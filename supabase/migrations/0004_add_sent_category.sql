-- =============================================================
-- Add the 'sent' category (synced from the Sent Items folder).
-- 'urgent' is retained in the allowed set for back-compat, but is no longer
-- produced by the classifier or shown as a tab.
-- =============================================================

alter table public.emails
  drop constraint if exists emails_category_check;

alter table public.emails
  add constraint emails_category_check
  check (category in ('urgent', 'primary', 'promotions', 'junk', 'sent'));
