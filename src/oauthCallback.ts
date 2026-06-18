import { supabase } from "./lib/supabase.js";
import { getSession } from "./auth.js";

const messageEl = document.getElementById("message")!;
const errorEl = document.getElementById("error-msg")!;

async function handleCallback(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const returnedState = params.get("state");
  const oauthError = params.get("error");

  // ── 1. Surface any error from Microsoft ───────────────────
  if (oauthError) {
    showError(`Microsoft returned an error: ${params.get("error_description") ?? oauthError}`);
    return;
  }

  if (!code || !returnedState) {
    showError("Missing authorization code or state parameter.");
    return;
  }

  // ── 2. CSRF state check ───────────────────────────────────
  const savedState = sessionStorage.getItem("ms_oauth_state");
  sessionStorage.removeItem("ms_oauth_state");

  if (!savedState || savedState !== returnedState) {
    showError("State mismatch — possible CSRF attempt. Please try connecting again.");
    return;
  }

  // ── 3. Confirm the user is still authenticated ────────────
  const session = await getSession();
  if (!session) {
    showError("Your session expired. Please sign in again.");
    return;
  }

  // ── 4. Send the code to the edge function ─────────────────
  messageEl.textContent = "Exchanging tokens with Microsoft…";

  const { data: { session: currentSession } } = await supabase.auth.getSession();
  const jwt = currentSession?.access_token;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const response = await fetch(`${supabaseUrl}/functions/v1/oauth-callback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${jwt}`,
    },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    showError(body.error ?? `Server error (${response.status}). Please try again.`);
    return;
  }

  // ── 5. Success — redirect to inbox ───────────────────────
  messageEl.textContent = "Connected! Redirecting to your inbox…";
  window.location.href = "/inbox.html";
}

function showError(msg: string): void {
  messageEl.textContent = "Something went wrong.";
  errorEl.textContent = msg;
}

handleCallback();
