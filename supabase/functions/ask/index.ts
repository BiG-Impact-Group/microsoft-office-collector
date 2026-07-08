import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Conversation-aware RAG assistant. Embeds the latest question (gte-small),
// retrieves the user's most relevant email + document chunks under RLS, grounds
// with a file inventory, and asks Claude to answer — carrying prior turns of the
// conversation for continuity. Persists the question and the answer to
// chat_conversations / chat_messages (RLS-scoped to the caller). Without
// ANTHROPIC_API_KEY it returns retrieval-only (sources) but still persists.

declare const Supabase: {
  ai: { Session: new (model: string) => { run: (input: string, opts: Record<string, unknown>) => Promise<number[]> } };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-4-8";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const MAX_HISTORY = 10;

interface ContextRow {
  kind: "email" | "document";
  source_id: string;
  title: string | null;
  content: string;
  similarity: number;
}
interface Source {
  n: number;
  kind: "email" | "document";
  title: string;
  source_id: string;
}
interface Turn {
  role: "user" | "assistant";
  content: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);

  let body: { question?: string; conversationId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const question = (body.question ?? "").trim();
  if (!question) return json({ error: "Missing question" }, 400);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Invalid session" }, 401);

  // ── Resolve or create the conversation (RLS ensures ownership) ──
  let conversationId = body.conversationId ?? null;
  if (conversationId) {
    const { data } = await supabase
      .from("chat_conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!data) conversationId = null; // unknown/not owned → start fresh
  }
  if (!conversationId) {
    const { data, error } = await supabase
      .from("chat_conversations")
      .insert({ title: question.slice(0, 80) })
      .select("id")
      .single();
    if (error || !data) {
      console.error("conversation create failed:", error);
      return json({ error: "Could not start conversation" }, 500);
    }
    conversationId = (data as { id: string }).id;
  }

  // Prior turns (before this one) for continuity.
  const { data: histData } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  let history = ((histData ?? []) as Turn[]).slice(-MAX_HISTORY);
  // Claude requires the first message to be from the user.
  while (history.length && history[0].role !== "user") history = history.slice(1);

  // ── Retrieve context for the latest question ──
  let embedding: number[];
  try {
    embedding = await new Supabase.ai.Session("gte-small").run(question, { mean_pool: true, normalize: true });
  } catch (err) {
    console.error("embedding failed:", err);
    return json({ error: "Failed to embed question" }, 502);
  }

  const { data: matchData, error: matchErr } = await supabase.rpc("match_context", {
    query_embedding: JSON.stringify(embedding),
    match_count: 12,
  });
  if (matchErr) {
    console.error("match_context failed:", matchErr);
    return json({ error: "Retrieval failed" }, 500);
  }
  const rows = (matchData ?? []) as ContextRow[];
  const sources: Source[] = rows.map((r, i) => ({
    n: i + 1,
    kind: r.kind,
    title: r.title ?? "(untitled)",
    source_id: r.source_id,
  }));

  // File inventory (authoritative list for "what files do I have" questions).
  const { data: invData } = await supabase
    .from("documents")
    .select("name, source")
    .in("status", ["converted", "skipped"])
    .order("created_at", { ascending: false })
    .limit(200);
  const files = (invData ?? []) as { name: string; source: string }[];
  const sourceLabel = (s: string) =>
    s === "onedrive" ? "OneDrive" : s === "email_attachment" ? "Email attachment" : s;
  const inventory = files.length
    ? "The user's stored files (these ARE the files in their drive/workspace):\n" +
      files.map((f) => `- ${f.name} (${sourceLabel(f.source)})`).join("\n")
    : "The user has no stored files yet.";

  // Persist the user's message now that we're committed to answering.
  await supabase.from("chat_messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: question,
  });

  // Finalizes a turn: persist the assistant message, bump the conversation, reply.
  const finish = async (answer: string | null, note?: string) => {
    await supabase.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: answer ?? "",
      sources: sources.length ? sources : null,
    });
    await supabase
      .from("chat_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);
    return json({ conversationId, answer, sources, ...(note ? { note } : {}) });
  };

  if (!ANTHROPIC_API_KEY) {
    return finish(
      null,
      "Set the ANTHROPIC_API_KEY function secret to get generated answers. Showing the most relevant sources.",
    );
  }

  if (rows.length === 0 && files.length === 0) {
    return finish("I couldn't find anything relevant in your synced mail or documents.");
  }

  const contextText = [
    `FILE INVENTORY:\n${inventory}`,
    ...rows.map((r, i) => `[${i + 1}] (${r.kind}) ${r.title ?? "(untitled)"}\n${r.content}`),
  ].join("\n\n");

  const system =
    "You are an ongoing-conversation assistant answering questions about the user's email, documents, and " +
    "OneDrive files using ONLY the provided context and the earlier turns of this conversation. " +
    "The FILE INVENTORY section is the authoritative list of the files/documents the user has — use it to " +
    "answer questions about what files or documents they have (in their drive/OneDrive/workspace). " +
    "Cite the sources you use with bracketed numbers like [1], [2]. " +
    "If the context does not contain the answer, say you don't know — do not invent details. " +
    "Respond directly with the answer; no preamble, no description of your reasoning.";

  const messages = [
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user" as const, content: `Context:\n${contextText}\n\n---\nQuestion: ${question}` },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1500, system, messages }),
  });

  if (!res.ok) {
    console.error("Anthropic API error:", res.status, await res.text());
    return finish(null, "Answer generation failed; showing sources.");
  }

  const completion = (await res.json()) as {
    stop_reason?: string;
    content?: Array<{ type: string; text?: string }>;
  };
  if (completion.stop_reason === "refusal") {
    return finish("I can't answer that one.");
  }
  const answer = (completion.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();

  return finish(answer);
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
