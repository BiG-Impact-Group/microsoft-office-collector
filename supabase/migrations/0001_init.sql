-- =============================================================
-- DevPod — Week 1 schema: connected_accounts + emails
--
-- Token encryption is done APPLICATION-SIDE in the edge functions
-- (AES-GCM via Web Crypto, key from the TOKEN_ENCRYPTION_KEY function
-- secret). The DB only ever stores opaque ciphertext, so there is no
-- pgsodium/Vault dependency here. Columns hold base64 ciphertext as text.
-- Extensions pg_cron + pg_net are used by the poll cron (see 0002).
-- =============================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- =============================================================
-- connected_accounts
-- One row per user × provider (e.g. 'microsoft').
-- Token columns hold app-encrypted ciphertext (never plaintext).
-- =============================================================
create table public.connected_accounts (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users on delete cascade,
  provider                text not null,
  provider_account_email  text,
  access_token_encrypted  text,
  refresh_token_encrypted text,
  token_expires_at        timestamptz,
  last_synced_at          timestamptz,
  created_at              timestamptz not null default now(),

  constraint connected_accounts_provider_check check (provider in ('microsoft', 'google')),
  constraint connected_accounts_user_provider_unique unique (user_id, provider)
);

-- =============================================================
-- emails
-- One row per message per connected account.
-- Deduped on (account_id, provider_message_id) so re-polls are safe.
-- =============================================================
create table public.emails (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.connected_accounts on delete cascade,
  provider_message_id  text not null,
  subject              text,
  from_address         text,
  -- preview comes from Graph's bodyPreview (≤255 plain-text chars)
  preview              text,
  body_html            text,
  received_at          timestamptz,
  is_read              boolean not null default false,
  created_at           timestamptz not null default now(),

  constraint emails_account_message_unique unique (account_id, provider_message_id)
);

-- =============================================================
-- Row-Level Security
-- Tokens are only ever read by the edge functions via the service
-- role (which bypasses RLS). End users get no direct token access.
-- =============================================================
alter table public.connected_accounts enable row level security;
alter table public.emails enable row level security;

-- connected_accounts: users may only see/touch their own rows
create policy "connected_accounts: own rows only"
  on public.connected_accounts
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- emails: users may only read emails belonging to their own accounts
create policy "emails: own accounts only"
  on public.emails
  for select
  using (
    account_id in (
      select id from public.connected_accounts where user_id = auth.uid()
    )
  );
