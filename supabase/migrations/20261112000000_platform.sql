-- ═══════════════════════════════════════════════════════════════════════════
--  GREENR PLATFORM MIGRATION — 2026-11-12
--  Supabase → SQL Editor → New query → paste all → Run.   Safe to re-run.
--
--  Run AFTER the files listed in docs/DATABASE.md ("Install order"). This file
--  only ADDS: new columns, new tables, replacement function bodies with the same
--  signatures. It drops no table and no column, and rewrites no existing row
--  except to fill columns it has just created.
--
--  What it does, in order:
--    1  readings        explicit raw columns, plant context, quality flags
--    2  ingest          validation + idempotency, same RPC signatures as before
--    3  reading_daily   one row per device per day, kept current by a trigger
--    4  plants          a durable identity for every plant
--    5  plant_substrates, sensor_calibrations   versioned context
--    6  plant_observations                      what the plant itself did
--    7  recommendations, model_versions         advice, and what followed it
--    8  plant_identifications, ai_usage, ai_cache, photo storage
--    9  reference tables for the substrate library
--   10  export / delete RPCs
--   11  aggregates (gated) and admin overview
-- ═══════════════════════════════════════════════════════════════════════════

do $guard$
begin
  if to_regclass('public.readings') is null or to_regclass('public.devices') is null then
    raise exception 'Run supabase-fix-uploads.sql first — public.devices / public.readings do not exist.';
  end if;
  if to_regclass('public.profiles') is null or to_regclass('public.plant_measurements') is null then
    raise exception 'Run supabase/schema.sql first — the research tables do not exist.';
  end if;
end
$guard$;


-- ───────────────────────────────────────────────────────────────────────────
--  1. READINGS — say what the columns actually hold
-- ───────────────────────────────────────────────────────────────────────────
--  `soil_pct` and `light_lux` have held RAW ADC COUNTS since the firmware stopped
--  converting on the device. The names are kept (old app builds read them) and
--  the truth is added beside them:
--
--    soil_raw, light_raw   ADC counts 0–4095, exactly as sent. Never rewritten.
--    plant_key             which plant the sensor was on WHEN IT READ. Moving a
--                          sensor no longer re-labels its history.
--    quality               bit flags; 0 = clean. See reading_quality().
--    received_at           when the server got it (created_at is when it was taken).
alter table public.readings add column if not exists soil_raw    int;
alter table public.readings add column if not exists light_raw   int;
alter table public.readings add column if not exists plant_key   text;
alter table public.readings add column if not exists quality     smallint not null default 0;
alter table public.readings add column if not exists received_at timestamptz not null default now();

comment on column public.readings.soil_pct  is 'LEGACY NAME. Holds the raw soil ADC count for current firmware (a 0–100 value only for rows from firmware that converted on-device). Read soil_raw.';
comment on column public.readings.light_lux is 'LEGACY NAME. Holds the raw LDR ADC count, not lux. Read light_raw.';
comment on column public.readings.dli       is 'UNUSED. Firmware sends 0. Daily light is computed in the app from light_raw.';
comment on column public.readings.soil_raw  is 'Measured. Capacitive probe ADC count, 0–4095. High = dry. Converted to a 0–100 index in the app with the sensor''s own endpoints (sensor_calibrations).';
comment on column public.readings.light_raw is 'Measured. LDR divider ADC count, 0–4095. High = dark. Not lux.';
comment on column public.readings.temp_c    is 'Measured. Air temperature, degrees Celsius (AHT10).';
comment on column public.readings.humidity_pct is 'Measured. Relative humidity, percent (AHT10).';
comment on column public.readings.plant_key is 'Context. The plant this device was assigned to when the reading was taken. Rows from before 2026-11-12 were filled from the assignment current on that date.';
comment on column public.readings.quality   is 'Derived. Bit flags from reading_quality(); 0 = usable. 1 soil out of range, 2 probe disconnected, 4 probe not in soil, 8 light at a rail, 16 temperature out of range, 32 humidity out of range.';
comment on column public.readings.created_at is 'When the reading was TAKEN (UTC). For buffered uploads this is earlier than received_at.';

/*
 * Flags, not deletions. A reading that fails a check is kept — it may be a real
 * extreme, and it is evidence about the sensor either way — but every summary
 * and every aggregate below reads only quality = 0 for the metric it uses.
 */
create or replace function public.reading_quality(
  p_soil numeric, p_light numeric, p_temp numeric, p_humidity numeric
) returns smallint
language sql immutable
set search_path = ''
as $$
  select (
      case when p_soil is not null and (p_soil < 0 or p_soil > 4095)      then 1 else 0 end
    + case when p_soil is not null and p_soil > 100 and p_soil < 200     then 2 else 0 end
    + case when p_soil is not null and p_soil >= 3120 and p_soil <= 4095 then 4 else 0 end
    + case when p_light is not null and (p_light <= 120 or p_light >= 3975) then 8 else 0 end
    -- AHT10 rated range is −40…85 °C and 0…100 %RH
    + case when p_temp is not null and (p_temp < -40 or p_temp > 85)     then 16 else 0 end
    + case when p_humidity is not null and (p_humidity < 0 or p_humidity > 100) then 32 else 0 end
  )::smallint;
$$;

-- Fill the new columns for rows that predate them. Idempotent: only touches nulls.
update public.readings
   set soil_raw = soil_pct::int
 where soil_raw is null and soil_pct > 100 and soil_pct <= 4095;
update public.readings
   set light_raw = light_lux::int
 where light_raw is null and light_lux >= 0 and light_lux <= 4095;
update public.readings r
   set plant_key = d.plant_key
  from public.devices d
 where r.plant_key is null and d.id = r.device_id and d.plant_key is not null;
update public.readings
   set quality = public.reading_quality(soil_pct, light_lux, temp_c, humidity_pct)
 where quality = 0
   and public.reading_quality(soil_pct, light_lux, temp_c, humidity_pct) <> 0;

create index if not exists readings_plant_time
  on public.readings (plant_key, created_at desc) where plant_key is not null;


-- ───────────────────────────────────────────────────────────────────────────
--  2. INGEST — validated, idempotent, same signatures the firmware already calls
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.ingest_reading(
  p_device uuid, p_secret text,
  p_light numeric default null, p_dli numeric default null,
  p_soil numeric default null, p_temp numeric default null,
  p_humidity numeric default null, p_battery int default null,
  p_secs_ago int default 0
) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_read_now boolean; v_wake int; v_plant text; v_at timestamptz;
begin
  select read_now, wake_seconds, plant_key into v_read_now, v_wake, v_plant
    from public.devices where id = p_device and secret = p_secret;
  if not found then raise exception 'bad device or secret'; end if;

  -- A buffered reading may be old, but not older than the buffer can hold and
  -- never in the future.
  v_at := now() - make_interval(secs => least(greatest(coalesce(p_secs_ago, 0), 0), 30 * 86400));

  -- Idempotent: a retry of the same upload lands within seconds of the first.
  if not exists (
    select 1 from public.readings r
     where r.device_id = p_device
       and r.created_at between v_at - interval '20 seconds' and v_at + interval '20 seconds'
       and r.soil_pct is not distinct from p_soil
       and r.light_lux is not distinct from p_light
  ) then
    insert into public.readings
      (device_id, light_lux, dli, soil_pct, temp_c, humidity_pct, battery_pct, created_at,
       soil_raw, light_raw, plant_key, quality)
    values
      (p_device, p_light, p_dli, p_soil, p_temp, p_humidity,
       nullif(p_battery, -1),
       v_at,
       case when p_soil  > 100 and p_soil  <= 4095 then p_soil::int  end,
       case when p_light >= 0  and p_light <= 4095 then p_light::int end,
       v_plant,
       public.reading_quality(p_soil, p_light, p_temp, p_humidity));
  end if;

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

revoke all on function public.ingest_reading(uuid,text,numeric,numeric,numeric,numeric,numeric,int,int) from public;
grant execute on function public.ingest_reading(uuid,text,numeric,numeric,numeric,numeric,numeric,int,int) to anon, authenticated;

create or replace function public.ingest_batch(p_device uuid, p_rows jsonb)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid; v_plant text; v_n int := 0; v_skipped int := 0; r jsonb;
  v_at timestamptz; v_soil numeric; v_light numeric; v_temp numeric; v_rh numeric;
begin
  select user_id, plant_key into v_owner, v_plant from public.devices where id = p_device;
  if v_owner is null then raise exception 'unknown device'; end if;
  if v_owner is distinct from auth.uid() then raise exception 'not your device'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'rows must be an array'; end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 2000 then raise exception 'too many rows in one batch (max 2000)'; end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      v_at    := coalesce((r->>'at')::timestamptz, now());
      v_soil  := nullif(r->>'soil_pct','')::numeric;
      v_light := nullif(r->>'light_lux','')::numeric;
      v_temp  := nullif(r->>'temp_c','')::numeric;
      v_rh    := nullif(r->>'humidity_pct','')::numeric;
    exception when others then
      v_skipped := v_skipped + 1;       -- a malformed row must not sink the batch
      continue;
    end;
    -- A sensor clock can be wrong; a reading cannot come from the future, and
    -- one older than a year is a clock that was never set.
    if v_at > now() + interval '10 minutes' or v_at < now() - interval '400 days' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if exists (select 1 from public.readings x where x.device_id = p_device and x.created_at = v_at) then
      v_skipped := v_skipped + 1;       -- already uploaded
      continue;
    end if;
    insert into public.readings
      (device_id, light_lux, dli, soil_pct, temp_c, humidity_pct, battery_pct, created_at,
       soil_raw, light_raw, plant_key, quality)
    values (
      p_device, v_light, nullif(r->>'dli','')::numeric, v_soil, v_temp, v_rh,
      nullif(r->>'battery_pct','')::int, v_at,
      case when v_soil  > 100 and v_soil  <= 4095 then v_soil::int  end,
      case when v_light >= 0  and v_light <= 4095 then v_light::int end,
      v_plant,
      public.reading_quality(v_soil, v_light, v_temp, v_rh));
    v_n := v_n + 1;
  end loop;

  if v_n > 0 then
    update public.devices set last_seen = now() where id = p_device;
  end if;
  return json_build_object('inserted', v_n, 'skipped', v_skipped);
end; $$;

revoke all on function public.ingest_batch(uuid, jsonb) from public, anon;
grant execute on function public.ingest_batch(uuid, jsonb) to authenticated;


-- ───────────────────────────────────────────────────────────────────────────
--  3. READING_DAILY — a month of chart from thirty rows instead of 240
-- ───────────────────────────────────────────────────────────────────────────
--  One row per device per UTC day, updated by a trigger as readings arrive (in
--  any order — a late buffered upload updates the day it belongs to). Sums and
--  counts are stored rather than means so the row can be updated incrementally
--  and so several days can be combined correctly.
--
--  Soil and light are summarised as RAW counts. Converting to an index needs the
--  sensor's endpoints, and that conversion has exactly one home: lib/sensing in
--  the app. Min/max in raw are still min/max after a monotone conversion.
create table if not exists public.reading_daily (
  device_id     uuid not null references public.devices on delete cascade,
  day           date not null,                 -- UTC calendar day of created_at
  plant_key     text,                          -- the plant on the day's last reading
  n             int  not null default 0,       -- all readings that day
  first_at      timestamptz,
  last_at       timestamptz,
  -- soil, raw counts, clean readings only (quality bits 1|2|4 clear)
  soil_n        int not null default 0,
  soil_raw_sum  bigint not null default 0,
  soil_raw_min  int,                           -- wettest
  soil_raw_max  int,                           -- driest
  soil_raw_first int,
  soil_raw_last  int,
  -- light, raw counts (bit 8 clear), plus how many sat at a rail
  light_n       int not null default 0,
  light_raw_sum bigint not null default 0,
  light_raw_min int,                           -- brightest
  light_raw_max int,                           -- darkest
  light_railed  int not null default 0,
  -- air
  temp_n        int not null default 0,
  temp_sum      numeric not null default 0,
  temp_min      numeric,
  temp_max      numeric,
  rh_n          int not null default 0,
  rh_sum        numeric not null default 0,
  rh_min        numeric,
  rh_max        numeric,
  vpd_n         int not null default 0,
  vpd_sum       numeric not null default 0,    -- kPa, Tetens, from paired temp + RH
  primary key (device_id, day)
);
comment on table public.reading_daily is
  'Derived. One row per device per UTC day, maintained by trigger from readings. Sums and counts, so means are sum/n. Soil and light are raw ADC counts.';

alter table public.reading_daily enable row level security;
drop policy if exists "own daily" on public.reading_daily;
create policy "own daily" on public.reading_daily
  for select using (
    exists (select 1 from public.devices d where d.id = reading_daily.device_id and d.user_id = auth.uid())
  );
create index if not exists reading_daily_plant on public.reading_daily (plant_key, day desc) where plant_key is not null;

/* Vapour pressure deficit, kPa. Tetens (1930); same formula as lib/vpd.ts. */
create or replace function public.vpd_kpa(p_temp_c numeric, p_rh numeric)
returns numeric language sql immutable set search_path = '' as $$
  select case
    when p_temp_c is null or p_rh is null then null
    else greatest(0, 0.61078 * exp(17.27 * least(greatest(p_temp_c, -50), 60) / (least(greatest(p_temp_c, -50), 60) + 237.3))
                     * (1 - least(greatest(p_rh, 0), 100) / 100.0))
  end;
$$;

create or replace function public.reading_daily_apply()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (new.created_at at time zone 'UTC')::date;
  v_soil_ok  boolean := new.soil_raw  is not null and (new.quality & 7)  = 0;
  v_light_ok boolean := new.light_raw is not null and (new.quality & 8)  = 0;
  v_temp_ok  boolean := new.temp_c    is not null and (new.quality & 16) = 0;
  v_rh_ok    boolean := new.humidity_pct is not null and (new.quality & 32) = 0;
  v_vpd numeric := case when v_temp_ok and v_rh_ok then public.vpd_kpa(new.temp_c, new.humidity_pct) end;
begin
  insert into public.reading_daily as d (
    device_id, day, plant_key, n, first_at, last_at,
    soil_n, soil_raw_sum, soil_raw_min, soil_raw_max, soil_raw_first, soil_raw_last,
    light_n, light_raw_sum, light_raw_min, light_raw_max, light_railed,
    temp_n, temp_sum, temp_min, temp_max,
    rh_n, rh_sum, rh_min, rh_max, vpd_n, vpd_sum)
  values (
    new.device_id, v_day, new.plant_key, 1, new.created_at, new.created_at,
    case when v_soil_ok then 1 else 0 end, case when v_soil_ok then new.soil_raw else 0 end,
    case when v_soil_ok then new.soil_raw end, case when v_soil_ok then new.soil_raw end,
    case when v_soil_ok then new.soil_raw end, case when v_soil_ok then new.soil_raw end,
    case when v_light_ok then 1 else 0 end, case when v_light_ok then new.light_raw else 0 end,
    case when v_light_ok then new.light_raw end, case when v_light_ok then new.light_raw end,
    case when new.light_raw is not null and (new.quality & 8) <> 0 then 1 else 0 end,
    case when v_temp_ok then 1 else 0 end, case when v_temp_ok then new.temp_c else 0 end,
    case when v_temp_ok then new.temp_c end, case when v_temp_ok then new.temp_c end,
    case when v_rh_ok then 1 else 0 end, case when v_rh_ok then new.humidity_pct else 0 end,
    case when v_rh_ok then new.humidity_pct end, case when v_rh_ok then new.humidity_pct end,
    case when v_vpd is not null then 1 else 0 end, coalesce(v_vpd, 0))
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
    vpd_sum = d.vpd_sum + excluded.vpd_sum;
  return null;
end; $$;

drop trigger if exists reading_daily_after_insert on public.readings;
create trigger reading_daily_after_insert
  after insert on public.readings
  for each row execute function public.reading_daily_apply();

/*
 * Recompute summary rows from readings — all of them, one device's, or one
 * device-day. The single definition of what a daily row contains; the insert
 * trigger above is its incremental equivalent and tests/db checks they agree.
 */
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
    temp_n, temp_sum, temp_min, temp_max, rh_n, rh_sum, rh_min, rh_max, vpd_n, vpd_sum)
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
    count(*) filter (where r.light_raw is not null and (r.quality & 8) <> 0)::int,
    count(*) filter (where r.temp_c is not null and (r.quality & 16) = 0)::int,
    coalesce(sum(r.temp_c) filter (where (r.quality & 16) = 0), 0),
    min(r.temp_c) filter (where (r.quality & 16) = 0),
    max(r.temp_c) filter (where (r.quality & 16) = 0),
    count(*) filter (where r.humidity_pct is not null and (r.quality & 32) = 0)::int,
    coalesce(sum(r.humidity_pct) filter (where (r.quality & 32) = 0), 0),
    min(r.humidity_pct) filter (where (r.quality & 32) = 0),
    max(r.humidity_pct) filter (where (r.quality & 32) = 0),
    count(*) filter (where r.temp_c is not null and r.humidity_pct is not null and (r.quality & 48) = 0)::int,
    coalesce(sum(public.vpd_kpa(r.temp_c, r.humidity_pct)) filter (where r.temp_c is not null and r.humidity_pct is not null and (r.quality & 48) = 0), 0)
  from public.readings r
  where (p_device is null or r.device_id = p_device)
    and (p_day is null or (r.created_at at time zone 'UTC')::date = p_day)
    -- a device mid-deletion still has readings for an instant; do not summarise them
    and exists (select 1 from public.devices dv where dv.id = r.device_id)
  group by r.device_id, (r.created_at at time zone 'UTC')::date;
  get diagnostics v_rows = row_count;
  return v_rows;
end; $$;
revoke all on function public.reading_daily_fill(uuid, date) from public, anon, authenticated;

/* Whole-table rebuild, by hand, after any bulk correction:  select public.rebuild_reading_daily(); */
create or replace function public.rebuild_reading_daily()
returns bigint language sql security definer set search_path = '' as $$
  select public.reading_daily_fill(null, null);
$$;
revoke all on function public.rebuild_reading_daily() from public, anon, authenticated;

/*
 * Readings are append-only through the API, but an operator can delete rows in
 * the SQL editor (a faulty sensor's bad week, say). Sums cannot be un-added
 * without the row, so the affected device-days are recomputed instead — once per
 * statement, however many rows it removed.
 */
create or replace function public.reading_daily_after_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select distinct o.device_id, (o.created_at at time zone 'UTC')::date as day
      from deleted_readings o
     where exists (select 1 from public.devices dv where dv.id = o.device_id)
  loop
    perform public.reading_daily_fill(r.device_id, r.day);
  end loop;
  return null;
end; $$;

drop trigger if exists reading_daily_after_delete on public.readings;
create trigger reading_daily_after_delete
  after delete on public.readings
  referencing old table as deleted_readings
  for each statement execute function public.reading_daily_after_delete();

select public.rebuild_reading_daily();

/* The shape charts want: means worked out, one row per device per day. */
create or replace view public.v_reading_daily with (security_invoker = on) as
select
  d.device_id, d.day, d.plant_key, d.n,
  case when d.soil_n  > 0 then round(d.soil_raw_sum::numeric  / d.soil_n, 1)  end as soil_raw_mean,
  d.soil_raw_min, d.soil_raw_max, d.soil_raw_first, d.soil_raw_last,
  case when d.light_n > 0 then round(d.light_raw_sum::numeric / d.light_n, 1) end as light_raw_mean,
  d.light_raw_min, d.light_raw_max, d.light_railed,
  case when d.temp_n > 0 then round(d.temp_sum / d.temp_n, 2) end as temp_mean, d.temp_min, d.temp_max,
  case when d.rh_n   > 0 then round(d.rh_sum   / d.rh_n, 1)   end as rh_mean,   d.rh_min,   d.rh_max,
  case when d.vpd_n  > 0 then round(d.vpd_sum  / d.vpd_n, 3)  end as vpd_mean_kpa
from public.reading_daily d;
grant select on public.v_reading_daily to authenticated;


-- ───────────────────────────────────────────────────────────────────────────
--  4. PLANTS — every plant gets a row of its own
-- ───────────────────────────────────────────────────────────────────────────
--  Until now a plant existed as an entry inside one JSON blob (gardens.state) and
--  as a text key repeated across the research tables. This is its identity: one
--  row, private to its owner, that everything else can point at.
create table if not exists public.plants (
  user_id     uuid not null references auth.users on delete cascade,
  plant_key   text not null,                    -- the app's id, stable for the plant's life
  name        text,                             -- what the owner calls it
  species     text not null,                    -- common name, keys the species catalog
  latin       text,
  status      text not null default 'active'
              check (status in ('active', 'archived', 'died', 'gifted')),
  identified_by text check (identified_by in ('owner', 'photo', 'photo-corrected')),
  acquired_on date,                             -- when the owner got it, if they said
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  ended_at    timestamptz,
  primary key (user_id, plant_key)
);
comment on table public.plants is
  'User-provided. One row per plant: who owns it, what it is, whether it is still alive. Private (RLS). species changes are also logged in plant_identifications.';
alter table public.plants enable row level security;
drop policy if exists "own plants" on public.plants;
create policy "own plants" on public.plants
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists plants_species on public.plants (species);


-- ───────────────────────────────────────────────────────────────────────────
--  5. VERSIONED CONTEXT — what a reading meant at the time it was taken
-- ───────────────────────────────────────────────────────────────────────────
--  A reading is interpreted through the substrate the plant was in and the
--  calibration the sensor had. Both change. Neither is ever edited: a change
--  closes the current row (valid_to) and opens a new one, and a reading finds
--  its context by timestamp. Nothing is stamped onto every reading.

create table if not exists public.plant_substrates (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users on delete cascade,
  plant_key     text not null,
  substrate_key text not null,          -- e.g. preset:coco-coir | mix:coir:20+perlite:30+potting-mix:50 | class:Standard mix | unknown
  kind          text not null check (kind in ('class', 'preset', 'custom', 'unknown')),
  label         text,
  components    jsonb not null default '[]'::jsonb,   -- [{component, fraction}], fractions sum to 1
  properties    jsonb,                  -- the ESTIMATE in force at the time (porosity, capacity, air, with ranges)
  model_version text,
  reason        text check (reason in ('setup', 'owner-edit', 'repot', 'backfill')),
  valid_from    timestamptz not null default now(),
  valid_to      timestamptz,
  check (jsonb_typeof(components) = 'array'),
  -- >= not >: two changes in one transaction share a timestamp, leaving a
  -- zero-length version that no reading can fall inside. Harmless, and true.
  check (valid_to is null or valid_to >= valid_from)
);
comment on table public.plant_substrates is
  'User-provided + estimated. What each plant is potted in, versioned. components is what the owner said; properties is the model''s estimate at the time, kept so later model changes do not rewrite history.';
alter table public.plant_substrates enable row level security;
drop policy if exists "own substrates" on public.plant_substrates;
create policy "own substrates" on public.plant_substrates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists plant_substrates_lookup on public.plant_substrates (user_id, plant_key, valid_from desc);
create unique index if not exists plant_substrates_one_current
  on public.plant_substrates (user_id, plant_key) where valid_to is null;
create index if not exists plant_substrates_key on public.plant_substrates (substrate_key);

create or replace function public.set_plant_substrate(
  p_plant_key text, p_substrate_key text, p_kind text, p_label text default null,
  p_components jsonb default '[]'::jsonb, p_properties jsonb default null,
  p_model_version text default null, p_reason text default 'owner-edit'
) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare v_id bigint; v_current text;
begin
  if auth.uid() is null then raise exception 'must be signed in'; end if;
  select substrate_key into v_current from public.plant_substrates
   where user_id = auth.uid() and plant_key = p_plant_key and valid_to is null;
  if v_current is not distinct from p_substrate_key then return null; end if;   -- unchanged
  update public.plant_substrates set valid_to = now()
   where user_id = auth.uid() and plant_key = p_plant_key and valid_to is null;
  insert into public.plant_substrates
    (user_id, plant_key, substrate_key, kind, label, components, properties, model_version, reason)
  values
    (auth.uid(), p_plant_key, p_substrate_key, p_kind, p_label,
     coalesce(p_components, '[]'::jsonb), p_properties, p_model_version, p_reason)
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.set_plant_substrate(text,text,text,text,jsonb,jsonb,text,text) from public, anon;
grant execute on function public.set_plant_substrate(text,text,text,text,jsonb,jsonb,text,text) to authenticated;

create table if not exists public.sensor_calibrations (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users on delete cascade,
  device_id   uuid not null references public.devices on delete cascade,
  metric      text not null check (metric in ('moisture', 'temperature', 'humidity', 'light')),
  kind        text not null check (kind in ('endpoints', 'offset', 'curve', 'inversion')),
  params      jsonb not null,       -- endpoints {dryAdc, wetAdc} | offset {offset, reference, measured} | curve [{index, theta}] | inversion {inverted}
  valid_from  timestamptz not null default now(),
  valid_to    timestamptz,
  -- >= not >: two changes in one transaction share a timestamp, leaving a
  -- zero-length version that no reading can fall inside. Harmless, and true.
  check (valid_to is null or valid_to >= valid_from)
);
comment on table public.sensor_calibrations is
  'User-provided measurements. Every calibration a sensor has had, versioned. A reading taken at time T was converted with the row where valid_from <= T < valid_to.';
alter table public.sensor_calibrations enable row level security;
drop policy if exists "own calibrations" on public.sensor_calibrations;
create policy "own calibrations" on public.sensor_calibrations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists sensor_calibrations_lookup
  on public.sensor_calibrations (device_id, metric, kind, valid_from desc);
create unique index if not exists sensor_calibrations_one_current
  on public.sensor_calibrations (device_id, metric, kind) where valid_to is null;

create or replace function public.set_sensor_calibration(
  p_device uuid, p_metric text, p_kind text, p_params jsonb
) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare v_id bigint; v_current jsonb;
begin
  if auth.uid() is null then raise exception 'must be signed in'; end if;
  if not exists (select 1 from public.devices d where d.id = p_device and d.user_id = auth.uid()) then
    raise exception 'not your device';
  end if;
  select params into v_current from public.sensor_calibrations
   where device_id = p_device and metric = p_metric and kind = p_kind and valid_to is null;
  if v_current is not distinct from p_params then return null; end if;
  update public.sensor_calibrations set valid_to = now()
   where device_id = p_device and metric = p_metric and kind = p_kind and valid_to is null;
  insert into public.sensor_calibrations (user_id, device_id, metric, kind, params)
  values (auth.uid(), p_device, p_metric, p_kind, p_params)
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.set_sensor_calibration(uuid,text,text,jsonb) from public, anon;
grant execute on function public.set_sensor_calibration(uuid,text,text,jsonb) to authenticated;


-- ───────────────────────────────────────────────────────────────────────────
--  6. PLANT_OBSERVATIONS — what the plant did, which no sensor can report
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.plant_observations (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  plant_key  text not null,
  at         timestamptz not null default now(),
  kind       text not null check (kind in (
               'new-growth', 'flowering', 'wilting', 'yellowing', 'browning',
               'leaf-drop', 'pests', 'mould', 'leggy', 'looks-well', 'other')),
  severity   smallint check (severity between 1 and 3),   -- 1 slight · 2 clear · 3 severe
  note       text check (char_length(note) <= 500),
  photo_path text,                                        -- storage path in plant-photos, if any
  unique (user_id, plant_key, kind, at)
);
comment on table public.plant_observations is
  'User-reported. What the owner saw on the plant. The outcome labels that make sensor history interpretable. An observation is a report, not a diagnosis.';
alter table public.plant_observations enable row level security;
drop policy if exists "own observations" on public.plant_observations;
create policy "own observations" on public.plant_observations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists plant_observations_lookup on public.plant_observations (user_id, plant_key, at desc);
create index if not exists plant_observations_kind on public.plant_observations (kind, at desc);


-- ───────────────────────────────────────────────────────────────────────────
--  7. RECOMMENDATIONS — what the app advised, on what basis, and what followed
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.model_versions (
  component   text not null,          -- sensing | substrate | light | decision
  version     text not null,
  description text not null,
  released_at timestamptz not null default now(),
  primary key (component, version)
);
comment on table public.model_versions is
  'Reference. Every version of every model that has produced stored output. recommendations.model_version is the four current versions joined with dots.';
alter table public.model_versions enable row level security;
drop policy if exists "anyone signed in can read model versions" on public.model_versions;
create policy "anyone signed in can read model versions" on public.model_versions
  for select to authenticated using (true);

insert into public.model_versions (component, version, description) values
  ('sensing',   's1', 'Global soil endpoints 3020/1400; additive offset calibration.'),
  ('sensing',   's2', 'Raw preserved; quality flags; per-sensor endpoints; optional weighed curve.'),
  ('substrate', 'b1', 'Four fitted classes.'),
  ('substrate', 'b2', 'Component library, 12 USDA textures (Carsel & Parrish 1988), packing-model blends.'),
  ('light',     'l1', 'Daily light from the mean of the log-scaled index.'),
  ('light',     'l2', 'Daily light integrated in linear illuminance; rail saturation reported.'),
  ('decision',  'd1', 'Water / hold from species band.'),
  ('decision',  'd2', 'Nine states with a nine-point evidence checklist.')
on conflict (component, version) do nothing;

create table if not exists public.recommendations (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users on delete cascade,
  plant_key     text not null,
  at            timestamptz not null default now(),
  state         text not null check (state in (
                  'insufficient-data', 'inconsistent', 'retry', 'waiting', 'water-now',
                  'drying', 'in-range', 'too-wet', 'not-draining')),
  grade         text not null check (grade in ('high', 'moderate', 'low', 'none')),
  ml            int check (ml is null or (ml >= 0 and ml <= 10000)),
  days_until_due numeric,
  inputs        jsonb not null default '{}'::jsonb,   -- the numbers the decision used
  evidence      jsonb not null default '[]'::jsonb,   -- [{key, met}]
  model_version text not null,
  -- filled in later
  response      text check (response in ('followed', 'dismissed', 'snoozed')),
  responded_at  timestamptz,
  outcome       jsonb,                                 -- e.g. {soil_before, soil_after, rise_points, hours}
  unique (user_id, plant_key, at)
);
comment on table public.recommendations is
  'Model output + user response. One row each time a plant''s advice CHANGES state (not per render). inputs are the measured values used; grade is a checklist count, not a probability.';
alter table public.recommendations enable row level security;
drop policy if exists "own recommendations" on public.recommendations;
create policy "own recommendations" on public.recommendations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists recommendations_lookup on public.recommendations (user_id, plant_key, at desc);
create index if not exists recommendations_state on public.recommendations (state, at desc);


-- ───────────────────────────────────────────────────────────────────────────
--  8. AI — identifications, usage accounting, cache, private photos
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.plant_identifications (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users on delete cascade,
  plant_key       text,                         -- null until the plant is created
  created_at      timestamptz not null default now(),
  image_sha256    text not null check (image_sha256 ~ '^[0-9a-f]{64}$'),
  image_path      text,                         -- storage path, if the photo was kept
  provider        text not null,
  model           text not null,
  prompt_version  text not null,
  escalated       boolean not null default false,   -- a second, stronger model was consulted
  -- validated model output
  is_plant        boolean,
  image_issue     text,                         -- blurry | dark | multiple-plants | partial | none
  top_common      text,
  top_latin       text,
  rank            text check (rank in ('species', 'genus', 'family', 'unknown')),
  confidence      text check (confidence in ('high', 'medium', 'low')),
  candidates      jsonb not null default '[]'::jsonb,   -- [{common, latin, rank, confidence, features}]
  -- what the owner did with it
  user_action     text check (user_action in ('confirmed', 'chose-alternative', 'corrected', 'rejected')),
  accepted_species text,                        -- catalog common name actually used
  acted_at        timestamptz
);
comment on table public.plant_identifications is
  'AI interpretation + user decision. Every photo identification attempt, the model that made it, and whether the owner agreed. Model output never writes to plants directly — the owner''s confirmation does.';
alter table public.plant_identifications enable row level security;
drop policy if exists "read own identifications" on public.plant_identifications;
create policy "read own identifications" on public.plant_identifications
  for select using (auth.uid() = user_id);
-- The owner may record their decision; they may not author or rewrite the model's output.
drop policy if exists "decide own identifications" on public.plant_identifications;
create policy "decide own identifications" on public.plant_identifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke insert, delete on public.plant_identifications from authenticated, anon;
revoke update on public.plant_identifications from authenticated, anon;
grant update (user_action, accepted_species, acted_at, plant_key) on public.plant_identifications to authenticated;
drop policy if exists "delete own identifications" on public.plant_identifications;
create policy "delete own identifications" on public.plant_identifications
  for delete using (auth.uid() = user_id);
grant delete on public.plant_identifications to authenticated;
create index if not exists plant_identifications_user on public.plant_identifications (user_id, created_at desc);

create table if not exists public.ai_usage (
  id            bigint generated always as identity primary key,
  user_id       uuid references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  task          text not null,                  -- identify | explain | …
  provider      text not null,
  model         text not null,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  cost_usd      numeric(12, 6) not null default 0,   -- ESTIMATE from the price table in the function
  latency_ms    int,
  cache_hit     boolean not null default false,
  ok            boolean not null default true,
  error         text
);
comment on table public.ai_usage is
  'Operational. One row per AI request, including cache hits and failures. Written only by edge functions (service role). cost_usd is an estimate from list prices, not a bill.';
alter table public.ai_usage enable row level security;   -- no policies: clients cannot read or write it
create index if not exists ai_usage_time on public.ai_usage (created_at desc);
create index if not exists ai_usage_user_day on public.ai_usage (user_id, created_at desc);

create table if not exists public.ai_cache (
  user_id     uuid not null references auth.users on delete cascade,
  task        text not null,
  input_hash  text not null,                    -- sha-256 of the exact input (image bytes) + prompt version
  result      jsonb not null,
  model       text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, task, input_hash)
);
comment on table public.ai_cache is
  'Operational. Per-user cache of AI results keyed by input hash, so the same photo is never paid for twice. Scoped to the user: results are never shared across accounts.';
alter table public.ai_cache enable row level security;   -- no policies: edge functions only

-- Private photo storage. Guarded so this file also runs where the storage
-- schema is absent (local test databases).
do $storage$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('plant-photos', 'plant-photos', false)
    on conflict (id) do nothing;

    -- Objects live at  <user id>/<anything>.  The first path segment is the owner.
    execute 'drop policy if exists "plant photos: owner reads" on storage.objects';
    execute 'create policy "plant photos: owner reads" on storage.objects for select to authenticated
             using (bucket_id = ''plant-photos'' and (storage.foldername(name))[1] = auth.uid()::text)';
    execute 'drop policy if exists "plant photos: owner writes" on storage.objects';
    execute 'create policy "plant photos: owner writes" on storage.objects for insert to authenticated
             with check (bucket_id = ''plant-photos'' and (storage.foldername(name))[1] = auth.uid()::text)';
    execute 'drop policy if exists "plant photos: owner deletes" on storage.objects';
    execute 'create policy "plant photos: owner deletes" on storage.objects for delete to authenticated
             using (bucket_id = ''plant-photos'' and (storage.foldername(name))[1] = auth.uid()::text)';
  end if;
end
$storage$;


-- ───────────────────────────────────────────────────────────────────────────
--  9. SUBSTRATE REFERENCE — the library, queryable
-- ───────────────────────────────────────────────────────────────────────────
--  Filled from the app's catalog by supabase/seed/substrates.sql (generated, so
--  there is one source of truth: lib/substrate). These exist so an analyst can
--  join a substrate_key to its properties in SQL.
create table if not exists public.substrate_components (
  id                 text primary key,
  label              text not null,
  family             text not null check (family in ('mineral', 'organic', 'aggregate', 'blend')),
  packing_role       text not null check (packing_role in ('matrix', 'skeleton')),
  total_porosity     numeric not null,     -- v/v
  interparticle_void numeric not null,     -- v/v, 0 for matrix materials
  spread             numeric not null,     -- ± v/v between products
  vg_alpha           numeric not null,     -- 1/cm
  vg_n               numeric not null,
  vg_theta_s         numeric not null,
  vg_theta_r         numeric not null,
  tier               text not null check (tier in ('published-parameters', 'published-anchors', 'typical-magnitude')),
  source             text not null,
  note               text
);
comment on table public.substrate_components is
  'Reference (literature-derived). Growing-media ingredients and the 12 USDA texture classes with van Genuchten parameters. tier says how well-sourced each row is. Not measured by Greenr.';

create table if not exists public.substrate_presets (
  id            text primary key,
  label         text not null,
  preset_group  text not null,
  substrate_key text not null,          -- what plant_substrates.substrate_key holds for this choice
  components    jsonb not null default '[]'::jsonb,
  -- the model's ESTIMATE, with ranges: {totalPorosity:{low,mid,high}, containerCapacity:…, airSpace:…}
  properties    jsonb,
  model_version text not null
);
comment on table public.substrate_presets is
  'Reference (estimated). The substrate choices offered in the app and the properties the model estimates for each.';

alter table public.substrate_components enable row level security;
alter table public.substrate_presets enable row level security;
drop policy if exists "read substrate components" on public.substrate_components;
create policy "read substrate components" on public.substrate_components for select using (true);
drop policy if exists "read substrate presets" on public.substrate_presets;
create policy "read substrate presets" on public.substrate_presets for select using (true);


-- ───────────────────────────────────────────────────────────────────────────
--  10. EXPORT AND DELETE — the owner's data is the owner's
-- ───────────────────────────────────────────────────────────────────────────
/* Everything stored about the caller, as one JSON document. */
create or replace function public.export_my_data()
returns jsonb
language plpgsql security invoker stable set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'must be signed in'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'plants',            (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.plants t where t.user_id = v_uid),
    'plant_substrates',  (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.plant_substrates t where t.user_id = v_uid),
    'plant_profiles',    (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.plant_profiles t where t.user_id = v_uid),
    'care_events',       (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.care_events t where t.user_id = v_uid),
    'plant_observations',(select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.plant_observations t where t.user_id = v_uid),
    'plant_measurements',(select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.plant_measurements t where t.user_id = v_uid),
    'plant_health_log',  (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.plant_health_log t where t.user_id = v_uid),
    'recommendations',   (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.recommendations t where t.user_id = v_uid),
    'identifications',   (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.plant_identifications t where t.user_id = v_uid),
    'sensor_calibrations',(select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.sensor_calibrations t where t.user_id = v_uid),
    'devices',           (select coalesce(jsonb_agg(jsonb_build_object(
                             'id', d.id, 'label', d.label, 'plant_key', d.plant_key,
                             'wake_seconds', d.wake_seconds, 'last_seen', d.last_seen)), '[]'::jsonb)
                            from public.devices d where d.user_id = v_uid),
    'reading_daily',     (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.reading_daily t
                           where exists (select 1 from public.devices d where d.id = t.device_id and d.user_id = v_uid))
  );
end; $$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

/*
 * Erase one plant and everything recorded about it. Readings stay with the
 * DEVICE (they are the device's history) but lose their link to the plant, via
 * unlink_plant_readings() below (plpgsql resolves it at call time).
 */
create or replace function public.delete_plant(p_plant_key text)
returns json
language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'must be signed in'; end if;
  delete from public.plant_observations    where user_id = v_uid and plant_key = p_plant_key;
  delete from public.recommendations       where user_id = v_uid and plant_key = p_plant_key;
  delete from public.plant_substrates      where user_id = v_uid and plant_key = p_plant_key;
  delete from public.plant_identifications where user_id = v_uid and plant_key = p_plant_key;
  delete from public.plant_measurements    where user_id = v_uid and plant_key = p_plant_key;
  delete from public.plant_health_log      where user_id = v_uid and plant_key = p_plant_key;
  delete from public.care_events           where user_id = v_uid and plant_key = p_plant_key;
  delete from public.plant_profiles        where user_id = v_uid and plant_key = p_plant_key;
  delete from public.plants                where user_id = v_uid and plant_key = p_plant_key;
  perform public.unlink_plant_readings(p_plant_key);
  update public.devices set plant_key = null where user_id = v_uid and plant_key = p_plant_key;
  return json_build_object('ok', true);
end; $$;
revoke all on function public.delete_plant(text) from public, anon;
grant execute on function public.delete_plant(text) to authenticated;

/*
 * delete_plant cannot un-label readings through RLS (readings has no update
 * policy, by design), so that one step runs with definer rights — scoped to
 * devices the caller owns.
 */
create or replace function public.unlink_plant_readings(p_plant_key text)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_n bigint;
begin
  if auth.uid() is null then raise exception 'must be signed in'; end if;
  update public.readings r set plant_key = null
   where r.plant_key = p_plant_key
     and exists (select 1 from public.devices d where d.id = r.device_id and d.user_id = auth.uid());
  get diagnostics v_n = row_count;
  update public.reading_daily rd set plant_key = null
   where rd.plant_key = p_plant_key
     and exists (select 1 from public.devices d where d.id = rd.device_id and d.user_id = auth.uid());
  return v_n;
end; $$;
revoke all on function public.unlink_plant_readings(text) from public, anon;
grant execute on function public.unlink_plant_readings(text) to authenticated;


-- ───────────────────────────────────────────────────────────────────────────
--  11. WHAT THE DATA SAYS — gated aggregates, and an operator's overview
-- ───────────────────────────────────────────────────────────────────────────
--  Same construction as supabase-moat.sql: a SECURITY DEFINER function confined
--  to the `research` schema, reading ONLY opted-in accounts, returning ONLY
--  groups that clear a minimum of distinct plants AND distinct growers, wrapped
--  in a privilege-free view. The unit counted is always the PLANT, never the
--  reading: a thousand readings from one pot are one observation.
create schema if not exists research;
revoke all on schema research from public;
grant usage on schema research to authenticated;

/* How long does each substrate take to dry, in pots that have been watched? */
create or replace function research.substrate_drying()
returns table (
  substrate_key        text,
  label                text,
  sample_plants        bigint,
  sample_growers       bigint,
  dry_down_days_p25    numeric,
  dry_down_days_median numeric,
  dry_down_days_p75    numeric,
  ml_per_point_per_liter_median numeric
)
language sql stable security definer set search_path = '' as $fn$
  with per_plant as (
    select m.user_id, m.plant_key, s.substrate_key, max(s.label) as label,
           avg(m.dry_down_days)          as dry_down_days,
           avg(m.ml_per_point_per_liter) as mlppl
      from public.plant_measurements m
      join public.profiles p on p.user_id = m.user_id and p.research_opt_in
      join lateral (
        -- the substrate it was in WHEN the measurement was taken
        select s2.substrate_key, s2.label
          from public.plant_substrates s2
         where s2.user_id = m.user_id and s2.plant_key = m.plant_key
           and s2.valid_from <= m.measured_at
           and (s2.valid_to is null or m.measured_at < s2.valid_to)
         order by s2.valid_from desc limit 1
      ) s on true
     where m.retention_confident                -- a measured dry-down, not an assumed one
       and m.dry_down_days is not null
       and s.substrate_key <> 'unknown'
     group by m.user_id, m.plant_key, s.substrate_key
  )
  select q.substrate_key, max(q.label),
         count(*)::bigint, count(distinct q.user_id)::bigint,
         (percentile_cont(0.25) within group (order by q.dry_down_days))::numeric,
         (percentile_cont(0.50) within group (order by q.dry_down_days))::numeric,
         (percentile_cont(0.75) within group (order by q.dry_down_days))::numeric,
         (percentile_cont(0.50) within group (order by q.mlppl))::numeric
    from per_plant q
   group by q.substrate_key
  having count(*) >= 15 and count(distinct q.user_id) >= 5;
$fn$;

/*
 * Does drier air go with faster drying? Per plant: its typical VPD and its
 * demand-UNcorrected drying rate, bucketed by VPD.
 *
 * This is an ASSOCIATION across different pots in different homes. Warm dry
 * rooms also tend to be brighter and to hold different plants, so the slope is
 * not the effect of VPD alone.
 */
create or replace function research.drying_by_vpd()
returns table (
  vpd_bucket_kpa   numeric,
  sample_plants    bigint,
  sample_growers   bigint,
  dry_points_per_day_median numeric
)
language sql stable security definer set search_path = '' as $fn$
  with per_plant as (
    select h.user_id, h.plant_key,
           avg(h.avg_vpd_kpa) as vpd,
           (select avg(m.dry_points_per_day) from public.plant_measurements m
             where m.user_id = h.user_id and m.plant_key = h.plant_key and m.retention_confident) as rate
      from public.plant_health_log h
      join public.profiles p on p.user_id = h.user_id and p.research_opt_in
     where h.avg_vpd_kpa is not null
     group by h.user_id, h.plant_key
  )
  select (floor(q.vpd / 0.25) * 0.25)::numeric,
         count(*)::bigint, count(distinct q.user_id)::bigint,
         (percentile_cont(0.5) within group (order by q.rate))::numeric
    from per_plant q
   where q.rate is not null
   group by floor(q.vpd / 0.25)
  having count(*) >= 15 and count(distinct q.user_id) >= 5;
$fn$;

/* Is the advice followed, and what does the soil do afterwards? */
create or replace function research.recommendation_outcomes()
returns table (
  model_version  text,
  state          text,
  grade          text,
  sample_plants  bigint,
  sample_growers bigint,
  issued         bigint,
  followed       bigint,
  dismissed      bigint,
  median_rise_points numeric
)
language sql stable security definer set search_path = '' as $fn$
  select r.model_version, r.state, r.grade,
         count(distinct (r.user_id, r.plant_key))::bigint,
         count(distinct r.user_id)::bigint,
         count(*)::bigint,
         count(*) filter (where r.response = 'followed')::bigint,
         count(*) filter (where r.response = 'dismissed')::bigint,
         (percentile_cont(0.5) within group (order by (r.outcome->>'rise_points')::numeric))::numeric
    from public.recommendations r
    join public.profiles p on p.user_id = r.user_id and p.research_opt_in
   group by r.model_version, r.state, r.grade
  having count(distinct (r.user_id, r.plant_key)) >= 15 and count(distinct r.user_id) >= 5;
$fn$;

revoke all on function research.substrate_drying()        from public;
revoke all on function research.drying_by_vpd()           from public;
revoke all on function research.recommendation_outcomes() from public;
grant execute on function research.substrate_drying()        to authenticated;
grant execute on function research.drying_by_vpd()           to authenticated;
grant execute on function research.recommendation_outcomes() to authenticated;

drop view if exists public.substrate_drying;
drop view if exists public.drying_by_vpd;
drop view if exists public.recommendation_outcomes;
create view public.substrate_drying with (security_invoker = on) as select * from research.substrate_drying();
create view public.drying_by_vpd with (security_invoker = on) as select * from research.drying_by_vpd();
create view public.recommendation_outcomes with (security_invoker = on) as select * from research.recommendation_outcomes();
comment on view public.substrate_drying is
  'Measured dry-down time per substrate, opted-in growers only, one value per plant. Gated at 15 distinct plants across 5+ growers.';
comment on view public.drying_by_vpd is
  'Association (not causation) between a plant''s typical VPD and its drying rate. Gated at 15 plants / 5 growers per bucket.';
comment on view public.recommendation_outcomes is
  'How often each kind of advice is followed and what the soil did next, per model version. Gated at 15 plants / 5 growers.';
revoke all on public.substrate_drying, public.drying_by_vpd, public.recommendation_outcomes from anon;
grant select on public.substrate_drying, public.drying_by_vpd, public.recommendation_outcomes to authenticated;

/*
 * THE OPERATOR'S OVERVIEW. One call, for accounts listed in analytics_admins
 * (see supabase-analytics.sql). Counts only — no row from any user leaves here.
 * Unlike the views above it is NOT limited to opted-in accounts, because it
 * reports the size and health of the system rather than anything about plants.
 */
create table if not exists public.analytics_admins (
  user_id uuid primary key references auth.users on delete cascade
);
alter table public.analytics_admins enable row level security;

create or replace function public.admin_overview(p_days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 400)));
begin
  if not exists (select 1 from public.analytics_admins a where a.user_id = auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'window_days', greatest(1, least(coalesce(p_days, 30), 400)),
    'generated_at', now(),
    'dataset', jsonb_build_object(
      'accounts_with_plants', (select count(distinct user_id) from public.plants),
      'plants_active',        (select count(*) from public.plants where status = 'active'),
      'plants_ended',         (select count(*) from public.plants where status <> 'active'),
      'research_opt_ins',     (select count(*) from public.profiles where research_opt_in),
      'devices_claimed',      (select count(*) from public.devices where user_id is not null),
      'devices_reporting',    (select count(*) from public.devices where last_seen >= v_since),
      'readings_total',       (select count(*) from public.readings),
      'readings_in_window',   (select count(*) from public.readings where created_at >= v_since),
      'care_events',          (select count(*) from public.care_events),
      'observations',         (select count(*) from public.plant_observations),
      'recommendations',      (select count(*) from public.recommendations)
    ),
    'data_quality', jsonb_build_object(
      'flagged_share',        (select round(avg((quality <> 0)::int)::numeric, 4) from public.readings where created_at >= v_since),
      'probe_not_in_soil',    (select count(*) from public.readings where created_at >= v_since and (quality & 4) <> 0),
      'probe_disconnected',   (select count(*) from public.readings where created_at >= v_since and (quality & 2) <> 0),
      'light_at_rail',        (select count(*) from public.readings where created_at >= v_since and (quality & 8) <> 0),
      'readings_without_plant', (select count(*) from public.readings where created_at >= v_since and plant_key is null),
      'devices_factory_scale', (select count(*) from public.devices d where d.user_id is not null and not exists (
                                  select 1 from public.sensor_calibrations c
                                   where c.device_id = d.id and c.metric = 'moisture' and c.kind = 'endpoints' and c.valid_to is null))
    ),
    'coverage', jsonb_build_object(
      'plants_with_substrate', (select count(distinct (user_id, plant_key)) from public.plant_substrates where valid_to is null and kind <> 'unknown'),
      'plants_with_measured_drying', (select count(distinct (user_id, plant_key)) from public.plant_measurements where retention_confident),
      'plants_with_measured_dose', (select count(distinct (user_id, plant_key)) from public.plant_measurements where ml_per_point_basis in ('measured', 'blended')),
      'top_species', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                        select species, count(*) as plants, count(distinct user_id) as growers
                          from public.plants where status = 'active'
                         group by species order by count(*) desc limit 15) x),
      'top_substrates', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                        select substrate_key, max(label) as label, count(*) as plants, count(distinct user_id) as growers
                          from public.plant_substrates where valid_to is null
                         group by substrate_key order by count(*) desc limit 15) x)
    ),
    'recommendations', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                        select state, grade, count(*) as issued,
                               count(*) filter (where response = 'followed') as followed,
                               count(distinct (user_id, plant_key)) as plants
                          from public.recommendations where at >= v_since
                         group by state, grade order by count(*) desc) x),
    'identifications', jsonb_build_object(
      'attempts',   (select count(*) from public.plant_identifications where created_at >= v_since),
      'confirmed',  (select count(*) from public.plant_identifications where created_at >= v_since and user_action = 'confirmed'),
      'alternative',(select count(*) from public.plant_identifications where created_at >= v_since and user_action = 'chose-alternative'),
      'corrected',  (select count(*) from public.plant_identifications where created_at >= v_since and user_action = 'corrected'),
      'rejected',   (select count(*) from public.plant_identifications where created_at >= v_since and user_action = 'rejected'),
      'escalated',  (select count(*) from public.plant_identifications where created_at >= v_since and escalated)
    ),
    'ai', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
            select task, model, count(*) as requests,
                   count(*) filter (where cache_hit) as cache_hits,
                   count(*) filter (where not ok) as errors,
                   sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
                   round(sum(cost_usd), 4) as cost_usd,
                   round(avg(latency_ms) filter (where not cache_hit)) as avg_latency_ms,
                   count(distinct user_id) as users
              from public.ai_usage where created_at >= v_since
             group by task, model order by count(*) desc) x)
  );
end; $$;
revoke all on function public.admin_overview(int) from public, anon;
grant execute on function public.admin_overview(int) to authenticated;
