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

-- 4) Guestbook (互动留言板)
-- 说明：
-- - 该模块用于 /feedback 页面（点赞/点踩/评论/删除）。
-- - 通过 Next.js Route Handler 使用 service role 写库（不在前端直连）。
-- - 这里开启 RLS，但不附带策略；service role 会绕过 RLS。

begin;

-- --------------------------
-- guestbook_entries
-- --------------------------
create table if not exists public.guestbook_entries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,

  -- 身份：前端本地生成并持久化的 visitor key
  visitor_id text not null,

  -- 兼容你现有 API 的 mine 判断（GET 用 author_key === visitorKey）
  author_key text not null,
  author_name text null,

  content text not null,
  content_type text not null default 'plain',

  -- 评论：parent_id 指向被评论的留言（根留言为 null）
  parent_id uuid null references public.guestbook_entries (id) on delete cascade
);

-- 兼容补齐（防止旧库缺列）
alter table public.guestbook_entries add column if not exists updated_at timestamptz not null default now();
alter table public.guestbook_entries add column if not exists deleted_at timestamptz;
alter table public.guestbook_entries add column if not exists visitor_id text;
alter table public.guestbook_entries add column if not exists author_key text;
alter table public.guestbook_entries add column if not exists author_name text;
alter table public.guestbook_entries add column if not exists content_type text;
alter table public.guestbook_entries add column if not exists parent_id uuid;

create index if not exists guestbook_entries_created_at_idx
  on public.guestbook_entries (created_at desc);

create index if not exists guestbook_entries_parent_id_created_at_idx
  on public.guestbook_entries (parent_id, created_at asc);

create index if not exists guestbook_entries_author_key_created_at_idx
  on public.guestbook_entries (author_key, created_at desc);

create index if not exists guestbook_entries_visitor_id_created_at_idx
  on public.guestbook_entries (visitor_id, created_at desc);

create index if not exists guestbook_entries_deleted_at_idx
  on public.guestbook_entries (deleted_at);

create index if not exists guestbook_entries_updated_at_idx
  on public.guestbook_entries (updated_at desc);

alter table public.guestbook_entries enable row level security;

-- --------------------------
-- guestbook_reactions
-- --------------------------
create table if not exists public.guestbook_reactions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  entry_id uuid not null references public.guestbook_entries (id) on delete cascade,

  -- 兼容当前代码：GET/UPSERT 走 user_key；visitor_id 用于满足 NOT NULL 与兼容历史字段
  user_key text not null,
  visitor_id text not null,

  value smallint not null check (value in (-1, 1))
);

-- 兼容补齐（防止旧库缺列）
alter table public.guestbook_reactions add column if not exists updated_at timestamptz not null default now();
alter table public.guestbook_reactions add column if not exists visitor_id text;
alter table public.guestbook_reactions add column if not exists user_key text;

-- 同一 user_key 对同一 entry 只能有一个反应（支撑 ON CONFLICT）
create unique index if not exists guestbook_reactions_entry_user_uniq
  on public.guestbook_reactions (entry_id, user_key);

create index if not exists guestbook_reactions_entry_id_idx
  on public.guestbook_reactions (entry_id);

create index if not exists guestbook_reactions_user_key_idx
  on public.guestbook_reactions (user_key);

create index if not exists guestbook_reactions_visitor_id_idx
  on public.guestbook_reactions (visitor_id);

alter table public.guestbook_reactions enable row level security;

-- --------------------------
-- functions + triggers
-- --------------------------

-- 自动更新时间（entries/reactions 都用）
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- reactions：同步 visitor_id <- user_key（避免 visitor_id NOT NULL 报错）
create or replace function public.guestbook_reactions_sync_visitor_id()
returns trigger as $$
begin
  if (new.visitor_id is null or new.visitor_id = '') and new.user_key is not null then
    new.visitor_id := new.user_key;
  end if;
  return new;
end;
$$ language plpgsql;

-- entries updated_at
drop trigger if exists trg_guestbook_entries_updated_at on public.guestbook_entries;
create trigger trg_guestbook_entries_updated_at
before insert or update on public.guestbook_entries
for each row execute function public.set_updated_at();

-- reactions updated_at（你“点赞后点踩 new.updated_at 报错”的根因就在这里）
drop trigger if exists trg_guestbook_reactions_updated_at on public.guestbook_reactions;
create trigger trg_guestbook_reactions_updated_at
before insert or update on public.guestbook_reactions
for each row execute function public.set_updated_at();

-- reactions sync visitor_id
drop trigger if exists trg_guestbook_reactions_sync_visitor_id on public.guestbook_reactions;
create trigger trg_guestbook_reactions_sync_visitor_id
before insert or update on public.guestbook_reactions
for each row execute function public.guestbook_reactions_sync_visitor_id();

commit;