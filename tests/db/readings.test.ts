import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from './harness';

/**
 * THE READINGS PATH, END TO END: firmware body → ingest_v2 → readings / devices.
 *
 * The body is built the way firmware/greenr_sensor_c3 builds it (rowJson,
 * uploadBacklog), then parsed as JSON — the same thing PostgREST does — so a body
 * the firmware could send but the server could not read fails here first.
 */

const ROOT = path.resolve(__dirname, '../..');
const FIRMWARE = readFileSync(path.join(ROOT, 'firmware/greenr_sensor_c3/greenr_sensor_c3.ino'), 'utf8');
const INGEST_SQL = readFileSync(path.join(ROOT, 'supabase/migrations/20261118120000_readings_accuracy.sql'), 'utf8');

type FwRow = { ago: number; soil: number | null; lux: number | null; t: number | null; h: number | null; bat: number | null };

/** Arduino String(v, 1): fixed one decimal. NaN/inf → null, as jsonNum does. */
const num1 = (v: number | null) => (v == null || !Number.isFinite(v) ? 'null' : v.toFixed(1));
/** Exactly the text rowJson() produces. */
const rowJson = (r: FwRow) =>
  `{"ago":${r.ago},"soil":${r.soil == null ? 'null' : r.soil},"lux":${num1(r.lux)},"t":${num1(r.t)},"h":${num1(r.h)},"bat":${r.bat == null ? 'null' : r.bat}}`;
/** Exactly the text uploadBacklog() produces. */
const body = (device: string, secret: string, rows: FwRow[], rssi = -61, fw = 'c3-1.2') =>
  `{"p_device":"${device}","p_secret":"${secret}","p_fw":"${fw}","p_rssi":${rssi},"p_rows":[${rows.map(rowJson).join(',')}]}`;

let db: Db;
let owner: string;
let dev: string;
const SECRET = 'readings-secret';

/** POST the body as the anon role, the way the sensor does. */
async function post(rows: FwRow[], rssi = -61) {
  const b = JSON.parse(body(dev, SECRET, rows, rssi)); // must be valid JSON
  const [{ r }] = await db.as<{ r: any }>(null, `select public.ingest_v2($1, $2, $3::jsonb, $4, $5) as r`,
    [b.p_device, b.p_secret, JSON.stringify(b.p_rows), b.p_fw, b.p_rssi]);
  return r as { inserted: number; skipped: number; wake_seconds: number; read_now: boolean };
}
const row = (over: Partial<FwRow>): FwRow => ({ ago: 0, soil: 2600, lux: 500, t: 21, h: 50, bat: null, ...over });
const readingsAt = (soil: number) =>
  db.sql<any>(`select * from public.readings where device_id = $1 and soil_raw = $2 order by created_at`, [dev, soil]);

beforeAll(async () => {
  db = await createDb();
  owner = await db.newUser('readings@example.com');
  dev = (await db.sql<{ id: string }>(
    `insert into public.devices (user_id, secret, plant_key) values ($1, $2, 'pl-readings') returning id`, [owner, SECRET],
  ))[0].id;
}, 120_000);

afterAll(async () => { await db?.close(); });

describe('the firmware and the database speak the same language', () => {
  it('every field the firmware sends is one ingest_v2 reads, and vice versa', () => {
    const sent = new Set([...FIRMWARE.matchAll(/\\"([a-z_]+)\\":/g)].map((m) => m[1]));
    const rowKeys = new Set([...INGEST_SQL.matchAll(/r->>'([a-z_]+)'/g)].map((m) => m[1]));
    for (const k of rowKeys) expect(sent, `firmware sends "${k}"`).toContain(k);
    for (const k of ['ago', 'soil', 'lux', 't', 'h', 'bat']) expect(rowKeys, `server reads "${k}"`).toContain(k);
    for (const p of ['p_device', 'p_secret', 'p_fw', 'p_rssi', 'p_rows']) {
      expect(sent, `firmware sends ${p}`).toContain(p);
      expect(INGEST_SQL, `ingest_v2 takes ${p}`).toMatch(new RegExp(`\\b${p}\\b`));
    }
    expect(FIRMWARE).toMatch(/\/rest\/v1\/rpc\/ingest_v2"/);
  });

  it('a missing or broken sensor value is sent as null, never as text JSON cannot hold', () => {
    // NaN and infinity both happen on real hardware (a sensor that stops answering).
    expect(FIRMWARE).toMatch(/String jsonNum\(float v, int dp\)\{ return \(isnan\(v\) \|\| isinf\(v\)\)/);
    const b = body('d', 's', [row({ lux: NaN, t: Infinity, h: null, soil: null })]);
    expect(() => JSON.parse(b)).not.toThrow();
  });
});

describe('what is stored is what was measured', () => {
  it('counts exact, decimals as sent, times from "ago"', async () => {
    const r = await post([
      row({ ago: 7200, soil: 2601, lux: 15000.5, t: 22.1, h: 51.2 }),
      row({ ago: 3600, soil: 2602, lux: 820.3, t: 21.4, h: 54 }),
      row({ ago: 0, soil: 2603, lux: 0, t: -2.5, h: 99.9 }),
    ]);
    expect(r).toMatchObject({ inserted: 3, skipped: 0 });
    const rows = await db.sql<any>(`select * from public.readings where device_id = $1 and soil_raw between 2601 and 2603 order by created_at`, [dev]);
    expect(rows.map((x: any) => x.soil_raw)).toEqual([2601, 2602, 2603]);
    expect(rows.map((x: any) => Number(x.lux))).toEqual([15000.5, 820.3, 0]); // 0 lux is darkness, not "missing"
    expect(rows.map((x: any) => Number(x.temp_c))).toEqual([22.1, 21.4, -2.5]);
    expect(rows.map((x: any) => Number(x.humidity_pct))).toEqual([51.2, 54, 99.9]);
    const t = rows.map((x: any) => new Date(x.created_at).getTime());
    expect((t[1] - t[0]) / 1000).toBeCloseTo(3600, 0);
    expect((t[2] - t[1]) / 1000).toBeCloseTo(3600, 0);
    expect(Math.abs(Date.now() - t[2])).toBeLessThan(60_000);
    expect(rows.every((x: any) => x.quality === 0)).toBe(true);
  });

  it('on USB power (no battery value) and with a missing sensor, the gaps are null, not zero', async () => {
    await post([row({ ago: 10, soil: 2700, lux: null, t: null, h: null, bat: null })]);
    const [x] = await readingsAt(2700);
    expect(x.lux).toBeNull();
    expect(x.temp_c).toBeNull();
    expect(x.humidity_pct).toBeNull();
    expect(x.battery_mv).toBeNull();
    expect(x.battery_pct).toBeNull();
  });

  it('every raw count is kept, and a disconnected probe is flagged rather than turned into a percentage', async () => {
    await post([row({ ago: 20, soil: 0 }), row({ ago: 30, soil: 60 }), row({ ago: 40, soil: 150 })]);
    for (const c of [0, 60, 150]) {
      const [x] = await readingsAt(c);
      expect(x, `count ${c} stored`).toBeTruthy();
      expect(x.quality & 2, `count ${c} flagged as disconnected`).toBe(2);
    }
  });

  it('the setup burst — three readings ~95 s apart with the same values — is stored as three', async () => {
    const r = await post([row({ ago: 190, soil: 3600, lux: 300 }), row({ ago: 95, soil: 3600, lux: 300 }), row({ ago: 0, soil: 3600, lux: 300 })]);
    expect(r.inserted).toBe(3);
    expect(await readingsAt(3600)).toHaveLength(3);
  });

  it('a retried upload is not stored twice', async () => {
    const rows = [row({ ago: 50, soil: 2801 }), row({ ago: 0, soil: 2802 })];
    await post(rows);
    const again = await post(rows);
    expect(again).toMatchObject({ inserted: 0, skipped: 2 });
    expect(await readingsAt(2801)).toHaveLength(1);
  });
});

describe('the device record stays true', () => {
  const device = async () => (await db.sql<any>(`select * from public.devices where id = $1`, [dev]))[0];

  it('battery follows the newest reading; moving to USB clears it instead of showing a stale figure', async () => {
    await post([row({ ago: 0, soil: 2901, bat: 3995 })]);
    expect((await device()).battery_mv).toBe(3995);
    expect((await device()).battery_pct).toBeGreaterThan(70);
    // an older backlog row still has a battery value, but the newest does not
    await post([row({ ago: 600, soil: 2902, bat: 3990 }), row({ ago: 0, soil: 2903, bat: null })]);
    const d = await device();
    expect(d.battery_mv).toBeNull();
    expect(d.battery_pct).toBeNull();
  });

  it('an empty upload leaves the battery alone, and every upload marks the device seen', async () => {
    await post([row({ ago: 0, soil: 2904, bat: 4100 })]);
    await post([]);
    const d = await device();
    expect(d.battery_mv).toBe(4100);
    expect(Date.now() - new Date(d.last_seen).getTime()).toBeLessThan(60_000);
    expect(d.firmware_version).toBe('c3-1.2');
    expect(d.rssi_dbm).toBe(-61);
  });

  it('only the owner can read the readings', async () => {
    const stranger = await db.newUser('stranger-readings@example.com');
    expect(await db.as(stranger, `select 1 from public.readings where device_id = $1`, [dev])).toEqual([]);
    // anon either sees nothing or is refused outright — both keep the rows private
    const anon = await db.as(null, `select 1 from public.readings where device_id = $1`, [dev]).catch((e: Error) => e);
    if (anon instanceof Error) expect(anon.message).toMatch(/permission denied/);
    else expect(anon).toEqual([]);
    expect((await db.as<any>(owner, `select count(*)::int n from public.readings where device_id = $1`, [dev]))[0].n).toBeGreaterThan(10);
  });
});

describe('the read-only health check (supabase/checks/readings_health.sql)', () => {
  it('runs, changes nothing, and gives the verdicts this data deserves', async () => {
    const sql = readFileSync(path.join(ROOT, 'supabase/checks/readings_health.sql'), 'utf8');
    const before = (await db.sql<any>(`select count(*)::int n from public.readings`))[0].n;
    const rows = await db.sql<{ status: string; check_name: string; detail: string }>(sql);
    expect((await db.sql<any>(`select count(*)::int n from public.readings`))[0].n).toBe(before);
    const by = (start: string) => rows.find((r) => r.check_name.startsWith(start))!;
    expect(rows).toHaveLength(15);
    expect(by('ingest_v2 is the corrected').status).toBe('PASS');
    expect(by('model versions').status).toBe('PASS');
    expect(by('readings and devices are private').status).toBe('PASS');
    expect(by('no reading is dated in the future').status).toBe('PASS');
    expect(by('every soil count').status).toBe('PASS');
    expect(by('no reading stored twice').status).toBe('PASS');
    expect(by('daily summaries match').status).toBe('PASS');
    // this test database really does hold disconnected-probe readings (count 0, 60, 150)
    expect(by('probe disconnected').status).toBe('WARN');
    expect(rows.filter((r) => r.status === 'FAIL')).toEqual([]);
  });
});
