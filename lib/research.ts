import type { Reading } from './devices';
import { metricSummary } from './dailyStats';
import { probeInsertion } from './probeInsertion';
import { salinityAssessment } from './salinity';
import { substrateCalibration } from './substrateCalibration';
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
  /**
   * Build the payload even when research is opted out. The measurements are also
   * used locally, as this device's memory of its own pots; only `syncResearch`
   * uploads anything, and that stays gated on consent.
   */
  forceBuild?: boolean;
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
  if (!settings.researchOptIn && !opts.forceBuild) return payload;

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

    /*
     * Measured rather than declared. These three answer the questions the
     * reviewing professors raised — what the substrate actually is, whether
     * salts are drifting the readings, and whether the probe is even in the
     * soil — and all three are properties of THIS pot that no care sheet can
     * supply. A pot whose probe is not seated contributes a `probe_insertion`
     * of 'likely-shallow', which is how the aggregate stays honest: those rows
     * can be excluded downstream rather than quietly poisoning an average.
     */
    const sub = substrateCalibration(plant, history, now);
    const salt = salinityAssessment(plant, history, now);
    const ins = probeInsertion(plant, history, now);

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
      /*
       * The measured substrate, which is the part of this row that is
       * comparable BETWEEN pots. Everything above depends on how big the pot
       * is; ml-per-point-per-litre does not, so it is the first figure here
       * that two different growers' plants can be averaged over honestly.
       */
      ml_per_point_per_liter: sub?.mlPerPointPerLiter ?? null,
      density_class: sub?.densityClass ?? null,
      air_filled_porosity: sub?.airFilledPorosity != null ? Math.round(sub.airFilledPorosity * 1000) / 1000 : null,
      sensed_water_fraction: sub?.sensedWaterFraction != null ? Math.round(sub.sensedWaterFraction * 1000) / 1000 : null,
      behaves_like_mix: sub?.behavesLike ?? null,
      stated_mix: plant.soilMix ?? null,
      substrate_confidence: sub?.confidence ?? null,
      salt_risk: salt?.risk === 'unknown' ? null : salt?.risk ?? null,
      salt_drift_pts_month: salt?.driftPtsPerMonth != null ? Math.round(salt.driftPtsPerMonth * 100) / 100 : null,
      probe_insertion: ins?.verdict === 'unknown' ? null : ins?.verdict ?? null,
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
 * WHAT THE LAST UPLOAD ACTUALLY DID.
 *
 * Added after finding the whole pipeline dead. Every write below is
 * best-effort — research collection must never interrupt or break the app
 * someone opened to look after a plant — but "swallow the failure" had been
 * implemented as "never find out", and the two are not the same thing.
 *
 * The live database was checked on 2026-09-05: `profiles` held zero rows and
 * `plant_profiles`, `plant_measurements` and `plant_health_log` did not exist,
 * because the deployed schema was an older generation than the one this file
 * writes. Every upload had been failing on its very first statement — the
 * profile upsert, rejected for `column climate_zone does not exist` — for as
 * long as the feature had existed. Nothing anywhere said so.
 *
 * Worse, it could not have said so. `attempt()` wrapped the calls in try/catch,
 * and the Supabase client does not THROW on a rejected write: it resolves with
 * `{ data, error }`. So the catch block could never fire and the code was
 * structurally incapable of noticing failure, which is a stronger claim than it
 * merely not noticing. The error is now read off the result, not waited for as
 * an exception.
 */
export interface ResearchSyncStatus {
  optedIn: boolean;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  /** the message from the most recent failure, or null if the last run was clean */
  lastError: string | null;
  /** rows accepted on the last run, per table */
  written: Record<string, number>;
}

let status: ResearchSyncStatus = {
  optedIn: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  written: {},
};

/** What the last upload did — for the line under the research toggle. */
export function researchSyncStatus(): ResearchSyncStatus {
  return status;
}

export async function syncResearch(userId: string, payload: ResearchPayload, now = Date.now()): Promise<void> {
  if (!supabase || !userId) return;
  if (!payload.profile.research_opt_in) {
    status = { ...status, optedIn: false };
    return;
  }

  const written: Record<string, number> = {};
  let failure: string | null = null;

  /*
   * One write, and what became of it.
   *
   * `rows` is what we TRIED to send, recorded only when the write came back
   * clean — so the status line reports what the database accepted rather than
   * what the app hoped for. The first error is kept rather than the last: it is
   * the one that explains the others (a missing table makes everything after it
   * fail too, and the last message would just be the least informative).
   */
  const attempt = async (table: string, rows: number, fn: () => PromiseLike<{ error: unknown } | unknown>) => {
    try {
      const res = (await fn()) as { error?: { message?: string; code?: string } | null } | null;
      const err = res?.error;
      if (err) {
        failure ??= `${table}: ${err.message ?? err.code ?? 'rejected'}`;
        return;
      }
      written[table] = (written[table] ?? 0) + rows;
    } catch (e) {
      failure ??= `${table}: ${e instanceof Error ? e.message : 'failed'}`;
    }
  };

  const okBefore = (table: string) => written[table] ?? 0;

  await attempt('profiles', 1, () =>
    supabase!.from('profiles').upsert(
      { user_id: userId, ...payload.profile, updated_at: new Date(now).toISOString() },
      { onConflict: 'user_id' },
    ),
  );

  /*
   * The profile row is the CONSENT record, and every other table's rows hang off
   * it. If it did not land, this account is not registered as opted in, so the
   * writes below would either be rejected too or — worse — stored without the
   * consent that makes them legitimate. A failure here stops the run.
   */
  if (failure) {
    status = { optedIn: true, lastAttemptAt: now, lastSuccessAt: status.lastSuccessAt, lastError: failure, written };
    return;
  }

  // Configuration: only write when it has actually CHANGED, and close the old
  // row rather than editing it — that versioning is what keeps old readings
  // interpretable after a repot.
  for (const row of payload.plantProfiles) {
    const key = String(row.plant_key);
    const fp = String(row._fingerprint);
    if (sentConfig.get(key) === fp) continue;
    const { _fingerprint, ...clean } = row as Record<string, unknown> & { _fingerprint: string };
    const before = okBefore('plant_profiles');
    await attempt('plant_profiles', 0, () =>
      supabase!.from('plant_profiles')
        .update({ valid_to: new Date(now).toISOString() })
        .eq('user_id', userId).eq('plant_key', key).is('valid_to', null),
    );
    await attempt('plant_profiles', 1, () =>
      supabase!.from('plant_profiles')
        .insert({ user_id: userId, ...clean, valid_from: new Date(now).toISOString() }),
    );
    /*
     * REMEMBER IT AS SENT ONLY IF IT WAS. This used to run unconditionally, so a
     * rejected write still marked the configuration as delivered and it was
     * never retried for the lifetime of the process. With the pipeline failing
     * every time, that meant every plant was recorded as uploaded and dropped.
     */
    if (okBefore('plant_profiles') > before) sentConfig.set(key, fp);
  }

  // Same rule for care events: the de-duplication key is only committed once the
  // database has accepted the row, so a failed batch is offered again next run.
  const freshCare = payload.careEvents.filter((c) => !sentCare.has(`${c.plant_key}|${c.at}`));
  if (freshCare.length) {
    const before = okBefore('care_events');
    await attempt('care_events', freshCare.length, () =>
      supabase!.from('care_events').upsert(
        freshCare.map((c) => ({ user_id: userId, ...c })),
        { onConflict: 'user_id,plant_key,kind,at' },
      ),
    );
    if (okBefore('care_events') > before) {
      for (const c of freshCare) sentCare.add(`${c.plant_key}|${c.at}`);
    }
  }

  // The interval timers move only on success too — a rejected push must not buy
  // itself another six hours of silence.
  if (now - lastMeasurementPushAt > MEASUREMENT_INTERVAL_H * 3600000 && payload.measurements.length) {
    const before = okBefore('plant_measurements');
    await attempt('plant_measurements', payload.measurements.length, () =>
      supabase!.from('plant_measurements').insert(
        payload.measurements.map((m) => ({ user_id: userId, ...m })),
      ),
    );
    if (okBefore('plant_measurements') > before) lastMeasurementPushAt = now;
  }

  if (now - lastHealthPushAt > HEALTH_LOG_INTERVAL_H * 3600000 && payload.healthLog.length) {
    const before = okBefore('plant_health_log');
    await attempt('plant_health_log', payload.healthLog.length, () =>
      supabase!.from('plant_health_log').insert(
        payload.healthLog.map((h) => ({ user_id: userId, ...h })),
      ),
    );
    if (okBefore('plant_health_log') > before) lastHealthPushAt = now;
  }

  status = {
    optedIn: true,
    lastAttemptAt: now,
    lastSuccessAt: failure ? status.lastSuccessAt : now,
    lastError: failure,
    written,
  };
}

/**
 * One line describing the last upload, for the research toggle.
 *
 * Deliberately plain rather than alarming. Someone who turned research on is
 * entitled to know whether anything is actually being contributed — and when the
 * answer is "nothing, ever", saying so is the entire point of the line.
 */
export function researchSyncLine(now = Date.now()): string {
  const st = status;
  if (!st.optedIn) return 'Off — nothing is uploaded.';
  if (st.lastAttemptAt == null) return 'On. Nothing uploaded yet this session.';
  if (st.lastError) {
    return `On, but the last upload was rejected (${st.lastError}). Nothing is reaching the database.`;
  }
  const rows = Object.entries(st.written)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${t.replace(/_/g, ' ')}`)
    .join(', ');
  const mins = Math.max(0, Math.round((now - (st.lastSuccessAt ?? now)) / 60000));
  const when = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
  return rows ? `On. Last upload ${when} — ${rows}.` : `On. Last checked ${when}; nothing new to send.`;
}

/** Clears the in-memory de-duplication state — used on sign-out. */
export function resetResearchSync(): void {
  lastHealthPushAt = 0;
  lastMeasurementPushAt = 0;
  sentConfig.clear();
  sentCare.clear();
  status = { optedIn: false, lastAttemptAt: null, lastSuccessAt: null, lastError: null, written: {} };
}
