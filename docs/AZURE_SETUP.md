# Azure / Entra ID setup

How to create the Microsoft Entra ID (Azure AD) app registration that powers the
"Connect my email" flow. The values you collect map directly to the project's
environment variables / Supabase edge-function secrets.

This app uses the **OAuth 2.0 authorization code flow with a confidential
client**: the browser receives the `code` at `oauth-callback.html`, then the
`oauth-callback` edge function redeems it server-side using a **client secret**.

## 1. Create the app registration

1. [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** →
   **App registrations** → **New registration**.
2. **Name:** e.g. `DevPod – Microsoft email`.
3. **Supported account types:** with `AZURE_TENANT=common`, choose
   **"Accounts in any organizational directory and personal Microsoft
   accounts"**. (Work/school only → choose "any organizational directory" and
   set `AZURE_TENANT=organizations`.)
4. **Redirect URI:** in the platform dropdown pick **Web** (⚠️ **not**
   "Single-page application"), and enter the `oauth-callback.html` URL:
   ```
   http://localhost:5173/oauth-callback.html
   ```
5. **Register.**

> ### ⚠️ Web vs SPA — the most common mistake
> Register the redirect URI under the **Web** platform, not SPA. The `code` is
> redeemed by the edge function with a **client secret** (confidential client).
> SPA-registered URIs force PKCE + public-client redemption (no secret) and will
> break the edge-function token exchange.

## 2. API permissions (least privilege)

**API permissions** → **Add a permission** → **Microsoft Graph** →
**Delegated permissions**, then add exactly:

- `Mail.Read`
- `User.Read`
- `offline_access` (required for refresh tokens)

No send/write/calendar/contacts scopes. These are user-consentable; some orgs
may still require admin consent.

## 3. Client secret

**Certificates & secrets** → **Client secrets** → **New client secret** → set an
expiry → **copy the `Value` immediately** (shown only once; not the "Secret ID").

## 4. Map values to config

From the app's **Overview** page:

| Azure value                  | Set as                                                                 |
| ---------------------------- | ---------------------------------------------------------------------- |
| **Application (client) ID**  | `AZURE_CLIENT_ID` (edge secret) **and** `VITE_AZURE_CLIENT_ID` (client) |
| Tenant (`common`)            | `AZURE_TENANT` **and** `VITE_AZURE_TENANT`                              |
| **Client secret `Value`**    | `AZURE_CLIENT_SECRET` — edge secret **only**, never a `VITE_` var       |
| Redirect URI                 | `AZURE_REDIRECT_URI` **and** `VITE_AZURE_REDIRECT_URI` (byte-identical) |

Edge-function secrets (Supabase CLI, project already linked):

```bash
supabase secrets set AZURE_CLIENT_ID=<application-client-id>
supabase secrets set AZURE_CLIENT_SECRET=<secret-value>
supabase secrets set AZURE_TENANT=common
supabase secrets set AZURE_REDIRECT_URI=http://localhost:5173/oauth-callback.html
```

Frontend `.env.local` (public values only — never the client secret):

```bash
VITE_AZURE_CLIENT_ID=<application-client-id>
VITE_AZURE_TENANT=common
VITE_AZURE_REDIRECT_URI=http://localhost:5173/oauth-callback.html
```

## Gotchas

- **Redirect URI must match in three places** — the Azure registration,
  `VITE_AZURE_REDIRECT_URI`, and `AZURE_REDIRECT_URI`. A mismatch is the most
  common failure (`AADSTS50011: redirect URI mismatch`).
- **Production:** add a second **Web** redirect URI in Azure for the deployed
  frontend (e.g. `https://yourapp.com/oauth-callback.html`) and point both
  redirect-URI values at it.
- The client secret lives **only** in edge-function secrets — never in the client
  bundle, a `VITE_` var, or git.
