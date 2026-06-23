import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptToken, encryptToken } from "../_shared/crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AZURE_CLIENT_ID = Deno.env.get("AZURE_CLIENT_ID")!;
const AZURE_CLIENT_SECRET = Deno.env.get("AZURE_CLIENT_SECRET")!;
const AZURE_TENANT = Deno.env.get("AZURE_TENANT") ?? "common";

// ms before expiry at which we proactively refresh the token (5 min)
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface ConnectedAccount {
  id: string;
  user_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string | null;
  last_synced_at: string | null;
}

interface GraphMessage {
  id: string;
  subject: string | null;
  from: { emailAddress: { address: string } } | null;
  bodyPreview: string | null;
  body: { content: string; contentType: string } | null;
  receivedDateTime: string;
  isRead: boolean;
}

Deno.serve(async (req: Request) => {
  // ── Auth: only accept calls from the pg_cron job (service role key) ──
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return json({ error: "Forbidden" }, 403);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Fetch all connected Microsoft accounts ────────────────
  const { data: accounts, error: fetchErr } = await db
    .from("connected_accounts")
    .select("id, user_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, last_synced_at")
    .eq("provider", "microsoft");

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
  // ── 1. Decrypt tokens (app-side AES-256-GCM) ──────────────
  let accessToken: string;
  let refreshToken: string;
  try {
    accessToken = await decryptToken(account.access_token_encrypted);
    refreshToken = await decryptToken(account.refresh_token_encrypted);
  } catch (err) {
    throw new Error(
      `Failed to decrypt tokens: ${err instanceof Error ? err.message : err}`
    );
  }

  let activeAccessToken = accessToken;

  // ── 2. Proactive token refresh ────────────────────────────
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (Date.now() + REFRESH_BUFFER_MS >= expiresAt) {
    activeAccessToken = await refreshAccessToken(db, account, refreshToken);
  }

  // ── 3. Fetch new messages from Graph ─────────────────────
  const since = account.last_synced_at ?? new Date(0).toISOString();
  const messages = await fetchNewMessages(activeAccessToken, since);

  if (messages.length === 0) {
    // Nothing new. Do NOT advance the watermark to now(): a message could
    // arrive with a receivedDateTime between this query and now(), and a
    // now() watermark would skip it on the next poll. Leaving the watermark
    // unchanged keeps the window gap-free (re-queries are cheap + deduped).
    return;
  }

  // ── 4. Upsert emails (deduplicated by unique constraint) ──
  const rows = messages.map((msg) => ({
    account_id: account.id,
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
  }));

  const { error: upsertErr } = await db
    .from("emails")
    .upsert(rows, { onConflict: "account_id,provider_message_id", ignoreDuplicates: true });

  if (upsertErr) {
    throw new Error(`Failed to upsert emails: ${upsertErr.message}`);
  }

  // ── 5. Advance last_synced_at to the newest message actually ingested.
  // Using the max receivedDateTime (not now()) guarantees the filter window
  // never jumps past a message we haven't stored.
  const newest = messages.reduce(
    (max, m) => (m.receivedDateTime > max ? m.receivedDateTime : max),
    messages[0].receivedDateTime
  );
  await db
    .from("connected_accounts")
    .update({ last_synced_at: newest })
    .eq("id", account.id);
}

async function refreshAccessToken(
  db: ReturnType<typeof createClient>,
  account: ConnectedAccount,
  refreshToken: string
): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${AZURE_TENANT}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: AZURE_CLIENT_ID,
        client_secret: AZURE_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: "offline_access User.Read Mail.Read",
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${await res.text()}`);
  }

  const tokens = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Re-encrypt and persist updated tokens. encryptToken throws on failure,
  // which aborts before the update so we never overwrite good tokens.
  const newRefresh = tokens.refresh_token ?? refreshToken;
  const encAccess = await encryptToken(tokens.access_token);
  const encRefresh = await encryptToken(newRefresh);

  await db
    .from("connected_accounts")
    .update({
      access_token_encrypted: encAccess,
      refresh_token_encrypted: encRefresh,
      token_expires_at: tokenExpiresAt,
    })
    .eq("id", account.id);

  return tokens.access_token;
}

// Cap pages so one very backlogged account can't run the function forever.
// 20 pages × 50 = up to 1000 messages per account per poll; the rest are
// picked up on the next run because the watermark only advances past what
// we ingested.
const MAX_PAGES = 20;

async function fetchNewMessages(
  accessToken: string,
  since: string
): Promise<GraphMessage[]> {
  // ISO 8601 format required by OData $filter.
  // Order ASCENDING and follow @odata.nextLink so we ingest the *oldest*
  // unsynced messages first and never drop a page beyond $top.
  const sinceEncoded = encodeURIComponent(since);
  let url: string | null =
    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages" +
    `?$select=id,subject,from,bodyPreview,body,receivedDateTime,isRead` +
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
