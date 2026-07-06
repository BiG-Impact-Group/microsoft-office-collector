import { openAssistant, closeAssistant, isAssistantOpen } from "./askModal.js";

// A single floating action button (bottom-right) that toggles the docked RAG
// assistant. Present across all workspace sections. Idempotent.

const CHAT_ICON = `
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
  </svg>`;
const CLOSE_ICON = `
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>`;

export function mountFab(): void {
  if (document.getElementById("assistant-fab")) return;

  const btn = document.createElement("button");
  btn.id = "assistant-fab";
  btn.className = "fab";
  btn.type = "button";
  btn.setAttribute("aria-label", "Ask the assistant");
  btn.title = "Ask the assistant";
  btn.innerHTML = CHAT_ICON;

  const setOpenIcon = (open: boolean) => {
    btn.innerHTML = open ? CLOSE_ICON : CHAT_ICON;
    btn.classList.toggle("open", open);
    btn.setAttribute("aria-label", open ? "Close the assistant" : "Ask the assistant");
    btn.title = open ? "Close the assistant" : "Ask the assistant";
  };

  btn.addEventListener("click", () => {
    if (isAssistantOpen()) {
      closeAssistant(); // triggers onClose → resets the icon
    } else {
      openAssistant(() => setOpenIcon(false));
      setOpenIcon(true);
    }
  });

  document.body.appendChild(btn);
}
