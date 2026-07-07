import {
  sendMessage,
  subscribe,
  getState,
  newConversation,
  loadConversation,
  listConversations,
  type ConversationSummary,
} from "./assistant.js";
import { renderThread, wireThread } from "./assistantRender.js";

// The full-page Assistant view: a past-logs sidebar + a large chat thread.
// Renders from the shared store, so it stays in sync with the FAB panel.

const SHELL = `
  <div class="assistant-page">
    <aside class="assistant-logs">
      <button class="btn btn-primary btn-sm" id="assistant-new-page">New chat</button>
      <div class="assistant-logs-list" id="assistant-logs-list"><p class="empty-state">Loading…</p></div>
    </aside>
    <main class="assistant-main">
      <div class="assistant-thread" id="assistant-thread"></div>
      <form class="assistant-page-form" id="assistant-page-form">
        <textarea id="assistant-page-input" rows="2" placeholder="Message the assistant…"></textarea>
        <button class="btn btn-primary" type="submit" id="assistant-page-send">Send</button>
      </form>
    </main>
  </div>
`;

export function mountAssistant(container: HTMLElement): () => void {
  container.innerHTML = SHELL;

  const threadEl = container.querySelector<HTMLElement>("#assistant-thread")!;
  const logsEl = container.querySelector<HTMLElement>("#assistant-logs-list")!;
  const form = container.querySelector("#assistant-page-form") as HTMLFormElement;
  const input = container.querySelector("#assistant-page-input") as HTMLTextAreaElement;
  const sendBtn = container.querySelector("#assistant-page-send") as HTMLButtonElement;
  wireThread(threadEl);

  let wasSending = false;

  const render = () => {
    const { messages, sending } = getState();
    renderThread(threadEl, messages, "Ask about your email, documents, and OneDrive files. Your past chats are on the left.");
    sendBtn.disabled = sending;
    threadEl.scrollTop = threadEl.scrollHeight;
    // Refresh the logs list when a send just finished (new title / new convo).
    if (wasSending && !sending) void refreshLogs();
    wasSending = sending;
  };

  async function refreshLogs(): Promise<void> {
    try {
      const convos = await listConversations();
      renderLogs(convos);
    } catch {
      logsEl.innerHTML = `<p class="empty-state">Couldn't load past chats.</p>`;
    }
  }

  function renderLogs(convos: ConversationSummary[]): void {
    const activeId = getState().conversationId;
    logsEl.innerHTML = convos.length
      ? convos
          .map(
            (c) =>
              `<button class="log-item${c.id === activeId ? " active" : ""}" data-id="${c.id}">${escapeHtml(
                c.title ?? "Untitled",
              )}</button>`,
          )
          .join("")
      : `<p class="empty-state">No past chats yet.</p>`;
    logsEl.querySelectorAll<HTMLElement>(".log-item").forEach((b) => {
      b.addEventListener("click", () => void loadConversation(b.dataset.id!));
    });
  }

  const unsubscribe = subscribe(render);
  render();
  void refreshLogs();

  container.querySelector("#assistant-new-page")!.addEventListener("click", () => {
    newConversation();
    input.focus();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    void sendMessage(q);
  });
  input.focus();

  return () => unsubscribe();
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
