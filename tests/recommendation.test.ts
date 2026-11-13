import { describe, expect, it } from 'vitest';

import { emptyCalibration, withSoilEndpoint } from '@/lib/calibration';
import { getSpecies, waterProfileFor } from '@/lib/plants';
import { recommendationFor, type Recommendation } from '@/lib/recommendation';
import { containerThresholds } from '@/lib/soilProfile';
import type { SubstrateSpec } from '@/lib/substrate';

import { DAY, HOUR, NOW, makePlant, reading, simulateTrace } from './helpers';

/**
 * Everything here runs on SIMULATED traces (tests/helpers.ts). These tests show
 * the decision logic is coherent and total; they say nothing about whether the
 * thresholds are right for a real plant.
 */

const preset = (id: string): SubstrateSpec => ({ kind: 'preset', id });
const at = (soil: number, hoursAgo = 1) => reading(NOW - hoursAgo * HOUR, soil);
const steady = (soil: number) =>
  Array.from({ length: 16 }, (_, i) => reading(NOW - (16 - i) * 3 * HOUR, soil + (16 - i) * 0.3));
const rec = (species: string, soil: number, over = {}, history = steady(soil)): Recommendation =>
  recommendationFor({ plant: makePlant(species, over), reading: history[history.length - 1] ?? at(soil), history, now: NOW });

const SPECIES = ['Echeveria', 'Golden barrel cactus', 'Monstera', 'Boston fern', 'Moth orchid', 'Basil'];

describe('fixtures exist in the catalog', () => {
  it.each(SPECIES)('%s', (s) => {
    const sp = getSpecies(s)!;
    expect(sp).toBeTruthy();
    expect(sp.band[0]).toBeLessThan(sp.band[1]);
  });
});

describe('the same reading means different things for different plants', () => {
  it('index 25: a succulent is fine, a fern needs water', () => {
    const succulent = rec('Echeveria', 25, { substrate: preset('succulent-mix'), soilMix: 'Gritty / cactus' });
    const fern = rec('Boston fern', 25);
    expect(['in-range', 'too-wet', 'drying']).toContain(succulent.state);
    expect(succulent.ml).toBe(0);
    expect(fern.state).toBe('water-now');
    expect(fern.ml).toBeGreaterThan(0);
  });

  it('every plant group gets water below its own floor and none above its own ceiling', () => {
    for (const s of SPECIES) {
      const [lo, hi] = getSpecies(s)!.band;
      const dry = rec(s, Math.max(1, lo - 6));
      const wet = rec(s, Math.min(99, hi + 12));
      expect(dry.state, `${s} dry`).toBe('water-now');
      expect(dry.ml, `${s} dry ml`).toBeGreaterThan(0);
      expect(['too-wet', 'not-draining', 'in-range'], `${s} wet`).toContain(wet.state);
      expect(wet.ml, `${s} wet ml`).toBe(0);
    }
  });

  it('floors are ordered the way the plants are: cactus < tropical < fern', () => {
    const lo = (s: string) => getSpecies(s)!.band[0];
    expect(lo('Golden barrel cactus')).toBeLessThan(lo('Monstera'));
    expect(lo('Monstera')).toBeLessThan(lo('Boston fern'));
    expect(waterProfileFor('Golden barrel cactus').style).toBe('soak-and-dry');
  });
});

describe('the same reading means different things in different substrates', () => {
  it('a Monstera just above its floor: "drying" in coir, plain "in range" in orchid bark', () => {
    const [lo] = getSpecies('Monstera')!.band;
    const soil = lo + 4;
    const coirRefill = containerThresholds({ potHeightCm: 16, soilMix: 'Standard mix', substrate: preset('coco-coir') }).refillReading;
    const barkRefill = containerThresholds({ potHeightCm: 16, soilMix: 'Standard mix', substrate: preset('orchid-mix') }).refillReading;
    expect(coirRefill).toBeGreaterThan(soil);
    expect(barkRefill).toBeLessThan(soil);
    expect(rec('Monstera', soil, { substrate: preset('coco-coir') }).state).toBe('drying');
    expect(rec('Monstera', soil, { substrate: preset('orchid-mix'), soilMix: 'Gritty / cactus' }).state).toBe('in-range');
  });

  it('the substrate never turns "drying" into an instruction to pour', () => {
    for (const id of ['coco-coir', 'potting-mix', 'peat-moss', 'clay-soil', 'seed-mix']) {
      const r = rec('Monstera', getSpecies('Monstera')!.band[0] + 3, { substrate: preset(id) });
      expect(r.ml, id).toBe(0);
      expect(r.state, id).not.toBe('water-now');
    }
  });

  it('soak-and-dry plants ignore the substrate threshold entirely', () => {
    const [lo] = getSpecies('Echeveria')!.band;
    const r = rec('Echeveria', lo + 3, { substrate: preset('coco-coir') });
    expect(r.state).toBe('in-range');
  });

  it('an unknown substrate does not produce a substrate-based warning', () => {
    const r = rec('Monstera', getSpecies('Monstera')!.band[0] + 3, { substrate: { kind: 'unknown' } });
    expect(r.state).toBe('in-range');
    expect(r.explain.substrate).toMatch(/not specified/);
    expect(r.evidence.find((e) => e.key === 'substrate')!.met).toBe(false);
  });

  it('a custom blend resolves, is named in the evidence, and is recorded in the inputs', () => {
    const custom: SubstrateSpec = { kind: 'custom', parts: [
      { component: 'potting-mix', parts: 50 }, { component: 'perlite', parts: 30 }, { component: 'coir', parts: 20 },
    ] };
    const r = rec('Monstera', 45, { substrate: custom });
    expect(r.evidence.find((e) => e.key === 'substrate')!.detail).toMatch(/50% bagged potting mix/);
    expect(String(r.inputs.substrate_key)).toMatch(/^mix:/);
  });
});

describe('states that are about the data, not the plant', () => {
  it('no reading → insufficient data, grade none', () => {
    const r = recommendationFor({ plant: makePlant('Monstera'), reading: null, history: [], now: NOW });
    expect(r.state).toBe('insufficient-data');
    expect(r.grade).toBe('none');
    expect(r.ml).toBe(0);
  });

  it('a stale reading is not acted on, however dry it was', () => {
    const old = steady(5).map((x, i) => ({ ...x, created_at: new Date(NOW - 3 * DAY - (16 - i) * 3 * HOUR).toISOString() }));
    const r = recommendationFor({ plant: makePlant('Boston fern'), reading: old[old.length - 1], history: old, now: NOW });
    expect(r.state).toBe('insufficient-data');
    expect(r.ml).toBe(0);
  });

  it('a slower reporting rhythm is not mistaken for staleness', () => {
    const sixHourly = Array.from({ length: 12 }, (_, i) => reading(NOW - (12 - i) * 6 * HOUR + 30 * 60_000, 45));
    const r = recommendationFor({ plant: makePlant('Monstera'), reading: sixHourly[11], history: sixHourly, now: NOW });
    expect(r.state).not.toBe('insufficient-data');
  });

  it('a probe in open air → inconsistent, with the fix', () => {
    const h = steady(40);
    const air = { ...h[h.length - 1], soil_pct: 0, soil_raw: 3600, soil_quality: 'not-inserted' as const };
    const r = recommendationFor({ plant: makePlant('Monstera'), reading: air, history: [...h.slice(0, -1), air], now: NOW });
    expect(r.state).toBe('inconsistent');
    expect(r.action).toMatch(/white line/);
    expect(r.ml).toBe(0);
  });

  it('a disconnected probe → inconsistent', () => {
    const h = steady(40);
    const bad = { ...h[h.length - 1], soil_pct: 100, soil_raw: 120, soil_quality: 'disconnected' as const };
    expect(recommendationFor({ plant: makePlant('Monstera'), reading: bad, history: h, now: NOW }).state).toBe('inconsistent');
  });

  it('an erratic trace → inconsistent, even when the latest value looks dry', () => {
    const zigzag = Array.from({ length: 20 }, (_, i) => reading(NOW - (20 - i) * 3 * HOUR, i % 2 ? 12 : 55));
    const r = recommendationFor({ plant: makePlant('Boston fern'), reading: zigzag[19], history: zigzag, now: NOW });
    expect(r.state).toBe('inconsistent');
    expect(r.ml).toBe(0);
  });

  it('extremes do not produce nonsense', () => {
    for (const soil of [0, 100]) {
      for (const s of SPECIES) {
        const r = rec(s, soil);
        expect(Number.isFinite(r.ml)).toBe(true);
        expect(r.ml).toBeGreaterThanOrEqual(0);
        expect(r.ml).toBeLessThanOrEqual(10_000);
        expect(r.headline).not.toMatch(/NaN|undefined|null|Infinity/);
        for (const line of Object.values(r.explain)) expect(line).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });

  it('a plant with missing optional fields still gets an answer', () => {
    const bare = makePlant('Monstera', { potCm: null, potHeightCm: null, soilMix: undefined, substrate: undefined, comfortBand: [NaN, NaN] as any });
    const r = recommendationFor({ plant: bare, reading: at(20), history: steady(20), now: NOW });
    expect(r.state).toBe('water-now');
    expect(Number.isFinite(r.ml)).toBe(true);
  });

  it('an unrecognised species falls back to generic values and says so', () => {
    const r = rec('Definitely not a plant', 10);
    expect(r.state).toBe('water-now');
    expect(r.evidence.find((e) => e.key === 'species')!.met).toBe(false);
  });
});

describe('the evidence grade', () => {
  const measured = (extra = {}) => {
    // SIMULATED month: a pot that dries from 70 to its watering point in about 6 days.
    const history = simulateTrace({ days: 30, full: 70, floor: 8, tauDays: 6, waterAt: 34, lastWaterDaysAgo: 2 });
    const plant = makePlant('Monstera', { substrate: preset('potting-mix'), ...extra });
    return { plant, history, reading: history[history.length - 1] };
  };

  it('is "low" with only a reading and nothing else known', () => {
    const r = rec('Definitely not a plant', 45, { potCm: null, potHeightCm: null, substrate: { kind: 'unknown' } });
    expect(r.grade).toBe('low');
  });

  it('rises as things become known, and never claims "high" without a measured dry-down', () => {
    const { plant, history, reading: last } = measured();
    const base = recommendationFor({ plant, reading: last, history, now: NOW });
    expect(['moderate', 'high']).toContain(base.grade);
    const drying = base.evidence.find((e) => e.key === 'pot-drying')!;
    if (!drying.met) expect(base.grade).not.toBe('high');

    const cal = withSoilEndpoint(withSoilEndpoint(emptyCalibration(), 'dry', 3020), 'wet', 1400);
    const better = recommendationFor({ plant, reading: last, history, calibration: cal, now: NOW });
    const rank = { none: 0, low: 1, moderate: 2, high: 3 } as const;
    expect(rank[better.grade]).toBeGreaterThanOrEqual(rank[base.grade]);
    expect(better.evidence.find((e) => e.key === 'own-range')!.met).toBe(true);
  });

  it('a failed required check caps the grade at "low" whatever else is known', () => {
    const { plant } = measured();
    const zigzag = Array.from({ length: 24 }, (_, i) => reading(NOW - (24 - i) * 3 * HOUR, i % 2 ? 20 : 60));
    const r = recommendationFor({ plant, reading: zigzag[23], history: zigzag, now: NOW });
    expect(r.grade).toBe('low');
  });

  it('lists nine checks, three of them required, each with a sentence', () => {
    const r = rec('Monstera', 45);
    expect(r.evidence).toHaveLength(9);
    expect(r.evidence.filter((e) => e.required)).toHaveLength(3);
    for (const e of r.evidence) expect(e.detail.length).toBeGreaterThan(10);
  });

  it('is deterministic', () => {
    const { plant, history, reading: last } = measured();
    const a = recommendationFor({ plant, reading: last, history, now: NOW });
    const b = recommendationFor({ plant, reading: last, history, now: NOW });
    expect(a).toEqual(b);
  });
});

describe('the explanation', () => {
  it('has all seven parts and names the index as an index, not a percentage of water', () => {
    const r = rec('Monstera', 44, { substrate: preset('coco-coir') });
    expect(Object.keys(r.explain)).toEqual(['measured', 'calculated', 'substrate', 'plant', 'history', 'why', 'reliability']);
    expect(r.explain.measured).toMatch(/moisture index 44/);
    expect(r.explain.measured).not.toMatch(/44%/);
    expect(r.explain.substrate).toMatch(/coco coir/i);
    expect(r.explain.reliability).toMatch(/of 9 checks met/);
  });

  it('records the inputs and the model version for later scoring', () => {
    const r = rec('Monstera', 44);
    expect(r.modelVersion).toMatch(/^s\d+\.b\d+\.l\d+\.d\d+$/);
    expect(r.inputs.soil_index).toBeCloseTo(44, 0);
    expect(r.inputs.state).toBe(r.state);
    for (const v of Object.values(r.inputs)) expect(typeof v === 'number' ? Number.isFinite(v) : true).toBe(true);
  });
});

describe('drying behaviour over time (simulated)', () => {
  it('a pot nearing its floor at a measured rate is flagged "drying" before it is "water now"', () => {
    const [lo] = getSpecies('Monstera')!.band;
    const states: string[] = [];
    // March the clock forward along one long dry-down and record the state each day.
    const full = simulateTrace({ days: 40, full: 72, floor: 6, tauDays: 7, waterAt: lo + 1, lastWaterDaysAgo: 12 });
    for (let back = 10; back >= 0; back--) {
      const now = NOW - back * DAY;
      const h = full.filter((r) => new Date(r.created_at).getTime() <= now);
      const r = recommendationFor({ plant: makePlant('Monstera', { substrate: preset('potting-mix') }), reading: h[h.length - 1], history: h, now });
      states.push(r.state);
    }
    const firstWater = states.indexOf('water-now');
    const firstDrying = states.indexOf('drying');
    if (firstWater >= 0) {
      expect(firstDrying).toBeGreaterThanOrEqual(0);
      expect(firstDrying).toBeLessThan(firstWater);
    }
    expect(states).not.toContain('inconsistent');
  });
});

describe('the projection aims at the plant’s floor, and only when drying was measured', () => {
  it('never claims to "reach" a level the soil is already below', () => {
    const history = simulateTrace({ days: 30, full: 72, floor: 6, tauDays: 7, waterAt: 31, lastWaterDaysAgo: 9 });
    const last = history[history.length - 1];
    const r = recommendationFor({ plant: makePlant('Monstera', { substrate: preset('coco-coir') }), reading: last, history, now: NOW });
    const soil = last.soil_pct!;
    for (const m of r.explain.calculated.matchAll(/reaches (?:[^0-9]*)(\d+)/g)) {
      expect(Number(m[1])).toBeLessThanOrEqual(Math.round(soil));
    }
    if (r.daysUntilDue != null) expect(r.daysUntilDue).toBeGreaterThanOrEqual(0);
  });

  it('gives no number of days without a measured dry-down', () => {
    const r = rec('Monstera', 44);
    expect(r.daysUntilDue).toBeNull();
    expect(r.explain.calculated).not.toMatch(/day/);
  });

  it('more headroom means more days', () => {
    const mk = (cut: number) => {
      const history = simulateTrace({ days: 30, full: 72, floor: 6, tauDays: 7, waterAt: 31, lastWaterDaysAgo: cut });
      return recommendationFor({ plant: makePlant('Monstera'), reading: history[history.length - 1], history, now: NOW }).daysUntilDue;
    };
    const early = mk(2);
    const late = mk(6);
    if (early != null && late != null) expect(early).toBeGreaterThan(late);
  });
});
