-- =============================================================
-- Email categorization.
--
-- Categories are derived in poll-microsoft from Microsoft Graph signals:
--   urgent      = importance 'high' or flagged
--   junk        = message lives in the Junk Email folder
--   promotions  = has a List-Unsubscribe header, or Focused-Inbox 'other'
--   primary     = everything else (Focused-Inbox 'focused')
-- We also store the raw signals for transparency / future re-classification.
-- =============================================================

alter table public.emails
  add column if not exists category               text
    check (category in ('urgent', 'primary', 'promotions', 'junk')),
  add column if not exists importance             text,
  add column if not exists inference_classification text;

-- Speeds up the per-category filtered list in the UI.
create index if not exists emails_account_category_idx
  on public.emails (account_id, category);
