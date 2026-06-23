# DevPod — Email & Workspace Integration Platform

A web application for connecting third-party inboxes and workspace tools to a
unified interface. Users authenticate, connect their accounts via OAuth, and
their data (starting with email) is polled and surfaced in-app.

**Stack:** TypeScript · Supabase (Postgres, Auth, Edge Functions) · plain TypeScript + HTML frontend (no UI framework, bundled with Vite)

> **Frontend:** The browser UI is hand-written TypeScript + HTML/CSS with no SPA
> framework, bundled with Vite (a Node-based tool). This keeps dependencies
> minimal for the Week 1 two-pane reader.

---

## Long-term goals

This platform will grow to integrate several external services. Work is split
across branches so contributors can move independently.

| Integration                | Owner branch        | Target  | Status      |
| -------------------------- | ------------------- | ------- | ----------- |
| **Microsoft email**        | this branch         | Week 1  | In progress |
| **Google email**           | coworker's branch   | Week 1  | Separate    |
| **Google Drive access**    | _future_            | Later   | Planned     |
| **Slack access**           | _future_            | Later   | Planned     |

The Microsoft and Google email integrations are being built in parallel on
separate branches and merged independently. Drive and Slack come afterward and
will reuse the same connect-account → store-token → poll/sync pattern
established by the email work.

---

## This branch: Microsoft / Azure email integration (Week 1)

Scope for the first week, on `feature/microsoft-email-integration`:

1. **Landing page** — users authenticate via Supabase Auth.
2. **"Connect my email" button** — initiates Microsoft Azure (Entra ID) OAuth,
   requesting **only basic inbox-read permissions** (`Mail.Read`, `User.Read`,
   `offline_access`). No write, no send, no calendar, no contacts.
3. **Token storage** — the OAuth access + refresh tokens returned by Azure after
   user consent are stored securely (see Security below).
4. **Polling edge function** — a Supabase Edge Function on a 60-second cron that
   polls every connected Microsoft account for new mail (via Microsoft Graph)
   and stores messages in the database.
5. **Email UI** — a two-pane reader: a left-hand list of messages showing
   subject + a 2–3 sentence preview, and a right-hand pane rendering the full
   HTML body of the selected email.

### Architecture (Week 1)

```
                ┌─────────────────────────────────────────────┐
                │            Browser (plain TS + HTML)          │
                │  Landing/Auth → Connect Email → Inbox UI      │
                └───────────────┬───────────────────────────────┘
                                │ Supabase JS client (auth + data)
                                ▼
        ┌───────────────────────────────────────────────────────┐
        │                      Supabase                          │
        │                                                        │
        │  Auth ── users                                         │
        │  Postgres ── connected_accounts, emails (RLS enforced) │
        │                                                        │
        │  Edge Functions:                                       │
        │    • oauth-callback   (exchange Azure code → tokens)   │
        │    • poll-microsoft   (cron @ 60s → Graph → emails)    │
        └───────────────┬───────────────────────────────────────┘
                        │ HTTPS (Microsoft Graph API)
                        ▼
        ┌───────────────────────────────────────────────────────┐
        │   Microsoft identity platform (Entra ID) + Graph API   │
        └───────────────────────────────────────────────────────┘
```

### OAuth flow

1. User clicks **Connect my email**.
2. App redirects to the Microsoft authorize endpoint with `scope=offline_access
   User.Read Mail.Read` and a state value.
3. User consents; Azure redirects back with an authorization `code`.
4. The `oauth-callback` edge function exchanges the code for an access token +
   refresh token and stores them against the user's `connected_accounts` row.
5. The `poll-microsoft` cron function refreshes tokens as needed and pulls new
   mail every 60 seconds.

### Data model (initial)

- **`connected_accounts`** — `id`, `user_id` (FK → auth.users), `provider`
  (`'microsoft'`), `provider_account_email`, `access_token`, `refresh_token`,
  `token_expires_at`, `last_synced_at`, `created_at`.
- **`emails`** — `id`, `account_id` (FK → connected_accounts), `provider_message_id`,
  `subject`, `from_address`, `preview`, `body_html`, `received_at`, `is_read`,
  `created_at`. Unique on (`account_id`, `provider_message_id`) to dedupe polls.

Row-Level Security is enabled so users can only read their own accounts and emails.

---

## Security

- **Least privilege:** the Azure app registration requests only `Mail.Read` and
  `User.Read` (plus `offline_access` for refresh tokens). It cannot send, delete,
  or modify mail.
- **Token handling:** OAuth tokens are encrypted **application-side** with
  AES-256-GCM (Web Crypto) inside the edge functions before being written to
  Postgres, so the database only ever holds opaque ciphertext. The 32-byte key
  lives in the `TOKEN_ENCRYPTION_KEY` edge-function secret, never in the DB or
  client bundle. Rows are additionally gated by RLS; only the service role
  (edge functions) ever reads token columns.
- **Secrets:** Azure client ID/secret and Supabase service-role key live only in
  edge-function environment variables, never in the client bundle or git.

---

## Project structure

See [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md) for the full tree and a
description of each directory.

---

## Getting started

> These steps assume the scaffold described in `PROJECT_STRUCTURE.md` exists.
> The app is not yet scaffolded — see "Status" below.

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local   # fill in Supabase + Azure values

# 3. Run the local Supabase stack (requires Supabase CLI)
supabase start

# 4. Run the frontend
npm run dev
```

### Required environment variables

| Variable                        | Where      | Purpose                                  |
| ------------------------------- | ---------- | ---------------------------------------- |
| `VITE_SUPABASE_URL`             | client     | Supabase project URL                     |
| `VITE_SUPABASE_ANON_KEY`        | client     | Supabase anon/public key                 |
| `SUPABASE_SERVICE_ROLE_KEY`     | edge fns   | Server-side DB access for cron/callback  |
| `TOKEN_ENCRYPTION_KEY`          | edge fns   | base64 32-byte AES-256-GCM token key      |
| `AZURE_CLIENT_ID`               | edge fns   | Entra ID app registration client ID      |
| `AZURE_CLIENT_SECRET`           | edge fns   | Entra ID client secret                   |
| `AZURE_REDIRECT_URI`            | both       | OAuth callback URL                       |
| `AZURE_TENANT`                  | edge fns   | Tenant (`common` for multi-tenant)       |

---

## Status

- [x] Repository initialized
- [x] README + long-term goals
- [x] Project structure document
- [x] App scaffold (frontend + Supabase config)
- [x] Supabase schema + RLS migrations
- [x] Landing page + Supabase auth
- [x] "Connect my email" → Azure OAuth
- [x] `oauth-callback` edge function
- [x] `poll-microsoft` cron edge function (60s)
- [x] Two-pane email reader UI
- [x] Code review + frontend manual test (backend flows pending live Azure/Supabase creds)
- [ ] Pull request (blocked: no git remote configured yet)

---

## Open decisions

These are intentionally left open to settle during the brainstorming/planning
step rather than assumed:

1. **Monorepo layout** — whether this branch shares a repo/package layout with
   the coworker's Google branch, which affects where shared code lives.

_(Resolved: frontend is plain TypeScript + HTML bundled with Vite — no UI
framework.)_

_(Resolved: token encryption at rest is **application-level AES-256-GCM** in the
edge functions — pgsodium's server-side key management is unavailable on the
project's Postgres 17 instance, and Vault-per-token was rejected as awkward.)_
