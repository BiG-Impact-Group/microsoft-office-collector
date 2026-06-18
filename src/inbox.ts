import { getSession, signOut } from "./auth.js";
import { getMicrosoftAccount, fetchEmails } from "./emails.js";
import type { Email } from "./emails.js";
import { renderEmailList } from "./emailList.js";
import { renderEmailViewer, clearEmailViewer } from "./emailViewer.js";

const POLL_INTERVAL_MS = 30_000;

const listEl = document.getElementById("email-list")!;
const viewerEl = document.getElementById("email-viewer")!;

let selectedId: string | null = null;
let accountId: string | null = null;

async function init(): Promise<void> {
  // Guard: redirect to landing if not authenticated
  const session = await getSession();
  if (!session) {
    window.location.href = "/";
    return;
  }

  document.getElementById("signout-btn")!.addEventListener("click", async () => {
    await signOut();
    window.location.href = "/";
  });

  // Find the connected Microsoft account
  try {
    const account = await getMicrosoftAccount();
    if (!account) {
      listEl.innerHTML = `
        <p class="empty-state">
          No Microsoft account connected.<br>
          <a href="/">Go back to connect one.</a>
        </p>`;
      return;
    }
    accountId = account.id;
  } catch {
    listEl.innerHTML = `<p class="empty-state">Failed to load account. Try refreshing.</p>`;
    return;
  }

  // Initial load
  await loadEmails();

  // Poll every 30s to pick up new mail from the cron function
  setInterval(loadEmails, POLL_INTERVAL_MS);
}

async function loadEmails(): Promise<void> {
  if (!accountId) return;

  try {
    const emails = await fetchEmails(accountId);
    renderEmailList(listEl, emails, selectedId, onEmailSelect);
  } catch {
    listEl.innerHTML = `<p class="empty-state">Failed to load emails. Try refreshing.</p>`;
  }
}

function onEmailSelect(email: Email): void {
  selectedId = email.id;

  // Re-render list to update selection highlight
  fetchEmails(accountId!).then((emails) => {
    renderEmailList(listEl, emails, selectedId, onEmailSelect);
  }).catch(() => {
    // Non-critical — viewer still works even if list refresh fails
  });

  renderEmailViewer(viewerEl, email);
}

clearEmailViewer(viewerEl);
init();
