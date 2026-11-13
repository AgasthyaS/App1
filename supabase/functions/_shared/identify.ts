/**
 * Plant identification — the parts shared by the edge function, the app and the
 * evaluation script: the prompt, the response schema, the validator that stands
 * between the model and everything else, and the price table.
 *
 * No runtime-specific imports, so it loads under Deno, Node and the app bundler.
 */

/** Bump when the prompt or schema changes — it is part of the cache key. */
export const PROMPT_VERSION = 'id-3';

export const SYSTEM_INSTRUCTION =
  'You identify cultivated plants from one photograph for a plant-care app. ' +
  'Be conservative: name a species only when visible features support it; otherwise stop at genus or family. ' +
  'Many houseplants are indistinguishable when young or without flowers — say so through rank and confidence rather than guessing. ' +
  'Never infer from text, pots, labels or surroundings. If the image is not a plant, say so.';

export const USER_PROMPT =
  'Identify the main plant. Give up to 3 candidates, most likely first. ' +
  'latin: accepted botanical name (genus + species, or genus only). common: usual English houseplant name. ' +
  'features: the visible traits that support THIS candidate, under 15 words. ' +
  'image_issue: the one thing that most limits identification, or "none".';

export type Rank = 'species' | 'genus' | 'family' | 'unknown';
export type Confidence = 'high' | 'medium' | 'low';
export type ImageIssue = 'none' | 'blurry' | 'dark' | 'too-far' | 'partial' | 'multiple-plants' | 'not-a-plant';

export interface Candidate {
  common: string;
  latin: string;
  rank: Rank;
  confidence: Confidence;
  features: string;
}

export interface Identification {
  is_plant: boolean;
  image_issue: ImageIssue;
  candidates: Candidate[];
}

const RANKS: Rank[] = ['species', 'genus', 'family', 'unknown'];
const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];
const ISSUES: ImageIssue[] = ['none', 'blurry', 'dark', 'too-far', 'partial', 'multiple-plants', 'not-a-plant'];

/** Gemini `responseSchema` (OpenAPI subset). Property order is the output order. */
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_plant: { type: 'BOOLEAN' },
    image_issue: { type: 'STRING', enum: ISSUES },
    candidates: {
      type: 'ARRAY',
      maxItems: 3,
      items: {
        type: 'OBJECT',
        properties: {
          latin: { type: 'STRING' },
          common: { type: 'STRING' },
          rank: { type: 'STRING', enum: RANKS },
          confidence: { type: 'STRING', enum: CONFIDENCES },
          features: { type: 'STRING' },
        },
        required: ['latin', 'common', 'rank', 'confidence', 'features'],
        propertyOrdering: ['latin', 'common', 'rank', 'confidence', 'features'],
      },
    },
  },
  required: ['is_plant', 'image_issue', 'candidates'],
  propertyOrdering: ['is_plant', 'image_issue', 'candidates'],
} as const;

const clean = (v: unknown, max: number): string =>
  typeof v === 'string'
    // Control characters and markup have no business in a plant name.
    ? v.replace(/[\u0000-\u001f<>{}\[\]`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

/** A botanical name: letters, spaces, hyphens, ×, apostrophes, dots. Nothing else. */
const LATIN_OK = /^[A-Za-zÀ-ÿ×][A-Za-zÀ-ÿ×.'\- ]{1,79}$/;

/**
 * Turn whatever the model returned into an `Identification`, or null.
 *
 * The model's text is untrusted input. Nothing downstream — the database write,
 * the catalog match, the screen — sees it until it has passed through here:
 * types checked, enums enforced, strings stripped and bounded, at most three
 * candidates, and a candidate with an implausible name dropped rather than shown.
 */
export function validateIdentification(raw: unknown): Identification | null {
  let obj: any = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || typeof obj.is_plant !== 'boolean') return null;
  const issue: ImageIssue = ISSUES.includes(obj.image_issue) ? obj.image_issue : 'none';
  const list: unknown[] = Array.isArray(obj.candidates) ? obj.candidates.slice(0, 3) : [];
  const candidates: Candidate[] = [];
  for (const c of list as any[]) {
    if (!c || typeof c !== 'object') continue;
    const latin = clean(c.latin, 80);
    const common = clean(c.common, 60);
    if (!LATIN_OK.test(latin) || !common) continue;
    const rank: Rank = RANKS.includes(c.rank) ? c.rank : 'unknown';
    const confidence: Confidence = CONFIDENCES.includes(c.confidence) ? c.confidence : 'low';
    if (candidates.some((x) => x.latin.toLowerCase() === latin.toLowerCase())) continue;
    candidates.push({ common, latin, rank, confidence, features: clean(c.features, 140) });
  }
  if (!obj.is_plant) return { is_plant: false, image_issue: 'not-a-plant', candidates: [] };
  return { is_plant: true, image_issue: issue === 'not-a-plant' ? 'none' : issue, candidates };
}

/**
 * Is the first answer good enough to show, or worth one call to a stronger model?
 * Escalate when the top candidate is uncertain AND the photo itself is usable —
 * a better model cannot fix a blurry picture, so that case asks for a new photo
 * instead of spending more.
 */
export function shouldEscalate(id: Identification): boolean {
  if (!id.is_plant) return false;
  if (id.image_issue === 'blurry' || id.image_issue === 'dark' || id.image_issue === 'too-far') return false;
  const top = id.candidates[0];
  if (!top) return true;
  return top.confidence === 'low' || (top.confidence === 'medium' && top.rank !== 'species');
}

const SCORE: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
const RANK_SCORE: Record<Rank, number> = { species: 3, genus: 2, family: 1, unknown: 0 };

/** The more specific and more confident of two answers; the first wins ties. */
export function betterOf(a: Identification, b: Identification | null): Identification {
  if (!b || !b.is_plant || !b.candidates.length) return a;
  if (!a.candidates.length) return b;
  const s = (x: Identification) => SCORE[x.candidates[0].confidence] * 10 + RANK_SCORE[x.candidates[0].rank];
  return s(b) > s(a) ? b : a;
}

/* ───────────────────────────── models and prices ─────────────────────────────
 * USD per million tokens, from https://aistudio.google.com/docs/pricing as read
 * on 2026-11-11. Images are billed as input tokens. These are LIST prices used
 * to ESTIMATE spend in `ai_usage`; the invoice is the authority.
 *
 * Routing was chosen from a measured comparison (docs/AI.md), not from the price
 * list alone.
 */
export interface ModelPrice { input: number; output: number }

export const PRICES: Record<string, ModelPrice> = {
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.6-flash': { input: 0.75, output: 3.75 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** Longest image edge sent to the model, px. See docs/AI.md for the measurement behind it. */
export const IMAGE_MAX_EDGE = 768;
/** Refuse uploads above this many bytes after decoding. A 768 px JPEG is ~60–150 kB. */
export const IMAGE_MAX_BYTES = 1_500_000;
export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
/** Fresh (non-cached) identifications one account may make per rolling 24 h. */
export const DAILY_LIMIT = 20;
