-- greenr sensor pipeline. Run once in Supabase → SQL Editor → New query → Run.
-- Creates: devices (one per ESP32), readings (telemetry), and two functions the
-- device calls with the public anon key, authenticated by a per-device secret.

-- One row per physical ESP32, owned by a user, optionally mapped to a plant.
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  secret text not null,                     -- flashed into firmware; gates writes
  label text,                               -- e.g. "Monstera sensor"
  plant_key text,                           -- which plant in the garden this maps to
  read_now boolean not null default false,  -- app sets true; device clears on wake
  wake_seconds int not null default 1800,   -- deep-sleep length between wakes (30 min)
  battery_pct int,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);
alter table public.devices enable row level security;
drop policy if exists "own devices" on public.devices;
create policy "own devices" on public.devices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Time-series telemetry from devices.
create table if not exists public.readings (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.devices on delete cascade,
  light_lux numeric,
  dli numeric,                 -- daily light integral (mol/m2/day so far today)
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

-- The ESP32 calls this to push a full reading. Authenticated by the device
-- secret, not a user login. Returns whether the app requested an immediate
-- reading and how long to sleep next.
create or replace function public.ingest_reading(
  p_device uuid, p_secret text,
  p_light numeric default null, p_dli numeric default null,
  p_soil numeric default null, p_temp numeric default null,
  p_humidity numeric default null, p_battery int default null
) returns json
language plpgsql security definer set search_path = '' as $$
declare v_read_now boolean; v_wake int;
begin
  select read_now, wake_seconds into v_read_now, v_wake
  from public.devices where id = p_device and secret = p_secret;
  if not found then raise exception 'bad device or secret'; end if;

  insert into public.readings
    (device_id, light_lux, dli, soil_pct, temp_c, humidity_pct, battery_pct)
  values (p_device, p_light, p_dli, p_soil, p_temp, p_humidity, p_battery);

  update public.devices
    set read_now = false,
        battery_pct = coalesce(p_battery, battery_pct),
        last_seen = now()
    where id = p_device;

  return json_build_object('read_now', coalesce(v_read_now, false),
                           'wake_seconds', coalesce(v_wake, 1800));
end; $$;
revoke all on function public.ingest_reading(uuid,text,numeric,numeric,numeric,numeric,numeric,int) from public;
grant execute on function public.ingest_reading(uuid,text,numeric,numeric,numeric,numeric,numeric,int) to anon, authenticated;

-- Pairing: the app calls this when you scan a device's QR code. Creates the
-- device row owned by you (or confirms it's already yours). Must be signed in.
create or replace function public.register_device(
  p_device uuid, p_secret text, p_label text default 'Sensor'
) returns json
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_found boolean := false;
begin
  if auth.uid() is null then raise exception 'must be signed in'; end if;
  select true, user_id into v_found, v_owner from public.devices where id = p_device;
  if not v_found then
    insert into public.devices (id, user_id, secret, label)
      values (p_device, auth.uid(), p_secret, coalesce(p_label, 'Sensor'));
    return json_build_object('ok', true, 'status', 'claimed');
  elsif v_owner = auth.uid() then
    return json_build_object('ok', true, 'status', 'already-yours');
  else
    raise exception 'device already registered to another account';
  end if;
end; $$;
revoke all on function public.register_device(uuid,text,text) from public, anon;
grant execute on function public.register_device(uuid,text,text) to authenticated;

-- Cheap check for the frequent daytime light-wakes: is an immediate reading
-- requested, and what's the sleep interval — without writing a full row.
create or replace function public.poll_device(p_device uuid, p_secret text)
returns json language plpgsql security definer set search_path = '' as $$
declare v_read_now boolean; v_wake int;
begin
  select read_now, wake_seconds into v_read_now, v_wake
  from public.devices where id = p_device and secret = p_secret;
  if not found then raise exception 'bad device or secret'; end if;
  return json_build_object('read_now', coalesce(v_read_now,false),
                           'wake_seconds', coalesce(v_wake,1800));
end; $$;
revoke all on function public.poll_device(uuid,text) from public;
grant execute on function public.poll_device(uuid,text) to anon, authenticated;
