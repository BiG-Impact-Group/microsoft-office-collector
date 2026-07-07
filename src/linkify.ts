import { openCompose } from "./composeModal.js";

// Turns email addresses in already-HTML-escaped text into clickable links that
// open a pre-addressed compose window. Used by the mail viewer and the
// assistant answer. Operates on escaped text, so the address chars are safe.

const EMAIL_RE = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

export function linkifyEmails(escapedText: string): string {
  return escapedText.replace(
    EMAIL_RE,
    (addr) => `<a href="#" class="addr-link" data-addr="${addr}">${addr}</a>`,
  );
}

/** Delegates clicks on .addr-link within `root` to open compose to that address. */
export function wireAddressLinks(root: HTMLElement): void {
  root.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement).closest<HTMLElement>(".addr-link");
    if (!link) return;
    e.preventDefault();
    const addr = link.dataset.addr;
    if (addr) openCompose({ to: addr });
  });
}
