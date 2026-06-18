import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  // ── 1. Decrypt tokens ──────────────────────────────────────
  const { data: accessToken, error: decAccessErr } = await db
    .rpc("decrypt_token", { ciphertext: account.access_token_encrypted });
  const { data: refreshToken, error: decRefreshErr } = await db
    .rpc("decrypt_token", { ciphertext: account.refresh_token_encrypted });

  if (decAccessErr || decRefreshErr || !accessToken || !refreshToken) {
    throw new Error("Failed to decrypt tokens");
  }

  let activeAccessToken: string = accessToken as string;

  // ── 2. Proactive token refresh ────────────────────────────
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (Date.now() + REFRESH_BUFFER_MS >= expiresAt) {
    activeAccessToken = await refreshAccessToken(db, account, refreshToken as string);
  }

  // ── 3. Fetch new messages from Graph ─────────────────────
  const since = account.last_synced_at ?? new Date(0).toISOString();
  const messages = await fetchNewMessages(activeAccessToken, since);

  if (messages.length === 0) {
    // Still update last_synced_at so the filter window advances
    await db
      .from("connected_accounts")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", account.id);
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

  // ── 5. Advance last_synced_at ─────────────────────────────
  await db
    .from("connected_accounts")
    .update({ last_synced_at: new Date().toISOString() })
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

  // Re-encrypt and persist updated tokens
  const { data: encAccess } = await db.rpc("encrypt_token", { plaintext: tokens.access_token });
  const newRefresh = tokens.refresh_token ?? refreshToken;
  const { data: encRefresh } = await db.rpc("encrypt_token", { plaintext: newRefresh });

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

async function fetchNewMessages(
  accessToken: string,
  since: string
): Promise<GraphMessage[]> {
  // ISO 8601 format required by OData $filter
  const sinceEncoded = encodeURIComponent(since);

  const url =
    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages" +
    `?$select=id,subject,from,bodyPreview,body,receivedDateTime,isRead` +
    `&$filter=receivedDateTime gt ${sinceEncoded}` +
    `&$orderby=receivedDateTime desc` +
    `&$top=50`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Graph messages fetch failed: ${await res.text()}`);
  }

  const data = await res.json() as { value: GraphMessage[] };
  return data.value ?? [];
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
