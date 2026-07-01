import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getValidAccessToken } from "../_shared/graphToken.ts";

// Collects email attachments via Microsoft Graph, converts them to markdown,
// and stores them in `documents` (the index cron then embeds them). Triggered
// server-side with x-poll-secret. Idempotent (deduped on email_id + name).
//
// Conversion support:
//   text / csv / html / json  -> inline (always)
//   pdf                        -> Claude document API (needs ANTHROPIC_API_KEY)
//   docx / xlsx / other binary -> recorded as status='skipped' (follow-up)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const POLL_SECRET = Deno.env.get("POLL_SECRET")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-4-8";

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

async function convertToMarkdown(name: string, mime: string, b64: string): Promise<string | null> {
  const lower = name.toLowerCase();
  const isText =
    mime.startsWith("text/") ||
    mime === "application/json" ||
    /\.(txt|md|markdown|csv|tsv|json|log|html?|xml)$/.test(lower);

  if (isText) {
    const text = new TextDecoder().decode(base64ToBytes(b64));
    if (mime.includes("html") || /\.html?$/.test(lower)) return stripHtml(text);
    return text.slice(0, 100_000);
  }

  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    if (!ANTHROPIC_API_KEY) return null; // can't convert without the key
    return await pdfToMarkdown(b64);
  }

  // docx / xlsx / pptx / images / other binary — not yet handled.
  return null;
}

async function pdfToMarkdown(b64: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 8000,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
            { type: "text", text: "Convert this document to clean Markdown. Output only the Markdown, no preamble." },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`pdf conversion failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100_000);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
