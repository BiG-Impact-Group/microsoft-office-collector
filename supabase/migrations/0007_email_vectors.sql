-- =============================================================
-- Vector search over email content (RAG retrieval).
--
-- Emails are chunked + embedded (Supabase's built-in gte-small, 384-dim) into
-- email_chunks. match_email_chunks does cosine-similarity retrieval, returning
-- the caller's own emails ranked by their best-matching chunk. RLS scopes
-- everything to the signed-in user's connected accounts.
-- =============================================================

create extension if not exists vector with schema extensions;

create table public.email_chunks (
  id          uuid primary key default gen_random_uuid(),
  email_id    uuid not null references public.emails on delete cascade,
  account_id  uuid not null references public.connected_accounts on delete cascade,
  chunk_index int  not null,
  content     text not null,
  embedding   extensions.vector(384),
  created_at  timestamptz not null default now(),

  constraint email_chunks_email_chunk_unique unique (email_id, chunk_index)
);

create index email_chunks_account_idx on public.email_chunks (account_id);
create index email_chunks_embedding_idx
  on public.email_chunks using hnsw (embedding extensions.vector_cosine_ops);

alter table public.email_chunks enable row level security;

-- Users may only read chunks belonging to their own connected accounts.
create policy "email_chunks: own accounts only"
  on public.email_chunks
  for select
  using (
    account_id in (
      select id from public.connected_accounts where user_id = auth.uid()
    )
  );

-- Retrieval: the caller's emails ranked by best-matching chunk similarity.
-- SECURITY INVOKER (default) so RLS on email_chunks + emails applies to the
-- calling user. search_path is pinned so vector ops resolve.
create or replace function public.match_email_chunks(
  query_embedding extensions.vector(384),
  match_count int default 20
)
returns table (
  id              uuid,
  account_id      uuid,
  subject         text,
  from_address    text,
  preview         text,
  body_html       text,
  received_at     timestamptz,
  is_read         boolean,
  category        text,
  to_recipients   text[],
  cc_recipients   text[],
  similarity      double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select
    e.id, e.account_id, e.subject, e.from_address, e.preview, e.body_html,
    e.received_at, e.is_read, e.category, e.to_recipients, e.cc_recipients,
    1 - min(c.embedding <=> query_embedding) as similarity
  from public.email_chunks c
  join public.emails e on e.id = c.email_id
  group by e.id
  order by min(c.embedding <=> query_embedding) asc
  limit match_count;
$$;
