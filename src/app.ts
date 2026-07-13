import { getSession } from "./auth.js";
import { mountMail } from "./mailView.js";
import { mountOneDrive } from "./onedriveView.js";
import { mountAssistant } from "./assistantView.js";
import { mountFab, setFabVisible } from "./fab.js";
import { openSettings } from "./settingsModal.js";
import { requestOpenEmail, requestRevealOneDrive } from "./navigation.js";
import { locateOneDriveItem, getDocumentTarget } from "./onedrive.js";

// Workspace shell: a sidebar switching between the Mail, OneDrive and Assistant
// sections. The assistant FAB is present everywhere except the Assistant page
// (where the large view replaces it). Sections mount in-place (no reload); the
// active section's dispose() runs before switching.

type Section = "mail" | "onedrive" | "assistant";

const NAV: { key: Section; label: string; icon: string }[] = [
  { key: "mail", label: "Mail", icon: "✉️" },
  { key: "onedrive", label: "OneDrive", icon: "☁️" },
  { key: "assistant", label: "Assistant", icon: "💬" },
];

const NAV_COLLAPSE_KEY = "devpod:nav-collapsed";

const SHELL = `
  <div class="app-shell">
    <aside class="app-nav" id="app-nav">
      <div class="app-brand">
        <span class="app-brand-name">DevPod</span>
        <div class="app-brand-actions">
          <button class="icon-btn" id="app-nav-toggle" aria-label="Collapse sidebar" title="Collapse sidebar">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" id="app-nav-toggle-icon">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <button class="icon-btn" id="app-settings-btn" aria-label="Settings" title="Settings">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.21.08-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
            </svg>
          </button>
        </div>
      </div>
      <nav id="app-nav-list" aria-label="Sections"></nav>
    </aside>
    <section class="app-main" id="app-content"></section>
  </div>
`;

async function init(): Promise<void> {
  const session = await getSession();
  if (!session) {
    window.location.href = "/";
    return;
  }
  const signInEmail = session.user.email ?? "";

  document.body.innerHTML = SHELL;
  const navList = document.getElementById("app-nav-list")!;
  const content = document.getElementById("app-content")!;

  document.getElementById("app-settings-btn")!.addEventListener("click", () => {
    openSettings({ signInEmail });
  });

  const navEl = document.getElementById("app-nav")!;
  const navToggle = document.getElementById("app-nav-toggle")!;
  function setNavCollapsed(collapsed: boolean): void {
    navEl.classList.toggle("collapsed", collapsed);
    navToggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    navToggle.setAttribute("title", collapsed ? "Expand sidebar" : "Collapse sidebar");
    localStorage.setItem(NAV_COLLAPSE_KEY, collapsed ? "1" : "0");
  }
  setNavCollapsed(localStorage.getItem(NAV_COLLAPSE_KEY) === "1");
  navToggle.addEventListener("click", () => setNavCollapsed(!navEl.classList.contains("collapsed")));

  navList.innerHTML = NAV.map(
    (n) =>
      `<button class="app-nav-item" data-section="${n.key}" title="${n.label}"><span class="app-nav-icon">${n.icon}</span><span class="app-nav-label">${n.label}</span></button>`,
  ).join("");

  let dispose: (() => void) | null = null;
  let current: Section | null = null;

  function sectionFromHash(): Section {
    if (location.hash === "#onedrive") return "onedrive";
    if (location.hash === "#assistant") return "assistant";
    return "mail";
  }

  function show(section: Section): void {
    if (section === current) return;
    if (dispose) {
      dispose();
      dispose = null;
    }
    current = section;

    navList.querySelectorAll<HTMLElement>(".app-nav-item").forEach((b) => {
      b.classList.toggle("active", b.dataset.section === section);
    });

    // The FAB is hidden on the Assistant page (its large view replaces it);
    // hiding also closes the docked panel without ending the live chat.
    setFabVisible(section !== "assistant");

    dispose =
      section === "mail"
        ? mountMail(content)
        : section === "onedrive"
          ? mountOneDrive(content)
          : mountAssistant(content);
  }

  navList.querySelectorAll<HTMLElement>(".app-nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.dataset.section as Section;
      if (location.hash !== `#${section}`) {
        location.hash = section;
      } else {
        show(section);
      }
    });
  });

  window.addEventListener("hashchange", () => show(sectionFromHash()));

  function goToSection(section: Section): void {
    if (current === section) return;
    if (location.hash !== `#${section}`) location.hash = section;
    else show(section);
  }
  function openEmail(id: string): void {
    goToSection("mail");
    requestOpenEmail(id);
  }

  // A source clicked in the assistant: open the email, or reveal the document
  // in the OneDrive browser (open the parent email for attachments).
  window.addEventListener("devpod:open-source", (async (e: Event) => {
    const { kind, source_id } = (e as CustomEvent).detail as { kind: string; source_id: string };
    if (!source_id) return;
    if (kind === "email") {
      openEmail(source_id);
      return;
    }
    const target = await getDocumentTarget(source_id);
    if (target?.source === "onedrive" && target.external_id) {
      goToSection("onedrive");
      try {
        const loc = await locateOneDriveItem(target.external_id);
        requestRevealOneDrive({
          folderId: loc.isRoot ? undefined : loc.parentId ?? undefined,
          folderName: loc.parentName,
          highlightId: target.external_id,
        });
      } catch {
        // Not in the live drive (e.g. a synced/DB-only doc) → just show the root.
        requestRevealOneDrive({});
      }
    } else if (target?.email_id) {
      openEmail(target.email_id);
    }
  }) as EventListener);

  mountFab();
  show(sectionFromHash());
}

init();
