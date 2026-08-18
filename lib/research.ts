import type { Reading } from './devices';
import { metricSummary } from './dailyStats';
import { vitalityFor } from './health';
import { idealsFor } from './plantStatus';
import { retentionEstimate } from './soilRetention';
import { supabase } from './supabase';
import type { Plant, Settings } from './types';
import { vpdKpa } from './vpd';
import { perPointFor, poursAndCeiling, wateringSchedule } from './waterBalance';
import { potVolume } from './watering';

/**
 * FILLING THE "HOW PLANTS THRIVE" DATABASE.
 *
 * The schema in supabase/schema.sql has existed in one form or another for a
 * while and has been completely empty the whole time, because nothing ever wrote
 * to it. This module is the missing half.
 *
 * ───────────────────────────── WHAT GETS SENT ──────────────────────────────
 *
 *   profiles           consent + climate zone
 *   plant_profiles     what each plant is, re-versioned whenever the pot changes
 *   care_events        waterings, with poured vs suggested and what the soil did
 *   plant_measurements the pot's measured physics — ml/point, retention, ceiling
 *   plant_health_log   a periodic verdict plus the conditions it lived in
 *
 * ──────────────────────────── AND WHAT DOES NOT ────────────────────────────
 *
 * Nothing identifying. No plant names, no photos, no notes, no coordinates —
 * `climate_zone` is the finest geography that leaves here, and it is a band
 * hundreds of miles wide. The whole thing is gated on an explicit opt-in, and
 * turning that off stops every write immediately.
 *
 * ────────────────────────── WHY IT IS WRITTEN THIS WAY ─────────────────────
 *
 * Two rules make the data worth having later:
 *
 * 1. CONFIGURATION IS VERSIONED, NEVER EDITED. A repot closes the old
 *    `plant_profiles` row and opens a new one, so a reading from March still
 *    resolves to the pot it was in during March. Overwrite it instead and the
 *    entire history before the repot becomes unlabelled.
 *
 * 2. PROVENANCE TRAVELS WITH EVERY NUMBER. `amount_source` and
 *    `ml_per_point_basis` say how each figure was arrived at, so an analysis can
 *    exclude the weak ones rather than quietly averaging them in. Without them a
 *    dataset full of the app's own guesses looks exactly like a dataset full of
 *    measurements — and would confirm whatever the app already believed.
 */

/** Health entries this far apart; more often than this is noise, not signal. */
const HEALTH_LOG_INTERVAL_H = 24;
/** Measurements change slowly — a daily snapshot is plenty. */
const MEASUREMENT_INTERVAL_H = 24;

export interface ResearchPlantInput {
  plant: Plant;
  /** calibration-corrected history for this plant */
  history: Reading[];
  hasSensor: boolean;
}

export interface ResearchPayload {
  profile: {
    research_opt_in: boolean;
    climate_zone: number | null;
    hemisphere: string | null;
  };
  plantProfiles: Record<string, unknown>[];
  careEvents: Record<string, unknown>[];
  measurements: Record<string, unknown>[];
  healthLog: Record<string, unknown>[];
}

/** Stable fingerprint of the fields that define a plant's configuration. */
function configFingerprint(p: Plant): string {
  return [
    p.species, p.potCm, p.potHeightCm, p.potShape, p.potMaterial,
    p.soilMix, p.soilRetention, p.hasDrainage,
  ].join('|');
}

/**
 * Everything worth sending, built from what the app already has in memory.
 *
 * Pure and synchronous so it can be inspected and tested without a network — the
 * upload is a separate step that does nothing but write what this returns.
 */
export function buildResearchPayload(opts: {
  plants: ResearchPlantInput[];
  settings: Pick<Settings, 'researchOptIn' | 'unitsF'>;
  climateZone?: number | null;
  hemisphere?: string | null;
  now?: number;
}): ResearchPayload {
  const { plants, settings, now = Date.now() } = opts;
  const payload: ResearchPayload = {
    profile: {
      research_opt_in: !!settings.researchOptIn,
      climate_zone: opts.climateZone ?? null,
      hemisphere: opts.hemisphere ?? null,
    },
    plantProfiles: [],
    careEvents: [],
    measurements: [],
    healthLog: [],
  };
  if (!settings.researchOptIn) return payload;

  for (const { plant, history, hasSensor } of plants) {
    if (!plant?.id || !plant.species) continue;
    const vol = potVolume(plant);

    // ── What this plant IS, as of now ──
    payload.plantProfiles.push({
      plant_key: plant.id,
      species: plant.species,
      latin: plant.latin ?? null,
      pot_diameter_cm: plant.potCm ?? null,
      pot_height_cm: plant.potHeightCm ?? null,
      pot_shape: plant.potShape ?? null,
      pot_material: plant.potMaterial ?? null,
      pot_liters: Math.round(vol.liters * 100) / 100,
      has_drainage: plant.hasDrainage ?? null,
      soil_mix: plant.soilMix ?? null,
      soil_retention: plant.soilRetention ?? null,
      indoor: true,
      room: null,
      _fingerprint: configFingerprint(plant),
    });

    // ── What the owner did. Waterings carry their outcome where the sensor saw it ──
    const { pours } = hasSensor && history.length
      ? poursAndCeiling(plant, history, now)
      : { pours: [] as ReturnType<typeof poursAndCeiling>['pours'] };
    /*
     * TWO FILTERS, BOTH LEARNED FROM THE LIVE DATA.
     *
     * The real garden contains a 2,775 ml watering logged against a 0.17 L pot —
     * sixteen times the pot's entire volume — and several pours recorded six
     * times within one second by a double-tapped button. Neither is a watering.
     * Letting them through would corrupt exactly the views this database exists
     * for: `v_watering_norms` would learn a nonsense millilitre figure, and
     * `v_advice_accuracy` would report the app wildly under-suggesting.
     *
     * Bad rows are dropped rather than repaired. A repaired row is a guess
     * wearing a measurement's clothes, and this dataset's whole value is that its
     * numbers are real.
     */
    const maxPlausibleMl = Math.max(250, vol.liters * 1000 * 2);
    const seenAt = new Set<number>();
    for (const w of plant.waterLog ?? []) {
      const at = new Date(w.at).getTime();
      if (!Number.isFinite(at)) continue;
      const minuteKey = Math.round(at / 60000);
      if (seenAt.has(minuteKey)) continue;
      seenAt.add(minuteKey);
      if (w.ml != null && (w.ml <= 0 || w.ml > maxPlausibleMl)) continue;
      const matched = pours.find((p) => Math.abs(p.at - at) < 90 * 60000);
      payload.careEvents.push({
        plant_key: plant.id,
        kind: 'water',
        at: new Date(at).toISOString(),
        ml: w.ml ?? null,
        suggested_ml: w.suggestedMl ?? null,
        amount_source: w.source ?? 'preset',
        rise_points: matched ? Math.round(matched.risePts * 10) / 10 : null,
        saturated: matched ? matched.saturated : null,
        note: null,
      });
    }

    if (!hasSensor || history.length < 8) continue;

    // ── What the app measured about the pot ──
    const ideal = idealsFor(plant.species, plant.comfortBand);
    const pp = perPointFor(plant, history, ideal.band[0], now);
    const ret = retentionEstimate(plant, history);
    const sched = wateringSchedule(plant, history, ideal.band, now);
    const { ceiling } = poursAndCeiling(plant, history, now);

    payload.measurements.push({
      plant_key: plant.id,
      measured_at: new Date(now).toISOString(),
      ml_per_point: pp.mlPerPoint,
      ml_per_point_basis: pp.basis,
      clean_pours: pp.cleanPours,
      retention_class: ret?.value ?? null,
      dry_down_days: ret ? Math.round(ret.dryDays * 10) / 10 : null,
      dry_points_per_day: ret ? Math.round(ret.ptsPerDay * 100) / 100 : null,
      retention_confident: ret?.confident ?? false,
      ceiling_pct: ceiling?.pct ?? null,
      ceiling_confirmed: ceiling?.confirmed ?? false,
      refill_at_pct: sched ? Math.round(sched.refillAt * 10) / 10 : null,
      capacity_at_pct: sched ? Math.round(sched.capacityAt * 10) / 10 : null,
      suggested_ml: sched?.ml ?? null,
      interval_days: sched?.everyDays != null ? Math.round(sched.everyDays * 10) / 10 : null,
    });

    // ── How it is doing, and in what conditions ──
    const soil = metricSummary(history, 'soil', 30);
    const temp = metricSummary(history, 'temp', 30);
    const rh = metricSummary(history, 'humidity', 30);
    const light = metricSummary(history, 'light', 30);
    const latest = history[history.length - 1];
    const vitality = vitalityFor(plant, true, latest ?? null, null, settings.unitsF ?? true, null, null);

    const daysOwned = plant.ownedSince
      ? Math.max(0, Math.round((now - new Date(plant.ownedSince).getTime()) / 86400000))
      : (plant.addedDaysAgo ?? null);

    /*
     * The verdict. Deliberately coarse: a 0–100 score implies a precision the app
     * does not have, and the analysis only ever needs "did this work or not".
     * `died`/`gifted` come from the archive flow rather than being inferred — a
     * plant that stops reporting has not necessarily died, and guessing would
     * poison the labels the whole dataset rests on.
     */
    const status = plant.archived
      ? (plant.archivedCause === 'gifted' ? 'gifted' : 'died')
      : vitality.awaiting || vitality.pending ? 'ok'
        : vitality.score >= 75 ? 'thriving'
          : vitality.score >= 50 ? 'ok'
            : 'struggling';

    const windowDays = soil?.days ?? 0;
    const recentPours = (plant.waterLog ?? []).filter(
      (w) => now - new Date(w.at).getTime() < windowDays * 86400000,
    );

    payload.healthLog.push({
      plant_key: plant.id,
      species: plant.species,
      at: new Date(now).toISOString(),
      status,
      cause: plant.archived ? plant.archivedCause ?? null : null,
      health_score: vitality.awaiting || vitality.pending ? null : vitality.score,
      days_owned: daysOwned,
      is_final: !!plant.archived,
      window_days: windowDays,
      avg_soil: soil ? Math.round(soil.avg * 10) / 10 : null,
      avg_light: light ? Math.round(light.avg * 10) / 10 : null,
      avg_temp: temp ? Math.round(temp.avg * 10) / 10 : null,
      avg_humidity: rh ? Math.round(rh.avg * 10) / 10 : null,
      avg_vpd_kpa: temp && rh ? Math.round((vpdKpa(temp.avg, rh.avg) ?? 0) * 100) / 100 : null,
      waterings: recentPours.length,
      total_ml: recentPours.reduce((a, w) => a + (w.ml ?? 0), 0) || null,
    });
  }

  return payload;
}

/* ────────────────────────────── THE UPLOAD ────────────────────────────── */

let lastHealthPushAt = 0;
let lastMeasurementPushAt = 0;
const sentConfig = new Map<string, string>();
const sentCare = new Set<string>();

/**
 * Push the payload. Every failure is swallowed on purpose: research collection
 * must never interrupt, slow, or break the app someone is using to look after a
 * plant. If the tables do not exist yet, this quietly does nothing.
 */
export async function syncResearch(userId: string, payload: ResearchPayload, now = Date.now()): Promise<void> {
  if (!supabase || !userId || !payload.profile.research_opt_in) return;

  // The Postgrest builder is thenable but not a Promise, so callers `await`
  // inside their own body rather than returning it.
  const attempt = async (fn: () => Promise<unknown> | unknown) => {
    try { await fn(); } catch { /* research data is never worth an error in front of a user */ }
  };

  await attempt(() =>
    supabase!.from('profiles').upsert(
      { user_id: userId, ...payload.profile, updated_at: new Date(now).toISOString() },
      { onConflict: 'user_id' },
    ),
  );

  // Configuration: only write when it has actually CHANGED, and close the old
  // row rather than editing it — that versioning is what keeps old readings
  // interpretable after a repot.
  for (const row of payload.plantProfiles) {
    const key = String(row.plant_key);
    const fp = String(row._fingerprint);
    if (sentConfig.get(key) === fp) continue;
    const { _fingerprint, ...clean } = row as Record<string, unknown> & { _fingerprint: string };
    await attempt(async () => {
      await supabase!.from('plant_profiles')
        .update({ valid_to: new Date(now).toISOString() })
        .eq('user_id', userId).eq('plant_key', key).is('valid_to', null);
      await supabase!.from('plant_profiles')
        .insert({ user_id: userId, ...clean, valid_from: new Date(now).toISOString() });
    });
    sentConfig.set(key, fp);
  }

  const freshCare = payload.careEvents.filter((c) => {
    const key = `${c.plant_key}|${c.at}`;
    if (sentCare.has(key)) return false;
    sentCare.add(key);
    return true;
  });
  if (freshCare.length) {
    await attempt(() =>
      supabase!.from('care_events').upsert(
        freshCare.map((c) => ({ user_id: userId, ...c })),
        { onConflict: 'user_id,plant_key,kind,at' },
      ),
    );
  }

  if (now - lastMeasurementPushAt > MEASUREMENT_INTERVAL_H * 3600000 && payload.measurements.length) {
    lastMeasurementPushAt = now;
    await attempt(() =>
      supabase!.from('plant_measurements').insert(
        payload.measurements.map((m) => ({ user_id: userId, ...m })),
      ),
    );
  }

  if (now - lastHealthPushAt > HEALTH_LOG_INTERVAL_H * 3600000 && payload.healthLog.length) {
    lastHealthPushAt = now;
    await attempt(() =>
      supabase!.from('plant_health_log').insert(
        payload.healthLog.map((h) => ({ user_id: userId, ...h })),
      ),
    );
  }
}

/** Clears the in-memory de-duplication state — used on sign-out. */
export function resetResearchSync(): void {
  lastHealthPushAt = 0;
  lastMeasurementPushAt = 0;
  sentConfig.clear();
  sentCare.clear();
}
