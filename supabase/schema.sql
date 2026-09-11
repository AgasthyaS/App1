-- ═══════════════════════════════════════════════════════════════════════════
--  GREENR — HOW PLANTS ACTUALLY THRIVE
--  Supabase → SQL Editor → New query → paste all → Run.  Safe to re-run.
--  Supersedes supabase-moat.sql (that file's tables are reused, not dropped).
-- ═══════════════════════════════════════════════════════════════════════════
--
--  THE IDEA IN ONE PARAGRAPH
--  Care advice for houseplants is almost entirely inherited opinion: a care card
--  says "bright indirect light, water when the top inch is dry" and nobody ever
--  checked. This database is the apparatus for checking. It records, for real
--  plants in real homes: what the plant IS (species, pot, soil), what conditions
--  it LIVED IN (from the sensor), what the owner DID (with amounts), what the app
--  MEASURED about the pot, and how the plant ENDED UP. Aggregate those and you
--  can answer "what conditions do thriving Monsteras actually live in?" with
--  evidence instead of folklore.
--
--  HOW THE SIX TABLES FIT TOGETHER
--
--      profiles ─────── one row per account: consent + climate zone
--          │
--          ├── plant_profiles ── what a plant is, versioned on every repot
--          │        │
--          │        ├── care_events ────── what the owner did, and when
--          │        ├── plant_measurements ─ what the app measured about the pot
--          │        └── plant_health_log ─── how it was doing, over time
--          │
--          └── devices ── readings          (already live — the raw telemetry)
--
--  WHY CONFIGURATION IS VERSIONED
--  A reading only means something next to what the plant was in AT THAT TIME.
--  Repot a Monstera from a 12 cm plastic pot into a 20 cm terracotta one and
--  every earlier reading must still resolve to the OLD pot, or the whole history
--  becomes unlabelled noise. So `plant_profiles` rows are never edited — a change
--  closes the current row and opens a new one.
--
--  PRIVACY
--  Every aggregate view reads ONLY from accounts that set `research_opt_in`, and
--  only ever in aggregate with a minimum sample size. No view exposes a user id,
--  a location finer than a climate zone, a plant name, or a photo.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
--  1. PROFILES — who, anonymously, and whether they agreed
-- ───────────────────────────────────────────────────────────────────────────
--  Deliberately thin. Everything here is either consent or the coarsest possible
--  geography, because "does this species do well where I live?" needs a region
--  and nothing finer.
create table if not exists public.profiles (
  user_id        uuid primary key references auth.users on delete cascade,
  research_opt_in boolean not null default false,
  climate_zone   int,          -- USDA-style hardiness zone, 1–13
  hemisphere     text,         -- 'N' | 'S' — decides which months are "winter"
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.profiles is
  'One row per account. Consent to research use, plus the coarsest geography needed for regional answers.';

-- CONVERGE AN EXISTING DATABASE, not just an empty one.
--
-- `create table if not exists` is a no-op against a table that already exists —
-- it does NOT add the new columns — and that is not a hypothetical: an earlier
-- `profiles` from supabase-moat.sql was already deployed with three columns, so
-- this file ran clean, changed nothing, and every research upload afterwards
-- failed with "column climate_zone does not exist". Silently, because
-- `syncResearch` swallows its errors by design.
--
-- So every table below is followed by idempotent `add column if not exists`
-- statements. Running this file twice is safe; running it over the old schema
-- now actually migrates it.
alter table public.profiles add column if not exists climate_zone int;
alter table public.profiles add column if not exists hemisphere   text;
alter table public.profiles add column if not exists created_at   timestamptz not null default now();

alter table public.profiles enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ───────────────────────────────────────────────────────────────────────────
--  2. PLANT_PROFILES — what a plant IS, versioned
-- ───────────────────────────────────────────────────────────────────────────
--  One row per plant per configuration. `valid_to` is null on the current row.
--  Never UPDATE the description fields — close the row and open a new one, so a
--  reading from March still resolves to the pot it was in during March.
create table if not exists public.plant_profiles (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users on delete cascade,
  plant_key     text not null,          -- the app's plant id, stable across repots
  species       text not null,
  latin         text,
  -- the container
  pot_diameter_cm numeric,
  pot_height_cm   numeric,
  pot_shape       text,                 -- straight | tapered | very-tapered
  pot_material    text,                 -- Terracotta | Plastic | Ceramic
  pot_liters      numeric,              -- derived, stored so analysis needn't recompute
  has_drainage    boolean,
  -- the medium
  soil_mix        text,                 -- Standard mix | Gritty / cactus | Chunky / aroid | Dense / heavy
  soil_retention  text,                 -- fast | typical | retentive | very-retentive
  -- where it lives
  indoor          boolean,
  room            text,                 -- free text, e.g. 'Living room' — never an address
  -- validity window
  valid_from      timestamptz not null default now(),
  valid_to        timestamptz
);
comment on table public.plant_profiles is
  'What a plant is: species, pot, soil, placement. Versioned — a repot closes one row and opens another, so old readings stay interpretable.';

alter table public.plant_profiles enable row level security;
drop policy if exists "own plant profiles" on public.plant_profiles;
create policy "own plant profiles" on public.plant_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists plant_profiles_current
  on public.plant_profiles (plant_key, valid_from desc);
create index if not exists plant_profiles_species
  on public.plant_profiles (species);


-- ───────────────────────────────────────────────────────────────────────────
--  3. CARE_EVENTS — what the owner actually did
-- ───────────────────────────────────────────────────────────────────────────
--  Telemetry alone cannot tell "this plant is in a bad spot" from "this plant is
--  well placed but under-watered". This table is what separates them.
--
--  `amount_source` is load-bearing. 'assumed' means the app filled in its own
--  suggestion because nobody stated an amount — analysing those as if they were
--  measurements would just re-discover the app's own recommendations.
create table if not exists public.care_events (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users on delete cascade,
  plant_key     text not null,
  kind          text not null,          -- water | feed | repot | prune | move | mist
  at            timestamptz not null default now(),
  -- watering detail
  ml            int,                    -- what was actually poured
  suggested_ml  int,                    -- what Greenr recommended at that moment
  amount_source text,                   -- measured | preset | assumed
  -- what the soil did afterwards, once the sensor confirmed it
  rise_points   numeric,                -- settled rise in display points
  saturated     boolean,                -- the pot filled and the rest ran out
  note          text,
  unique (user_id, plant_key, kind, at)
);
comment on table public.care_events is
  'What the owner did and when. For waterings: poured vs suggested, how the amount was arrived at, and what the soil did in response.';

-- Same migration as above: the old `care_events` had only (ml, note), so the
-- columns that make a watering GRADEABLE were missing and every upsert 400'd.
alter table public.care_events add column if not exists suggested_ml  int;
alter table public.care_events add column if not exists amount_source text;
alter table public.care_events add column if not exists rise_points   numeric;
alter table public.care_events add column if not exists saturated     boolean;

alter table public.care_events enable row level security;
drop policy if exists "own care events" on public.care_events;
create policy "own care events" on public.care_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists care_events_lookup on public.care_events (plant_key, at desc);

-- The de-duplication key the app upserts on. Declared inline above for a fresh
-- database; declared again here as an index so an EXISTING table gets it too —
-- without it PostgREST rejects `on_conflict=user_id,plant_key,kind,at` outright
-- and the app re-sends the same waterings forever.
create unique index if not exists care_events_dedupe
  on public.care_events (user_id, plant_key, kind, at);


-- ───────────────────────────────────────────────────────────────────────────
--  4. PLANT_MEASUREMENTS — what the app measured about THIS pot
-- ───────────────────────────────────────────────────────────────────────────
--  The genuinely novel table. These are not settings and not opinions: they are
--  physical properties of a specific pot, measured from its own drying curve and
--  its own watering responses — millilitres per display point, how long it holds
--  water, where it tops out. Nobody else has these because they require a sensor
--  in the soil and a model that closes the loop.
--
--  `basis` records HOW each figure was arrived at, so weak evidence can be
--  excluded from analysis instead of quietly diluting it.
create table if not exists public.plant_measurements (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users on delete cascade,
  plant_key         text not null,
  measured_at       timestamptz not null default now(),
  -- how much water moves this pot's reading
  ml_per_point      numeric,
  ml_per_point_basis text,              -- measured | blended | bounded | modelled
  clean_pours       int,                -- waterings that produced a usable measurement
  -- how long it holds that water
  retention_class   text,               -- fast | typical | retentive | very-retentive
  dry_down_days     numeric,            -- watered → needing water, at reference humidity
  dry_points_per_day numeric,           -- demand-normalised drying rate
  retention_confident boolean,
  -- where it tops out, and what that implies
  ceiling_pct       numeric,            -- highest reading ever recorded for this pot
  ceiling_confirmed boolean,
  refill_at_pct     numeric,            -- the reading at which watering is due
  capacity_at_pct   numeric,            -- the reading a full watering reaches
  suggested_ml      int,                -- the schedule's amount at time of writing
  interval_days     numeric,            -- the schedule's interval
  unique (user_id, plant_key, measured_at)
);
comment on table public.plant_measurements is
  'Physical properties of a specific pot, measured rather than assumed: ml per display point, how long it holds water, where it tops out.';

-- ── MEASURED SUBSTRATE PROPERTIES ────────────────────────────────────────────
-- Added 2026-09-09, after Prof. Neil Mattson's point that a substrate cannot be
-- modelled from its name: particle size, pore structure and composition decide
-- how water is held, and two bags with the same label behave differently.
--
-- These are the outputs of `lib/substrateCalibration.ts`, which measures them
-- from a known volume of water and the sensor's response rather than asking. The
-- reason they belong in the shared database rather than only on the device is
-- that they are the first properties here that are COMPARABLE ACROSS POTS:
-- ml-per-point depends on how big the pot is, but ml-per-point-per-litre does
-- not, so one grower's Monstera and another's are finally measuring the same
-- quantity. That comparability is what makes an aggregate mean anything.
alter table public.plant_measurements add column if not exists ml_per_point_per_liter numeric;
alter table public.plant_measurements add column if not exists density_class          text;    -- open | light | medium | dense
alter table public.plant_measurements add column if not exists air_filled_porosity     numeric; -- v/v, a LOWER bound at 3-hourly reporting
alter table public.plant_measurements add column if not exists sensed_water_fraction   numeric; -- water to cross the observed range, v/v
alter table public.plant_measurements add column if not exists behaves_like_mix        text;    -- what it acts like, whatever it is called
alter table public.plant_measurements add column if not exists stated_mix              text;    -- what the owner called it
alter table public.plant_measurements add column if not exists substrate_confidence    numeric; -- 0-1
-- Prof. Dana Porter's salt question, and Prof. Scott Jones's insertion question.
alter table public.plant_measurements add column if not exists salt_risk               text;    -- low | watch | likely
alter table public.plant_measurements add column if not exists salt_drift_pts_month    numeric;
alter table public.plant_measurements add column if not exists probe_insertion         text;    -- seated | suspect | likely-shallow

alter table public.plant_measurements enable row level security;
drop policy if exists "own measurements" on public.plant_measurements;
create policy "own measurements" on public.plant_measurements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists plant_measurements_lookup
  on public.plant_measurements (plant_key, measured_at desc);


-- ───────────────────────────────────────────────────────────────────────────
--  5. PLANT_HEALTH_LOG — how it was doing, and in what conditions
-- ───────────────────────────────────────────────────────────────────────────
--  The labels. Without these the telemetry is unsupervised and can never say
--  which conditions were the GOOD ones.
--
--  Written periodically, not only at the end. A plant that quietly declines for
--  four months and then dies teaches far more as a time series than as a single
--  death certificate — and a plant that is still alive teaches nothing at all
--  unless its ongoing state is recorded.
create table if not exists public.plant_health_log (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users on delete cascade,
  plant_key     text not null,
  species       text not null,
  at            timestamptz not null default now(),
  -- the verdict
  status        text not null,          -- thriving | ok | struggling | recovered | died | gifted
  cause         text,                   -- overwatering | underwatering | too dark | cold | pests | unknown
  health_score  int,                    -- 0–100, the app's vitality score
  days_owned    int,
  is_final      boolean not null default false,
  -- the conditions it actually lived in since the previous entry
  window_days   int,
  avg_soil      numeric,
  avg_light     numeric,
  avg_temp      numeric,
  avg_humidity  numeric,
  avg_vpd_kpa   numeric,                -- the number that actually drives drying
  -- how it was cared for over that window
  waterings     int,
  total_ml      int,
  unique (user_id, plant_key, at)
);
comment on table public.plant_health_log is
  'How each plant was doing over time, with the averaged conditions it lived in. The final row is its outcome.';

alter table public.plant_health_log enable row level security;
drop policy if exists "own health log" on public.plant_health_log;
create policy "own health log" on public.plant_health_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists plant_health_species on public.plant_health_log (species, status);
create index if not exists plant_health_lookup on public.plant_health_log (plant_key, at desc);


-- ═══════════════════════════════════════════════════════════════════════════
--  THE ANSWERS — each view is a question, phrased as one
--  All read only from opted-in accounts, all enforce a minimum sample.
--
--  Every view below is `security_invoker = on`, meaning it runs with the
--  PERMISSIONS OF WHOEVER READS IT rather than of whoever created it. Without
--  that, Postgres runs a view as its owner, which quietly bypasses the row-level
--  security on every table underneath — an elevation nobody declared and nobody
--  can see when reading the view. (Supabase's advisor flags exactly this, as
--  `security_definer_view`, and it is right to.)
--
--  The consequence is worth stating plainly: read in the SQL editor, these views
--  see the whole dataset, because the editor connects as the owner. Read through
--  the API by a signed-in user, they see only that user's own rows. That is the
--  correct trade for ANALYSIS views, which is all these are — nothing in the app
--  queries them.
--
--  The three aggregates the app DOES read across users live in supabase-moat.sql
--  and are built the other way round: a confined SECURITY DEFINER function in a
--  private schema, wrapped in a privilege-free public view. Use that pattern if
--  one of these ever needs to answer for everybody at once — never plain view
--  ownership.
-- ═══════════════════════════════════════════════════════════════════════════

-- How much data is there, per species? ──────────────────────────────────────
-- Read this FIRST. Everything below is gated on sample size, so an empty result
-- there means "not enough data yet", not "this species has no requirements".
-- This view is the honest picture of how far the dataset has actually got.
create or replace view public.v_data_coverage with (security_invoker = on) as
select
  h.species,
  count(distinct h.plant_key)                                              as plants,
  count(distinct h.user_id)                                                as growers,
  count(*)                                                                 as health_entries,
  sum(case when h.status in ('thriving','recovered') then 1 else 0 end)    as thriving_entries,
  sum(case when h.status = 'died' then 1 else 0 end)                       as deaths,
  max(h.days_owned)                                                        as longest_days_owned,
  min(h.at)                                                                as first_seen,
  max(h.at)                                                                as last_seen
from public.plant_health_log h
join public.profiles p on p.user_id = h.user_id and p.research_opt_in
group by h.species
order by plants desc;

comment on view public.v_data_coverage is
  'How much evidence exists per species. Check here before trusting — or being puzzled by — an empty result from the views below.';


-- What conditions do THRIVING plants of this species actually live in? ──────
-- The interquartile range, not the mean: it describes where the middle half of
-- successful plants sat, which is what a care band should be.
create or replace view public.v_thriving_conditions with (security_invoker = on) as
select
  h.species,
  count(distinct h.plant_key)                                       as sample_plants,
  percentile_cont(0.25) within group (order by h.avg_soil)     as soil_p25,
  percentile_cont(0.50) within group (order by h.avg_soil)     as soil_median,
  percentile_cont(0.75) within group (order by h.avg_soil)     as soil_p75,
  percentile_cont(0.25) within group (order by h.avg_light)    as light_p25,
  percentile_cont(0.75) within group (order by h.avg_light)    as light_p75,
  percentile_cont(0.25) within group (order by h.avg_temp)     as temp_p25,
  percentile_cont(0.75) within group (order by h.avg_temp)     as temp_p75,
  percentile_cont(0.25) within group (order by h.avg_humidity) as humidity_p25,
  percentile_cont(0.75) within group (order by h.avg_humidity) as humidity_p75,
  percentile_cont(0.50) within group (order by h.avg_vpd_kpa)  as vpd_median
from public.plant_health_log h
join public.profiles p on p.user_id = h.user_id and p.research_opt_in
where h.status in ('thriving', 'recovered')
  and h.days_owned >= 30                       -- long enough for the verdict to mean something
group by h.species
having count(distinct h.plant_key) >= 20;      -- never expose a thin sample

comment on view public.v_thriving_conditions is
  'The conditions the middle half of successful plants of each species actually lived in. Replaces textbook care bands with evidence.';


-- How much water, how often, for a pot this size? ───────────────────────────
-- Grouped by pot volume because the answer is meaningless without it: the same
-- species in a 1 L pot and a 16 L pot are different watering problems.
create or replace view public.v_watering_norms with (security_invoker = on) as
select
  pp.species,
  width_bucket(pp.pot_liters, 0, 20, 10) * 2                    as pot_liters_bucket,
  pp.soil_mix,
  count(distinct m.plant_key)                                   as sample_plants,
  percentile_cont(0.50) within group (order by m.ml_per_point)  as ml_per_point_median,
  percentile_cont(0.50) within group (order by m.dry_down_days) as dry_down_days_median,
  percentile_cont(0.50) within group (order by m.interval_days) as interval_days_median,
  percentile_cont(0.50) within group (order by m.suggested_ml)  as ml_per_watering_median,
  mode() within group (order by m.retention_class)              as typical_retention
from public.plant_measurements m
join public.profiles p on p.user_id = m.user_id and p.research_opt_in
join public.plant_profiles pp
  on pp.plant_key = m.plant_key and pp.user_id = m.user_id
 and m.measured_at >= pp.valid_from
 and (pp.valid_to is null or m.measured_at < pp.valid_to)
where m.ml_per_point_basis in ('measured', 'blended')   -- never learn from unmeasured pots
group by pp.species, 2, pp.soil_mix
having count(distinct m.plant_key) >= 10;

comment on view public.v_watering_norms is
  'Measured watering behaviour by species, pot size and soil mix. Only pots whose figures came from real logged pours.';


-- Does this species do well where I live? ───────────────────────────────────
create or replace view public.v_survival_by_region with (security_invoker = on) as
select
  h.species,
  p.climate_zone,
  pp.indoor,
  count(distinct h.plant_key)                                                    as sample_plants,
  avg(case when h.status in ('thriving','recovered') then 1.0 else 0 end)        as success_rate,
  avg(h.days_owned)                                                              as avg_days_owned
from public.plant_health_log h
join public.profiles p on p.user_id = h.user_id and p.research_opt_in
join public.plant_profiles pp
  on pp.plant_key = h.plant_key and pp.user_id = h.user_id and pp.valid_to is null
where h.is_final
  and h.days_owned >= 30
group by h.species, p.climate_zone, pp.indoor
having count(distinct h.plant_key) >= 15;

comment on view public.v_survival_by_region is
  'Real success rates by species, climate zone and indoor/outdoor — evidence rather than care-sheet opinion.';


-- What actually kills this species? ─────────────────────────────────────────
-- Every plant that dies without a recorded cause is a training example lost for
-- good, which is why the autopsy flow matters more than it looks.
create or replace view public.v_what_kills with (security_invoker = on) as
select
  h.species,
  coalesce(h.cause, 'unrecorded')                    as cause,
  count(*)                                           as deaths,
  round(100.0 * count(*) / sum(count(*)) over (partition by h.species), 1) as pct_of_deaths,
  avg(h.days_owned)                                  as avg_days_survived
from public.plant_health_log h
join public.profiles p on p.user_id = h.user_id and p.research_opt_in
where h.status = 'died'
group by h.species, coalesce(h.cause, 'unrecorded')
having (select count(*) from public.plant_health_log h2
         where h2.species = h.species and h2.status = 'died') >= 10
order by h.species, deaths desc;

comment on view public.v_what_kills is
  'Recorded causes of death per species, as a share of all deaths for that species.';


-- Is the app''s own watering advice any good? ────────────────────────────────
-- Grades Greenr, not the plant. `poured ÷ suggested` says whether people follow
-- the advice; the saturation rate says whether following it floods the pot.
create or replace view public.v_advice_accuracy with (security_invoker = on) as
select
  pp.species,
  count(*)                                                                  as graded_waterings,
  count(distinct c.plant_key)                                               as sample_plants,
  percentile_cont(0.50) within group (order by c.ml::numeric / nullif(c.suggested_ml, 0)) as poured_over_suggested,
  avg(case when c.saturated then 1.0 else 0 end)                            as saturation_rate
from public.care_events c
join public.profiles p on p.user_id = c.user_id and p.research_opt_in
join public.plant_profiles pp
  on pp.plant_key = c.plant_key and pp.user_id = c.user_id and pp.valid_to is null
where c.kind = 'water'
  and c.amount_source in ('measured', 'preset')   -- an assumed amount grades nothing
  and c.suggested_ml > 0
group by pp.species
having count(*) >= 20;

comment on view public.v_advice_accuracy is
  'How Greenr''s own watering amounts held up: how closely people followed them, and how often following them filled the pot.';


-- What does a compost SOLD AS this actually behave like? ────────────────────
-- The most commercially interesting question in this database, and one nobody
-- without sensors in homes can answer. Growers buy a bag labelled "houseplant
-- compost" and the app is asked to model it; this measures what came out of the
-- bag. A named mix whose pots mostly behave like something else is not a
-- labelling curiosity — it is the reason care advice keyed to the name fails.
create or replace view public.v_mix_reality with (security_invoker = on) as
select
  m.stated_mix,
  count(distinct m.plant_key)                                            as sample_plants,
  count(distinct m.user_id)                                              as growers,
  mode() within group (order by m.behaves_like_mix)                      as usually_behaves_like,
  round(100.0 * sum(case when m.behaves_like_mix is distinct from m.stated_mix then 1 else 0 end)
        / nullif(count(*), 0), 1)                                        as pct_behaving_otherwise,
  percentile_cont(0.25) within group (order by m.ml_per_point_per_liter) as ml_per_point_per_liter_p25,
  percentile_cont(0.50) within group (order by m.ml_per_point_per_liter) as ml_per_point_per_liter_median,
  percentile_cont(0.75) within group (order by m.ml_per_point_per_liter) as ml_per_point_per_liter_p75,
  percentile_cont(0.50) within group (order by m.dry_down_days)          as dry_down_days_median,
  mode() within group (order by m.density_class)                         as usual_density
from public.plant_measurements m
join public.profiles p on p.user_id = m.user_id and p.research_opt_in
where m.stated_mix is not null
  and m.ml_per_point_basis in ('measured', 'blended')
  and m.substrate_confidence >= 0.5
group by m.stated_mix
having count(distinct m.plant_key) >= 10;

comment on view public.v_mix_reality is
  'What a compost sold under each name actually does, measured in real pots. The share behaving unlike their label is the number that says why name-keyed care advice fails.';


-- Which species thrive in which MEASURED substrate, not which named one? ────
-- The scientifically stronger version of `v_thriving_conditions`: it groups by
-- what the medium was measured to be rather than by what its owner called it,
-- which removes the largest single source of noise in the whole dataset.
create or replace view public.v_thriving_by_substrate with (security_invoker = on) as
select
  h.species,
  m.density_class,
  count(distinct h.plant_key)                                       as sample_plants,
  count(distinct h.user_id)                                         as growers,
  avg(case when h.status in ('thriving','recovered') then 1.0 else 0 end) as success_rate,
  percentile_cont(0.50) within group (order by m.dry_down_days)     as dry_down_days_median,
  percentile_cont(0.50) within group (order by m.interval_days)     as interval_days_median,
  percentile_cont(0.50) within group (order by h.avg_soil)          as soil_median
from public.plant_health_log h
join public.profiles p on p.user_id = h.user_id and p.research_opt_in
join lateral (
  select m2.*
    from public.plant_measurements m2
   where m2.user_id = h.user_id and m2.plant_key = h.plant_key
     and m2.measured_at <= h.at
     and m2.density_class is not null
   order by m2.measured_at desc
   limit 1
) m on true
where coalesce(h.days_owned, 0) >= 30
group by h.species, m.density_class
having count(distinct h.plant_key) >= 10;

comment on view public.v_thriving_by_substrate is
  'Success rate per species against the substrate actually MEASURED in the pot, rather than the one it was labelled with. The label is the noisiest field in the dataset; this removes it.';


-- Where sensors are being defeated ─────────────────────────────────────────
-- Aggregates the two hardware failures the professors raised: salts drifting the
-- readings, and probes not pushed far enough in. Both are invisible per-pot and
-- obvious in aggregate, and both tell the hardware side what to change.
create or replace view public.v_sensor_conditions with (security_invoker = on) as
select
  m.stated_mix,
  count(distinct m.plant_key)                                                     as sample_plants,
  count(distinct m.user_id)                                                       as growers,
  avg(case when m.salt_risk = 'likely' then 1.0 else 0 end)                       as salt_rate,
  percentile_cont(0.50) within group (order by m.salt_drift_pts_month)            as drift_median,
  avg(case when m.probe_insertion = 'likely-shallow' then 1.0 else 0 end)         as shallow_probe_rate
from public.plant_measurements m
join public.profiles p on p.user_id = m.user_id and p.research_opt_in
where m.salt_risk is not null or m.probe_insertion is not null
group by m.stated_mix
having count(distinct m.plant_key) >= 10;

comment on view public.v_sensor_conditions is
  'How often salts drift the readings and how often probes sit too shallow, per substrate. Per-pot these are invisible; in aggregate they are a hardware roadmap.';
