import { describe, expect, it } from 'vitest';

import { applyCalibration, emptyCalibration, isCalibrated, withSoilEndpoint } from '@/lib/calibration';
import { normalizeReading, type Reading } from '@/lib/devices';
import { dayLight, daytimeLightAvg, recentLightAvg, type DayLight } from '@/lib/insights';
import { LDR_SIGMA, LUX_SENSOR_SIGMA, dliToIndex, estimateDli, indexToLux, luxToIndex, luxToPpfd, photonMeanIndex, ppfdToDli } from '@/lib/lightModel';
import { lightStatus, lightTone } from '@/lib/plantStatus';
import { BH1750_FULL_SCALE_LUX, TYPICAL_LDR, calibrateLdr, ldrCeilingLux, ldrLux, luxQuality, validateLight } from '@/lib/sensing/light';
import {
  ADC_MAX, FACTORY_SOIL_ENDPOINTS, cleanCurve, endpointsValid, rawFromIndex, soilIndex,
  thetaFromCurve, thetaFromWeights, traceConsistency, validateSoil,
} from '@/lib/sensing/moisture';
import { saturationVaporPressureKpa, vpdKpa } from '@/lib/vpd';

import { HOUR, NOW } from './helpers';

const row = (over: Partial<Reading>): Reading => ({
  device_id: 'd', light_lux: null, dli: null, soil_pct: null, temp_c: null, humidity_pct: null,
  battery_pct: null, created_at: new Date(NOW).toISOString(), ...over,
});

describe('soil: raw → validated', () => {
  it('classifies the whole converter range without throwing', () => {
    for (let raw = -50; raw <= ADC_MAX + 50; raw += 7) expect(() => validateSoil(raw)).not.toThrow();
  });
  it.each([
    [0, 'legacy-index'], [55, 'legacy-index'], [100, 'legacy-index'],
    [150, 'disconnected'], [1000, 'beyond-wet'], [1400, 'ok'], [2200, 'ok'], [3020, 'ok'],
    [3120, 'not-inserted'], [4095, 'not-inserted'], [4096, 'invalid'], [-1, 'invalid'],
    [NaN, 'invalid'], [Infinity, 'invalid'],
  ])('against a known scale: raw %s → %s', (raw, quality) => {
    expect(validateSoil(raw as number, FACTORY_SOIL_ENDPOINTS).quality).toBe(quality);
  });
  it('without the sensor’s own scale, only structural faults are flagged', () => {
    // An ESP32-C3 can read 3500 in dry soil. Judged against the dev-kit's factory
    // pair that looked like "not in the soil"; it must not.
    expect(validateSoil(3500).quality).toBe('ok');
    expect(validateSoil(900).quality).toBe('ok');
    expect(validateSoil(150).quality).toBe('disconnected');
    expect(validateSoil(4096).quality).toBe('invalid');
    expect(validateSoil(3500, { dryAdc: 3700, wetAdc: 1700 }).quality).toBe('ok');
    expect(validateSoil(3850, { dryAdc: 3700, wetAdc: 1700 }).quality).toBe('not-inserted');
  });
  it('null and undefined are invalid, not zero', () => {
    expect(validateSoil(null).quality).toBe('invalid');
    expect(validateSoil(undefined).raw).toBeNull();
  });
});

describe('soil: validated → index', () => {
  it('maps the endpoints to 0 and 100 and is linear between', () => {
    const e = { dryAdc: 3000, wetAdc: 1000 };
    expect(soilIndex(3000, e)).toBe(0);
    expect(soilIndex(1000, e)).toBe(100);
    expect(soilIndex(2000, e)).toBe(50);
    expect(soilIndex(2500, e)).toBe(25);
  });
  it('clamps beyond the endpoints and never returns NaN', () => {
    expect(soilIndex(4095)).toBe(0);
    expect(soilIndex(0)).toBe(100);
    expect(soilIndex(NaN)).toBe(0);
  });
  it('round-trips through its inverse', () => {
    for (const i of [0, 12.5, 40, 77, 100]) expect(soilIndex(rawFromIndex(i))).toBeCloseTo(i, 6);
  });
  it('two sensors with different endpoints agree once each uses its own', () => {
    // SIMULATED: the same soil, two probes whose air/water counts differ.
    const a = { dryAdc: 3020, wetAdc: 1400 };
    const b = { dryAdc: 2850, wetAdc: 1250 };
    const truth = 45;
    const rawA = rawFromIndex(truth, a);
    const rawB = rawFromIndex(truth, b);
    expect(soilIndex(rawA, a)).toBeCloseTo(soilIndex(rawB, b), 6);
    // Read through the factory pair, probe B is out by several points.
    expect(Math.abs(soilIndex(rawB, FACTORY_SOIL_ENDPOINTS) - truth)).toBeGreaterThan(5);
  });
  it('rejects endpoint pairs that cannot be air and water', () => {
    expect(endpointsValid({ dryAdc: 3000, wetAdc: 1400 })).toBe(true);
    expect(endpointsValid({ dryAdc: 1400, wetAdc: 3000 })).toBe(false); // reversed
    expect(endpointsValid({ dryAdc: 2000, wetAdc: 1900 })).toBe(false); // too close
    expect(endpointsValid({ dryAdc: NaN, wetAdc: 1400 })).toBe(false);
    expect(endpointsValid({ dryAdc: 5000, wetAdc: 1400 })).toBe(false);
    expect(endpointsValid(null)).toBe(false);
    // An invalid pair falls back to the factory one rather than dividing by ~0.
    expect(soilIndex(2210, { dryAdc: 2000, wetAdc: 2000 })).toBeCloseTo(soilIndex(2210), 6);
  });
});

describe('soil: normalising and calibrating a fetched row', () => {
  it('keeps the raw count beside the index', () => {
    const r = normalizeReading(row({ soil_pct: 2210, light_lux: 1700 }));
    expect(r.soil_raw).toBe(2210);
    expect(r.soil_pct).toBe(50);
    expect(r.soil_quality).toBe('ok');
    expect(r.light_raw).toBe(1700);
  });
  it('is idempotent', () => {
    const once = normalizeReading(row({ soil_pct: 2600, light_lux: 900, temp_c: 21.5, humidity_pct: 48 }));
    expect(normalizeReading(once)).toEqual(once);
  });
  it('passes an older 0–100 row through and marks it', () => {
    const r = normalizeReading(row({ soil_pct: 37 }));
    expect(r.soil_pct).toBe(37);
    expect(r.soil_raw).toBeNull();
    expect(r.soil_quality).toBe('legacy-index');
  });
  it('turns NaN and Infinity into null', () => {
    const r = normalizeReading(row({ soil_pct: NaN, light_lux: Infinity, temp_c: NaN, humidity_pct: -Infinity }));
    expect([r.soil_pct, r.light_lux, r.temp_c, r.humidity_pct]).toEqual([null, null, null, null]);
  });
  it('a sensor’s own endpoints re-derive the index from raw; applying twice changes nothing', () => {
    let cal = emptyCalibration();
    expect(isCalibrated(cal)).toBe(false);
    cal = withSoilEndpoint(cal, 'dry', 2850);
    expect(isCalibrated(cal)).toBe(false); // one end is not a calibration
    cal = withSoilEndpoint(cal, 'wet', 1250);
    expect(isCalibrated(cal)).toBe(true);
    const r = normalizeReading(row({ soil_pct: 2050 }));
    const once = applyCalibration(r, cal);
    expect(once.soil_pct).toBeCloseTo(50, 6);
    expect(applyCalibration(once, cal).soil_pct).toBeCloseTo(50, 6);
    expect(once.soil_raw).toBe(2050); // raw is never rewritten
  });
  it('refuses implausible endpoint captures', () => {
    const cal = emptyCalibration();
    expect(withSoilEndpoint(cal, 'dry', 50)).toBe(cal);
    expect(withSoilEndpoint(cal, 'dry', NaN)).toBe(cal);
    // A "wet" count above the stored "dry" one drops the stale end instead of storing a reversed pair.
    const dry = withSoilEndpoint(cal, 'dry', 2000);
    const bad = withSoilEndpoint(dry, 'wet', 2600);
    expect(endpointsValid(bad.soilEndpoints)).toBe(false);
    expect(bad.soilEndpoints).toMatchObject({ wetAdc: 2600 });
    expect(bad.soilEndpoints?.dryAdc).toBeUndefined();
  });
});

describe('soil: weighed calibration curve', () => {
  const pts = [
    { index: 10, theta: 0.12 }, { index: 30, theta: 0.2 }, { index: 55, theta: 0.38 }, { index: 75, theta: 0.6 },
  ];
  it('passes through every point', () => {
    for (const p of pts) expect(thetaFromCurve(p.index, pts)).toBeCloseTo(p.theta, 10);
  });
  it('is monotone between points — never reports less water for a wetter reading', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 100; i += 0.5) {
      const t = thetaFromCurve(i, pts)!;
      expect(t).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = t;
    }
  });
  it('holds the end values outside the measured range instead of extrapolating', () => {
    expect(thetaFromCurve(0, pts)).toBe(0.12);
    expect(thetaFromCurve(100, pts)).toBe(0.6);
  });
  it('refuses fewer than three usable points, or points that are not increasing', () => {
    expect(thetaFromCurve(40, pts.slice(0, 2))).toBeNull();
    expect(thetaFromCurve(40, [{ index: 10, theta: 0.3 }, { index: 40, theta: 0.2 }, { index: 70, theta: 0.1 }])).toBeNull();
    expect(cleanCurve([{ index: NaN, theta: 0.1 }, { index: 20, theta: 2 }])).toBeNull();
    expect(thetaFromCurve(NaN, pts)).toBeNull();
  });
  it('water content from two weighings is dimensionally right', () => {
    // 1.5 L of substrate, 450 g heavier than dry → 450 cm³ / 1500 cm³ = 0.30
    expect(thetaFromWeights(1650, 1200, 1500)).toBeCloseTo(0.3, 10);
    expect(thetaFromWeights(1000, 1200, 1500)).toBeNull(); // lighter than dry
    expect(thetaFromWeights(4000, 1200, 1500)).toBeNull(); // more water than volume
    expect(thetaFromWeights(1650, 1200, 0)).toBeNull();
  });
});

describe('soil: is the trace believable', () => {
  const smooth = Array.from({ length: 24 }, (_, i) => 60 - i * 0.8);
  it('a smooth dry-down is consistent', () => {
    expect(traceConsistency(smooth)!.inconsistent).toBe(false);
  });
  it('one watering step is not an inconsistency', () => {
    const watered = [...smooth.slice(0, 12), 65, ...smooth.slice(12).map((v) => v + 20)];
    expect(traceConsistency(watered)!.inconsistent).toBe(false);
  });
  it('a single spike is tolerated; a zig-zag is not', () => {
    const spike = smooth.slice(); spike[10] = 95;
    expect(traceConsistency(spike)!.inconsistent).toBe(false);
    const zigzag = Array.from({ length: 24 }, (_, i) => (i % 2 ? 60 : 30));
    expect(traceConsistency(zigzag)!.inconsistent).toBe(true);
  });
  it('needs eight readings, and ignores nulls and NaN', () => {
    expect(traceConsistency([40, 41, 42])).toBeNull();
    expect(traceConsistency([null, NaN, undefined, ...smooth])!.n).toBe(24);
  });
  it('a perfectly flat trace is consistent (no division by zero)', () => {
    const t = traceConsistency(Array(20).fill(42))!;
    expect(t.inconsistent).toBe(false);
    expect(Number.isFinite(t.noisePts)).toBe(true);
  });
});

describe('light: the divider model', () => {
  it('flags both rails', () => {
    expect(validateLight(20).quality).toBe('saturated-bright');
    expect(validateLight(4050).quality).toBe('floor-dark');
    expect(validateLight(2000).quality).toBe('ok');
    expect(validateLight(-3).quality).toBe('invalid');
    expect(validateLight(NaN).quality).toBe('invalid');
  });
  it('brighter light gives a lower count, monotonically', () => {
    let prev = Infinity;
    for (let raw = 200; raw <= 3900; raw += 100) {
      const lux = ldrLux(raw)!;
      expect(lux).toBeLessThan(prev);
      prev = lux;
    }
  });
  it('mid-scale is where the LDR equals the fixed resistor', () => {
    // x = 0.5 → R_ldr = R_fixed = 10 kΩ → E = 10·(12k/10k)^(1/0.7)
    expect(ldrLux(ADC_MAX / 2)).toBeCloseTo(10 * Math.pow(1.2, 1 / 0.7), 6);
  });
  it('one reference lux reading fixes R10 so the model reproduces it', () => {
    const d = calibrateLdr(900, 2500)!;
    expect(ldrLux(900, d)).toBeCloseTo(2500, 6);
    expect(calibrateLdr(10, 2500)).toBeNull(); // at the rail: nothing to calibrate against
    expect(calibrateLdr(900, -1)).toBeNull();
  });
  it('with typical parts the divider stops resolving far below direct sun', () => {
    // The stated limitation, as a number: a few thousand lux at most.
    expect(ldrCeilingLux(TYPICAL_LDR)).toBeLessThan(10_000);
  });
});

describe('light: averaging and the daily integral', () => {
  it('index ↔ lux round-trips and is clamped', () => {
    for (const i of [0, 10, 37.5, 80, 100]) expect(luxToIndex(indexToLux(i))).toBeCloseTo(i, 8);
    expect(luxToIndex(0)).toBe(0);
    expect(luxToIndex(-5)).toBe(0);
    expect(luxToIndex(1e9)).toBe(100);
    expect(luxToIndex(NaN)).toBe(0);
  });
  it('DLI units: 100 µmol/m²/s for 12 h is 4.32 mol/m²/day', () => {
    expect(ppfdToDli(100, 12)).toBeCloseTo(4.32, 10);
    expect(luxToPpfd(10_000)).toBeCloseTo(185, 6);
  });
  it('a constant light averages to itself', () => {
    expect(photonMeanIndex([{ index: 42, weight: 3 }, { index: 42, weight: 9 }])).toBeCloseTo(42, 8);
  });
  it('a varying day averages ABOVE the mean of its index values (Jensen)', () => {
    const half = [{ index: 20, weight: 1 }, { index: 70, weight: 1 }];
    const avg = photonMeanIndex(half)!;
    expect(avg).toBeGreaterThan(45);
    // …and equals the index of the arithmetic-mean illuminance, exactly.
    expect(indexToLux(avg)).toBeCloseTo((indexToLux(20) + indexToLux(70)) / 2, 6);
    // The old f(mean index) figure understated the day's light by more than 2×.
    expect(estimateDli(avg).dli / estimateDli(45).dli).toBeGreaterThan(2);
  });
  it('ignores bad samples and returns null with nothing usable', () => {
    expect(photonMeanIndex([])).toBeNull();
    expect(photonMeanIndex([{ index: NaN, weight: 1 }, { index: 50, weight: 0 }])).toBeNull();
  });
  it('dliToIndex inverts estimateDli and survives bad input', () => {
    expect(dliToIndex(estimateDli(63).dli)).toBeCloseTo(63, 6);
    expect(dliToIndex(-1)).toBe(0);
    expect(dliToIndex(NaN)).toBe(0);
  });

  // SIMULATED day: readings every 3 h, dim morning, bright afternoon.
  const dayStart = new Date(NOW); dayStart.setHours(0, 0, 0, 0);
  const at = (h: number, idx: number, over: Partial<Reading> = {}) =>
    row({ light_lux: idx, created_at: new Date(dayStart.getTime() + h * HOUR).toISOString(), ...over });
  const trace = [at(6, 5), at(9, 20), at(12, 70), at(15, 70), at(18, 20), at(21, 2)];

  it('the day’s figure is the photon-weighted one, above the plain mean of the samples', () => {
    const d = dayLight(trace, dayStart.getTime() + 22 * HOUR)!;
    const plainMean = (20 + 70 + 70 + 20) / 4;
    expect(d.avg).toBeGreaterThan(plainMean);
    expect(d.avg).toBeLessThan(70);
    expect(d.hours).toBeGreaterThan(8);
  });
  it('irregular spacing and a gap do not break it', () => {
    const gappy = [at(7, 30), at(7.2, 31), at(7.4, 30), at(16, 60), at(16.5, 61), at(18.9, 25)];
    const d = dayLight(gappy, dayStart.getTime() + 20 * HOUR);
    if (d) {
      expect(Number.isFinite(d.avg)).toBe(true);
      expect(d.avg).toBeGreaterThanOrEqual(0);
      expect(d.avg).toBeLessThanOrEqual(100);
    }
  });
  it('time at the bright rail is reported, so the day can be called a lower bound', () => {
    const sat = [at(9, 60), at(12, 100, { light_quality: 'saturated-bright' }), at(15, 100, { light_quality: 'saturated-bright' }), at(18, 40)];
    const d = dayLight(sat, dayStart.getTime() + 19 * HOUR)!;
    expect(d.saturatedHours).toBeGreaterThan(3);
  });
  it('too little data yields null, not a number', () => {
    expect(dayLight([at(12, 50)], dayStart.getTime() + 13 * HOUR)).toBeNull();
    expect(dayLight([], NOW)).toBeNull();
    expect(daytimeLightAvg([], NOW)).toBeNull();
  });
  it('blending days also happens in linear light', () => {
    const days: DayLight[] = [{ day: '2026-06-13', avg: 20, hours: 10 }, { day: '2026-06-14', avg: 70, hours: 10 }];
    expect(recentLightAvg(days)!.avg).toBeGreaterThan(45);
  });
});

describe('light: one classifier', () => {
  it('the per-reading status and the tone agree for every index and band', () => {
    for (const band of [[1, 3], [2, 8], [8, 20]] as [number, number][])
      for (let i = 0; i <= 100; i += 5) expect(lightStatus(i, band).tone).toBe(lightTone(i, band));
  });
  it('the same light is fine for a shade plant and too dim for a sun-lover', () => {
    expect(lightTone(20, [1, 3])).toBe('good');
    expect(lightTone(20, [8, 20])).toBe('bad');
    expect(lightTone(90, [1, 3])).toBe('warn');
    expect(lightTone(90, [8, 20])).toBe('good');
  });
});

describe('air: saturation vapour pressure and VPD', () => {
  it.each([[0, 0.6108], [20, 2.3388], [25, 3.1690], [30, 4.2455]])('SVP at %s °C ≈ %s kPa', (t, kpa) => {
    expect(saturationVaporPressureKpa(t)).toBeCloseTo(kpa, 2);
  });
  it('VPD is zero at saturation, equals SVP in perfectly dry air, and is never negative', () => {
    expect(vpdKpa(22, 100)).toBe(0);
    expect(vpdKpa(22, 0)).toBeCloseTo(saturationVaporPressureKpa(22), 10);
    expect(vpdKpa(22, 140)).toBe(0);
    expect(vpdKpa(22, -10)).toBeCloseTo(saturationVaporPressureKpa(22), 10);
  });
  it('missing or non-finite inputs give null', () => {
    expect(vpdKpa(null, 50)).toBeNull();
    expect(vpdKpa(22, undefined)).toBeNull();
    expect(vpdKpa(NaN, 50)).toBeNull();
  });
  it('warmer air at the same humidity is thirstier', () => {
    expect(vpdKpa(28, 60)!).toBeGreaterThan(vpdKpa(22, 60)! * 1.3);
  });
});

describe('ESP32-C3 rows: BH1750 lux, battery, own-scale soil checks', () => {
  const c3 = (over: Partial<Reading>) =>
    row({ soil_pct: 2900, soil_raw: 2900, lux: 1200, battery_mv: 3950, rssi_dbm: -61, temp_c: 21.5, humidity_pct: 48, ...over });

  it('a lux reading becomes the light index exactly, and the photoresistor path is not used', () => {
    const r = normalizeReading(c3({}));
    expect(r.light_lux).toBeCloseTo(luxToIndex(1200), 10);
    expect(indexToLux(r.light_lux!)).toBeCloseTo(1200, 6);
    expect(r.light_raw).toBeNull();
    expect(r.light_quality).toBe('ok');
    expect(r.battery_mv).toBe(3950);
    expect(r.rssi_dbm).toBe(-61);
  });

  it('is idempotent with lux', () => {
    const once = normalizeReading(c3({}));
    expect(normalizeReading(once)).toEqual(once);
  });

  it('lux at the BH1750 ceiling is flagged as a lower bound; dark is 0, not an error', () => {
    expect(normalizeReading(c3({ lux: 121557 })).light_quality).toBe('saturated-bright');
    expect(luxQuality(BH1750_FULL_SCALE_LUX - 1)).toBe('ok');
    const dark = normalizeReading(c3({ lux: 0 }));
    expect(dark.light_lux).toBe(0);
    expect(dark.light_quality).toBe('ok');
  });

  it('a missing or negative lux falls back to whatever light the row has, never NaN', () => {
    expect(normalizeReading(c3({ lux: null, light_lux: null })).light_lux).toBeNull();
    expect(normalizeReading(c3({ lux: -1, light_lux: null })).light_lux).toBeNull();
    expect(normalizeReading(c3({ lux: NaN, light_lux: null })).light_lux).toBeNull();
  });

  it('an old LDR row is still read as before', () => {
    const r = normalizeReading(row({ soil_pct: 2210, light_lux: 1700 }));
    expect(r.lux).toBeNull();
    expect(r.light_raw).toBe(1700);
  });

  it('a dry C3 probe is not called "not in the soil" until its own air reading is known', () => {
    const r = normalizeReading(c3({ soil_pct: 3500, soil_raw: 3500 }));
    expect(r.soil_quality).toBe('ok');
    const cal = withSoilEndpoint(withSoilEndpoint(emptyCalibration(), 'dry', 3700), 'wet', 1700);
    expect(applyCalibration(r, cal).soil_quality).toBe('ok');
    expect(applyCalibration(normalizeReading(c3({ soil_pct: 3850, soil_raw: 3850 })), cal).soil_quality).toBe('not-inserted');
    expect(applyCalibration(r, cal).soil_pct).toBeCloseTo(10, 6); // (3700 − 3500) / 2000
  });

  it('a "reversed light sensor" switch left on from an LDR does not flip a lux sensor', () => {
    const cal = { ...emptyCalibration(), lightInverted: true };
    const r = normalizeReading(c3({ lux: 20000 }));
    expect(applyCalibration(r, cal).light_lux).toBeCloseTo(r.light_lux!, 10);
    const ldr = normalizeReading(row({ light_lux: 1700 }));
    expect(applyCalibration(ldr, cal).light_lux).toBeCloseTo(100 - ldr.light_lux!, 10);
  });

  it('the daily-light band is narrower for a lux sensor than for an LDR', () => {
    const ldr = estimateDli(60);
    const lux = estimateDli(60, undefined, LUX_SENSOR_SIGMA);
    expect(lux.dli).toBeCloseTo(ldr.dli, 10);
    expect(ldr.high / ldr.low).toBeCloseTo(LDR_SIGMA ** 2, 10);
    expect(lux.high / lux.low).toBeCloseTo(LUX_SENSOR_SIGMA ** 2, 10);
    // a nonsense band falls back to the conservative one
    expect(estimateDli(60, undefined, 0.5).high / estimateDli(60, undefined, 0.5).low).toBeCloseTo(LDR_SIGMA ** 2, 10);
  });
});
