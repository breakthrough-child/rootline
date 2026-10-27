-- Rootline storage. Run once in the Supabase SQL editor.
-- The app talks to these tables server-side with the service role key only.
create table if not exists public.investigations (
  id text primary key,
  created_at timestamptz not null default now(),
  data jsonb not null
);

create table if not exists public.watchlist (
  id text primary key,
  updated_at timestamptz not null default now(),
  data jsonb not null
);

create index if not exists watchlist_updated_at_idx on public.watchlist (updated_at desc);

-- No public access: Row Level Security on, and no policies for anon/authenticated roles.
alter table public.investigations enable row level security;
alter table public.watchlist enable row level security;
