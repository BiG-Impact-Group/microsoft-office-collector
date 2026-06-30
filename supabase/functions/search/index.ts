import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Semantic search over the caller's emails. Embeds the query with gte-small and
// calls match_email_chunks under the user's JWT, so RLS returns only their mail.

declare const Supabase: {
  ai: { Session: new (model: string) => { run: (input: string, opts: Record<string, unknown>) => Promise<number[]> } };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Missing authorization" }, 401);
  }

  let body: { query?: string; limit?: number };
  try {
    body = (await req.json()) as { query?: string; limit?: number };
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const query = (body.query ?? "").trim();
  if (!query) {
    return json({ error: "Missing query" }, 400);
  }
  const limit = Math.min(Math.max(body.limit ?? 20, 1), 50);

  // Embed the query (gte-small, keyless).
  let queryEmbedding: number[];
  try {
    const model = new Supabase.ai.Session("gte-small");
    queryEmbedding = await model.run(query, { mean_pool: true, normalize: true });
  } catch (err) {
    console.error("embedding failed:", err);
    return json({ error: "Failed to embed query" }, 502);
  }

  // RLS-scoped client: the user's JWT decides which chunks are visible.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await supabase.rpc("match_email_chunks", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: limit,
  });

  if (error) {
    console.error("match_email_chunks failed:", error);
    return json({ error: "Search failed" }, 500);
  }

  return json({ results: data ?? [] });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
