import type { Email } from "./emails.js";
import { openCompose } from "./composeModal.js";

// The previously-rendered body is loaded as a Blob URL; track it so we can
// revoke it when switching emails (avoids leaking object URLs).
let currentBlobUrl: string | null = null;

/**
 * Renders the selected email into the right-hand pane.
 *
 * The HTML body is rendered inside a sandboxed <iframe>:
 *   - NO `allow-scripts` → the email can never execute JavaScript (XSS-safe).
 *   - `allow-same-origin` → the document gets a real origin so its own styles,
 *     fonts and images render normally (without it the opaque origin makes
 *     most marketing HTML render blank). Safe here precisely because scripts
 *     are disabled, so nothing can use that origin to reach the parent.
 *   - `allow-popups*` → links can open in a new tab.
 *
 * The body is delivered via a Blob URL rather than `srcdoc`, which renders
 * large/complex documents more reliably.
 */
export function renderEmailViewer(container: HTMLElement, email: Email): void {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }

  container.innerHTML = `
    <div class="email-viewer-header">
      <div class="email-viewer-head-text">
        <h2>${escapeHtml(email.subject)}</h2>
        <div class="email-viewer-meta">
          From: ${escapeHtml(email.from_address)} &nbsp;·&nbsp;
          ${formatDate(email.received_at)}
        </div>
        <div class="email-viewer-recipients" id="viewer-recipients"></div>
      </div>
      <button class="btn btn-secondary btn-sm" id="reply-btn">Reply</button>
    </div>
    <div class="email-viewer-body">
      <iframe
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        title="Email body"
      ></iframe>
    </div>
  `;

  const iframe = container.querySelector("iframe")!;
  const html =
    email.body_html && email.body_html.trim().length > 0
      ? email.body_html
      : "<p style='padding:1rem;color:#666;font-family:sans-serif'>No content.</p>";

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  currentBlobUrl = URL.createObjectURL(blob);
  iframe.src = currentBlobUrl;

  // To / Cc rows: collapsed to one address (+ "…") until expanded.
  const recipEl = container.querySelector("#viewer-recipients") as HTMLElement;
  const expanded = { to: false, cc: false };
  function renderRecipients(): void {
    recipEl.innerHTML =
      recipientRow("To", email.to_recipients, expanded.to, "to") +
      recipientRow("Cc", email.cc_recipients, expanded.cc, "cc");
    recipEl.querySelectorAll<HTMLElement>("[data-recip-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.recipToggle as "to" | "cc";
        expanded[key] = !expanded[key];
        renderRecipients();
      });
    });
  }
  renderRecipients();

  container.querySelector("#reply-btn")!.addEventListener("click", () => {
    openCompose({
      to: email.from_address,
      subject: replySubject(email.subject),
    });
  });
}

function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

function recipientRow(
  label: string,
  addresses: string[],
  isExpanded: boolean,
  key: "to" | "cc"
): string {
  if (!addresses || addresses.length === 0) return "";

  const prefix = `<span class="recip-label">${label}:</span> `;
  if (addresses.length === 1) {
    return `<div class="recip-row">${prefix}${escapeHtml(addresses[0])}</div>`;
  }
  if (!isExpanded) {
    return `<div class="recip-row">${prefix}${escapeHtml(addresses[0])} <button class="recip-toggle" data-recip-toggle="${key}">…(+${addresses.length - 1})</button></div>`;
  }
  return `<div class="recip-row">${prefix}${addresses.map(escapeHtml).join(", ")} <button class="recip-toggle" data-recip-toggle="${key}">Hide</button></div>`;
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
