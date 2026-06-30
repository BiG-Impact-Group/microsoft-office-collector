-- =============================================================
-- OneDrive support: dedupe documents by the provider's item id.
-- Email attachments dedupe on (email_id, name); OneDrive files have no
-- email_id, so they dedupe on (account_id, source, external_id).
-- =============================================================

alter table public.documents
  add column if not exists external_id text;

create unique index if not exists documents_account_source_external_uidx
  on public.documents (account_id, source, external_id)
  where external_id is not null;
