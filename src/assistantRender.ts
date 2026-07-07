import type { ChatMessage } from "./assistant.js";
import type { AskSource } from "./emails.js";
import { linkifyEmails, wireAddressLinks } from "./linkify.js";

// Shared rendering of a chat thread (user + assistant bubbles). Assistant
// answers get linkified addresses and clickable sources — reusing the
// `devpod:open-source` event (handled in app.ts) and `wireAddressLinks`.

export function renderThread(el: HTMLElement, messages: ChatMessage[], emptyHint: string): void {
  if (messages.length === 0) {
    el.innerHTML = `<p class="ask-status">${escapeHtml(emptyHint)}</p>`;
    return;
  }
  el.innerHTML = messages.map(bubble).join("");
}

function bubble(m: ChatMessage): string {
  if (m.role === "user") {
    return `<div class="chat-msg user"><div class="chat-bubble">${escapeHtml(m.content)}</div></div>`;
  }
  if (m.pending) {
    return `<div class="chat-msg assistant"><div class="chat-bubble"><span class="ask-status">Thinking…</span></div></div>`;
  }
  return `<div class="chat-msg assistant"><div class="chat-bubble">${
    linkifyEmails(escapeHtml(m.content))
  }${renderSources(m.sources)}</div></div>`;
}

function renderSources(sources?: AskSource[]): string {
  if (!sources || sources.length === 0) return "";
  const items = sources
    .map(
      (s) =>
        `<li><button type="button" class="src-open" data-kind="${s.kind}" data-id="${escapeHtml(
          s.source_id,
        )}" title="Open"><span class="src-num">[${s.n}]</span> <span class="cat-pill cat-${
          s.kind === "document" ? "sent" : "primary"
        }">${s.kind}</span> <span class="src-title">${escapeHtml(s.title)}</span></button></li>`,
    )
    .join("");
  return `<div class="ask-sources"><div class="ask-sources-label">Sources</div><ul>${items}</ul></div>`;
}

/** Attach once to the persistent thread container: delegates address-link and
 *  source-open clicks (survives re-renders of the container's children). */
export function wireThread(root: HTMLElement): void {
  wireAddressLinks(root);
  root.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".src-open");
    if (!el) return;
    e.preventDefault();
    window.dispatchEvent(
      new CustomEvent("devpod:open-source", {
        detail: { kind: el.dataset.kind, source_id: el.dataset.id },
      }),
    );
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
