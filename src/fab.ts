import { openAssistant, closeAssistant, isAssistantOpen } from "./askModal.js";

// A single floating action button (bottom-right) that toggles the docked RAG
// assistant. Present across sections except the Assistant page (where the large
// view replaces it). Idempotent.

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

let fab: HTMLButtonElement | null = null;

function setOpenIcon(open: boolean): void {
  if (!fab) return;
  fab.innerHTML = open ? CLOSE_ICON : CHAT_ICON;
  fab.classList.toggle("open", open);
  fab.setAttribute("aria-label", open ? "Close the assistant" : "Ask the assistant");
  fab.title = open ? "Close the assistant" : "Ask the assistant";
}

export function mountFab(): void {
  if (document.getElementById("assistant-fab")) return;

  fab = document.createElement("button");
  fab.id = "assistant-fab";
  fab.className = "fab";
  fab.type = "button";
  fab.innerHTML = CHAT_ICON;
  fab.setAttribute("aria-label", "Ask the assistant");
  fab.title = "Ask the assistant";

  fab.addEventListener("click", () => {
    if (isAssistantOpen()) {
      closeAssistant(true); // clicking the FAB (now an ✕) ends the chat
    } else {
      openAssistant(() => setOpenIcon(false));
      setOpenIcon(true);
    }
  });

  document.body.appendChild(fab);
}

/** Hide/show the FAB (hidden on the Assistant page). Hiding also closes the
 *  docked panel WITHOUT ending the chat, so the live thread carries to the page. */
export function setFabVisible(visible: boolean): void {
  if (!fab) return;
  if (!visible && isAssistantOpen()) closeAssistant(false);
  fab.classList.toggle("hidden", !visible);
}
