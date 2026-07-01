import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Chunks + embeds converted documents (markdown) into document_chunks with
// gte-small, in small CPU-safe batches. Driven by a per-minute cron, same
// pattern as index-emails. Idempotent.

declare const Supabase: {
  ai: { Session: new (model: string) => { run: (input: string, opts: Record<string, unknown>) => Promise<number[]> } };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const POLL_SECRET = Deno.env.get("POLL_SECRET")!;

const CHUNK_SIZE = 1200;
const MAX_CHUNKS_PER_DOC = 8;
const MAX_DOCS_PER_RUN = 3;

interface DocRow {
  id: string;
  account_id: string;
  markdown: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("x-poll-secret") !== POLL_SECRET) return json({ error: "Forbidden" }, 403);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: chunked } = await db.from("document_chunks").select("document_id");
  const done = new Set((chunked ?? []).map((r) => (r as { document_id: string }).document_id));

  const { data: docs, error } = await db
    .from("documents")
    .select("id, account_id, markdown")
    .eq("status", "converted");
  if (error) {
    console.error("doc fetch failed:", error);
    return json({ error: "DB error" }, 500);
  }

  const pending = (docs ?? []).filter((d) => !done.has((d as DocRow).id) && (d as DocRow).markdown);
  const batch = pending.slice(0, MAX_DOCS_PER_RUN) as DocRow[];
  if (batch.length === 0) return json({ ok: true, indexed: 0, chunks: 0, remaining: 0 });

  const model = new Supabase.ai.Session("gte-small");
  let chunkCount = 0;

  for (const doc of batch) {
    const parts = chunkText(doc.markdown ?? "");
    if (parts.length === 0) continue;
    const rows = [];
    for (let i = 0; i < parts.length; i++) {
      const embedding = await model.run(parts[i], { mean_pool: true, normalize: true });
      rows.push({
        document_id: doc.id,
        account_id: doc.account_id,
        chunk_index: i,
        content: parts[i],
        embedding: JSON.stringify(embedding),
      });
    }
    const { error: insErr } = await db
      .from("document_chunks")
      .upsert(rows, { onConflict: "document_id,chunk_index", ignoreDuplicates: true });
    if (insErr) {
      console.error(`chunk insert failed for ${doc.id}:`, insErr);
      continue;
    }
    chunkCount += rows.length;
  }

  return json({ ok: true, indexed: batch.length, chunks: chunkCount, remaining: pending.length - batch.length });
});

function chunkText(text: string): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < MAX_CHUNKS_PER_DOC; i += CHUNK_SIZE) {
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
