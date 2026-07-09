# DevPod / microsoft-office-collector — Session Handoff

> Working context for picking this up in a fresh Claude Code session.

## What this is
Email + workspace "collector" web app. Users sign in (Supabase Auth), connect
Microsoft via OAuth, and their mail + OneDrive files are synced, embedded, and
made searchable/answerable (RAG). This is the **Microsoft branch** (Cloee's).
Frontend: plain **TypeScript + Vite** (no framework). Backend: **Supabase**
Postgres/Auth/Edge Functions (Deno).

## Environment / access
- **Working dir:** `/Volumes/forge2.0/DevPod` — default branch `main`, clean.
- **GitHub:** `BiG-Impact-Group/microsoft-office-collector` (SSH origin). `gh` authed as `ckunstek`. Everything merged (no open PRs as of this handoff).
- **Supabase project:** ref `swfnxitaxbydcyyffxam` (org BiG Impact Group, PG17, us-east-2). Use the MCP tools + linked `supabase` CLI.
- **Dev server:** `npm run dev` on :5173 (needs `.env.local` VITE_ vars). ⚠️ The `/Volumes/forge2.0` mount doesn't emit fs events, so Vite's watcher misses changes — **restart `npm run dev` (or set `server.watch.usePolling: true`) to pick up edits/new files.**

## Key architecture / decisions
- **Edge-function deploy:** always `supabase functions deploy <name>` (CLI bundles `_shared/`); the MCP deploy tool can't bundle shared imports.
- **Token encryption:** app-level AES-256-GCM in `_shared/crypto.ts` (`TOKEN_ENCRYPTION_KEY`). Not pgsodium (unavailable on PG17).
- **Graph token refresh:** `_shared/graphToken.ts` (`getValidAccessToken`, `GRAPH_SCOPE`). **Scope:** `offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send Files.ReadWrite` (upload needs ReadWrite). Set in 3 places: `graphToken.ts`, `oauth-callback`, `src/connectEmail.ts`.
- **User-facing fn pattern:** `_shared/graphUser.ts` `resolveCaller(req)` verifies the JWT, resolves the user's active Microsoft account, returns a service client + Graph token.
- **Cron→fn auth:** `x-poll-secret` header (secret inline in `cron.job` rows — read via `execute_sql: select jobname, command from cron.job`). Per-minute crons: poll-microsoft, index-emails, index-documents, process-attachments, poll-onedrive.
- **Embeddings:** Supabase built-in `gte-small` (384-dim, keyless). Index crons process ~3 items/run (edge CPU limit).
- **RAG:** `match_context` RPC over `email_chunks` + `document_chunks` (RLS-scoped). `ask` fn grounds with a **FILE INVENTORY** (the user's `documents`) so listing questions work, and is **conversation-aware** (multi-turn, persists to chat tables).
- **File→markdown:** `_shared/convert.ts` — text/csv/html/json inline; **PDF + images (OCR/description) via Claude vision** (needs `ANTHROPIC_API_KEY`); docx/xlsx still `skipped`. Shared upsert helper `_shared/onedriveDoc.ts`.
- **OneDrive collection:** `poll-onedrive` walks `/me/drive/root/delta` (whole drive) with a persisted cursor `connected_accounts.onedrive_delta_link` (NOT `/me/drive/recent`, which returned 0 for non-empty drives).
- **Migrations applied live through 0014.** 0014 = `chat_conversations` + `chat_messages` (owner-only RLS). 0013 = `onedrive_delta_link`. 0011 = `documents.external_id` unique per (account_id, source, external_id).
- **Secrets set:** `ANTHROPIC_API_KEY` (model via `ANTHROPIC_MODEL`, default `claude-opus-4-8`), `TOKEN_ENCRYPTION_KEY`, `POLL_SECRET`, `AZURE_*`.

## Deployed edge functions (all active)
oauth-callback, poll-microsoft, delete-account, send-mail, index-emails, search,
ask, process-attachments, index-documents, poll-onedrive, onedrive-list,
onedrive-download, onedrive-process, onedrive-upload.

## Frontend structure (Vite MPA)
- Entries (`vite.config.ts` rollupOptions.input): `index.html` (auth + landing → `src/main.ts`), `inbox.html` (**workspace shell** → `src/app.ts`), `oauth-callback.html`.
- **Shell (`app.ts`):** sidebar with **Mail / OneDrive / Assistant** sections (hash routes `#mail`/`#onedrive`/`#assistant`); global **Settings** gear in the "DevPod" brand row; a bottom-right **FAB** assistant, hidden on the Assistant page (`fab.setFabVisible`).
- **Mail** (`mailView.ts`, `emailViewer.ts`, `emailList.ts`): two-pane reader, category tabs, search, compose/reply; From/To/Cc addresses are clickable → compose.
- **OneDrive** (`onedriveView.ts`, `onedrive.ts`): live browse (folder nav/breadcrumb), download, upload (to `DevPod Uploads`), process-to-vector-DB, indexed badges.
- **Assistant** (`assistant.ts` shared store, `assistantRender.ts`, `assistantView.ts`, `askModal.ts` docked FAB panel): persistent **multi-turn** chat shared between the FAB and the full page; past-logs browser; FAB **X ends the chat**, navigation preserves it. Clickable **sources**: email → opens in Mail; **document → reveals the file's folder in OneDrive** (falls back to root if not in the live drive). Address links → compose. Shared open buses in `navigation.ts`.

## Accounts note (not a bug)
Two DevPod app users both connected the same mailbox `ckunstek@deeplight.ae`:
**cloee@bigimpactgroup.ai** (`connected_accounts.id = 99f8bfda`, the one being
tested) and **cloee@kunstek.com** (`1222dd4f`). Each has its own RLS-isolated
data; the `(user_id, provider)` unique index prevents true per-user duplicates.

## Test data (seeded — removable)
For account `99f8bfda`: **6 emails** (`provider_message_id like 'seed-%'`) +
**4 documents** (`external_id like 'seed-doc-%'`: Project Phoenix PRD, Company
Handbook, Q3 Financials, CloudHost contract), all embedded. Delete by those
tags. The `seed-doc-*` external_ids are placeholders, so their source-links
reveal the OneDrive root (not a real file); real files (e.g. `bigimpact.jpeg`
in `DevPod Uploads`) reveal their exact folder.

## Verified live (latest session)
Multi-turn memory, chat persistence, X-resets-chat, Assistant page + past-logs +
FAB-hidden, image OCR → embed → answer, clickable sources, document-source
reveal in OneDrive, seeded emails in inbox.

## 🔜 NEXT: deploy to Netlify (open task — not started)
- **Build:** `npm run build` (`tsc && vite build` → `dist/`). Publish dir `dist`. MPA: `index.html`, `inbox.html`, `oauth-callback.html` are all Vite entries and deploy as static files. Add a `netlify.toml` (build command + publish dir); verify deep links to `/inbox.html` and `/oauth-callback.html`.
- **Netlify env vars** (from local `.env.local`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AZURE_CLIENT_ID` (`d94df09f-6ff1-41b7-9717-7be1b219cfe2`), `VITE_AZURE_TENANT` (`common`), `VITE_AZURE_REDIRECT_URI`.
- **OAuth redirect URI (main gotcha):** currently `http://localhost:5173/oauth-callback.html`. For prod: (1) add `https://<site>.netlify.app/oauth-callback.html` to the Azure app registration redirect URIs, (2) set `VITE_AZURE_REDIRECT_URI` to that prod URL at build, (3) update the **`AZURE_REDIRECT_URI` edge secret** the `oauth-callback` function uses in its token exchange (must match the client's redirect_uri).
- **Supabase edge fns/DB stay on Supabase** (not proxied through Netlify); client calls `${VITE_SUPABASE_URL}/functions/v1/...` directly (functions send permissive CORS).

## Workflow conventions
Feature branch → PR (never push to `main` directly). Commit messages end with
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR bodies end with the
"Generated with Claude Code" line. Persistent memory:
`~/.claude/projects/-Volumes-forge2-0-DevPod/memory/` (`github-remote.md`,
`supabase-project.md`).
