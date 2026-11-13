-- ═══════════════════════════════════════════════════════════════════════════
--  GREENR — ESP32-C3 SENSOR SUPPORT — 2026-11-12
--  Supabase → SQL Editor → New query → paste all → Run.   Safe to re-run.
--
--  Run AFTER supabase/migrations/20261112000000_platform.sql.
--  Run BEFORE flashing firmware/greenr_sensor_c3 — that firmware uploads
--  through ingest_v2, which this file creates.
--
--  Adds, without removing anything:
--    1  readings: lux (BH1750), battery_mv, rssi_dbm
--    2  devices:  firmware_version, battery_mv, rssi_dbm
--    3  battery_pct_from_mv()   one place where volts become a percentage
--    4  reading_quality_v2()    flags that use the sensor's OWN scale
--    5  ingest_v2()             one request per wake, carrying any backlog
--    6  reading_daily: lux and battery columns, trigger + rebuild updated,
--       and v_reading_daily_v2 with the daily means
--
--    7  model_versions: s3 and l3
--
--  The older ingest_reading() stays, unchanged, for sensors on older firmware.
-- ═══════════════════════════════════════════════════════════════════════════

do $guard$
begin
  if to_regclass('public.reading_daily') is null or to_regclass('public.sensor_calibrations') is null then
    raise exception 'Run supabase/migrations/20261112000000_platform.sql first.';
  end if;
end
$guard$;


-- ───────────────────────────────────────────────────────────────────────────
--  1–2. NEW COLUMNS
-- ───────────────────────────────────────────────────────────────────────────
alter table public.readings add column if not exists lux        numeric;
alter table public.readings add column if not exists battery_mv int;
alter table public.readings add column if not exists rssi_dbm   smallint;

comment on column public.readings.lux        is 'Measured. Illuminance in lux from a BH1750 (C3 firmware). Null for LDR sensors, whose light is in light_raw.';
comment on column public.readings.battery_mv is 'Measured. Battery voltage in millivolts at the cell, via the board''s divider. Null when running from USB.';
comment on column public.readings.rssi_dbm   is 'Measured. Wi-Fi signal strength at upload, dBm. For diagnosing dropouts.';

alter table public.devices add column if not exists firmware_version text;
alter table public.devices add column if not exists battery_mv       int;
alter table public.devices add column if not exists rssi_dbm         smallint;

comment on column public.devices.firmware_version is 'Reported by the sensor on every upload, e.g. c3-1.0.';


-- ───────────────────────────────────────────────────────────────────────────
--  3. BATTERY: MILLIVOLTS → PERCENT
-- ───────────────────────────────────────────────────────────────────────────
--  One single-cell lithium battery (3.7 V nominal, 4.2 V full), resting voltage.
--  Piecewise-linear through the typical discharge curve; percent is of the
--  USABLE charge for this board, so 0 % is 3.40 V — below that the regulator can
--  no longer hold 3.3 V during a Wi-Fi transmission and the sensor browns out.
--  The curve lives here, not in the firmware, so it can be corrected without
--  reflashing anything.
create or replace function public.battery_pct_from_mv(p_mv numeric)
returns int
language sql immutable
set search_path = ''
as $$
  select case
    when p_mv is null or p_mv < 2500 or p_mv > 4500 then null   -- no battery / not a lithium cell
    else greatest(0, least(100, round(
      case
        when p_mv >= 4200 then 100
        when p_mv >= 4100 then  90 + (p_mv - 4100) * 10 / 100.0
        when p_mv >= 4000 then  80 + (p_mv - 4000) * 10 / 100.0
        when p_mv >= 3900 then  65 + (p_mv - 3900) * 15 / 100.0
        when p_mv >= 3800 then  50 + (p_mv - 3800) * 15 / 100.0
        when p_mv >= 3700 then  30 + (p_mv - 3700) * 20 / 100.0
        when p_mv >= 3600 then  12 + (p_mv - 3600) * 18 / 100.0
        when p_mv >= 3500 then   5 + (p_mv - 3500) *  7 / 100.0
        when p_mv >= 3400 then   0 + (p_mv - 3400) *  5 / 100.0
        else 0
      end)))::int
  end;
$$;


-- ───────────────────────────────────────────────────────────────────────────
--  4. QUALITY FLAGS ON THE SENSOR'S OWN SCALE
-- ───────────────────────────────────────────────────────────────────────────
--  Same bits as reading_quality(). The difference is bit 4, "probe not in soil":
--  the older function compares against fixed ESP32 dev-kit numbers, which are
--  wrong for an ESP32-C3 (its converter reads the same voltage as a different
--  count). Here bit 4 is set only when this device has its own air/water
--  endpoints on file, and the count is above its own "in air" value.
create or replace function public.reading_quality_v2(
  p_device uuid, p_soil numeric, p_lux numeric, p_temp numeric, p_humidity numeric
) returns smallint
language sql stable
security definer
set search_path = ''
as $$
  select (
      case when p_soil is not null and (p_soil < 0 or p_soil > 4095)  then 1 else 0 end
    + case when p_soil is not null and p_soil >= 0 and p_soil < 200   then 2 else 0 end
    + case when p_soil is not null and p_soil >= coalesce((
        select (c.params->>'dryAdc')::numeric + 100
          from public.sensor_calibrations c
         where c.device_id = p_device and c.metric = 'moisture' and c.kind = 'endpoints' and c.valid_to is null
      ), 1e9) and p_soil <= 4095                                      then 4 else 0 end
    -- BH1750 pinned at full scale: 65535 counts at the shortest integration
    -- time (MTreg 31) is 65535 / 1.2 × 69/31 ≈ 121 557 lux
    + case when p_lux is not null and p_lux >= 121000                then 8 else 0 end
    + case when p_temp is not null and (p_temp < -40 or p_temp > 85) then 16 else 0 end
    + case when p_humidity is not null and (p_humidity < 0 or p_humidity > 100) then 32 else 0 end
  )::smallint;
$$;
revoke all on function public.reading_quality_v2(uuid, numeric, numeric, numeric, numeric) from public, anon, authenticated;


-- ───────────────────────────────────────────────────────────────────────────
--  5. INGEST_V2 — what the ESP32-C3 firmware calls
-- ───────────────────────────────────────────────────────────────────────────
--  One POST per wake. p_rows carries the reading just taken plus any that could
--  not be uploaded on earlier wakes (the sensor keeps them in its RTC memory):
--
--    {"p_device":"…","p_secret":"…","p_fw":"c3-1.0","p_rssi":-61,
--     "p_rows":[{"ago":0,"soil":2311,"lux":845.2,"t":21.4,"h":54.0,"bat":3987}, …]}
--
--    ago   seconds since the reading was taken (the sensor's clock keeps running
--          in deep sleep, accurate to a few percent)
--    soil  raw ADC count 0–4095      lux  BH1750 illuminance
--    t     °C                        h    % relative humidity
--    bat   battery millivolts, omitted or null on USB power
--
--  Idempotent: a reading already stored within ±30 s with the same soil count
--  and lux is skipped, so a retry after a lost response does not duplicate it.
--  Returns {read_now, wake_seconds, inserted, skipped}, the first two in the same
--  shape the older firmware parses.
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
  v_at timestamptz; v_soil numeric; v_lux numeric; v_t numeric; v_h numeric; v_bat numeric;
  v_latest_bat numeric; v_latest_at timestamptz;
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

    if exists (
      select 1 from public.readings x
       where x.device_id = p_device
         and x.created_at between v_at - interval '30 seconds' and v_at + interval '30 seconds'
         and x.soil_raw is not distinct from (case when v_soil > 100 and v_soil <= 4095 then v_soil::int end)
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
      case when v_soil > 100 and v_soil <= 4095 then v_soil::int end,
      v_lux, v_t, v_h,
      v_bat::int, public.battery_pct_from_mv(v_bat),
      case when (r->>'ago')::numeric = 0 then p_rssi end,              -- signal belongs to this upload only
      v_plant,
      public.reading_quality_v2(p_device, v_soil, v_lux, v_t, v_h));
    v_n := v_n + 1;

    if v_bat is not null and (v_latest_at is null or v_at > v_latest_at) then
      v_latest_bat := v_bat; v_latest_at := v_at;
    end if;
  end loop;

  update public.devices
     set read_now = false,
         last_seen = now(),
         firmware_version = coalesce(left(p_fw, 32), firmware_version),
         rssi_dbm = coalesce(p_rssi, rssi_dbm),
         battery_mv = coalesce(v_latest_bat::int, battery_mv),
         battery_pct = coalesce(public.battery_pct_from_mv(v_latest_bat), battery_pct)
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


-- ───────────────────────────────────────────────────────────────────────────
--  6. DAILY SUMMARY: LUX AND BATTERY
-- ───────────────────────────────────────────────────────────────────────────
alter table public.reading_daily add column if not exists lux_n      int not null default 0;
alter table public.reading_daily add column if not exists lux_sum    numeric not null default 0;
alter table public.reading_daily add column if not exists lux_max    numeric;
alter table public.reading_daily add column if not exists bat_mv_min int;

-- Same function as in the platform migration, with the four columns added.
create or replace function public.reading_daily_apply()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (new.created_at at time zone 'UTC')::date;
  v_soil_ok  boolean := new.soil_raw  is not null and (new.quality & 7)  = 0;
  v_light_ok boolean := new.light_raw is not null and (new.quality & 8)  = 0;
  v_lux_ok   boolean := new.lux       is not null and (new.quality & 8)  = 0;
  v_temp_ok  boolean := new.temp_c    is not null and (new.quality & 16) = 0;
  v_rh_ok    boolean := new.humidity_pct is not null and (new.quality & 32) = 0;
  v_vpd numeric := case when v_temp_ok and v_rh_ok then public.vpd_kpa(new.temp_c, new.humidity_pct) end;
begin
  insert into public.reading_daily as d (
    device_id, day, plant_key, n, first_at, last_at,
    soil_n, soil_raw_sum, soil_raw_min, soil_raw_max, soil_raw_first, soil_raw_last,
    light_n, light_raw_sum, light_raw_min, light_raw_max, light_railed,
    temp_n, temp_sum, temp_min, temp_max,
    rh_n, rh_sum, rh_min, rh_max, vpd_n, vpd_sum,
    lux_n, lux_sum, lux_max, bat_mv_min)
  values (
    new.device_id, v_day, new.plant_key, 1, new.created_at, new.created_at,
    case when v_soil_ok then 1 else 0 end, case when v_soil_ok then new.soil_raw else 0 end,
    case when v_soil_ok then new.soil_raw end, case when v_soil_ok then new.soil_raw end,
    case when v_soil_ok then new.soil_raw end, case when v_soil_ok then new.soil_raw end,
    case when v_light_ok then 1 else 0 end, case when v_light_ok then new.light_raw else 0 end,
    case when v_light_ok then new.light_raw end, case when v_light_ok then new.light_raw end,
    case when (new.light_raw is not null or new.lux is not null) and (new.quality & 8) <> 0 then 1 else 0 end,
    case when v_temp_ok then 1 else 0 end, case when v_temp_ok then new.temp_c else 0 end,
    case when v_temp_ok then new.temp_c end, case when v_temp_ok then new.temp_c end,
    case when v_rh_ok then 1 else 0 end, case when v_rh_ok then new.humidity_pct else 0 end,
    case when v_rh_ok then new.humidity_pct end, case when v_rh_ok then new.humidity_pct end,
    case when v_vpd is not null then 1 else 0 end, coalesce(v_vpd, 0),
    case when v_lux_ok then 1 else 0 end, case when v_lux_ok then new.lux else 0 end,
    case when v_lux_ok then new.lux end,
    new.battery_mv)
  on conflict (device_id, day) do update set
    n = d.n + 1,
    plant_key = case when excluded.last_at >= d.last_at then coalesce(excluded.plant_key, d.plant_key) else d.plant_key end,
    soil_raw_first = case when excluded.soil_n = 1 and (d.soil_raw_first is null or excluded.first_at < d.first_at) then excluded.soil_raw_first else d.soil_raw_first end,
    soil_raw_last  = case when excluded.soil_n = 1 and (d.soil_raw_last  is null or excluded.last_at >= d.last_at) then excluded.soil_raw_last  else d.soil_raw_last  end,
    first_at = least(d.first_at, excluded.first_at),
    last_at  = greatest(d.last_at, excluded.last_at),
    soil_n = d.soil_n + excluded.soil_n,
    soil_raw_sum = d.soil_raw_sum + excluded.soil_raw_sum,
    soil_raw_min = least(d.soil_raw_min, excluded.soil_raw_min),
    soil_raw_max = greatest(d.soil_raw_max, excluded.soil_raw_max),
    light_n = d.light_n + excluded.light_n,
    light_raw_sum = d.light_raw_sum + excluded.light_raw_sum,
    light_raw_min = least(d.light_raw_min, excluded.light_raw_min),
    light_raw_max = greatest(d.light_raw_max, excluded.light_raw_max),
    light_railed = d.light_railed + excluded.light_railed,
    temp_n = d.temp_n + excluded.temp_n,
    temp_sum = d.temp_sum + excluded.temp_sum,
    temp_min = least(d.temp_min, excluded.temp_min),
    temp_max = greatest(d.temp_max, excluded.temp_max),
    rh_n = d.rh_n + excluded.rh_n,
    rh_sum = d.rh_sum + excluded.rh_sum,
    rh_min = least(d.rh_min, excluded.rh_min),
    rh_max = greatest(d.rh_max, excluded.rh_max),
    vpd_n = d.vpd_n + excluded.vpd_n,
    vpd_sum = d.vpd_sum + excluded.vpd_sum,
    lux_n = d.lux_n + excluded.lux_n,
    lux_sum = d.lux_sum + excluded.lux_sum,
    lux_max = greatest(d.lux_max, excluded.lux_max),
    bat_mv_min = least(d.bat_mv_min, excluded.bat_mv_min);
  return null;
end; $$;

create or replace function public.reading_daily_fill(p_device uuid default null, p_day date default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_rows bigint;
begin
  delete from public.reading_daily d
   where (p_device is null or d.device_id = p_device)
     and (p_day is null or d.day = p_day);
  insert into public.reading_daily (
    device_id, day, plant_key, n, first_at, last_at,
    soil_n, soil_raw_sum, soil_raw_min, soil_raw_max, soil_raw_first, soil_raw_last,
    light_n, light_raw_sum, light_raw_min, light_raw_max, light_railed,
    temp_n, temp_sum, temp_min, temp_max, rh_n, rh_sum, rh_min, rh_max, vpd_n, vpd_sum,
    lux_n, lux_sum, lux_max, bat_mv_min)
  select
    r.device_id,
    (r.created_at at time zone 'UTC')::date,
    (array_agg(r.plant_key order by r.created_at desc))[1],
    count(*)::int, min(r.created_at), max(r.created_at),
    count(*) filter (where r.soil_raw is not null and (r.quality & 7) = 0)::int,
    coalesce(sum(r.soil_raw) filter (where (r.quality & 7) = 0), 0),
    min(r.soil_raw) filter (where (r.quality & 7) = 0),
    max(r.soil_raw) filter (where (r.quality & 7) = 0),
    (array_agg(r.soil_raw order by r.created_at asc)  filter (where r.soil_raw is not null and (r.quality & 7) = 0))[1],
    (array_agg(r.soil_raw order by r.created_at desc) filter (where r.soil_raw is not null and (r.quality & 7) = 0))[1],
    count(*) filter (where r.light_raw is not null and (r.quality & 8) = 0)::int,
    coalesce(sum(r.light_raw) filter (where (r.quality & 8) = 0), 0),
    min(r.light_raw) filter (where (r.quality & 8) = 0),
    max(r.light_raw) filter (where (r.quality & 8) = 0),
    count(*) filter (where (r.light_raw is not null or r.lux is not null) and (r.quality & 8) <> 0)::int,
    count(*) filter (where r.temp_c is not null and (r.quality & 16) = 0)::int,
    coalesce(sum(r.temp_c) filter (where (r.quality & 16) = 0), 0),
    min(r.temp_c) filter (where (r.quality & 16) = 0),
    max(r.temp_c) filter (where (r.quality & 16) = 0),
    count(*) filter (where r.humidity_pct is not null and (r.quality & 32) = 0)::int,
    coalesce(sum(r.humidity_pct) filter (where (r.quality & 32) = 0), 0),
    min(r.humidity_pct) filter (where (r.quality & 32) = 0),
    max(r.humidity_pct) filter (where (r.quality & 32) = 0),
    count(*) filter (where r.temp_c is not null and r.humidity_pct is not null and (r.quality & 48) = 0)::int,
    coalesce(sum(public.vpd_kpa(r.temp_c, r.humidity_pct)) filter (where r.temp_c is not null and r.humidity_pct is not null and (r.quality & 48) = 0), 0),
    count(*) filter (where r.lux is not null and (r.quality & 8) = 0)::int,
    coalesce(sum(r.lux) filter (where r.lux is not null and (r.quality & 8) = 0), 0),
    max(r.lux) filter (where (r.quality & 8) = 0),
    min(r.battery_mv)
  from public.readings r
  where (p_device is null or r.device_id = p_device)
    and (p_day is null or (r.created_at at time zone 'UTC')::date = p_day)
    and exists (select 1 from public.devices dv where dv.id = r.device_id)
  group by r.device_id, (r.created_at at time zone 'UTC')::date;
  get diagnostics v_rows = row_count;
  return v_rows;
end; $$;
revoke all on function public.reading_daily_fill(uuid, date) from public, anon, authenticated;

select public.rebuild_reading_daily();

-- v_reading_daily (platform migration) is left exactly as that file defines it,
-- and the full set of daily means is published under a new name. Extending the
-- old view here would make the platform file fail if it were ever re-run after
-- this one (Postgres cannot drop a view's columns), and every file in the
-- install order must stay safe to re-run. Read this view for charts.
create or replace view public.v_reading_daily_v2 with (security_invoker = on) as
select
  d.device_id, d.day, d.plant_key, d.n,
  case when d.soil_n  > 0 then round(d.soil_raw_sum::numeric  / d.soil_n, 1)  end as soil_raw_mean,
  d.soil_raw_min, d.soil_raw_max, d.soil_raw_first, d.soil_raw_last,
  case when d.light_n > 0 then round(d.light_raw_sum::numeric / d.light_n, 1) end as light_raw_mean,
  d.light_raw_min, d.light_raw_max, d.light_railed,
  case when d.temp_n > 0 then round(d.temp_sum / d.temp_n, 2) end as temp_mean, d.temp_min, d.temp_max,
  case when d.rh_n   > 0 then round(d.rh_sum   / d.rh_n, 1)   end as rh_mean,   d.rh_min,   d.rh_max,
  case when d.vpd_n  > 0 then round(d.vpd_sum  / d.vpd_n, 3)  end as vpd_mean_kpa,
  case when d.lux_n  > 0 then round(d.lux_sum  / d.lux_n, 1)  end as lux_mean,
  d.lux_max,
  d.bat_mv_min
from public.reading_daily d;
comment on view public.v_reading_daily_v2 is
  'Derived. Daily means per device including lux (BH1750) and the day''s lowest battery voltage. Supersedes v_reading_daily.';
grant select on public.v_reading_daily_v2 to authenticated;


-- ───────────────────────────────────────────────────────────────────────────
--  7. MODEL VERSIONS (mirrors lib/modelVersion.ts)
-- ───────────────────────────────────────────────────────────────────────────
insert into public.model_versions (component, version, description) values
  ('sensing', 's3', 'BH1750 lux read directly; "probe not in soil" judged only against the sensor''s own air/water counts.'),
  ('light',   'l3', 'Daily-light band narrows to a factor of 1.3 when the sensor reports lux (BH1750); 2.0 for an LDR.')
on conflict (component, version) do nothing;
