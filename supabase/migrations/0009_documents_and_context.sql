-- =============================================================
-- Documents (markdown extracted from email attachments / files) + their
-- vector chunks, and a unified retrieval RPC spanning emails + documents
-- for RAG answer generation.
-- =============================================================

create table public.documents (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.connected_accounts on delete cascade,
  source      text not null,                       -- 'email_attachment' | 'onedrive'
  email_id    uuid references public.emails on delete cascade,
  name        text not null,
  mime_type   text,
  markdown    text,                                -- null until converted
  status      text not null default 'pending',     -- pending|converted|failed|skipped
  error       text,
  created_at  timestamptz not null default now(),

  constraint documents_source_check check (source in ('email_attachment', 'onedrive'))
);

create unique index documents_email_name_uidx
  on public.documents (email_id, name) where email_id is not null;
create index documents_account_idx on public.documents (account_id);
create index documents_status_idx on public.documents (status);

create table public.document_chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents on delete cascade,
  account_id   uuid not null references public.connected_accounts on delete cascade,
  chunk_index  int  not null,
  content      text not null,
  embedding    extensions.vector(384),
  created_at   timestamptz not null default now(),

  constraint document_chunks_doc_chunk_unique unique (document_id, chunk_index)
);

create index document_chunks_account_idx on public.document_chunks (account_id);
create index document_chunks_embedding_idx
  on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);

alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;

create policy "documents: own accounts only"
  on public.documents for select
  using (account_id in (select id from public.connected_accounts where user_id = auth.uid()));

create policy "document_chunks: own accounts only"
  on public.document_chunks for select
  using (account_id in (select id from public.connected_accounts where user_id = auth.uid()));

-- Unified chunk-level retrieval across emails + documents (content included,
-- for feeding an LLM). SECURITY INVOKER so RLS scopes to the caller.
create or replace function public.match_context(
  query_embedding extensions.vector(384),
  match_count int default 12
)
returns table (
  kind        text,
  source_id   uuid,
  title       text,
  content     text,
  similarity  double precision
)
language sql
stable
set search_path = public, extensions
as $$
  (
    select 'email'::text, e.id, e.subject, c.content,
           1 - (c.embedding <=> query_embedding)
    from public.email_chunks c
    join public.emails e on e.id = c.email_id
  )
  union all
  (
    select 'document'::text, d.id, d.name, c.content,
           1 - (c.embedding <=> query_embedding)
    from public.document_chunks c
    join public.documents d on d.id = c.document_id
  )
  order by 5 desc   -- similarity (5th column); alias not referenceable across UNION
  limit match_count;
$$;
