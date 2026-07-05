-- greenr cloud storage — run once in Supabase → SQL Editor → New query → Run.
-- Creates one row per user holding their whole garden as JSON, locked down so a
-- user can only ever read/write their own row.

create table if not exists public.gardens (
  user_id uuid primary key references auth.users on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.gardens enable row level security;

drop policy if exists "own garden" on public.gardens;
create policy "own garden" on public.gardens
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
