import { getMicrosoftAccount, fetchEmails, searchEmails } from "./emails.js";
import type { Email, EmailCategory } from "./emails.js";
import { renderEmailList } from "./emailList.js";
import { renderEmailViewer, clearEmailViewer } from "./emailViewer.js";
import { openSettings } from "./settingsModal.js";
import { openCompose } from "./composeModal.js";

const POLL_INTERVAL_MS = 30_000;

type TabKey = EmailCategory | "all";
const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "primary", label: "Primary" },
  { key: "promotions", label: "Promotions" },
  { key: "junk", label: "Junk" },
  { key: "sent", label: "Sent" },
];

const MAIL_MARKUP = `
  <div class="inbox-layout">
    <aside class="email-list-pane">
      <div class="email-list-header">
        <h1>Inbox</h1>
        <div class="header-actions">
          <button class="btn btn-primary btn-sm" id="compose-btn">Compose</button>
          <button class="icon-btn" id="settings-btn" aria-label="Settings" title="Settings">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.21.08-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="search-row">
        <input id="search-input" type="search" placeholder="Search your inbox…" aria-label="Search emails" />
      </div>
      <nav class="category-tabs" id="category-tabs" aria-label="Filter by category"></nav>
      <div class="email-list-scroll" id="email-list">
        <p class="empty-state">Loading…</p>
      </div>
    </aside>
    <main class="email-viewer-pane" id="email-viewer">
      <div class="email-viewer-placeholder">Select a message to read it</div>
    </main>
  </div>
`;

export interface MailContext {
  signInEmail: string;
}

/**
 * Mounts the two-pane mail reader into `container`. Returns a dispose function
 * that stops the background poll (called when navigating away from the section).
 */
export function mountMail(container: HTMLElement, ctx: MailContext): () => void {
  container.innerHTML = MAIL_MARKUP;

  const listEl = container.querySelector<HTMLElement>("#email-list")!;
  const viewerEl = container.querySelector<HTMLElement>("#email-viewer")!;
  const tabsEl = container.querySelector<HTMLElement>("#category-tabs")!;
  const searchInput = container.querySelector<HTMLInputElement>("#search-input")!;

  let selectedId: string | null = null;
  let accountId: string | null = null;
  let emailCache: Email[] = [];
  let activeCategory: TabKey = "all";
  // When set, the list shows semantic-search results instead of the category list.
  let searchResults: Email[] | null = null;
  let pollTimer: number | undefined;

  container.querySelector("#settings-btn")!.addEventListener("click", () => {
    openSettings({ signInEmail: ctx.signInEmail });
  });
  container.querySelector("#compose-btn")!.addEventListener("click", () => {
    openCompose();
  });

  searchInput.addEventListener("keydown", async (e) => {
    if ((e as KeyboardEvent).key !== "Enter") return;
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
  searchInput.addEventListener("input", () => {
    if (searchInput.value.trim() === "" && searchResults) {
      searchResults = null;
      renderList();
    }
  });

  function filteredEmails(): Email[] {
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
        searchResults = null;
        searchInput.value = "";
        activeCategory = btn.dataset.cat as TabKey;
        renderTabs();
        renderList();
      });
    });
  }

  function onEmailSelect(email: Email): void {
    selectedId = email.id;
    renderList();
    renderEmailViewer(viewerEl, email);
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

  clearEmailViewer(viewerEl);

  (async () => {
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
    await loadEmails();
    pollTimer = window.setInterval(loadEmails, POLL_INTERVAL_MS);
  })();

  return () => {
    if (pollTimer !== undefined) window.clearInterval(pollTimer);
  };
}
