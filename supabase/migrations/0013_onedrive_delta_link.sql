-- =============================================================
-- OneDrive delta sync: persist the Graph delta cursor per account.
-- poll-onedrive walks /me/drive/root/delta drive-wide and stores the
-- returned @odata.deltaLink (or an in-progress @odata.nextLink) here so
-- each run resumes incrementally instead of re-scanning. NULL = never
-- synced → start a fresh delta enumeration.
-- =============================================================

alter table public.connected_accounts
  add column if not exists onedrive_delta_link text;
