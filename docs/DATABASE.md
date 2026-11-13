# Greenr database

What is stored, where it comes from, and how the pieces relate. Written so a
developer can use the database without reading the app.

Every statement here is exercised by `tests/db/database.test.ts`, which runs the
project's SQL unmodified against a real Postgres (PGlite) on every `npm test`.

---

## Install order

Run in the Supabase SQL editor, in this order. Every file is safe to re-run; the
test suite runs the whole list twice on a populated database to prove it.

| # | File | Creates |
|---|---|---|
| 1 | `supabase-setup.sql` | `gardens` |
| 2 | `supabase-fix-uploads.sql` | `devices`, `readings`, `ingest_reading`, `register_device` |
| 3 | `supabase-hybrid-sync.sql` | `ingest_batch` |
| 4 | `supabase-device-manager.sql` | `release_device` |
| 5 | `supabase-device-transfer.sql` | `transfer_device` |
| 6 | `supabase-firmware.sql` | `firmware` |
| 7 | `supabase-sharing.sql` | `garden_shares`, `invite_member` |
| 8 | `supabase/schema.sql` | research tables and `v_*` views |
| 9 | `supabase-moat.sql` | `research` schema, gated aggregates |
| 10 | `supabase-delete-user.sql` | `delete_user` |
| 11 | `supabase-analytics.sql` | `analytics_events`, `analytics_admins` |
| 12 | `supabase/migrations/20261112000000_platform.sql` | everything marked **new** below |
| 13 | `supabase/seed/substrates.sql` | fills the substrate reference tables |

`supabase-sensors.sql`, `supabase-sensors-v2.sql` and `supabase-idle-3h.sql` are
superseded by file 2 and need not be run on a new project.

Then, once:

```sql
-- make yourself an operator (data explorer + usage totals)
insert into public.analytics_admins (user_id)
select id from auth.users where email = 'you@example.com' on conflict do nothing;
```

---

## The layers

```
                         auth.users
                             │
        ┌────────────────────┼─────────────────────────────┐
        │                    │                             │
     devices              plants  (new)                 profiles
        │                    │                        (research consent)
        │        ┌───────────┼────────────┬──────────────┐
     readings    │           │            │              │
        │   plant_substrates │   plant_observations  recommendations
        │      (new, versioned)        (new)             (new)
   reading_daily             │
      (new)            plant_profiles · care_events · plant_measurements · plant_health_log
                                              (research, opt-in upload)
   sensor_calibrations (new, versioned, per device)
   plant_identifications · ai_usage · ai_cache (new)
```

A plant is identified everywhere by `(user_id, plant_key)`. `plant_key` is the
app's own id for the plant and never changes.

| Layer | What it is | Rule |
|---|---|---|
| 1 Raw | `readings` | Append-only. Never edited. |
| 2 Context | `plants`, `plant_substrates`, `sensor_calibrations`, `plant_profiles` | Versioned: a change closes a row and opens another. |
| 3 Events | `care_events`, `plant_observations` | What a person did or saw, with a timestamp. |
| 4 Summaries | `reading_daily` | Derived by trigger; can be rebuilt from layer 1 at any time. |
| 5 Decisions | `recommendations`, `model_versions` | What the app advised, the inputs it used, and what happened next. |
| 6 AI | `plant_identifications`, `ai_usage`, `ai_cache` | Written only by the edge function. |
| 7 Reference | `substrate_components`, `substrate_presets`, `firmware` | Generated from code or maintained by hand. |
| 8 Aggregates | `research.*` functions, public wrapper views | Opt-in accounts only, gated on sample size. |

---

## Where each kind of value comes from

Every column falls into one of these. Column comments in the database say which.

| Kind | Meaning | Examples |
|---|---|---|
| **Measured** | A sensor reported it | `readings.soil_raw`, `temp_c`, `humidity_pct` |
| **User-provided** | A person entered or confirmed it | `plants.species`, `plant_substrates.components`, `care_events.ml` |
| **User-reported** | A person saw it | `plant_observations.kind` |
| **Reference** | From published literature | `substrate_components.vg_alpha` |
| **Estimated** | A model produced it from the above | `plant_substrates.properties`, `plant_measurements.dry_down_days` |
| **Model output** | Advice | `recommendations.state` |
| **AI interpretation** | A vision model's reading of a photo | `plant_identifications.candidates` |
| **Derived** | Arithmetic on stored values | `reading_daily.*`, `readings.quality` |

---

## Tables

### `readings` — layer 1

One row per sensor report.

| Column | Type | Kind | Notes |
|---|---|---|---|
| `device_id` | uuid → `devices` | | cascade on device delete |
| `created_at` | timestamptz | | when the reading was **taken** (UTC) |
| `received_at` | timestamptz | | when the server got it. **new** |
| `soil_raw` | int | Measured | ADC counts 0–4095, high = dry. **new** |
| `light_raw` | int | Measured | ADC counts 0–4095, high = dark. Not lux. **new** |
| `temp_c` | numeric | Measured | °C |
| `humidity_pct` | numeric | Measured | % relative humidity |
| `plant_key` | text | Context | the plant the sensor was on at the time. **new** |
| `quality` | smallint | Derived | bit flags, 0 = clean. **new** |
| `soil_pct`, `light_lux` | numeric | | **legacy names** holding the same raw counts; kept for old app builds |
| `dli` | numeric | | unused, firmware sends 0 |
| `battery_pct` | int | Measured | null with current firmware |

`quality` bits: `1` soil outside 0–4095, `2` probe disconnected, `4` probe not in
soil, `8` light at a rail, `16` temperature outside −40…85 °C, `32` humidity
outside 0…100 %. Flagged rows are kept; summaries and aggregates skip them per
metric.

Raw counts are converted to a 0–100 index **in the app**, with the sensor's own
endpoints (`lib/sensing/moisture.ts`). The database stores no converted soil
value, so there is nothing to go stale when a calibration changes.

Index: `(device_id, created_at desc)`, `(plant_key, created_at desc)`.

RLS: owner may select. There is no insert, update or delete policy: rows arrive
only through the ingest functions, and cannot be changed through the API.

### `reading_daily` — layer 4 (new)

One row per device per UTC day, maintained by an insert trigger and recomputed
for the affected day when readings are deleted. Stores sums and counts so that
means are `sum / n` and days combine correctly. `v_reading_daily` exposes the
means.

Use it for any chart longer than a few days. A month is 30 rows instead of 240.

Limitation: days are UTC. A chart drawn in local time is offset by the user's
UTC offset at the day boundary.

### `plants` — layer 2 (new)

`(user_id, plant_key)` primary key. `name`, `species`, `latin`, `status`
(`active | archived | died | gifted`), `identified_by`
(`owner | photo | photo-corrected`), `acquired_on`.

### `plant_substrates` — layer 2 (new, versioned)

What each plant is potted in over time.

| Column | Notes |
|---|---|
| `substrate_key` | `preset:coco-coir`, `mix:coir:20+perlite:30+potting-mix:50`, `class:Standard mix`, or `unknown` |
| `kind` | `class | preset | custom | unknown` |
| `components` | `[{component, fraction}]`, what the owner said |
| `properties` | the model's estimate at the time, with ranges |
| `model_version` | which model produced `properties` |
| `valid_from`, `valid_to` | `valid_to is null` is the current row; a partial unique index allows one |

Write through `set_plant_substrate(...)`, which closes the previous version and
is a no-op when nothing changed.

### `sensor_calibrations` — layer 2 (new, versioned)

Per device, per metric, per kind (`endpoints | offset | curve | inversion`).
`params` holds the values. A reading taken at time T was converted with the row
where `valid_from <= T < valid_to`. Write through `set_sensor_calibration(...)`.

### `plant_observations` — layer 3 (new)

`kind` is one of eleven fixed values (`new-growth`, `wilting`, `yellowing`, …),
`severity` 1–3, optional `note` up to 500 characters. An observation records what
was seen, not a diagnosis.

### `recommendations` — layer 5 (new)

One row each time a plant's advice **changes state**, not one per screen render.

| Column | Notes |
|---|---|
| `state` | one of nine: `water-now`, `drying`, `in-range`, `too-wet`, `not-draining`, `retry`, `waiting`, `inconsistent`, `insufficient-data` |
| `grade` | `high | moderate | low | none`. A checklist count, not a probability |
| `ml`, `days_until_due` | the advice |
| `inputs` | jsonb snapshot of the numbers used |
| `evidence` | `[{key, met}]` for the nine checks |
| `model_version` | e.g. `s2.b2.l2.d2` |
| `response`, `responded_at`, `outcome` | filled later: was it followed, and what did the soil do |

### `plant_identifications`, `ai_usage`, `ai_cache` — layer 6 (new)

See [AI.md](AI.md). Clients can read their own identifications and update only
the decision columns (`user_action`, `accepted_species`, `acted_at`,
`plant_key`). `ai_usage` and `ai_cache` have RLS enabled and no policies, so
only the edge function's service role can touch them.

### Research tables (existing)

`profiles`, `plant_profiles`, `care_events`, `plant_measurements`,
`plant_health_log`. Uploaded only by accounts that opted in. Documented at
length in `supabase/schema.sql`.

---

## History is never overwritten

| Change | What happens |
|---|---|
| Substrate changed or plant repotted | old `plant_substrates` row closed, new one opened |
| Sensor recalibrated | old `sensor_calibrations` row closed, new one opened |
| Sensor moved to another plant | new readings get the new `plant_key`; old readings keep theirs |
| Species re-identified | `plants.species` updates; the attempt and decision stay in `plant_identifications`; the app keeps `speciesHistory` on the plant |
| Model changed | new rows carry a new `model_version`; old rows are untouched |
| Pot changed | `plant_profiles` versioned (existing behaviour) |

To interpret an old reading: join to `sensor_calibrations` and
`plant_substrates` on the time range containing `readings.created_at`.

```sql
select r.created_at, r.soil_raw,
       c.params as endpoints, s.substrate_key
  from readings r
  left join sensor_calibrations c
    on c.device_id = r.device_id and c.metric = 'moisture' and c.kind = 'endpoints'
   and c.valid_from <= r.created_at and (c.valid_to is null or r.created_at < c.valid_to)
  left join devices d on d.id = r.device_id
  left join plant_substrates s
    on s.user_id = d.user_id and s.plant_key = r.plant_key
   and s.valid_from <= r.created_at and (s.valid_to is null or r.created_at < s.valid_to)
 where r.device_id = '…' order by r.created_at;
```

---

## Ingest

Two functions, signatures unchanged from before the migration, so deployed
firmware keeps working.

`ingest_reading(p_device, p_secret, p_light, p_dli, p_soil, p_temp, p_humidity, p_battery, p_secs_ago)`
is called by the sensor with the anon key. It checks the device secret, clamps
`p_secs_ago` to 0…30 days, skips an identical upload within ±20 s, stamps
`plant_key` from the device's current assignment, sets `quality`, and returns
`{read_now, wake_seconds}`.

`ingest_batch(p_device, p_rows)` is called by the phone gateway as the signed-in
owner. Up to 2 000 rows; rows with the same `(device, at)`, an unparseable
timestamp, a future timestamp or one older than 400 days are skipped and counted.

---

## Privacy and access

- RLS is enabled on every table in `public`. A test fails if one is added without it.
- A user reaches only rows where `user_id = auth.uid()`, or readings of devices they own.
- Cross-user results exist only as aggregates from `security definer` functions in
  the `research` schema. They read opted-in accounts only and return a group only
  when it has **at least 15 distinct plants from at least 5 growers** (20 for
  species bands). The unit is the plant: many readings from one pot count once.
- `admin_overview(p_days)` returns counts for accounts in `analytics_admins`. No
  row, email or id leaves it.
- Photos sent for identification are not stored on the server. A private
  `plant-photos` bucket exists, path-scoped to the owner, for future use.

Removing a user id does not make a row anonymous. Research rows carry species,
pot size, a climate zone and a timeline, which together could single someone out
in a small sample. The sample gates are what protect against that, which is why
they are in the database and not in the app.

### Deletion

| Action | Effect |
|---|---|
| Delete account | cascades from `auth.users` to every table above. `ai_usage` keeps the row with `user_id` null, for accounting |
| `delete_plant(plant_key)` | removes that plant's rows from every per-plant table; its readings stay with the device and lose their `plant_key` |
| Release a device | device unassigned; readings stay with the device row |
| `export_my_data()` | one JSON document of everything stored about the caller (device secrets excluded) |

Aggregates are computed on read, so deleted rows drop out of them immediately.
Nothing derived from a user's data is stored outside that user's own rows.

---

## Analytics for operators

In the app: Settings → Usage → Data explorer (`app/explorer.tsx`), for accounts in
`analytics_admins`.

In SQL (the editor connects as owner and sees everything):

```sql
-- how much is measured rather than assumed
select count(*) filter (where retention_confident) as drying_measured,
       count(*) filter (where ml_per_point_basis in ('measured','blended')) as dose_measured,
       count(distinct (user_id, plant_key)) as plants
  from plant_measurements;

-- which sensors produce the most flagged readings
select device_id, count(*) n, round(avg((quality <> 0)::int), 3) flagged
  from readings where created_at > now() - interval '30 days'
 group by 1 having count(*) > 20 order by flagged desc;

-- identification: how often the first answer is accepted, by model
select model, count(*) attempts,
       round(avg((user_action = 'confirmed')::int), 2) accepted_first,
       round(avg((user_action = 'corrected')::int), 2) corrected
  from plant_identifications where user_action is not null group by 1;

-- AI spend per day
select date_trunc('day', created_at) d, model, count(*) calls,
       sum(cost_usd) est_usd, avg(cache_hit::int) cache_rate
  from ai_usage group by 1, 2 order by 1 desc;

-- plants without enough data to learn from
select p.user_id, p.plant_key, p.species
  from plants p
 where p.status = 'active'
   and not exists (select 1 from plant_measurements m
                    where m.user_id = p.user_id and m.plant_key = p.plant_key and m.retention_confident);
```

Gated views any signed-in user may read: `substrate_drying`, `drying_by_vpd`,
`recommendation_outcomes`, `species_env_stats`, `species_area_survival`,
`drying_constants`. An empty result means the sample gate has not been reached.

---

## The learning loop

```
collect ─▶ validate ─▶ contextualise ─▶ store ─▶ analyse ─▶ discover ─▶ improve ─▶ recommend
readings   quality     plant_key,       rows     gated      views       new model   recommendations
           flags       substrate,                aggregates             version     + outcome
                       calibration
```

What closes the loop is `recommendations.outcome` and
`plant_observations`: without them the data describes conditions but never says
which advice worked.

Nothing discovered in the aggregates changes advice automatically. The one
existing path (`lib/empirical.ts` blending a measured species band into the book
band) weights by sample size and starts at 20 plants. Any new use of an
aggregate should ship as a new `model_versions` row so its effect can be compared
on `recommendation_outcomes` and reverted.

---

## Scale

| Devices | Readings per year | Daily rows per year |
|---|---|---|
| 100 | 0.3 M | 36 k |
| 10 000 | 29 M | 3.6 M |
| 100 000 | 290 M | 36 M |

At 3-hourly reporting. One Postgres handles the first two rows comfortably with
the existing indexes. Before the third: partition `readings` by month on
`created_at`, and move rows older than about 13 months to cold storage, since
`reading_daily` already answers every long-range question. No queue, warehouse
or separate analytics database is justified before then.

Backups are Supabase's own (daily, plus point-in-time recovery on paid plans).
`reading_daily` needs no backup of its own: `select rebuild_reading_daily();`
recreates it.

---

## Known gaps

- Research tables key plants by `plant_key` text with no foreign key to `plants`,
  because rows predate that table. New tables follow the same convention for
  consistency.
- `readings.plant_key` for rows before 2026-11-12 was filled from the assignment
  current on that date, which is wrong for any sensor that had been moved.
- The app does not yet read `v_reading_daily`; charts still fetch raw rows. The
  summary is in place and tested, the client switch is not done.
- The migration has been executed against PGlite, not against the live Supabase
  project. Storage policies in particular are untested, because PGlite has no
  storage schema.
