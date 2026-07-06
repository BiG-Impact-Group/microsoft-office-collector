# DevPod / microsoft-office-collector — Session Handoff

> Working context for picking this up in a fresh Claude Code session.

## What this is
Email + workspace "collector" web app. Users authenticate (Supabase), connect Microsoft
via OAuth, and their mail + files are synced, categorized, embedded, and made
searchable/answerable (RAG). This is the **Microsoft branch** (Cloee's); a coworker does
the Google side separately. End goal: "talk to your content across Microsoft (mail,
OneDrive, SharePoint, Teams)".

## Environment / access
- **Working dir:** /Volumes/forge2.0/DevPod  (default branch: `main`)
- **GitHub:** `BiG-Impact-Group/microsoft-office-collector` (git remote `origin` = SSH). `gh` CLI is authed as `ckunstek`.
- **Supabase project:** ref `swfnxitaxbydcyyffxam` (org "BiG Impact Group", PG17, us-east-2). Reachable via the Supabase MCP tools + the linked `supabase` CLI.
- **Stack:** TypeScript + Vite (plain TS/HTML, NO framework) frontend; Supabase Postgres/Auth/Edge Functions (Deno/TypeScript).
- **Dev server:** `npm run dev` on :5173 (needs `.env.local` with VITE_ vars — set locally: SUPABASE URL/anon key, AZURE_CLIENT_ID `d94df09f-6ff1-41b7-9717-7be1b219cfe2`, AZURE_TENANT=common, AZURE_REDIRECT_URI=http://localhost:5173/oauth-callback.html).

## Key architecture decisions
- **Token encryption = app-level AES-256-GCM** in edge functions (`_shared/crypto.ts`, key = `TOKEN_ENCRYPTION_KEY` secret). pgsodium does NOT work on this PG17 project — don't reintroduce it.
- **Token decrypt/refresh** shared in `_shared/graphToken.ts` (`getValidAccessToken`, `GRAPH_SCOPE`).
- **Cron→function auth:** functions check an `x-poll-secret` header (NOT the service-role key). The cron sends the anon key (satisfies gateway verify_jwt) + `x-poll-secret`. The secret is the `POLL_SECRET` edge secret AND inline in the live `cron.job` rows — read it via MCP `execute_sql: select jobname, command from cron.job` if you need to fire a function manually.
- **Embeddings = Supabase built-in `gte-small`** (384-dim, keyless) via `new Supabase.ai.Session("gte-small")` in edge functions. Edge runtime has a CPU limit → index crons process tiny batches (~3 items/run).
- **OAuth scope (now):** `offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send Files.Read` (in `_shared/graphToken.ts`, `src/connectEmail.ts`, `oauth-callback`).
- **Migrations:** live DB applied through **0012**. Repo migration numbering has gaps across branches; repo cron migrations reference a `current_setting('app.poll_secret')` GUC that is NOT set — the LIVE crons use the inline secret instead (minor repo/live divergence, documented).
- **Supabase CLI deploy** (`supabase functions deploy <name>`) bundles `_shared/`; the MCP deploy tool CANNOT bundle shared imports — always use the CLI for functions that import from `_shared/`.
- Use `curl` (not python `urllib` — TLS fails) for any raw HTTP.

## MERGED to main (Week 1 + iterations)
Auth + landing; Azure OAuth; encrypted token storage; `poll-microsoft` (60s cron: Inbox+Junk+Sent);
two-pane reader (sandboxed iframe, allow-same-origin, no allow-scripts); category tabs
(Primary/Promotions/Junk/Sent from `inferenceClassification`; All excludes Sent);
settings modal (change email/password; `delete-account` fn; disconnect via `is_active` +
reconnect; fetches live account state); compose/send (`send-mail`), reply, To/Cc display;
semantic search (pgvector `email_chunks`, `index-emails` cron, `search` fn,
`match_email_chunks` RPC, search box). PRs #1-#6 merged.

## OPEN PRs (stacked — MERGE #7 THEN #8)
- **PR #7 `feature/rag-ask-attachments`**: `ask` edge fn (RAG answers via Claude; `match_context`
  RPC spanning emails+documents; model = `ANTHROPIC_MODEL` env, default `claude-opus-4-8`;
  degrades to retrieval-only without `ANTHROPIC_API_KEY`); "Ask AI" UI (`askModal.ts`);
  `documents`+`document_chunks` tables (0009); `process-attachments` fn (email attachments ->
  markdown); `index-documents` fn; crons (0010).
- **PR #8 `feature/onedrive`** (branched off #7): `poll-onedrive` fn (walks `/me/drive/root/delta`
  drive-wide -> markdown -> `documents` source='onedrive', dedupe on `external_id`); `_shared/convert.ts`
  (shared file->markdown: text/csv/html/json inline, PDF via Claude, docx/xlsx skipped);
  `documents.external_id` (0011); `poll-onedrive` cron (0012); scope += `Files.Read`; CLAUDE.md updated.
  NOTE: originally used `/me/drive/recent`, which returned 0 items even for non-empty drives
  (it tracks recently-*accessed* files, not drive contents). Fixed in PR #9 -> delta enumeration
  with a persisted cursor (`connected_accounts.onedrive_delta_link`, migration 0013).

## IMMEDIATE NEXT STEP (user-approved)
1. **User is reconnecting** the Microsoft account to consent to `Files.Read` (Azure perms were
   ADDED but blank Status = not yet consented; admin consent not required, so reconnect grants
   it). After reconnect, verify OneDrive via MCP `execute_sql: select status, count(*) from
   documents where source='onedrive' group by status`.
2. Then **merge PR #7, then PR #8** into main (`gh pr merge <n> --merge`). #8 is stacked on #7,
   so merge #7 first; a small `inbox.ts`/`emails.ts` conflict is possible — resolve by keeping
   both features. After each merge: `git fetch && git checkout main && git reset --hard origin/main`.

## Deployed edge functions (all ACTIVE)
oauth-callback, poll-microsoft, delete-account, send-mail, index-emails, search, ask,
process-attachments, index-documents, poll-onedrive.
Live per-minute crons: poll-microsoft, index-emails, index-documents, process-attachments, poll-onedrive.

## PENDING USER ACTIONS (not code)
- **Reconnect** to grant `Files.Read` (in progress) -> activates OneDrive collection.
- **Set `ANTHROPIC_API_KEY`** edge secret (`supabase secrets set ANTHROPIC_API_KEY=...`, optional
  `ANTHROPIC_MODEL`) -> enables generated RAG answers AND PDF->markdown. Until then, Ask shows
  sources only and PDFs are skipped.
- **Revoke the GitHub PATs** pasted earlier in the original chat (security hygiene).

## KNOWN GAPS / TODO backlog
- **docx/xlsx -> markdown** (currently status='skipped' for attachments + OneDrive). Needs a Deno
  unzip+extract pass or a separate Python worker (markitdown/docling).
- **SharePoint**: `Sites.Read.All` added in Azure but NOT requested in the app scope, so dormant.
  Enable by adding `Sites.Read.All` to the scope (3 places) + extending `poll-onedrive` to site
  drives, then reconnect.
- Optionally converge live crons to the `app.poll_secret` GUC to match repo migrations.

## Workflow conventions
Feature branch -> PR (never push to main directly). Commit messages end with:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. PR bodies end with the
"Generated with Claude Code" line. Persistent memory:
`~/.claude/projects/-Volumes-forge2-0-DevPod/memory/` (`github-remote.md`, `supabase-project.md`).
