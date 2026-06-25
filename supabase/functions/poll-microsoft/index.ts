import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getValidAccessToken } from "../_shared/graphToken.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Shared secret the pg_cron job presents in the x-poll-secret header.
const POLL_SECRET = Deno.env.get("POLL_SECRET")!;

interface ConnectedAccount {
  id: string;
  user_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string | null;
  last_synced_at: string | null;
}

type Category = "urgent" | "primary" | "promotions" | "junk" | "sent";

interface Recipient {
  emailAddress: { address: string };
}

interface GraphMessage {
  id: string;
  subject: string | null;
  from: { emailAddress: { address: string } } | null;
  toRecipients: Recipient[] | null;
  ccRecipients: Recipient[] | null;
  bodyPreview: string | null;
  body: { content: string; contentType: string } | null;
  receivedDateTime: string;
  isRead: boolean;
  importance: "low" | "normal" | "high" | null;
  inferenceClassification: "focused" | "other" | null;
  flag: { flagStatus: "notFlagged" | "flagged" | "complete" } | null;
}

Deno.serve(async (req: Request) => {
  // ── Auth: the pg_cron job presents a shared secret in x-poll-secret.
  // (The gateway also enforces a valid JWT via verify_jwt; the cron sends the
  // anon key for that. We avoid putting the service-role key in a DB setting.)
  if (req.headers.get("x-poll-secret") !== POLL_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Fetch all connected Microsoft accounts ────────────────
  const { data: accounts, error: fetchErr } = await db
    .from("connected_accounts")
    .select("id, user_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, last_synced_at")
    .eq("provider", "microsoft")
    .eq("is_active", true);

  if (fetchErr) {
    console.error("Failed to fetch accounts:", fetchErr);
    return json({ error: "DB error" }, 500);
  }

  if (!accounts || accounts.length === 0) {
    return json({ ok: true, synced: 0 });
  }

  let synced = 0;
  let errors = 0;

  // Process sequentially to respect Graph rate limits
  for (const account of accounts as ConnectedAccount[]) {
    try {
      await syncAccount(db, account);
      synced++;
    } catch (err) {
      console.error(`Failed to sync account ${account.id}:`, err);
      errors++;
    }
  }

  return json({ ok: true, synced, errors });
});

async function syncAccount(
  db: ReturnType<typeof createClient>,
  account: ConnectedAccount
): Promise<void> {
  // ── 1. Valid access token (decrypts; refreshes + persists if near expiry) ──
  const activeAccessToken = await getValidAccessToken(db, account);

  // ── 3. Fetch new messages from Inbox, Junk, and Sent Items ──
  const since = account.last_synced_at ?? new Date(0).toISOString();
  const [inboxMsgs, junkMsgs, sentMsgs] = await Promise.all([
    fetchNewMessages(activeAccessToken, since, "inbox"),
    fetchNewMessages(activeAccessToken, since, "junkemail"),
    fetchNewMessages(activeAccessToken, since, "sentitems"),
  ]);

  const all = [...inboxMsgs, ...junkMsgs, ...sentMsgs];
  if (all.length === 0) {
    // Nothing new. Do NOT advance the watermark to now(): a message could
    // arrive with a receivedDateTime between this query and now(), and a
    // now() watermark would skip it on the next poll. Leaving the watermark
    // unchanged keeps the window gap-free (re-queries are cheap + deduped).
    return;
  }

  // ── 4. Classify + upsert (deduped by unique constraint) ───
  // Inbox messages are classified from Graph signals; anything in the Junk
  // folder is always 'junk' regardless of those signals.
  const rows = [
    ...inboxMsgs.map((m) => toRow(account.id, m, classifyCategory(m))),
    ...junkMsgs.map((m) => toRow(account.id, m, "junk")),
    ...sentMsgs.map((m) => toRow(account.id, m, "sent")),
  ];

  const { error: upsertErr } = await db
    .from("emails")
    .upsert(rows, { onConflict: "account_id,provider_message_id", ignoreDuplicates: true });

  if (upsertErr) {
    throw new Error(`Failed to upsert emails: ${upsertErr.message}`);
  }

  // ── 5. Advance last_synced_at to the newest message actually ingested
  // (across both folders). Using the max receivedDateTime (not now())
  // guarantees the filter window never jumps past a message we haven't stored.
  const newest = all.reduce(
    (max, m) => (m.receivedDateTime > max ? m.receivedDateTime : max),
    all[0].receivedDateTime
  );
  await db
    .from("connected_accounts")
    .update({ last_synced_at: newest })
    .eq("id", account.id);
}

// Derive a category for inbox messages (junk/sent are handled by folder).
function classifyCategory(msg: GraphMessage): "primary" | "promotions" {
  // Focused Inbox "other" is where newsletters/promotions/subscriptions land.
  if (msg.inferenceClassification === "other") return "promotions";
  return "primary";
}

function toRow(accountId: string, msg: GraphMessage, category: Category) {
  return {
    account_id: accountId,
    provider_message_id: msg.id,
    subject: msg.subject ?? "(no subject)",
    from_address: msg.from?.emailAddress?.address ?? "",
    preview: msg.bodyPreview ?? "",
    body_html: msg.body
      ? msg.body.contentType === "html"
        ? msg.body.content
        : `<pre>${escapeHtml(msg.body.content)}</pre>`
      : "",
    received_at: msg.receivedDateTime,
    is_read: msg.isRead,
    category,
    importance: msg.importance ?? null,
    inference_classification: msg.inferenceClassification ?? null,
    to_recipients: (msg.toRecipients ?? []).map((r) => r.emailAddress.address),
    cc_recipients: (msg.ccRecipients ?? []).map((r) => r.emailAddress.address),
  };
}

// Cap pages so one very backlogged account can't run the function forever.
// 20 pages × 50 = up to 1000 messages per account per poll; the rest are
// picked up on the next run because the watermark only advances past what
// we ingested.
const MAX_PAGES = 20;

async function fetchNewMessages(
  accessToken: string,
  since: string,
  folder: "inbox" | "junkemail" | "sentitems"
): Promise<GraphMessage[]> {
  // ISO 8601 format required by OData $filter.
  // Order ASCENDING and follow @odata.nextLink so we ingest the *oldest*
  // unsynced messages first and never drop a page beyond $top.
  const sinceEncoded = encodeURIComponent(since);
  let url: string | null =
    `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages` +
    `?$select=id,subject,from,toRecipients,ccRecipients,bodyPreview,body,receivedDateTime,isRead,importance,inferenceClassification,flag` +
    `&$filter=receivedDateTime gt ${sinceEncoded}` +
    `&$orderby=receivedDateTime asc` +
    `&$top=50`;

  const messages: GraphMessage[] = [];
  let pages = 0;

  while (url && pages < MAX_PAGES) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`Graph messages fetch failed: ${await res.text()}`);
    }

    const data = await res.json() as {
      value: GraphMessage[];
      "@odata.nextLink"?: string;
    };
    messages.push(...(data.value ?? []));
    url = data["@odata.nextLink"] ?? null;
    pages++;
  }

  return messages;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
