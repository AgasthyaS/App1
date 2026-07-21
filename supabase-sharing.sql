-- Greenr household sharing — invite family members to a shared garden.
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- SCOPE: this creates the invite layer (who is allowed to share with whom) and
-- opens read access to the OWNER's devices + readings for accepted members.
-- Plants/spots currently sync per-account through the app's own cloud store;
-- surfacing the owner's plants inside a member's app is the remaining app-side
-- step. So today a member gains read access to the shared sensor DATA; the full
-- in-app "switch to their garden" view is the documented next increment.

create table if not exists public.garden_shares (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users on delete cascade,
  member_email text not null,
  member_id uuid references auth.users on delete set null,  -- filled when they accept
  role text not null default 'viewer',                      -- viewer | caretaker
  created_at timestamptz not null default now(),
  unique (owner_id, member_email)
);
alter table public.garden_shares enable row level security;

-- Owners manage their own invites.
drop policy if exists "owner manages shares" on public.garden_shares;
create policy "owner manages shares" on public.garden_shares
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Members can see rows that are about them (so their app can list shared gardens).
drop policy if exists "member sees own shares" on public.garden_shares;
create policy "member sees own shares" on public.garden_shares
  for select using (member_id = auth.uid());

-- Owner invites a member by email.
create or replace function public.invite_member(p_email text, p_role text default 'viewer')
returns json language plpgsql security definer set search_path = '' as $$
declare v_member uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select id into v_member from auth.users where lower(email) = lower(p_email);  -- may be null (not signed up yet)
  insert into public.garden_shares (owner_id, member_email, member_id, role)
  values (auth.uid(), lower(p_email), v_member, p_role)
  on conflict (owner_id, member_email) do update set role = excluded.role;
  return json_build_object('ok', true, 'member_exists', v_member is not null);
end; $$;
grant execute on function public.invite_member(text, text) to authenticated;

-- Extend device + reading visibility to accepted members of the owner.
drop policy if exists "shared members read devices" on public.devices;
create policy "shared members read devices" on public.devices
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.garden_shares s
               where s.owner_id = public.devices.user_id and s.member_id = auth.uid())
  );

drop policy if exists "shared members read readings" on public.readings;
create policy "shared members read readings" on public.readings
  for select using (
    exists (select 1 from public.devices d
            where d.id = readings.device_id
              and (d.user_id = auth.uid()
                   or exists (select 1 from public.garden_shares s
                              where s.owner_id = d.user_id and s.member_id = auth.uid())))
  );
