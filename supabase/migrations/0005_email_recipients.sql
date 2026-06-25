-- =============================================================
-- Store recipient addresses so the viewer can show To/Cc and the Sent
-- list can show the recipient instead of the sender.
-- =============================================================

alter table public.emails
  add column if not exists to_recipients text[] not null default '{}',
  add column if not exists cc_recipients text[] not null default '{}';
