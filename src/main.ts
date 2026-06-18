import { signIn, signUp, signOut, getSession } from "./auth.js";
import { initiateOAuth } from "./connectEmail.js";
import { getMicrosoftAccount } from "./emails.js";

const app = document.getElementById("app")!;

async function render(): Promise<void> {
  const session = await getSession();

  if (session) {
    await renderDashboard(session.user.email ?? "");
  } else {
    renderAuthForm("signin");
  }
}

function renderAuthForm(mode: "signin" | "signup"): void {
  const isSignIn = mode === "signin";

  app.innerHTML = `
    <h1>DevPod</h1>
    <p class="subtitle">${isSignIn ? "Sign in to your account" : "Create an account"}</p>
    <form id="auth-form">
      <div class="form-group">
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" required />
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input id="password" type="password" autocomplete="${isSignIn ? "current-password" : "new-password"}" required />
      </div>
      <p class="error-msg" id="error-msg"></p>
      <button class="btn btn-primary" type="submit">
        ${isSignIn ? "Sign in" : "Create account"}
      </button>
    </form>
    <p class="form-toggle">
      ${isSignIn
        ? `No account? <a id="toggle-mode">Sign up</a>`
        : `Already have an account? <a id="toggle-mode">Sign in</a>`}
    </p>
  `;

  document.getElementById("toggle-mode")!.addEventListener("click", () => {
    renderAuthForm(isSignIn ? "signup" : "signin");
  });

  document.getElementById("auth-form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = (document.getElementById("email") as HTMLInputElement).value;
    const password = (document.getElementById("password") as HTMLInputElement).value;
    const errorEl = document.getElementById("error-msg")!;

    try {
      if (isSignIn) {
        await signIn(email, password);
      } else {
        await signUp(email, password);
      }
      await render();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : "Something went wrong.";
    }
  });
}

async function renderDashboard(email: string): Promise<void> {
  // Reflect whether a Microsoft account is already connected.
  let connected: { provider_account_email: string } | null = null;
  try {
    connected = await getMicrosoftAccount();
  } catch {
    // Non-fatal — fall back to the "connect" prompt.
  }

  const body = connected
    ? `<p>Connected as <strong>${escapeHtml(connected.provider_account_email)}</strong>.</p>
       <div class="dashboard-actions">
         <a class="btn btn-primary" href="/inbox.html">Go to inbox</a>
         <button class="btn btn-danger" id="signout-btn">Sign out</button>
       </div>`
    : `<p>Connect your Microsoft inbox to start syncing email.</p>
       <div class="dashboard-actions">
         <button class="btn btn-primary" id="connect-btn">Connect my email</button>
         <button class="btn btn-danger" id="signout-btn">Sign out</button>
       </div>`;

  app.innerHTML = `
    <div class="dashboard">
      <h2>Welcome, ${escapeHtml(email)}</h2>
      ${body}
    </div>
  `;

  document.getElementById("connect-btn")?.addEventListener("click", () => {
    initiateOAuth();
  });

  document.getElementById("signout-btn")!.addEventListener("click", async () => {
    await signOut();
    await render();
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

render();
