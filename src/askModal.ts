import { askQuestion, type AskResult } from "./emails.js";
import { linkifyEmails, wireAddressLinks } from "./linkify.js";

// The RAG assistant, rendered as a docked panel in the bottom-right corner.
// It is non-modal: no overlay, so the rest of the workspace stays interactive
// while it's open. Toggled by the FAB (see fab.ts).

let panel: HTMLElement | null = null;
let onCloseCb: (() => void) | null = null;

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") closeAssistant();
}

export function isAssistantOpen(): boolean {
  return panel !== null;
}

/** Opens the docked assistant panel. `onClose` fires whenever it closes
 *  (via the panel's close button, Escape, or a caller calling closeAssistant). */
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
      <button class="modal-close" id="assistant-close" aria-label="Close">&times;</button>
    </div>
    <div class="assistant-body">
      <div class="ask-result" id="ask-result">
        <p class="ask-status">Ask about your email, documents, and OneDrive files.</p>
      </div>
    </div>
    <form id="ask-form" class="assistant-form">
      <textarea id="ask-q" rows="2" placeholder="What would you like to know?"></textarea>
      <button class="btn btn-primary btn-sm" type="submit" id="ask-send">Ask</button>
    </form>
  `;
  document.body.appendChild(panel);
  document.addEventListener("keydown", onKey);

  panel.querySelector("#assistant-close")!.addEventListener("click", () => closeAssistant());

  const form = panel.querySelector("#ask-form") as HTMLFormElement;
  const resultEl = panel.querySelector("#ask-result")!;
  const input = panel.querySelector("#ask-q") as HTMLTextAreaElement;
  input.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const btn = panel!.querySelector("#ask-send") as HTMLButtonElement;
    btn.disabled = true;
    resultEl.innerHTML = `<p class="ask-status">Thinking…</p>`;
    try {
      const res = await askQuestion(q);
      resultEl.innerHTML = renderResult(res);
      wireResult(resultEl as HTMLElement);
    } catch (err) {
      resultEl.innerHTML = `<p class="ask-status error">${escapeHtml(
        err instanceof Error ? err.message : "Something went wrong.",
      )}</p>`;
    } finally {
      btn.disabled = false;
    }
  });
}

// Make answer addresses and source rows interactive after render.
function wireResult(resultEl: HTMLElement): void {
  wireAddressLinks(resultEl);
  resultEl.addEventListener("click", (e) => {
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

export function closeAssistant(): void {
  if (!panel) return;
  panel.remove();
  panel = null;
  document.removeEventListener("keydown", onKey);
  const cb = onCloseCb;
  onCloseCb = null;
  if (cb) cb();
}

/** Back-compat alias: some call sites open the assistant via openAsk(). */
export function openAsk(): void {
  openAssistant();
}

function renderResult(res: AskResult): string {
  const parts: string[] = [];
  if (res.note) {
    parts.push(`<p class="ask-status">${escapeHtml(res.note)}</p>`);
  }
  if (res.answer) {
    parts.push(`<div class="ask-answer">${linkifyEmails(escapeHtml(res.answer))}</div>`);
  }
  if (res.sources.length > 0) {
    const items = res.sources
      .map(
        (s) =>
          `<li><button type="button" class="src-open" data-kind="${s.kind}" data-id="${escapeHtml(
            s.source_id,
          )}" title="Open"><span class="src-num">[${s.n}]</span> <span class="cat-pill cat-${
            s.kind === "document" ? "sent" : "primary"
          }">${s.kind}</span> <span class="src-title">${escapeHtml(s.title)}</span></button></li>`,
      )
      .join("");
    parts.push(`<div class="ask-sources"><div class="ask-sources-label">Sources</div><ul>${items}</ul></div>`);
  }
  if (parts.length === 0) parts.push(`<p class="ask-status">No answer.</p>`);
  return parts.join("");
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
