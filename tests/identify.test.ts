import { describe, expect, it } from 'vitest';

import { matchCatalog } from '@/lib/identify';
import {
  DAILY_LIMIT, IMAGE_MAX_BYTES, betterOf, estimateCostUsd, shouldEscalate, validateIdentification,
  type Identification,
} from '@/supabase/functions/_shared/identify';
import { identify, type IdentifyDeps, type UsageRow } from '@/supabase/functions/_shared/identifyHandler';

const cand = (latin: string, common: string, rank = 'species', confidence = 'high', features = 'x') =>
  ({ latin, common, rank, confidence, features });
const good = (over: Partial<Identification> = {}): Identification => ({
  is_plant: true, image_issue: 'none', candidates: [cand('Monstera deliciosa', 'Monstera') as any], ...over,
});

describe('validating model output', () => {
  it('accepts a well-formed answer, as an object or as JSON text', () => {
    expect(validateIdentification(good())).toEqual(good());
    expect(validateIdentification(JSON.stringify(good()))).toEqual(good());
    expect(validateIdentification('```json\n' + JSON.stringify(good()) + '\n```')).toEqual(good());
  });

  it.each([null, undefined, 42, '', 'not json', '[]', {}, { is_plant: 'yes' }, { candidates: [] }])(
    'rejects %j', (bad) => { expect(validateIdentification(bad as any)).toBeNull(); });

  it('drops candidates with implausible names and strips markup from the rest', () => {
    const out = validateIdentification({
      is_plant: true, image_issue: 'none',
      candidates: [
        cand('<script>alert(1)</script>', 'Evil'),
        cand('DROP TABLE plants; --', 'Bobby'),
        cand('Ficus lyrata', 'Fiddle-leaf <b>fig</b>', 'species', 'high', 'large `lyre` {shaped} leaves'),
        cand('', 'Nameless'),
        cand('Ficus lyrata', 'Duplicate'),
      ],
    })!;
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].latin).toBe('Ficus lyrata');
    expect(out.candidates[0].common).not.toMatch(/[<>]/);
    expect(out.candidates[0].features).not.toMatch(/[`{}]/);
  });

  it('coerces unknown enum values to the cautious option and caps the list at three', () => {
    const out = validateIdentification({
      is_plant: true, image_issue: 'sparkly',
      candidates: [1, 2, 3, 4, 5].map((i) => cand(`Ficus ${'abcde'[i - 1]}us`, `Fig ${i}`, 'kingdom', 'certain')),
    })!;
    expect(out.image_issue).toBe('none');
    expect(out.candidates).toHaveLength(3);
    expect(out.candidates.every((c) => c.rank === 'unknown' && c.confidence === 'low')).toBe(true);
  });

  it('bounds string lengths', () => {
    const out = validateIdentification({ is_plant: true, image_issue: 'none',
      candidates: [cand('Ficus lyrata', 'c'.repeat(500), 'species', 'high', 'f'.repeat(5000))] })!;
    expect(out.candidates[0].common.length).toBeLessThanOrEqual(60);
    expect(out.candidates[0].features.length).toBeLessThanOrEqual(140);
  });

  it('"not a plant" carries no candidates, whatever the model added', () => {
    const out = validateIdentification({ is_plant: false, image_issue: 'none', candidates: [cand('Ficus lyrata', 'Fig')] })!;
    expect(out).toEqual({ is_plant: false, image_issue: 'not-a-plant', candidates: [] });
  });
});

describe('when to pay for a second opinion', () => {
  it('not for a confident species, a non-plant, or a photo no model could read', () => {
    expect(shouldEscalate(good())).toBe(false);
    expect(shouldEscalate({ is_plant: false, image_issue: 'not-a-plant', candidates: [] })).toBe(false);
    expect(shouldEscalate(good({ image_issue: 'blurry', candidates: [cand('Ficus', 'Fig', 'genus', 'low') as any] }))).toBe(false);
  });
  it('for a low-confidence or genus-only answer on a usable photo', () => {
    expect(shouldEscalate(good({ candidates: [cand('Ficus', 'Fig', 'genus', 'low') as any] }))).toBe(true);
    expect(shouldEscalate(good({ candidates: [cand('Ficus', 'Fig', 'genus', 'medium') as any] }))).toBe(true);
    expect(shouldEscalate(good({ image_issue: 'partial', candidates: [cand('Ficus', 'Fig', 'genus', 'low') as any] }))).toBe(true);
    expect(shouldEscalate(good({ candidates: [] }))).toBe(true);
  });
  it('a medium-confidence species is shown as it is', () => {
    expect(shouldEscalate(good({ candidates: [cand('Aloe vera', 'Aloe', 'species', 'medium') as any] }))).toBe(false);
  });
  it('keeps the better of two answers, and the first on a tie', () => {
    const a = good({ candidates: [cand('Ficus', 'Fig', 'genus', 'low') as any] });
    const b = good({ candidates: [cand('Ficus elastica', 'Rubber plant', 'species', 'high') as any] });
    expect(betterOf(a, b)).toBe(b);
    expect(betterOf(b, a)).toBe(b);
    expect(betterOf(a, a)).toBe(a);
    expect(betterOf(a, null)).toBe(a);
  });
});

describe('cost estimate', () => {
  it('matches the price list arithmetic', () => {
    // 412 in + 130 out on 3.1 Flash-Lite: (412·0.25 + 130·1.5) / 1e6
    expect(estimateCostUsd('gemini-3.1-flash-lite', 412, 130)).toBeCloseTo(0.000298, 6);
    expect(estimateCostUsd('gemini-3.5-flash-lite', 1233, 130)).toBeCloseTo(0.000695, 6);
    expect(estimateCostUsd('unknown-model', 1000, 1000)).toBe(0);
  });
});

/* ───────────────────────────── the request handler ───────────────────────────── */

const JPEG = (() => {
  const bytes = new Uint8Array(400);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < bytes.length; i++) bytes[i] = (i * 31) % 251;
  return Buffer.from(bytes).toString('base64');
})();

function fakeDeps(over: Partial<IdentifyDeps> & { answers?: (Identification | string | Error)[] } = {}) {
  const usage: UsageRow[] = [];
  const cache = new Map<string, { result: Identification; model: string }>();
  const calls: { model: string; detail: string }[] = [];
  const saved: any[] = [];
  let recent = 0;
  const answers = over.answers ?? [good()];
  const deps: IdentifyDeps = {
    models: { primary: 'cheap', escalation: 'strong' },
    callModel: async (model, _img, detail) => {
      const a = answers[Math.min(calls.length, answers.length - 1)];
      calls.push({ model, detail });
      if (a instanceof Error) throw a;
      return { text: typeof a === 'string' ? a : JSON.stringify(a), inputTokens: 400, outputTokens: 120, ms: 900 };
    },
    sha256Hex: async (b) => Array.from(b.slice(0, 32)).map((x) => x.toString(16).padStart(2, '0')).join(''),
    cacheGet: async (u, k) => cache.get(`${u}|${k}`) ?? null,
    cachePut: async (u, k, result, model) => void cache.set(`${u}|${k}`, { result, model }),
    recentCount: async () => recent,
    logUsage: async (r) => void usage.push(r),
    saveIdentification: async (r) => { saved.push(r); recent++; return saved.length; },
    ...over,
  };
  return { deps, usage, cache, calls, saved, setRecent: (n: number) => { recent = n; } };
}

describe('identify request', () => {
  it('happy path: one cheap low-detail call, validated result stored and returned', async () => {
    const f = fakeDeps();
    const out = await identify(f.deps, 'u1', { imageBase64: JPEG, plantKey: 'pl-1' });
    expect(out.status).toBe(200);
    if (out.status !== 200) return;
    expect(out.body.result.candidates[0].latin).toBe('Monstera deliciosa');
    expect(out.body).toMatchObject({ cached: false, escalated: false, model: 'cheap', remainingToday: DAILY_LIMIT - 1 });
    expect(f.calls).toEqual([{ model: 'cheap', detail: 'low' }]);
    expect(f.saved[0]).toMatchObject({ userId: 'u1', plantKey: 'pl-1', model: 'cheap' });
    expect(f.usage).toHaveLength(1);
    expect(f.usage[0]).toMatchObject({ ok: true, cacheHit: false, inputTokens: 400 });
  });

  it('the same photo again is served from cache: no model call, no cost, logged as a hit', async () => {
    const f = fakeDeps();
    await identify(f.deps, 'u1', { imageBase64: JPEG });
    const again = await identify(f.deps, 'u1', { imageBase64: JPEG });
    expect(again.status).toBe(200);
    expect(f.calls).toHaveLength(1);
    expect(f.usage[1]).toMatchObject({ cacheHit: true, costUsd: 0 });
    if (again.status === 200) expect(again.body.cached).toBe(true);
  });

  it('accepts a data-URI prefix', async () => {
    const f = fakeDeps();
    expect((await identify(f.deps, 'u1', { imageBase64: `data:image/jpeg;base64,${JPEG}` })).status).toBe(200);
  });

  it('the cache is per user', async () => {
    const f = fakeDeps();
    await identify(f.deps, 'u1', { imageBase64: JPEG });
    await identify(f.deps, 'u2', { imageBase64: JPEG });
    expect(f.calls).toHaveLength(2);
  });

  it('an unsure first answer triggers exactly one full-detail call to the stronger model', async () => {
    const unsure = good({ candidates: [cand('Ficus', 'Fig', 'genus', 'low') as any] });
    const sure = good({ candidates: [cand('Ficus elastica', 'Rubber plant') as any] });
    const f = fakeDeps({ answers: [unsure, sure] });
    const out = await identify(f.deps, 'u1', { imageBase64: JPEG });
    expect(f.calls).toEqual([{ model: 'cheap', detail: 'low' }, { model: 'strong', detail: 'full' }]);
    if (out.status === 200) {
      expect(out.body.escalated).toBe(true);
      expect(out.body.model).toBe('strong');
      expect(out.body.result.candidates[0].latin).toBe('Ficus elastica');
    }
  });

  it('a blurry photo is not escalated — a better model cannot fix the picture', async () => {
    const f = fakeDeps({ answers: [good({ image_issue: 'blurry', candidates: [cand('Ficus', 'Fig', 'genus', 'low') as any] })] });
    await identify(f.deps, 'u1', { imageBase64: JPEG });
    expect(f.calls).toHaveLength(1);
  });

  it('garbage from the first model falls through to the second; garbage from both is a clean 502', async () => {
    const f = fakeDeps({ answers: ['<html>oops</html>', good()] });
    expect((await identify(f.deps, 'u1', { imageBase64: JPEG })).status).toBe(200);
    expect(f.usage[0]).toMatchObject({ ok: false, error: 'invalid model output' });

    const g = fakeDeps({ answers: ['nope', new Error('quota exceeded')] });
    const out = await identify(g.deps, 'u1', { imageBase64: JPEG });
    expect(out.status).toBe(502);
    expect(g.saved).toHaveLength(0);
    expect(g.cache.size).toBe(0);
    expect(g.usage.map((u) => u.ok)).toEqual([false, false]);
  });

  it('escalation can be switched off', async () => {
    const f = fakeDeps({ models: { primary: 'cheap', escalation: null }, answers: [good({ candidates: [cand('Ficus', 'Fig', 'genus', 'low') as any] })] });
    const out = await identify(f.deps, 'u1', { imageBase64: JPEG });
    expect(out.status).toBe(200);
    expect(f.calls).toHaveLength(1);
  });

  it('the daily limit stops new photos but not cached ones', async () => {
    const f = fakeDeps();
    await identify(f.deps, 'u1', { imageBase64: JPEG });
    f.setRecent(DAILY_LIMIT);
    const other = Buffer.from(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, ...Array(300).fill(7)])).toString('base64');
    const blocked = await identify(f.deps, 'u1', { imageBase64: other });
    expect(blocked.status).toBe(429);
    expect(f.calls).toHaveLength(1);
    expect((await identify(f.deps, 'u1', { imageBase64: JPEG })).status).toBe(200);
  });

  it.each([
    ['nothing', {}, 400],
    ['a number', { imageBase64: 12345 }, 400],
    ['not base64', { imageBase64: '!'.repeat(400) }, 400],
    ['a text file', { imageBase64: Buffer.from('hello world '.repeat(40)).toString('base64') }, 415],
    ['an oversized body', { imageBase64: 'A'.repeat(Math.ceil((IMAGE_MAX_BYTES * 4) / 3) + 100) }, 413],
  ])('rejects %s before any model call', async (_n, input, status) => {
    const f = fakeDeps();
    expect((await identify(f.deps, 'u1', input)).status).toBe(status);
    expect(f.calls).toHaveLength(0);
    expect(f.usage).toHaveLength(0);
  });

  it('an unsafe plantKey is dropped, not stored', async () => {
    const f = fakeDeps();
    await identify(f.deps, 'u1', { imageBase64: JPEG, plantKey: "x'; drop table plants; --" });
    expect(f.saved[0].plantKey).toBeNull();
  });
});

describe('matching a suggestion to the catalog', () => {
  const m = (latin: string, common = 'x', rank = 'species') => matchCatalog(cand(latin, common, rank) as any);

  it('exact botanical name', () => {
    expect(m('Monstera deliciosa').species?.common).toBe('Monstera');
    expect(m('monstera  DELICIOSA').species?.common).toBe('Monstera');
  });
  it('renamed genera resolve either way', () => {
    expect(m('Sansevieria trifasciata').species?.common).toBe('Snake plant');
    expect(m('Dracaena trifasciata').species?.common).toBe('Snake plant');
  });
  it('genus only: offers the catalog’s species in that genus instead of picking one', () => {
    const r = m('Ficus', 'Fig', 'genus');
    expect(r.species).toBeNull();
    expect(r.sameGenus.length).toBeGreaterThan(1);
    expect(r.sameGenus.every((s) => s.latin.toLowerCase().startsWith('ficus'))).toBe(true);
  });
  it('a plant Greenr has no record for is not mapped onto a neighbour', () => {
    const r = m('Welwitschia mirabilis', 'Welwitschia');
    expect(r.species).toBeNull();
    expect(r.sameGenus).toEqual([]);
  });
  it('a common name only counts when the genus does not contradict it', () => {
    expect(m('Quercus robur', 'Monstera').species).toBeNull();
  });
});
