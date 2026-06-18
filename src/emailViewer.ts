import type { Email } from "./emails.js";

/**
 * Renders the selected email into the right-hand pane.
 *
 * The HTML body is placed inside a sandboxed <iframe> via `srcdoc`.
 * The sandbox attribute:
 *   - blocks all scripts (no allow-scripts)
 *   - blocks same-origin access (no allow-same-origin)
 *   - allows links to open in new tabs (allow-popups + allow-popups-to-escape-sandbox)
 */
export function renderEmailViewer(container: HTMLElement, email: Email): void {
  container.innerHTML = `
    <div class="email-viewer-header">
      <h2>${escapeHtml(email.subject)}</h2>
      <div class="email-viewer-meta">
        From: ${escapeHtml(email.from_address)} &nbsp;·&nbsp;
        ${formatDate(email.received_at)}
      </div>
    </div>
    <div class="email-viewer-body">
      <iframe
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        title="Email body"
        srcdoc=""
      ></iframe>
    </div>
  `;

  // Set srcdoc via JS property (not attribute) to avoid HTML attribute
  // encoding issues with complex HTML bodies.
  const iframe = container.querySelector("iframe")!;
  iframe.srcdoc = email.body_html || "<p style='padding:1rem;color:#666'>No content.</p>";
}

export function clearEmailViewer(container: HTMLElement): void {
  container.innerHTML = `
    <div class="email-viewer-placeholder">
      Select a message to read it
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
