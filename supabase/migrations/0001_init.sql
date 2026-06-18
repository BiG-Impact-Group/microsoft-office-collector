-- =============================================================
-- DevPod — Week 1 schema: connected_accounts + emails
-- Extensions: pgsodium (Vault encryption), pg_cron, pg_net
-- =============================================================

-- Extensions

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- =============================================================
-- connected_accounts
-- Stores one row per user × provider (e.g. 'microsoft').
-- Tokens are encrypted at rest with pgsodium deterministic AEAD.
-- =============================================================
create table public.connected_accounts (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users on delete cascade,
  provider                text not null,
  provider_account_email  text,
  -- Tokens stored as pgsodium-encrypted bytea; never plaintext in the DB.
  access_token_encrypted  bytea,
  refresh_token_encrypted bytea,
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

-- =============================================================
-- pgsodium key for token encryption
-- Key ID 1 is derived from Supabase's root pgsodium key.
-- Edge functions call pgsodium.crypto_aead_det_encrypt /
-- pgsodium.crypto_aead_det_decrypt with this key ID.
-- =============================================================
select pgsodium.create_key(
  name        => 'devpod-token-key',
  key_type    => 'aead-det',
  raw_key     => null   -- let pgsodium derive from the root key
);

-- Expose a helper that edge functions can call via RPC to avoid
-- embedding raw pgsodium calls in every edge function.

-- encrypt_token: wraps pgsodium det-encrypt; returns bytea
create or replace function public.encrypt_token(plaintext text)
returns bytea
language sql security definer
as $$
  select pgsodium.crypto_aead_det_encrypt(
    plaintext => convert_to(plaintext, 'utf8'),
    additional => convert_to('devpod-token', 'utf8'),
    key_id => (select id from pgsodium.valid_key where name = 'devpod-token-key' limit 1)
  );
$$;

-- decrypt_token: wraps pgsodium det-decrypt; returns text
create or replace function public.decrypt_token(ciphertext bytea)
returns text
language sql security definer
as $$
  select convert_from(
    pgsodium.crypto_aead_det_decrypt(
      ciphertext  => ciphertext,
      additional  => convert_to('devpod-token', 'utf8'),
      key_id      => (select id from pgsodium.valid_key where name = 'devpod-token-key' limit 1)
    ),
    'utf8'
  );
$$;

-- =============================================================
-- pg_cron: invoke poll-microsoft every minute
-- URL is hardcoded (public). The service role key is read from
-- a DB-level GUC set post-deploy (see README / deployment notes).
-- Run this after pushing the migration:
--   ALTER DATABASE postgres SET "app.service_role_key" = '<your-service-role-key>';
-- =============================================================
select cron.schedule(
  'poll-microsoft',
  '* * * * *',
  $$
    select net.http_post(
      url     => 'https://swfnxitaxbydcyyffxam.supabase.co/functions/v1/poll-microsoft',
      headers => jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body    => '{}'::jsonb
    );
  $$
);
