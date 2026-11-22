-- ═══════════════════════════════════════════════════════════════════════════
--  READINGS HEALTH CHECK — read-only. Changes nothing.
--
--  Paste into the Supabase SQL editor and Run, any time. One table comes back:
--  each line is a check, its status, and the numbers behind it.
--
--    PASS    as it should be
--    INFO    numbers to look at, no verdict
--    WARN    worth a look (usually wiring, or a step not run yet)
--    FAIL    something is wrong with stored data — tell whoever maintains Greenr
--
--  Covers the last 30 days of readings. Safe on a project with no readings yet.
-- ═══════════════════════════════════════════════════════════════════════════

with
r30 as (
  select * from public.readings where created_at > now() - interval '30 days'
),
ingest as (
  select coalesce((
    select pg_get_functiondef(p.oid)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'ingest_v2'
     limit 1), '') as def
),
daily_check as (
  -- the daily summary must count exactly the readings it summarises
  select count(*) as bad
    from (
      select r.device_id, (r.created_at at time zone 'UTC')::date as day, count(*) as n
        from public.readings r
       where r.created_at > now() - interval '7 days'
       group by 1, 2
    ) x
    left join public.reading_daily d on d.device_id = x.device_id and d.day = x.day
   where d.n is distinct from x.n
     and x.day > (now() at time zone 'UTC')::date - 7      -- whole days only
),
dupes as (
  select count(*) as n
    from r30 a
    join r30 b on b.device_id = a.device_id and b.id > a.id
              and b.created_at between a.created_at - interval '30 seconds' and a.created_at + interval '30 seconds'
              and b.soil_raw is not distinct from a.soil_raw
              and b.lux is not distinct from a.lux
),
per_device as (
  select string_agg(
           coalesce(nullif(d.label, ''), left(d.id::text, 8)) || ': ' ||
           coalesce(to_char(x.last_at, 'YYYY-MM-DD HH24:MI') || ' UTC', 'no readings') ||
           coalesce(', fw ' || d.firmware_version, '') ||
           case when d.battery_mv is null then ', no battery value (USB or no divider)'
                else ', battery ' || d.battery_mv || ' mV' end,
           ' · ' order by x.last_at desc nulls last) as s
    from public.devices d
    left join (select device_id, max(created_at) as last_at from public.readings group by 1) x on x.device_id = d.id
)
select status, check_name, detail from (
  select 1 as ord, 'ingest_v2 is the corrected version (file 16)' as check_name,
         case when (select def from ingest) like '%v_newest_bat%' then 'PASS'
              when (select def from ingest) = '' then 'FAIL'
              else 'WARN' end as status,
         case when (select def from ingest) like '%v_newest_bat%' then 'stores every raw count; battery follows the newest reading'
              when (select def from ingest) = '' then 'ingest_v2 is missing: run SQL file 14, then 16'
              else 'older version: run supabase/migrations/20261118120000_readings_accuracy.sql' end as detail
  union all
  select 2, 'model versions s4, s5, d3, d4 registered',
         case when (select count(*) from public.model_versions
                     where (component, version) in (('sensing','s4'),('sensing','s5'),('decision','d3'),('decision','d4'))) = 4
              then 'PASS' else 'WARN' end,
         'found: ' || coalesce((select string_agg(component || ' ' || version, ', ' order by component, version)
                                  from public.model_versions where version in ('s4','s5','d3','d4')), 'none')
         || ' (files 15 and 16 register them)'
  union all
  select 3, 'readings and devices are private (row level security on)',
         case when (select bool_and(c.relrowsecurity) from pg_class c
                     where c.oid in ('public.readings'::regclass, 'public.devices'::regclass)) then 'PASS' else 'FAIL' end,
         'only a sensor''s owner can read its readings'
  union all
  select 4, 'devices', 'INFO',
         (select count(*) || ' registered, ' || count(*) filter (where user_id is not null) || ' paired to an account' from public.devices)
  union all
  select 5, 'readings stored: last 24 h / 7 days / 30 days', 'INFO',
         (select count(*) filter (where created_at > now() - interval '1 day') || ' / '
               || count(*) filter (where created_at > now() - interval '7 days') || ' / ' || count(*) from r30)
  union all
  select 6, 'no reading is dated in the future',
         case when (select count(*) from r30 where created_at > now() + interval '1 minute') = 0 then 'PASS' else 'FAIL' end,
         (select count(*) from r30 where created_at > now() + interval '1 minute') || ' readings'
  union all
  select 7, 'every soil count is one a 12-bit converter can produce (0–4095)',
         case when (select count(*) from r30 where soil_raw < 0 or soil_raw > 4095) = 0 then 'PASS' else 'FAIL' end,
         (select count(*) from r30 where soil_raw < 0 or soil_raw > 4095) || ' readings'
  union all
  select 8, 'no C3 reading lost its raw count (rows stored before file 16)',
         case when (select count(*) from r30 where soil_raw is null and soil_pct between 0 and 100 and lux is not null) = 0
              then 'PASS' else 'WARN' end,
         (select count(*) from r30 where soil_raw is null and soil_pct between 0 and 100 and lux is not null)
         || ' readings; the app shows these as disconnected'
  union all
  select 9, 'probe disconnected or unpowered (quality bit 2)',
         case when (select count(*) from r30 where quality & 2 = 2) = 0 then 'PASS' else 'WARN' end,
         (select count(*) from r30 where quality & 2 = 2) || ' readings — check AOUT→GPIO3, VCC→GPIO10, GND'
  union all
  select 10, 'probe read as out of the soil (quality bit 4)', 'INFO',
         (select count(*) from r30 where quality & 4 = 4) || ' readings (normal during setup and calibration)'
  union all
  select 11, 'light sensor at full scale (quality bit 8)', 'INFO',
         (select count(*) from r30 where quality & 8 = 8) || ' readings (direct summer sun can do this)'
  union all
  select 12, 'temperature and humidity in range (quality bits 16, 32)',
         case when (select count(*) from r30 where quality & 48 <> 0) = 0 then 'PASS' else 'WARN' end,
         (select count(*) from r30 where quality & 48 <> 0) || ' readings — check the AHT10 wiring'
  union all
  select 13, 'no reading stored twice',
         case when (select n from dupes) = 0 then 'PASS' else 'FAIL' end,
         (select n from dupes) || ' pairs within 30 s with identical values'
  union all
  select 14, 'daily summaries match the readings (last 7 days)',
         case when (select bad from daily_check) = 0 then 'PASS' else 'FAIL' end,
         (select bad from daily_check) || ' device-days differ'
         || case when (select bad from daily_check) > 0 then ' — fix with: select public.rebuild_reading_daily();' else '' end
  union all
  select 15, 'last reading per device', 'INFO', coalesce((select s from per_device), 'no devices')
) t
order by ord;
