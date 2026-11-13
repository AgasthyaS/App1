import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { vpdKpa } from '@/lib/vpd';

import { createDb, rerunAll, type Db } from './harness';

/**
 * Runs the project's SQL, unmodified and in install order, against a real
 * Postgres, then exercises it the way the app and the firmware do.
 */

let db: Db;
let alice: string;
let bob: string;
let devA: string;
let devB: string;
const SECRET_A = 'secret-a';
const SECRET_B = 'secret-b';

const ingest = (device: string, secret: string, soil: number | null, light: number | null, temp: number | null, rh: number | null, secsAgo = 0) =>
  db.as(null, `select public.ingest_reading($1,$2,$3,0,$4,$5,$6,-1,$7) as r`, [device, secret, light, soil, temp, rh, secsAgo]);

beforeAll(async () => {
  db = await createDb();
  alice = await db.newUser('alice@example.com');
  bob = await db.newUser('bob@example.com');
  devA = (await db.sql<{ id: string }>(`insert into public.devices (user_id, secret, plant_key) values ($1,$2,'pl-a1') returning id`, [alice, SECRET_A]))[0].id;
  devB = (await db.sql<{ id: string }>(`insert into public.devices (user_id, secret, plant_key) values ($1,$2,'pl-b1') returning id`, [bob, SECRET_B]))[0].id;
}, 120_000);

afterAll(async () => { await db?.close(); });

describe('migrations', () => {
  it('every file applies in the documented order', async () => {
    const tables = (await db.sql<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`)).map((t) => t.tablename);
    for (const t of ['readings', 'reading_daily', 'plants', 'plant_substrates', 'sensor_calibrations',
      'plant_observations', 'recommendations', 'model_versions', 'plant_identifications', 'ai_usage',
      'ai_cache', 'substrate_components', 'substrate_presets', 'analytics_events']) {
      expect(tables, t).toContain(t);
    }
  });

  it('every public table has row-level security enabled', async () => {
    const open = await db.sql<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(open.map((r) => r.relname)).toEqual([]);
  });

  it('the substrate reference tables are seeded from the app catalog', async () => {
    const [{ n }] = await db.sql<{ n: number }>(`select count(*)::int as n from public.substrate_components`);
    expect(n).toBe(23);
    const [sand] = await db.sql<any>(`select * from public.substrate_components where id = 'sand'`);
    expect(Number(sand.vg_alpha)).toBe(0.145);
    expect(Number(sand.vg_n)).toBe(2.68);
    expect(sand.tier).toBe('published-parameters');
    const [{ p }] = await db.sql<{ p: number }>(`select count(*)::int as p from public.substrate_presets`);
    expect(p).toBe(26);
  });
});

describe('ingest: what the firmware sends', () => {
  it('rejects a wrong secret', async () => {
    await expect(ingest(devA, 'nope', 2200, 1500, 21, 50)).rejects.toThrow(/bad device or secret/);
  });

  it('stores raw counts, stamps the plant, and answers in the shape the firmware parses', async () => {
    const [{ r }] = await ingest(devA, SECRET_A, 2200, 1500, 21.5, 48, 4 * 3600);
    expect(r).toMatchObject({ read_now: false, wake_seconds: 10800 });
    const [row] = await db.sql<any>(`select * from public.readings where device_id = $1 order by created_at desc limit 1`, [devA]);
    expect(row.soil_raw).toBe(2200);
    expect(Number(row.soil_pct)).toBe(2200); // legacy column still filled for old app builds
    expect(row.light_raw).toBe(1500);
    expect(row.plant_key).toBe('pl-a1');
    expect(row.quality).toBe(0);
    expect(new Date(row.received_at).getTime() - new Date(row.created_at).getTime()).toBeGreaterThan(3.9 * 3600_000);
  });

  it('is idempotent: the same upload twice is one row', async () => {
    const before = (await db.sql<{ n: number }>(`select count(*)::int n from public.readings where device_id = $1`, [devA]))[0].n;
    await ingest(devA, SECRET_A, 2311, 1622, 20, 50, 7200);
    await ingest(devA, SECRET_A, 2311, 1622, 20, 50, 7200);
    const after = (await db.sql<{ n: number }>(`select count(*)::int n from public.readings where device_id = $1`, [devA]))[0].n;
    expect(after).toBe(before + 1);
  });

  it.each([
    ['probe in open air', 3500, 1500, 21, 50, 4],
    ['probe disconnected', 150, 1500, 21, 50, 2],
    ['soil beyond the converter', 9000, 1500, 21, 50, 1],
    ['light at the bright rail', 2200, 30, 21, 50, 8],
    ['impossible temperature', 2200, 1500, 150, 50, 16],
    ['impossible humidity', 2200, 1500, 21, 130, 32],
    ['several at once', 3500, 30, 150, 130, 4 + 8 + 16 + 32],
  ])('flags %s but keeps the row', async (_name, soil, light, temp, rh, flags) => {
    const secs = 100_000 + flags * 1000;
    await ingest(devA, SECRET_A, soil, light, temp, rh, secs);
    const [row] = await db.sql<any>(`select * from public.readings where device_id = $1 order by created_at asc limit 1`, [devA]);
    expect(row.quality).toBe(flags);
    expect(Number(row.soil_pct)).toBe(soil); // preserved exactly as sent
    await db.sql(`delete from public.readings where id = $1`, [row.id]);
  });

  it('never accepts a reading from the future or older than the buffer', async () => {
    await ingest(devA, SECRET_A, 2400, 1500, 21, 50, -99999);
    await ingest(devA, SECRET_A, 2401, 1500, 21, 50, 10 * 365 * 86400);
    const rows = await db.sql<any>(`select created_at from public.readings where device_id = $1 and soil_raw in (2400, 2401)`, [devA]);
    for (const r of rows) {
      const t = new Date(r.created_at).getTime();
      expect(t).toBeLessThanOrEqual(Date.now() + 1000);
      expect(t).toBeGreaterThan(Date.now() - 31 * 86400_000);
    }
    await db.sql(`delete from public.readings where soil_raw in (2400, 2401)`);
  });

  it('moving a sensor does not relabel its history', async () => {
    await db.sql(`update public.devices set plant_key = 'pl-a2' where id = $1`, [devA]);
    await ingest(devA, SECRET_A, 2250, 1500, 21, 50, 0);
    const keys = await db.sql<{ plant_key: string; n: number }>(
      `select plant_key, count(*)::int n from public.readings where device_id = $1 group by 1 order by 1`, [devA]);
    expect(keys.map((k) => k.plant_key)).toEqual(['pl-a1', 'pl-a2']);
    await db.sql(`update public.devices set plant_key = 'pl-a1' where id = $1`, [devA]);
  });

  it('batch upload: owner only, de-duplicated, bad rows skipped not fatal', async () => {
    const t0 = new Date(Date.now() - 86400_000).toISOString();
    const rows = JSON.stringify([
      { at: t0, soil_pct: 2600, light_lux: 1800, temp_c: 22, humidity_pct: 45 },
      { at: t0, soil_pct: 2600, light_lux: 1800, temp_c: 22, humidity_pct: 45 }, // same instant
      { at: 'not a date', soil_pct: 2600 },
      { at: new Date(Date.now() + 86400_000).toISOString(), soil_pct: 2600 }, // tomorrow
    ]);
    await expect(db.as(bob, `select public.ingest_batch($1, $2::jsonb)`, [devA, rows])).rejects.toThrow(/not your device/);
    const [{ r }] = await db.as<any>(alice, `select public.ingest_batch($1, $2::jsonb) as r`, [devA, rows]);
    expect(r).toEqual({ inserted: 1, skipped: 3 });
    const [{ r: again }] = await db.as<any>(alice, `select public.ingest_batch($1, $2::jsonb) as r`, [devA, rows]);
    expect(again.inserted).toBe(0);
  });
});

describe('reading_daily: maintained by trigger, in any arrival order', () => {
  it('matches a direct aggregate over readings, including a late arrival', async () => {
    // A late, buffered reading for a day that already has rows.
    await ingest(devA, SECRET_A, 2900, 2500, 18, 60, 5 * 3600);
    const direct = await db.sql<any>(`
      select (created_at at time zone 'UTC')::date as day, count(*)::int n,
             min(soil_raw) filter (where (quality & 7) = 0) soil_min,
             max(soil_raw) filter (where (quality & 7) = 0) soil_max,
             round(avg(soil_raw) filter (where (quality & 7) = 0), 1) soil_mean,
             round(avg(temp_c) filter (where (quality & 16) = 0), 2) temp_mean
        from public.readings where device_id = $1 group by 1 order by 1`, [devA]);
    const rolled = await db.sql<any>(
      `select day, n, soil_raw_min, soil_raw_max, soil_raw_mean, temp_mean from public.v_reading_daily where device_id = $1 order by day`, [devA]);
    expect(rolled.length).toBe(direct.length);
    direct.forEach((d, i) => {
      expect(rolled[i].n).toBe(d.n);
      expect(rolled[i].soil_raw_min).toBe(d.soil_min);
      expect(rolled[i].soil_raw_max).toBe(d.soil_max);
      expect(Number(rolled[i].soil_raw_mean)).toBeCloseTo(Number(d.soil_mean), 1);
      expect(Number(rolled[i].temp_mean)).toBeCloseTo(Number(d.temp_mean), 2);
    });
  });

  it('deleting readings recomputes the affected day', async () => {
    const day = (await db.sql<any>(`select day, n from public.reading_daily where device_id = $1 order by n desc limit 1`, [devA]))[0];
    const [victim] = await db.sql<any>(`select id from public.readings where device_id = $1 and (created_at at time zone 'UTC')::date = $2 limit 1`, [devA, day.day]);
    await db.sql(`delete from public.readings where id = $1`, [victim.id]);
    const after = await db.sql<any>(`select n from public.reading_daily where device_id = $1 and day = $2`, [devA, day.day]);
    expect(after[0]?.n ?? 0).toBe(day.n - 1);
  });

  it('a full rebuild reproduces what the trigger built', async () => {
    const before = await db.sql<any>(`select * from public.reading_daily order by device_id, day`);
    await db.sql(`select public.rebuild_reading_daily()`);
    const after = await db.sql<any>(`select * from public.reading_daily order by device_id, day`);
    expect(after).toEqual(before);
  });

  it('the database and the app compute the same VPD', async () => {
    for (const [t, rh] of [[22, 55], [28, 60], [5, 90], [35, 20]]) {
      const [{ v }] = await db.sql<{ v: string }>(`select public.vpd_kpa($1, $2) as v`, [t, rh]);
      expect(Number(v)).toBeCloseTo(vpdKpa(t, rh)!, 6);
    }
  });
});

describe('one user cannot reach another’s data', () => {
  beforeAll(async () => {
    await ingest(devB, SECRET_B, 2000, 1000, 23, 40, 0);
    for (const [u, key] of [[alice, 'pl-a1'], [bob, 'pl-b1']] as const) {
      await db.as(u, `insert into public.plants (user_id, plant_key, species) values ($1, $2, 'Monstera')`, [u, key]);
      await db.as(u, `select public.set_plant_substrate($1, 'preset:coco-coir', 'preset', 'Coco coir')`, [key]);
      await db.as(u, `insert into public.plant_observations (user_id, plant_key, kind) values ($1, $2, 'new-growth')`, [u, key]);
      await db.as(u, `insert into public.recommendations (user_id, plant_key, state, grade, model_version) values ($1, $2, 'in-range', 'low', 's2.b2.l2.d2')`, [u, key]);
    }
  });

  const PRIVATE = ['plants', 'plant_substrates', 'plant_observations', 'recommendations', 'readings', 'reading_daily', 'devices'];

  it.each(PRIVATE)('%s: a user sees only their own rows', async (table) => {
    const mine = await db.as<any>(alice, `select * from public.${table}`);
    expect(mine.length).toBeGreaterThan(0);
    const all = await db.sql<any>(`select * from public.${table}`);
    expect(all.length).toBeGreaterThan(mine.length);
    for (const row of mine) {
      if ('user_id' in row) expect(row.user_id).toBe(alice);
      if ('device_id' in row) expect(row.device_id).toBe(devA);
    }
  });

  it.each(PRIVATE)('%s: signed out sees nothing', async (table) => {
    expect(await db.as(null, `select * from public.${table}`)).toEqual([]);
  });

  it('cannot insert a row for someone else', async () => {
    await expect(db.as(alice, `insert into public.plants (user_id, plant_key, species) values ($1, 'x', 'Fern')`, [bob])).rejects.toThrow(/row-level security/);
    await expect(db.as(alice, `insert into public.plant_observations (user_id, plant_key, kind) values ($1, 'pl-b1', 'wilting')`, [bob])).rejects.toThrow(/row-level security/);
  });

  it('cannot update or delete someone else’s rows — the statement simply matches nothing', async () => {
    await db.as(alice, `update public.plants set species = 'Hacked' where plant_key = 'pl-b1'`);
    await db.as(alice, `delete from public.recommendations where plant_key = 'pl-b1'`);
    expect((await db.sql<any>(`select species from public.plants where plant_key = 'pl-b1'`))[0].species).toBe('Monstera');
    expect((await db.sql<any>(`select count(*)::int n from public.recommendations where plant_key = 'pl-b1'`))[0].n).toBe(1);
  });

  it('cannot calibrate, or read the calibration of, someone else’s sensor', async () => {
    await expect(db.as(alice, `select public.set_sensor_calibration($1, 'moisture', 'endpoints', '{"dryAdc":3000,"wetAdc":1300}')`, [devB])).rejects.toThrow(/not your device/);
    await db.as(bob, `select public.set_sensor_calibration($1, 'moisture', 'endpoints', '{"dryAdc":3000,"wetAdc":1300}')`, [devB]);
    expect(await db.as(alice, `select * from public.sensor_calibrations`)).toEqual([]);
  });

  it('clients cannot read or write the AI accounting tables at all', async () => {
    await db.sql(`insert into public.ai_usage (user_id, task, provider, model) values ($1, 'identify', 'google', 'm')`, [alice]);
    expect(await db.as(alice, `select * from public.ai_usage`)).toEqual([]);
    expect(await db.as(alice, `select * from public.ai_cache`)).toEqual([]);
    await expect(db.as(alice, `insert into public.ai_usage (user_id, task, provider, model) values ($1, 'identify', 'google', 'm')`, [alice])).rejects.toThrow(/row-level security/);
  });

  it('a user cannot forge an identification result, only record their decision on a real one', async () => {
    const sha = 'a'.repeat(64);
    await expect(db.as(alice,
      `insert into public.plant_identifications (user_id, image_sha256, provider, model, prompt_version) values ($1, $2, 'google', 'm', 'v1')`,
      [alice, sha])).rejects.toThrow(/permission denied|row-level security/);
    const [{ id }] = await db.sql<{ id: number }>(
      `insert into public.plant_identifications (user_id, image_sha256, provider, model, prompt_version, top_common) values ($1, $2, 'google', 'm', 'v1', 'Monstera') returning id`,
      [alice, sha]);
    await db.as(alice, `update public.plant_identifications set user_action = 'confirmed', accepted_species = 'Monstera' where id = $1`, [id]);
    await expect(db.as(alice, `update public.plant_identifications set top_common = 'Cactus' where id = $1`, [id])).rejects.toThrow(/permission denied/);
    await db.as(bob, `update public.plant_identifications set user_action = 'rejected' where id = $1`, [id]);
    expect((await db.sql<any>(`select user_action, top_common from public.plant_identifications where id = $1`, [id]))[0])
      .toEqual({ user_action: 'confirmed', top_common: 'Monstera' });
  });

  it('export returns the caller’s data and nobody else’s', async () => {
    const [{ d }] = await db.as<any>(alice, `select public.export_my_data() as d`);
    expect(d.plants.map((p: any) => p.plant_key)).toEqual(['pl-a1']);
    expect(d.devices.map((x: any) => x.id)).toEqual([devA]);
    expect(JSON.stringify(d)).not.toContain(bob);
    expect(JSON.stringify(d)).not.toContain(SECRET_A); // device secrets are not exported
    await expect(db.as(null, `select public.export_my_data()`)).rejects.toThrow(/must be signed in|permission denied/);
  });

  it('the operator overview is refused to non-admins and returns counts only to admins', async () => {
    await expect(db.as(alice, `select public.admin_overview(30)`)).rejects.toThrow(/not authorized/);
    await db.sql(`insert into public.analytics_admins (user_id) values ($1)`, [alice]);
    const [{ o }] = await db.as<any>(alice, `select public.admin_overview(30) as o`);
    expect(o.dataset.plants_active).toBe(2);
    expect(o.dataset.devices_claimed).toBe(2);
    expect(JSON.stringify(o)).not.toContain(bob);
    expect(JSON.stringify(o)).not.toContain('@example.com');
  });
});

describe('history is preserved, not overwritten', () => {
  it('changing substrate closes the old version and opens a new one', async () => {
    await db.as(alice, `select public.set_plant_substrate('pl-a1', 'preset:orchid-mix', 'preset', 'Orchid bark mix', '[]'::jsonb, null, 's2.b2.l2.d2', 'repot')`);
    const rows = await db.sql<any>(`select substrate_key, valid_to is null as current from public.plant_substrates where user_id = $1 and plant_key = 'pl-a1' order by valid_from`, [alice]);
    expect(rows).toEqual([
      { substrate_key: 'preset:coco-coir', current: false },
      { substrate_key: 'preset:orchid-mix', current: true },
    ]);
  });

  it('setting the same substrate again is a no-op', async () => {
    const [{ id }] = await db.as<any>(alice, `select public.set_plant_substrate('pl-a1', 'preset:orchid-mix', 'preset') as id`);
    expect(id).toBeNull();
    expect((await db.sql<any>(`select count(*)::int n from public.plant_substrates where user_id = $1 and plant_key = 'pl-a1'`, [alice]))[0].n).toBe(2);
  });

  it('a plant can never have two current substrates', async () => {
    await expect(db.sql(
      `insert into public.plant_substrates (user_id, plant_key, substrate_key, kind) values ($1, 'pl-a1', 'x', 'preset')`, [alice],
    )).rejects.toThrow(/plant_substrates_one_current/);
  });

  it('recalibrating keeps the previous calibration with its dates', async () => {
    await db.as(alice, `select public.set_sensor_calibration($1, 'moisture', 'endpoints', '{"dryAdc":3020,"wetAdc":1400}')`, [devA]);
    await db.as(alice, `select public.set_sensor_calibration($1, 'moisture', 'endpoints', '{"dryAdc":2950,"wetAdc":1310}')`, [devA]);
    const rows = await db.sql<any>(`select params->>'dryAdc' as dry, valid_to is null as current from public.sensor_calibrations where device_id = $1 order by valid_from`, [devA]);
    expect(rows).toEqual([{ dry: '3020', current: false }, { dry: '2950', current: true }]);
  });

  it('raw readings cannot be edited or deleted through the API', async () => {
    await db.as(alice, `update public.readings set soil_raw = 1 where device_id = $1`, [devA]);
    await db.as(alice, `delete from public.readings where device_id = $1`, [devA]);
    const [{ n, tampered }] = await db.sql<any>(`select count(*)::int n, count(*) filter (where soil_raw = 1)::int tampered from public.readings where device_id = $1`, [devA]);
    expect(n).toBeGreaterThan(0);
    expect(tampered).toBe(0);
  });

  it('constraints refuse values the app should never send', async () => {
    await expect(db.as(alice, `insert into public.plant_observations (user_id, plant_key, kind) values ($1, 'pl-a1', 'possessed')`, [alice])).rejects.toThrow(/check constraint/);
    await expect(db.as(alice, `insert into public.recommendations (user_id, plant_key, state, grade, model_version, ml) values ($1, 'pl-a1', 'water-now', 'high', 'v', 99999)`, [alice])).rejects.toThrow(/check constraint/);
    await expect(db.as(alice, `insert into public.plants (user_id, plant_key, species, status) values ($1, 'z', 'Fern', 'zombie')`, [alice])).rejects.toThrow(/check constraint/);
  });
});

describe('aggregates never expose a thin sample', () => {
  it('with two growers, every gated view is empty', async () => {
    for (const v of ['substrate_drying', 'drying_by_vpd', 'recommendation_outcomes', 'species_env_stats', 'drying_constants']) {
      expect(await db.as(alice, `select * from public.${v}`), v).toEqual([]);
    }
  });

  it('counts plants, not readings: 30 measurements from 2 plants stay hidden; 16 plants from 6 growers appear', async () => {
    // SIMULATED population.
    const mk = async (email: string, optIn: boolean) => {
      const id = await db.newUser(email);
      await db.sql(`insert into public.profiles (user_id, research_opt_in) values ($1, $2)`, [id, optIn]);
      return id;
    };
    const seedPlant = async (uid: string, key: string, substrate: string, days: number, reps = 1) => {
      await db.sql(`insert into public.plant_substrates (user_id, plant_key, substrate_key, kind, label, valid_from) values ($1,$2,$3,'preset',$3, now() - interval '90 days')`, [uid, key, substrate]);
      for (let i = 0; i < reps; i++) {
        await db.sql(`insert into public.plant_measurements (user_id, plant_key, measured_at, dry_down_days, retention_confident, ml_per_point_per_liter) values ($1,$2, now() - make_interval(days => $3), $4, true, 6)`, [uid, key, i + 1, days]);
      }
    };
    const heavy = await mk('heavy@example.com', true);
    await seedPlant(heavy, 'h1', 'preset:peat-moss', 9, 15);
    await seedPlant(heavy, 'h2', 'preset:peat-moss', 9, 15);
    expect(await db.as(alice, `select * from public.substrate_drying`)).toEqual([]);

    const growers = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => mk(`g${i}@example.com`, true)));
    let k = 0;
    for (const g of growers) for (let i = 0; i < 3; i++) await seedPlant(g, `c${k++}`, 'preset:coco-coir', 5 + (k % 4));
    // An opted-OUT grower with many plants must not count.
    const out = await mk('private@example.com', false);
    for (let i = 0; i < 20; i++) await seedPlant(out, `o${i}`, 'preset:orchid-mix', 2);

    const rows = await db.as<any>(alice, `select * from public.substrate_drying`);
    expect(rows.map((r) => r.substrate_key)).toEqual(['preset:coco-coir']);
    expect(Number(rows[0].sample_plants)).toBe(18);
    expect(Number(rows[0].sample_growers)).toBe(6);
    expect(Number(rows[0].dry_down_days_median)).toBeGreaterThan(5);
  });
});

describe('deletion', () => {
  it('deleting a plant removes its records and unlinks, but keeps, the device’s readings', async () => {
    const before = (await db.sql<any>(`select count(*)::int n from public.readings where device_id = $1`, [devB]))[0].n;
    await db.as(bob, `select public.delete_plant('pl-b1')`);
    for (const t of ['plants', 'plant_substrates', 'plant_observations', 'recommendations']) {
      expect((await db.sql<any>(`select count(*)::int n from public.${t} where user_id = $1`, [bob]))[0].n, t).toBe(0);
    }
    const [r] = await db.sql<any>(`select count(*)::int n, count(plant_key)::int linked from public.readings where device_id = $1`, [devB]);
    expect(r.n).toBe(before);
    expect(r.linked).toBe(0);
    // …and it did not touch anyone else's plant with a different key.
    expect((await db.sql<any>(`select count(*)::int n from public.plants where user_id = $1`, [alice]))[0].n).toBe(1);
  });

  it('deleting an account cascades through every table that holds its data', async () => {
    await db.sql(`delete from auth.users where id = $1`, [alice]);
    for (const t of ['plants', 'plant_substrates', 'plant_observations', 'recommendations', 'sensor_calibrations',
      'plant_identifications', 'ai_cache', 'gardens', 'devices', 'analytics_admins']) {
      const cols = (await db.sql<{ column_name: string }>(`select column_name from information_schema.columns where table_schema='public' and table_name=$1`, [t])).map((c) => c.column_name);
      if (!cols.includes('user_id')) continue;
      expect((await db.sql<any>(`select count(*)::int n from public.${t} where user_id = $1`, [alice]))[0].n, t).toBe(0);
    }
    expect((await db.sql<any>(`select count(*)::int n from public.readings where device_id = $1`, [devA]))[0].n).toBe(0);
    expect((await db.sql<any>(`select count(*)::int n from public.reading_daily where device_id = $1`, [devA]))[0].n).toBe(0);
    // Usage accounting survives, de-identified.
    expect((await db.sql<any>(`select count(*)::int n from public.ai_usage where user_id is null`))[0].n).toBeGreaterThan(0);
  });
});

describe('re-running', () => {
  it('every file can be run a second time on a populated database without error or data loss', async () => {
    const count = async () => (await db.sql<any>(`select (select count(*) from public.readings)::int r, (select count(*) from public.plant_substrates)::int s, (select count(*) from public.reading_daily)::int d`))[0];
    const before = await count();
    await rerunAll(db);
    expect(await count()).toEqual(before);
  }, 120_000);
});
