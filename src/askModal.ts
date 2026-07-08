import {
  sendMessage,
  subscribe,
  getState,
  newConversation,
  endConversation,
  listConversations,
  loadConversation,
} from "./assistant.js";
import { renderThread, wireThread } from "./assistantRender.js";

// The RAG assistant as a docked, non-modal panel in the bottom-right corner
// (toggled by the FAB). Renders the shared conversation thread; multi-turn
// until the user closes it with the X (which ends the chat). Navigating away
// (e.g. to the Assistant page) closes the panel WITHOUT ending the chat, so the
// live thread carries over to the large view.

let panel: HTMLElement | null = null;
let onCloseCb: (() => void) | null = null;
let unsubscribe: (() => void) | null = null;

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") closeAssistant(true);
}

export function isAssistantOpen(): boolean {
  return panel !== null;
}

export function openAssistant(onClose?: () => void): void {
  if (panel) return;
  onCloseCb = onClose ?? null;

  panel = document.createElement("div");
  panel.className = "assistant-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Assistant");
  panel.innerHTML = `
    <div class="assistant-header">
      <span class="assistant-title">Assistant</span>
      <div class="assistant-header-actions">
        <button class="icon-btn" id="assistant-new" aria-label="New chat" title="New chat">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button class="icon-btn" id="assistant-history" aria-label="History" title="Past chats">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
        </button>
        <button class="modal-close" id="assistant-close" aria-label="Close">&times;</button>
      </div>
    </div>
    <div class="assistant-history-list" id="assistant-history-list" hidden></div>
    <div class="assistant-body">
      <div class="ask-result" id="ask-result"></div>
    </div>
    <form id="ask-form" class="assistant-form">
      <textarea id="ask-q" rows="2" placeholder="What would you like to know?"></textarea>
      <button class="btn btn-primary btn-sm" type="submit" id="ask-send">Ask</button>
    </form>
  `;
  document.body.appendChild(panel);
  document.addEventListener("keydown", onKey);

  const resultEl = panel.querySelector<HTMLElement>("#ask-result")!;
  const historyList = panel.querySelector<HTMLElement>("#assistant-history-list")!;
  const form = panel.querySelector("#ask-form") as HTMLFormElement;
  const input = panel.querySelector("#ask-q") as HTMLTextAreaElement;
  const sendBtn = panel.querySelector("#ask-send") as HTMLButtonElement;
  wireThread(resultEl);

  const render = () => {
    const { messages, sending } = getState();
    renderThread(resultEl, messages, "Ask about your email, documents, and OneDrive files.");
    sendBtn.disabled = sending;
    resultEl.scrollTop = resultEl.scrollHeight;
  };
  unsubscribe = subscribe(render);
  render();

  panel.querySelector("#assistant-close")!.addEventListener("click", () => closeAssistant(true));
  panel.querySelector("#assistant-new")!.addEventListener("click", () => {
    historyList.hidden = true;
    newConversation();
    input.focus();
  });
  panel.querySelector("#assistant-history")!.addEventListener("click", async () => {
    if (!historyList.hidden) {
      historyList.hidden = true;
      return;
    }
    historyList.innerHTML = `<p class="ask-status">Loading…</p>`;
    historyList.hidden = false;
    try {
      const convos = await listConversations();
      historyList.innerHTML = convos.length
        ? convos
            .map(
              (c) =>
                `<button class="history-item" data-id="${c.id}">${escapeHtml(c.title ?? "Untitled")}</button>`,
            )
            .join("")
        : `<p class="ask-status">No past chats yet.</p>`;
      historyList.querySelectorAll<HTMLElement>(".history-item").forEach((b) => {
        b.addEventListener("click", async () => {
          await loadConversation(b.dataset.id!);
          historyList.hidden = true;
        });
      });
    } catch {
      historyList.innerHTML = `<p class="ask-status error">Couldn't load history.</p>`;
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    void sendMessage(q);
  });

  input.focus();
}

/** Closes the docked panel. `endChat=true` (the X / Escape) also ends the
 *  current conversation; a programmatic close (navigation) preserves it. */
export function closeAssistant(endChat = false): void {
  if (!panel) return;
  panel.remove();
  panel = null;
  document.removeEventListener("keydown", onKey);
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (endChat) endConversation();
  const cb = onCloseCb;
  onCloseCb = null;
  if (cb) cb();
}

/** Back-compat alias. */
export function openAsk(): void {
  openAssistant();
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
