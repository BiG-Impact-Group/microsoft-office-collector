import { openAsk } from "./askModal.js";

// A single floating action button (bottom-right) that opens the RAG assistant.
// Present across all workspace sections. Idempotent — only ever one in the DOM.

export function mountFab(): void {
  if (document.getElementById("assistant-fab")) return;

  const btn = document.createElement("button");
  btn.id = "assistant-fab";
  btn.className = "fab";
  btn.type = "button";
  btn.setAttribute("aria-label", "Ask the assistant");
  btn.title = "Ask the assistant";
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
    </svg>`;
  btn.addEventListener("click", () => openAsk());
  document.body.appendChild(btn);
}
