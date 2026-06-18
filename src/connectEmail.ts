const clientId = import.meta.env.VITE_AZURE_CLIENT_ID as string;
const tenant = import.meta.env.VITE_AZURE_TENANT as string;
const redirectUri = import.meta.env.VITE_AZURE_REDIRECT_URI as string;

/**
 * Generates a cryptographically random hex string, stores it in
 * sessionStorage as the CSRF state param, then redirects the browser
 * to the Microsoft Entra ID authorize endpoint.
 */
export function initiateOAuth(): void {
  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  sessionStorage.setItem("ms_oauth_state", state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "offline_access User.Read Mail.Read",
    state,
  });

  window.location.href =
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}`;
}
