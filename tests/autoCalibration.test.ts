import { describe, expect, it } from 'vitest';

import { applyCalibration, emptyCalibration } from '@/lib/calibration';
import type { Reading } from '@/lib/devices';
import { getSpecies } from '@/lib/plants';
import {
  SOIL_SCALE_SD,
  WET_TO_DRY_RATIO,
  autoEndpointsChanged,
  autoSoilEndpoints,
  effectiveSoilEndpoints,
  latestBurst,
  type AutoSoilEndpoints,
} from '@/lib/sensing/autoCalibration';
import { currentSoilLevel } from '@/lib/sensing/level';
import { FACTORY_SOIL_ENDPOINTS, soilIndex } from '@/lib/sensing/moisture';
import { waterAction } from '@/lib/waterAction';
import { perPointFor, pourLogSd, withoutOutlierPours } from '@/lib/waterBalance';
import { CAUTION_FLOOR, pourStep, uncertaintyCaution } from '@/lib/watering';

import { DAY, HOUR, NOW, makePlant, reading } from './helpers';

/** A reading as the firmware sends it: a raw count, converted on the factory scale. */
const raw = (atMs: number, count: number, over: Partial<Reading> = {}): Reading => ({
  device_id: 'dev-test',
  soil_raw: count,
  soil_pct: soilIndex(count),
  soil_quality: 'ok',
  light_lux: 40,
  dli: null,
  temp_c: 22,
  humidity_pct: 55,
  battery_pct: null,
  created_at: new Date(atMs).toISOString(),
  ...over,
});
/** A reading with an exact index value (for the level tests). */
const idx = (atMs: number, v: number, over: Partial<Reading> = {}): Reading => reading(atMs, v, { soil_pct: v, ...over });

const T0 = NOW - 5 * DAY;
/** The firmware's setup burst in open air: power-up reading + two ~95 s apart. */
const burst = (air: number, at = T0) => [raw(at, air), raw(at + 95_000, air + 10), raw(at + 190_000, air - 5)];
/** Hourly in-soil readings after the probe goes in. */
const inSoil = (n: number, from: number, step: number, at = T0) =>
  Array.from({ length: n }, (_, i) => raw(at + (i + 1) * HOUR, from + i * step));

describe('automatic soil endpoints', () => {
  it('measures the air end from the setup burst and estimates the water end from it', () => {
    const auto = autoSoilEndpoints([...burst(3600), ...inSoil(48, 2500, 4)], null, NOW)!;
    expect(auto.method).toBe('air');
    expect(auto.dryAdc).toBe(3600); // median of 3600, 3610, 3595 — not any single reading
    expect(auto.wetAdc).toBe(Math.round(3600 * WET_TO_DRY_RATIO));
    expect(auto.n).toBe(51);
    expect(auto.clipped).toBeUndefined();
  });

  it('never takes the air end from a single reading', () => {
    const one = autoSoilEndpoints([raw(T0, 3600), ...inSoil(48, 2500, 4)], null, NOW);
    expect(one?.method).not.toBe('air');
  });

  it('bounds the water end by the wettest soil actually seen', () => {
    const wet = [raw(T0 + HOUR, 1300), raw(T0 + 2 * HOUR, 1300), raw(T0 + 3 * HOUR, 1300)];
    const later = Array.from({ length: 27 }, (_, i) => raw(T0 + (i + 4) * HOUR, 1400 + i * 25));
    const auto = autoSoilEndpoints([...burst(3000), ...wet, ...later], null, NOW)!;
    expect(auto.method).toBe('air');
    expect(auto.wetAdc).toBe(1250); // 1300 − 50, below the ratio estimate of 1391
    expect(auto.dryAdc - auto.wetAdc).toBeGreaterThanOrEqual(400);
  });

  it('a dry pot pressed with RST before a watering is accepted at first, then demoted when the soil dries back up', () => {
    const base = Array.from({ length: 30 }, (_, i) => raw(T0 + i * 3 * HOUR, 2900 + i * 7));
    const tc = T0 + 30 * 3 * HOUR;
    const rst = [raw(tc, 3150), raw(tc + 120_000, 3160)];
    const watered = [raw(tc + HOUR, 2600), raw(tc + 4 * HOUR, 2610)];
    const early = autoSoilEndpoints([...base, ...rst, ...watered], null, NOW)!;
    expect(early.method).toBe('air'); // indistinguishable from setup — so far
    const dryBack = Array.from({ length: 20 }, (_, i) => raw(tc + (7 + i * 3) * HOUR, 2650 + i * 32));
    const later = autoSoilEndpoints([...base, ...rst, ...watered, ...dryBack], early, NOW)!;
    expect(later.method).toBe('data'); // soil read as high as the "air" count: it was never air
    expect(later.dryAdc).toBeGreaterThan(Math.max(...dryBack.map((r) => r.soil_raw as number)));
  });

  it('keeps a measured air end after the setup readings scroll out of the window', () => {
    const prior: AutoSoilEndpoints = { dryAdc: 3600, wetAdc: 1669, method: 'air', n: 51, at: new Date(T0).toISOString() };
    const kept = autoSoilEndpoints(inSoil(30, 2500, 5), prior, NOW)!;
    expect(kept.method).toBe('air');
    expect(kept.dryAdc).toBe(3600);
  });

  it('without an air reading, only enough data can move the scale, and never below what the soil reads', () => {
    expect(autoSoilEndpoints(inSoil(10, 3200, 3), null, NOW)).toBeNull();
    const auto = autoSoilEndpoints(inSoil(30, 3200, 3), null, NOW)!;
    expect(auto.method).toBe('data');
    expect(auto.dryAdc).toBeGreaterThanOrEqual(3287 + 100); // above the driest soil reading
    expect(auto.wetAdc).toBe(Math.round(auto.dryAdc * WET_TO_DRY_RATIO));
  });

  it('marks an air burst stuck at the top of the converter as clipped', () => {
    const auto = autoSoilEndpoints([raw(T0, 4095), raw(T0 + 95_000, 4095), raw(T0 + 190_000, 4095), ...inSoil(30, 2600, 3)], null, NOW)!;
    expect(auto.clipped).toBe(true);
    expect(effectiveSoilEndpoints(null, auto).sd).toBe(SOIL_SCALE_SD['auto-air'] + 3);
  });

  it('only stores a change that matters', () => {
    const a: AutoSoilEndpoints = { dryAdc: 3600, wetAdc: 1669, method: 'air', n: 10, at: '' };
    expect(autoEndpointsChanged(null, a)).toBe(true);
    expect(autoEndpointsChanged(a, { ...a, n: 20 })).toBe(false);
    expect(autoEndpointsChanged(a, { ...a, dryAdc: 3610 })).toBe(false);
    expect(autoEndpointsChanged(a, { ...a, dryAdc: 3630 })).toBe(true);
    expect(autoEndpointsChanged(a, { ...a, method: 'data' })).toBe(true);
    expect(autoEndpointsChanged(a, null)).toBe(false);
  });

  it('reports setup-burst progress for the pairing screen', () => {
    const hist = [raw(T0 - 6 * HOUR, 2500), ...burst(3600)];
    expect(latestBurst(hist)).toEqual({ n: 3, spread: 15, raw: 3600 });
    expect(latestBurst([])).toBeNull();
  });
});

describe('which scale a reading is converted with', () => {
  const auto: AutoSoilEndpoints = { dryAdc: 3600, wetAdc: 1669, method: 'air', n: 51, at: '' };

  it('hand captures beat automatic ones; the factory pair is the last resort', () => {
    expect(effectiveSoilEndpoints({ dryAdc: 3500, wetAdc: 1600 }, auto)).toMatchObject({ source: 'manual', judgesInsertion: true });
    const mixed = effectiveSoilEndpoints({ dryAdc: 3500 }, auto);
    expect(mixed).toMatchObject({ source: 'mixed', judgesInsertion: true });
    expect(mixed.endpoints).toEqual({ dryAdc: 3500, wetAdc: Math.min(Math.round(3500 * WET_TO_DRY_RATIO), 1669) });
    expect(effectiveSoilEndpoints({ wetAdc: 1500 }, { ...auto, method: 'data' })).toMatchObject({ source: 'mixed', judgesInsertion: false });
    expect(effectiveSoilEndpoints(null, auto)).toMatchObject({ source: 'auto-air', sd: SOIL_SCALE_SD['auto-air'], judgesInsertion: true });
    expect(effectiveSoilEndpoints(null, { ...auto, method: 'data' })).toMatchObject({ source: 'auto-data', judgesInsertion: false });
    expect(effectiveSoilEndpoints(null, null)).toMatchObject({ source: 'factory', endpoints: FACTORY_SOIL_ENDPOINTS });
  });

  it('applyCalibration converts on the automatic scale and labels how certain it is', () => {
    const cal = { ...emptyCalibration(), soilEndpointsAuto: auto };
    const mid = Math.round((3600 + 1669) / 2);
    const r = applyCalibration(raw(NOW, mid), cal);
    expect(r.soil_pct).toBeCloseTo(50, 0);
    expect(r.soil_scale).toBe('auto-air');
    expect(r.soil_sd).toBe(SOIL_SCALE_SD['auto-air']);
    // a measured air end may judge "not in the soil"…
    expect(applyCalibration(raw(NOW, 3750), cal).soil_quality).toBe('not-inserted');
    // …an estimated one may not
    const dataCal = { ...emptyCalibration(), soilEndpointsAuto: { ...auto, method: 'data' as const } };
    expect(applyCalibration(raw(NOW, 3750), dataCal).soil_quality).toBe('ok');
  });
});

describe('the soil level now: several readings, not one', () => {
  it('on a steady dry-down it equals the newest value — no lag from averaging', () => {
    const h = Array.from({ length: 24 }, (_, i) => idx(NOW - (23 - i) * HOUR, 60 - 0.2 * i));
    const level = currentSoilLevel(h[h.length - 1], h)!;
    expect(level.pct).toBe(55.4); // a plain median of the last 4 would say 55.7
    expect(level.slopePerHour).toBeCloseTo(-0.2, 3);
    expect(level.n).toBe(4);
  });

  it('one noisy reading does not move it, high or low', () => {
    const flat = Array.from({ length: 12 }, (_, i) => idx(NOW - (14 - i) * HOUR, 40));
    const spike = [...flat, idx(NOW - 2 * HOUR, 40), idx(NOW - HOUR, 48), idx(NOW, 40)];
    expect(currentSoilLevel(spike[spike.length - 1], spike)!.pct).toBe(40);
    const dip = [...flat, idx(NOW - 2 * HOUR, 40.2), idx(NOW - HOUR, 39.8), idx(NOW, 25)];
    expect(currentSoilLevel(dip[dip.length - 1], dip)!.pct).toBeCloseTo(40, 0);
  });

  it('after a watering, only the readings since the watering count', () => {
    const before = Array.from({ length: 12 }, (_, i) => idx(NOW - (14 - i) * HOUR, 30));
    const after = [idx(NOW - 2 * HOUR, 55), idx(NOW - HOUR, 54), idx(NOW, 53)];
    const level = currentSoilLevel(after[2], [...before, ...after])!;
    expect(level.pct).toBe(54);
    expect(level.n).toBe(3);
  });

  it('a reading the probe cannot be trusted for is reported as it is, not smoothed away', () => {
    const h = Array.from({ length: 6 }, (_, i) => idx(NOW - (6 - i) * HOUR, 40));
    const out = idx(NOW, 0, { soil_quality: 'not-inserted' });
    expect(currentSoilLevel(out, [...h, out])).toMatchObject({ pct: 0, n: 1 });
  });

  it('carries the scale uncertainty of the sensor', () => {
    const h = Array.from({ length: 6 }, (_, i) => idx(NOW - (5 - i) * HOUR, 40, { soil_sd: 7 }));
    expect(currentSoilLevel(h[5], h)!.scaleSd).toBe(7);
    const f = Array.from({ length: 6 }, (_, i) => idx(NOW - (5 - i) * HOUR, 40));
    expect(currentSoilLevel(f[5], f)!.scaleSd).toBe(SOIL_SCALE_SD.factory);
  });
});

describe('logged pours: guessed amounts and mistakes', () => {
  it('a tapped preset counts for less than a measured amount', () => {
    expect(pourLogSd({ risePts: 15, source: 'preset' })).toBeGreaterThan(pourLogSd({ risePts: 15, source: 'measured' }));
    expect(pourLogSd({ risePts: 15, source: 'unknown' })).toBe(pourLogSd({ risePts: 15, source: 'preset' }));
  });

  it('one pour wildly out of line with the rest is set aside; two cannot outvote each other', () => {
    const r = withoutOutlierPours([{ mlPerPoint: 10 }, { mlPerPoint: 11 }, { mlPerPoint: 9.5 }, { mlPerPoint: 50 }]);
    expect(r.dropped.map((p) => p.mlPerPoint)).toEqual([50]);
    expect(withoutOutlierPours([{ mlPerPoint: 10 }, { mlPerPoint: 30 }]).dropped).toHaveLength(0);
  });

  it('the same two pours are less certain when their amounts were guessed', () => {
    // hourly readings, drying 0.15/h, two pours that each lift the soil 15 points
    const pours = [NOW - 3.5 * DAY, NOW - 1.5 * DAY];
    const hist: Reading[] = [];
    let v = 50;
    for (let t = NOW - 5 * DAY; t <= NOW; t += HOUR) {
      if (pours.some((p) => p > t - HOUR && p <= t)) v += 15;
      hist.push(idx(t, Math.round(v * 10) / 10));
      v -= 0.15;
    }
    const logged = (source: 'measured' | 'preset') => makePlant('Monstera', {
      waterLog: pours.map((p) => ({ at: new Date(p - 10 * 60_000).toISOString(), ml: 300, source })),
    });
    const measured = perPointFor(logged('measured'), hist, 40, NOW);
    const guessed = perPointFor(logged('preset'), hist, 40, NOW);
    expect(measured.cleanPours).toBe(2);
    expect(guessed.cleanPours).toBe(2);
    expect(guessed.estimatedPours).toBe(2);
    expect(measured.estimatedPours).toBe(0);
    expect(guessed.sdLog).toBeGreaterThan(measured.sdLog);
    expect(guessed.note).toMatch(/estimated/);
  });
});

describe('the dose leans low when the answer is uncertain', () => {
  it('no uncertainty, no reduction; never below the floor', () => {
    expect(uncertaintyCaution(0, 0, 20)).toMatchObject({ factor: 1, note: '' });
    expect(uncertaintyCaution(2, 40, 2).factor).toBe(CAUTION_FLOOR);
  });

  it('more uncertainty never means more water', () => {
    let prev = 1;
    for (const sd of [0, 0.1, 0.3, 0.6, 1]) {
      const f = uncertaintyCaution(sd, 5, 20).factor;
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });

  it('an uncalibrated scale gets a smaller pour than a calibrated one for the same reading', () => {
    const plant = makePlant('Monstera');
    const balance = { mlPerPoint: 10, basis: 'measured', note: 'Measured.', sdLog: 0.05 };
    const tight = pourStep(plant, { soilPct: 20, targetPct: 40, soilSdPts: 3 }, null, balance);
    const loose = pourStep(plant, { soilPct: 20, targetPct: 40, soilSdPts: 15 }, null, balance);
    expect(tight.ml).toBeLessThanOrEqual(200);
    expect(loose.ml).toBeLessThan(tight.ml);
    expect(loose.ml).toBeGreaterThanOrEqual(CAUTION_FLOOR * 200 - 25);
    expect(loose.note).toMatch(/less than the central estimate/);
  });
});

describe('watering decisions use the level, not one reading', () => {
  const [lo] = getSpecies('Monstera')!.band;

  it('a single low reading does not trigger "water now"', () => {
    const ok = Array.from({ length: 12 }, (_, i) => idx(NOW - (15 - i) * HOUR, lo + 10));
    const h = [...ok, idx(NOW - 2 * HOUR, lo + 10), idx(NOW - HOUR, lo + 10), idx(NOW, lo - 10)];
    const act = waterAction({ plant: makePlant('Monstera'), reading: h[h.length - 1], history: h, now: NOW });
    expect(act.kind).not.toBe('water');
  });

  it('a sustained low does', () => {
    const ok = Array.from({ length: 12 }, (_, i) => idx(NOW - (15 - i) * HOUR, lo + 10));
    const h = [...ok, idx(NOW - 2 * HOUR, lo - 10), idx(NOW - HOUR, lo - 10), idx(NOW, lo - 10)];
    const act = waterAction({ plant: makePlant('Monstera'), reading: h[h.length - 1], history: h, now: NOW });
    expect(act.kind).toBe('water');
    expect(act.ml).toBeGreaterThan(0);
  });
});
