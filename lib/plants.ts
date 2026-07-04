/**
 * The plant species database. Hundreds of species, each with care parameters
 * derived from its category (with per-species overrides where it matters).
 * This is the single source of truth the add-plant picker, advice engine,
 * suggestions, and spot fit all read from.
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

export interface PlantSpecies {
  common: string;
  latin: string;
  emoji: string;
  category: CategoryKey;
  band: [number, number]; // soil-moisture comfort band %
  dli: [number, number]; // daily light (DLI) comfort band
  rhFloor: number; // humidity floor %
  temp: [number, number]; // comfortable temp °F
  outdoor: boolean; // can thrive outdoors (in season / mild climates)
}

interface CategoryTemplate {
  emoji: string;
  band: [number, number];
  dli: [number, number];
  rhFloor: number;
  temp: [number, number];
  outdoor: boolean;
}

const CATEGORIES: Record<CategoryKey, CategoryTemplate> = {
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

/** [common, latin, category, emojiOverride?] */
type Row = [string, string, CategoryKey, string?];

// A broad catalog. Care params come from the category; a few notable species
// keep a distinctive emoji. This is intentionally large so most plants a user
// owns are findable.
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
  ['Calathea Orbifolia', 'Goeppertia orbifolia', 'tropical', '🪴'],
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
  };
}

export const ALL_SPECIES: PlantSpecies[] = ROWS.map(expand);

export const SPECIES_COUNT = ALL_SPECIES.length;

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
