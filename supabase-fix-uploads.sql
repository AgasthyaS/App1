-- ============================================================================
--  greenr — one-shot "make uploads work" script
--  Supabase → SQL Editor → New query → paste ALL of this → Run.
--  Safe to re-run: it never drops your data, only fixes the function + cadence.
-- ============================================================================

-- 1. Tables (created only if missing — existing data is left untouched) --------
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  secret text not null,
  label text,
  plant_key text,
  read_now boolean not null default false,
  wake_seconds int not null default 10800,
  battery_pct int,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);
alter table public.devices enable row level security;
drop policy if exists "own devices" on public.devices;
create policy "own devices" on public.devices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.readings (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.devices on delete cascade,
  light_lux numeric,
  dli numeric,
  soil_pct numeric,
  temp_c numeric,
  humidity_pct numeric,
  battery_pct int,
  created_at timestamptz not null default now()
);
alter table public.readings enable row level security;
drop policy if exists "own readings" on public.readings;
create policy "own readings" on public.readings
  for select using (
    exists (select 1 from public.devices d
            where d.id = readings.device_id and d.user_id = auth.uid())
  );
create index if not exists readings_device_time on public.readings (device_id, created_at desc);

-- 2. Cadence: sensor sleeps 3 h between reports -------------------------------
alter table public.devices alter column wake_seconds set default 10800;
update public.devices set wake_seconds = 10800 where wake_seconds is distinct from 10800;

-- 3. The upload function the firmware calls ----------------------------------
-- The v4 firmware sends 9 fields (…, p_secs_ago). Drop the old 8-arg version so
-- only one signature exists, then (re)create the correct one.
drop function if exists public.ingest_reading(uuid, text, numeric, numeric, numeric, numeric, numeric, int);

create or replace function public.ingest_reading(
  p_device uuid, p_secret text,
  p_light numeric default null, p_dli numeric default null,
  p_soil numeric default null, p_temp numeric default null,
  p_humidity numeric default null, p_battery int default null,
  p_secs_ago int default 0
) returns json
language plpgsql security definer set search_path = '' as $$
declare v_read_now boolean; v_wake int;
begin
  -- Authenticate by the per-device secret (the sensor uses the public anon key).
  select read_now, wake_seconds into v_read_now, v_wake
  from public.devices where id = p_device and secret = p_secret;
  if not found then raise exception 'bad device or secret'; end if;

  insert into public.readings
    (device_id, light_lux, dli, soil_pct, temp_c, humidity_pct, battery_pct, created_at)
  values
    (p_device, p_light, p_dli, p_soil, p_temp, p_humidity,
     nullif(p_battery, -1),                                   -- -1 = "not measured" → null
     now() - make_interval(secs => greatest(p_secs_ago, 0))); -- keep the real capture time

  update public.devices
    set read_now = false,
        battery_pct = coalesce(nullif(p_battery, -1), battery_pct),
        last_seen = now()
    where id = p_device;

  return json_build_object(
    'read_now', coalesce(v_read_now, false),
    'wake_seconds', coalesce(v_wake, 10800)
  );
end; $$;

-- The sensor calls this with the anon key, so anon must be able to execute it.
revoke all on function public.ingest_reading(uuid,text,numeric,numeric,numeric,numeric,numeric,int,int) from public;
grant execute on function public.ingest_reading(uuid,text,numeric,numeric,numeric,numeric,numeric,int,int) to anon, authenticated;

-- 4. Pairing function (used when you scan the QR in the app) ------------------
-- Claim-only: the device must already exist (provisioned / inserted) and the
-- scanned secret must match. DROP BOTH older signatures first so exactly ONE
-- register_device remains — two that can both take (uuid, text) make the app's
-- call fail with "could not choose the best candidate function".
drop function if exists public.register_device(uuid, text, text);
drop function if exists public.register_device(uuid, text);
alter table public.devices alter column user_id drop not null;   -- a device exists before anyone claims it

create or replace function public.register_device(p_device uuid, p_secret text)
returns json language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_key text;
begin
  if auth.uid() is null then raise exception 'must be signed in'; end if;
  select user_id, secret into v_owner, v_key from public.devices where id = p_device;
  if v_key is null then raise exception 'unknown device - not provisioned';
  elsif v_key <> p_secret then raise exception 'bad device code';
  elsif v_owner is not null and v_owner <> auth.uid() then raise exception 'device already registered to another account';
  end if;
  update public.devices set user_id = auth.uid() where id = p_device;
  return json_build_object('ok', true);
end; $$;
revoke all on function public.register_device(uuid, text) from public, anon;
grant execute on function public.register_device(uuid, text) to authenticated;
