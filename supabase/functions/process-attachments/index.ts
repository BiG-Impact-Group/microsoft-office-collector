import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getValidAccessToken } from "../_shared/graphToken.ts";
import { convertToMarkdown } from "../_shared/convert.ts";

// Collects email attachments via Microsoft Graph, converts them to markdown,
// and stores them in `documents` (the index cron then embeds them). Triggered
// server-side with x-poll-secret. Idempotent (deduped on email_id + name).
// Conversion lives in _shared/convert.ts.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const POLL_SECRET = Deno.env.get("POLL_SECRET")!;

const MAX_MESSAGES_PER_RUN = 10;
const MAX_ATTACHMENTS_PER_RUN = 15;

interface Account {
  id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string | null;
}

interface GraphAttachment {
  "@odata.type": string;
  id: string;
  name: string;
  contentType: string | null;
  size: number;
  contentBytes?: string; // base64, present for fileAttachment when inlined
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

  let stored = 0;
  let processed = 0;

  for (const account of (accounts ?? []) as Account[]) {
    if (processed >= MAX_ATTACHMENTS_PER_RUN) break;
    let token: string;
    try {
      token = await getValidAccessToken(db, account);
    } catch (err) {
      console.error(`token failed for ${account.id}:`, err);
      continue;
    }

    // Recent messages that have attachments.
    const listRes = await fetch(
      "https://graph.microsoft.com/v1.0/me/messages" +
        "?$filter=hasAttachments eq true&$select=id&$orderby=receivedDateTime desc" +
        `&$top=${MAX_MESSAGES_PER_RUN}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!listRes.ok) {
      console.error("graph message list failed:", await listRes.text());
      continue;
    }
    const msgs = ((await listRes.json()) as { value: { id: string }[] }).value ?? [];

    for (const msg of msgs) {
      if (processed >= MAX_ATTACHMENTS_PER_RUN) break;

      // Link to our stored email row (skip if we haven't synced it).
      const { data: emailRow } = await db
        .from("emails")
        .select("id")
        .eq("account_id", account.id)
        .eq("provider_message_id", msg.id)
        .maybeSingle();
      if (!emailRow) continue;
      const emailId = (emailRow as { id: string }).id;

      const attRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${msg.id}/attachments`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!attRes.ok) continue;
      const attachments = ((await attRes.json()) as { value: GraphAttachment[] }).value ?? [];

      for (const att of attachments) {
        if (processed >= MAX_ATTACHMENTS_PER_RUN) break;
        if (att["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;

        // Dedupe: skip if we already have this attachment for this email.
        const { data: existing } = await db
          .from("documents")
          .select("id")
          .eq("email_id", emailId)
          .eq("name", att.name)
          .maybeSingle();
        if (existing) continue;

        processed++;
        const row = await toDocument(account.id, emailId, att);
        const { error: insErr } = await db.from("documents").insert(row);
        if (insErr) {
          console.error(`document insert failed (${att.name}):`, insErr);
          continue;
        }
        if (row.status === "converted") stored++;
      }
    }
  }

  return json({ ok: true, attachments_seen: processed, converted: stored });
});

async function toDocument(accountId: string, emailId: string, att: GraphAttachment) {
  const base = {
    account_id: accountId,
    email_id: emailId,
    source: "email_attachment",
    name: att.name,
    mime_type: att.contentType,
  };

  if (!att.contentBytes) {
    return { ...base, status: "skipped", error: "no inline content (attachment too large)" };
  }

  try {
    const result = await convertToMarkdown(att.name, att.contentType ?? "", att.contentBytes);
    if (result === null) {
      return { ...base, status: "skipped", error: "unsupported type (docx/xlsx/binary)" };
    }
    return { ...base, status: "converted", markdown: result };
  } catch (err) {
    return { ...base, status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
