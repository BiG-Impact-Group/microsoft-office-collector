import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Chunks + embeds emails that don't yet have chunks, using Supabase's built-in
// gte-small model (384-dim, no external API key). Triggered server-side with
// the x-poll-secret header (same as poll-microsoft). Idempotent: only embeds
// emails missing from email_chunks.

// `Supabase` is a global provided by the Supabase Edge runtime.
declare const Supabase: {
  ai: { Session: new (model: string) => { run: (input: string, opts: Record<string, unknown>) => Promise<number[]> } };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const POLL_SECRET = Deno.env.get("POLL_SECRET")!;

const CHUNK_SIZE = 1200;       // characters per chunk
// Small per-run caps: gte-small inference is CPU-bound and the edge runtime
// kills long requests. A per-minute cron drives the backfill and keeps up with
// new mail. Worst case ~15 embeds/run stays well under the limit.
const MAX_CHUNKS_PER_EMAIL = 5;
const MAX_EMAILS_PER_RUN = 3;

interface EmailRow {
  id: string;
  account_id: string;
  subject: string | null;
  preview: string | null;
  body_html: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("x-poll-secret") !== POLL_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Which emails already have chunks?
  const { data: chunked, error: chunkErr } = await db.from("email_chunks").select("email_id");
  if (chunkErr) {
    console.error("chunk lookup failed:", chunkErr);
    return json({ error: "DB error" }, 500);
  }
  const done = new Set((chunked ?? []).map((r) => (r as { email_id: string }).email_id));

  const { data: emails, error: emailErr } = await db
    .from("emails")
    .select("id, account_id, subject, preview, body_html");
  if (emailErr) {
    console.error("email fetch failed:", emailErr);
    return json({ error: "DB error" }, 500);
  }

  const pending = (emails ?? []).filter((e) => !done.has((e as EmailRow).id));
  const batch = pending.slice(0, MAX_EMAILS_PER_RUN) as EmailRow[];
  if (batch.length === 0) {
    return json({ ok: true, indexed: 0, chunks: 0, remaining: 0 });
  }

  const model = new Supabase.ai.Session("gte-small");
  let chunkCount = 0;

  for (const email of batch) {
    const parts = chunkText(buildText(email));
    if (parts.length === 0) continue;

    const rows = [];
    for (let i = 0; i < parts.length; i++) {
      const embedding = await model.run(parts[i], { mean_pool: true, normalize: true });
      rows.push({
        email_id: email.id,
        account_id: email.account_id,
        chunk_index: i,
        content: parts[i],
        embedding: JSON.stringify(embedding),
      });
    }

    const { error: insErr } = await db
      .from("email_chunks")
      .upsert(rows, { onConflict: "email_id,chunk_index", ignoreDuplicates: true });
    if (insErr) {
      console.error(`chunk insert failed for ${email.id}:`, insErr);
      continue;
    }
    chunkCount += rows.length;
  }

  return json({
    ok: true,
    indexed: batch.length,
    chunks: chunkCount,
    remaining: pending.length - batch.length,
  });
});

function buildText(email: EmailRow): string {
  const body = stripHtml(email.body_html ?? "") || (email.preview ?? "");
  return [email.subject ?? "", body].filter(Boolean).join("\n\n").slice(0, 20000);
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkText(text: string): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < MAX_CHUNKS_PER_EMAIL; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
