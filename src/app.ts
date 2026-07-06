import { getSession } from "./auth.js";
import { mountMail } from "./mailView.js";
import { mountOneDrive } from "./onedriveView.js";
import { mountFab } from "./fab.js";
import { openSettings } from "./settingsModal.js";

// Workspace shell: a sidebar switching between the Mail and OneDrive sections,
// with the assistant FAB present across both. Sections are mounted in-place
// (no reload); the active section's dispose() runs before switching.

type Section = "mail" | "onedrive";

const NAV: { key: Section; label: string; icon: string }[] = [
  { key: "mail", label: "Mail", icon: "✉️" },
  { key: "onedrive", label: "OneDrive", icon: "☁️" },
];

const SHELL = `
  <div class="app-shell">
    <aside class="app-nav">
      <div class="app-brand">
        <span class="app-brand-name">DevPod</span>
        <button class="icon-btn" id="app-settings-btn" aria-label="Settings" title="Settings">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.21.08-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
        </button>
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

  navList.innerHTML = NAV.map(
    (n) =>
      `<button class="app-nav-item" data-section="${n.key}"><span class="app-nav-icon">${n.icon}</span>${n.label}</button>`,
  ).join("");

  let dispose: (() => void) | null = null;
  let current: Section | null = null;

  function sectionFromHash(): Section {
    return location.hash === "#onedrive" ? "onedrive" : "mail";
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

    dispose = section === "mail" ? mountMail(content) : mountOneDrive(content);
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

  mountFab();
  show(sectionFromHash());
}

init();
