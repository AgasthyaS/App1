import { describe, expect, it } from 'vitest';

import { applyCalibration, emptyCalibration } from '@/lib/calibration';
import { normalizeReading, type Reading } from '@/lib/devices';
import { recommendationFor } from '@/lib/recommendation';
import { validateSoil } from '@/lib/sensing/moisture';
import { waterAction } from '@/lib/waterAction';

import { HOUR, NOW, makePlant } from './helpers';

/** A row as the database returns it (before normalizeReading). */
const dbRow = (over: Partial<Reading>): Reading => ({
  device_id: 'dev-test',
  soil_pct: null,
  soil_raw: null,
  light_lux: null,
  dli: null,
  temp_c: 21,
  humidity_pct: 50,
  battery_pct: null,
  created_at: new Date(NOW).toISOString(),
  ...over,
});

describe('a soil count is read as what it is', () => {
  it('a count from the raw column is never mistaken for an old percentage', () => {
    for (const c of [0, 60, 100, 150, 199]) {
      // ingest_v2 stores the same count in both columns
      const r = normalizeReading(dbRow({ soil_raw: c, soil_pct: c }));
      expect(r.soil_quality, `count ${c}`).toBe('disconnected');
      expect(r.soil_pct, `count ${c} has no moisture value`).toBeNull();
    }
  });

  it('old firmware rows that sent a percentage still read as before', () => {
    const r = normalizeReading(dbRow({ soil_raw: null, soil_pct: 45 }));
    expect(r.soil_quality).toBe('legacy-index');
    expect(r.soil_pct).toBe(45);
  });

  it('a normal count converts as before', () => {
    const r = normalizeReading(dbRow({ soil_raw: 2210, soil_pct: 2210 }));
    expect(r.soil_quality).toBe('ok');
    expect(r.soil_pct).toBe(50); // halfway between 3020 and 1400
  });

  it('validateSoil only treats 0–100 as a percentage when the value did not come from the raw column', () => {
    expect(validateSoil(50).quality).toBe('legacy-index');
    expect(validateSoil(50, null, true).quality).toBe('disconnected');
  });

  it('calibration never turns a disconnected probe back into a number', () => {
    const cal = { ...emptyCalibration(), soilEndpoints: { dryAdc: 3600, wetAdc: 1700 } };
    const r = applyCalibration(normalizeReading(dbRow({ soil_raw: 40, soil_pct: 40 })), cal);
    expect(r.soil_quality).toBe('disconnected');
    expect(r.soil_pct).toBeNull();
  });
});

describe('no watering advice from a probe that cannot be trusted', () => {
  const history = (last: Reading) => [
    ...Array.from({ length: 6 }, (_, i) =>
      normalizeReading(dbRow({ soil_raw: 2210, soil_pct: 2210, created_at: new Date(NOW - (7 - i) * HOUR).toISOString() }))),
    last,
  ];
  const act = (last: Reading) => waterAction({ plant: makePlant('Monstera'), reading: last, history: history(last), now: NOW });

  it('unplugged: says check the probe, does not say "awaiting first reading" or pour', () => {
    const a = act(normalizeReading(dbRow({ soil_raw: 0, soil_pct: 0 })));
    expect(a.kind).toBe('hold');
    expect(a.ml).toBe(0);
    expect(a.line).toMatch(/Check the probe/);
  });

  it('out of the soil: does not ask for water', () => {
    const cal = { ...emptyCalibration(), soilEndpoints: { dryAdc: 3600, wetAdc: 1700 } };
    const out = applyCalibration(normalizeReading(dbRow({ soil_raw: 3750, soil_pct: 3750 })), cal);
    expect(out.soil_quality).toBe('not-inserted');
    const a = act(out);
    expect(a.kind).toBe('hold');
    expect(a.ml).toBe(0);
    expect(a.line).toMatch(/out of the soil/);
  });

  it('past the water reading: says check the probe', () => {
    const cal = { ...emptyCalibration(), soilEndpoints: { dryAdc: 3600, wetAdc: 1700 } };
    const wet = applyCalibration(normalizeReading(dbRow({ soil_raw: 1300, soil_pct: 1300 })), cal);
    expect(wet.soil_quality).toBe('beyond-wet');
    expect(act(wet).kind).toBe('hold');
  });
});

describe('the advice card says the same', () => {
  it('a disconnected probe is a fault, not "waiting for a first reading"', () => {
    const h = Array.from({ length: 6 }, (_, i) =>
      normalizeReading(dbRow({ soil_raw: 2210, soil_pct: 2210, created_at: new Date(NOW - (7 - i) * HOUR).toISOString() })));
    const last = normalizeReading(dbRow({ soil_raw: 0, soil_pct: 0 }));
    const r = recommendationFor({ plant: makePlant('Monstera'), reading: last, history: [...h, last], now: NOW });
    expect(r.state).toBe('inconsistent');
    expect(r.headline).toMatch(/faulty/);
    expect(r.ml).toBe(0);
  });
});
