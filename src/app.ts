import { getSession } from "./auth.js";
import { mountMail } from "./mailView.js";
import { mountOneDrive } from "./onedriveView.js";
import { mountFab } from "./fab.js";

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
      <div class="app-brand">DevPod</div>
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

    dispose = section === "mail" ? mountMail(content, { signInEmail }) : mountOneDrive(content);
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
