-- Greenr hybrid sync — backend support for the phone-as-BLE-gateway path.
-- Run once in Supabase → SQL Editor → Run. Safe to re-run (idempotent).
--
-- Two upload paths now exist:
--   • WiFi (device → cloud):  the sensor posts directly, authenticating with its
--     own device secret via ingest_reading (unchanged, plus p_secs_ago so a
--     buffered reading keeps its real capture time).
--   • BLE (device → phone → cloud):  when someone is home, their phone collects
--     the sensor's buffered readings over Bluetooth and uploads them here with
--     ingest_batch. The phone authenticates as the signed-in USER who OWNS the
--     device (devices.user_id = auth.uid()) — the device secret never travels
--     over BLE, which the security review flagged as important.

-- ── 1. ingest_reading: add p_secs_ago so buffered WiFi uploads keep real times ──
-- (created_at = now() − secs_ago; existing callers omit it → 0 → now, unchanged.)
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

-- ── 2. ingest_batch: the phone uploads a batch on behalf of a device it owns ──
-- p_rows is a JSON array of:
--   { "at": ISO-timestamp, "light_lux": n, "dli": n, "soil_pct": n,
--     "temp_c": n, "humidity_pct": n, "battery_pct": n }   (any field may be null)
create or replace function public.ingest_batch(
  p_device uuid,
  p_rows jsonb
) returns json
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_n int := 0; r jsonb;
begin
  -- Authorize: the caller must be the signed-in owner of this device.
  select user_id into v_owner from public.devices where id = p_device;
  if v_owner is null then raise exception 'unknown device'; end if;
  if v_owner is distinct from auth.uid() then raise exception 'not your device'; end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into public.readings
      (device_id, light_lux, dli, soil_pct, temp_c, humidity_pct, battery_pct, created_at)
    values (
      p_device,
      nullif(r->>'light_lux','')::numeric,
      nullif(r->>'dli','')::numeric,
      nullif(r->>'soil_pct','')::numeric,
      nullif(r->>'temp_c','')::numeric,
      nullif(r->>'humidity_pct','')::numeric,
      nullif(r->>'battery_pct','')::int,
      coalesce((r->>'at')::timestamptz, now())
    );
    v_n := v_n + 1;
  end loop;

  if v_n > 0 then
    update public.devices set last_seen = now() where id = p_device;
  end if;

  return json_build_object('inserted', v_n);
end; $$;

-- Authenticated users may call the batch RPC (ownership is enforced inside it).
grant execute on function public.ingest_batch(uuid, jsonb) to authenticated;
