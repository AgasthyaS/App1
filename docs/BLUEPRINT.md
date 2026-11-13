# Greenr technical blueprint

Written 2026-11-11 from an audit of the repository as it stood at commit `bd39c8d`.
This is the plan the overhaul follows. Status marks are updated as phases land:
`[done]`, `[partial]`, `[open]`.

Companion documents: [DATABASE.md](DATABASE.md), [FORMULAS.md](FORMULAS.md),
[AI.md](AI.md), [HARDWARE.md](HARDWARE.md), [DESIGN.md](DESIGN.md).

---

## A. Existing architecture

**Stack.** Expo 53 / React Native 0.79 / expo-router, one codebase for iOS, Android and
web (Vercel). Supabase for auth, Postgres and device ingest. No server code of our own
before this overhaul: every calculation runs in the client.

**Data flow, as built.**

```
sensor ──raw ADC + °C + %RH──▶ firmware ──HTTPS POST──▶ rpc ingest_reading
                                                            │
                                                     public.readings
                                                            │ select (RLS: own devices)
app: normalizeReading (ADC → 0–100 index) ─▶ applyCalibration (offsets)
   ─▶ soilProfile / soilRetention / waterBalance / hydration (models)
   ─▶ waterAction / attention / health (decisions) ─▶ screens
garden state (plants, logs, settings) ── one JSON blob per user ──▶ public.gardens
opt-in research rows ──▶ plant_profiles, care_events, plant_measurements, plant_health_log
```

**Strengths worth preserving.**

- One water decision (`lib/waterAction.ts`) shared by every screen.
- Container physics already modelled: hydrostatic profile, van Genuchten retention,
  De Boodt and Verdonck tensions (10 / 50 / 100 cm), probe-band averaging
  (`lib/soilProfile.ts`).
- Per-pot learning from the pot's own data: dry-down curve fit (`soilRetention`),
  millilitres per point from logged pours (`waterBalance`, `hydration`), ceiling
  detection, probe-insertion checks.
- Provenance already recorded for amounts (`measured | preset | assumed`) and for
  per-point estimates (`measured | blended | bounded | modelled`).
- Research schema with versioned plant configuration and k-anonymity gates counted
  in distinct plants and growers.
- Non-finite values are collapsed to null at the single fetch choke point.

**Weaknesses found.** Severity: H = wrong output or false claim, M = limits accuracy
or growth, L = hygiene.

| # | Sev | Finding | Where |
|---|---|---|---|
| 1 | H | Plant identification is fabricated: after a photo, the wizard shows the same three species with hardcoded 96 / 88 / 81 % "confidence". | `AddPlantWizard.tsx` |
| 2 | H | Photo diagnosis is simulated: a 4 s timer, then invented probabilities and a "leaf-edge browning pattern" nobody looked for. | `app/diagnose/[id].tsx` |
| 3 | H | Daily light is computed as f(mean(index)). The index is logarithmic in lux, so this returns the geometric mean and under-reports light on any day that varies (2–3× on a typical window sill). | `insights.ts`, `lightModel.ts` |
| 4 | H | The firmware in the repo targets a classic ESP32 dev kit (GPIO 34, 39, 19, 21, 22). Three of those pins do not exist on an ESP32-C3 Super Mini, which is the stated current hardware. | `firmware/greenr_sensor.ino` |
| 5 | M | Only four substrate classes. No mineral textures, no component media, no mixtures, no "unknown". | `types.ts`, `soilProfile.ts` |
| 6 | M | Soil ADC endpoints are two global constants (3020 / 1400) for every sensor ever made. Capacitive probes vary unit to unit; the only per-sensor correction is an additive offset in index points. | `devices.ts`, `calibration.ts` |
| 7 | M | Raw readings are stored in columns named `soil_pct` and `light_lux`. They hold ADC counts. The conversion `v <= 100 → already a percentage` guesses which is which. | `readings` table, `devices.ts` |
| 8 | M | Ingest is not idempotent, does no range validation, and does not record which plant a device was on at the time. Re-assigning a sensor re-labels its whole history. | `ingest_reading`, `ingest_batch` |
| 9 | M | Charts download raw rows (up to 2 000) and aggregate in the client. No server-side daily summary. | `getReadingsSince` |
| 10 | M | No recommendation history, so advice can never be scored against what happened next. Observations of the plant itself (wilting, new growth) have no table. | schema |
| 11 | M | The LDR is mapped to lux by a log-linear interpolation of ADC counts with assumed endpoints (80 lx to 65 000 lx). The circuit is a voltage divider; with typical parts it saturates near 1–2 klx. Unverifiable without the hardware, but the top of the scale is very likely wrong. | `lightModel.ts` |
| 12 | M | The "display scale is linear in permittivity" assumption behind the Topp conversion is unverified for this probe's output stage. | `soilProfile.ts` |
| 13 | M | Two light classifiers with different thresholds (`lightStatus` fixed cut-offs, `lightVerdict` species DLI band). | `plantStatus.ts`, `insights.ts` |
| 14 | M | The vitality score rates measured conditions but is worded as plant health ("Thriving", "7 of 9 plants are healthy"). | `health.ts`, Home |
| 15 | M | The decision has two states that matter (water / hold). No "drying, not yet", "readings inconsistent" or "not enough data", and no statement of how well-founded the advice is. | `waterAction.ts` |
| 16 | L | Device id and secret, and TLS with certificate checks disabled, in the firmware source. | firmware |
| 17 | L | No automated tests and no test runner. `formulaCheck.ts` self-checks run only inside the app. | repo |
| 18 | L | Twelve loose SQL files with overlapping definitions; order matters and is undocumented. | repo root |

---

## B. Database architecture

Full detail in [DATABASE.md](DATABASE.md). Summary of the target:

**Principles.** Raw is never overwritten. Every interpretation can be traced to the
calibration, substrate and model version in force at the time. Private by default;
anything read across users is an aggregate gated on distinct plants and growers.
Additive migrations only.

**Layers.**

| Layer | Tables / objects | Written by |
|---|---|---|
| 1 Raw | `readings` (+ `soil_raw`, `light_raw`, `plant_key`, `quality`, `received_at`) | device ingest RPCs |
| 2 Context | `plants`, `plant_substrates`, `sensor_calibrations`, `plant_profiles` (existing) | app |
| 3 Events | `care_events` (existing), `plant_observations` | app |
| 4 Summaries | `reading_daily` (trigger-maintained) | database |
| 5 Decisions | `recommendations`, `model_versions` | app |
| 6 AI | `plant_identifications`, `ai_usage`, `ai_cache`, storage bucket `plant-photos` | edge function |
| 7 Reference | `substrate_components`, `substrate_presets` | migration |
| 8 Analytics | `research.*` functions and `v_*` views, admin RPC | database |

**History strategy.** Versioned rows with `valid_from` / `valid_to` for anything a
reading's meaning depends on (substrate, calibration, pot). A reading resolves to its
context by timestamp, so nothing is stamped onto every row.

**Scale.** One reading per device per 3 h is about 2 900 rows a year. Ten thousand
devices is 29 M rows a year, well within a single Postgres with the existing
`(device_id, created_at desc)` index. `reading_daily` makes month and year charts one
row per day. No warehouse, queue or partitioning is justified yet; the document
states the row count at which monthly partitioning becomes worth doing.

---

## C. Mathematical and scientific architecture

Formula inventory with definitions, units, assumptions and tests: [FORMULAS.md](FORMULAS.md).

**Retained** (sound, already tested by `formulaCheck`): Tetens saturation vapour
pressure and VPD; van Genuchten retention; hydrostatic container profile; De Boodt
tensions; exponential dry-down fit; frustum pot volume; time-weighted daily stats.

**Replaced or extended.**

| Area | Before | After |
|---|---|---|
| Substrate | 4 classes | Component library, 12 USDA textures (Carsel and Parrish 1988), presets, custom mixtures, unknown |
| Mixtures | n/a | Packing model bounded by additive and ideal-nesting limits, then an effective van Genuchten fit. Not a linear average. |
| Soil signal | global endpoints + offset | Explicit stages: raw → validated → index (per-sensor two-point) → optional gravimetric curve → substrate → plant |
| Daily light | f(mean index) | Trapezoid integration of PPFD(t), reported with coverage and a saturation flag |
| Decision | water / hold | Six states plus an evidence grade built from a published checklist, not a made-up percentage |

**Explicitly not done, and why.**

- No claim of volumetric water content. Without a gravimetric calibration the soil
  figure is a relative moisture index and is labelled as one.
- No PPFD claim. Light stays an estimate with a stated factor-of-two band until a
  lux or PAR sensor is fitted.
- Field capacity (330 cm) and wilting point (15 000 cm) are not used for containers.
  A pot drains under its own height, so the container tensions apply instead.
- No Bayesian hierarchy yet. With zero pooled data the prior would be the whole
  answer. The sample-size blend in `empirical.ts` is the correct tool at this scale.

---

## D. Plant intelligence

Five levels, most specific wins when its evidence is good enough:

1. Horticultural reference (category baselines).
2. Species record (curated override, `care.verified`).
3. Substrate (catalog or mixture estimate).
4. Population observation (opt-in aggregates, gated at 15–20 distinct plants and
   5 growers, blended in by sample size).
5. This plant's own history (retention fit, ml per point, ceiling).

Level 5 already overrides the others in `waterAction` once a dry-down and a clean
pour exist. Level 4 can only move a species band, never an individual pot's
measured values.

New collection: observations of the plant itself, recommendation history with the
outcome that followed, substrate and calibration versions, identification results.

---

## E. Application redesign

See [DESIGN.md](DESIGN.md). The existing visual language is competent, so this is a
refinement, not a replacement: one typeface with character, a calmer neutral
palette with green as an accent, photo-led plant cards, and three new surfaces
(identify, substrate, "why this advice").

---

## F. Security and scalability

- Gemini key lives only as a Supabase function secret. The client calls the edge
  function with the user's JWT; the function validates input size, rate-limits per
  user, validates model output against a schema, and never lets the model write to
  the database.
- All new tables have RLS. Cross-user reads go through `security definer` functions
  in the `research` schema with sample gates, never plain view ownership.
- Photos go to a private bucket, path-scoped to the owner.
- Account deletion cascades from `auth.users`; plant deletion and export get RPCs.

---

## G. Testing

| Kind | Tool | Scope |
|---|---|---|
| Unit and property | Vitest | every formula module, substrate scenarios, plant scenarios, edge cases |
| Self-check | existing `formulaCheck` run under Vitest | reference values |
| Database | PGlite (Postgres in WASM) | migrations apply in order, ingest validation, idempotency, rollups, RLS isolation between two users |
| AI | script against the live API | token cost by image size, model comparison on a small labelled set |
| Visual | Playwright + Chrome | screenshots of changed screens, light and dark |

What these cannot establish: sensor accuracy, substrate parameter accuracy, or
horticultural outcomes. Those need bench and field data and are listed as open.

---

## Roadmap

Ordered by dependency. Each phase ends with type-check and tests green.

| Phase | Objective | Depends on | Status |
|---|---|---|---|
| 0 | Tooling: Node, Vitest, baseline type-check | none | done |
| 1 | Substrate library, mixture model, VG fit; wire into `soilProfile` | 0 | done |
| 2 | Sensing pipeline: raw preservation, quality flags, per-sensor two-point, multi-point curve | 0 | done; no screen yet collects weighed points |
| 3 | Light: PPFD integration, saturation flag, one classifier | 2 | done; divider model implemented but not wired in |
| 4 | Recommendation: states, evidence grade, explanation | 1, 2 | done |
| 5 | Database migration, rollups, RLS, analytics, PGlite tests | 1, 2, 4 | done in SQL and tests; **not run on the live project**; charts not yet switched to daily summaries |
| 6 | AI: edge function, routing, cache, usage log; live model comparison | 5 | written and measured; **not deployed** |
| 7 | Identify flow in the wizard; honest check-up screen | 6 | done |
| 8 | Substrate picker and custom mixture screen; "why" card | 1, 4 | done |
| 9 | Visual refinement of Home, plant list, plant page | 7, 8 | **not done** beyond the new surfaces; see DESIGN.md |
| 10 | Docs, hardware table, review passes, report | all | done |
| 11 | ESP32-C3 build: BH1750, battery, firmware `c3-1.0`, `ingest_v2` (SQL file 14), app lux/battery path | 2, 3, 5 | done; compiled, not run on hardware |

Findings from section A and where they stand:

| # | Finding | Status |
|---|---|---|
| 1 | Fabricated identification confidences | fixed |
| 2 | Simulated photo diagnosis | replaced by the check-up |
| 3 | Daily light from mean of log index | fixed |
| 4 | Firmware is not for the ESP32-C3 | C3 firmware added (`firmware/greenr_sensor_c3`); dev-kit firmware kept as legacy |
| 5 | Four substrate classes | fixed: 23 ingredients, 26 presets, custom blends, unknown |
| 6 | Global soil endpoints | fixed in software; each sensor must be captured |
| 7 | Raw values in misnamed columns | explicit raw columns added; legacy kept |
| 8 | Ingest not idempotent or validated; history relabelled on move | fixed in the migration |
| 9 | Charts aggregate raw rows in the client | summary table built; client not switched |
| 10 | No advice history or observations | both added |
| 11 | LDR mapping unverifiable, likely saturating | documented, flagged at the rails; needs hardware |
| 12 | Index-to-permittivity assumption | documented; tooling to test it exists |
| 13 | Two light classifiers | unified |
| 14 | Conditions score worded as health | Home fixed; score words remain |
| 15 | Two-state decision, no stated basis | nine states and an evidence grade |
| 16 | Firmware credentials and TLS | TLS verified in the C3 firmware; per-unit credentials still compile-time |
| 17 | No tests | 274 |
| 18 | Loose SQL files, order undocumented | order documented and tested |

Risks: (a) changing light averaging shifts stored 14-day averages, mitigated by
storing the new value alongside and letting old days age out; (b) substrate
overrides change watering thresholds, mitigated by mapping existing plants to their
legacy class parameters unchanged; (c) SQL cannot be run against the live project
from here, mitigated by executing every migration against PGlite.
