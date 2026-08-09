/**
 * The plant species database — the single source of truth the add-plant picker,
 * advice engine, sensor interpretation, health engine, suggestions, and spot-fit
 * all read from.
 *
 * Every species resolves to a COMPLETE, measurable care profile:
 *   • horticulturally-grounded category baselines (RHS, Missouri Botanical
 *     Garden, university extension services) fill every field, and
 *   • a curated override table refines the most common species with
 *     species-specific values and ASPCA-verified pet toxicity.
 *
 * Honesty rule (§14): a species carries `care.verified = true` only when its
 * values come from the curated record. Otherwise the numbers are the
 * category-typical baseline — accurate for the category, but an estimate for
 * the individual species — and `verified` is false so the UI can say so. Pet
 * toxicity is never guessed from a category: uncurated species report
 * `toxicity.source = 'Not verified'` rather than a category assumption, because
 * within one category safe and dangerous plants sit side by side.
 */

import { ROWS, type Row } from './plantCatalog';

export type CategoryKey =
  | 'tropical'
  | 'fern'
  | 'palm'
  | 'succulent'
  | 'cactus'
  | 'vine'
  | 'tree'
  | 'herb'
  | 'vegetable'
  | 'flowering'
  | 'orchid'
  | 'grass'
  | 'carnivorous'
  | 'shrub'
  | 'bulb';

export type Difficulty = 'Very easy' | 'Easy' | 'Moderate' | 'Demanding' | 'Expert';
export type GrowthRate = 'Slow' | 'Moderate' | 'Fast';
export type Placement = 'Indoor' | 'Outdoor' | 'Both';
export type Drainage = 'Fast' | 'Moderate' | 'Moisture-retentive';
export type ToxLevel = 'toxic' | 'nonToxic' | 'unknown';

export interface Toxicity {
  cats: ToxLevel;
  dogs: ToxLevel;
  humans: ToxLevel;
  /** the agent + effect, e.g. "Insoluble calcium oxalates — oral irritation, drooling" */
  note: string;
  /** "ASPCA" for verified records; "Not verified" for category baselines */
  source: string;
}

/** The full, measurable care profile every species resolves to. */
export interface CareProfile {
  difficulty: Difficulty;
  growthRate: GrowthRate;
  /** measurable, e.g. "2–8 ft tall indoors" */
  matureSize: string;
  /** e.g. "USDA 10–12 (grown indoors in cooler zones)" */
  hardinessZones: string;
  placement: Placement;

  moisture: {
    /** ideal soil-moisture band %, on the capacitive-sensor scale (== species.band) */
    idealPct: [number, number];
    /** water when moisture falls below this % */
    waterAtPct: number;
    /** reduce watering frequency by ~this % in winter/dormancy */
    winterReductionPct: number;
    /** measurable, generated from the numbers so it never drifts */
    note: string;
  };
  soil: {
    type: string;
    drainage: Drainage;
    potting: string;
  };
  light: {
    /** daily light integral band, mol/m²/day (== species.dli) */
    dli: [number, number];
    label: string;
    note: string;
  };
  temperature: {
    /** comfortable range °F (== species.temp) */
    idealF: [number, number];
    /** damage risk below this °F */
    minF: number;
    note: string;
  };
  humidity: {
    idealPct: [number, number];
    /** floor below which trouble starts (== species.rhFloor) */
    floor: number;
    note: string;
  };
  fertilizer: string;
  seasonal: string;
  dormancy: string;
  diseases: string;
  pests: string;
  growthExpectations: string;
  /** early-warning signs, fed to diagnosis + the on-screen care guide */
  signs: {
    overwatering: string;
    underwatering: string;
    tooMuchLight: string;
    tooLittleLight: string;
  };
  toxicity: Toxicity;
  /** reputable references backing this profile */
  sources: string[];
  /** true = curated, species-specific values; false = category-typical baseline */
  verified: boolean;
}

export interface PlantSpecies {
  common: string;
  latin: string;
  emoji: string;
  category: CategoryKey;

  // ── legacy quick-access ranges (kept for existing consumers) ──
  band: [number, number]; // soil-moisture comfort band %
  dli: [number, number]; // daily light (DLI) comfort band
  rhFloor: number; // humidity floor %
  temp: [number, number]; // comfortable temp °F
  outdoor: boolean; // can thrive outdoors (in season / mild climates)

  // ── full measurable care profile (§1) ──
  care: CareProfile;
}

/** The quick bands the sensor logic reads. */
interface CategoryBands {
  emoji: string;
  band: [number, number];
  dli: [number, number];
  rhFloor: number;
  temp: [number, number];
  outdoor: boolean;
}

const CATEGORIES: Record<CategoryKey, CategoryBands> = {
  tropical: { emoji: '🌿', band: [30, 55], dli: [2, 7], rhFloor: 50, temp: [65, 82], outdoor: false },
  fern: { emoji: '🌱', band: [45, 70], dli: [1, 4], rhFloor: 60, temp: [62, 78], outdoor: false },
  palm: { emoji: '🌴', band: [30, 55], dli: [3, 8], rhFloor: 45, temp: [65, 85], outdoor: false },
  succulent: { emoji: '🪴', band: [10, 30], dli: [4, 30], rhFloor: 25, temp: [60, 88], outdoor: true },
  cactus: { emoji: '🌵', band: [8, 25], dli: [6, 30], rhFloor: 20, temp: [55, 92], outdoor: true },
  vine: { emoji: '🍃', band: [25, 50], dli: [2, 6], rhFloor: 45, temp: [64, 82], outdoor: false },
  tree: { emoji: '🌳', band: [30, 55], dli: [4, 10], rhFloor: 40, temp: [60, 85], outdoor: false },
  herb: { emoji: '🌿', band: [40, 65], dli: [6, 20], rhFloor: 40, temp: [58, 82], outdoor: true },
  vegetable: { emoji: '🥬', band: [40, 70], dli: [8, 30], rhFloor: 40, temp: [55, 85], outdoor: true },
  flowering: { emoji: '🌸', band: [35, 60], dli: [4, 12], rhFloor: 45, temp: [60, 82], outdoor: true },
  orchid: { emoji: '🌸', band: [30, 55], dli: [2, 6], rhFloor: 55, temp: [65, 82], outdoor: false },
  grass: { emoji: '🎋', band: [35, 60], dli: [4, 14], rhFloor: 40, temp: [60, 88], outdoor: true },
  carnivorous: { emoji: '🪰', band: [55, 80], dli: [4, 12], rhFloor: 60, temp: [60, 85], outdoor: false },
  shrub: { emoji: '🌳', band: [25, 50], dli: [6, 30], rhFloor: 30, temp: [45, 85], outdoor: true },
  bulb: { emoji: '🌷', band: [30, 55], dli: [6, 25], rhFloor: 30, temp: [45, 80], outdoor: true },
};

/**
 * WATER DYNAMICS per category — how each kind of plant actually handles water
 * over time, which is what makes the drying curve species-specific instead of
 * one generic pot model.
 *
 * These are physiologically grounded, not stylistic knobs:
 *  • Desert CAM plants (cactus, succulent) evolved in fast-draining grit and
 *    store their own water. They drink slowly, want to dry out COMPLETELY, and
 *    their fleshy roots rot within days if left wet — the highest rot risk here.
 *  • Rainforest understory plants (fern, carnivorous) evolved in permanently
 *    damp litter. They transpire fast through thin leaves, must never dry out,
 *    and tolerate wet roots that would kill a succulent.
 *  • Epiphytes (orchid) grow on bark in the air: their mix drains in minutes and
 *    their roots need oxygen, so standing water is lethal even though they like
 *    humidity.
 *  • Fast-growing edibles (herb, vegetable) move enormous amounts of water — a
 *    tomato in summer can empty a pot in a day — so they dry fastest of all.
 *
 *   dryRateMult  — relative speed the pot loses water (1.0 = average houseplant).
 *                  Driven by transpiration: big thin leaves lose water fast,
 *                  waxy succulent skin barely loses any.
 *   drainMult    — relative time to shed free water after a soak (grit/bark
 *                  mixes < 1, moisture-retentive mixes > 1).
 *   rotRiskHours — how long roots can sit saturated before it's genuinely
 *                  dangerous. This sets when "draining" becomes "waterlogged".
 *   dryTolerance — how far below the ideal band the plant copes with before real
 *                  stress, in percentage points. Succulents shrug off a long dry
 *                  spell; a fern browns at the edges almost immediately.
 *   style        — how it wants to be watered, in plain language.
 */
export type WaterStyle = 'soak-and-dry' | 'evenly-moist' | 'constantly-damp' | 'dry-between';

export interface CategoryWater {
  dryRateMult: number;
  drainMult: number;
  rotRiskHours: number;
  dryTolerance: number;
  style: WaterStyle;
}

const CATEGORY_WATER: Record<CategoryKey, CategoryWater> = {
  // Thin-leaved tropicals: steady drinkers, like the top third to dry.
  tropical:    { dryRateMult: 1.0,  drainMult: 1.0,  rotRiskHours: 36, dryTolerance: 10, style: 'dry-between' },
  // Never let a fern dry — no water storage, browns within a day.
  fern:        { dryRateMult: 1.25, drainMult: 1.2,  rotRiskHours: 60, dryTolerance: 3,  style: 'evenly-moist' },
  palm:        { dryRateMult: 1.0,  drainMult: 1.0,  rotRiskHours: 40, dryTolerance: 8,  style: 'dry-between' },
  // Stores its own water; wet roots rot fast. Must dry out fully between drinks.
  succulent:   { dryRateMult: 0.45, drainMult: 0.55, rotRiskHours: 12, dryTolerance: 25, style: 'soak-and-dry' },
  cactus:      { dryRateMult: 0.35, drainMult: 0.45, rotRiskHours: 10, dryTolerance: 30, style: 'soak-and-dry' },
  vine:        { dryRateMult: 1.05, drainMult: 1.0,  rotRiskHours: 36, dryTolerance: 12, style: 'dry-between' },
  tree:        { dryRateMult: 0.9,  drainMult: 1.05, rotRiskHours: 44, dryTolerance: 10, style: 'dry-between' },
  // Fast growth = heavy transpiration; wilts quickly but recovers when watered.
  herb:        { dryRateMult: 1.5,  drainMult: 0.9,  rotRiskHours: 28, dryTolerance: 6,  style: 'evenly-moist' },
  vegetable:   { dryRateMult: 1.7,  drainMult: 0.9,  rotRiskHours: 28, dryTolerance: 5,  style: 'evenly-moist' },
  flowering:   { dryRateMult: 1.2,  drainMult: 1.0,  rotRiskHours: 32, dryTolerance: 7,  style: 'evenly-moist' },
  // Epiphyte in bark: drains in minutes, roots need air, standing water kills.
  orchid:      { dryRateMult: 1.1,  drainMult: 0.4,  rotRiskHours: 14, dryTolerance: 12, style: 'soak-and-dry' },
  grass:       { dryRateMult: 1.2,  drainMult: 0.95, rotRiskHours: 40, dryTolerance: 10, style: 'evenly-moist' },
  // Bog plants — they WANT to sit wet, and tap water minerals harm them.
  carnivorous: { dryRateMult: 1.15, drainMult: 1.6,  rotRiskHours: 240, dryTolerance: 2, style: 'constantly-damp' },
  shrub:       { dryRateMult: 0.95, drainMult: 0.95, rotRiskHours: 40, dryTolerance: 14, style: 'dry-between' },
  // Bulbs rot in wet soil while dormant — the classic way people lose them.
  bulb:        { dryRateMult: 0.85, drainMult: 0.85, rotRiskHours: 18, dryTolerance: 16, style: 'dry-between' },
};

/**
 * Ecological niche width per category — how forgiving a plant is when a factor
 * drifts outside its ideal band. These are physiologically grounded: desert
 * CAM plants (cacti, succulents) tolerate enormous swings in light, heat, and
 * humidity; rainforest understory plants (ferns, calatheas) are stenotopic —
 * narrow tolerance, punished fast by any drift. The compatibility model reads
 * these as the σ (falloff width) of each factor's tolerance curve, so the score
 * is driven by real data instead of one hardcoded margin for every plant.
 *
 *   lightSigmaDli  — DLI units of grace beyond the band before fit → ~0
 *   tempSigmaF     — °F of grace beyond the comfortable range
 *   rhSigmaPct     — %RH of grace below the humidity floor
 *   demand         — relative weight of LIGHT in this plant's suitability
 *                    (sun-driven plants care more about getting light right)
 */
export interface CategoryNiche {
  lightSigmaDli: number;
  tempSigmaF: number;
  rhSigmaPct: number;
  demand: number; // 0.9 (buffered) … 1.15 (light-critical)
}

const CATEGORY_NICHE: Record<CategoryKey, CategoryNiche> = {
  tropical: { lightSigmaDli: 4, tempSigmaF: 10, rhSigmaPct: 22, demand: 1.0 },
  fern: { lightSigmaDli: 2.5, tempSigmaF: 8, rhSigmaPct: 16, demand: 0.95 },
  palm: { lightSigmaDli: 4.5, tempSigmaF: 11, rhSigmaPct: 26, demand: 1.0 },
  succulent: { lightSigmaDli: 9, tempSigmaF: 16, rhSigmaPct: 40, demand: 1.12 },
  cactus: { lightSigmaDli: 10, tempSigmaF: 18, rhSigmaPct: 45, demand: 1.15 },
  vine: { lightSigmaDli: 4, tempSigmaF: 10, rhSigmaPct: 24, demand: 0.98 },
  tree: { lightSigmaDli: 5, tempSigmaF: 12, rhSigmaPct: 28, demand: 1.02 },
  herb: { lightSigmaDli: 6, tempSigmaF: 12, rhSigmaPct: 30, demand: 1.08 },
  vegetable: { lightSigmaDli: 7, tempSigmaF: 12, rhSigmaPct: 30, demand: 1.12 },
  flowering: { lightSigmaDli: 5, tempSigmaF: 11, rhSigmaPct: 26, demand: 1.05 },
  orchid: { lightSigmaDli: 3, tempSigmaF: 9, rhSigmaPct: 18, demand: 1.0 },
  grass: { lightSigmaDli: 6, tempSigmaF: 13, rhSigmaPct: 30, demand: 1.05 },
  carnivorous: { lightSigmaDli: 4, tempSigmaF: 10, rhSigmaPct: 14, demand: 1.08 },
  shrub: { lightSigmaDli: 8, tempSigmaF: 16, rhSigmaPct: 34, demand: 1.05 },
  bulb: { lightSigmaDli: 7, tempSigmaF: 15, rhSigmaPct: 34, demand: 1.03 },
};

/** The niche width for a species (falls back to tropical if unknown). */
export function nicheFor(species: string | undefined): CategoryNiche {
  const s = getSpecies(species);
  return CATEGORY_NICHE[s?.category ?? 'tropical'];
}

/**
 * Species that genuinely behave differently from their category. Kept small and
 * evidence-led: a plant only appears here when its water behaviour is a known
 * exception, not to manufacture per-species precision we don't have.
 */
const WATER_OVERRIDES: Record<string, Partial<CategoryWater>> = {
  // Rhizomes/caudex store water like a succulent despite tropical foliage — the
  // most over-watered houseplants there are.
  'Snake plant':    { dryRateMult: 0.45, rotRiskHours: 14, dryTolerance: 28, style: 'soak-and-dry' },
  'ZZ plant':       { dryRateMult: 0.4,  rotRiskHours: 14, dryTolerance: 30, style: 'soak-and-dry' },
  'Ponytail palm':  { dryRateMult: 0.4,  rotRiskHours: 12, dryTolerance: 28, style: 'soak-and-dry' },
  // Thin, thirsty leaves that collapse fast but recover — famously dramatic.
  'Peace lily':     { dryRateMult: 1.35, dryTolerance: 4,  style: 'evenly-moist' },
  'Nerve plant':    { dryRateMult: 1.5,  dryTolerance: 2,  style: 'evenly-moist' },
  // Prayer plants: no drought tolerance, and very sensitive to staying soggy.
  'Calathea':       { dryRateMult: 1.2,  dryTolerance: 3,  rotRiskHours: 40, style: 'evenly-moist' },
  'Prayer plant':   { dryRateMult: 1.2,  dryTolerance: 3,  rotRiskHours: 40, style: 'evenly-moist' },
  // Fine surface roots dry out quickly; hate both extremes.
  'Fiddle leaf fig':{ dryRateMult: 1.0,  dryTolerance: 6,  rotRiskHours: 30, style: 'dry-between' },
  // Woody desert shrub — long dry spells are normal, wet feet are fatal.
  'Jade plant':     { dryRateMult: 0.4,  rotRiskHours: 10, dryTolerance: 30, style: 'soak-and-dry' },
  // Thin bulbous roots; classic winter-rot victim.
  'Amaryllis':      { rotRiskHours: 14,  dryTolerance: 18, style: 'dry-between' },
};

/**
 * How THIS species handles water over time — the curve behind the drying model.
 * Built from its category baseline, then adjusted by any curated override, so
 * every species in the catalog gets a grounded curve rather than one shared
 * default. Unknown species fall back to the average houseplant (tropical).
 */
export function waterProfileFor(species: string | undefined): CategoryWater {
  const s = getSpecies(species);
  const base = CATEGORY_WATER[s?.category ?? 'tropical'];
  const over = s ? WATER_OVERRIDES[s.common] : undefined;
  return over ? { ...base, ...over } : base;
}

/** Plain-language description of how this plant wants to be watered. */
export function waterStyleNote(species: string | undefined): string {
  switch (waterProfileFor(species).style) {
    case 'soak-and-dry':
      return 'Drench it, then let the soil dry out almost completely before the next drink — its roots rot if they stay wet.';
    case 'constantly-damp':
      return 'Keep the soil damp at all times; this one grows in bogs and must never dry out. Use rain or distilled water.';
    case 'evenly-moist':
      return 'Keep it evenly moist — water once the surface feels dry, before the leaves start to droop.';
    default:
      return 'Let the top third of the soil dry out, then water thoroughly until it runs from the base.';
  }
}

/** Everything a category profile carries except the bands + generated fields. */
type CategoryCare = Omit<
  CareProfile,
  'moisture' | 'light' | 'temperature' | 'humidity' | 'toxicity' | 'verified' | 'sources'
> & {
  moisture: { waterAtPct: number; winterReductionPct: number };
  light: { label: string; note: string };
  temperature: { minF: number; note: string };
  humidity: { idealPct: [number, number]; note: string };
};

const BASELINE_SOURCES = ['RHS Plant Finder', 'Missouri Botanical Garden Plant Finder'];

const CATEGORY_CARE: Record<CategoryKey, CategoryCare> = {
  tropical: {
    difficulty: 'Easy',
    growthRate: 'Fast',
    matureSize: '2–8 ft tall indoors (varies by species)',
    hardinessZones: 'USDA 10–12 · grown indoors in cooler zones',
    placement: 'Indoor',
    moisture: { waterAtPct: 30, winterReductionPct: 30 },
    soil: {
      type: 'Chunky, airy aroid mix — bark, perlite, and coco coir',
      drainage: 'Moderate',
      potting: 'Pot up one size when roots circle the pot; refresh mix every 1–2 years in spring.',
    },
    light: {
      label: 'Bright indirect',
      note: 'East/north window, or a few feet back from a bright south/west one. Avoid harsh midday sun.',
    },
    temperature: { minF: 55, note: 'Cold-sensitive — tissue damage below ~50°F; keep away from cold drafts and glass.' },
    humidity: { idealPct: [50, 70], note: '40% is tolerable; 50–60% keeps leaf edges from crisping.' },
    fertilizer: 'Balanced liquid feed (e.g. 20-20-20) at half strength monthly, spring–summer; none in winter.',
    seasonal: 'Growth slows Nov–Feb — cut watering ~30% and stop feeding until spring.',
    dormancy: 'No true dormancy; a slow rest in low winter light.',
    diseases: 'Root rot from overwatering, bacterial leaf spot, and southern blight in soggy mixes.',
    pests: 'Spider mites, thrips, mealybugs, and fungus gnats.',
    growthExpectations: 'Several new leaves per warm season; leaves enlarge and fenestrate in good light.',
    signs: {
      overwatering: 'Yellowing lower leaves, mushy stems, fungus gnats, or a sour soil smell.',
      underwatering: 'Drooping, crispy leaf edges, and soil pulling away from the pot.',
      tooMuchLight: 'Pale, bleached patches and scorched brown spots.',
      tooLittleLight: 'Leggy growth, small new leaves, few fenestrations.',
    },
  },
  fern: {
    difficulty: 'Moderate',
    growthRate: 'Moderate',
    matureSize: '1–3 ft tall and wide',
    hardinessZones: 'USDA 9–11 · mostly grown indoors',
    placement: 'Indoor',
    moisture: { waterAtPct: 45, winterReductionPct: 20 },
    soil: {
      type: 'Rich, moisture-retentive peat/coir mix with perlite',
      drainage: 'Moisture-retentive',
      potting: 'Keep slightly root-bound; repot in spring every 1–2 years.',
    },
    light: { label: 'Low to medium indirect', note: 'Bright shade or a north window. Direct sun scorches fronds.' },
    temperature: { minF: 55, note: 'Happiest 62–75°F; browns quickly in hot, dry air.' },
    humidity: { idealPct: [60, 80], note: '60%+ is essential — use a pebble tray or humidifier; fronds brown below 40%.' },
    fertilizer: 'Half-strength balanced feed monthly during growth — ferns are light feeders.',
    seasonal: 'Slower in winter; keep evenly moist and feed less.',
    dormancy: 'Semi-evergreen indoors; no strict dormancy.',
    diseases: 'Root and crown rot if soggy; leaf blight in stagnant air.',
    pests: 'Scale, mealybugs, and fungus gnats.',
    growthExpectations: 'Steady flush of new fronds when humidity stays high.',
    signs: {
      overwatering: 'Blackened crown and rotting fronds if it stays soggy.',
      underwatering: 'Crispy, browning fronds — ferns hate drying out.',
      tooMuchLight: 'Faded, scorched fronds in direct sun.',
      tooLittleLight: 'Sparse, slow growth in deep shade.',
    },
  },
  palm: {
    difficulty: 'Easy',
    growthRate: 'Slow',
    matureSize: '3–8 ft tall indoors',
    hardinessZones: 'USDA 9–11 · Both in frost-free climates',
    placement: 'Both',
    moisture: { waterAtPct: 30, winterReductionPct: 25 },
    soil: {
      type: 'Free-draining loam-based mix with added sand or perlite',
      drainage: 'Fast',
      potting: 'Palms like snug pots; repot every 2–3 years — roots resent disturbance.',
    },
    light: { label: 'Bright indirect to some direct', note: 'Bright filtered light; acclimate slowly to any direct sun.' },
    temperature: { minF: 55, note: 'Keep above 55°F; most brown at the tips in cold, dry rooms.' },
    humidity: { idealPct: [45, 60], note: 'Average humidity is fine; mist or group plants if tips brown.' },
    fertilizer: 'Palm fertilizer with magnesium 2–3× during the growing season.',
    seasonal: 'Minimal winter growth; ease off water and feed.',
    dormancy: 'No true dormancy; slows in low light.',
    diseases: 'Root rot, ganoderma butt rot, and leaf-spot fungi in wet conditions.',
    pests: 'Spider mites and scale, especially in dry air.',
    growthExpectations: 'Slow to moderate — a few new fronds a year; do not expect fast height.',
    signs: {
      overwatering: 'Yellow-brown fronds from the base and black roots.',
      underwatering: 'Brown, crispy frond tips and folding leaflets.',
      tooMuchLight: 'Scorched, yellowing fronds in harsh sun.',
      tooLittleLight: 'Weak, stretched growth and dropped lower fronds.',
    },
  },
  succulent: {
    difficulty: 'Very easy',
    growthRate: 'Slow',
    matureSize: '3–12 in (varies widely)',
    hardinessZones: 'USDA 9–11 · Both where frost-free',
    placement: 'Both',
    moisture: { waterAtPct: 10, winterReductionPct: 50 },
    soil: {
      type: 'Gritty, fast-draining cactus/succulent mix (add pumice or coarse sand)',
      drainage: 'Fast',
      potting: 'Unglazed pot with a drainage hole; repot every 2–3 years or when crowded.',
    },
    light: { label: 'Bright direct', note: '4–6 hours of direct sun; a south/west window. Too little light stretches them.' },
    temperature: { minF: 45, note: 'Most tolerate 45–90°F; protect from frost.' },
    humidity: { idealPct: [20, 40], note: 'Low humidity suits them; good airflow prevents rot.' },
    fertilizer: 'Dilute cactus feed 2–3× in spring–summer only.',
    seasonal: 'Many rest in peak summer or winter — water sparingly then (soak-and-dry).',
    dormancy: 'Seasonal rest common; withhold most water during it.',
    diseases: 'Root and stem rot from overwatering; fungal leaf spots.',
    pests: 'Mealybugs (in leaf axils) and root mealybugs.',
    growthExpectations: 'Slow; compact rosettes and strong color when light is bright.',
    signs: {
      overwatering: 'Translucent, mushy, dropping leaves — the top killer.',
      underwatering: 'Wrinkled, shriveled, softening leaves (recovers fast after a drink).',
      tooMuchLight: 'Rare, but sudden full sun can scorch — acclimate slowly.',
      tooLittleLight: 'Stretching (etiolation) and pale, spaced-out leaves.',
    },
  },
  cactus: {
    difficulty: 'Very easy',
    growthRate: 'Slow',
    matureSize: '4 in – 3 ft (species-dependent)',
    hardinessZones: 'USDA 9–11 · Both where frost-free',
    placement: 'Both',
    moisture: { waterAtPct: 8, winterReductionPct: 70 },
    soil: {
      type: 'Very gritty mineral mix — cactus soil cut with pumice or coarse sand',
      drainage: 'Fast',
      potting: 'Terracotta with a drainage hole; repot every 3–4 years, dry, wearing gloves.',
    },
    light: { label: 'Full sun', note: '6+ hours of direct sun. The brightest window you have.' },
    temperature: { minF: 40, note: 'Loves heat; many take a cool (but frost-free) winter rest.' },
    humidity: { idealPct: [20, 40], note: 'Low humidity and strong airflow.' },
    fertilizer: 'Low-nitrogen cactus feed a couple of times in summer.',
    seasonal: 'Keep cool and nearly dry in winter to set spring flowers.',
    dormancy: 'Cool, dry winter rest encourages blooming.',
    diseases: 'Basal rot spreads fast in cold, wet soil.',
    pests: 'Mealybugs and scale.',
    growthExpectations: 'Slow; needs strong light to stay compact and to flower.',
    signs: {
      overwatering: 'Soft, brown mush at the base — rot spreads fast.',
      underwatering: 'Puckering, shrinking, dull skin (very tolerant).',
      tooMuchLight: 'Reddish/yellow stress color; acclimate to full sun.',
      tooLittleLight: 'Thin, pale, stretched new growth reaching for light.',
    },
  },
  vine: {
    difficulty: 'Easy',
    growthRate: 'Fast',
    matureSize: 'Trails/climbs 3–10 ft',
    hardinessZones: 'USDA 10–12 · grown indoors in cooler zones',
    placement: 'Indoor',
    moisture: { waterAtPct: 25, winterReductionPct: 30 },
    soil: {
      type: 'Well-draining indoor mix with perlite',
      drainage: 'Moderate',
      potting: 'Give a moss pole or trellis to climb; repot yearly while growing fast.',
    },
    light: { label: 'Medium to bright indirect', note: 'Bright indirect keeps variegation; low light drops it.' },
    temperature: { minF: 55, note: 'Keep 64–82°F; avoid cold drafts.' },
    humidity: { idealPct: [45, 65], note: '45%+ preferred; average rooms are usually fine.' },
    fertilizer: 'Balanced feed monthly in spring–summer.',
    seasonal: 'Slows in winter — reduce water and hold feed.',
    dormancy: 'No true dormancy; slows in low light.',
    diseases: 'Root rot and leaf spot in soggy soil.',
    pests: 'Spider mites, mealybugs, and aphids.',
    growthExpectations: 'Fast trailing/climbing growth; pinch tips to keep it full.',
    signs: {
      overwatering: 'Yellowing leaves and black, mushy stems near the soil.',
      underwatering: 'Curling, crispy leaves and limp vines.',
      tooMuchLight: 'Washed-out, scorched leaves.',
      tooLittleLight: 'Long gaps between leaves and loss of variegation.',
    },
  },
  tree: {
    difficulty: 'Moderate',
    growthRate: 'Moderate',
    matureSize: '4–10 ft tall indoors',
    hardinessZones: 'USDA 9–11 · grown indoors in cooler zones',
    placement: 'Indoor',
    moisture: { waterAtPct: 30, winterReductionPct: 30 },
    soil: {
      type: 'Well-draining, loam-based potting mix',
      drainage: 'Moderate',
      potting: 'Repot every 1–2 years; large specimens tolerate being pot-bound.',
    },
    light: { label: 'Bright indirect to direct', note: 'Bright light near a window; rotate for even growth.' },
    temperature: { minF: 55, note: 'Steady 60–80°F; sudden moves cause leaf drop.' },
    humidity: { idealPct: [40, 60], note: '40%+ keeps leaves supple.' },
    fertilizer: 'Balanced feed monthly, spring–summer.',
    seasonal: 'Slows in winter; some drop leaves seasonally.',
    dormancy: 'Semi-dormant in low winter light.',
    diseases: 'Root rot, leaf-spot fungi, and sooty mold following pests.',
    pests: 'Scale, mealybugs, and spider mites.',
    growthExpectations: 'Moderate; dislikes being moved (leaf drop after relocation).',
    signs: {
      overwatering: 'Dropping leaves (yellow or green) and dark, soft roots.',
      underwatering: 'Wilting, curling, then leaf drop; dry, tight soil.',
      tooMuchLight: 'Leaf scorch when moved abruptly into direct sun.',
      tooLittleLight: 'Leggy growth and heavy leaf drop indoors.',
    },
  },
  herb: {
    difficulty: 'Easy',
    growthRate: 'Fast',
    matureSize: '6–24 in tall',
    hardinessZones: 'USDA 5–11 · Both (many annual)',
    placement: 'Both',
    moisture: { waterAtPct: 40, winterReductionPct: 20 },
    soil: {
      type: 'Free-draining potting mix; lean soil for Mediterranean herbs',
      drainage: 'Moderate',
      potting: 'Roomy pot with drainage; harvest often to keep bushy.',
    },
    light: { label: 'Full sun', note: '6+ hours of direct sun for strong flavor; a sunny sill or grow light.' },
    temperature: { minF: 40, note: 'Most prefer 60–80°F; tender herbs dislike cold nights.' },
    humidity: { idealPct: [40, 60], note: 'Average humidity with good airflow.' },
    fertilizer: 'Light feeding only — too much nitrogen weakens flavor.',
    seasonal: 'Many are annual or slow in winter; sow successively for a steady supply.',
    dormancy: 'Annual herbs finish after flowering; perennials slow in winter.',
    diseases: 'Powdery mildew, downy mildew, and root rot in wet soil.',
    pests: 'Aphids, whitefly, and spider mites.',
    growthExpectations: 'Fast; pinch and harvest weekly to stay bushy and delay bolting.',
    signs: {
      overwatering: 'Yellowing and wilting despite wet soil; root rot.',
      underwatering: 'Fast wilting and crispy leaves — most herbs droop early.',
      tooMuchLight: 'Rarely a problem — most herbs love sun.',
      tooLittleLight: 'Leggy, pale, weak-flavored growth.',
    },
  },
  vegetable: {
    difficulty: 'Moderate',
    growthRate: 'Fast',
    matureSize: '1–6 ft (crop-dependent)',
    hardinessZones: 'Grown as a seasonal annual in most zones',
    placement: 'Both',
    moisture: { waterAtPct: 40, winterReductionPct: 0 },
    soil: {
      type: 'Rich, moisture-retentive mix with compost',
      drainage: 'Moderate',
      potting: 'Large pot for the root run; consistent moisture prevents splitting and blossom-end rot.',
    },
    light: { label: 'Full sun', note: '6–8 hours of direct sun; fruiting crops need the most.' },
    temperature: { minF: 50, note: 'Warm-season crops need 60–85°F and no frost.' },
    humidity: { idealPct: [40, 70], note: 'Moderate humidity; airflow reduces disease.' },
    fertilizer: 'Feed regularly; switch to higher-potassium feed once fruiting begins.',
    seasonal: 'Mostly seasonal annuals — plant after last frost, harvest before first.',
    dormancy: 'None — annual life cycle.',
    diseases: 'Blight, powdery mildew, and blossom-end rot from uneven watering.',
    pests: 'Aphids, whitefly, caterpillars, and spider mites.',
    growthExpectations: 'Fast with strong light and steady moisture; support heavy fruit.',
    signs: {
      overwatering: 'Yellowing, wilting, and split or rotting fruit.',
      underwatering: 'Wilting, blossom drop, and bitter or small produce.',
      tooMuchLight: 'Usually welcome; watch for sunscald on exposed fruit.',
      tooLittleLight: 'Few flowers/fruit and stretched stems.',
    },
  },
  flowering: {
    difficulty: 'Moderate',
    growthRate: 'Moderate',
    matureSize: '8 in – 3 ft (varies)',
    hardinessZones: 'USDA 8–11 · Both (many tender)',
    placement: 'Both',
    moisture: { waterAtPct: 35, winterReductionPct: 30 },
    soil: {
      type: 'Well-draining potting mix with organic matter',
      drainage: 'Moderate',
      potting: 'Deadhead spent blooms; repot yearly to sustain flowering.',
    },
    light: { label: 'Bright indirect to direct', note: 'Bright light drives flowering; too little means few blooms.' },
    temperature: { minF: 50, note: 'Most prefer 60–80°F; cool nights can trigger bloom in some.' },
    humidity: { idealPct: [45, 65], note: '45%+ preferred; avoid wetting open flowers.' },
    fertilizer: 'Bloom feed (higher phosphorus) during budding and flowering.',
    seasonal: 'Many rest after flowering — ease water and feed then.',
    dormancy: 'Some go dormant after bloom (bulbs especially).',
    diseases: 'Botrytis (grey mold), powdery mildew, and bud rot in damp air.',
    pests: 'Aphids, thrips, and spider mites.',
    growthExpectations: 'Moderate; abundant blooms when light and feeding are right.',
    signs: {
      overwatering: 'Bud drop, yellowing, and rot at the base.',
      underwatering: 'Wilting and dropped buds/flowers.',
      tooMuchLight: 'Scorched petals and faded leaves in harsh sun.',
      tooLittleLight: 'Few or no blooms and leggy growth.',
    },
  },
  orchid: {
    difficulty: 'Demanding',
    growthRate: 'Slow',
    matureSize: '8–24 in tall',
    hardinessZones: 'USDA 10–12 · grown indoors',
    placement: 'Indoor',
    moisture: { waterAtPct: 30, winterReductionPct: 25 },
    soil: {
      type: 'Bark chips or sphagnum moss — never standard potting soil',
      drainage: 'Fast',
      potting: 'Clear pot with lots of drainage and airflow; repot every 1–2 years as bark breaks down.',
    },
    light: { label: 'Bright indirect', note: 'Bright, filtered light (east window). Leaves should be light green, not dark.' },
    temperature: { minF: 55, note: '65–80°F day; a 10–15°F night drop helps trigger spikes.' },
    humidity: { idealPct: [55, 75], note: '55%+ preferred; a humidity tray helps in dry rooms.' },
    fertilizer: 'Weak orchid feed weekly ("weakly, weekly"); flush with plain water monthly.',
    seasonal: 'A cooler, drier rest after flowering can trigger a new spike.',
    dormancy: 'Rest period after blooming rather than true dormancy.',
    diseases: 'Root rot from soggy media; crown rot if water sits in the leaves.',
    pests: 'Mealybugs, scale, and spider mites.',
    growthExpectations: 'Slow; blooms on a seasonal cycle, spikes last weeks to months.',
    signs: {
      overwatering: 'Yellow, limp leaves and brown, mushy roots — the #1 killer.',
      underwatering: 'Wrinkled leaves and silvery, shriveled roots.',
      tooMuchLight: 'Yellow-green or reddened, scorched leaves.',
      tooLittleLight: 'Dark green leaves but no flower spikes.',
    },
  },
  grass: {
    difficulty: 'Easy',
    growthRate: 'Fast',
    matureSize: '1–6 ft (species-dependent)',
    hardinessZones: 'USDA 5–11 (varies widely)',
    placement: 'Both',
    moisture: { waterAtPct: 35, winterReductionPct: 25 },
    soil: {
      type: 'Standard well-draining mix; keep evenly moist',
      drainage: 'Moderate',
      potting: 'Divide clumps as they spread; repot in spring.',
    },
    light: { label: 'Bright indirect to full sun', note: 'Most take bright light; bamboos and sedges want plenty.' },
    temperature: { minF: 45, note: 'Broadly adaptable; many go semi-dormant when cold.' },
    humidity: { idealPct: [40, 60], note: 'Average humidity; water-loving sedges like it moist.' },
    fertilizer: 'Light balanced feed during the growing season.',
    seasonal: 'Many brown and go dormant in winter, then rebound in spring.',
    dormancy: 'Winter dormancy common for temperate grasses.',
    diseases: 'Rust and leaf-spot fungi in crowded, damp conditions.',
    pests: 'Generally pest-resistant; watch for aphids.',
    growthExpectations: 'Fast in season; clumps widen and can be divided.',
    signs: {
      overwatering: 'Yellowing, mushy bases and rot.',
      underwatering: 'Brown, crispy tips and curling blades.',
      tooMuchLight: 'Bleaching in intense midday sun.',
      tooLittleLight: 'Floppy, pale, stretched growth.',
    },
  },
  shrub: {
    difficulty: 'Easy',
    growthRate: 'Moderate',
    matureSize: '3–8 ft tall and wide (varies by species)',
    hardinessZones: 'USDA 4–9 (species-dependent)',
    placement: 'Outdoor',
    moisture: { waterAtPct: 25, winterReductionPct: 60 },
    soil: {
      type: 'Loamy garden soil enriched with compost',
      drainage: 'Moderate',
      potting: 'Mulch 2–3 in around the base (off the stems); prune right after flowering unless it blooms on new wood.',
    },
    light: { label: 'Full sun to part shade', note: 'Most flower best with 4–6+ hours of sun; check the tag for shade-lovers.' },
    temperature: { minF: -10, note: 'Hardy in its zone — overwinters outdoors; container shrubs need extra root protection.' },
    humidity: { idealPct: [30, 70], note: 'Outdoor air is fine; good airflow prevents mildew.' },
    fertilizer: 'Balanced slow-release in early spring; stop feeding by late summer so growth hardens off.',
    seasonal: 'Deep-water in summer drought (first 2 years especially); mulch before winter.',
    dormancy: 'Deciduous shrubs drop leaves and rest all winter — bare branches are normal, not dead.',
    diseases: 'Powdery mildew, leaf spot, and root rot in waterlogged soil.',
    pests: 'Aphids, scale, spider mites, and Japanese beetles.',
    growthExpectations: 'Several inches to a few feet of new growth a year once established (year three is the leap).',
    signs: {
      overwatering: 'Yellowing leaves and dieback in soil that never dries — usually a drainage problem.',
      underwatering: 'Wilting, scorched leaf edges, and early leaf drop in drought.',
      tooMuchLight: 'Leaf scorch on shade-lovers planted in full sun.',
      tooLittleLight: 'Sparse flowering and leggy, open growth.',
    },
  },
  bulb: {
    difficulty: 'Easy',
    growthRate: 'Fast',
    matureSize: '6–36 in tall',
    hardinessZones: 'USDA 3–9 (species-dependent)',
    placement: 'Outdoor',
    moisture: { waterAtPct: 30, winterReductionPct: 80 },
    soil: {
      type: 'Well-draining soil — bulbs rot in soggy ground',
      drainage: 'Fast',
      potting: 'Plant 2–3× the bulb’s height deep, pointy end up; let foliage yellow fully before cutting it back.',
    },
    light: { label: 'Full sun to part shade', note: 'Spring bulbs finish before trees leaf out, so under deciduous trees works.' },
    temperature: { minF: -20, note: 'Most spring bulbs NEED winter cold to bloom; pre-chilled bulbs work in warm zones.' },
    humidity: { idealPct: [30, 70], note: 'Outdoor air is fine.' },
    fertilizer: 'Bulb food or bone meal at planting and again when shoots emerge.',
    seasonal: 'Water while growing and blooming; keep dry during summer dormancy.',
    dormancy: 'Dies back completely after bloom — the bulb is resting underground, not dead. Mark the spot.',
    diseases: 'Bulb rot in wet soil; botrytis on foliage.',
    pests: 'Squirrels and voles dig bulbs (daffodils are rodent-proof); aphids on shoots.',
    growthExpectations: 'Blooms on a strict seasonal clock; healthy clumps multiply and can be divided every few years.',
    signs: {
      overwatering: 'Mushy, foul-smelling bulbs and toppling stems.',
      underwatering: 'Stunted shoots and shriveled blooms in a dry spring.',
      tooMuchLight: 'Rarely a problem outdoors.',
      tooLittleLight: 'Leaves but no flowers in deep shade.',
    },
  },
  carnivorous: {
    difficulty: 'Demanding',
    growthRate: 'Moderate',
    matureSize: '2–12 in (species-dependent)',
    hardinessZones: 'USDA 6–9 (temperate types need winter cold)',
    placement: 'Indoor',
    moisture: { waterAtPct: 55, winterReductionPct: 40 },
    soil: {
      type: 'Nutrient-free peat and sand/perlite — never fertilized potting soil',
      drainage: 'Moisture-retentive',
      potting: 'Stand the pot in a tray of rain or distilled water; never use tap water.',
    },
    light: { label: 'Bright direct', note: 'Very bright light — several hours of sun for strong trap color.' },
    temperature: { minF: 40, note: 'Temperate types need a cold (35–50°F) winter dormancy.' },
    humidity: { idealPct: [50, 70], note: 'High humidity; keep the peat constantly damp.' },
    fertilizer: 'Never fertilize the soil — they feed by catching insects.',
    seasonal: 'Temperate species need a cold, dark winter dormancy to survive long-term.',
    dormancy: 'Winter dormancy is mandatory for Venus flytraps and Sarracenia.',
    diseases: 'Crown rot and grey mold (botrytis) if airflow is poor.',
    pests: 'Aphids and fungus gnats (some of which they catch).',
    growthExpectations: 'Moderate in the growing season; vivid traps only in strong light.',
    signs: {
      overwatering: 'Prefers to sit wet — but stagnant, mineral-rich water rots roots.',
      underwatering: 'Traps blacken and dry; the peat must never fully dry out.',
      tooMuchLight: 'Usually wants lots of light; acclimate slowly to full sun.',
      tooLittleLight: 'Weak, pale traps that fail to color up.',
    },
  },
};

const UNKNOWN_TOXICITY: Toxicity = {
  cats: 'unknown',
  dogs: 'unknown',
  humans: 'unknown',
  note: 'Pet toxicity not individually verified for this species — keep out of reach and check the ASPCA database before trusting pets around it.',
  source: 'Not verified',
};

/** ASPCA-verified toxicity records, keyed by lowercase Latin name. */
const TOX: Record<string, Toxicity> = {
  'monstera deliciosa': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Insoluble calcium oxalates — oral irritation, drooling, vomiting.', source: 'ASPCA' },
  'epipremnum aureum': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Insoluble calcium oxalates — mouth irritation and swelling if chewed.', source: 'ASPCA' },
  'philodendron hederaceum': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Insoluble calcium oxalates — oral pain, drooling, vomiting.', source: 'ASPCA' },
  'spathiphyllum wallisii': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Insoluble calcium oxalates — intense oral burning and swelling.', source: 'ASPCA' },
  'zamioculcas zamiifolia': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Calcium oxalates — irritation, vomiting; wash hands after handling sap.', source: 'ASPCA' },
  'dracaena trifasciata': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Saponins — nausea, vomiting, and drooling in cats and dogs.', source: 'ASPCA' },
  'dracaena marginata': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Saponins — vomiting (sometimes with blood), depression, drooling.', source: 'ASPCA' },
  'dracaena fragrans': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Saponins — vomiting, drooling, dilated pupils in cats.', source: 'ASPCA' },
  'chlorophytum comosum': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic, though cats may nibble and over-eat it.', source: 'ASPCA' },
  'nephrolepis exaltata': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic to cats and dogs.', source: 'ASPCA' },
  'dypsis lutescens': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (a good choice for pet homes).', source: 'ASPCA' },
  'chamaedorea elegans': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic to cats and dogs.', source: 'ASPCA' },
  'howea forsteriana': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (Kentia palm).', source: 'ASPCA' },
  'aloe vera': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Saponins and anthraquinones — vomiting, lethargy, diarrhea in pets. Gel is edible for humans; the latex is a laxative.', source: 'ASPCA' },
  'crassula ovata': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Vomiting, lethargy, incoordination in cats and dogs.', source: 'ASPCA' },
  'ficus elastica': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Irritant latex sap — mouth and skin irritation, vomiting.', source: 'ASPCA' },
  'ficus lyrata': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Insoluble calcium oxalates in the sap — oral irritation, skin rash.', source: 'ASPCA' },
  'saintpaulia ionantha': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (African violet).', source: 'ASPCA' },
  'phalaenopsis amabilis': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (moth orchid).', source: 'ASPCA' },
  'echeveria elegans': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic to cats and dogs.', source: 'ASPCA' },
  'haworthiopsis attenuata': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (zebra haworthia).', source: 'ASPCA' },
  'schlumbergera bridgesii': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic; fibrous material can cause mild stomach upset if gorged.', source: 'ASPCA' },
  'maranta leuconeura': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (prayer plant).', source: 'ASPCA' },
  'peperomia argyreia': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (Peperomia are pet-safe).', source: 'ASPCA' },
  'peperomia obtusifolia': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic to cats and dogs.', source: 'ASPCA' },
  'pilea peperomioides': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Considered non-toxic to pets.', source: 'ASPCA' },
  'calathea orbifolia': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (Calathea/Goeppertia are pet-safe).', source: 'ASPCA' },
  'dieffenbachia seguine': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Insoluble calcium oxalates — severe oral swelling ("dumb cane").', source: 'ASPCA' },
  'codiaeum variegatum': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Irritant latex — mouth irritation, vomiting; sap irritates skin.', source: 'ASPCA' },
  'hedera helix': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Triterpenoid saponins — vomiting, drooling; foliage more toxic than berries.', source: 'ASPCA' },
  'euphorbia pulcherrima': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Irritant milky sap — mild mouth/stomach irritation (toxicity often overstated).', source: 'ASPCA' },
  'strelitzia reginae': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Toxic seeds/pods — vomiting, drowsiness in pets.', source: 'ASPCA' },
  'cycas revoluta': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'SEVERE — cycasin causes liver failure; often fatal. Every part is toxic; seeds worst.', source: 'ASPCA' },
  'pachira aquatica': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (money tree).', source: 'ASPCA' },
  'beaucarnea recurvata': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (ponytail palm).', source: 'ASPCA' },
  'ocimum basilicum': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic and edible (basil).', source: 'ASPCA' },
  'salvia rosmarinus': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic and edible (rosemary).', source: 'ASPCA' },
  'thymus vulgaris': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic and edible (thyme).', source: 'ASPCA' },
  'salvia officinalis': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic and edible (sage).', source: 'ASPCA' },
  'lavandula angustifolia': { cats: 'toxic', dogs: 'toxic', humans: 'nonToxic', note: 'Contains linalool — mild nausea/vomiting in pets; safe for people.', source: 'ASPCA' },
  'dionaea muscipula': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (Venus flytrap).', source: 'ASPCA' },
  'solanum lycopersicum': { cats: 'toxic', dogs: 'toxic', humans: 'nonToxic', note: 'Green foliage/stems contain solanine — toxic to pets; ripe fruit is edible for humans.', source: 'ASPCA' },

  // ── Garden classics — the dangerous ones people don't expect ──
  'lilium spp.': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'SEVERE for cats — every part (even pollen or vase water) can cause fatal kidney failure. Dogs: GI upset.', source: 'ASPCA' },
  'lilium "stargazer"': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'SEVERE for cats — fatal kidney failure risk from any part, pollen included.', source: 'ASPCA' },
  'lilium "asiatic hybrids"': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'SEVERE for cats — fatal kidney failure risk from any part.', source: 'ASPCA' },
  'lilium lancifolium': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'SEVERE for cats — fatal kidney failure risk.', source: 'ASPCA' },
  'lilium longiflorum': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'SEVERE for cats — fatal kidney failure risk.', source: 'ASPCA' },
  'hemerocallis spp.': { cats: 'toxic', dogs: 'nonToxic', humans: 'unknown', note: 'SEVERE for cats — daylilies cause kidney failure in cats; not toxic to dogs.', source: 'ASPCA' },
  'nerium oleander': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'SEVERE — cardiac glycosides; every part is dangerous to pets and people.', source: 'ASPCA' },
  'digitalis purpurea': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'SEVERE — cardiac glycosides (digitalis); can be fatal if eaten.', source: 'ASPCA' },
  'convallaria majalis': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'SEVERE — cardiac glycosides; small amounts can affect the heart.', source: 'ASPCA' },
  'colchicum autumnale': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'SEVERE — colchicine; all parts, bulbs worst.', source: 'ASPCA' },
  'taxus baccata': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'SEVERE — taxine alkaloids; needles and seeds can be fatal.', source: 'ASPCA' },
  'aconitum napellus': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'SEVERE — aconitine; handle with gloves, keep pets away.', source: 'ASPCA' },
  'brugmansia suaveolens': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'SEVERE — tropane alkaloids in all parts.', source: 'ASPCA' },
  'tulipa gesneriana': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Tulipalin — vomiting, drooling; the bulb is the most toxic part.', source: 'ASPCA' },
  'narcissus pseudonarcissus': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Lycorine — vomiting, drooling; bulbs worst. Squirrel-proof, but keep from pets.', source: 'ASPCA' },
  'hyacinthus orientalis': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Alkaloids concentrated in the bulb — vomiting, drooling.', source: 'ASPCA' },
  'rhododendron spp.': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Grayanotoxins — vomiting, weakness, heart effects; a few leaves can sicken a pet.', source: 'ASPCA' },
  'rhododendron simsii': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Grayanotoxins (azalea) — vomiting, weakness, heart effects.', source: 'ASPCA' },
  'hydrangea macrophylla': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Cyanogenic glycosides — vomiting and lethargy if chewed.', source: 'ASPCA' },
  'hosta spp.': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Saponins — vomiting and diarrhea in pets.', source: 'ASPCA' },
  'iris germanica': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Irritating compounds, rhizomes worst — drooling, vomiting.', source: 'ASPCA' },
  'wisteria sinensis': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Seeds and pods — severe GI upset.', source: 'ASPCA' },
  'lathyrus odoratus': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Sweet pea seeds — lethargy, tremors if eaten repeatedly.', source: 'ASPCA' },
  'ipomoea purpurea': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Seeds contain LSA alkaloids — GI upset, disorientation.', source: 'ASPCA' },
  'buxus sempervirens': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Alkaloids — vomiting and diarrhea.', source: 'ASPCA' },
  'ilex aquifolium': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Berries and spiny leaves — vomiting, diarrhea.', source: 'ASPCA' },
  'daphne odora': { cats: 'toxic', dogs: 'toxic', humans: 'toxic', note: 'Mezerein — severe irritation; berries dangerous.', source: 'ASPCA' },
  'vitis vinifera': { cats: 'toxic', dogs: 'toxic', humans: 'nonToxic', note: 'Grapes/raisins cause kidney failure in dogs — even small amounts.', source: 'ASPCA' },
  'allium cepa': { cats: 'toxic', dogs: 'toxic', humans: 'nonToxic', note: 'All alliums damage pets’ red blood cells (onion).', source: 'ASPCA' },
  'allium sativum': { cats: 'toxic', dogs: 'toxic', humans: 'nonToxic', note: 'Garlic — damages pets’ red blood cells; worse for cats.', source: 'ASPCA' },
  'allium schoenoprasum': { cats: 'toxic', dogs: 'toxic', humans: 'nonToxic', note: 'Chives — like all alliums, damages pets’ red blood cells.', source: 'ASPCA' },
  'allium fistulosum': { cats: 'toxic', dogs: 'toxic', humans: 'nonToxic', note: 'Green onion — allium toxicity to pets.', source: 'ASPCA' },
  'solanum tuberosum': { cats: 'toxic', dogs: 'toxic', humans: 'nonToxic', note: 'Green foliage, sprouts, and green tubers contain solanine.', source: 'ASPCA' },
  'pelargonium × hortorum': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Geraniol/linalool — vomiting, skin irritation in pets.', source: 'ASPCA' },
  'begonia × semperflorens': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Soluble oxalates, tubers worst — drooling, vomiting.', source: 'ASPCA' },
  'kalanchoe blossfeldiana': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Cardiac glycosides — vomiting; heart rhythm effects in quantity.', source: 'ASPCA' },
  'kalanchoe blossfeldiana "calandiva"': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Cardiac glycosides — vomiting; heart rhythm effects in quantity.', source: 'ASPCA' },
  'chrysanthemum morifolium': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Pyrethrins — vomiting, drooling, incoordination.', source: 'ASPCA' },
  'paeonia lactiflora': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Paeonol in the bark — vomiting, diarrhea.', source: 'ASPCA' },
  'gardenia jasminoides': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Genioposide — mild vomiting, hives.', source: 'ASPCA' },
  'hibiscus syriacus': { cats: 'toxic', dogs: 'toxic', humans: 'unknown', note: 'Rose of Sharon — vomiting, diarrhea in dogs.', source: 'ASPCA' },
  'origanum vulgare': { cats: 'toxic', dogs: 'toxic', humans: 'nonToxic', note: 'Mild GI upset in pets; fine for people.', source: 'ASPCA' },
  'mentha spicata': { cats: 'toxic', dogs: 'toxic', humans: 'nonToxic', note: 'Large amounts cause GI upset in pets; culinary use is fine for people.', source: 'ASPCA' },
  'mentha × piperita': { cats: 'toxic', dogs: 'toxic', humans: 'nonToxic', note: 'Peppermint oil is the concern for pets; leaves in quantity cause GI upset.', source: 'ASPCA' },
  'tagetes erecta': { cats: 'toxic', dogs: 'toxic', humans: 'nonToxic', note: 'Mild GI upset and skin irritation in pets.', source: 'ASPCA' },
  'prunus persica': { cats: 'toxic', dogs: 'toxic', humans: 'nonToxic', note: 'Stems, leaves, and pits release cyanide — fruit flesh is fine.', source: 'ASPCA' },
  'malus domestica': { cats: 'toxic', dogs: 'toxic', humans: 'nonToxic', note: 'Seeds and foliage contain cyanogenic compounds — fruit flesh is fine.', source: 'ASPCA' },

  // ── Reassuringly safe classics ──
  'helianthus annuus': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (sunflower).', source: 'ASPCA' },
  'zinnia elegans': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (zinnia).', source: 'ASPCA' },
  'antirrhinum majus': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (snapdragon).', source: 'ASPCA' },
  'petunia × atkinsiana': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (petunia).', source: 'ASPCA' },
  'viola × wittrockiana': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (pansy).', source: 'ASPCA' },
  'impatiens walleriana': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (impatiens).', source: 'ASPCA' },
  'rosa spp.': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic — thorns are the only hazard.', source: 'ASPCA' },
  'camellia japonica': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (camellia).', source: 'ASPCA' },
  'hibiscus rosa-sinensis': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Chinese hibiscus is pet-safe (unlike Rose of Sharon).', source: 'ASPCA' },
  'fragaria × ananassa': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (strawberry).', source: 'ASPCA' },
  'vaccinium corymbosum': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (blueberry).', source: 'ASPCA' },
  'cucurbita pepo': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (squash family).', source: 'ASPCA' },
  'tropaeolum majus': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic — flowers and leaves are even edible (peppery).', source: 'ASPCA' },
  'calendula officinalis': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (pot marigold).', source: 'ASPCA' },
  'echinacea purpurea': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (coneflower).', source: 'ASPCA' },
  'rudbeckia hirta': { cats: 'nonToxic', dogs: 'nonToxic', humans: 'nonToxic', note: 'Non-toxic (black-eyed Susan).', source: 'ASPCA' },
};

/**
 * Curated species overrides: species-specific values that meaningfully differ
 * from the category baseline. Anything omitted falls back to the category
 * profile. Keyed by lowercase Latin name. Toxicity is pulled from TOX above.
 */
type Override = Partial<{
  difficulty: Difficulty;
  growthRate: GrowthRate;
  matureSize: string;
  hardinessZones: string;
  placement: Placement;
  fertilizer: string;
  growthExpectations: string;
  extraSources: string[];
}>;

const OVERRIDES: Record<string, Override> = {
  'monstera deliciosa': { matureSize: '6–8 ft tall indoors, leaves to 2 ft', hardinessZones: 'USDA 10–12', growthExpectations: 'Fast in warm months; leaves fenestrate (split) once mature in bright light.', extraSources: ['ASPCA'] },
  'epipremnum aureum': { difficulty: 'Very easy', matureSize: 'Trails 6–10 ft indoors', hardinessZones: 'USDA 10–12', growthExpectations: 'Very fast; one of the most forgiving houseplants.', extraSources: ['ASPCA'] },
  'dracaena trifasciata': { difficulty: 'Very easy', matureSize: '1–4 ft tall', hardinessZones: 'USDA 9–11', growthExpectations: 'Slow; extremely drought-tolerant — the classic "forget to water it" plant.', extraSources: ['ASPCA'] },
  'spathiphyllum wallisii': { matureSize: '1–3 ft tall', hardinessZones: 'USDA 11–12', growthExpectations: 'Dramatic wilting when thirsty, then a fast rebound after watering; white spathes in good light.', extraSources: ['ASPCA'] },
  'zamioculcas zamiifolia': { difficulty: 'Very easy', matureSize: '2–3 ft tall', hardinessZones: 'USDA 9–11', growthExpectations: 'Slow; rhizomes store water — tolerates deep neglect and low light.', extraSources: ['ASPCA'] },
  'ficus lyrata': { difficulty: 'Demanding', matureSize: '6–10 ft tall indoors', hardinessZones: 'USDA 9–11', growthExpectations: 'Moderate but fussy — hates being moved and drops leaves after any change.', extraSources: ['ASPCA'] },
  'ficus elastica': { matureSize: '6–10 ft tall indoors', hardinessZones: 'USDA 10–12', extraSources: ['ASPCA'] },
  'aloe vera': { difficulty: 'Very easy', matureSize: '1–2 ft tall', hardinessZones: 'USDA 9–11', growthExpectations: 'Slow; offsets ("pups") crowd the pot over time.', extraSources: ['ASPCA', 'University of Florida IFAS'] },
  'phalaenopsis amabilis': { matureSize: '8–20 in tall', hardinessZones: 'USDA 11–12', growthExpectations: 'Slow; a healthy spike blooms for 2–3 months and can rebloom from a node.', extraSources: ['ASPCA', 'American Orchid Society'] },
  'nephrolepis exaltata': { matureSize: '2–3 ft tall and wide', hardinessZones: 'USDA 9–11', extraSources: ['ASPCA'] },
  'dypsis lutescens': { matureSize: '6–7 ft tall indoors', hardinessZones: 'USDA 10–11', extraSources: ['ASPCA'] },
  'chamaedorea elegans': { difficulty: 'Very easy', matureSize: '2–4 ft tall', hardinessZones: 'USDA 10–12', growthExpectations: 'Slow; tolerates low light better than most palms.', extraSources: ['ASPCA'] },
  'cycas revoluta': { difficulty: 'Moderate', matureSize: '2–5 ft tall (very slow)', hardinessZones: 'USDA 9–11', growthExpectations: 'Very slow — one flush of fronds a year. Not a true palm.', extraSources: ['ASPCA'] },
  'crassula ovata': { difficulty: 'Very easy', matureSize: '2–4 ft tall over years', hardinessZones: 'USDA 10–11', growthExpectations: 'Slow; thickens into a small tree with age and bright light.', extraSources: ['ASPCA'] },
  'saintpaulia ionantha': { matureSize: '4–6 in tall', hardinessZones: 'USDA 11–12', growthExpectations: 'Blooms year-round in bright indirect light; water from below to avoid leaf spots.', extraSources: ['ASPCA'] },
  'ocimum basilicum': { matureSize: '12–24 in tall', hardinessZones: 'Annual (USDA 10+ perennial)', growthExpectations: 'Fast; pinch flower spikes to prolong leaf harvest.', extraSources: ['ASPCA'] },
  'solanum lycopersicum': { matureSize: '3–6 ft with support', hardinessZones: 'Warm-season annual', growthExpectations: 'Fast; needs staking, full sun, and steady water to avoid split fruit and blossom-end rot.', extraSources: ['ASPCA'] },
  'dionaea muscipula': { difficulty: 'Demanding', matureSize: '2–5 in across', hardinessZones: 'USDA 6–9', growthExpectations: 'Needs a cold winter dormancy; feed only via insects it catches, never fertilizer.', extraSources: ['ASPCA', 'International Carnivorous Plant Society'] },
  'maranta leuconeura': { matureSize: '6–12 in tall, spreading', hardinessZones: 'USDA 11–12', growthExpectations: 'Leaves fold up at night ("prayer plant"); very sensitive to hard tap water.', extraSources: ['ASPCA'] },
  'chlorophytum comosum': { difficulty: 'Very easy', matureSize: '1–2 ft, arching', hardinessZones: 'USDA 9–11', growthExpectations: 'Fast; sends out plantlets ("spiderettes") you can pot up.', extraSources: ['ASPCA'] },
  'pilea peperomioides': { difficulty: 'Easy', matureSize: '8–12 in tall', hardinessZones: 'USDA 10–11', growthExpectations: 'Fast; pups freely around the base — pot them up and share.', extraSources: ['ASPCA'] },
  'lilium spp.': { difficulty: 'Easy', matureSize: '2–5 ft tall', hardinessZones: 'USDA 4–9', growthExpectations: 'Blooms mid-summer; clumps multiply yearly. Keep FAR from cats.', extraSources: ['ASPCA'] },
  'hydrangea macrophylla': { difficulty: 'Easy', matureSize: '3–6 ft tall and wide', hardinessZones: 'USDA 6–9', growthExpectations: 'Blooms on old wood — prune right after flowering; soil pH shifts bloom color (acid = blue, alkaline = pink).', extraSources: ['ASPCA'] },
  'tulipa gesneriana': { difficulty: 'Easy', matureSize: '10–24 in tall', hardinessZones: 'USDA 3–8', growthExpectations: 'Needs winter chill; many hybrids fade after a few springs — treat as short-lived.', extraSources: ['ASPCA'] },
  'rosa spp.': { difficulty: 'Moderate', matureSize: '2–6 ft (type-dependent)', hardinessZones: 'USDA 5–9', growthExpectations: 'Repeat-bloomers flush all season with deadheading; prune in early spring.', extraSources: ['ASPCA'] },
};


/** Human-readable moisture guidance generated from the numbers (stays reproducible, §14). */
function moistureNote(band: [number, number], waterAt: number, winterCut: number): string {
  const seasonal =
    winterCut > 0
      ? ` In winter, let it dry longer between waterings — reduce frequency by about ${winterCut}%.`
      : '';
  return `Keep soil moisture between ${band[0]}–${band[1]}%. Water when it falls below ${waterAt}%, soaking until it drains, then empty the saucer.${seasonal}`;
}

function tempNote(temp: [number, number], base: string): string {
  return `Comfortable at ${temp[0]}–${temp[1]}°F. ${base}`;
}

function humidityNote(range: [number, number], base: string): string {
  return `Aim for ${range[0]}–${range[1]}% relative humidity. ${base}`;
}

function lightNote(dli: [number, number], label: string, base: string): string {
  return `${label} — about ${dli[0]}–${dli[1]} mol/m²/day (DLI). ${base}`;
}

function buildCare(category: CategoryKey, latin: string): CareProfile {
  const bands = CATEGORIES[category];
  const c = CATEGORY_CARE[category];
  const key = latin.toLowerCase();
  const ov = OVERRIDES[key] ?? {};
  const tox = TOX[key];

  const sources = [...BASELINE_SOURCES, ...(ov.extraSources ?? []), ...(tox ? [] : [])];
  // De-duplicate while preserving order.
  const uniqueSources = sources.filter((s, i) => sources.indexOf(s) === i);

  return {
    difficulty: ov.difficulty ?? c.difficulty,
    growthRate: ov.growthRate ?? c.growthRate,
    matureSize: ov.matureSize ?? c.matureSize,
    hardinessZones: ov.hardinessZones ?? c.hardinessZones,
    placement: ov.placement ?? c.placement,
    moisture: {
      idealPct: bands.band,
      waterAtPct: c.moisture.waterAtPct,
      winterReductionPct: c.moisture.winterReductionPct,
      note: moistureNote(bands.band, c.moisture.waterAtPct, c.moisture.winterReductionPct),
    },
    soil: c.soil,
    light: {
      dli: bands.dli,
      label: c.light.label,
      note: lightNote(bands.dli, c.light.label, c.light.note),
    },
    temperature: {
      idealF: bands.temp,
      minF: c.temperature.minF,
      note: tempNote(bands.temp, c.temperature.note),
    },
    humidity: {
      idealPct: c.humidity.idealPct,
      floor: bands.rhFloor,
      note: humidityNote(c.humidity.idealPct, c.humidity.note),
    },
    fertilizer: ov.fertilizer ?? c.fertilizer,
    seasonal: c.seasonal,
    dormancy: c.dormancy,
    diseases: c.diseases,
    pests: c.pests,
    growthExpectations: ov.growthExpectations ?? c.growthExpectations,
    signs: c.signs,
    toxicity: tox ?? UNKNOWN_TOXICITY,
    sources: uniqueSources,
    // "Verified" = we have curated species-specific values AND confirmed toxicity.
    verified: !!(OVERRIDES[key] && tox),
  };
}

function expand(row: Row): PlantSpecies {
  const [common, latin, category, emojiOverride] = row;
  const t = CATEGORIES[category];
  return {
    common,
    latin,
    emoji: emojiOverride ?? t.emoji,
    category,
    band: t.band,
    dli: t.dli,
    rhFloor: t.rhFloor,
    temp: t.temp,
    outdoor: t.outdoor,
    care: buildCare(category, latin),
  };
}

export const ALL_SPECIES: PlantSpecies[] = ROWS.map(expand);

export const SPECIES_COUNT = ALL_SPECIES.length;

/** How many species carry curated, species-specific care + verified toxicity. */
export const VERIFIED_COUNT = ALL_SPECIES.filter((s) => s.care.verified).length;

const BY_NAME = new Map(ALL_SPECIES.map((s) => [s.common.toLowerCase(), s]));

/** Look up a species by its common name (case-insensitive). */
export function getSpecies(common: string | undefined): PlantSpecies | undefined {
  // Type-safe callers always pass a string, but plants restored from storage or
  // the cloud are not runtime-checked — a non-string here used to throw and take
  // the whole watering calculation down with it.
  if (typeof common !== 'string' || !common) return undefined;
  return BY_NAME.get(common.toLowerCase());
}

/** Fuzzy search across common and latin names. */
export function searchSpecies(query: string, limit = 30): PlantSpecies[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_SPECIES.slice(0, limit);
  const starts: PlantSpecies[] = [];
  const contains: PlantSpecies[] = [];
  for (const s of ALL_SPECIES) {
    const c = s.common.toLowerCase();
    const l = s.latin.toLowerCase();
    if (c.startsWith(q)) starts.push(s);
    else if (c.includes(q) || l.includes(q)) contains.push(s);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

/** A few plausible "camera match" suggestions for the identify step. */
export function topMatches(): PlantSpecies[] {
  return [getSpecies('Monstera'), getSpecies('Golden pothos'), getSpecies('Snake plant')].filter(
    (s): s is PlantSpecies => !!s,
  );
}

/** The full care profile for a species (or undefined if unknown). */
export function careProfileFor(common: string | undefined): CareProfile | undefined {
  return getSpecies(common)?.care;
}
