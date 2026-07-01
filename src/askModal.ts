import { askQuestion, type AskResult } from "./emails.js";

/** Opens the "Ask your inbox" dialog: a question box that runs RAG over the
 *  user's email + documents and shows the answer with its sources. */
export function openAsk(): void {
  if (document.getElementById("ask-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "ask-overlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card ask-card" role="dialog" aria-modal="true" aria-label="Ask your inbox">
      <div class="modal-header">
        <h2>Ask your inbox</h2>
        <button class="modal-close" id="ask-close" aria-label="Close">&times;</button>
      </div>
      <form id="ask-form" class="ask-form">
        <textarea id="ask-q" rows="3" placeholder="Ask a question about your email and attachments…"></textarea>
        <div class="ask-actions">
          <button class="btn btn-primary btn-sm" type="submit" id="ask-send">Ask</button>
        </div>
      </form>
      <div class="ask-result" id="ask-result"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.getElementById("ask-close")!.addEventListener("click", close);

  const form = document.getElementById("ask-form") as HTMLFormElement;
  const resultEl = document.getElementById("ask-result")!;
  const input = document.getElementById("ask-q") as HTMLTextAreaElement;
  input.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const btn = document.getElementById("ask-send") as HTMLButtonElement;
    btn.disabled = true;
    resultEl.innerHTML = `<p class="ask-status">Thinking…</p>`;
    try {
      const res = await askQuestion(q);
      resultEl.innerHTML = renderResult(res);
    } catch (err) {
      resultEl.innerHTML = `<p class="ask-status error">${escapeHtml(
        err instanceof Error ? err.message : "Something went wrong.",
      )}</p>`;
    } finally {
      btn.disabled = false;
    }
  });
}

function renderResult(res: AskResult): string {
  const parts: string[] = [];
  if (res.note) {
    parts.push(`<p class="ask-status">${escapeHtml(res.note)}</p>`);
  }
  if (res.answer) {
    parts.push(`<div class="ask-answer">${escapeHtml(res.answer)}</div>`);
  }
  if (res.sources.length > 0) {
    const items = res.sources
      .map(
        (s) =>
          `<li><span class="src-num">[${s.n}]</span> <span class="cat-pill cat-${
            s.kind === "document" ? "sent" : "primary"
          }">${s.kind}</span> ${escapeHtml(s.title)}</li>`,
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
