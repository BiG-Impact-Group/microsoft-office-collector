# Project Structure

> Generated as the project-structure reference (the role `/doc` would serve).
> This describes the **planned** layout for the Week 1 Microsoft email
> integration. Directories marked _(planned)_ do not exist yet — they will be
> created during the build step.

```
DevPod/
├── README.md                      # Goals, scope, architecture, setup
├── PROJECT_STRUCTURE.md           # This file
├── .gitignore
├── .env.example                   # (planned) template for required env vars
├── package.json                   # (planned) frontend + tooling deps
├── tsconfig.json                  # (planned) TypeScript config
├── vite.config.ts                 # (planned) Vite config (vanilla TS)
├── index.html                     # (planned) landing page entry
├── inbox.html                     # (planned) two-pane reader entry
│
├── src/                           # (planned) plain TypeScript modules (no framework)
│   ├── main.ts                    #   landing/auth bootstrap
│   ├── inbox.ts                   #   inbox page bootstrap
│   ├── lib/
│   │   └── supabase.ts            #   Supabase client singleton
│   ├── auth.ts                    #   Supabase auth helpers (sign in/out)
│   ├── connectEmail.ts            #   builds + initiates Azure OAuth redirect
│   ├── emailList.ts               #   left pane: render subject + preview list
│   ├── emailViewer.ts             #   right pane: render full HTML body
│   └── emails.ts                  #   fetch stored emails from Supabase
│   └── styles.css                 #   two-pane layout styling
│
└── supabase/                      # (planned) Supabase project
    ├── config.toml                #   local stack + cron schedule config
    ├── migrations/
    │   └── 0001_init.sql          #   connected_accounts, emails, RLS
    └── functions/
        ├── oauth-callback/
        │   └── index.ts           #   exchange Azure code → tokens, store
        └── poll-microsoft/
            └── index.ts           #   cron @ 60s: Graph → new emails → DB
```

## Directory responsibilities

| Path                       | Responsibility                                              |
| -------------------------- | ----------------------------------------------------------- |
| `index.html` / `inbox.html`| HTML entry points for the landing and inbox pages.          |
| `src/lib/`                 | Shared client utilities (Supabase client, types).           |
| `src/*.ts`                 | Plain TS modules: auth, OAuth redirect, list/viewer rendering, data fetch. |
| `supabase/migrations/`     | Versioned SQL schema, including Row-Level Security policies. |
| `supabase/functions/`      | Deno edge functions: OAuth callback + the 60s poll cron.    |

## Edge functions

- **`oauth-callback`** — receives the Azure authorization `code`, exchanges it
  for access + refresh tokens, and writes a `connected_accounts` row for the
  authenticated user.
- **`poll-microsoft`** — invoked by cron every 60 seconds; for each connected
  Microsoft account it refreshes the token if expired, queries Microsoft Graph
  for new messages, and upserts them into `emails` (deduped by
  `provider_message_id`).
