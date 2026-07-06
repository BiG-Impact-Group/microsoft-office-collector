import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getValidAccessToken } from "../_shared/graphToken.ts";
import { convertToMarkdown, bytesToBase64 } from "../_shared/convert.ts";

// Collects OneDrive files drive-wide via Microsoft Graph delta, converts them
// to markdown, and stores them in `documents` (source='onedrive'); the index
// cron embeds them. Triggered with x-poll-secret. Requires the Files.Read
// OAuth scope — inert (Graph 403) until the account is reconnected with it.
//
// Enumeration uses /me/drive/root/delta (the whole drive incl. nested folders),
// persisting the returned cursor on connected_accounts.onedrive_delta_link:
//   - @odata.nextLink  → more pages to walk; resume there next run.
//   - @odata.deltaLink → caught up; next run returns only new/changed items.
// One page is processed per run to stay within the edge CPU/time budget; the
// cursor only advances once a page is fully consumed under the per-run cap, so
// large pages are drained across runs (the external_id dedupe makes that idempotent).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const POLL_SECRET = Deno.env.get("POLL_SECRET")!;

const DELTA_START = "https://graph.microsoft.com/v1.0/me/drive/root/delta?$top=50";
const MAX_FILES_PER_RUN = 8;
const MAX_FILE_BYTES = 5_000_000;

interface Account {
  id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string | null;
  onedrive_delta_link: string | null;
}

interface DriveItem {
  id: string;
  name?: string;
  size?: number;
  file?: { mimeType?: string };
  folder?: unknown;
  deleted?: unknown;
  "@microsoft.graph.downloadUrl"?: string;
}

interface DeltaPage {
  value?: DriveItem[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("x-poll-secret") !== POLL_SECRET) return json({ error: "Forbidden" }, 403);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: accounts, error } = await db
    .from("connected_accounts")
    .select("id, access_token_encrypted, refresh_token_encrypted, token_expires_at, onedrive_delta_link")
    .eq("provider", "microsoft")
    .eq("is_active", true);
  if (error) {
    console.error("account fetch failed:", error);
    return json({ error: "DB error" }, 500);
  }

  let seen = 0;
  let converted = 0;

  for (const account of (accounts ?? []) as Account[]) {
    if (seen >= MAX_FILES_PER_RUN) break;

    let token: string;
    try {
      token = await getValidAccessToken(db, account);
    } catch (err) {
      console.error(`token failed for ${account.id}:`, err);
      continue;
    }

    const pageUrl = account.onedrive_delta_link ?? DELTA_START;
    const pageRes = await fetch(pageUrl, { headers: { Authorization: `Bearer ${token}` } });

    // 410 Gone = the delta token expired (resyncRequired). Reset to a fresh
    // enumeration on the next run.
    if (pageRes.status === 410) {
      console.error(`delta token expired for ${account.id}; resetting`);
      await db.from("connected_accounts").update({ onedrive_delta_link: null }).eq("id", account.id);
      continue;
    }
    if (!pageRes.ok) {
      // 403 here means Files.Read hasn't been granted — expected until reconnect.
      console.error("drive/root/delta failed:", pageRes.status, await pageRes.text());
      continue;
    }

    const page = (await pageRes.json()) as DeltaPage;
    const files = (page.value ?? []).filter((it) => it.file && !it.deleted);

    let capped = false;
    for (const item of files) {
      if (seen >= MAX_FILES_PER_RUN) {
        capped = true;
        break;
      }
      if ((item.size ?? 0) > MAX_FILE_BYTES) continue;

      const { data: existing } = await db
        .from("documents")
        .select("id")
        .eq("account_id", account.id)
        .eq("source", "onedrive")
        .eq("external_id", item.id)
        .maybeSingle();
      if (existing) continue;

      seen++;
      let b64: string;
      try {
        b64 = bytesToBase64(await downloadBytes(item, token));
      } catch (err) {
        await db.from("documents").insert(failed(account.id, item, err));
        continue;
      }

      const row = await toDocument(account.id, item, b64);
      const { error: insErr } = await db.from("documents").insert(row);
      if (insErr) {
        console.error(`document insert failed (${item.name}):`, insErr);
        continue;
      }
      if (row.status === "converted") converted++;
    }

    // Only advance the cursor when the whole page was consumed; a capped page is
    // retried next run (already-inserted items are skipped by the dedupe check).
    if (!capped) {
      const next = page["@odata.nextLink"] ?? page["@odata.deltaLink"] ?? null;
      if (next) await db.from("connected_accounts").update({ onedrive_delta_link: next }).eq("id", account.id);
    }
  }

  return json({ ok: true, files_seen: seen, converted });
});

async function downloadBytes(item: DriveItem, token: string): Promise<Uint8Array> {
  const url = item["@microsoft.graph.downloadUrl"];
  if (url) {
    const dl = await fetch(url);
    if (!dl.ok) throw new Error(`download failed: ${dl.status}`);
    return new Uint8Array(await dl.arrayBuffer());
  }
  // Delta pages don't always include a pre-authed download URL; fall back to the
  // authenticated content endpoint.
  const dl = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${item.id}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!dl.ok) throw new Error(`content fetch failed: ${dl.status}`);
  return new Uint8Array(await dl.arrayBuffer());
}

async function toDocument(accountId: string, item: DriveItem, b64: string) {
  const base = {
    account_id: accountId,
    source: "onedrive",
    external_id: item.id,
    name: item.name ?? "(unnamed)",
    mime_type: item.file?.mimeType ?? null,
    email_id: null,
  };
  try {
    const result = await convertToMarkdown(item.name ?? "", item.file?.mimeType ?? "", b64);
    if (result === null) return { ...base, status: "skipped", error: "unsupported type (docx/xlsx/binary)" };
    return { ...base, status: "converted", markdown: result };
  } catch (err) {
    return { ...base, status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

function failed(accountId: string, item: DriveItem, err: unknown) {
  return {
    account_id: accountId,
    source: "onedrive",
    external_id: item.id,
    name: item.name ?? "(unnamed)",
    mime_type: item.file?.mimeType ?? null,
    email_id: null,
    status: "failed",
    error: err instanceof Error ? err.message : String(err),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
