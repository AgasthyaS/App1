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

alter table public.care_events enable row level security;
drop policy if exists "own care events" on public.care_events;
create policy "own care events" on public.care_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists care_events_lookup on public.care_events (plant_key, at desc);


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
-- ═══════════════════════════════════════════════════════════════════════════

-- How much data is there, per species? ──────────────────────────────────────
-- Read this FIRST. Everything below is gated on sample size, so an empty result
-- there means "not enough data yet", not "this species has no requirements".
-- This view is the honest picture of how far the dataset has actually got.
create or replace view public.v_data_coverage as
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
create or replace view public.v_thriving_conditions as
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
create or replace view public.v_watering_norms as
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
create or replace view public.v_survival_by_region as
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
create or replace view public.v_what_kills as
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
create or replace view public.v_advice_accuracy as
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
