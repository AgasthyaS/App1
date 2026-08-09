import { getSpecies, type CategoryKey, type Drainage } from './plants';
import type { SoilMix } from './types';

/**
 * WHAT TO POT THIS PLANT IN — the substrate recommendation.
 *
 * Repotting is the one care decision that is both irreversible for a year and
 * almost impossible to correct afterwards. Everything else the app measures is a
 * knob you can turn tomorrow: water less, move it to a brighter shelf, raise the
 * humidity. The mix in the pot is fixed until you disturb the roots again, and it
 * silently sets the ceiling on how well every other decision can work — no
 * watering schedule can rescue a fern in pure grit or a cactus in wet peat.
 *
 * ────────────────────────── WHY NOT ONE MIX PER CATEGORY ─────────────────────────
 *
 * The obvious build is one recipe per category, and it is wrong in ways that kill
 * plants. Three examples straight out of this catalog:
 *
 *   • ELEVEN of the 38 species filed under `cactus` are JUNGLE cacti — Rhipsalis,
 *     Schlumbergera, Epiphyllum, Hatiora, Disocactus, Lepismium, Selenicereus.
 *     They are rainforest epiphytes that grow in leaf litter in tree forks. The
 *     desert-grit mix that is right for a Ferocactus dries them out and starves
 *     them. This is the single most common way a Christmas cactus is lost.
 *   • The 14 orchids sit in 14 different genera and genuinely want different
 *     media: Vanda in an empty basket, Phalaenopsis in medium bark, Paphiopedilum
 *     in a finer moisture-holding mix, and Ludisia — a jewel orchid — in actual
 *     potting compost, because it is terrestrial.
 *   • Of the 8 carnivores, six want the classic peat-and-sand bog mix, but
 *     Nepenthes is an epiphyte that rots in it, and Mexican Pinguicula want a
 *     MINERAL mix. "Carnivorous plant compost" applied to all eight kills two.
 *
 * ─────────────────────────────── SO: THREE LAYERS ────────────────────────────────
 *
 * Same architecture the water curves use, for the same reason — it covers all
 * 1,212 species without inventing per-species precision that doesn't exist:
 *
 *   1. CATEGORY baseline — horticulturally correct for the group.
 *   2. GENUS refinement — keyed on the latin name, which is a far better
 *      predictor of substrate than the 15 broad categories, and covers whole
 *      swathes of the catalog at once (every Hoya is an epiphyte; every
 *      Rhododendron needs acid; every Citrus wants the same free-draining loam).
 *   3. SPECIES override — for individuals that differ from their own genus.
 *
 * `basis` reports which layer answered, so the UI can say "specific to this
 * species" or "typical for cacti" instead of implying the same confidence for
 * both. That is the §14 honesty rule applied to substrate.
 *
 * ───────────────────────── IT PLUGS INTO THE PHYSICS ─────────────────────────────
 *
 * Every recipe names the `SoilMix` bucket it belongs to, which is what
 * lib/soilProfile turns into a van Genuchten retention curve. So a recommendation
 * is not a paragraph of advice sitting next to the model — changing the mix moves
 * the perched water table, the drain time and the watering interval, and the app
 * can show those numbers before the user commits to anything.
 */

/** One ingredient, in parts by VOLUME (the only unit that survives a garden centre). */
export interface RecipeComponent {
  name: string;
  parts: number;
  /** what this ingredient is actually for — so a substitution can be reasoned about */
  role: string;
}

export type WaterQuality = 'tap' | 'low-mineral' | 'rain-only';

export interface SoilRecipe {
  /** short name for the mix, e.g. "Free-draining cactus grit" */
  headline: string;
  components: RecipeComponent[];
  /** which retention curve this behaves like — the link into lib/soilProfile */
  mix: SoilMix;
  ph: [number, number];
  phNote?: string;
  water: WaterQuality;
  drainage: Drainage;
  /** how often the mix itself needs replacing, plain language */
  repotEvery: string;
  bestTime: string;
  /** things that will actively harm this plant */
  avoid: string[];
  /** the habitat reason — why this mix and not another */
  why: string;
  /** optional extras worth adding, when they earn their place */
  amendments?: string[];
  /**
   * True when ORDINARY POTTING COMPOST is not merely suboptimal but harmful:
   * carnivores burned by its nutrients, epiphytes suffocated by its density.
   * The four retention buckets cannot express this — "Dense / heavy" describes
   * peat and cheap compost identically, yet one grows a flytrap and the other
   * kills it — so the danger is carried as its own flag rather than inferred.
   */
  compostIsHarmful?: boolean;
  /** which layer produced this: species / genus / category */
  basis: 'species' | 'genus' | 'category';
  /** the layer's label, for the UI ("Specific to Phalaenopsis") */
  basisNote: string;
}

type RecipePatch = Partial<Omit<SoilRecipe, 'basis' | 'basisNote'>>;

/* ────────────────────────────── SHARED INGREDIENTS ──────────────────────────────
 * Named once so a substitution is consistent everywhere and the roles never drift.
 */
const BARK = (parts: number): RecipeComponent => ({
  name: 'Orchid bark (fine–medium)', parts, role: 'Big air pockets that stay open for years',
});
const PERLITE = (parts: number): RecipeComponent => ({
  name: 'Perlite', parts, role: 'Drainage and air, without holding salts',
});
const PUMICE = (parts: number): RecipeComponent => ({
  name: 'Pumice or lava grit (3–6 mm)', parts, role: 'Sharp drainage that never compacts',
});
const COIR = (parts: number): RecipeComponent => ({
  name: 'Coco coir or peat-free compost', parts, role: 'Holds moisture and rewets easily',
});
const COMPOST = (parts: number): RecipeComponent => ({
  name: 'Peat-free multipurpose compost', parts, role: 'The body of the mix — water and nutrients',
});
const LOAM = (parts: number): RecipeComponent => ({
  name: 'Loam-based compost (John Innes No. 2–3)', parts, role: 'Weight, structure and a nutrient reserve',
});
const CASTINGS = (parts: number): RecipeComponent => ({
  name: 'Worm castings', parts, role: 'Slow, gentle nutrition that will not scorch roots',
});
const CHARCOAL = (parts: number): RecipeComponent => ({
  name: 'Horticultural charcoal', parts, role: 'Keeps the mix sweet and absorbs stagnation',
});
const SPHAGNUM = (parts: number): RecipeComponent => ({
  name: 'Long-fibre sphagnum moss', parts, role: 'Holds water and air at once; naturally acidic',
});
const PEAT = (parts: number): RecipeComponent => ({
  name: 'Sphagnum peat (no added fertiliser)', parts, role: 'The acidic, nutrient-free base bog plants need',
});
const SILICA = (parts: number): RecipeComponent => ({
  name: 'Silica sand or perlite', parts, role: 'Opens the peat up without adding minerals',
});
const GRIT = (parts: number): RecipeComponent => ({
  name: 'Horticultural grit (3–6 mm)', parts, role: 'Drainage and stability for top-heavy plants',
});
const ERICACEOUS = (parts: number): RecipeComponent => ({
  name: 'Ericaceous (acidic) compost', parts, role: 'Keeps pH low enough for iron to stay available',
});
const LEAFMOULD = (parts: number): RecipeComponent => ({
  name: 'Leaf mould or fine composted bark', parts, role: 'The woodland-floor humus these roots evolved in',
});

/* ─────────────────────────────── CATEGORY BASELINES ─────────────────────────────── */

const CATEGORY_RECIPE: Record<CategoryKey, Omit<SoilRecipe, 'basis' | 'basisNote'>> = {
  tropical: {
    headline: 'Chunky aroid mix',
    components: [BARK(2), COIR(2), PERLITE(2), CASTINGS(1), CHARCOAL(1)],
    mix: 'Chunky / aroid',
    ph: [5.5, 6.5],
    water: 'tap',
    drainage: 'Moderate',
    repotEvery: 'Refresh every 18–24 months; pot up a size only when roots circle the pot',
    bestTime: 'Spring, as new growth starts',
    avoid: ['Bagged compost straight from the bag — it compacts and suffocates thick aroid roots', 'Water-retaining gel crystals'],
    why: 'Most tropical foliage plants are aroids that root into loose leaf litter and up tree bark, not into soil. They need air around the roots as much as water, and a chunky mix gives both.',
    amendments: ['A handful of horticultural charcoal keeps a closed pot from going sour'],
  },
  fern: {
    headline: 'Moisture-retentive woodland mix',
    components: [COIR(3), LEAFMOULD(1), PERLITE(1)],
    mix: 'Standard mix',
    ph: [5.5, 6.5],
    water: 'low-mineral',
    drainage: 'Moisture-retentive',
    repotEvery: 'Every 2 years, or when the pot dries out noticeably faster than it used to',
    bestTime: 'Spring',
    avoid: ['Gritty or cactus mixes — a fern browns within days of drying out', 'Letting the mix dry hard; peat-based mixes are very difficult to rewet'],
    why: 'Ferns evolved on shaded forest floors in deep leaf litter that is permanently damp but never stagnant. The mix has to hold water without turning to mud.',
  },
  palm: {
    headline: 'Free-draining loam',
    components: [COMPOST(3), PERLITE(1), GRIT(1)],
    mix: 'Standard mix',
    ph: [6.0, 7.0],
    water: 'tap',
    drainage: 'Moderate',
    repotEvery: 'Every 2–3 years — palms resent root disturbance and prefer being slightly tight',
    bestTime: 'Late spring',
    avoid: ['Frequent repotting — palm roots are brittle and slow to recover', 'Burying the crown or trunk base any deeper than it sat before'],
    why: 'Palms want steady moisture at depth with free drainage above, which is what a loam-and-grit mix does naturally.',
  },
  succulent: {
    headline: 'Gritty succulent mix',
    components: [PUMICE(2), COMPOST(1), PERLITE(1)],
    mix: 'Gritty / cactus',
    ph: [6.0, 7.5],
    water: 'tap',
    drainage: 'Fast',
    repotEvery: 'Every 2–3 years; the mineral part does not break down, so it lasts',
    bestTime: 'Spring or early summer, into dry mix — wait a week before the first watering',
    avoid: ['Ordinary potting compost on its own — it stays wet for days and rots the stem at soil level', 'Fine builder\'s sand, which sets like concrete'],
    why: 'Succulents store their own water and evolved where rain drains away in minutes. Over half the mix should be mineral, so the roots are wet briefly and then dry.',
    amendments: ['Top-dress with 1 cm of gravel to keep the stem base dry — this alone prevents most collapse'],
  },
  cactus: {
    headline: 'Sharp desert-cactus mix',
    components: [PUMICE(3), COMPOST(1)],
    mix: 'Gritty / cactus',
    ph: [6.0, 7.5],
    water: 'tap',
    drainage: 'Fast',
    repotEvery: 'Every 3–4 years',
    bestTime: 'Spring, into dry mix — do not water for 7–10 days afterwards',
    avoid: ['Any mix that stays damp more than a day or two', 'Watering straight after repotting — cut roots rot before they heal'],
    why: 'Desert cacti root in coarse mineral scree. Three parts grit to one of compost reproduces it; anything richer holds water against the roots long enough to rot them.',
    amendments: ['A gravel top-dressing keeps the vulnerable base dry and stops soil splashing onto the body'],
  },
  vine: {
    headline: 'Airy climbing-aroid mix',
    components: [COIR(3), PERLITE(2), BARK(1), CASTINGS(1)],
    mix: 'Chunky / aroid',
    ph: [5.5, 6.5],
    water: 'tap',
    drainage: 'Moderate',
    repotEvery: 'Every 18–24 months',
    bestTime: 'Spring',
    avoid: ['Dense compost, which rots the fine aerial-type roots these climbers make'],
    why: 'Trailing and climbing tropicals root shallowly into loose litter and moss, so they want a light mix that drains fast but never dries to dust.',
  },
  tree: {
    headline: 'Loam-based tree mix',
    components: [LOAM(3), COMPOST(1), GRIT(1)],
    mix: 'Standard mix',
    ph: [6.0, 7.0],
    water: 'tap',
    drainage: 'Moderate',
    repotEvery: 'Every 2–3 years while young; then top-dress instead of repotting',
    bestTime: 'Early spring, before growth starts',
    avoid: ['Light peat-based mixes alone — a tree in a tall pot becomes top-heavy and blows over', 'Burying the trunk flare below the soil line'],
    why: 'A woody plant needs a mix with real body: loam holds nutrients and weight, and the grit stops it packing down under years of watering.',
  },
  herb: {
    headline: 'Lean, free-draining herb mix',
    components: [COMPOST(3), GRIT(1), PERLITE(1)],
    mix: 'Standard mix',
    ph: [6.0, 7.5],
    water: 'tap',
    drainage: 'Fast',
    repotEvery: 'Annually — most culinary herbs are treated as short-lived anyway',
    bestTime: 'Spring',
    avoid: ['Rich, heavily fed compost — it produces soft, watery growth with far less flavour', 'Sitting in a saucer of water'],
    why: 'The Mediterranean herbs (rosemary, thyme, oregano, sage) evolved on poor, stony hillsides. Lean and sharp-draining gives tougher growth and much stronger essential oils.',
  },
  vegetable: {
    headline: 'Rich, moisture-holding vegetable compost',
    components: [COMPOST(4), CASTINGS(1), PERLITE(1)],
    mix: 'Standard mix',
    ph: [6.0, 7.0],
    water: 'tap',
    drainage: 'Moisture-retentive',
    repotEvery: 'Fresh mix every crop — vegetables strip a container in one season',
    bestTime: 'At sowing or planting out',
    avoid: ['Reusing spent compost without refreshing it', 'Letting a fruiting crop dry out and re-wet repeatedly — that is what splits tomatoes and gives blossom-end rot'],
    why: 'Fast-growing edibles move enormous amounts of water and nutrients. The mix has to hold both, and be fed on top of that.',
    amendments: ['A slow-release feed at planting, then liquid feed weekly once flowering starts'],
  },
  flowering: {
    headline: 'General-purpose flowering mix',
    components: [COMPOST(3), PERLITE(1), CASTINGS(1)],
    mix: 'Standard mix',
    ph: [6.0, 7.0],
    water: 'tap',
    drainage: 'Moderate',
    repotEvery: 'Every 1–2 years',
    bestTime: 'After flowering finishes, or in spring',
    avoid: ['Repotting in full bud — many plants drop the lot'],
    why: 'Flowering needs steady moisture and steady feeding; a standard mix opened up with perlite gives both without going soggy.',
  },
  orchid: {
    headline: 'Bark — not soil',
    components: [BARK(4), PERLITE(1), CHARCOAL(1)],
    mix: 'Chunky / aroid',
    ph: [5.5, 6.5],
    water: 'low-mineral',
    drainage: 'Fast',
    repotEvery: 'Every 18–24 months — bark breaks down, and old sour bark is what actually kills orchids',
    bestTime: 'Straight after flowering, when new roots are just starting',
    avoid: ['Potting compost of any kind — it suffocates orchid roots within weeks', 'Leaving the plant standing in water'],
    why: 'Almost all cultivated orchids are epiphytes: in the wild their roots are clamped to bark in open air, wetted by rain and dry within the hour. Bark is the closest thing in a pot.',
    compostIsHarmful: true,
  },
  grass: {
    headline: 'Free-draining loam',
    components: [LOAM(3), COMPOST(1), GRIT(1)],
    mix: 'Standard mix',
    ph: [6.0, 7.0],
    water: 'tap',
    drainage: 'Moderate',
    repotEvery: 'Every 2 years, dividing the clump at the same time',
    bestTime: 'Spring',
    avoid: ['Winter wet — most ornamental grasses die from sitting cold and soggy, not from cold itself'],
    why: 'Grasses root deeply and hard; they want a mix with structure that will not collapse into mud.',
  },
  carnivorous: {
    headline: 'Peat and sand bog mix — NO fertiliser',
    components: [PEAT(1), SILICA(1)],
    mix: 'Dense / heavy',
    ph: [3.5, 5.0],
    phNote: 'Strongly acidic and nutrient-free. This is the point, not a compromise.',
    water: 'rain-only',
    drainage: 'Moisture-retentive',
    repotEvery: 'Every 1–2 years — peat degrades and its acidity fades',
    bestTime: 'Late winter, at the end of dormancy',
    avoid: [
      'ANY fertiliser, compost, or manure — the minerals burn these roots and kill the plant',
      'Tap water and softened water; the dissolved salts accumulate and are fatal within a season',
      'Lime, dolomite, or anything sold as "pH balanced"',
    ],
    why: 'Carnivorous plants evolved in nutrient-poor acidic bogs; that is exactly why they eat insects. Ordinary compost is not food to them, it is poison.',
    amendments: ['Stand the pot in 1–2 cm of rainwater through the growing season'],
    compostIsHarmful: true,
  },
  shrub: {
    headline: 'Loam-based shrub mix',
    components: [LOAM(3), COMPOST(1), GRIT(1)],
    mix: 'Standard mix',
    ph: [6.0, 7.0],
    water: 'tap',
    drainage: 'Moderate',
    repotEvery: 'Every 2–3 years, or top-dress annually once the pot is full size',
    bestTime: 'Autumn or early spring, while dormant',
    avoid: ['Peat-only mixes in containers — they dry out irreversibly and blow over'],
    why: 'Shrubs are long-term container residents. Loam gives a nutrient reserve that lasts years and does not shrink away from the pot walls.',
  },
  bulb: {
    headline: 'Very free-draining bulb mix',
    components: [COMPOST(2), GRIT(1), PERLITE(1)],
    mix: 'Gritty / cactus',
    ph: [6.0, 7.0],
    water: 'tap',
    drainage: 'Fast',
    repotEvery: 'Refresh each year when the bulbs are lifted or go dormant',
    bestTime: 'At planting, while dormant',
    avoid: ['Wet mix during dormancy — that is how nearly every bulb is lost', 'Burying too shallow; most want two to three times their own depth of cover'],
    why: 'A bulb is a stored food reserve sitting in the soil doing nothing for months. Anything that holds water around it in that period rots it.',
  },
};

/* ─────────────────────────────── GENUS REFINEMENTS ───────────────────────────────
 *
 * Keyed on the first word of the latin name. This is where most of the real
 * accuracy lives: genus predicts root architecture and habitat far better than
 * the app's 15 categories, and one entry corrects every species under it.
 */
const GENUS_RECIPE: Record<string, RecipePatch> = {
  /* ── JUNGLE (EPIPHYTIC) CACTI — filed as `cactus`, but rainforest plants ──
   * The category mix would be actively wrong for these: they grow in leaf
   * litter caught in tree forks and shrivel in pure grit. */
  Rhipsalis: EPIPHYTIC_CACTUS(),
  Schlumbergera: EPIPHYTIC_CACTUS(),
  Hatiora: EPIPHYTIC_CACTUS(),
  Epiphyllum: EPIPHYTIC_CACTUS(),
  Disocactus: EPIPHYTIC_CACTUS(),
  Lepismium: EPIPHYTIC_CACTUS(),
  Selenicereus: EPIPHYTIC_CACTUS(),

  /* ── ORCHIDS, by genus — they genuinely differ ── */
  Phalaenopsis: {
    headline: 'Medium bark, open and loose',
    components: [BARK(4), SPHAGNUM(1), PERLITE(1), CHARCOAL(1)],
    why: 'Moth orchids climb tree trunks with thick roots that photosynthesise and must see air. Medium bark holds them without ever staying wet.',
    repotEvery: 'Every 18–24 months, straight after flowering — collapsed, soggy bark is the usual cause of sudden decline',
  },
  Vanda: {
    headline: 'No medium at all — an empty basket',
    components: [{ name: 'Open slatted basket (no compost)', parts: 1, role: 'The roots hang free in air, exactly as they do on a branch' }],
    mix: 'Chunky / aroid',
    drainage: 'Fast',
    why: 'Vandas hang from branches with metre-long bare aerial roots. Potting one in any medium rots it — they are watered by drenching the roots daily and letting them dry within the hour.',
    avoid: ['Potting it in bark or compost at all', 'Any medium that keeps the roots damp for more than an hour or two'],
    repotEvery: 'Only when the basket itself rots away',
  },
  Cattleya: {
    headline: 'Coarse bark, dried out hard between waterings',
    components: [BARK(5), CHARCOAL(1), PERLITE(1)],
    why: 'Cattleyas store water in thick pseudobulbs and grow on exposed branches. They want the coarsest bark of the common orchids and a genuine dry-out between drinks.',
  },
  Paphiopedilum: {
    headline: 'Fine bark with moisture held in',
    components: [BARK(3), SPHAGNUM(1), PERLITE(1), CHARCOAL(1)],
    drainage: 'Moderate',
    why: 'Slipper orchids are the exception among orchids: mostly terrestrial, growing in leaf litter on limestone. They have no pseudobulbs, so they must never dry out completely.',
    amendments: ['A small amount of crushed oyster shell or limestone chip suits the limestone-dwelling species'],
    ph: [6.5, 7.5],
  },
  Cymbidium: {
    headline: 'Fine bark with real compost in it',
    components: [BARK(3), COIR(1), PERLITE(1), LOAM(1)],
    drainage: 'Moderate',
    why: 'Cymbidiums are semi-terrestrial and far hungrier than epiphytic orchids — they want more body and more feeding than a Phalaenopsis would ever tolerate.',
  },
  Ludisia: {
    headline: 'Actual potting compost — this orchid is terrestrial',
    components: [COIR(3), PERLITE(1), LEAFMOULD(1)],
    mix: 'Standard mix',
    drainage: 'Moisture-retentive',
    why: 'Jewel orchids are grown for their velvet leaves and creep across the forest FLOOR, not up trees. Bark starves them; they want a damp, humus-rich mix.',
    avoid: ['Bark-based orchid compost, which is the standard mistake with this plant'],
    compostIsHarmful: false,
  },
  Bletilla: {
    headline: 'Ordinary garden compost — a hardy ground orchid',
    components: [COMPOST(3), LEAFMOULD(1), GRIT(1)],
    mix: 'Standard mix',
    drainage: 'Moderate',
    why: 'Bletilla is a hardy terrestrial orchid that grows like a perennial. It wants normal soil, not bark.',
    compostIsHarmful: false,
  },
  Spathoglottis: {
    headline: 'Terrestrial orchid mix',
    components: [COMPOST(2), BARK(1), PERLITE(1)],
    mix: 'Standard mix',
    drainage: 'Moderate',
    why: 'Ground orchids root into soil, so they need more body than a bark mix gives.',
    compostIsHarmful: false,
  },
  Miltoniopsis: {
    headline: 'Fine bark kept evenly damp',
    components: [BARK(3), SPHAGNUM(2), PERLITE(1)],
    drainage: 'Moderate',
    why: 'Cloud-forest orchids from cool, constantly humid mountains. Fine bark plus moss keeps them damp without drowning; they suffer badly from drying out.',
  },
  Oncidium: { components: [BARK(4), PERLITE(1), CHARCOAL(1)], why: 'Fine roots on exposed branches — medium-fine bark, dried out between waterings.' },
  Brassia: { components: [BARK(4), PERLITE(1), CHARCOAL(1)], why: 'Spider orchids want the same free-draining bark as Oncidium, their close relative.' },
  Dendrobium: {
    headline: 'Tight pot, coarse bark',
    components: [BARK(5), CHARCOAL(1)],
    why: 'Dendrobiums flower best when quite pot-bound in coarse, fast-drying bark, with a dry winter rest.',
  },
  Zygopetalum: { components: [BARK(3), COIR(1), PERLITE(1)], drainage: 'Moderate', why: 'Wants a little more moisture than a Cattleya, so bark with some coir in it.' },
  Epidendrum: { components: [BARK(4), PERLITE(1), CHARCOAL(1)], why: 'Reed-stem orchids are tough epiphytes; coarse bark and sharp drainage suit them.' },

  /* ── CARNIVOROUS PLANTS, by genus — the category mix kills two of them ── */
  Nepenthes: {
    headline: 'Airy epiphyte mix — NOT peat and sand',
    components: [SPHAGNUM(2), PERLITE(1), BARK(1)],
    mix: 'Chunky / aroid',
    drainage: 'Fast',
    ph: [4.5, 6.0],
    why: 'Tropical pitcher plants are climbing epiphytes, not bog plants. The dense peat-and-sand mix that suits a Venus flytrap waterlogs a Nepenthes and rots its roots.',
    avoid: ['The standard peat/sand carnivorous mix — it is too wet and too dense for this genus', 'Standing it in a tray of water, which is right for flytraps and wrong here', 'Any fertiliser in the soil'],
    amendments: ['Feed by dropping a diluted foliar feed into the pitchers, never into the mix'],
  },
  Pinguicula: {
    headline: 'Mineral mix — most butterworts are not bog plants',
    components: [PUMICE(2), SILICA(1), PEAT(1)],
    mix: 'Gritty / cactus',
    drainage: 'Fast',
    ph: [6.0, 7.5],
    why: 'The commonly sold Mexican butterworts grow on limestone cliffs, not in bogs. They want a gritty mineral mix and a genuinely dry winter rest — peat keeps them too wet and they rot.',
    avoid: ['Pure peat mixes', 'Keeping them wet through winter dormancy'],
  },
  Darlingtonia: {
    headline: 'Bog mix kept cool at the roots',
    components: [PEAT(1), SILICA(1), PUMICE(1)],
    why: 'The cobra lily grows in mountain seeps fed by cold running water. It needs the coolest, most open bog mix of any carnivore.',
    avoid: ['Warm, stagnant water at the roots — flush the pot through with cold rainwater in hot weather', 'Any fertiliser'],
  },
  Cephalotus: {
    headline: 'Open bog mix with extra grit',
    components: [PEAT(2), SILICA(1), PERLITE(1)],
    drainage: 'Moderate',
    why: 'Albany pitcher plants rot more easily than other carnivores — they want the bog mix opened up and never sodden.',
  },

  /* ── ERICACEOUS (ACID-LOVING) — pH is not a detail for these ── */
  Rhododendron: ERICACEOUS_MIX('Rhododendrons and azaleas cannot take up iron above about pH 6; in ordinary compost the new leaves go yellow between green veins and the plant slowly starves.'),
  Camellia: ERICACEOUS_MIX('Camellias need acid soil to take up iron, and set next year\'s buds in late summer — dryness then, not cold, is what makes the buds drop.'),
  Vaccinium: {
    ...ERICACEOUS_MIX('Blueberries need a genuinely acidic root run — pH 4.5–5.5 — or they yellow and refuse to crop.'),
    ph: [4.5, 5.5],
    amendments: ['Mulch with pine needles or composted bark to hold the pH down', 'Feed only with an ericaceous fertiliser'],
  },
  Pieris: ERICACEOUS_MIX('Pieris is a woodland ericaceous shrub and yellows badly in limy compost.'),
  Calluna: ERICACEOUS_MIX('Heathers want acidic, lean, sharply drained soil — rich compost makes them soft and short-lived.'),
  Erica: ERICACEOUS_MIX('Heaths want acidic, lean, sharply drained soil.'),
  Gardenia: {
    ...ERICACEOUS_MIX('Gardenias are notorious for yellowing leaves, and the cause is almost always alkaline compost or hard tap water locking up iron.'),
    water: 'low-mineral',
    avoid: ['Hard tap water — it raises the pH of the pot within weeks', 'Any compost containing lime'],
  },
  Hydrangea: {
    headline: 'Rich, moisture-holding compost — pH sets the flower colour',
    components: [COMPOST(3), LEAFMOULD(1), PERLITE(1)],
    mix: 'Standard mix',
    ph: [5.0, 6.5],
    phNote: 'On mophead and lacecap types, acidic soil (pH 5–5.5) gives BLUE flowers and alkaline (pH 6.5+) gives pink. White varieties stay white whatever you do.',
    drainage: 'Moisture-retentive',
    why: 'Hydrangeas drink hard — the name means "water vessel" — and wilt dramatically in any mix that dries out. Their flower colour is a live readout of the pH at their roots.',
    amendments: ['For blue flowers: ericaceous compost plus aluminium sulphate, and rainwater rather than tap'],
  },
  Magnolia: { ph: [5.5, 6.5], why: 'Magnolias have fleshy, shallow, easily damaged roots and prefer a slightly acidic, humus-rich mix that is never disturbed deeply.' },
  Aronia: ERICACEOUS_MIX('Chokeberries fruit best in acidic, moisture-retentive soil.'),
  Fothergilla: ERICACEOUS_MIX('An ericaceous woodland shrub — its autumn colour is much better in acid soil.'),
  Hamamelis: ERICACEOUS_MIX('Witch hazel wants neutral-to-acid, humus-rich, never-dry soil.'),
  Skimmia: ERICACEOUS_MIX('Skimmia yellows quickly in alkaline compost.'),

  /* ── EPIPHYTES AND SEMI-EPIPHYTES filed under other categories ── */
  Tillandsia: {
    headline: 'No growing medium whatsoever',
    components: [{ name: 'Nothing — mount on bark, cork, or leave loose', parts: 1, role: 'Air plants absorb everything through their leaves' }],
    mix: 'Gritty / cactus',
    drainage: 'Fast',
    water: 'low-mineral',
    repotEvery: 'Never — there is nothing to repot',
    bestTime: 'n/a',
    why: 'Air plants have no functional root system: the roots are anchors only, and every drop of water and scrap of nutrient is taken in through the leaves.',
    compostIsHarmful: true,
    avoid: ['Potting it in compost, which rots the base within weeks', 'Leaving water sitting in the crown after soaking — turn it upside down to drain'],
    amendments: ['Soak in rainwater for 20 minutes weekly, then shake out and dry within 4 hours'],
  },
  Platycerium: {
    headline: 'Mounted on bark, or in pure sphagnum',
    components: [SPHAGNUM(3), BARK(1)],
    mix: 'Chunky / aroid',
    drainage: 'Fast',
    why: 'Staghorn ferns are epiphytes that clasp tree trunks with a shield frond. They are happiest mounted on a board with a pad of moss behind them rather than potted at all.',
    compostIsHarmful: true,
    avoid: ['Ordinary compost, which rots the shield frond', 'Removing the brown shield frond — it is alive and doing its job'],
  },
  Hoya: {
    headline: 'Very chunky epiphyte mix',
    components: [BARK(2), PERLITE(2), COIR(1), CHARCOAL(1)],
    mix: 'Chunky / aroid',
    drainage: 'Fast',
    why: 'Hoyas are epiphytic climbers with thick waxy leaves that store water. They flower best kept pot-bound in a mix that is more air than soil.',
    compostIsHarmful: true,
    avoid: ['Repotting a Hoya that is flowering well — being tight in the pot is what triggers it', 'Dense compost, which rots the fine roots fast'],
    repotEvery: 'Rarely — every 3 years at most, and only when it is truly root-bound',
  },
  Rhipsalidopsis: EPIPHYTIC_CACTUS(),
  Aeschynanthus: { components: [BARK(2), COIR(2), PERLITE(2)], mix: 'Chunky / aroid', drainage: 'Fast', why: 'Lipstick plants are epiphytes and want a light, airy mix rather than compost.' },
  Bromelia: BROMELIAD(),
  Guzmania: BROMELIAD(),
  Vriesea: BROMELIAD(),
  Neoregelia: BROMELIAD(),
  Aechmea: BROMELIAD(),
  Ananas: BROMELIAD(),
  Billbergia: BROMELIAD(),

  /* ── SUCCULENTS THAT WANT EVEN LESS ORGANIC MATTER ── */
  Lithops: MESEMB(),
  Fenestraria: MESEMB(),
  Pleiospilos: MESEMB(),
  Conophytum: MESEMB(),
  Adenium: {
    headline: 'Very sharp mineral mix for a caudex',
    components: [PUMICE(3), COMPOST(1), GRIT(1)],
    drainage: 'Fast',
    why: 'The desert rose stores water in a swollen caudex that rots at the soil line if the mix stays damp. Plant it high, with the caudex proud of the surface.',
    avoid: ['Burying the caudex', 'Watering at all through winter dormancy'],
  },
  Dracaena: {
    // Dracaena absorbed Sansevieria taxonomically, so this genus now spans thin-leaved
    // canes AND thick-leaved snake plants. The species layer separates them below.
    headline: 'Free-draining houseplant mix',
    components: [COIR(2), PERLITE(1), BARK(1)],
    mix: 'Standard mix',
    water: 'low-mineral',
    why: 'Dracaenas want steady but light moisture, and are unusually sensitive to fluoride and salts in tap water — the classic brown leaf tips.',
    avoid: ['Tap water in hard-water or fluoridated areas — it causes the brown tips people blame on humidity', 'Perlite-heavy mixes for the thin-leaved canes, which prefer more body'],
  },
  Zamioculcas: SNAKE_PLANT('The ZZ plant stores water in potato-like rhizomes and is the most over-watered houseplant there is. Gritty mix makes over-watering nearly impossible.'),
  Beaucarnea: SNAKE_PLANT('The ponytail palm stores months of water in its swollen base and rots if that base sits in damp mix.'),
  Euphorbia: {
    headline: 'Gritty mix — mind the sap',
    components: [PUMICE(2), COMPOST(1), PERLITE(1)],
    why: 'Succulent euphorbias want cactus conditions. Their milky sap is a serious irritant to eyes and skin — wear gloves when repotting.',
    avoid: ['Getting the sap on skin or in eyes when handling cut roots or stems'],
  },

  /* ── FRUIT, CITRUS AND OTHER SPECIFIC FEEDERS ── */
  Citrus: {
    headline: 'Open citrus mix, slightly acidic',
    components: [LOAM(2), BARK(1), PERLITE(1), GRIT(1)],
    mix: 'Standard mix',
    ph: [6.0, 6.5],
    drainage: 'Fast',
    water: 'low-mineral',
    why: 'Citrus roots need air as much as water and rot in ordinary compost, but the tree is also a heavy feeder — hence a loam base opened up with bark and grit.',
    avoid: ['Ordinary multipurpose compost, which stays wet and causes the leaf drop citrus are notorious for', 'Hard tap water, which raises the pH and locks up iron'],
    amendments: ['Use a dedicated citrus feed — summer and winter formulations differ for a reason'],
    repotEvery: 'Every 2–3 years in spring, into a pot only one size larger',
  },
  Olea: { components: [LOAM(2), GRIT(1), PERLITE(1)], drainage: 'Fast', ph: [6.5, 8.0], why: 'Olives come from thin, alkaline, stony Mediterranean soil and tolerate lime happily — what kills them in pots is winter wet.' },
  Ficus: {
    headline: 'Well-drained, weighty mix',
    components: [LOAM(2), COIR(1), PERLITE(1), BARK(1)],
    mix: 'Standard mix',
    why: 'Figs are strangler trees with vigorous roots. They want a mix with some weight so a tall plant stays upright, and they hate being moved or repotted more than necessary.',
    avoid: ['Repotting more than every 2–3 years — leaf drop after a move is usually the disturbance, not the new spot'],
  },
  Musa: { components: [COMPOST(3), CASTINGS(1), PERLITE(1)], drainage: 'Moisture-retentive', why: 'Bananas are gross feeders that grow enormously in one season and cannot be over-fed or, in growth, over-watered.' },
  Coffea: { ph: [5.5, 6.5], components: [COIR(3), PERLITE(1), CASTINGS(1)], why: 'Coffee is an acid-loving understory shrub — slightly acidic, humus-rich, and never dry.' },

  /* ── WATER-LOVERS AND BOG PLANTS OUTSIDE THE CARNIVOROUS CATEGORY ── */
  Cyperus: {
    headline: 'Mix that never dries — stand it in water',
    components: [COMPOST(3), COIR(1)],
    mix: 'Dense / heavy',
    drainage: 'Moisture-retentive',
    why: 'Umbrella papyrus is a true marginal aquatic. It is one of the very few pot plants that should permanently stand in a saucer of water.',
    avoid: ['Ever letting it dry out'],
  },
  Acorus: { mix: 'Dense / heavy', drainage: 'Moisture-retentive', why: 'Sweet flag is a marginal aquatic and wants permanently wet soil.' },

  /* ── FERNS THAT DIFFER FROM THE CATEGORY ── */
  Adiantum: {
    headline: 'Fine, damp, lime-tolerant mix',
    components: [COIR(3), PERLITE(1), LEAFMOULD(1)],
    ph: [6.0, 7.5],
    water: 'low-mineral',
    why: 'Maidenhair ferns grow on damp limestone, so unlike most ferns they tolerate a little lime. What they will not tolerate is drying out — one dry day crisps the whole plant.',
    avoid: ['Letting it dry out even once', 'Cutting back the whole plant in panic — water it and new fronds usually come'],
  },
  Selaginella: { components: [COIR(3), PERLITE(1), SPHAGNUM(1)], drainage: 'Moisture-retentive', why: 'Spikemoss needs constant humidity and damp — it is a terrarium plant more than a houseplant.' },
  Asparagus: { components: [COMPOST(3), PERLITE(1), GRIT(1)], drainage: 'Moderate', why: 'Asparagus ferns are not ferns at all — they are lilies with water-storing tubers, so they want more drainage and tolerate far more neglect than a true fern.' },

  /* ── HERBS THAT WANT IT LEANER OR RICHER THAN THE CATEGORY ── */
  Lavandula: LEAN_MEDITERRANEAN('Lavender dies from winter wet and rich soil far more often than from cold.'),
  Rosmarinus: LEAN_MEDITERRANEAN('Rosemary rots at the base in damp, rich compost.'),
  Salvia: LEAN_MEDITERRANEAN('Sage wants poor, sharply drained soil — rich compost gives soft growth and much weaker flavour.'),
  Thymus: LEAN_MEDITERRANEAN('Thyme grows on stony hillsides and needs the sharpest drainage of the common herbs.'),
  Origanum: LEAN_MEDITERRANEAN('Oregano develops its oils in poor, dry, sunny conditions.'),
  Ocimum: {
    headline: 'Rich, damp compost — the herb exception',
    components: [COMPOST(4), CASTINGS(1), PERLITE(1)],
    drainage: 'Moisture-retentive',
    why: 'Basil is the exception among culinary herbs: it is a soft tropical annual that wants rich, damp compost and warmth, not lean Mediterranean grit.',
    avoid: ['Letting it dry out, which makes it bolt straight to flower', 'Cold — below about 10 °C it stops and blackens'],
  },
  Mentha: {
    headline: 'Rich, permanently moist compost',
    components: [COMPOST(4), COIR(1)],
    drainage: 'Moisture-retentive',
    why: 'Mint is a damp-ground runner — rich, moist compost, and always in its own pot, because it will strangle anything planted with it.',
    avoid: ['Planting it in a bed or shared pot — the runners take over within a season', 'Letting it dry out'],
  },
  Petroselinum: {
    headline: 'Rich, deep, moisture-holding mix',
    components: [COMPOST(4), PERLITE(1)],
    drainage: 'Moisture-retentive',
    why: 'Parsley is a deep-rooted biennial that wants rich, moist soil and a deep pot for its taproot.',
    avoid: ['Shallow pots, which stunt the taproot', 'Drying out, which triggers bolting'],
  },

  /* ── GESNERIADS AND OTHER FINE-ROOTED FLOWERING PLANTS ── */
  Saintpaulia: AFRICAN_VIOLET(),
  Streptocarpus: AFRICAN_VIOLET('Cape primroses have the same fine roots as African violets and rot just as readily in ordinary compost.'),
  Sinningia: AFRICAN_VIOLET('Gloxinias grow from a tuber and rot easily — light, airy mix and never water the crown.'),
  Begonia: {
    headline: 'Light, airy mix — begonia roots are shallow',
    components: [COIR(2), PERLITE(2), BARK(1)],
    mix: 'Chunky / aroid',
    drainage: 'Fast',
    why: 'Begonias have fine, shallow roots and rot at the base in dense wet compost. Rhizomatous and rex types especially want a wide, shallow pot rather than a deep one.',
    avoid: ['Deep pots — the mix below the roots stays wet and sours', 'Watering into the crown'],
  },
  Cyclamen: {
    headline: 'Gritty, free-draining — keep the corm dry',
    components: [COMPOST(2), GRIT(1), PERLITE(1)],
    mix: 'Gritty / cactus',
    drainage: 'Fast',
    why: 'Cyclamen grow from a corm that must sit with its top proud of the surface. Water sitting on the crown rots it, which is why they are usually watered from below.',
    avoid: ['Burying the corm', 'Watering over the top of the plant'],
  },
  Pelargonium: { components: [COMPOST(3), GRIT(1), PERLITE(1)], drainage: 'Fast', why: 'Geraniums flower far better slightly pot-bound in a lean, gritty mix; rich damp compost gives leaves instead of flowers.' },

  /* ── BULBS AND TUBERS WITH SPECIFIC NEEDS ── */
  Hippeastrum: { components: [COMPOST(2), GRIT(1), PERLITE(1)], mix: 'Gritty / cactus', drainage: 'Fast', why: 'Amaryllis bulbs rot readily — plant with the top third of the bulb above the surface in a pot only 2–3 cm wider than the bulb itself.', avoid: ['Burying the bulb completely', 'A pot much wider than the bulb — the surplus wet mix is what rots it'] },
  Narcissus: { why: 'Daffodil bulbs need sharp drainage and must be kept dry once the foliage yellows and they go dormant.' },
  Tulipa: { why: 'Tulip bulbs rot in damp summer soil — the sharpest drainage of the common bulbs, and a dry dormancy.' },

  /* ── CONIFERS, BONSAI-STYLE AND ACID-TOLERANT TREES ── */
  Juniperus: { components: [PUMICE(2), LOAM(1), BARK(1)], mix: 'Gritty / cactus', drainage: 'Fast', why: 'Conifers need oxygen at the roots above all else. The classic bonsai mix — mostly mineral grit with a little organic matter — is right even for a plain container juniper.' },
  Pinus: { components: [PUMICE(2), LOAM(1), BARK(1)], mix: 'Gritty / cactus', drainage: 'Fast', ph: [5.5, 6.5], why: 'Pines want sharp, mineral, slightly acidic conditions and a mycorrhizal partner — never sterilise or over-feed the mix.' },
  Picea: { components: [PUMICE(1), LOAM(2), BARK(1)], drainage: 'Fast', ph: [5.0, 6.5], why: 'Spruces want acidic, well-drained, cool root conditions.' },
  Acer: {
    headline: 'Free-draining, slightly acidic, wind-sheltered',
    components: [LOAM(2), LEAFMOULD(1), GRIT(1), BARK(1)],
    ph: [5.5, 6.5],
    drainage: 'Fast',
    water: 'low-mineral',
    why: 'Japanese maples have fine surface roots that scorch when dry and rot when waterlogged. They want an open, acidic, humus-rich mix and shelter from drying wind.',
    avoid: ['Alkaline tap water over years, which yellows the leaves', 'Letting the pot bake in full afternoon sun — the roots cook before the leaves show it'],
  },
  Ginkgo: { components: [LOAM(2), GRIT(1), COMPOST(1)], why: 'Ginkgos are extraordinarily tolerant, but in a pot they still want free drainage and real soil body.' },

  /* ── VEGETABLES WITH SPECIFIC CONTAINER NEEDS ── */
  Solanum: {
    headline: 'Deep, rich, evenly-watered fruiting mix',
    components: [COMPOST(4), CASTINGS(1), PERLITE(1)],
    drainage: 'Moisture-retentive',
    why: 'Tomatoes, aubergines and peppers are heavy feeders that crop badly in small or dry containers — irregular watering is exactly what causes blossom-end rot and split fruit.',
    avoid: ['Pots under about 10 litres for a full-size tomato', 'Letting it dry then flooding it — that swing splits the fruit'],
    amendments: ['Feed with a high-potash tomato feed once the first truss sets'],
  },
  Capsicum: {
    headline: 'Rich but free-draining fruiting mix',
    components: [COMPOST(3), PERLITE(1), CASTINGS(1)],
    drainage: 'Moderate',
    why: 'Chillies and peppers want warmth and steady moisture but rot faster than tomatoes if kept sodden — slightly more drainage, slightly less water.',
    avoid: ['Over-watering in cool weather', 'Over-feeding with nitrogen, which gives leaves instead of fruit'],
    amendments: ['Switch to a high-potash feed once flowers set'],
  },
  Cucumis: { headline: 'Very rich, thirsty crop mix', components: [COMPOST(4), CASTINGS(1), COIR(1)], drainage: 'Moisture-retentive', why: 'Cucumbers and melons are among the thirstiest and hungriest things you can grow in a pot — they need volume, richness and water every day in summer.', avoid: ['Small pots', 'Any check in watering, which makes cucumbers bitter'] },
  Cucurbita: { headline: 'Very rich, thirsty crop mix', components: [COMPOST(4), CASTINGS(1), COIR(1)], drainage: 'Moisture-retentive', why: 'Squashes, courgettes and pumpkins are gross feeders with enormous leaves — they cannot really be over-fed or, in growth, over-watered.', avoid: ['Watering onto the crown, which rots it', 'Under-sized containers'] },
  Lactuca: { headline: 'Fine, moisture-holding salad mix', components: [COMPOST(3), COIR(1), PERLITE(1)], drainage: 'Moisture-retentive', why: 'Lettuce is shallow-rooted and mostly water — it needs constant moisture near the surface, and bolts the moment it dries or overheats.', avoid: ['Drying out, which turns the leaves bitter and triggers bolting'] },
  Spinacia: { headline: 'Rich, cool, moisture-holding mix', components: [COMPOST(3), COIR(1), CASTINGS(1)], drainage: 'Moisture-retentive', why: 'Spinach bolts in heat and dryness; it wants a rich, damp, cool root run.', avoid: ['Heat and dryness together — the fastest route to bolting'] },
  Daucus: {
    headline: 'Fine, deep, sandy — and NOT freshly enriched',
    components: [COMPOST(3), SILICA(2)],
    drainage: 'Fast',
    why: 'Carrots fork and stunt in stony, lumpy or freshly manured mix — they want it fine, deep, sandy and not recently fed.',
    avoid: ['Fresh manure or lumpy compost, which causes forked roots', 'Shallow containers — depth is the whole game with carrots'],
  },
  Brassica: {
    headline: 'Firm, limed, alkaline mix',
    components: [LOAM(3), COMPOST(1), CASTINGS(1)],
    ph: [6.5, 7.5],
    phNote: 'Brassicas are one of the few crops that genuinely want alkaline conditions — lime suppresses clubroot.',
    drainage: 'Moisture-retentive',
    why: 'Cabbages, kale, broccoli and their relatives want firm, limed, alkaline soil — loose acidic mix gives weak plants and encourages clubroot.',
    avoid: ['Acidic or ericaceous compost', 'Loose, fluffy mix — brassicas want to be planted firm'],
    amendments: ['Add garden lime to bring the pH up toward 7 if it is below 6.5'],
  },
  Allium: { headline: 'Free-draining, low-nitrogen mix', components: [COMPOST(2), GRIT(1), PERLITE(1)], drainage: 'Fast', ph: [6.0, 7.0], why: 'Onions, garlic and leeks rot in wet soil and store badly if given too much nitrogen late on — free drainage and lean feeding.', avoid: ['Rich nitrogen feeds late in the season, which give soft bulbs that will not keep', 'Wet soil around the neck of the bulb'] },
  Fragaria: {
    headline: 'Slightly acidic, free-draining fruit mix',
    components: [COMPOST(3), PERLITE(1), CASTINGS(1)],
    ph: [5.5, 6.5],
    drainage: 'Moderate',
    why: 'Strawberries want slightly acidic, free-draining soil with the crown sitting exactly at the surface — buried crowns rot, exposed roots dry out.',
    avoid: ['Burying the crown', 'Old, tired compost — replace it and the plants every 3 years'],
  },
  Rubus: { headline: 'Rich, deep, slightly acidic cane-fruit mix', components: [COMPOST(3), LEAFMOULD(1), GRIT(1)], ph: [5.5, 6.5], why: 'Raspberries and blackberries are deep-rooted and hungry, and dislike both drought and waterlogging — depth and organic matter matter more than anything.' },
  Ribes: { headline: 'Rich, moisture-holding fruit-bush mix', components: [LOAM(2), COMPOST(2), GRIT(1)], why: 'Currants and gooseberries are hungry, shallow-rooted bushes that want rich, moisture-retentive soil and a heavy annual mulch.' },

  /* ── AROIDS AND TROPICAL FOLIAGE: the big genera, where they differ ── */
  Alocasia: {
    headline: 'Extremely chunky, fast-draining aroid mix',
    components: [BARK(3), PERLITE(2), COIR(2), CHARCOAL(1)],
    drainage: 'Fast',
    why: 'Alocasias grow from corms that rot readily and are the aroid most often lost to a dense mix. They want it chunkier and faster-draining than a Monstera, and they naturally go dormant in winter — bare stems then are usually dormancy, not death.',
    avoid: ['Dense compost, which rots the corm', 'Throwing away a dormant plant — keep the corm barely damp and it returns in spring'],
  },
  Anthurium: {
    headline: 'Very chunky — nearly an orchid mix',
    components: [BARK(3), PERLITE(2), COIR(1), CHARCOAL(1)],
    mix: 'Chunky / aroid',
    drainage: 'Fast',
    why: 'Anthuriums are epiphytes with thick, brittle roots that need more air than almost any other common houseplant. In ordinary compost they slowly rot from the root up.',
    compostIsHarmful: true,
    avoid: ['Ordinary potting compost', 'Burying the aerial roots — top-dress with moss instead'],
  },
  Philodendron: { headline: 'Chunky aroid mix with room for aerial roots', why: 'Philodendrons are climbing or self-heading aroids that root into bark and litter. The chunkier the mix, the bigger the leaves — and a moss pole for the aerial roots does more for leaf size than any feed.', amendments: ['Give climbing types a moss pole; leaf size increases dramatically once the aerial roots grip'] },
  Monstera: { headline: 'Chunky aroid mix with room for aerial roots', why: 'Monsteras are forest climbers whose thick roots need air pockets. Fenestration — the holes — comes with maturity, light and something to climb, not from feeding.', amendments: ['A moss pole or plank: aerial roots that grip produce noticeably larger, more fenestrated leaves'] },
  Epipremnum: { headline: 'Chunky, forgiving aroid mix', why: 'Pothos are the most tolerant aroids there are, but they still root fastest and grow largest in a chunky mix rather than dense compost.' },
  Scindapsus: { headline: 'Chunky, forgiving aroid mix', why: 'Satin pothos want the same airy mix as their Epipremnum relatives, and hold their silver markings best in bright indirect light.' },
  Syngonium: { headline: 'Chunky aroid mix, slightly moisture-holding', components: [COIR(3), PERLITE(2), BARK(1)], why: 'Arrowhead vines want a little more moisture than most aroids but still rot in dense compost.' },
  Aglaonema: { headline: 'Standard aroid mix, on the retentive side', components: [COIR(3), PERLITE(1), BARK(1)], drainage: 'Moderate', why: 'Chinese evergreens tolerate low light and less air at the roots than most aroids, but still resent sitting wet in winter.' },
  Dieffenbachia: { headline: 'Chunky aroid mix — mind the sap', why: 'Dumb cane needs the standard airy aroid mix. Its sap is loaded with calcium oxalate crystals and causes severe mouth and throat swelling — wear gloves when repotting and keep cuttings away from pets and children.', avoid: ['Handling cut stems without gloves'] },
  Spathiphyllum: { headline: 'Moisture-holding aroid mix', components: [COIR(3), PERLITE(1), BARK(1)], drainage: 'Moisture-retentive', why: 'Peace lilies want more moisture than most aroids — they wilt dramatically and recover within hours, but every collapse costs them roots.' },
  Zantedeschia: {
    headline: 'Rich mix that stays wet',
    components: [COMPOST(3), COIR(1), CASTINGS(1)],
    mix: 'Dense / heavy',
    drainage: 'Moisture-retentive',
    why: 'Calla lilies are marginal bog plants — in growth they can stand in shallow water, which would kill most pot plants.',
    avoid: ['Letting them dry out in growth', 'Keeping the tubers wet during dormancy — that is when they rot'],
  },

  /* ── PRAYER PLANTS AND OTHER RAINWATER-SENSITIVE FOLIAGE ── */
  Goeppertia: PRAYER_PLANT(),
  Calathea: PRAYER_PLANT(),
  Maranta: PRAYER_PLANT('Prayer plants fold their leaves up at night and are just as fussy about water quality as their Calathea relatives.'),
  Ctenanthe: PRAYER_PLANT(),
  Stromanthe: PRAYER_PLANT(),
  Fittonia: {
    headline: 'Fine, permanently damp mix',
    components: [COIR(3), PERLITE(1), SPHAGNUM(1)],
    mix: 'Standard mix',
    drainage: 'Moisture-retentive',
    water: 'low-mineral',
    why: 'Nerve plants are shallow-rooted forest-floor creepers with no drought tolerance at all — they collapse flat within hours of drying out, and usually recover if watered immediately.',
    avoid: ['Ever letting it dry out', 'Dry air — this is a terrarium plant at heart'],
  },
  Peperomia: {
    headline: 'Light, airy, semi-succulent mix',
    components: [COIR(2), PERLITE(2), BARK(1)],
    mix: 'Chunky / aroid',
    drainage: 'Fast',
    why: 'Peperomias are semi-succulent epiphytes with thick leaves and a small, fine root system. They rot at the base far more often than they dry out — an airy mix and a small pot are what keep them alive.',
    avoid: ['Over-potting — a pot much bigger than the roots stays wet and rots them', 'Dense compost'],
  },
  Pilea: { headline: 'Light, free-draining mix', components: [COIR(2), PERLITE(1), BARK(1)], drainage: 'Fast', why: 'Chinese money plants have fine roots and a fleshy stem that rots at soil level in dense wet compost.' },
  Tradescantia: { headline: 'Ordinary free-draining mix', components: [COMPOST(3), PERLITE(1)], drainage: 'Moderate', why: 'Inch plants root from any node and grow in almost anything — the real fix for a leggy one is cutting it back hard, not repotting.' },
  Chlorophytum: { headline: 'Free-draining mix, and don\'t over-pot', components: [COMPOST(3), PERLITE(1), GRIT(1)], drainage: 'Moderate', water: 'low-mineral', why: 'Spider plants store water in thick white roots that will crack a pot when crowded. They are very sensitive to fluoride in tap water — the classic brown tips.', avoid: ['Fluoridated tap water, the usual cause of brown tips'] },
  Sansevieria: SNAKE_PLANT(),

  /* ── SUCCULENT GENERA WITH DISTINCT NEEDS ── */
  Aloe: { headline: 'Gritty succulent mix', components: [PUMICE(2), COMPOST(1), PERLITE(1)], why: 'Aloes rot at the crown if water sits in the rosette or the mix stays damp — grit, and water at the soil rather than over the plant.', avoid: ['Water sitting in the centre of the rosette'] },
  Agave: { headline: 'Very sharp mineral mix', components: [PUMICE(3), COMPOST(1), GRIT(1)], why: 'Agaves are desert plants that survive on almost nothing and rot quickly in rich or damp mix. Mind the spines — most need the tips blunted if they are anywhere near a walkway.' },
  Echeveria: { headline: 'Gritty mix, and keep the rosette dry', components: [PUMICE(2), COMPOST(1), PERLITE(1)], why: 'Echeverias rot from water trapped in the rosette and stretch badly in low light. Grit, bright light, and water at soil level only.', avoid: ['Watering over the rosette', 'Low light, which stretches them irreversibly'] },
  Crassula: { headline: 'Gritty mix for a woody succulent', components: [PUMICE(2), COMPOST(1), PERLITE(1)], why: 'Jade plants and their relatives become genuinely woody and top-heavy — they want grit for drainage and a heavy pot for stability.' },
  Kalanchoe: { headline: 'Gritty succulent mix', components: [PUMICE(2), COMPOST(1), PERLITE(1)], why: 'Kalanchoes flower on a short-day trigger and rot easily at the base; grit and a dry-out between waterings.' },
  Sedum: { headline: 'Very sharp, lean mineral mix', components: [PUMICE(2), GRIT(1), COMPOST(1)], why: 'Stonecrops grow on rock and roofs — lean and sharp is the point, and winter wet is what kills them, not cold.' },
  Sempervivum: { headline: 'Very sharp, lean mineral mix', components: [PUMICE(2), GRIT(1), COMPOST(1)], why: 'Houseleeks are alpine rosettes that survive hard frost but not winter wet — near-pure grit, and shelter from rain rather than cold.' },
  Curio: { headline: 'Gritty mix for a trailing succulent', components: [PUMICE(2), COMPOST(1), PERLITE(1)], why: 'String-of-pearls and its relatives have very fine surface roots and shrivel or rot easily — shallow pots, gritty mix, and let the strands sit ON the surface where they root as they go.', avoid: ['Deep pots', 'Burying the strands'] },
  Haworthia: { headline: 'Gritty mix for a shade succulent', components: [PUMICE(2), COMPOST(1), PERLITE(1)], why: 'Haworthias grow half-buried in gritty shade and have finer roots than most succulents — sharp drainage, but not baked dry.' },
  Gasteria: { headline: 'Gritty mix for a shade succulent', components: [PUMICE(2), COMPOST(1), PERLITE(1)], why: 'Same shade-and-grit conditions as Haworthia, its close relative.' },
  Aeonium: { headline: 'Gritty mix — and it grows in WINTER', components: [PUMICE(2), COMPOST(1), PERLITE(1)], why: 'Aeoniums are winter growers that go dormant and drop leaves in summer heat — that bare summer stem is normal, not neglect. Repot in autumn as growth restarts, not in spring.', bestTime: 'Autumn, as growth restarts' },
  Portulacaria: { headline: 'Gritty mix for a woody succulent', components: [PUMICE(2), COMPOST(1), PERLITE(1)], why: 'Elephant bush is a shrubby succulent that takes hard pruning and is a classic bonsai subject — grit, sun, and infrequent water.' },

  /* ── FERNS, CLIMBERS AND PERENNIALS ── */
  Nephrolepis: { headline: 'Moisture-retentive fern mix', why: 'Boston ferns shed leaflets everywhere the moment the mix dries. Keep it consistently damp, and divide the clump when you repot in spring.' },
  Asplenium: { headline: 'Open, moisture-retentive fern mix', components: [COIR(2), BARK(1), PERLITE(1)], why: 'Bird\'s nest ferns are epiphytic, so they want a more open mix than a ground fern — and never let water sit in the central nest, which rots the crown.', avoid: ['Water sitting in the central rosette'] },
  Hedera: { headline: 'Ordinary free-draining mix', components: [COMPOST(3), PERLITE(1), GRIT(1)], ph: [6.0, 7.5], drainage: 'Moderate', why: 'Ivy is undemanding about soil and tolerates lime happily. Its real enemy indoors is red spider mite in warm, dry air — not the mix.' },
  Cissus: { headline: 'Free-draining climbing mix', components: [COIR(2), PERLITE(1), BARK(1)], why: 'Grape ivies are tendril climbers with fine roots that rot in dense compost.' },
  Clematis: { headline: 'Rich, deep mix with cool, shaded roots', components: [LOAM(2), COMPOST(2), GRIT(1)], ph: [6.5, 7.5], why: 'Clematis famously want their heads in the sun and their roots in the shade. They tolerate lime well and need a deep, rich, cool root run — mulch or a stone slab over the root zone makes a visible difference.', avoid: ['Hot, exposed pots — the roots cook', 'Planting shallow; most clematis go in about 8 cm deeper than they grew in the pot'] },
  Hosta: { headline: 'Rich, moisture-holding shade mix', components: [COMPOST(3), LEAFMOULD(1), PERLITE(1)], drainage: 'Moisture-retentive', why: 'Hostas are woodland perennials that want rich, permanently moist soil in shade — a dry hosta is a small, slug-eaten hosta.' },
  Heuchera: { headline: 'Free-draining mix, crown kept proud', components: [COMPOST(2), LEAFMOULD(1), GRIT(1)], drainage: 'Moderate', why: 'Coral bells rot at the crown in wet soil and lift themselves out of the ground over time — replant deeper every few years, but never bury the crown.' },
  Rosa: { headline: 'Heavy, rich loam', components: [LOAM(3), COMPOST(1), GRIT(1)], ph: [6.0, 6.8], drainage: 'Moderate', why: 'Roses want heavy, rich, loamy soil — light peat-based compost gives weak growth. In containers they need the largest pot you can manage and annual top-dressing.', amendments: ['Mycorrhizal fungi at planting establishes them noticeably faster'] },
  Prunus: { headline: 'Free-draining loam', components: [LOAM(3), COMPOST(1), GRIT(1)], ph: [6.0, 7.0], why: 'Cherries, plums and their relatives hate waterlogging above all — free drainage matters more than richness, and they are best pruned in summer to avoid silver leaf.' },
  Malus: { headline: 'Free-draining loam', components: [LOAM(3), COMPOST(1), GRIT(1)], why: 'Apples and crabapples want a deep, well-drained loam; in containers the rootstock matters far more than the mix.' },
  Lilium: { headline: 'Deep, free-draining bulb mix', components: [COMPOST(2), LEAFMOULD(1), GRIT(1)], drainage: 'Fast', why: 'Lily bulbs have no protective tunic and rot easily; most also root from the stem above the bulb, so they want planting deep — about three times the bulb\'s height.', avoid: ['Shallow planting', 'Wet soil in winter'] },
  Iris: { headline: 'Sharp drainage; rhizome ON the surface', components: [LOAM(2), GRIT(2), COMPOST(1)], drainage: 'Fast', why: 'Bearded irises need their rhizome baking on the surface in full sun — burying it is the single most common reason one never flowers.', avoid: ['Burying the rhizome', 'Mulching over the rhizome'] },
  Ilex: { headline: 'Free-draining, slightly acidic mix', components: [LOAM(2), ERICACEOUS(1), GRIT(1)], ph: [5.5, 6.5], why: 'Hollies prefer slightly acidic, well-drained soil. Berries need a female plant with a male nearby — soil is rarely the reason one has none.' },
  Buxus: { headline: 'Free-draining, alkaline-tolerant loam', components: [LOAM(3), GRIT(1), COMPOST(1)], ph: [6.5, 7.5], why: 'Box tolerates lime and drought once established but rots in wet compost, and box blight spreads fastest where air cannot move through damp foliage.' },
  Lonicera: { headline: 'Rich loam with cool roots', components: [LOAM(2), COMPOST(2), GRIT(1)], why: 'Honeysuckles want rich soil, cool shaded roots and their tops in sun — the same arrangement clematis ask for.' },
};

/** Prayer plants and their relatives: fine roots, constant damp, and no tap water. */
function PRAYER_PLANT(why?: string): RecipePatch {
  return {
    headline: 'Fine, evenly damp mix — rainwater only',
    components: [COIR(3), PERLITE(1), BARK(1)],
    mix: 'Standard mix',
    ph: [6.0, 6.5],
    drainage: 'Moisture-retentive',
    water: 'low-mineral',
    why: why ?? 'Calatheas have fine surface roots and are famously intolerant of tap water — the crisped brown leaf edges people blame on humidity are usually fluoride and dissolved salts. They want an evenly damp, fine mix and rainwater.',
    avoid: ['Tap water — this is the single biggest cause of the brown edges', 'Letting the mix dry out, then flooding it', 'Cold draughts'],
  };
}

/* ── Helper builders: these keep repeated patterns honest and identical ── */

function EPIPHYTIC_CACTUS(): RecipePatch {
  return {
    headline: 'Rich, airy jungle-cactus mix — NOT desert grit',
    components: [BARK(2), COIR(2), PERLITE(2), LEAFMOULD(1)],
    mix: 'Chunky / aroid',
    ph: [5.5, 6.5],
    drainage: 'Moderate',
    water: 'low-mineral',
    why: 'This is a JUNGLE cactus, not a desert one. It grows as an epiphyte in leaf litter caught in the forks of rainforest trees — it wants an airy, organic, evenly damp mix, and the gritty compost sold for cacti slowly starves and shrivels it.',
    avoid: ['Desert cactus compost — the single most common mistake with this plant', 'Full sun, which scorches it, and a bone-dry rest, which drops the buds'],
    repotEvery: 'Every 2–3 years, just after flowering; it flowers best slightly pot-bound',
    bestTime: 'After flowering finishes',
  };
}

function BROMELIAD(): RecipePatch {
  return {
    headline: 'Bark-based epiphyte mix',
    components: [BARK(3), PERLITE(1), COIR(1)],
    mix: 'Chunky / aroid',
    drainage: 'Fast',
    water: 'low-mineral',
    why: 'Bromeliads are epiphytes with a tiny anchoring root system — they take up water through the central cup in their leaves, not from the pot. The mix is there to hold them upright.',
    compostIsHarmful: true,
    avoid: ['Ordinary compost, which rots the small root system', 'Letting the central cup stay empty — that is where they actually drink from'],
    amendments: ['Keep the central cup topped up with rainwater and flush it out monthly'],
  };
}

function MESEMB(): RecipePatch {
  return {
    headline: 'Almost pure mineral — no organic matter',
    components: [PUMICE(3), SILICA(1), COMPOST(1)],
    mix: 'Gritty / cactus',
    drainage: 'Fast',
    why: 'Living stones and their relatives grow in near-pure mineral desert grit and split or rot in anything richer. They also need a completely dry rest while the new pair of leaves absorbs the old one.',
    avoid: ['Any water at all while the old leaves are shrivelling — this is the classic way they are killed', 'Organic-heavy compost, which causes them to swell and split'],
    repotEvery: 'Every 3–4 years at most',
    bestTime: 'Early autumn, in growth',
  };
}

function SNAKE_PLANT(why?: string): RecipePatch {
  return {
    headline: 'Gritty mix — this one rots from over-watering',
    components: [PUMICE(2), COIR(1), PERLITE(1)],
    mix: 'Gritty / cactus',
    drainage: 'Fast',
    why: why ?? 'Snake plants store water in thick rhizomes and leaves. In ordinary compost the roots stay wet between waterings and rot — a gritty mix makes that almost impossible.',
    avoid: ['Ordinary potting compost', 'Deep pots — these want to be tight and shallow'],
    repotEvery: 'Every 3–4 years, and only when the pot is being forced apart',
  };
}

function ERICACEOUS_MIX(why: string): RecipePatch {
  return {
    headline: 'Ericaceous (acidic) mix',
    components: [ERICACEOUS(3), LEAFMOULD(1), PERLITE(1)],
    mix: 'Standard mix',
    ph: [4.5, 6.0],
    phNote: 'Must be acidic. Ordinary compost, and hard tap water over time, will push the pH up and lock out iron.',
    water: 'low-mineral',
    drainage: 'Moderate',
    why,
    avoid: ['Ordinary or lime-containing compost', 'Hard tap water — use rainwater where you can, as it slowly re-acidifies the pot'],
    amendments: ['Feed with an ericaceous fertiliser only'],
  };
}

function LEAN_MEDITERRANEAN(why: string): RecipePatch {
  return {
    headline: 'Lean, sharply drained Mediterranean mix',
    components: [LOAM(2), GRIT(2), PERLITE(1)],
    mix: 'Gritty / cactus',
    ph: [6.5, 7.5],
    drainage: 'Fast',
    why,
    avoid: ['Rich compost and heavy feeding — it gives soft growth, weak flavour and winter losses', 'Wet mix in winter, which is the actual cause of most deaths'],
  };
}

function AFRICAN_VIOLET(why?: string): RecipePatch {
  return {
    headline: 'Light, fluffy violet mix',
    components: [COIR(2), PERLITE(2), SPHAGNUM(1)],
    mix: 'Chunky / aroid',
    ph: [5.8, 6.5],
    drainage: 'Fast',
    water: 'low-mineral',
    why: why ?? 'African violets have very fine roots that need air. Ordinary compost packs down and rots them, which is why they are traditionally grown in a mix that is half perlite.',
    avoid: ['Ordinary potting compost', 'Cold water on the leaves, which marks them permanently', 'Watering into the crown — water from below'],
  };
}

/* ─────────────────────────────── SPECIES OVERRIDES ───────────────────────────────
 * Keyed by COMMON name (the catalog's unique key). Only for individuals that
 * differ from their own genus — kept small on purpose.
 */
const SPECIES_RECIPE: Record<string, RecipePatch> = {
  // Dracaena now contains the snake plants taxonomically, and they want the
  // opposite of what a Dracaena cane wants.
  'Snake plant': SNAKE_PLANT(),
  'Snake plant Laurentii': SNAKE_PLANT(),
  'Snake plant Moonshine': SNAKE_PLANT(),
  'Cylindrical snake plant': SNAKE_PLANT(),
  'Whale fin snake plant': SNAKE_PLANT(),
  'Bird\'s nest snake plant': SNAKE_PLANT(),
  'Starfish snake plant': SNAKE_PLANT(),
  'Lucky bamboo': {
    headline: 'Water, or pebbles — not compost',
    components: [{ name: 'Pebbles and water (or a very free-draining mix)', parts: 1, role: 'Holds the canes upright while the roots sit in water' }],
    mix: 'Dense / heavy',
    drainage: 'Moisture-retentive',
    water: 'low-mineral',
    why: 'Lucky bamboo is a Dracaena grown hydroponically. It is normally kept in water with pebbles, and it is very sensitive to fluoride and chlorine in tap water.',
    avoid: ['Tap water — use rainwater, distilled, or tap left to stand 24 hours', 'Letting the water go stale; change it every 2 weeks'],
    repotEvery: 'Change the water fortnightly; no compost involved',
    bestTime: 'Any time',
  },
  'Venus flytrap': {
    why: 'Venus flytraps grow in nutrient-poor acidic bogs in a single small area of the Carolinas. Feeding them, or watering with tap water, kills them — the traps are how they get nitrogen precisely because the soil has none.',
    avoid: [
      'ANY fertiliser or compost — this is the fastest way to kill one',
      'Tap or bottled mineral water; rainwater or distilled only',
      'Triggering the traps for fun — each trap only closes a handful of times before it dies',
    ],
    amendments: ['Stand in 1–2 cm of rainwater in summer; keep just damp through a cold winter dormancy'],
  },
  'Peace lily': { components: [COIR(3), PERLITE(1), BARK(1)], drainage: 'Moisture-retentive', why: 'Peace lilies want more moisture than most aroids — they wilt dramatically and recover within hours, but every collapse costs them roots.' },
  'Boston fern': { why: 'Boston ferns drop leaflets everywhere the moment the mix dries. They want it consistently damp and are best repotted every spring, dividing the clump at the same time.' },
  'African violet': AFRICAN_VIOLET(),
  'Christmas cactus': EPIPHYTIC_CACTUS(),
  'Thanksgiving cactus': EPIPHYTIC_CACTUS(),
  'Easter cactus': EPIPHYTIC_CACTUS(),
  'Orchid cactus': EPIPHYTIC_CACTUS(),
  'Mistletoe cactus': EPIPHYTIC_CACTUS(),
  'Fishbone cactus': EPIPHYTIC_CACTUS(),
  'Dragon fruit': {
    ...EPIPHYTIC_CACTUS(),
    headline: 'Airy mix with real feeding — a climbing cactus',
    why: 'Dragon fruit is a climbing epiphytic cactus that needs support, an airy mix, and far more water and feeding than a desert cactus while it is in growth.',
  },
  'Moth orchid': { why: 'Moth orchids are the commonest orchid and the commonest orchid casualty: almost all losses are old, collapsed bark holding water against the roots. Repot into fresh medium bark every other year and the plant looks after itself.' },
  'Air plant': {
    ...GENUS_RECIPE.Tillandsia,
    why: 'Air plants have no working roots at all — they take in water and nutrients through scales on their leaves. Potting one in anything is what kills it.',
  },
  'Blueberry': {
    ...ERICACEOUS_MIX('Blueberries need genuinely acidic soil — pH 4.5–5.5 — and will simply yellow and refuse to fruit in ordinary compost.'),
    ph: [4.5, 5.5],
    amendments: ['Mulch with pine needles or composted bark', 'Two different varieties nearby give a substantially bigger crop'],
  },
};

/* ────────────────────────────────── RESOLUTION ────────────────────────────────── */

/** First word of the latin name — the genus. */
function genusOf(latin: string | undefined): string {
  if (!latin) return '';
  const first = latin.trim().split(/[\s"']/)[0];
  // Hybrid names are written "× Fatshedera"; the genus is the next word.
  if (first === '×' || first === 'x') return latin.trim().split(/[\s"']/)[1] ?? '';
  return first;
}

/**
 * The best substrate for this species: the category baseline, refined by genus,
 * then by any species-specific override. `basis` says which layer answered so the
 * UI never implies category-typical advice is species-specific.
 */
export function soilRecipeFor(species: string | undefined): SoilRecipe {
  const s = getSpecies(species);
  const category = s?.category ?? 'tropical';
  const base = CATEGORY_RECIPE[category];
  const genus = genusOf(s?.latin);
  const byGenus = genus ? GENUS_RECIPE[genus] : undefined;
  const bySpecies = s ? SPECIES_RECIPE[s.common] : undefined;

  const merged = { ...base, ...(byGenus ?? {}), ...(bySpecies ?? {}) };
  const basis: SoilRecipe['basis'] = bySpecies ? 'species' : byGenus ? 'genus' : 'category';
  const basisNote =
    basis === 'species'
      ? `Specific to ${s?.common ?? 'this plant'}`
      : basis === 'genus'
        ? `Specific to ${genus} — the genus this plant belongs to`
        : `Typical for ${CATEGORY_LABEL[category]}; not species-specific`;

  return { ...merged, basis, basisNote };
}

const CATEGORY_LABEL: Record<CategoryKey, string> = {
  tropical: 'tropical foliage plants',
  fern: 'ferns',
  palm: 'palms',
  succulent: 'succulents',
  cactus: 'cacti',
  vine: 'climbers and trailers',
  tree: 'trees',
  herb: 'herbs',
  vegetable: 'vegetables',
  flowering: 'flowering plants',
  orchid: 'orchids',
  grass: 'grasses',
  carnivorous: 'carnivorous plants',
  shrub: 'shrubs',
  bulb: 'bulbs',
};

/** The recipe written out as parts, e.g. "2 parts bark : 2 parts coir : 1 part perlite". */
export function recipeLine(recipe: SoilRecipe): string {
  return recipe.components
    .map((c) => {
      // Strip the parenthetical grade note, leaving ONE space where it was —
      // swallowing the spaces glued words together ("ericaceouscompost").
      const short = c.name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      return `${c.parts} part${c.parts === 1 ? '' : 's'} ${short}`;
    })
    .join(' · ');
}

/**
 * Turn the parts into actual litres for a specific pot, because "2 parts bark"
 * is not a shopping list and a pot's volume is already known.
 */
export function recipeVolumes(recipe: SoilRecipe, liters: number): { name: string; liters: number; role: string }[] {
  const total = recipe.components.reduce((a, c) => a + c.parts, 0);
  if (total <= 0 || !Number.isFinite(liters) || liters <= 0) return [];
  return recipe.components.map((c) => ({
    name: c.name,
    role: c.role,
    liters: Math.round((c.parts / total) * liters * 10) / 10,
  }));
}

export interface MixVerdict {
  /** the mix the plant is in now */
  current: SoilMix | null;
  /** the mix the recipe amounts to */
  recommended: SoilMix;
  matches: boolean;
  /** how serious the mismatch is */
  severity: 'none' | 'minor' | 'major';
  headline: string;
  detail: string;
}

/**
 * Is what it is potted in now good enough?
 *
 * Judged on the retention bucket rather than the recipe wording, because that is
 * what actually changes the physics — and because plenty of homemade mixes are
 * perfectly good without matching any recipe word for word. A mismatch is only
 * called MAJOR when it crosses from one end of the drainage range to the other,
 * which is the case that genuinely kills plants (a cactus in dense compost, a
 * fern in grit). Adjacent buckets are a nudge, not an alarm.
 */
const MIX_ORDER: SoilMix[] = ['Gritty / cactus', 'Chunky / aroid', 'Standard mix', 'Dense / heavy'];

export function mixVerdict(species: string | undefined, current: SoilMix | null | undefined): MixVerdict {
  const recipe = soilRecipeFor(species);
  const rec = recipe.mix;
  if (!current) {
    return {
      current: null, recommended: rec, matches: false, severity: 'minor',
      headline: 'Greenr doesn’t know what this is potted in',
      detail: `Set the mix and every moisture reading gets sharper — the app models ${rec.toLowerCase()} differently from dense compost, and it changes both the amount of water and when it is due.`,
    };
  }
  if (current === rec) {
    return {
      current, recommended: rec, matches: true, severity: 'none',
      headline: 'Already in the right kind of mix',
      detail: `${current} is what this plant wants. Worth refreshing it anyway when the mix stops draining as it used to — ${recipe.repotEvery.toLowerCase()}.`,
    };
  }
  const gap = Math.abs(MIX_ORDER.indexOf(current) - MIX_ORDER.indexOf(rec));
  // Distance between retention buckets is the usual measure of how bad a mismatch
  // is, and for most plants it is the right one. It is NOT sufficient on its own:
  // a Venus flytrap wants "Dense / heavy" and ordinary compost is also "Dense /
  // heavy", so bucket distance called potting one in compost a MINOR issue when it
  // is fatal within a season. Where the recipe says ordinary compost harms this
  // plant, being in it is always major, however close the buckets look.
  const inOrdinaryCompost = current === 'Standard mix' || current === 'Dense / heavy';
  const major = gap >= 2 || (!!recipe.compostIsHarmful && inOrdinaryCompost);
  return {
    current, recommended: rec, matches: false, severity: major ? 'major' : 'minor',
    headline: major ? `Wrong kind of mix for this plant` : `Close, but ${rec.toLowerCase()} would suit it better`,
    detail: major
      ? recipe.compostIsHarmful && inOrdinaryCompost
        ? `It is in ${current.toLowerCase()} — ordinary compost — and for this plant that is not a compromise, it is harmful. ${recipe.why} Repot it into ${recipe.headline.toLowerCase()} as soon as you can.`
        : `It is in ${current.toLowerCase()} and wants ${rec.toLowerCase()} — that is a difference big enough to hold it back however carefully it is watered. ${recipe.why}`
      : `${current} works, but ${rec.toLowerCase()} is a better match for how these roots are built. Worth switching at the next repot rather than disturbing it now.`,
  };
}

export const WATER_QUALITY_NOTE: Record<WaterQuality, string> = {
  'tap': 'Tap water is fine.',
  'low-mineral': 'Prefers rainwater or filtered water — hard tap water gradually raises the pH of the pot and marks the leaves.',
  'rain-only': 'Rainwater or distilled ONLY. Tap and bottled mineral water will kill this plant within a season.',
};
