-- greenr usage analytics — run once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run.
--
-- Stores one row per screen view / tap / action sent by lib/analytics.ts.
-- Users can insert their own events and read or delete only their own; nobody
-- can read anyone else's through the API. Cross-user totals come only from
-- analytics_summary(), which answers solely for accounts in analytics_admins.
--
-- AFTER RUNNING: make yourself an admin so the in-app Usage screen shows
-- totals across all users (replace the email):
--
--   insert into public.analytics_admins (user_id)
--   select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  -- null for signed-out installs; deleting the account cascades its events away
  user_id uuid references auth.users on delete cascade default auth.uid(),
  install_id text not null check (char_length(install_id) between 8 and 64),
  -- mirrors NAME_RE in lib/analytics.ts — slugs only, so free text can't land here
  name text not null check (name ~ '^[a-z0-9_.:/\[\]-]{1,80}$'),
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) <= 1024),
  platform text check (platform in ('ios', 'android', 'web', 'windows', 'macos')),
  app_version text check (char_length(app_version) <= 32),
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now()
);

create index if not exists analytics_events_name_time on public.analytics_events (name, occurred_at desc);
create index if not exists analytics_events_time on public.analytics_events (occurred_at desc);
create index if not exists analytics_events_user on public.analytics_events (user_id);

alter table public.analytics_events enable row level security;

drop policy if exists "insert own events" on public.analytics_events;
create policy "insert own events" on public.analytics_events
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

drop policy if exists "read own events" on public.analytics_events;
create policy "read own events" on public.analytics_events
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "delete own events" on public.analytics_events;
create policy "delete own events" on public.analytics_events
  for delete to authenticated
  using (user_id = auth.uid());

-- Who may see totals across all users. No policies: unreadable through the API,
-- edited only here in the SQL editor.
create table if not exists public.analytics_admins (
  user_id uuid primary key references auth.users on delete cascade
);
alter table public.analytics_admins enable row level security;

-- Totals per event over the last p_days, for admins only.
-- `people` counts distinct accounts, plus distinct installs for signed-out use.
create or replace function public.analytics_summary(p_days int default 30)
returns table (name text, total bigint, people bigint, last_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.analytics_admins a where a.user_id = auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select e.name,
           count(*)::bigint,
           count(distinct coalesce(e.user_id::text, e.install_id))::bigint,
           max(e.occurred_at)
      from public.analytics_events e
     where e.occurred_at >= now() - make_interval(days => greatest(1, least(p_days, 400)))
     group by e.name
     order by 2 desc;
end;
$$;

revoke all on function public.analytics_summary(int) from public, anon;
grant execute on function public.analytics_summary(int) to authenticated;

-- Retention: the Privacy Policy promises raw events are kept 13 months.
create or replace function public.analytics_purge()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.analytics_events where occurred_at < now() - interval '13 months';
$$;

revoke all on function public.analytics_purge() from public, anon, authenticated;

-- Run the purge nightly. Needs the pg_cron extension (Database → Extensions →
-- pg_cron). If you'd rather not enable it, run `select public.analytics_purge();`
-- by hand at least monthly.
--
--   select cron.schedule('analytics-purge', '15 3 * * *', 'select public.analytics_purge()');

-- Handy queries for the SQL editor:
--
--   -- how often the weekly briefing is opened, per day
--   select date_trunc('day', occurred_at) as day, count(*)
--     from analytics_events where name = 'screen:briefing'
--    group by 1 order by 1 desc;
--
--   -- top 25 taps this week
--   select name, count(*) from analytics_events
--    where name like 'tap:%' and occurred_at > now() - interval '7 days'
--    group by 1 order by 2 desc limit 25;
