import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from './auth';
import { type CalMetricKey, type SensorCalibration, emptyCalibration, withCalibration } from './calibration';
import { pullGarden, pushGarden } from './cloud';
import type { DayLight } from './insights';
import { SEED_ACCURACY, SEED_PLANTS, SEED_SENSORS, SEED_SPOTS, SEED_TASKS } from './seed';
import {
  AccuracyEntry,
  CareTask,
  Plant,
  PotShape,
  Profile,
  Sensor,
  Settings,
  SoilMix,
  Spot,
  WaterAmountSource,
} from './types';

const STORAGE_KEY = 'greenr.state.v2';

interface GreenrState {
  onboarded: boolean;
  /** null until sign-in + survey complete */
  profile: Profile | null;
  /** true while the seeded demo garden is loaded (testing only) */
  demo: boolean;
  plants: Plant[];
  spots: Spot[];
  sensors: Sensor[];
  tasks: CareTask[];
  accuracy: AccuracyEntry[];
  settings: Settings;
  briefingOpened: boolean;
  /** sensor/device calibration, keyed by sensor or device id (§8) */
  calibrations: Record<string, SensorCalibration>;
  /** per-plant daily daytime-light snapshots — the multi-day light average
   *  accumulates here so the light verdict improves with each day of data. */
  lightDaily: Record<string, DayLight[]>;
}

const DEFAULT_SETTINGS: Settings = {
  briefingDay: 'Sunday',
  briefingTime: '9:00',
  emergencyLeadHours: 48,
  quietHours: ['21:00', '08:00'],
  unitsF: true,
  voice: 'Standard',
  appearance: 'Dark',
  researchOptIn: true,
  plus: false,
  remindersEnabled: false,
  bleGatewayEnabled: false,
  mutedPlantIds: [],
};

/** Real users start with nothing — the garden is theirs to build. */
function emptyState(): GreenrState {
  return {
    onboarded: false,
    profile: null,
    demo: false,
    plants: [],
    spots: [],
    sensors: [],
    tasks: [],
    accuracy: [],
    settings: DEFAULT_SETTINGS,
    briefingOpened: false,
    calibrations: {},
    lightDaily: {},
  };
}

function demoData() {
  return {
    plants: SEED_PLANTS,
    spots: SEED_SPOTS,
    sensors: SEED_SENSORS,
    tasks: SEED_TASKS,
    accuracy: SEED_ACCURACY,
  };
}

/**
 * The slice of state that persists — locally to AsyncStorage and (when signed
 * in) to the cloud. Demo data is deliberately excluded so testing never
 * pollutes a real account; it always re-seeds from code.
 */
function persistedSlice(s: GreenrState): Partial<GreenrState> {
  const base: Partial<GreenrState> = {
    onboarded: s.onboarded,
    profile: s.profile,
    demo: s.demo,
    settings: s.settings,
    briefingOpened: s.briefingOpened,
    // Calibration persists for everyone — it's tied to physical hardware, not
    // the demo garden, so it survives restarts and syncs across devices (§7/§8).
    calibrations: s.calibrations,
    // Measured light history persists too — it's real per-day data that the
    // multi-day light average is built from (would otherwise reset each launch).
    lightDaily: s.lightDaily,
  };
  if (!s.demo) {
    base.plants = s.plants;
    base.spots = s.spots;
    base.sensors = s.sensors;
    base.tasks = s.tasks;
  }
  return base;
}

/** Backfill fields older saves don't have (addedAt drives the baseline clock). */
function migratePlants(plants: Plant[] | undefined): Plant[] | undefined {
  if (!plants) return plants;
  return plants.map((p) =>
    p.addedAt
      ? p
      : { ...p, addedAt: new Date(Date.now() - (p.addedDaysAgo ?? 0) * 86400000).toISOString() },
  );
}

/** Merge a saved (local or cloud) slice onto current state. */
function applySaved(s: GreenrState, saved: Partial<GreenrState>): GreenrState {
  const base: GreenrState = {
    ...s,
    ...saved,
    plants: migratePlants(saved.plants) ?? s.plants,
    settings: { ...s.settings, ...saved.settings },
  };
  return saved.demo ? { ...base, ...demoData() } : base;
}

interface GreenrApi extends GreenrState {
  hydrated: boolean;
  setProfile: (p: Profile) => void;
  signOut: () => void;
  completeOnboarding: () => void;
  addPlant: (p: Plant) => void;
  addSpot: (s: Spot) => void;
  logWater: (plantId: string) => void;
  /** Log a watering with its amount — feeds the estimate cycle (honest, no fabricated score change). */
  logWaterAmount: (
    plantId: string,
    ml: number | null,
    /**
     * Everything that makes the amount interpretable later. `source` decides
     * whether this pour may calibrate the pot at all, and `suggestedMl` is what
     * lets the app grade its own advice afterwards.
     */
    meta?: {
      predictedRisePts?: number | null;
      suggestedMl?: number | null;
      source?: WaterAmountSource;
      /**
       * When the watering actually happened. Defaults to now, but a watering
       * being recorded AFTER the fact — because the sensor spotted the jump and
       * asked — must be logged at the time of the jump. Log it at "now" and it
       * pairs with no reading at all, so the amount teaches the model nothing,
       * which is the entire point of having asked.
       */
      at?: string;
    },
  ) => void;
  /** Log non-watering care (fertilized, misted, repotted, …) to the plant's history. */
  logCare: (plantId: string, note: string) => void;
  completeTask: (taskId: string, verified: boolean) => void;
  skipTask: (taskId: string) => void;
  resetCareSession: () => void;
  markBriefingOpened: () => void;
  setSettings: (patch: Partial<Settings>) => void;
  setPlus: (on: boolean) => void;
  movePlant: (plantId: string, spotId: string) => void;
  archivePlant: (plantId: string, cause?: string) => void;
  addDiagnosis: (plantId: string, text: string) => void;
  addTasks: (tasks: CareTask[]) => void;
  setPlantPhoto: (plantId: string, uri: string) => void;
  /** Add a growth-journal entry (photo and/or height/leaf measurement + note). */
  logGrowth: (plantId: string, entry: { photoUri?: string; heightCm?: number | null; leaves?: number | null; note?: string }) => void;
  renamePlant: (plantId: string, name: string) => void;
  setPotDimensions: (plantId: string, dims: { potCm?: number | null; potHeightCm?: number | null; potShape?: PotShape }) => void;
  /**
   * Record a repot: the new mix, optionally new pot dimensions, and the date.
   * Stamping `lastRepottedAt` is not bookkeeping — it puts the plant into
   * `settlingState`'s 21-day window, which softens the advice and suppresses
   * feeding while the roots re-establish.
   */
  repotPlant: (plantId: string, change: { soilMix?: SoilMix; hasDrainage?: boolean; potCm?: number | null; potHeightCm?: number | null }) => void;
  /** Record that a detected soil jump was NOT a watering, so it stops being asked about. */
  dismissSoilJump: (plantId: string, at: string) => void;
  /** Carry a pot's measured figures forward so they outlive the reading window. */
  rememberMeasurements: (plantId: string, m: NonNullable<Plant['measurementMemory']>) => void;
  reassignSensor: (sensorId: string, plantId: string) => void;
  recalibrateSensor: (sensorId: string) => void;
  /** §8: record a per-metric calibration (offset = reference − measured) */
  calibrateMetric: (sensorKey: string, key: CalMetricKey, reference: number, measured: number) => void;
  /** Flip a reversed light sensor (LDR modules that read high in the dark). */
  setLightInverted: (sensorKey: string, inverted: boolean) => void;
  /** Snapshot a plant's daytime-light for one day (multi-day light average). */
  recordLightDay: (plantId: string, day: DayLight) => void;
  installFirmware: (sensorId: string) => void;
  forgetSensor: (sensorId: string) => void;
  /** testing: load the seeded demo garden */
  loadDemoGarden: () => void;
  /** testing: wipe everything back to a fresh install */
  resetApp: () => void;
}

const Ctx = createContext<GreenrApi | null>(null);

export function GreenrProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GreenrState>(emptyState);
  const [hydrated, setHydrated] = useState(false);
  const { user } = useAuth();

  // Latest state, readable inside async callbacks without re-subscribing.
  const stateRef = useRef(state);
  stateRef.current = state;
  // The account we've *started* pulling for (dedupes the pull effect).
  const pullStartedFor = useRef<string | null>(null);
  // The account whose initial pull has *finished* — pushes wait for this so we
  // never overwrite the cloud with local data before we've read it.
  const pullDoneFor = useRef<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as Partial<GreenrState>;
        setState((s) => applySaved(s, saved));
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  // Local persistence (offline cache + guest users).
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persistedSlice(state))).catch(() => {});
  }, [hydrated, state]);

  // On sign-in, pull the account's cloud garden. If the account has one, it
  // wins (this device now mirrors it). If it's a brand-new account, seed the
  // cloud with whatever is on this device so guest progress carries over.
  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      pullStartedFor.current = null;
      pullDoneFor.current = null;
      return;
    }
    if (pullStartedFor.current === user.id) return;
    pullStartedFor.current = user.id;
    (async () => {
      const cloud = await pullGarden(user.id);
      if (cloud) {
        setState((s) => applySaved(s, cloud as Partial<GreenrState>));
      } else {
        await pushGarden(user.id, persistedSlice(stateRef.current));
      }
      pullDoneFor.current = user.id;
    })();
  }, [hydrated, user]);

  // While signed in, mirror changes up to the cloud (debounced). Waits for the
  // initial pull to finish so we don't clobber the cloud with local data.
  useEffect(() => {
    if (!hydrated || !user || state.demo) return;
    if (pullDoneFor.current !== user.id) return;
    const t = setTimeout(() => {
      pushGarden(user.id, persistedSlice(state)).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [hydrated, user, state]);

  const completeOnboarding = useCallback(
    () => setState((s) => ({ ...s, onboarded: true })),
    [],
  );

  const setProfile = useCallback(
    (p: Profile) => setState((s) => ({ ...s, profile: p })),
    [],
  );

  const signOut = useCallback(() => {
    // The garden is safe in the cloud now, so signing out fully clears this
    // device — otherwise the next account to sign in here could inherit it.
    pullStartedFor.current = null;
    pullDoneFor.current = null;
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    setState(emptyState());
  }, []);

  const addPlant = useCallback(
    (p: Plant) => setState((s) => ({ ...s, plants: [...s.plants, p] })),
    [],
  );

  const addSpot = useCallback(
    (sp: Spot) => setState((s) => ({ ...s, spots: [...s.spots, sp] })),
    [],
  );

  const logWater = useCallback((plantId: string) => {
    setState((s) => {
      const plant = s.plants.find((p) => p.id === plantId);
      const [plo, phi] = plant?.comfortBand ?? [0, 100];
      const cur = plant?.moistureHistory[0]?.moisture ?? plo;
      const soaked =
        cur >= phi
          ? Math.min(96, cur + 18)
          : cur > (plo + phi) / 2
            ? Math.min(96, cur + 20)
            : Math.round((plo + phi) / 2 + 8);
      return {
      ...s,
      // the paired sensor sees the pour on its next reading
      sensors: s.sensors.map((sn) =>
        sn.plantId === plantId
          ? { ...sn, lastReadingMinsAgo: 0, latest: { ...sn.latest, soilPct: soaked } }
          : sn,
      ),
      plants: s.plants.map((p) => {
        if (p.id !== plantId) return p;
        const [lo, hi] = p.comfortBand;
        const current = p.moistureHistory[0]?.moisture ?? lo;

        // Water isn't free points — pouring into wet soil overshoots the band.
        let newMoisture: number;
        let scoreDelta: number;
        let action: string;
        let note: string;
        if (current >= hi) {
          newMoisture = Math.min(96, current + 18);
          scoreDelta = -8;
          action = 'Hold off — soil above the band, let it dry';
          note = p.sensorId
            ? `Watered while already wet — soil ${current}% → ${newMoisture}%, over the band. Root-rot risk climbs with every repeat.`
            : 'Watered while the model read wet — now over the band. Root-rot risk climbs with every repeat.';
        } else if (current > (lo + hi) / 2) {
          newMoisture = Math.min(96, current + 20);
          const over = newMoisture > hi;
          scoreDelta = over ? -3 : 1;
          action = over ? 'Hold off — soil pushed over the band' : 'Nothing needed';
          note = over
            ? `Watered early — soil ${current}% → ${newMoisture}%, past the band edge. It didn't need it yet.`
            : `Topped up — soil ${current}% → ${newMoisture}%.`;
        } else {
          newMoisture = Math.round((lo + hi) / 2 + 8);
          scoreDelta = 6;
          action = 'Nothing needed';
          note = p.sensorId
            ? `Watered — soil ${current}% → ${newMoisture}%`
            : 'Watered (logged)';
        }

        return {
          ...p,
          score: Math.max(5, Math.min(100, p.score + scoreDelta)),
          moistureHistory: [
            { daysAgo: 0, moisture: newMoisture, watered: true },
            ...p.moistureHistory,
          ],
          forecast: { ...p.forecast, warnInDays: null, criticalInDays: null, action },
          timeline: [
            {
              id: `tl-${Date.now()}`, at: new Date().toISOString(),
              daysAgo: 0,
              kind: (scoreDelta < 0 ? 'insight' : 'care') as 'insight' | 'care',
              text: note,
              verified: scoreDelta >= 0 && !!p.sensorId,
            },
            ...p.timeline,
          ],
        };
      }),
      };
    });
  }, []);

  const logWaterAmount = useCallback((
    plantId: string,
    ml: number | null,
    meta?: {
      predictedRisePts?: number | null;
      suggestedMl?: number | null;
      source?: WaterAmountSource;
      at?: string;
    },
  ) => {
    const at = meta?.at ?? new Date().toISOString();
    const source: WaterAmountSource = meta?.source ?? 'preset';
    setState((s) => ({
      ...s,
      // A paired demo sensor sees the pour on its next reading (cosmetic only).
      sensors: s.sensors.map((sn) =>
        sn.plantId === plantId ? { ...sn, lastReadingMinsAgo: 0 } : sn,
      ),
      plants: s.plants.map((p) => {
        if (p.id !== plantId) return p;
        return {
          ...p,
          // A back-filled watering must not drag `lastWateredAt` backwards — that
          // field gates the "just watered, wait for the sensor" logic and moving
          // it into the past would un-mute alerts that are correctly muted.
          lastWateredAt:
            p.lastWateredAt && new Date(p.lastWateredAt).getTime() > new Date(at).getTime()
              ? p.lastWateredAt
              : at,
          waterLog: [...(p.waterLog ?? []), {
            at,
            ml,
            predictedRisePts: meta?.predictedRisePts ?? null,
            suggestedMl: meta?.suggestedMl ?? null,
            source,
          }].slice(-30),
          timeline: [
            {
              id: `tl-${Date.now()}`, at: new Date().toISOString(),
              daysAgo: 0,
              kind: 'care' as const,
              // "about 250 ml" and "250 ml, measured" are different claims, and the
              // timeline is the record someone reads back months later.
              text: ml == null
                ? 'Watered (logged)'
                : source === 'measured'
                  ? `Watered ${ml} ml (measured)`
                  : source === 'assumed'
                    ? `Watered — amount not recorded (about ${ml} ml suggested)`
                    : `Watered ~${ml} ml (logged)`,
            },
            ...p.timeline,
          ],
        };
      }),
    }));
  }, []);

  const logCare = useCallback((plantId: string, note: string) => {
    setState((s) => ({
      ...s,
      plants: s.plants.map((p) =>
        p.id === plantId
          ? {
              ...p,
              timeline: [
                { id: `tl-${Date.now()}`, at: new Date().toISOString(), daysAgo: 0, kind: 'care' as const, text: note },
                ...p.timeline,
              ],
            }
          : p,
      ),
    }));
  }, []);

  const completeTask = useCallback((taskId: string, verified: boolean) => {
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, done: true, verified } : t)),
    }));
  }, []);

  const skipTask = useCallback((taskId: string) => {
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, done: true, skipped: true } : t)),
    }));
  }, []);

  const resetCareSession = useCallback(() => {
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) => ({ ...t, done: false, verified: false, skipped: false })),
    }));
  }, []);

  const markBriefingOpened = useCallback(
    () => setState((s) => ({ ...s, briefingOpened: true })),
    [],
  );

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  }, []);

  const setPlus = useCallback((on: boolean) => {
    setState((s) => ({ ...s, settings: { ...s.settings, plus: on } }));
  }, []);

  const movePlant = useCallback((plantId: string, spotId: string) => {
    setState((s) => ({
      ...s,
      plants: s.plants.map((p) =>
        p.id === plantId
          ? {
              ...p,
              spotId,
              timeline: [
                {
                  id: `tl-${Date.now()}`, at: new Date().toISOString(),
                  daysAgo: 0,
                  kind: 'care' as const,
                  text: `Moved to ${s.spots.find((sp) => sp.id === spotId)?.name ?? 'a new spot'} — expectations re-baselined for 7 days.`,
                },
                ...p.timeline,
              ],
            }
          : p,
      ),
    }));
  }, []);

  const archivePlant = useCallback((plantId: string, cause?: string) => {
    setState((s) => ({
      ...s,
      plants: s.plants.map((p) =>
        p.id === plantId ? { ...p, archived: true, archivedCause: cause } : p,
      ),
      tasks: s.tasks.filter((t) => t.plantId !== plantId),
    }));
  }, []);

  const addDiagnosis = useCallback((plantId: string, text: string) => {
    setState((s) => ({
      ...s,
      plants: s.plants.map((p) =>
        p.id === plantId
          ? {
              ...p,
              timeline: [
                { id: `tl-${Date.now()}`, at: new Date().toISOString(), daysAgo: 0, kind: 'diagnosis' as const, text },
                ...p.timeline,
              ],
            }
          : p,
      ),
    }));
  }, []);

  const addTasks = useCallback((newTasks: CareTask[]) => {
    setState((s) => ({ ...s, tasks: [...s.tasks, ...newTasks] }));
  }, []);

  const setPlantPhoto = useCallback((plantId: string, uri: string) => {
    setState((s) => ({
      ...s,
      plants: s.plants.map((p) =>
        p.id === plantId
          ? {
              ...p,
              photoUri: uri,
              timeline: [
                { id: `tl-${Date.now()}`, at: new Date().toISOString(), daysAgo: 0, kind: 'photo' as const, text: 'Photo added.' },
                ...p.timeline,
              ],
            }
          : p,
      ),
    }));
  }, []);

  const logGrowth = useCallback(
    (
      plantId: string,
      entry: { photoUri?: string; heightCm?: number | null; leaves?: number | null; note?: string },
    ) => {
      const now = Date.now();
      const id = `gr-${now}`;
      const bits: string[] = [];
      if (entry.photoUri) bits.push('photo');
      if (entry.heightCm != null) bits.push(`${entry.heightCm} cm tall`);
      if (entry.leaves != null) bits.push(`${entry.leaves} leaves`);
      const text = `Growth logged${bits.length ? ` — ${bits.join(', ')}` : ''}.`;
      setState((s) => ({
        ...s,
        plants: s.plants.map((p) =>
          p.id === plantId
            ? {
                ...p,
                // newest photo becomes the cover; keep the last 60 entries
                photoUri: entry.photoUri ?? p.photoUri,
                growth: [...(p.growth ?? []), { id, at: new Date(now).toISOString(), ...entry }].slice(-60),
                timeline: [
                  { id: `tl-${now}`, at: new Date(now).toISOString(), daysAgo: 0, kind: entry.photoUri ? ('photo' as const) : ('care' as const), text },
                  ...p.timeline,
                ],
              }
            : p,
        ),
      }));
    },
    [],
  );

  const renamePlant = useCallback((plantId: string, name: string) => {
    setState((s) => ({
      ...s,
      plants: s.plants.map((p) => (p.id === plantId ? { ...p, name } : p)),
    }));
  }, []);

  /**
   * Record the pot's measured dimensions. Soil volume needs BOTH the width and
   * the depth — supplying only one leaves the estimate on its fallback, which is
   * why this takes them together rather than one at a time.
   */
  const setPotDimensions = useCallback(
    (plantId: string, dims: { potCm?: number | null; potHeightCm?: number | null; potShape?: PotShape }) => {
      setState((s) => ({
        ...s,
        plants: s.plants.map((p) =>
          p.id === plantId
            ? {
                ...p,
                ...(dims.potCm != null ? { potCm: dims.potCm } : {}),
                ...(dims.potHeightCm != null ? { potHeightCm: dims.potHeightCm } : {}),
                ...(dims.potShape ? { potShape: dims.potShape } : {}),
              }
            : p,
        ),
      }));
    },
    [],
  );

  const repotPlant = useCallback(
    (plantId: string, change: { soilMix?: SoilMix; hasDrainage?: boolean; potCm?: number | null; potHeightCm?: number | null }) => {
      setState((s) => ({
        ...s,
        plants: s.plants.map((p) => {
          if (p.id !== plantId) return p;
          const bits = [
            change.soilMix && change.soilMix !== p.soilMix ? `into ${change.soilMix.toLowerCase()}` : null,
            change.potCm != null && change.potCm !== p.potCm ? `${change.potCm} cm pot` : null,
            change.hasDrainage === true && p.hasDrainage === false ? 'drainage holes added' : null,
          ].filter(Boolean);
          return {
            ...p,
            ...(change.soilMix ? { soilMix: change.soilMix } : {}),
            ...(change.hasDrainage != null ? { hasDrainage: change.hasDrainage } : {}),
            ...(change.potCm != null ? { potCm: change.potCm } : {}),
            ...(change.potHeightCm != null ? { potHeightCm: change.potHeightCm } : {}),
            lastRepottedAt: new Date().toISOString(),
            timeline: [
              {
                id: `tl-${Date.now()}`,
                at: new Date().toISOString(),
                daysAgo: 0,
                kind: 'care' as const,
                text: bits.length ? `Repotted ${bits.join(', ')}` : 'Repotted',
              },
              ...p.timeline,
            ],
          };
        }),
      }));
    },
    [],
  );

  const dismissSoilJump = useCallback((plantId: string, at: string) => {
    setState((s) => ({
      ...s,
      plants: s.plants.map((p) =>
        p.id === plantId
          ? { ...p, ignoredJumps: [...(p.ignoredJumps ?? []), at].slice(-40) }
          : p,
      ),
    }));
  }, []);

  const rememberMeasurements = useCallback(
    (plantId: string, m: NonNullable<Plant['measurementMemory']>) => {
      setState((s) => {
        const p = s.plants.find((x) => x.id === plantId);
        if (!p) return s;
        const prev = p.measurementMemory;
        // Only write when something meaningful moved — this is called on a timer
        // and an unconditional setState would re-render the whole garden and
        // re-push the cloud blob every tick.
        const same =
          prev &&
          prev.mlPerPoint === m.mlPerPoint &&
          prev.mlPerPointBasis === m.mlPerPointBasis &&
          prev.ceilingPct === m.ceilingPct &&
          prev.retentionClass === m.retentionClass;
        if (same) return s;
        return {
          ...s,
          plants: s.plants.map((x) =>
            x.id === plantId
              ? { ...x, measurementMemory: { ...m, updatedAt: new Date().toISOString() } }
              : x,
          ),
        };
      });
    },
    [],
  );

  const reassignSensor = useCallback((sensorId: string, plantId: string) => {
    setState((s) => ({
      ...s,
      sensors: s.sensors.map((sn) => (sn.id === sensorId ? { ...sn, plantId } : sn)),
      plants: s.plants.map((p) => {
        if (p.sensorId === sensorId && p.id !== plantId) {
          // old plant: stream archives to its history, back to estimate mode
          return {
            ...p,
            sensorId: null,
            estimate: true,
            estimateBand: 6,
            timeline: [
              {
                id: `tl-${Date.now()}`, at: new Date().toISOString(),
                daysAgo: 0,
                kind: 'insight' as const,
                text: 'Sensor moved — its stream is archived here; scores continue as estimates.',
              },
              ...p.timeline,
            ],
          };
        }
        if (p.id === plantId) {
          return { ...p, sensorId, estimate: false, estimateBand: 0 };
        }
        return p;
      }),
    }));
  }, []);

  const recalibrateSensor = useCallback((sensorId: string) => {
    setState((s) => ({
      ...s,
      sensors: s.sensors.map((sn) =>
        sn.id === sensorId
          ? {
              ...sn,
              calibratedOn: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              calDry: 2860 + Math.floor(Math.random() * 30),
              calWet: 1170 + Math.floor(Math.random() * 30),
            }
          : sn,
      ),
    }));
  }, []);

  const calibrateMetric = useCallback(
    (sensorKey: string, key: CalMetricKey, reference: number, measured: number) => {
      setState((s) => {
        const current = s.calibrations[sensorKey] ?? emptyCalibration();
        return {
          ...s,
          calibrations: {
            ...s.calibrations,
            [sensorKey]: withCalibration(current, key, reference, measured),
          },
        };
      });
    },
    [],
  );

  const setLightInverted = useCallback((sensorKey: string, inverted: boolean) => {
    setState((s) => {
      const current = s.calibrations[sensorKey] ?? emptyCalibration();
      return {
        ...s,
        calibrations: { ...s.calibrations, [sensorKey]: { ...current, lightInverted: inverted } },
      };
    });
  }, []);

  // Snapshot a plant's daytime-light for one day into the accumulating record.
  // Upserts by day key (a later, better-covered snapshot of the same day wins)
  // and keeps ~30 days. No-op unless the value actually changed, so the plant
  // screen can call it freely on every reading without churning state/persist.
  const recordLightDay = useCallback((plantId: string, day: DayLight) => {
    setState((s) => {
      const prev = s.lightDaily[plantId] ?? [];
      const existing = prev.find((d) => d.day === day.day);
      if (existing && existing.avg === day.avg && existing.hours === day.hours) return s;
      const next = [...prev.filter((d) => d.day !== day.day), day]
        .sort((a, b) => (a.day < b.day ? -1 : 1))
        .slice(-30);
      return { ...s, lightDaily: { ...s.lightDaily, [plantId]: next } };
    });
  }, []);

  const installFirmware = useCallback((sensorId: string) => {
    setState((s) => ({
      ...s,
      sensors: s.sensors.map((sn) =>
        sn.id === sensorId ? { ...sn, updateAvailable: false, firmware: 'v1.4.2' } : sn,
      ),
    }));
  }, []);

  const forgetSensor = useCallback((sensorId: string) => {
    setState((s) => ({
      ...s,
      sensors: s.sensors.filter((sn) => sn.id !== sensorId),
      plants: s.plants.map((p) =>
        p.sensorId === sensorId
          ? {
              ...p,
              sensorId: null,
              estimate: true,
              estimateBand: 7,
              timeline: [
                {
                  id: `tl-${Date.now()}`, at: new Date().toISOString(),
                  daysAgo: 0,
                  kind: 'insight' as const,
                  text: 'Sensor forgotten — history stays with this plant; scores continue as estimates.',
                },
                ...p.timeline,
              ],
            }
          : p,
      ),
    }));
  }, []);

  const loadDemoGarden = useCallback(() => {
    setState((s) => ({
      ...s,
      demo: true,
      onboarded: true,
      // demo shouldn't dead-end at the sign-in gate
      profile:
        s.profile ?? {
          name: 'Demo Gardener',
          email: null,
          method: 'guest',
          experience: '1–5 years',
          plantCount: '4–10',
          where: 'Both',
          struggle: 'Watering',
          joined: 'Mar 2026',
        },
      // Plus comes with the demo so every surface is explorable in testing
      settings: { ...s.settings, plus: true },
      ...demoData(),
    }));
  }, []);

  const resetApp = useCallback(() => {
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    setState(emptyState());
  }, []);

  const api = useMemo<GreenrApi>(
    () => ({
      ...state,
      hydrated,
      setProfile,
      signOut,
      completeOnboarding,
      addPlant,
      addSpot,
      logWater,
      logWaterAmount,
      logCare,
      completeTask,
      skipTask,
      resetCareSession,
      markBriefingOpened,
      setSettings,
      setPlus,
      movePlant,
      archivePlant,
      addDiagnosis,
      addTasks,
      setPlantPhoto,
      logGrowth,
      renamePlant,
      setPotDimensions,
      repotPlant,
      dismissSoilJump,
      rememberMeasurements,
      reassignSensor,
      recalibrateSensor,
      calibrateMetric,
      setLightInverted,
      recordLightDay,
      installFirmware,
      forgetSensor,
      loadDemoGarden,
      resetApp,
    }),
    [state, hydrated, setProfile, signOut, completeOnboarding, addPlant, addSpot, logWater, logWaterAmount, logCare, completeTask, skipTask, resetCareSession, markBriefingOpened, setSettings, setPlus, movePlant, archivePlant, addDiagnosis, addTasks, setPlantPhoto, logGrowth, renamePlant, setPotDimensions, repotPlant, dismissSoilJump, rememberMeasurements, reassignSensor, recalibrateSensor, calibrateMetric, setLightInverted, recordLightDay, installFirmware, forgetSensor, loadDemoGarden, resetApp],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useGreenr(): GreenrApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGreenr must be used inside GreenrProvider');
  return v;
}

/** Plants on active surfaces — archived ones live only in history. */
export function activePlants(plants: Plant[]): Plant[] {
  return plants.filter((p) => !p.archived);
}

export function gardenAverage(plants: Plant[]): number {
  const act = activePlants(plants);
  if (!act.length) return 0;
  return Math.round(act.reduce((a, p) => a + p.score, 0) / act.length);
}
