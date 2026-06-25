# CLAUDE.md

Guidance for Claude Code working in this repo. Read this first.

## What this is

DevPod — an email/workspace integration web app. This branch
(`feature/microsoft-email-integration`) covers **Microsoft / Azure OAuth inbox
access**. A coworker handles the Google suite on a separate branch. See
[README.md](./README.md) for full goals and [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md)
for the planned layout.

## Decisions already made (do not re-litigate)

- **Stack:** TypeScript · Supabase (Postgres, Auth, Edge Functions).
- **Frontend:** plain TypeScript + HTML/CSS, **no UI framework**, bundled with
  Vite. (React/Next were explicitly declined — ignore React-specific skill
  guidance below.)
- **Branch:** `feature/microsoft-email-integration`.
- **OAuth scope:** originally read-only least-privilege (`Mail.Read`,
  `User.Read`, `offline_access`). **Expanded for compose/send** to add
  `Mail.ReadWrite` + `Mail.Send` (user-approved). Still no calendar/contacts.
  Existing connections must re-consent (reconnect) to gain the new scopes.
- **Tokens:** stored server-side in Postgres, never in the client bundle; RLS
  enforced; encrypt at rest (mechanism TBD — see README "Open decisions").

## Week 1 scope (this branch)

1. Landing page with Supabase auth.
2. "Connect my email" → Microsoft Azure OAuth (inbox-read only).
3. Store returned OAuth tokens.
4. Supabase edge function on a 60s cron polling connected Microsoft accounts
   for new mail (Microsoft Graph) → store in DB.
5. Two-pane email UI: subject + 2–3 sentence preview list (left), full HTML
   body (right).

## Imported skills (`.claude/skills/`)

23 skills were imported from the `todo-sample` repo. Caveats:

- **Applicable here:** `supabase-mcp`, `supabase-safe-stop`, the `a11y-*` suite,
  `web-design-guidelines`, `ux-taste`, `jobs-ive-critique`, `validation-gate`,
  `pr-package`, `feature-commit`, `version-and-commit`, `memory-persist`,
  `unstuck-engineering`.
- **Conflicts with our stack (React/Vite/SCSS-specific — do NOT apply):**
  `react-best-practices`, `composition-patterns`, `design-guardian`.
- **Need infra we don't have:** `spawn-planner` / `spawn-builder` assume git
  worktrees + `origin/test` + GitHub issues; `codex-*` need Codex tooling.
  Adapt rather than run as-is. There is **no remote, no `test` branch** yet.
- **No `/brainstorm` skill was imported** — the brainstorming step has no
  backing skill/command here; handle it natively or have the user supply one.

## Workflow the user wants

brainstorm → plan → build → code-review → fix bugs → manual test → pull request.
