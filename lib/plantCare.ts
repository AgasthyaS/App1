import { getSpecies, type CategoryKey } from './plants';

/**
 * Deep care facts, keyed by plant category (hundreds of species map to these).
 * Powers the on-screen care guide and feeds notifications/diagnosis with the
 * signs to watch for. Concise, horticulturally accurate defaults.
 */
export interface CareGuide {
  overwatering: string;
  underwatering: string;
  tooMuchLight: string;
  tooLittleLight: string;
  fertilizer: string;
  dormancy: string;
  growth: string;
  pests: string;
  potting: string;
}

const CARE: Record<CategoryKey, CareGuide> = {
  tropical: {
    overwatering: 'Yellowing lower leaves, mushy stems, fungus gnats, or a sour soil smell.',
    underwatering: 'Drooping, crispy leaf edges, and soil pulling away from the pot.',
    tooMuchLight: 'Pale, bleached patches and scorched brown spots.',
    tooLittleLight: 'Leggy growth, small new leaves, few fenestrations.',
    fertilizer: 'Balanced feed monthly in spring–summer; skip in winter.',
    dormancy: 'Growth slows in winter — water less, hold fertilizer.',
    growth: 'Fast in warm months; several new leaves a season.',
    pests: 'Spider mites, thrips, mealybugs, fungus gnats.',
    potting: 'Chunky, airy aroid mix; pot up one size when roots circle.',
  },
  fern: {
    overwatering: 'Blackened crown and rotting fronds if it stays soggy.',
    underwatering: 'Crispy, browning fronds — ferns hate drying out.',
    tooMuchLight: 'Faded, scorched fronds in direct sun.',
    tooLittleLight: 'Sparse, slow growth in deep shade.',
    fertilizer: 'Weak balanced feed monthly during growth.',
    dormancy: 'Slows in winter; keep evenly moist, feed less.',
    growth: 'Moderate; humidity drives new fronds.',
    pests: 'Scale, mealybugs, fungus gnats.',
    potting: 'Rich, moisture-retentive mix; keep slightly root-bound.',
  },
  palm: {
    overwatering: 'Yellow-brown fronds from the base, black roots.',
    underwatering: 'Brown, crispy frond tips and folding leaflets.',
    tooMuchLight: 'Scorched, yellowing fronds in harsh sun.',
    tooLittleLight: 'Weak, stretched growth and dropped lower fronds.',
    fertilizer: 'Palm fertilizer (with magnesium) 2–3× in the growing season.',
    dormancy: 'Minimal in winter; ease off water and feed.',
    growth: 'Slow to moderate; steady new fronds.',
    pests: 'Spider mites and scale, especially in dry air.',
    potting: 'Free-draining mix; palms like being snug in the pot.',
  },
  succulent: {
    overwatering: 'Translucent, mushy, dropping leaves — the top killer.',
    underwatering: 'Wrinkled, shriveled, softening leaves (recovers fast).',
    tooMuchLight: 'Rare, but sudden full sun can scorch — acclimate slowly.',
    tooLittleLight: 'Stretching (etiolation) and pale, spaced-out leaves.',
    fertilizer: 'Dilute cactus feed 2–3× in spring–summer only.',
    dormancy: 'Many rest in summer or winter — water sparingly then.',
    growth: 'Slow; compact rosettes when light is strong.',
    pests: 'Mealybugs (in leaf axils) and root mealybugs.',
    potting: 'Gritty, fast-draining mix; unglazed pot with drainage.',
  },
  cactus: {
    overwatering: 'Soft, brown mush at the base — rot spreads fast.',
    underwatering: 'Puckering, shrinking, dull skin (very tolerant).',
    tooMuchLight: 'Reddish/yellow stress color; acclimate to full sun.',
    tooLittleLight: 'Thin, pale, stretched new growth reaching for light.',
    fertilizer: 'Low-nitrogen cactus feed a couple times in summer.',
    dormancy: 'Cool, dry winter rest encourages spring flowers.',
    growth: 'Slow; needs bright light to stay compact.',
    pests: 'Mealybugs and scale.',
    potting: 'Very gritty mineral mix; terracotta with a drainage hole.',
  },
  vine: {
    overwatering: 'Yellowing leaves and black, mushy stems near the soil.',
    underwatering: 'Curling, crispy leaves and limp vines.',
    tooMuchLight: 'Washed-out, scorched leaves.',
    tooLittleLight: 'Long gaps between leaves and loss of variegation.',
    fertilizer: 'Balanced feed monthly in spring–summer.',
    dormancy: 'Slows in winter — reduce water and feed.',
    growth: 'Fast; pinch tips to keep it full.',
    pests: 'Spider mites, mealybugs, aphids.',
    potting: 'Well-draining mix; give a moss pole or trellis to climb.',
  },
  tree: {
    overwatering: 'Dropping leaves (yellow or green) and dark, soft roots.',
    underwatering: 'Wilting, curling, then leaf drop; dry, tight soil.',
    tooMuchLight: 'Leaf scorch when moved abruptly into direct sun.',
    tooLittleLight: 'Leggy growth and heavy leaf drop indoors.',
    fertilizer: 'Balanced feed monthly spring–summer.',
    dormancy: 'Slows in winter; some drop leaves seasonally.',
    growth: 'Moderate; dislikes being moved (leaf drop).',
    pests: 'Scale, mealybugs, spider mites.',
    potting: 'Well-draining mix; repot every 1–2 years.',
  },
  herb: {
    overwatering: 'Yellowing, wilting despite wet soil; root rot.',
    underwatering: 'Fast wilting and crispy leaves — most herbs droop early.',
    tooMuchLight: 'Rarely a problem — most herbs love sun.',
    tooLittleLight: 'Leggy, pale, weak-flavored growth.',
    fertilizer: 'Light feeding; too much cuts flavor.',
    dormancy: 'Many are annual or slow in winter.',
    growth: 'Fast; pinch/harvest often to stay bushy.',
    pests: 'Aphids, whitefly, spider mites.',
    potting: 'Free-draining mix; plenty of direct light.',
  },
  vegetable: {
    overwatering: 'Yellowing, wilting, and split or rotting fruit.',
    underwatering: 'Wilting, blossom drop, bitter or small produce.',
    tooMuchLight: 'Usually welcome; watch for sunscald on fruit.',
    tooLittleLight: 'Few flowers/fruit and stretched stems.',
    fertilizer: 'Regular feeding; switch to higher-potassium when fruiting.',
    dormancy: 'Mostly seasonal annuals.',
    growth: 'Fast; needs strong light and steady moisture.',
    pests: 'Aphids, whitefly, caterpillars, spider mites.',
    potting: 'Rich, moisture-retentive mix; large pot for roots.',
  },
  flowering: {
    overwatering: 'Bud drop, yellowing, and rot at the base.',
    underwatering: 'Wilting and dropped buds/flowers.',
    tooMuchLight: 'Scorched petals and faded leaves in harsh sun.',
    tooLittleLight: 'Few or no blooms and leggy growth.',
    fertilizer: 'Bloom feed (higher phosphorus) during budding.',
    dormancy: 'Many rest after flowering — ease water and feed.',
    growth: 'Moderate; light drives flowering.',
    pests: 'Aphids, thrips, spider mites.',
    potting: 'Well-draining mix; deadhead spent blooms.',
  },
  orchid: {
    overwatering: 'Yellow, limp leaves and brown, mushy roots — #1 killer.',
    underwatering: 'Wrinkled leaves and silvery, shriveled roots.',
    tooMuchLight: 'Yellow-green or reddened, scorched leaves.',
    tooLittleLight: 'Dark green leaves but no flower spikes.',
    fertilizer: 'Weak orchid feed weekly, "weakly" — flush monthly.',
    dormancy: 'A cool, drier rest can trigger a new spike.',
    growth: 'Slow; blooms on a seasonal cycle.',
    pests: 'Mealybugs, scale, spider mites.',
    potting: 'Bark or moss in a pot with lots of drainage/airflow.',
  },
  grass: {
    overwatering: 'Yellowing, mushy bases and rot.',
    underwatering: 'Brown, crispy tips and curling blades.',
    tooMuchLight: 'Bleaching in intense midday sun.',
    tooLittleLight: 'Floppy, pale, stretched growth.',
    fertilizer: 'Light balanced feed in the growing season.',
    dormancy: 'Many go dormant/brown in winter, then rebound.',
    growth: 'Fast in season; divide clumps as they spread.',
    pests: 'Generally pest-resistant; watch for aphids.',
    potting: 'Standard mix; keep evenly moist.',
  },
  carnivorous: {
    overwatering: 'Prefers to sit wet — but stagnant, mineral water rots roots.',
    underwatering: 'Traps blacken and dry; peat must stay damp.',
    tooMuchLight: 'Usually wants lots of light; slow acclimation to full sun.',
    tooLittleLight: 'Weak, pale traps that fail to color up.',
    fertilizer: 'Never fertilize the soil — they feed by catching insects.',
    dormancy: 'Temperate types need a cold winter dormancy.',
    growth: 'Moderate; strong light makes vivid traps.',
    pests: 'Aphids and fungus gnats (which they may catch).',
    potting: 'Nutrient-free peat/sand; only rain or distilled water.',
  },
};

export function careFor(speciesCommon: string): CareGuide | null {
  const s = getSpecies(speciesCommon);
  return s ? CARE[s.category] : null;
}
