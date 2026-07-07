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
  | 'carnivorous';

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
};

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
};

/** [common, latin, category, emojiOverride?] */
type Row = [string, string, CategoryKey, string?];

// A broad catalog. Care params come from the category baseline; curated species
// refine it. This is intentionally large so most plants a user owns are findable.
const ROWS: Row[] = [
  // ── Tropical foliage / aroids ──
  ['Monstera', 'Monstera deliciosa', 'tropical', '🌿'],
  ['Swiss cheese vine', 'Monstera adansonii', 'tropical'],
  ['Monstera Thai Constellation', 'Monstera deliciosa "Thai Constellation"', 'tropical'],
  ['Heartleaf philodendron', 'Philodendron hederaceum', 'vine', '🍃'],
  ['Philodendron Brasil', 'Philodendron hederaceum "Brasil"', 'vine', '🍃'],
  ['Philodendron Birkin', 'Philodendron "Birkin"', 'tropical'],
  ['Philodendron Pink Princess', 'Philodendron erubescens', 'tropical'],
  ['Philodendron Micans', 'Philodendron hederaceum var. hederaceum', 'vine', '🍃'],
  ['Philodendron Selloum', 'Thaumatophyllum bipinnatifidum', 'tropical'],
  ['Golden pothos', 'Epipremnum aureum', 'vine', '🍃'],
  ['Marble Queen pothos', 'Epipremnum aureum "Marble Queen"', 'vine', '🍃'],
  ['Neon pothos', 'Epipremnum aureum "Neon"', 'vine', '🍃'],
  ['Jade pothos', 'Epipremnum aureum "Jade"', 'vine', '🍃'],
  ['Satin pothos', 'Scindapsus pictus', 'vine', '🍃'],
  ['Peace lily', 'Spathiphyllum wallisii', 'tropical', '🌸'],
  ['Chinese evergreen', 'Aglaonema commutatum', 'tropical'],
  ['Aglaonema Red Siam', 'Aglaonema "Siam Aurora"', 'tropical'],
  ['Dumb cane', 'Dieffenbachia seguine', 'tropical'],
  ['Arrowhead plant', 'Syngonium podophyllum', 'vine', '🍃'],
  ['ZZ plant', 'Zamioculcas zamiifolia', 'tropical', '🌿'],
  ['Raven ZZ', 'Zamioculcas zamiifolia "Raven"', 'tropical'],
  ['Elephant ear', 'Alocasia amazonica', 'tropical'],
  ['Alocasia Polly', 'Alocasia × amazonica "Polly"', 'tropical'],
  ['Alocasia Zebrina', 'Alocasia zebrina', 'tropical'],
  ['Giant taro', 'Alocasia macrorrhizos', 'tropical'],
  ['Colocasia', 'Colocasia esculenta', 'tropical'],
  ['Caladium', 'Caladium bicolor', 'tropical', '🌸'],
  ['Calathea Orbifolia', 'Calathea orbifolia', 'tropical', '🪴'],
  ['Calathea Medallion', 'Goeppertia veitchiana', 'tropical', '🪴'],
  ['Rattlesnake plant', 'Goeppertia insignis', 'tropical', '🪴'],
  ['Calathea Zebrina', 'Goeppertia zebrina', 'tropical', '🪴'],
  ['Peacock plant', 'Goeppertia makoyana', 'tropical', '🪴'],
  ['Prayer plant', 'Maranta leuconeura', 'tropical', '🪴'],
  ['Stromanthe Triostar', 'Stromanthe sanguinea', 'tropical'],
  ['Ctenanthe', 'Ctenanthe burle-marxii', 'tropical'],
  ['Nerve plant', 'Fittonia albivenis', 'tropical'],
  ['Polka dot plant', 'Hypoestes phyllostachya', 'tropical'],
  ['Aluminum plant', 'Pilea cadierei', 'tropical'],
  ['Chinese money plant', 'Pilea peperomioides', 'tropical'],
  ['Baby tears', 'Soleirolia soleirolii', 'tropical'],
  ['Watermelon peperomia', 'Peperomia argyreia', 'tropical'],
  ['Peperomia Obtusifolia', 'Peperomia obtusifolia', 'tropical'],
  ['Ripple peperomia', 'Peperomia caperata', 'tropical'],
  ['String of turtles', 'Peperomia prostrata', 'vine', '🍃'],
  ['Cast iron plant', 'Aspidistra elatior', 'tropical'],
  ['Ti plant', 'Cordyline fruticosa', 'tropical'],
  ['Croton', 'Codiaeum variegatum', 'tropical'],
  ['Coleus', 'Coleus scutellarioides', 'flowering'],
  ['Anthurium', 'Anthurium andraeanum', 'tropical', '🌸'],
  ['Bird of paradise', 'Strelitzia reginae', 'tropical', '🌸'],
  ['White bird of paradise', 'Strelitzia nicolai', 'tropical'],
  ['Banana plant', 'Musa acuminata', 'tropical'],
  ['Ornamental banana', 'Musa "Dwarf Cavendish"', 'tropical'],
  ['Ginger', 'Zingiber officinale', 'tropical'],
  ['Bromeliad', 'Guzmania lingulata', 'tropical', '🌸'],
  ['Aechmea', 'Aechmea fasciata', 'tropical', '🌸'],
  ['Neoregelia', 'Neoregelia carolinae', 'tropical'],
  ['Air plant', 'Tillandsia ionantha', 'tropical'],
  ['Tillandsia Xerographica', 'Tillandsia xerographica', 'tropical'],

  // ── Ferns ──
  ['Boston fern', 'Nephrolepis exaltata', 'fern', '🌱'],
  ['Kimberly Queen fern', 'Nephrolepis obliterata', 'fern', '🌱'],
  ['Bird’s nest fern', 'Asplenium nidus', 'fern', '🌱'],
  ['Staghorn fern', 'Platycerium bifurcatum', 'fern'],
  ['Maidenhair fern', 'Adiantum raddianum', 'fern'],
  ['Rabbit’s foot fern', 'Davallia fejeensis', 'fern'],
  ['Blue star fern', 'Phlebodium aureum', 'fern'],
  ['Button fern', 'Pellaea rotundifolia', 'fern'],
  ['Autumn fern', 'Dryopteris erythrosora', 'fern'],
  ['Asparagus fern', 'Asparagus setaceus', 'fern'],
  ['Foxtail fern', 'Asparagus densiflorus', 'fern'],
  ['Lemon button fern', 'Nephrolepis cordifolia', 'fern', '🌱'],

  // ── Palms ──
  ['Areca palm', 'Dypsis lutescens', 'palm', '🌴'],
  ['Parlor palm', 'Chamaedorea elegans', 'palm', '🌴'],
  ['Kentia palm', 'Howea forsteriana', 'palm', '🌴'],
  ['Majesty palm', 'Ravenea rivularis', 'palm', '🌴'],
  ['Ponytail palm', 'Beaucarnea recurvata', 'succulent'],
  ['Cat palm', 'Chamaedorea cataractarum', 'palm', '🌴'],
  ['Sago palm', 'Cycas revoluta', 'palm', '🌴'],
  ['Fishtail palm', 'Caryota mitis', 'palm', '🌴'],
  ['Lady palm', 'Rhapis excelsa', 'palm', '🌴'],
  ['Chinese fan palm', 'Livistona chinensis', 'palm', '🌴'],

  // ── Dracaena / snake / spider ──
  ['Snake plant', 'Dracaena trifasciata', 'succulent', '🌵'],
  ['Snake plant Laurentii', 'Dracaena trifasciata "Laurentii"', 'succulent', '🌵'],
  ['Cylindrical snake plant', 'Dracaena angolensis', 'succulent', '🌵'],
  ['Dragon tree', 'Dracaena marginata', 'tree'],
  ['Corn plant', 'Dracaena fragrans', 'tree'],
  ['Janet Craig', 'Dracaena deremensis "Janet Craig"', 'tropical'],
  ['Lucky bamboo', 'Dracaena sanderiana', 'grass', '🎋'],
  ['Spider plant', 'Chlorophytum comosum', 'grass', '🌿'],
  ['Spider plant Bonnie', 'Chlorophytum comosum "Bonnie"', 'grass', '🌿'],

  // ── Figs / trees ──
  ['Fiddle-leaf fig', 'Ficus lyrata', 'tree', '🌳'],
  ['Rubber plant', 'Ficus elastica', 'tree', '🌳'],
  ['Rubber plant Tineke', 'Ficus elastica "Tineke"', 'tree', '🌳'],
  ['Weeping fig', 'Ficus benjamina', 'tree', '🌳'],
  ['Ficus Audrey', 'Ficus benghalensis', 'tree', '🌳'],
  ['Creeping fig', 'Ficus pumila', 'vine', '🍃'],
  ['Umbrella tree', 'Schefflera actinophylla', 'tree'],
  ['Dwarf umbrella tree', 'Schefflera arboricola', 'tree'],
  ['Money tree', 'Pachira aquatica', 'tree', '🌳'],
  ['Norfolk Island pine', 'Araucaria heterophylla', 'tree', '🌲'],
  ['Guiana chestnut', 'Pachira glabra', 'tree', '🌳'],
  ['Jade plant', 'Crassula ovata', 'succulent'],
  ['Olive tree', 'Olea europaea', 'tree', '🫒'],
  ['Meyer lemon', 'Citrus × meyeri', 'tree', '🍋'],
  ['Calamondin orange', 'Citrus × microcarpa', 'tree', '🍊'],
  ['Kaffir lime', 'Citrus hystrix', 'tree'],
  ['Coffee plant', 'Coffea arabica', 'tree'],
  ['Avocado', 'Persea americana', 'tree', '🥑'],

  // ── Succulents ──
  ['Aloe vera', 'Aloe vera', 'succulent'],
  ['Haworthia', 'Haworthiopsis attenuata', 'succulent'],
  ['Zebra haworthia', 'Haworthiopsis fasciata', 'succulent'],
  ['Echeveria', 'Echeveria elegans', 'succulent'],
  ['Echeveria Lola', 'Echeveria "Lola"', 'succulent'],
  ['Ghost plant', 'Graptopetalum paraguayense', 'succulent'],
  ['Panda plant', 'Kalanchoe tomentosa', 'succulent'],
  ['Flaming Katy', 'Kalanchoe blossfeldiana', 'flowering', '🌸'],
  ['Burro’s tail', 'Sedum morganianum', 'succulent'],
  ['Jelly bean plant', 'Sedum rubrotinctum', 'succulent'],
  ['String of pearls', 'Curio rowleyanus', 'vine', '🍃'],
  ['String of bananas', 'Curio radicans', 'vine', '🍃'],
  ['String of hearts', 'Ceropegia woodii', 'vine', '🍃'],
  ['String of dolphins', 'Curio × peregrinus', 'vine', '🍃'],
  ['Hens and chicks', 'Sempervivum tectorum', 'succulent'],
  ['Aeonium', 'Aeonium arboreum', 'succulent'],
  ['Crown of thorns', 'Euphorbia milii', 'succulent', '🌸'],
  ['Pencil cactus', 'Euphorbia tirucalli', 'succulent'],
  ['African milk tree', 'Euphorbia trigona', 'succulent'],
  ['Lithops', 'Lithops spp.', 'succulent'],
  ['Snake gourd agave', 'Agave attenuata', 'succulent'],
  ['Century plant', 'Agave americana', 'succulent'],
  ['Elephant bush', 'Portulacaria afra', 'succulent'],
  ['Christmas cactus', 'Schlumbergera bridgesii', 'succulent', '🌸'],
  ['Thanksgiving cactus', 'Schlumbergera truncata', 'succulent', '🌸'],

  // ── Cacti ──
  ['Bunny ears cactus', 'Opuntia microdasys', 'cactus', '🌵'],
  ['Golden barrel cactus', 'Echinocactus grusonii', 'cactus', '🌵'],
  ['Old lady cactus', 'Mammillaria hahniana', 'cactus', '🌵'],
  ['Fairy castle cactus', 'Acanthocereus tetragonus', 'cactus', '🌵'],
  ['Moon cactus', 'Gymnocalycium mihanovichii', 'cactus', '🌵'],
  ['San Pedro cactus', 'Echinopsis pachanoi', 'cactus', '🌵'],
  ['Prickly pear', 'Opuntia ficus-indica', 'cactus', '🌵'],
  ['Star cactus', 'Astrophytum asterias', 'cactus', '🌵'],
  ['Rat tail cactus', 'Disocactus flagelliformis', 'cactus', '🌵'],
  ['Fishbone cactus', 'Disocactus anguliger', 'cactus', '🌵'],

  // ── Vines / trailing ──
  ['English ivy', 'Hedera helix', 'vine', '🍃'],
  ['Swedish ivy', 'Plectranthus verticillatus', 'vine', '🍃'],
  ['Grape ivy', 'Cissus rhombifolia', 'vine', '🍃'],
  ['Wandering jew', 'Tradescantia zebrina', 'vine', '🍃'],
  ['Tradescantia Nanouk', 'Tradescantia albiflora "Nanouk"', 'vine', '🍃'],
  ['Purple heart', 'Tradescantia pallida', 'vine', '🍃'],
  ['Hoya', 'Hoya carnosa', 'vine', '🍃'],
  ['Hoya Kerrii', 'Hoya kerrii', 'succulent'],
  ['Wax plant', 'Hoya pubicalyx', 'vine', '🍃'],
  ['Passionflower', 'Passiflora caerulea', 'vine', '🌸'],
  ['Bougainvillea', 'Bougainvillea glabra', 'vine', '🌸'],
  ['Mandevilla', 'Mandevilla sanderi', 'vine', '🌸'],
  ['Morning glory', 'Ipomoea purpurea', 'vine', '🌸'],
  ['Jasmine', 'Jasminum polyanthum', 'vine', '🌸'],
  ['Clematis', 'Clematis "Jackmanii"', 'vine', '🌸'],

  // ── Herbs ──
  ['Basil', 'Ocimum basilicum', 'herb', '🌿'],
  ['Thai basil', 'Ocimum basilicum var. thyrsiflora', 'herb', '🌿'],
  ['Rosemary', 'Salvia rosmarinus', 'herb', '🌿'],
  ['Thyme', 'Thymus vulgaris', 'herb', '🌿'],
  ['Oregano', 'Origanum vulgare', 'herb', '🌿'],
  ['Mint', 'Mentha spicata', 'herb', '🌿'],
  ['Peppermint', 'Mentha × piperita', 'herb', '🌿'],
  ['Parsley', 'Petroselinum crispum', 'herb', '🌿'],
  ['Cilantro', 'Coriandrum sativum', 'herb', '🌿'],
  ['Dill', 'Anethum graveolens', 'herb', '🌿'],
  ['Chives', 'Allium schoenoprasum', 'herb', '🌿'],
  ['Sage', 'Salvia officinalis', 'herb', '🌿'],
  ['Lavender', 'Lavandula angustifolia', 'herb', '💜'],
  ['Lemongrass', 'Cymbopogon citratus', 'grass', '🌿'],
  ['Lemon balm', 'Melissa officinalis', 'herb', '🌿'],
  ['Tarragon', 'Artemisia dracunculus', 'herb', '🌿'],
  ['Marjoram', 'Origanum majorana', 'herb', '🌿'],
  ['Fennel', 'Foeniculum vulgare', 'herb', '🌿'],
  ['Catnip', 'Nepeta cataria', 'herb', '🌿'],
  ['Stevia', 'Stevia rebaudiana', 'herb', '🌿'],

  // ── Vegetables & fruit ──
  ['Cherry tomato', 'Solanum lycopersicum', 'vegetable', '🍅'],
  ['Beefsteak tomato', 'Solanum lycopersicum "Beefsteak"', 'vegetable', '🍅'],
  ['Bell pepper', 'Capsicum annuum', 'vegetable', '🫑'],
  ['Chili pepper', 'Capsicum frutescens', 'vegetable', '🌶️'],
  ['Jalapeño', 'Capsicum annuum "Jalapeño"', 'vegetable', '🌶️'],
  ['Cucumber', 'Cucumis sativus', 'vegetable', '🥒'],
  ['Lettuce', 'Lactuca sativa', 'vegetable', '🥬'],
  ['Spinach', 'Spinacia oleracea', 'vegetable', '🥬'],
  ['Kale', 'Brassica oleracea', 'vegetable', '🥬'],
  ['Arugula', 'Eruca vesicaria', 'vegetable', '🥬'],
  ['Swiss chard', 'Beta vulgaris', 'vegetable', '🥬'],
  ['Green beans', 'Phaseolus vulgaris', 'vegetable', '🫛'],
  ['Pea', 'Pisum sativum', 'vegetable', '🫛'],
  ['Radish', 'Raphanus sativus', 'vegetable'],
  ['Carrot', 'Daucus carota', 'vegetable', '🥕'],
  ['Strawberry', 'Fragaria × ananassa', 'flowering', '🍓'],
  ['Blueberry', 'Vaccinium corymbosum', 'flowering', '🫐'],
  ['Eggplant', 'Solanum melongena', 'vegetable', '🍆'],
  ['Zucchini', 'Cucurbita pepo', 'vegetable'],
  ['Green onion', 'Allium fistulosum', 'vegetable'],

  // ── Flowering / bloomers ──
  ['African violet', 'Saintpaulia ionantha', 'flowering', '🌸'],
  ['Geranium', 'Pelargonium × hortorum', 'flowering', '🌸'],
  ['Begonia', 'Begonia × semperflorens', 'flowering', '🌸'],
  ['Rex begonia', 'Begonia rex', 'flowering'],
  ['Gerbera daisy', 'Gerbera jamesonii', 'flowering', '🌼'],
  ['Chrysanthemum', 'Chrysanthemum morifolium', 'flowering', '🌼'],
  ['Cyclamen', 'Cyclamen persicum', 'flowering', '🌸'],
  ['Kalanchoe', 'Kalanchoe blossfeldiana', 'flowering', '🌸'],
  ['Hibiscus', 'Hibiscus rosa-sinensis', 'flowering', '🌺'],
  ['Gardenia', 'Gardenia jasminoides', 'flowering', '🌼'],
  ['Camellia', 'Camellia japonica', 'flowering', '🌸'],
  ['Azalea', 'Rhododendron simsii', 'flowering', '🌸'],
  ['Poinsettia', 'Euphorbia pulcherrima', 'flowering', '🌺'],
  ['Amaryllis', 'Hippeastrum spp.', 'flowering', '🌷'],
  ['Anthurium Clarinervium', 'Anthurium clarinervium', 'tropical'],
  ['Peony', 'Paeonia lactiflora', 'flowering', '🌸'],
  ['Rose', 'Rosa spp.', 'flowering', '🌹'],
  ['Tulip', 'Tulipa gesneriana', 'flowering', '🌷'],
  ['Daffodil', 'Narcissus pseudonarcissus', 'flowering', '🌼'],
  ['Marigold', 'Tagetes erecta', 'flowering', '🌼'],
  ['Petunia', 'Petunia × atkinsiana', 'flowering', '🌸'],
  ['Sunflower', 'Helianthus annuus', 'flowering', '🌻'],
  ['Lily', 'Lilium spp.', 'flowering', '🌷'],
  ['Dahlia', 'Dahlia pinnata', 'flowering', '🌸'],
  ['Zinnia', 'Zinnia elegans', 'flowering', '🌸'],
  ['Pansy', 'Viola × wittrockiana', 'flowering', '🌸'],
  ['Impatiens', 'Impatiens walleriana', 'flowering', '🌸'],
  ['Fuchsia', 'Fuchsia × hybrida', 'flowering', '🌸'],
  ['Lantana', 'Lantana camara', 'flowering', '🌸'],

  // ── Orchids ──
  ['Moth orchid', 'Phalaenopsis amabilis', 'orchid', '🌸'],
  ['Dendrobium orchid', 'Dendrobium nobile', 'orchid', '🌸'],
  ['Cattleya orchid', 'Cattleya labiata', 'orchid', '🌸'],
  ['Oncidium orchid', 'Oncidium altissimum', 'orchid', '🌸'],
  ['Cymbidium orchid', 'Cymbidium spp.', 'orchid', '🌸'],
  ['Lady slipper orchid', 'Paphiopedilum spp.', 'orchid', '🌸'],
  ['Vanda orchid', 'Vanda coerulea', 'orchid', '🌸'],
  ['Jewel orchid', 'Ludisia discolor', 'orchid'],

  // ── Grasses / bamboo ──
  ['Lucky bamboo grove', 'Dracaena braunii', 'grass', '🎋'],
  ['Golden bamboo', 'Phyllostachys aurea', 'grass', '🎋'],
  ['Fountain grass', 'Pennisetum setaceum', 'grass'],
  ['Papyrus', 'Cyperus papyrus', 'grass'],
  ['Umbrella sedge', 'Cyperus alternifolius', 'grass'],
  ['Mondo grass', 'Ophiopogon japonicus', 'grass'],
  ['Blue fescue', 'Festuca glauca', 'grass'],

  // ── Carnivorous ──
  ['Venus flytrap', 'Dionaea muscipula', 'carnivorous', '🪰'],
  ['Pitcher plant', 'Sarracenia purpurea', 'carnivorous', '🪰'],
  ['Sundew', 'Drosera capensis', 'carnivorous', '🪰'],
  ['Tropical pitcher', 'Nepenthes spp.', 'carnivorous', '🪰'],
  ['Butterwort', 'Pinguicula spp.', 'carnivorous', '🪰'],
];

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
  if (!common) return undefined;
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
