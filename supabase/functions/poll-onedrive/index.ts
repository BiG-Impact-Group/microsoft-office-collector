import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getValidAccessToken } from "../_shared/graphToken.ts";
import { convertToMarkdown, bytesToBase64 } from "../_shared/convert.ts";

// Collects recent OneDrive files via Microsoft Graph, converts them to markdown,
// and stores them in `documents` (source='onedrive'); the index cron embeds
// them. Triggered with x-poll-secret. Requires the Files.Read OAuth scope —
// inert (Graph 403) until the account is reconnected with that scope granted.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const POLL_SECRET = Deno.env.get("POLL_SECRET")!;

const MAX_FILES_PER_RUN = 8;
const MAX_FILE_BYTES = 5_000_000;

interface Account {
  id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string | null;
}

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  file?: { mimeType?: string };
  "@microsoft.graph.downloadUrl"?: string;
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("x-poll-secret") !== POLL_SECRET) return json({ error: "Forbidden" }, 403);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: accounts, error } = await db
    .from("connected_accounts")
    .select("id, access_token_encrypted, refresh_token_encrypted, token_expires_at")
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

    const listRes = await fetch("https://graph.microsoft.com/v1.0/me/drive/recent?$top=25", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) {
      // 403 here means Files.Read hasn't been granted — expected until reconnect.
      console.error("drive/recent failed:", listRes.status, await listRes.text());
      continue;
    }
    const items = (((await listRes.json()) as { value: DriveItem[] }).value ?? []).filter(
      (it) => it.file && it["@microsoft.graph.downloadUrl"]
    );

    for (const item of items) {
      if (seen >= MAX_FILES_PER_RUN) break;
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
        const dl = await fetch(item["@microsoft.graph.downloadUrl"]!);
        if (!dl.ok) throw new Error(`download failed: ${dl.status}`);
        b64 = bytesToBase64(new Uint8Array(await dl.arrayBuffer()));
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
  }

  return json({ ok: true, files_seen: seen, converted });
});

async function toDocument(accountId: string, item: DriveItem, b64: string) {
  const base = {
    account_id: accountId,
    source: "onedrive",
    external_id: item.id,
    name: item.name,
    mime_type: item.file?.mimeType ?? null,
    email_id: null,
  };
  try {
    const result = await convertToMarkdown(item.name, item.file?.mimeType ?? "", b64);
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
    name: item.name,
    mime_type: item.file?.mimeType ?? null,
    email_id: null,
    status: "failed",
    error: err instanceof Error ? err.message : String(err),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
