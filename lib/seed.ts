import {
  AccuracyEntry,
  CareTask,
  MoisturePoint,
  Plant,
  Sensor,
  Spot,
} from './types';

/** Deterministic pseudo-random so the demo garden is stable across launches. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate ~90 days of soil-moisture history: a sawtooth of watering spikes
 * decaying toward dryness, shaped per plant.
 */
function genMoisture(opts: {
  seed: number;
  band: [number, number];
  dryDaysPerCycle: number; // days from wet to needing water
  overWetSpell?: [number, number]; // daysAgo range spent above band
  gapSpell?: [number, number]; // sensor-offline daysAgo range
  currentMoisture: number;
}): MoisturePoint[] {
  const rnd = mulberry32(opts.seed);
  const pts: MoisturePoint[] = [];
  const [lo, hi] = opts.band;
  let m = opts.currentMoisture;
  // walk backward in time from today
  let sinceWater = 0;
  const decay = (hi + 12 - lo) / opts.dryDaysPerCycle; // % per day
  for (let d = 0; d <= 90; d += 0.5) {
    const inOverWet =
      opts.overWetSpell && d >= opts.overWetSpell[0] && d <= opts.overWetSpell[1];
    const inGap = opts.gapSpell && d >= opts.gapSpell[0] && d <= opts.gapSpell[1];
    let watered = false;
    if (inOverWet) {
      m = hi + 6 + rnd() * 8;
    } else {
      m += decay / 2; // going back in time, moisture rises toward last watering
      sinceWater += 0.5;
      if (m >= hi + 4 + rnd() * 4) {
        // this was a watering event
        watered = true;
        m = lo - 2 + rnd() * 4;
        sinceWater = 0;
      }
    }
    pts.push({
      daysAgo: d,
      moisture: Math.max(4, Math.min(96, Math.round(m + (rnd() - 0.5) * 2))),
      watered,
      gap: inGap || undefined,
    });
  }
  return pts;
}

function trend(seed: number, start: number, end: number): number[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: 14 }, (_, i) =>
    Math.round(start + ((end - start) * i) / 13 + (rnd() - 0.5) * 3),
  );
}

export const SEED_SPOTS: Spot[] = [
  { id: 'sp-east', name: 'East windowsill', room: 'Living room', dli: 4.1, tempRange: [68, 75], rh: 58, measuredBySensor: true },
  { id: 'sp-shelf', name: 'Bookshelf', room: 'Living room', dli: 1.2, tempRange: [69, 74], rh: 52, measuredBySensor: false },
  { id: 'sp-south', name: 'South window', room: 'Bedroom', dli: 6.8, tempRange: [66, 78], rh: 46, measuredBySensor: true, seasonalNote: 'This spot gained ~18% light since March.' },
  { id: 'sp-desk', name: 'Desk corner', room: 'Office', dli: 2.3, tempRange: [70, 76], rh: 44, measuredBySensor: false },
  { id: 'sp-bath', name: 'Bathroom shelf', room: 'Bathroom', dli: 1.8, tempRange: [70, 77], rh: 71, measuredBySensor: true },
  { id: 'sp-kitchen', name: 'Kitchen counter', room: 'Kitchen', dli: 3.4, tempRange: [68, 79], rh: 55, measuredBySensor: false },
  { id: 'sp-hall', name: 'Hallway table', room: 'Hallway', dli: 0.8, tempRange: [69, 74], rh: 50, measuredBySensor: false },
  { id: 'sp-balcony', name: 'Balcony rail', room: 'Outdoors', dli: 18.4, tempRange: [58, 94], rh: 48, measuredBySensor: false, outdoor: true, seasonalNote: 'Weather-driven — temp and RH come from the local forecast.' },
];

export const SEED_PLANTS: Plant[] = [
  {
    id: 'pl-calathea',
    name: 'Calathea',
    species: 'Calathea',
    latin: 'Goeppertia orbifolia',
    emoji: '🪴',
    spotId: 'sp-desk',
    potSize: 'M',
    potMaterial: 'Plastic',
    score: 61,
    estimate: false,
    estimateBand: 0,
    sensorId: 'sn-4f2a',
    components: { hydration: 24, light: 15, climate: 9, consistency: 8, trend: 5 },
    comfortBand: [35, 60],
    moistureHistory: genMoisture({ seed: 11, band: [35, 60], dryDaysPerCycle: 5, currentMoisture: 27 }),
    scoreTrend14: trend(12, 71, 61),
    forecast: {
      warnInDays: 0.5,
      criticalInDays: 2.3,
      criticalLabel: 'Thu AM',
      confidenceDays: 0.5,
      action: 'Water Wed evening',
    },
    timeline: [
      { id: 't1', daysAgo: 0.2, kind: 'insight', text: 'Driest day this month — soil 27%.' },
      { id: 't2', daysAgo: 3, kind: 'care', text: 'Watered — soil 31% → 58%', verified: true },
      { id: 't3', daysAgo: 9, kind: 'band-change', text: 'Stable → Stressed. RH at Desk corner averaged 44% vs 55% floor.' },
      { id: 't4', daysAgo: 14, kind: 'photo', text: 'Photo added' },
    ],
    timeInRangePct: 64,
    addedDaysAgo: 92,
    watchMode: true,
  },
  {
    id: 'pl-monstera',
    name: 'Monstera',
    species: 'Monstera',
    latin: 'Monstera deliciosa',
    emoji: '🌿',
    spotId: 'sp-east',
    potSize: 'L',
    potMaterial: 'Terracotta',
    score: 92,
    estimate: false,
    estimateBand: 0,
    sensorId: 'sn-7b19',
    components: { hydration: 38, light: 24, climate: 14, consistency: 9, trend: 7 },
    comfortBand: [30, 55],
    moistureHistory: genMoisture({ seed: 21, band: [30, 55], dryDaysPerCycle: 9, currentMoisture: 44 }),
    scoreTrend14: trend(22, 90, 92),
    timeline: [
      { id: 't1', daysAgo: 1, kind: 'care', text: 'Watered — soil 32% → 51%', verified: true },
      { id: 't2', daysAgo: 6, kind: 'insight', text: '60 days thriving — its longest run.' },
      { id: 't3', daysAgo: 20, kind: 'photo', text: 'Photo added' },
    ],
    forecast: { warnInDays: 7, criticalInDays: null, confidenceDays: 1, action: 'Nothing needed — 9 d headroom' },
    timeInRangePct: 94,
    addedDaysAgo: 210,
  },
  {
    id: 'pl-fern',
    name: 'Fern',
    species: 'Boston fern',
    latin: 'Nephrolepis exaltata',
    emoji: '🌱',
    spotId: 'sp-bath',
    potSize: 'M',
    potMaterial: 'Ceramic',
    score: 84,
    estimate: false,
    estimateBand: 0,
    sensorId: 'sn-9c03',
    components: { hydration: 34, light: 19, climate: 14, consistency: 9, trend: 8 },
    comfortBand: [45, 70],
    moistureHistory: genMoisture({ seed: 31, band: [45, 70], dryDaysPerCycle: 4, currentMoisture: 52 }),
    scoreTrend14: trend(32, 73, 84),
    timeline: [
      { id: 't1', daysAgo: 2, kind: 'insight', text: 'Humidity recovered after the humidifier move — +11 this week.' },
      { id: 't2', daysAgo: 4, kind: 'care', text: 'Watered — soil 44% → 66%', verified: true },
    ],
    forecast: { warnInDays: 2.5, criticalInDays: 4.2, criticalLabel: 'Sun PM', confidenceDays: 0.8, action: 'Water Sat morning' },
    timeInRangePct: 82,
    addedDaysAgo: 150,
  },
  {
    id: 'pl-pothos',
    name: 'Pothos',
    species: 'Golden pothos',
    latin: 'Epipremnum aureum',
    emoji: '🍃',
    spotId: 'sp-shelf',
    potSize: 'S',
    potMaterial: 'Plastic',
    score: 76,
    estimate: true,
    estimateBand: 7,
    sensorId: null,
    components: { hydration: 28, light: 17, climate: 13, consistency: 10, trend: 8 },
    comfortBand: [25, 50],
    moistureHistory: genMoisture({ seed: 41, band: [25, 50], dryDaysPerCycle: 8, currentMoisture: 33 }),
    scoreTrend14: trend(42, 74, 76),
    timeline: [
      { id: 't1', daysAgo: 5, kind: 'care', text: 'Watered (logged)' },
      { id: 't2', daysAgo: 12, kind: 'photo', text: 'Photo added' },
    ],
    forecast: { warnInDays: 4, criticalInDays: null, confidenceDays: 2, action: 'Check ~Fri' },
    timeInRangePct: 78,
    addedDaysAgo: 120,
  },
  {
    id: 'pl-fiddle',
    name: 'Fig',
    species: 'Fiddle-leaf fig',
    latin: 'Ficus lyrata',
    emoji: '🌳',
    spotId: 'sp-south',
    potSize: 'L',
    potMaterial: 'Ceramic',
    score: 88,
    estimate: true,
    estimateBand: 6,
    sensorId: null,
    components: { hydration: 34, light: 24, climate: 13, consistency: 9, trend: 8 },
    comfortBand: [30, 55],
    moistureHistory: genMoisture({ seed: 51, band: [30, 55], dryDaysPerCycle: 10, currentMoisture: 41 }),
    scoreTrend14: trend(52, 85, 88),
    timeline: [{ id: 't1', daysAgo: 7, kind: 'care', text: 'Watered (logged)' }],
    forecast: { warnInDays: 5, criticalInDays: null, confidenceDays: 1.8, action: 'Nothing needed' },
    timeInRangePct: 86,
    addedDaysAgo: 60,
  },
  {
    id: 'pl-snake',
    name: 'Snake plant',
    species: 'Snake plant',
    latin: 'Dracaena trifasciata',
    emoji: '🌵',
    spotId: 'sp-hall',
    potSize: 'M',
    potMaterial: 'Terracotta',
    score: 71,
    estimate: true,
    estimateBand: 9,
    sensorId: null,
    components: { hydration: 30, light: 12, climate: 13, consistency: 9, trend: 7 },
    comfortBand: [15, 40],
    moistureHistory: genMoisture({ seed: 61, band: [15, 40], dryDaysPerCycle: 18, currentMoisture: 22, overWetSpell: [55, 61] }),
    scoreTrend14: trend(62, 70, 71),
    timeline: [
      { id: 't1', daysAgo: 10, kind: 'insight', text: 'Light-debt: Hallway table delivers 0.8 DLI vs 2.5 target.' },
      { id: 't2', daysAgo: 55, kind: 'insight', text: '6 days over-wet, root-rot risk flagged.' },
    ],
    forecast: { warnInDays: 8, criticalInDays: null, confidenceDays: 2, action: 'Nothing needed' },
    timeInRangePct: 74,
    addedDaysAgo: 300,
  },
];

SEED_PLANTS.push({
  id: 'pl-tomato',
  name: 'Tomato',
  species: 'Cherry tomato',
  latin: 'Solanum lycopersicum',
  emoji: '🍅',
  spotId: 'sp-balcony',
  potSize: 'L',
  potMaterial: 'Plastic',
  score: 79,
  estimate: true,
  estimateBand: 8,
  sensorId: null,
  components: { hydration: 30, light: 24, climate: 10, consistency: 8, trend: 7 },
  comfortBand: [40, 65],
  moistureHistory: genMoisture({ seed: 71, band: [40, 65], dryDaysPerCycle: 3, currentMoisture: 46 }),
  scoreTrend14: trend(72, 76, 79),
  timeline: [
    { id: 't1', daysAgo: 1, kind: 'care', text: 'Watered (logged)' },
    { id: 't2', daysAgo: 4, kind: 'insight', text: 'Outdoor drying accelerated — daytime highs above 90°.' },
  ],
  forecast: { warnInDays: 1.2, criticalInDays: 3.1, criticalLabel: 'Fri PM', confidenceDays: 1.5, action: 'Water Thu evening — heat advisory' },
  timeInRangePct: 71,
  addedDaysAgo: 45,
});

SEED_PLANTS.push(
  {
    id: 'pl-orchid',
    name: 'Orchid',
    species: 'Moth orchid',
    latin: 'Phalaenopsis amabilis',
    emoji: '🌸',
    spotId: 'sp-kitchen',
    potSize: 'S',
    potMaterial: 'Plastic',
    score: 68,
    estimate: true,
    estimateBand: 11,
    sensorId: null,
    components: { hydration: 24, light: 18, climate: 12, consistency: 7, trend: 7 },
    comfortBand: [30, 55],
    moistureHistory: genMoisture({ seed: 81, band: [30, 55], dryDaysPerCycle: 7, currentMoisture: 31 }),
    scoreTrend14: trend(82, 72, 68),
    timeline: [
      { id: 't1', daysAgo: 2, kind: 'insight', text: 'Widest uncertainty in the garden — orchid bark dries unlike soil. A sensor would make this exact.' },
      { id: 't2', daysAgo: 8, kind: 'care', text: 'Watered (logged)' },
    ],
    forecast: { warnInDays: 2, criticalInDays: null, confidenceDays: 2, action: 'Check ~Sat' },
    timeInRangePct: 69,
    addedDaysAgo: 30,
  },
  {
    id: 'pl-zz',
    name: 'ZZ plant',
    species: 'ZZ plant',
    latin: 'Zamioculcas zamiifolia',
    emoji: '🌴',
    spotId: 'sp-shelf',
    potSize: 'M',
    potMaterial: 'Ceramic',
    score: 82,
    estimate: true, // sensor offline >24 h → estimate mode (§5.3)
    estimateBand: 6,
    sensorId: 'sn-2e77',
    components: { hydration: 33, light: 17, climate: 14, consistency: 10, trend: 8 },
    comfortBand: [15, 40],
    moistureHistory: genMoisture({ seed: 91, band: [15, 40], dryDaysPerCycle: 14, currentMoisture: 26, gapSpell: [0, 1.5] }),
    scoreTrend14: trend(92, 81, 82),
    timeline: [
      { id: 't1', daysAgo: 1.2, kind: 'insight', text: 'Greenr-2E77 went silent — estimating from the manual model until it reports.' },
      { id: 't2', daysAgo: 9, kind: 'care', text: 'Watered — soil 14% → 31%', verified: true },
    ],
    forecast: { warnInDays: 6, criticalInDays: null, confidenceDays: 1.5, action: 'Nothing needed' },
    timeInRangePct: 88,
    addedDaysAgo: 130,
  },
);

export const SEED_SENSORS: Sensor[] = [
  {
    id: 'sn-4f2a',
    name: 'Greenr-4F2A',
    plantId: 'pl-calathea',
    status: 'online',
    batteryPct: 74,
    batteryEta: '~3 months',
    rssiDbm: -58,
    lastReadingMinsAgo: 43,
    wakeIntervalMins: 30, // watch mode
    firmware: 'v1.4.2',
    updateAvailable: false,
    calibratedOn: 'Jun 12',
    calDry: 2870,
    calWet: 1180,
    latest: { soilPct: 27, dli: 2.3, tempF: 74, rhPct: 44, rawAdc: 2412 },
  },
  {
    id: 'sn-7b19',
    name: 'Greenr-7B19',
    plantId: 'pl-monstera',
    status: 'online',
    batteryPct: 88,
    batteryEta: '~5 months',
    rssiDbm: -51,
    lastReadingMinsAgo: 112,
    wakeIntervalMins: 180,
    firmware: 'v1.4.2',
    updateAvailable: false,
    calibratedOn: 'Apr 3',
    calDry: 2910,
    calWet: 1150,
    latest: { soilPct: 44, dli: 4.0, tempF: 72, rhPct: 57, rawAdc: 2135 },
  },
  {
    id: 'sn-9c03',
    name: 'Greenr-9C03',
    plantId: 'pl-fern',
    status: 'late',
    batteryPct: 18,
    batteryEta: '~2 weeks',
    rssiDbm: -71,
    lastReadingMinsAgo: 260,
    wakeIntervalMins: 180,
    firmware: 'v1.3.9',
    updateAvailable: true,
    calibratedOn: 'May 20',
    calDry: 2840,
    calWet: 1210,
    latest: { soilPct: 52, dli: 1.7, tempF: 75, rhPct: 71, rawAdc: 1980 },
  },
];

SEED_SENSORS.push({
  id: 'sn-2e77',
  name: 'Greenr-2E77',
  plantId: 'pl-zz',
  status: 'offline',
  batteryPct: 41,
  batteryEta: '~6 weeks',
  rssiDbm: -83,
  lastReadingMinsAgo: 26 * 60,
  wakeIntervalMins: 180,
  firmware: 'v1.4.1',
  updateAvailable: true,
  calibratedOn: 'May 2',
  calDry: 2895,
  calWet: 1165,
  latest: { soilPct: 26, dli: 1.1, tempF: 71, rhPct: 52, rawAdc: 2456 },
});

export const SEED_TASKS: CareTask[] = [
  {
    id: 'task-1',
    plantId: 'pl-calathea',
    title: 'Water the Calathea — 1¼ cups (325 ml), slowly, until the top drains',
    why: 'Soil at 27%, dropping ~4%/day; critical projected Thu AM.',
    minutes: 3,
    verifiable: true,
  },
  {
    id: 'task-2',
    plantId: 'pl-fern',
    title: 'Water the Fern — 1½ cups (350 ml), keep it evenly moist',
    why: 'Projected to leave its band Sunday; watering Saturday keeps it in range.',
    minutes: 2,
    verifiable: true,
  },
  {
    id: 'task-3',
    plantId: 'pl-snake',
    title: 'Move the Snake plant to the Kitchen counter',
    why: 'Hallway delivers 0.8 DLI vs 2.5 target — the move projects +9 vitality.',
    minutes: 4,
    verifiable: false,
  },
  {
    id: 'task-4',
    plantId: 'pl-pothos',
    title: 'Poke test the Pothos — is the top inch dry?',
    why: 'Estimate uncertainty is ±7; one check tightens the forecast.',
    minutes: 1,
    verifiable: false,
  },
];

export const SEED_ACCURACY: AccuracyEntry[] = [
  { id: 'a1', plant: 'Calathea', predicted: 'Dry-out Jun 26 AM', outcome: 'Dried Jun 26 AM', hit: true },
  { id: 'a2', plant: 'Monstera', predicted: 'Dry-out Jun 21', outcome: 'Dried Jun 22', hit: true },
  { id: 'a3', plant: 'Fern', predicted: 'Dry-out Jun 19 PM', outcome: 'Dried Jun 19 PM', hit: true },
  { id: 'a4', plant: 'Pothos', predicted: 'Dry-out Jun 15', outcome: 'Dried Jun 17', hit: false, missReason: 'Missed by 2 d — heat wave exceeded forecast' },
  { id: 'a5', plant: 'Calathea', predicted: 'Dry-out Jun 12 AM', outcome: 'Dried Jun 12 PM', hit: true },
  { id: 'a6', plant: 'Fig', predicted: 'Dry-out Jun 8', outcome: 'Dried Jun 8', hit: true },
  { id: 'a7', plant: 'Snake plant', predicted: 'Dry-out May 30', outcome: 'Dried May 29', hit: true },
];
