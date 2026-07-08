import { supabase } from "./lib/supabase.js";
import type { AskSource } from "./emails.js";

// Shared, single-source-of-truth chat store for the assistant. Both the docked
// FAB panel and the full Assistant page render from and drive this store, so a
// conversation started in one appears in the other. History is persisted
// server-side by the `ask` edge function; reads here are RLS-scoped to the user.

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: AskSource[];
  pending?: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  updated_at: string;
}

interface State {
  conversationId: string | null;
  messages: ChatMessage[];
  sending: boolean;
}

const state: State = { conversationId: null, messages: [], sending: false };
const listeners = new Set<() => void>();

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(): void {
  for (const fn of listeners) fn();
}

export function getState(): Readonly<State> {
  return state;
}

/** Clears the live thread so the next message starts a brand-new conversation. */
export function newConversation(): void {
  state.conversationId = null;
  state.messages = [];
  state.sending = false;
  notify();
}
// The FAB's X ends the current chat (same behavior as starting fresh).
export const endConversation = newConversation;

export async function sendMessage(text: string): Promise<void> {
  const question = text.trim();
  if (!question || state.sending) return;

  state.messages.push({ role: "user", content: question });
  state.messages.push({ role: "assistant", content: "", pending: true });
  state.sending = true;
  notify();

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const jwt = session?.access_token;
    if (!jwt) throw new Error("Not signed in");

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const res = await fetch(`${supabaseUrl}/functions/v1/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ question, conversationId: state.conversationId }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      conversationId?: string;
      answer?: string | null;
      sources?: AskSource[];
      note?: string;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? `Server error (${res.status})`);

    if (data.conversationId) state.conversationId = data.conversationId;
    const reply = state.messages[state.messages.length - 1];
    reply.pending = false;
    reply.content = data.answer ?? data.note ?? "(no answer)";
    reply.sources = data.sources ?? [];
  } catch (err) {
    const reply = state.messages[state.messages.length - 1];
    reply.pending = false;
    reply.content = err instanceof Error ? err.message : "Something went wrong.";
  } finally {
    state.sending = false;
    notify();
  }
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const { data, error } = await supabase
    .from("chat_conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as ConversationSummary[];
}

/** Loads a past conversation into the live thread (both views then show it). */
export async function loadConversation(id: string): Promise<void> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("role, content, sources")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  state.conversationId = id;
  state.messages = ((data ?? []) as { role: "user" | "assistant"; content: string; sources: AskSource[] | null }[])
    .map((m) => ({ role: m.role, content: m.content, sources: m.sources ?? undefined }));
  state.sending = false;
  notify();
}
