-- =============================================================
-- Disconnect support: an active flag on connected accounts.
--
-- Disconnecting sets is_active = false and clears the stored tokens, so the
-- poll stops gathering new mail — but the connected_accounts row (and its
-- emails, via the FK) are kept. Reconnecting re-consents and flips it back.
-- =============================================================

alter table public.connected_accounts
  add column if not exists is_active boolean not null default true;
