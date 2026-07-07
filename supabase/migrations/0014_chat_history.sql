-- =============================================================
-- Assistant chat history: persistent, multi-turn conversations.
-- The `ask` edge function writes turns here; the client reads its own
-- conversations/messages under RLS to show past logs and the live thread.
-- =============================================================

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  sources jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_conversations_user_updated_idx
  on public.chat_conversations (user_id, updated_at desc);
create index if not exists chat_messages_conversation_idx
  on public.chat_messages (conversation_id, created_at);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

-- Owner-only access.
create policy "own conversations" on public.chat_conversations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own messages" on public.chat_messages
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
