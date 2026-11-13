import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MODEL_VERSIONS } from '@/lib/modelVersion';

import { createDb, type Db } from './harness';

/**
 * The ESP32-C3 upload path (supabase/migrations/20261112120000_c3_sensors.sql),
 * exercised the way firmware/greenr_sensor_c3 calls it: one POST per wake, as the
 * anon role, carrying the reading just taken plus any backlog.
 */

let db: Db;
let owner: string;
let dev: string;
const SECRET = 'c3-secret';

type Row = { ago?: number; soil?: number | null; lux?: number | null; t?: number | null; h?: number | null; bat?: number | null };
const ingest = (rows: Row[] | unknown, fw = 'c3-1.0', rssi: number | null = -61, secret = SECRET) =>
  db.as<{ r: any }>(null, `select public.ingest_v2($1, $2, $3::jsonb, $4, $5) as r`, [dev, secret, JSON.stringify(rows), fw, rssi]);

beforeAll(async () => {
  db = await createDb();
  owner = await db.newUser('c3@example.com');
  dev = (await db.sql<{ id: string }>(
    `insert into public.devices (user_id, secret, plant_key) values ($1, $2, 'pl-c3') returning id`, [owner, SECRET],
  ))[0].id;
}, 120_000);

afterAll(async () => { await db?.close(); });

describe('ingest_v2', () => {
  it('rejects a wrong secret', async () => {
    await expect(ingest([{ ago: 0, soil: 2500 }], 'c3-1.0', -60, 'wrong')).rejects.toThrow(/bad device or secret/);
  });

  it('stores lux, battery and signal, and answers in the shape the firmware parses', async () => {
    const [{ r }] = await ingest([
      { ago: 7200, soil: 2600, lux: 15000.5, t: 22.1, h: 51.2, bat: 4010 },
      { ago: 0, soil: 2650, lux: 820.3, t: 21.4, h: 54, bat: 3995 },
    ]);
    expect(r).toEqual({ read_now: false, wake_seconds: 10800, inserted: 2, skipped: 0 });
    const rows = await db.sql<any>(`select * from public.readings where device_id = $1 order by created_at`, [dev]);
    expect(rows).toHaveLength(2);
    const [old, cur] = rows;
    expect(Number(cur.lux)).toBe(820.3);
    expect(cur.soil_raw).toBe(2650);
    expect(Number(cur.soil_pct)).toBe(2650);          // legacy column carries the same count
    expect(cur.light_lux).toBeNull();                  // never mistaken for an LDR count by old builds
    expect(cur.light_raw).toBeNull();
    expect(cur.battery_mv).toBe(3995);
    expect(cur.battery_pct).toBeGreaterThan(70);
    expect(cur.rssi_dbm).toBe(-61);
    expect(old.rssi_dbm).toBeNull();                   // the signal belongs to this upload, not the backlog
    expect(cur.plant_key).toBe('pl-c3');
    expect(cur.quality).toBe(0);
    const gapH = (new Date(cur.created_at).getTime() - new Date(old.created_at).getTime()) / 3_600_000;
    expect(gapH).toBeCloseTo(2, 2);
  });

  it('updates the device: firmware, battery, signal, last seen', async () => {
    const [d] = await db.sql<any>(`select * from public.devices where id = $1`, [dev]);
    expect(d.firmware_version).toBe('c3-1.0');
    expect(d.battery_mv).toBe(3995);                   // the newest reading's, not the backlog's
    expect(d.rssi_dbm).toBe(-61);
    expect(Date.now() - new Date(d.last_seen).getTime()).toBeLessThan(60_000);
  });

  it('is idempotent: the same backlog sent again is skipped', async () => {
    const before = (await db.sql<any>(`select count(*)::int n from public.readings where device_id = $1`, [dev]))[0].n;
    const [{ r }] = await ingest([
      { ago: 7200, soil: 2600, lux: 15000.5, t: 22.1, h: 51.2, bat: 4010 },
      { ago: 0, soil: 2650, lux: 820.3, t: 21.4, h: 54, bat: 3995 },
    ]);
    expect(r.inserted).toBe(0);
    expect(r.skipped).toBe(2);
    expect((await db.sql<any>(`select count(*)::int n from public.readings where device_id = $1`, [dev]))[0].n).toBe(before);
  });

  it('a malformed row is skipped without losing the rest', async () => {
    const [{ r }] = await ingest([{ ago: 'soon', soil: 2700 }, { ago: 60, soil: 'x' }, { ago: 120, soil: 2710, lux: 400 }]);
    expect(r.inserted).toBe(1);
    expect(r.skipped).toBe(2);
  });

  it('bounds the batch and the backdating', async () => {
    await expect(ingest(Array.from({ length: 49 }, (_, i) => ({ ago: i * 60, soil: 2000 + i })))).rejects.toThrow(/max 48/);
    await expect(ingest({ not: 'an array' })).rejects.toThrow(/must be an array/);
    await ingest([{ ago: 10 * 365 * 86400, soil: 2111 }, { ago: -500, soil: 2112 }]);
    const rows = await db.sql<any>(`select created_at from public.readings where device_id = $1 and soil_raw in (2111, 2112)`, [dev]);
    for (const row of rows) {
      const t = new Date(row.created_at).getTime();
      expect(t).toBeLessThanOrEqual(Date.now() + 1000);
      expect(t).toBeGreaterThan(Date.now() - 31 * 86400_000);
    }
  });

  it('USB power (no battery) and missing sensors are stored as null, not zero', async () => {
    await ingest([{ ago: 30, soil: 2800, lux: null, t: null, h: null, bat: null }]);
    const [row] = await db.sql<any>(`select * from public.readings where device_id = $1 and soil_raw = 2800`, [dev]);
    expect(row.battery_mv).toBeNull();
    expect(row.battery_pct).toBeNull();
    expect(row.lux).toBeNull();
    expect(row.temp_c).toBeNull();
  });

  it('cannot be used to read anything back, and other users cannot see the rows', async () => {
    const stranger = await db.newUser('stranger@example.com');
    expect(await db.as(stranger, `select * from public.readings where device_id = $1`, [dev])).toEqual([]);
    expect((await db.as<any>(owner, `select count(*)::int n from public.readings where device_id = $1`, [dev]))[0].n).toBeGreaterThan(0);
    await expect(db.as(null, `select public.reading_quality_v2($1, 1, 1, 1, 1)`, [dev])).rejects.toThrow(/permission denied/);
  });
});

describe('battery: millivolts → percent', () => {
  const pct = async (mv: number | null) =>
    (await db.sql<{ p: number | null }>(`select public.battery_pct_from_mv($1) as p`, [mv]))[0].p;

  it.each([[4200, 100], [4250, 100], [4100, 90], [3800, 50], [3700, 30], [3600, 12], [3500, 5], [3400, 0], [3300, 0]])(
    '%s mV → %s %%', async (mv, want) => { expect(await pct(mv)).toBe(want); });

  it('no battery, or not a lithium cell, is null', async () => {
    expect(await pct(null)).toBeNull();
    expect(await pct(0)).toBeNull();
    expect(await pct(2400)).toBeNull();
    expect(await pct(9000)).toBeNull();
  });

  it('never decreases as voltage rises', async () => {
    let prev = -1;
    for (let mv = 3300; mv <= 4300; mv += 10) {
      const p = (await pct(mv)) as number;
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('quality flags on the sensor’s own scale', () => {
  it('a dry C3 reading is not flagged "not in soil" before the sensor is calibrated', async () => {
    await ingest([{ ago: 200, soil: 3600, lux: 300 }]);
    const [row] = await db.sql<any>(`select quality from public.readings where device_id = $1 and soil_raw = 3600`, [dev]);
    expect(row.quality & 4).toBe(0);
  });

  it('after calibration, a count above this sensor’s own air reading is', async () => {
    await db.as(owner, `select public.set_sensor_calibration($1, 'moisture', 'endpoints', '{"dryAdc":3700,"wetAdc":1700}')`, [dev]);
    await ingest([{ ago: 300, soil: 3850, lux: 300 }, { ago: 400, soil: 3600, lux: 300 }]);
    const rows = await db.sql<any>(`select soil_raw, quality from public.readings where device_id = $1 and soil_raw in (3850, 3600) order by soil_raw`, [dev]);
    expect(rows.find((r: any) => r.soil_raw === 3850).quality & 4).toBe(4);
    expect(rows.filter((r: any) => r.soil_raw === 3600).every((r: any) => (r.quality & 4) === 0)).toBe(true);
  });

  it('flags lux pinned at the BH1750 ceiling and a disconnected probe', async () => {
    await ingest([{ ago: 500, soil: 2222, lux: 121557.2 }, { ago: 600, soil: 150, lux: 10 }]);
    const sat = (await db.sql<any>(`select quality from public.readings where device_id = $1 and soil_raw = 2222`, [dev]))[0];
    expect(sat.quality & 8).toBe(8);
    const disc = (await db.sql<any>(`select quality, soil_raw from public.readings where device_id = $1 and soil_pct = 150`, [dev]))[0];
    expect(disc.quality & 2).toBe(2);
    expect(disc.soil_raw).toBe(150);                  // the raw count is kept; the flag says it is unusable
  });

  it('older firmware keeps its old behaviour on the old function', async () => {
    const [{ r }] = await db.as<any>(null, `select public.ingest_reading($1,$2,1500,0,3500,21,50,-1,0) as r`, [dev, SECRET]);
    expect(r.wake_seconds).toBe(10800);
    const [row] = await db.sql<any>(`select quality, lux from public.readings where device_id = $1 and soil_raw = 3500`, [dev]);
    expect(row.quality & 4).toBe(4);
    expect(row.lux).toBeNull();
  });
});

describe('daily summary includes lux and battery', () => {
  it('matches a direct aggregate, and a rebuild reproduces the trigger', async () => {
    const direct = await db.sql<any>(`
      select (created_at at time zone 'UTC')::date as day,
             count(*) filter (where lux is not null and (quality & 8) = 0)::int lux_n,
             round(coalesce(sum(lux) filter (where lux is not null and (quality & 8) = 0), 0), 3) lux_sum,
             max(lux) filter (where (quality & 8) = 0) lux_max,
             min(battery_mv) bat
        from public.readings where device_id = $1 group by 1 order by 1`, [dev]);
    const rolled = await db.sql<any>(`select day, lux_n, round(lux_sum, 3) lux_sum, lux_max, bat_mv_min from public.reading_daily where device_id = $1 order by day`, [dev]);
    expect(rolled.length).toBe(direct.length);
    direct.forEach((d, i) => {
      expect(rolled[i].lux_n).toBe(d.lux_n);
      expect(Number(rolled[i].lux_sum)).toBeCloseTo(Number(d.lux_sum), 3);
      expect(rolled[i].lux_max == null ? null : Number(rolled[i].lux_max)).toBe(d.lux_max == null ? null : Number(d.lux_max));
      expect(rolled[i].bat_mv_min).toBe(d.bat);
    });
    const before = await db.sql<any>(`select * from public.reading_daily order by device_id, day`);
    await db.sql(`select public.rebuild_reading_daily()`);
    expect(await db.sql<any>(`select * from public.reading_daily order by device_id, day`)).toEqual(before);
    const [view] = await db.as<any>(owner, `select lux_mean, lux_max, bat_mv_min from public.v_reading_daily_v2 where device_id = $1 limit 1`, [dev]);
    expect(view).toBeTruthy();
    // the platform migration's view keeps its original columns, so that file stays re-runnable
    const cols = (await db.sql<any>(`select column_name from information_schema.columns where table_name = 'v_reading_daily'`)).map((c: any) => c.column_name);
    expect(cols).not.toContain('lux_mean');
  });
});

describe('model versions', () => {
  it('every version the app stamps on its output is registered in the database', async () => {
    for (const [component, version] of Object.entries(MODEL_VERSIONS)) {
      const rows = await db.sql<any>(`select 1 from public.model_versions where component = $1 and version = $2`, [component, version]);
      expect(rows.length, `${component} ${version}`).toBe(1);
    }
  });
});
