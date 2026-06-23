# Week 1 — Microsoft / Azure email integration

Implements the full Week-1 scope on `feature/microsoft-email-integration`:
Supabase auth, Azure OAuth inbox-read connect flow, server-side encrypted token
storage, a 60s polling edge function, and a two-pane email reader.

## What's included

- **Landing + auth** — Supabase email/password sign in/up ([src/main.ts](src/main.ts), [src/auth.ts](src/auth.ts)).
- **Connect my email** — Azure (Entra ID) OAuth with a CSRF `state` param,
  least-privilege scope `offline_access User.Read Mail.Read` ([src/connectEmail.ts](src/connectEmail.ts), [src/oauthCallback.ts](src/oauthCallback.ts)).
- **`oauth-callback` edge function** — exchanges the auth code for tokens,
  encrypts them with pgsodium, upserts `connected_accounts` ([supabase/functions/oauth-callback/index.ts](supabase/functions/oauth-callback/index.ts)).
- **`poll-microsoft` edge function** — 60s pg_cron job; refreshes tokens, pages
  Microsoft Graph for new mail, dedupes into `emails` ([supabase/functions/poll-microsoft/index.ts](supabase/functions/poll-microsoft/index.ts)).
- **Schema + RLS** — `connected_accounts`, `emails`, row-level security,
  pgsodium token encryption, cron schedule ([supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql)).
- **Two-pane reader** — subject/preview list + sandboxed-iframe HTML body
  ([src/inbox.ts](src/inbox.ts), [src/emailList.ts](src/emailList.ts), [src/emailViewer.ts](src/emailViewer.ts)).

## Code review fixes (commit 33522e0)

A review surfaced and this PR fixes:

1. **Build was broken** — `import.meta.env` untyped; added `src/vite-env.d.ts`.
2. **OAuth connect was broken in-browser** — `oauth-callback` didn't answer the
   CORS preflight; now handles `OPTIONS` and sends CORS headers.
3. **Token decryption oracle** — `encrypt_token`/`decrypt_token` were
   `EXECUTE`-able by `anon`/`authenticated`; locked to `service_role` (migration `0002`).
4. **Polling dropped mail** — `$top=50`/no paging + `now()` watermark; now pages
   `@odata.nextLink` ascending and advances the watermark to the max ingested
   `receivedDateTime`.
5. **Refresh could persist null tokens** — now checks encrypt errors and throws.
6. Minor: list re-render from cache (no refetch), `&` escaping, dashboard
   reflects connected state.

## Testing done

- `npm run build` passes (tsc + vite).
- Dev-server smoke test: all three routes serve; auth form + sign-in/up toggle
  render; `oauth-callback` shows a clear error with no code/state; `inbox.html`
  redirects to `/` when unauthenticated; no console errors.

## ⚠️ Deployment hazards / not yet verified

These need live Azure + Supabase credentials (and Docker for the local stack),
which weren't available in the build environment:

- **Migrations** — `0001_init.sql` (extensions: `pg_cron`, `pg_net`, pgsodium;
  RLS; cron) and `0002_lock_down_token_functions.sql` must be applied.
- **pg_cron secret** — after deploy, run
  `ALTER DATABASE postgres SET "app.service_role_key" = '<service-role-key>';`
  (referenced by the cron job in `0001`).
- **Edge function env vars** — `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
  `AZURE_REDIRECT_URI`, `AZURE_TENANT`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Cron URL** — `0001` hardcodes the project's functions URL; confirm it
  matches the deploy target.
- **bytea ↔ RPC round-trip** — token encrypt/decrypt relies on PostgREST's
  default hex `bytea` encoding; verify a real connect→poll cycle decrypts cleanly.
- **End-to-end unverified:** real Supabase auth, Azure consent + token exchange,
  Graph polling, RLS enforcement, and the reader with real messages.

## Open decisions (from README)

- Token encryption mechanism — currently pgsodium det-AEAD; README listed Vault
  vs. application-level as open.
- Monorepo layout shared with the Google branch.
