-- ═══════════════════════════════════════════════════════════════════════════
--  16. READINGS ACCURACY — ingest_v2, corrected
--
--  Run after file 15. Safe to re-run. Replaces one function (same signature,
--  same grants, same reply) and registers two model versions. No table, column
--  or existing row is changed.
--
--  What changes in ingest_v2 (what the ESP32-C3 firmware calls):
--
--  1  soil_raw holds EVERY count the firmware sends, 0–4095. It used to keep only
--     counts above 100, because older firmware sent 0–100 percentages in the same
--     field. ingest_v2 is only ever called by firmware that sends raw counts, so a
--     count of 0–100 is a disconnected or unpowered probe (quality bit 2), and
--     must be stored as the raw count it is. Left out of soil_raw, the app read it
--     as an old percentage: a loose power wire showed as "0 % moisture".
--
--  2  The device's battery follows its NEWEST reading. A newest reading with no
--     battery value (USB power, or no divider fitted) now clears battery_mv and
--     battery_pct, instead of leaving the last battery figure on show forever
--     after a sensor moves from battery to USB.
--
--  Everything else — authentication, the 48-row and 30-day bounds, malformed-row
--  skipping, the ±30 s duplicate check, quality flags, the reply — is unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

do $guard$
begin
  if to_regprocedure('public.ingest_v2(uuid, text, jsonb, text, integer)') is null
     or to_regprocedure('public.reading_quality_v2(uuid, numeric, numeric, numeric, numeric)') is null then
    raise exception 'Run supabase/migrations/20261112120000_c3_sensors.sql (file 14) first.';
  end if;
end
$guard$;

create or replace function public.ingest_v2(
  p_device uuid,
  p_secret text,
  p_rows   jsonb,
  p_fw     text default null,
  p_rssi   int  default null
) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_read_now boolean; v_wake int; v_plant text;
  r jsonb; v_n int := 0; v_skipped int := 0;
  v_at timestamptz; v_soil numeric; v_raw int; v_lux numeric; v_t numeric; v_h numeric; v_bat numeric;
  v_newest_at timestamptz; v_newest_bat numeric;
begin
  select read_now, wake_seconds, plant_key into v_read_now, v_wake, v_plant
    from public.devices where id = p_device and secret = p_secret;
  if not found then raise exception 'bad device or secret'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'p_rows must be an array'; end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 48 then raise exception 'too many rows (max 48)'; end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      v_at   := now() - make_interval(secs => least(greatest(coalesce((r->>'ago')::numeric, 0), 0), 30 * 86400));
      v_soil := nullif(r->>'soil', '')::numeric;
      v_lux  := nullif(r->>'lux',  '')::numeric;
      v_t    := nullif(r->>'t',    '')::numeric;
      v_h    := nullif(r->>'h',    '')::numeric;
      v_bat  := nullif(r->>'bat',  '')::numeric;
    exception when others then
      v_skipped := v_skipped + 1;          -- one malformed row must not lose the rest
      continue;
    end;
    if v_lux is not null and v_lux < 0 then v_lux := null; end if;
    -- (1) every count a 12-bit converter can produce is a raw count here
    v_raw := case when v_soil >= 0 and v_soil <= 4095 then round(v_soil)::int end;

    -- (2) the newest reading in the upload describes the device as it is now
    if v_newest_at is null or v_at >= v_newest_at then
      v_newest_at := v_at; v_newest_bat := v_bat;
    end if;

    if exists (
      select 1 from public.readings x
       where x.device_id = p_device
         and x.created_at between v_at - interval '30 seconds' and v_at + interval '30 seconds'
         and x.soil_raw is not distinct from v_raw
         and x.lux is not distinct from v_lux
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.readings
      (device_id, created_at, soil_pct, soil_raw, lux, temp_c, humidity_pct,
       battery_mv, battery_pct, rssi_dbm, plant_key, quality)
    values (
      p_device, v_at,
      v_soil,                                                          -- legacy column, same count
      v_raw,
      v_lux, v_t, v_h,
      v_bat::int, public.battery_pct_from_mv(v_bat),
      case when (r->>'ago')::numeric = 0 then p_rssi end,              -- signal belongs to this upload only
      v_plant,
      public.reading_quality_v2(p_device, v_soil, v_lux, v_t, v_h));
    v_n := v_n + 1;
  end loop;

  update public.devices
     set read_now = false,
         last_seen = now(),
         firmware_version = coalesce(left(p_fw, 32), firmware_version),
         rssi_dbm = coalesce(p_rssi, rssi_dbm),
         battery_mv  = case when v_newest_at is null then battery_mv  else v_newest_bat::int end,
         battery_pct = case when v_newest_at is null then battery_pct else public.battery_pct_from_mv(v_newest_bat) end
   where id = p_device;

  return json_build_object(
    'read_now', coalesce(v_read_now, false),
    'wake_seconds', coalesce(v_wake, 10800),
    'inserted', v_n,
    'skipped', v_skipped
  );
end; $$;

revoke all on function public.ingest_v2(uuid, text, jsonb, text, int) from public;
grant execute on function public.ingest_v2(uuid, text, jsonb, text, int) to anon, authenticated;

comment on column public.readings.soil_raw is
  'Measured. Capacitive probe ADC count, 0–4095, exactly as sent (high = dry). From ingest_v2 every count is stored, including 0–199, which quality bit 2 marks as a disconnected probe. Null only for rows from firmware that sent an on-device percentage.';

-- ───────────────────────────────────────────────────────────────────────────
--  MODEL VERSIONS (mirrors lib/modelVersion.ts)
-- ───────────────────────────────────────────────────────────────────────────
insert into public.model_versions (component, version, description) values
  ('sensing',  's5', 'A count from the soil_raw column is always a raw count: 0–199 is a disconnected probe with no moisture value, never an old 0–100 percentage.'),
  ('decision', 'd4', 'No watering advice from an untrustworthy probe reading (out of the soil, disconnected, past the water reading); the app says to check the probe instead.')
on conflict (component, version) do nothing;
