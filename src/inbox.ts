import { getSession, signOut } from "./auth.js";
import { getMicrosoftAccount, fetchEmails } from "./emails.js";
import type { Email, EmailCategory } from "./emails.js";
import { renderEmailList } from "./emailList.js";
import { renderEmailViewer, clearEmailViewer } from "./emailViewer.js";

const POLL_INTERVAL_MS = 30_000;

const listEl = document.getElementById("email-list")!;
const viewerEl = document.getElementById("email-viewer")!;
const tabsEl = document.getElementById("category-tabs")!;

type TabKey = EmailCategory | "all";
const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "urgent", label: "Urgent" },
  { key: "primary", label: "Primary" },
  { key: "promotions", label: "Promotions" },
  { key: "junk", label: "Junk" },
];

let selectedId: string | null = null;
let accountId: string | null = null;
let emailCache: Email[] = [];
let activeCategory: TabKey = "all";

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
    emailCache = await fetchEmails(accountId);
    renderTabs();
    renderList();
  } catch {
    listEl.innerHTML = `<p class="empty-state">Failed to load emails. Try refreshing.</p>`;
  }
}

function filteredEmails(): Email[] {
  if (activeCategory === "all") return emailCache;
  return emailCache.filter((e) => e.category === activeCategory);
}

function renderList(): void {
  renderEmailList(listEl, filteredEmails(), selectedId, onEmailSelect);
}

function renderTabs(): void {
  const countFor = (key: TabKey) =>
    key === "all" ? emailCache.length : emailCache.filter((e) => e.category === key).length;

  tabsEl.innerHTML = TABS.map((t) => {
    const isActive = t.key === activeCategory;
    return `
      <button
        class="cat-tab${isActive ? " active" : ""}"
        data-cat="${t.key}"
        role="tab"
        aria-selected="${isActive}"
      >${t.label} <span class="cat-count">${countFor(t.key)}</span></button>`;
  }).join("");

  tabsEl.querySelectorAll<HTMLElement>(".cat-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.cat as TabKey;
      renderTabs();
      renderList();
    });
  });
}

function onEmailSelect(email: Email): void {
  selectedId = email.id;

  // Re-render the (filtered) cached list to move the highlight — no refetch.
  renderList();
  renderEmailViewer(viewerEl, email);
}

clearEmailViewer(viewerEl);
init();
