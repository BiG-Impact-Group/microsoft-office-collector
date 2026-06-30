import { getSession } from "./auth.js";
import { getMicrosoftAccount, fetchEmails, searchEmails } from "./emails.js";
import type { Email, EmailCategory } from "./emails.js";
import { renderEmailList } from "./emailList.js";
import { renderEmailViewer, clearEmailViewer } from "./emailViewer.js";
import { openSettings } from "./settingsModal.js";
import { openCompose } from "./composeModal.js";
import { openAsk } from "./askModal.js";

const POLL_INTERVAL_MS = 30_000;

const listEl = document.getElementById("email-list")!;
const viewerEl = document.getElementById("email-viewer")!;
const tabsEl = document.getElementById("category-tabs")!;

type TabKey = EmailCategory | "all";
const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "primary", label: "Primary" },
  { key: "promotions", label: "Promotions" },
  { key: "junk", label: "Junk" },
  { key: "sent", label: "Sent" },
];

let selectedId: string | null = null;
let accountId: string | null = null;
let emailCache: Email[] = [];
let activeCategory: TabKey = "all";
let signInEmail = "";
let microsoftEmail: string | null = null;
// When set, the list shows semantic-search results instead of the category list.
let searchResults: Email[] | null = null;

async function init(): Promise<void> {
  // Guard: redirect to landing if not authenticated
  const session = await getSession();
  if (!session) {
    window.location.href = "/";
    return;
  }

  signInEmail = session.user.email ?? "";
  document.getElementById("settings-btn")!.addEventListener("click", () => {
    openSettings({ signInEmail, microsoftEmail });
  });
  document.getElementById("compose-btn")!.addEventListener("click", () => {
    openCompose();
  });
  document.getElementById("ask-btn")!.addEventListener("click", () => {
    openAsk();
  });

  const searchInput = document.getElementById("search-input") as HTMLInputElement;
  searchInput.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const q = searchInput.value.trim();
    if (!q) {
      searchResults = null;
      renderList();
      return;
    }
    listEl.innerHTML = `<p class="empty-state">Searching…</p>`;
    try {
      searchResults = await searchEmails(q);
      renderList();
    } catch {
      listEl.innerHTML = `<p class="empty-state">Search failed. Try again.</p>`;
    }
  });
  // Clearing the box (incl. the native ✕) returns to the normal list.
  searchInput.addEventListener("input", () => {
    if (searchInput.value.trim() === "" && searchResults) {
      searchResults = null;
      renderList();
    }
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
    microsoftEmail = account.provider_account_email;
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
  // "All" means all received mail — Sent has its own tab.
  if (activeCategory === "all") return emailCache.filter((e) => e.category !== "sent");
  return emailCache.filter((e) => e.category === activeCategory);
}

function renderList(): void {
  const list = searchResults ?? filteredEmails();
  renderEmailList(listEl, list, selectedId, onEmailSelect);
}

function renderTabs(): void {
  const countFor = (key: TabKey) =>
    key === "all"
      ? emailCache.filter((e) => e.category !== "sent").length
      : emailCache.filter((e) => e.category === key).length;

  tabsEl.innerHTML = TABS.map((t) => {
    const isActive = t.key === activeCategory;
    return `
      <button
        class="cat-tab${isActive ? " active" : ""}${t.key === "sent" ? " cat-tab-right" : ""}"
        data-cat="${t.key}"
        role="tab"
        aria-selected="${isActive}"
      >${t.label} <span class="cat-count">${countFor(t.key)}</span></button>`;
  }).join("");

  tabsEl.querySelectorAll<HTMLElement>(".cat-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      // Switching tabs exits search mode.
      searchResults = null;
      (document.getElementById("search-input") as HTMLInputElement).value = "";
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
