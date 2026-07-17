/** GREENR 2.0 domain model. */

export type PotSize = 'S' | 'M' | 'L';
export type PotMaterial = 'Terracotta' | 'Plastic' | 'Ceramic';

export interface ScoreComponents {
  hydration: number; // /40
  light: number; // /25
  climate: number; // /15
  consistency: number; // /10
  trend: number; // /10, may be negative displayed as +/-
}

export const COMPONENT_MAX: Record<keyof ScoreComponents, number> = {
  hydration: 40,
  light: 25,
  climate: 15,
  consistency: 10,
  trend: 10,
};

export interface MoisturePoint {
  /** days before now (0 = today), fractional allowed */
  daysAgo: number;
  moisture: number; // %
  watered?: boolean;
  gap?: boolean; // sensor offline segment
}

export interface ForecastInfo {
  /** days from now until projected warning band entry; null = none in window */
  warnInDays: number | null;
  /** days from now until projected critical; null = none in window */
  criticalInDays: number | null;
  /** label like "Thu AM" */
  criticalLabel?: string;
  /** confidence half-width in days (0.5 = crisp, 2 = wide) */
  confidenceDays: number;
  /** plain-words action line */
  action: string;
}

export interface TimelineEvent {
  id: string;
  daysAgo: number;
  kind: 'photo' | 'care' | 'insight' | 'diagnosis' | 'band-change';
  text: string;
  verified?: boolean;
}

/** One logged watering — the raw material for sensorless accuracy. */
export interface WaterEvent {
  at: string; // ISO timestamp
  ml: number | null; // null = amount unknown
}

/**
 * One growth-journal entry — the OUTCOME dimension no sensor can read: how the
 * plant is actually changing. A photo, an optional height/leaf-count
 * measurement, and a note; any field may be omitted.
 */
export interface GrowthEntry {
  id: string;
  at: string; // ISO timestamp
  photoUri?: string; // dated progress photo (data URI)
  heightCm?: number | null; // measured height
  leaves?: number | null; // leaf / frond count
  note?: string;
}

export interface Plant {
  id: string;
  name: string;
  species: string; // common name
  latin: string;
  emoji: string; // shown when there's no photo
  photoUri?: string; // the user's photo (data URI); emoji is the fallback
  spotId: string;
  potSize: PotSize;
  potMaterial: PotMaterial;
  /**
   * Pot diameter in cm (optional). Same species, different pot = different
   * water needs — this makes ml amounts exact instead of S/M/L buckets.
   */
  potCm?: number | null;
  /** ISO timestamp when the plant was added (drives the baseline countdown) */
  addedAt?: string;
  /** last watering the user reported (asked at registration, updated by logs) */
  lastWateredAt?: string | null;
  /** logged waterings with amounts — sharpens the estimate cycle */
  waterLog?: WaterEvent[];
  /** growth journal — dated photos + height/leaf measurements over time */
  growth?: GrowthEntry[];
  score: number;
  estimate: boolean; // true = manual model (dashed ring, ± band)
  estimateBand: number; // the ± value when estimate
  sensorId: string | null;
  components: ScoreComponents;
  comfortBand: [number, number]; // soil moisture % band
  moistureHistory: MoisturePoint[]; // ~90 days
  scoreTrend14: number[]; // 14 daily scores, oldest first
  forecast: ForecastInfo;
  timeline: TimelineEvent[];
  timeInRangePct: number; // 14 d
  addedDaysAgo: number;
  watchMode?: boolean;
  /** archived via gifting or the autopsy flow — hidden from active surfaces */
  archived?: boolean;
  archivedCause?: string;
}

export interface Spot {
  id: string;
  name: string;
  room: string;
  dli: number;
  tempRange: [number, number]; // °F
  rh: number; // %
  measuredBySensor: boolean;
  seasonalNote?: string;
  /** outdoor spots take temp/RH from local weather, not indoor estimates */
  outdoor?: boolean;
}

export type SensorStatus = 'online' | 'late' | 'offline';

export interface Sensor {
  id: string;
  name: string; // e.g. Greenr-4F2A
  plantId: string | null;
  status: SensorStatus;
  batteryPct: number;
  batteryEta: string; // "~3 months"
  rssiDbm: number;
  lastReadingMinsAgo: number;
  wakeIntervalMins: number; // 180 standard, 30 watch
  firmware: string;
  updateAvailable: boolean;
  calibratedOn: string;
  calDry: number;
  calWet: number;
  latest: { soilPct: number; dli: number; tempF: number; rhPct: number; rawAdc: number };
}

export interface CareTask {
  id: string;
  plantId: string;
  title: string;
  why: string;
  minutes: number;
  verifiable: boolean; // sensor present → live verify
  done?: boolean;
  verified?: boolean;
  skipped?: boolean;
}

export interface AccuracyEntry {
  id: string;
  plant: string;
  predicted: string;
  outcome: string;
  hit: boolean;
  missReason?: string;
}

export interface Profile {
  name: string;
  email: string | null;
  method: 'apple' | 'google' | 'email' | 'guest';
  /** survey answers */
  experience: string; // how long gardening
  plantCount: string;
  where: string; // indoors / outdoors / both
  struggle: string; // what kills plants most often
  joined: string; // e.g. "Jul 2026"
}

export interface Settings {
  briefingDay: string;
  briefingTime: string;
  emergencyLeadHours: 24 | 48;
  quietHours: [string, string];
  unitsF: boolean;
  voice: 'Standard' | 'Warm';
  appearance: 'Dark' | 'Light' | 'System';
  researchOptIn: boolean;
  plus: boolean;
  /** local care reminders (water / move / feed) scheduled on-device */
  remindersEnabled: boolean;
}
