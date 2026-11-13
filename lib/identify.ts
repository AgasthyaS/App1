import { ALL_SPECIES, type PlantSpecies } from './plants';
import { supabase } from './supabase';
import type { Candidate, Identification } from '../supabase/functions/_shared/identify';

export type { Candidate, Identification } from '../supabase/functions/_shared/identify';

/**
 * PHOTO IDENTIFICATION — the app's side.
 *
 * The photo goes to the `identify-plant` edge function, which holds the model
 * key, enforces the limits, and returns a validated structure. Nothing here
 * talks to a model directly, and nothing the model says changes a plant until
 * the owner has confirmed it on screen.
 *
 * The model names plants in botanical Latin; Greenr's care data is keyed by its
 * own catalog. `matchCatalog` is the bridge, and it is deliberately strict: a
 * suggestion Greenr has no care record for is shown as "not in the catalog"
 * rather than being quietly mapped onto something similar.
 */

export type IdentifyFailure =
  | 'not-configured' // no backend, or the function is not deployed
  | 'signed-out'
  | 'daily-limit'
  | 'too-large'
  | 'bad-image'
  | 'unavailable';

export interface IdentifyResult {
  ok: true;
  /** `plant_identifications.id`, for recording what the owner decided. Null on a cache hit. */
  id: number | null;
  identification: Identification;
  matches: CandidateMatch[];
  cached: boolean;
  remainingToday: number;
}

export interface IdentifyError {
  ok: false;
  reason: IdentifyFailure;
  message: string;
}

export interface CandidateMatch {
  candidate: Candidate;
  /** the catalog species this resolves to, when there is exactly one good answer */
  species: PlantSpecies | null;
  /** catalog species in the same genus — offered when the model stopped at genus */
  sameGenus: PlantSpecies[];
}

/** Genera that were renamed; houseplant sources and models use both. */
const GENUS_SYNONYMS: Record<string, string[]> = {
  sansevieria: ['dracaena'],
  dracaena: ['sansevieria'],
  calathea: ['goeppertia'],
  goeppertia: ['calathea'],
  scindapsus: ['epipremnum'],
  epipremnum: ['scindapsus'],
  plectranthus: ['coleus'],
  coleus: ['plectranthus'],
  senecio: ['curio'],
  curio: ['senecio'],
};

const norm = (s: string) =>
  s.toLowerCase().replace(/[×x]\s/g, '').replace(/['".]/g, '').replace(/\s+/g, ' ').trim();
const genusOf = (latin: string) => norm(latin).split(' ')[0] ?? '';
const epithetOf = (latin: string) => norm(latin).split(' ')[1] ?? '';

let byLatin: Map<string, PlantSpecies> | null = null;
let byGenus: Map<string, PlantSpecies[]> | null = null;
let byCommon: Map<string, PlantSpecies> | null = null;

function index() {
  if (byLatin) return;
  byLatin = new Map();
  byGenus = new Map();
  byCommon = new Map();
  for (const s of ALL_SPECIES) {
    const l = norm(s.latin);
    if (l && !byLatin.has(l)) byLatin.set(l, s);
    const g = genusOf(s.latin);
    if (g) byGenus.set(g, [...(byGenus.get(g) ?? []), s]);
    const c = norm(s.common);
    if (c && !byCommon.has(c)) byCommon.set(c, s);
  }
}

/** Resolve one model candidate against the species catalog. */
export function matchCatalog(candidate: Candidate): CandidateMatch {
  index();
  const genus = genusOf(candidate.latin);
  const epithet = epithetOf(candidate.latin);
  const genera = [genus, ...(GENUS_SYNONYMS[genus] ?? [])].filter(Boolean);
  const sameGenus = genera.flatMap((g) => byGenus!.get(g) ?? []);

  let species: PlantSpecies | null = null;
  if (epithet) {
    // Exact binomial, under the current or the older genus name.
    for (const g of genera) {
      species = byLatin!.get(`${g} ${epithet}`) ?? null;
      if (species) break;
    }
    // A catalog entry may carry a cultivar or variety after the binomial.
    if (!species) species = sameGenus.find((s) => epithetOf(s.latin) === epithet) ?? null;
  }
  // The model's common name, when it is exactly one the catalog uses AND the
  // genus does not contradict it. Not for a genus-only answer with several
  // catalog species behind it: "Ficus, a fig" must not become the edible fig
  // just because the catalog happens to file one under the bare word.
  if (!species && (epithet || sameGenus.length <= 1)) {
    const c = byCommon!.get(norm(candidate.common));
    if (c && (!genus || genera.includes(genusOf(c.latin)))) species = c;
  }
  // Genus only, and the catalog has just one plant in it: that one.
  if (!species && !epithet && sameGenus.length === 1) species = sameGenus[0];

  return { candidate, species, sameGenus: sameGenus.filter((s) => s !== species).slice(0, 8) };
}

/** Strip a data-URI prefix; the function wants bare base64. */
const bare = (dataUri: string) => dataUri.replace(/^data:[^;]+;base64,/, '');

/**
 * Identify the plant in a photo. `photo` is the data URI the camera or picker
 * already produced (resized to ~720 px there), so nothing is re-encoded here.
 */
export async function identifyPlant(photo: string, plantKey?: string): Promise<IdentifyResult | IdentifyError> {
  const err = (reason: IdentifyFailure, message: string): IdentifyError => ({ ok: false, reason, message });
  if (!supabase) return err('not-configured', 'Photo identification needs an account server, which this build does not have.');
  if (!photo.startsWith('data:')) return err('bad-image', 'That photo could not be read. Try taking it again.');
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return err('signed-out', 'Sign in to identify plants from a photo. You can still search by name.');

  const { data, error } = await supabase.functions.invoke('identify-plant', {
    body: { imageBase64: bare(photo), ...(plantKey ? { plantKey } : {}) },
  });
  if (error) {
    // supabase-js puts the function's own JSON body on error.context for non-2xx.
    let code = '';
    let message = '';
    try {
      const body = await (error as { context?: Response }).context?.json?.();
      code = body?.code ?? '';
      message = body?.error ?? '';
    } catch {
      /* no body — fall through to the generic message */
    }
    if (code === 'daily-limit') return err('daily-limit', message);
    if (code === 'too-large') return err('too-large', message);
    if (code === 'bad-type' || code === 'bad-image' || code === 'no-image') return err('bad-image', message || 'That photo could not be read.');
    if (code === 'auth') return err('signed-out', message);
    if (code === 'not-configured' || /not found|404/i.test(String(error.message))) {
      return err('not-configured', 'Photo identification is not switched on for this app yet. Search by name instead.');
    }
    return err('unavailable', message || 'Identification is not available right now. Search by name instead.');
  }
  const identification = data?.result as Identification | undefined;
  if (!identification || typeof identification.is_plant !== 'boolean') {
    return err('unavailable', 'Identification returned nothing usable. Search by name instead.');
  }
  return {
    ok: true,
    id: typeof data.id === 'number' ? data.id : null,
    identification,
    matches: identification.candidates.map(matchCatalog),
    cached: !!data.cached,
    remainingToday: typeof data.remainingToday === 'number' ? data.remainingToday : 0,
  };
}

/** Record what the owner did with a suggestion. Best-effort; never blocks the flow. */
export async function recordIdentificationDecision(
  id: number | null,
  action: 'confirmed' | 'chose-alternative' | 'corrected' | 'rejected',
  acceptedSpecies: string | null,
  plantKey?: string | null,
): Promise<void> {
  if (!supabase || id == null) return;
  try {
    await supabase.from('plant_identifications').update({
      user_action: action,
      accepted_species: acceptedSpecies,
      acted_at: new Date().toISOString(),
      ...(plantKey ? { plant_key: plantKey } : {}),
    }).eq('id', id);
  } catch {
    /* the record is a nicety; the plant has already been created */
  }
}

/** Plain words for what limited a photo, and what to do about it. */
export function issueAdvice(issue: Identification['image_issue']): string | null {
  switch (issue) {
    case 'blurry': return 'The photo is blurry. Hold still, tap to focus, and try again.';
    case 'dark': return 'The photo is too dark. Move nearer a window or turn on a light.';
    case 'too-far': return 'The plant is too far away. Fill the frame with it.';
    case 'partial': return 'Only part of the plant is visible. A photo of the whole plant, or a whole leaf with its stem, identifies better.';
    case 'multiple-plants': return 'There are several plants in the photo. Photograph one at a time.';
    default: return null;
  }
}
