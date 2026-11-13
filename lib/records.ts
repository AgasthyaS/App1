import type { SensorCalibration } from './calibration';
import { MODEL_VERSION } from './modelVersion';
import type { Recommendation } from './recommendation';
import { endpointsValid } from './sensing/moisture';
import { resolveSubstrate } from './substrate/catalog';
import { supabase } from './supabase';
import type { Plant, PlantObservation } from './types';

/**
 * THE PLANT RECORD — the durable, per-plant history kept in the account.
 *
 * `lib/cloud.ts` backs the whole garden up as one blob so the app can restore
 * itself. This writes the same facts as ROWS — one plant, one substrate version,
 * one observation, one piece of advice — because rows are what can be queried,
 * compared over time, and (for accounts that opted in) learned from.
 *
 * Unlike `lib/research.ts`, none of this depends on the research opt-in: these
 * tables are private to the account under row-level security, exactly like the
 * garden blob. The opt-in governs only whether aggregates may READ them.
 *
 * Every write is best-effort and remembered only once it has succeeded, so a
 * database that has not had the migration run yet costs a failed request an
 * hour and nothing else.
 */

interface Sent {
  plants: Map<string, string>;
  substrates: Map<string, string>;
  calibrations: Map<string, string>;
  observations: Set<string>;
  advice: Map<string, string>;
}

const sent: Sent = {
  plants: new Map(),
  substrates: new Map(),
  calibrations: new Map(),
  observations: new Set(),
  advice: new Map(),
};

let lastError: string | null = null;
let lastOkAt: number | null = null;

export function recordsStatus(): { lastError: string | null; lastOkAt: number | null } {
  return { lastError, lastOkAt };
}

export function resetRecords(): void {
  sent.plants.clear();
  sent.substrates.clear();
  sent.calibrations.clear();
  sent.observations.clear();
  sent.advice.clear();
  lastError = null;
  lastOkAt = null;
}

async function attempt(run: () => PromiseLike<{ error: { message: string } | null }>): Promise<boolean> {
  try {
    const { error } = await run();
    if (error) {
      lastError = error.message;
      return false;
    }
    lastOkAt = Date.now();
    return true;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return false;
  }
}

const statusOf = (p: Plant): 'active' | 'archived' | 'died' | 'gifted' =>
  !p.archived ? 'active' : /gift/i.test(p.archivedCause ?? '') ? 'gifted' : p.archivedCause ? 'died' : 'archived';

/** Upsert the registry row and the current substrate version for each plant. */
export async function syncPlantRecords(userId: string, plants: Plant[]): Promise<void> {
  if (!supabase) return;
  const changed = plants.filter((p) => {
    const fp = [p.species, p.latin, p.name, statusOf(p), p.identifiedBy ?? '', p.ownedSince ?? ''].join('|');
    return sent.plants.get(p.id) !== fp;
  });
  if (changed.length) {
    const ok = await attempt(() =>
      supabase!.from('plants').upsert(
        changed.map((p) => ({
          user_id: userId,
          plant_key: p.id,
          name: p.name,
          species: p.species,
          latin: p.latin || null,
          status: statusOf(p),
          identified_by: p.identifiedBy ?? 'owner',
          acquired_on: p.ownedSince ? p.ownedSince.slice(0, 10) : null,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'user_id,plant_key' },
      ),
    );
    if (!ok) return; // the table is not there yet — nothing below will work either
    for (const p of changed) {
      sent.plants.set(p.id, [p.species, p.latin, p.name, statusOf(p), p.identifiedBy ?? '', p.ownedSince ?? ''].join('|'));
    }
  }

  for (const p of plants) {
    const r = resolveSubstrate(p.substrate, p.soilMix);
    if (sent.substrates.get(p.id) === r.key) continue;
    const props = r.properties && {
      totalPorosity: r.properties.totalPorosity,
      containerCapacity: r.properties.containerCapacity,
      airSpace: r.properties.airSpace,
      easilyAvailable: r.properties.easilyAvailable,
      basis: r.properties.basis,
      weakestInput: r.properties.weakestInput,
      regime: r.properties.regime,
      vg: r.vg,
    };
    const ok = await attempt(() =>
      supabase!.rpc('set_plant_substrate', {
        p_plant_key: p.id,
        p_substrate_key: r.key,
        p_kind: r.knowledge === 'unknown' ? 'unknown' : r.key.startsWith('mix:') ? 'custom' : r.key.startsWith('preset:') ? 'preset' : 'class',
        p_label: r.label,
        p_components: r.parts.map((x) => ({ component: x.component, fraction: Math.round(x.fraction * 1000) / 1000 })),
        p_properties: props || { vg: r.vg },
        p_model_version: MODEL_VERSION,
        p_reason: sent.substrates.has(p.id) ? 'owner-edit' : 'setup',
      }),
    );
    if (ok) sent.substrates.set(p.id, r.key);
  }
}

/** Version each device's calibration whenever it changes. Keys that are not device UUIDs are skipped. */
export async function syncCalibrations(calibrations: Record<string, SensorCalibration>): Promise<void> {
  if (!supabase) return;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const [deviceId, cal] of Object.entries(calibrations)) {
    if (!UUID.test(deviceId)) continue; // demo sensors live only on the device
    const entries: [metric: string, kind: string, params: unknown][] = [];
    if (endpointsValid(cal.soilEndpoints)) {
      entries.push(['moisture', 'endpoints', { dryAdc: cal.soilEndpoints.dryAdc, wetAdc: cal.soilEndpoints.wetAdc }]);
    }
    if (cal.moistureCurve?.length) entries.push(['moisture', 'curve', cal.moistureCurve]);
    if (cal.lightInverted != null) entries.push(['light', 'inversion', { inverted: !!cal.lightInverted }]);
    for (const m of ['moisture', 'temperature', 'humidity', 'light'] as const) {
      const c = cal[m];
      if (c.calibratedAt) {
        const h = c.history[0];
        entries.push([m, 'offset', { offset: c.offset, reference: h?.reference ?? null, measured: h?.measured ?? null }]);
      }
    }
    for (const [metric, kind, params] of entries) {
      const id = `${deviceId}|${metric}|${kind}`;
      const fp = JSON.stringify(params);
      if (sent.calibrations.get(id) === fp) continue;
      const ok = await attempt(() =>
        supabase!.rpc('set_sensor_calibration', { p_device: deviceId, p_metric: metric, p_kind: kind, p_params: params }),
      );
      if (ok) sent.calibrations.set(id, fp);
    }
  }
}

export async function syncObservations(userId: string, plants: Plant[]): Promise<void> {
  if (!supabase) return;
  const fresh: { plant: Plant; obs: PlantObservation }[] = [];
  for (const p of plants) for (const o of p.observations ?? []) {
    if (!sent.observations.has(`${p.id}|${o.id}`)) fresh.push({ plant: p, obs: o });
  }
  if (!fresh.length) return;
  const ok = await attempt(() =>
    supabase!.from('plant_observations').upsert(
      fresh.map(({ plant, obs }) => ({
        user_id: userId,
        plant_key: plant.id,
        at: obs.at,
        kind: obs.kind,
        severity: obs.severity ?? null,
        note: obs.note ?? null,
      })),
      { onConflict: 'user_id,plant_key,kind,at' },
    ),
  );
  if (ok) for (const { plant, obs } of fresh) sent.observations.add(`${plant.id}|${obs.id}`);
}

/**
 * Record a piece of advice — but only when it has CHANGED. A plant that sits
 * "in range" for a fortnight is one row, not a row per render; the interesting
 * events are the transitions, and those are what get scored later.
 */
export async function logRecommendation(userId: string, plantKey: string, rec: Recommendation): Promise<void> {
  if (!supabase) return;
  // The amount is part of the identity for "water now": 300 ml and 600 ml are different advice.
  const fp = `${rec.state}|${rec.grade}|${rec.state === 'water-now' || rec.state === 'retry' ? rec.ml : ''}`;
  if (sent.advice.get(plantKey) === fp) return;
  // Nothing to learn from "no data yet" before a sensor has ever reported.
  if (rec.state === 'insufficient-data' && rec.inputs.soil_index == null && !sent.advice.has(plantKey)) {
    sent.advice.set(plantKey, fp);
    return;
  }
  const ok = await attempt(() =>
    supabase!.from('recommendations').insert({
      user_id: userId,
      plant_key: plantKey,
      state: rec.state,
      grade: rec.grade,
      ml: rec.ml || null,
      days_until_due: rec.daysUntilDue,
      inputs: rec.inputs,
      evidence: rec.evidence.map((e) => ({ key: e.key, met: e.met })),
      model_version: rec.modelVersion,
    }),
  );
  if (ok) sent.advice.set(plantKey, fp);
}

/**
 * A logged watering answers the most recent "water now" for that plant: the
 * owner followed it. Recorded with what the soil did, once the sensor shows it.
 */
export async function markRecommendationFollowed(
  userId: string,
  plantKey: string,
  outcome: { ml: number | null; soilBefore: number | null; soilAfter?: number | null; risePoints?: number | null },
): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase
    .from('recommendations')
    .select('id')
    .eq('user_id', userId)
    .eq('plant_key', plantKey)
    .in('state', ['water-now', 'retry'])
    .is('response', null)
    .order('at', { ascending: false })
    .limit(1);
  const id = (data as { id: number }[] | null)?.[0]?.id;
  if (id == null) return;
  await attempt(() =>
    supabase!.from('recommendations').update({
      response: 'followed',
      responded_at: new Date().toISOString(),
      outcome: {
        ml: outcome.ml,
        soil_before: outcome.soilBefore,
        soil_after: outcome.soilAfter ?? null,
        rise_points: outcome.risePoints ?? null,
      },
    }).eq('id', id),
  );
}
