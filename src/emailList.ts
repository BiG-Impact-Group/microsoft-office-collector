import type { Email } from "./emails.js";

type OnSelectCallback = (email: Email) => void;

export function renderEmailList(
  container: HTMLElement,
  emails: Email[],
  selectedId: string | null,
  onSelect: OnSelectCallback
): void {
  if (emails.length === 0) {
    container.innerHTML = `<p class="empty-state">No messages yet.<br>Check back after the next sync.</p>`;
    return;
  }

  container.innerHTML = emails
    .map((email) => {
      const isSelected = email.id === selectedId;
      const isUnread = !email.is_read;
      const date = formatDate(email.received_at);
      // In Sent, show who it went to; elsewhere show the sender.
      const who =
        email.category === "sent"
          ? email.to_recipients[0]
            ? `To: ${email.to_recipients[0]}`
            : "(no recipient)"
          : email.from_address;

      return `
        <div
          class="email-item${isSelected ? " selected" : ""}${isUnread ? " unread" : ""}"
          data-id="${email.id}"
          role="button"
          tabindex="0"
          aria-label="${escapeAttr(email.subject)} from ${escapeAttr(email.from_address)}"
        >
          <div class="email-item-from">${email.category ? `<span class="cat-pill cat-${email.category}">${catLabel(email.category)}</span> ` : ""}${escapeHtml(who)} · ${date}</div>
          <div class="email-item-subject">${escapeHtml(email.subject)}</div>
          <div class="email-item-preview">${escapeHtml(email.preview)}</div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll<HTMLElement>(".email-item").forEach((el) => {
    const id = el.dataset.id!;
    const email = emails.find((e) => e.id === id)!;

    el.addEventListener("click", () => onSelect(email));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(email);
      }
    });
  });
}

function catLabel(category: string): string {
  switch (category) {
    case "urgent": return "Urgent";
    case "primary": return "Primary";
    case "promotions": return "Promo";
    case "junk": return "Junk";
    case "sent": return "Sent";
    default: return category;
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
