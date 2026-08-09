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

-- 5a. EMPIRICAL CARE BANDS. Replaces textbook ranges with what actually worked:
--     "across N Monsteras that thrived, soil sat at 34–48%" — a number no
--     competitor can obtain without sensors in homes.
create or replace view public.species_env_stats as
select
  o.species,
  count(*)                                             as sample_plants,
  percentile_cont(0.25) within group (order by o.avg_soil)     as soil_p25,
  percentile_cont(0.50) within group (order by o.avg_soil)     as soil_median,
  percentile_cont(0.75) within group (order by o.avg_soil)     as soil_p75,
  percentile_cont(0.25) within group (order by o.avg_light)    as light_p25,
  percentile_cont(0.50) within group (order by o.avg_light)    as light_median,
  percentile_cont(0.75) within group (order by o.avg_light)    as light_p75,
  percentile_cont(0.25) within group (order by o.avg_temp)     as temp_p25,
  percentile_cont(0.75) within group (order by o.avg_temp)     as temp_p75,
  percentile_cont(0.25) within group (order by o.avg_humidity) as rh_p25,
  percentile_cont(0.75) within group (order by o.avg_humidity) as rh_p75
from public.plant_outcomes o
join public.profiles p on p.user_id = o.user_id and p.research_opt_in
where o.status in ('thriving', 'recovered')          -- learn from what WORKED
  and o.days_owned >= 30                             -- long enough to mean something
group by o.species
having count(*) >= 20;                               -- never expose thin samples

-- 5b. SURVIVAL BY SPECIES × REGION. Powers "what actually thrives in YOUR area"
--     with evidence rather than care-sheet opinion.
create or replace view public.species_area_survival as
select
  o.species,
  c.climate_zone,
  c.indoor,
  count(*)                                                          as sample_plants,
  avg(case when o.status in ('thriving','recovered') then 1.0 else 0 end) as success_rate,
  avg(o.days_owned)                                                 as avg_days_owned
from public.plant_outcomes o
join public.profiles p on p.user_id = o.user_id and p.research_opt_in
join lateral (
  select climate_zone, indoor from public.plant_configs
   where plant_key = o.plant_key and user_id = o.user_id
   order by valid_from desc limit 1
) c on true
where o.days_owned >= 30
group by o.species, c.climate_zone, c.indoor
having count(*) >= 15;

-- 5c. LEARNED DRYING CONSTANTS. Turns the hand-tuned pot physics in
--     lib/soilDynamics into measured truth per pot configuration.
create or replace view public.drying_constants as
select
  c.species, c.pot_material, c.soil_mix, c.has_drainage,
  width_bucket(coalesce(c.pot_cm, 15), 5, 40, 7)      as pot_size_bucket,
  count(*)                                            as sample_plants,
  percentile_cont(0.50) within group (order by o.avg_soil) as median_soil
from public.plant_configs c
join public.plant_outcomes o on o.plant_key = c.plant_key and o.user_id = c.user_id
join public.profiles p on p.user_id = c.user_id and p.research_opt_in
group by c.species, c.pot_material, c.soil_mix, c.has_drainage, pot_size_bucket
having count(*) >= 15;

-- Aggregates are safe to read by any signed-in user (they are k-anonymised by
-- the HAVING clauses above and contain no identifiers).
grant select on public.species_env_stats     to authenticated;
grant select on public.species_area_survival to authenticated;
grant select on public.drying_constants      to authenticated;
