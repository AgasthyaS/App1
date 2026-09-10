-- ============================================================================
--  greenr — the data moat
--  Supabase → SQL Editor → New query → paste ALL → Run.  Safe to re-run.
--
--  WHY THIS EXISTS
--  Every plant app has photos and species names — that data is scrapeable and
--  worth nothing. What almost nobody has is CONTINUOUS ENVIRONMENTAL TELEMETRY
--  tied to a known species and pot, paired with what the owner DID and how the
--  plant ACTUALLY ENDED UP. That combination can't be bought or crawled; it only
--  accumulates by having hardware in real homes.
--
--  These tables exist so that data is captured correctly FROM THE START. Most of
--  it isn't useful at ten users and is extremely valuable at ten thousand — but
--  it can only be collected going forward, never retrofitted. A reading whose
--  pot/species context was lost, or a plant that died without a recorded cause,
--  is a training example gone for good.
--
--  Privacy: aggregates read ONLY from rows whose owner opted in (profiles.
--  research_opt_in). Nothing here exposes a user's identity, location or photos.
-- ============================================================================

-- ── 1. CONSENT ───────────────────────────────────────────────────────────────
-- The legal + ethical basis for ever using this data in aggregate. Default FALSE
-- so it is strictly opt-in; the app's Settings toggle writes here.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  research_opt_in boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 2. CONFIGURATION SNAPSHOTS ───────────────────────────────────────────────
-- The single most important table for making history LEARNABLE.
-- A reading only means something alongside what the plant was in AT THAT TIME.
-- If someone repots from a 12 cm plastic pot into a 20 cm terracotta one, every
-- earlier reading must still resolve to the OLD pot — otherwise the whole
-- history becomes unlabelled noise. So configuration is versioned, never edited.
-- ⚠ SUPERSEDED, kept only so an existing database still parses this file.
--   Nothing in the app has ever written to this table, and section 5 no longer
--   reads it. Its job is done by `plant_profiles` in supabase/schema.sql, which
--   `lib/research.ts` does write. Left in place rather than dropped because
--   dropping a table is not something a schema file should do quietly.
create table if not exists public.plant_configs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  device_id uuid references public.devices on delete set null,
  plant_key text not null,                 -- the app's plant id
  species text not null,                   -- common name, keys lib/plants.ts
  pot_size text,                           -- S | M | L
  pot_material text,                       -- Terracotta | Plastic | Ceramic
  pot_cm numeric,
  soil_mix text,                           -- Standard | Gritty | Chunky | Dense
  has_drainage boolean,
  indoor boolean,
  -- coarse location only: enough to learn regional effects, too coarse to identify
  climate_zone int,                        -- derived USDA-style zone
  latitude_band int,                       -- latitude rounded to 5° (e.g. 50, 55)
  valid_from timestamptz not null default now(),
  valid_to timestamptz                     -- null = current
);
alter table public.plant_configs enable row level security;
drop policy if exists "own configs" on public.plant_configs;
create policy "own configs" on public.plant_configs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists plant_configs_lookup
  on public.plant_configs (plant_key, valid_from desc);

-- Close the previous version and open a new one. The app calls this whenever a
-- plant's pot/soil/species/spot changes.
-- ⚠ SUPERSEDED and uncalled — `lib/research.ts` versions `plant_profiles`
--   directly (close the open row, insert a new one) rather than through an RPC.
create or replace function public.snapshot_plant_config(
  p_plant_key text, p_species text,
  p_device uuid default null,
  p_pot_size text default null, p_pot_material text default null, p_pot_cm numeric default null,
  p_soil_mix text default null, p_has_drainage boolean default null,
  p_indoor boolean default null, p_climate_zone int default null, p_lat_band int default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if auth.uid() is null then raise exception 'must be signed in'; end if;
  update public.plant_configs
     set valid_to = now()
   where user_id = auth.uid() and plant_key = p_plant_key and valid_to is null;
  insert into public.plant_configs
    (user_id, device_id, plant_key, species, pot_size, pot_material, pot_cm,
     soil_mix, has_drainage, indoor, climate_zone, latitude_band)
  values
    (auth.uid(), p_device, p_plant_key, p_species, p_pot_size, p_pot_material, p_pot_cm,
     p_soil_mix, p_has_drainage, p_indoor, p_climate_zone, p_lat_band)
  returning id into v_id;
  return v_id;
end; $$;
grant execute on function public.snapshot_plant_config(text,text,uuid,text,text,numeric,text,boolean,boolean,int,int) to authenticated;

-- ── 3. CARE EVENTS ───────────────────────────────────────────────────────────
-- What the owner DID, with amounts and times. Needed to separate "this plant is
-- in a bad spot" from "this plant is well placed but under-watered", which the
-- telemetry alone cannot distinguish.
-- ⚠ OWNED BY supabase/schema.sql NOW. That file adds the columns that make a
--   watering gradeable (suggested_ml, amount_source, rise_points, saturated) and
--   the unique key the app upserts on. This definition is the older, narrower
--   one; `if not exists` means it will not undo the newer shape.
create table if not exists public.care_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  plant_key text not null,
  kind text not null,                      -- water | feed | repot | prune | move | mist
  ml int,                                  -- for waterings
  note text,
  at timestamptz not null default now()
);
alter table public.care_events enable row level security;
drop policy if exists "own care events" on public.care_events;
create policy "own care events" on public.care_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists care_events_lookup on public.care_events (plant_key, at desc);

-- ── 4. OUTCOMES — the labels ─────────────────────────────────────────────────
-- Without these, all the telemetry in the world is unsupervised. Every plant
-- that dies WITHOUT a recorded cause is a permanently lost training example, so
-- the app's autopsy flow matters more than it looks.
-- ⚠ SUPERSEDED, kept only so an existing database still parses this file.
--   Nothing in the app has ever written to this table, and section 5 no longer
--   reads it. Its job is done by `plant_health_log` in supabase/schema.sql, which
--   `lib/research.ts` does write. Left in place rather than dropped because
--   dropping a table is not something a schema file should do quietly.
create table if not exists public.plant_outcomes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  plant_key text not null,
  species text not null,
  status text not null,                    -- thriving | struggling | recovered | died | gifted
  cause text,                              -- overwatering | underwatering | too dark | pests | cold | unknown
  days_owned int,
  -- conditions over the plant's life, so an outcome can be tied to environment
  avg_soil numeric, avg_light numeric, avg_temp numeric, avg_humidity numeric,
  at timestamptz not null default now()
);
alter table public.plant_outcomes enable row level security;
drop policy if exists "own outcomes" on public.plant_outcomes;
create policy "own outcomes" on public.plant_outcomes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists plant_outcomes_species on public.plant_outcomes (species, status);

-- ── 5. THE AGGREGATES — what the moat actually produces ──────────────────────
-- Read ONLY from opted-in users, and only ever in aggregate.
--
-- ⚠ RUN `supabase/schema.sql` FIRST. These read the tables it defines; the guard
--   below stops with a clear message rather than half-applying.
--
-- ─────────────────── WHY THESE READ DIFFERENT TABLES NOW ─────────────────────
--
-- They used to read `plant_outcomes` and `plant_configs`, defined above. Checked
-- against the live database on 2026-09-05: both are EMPTY, and grepping the app
-- explains why — nothing anywhere writes to either of them, and nothing ever
-- did. `snapshot_plant_config()` has no caller either.
--
-- So the whole chain was decorative. `loadEmpiricalBands()` queried
-- `species_env_stats`, which aggregated `plant_outcomes`, which no code path
-- could ever populate, so the measured bands were guaranteed to stay empty
-- forever and every plant silently kept its book values. Nothing failed. That is
-- what made it survive: a pipeline with no writer looks exactly like a pipeline
-- with no users yet.
--
-- What DOES get written is the newer research schema in `supabase/schema.sql`,
-- pushed by `lib/research.ts` from `useResearchSync`. It is a strict superset of
-- what was intended here — `plant_health_log` carries the labels `plant_outcomes`
-- was for, `plant_profiles` the versioned configuration `plant_configs` was for,
-- and `plant_measurements` carries measured pot physics that had no equivalent
-- at all. So these three read that instead, and the two older tables are left in
-- place but deprecated (see the note in section 2).
--
-- ─────────────────────────── WHY THIS IS SHAPED ODDLY ────────────────────────
--
-- These results have to cross user boundaries — an average over one person's
-- plants is not evidence — while every base table is protected by RLS that
-- (correctly) limits a signed-in user to their own rows. Something has to be
-- allowed to see past that.
--
-- The first version let a plain view do it. A Postgres view executes as its
-- OWNER unless told otherwise, so `create view` over an RLS-protected table
-- silently grants an elevation nobody wrote down — which is what Supabase's
-- advisor flags as `security_definer_view`, and it is right to. The elevation
-- was real, undeclared, and applied to the whole view body, so any later edit
-- that let a raw row through would have leaked it with no warning at all.
--
-- So the elevation is now explicit and confined:
--
--   * the aggregation lives in a SECURITY DEFINER function in schema
--     `research`, which is NOT exposed through the API — it cannot be called
--     over HTTP, only from inside the database;
--   * each function pins `search_path = ''` so nothing it references can be
--     shadowed by a caller-controlled schema (the standard SECURITY DEFINER
--     hijack);
--   * the `public` views that PostgREST serves are `security_invoker = on`,
--     i.e. they carry no privilege of their own. All they do is call the
--     function, so the only elevated code in the system is the aggregate itself.
--
-- ────────────────────── AND WHY THE COUNTS CHANGED ───────────────────────────
--
-- The k-anonymity gate used to read `having count(*) >= 20`. `count(*)` counts
-- ROWS, and none of these tables holds one row per plant — `plant_health_log` is
-- written periodically for as long as a plant lives, precisely so a slow decline
-- is a time series rather than a death certificate. A single well-tended plant
-- logged fortnightly for a year is twenty-six rows, and would have cleared a
-- threshold meant to guarantee twenty PLANTS entirely on its own.
--
-- That matters precisely BECAUSE of the elevation above: everything behind the
-- gate is readable by every signed-in user. So each aggregate now collapses to
-- one row per plant first, gates on distinct plants, and requires several
-- distinct GROWERS as well — twenty plants belonging to one household is still
-- one person's data.
--
-- Collapsing per plant fixes a statistical error too, not only a privacy one.
-- Percentiles taken over raw log rows weight each plant by how often it was
-- logged, so the most fussed-over plants quietly become the species' definition
-- of normal.

do $guard$
begin
  if to_regclass('public.plant_health_log') is null then
    raise exception
      'Run supabase/schema.sql first — public.plant_health_log does not exist, and sections 5-6 of this file read it.';
  end if;
end
$guard$;

create schema if not exists research;
revoke all on schema research from public;
grant usage on schema research to authenticated;

-- 5a. EMPIRICAL CARE BANDS. Replaces textbook ranges with what actually worked:
--     "across N Monsteras that thrived, soil sat at 34–48%" — a number no
--     competitor can obtain without sensors in homes.
create or replace function research.species_env_stats()
returns table (
  species        text,
  sample_plants  bigint,
  sample_growers bigint,
  soil_p25       numeric, soil_median numeric, soil_p75 numeric,
  light_p25      numeric, light_median numeric, light_p75 numeric,
  temp_p25       numeric, temp_p75 numeric,
  rh_p25         numeric, rh_p75 numeric
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with per_plant as (
    -- one row per plant: the average of the conditions it lived in across every
    -- window it was recorded as doing well
    select h.user_id, h.plant_key, h.species,
           avg(h.avg_soil)     as avg_soil,
           avg(h.avg_light)    as avg_light,
           avg(h.avg_temp)     as avg_temp,
           avg(h.avg_humidity) as avg_humidity
      from public.plant_health_log h
      join public.profiles p on p.user_id = h.user_id and p.research_opt_in
     where h.status in ('thriving', 'recovered')   -- learn from what WORKED
       and coalesce(h.days_owned, 0) >= 30         -- long enough to mean something
     group by h.user_id, h.plant_key, h.species
  )
  select
    q.species,
    count(*)::bigint,
    count(distinct q.user_id)::bigint,
    (percentile_cont(0.25) within group (order by q.avg_soil))::numeric,
    (percentile_cont(0.50) within group (order by q.avg_soil))::numeric,
    (percentile_cont(0.75) within group (order by q.avg_soil))::numeric,
    (percentile_cont(0.25) within group (order by q.avg_light))::numeric,
    (percentile_cont(0.50) within group (order by q.avg_light))::numeric,
    (percentile_cont(0.75) within group (order by q.avg_light))::numeric,
    (percentile_cont(0.25) within group (order by q.avg_temp))::numeric,
    (percentile_cont(0.75) within group (order by q.avg_temp))::numeric,
    (percentile_cont(0.25) within group (order by q.avg_humidity))::numeric,
    (percentile_cont(0.75) within group (order by q.avg_humidity))::numeric
  from per_plant q
  group by q.species
  having count(*) >= 20                        -- twenty distinct plants…
     and count(distinct q.user_id) >= 5;       -- …from at least five households
$fn$;

-- 5b. SURVIVAL BY SPECIES × REGION. Powers "what actually thrives in YOUR area"
--     with evidence rather than care-sheet opinion.
create or replace function research.species_area_survival()
returns table (
  species        text,
  climate_zone   int,
  indoor         boolean,
  sample_plants  bigint,
  sample_growers bigint,
  success_rate   numeric,
  avg_days_owned numeric
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with latest as (
    -- the most recent verdict per plant, not every verdict it ever had
    select distinct on (h.user_id, h.plant_key)
           h.user_id, h.plant_key, h.species, h.status, h.days_owned, h.at,
           p.climate_zone
      from public.plant_health_log h
      join public.profiles p on p.user_id = h.user_id and p.research_opt_in
     where coalesce(h.days_owned, 0) >= 30
     order by h.user_id, h.plant_key, h.at desc
  ),
  placed as (
    select l.*, pp.indoor
      from latest l
      join lateral (
        -- where it actually stood when the verdict was recorded, not where the
        -- plant happens to live today
        select pp2.indoor
          from public.plant_profiles pp2
         where pp2.user_id = l.user_id
           and pp2.plant_key = l.plant_key
           and pp2.valid_from <= l.at
         order by pp2.valid_from desc
         limit 1
      ) pp on true
  )
  select
    pl.species,
    pl.climate_zone,
    pl.indoor,
    count(*)::bigint,
    count(distinct pl.user_id)::bigint,
    avg(case when pl.status in ('thriving', 'recovered') then 1.0 else 0 end)::numeric,
    avg(pl.days_owned)::numeric
  from placed pl
  group by pl.species, pl.climate_zone, pl.indoor
  having count(*) >= 15
     and count(distinct pl.user_id) >= 5;
$fn$;

-- 5c. LEARNED POT PHYSICS. This is the one that changed most.
--
--     It used to return the median SOIL LEVEL per pot configuration, which is
--     nearly useless — a level is a reading, not a property, and it says nothing
--     about how much water the pot takes or how long it holds it. The newer
--     schema records what the app actually measures per pot (`ml_per_point`,
--     `dry_down_days`, the demand-normalised drying rate), so this now returns
--     those: real constants, aggregated across every pot of the same shape and
--     mix, which is the prior `lib/waterBalance.ts` wants for a pot it has not
--     yet observed.
--
--     Only pots whose figures came from real logged pours are included. A
--     'modelled' ml-per-point is the app's own physics; aggregating it would
--     re-discover the app's assumptions and present them back as evidence.
create or replace function research.drying_constants()
returns table (
  species              text,
  pot_material         text,
  soil_mix             text,
  has_drainage         boolean,
  pot_size_bucket      int,
  sample_plants        bigint,
  sample_growers       bigint,
  ml_per_point_median  numeric,
  dry_down_days_median numeric,
  interval_days_median numeric,
  typical_retention    text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with per_plant as (
    select m.user_id, m.plant_key,
           pp.species, pp.pot_material, pp.soil_mix, pp.has_drainage,
           pg_catalog.width_bucket(coalesce(pp.pot_diameter_cm, 15), 5, 40, 7) as bucket,
           avg(m.ml_per_point)  as ml_per_point,
           avg(m.dry_down_days) as dry_down_days,
           avg(m.interval_days) as interval_days,
           mode() within group (order by m.retention_class) as retention_class
      from public.plant_measurements m
      join public.profiles p on p.user_id = m.user_id and p.research_opt_in
      join lateral (
        -- the pot it was in AT THE TIME of the measurement; a repot must not
        -- retro-label older figures with the new container
        select pp2.species, pp2.pot_material, pp2.soil_mix,
               pp2.has_drainage, pp2.pot_diameter_cm
          from public.plant_profiles pp2
         where pp2.user_id = m.user_id
           and pp2.plant_key = m.plant_key
           and pp2.valid_from <= m.measured_at
           and (pp2.valid_to is null or m.measured_at < pp2.valid_to)
         order by pp2.valid_from desc
         limit 1
      ) pp on true
     where m.ml_per_point_basis in ('measured', 'blended')
     group by m.user_id, m.plant_key, pp.species, pp.pot_material, pp.soil_mix,
              pp.has_drainage,
              pg_catalog.width_bucket(coalesce(pp.pot_diameter_cm, 15), 5, 40, 7)
  )
  select
    q.species,
    q.pot_material,
    q.soil_mix,
    q.has_drainage,
    q.bucket,
    count(*)::bigint,
    count(distinct q.user_id)::bigint,
    (percentile_cont(0.50) within group (order by q.ml_per_point))::numeric,
    (percentile_cont(0.50) within group (order by q.dry_down_days))::numeric,
    (percentile_cont(0.50) within group (order by q.interval_days))::numeric,
    mode() within group (order by q.retention_class)
  from per_plant q
  group by q.species, q.pot_material, q.soil_mix, q.has_drainage, q.bucket
  having count(*) >= 15
     and count(distinct q.user_id) >= 5;
$fn$;

-- Only signed-in users, and only through these functions. `public` (which
-- includes the anonymous role) gets nothing: an unauthenticated caller has no
-- business reading even k-anonymised aggregates.
revoke all on function research.species_env_stats()     from public;
revoke all on function research.species_area_survival() from public;
revoke all on function research.drying_constants()      from public;
grant execute on function research.species_env_stats()     to authenticated;
grant execute on function research.species_area_survival() to authenticated;
grant execute on function research.drying_constants()      to authenticated;

-- ── 6. THE API SURFACE ───────────────────────────────────────────────────────
-- Thin, privilege-free views, so the app keeps calling `.from('species_env_stats')`
-- rather than an RPC. `security_invoker = on` is the whole point: these carry no
-- rights of their own, so the only elevated code is the three functions above.
-- Dropped rather than replaced because the column lists changed and
-- `create or replace view` cannot widen one.
drop view if exists public.species_env_stats;
drop view if exists public.species_area_survival;
drop view if exists public.drying_constants;

create view public.species_env_stats with (security_invoker = on) as
  select * from research.species_env_stats();
create view public.species_area_survival with (security_invoker = on) as
  select * from research.species_area_survival();
create view public.drying_constants with (security_invoker = on) as
  select * from research.drying_constants();

comment on view public.species_env_stats is
  'Measured care bands per species, from opted-in growers only. Gated at 20 distinct plants across 5+ households.';
comment on view public.species_area_survival is
  'Success rate per species x climate zone x indoor/outdoor. Gated at 15 distinct plants across 5+ households.';
comment on view public.drying_constants is
  'Measured pot physics — ml per display point, dry-down days, watering interval — per species and container. Measured pours only.';

-- Any signed-in user may read them: they are k-anonymised by the HAVING clauses
-- above and carry no identifiers. Anonymous callers are not signed in, and get
-- nothing.
revoke all on public.species_env_stats     from anon;
revoke all on public.species_area_survival from anon;
revoke all on public.drying_constants      from anon;
grant select on public.species_env_stats     to authenticated;
grant select on public.species_area_survival to authenticated;
grant select on public.drying_constants      to authenticated;
