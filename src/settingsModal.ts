import { signOut, updateEmail, updatePassword, deleteAccount } from "./auth.js";

interface SettingsOpts {
  signInEmail: string;
  microsoftEmail: string | null;
}

/**
 * Opens the account settings dialog: shows the sign-in email (with options to
 * change email/password), the linked Microsoft account, and a sign-out button.
 */
export function openSettings(opts: SettingsOpts): void {
  if (document.getElementById("settings-overlay")) return; // already open

  const overlay = document.createElement("div");
  overlay.id = "settings-overlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="modal-header">
        <h2>Settings</h2>
        <button class="modal-close" id="settings-close" aria-label="Close">&times;</button>
      </div>

      <div class="modal-section">
        <div class="modal-label">Signed in as</div>
        <div class="modal-value">${escapeHtml(opts.signInEmail)}</div>
        <div class="modal-actions-row">
          <button class="link-btn" id="toggle-email" type="button">Change email</button>
          <button class="link-btn" id="toggle-password" type="button">Change password</button>
        </div>

        <form class="modal-subform hidden" id="email-form">
          <input type="email" id="new-email" placeholder="New email" autocomplete="email" required />
          <button class="btn btn-primary btn-sm" type="submit">Save</button>
          <p class="modal-msg" id="email-msg"></p>
        </form>

        <form class="modal-subform hidden" id="password-form">
          <input type="password" id="new-password" placeholder="New password (min 6 chars)" autocomplete="new-password" minlength="6" required />
          <button class="btn btn-primary btn-sm" type="submit">Save</button>
          <p class="modal-msg" id="password-msg"></p>
        </form>
      </div>

      <div class="modal-section">
        <div class="modal-label">Connected email account</div>
        <div class="modal-value">${
          opts.microsoftEmail
            ? `Microsoft &middot; ${escapeHtml(opts.microsoftEmail)}`
            : "None connected"
        }</div>
      </div>

      <div class="modal-section">
        <div class="modal-label">Danger zone</div>
        <button class="btn btn-danger" id="delete-account" type="button">Delete account</button>
      </div>

      <div class="modal-footer">
        <button class="btn btn-danger" id="settings-signout" type="button">Sign out</button>
      </div>
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
  document.getElementById("settings-close")!.addEventListener("click", close);

  // Toggle the two inline sub-forms
  const emailForm = document.getElementById("email-form") as HTMLFormElement;
  const passwordForm = document.getElementById("password-form") as HTMLFormElement;
  document
    .getElementById("toggle-email")!
    .addEventListener("click", () => emailForm.classList.toggle("hidden"));
  document
    .getElementById("toggle-password")!
    .addEventListener("click", () => passwordForm.classList.toggle("hidden"));

  // Change email — Supabase sends a confirmation link to complete the change.
  emailForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("email-msg")!;
    const value = (document.getElementById("new-email") as HTMLInputElement).value.trim();
    setMsg(msg, "Saving…", "");
    try {
      await updateEmail(value);
      setMsg(msg, "Check your inbox to confirm the new email address.", "success");
    } catch (err) {
      setMsg(msg, errText(err, "Failed to update email."), "error");
    }
  });

  // Change password — applies immediately.
  passwordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("password-msg")!;
    const input = document.getElementById("new-password") as HTMLInputElement;
    setMsg(msg, "Saving…", "");
    try {
      await updatePassword(input.value);
      input.value = "";
      setMsg(msg, "Password updated.", "success");
    } catch (err) {
      setMsg(msg, errText(err, "Failed to update password."), "error");
    }
  });

  document.getElementById("settings-signout")!.addEventListener("click", async () => {
    await signOut();
    window.location.href = "/";
  });

  document.getElementById("delete-account")!.addEventListener("click", openDeleteConfirm);
}

/** Confirmation popup for the irreversible account deletion. */
function openDeleteConfirm(): void {
  if (document.getElementById("delete-confirm-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "delete-confirm-overlay";
  overlay.className = "modal-overlay modal-overlay-top";
  overlay.innerHTML = `
    <div class="modal-card" role="alertdialog" aria-modal="true" aria-label="Confirm account deletion">
      <div class="modal-header"><h2>Delete account?</h2></div>
      <div class="modal-section">
        <p class="modal-warning">This permanently deletes your account, the linked
        Microsoft connection, and all synced email. This <strong>cannot be undone</strong>.</p>
        <p class="modal-msg error" id="delete-msg"></p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="delete-cancel" type="button">Cancel</button>
        <button class="btn btn-danger-solid" id="delete-confirm" type="button">Delete permanently</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeConfirm = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeConfirm();
  });
  document.getElementById("delete-cancel")!.addEventListener("click", closeConfirm);

  document.getElementById("delete-confirm")!.addEventListener("click", async () => {
    const btn = document.getElementById("delete-confirm") as HTMLButtonElement;
    const msg = document.getElementById("delete-msg")!;
    btn.disabled = true;
    setMsg(msg, "Deleting…", "");
    try {
      await deleteAccount();
      await signOut();
      window.location.href = "/";
    } catch (err) {
      btn.disabled = false;
      setMsg(msg, errText(err, "Failed to delete account."), "error");
    }
  });
}

function setMsg(el: HTMLElement, text: string, kind: "" | "success" | "error"): void {
  el.textContent = text;
  el.className = `modal-msg${kind ? " " + kind : ""}`;
}

function errText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
