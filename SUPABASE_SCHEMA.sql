-- Supabase schema for:
--   - feedback
--   - chat_sessions
--   - chat_messages
--
-- Notes:
-- - Uses UUID primary keys via `gen_random_uuid()` (pgcrypto).
-- - Enables RLS but does not create any policies. Service role bypasses RLS.

begin;

create extension if not exists pgcrypto;

-- 1) Feedback (留言)
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  name text,
  email text,
  message text not null,

  page_path text,
  user_agent text,
  ip inet
);

create index if not exists feedback_created_at_idx
  on public.feedback (created_at desc);

alter table public.feedback enable row level security;

-- 2) Chat sessions (会话)
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Optional: link to Supabase auth user (nullable for anonymous sessions).
  user_id uuid references auth.users (id) on delete set null,

  title text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists chat_sessions_created_at_idx
  on public.chat_sessions (created_at desc);

create index if not exists chat_sessions_user_id_created_at_idx
  on public.chat_sessions (user_id, created_at desc);

alter table public.chat_sessions enable row level security;

-- 3) Chat messages (消息)
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  session_id uuid not null references public.chat_sessions (id) on delete cascade,

  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content text not null,

  model text,
  token_count integer,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists chat_messages_session_id_created_at_idx
  on public.chat_messages (session_id, created_at asc);

create index if not exists chat_messages_created_at_idx
  on public.chat_messages (created_at desc);

alter table public.chat_messages enable row level security;

commit;
