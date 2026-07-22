-- Sensor idle cadence = 3 hours. Run once in Supabase → SQL Editor → Run.
-- Safe to re-run (matches the current 9-arg ingest_reading; also cleans up the
-- old 8-arg version, which — if left alongside — makes every upload fail with
-- an "ambiguous function" error).
--
-- The sensor wakes, reads, uploads, and asks the server for its next sleep, then
-- deep-sleeps. This sets that answer to 3 h (battery-friendly). There is no live
-- streaming — the app just shows whatever the sensor last reported.

-- 3 h (10800 s) between reports; normalise any existing devices to it.
alter table public.devices alter column wake_seconds set default 10800;
update public.devices set wake_seconds = 10800 where wake_seconds is distinct from 10800;

-- Drop the legacy 8-arg signature so only one ingest_reading exists.
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
  select read_now, wake_seconds into v_read_now, v_wake
  from public.devices where id = p_device and secret = p_secret;
  if not found then raise exception 'bad device or secret'; end if;

  insert into public.readings
    (device_id, light_lux, dli, soil_pct, temp_c, humidity_pct, battery_pct, created_at)
  values
    (p_device, p_light, p_dli, p_soil, p_temp, p_humidity,
     nullif(p_battery, -1),
     now() - make_interval(secs => greatest(p_secs_ago, 0)));

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
