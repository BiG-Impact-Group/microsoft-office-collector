import { getMicrosoftAccount, fetchEmails, searchEmails } from "./emails.js";
import type { Email, EmailCategory } from "./emails.js";
import { renderEmailList } from "./emailList.js";
import { renderEmailViewer, clearEmailViewer } from "./emailViewer.js";
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

/**
 * Mounts the two-pane mail reader into `container`. Returns a dispose function
 * that stops the background poll (called when navigating away from the section).
 */
export function mountMail(container: HTMLElement): () => void {
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
