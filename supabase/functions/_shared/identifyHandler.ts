import {
  ALLOWED_MIME, DAILY_LIMIT, IMAGE_MAX_BYTES, PROMPT_VERSION, betterOf, estimateCostUsd,
  shouldEscalate, validateIdentification, type Identification,
} from './identify.ts';

/**
 * The identification request, start to finish, with every outside effect
 * injected — so the whole policy (limits, cache, routing, validation, logging)
 * runs under test without a network, a database or Deno.
 *
 * Order matters and each step exists to avoid paying for the next:
 *
 *   1. reject bad input           free
 *   2. cache lookup by image hash free — the same photo is never paid for twice
 *   3. daily limit                free — bounds what one account can spend
 *   4. first model, low detail    ~$0.0003
 *   5. second model, full detail  ~$0.0007, only when (4) was unsure of a usable photo
 *
 * The model never touches the database. Its text goes through
 * `validateIdentification`, and only the validated structure is stored or returned.
 */

export interface ModelCall {
  /** raw text the model returned */
  text: string;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

export interface UsageRow {
  userId: string;
  task: 'identify';
  provider: 'google';
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number | null;
  cacheHit: boolean;
  ok: boolean;
  error: string | null;
}

export interface IdentifyDeps {
  /** primary: cheap, low image detail. escalation: stronger and/or full detail. */
  models: { primary: string; escalation: string | null };
  callModel: (model: string, image: { mime: string; base64: string }, detail: 'low' | 'full') => Promise<ModelCall>;
  sha256Hex: (bytes: Uint8Array) => Promise<string>;
  cacheGet: (userId: string, key: string) => Promise<{ result: Identification; model: string } | null>;
  cachePut: (userId: string, key: string, result: Identification, model: string) => Promise<void>;
  /** fresh (non-cached, successful) identifications by this user in the last 24 h */
  recentCount: (userId: string) => Promise<number>;
  logUsage: (row: UsageRow) => Promise<void>;
  saveIdentification: (row: {
    userId: string; plantKey: string | null; imageSha256: string; model: string; escalated: boolean; result: Identification;
  }) => Promise<number | null>;
}

export interface IdentifyInput {
  imageBase64?: unknown;
  mime?: unknown;
  plantKey?: unknown;
}

export type IdentifyOutput =
  | { status: 200; body: { id: number | null; result: Identification; model: string; escalated: boolean; cached: boolean; remainingToday: number } }
  | { status: 400 | 413 | 415 | 429 | 502; body: { error: string; code: string } };

function decodeBase64(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** JPEG, PNG or WebP by their first bytes — the declared type is not trusted. */
function sniff(bytes: Uint8Array): string | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

export async function identify(deps: IdentifyDeps, userId: string, input: IdentifyInput): Promise<IdentifyOutput> {
  const fail = (status: 400 | 413 | 415 | 429 | 502, code: string, error: string): IdentifyOutput => ({ status, body: { error, code } });

  // 1. Input.
  if (typeof input.imageBase64 !== 'string' || input.imageBase64.length < 100) {
    return fail(400, 'no-image', 'No image was sent.');
  }
  // Check the encoded length before decoding, so an oversized body costs nothing.
  if (input.imageBase64.length > Math.ceil((IMAGE_MAX_BYTES * 4) / 3) + 8) {
    return fail(413, 'too-large', 'That photo is too large. The app should resize it before sending.');
  }
  const base64 = input.imageBase64.replace(/^data:[^;]+;base64,/, '');
  const bytes = decodeBase64(base64);
  if (!bytes) return fail(400, 'bad-image', 'The image could not be read.');
  if (bytes.length > IMAGE_MAX_BYTES) return fail(413, 'too-large', 'That photo is too large.');
  const mime = sniff(bytes);
  if (!mime || !ALLOWED_MIME.includes(mime)) return fail(415, 'bad-type', 'Send a JPEG, PNG or WebP photo.');
  const plantKey = typeof input.plantKey === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(input.plantKey) ? input.plantKey : null;

  // 2. Cache.
  const sha = await deps.sha256Hex(bytes);
  const cacheKey = `${PROMPT_VERSION}:${sha}`;
  const used = await deps.recentCount(userId);
  const cached = await deps.cacheGet(userId, cacheKey);
  if (cached) {
    await deps.logUsage({
      userId, task: 'identify', provider: 'google', model: cached.model, inputTokens: 0, outputTokens: 0,
      costUsd: 0, latencyMs: null, cacheHit: true, ok: true, error: null,
    });
    return { status: 200, body: { id: null, result: cached.result, model: cached.model, escalated: false, cached: true, remainingToday: Math.max(0, DAILY_LIMIT - used) } };
  }

  // 3. Limit.
  if (used >= DAILY_LIMIT) {
    return fail(429, 'daily-limit', `You have identified ${DAILY_LIMIT} photos in the last day. Search for the plant by name, or try again tomorrow.`);
  }

  // 4. First pass.
  const run = async (model: string, detail: 'low' | 'full'): Promise<Identification | null> => {
    try {
      const r = await deps.callModel(model, { mime, base64 }, detail);
      const id = validateIdentification(r.text);
      await deps.logUsage({
        userId, task: 'identify', provider: 'google', model, inputTokens: r.inputTokens, outputTokens: r.outputTokens,
        costUsd: estimateCostUsd(model, r.inputTokens, r.outputTokens), latencyMs: r.ms, cacheHit: false,
        ok: !!id, error: id ? null : 'invalid model output',
      });
      return id;
    } catch (e) {
      await deps.logUsage({
        userId, task: 'identify', provider: 'google', model, inputTokens: 0, outputTokens: 0, costUsd: 0,
        latencyMs: null, cacheHit: false, ok: false, error: String((e as Error)?.message ?? e).slice(0, 300),
      });
      return null;
    }
  };

  let result = await run(deps.models.primary, 'low');
  let model = deps.models.primary;
  let escalated = false;

  // 5. One escalation, when the first answer was unusable or unsure of a usable photo.
  if (deps.models.escalation && (!result || shouldEscalate(result))) {
    const second = await run(deps.models.escalation, 'full');
    if (second) {
      escalated = true;
      const best: Identification = result ? betterOf(result, second) : second;
      if (best === second) model = deps.models.escalation;
      result = best;
    }
  }
  if (!result) return fail(502, 'model-failed', 'Identification is not available right now. Search for the plant by name instead.');

  await deps.cachePut(userId, cacheKey, result, model);
  const id = await deps.saveIdentification({ userId, plantKey, imageSha256: sha, model, escalated, result });
  return { status: 200, body: { id, result, model, escalated, cached: false, remainingToday: Math.max(0, DAILY_LIMIT - used - 1) } };
}
