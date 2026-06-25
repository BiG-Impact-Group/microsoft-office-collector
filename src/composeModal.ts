import { sendEmail } from "./emails.js";

/** Opens the compose-email dialog and sends via the send-mail edge function. */
export function openCompose(): void {
  if (document.getElementById("compose-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "compose-overlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card compose-card" role="dialog" aria-modal="true" aria-label="Compose email">
      <div class="modal-header">
        <h2>New message</h2>
        <button class="modal-close" id="compose-close" aria-label="Close">&times;</button>
      </div>
      <form id="compose-form" class="compose-form">
        <input type="text" id="compose-to" placeholder="To (comma-separated)" autocomplete="off" />
        <input type="text" id="compose-cc" placeholder="Cc (optional)" autocomplete="off" />
        <input type="text" id="compose-subject" placeholder="Subject" autocomplete="off" />
        <textarea id="compose-body" placeholder="Write your message…" rows="10"></textarea>
        <div class="compose-footer">
          <p class="modal-msg" id="compose-msg"></p>
          <button class="btn btn-primary btn-sm" type="submit" id="compose-send">Send</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.getElementById("compose-close")!.addEventListener("click", close);

  const form = document.getElementById("compose-form") as HTMLFormElement;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("compose-msg")!;
    const sendBtn = document.getElementById("compose-send") as HTMLButtonElement;

    const to = splitAddresses((document.getElementById("compose-to") as HTMLInputElement).value);
    const cc = splitAddresses((document.getElementById("compose-cc") as HTMLInputElement).value);
    const subject = (document.getElementById("compose-subject") as HTMLInputElement).value;
    const body = (document.getElementById("compose-body") as HTMLTextAreaElement).value;

    if (to.length === 0) {
      setMsg(msg, "Add at least one recipient.", "error");
      return;
    }

    sendBtn.disabled = true;
    setMsg(msg, "Sending…", "");
    try {
      await sendEmail({ to, cc, subject, body });
      setMsg(msg, "Sent!", "success");
      setTimeout(close, 800);
    } catch (err) {
      sendBtn.disabled = false;
      setMsg(msg, err instanceof Error ? err.message : "Failed to send.", "error");
    }
  });
}

function splitAddresses(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function setMsg(el: HTMLElement, text: string, kind: "" | "success" | "error"): void {
  el.textContent = text;
  el.className = `modal-msg${kind ? " " + kind : ""}`;
}
