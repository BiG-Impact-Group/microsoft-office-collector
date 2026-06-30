import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// RAG: embed the question (gte-small), retrieve the user's most relevant email
// + document chunks under RLS, then ask Claude to answer from that context with
// citations. Without ANTHROPIC_API_KEY it returns retrieval-only (the sources).

declare const Supabase: {
  ai: { Session: new (model: string) => { run: (input: string, opts: Record<string, unknown>) => Promise<number[]> } };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
// Model is configurable; defaults to the current Opus. Set to claude-haiku-4-5
// for a cheaper/faster answerer.
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-4-8";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

interface ContextRow {
  kind: "email" | "document";
  source_id: string;
  title: string | null;
  content: string;
  similarity: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);

  let body: { question?: string };
  try {
    body = (await req.json()) as { question?: string };
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const question = (body.question ?? "").trim();
  if (!question) return json({ error: "Missing question" }, 400);

  // Embed the question.
  let embedding: number[];
  try {
    embedding = await new Supabase.ai.Session("gte-small").run(question, { mean_pool: true, normalize: true });
  } catch (err) {
    console.error("embedding failed:", err);
    return json({ error: "Failed to embed question" }, 502);
  }

  // Retrieve context under the caller's RLS.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await supabase.rpc("match_context", {
    query_embedding: JSON.stringify(embedding),
    match_count: 12,
  });
  if (error) {
    console.error("match_context failed:", error);
    return json({ error: "Retrieval failed" }, 500);
  }

  const rows = (data ?? []) as ContextRow[];
  const sources = rows.map((r, i) => ({
    n: i + 1,
    kind: r.kind,
    title: r.title ?? "(untitled)",
    source_id: r.source_id,
  }));

  // No key → retrieval-only.
  if (!ANTHROPIC_API_KEY) {
    return json({
      answer: null,
      sources,
      note: "Set the ANTHROPIC_API_KEY function secret to get generated answers. Showing the most relevant sources.",
    });
  }

  if (rows.length === 0) {
    return json({ answer: "I couldn't find anything relevant in your synced mail or documents.", sources: [] });
  }

  const contextText = rows
    .map((r, i) => `[${i + 1}] (${r.kind}) ${r.title ?? "(untitled)"}\n${r.content}`)
    .join("\n\n");

  const system =
    "You answer questions about the user's email and attached documents using ONLY the provided context. " +
    "Cite the sources you use with bracketed numbers like [1], [2]. " +
    "If the context does not contain the answer, say you don't know — do not invent details. " +
    "Respond directly with the answer; no preamble, no description of your reasoning.";

  // Minimal request shape: no thinking/effort/sampling params, so it's valid on
  // claude-opus-4-8, claude-haiku-4-5, and claude-sonnet-4-6 alike.
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: `Context:\n${contextText}\n\n---\nQuestion: ${question}` }],
    }),
  });

  if (!res.ok) {
    console.error("Anthropic API error:", res.status, await res.text());
    return json({ error: "Answer generation failed", sources }, 502);
  }

  const completion = (await res.json()) as {
    stop_reason?: string;
    content?: Array<{ type: string; text?: string }>;
  };
  if (completion.stop_reason === "refusal") {
    return json({ answer: "I can't answer that one.", sources });
  }
  const answer = (completion.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();

  return json({ answer, sources });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
