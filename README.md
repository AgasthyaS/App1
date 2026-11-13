# Greenr

A plant-care app with a soil sensor. Expo / React Native (iOS, Android, web) on
Supabase.

## Run

```bash
npm install
npx expo start            # press w for web, or scan for a device
```

Without a `.env` the app runs locally with no account server. To connect one,
copy `.env.example` to `.env` and fill in the two Supabase values.

## Check

```bash
npm run typecheck         # TypeScript
npm test                  # 308 tests: formulas, substrate, sensing, advice, AI handler, database
npm run lint
```

The database tests run every SQL file in this repository, in install order,
against a real Postgres (PGlite) and exercise ingest, summaries, history and
row-level security.

## Set up the backend

1. Run the SQL files in the order listed in [docs/DATABASE.md](docs/DATABASE.md).
   File 14 must be in place before flashing the ESP32-C3 firmware.
2. Photo identification (optional):
   ```bash
   supabase secrets set GEMINI_API_KEY=<key>
   supabase functions deploy identify-plant
   ```
   The key never goes in the app or the repository. See [docs/AI.md](docs/AI.md).

## Documentation

| | |
|---|---|
| [docs/BLUEPRINT.md](docs/BLUEPRINT.md) | audit findings, architecture, roadmap and status |
| [docs/DATABASE.md](docs/DATABASE.md) | every table, where its values come from, access rules, analytics |
| [docs/FORMULAS.md](docs/FORMULAS.md) | every calculation: definition, units, assumptions, tests, what is unverified |
| [docs/AI.md](docs/AI.md) | model choice, measured comparison, routing, cost, key handling |
| [docs/HARDWARE.md](docs/HARDWARE.md) | wiring from the firmware, sensor limits, upgrade path |
| [docs/DESIGN.md](docs/DESIGN.md) | the visual system, what changed, what is still to do |

## Layout

```
app/                    screens (expo-router)
components/greenr/      shared UI
lib/                    all logic
  sensing/              raw counts → validated → index; light rails
  substrate/            ingredient library, blend model, retention curves
  recommendation.ts     the advice, its states and its evidence grade
  records.ts            per-plant history written to the account
supabase/
  migrations/           platform migration
  functions/            identify-plant edge function and its shared logic
  seed/                 generated from lib/substrate — npm run gen:substrates
tests/                  Vitest; tests/db runs the SQL
firmware/
  greenr_sensor_c3/     ESP32-C3 + BH1750 + AHT10 + battery (current; see docs/HARDWARE.md)
  greenr_sensor/        ESP32 dev kit + LDR (legacy)
```
