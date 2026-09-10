import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Breathing from '@/components/greenr/Breathing';
import CameraCapture from '@/components/greenr/CameraCapture';
import { LogFab } from '@/components/greenr/LogFab';
import PlantAvatar from '@/components/greenr/PlantAvatar';
import { Card, Chip, GButton, Hairline, SectionHeader } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, bandFor, dark, layout, type } from '@/constants/theme';
import { daysAgoLabel, eventDaysAgo, relTime } from '@/lib/format';
import { useGreenr } from '@/lib/store';
import { useLiveReading } from '@/lib/useLiveReading';
import { idealsFor, type Tone } from '@/lib/plantStatus';
import { plantsForEnvironment, scoreSpeciesForEnvironment, type Match } from '@/lib/compatibility';
import { estimateDli, dliBracket } from '@/lib/lightModel';
import { insightsFor, lightBenchmark, dayLight, daytimeLightAvg, recentLightAvg, lightVerdict } from '@/lib/insights';
import { careProfileFor } from '@/lib/plantCare';
import { computeHealth, vitalityFor, BASELINE_DAYS, type HealthComponent } from '@/lib/health';
import { computeCareScore, type CareComponent } from '@/lib/careScore';
import { growthHeadline, growthSummary } from '@/lib/growth';
import { applyCalibration, calibrationFor } from '@/lib/calibration';
import { estimateWaterSchedule, qualitativeNeeds } from '@/lib/estimate';
import { getSpecies, waterProfileFor, waterStyleNote, type Toxicity } from '@/lib/plants';
import { computeSchedule, wateringIcs } from '@/lib/schedule';
import { useWeather } from '@/lib/useWeather';
import { weatherWateringImpact } from '@/lib/weather';
import { shareContent } from '@/lib/platform';
import { currentSeason, seasonalNotes, SEASON_EMOJI, SEASON_LABEL } from '@/lib/season';
import { groomingTip, tipsFor } from '@/lib/tips';
import { potVolume, pourStep, recommendedPourMl, waterPlan, wateringAdvice, wettingFor } from '@/lib/watering';
import { pourOutcome, reviewWatering, settlingState, soilDynamics, wateredSinceLastReading, wateringDidNotRegister } from '@/lib/soilDynamics';
import { confidentVerdicts } from '@/lib/environment';
import { metricSummary } from '@/lib/dailyStats';
import { PROBE, profileCorrection, perchedWaterTableCm, probeFit, profileBands, rootZoneFromReading, inferWaterTableDepth } from '@/lib/soilProfile';
import { retentionEstimate, RETENTION_LABEL } from '@/lib/soilRetention';
import { doseAccuracy } from '@/lib/doseAccuracy';
import { pendingWateringQuestion } from '@/lib/unloggedWatering';
import { setupCompleteness } from '@/lib/setupGaps';
import { probeResolution, relativeThreshold, relativeWetness } from '@/lib/probeResolution';
import { mixVerdict, recipeLine, soilRecipeFor } from '@/lib/soilRecipe';
import { buildHydrationModel, rootBoundSignal } from '@/lib/hydration';
import { pestRisks } from '@/lib/pestRisk';
import { vpdKpa, vpdVerdict } from '@/lib/vpd';
import { waterAction } from '@/lib/waterAction';
import type { PotShape, WaterAmountSource } from '@/lib/types';

/** A labelled fact chip for the care guide (difficulty, size, zones, …). */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        backgroundColor: dark.surface2,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 7,
        minWidth: '30%',
        flexGrow: 1,
      }}
    >
      <Text style={[type.micro, { color: dark.inkMuted }]}>{label.toUpperCase()}</Text>
      <Text style={[type.caption, { color: dark.ink, marginTop: 2 }]}>{value}</Text>
    </View>
  );
}

/** One measurable care line: icon · label · sentence. */
function CareLine({ emoji, label, text }: { emoji: string; label: string; text: string }) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={[type.micro, { color: dark.inkMuted }]}>
        {emoji} {label.toUpperCase()}
      </Text>
      <Text style={[type.body, { color: dark.ink, marginTop: 3, lineHeight: 21 }]}>{text}</Text>
    </View>
  );
}

/** Distills the ASPCA toxicity record into a single honest banner. */
function toxSummary(t: Toxicity): { text: string; color: string; icon: 'warning' | 'checkmark-circle' | 'help-circle' } {
  const anyToxic = t.cats === 'toxic' || t.dogs === 'toxic';
  const bothSafe = t.cats === 'nonToxic' && t.dogs === 'nonToxic';
  if (anyToxic) return { text: `Toxic to pets — ${t.note}`, color: accent.clay, icon: 'warning' };
  if (bothSafe) return { text: `Pet-safe — ${t.note}`, color: accent.sage, icon: 'checkmark-circle' };
  return { text: t.note, color: dark.inkMuted, icon: 'help-circle' };
}

const healthTone = (t: HealthComponent['tone']) =>
  t === 'good' ? accent.sage : t === 'warn' ? accent.sunbeam : t === 'bad' ? accent.clay : dark.inkMuted;

/** Color ramp for a 0–100 suitability score. */
const matchColor = (score: number) =>
  score >= 82 ? accent.sage : score >= 62 ? accent.verdant : score >= 42 ? accent.sunbeam : accent.clay;

/** Representative percentage for a grade word (for coloring the watering strip). */
const gradePct = (g: 'excellent' | 'good' | 'fair' | 'poor') =>
  g === 'excellent' ? 90 : g === 'good' ? 70 : g === 'fair' ? 50 : 25;

/** One component of the sensorless care-fidelity breakdown. */
function CareRow({ c }: { c: CareComponent }) {
  const pct = Math.round(c.fit * 100);
  const color = matchColor(pct);
  return (
    <View style={{ marginTop: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[type.caption, { color: dark.ink, flex: 1 }]}>{c.label}</Text>
        <Text style={[type.numBold as any, { color, fontSize: 13, minWidth: 34, textAlign: 'right' }]}>{pct}%</Text>
      </View>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: dark.hairline, marginTop: 6, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: 5, backgroundColor: color }} />
      </View>
      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 5, lineHeight: 15 }]}>{c.detail}</Text>
      {c.recommendation ? (
        <Text style={[type.micro, { color: accent.verdant, marginTop: 2, lineHeight: 15 }]}>→ {c.recommendation}</Text>
      ) : null}
    </View>
  );
}

/** One factor of the spot-suitability breakdown: fit bar + measured vs ideal. */
function FactorBar({ f }: { f: Match['factors'][number] }) {
  const pct = Math.round(f.fit * 100);
  const color = matchColor(pct);
  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[type.caption, { color: dark.ink, flex: 1 }]}>{f.label}</Text>
        <Text style={[type.micro, { color: dark.inkMuted }]}>
          {f.measured} · {f.ideal}
        </Text>
        <Text style={[type.numBold as any, { color, fontSize: 12, minWidth: 34, textAlign: 'right' }]}>{pct}%</Text>
      </View>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: dark.hairline, marginTop: 5, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: 5, backgroundColor: color }} />
      </View>
    </View>
  );
}

/** One row of the transparent health breakdown: earned/max, reason, action (§9/§2). */
function HealthRow({ c }: { c: HealthComponent }) {
  const color = healthTone(c.tone);
  return (
    <View style={{ marginTop: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[type.caption, { color: dark.ink, flex: 1 }]}>
          {c.label}
          {c.estimate ? ' · est.' : ''}
        </Text>
        <Text style={[type.num as any, { color: dark.inkMuted, fontSize: 12 }]}>{c.value}</Text>
        <Text style={[type.numBold as any, { color, fontSize: 14, minWidth: 46, textAlign: 'right' }]}>
          {c.earned}/{c.max}
        </Text>
      </View>
      {/* proportional bar */}
      <View style={{ height: 5, borderRadius: 3, backgroundColor: dark.hairline, marginTop: 6, overflow: 'hidden' }}>
        <View style={{ width: `${Math.round((c.earned / c.max) * 100)}%`, height: 5, backgroundColor: color }} />
      </View>
      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 5, lineHeight: 15 }]}>{c.reason}</Text>
      {c.recommendation ? (
        <Text style={[type.micro, { color: accent.verdant, marginTop: 2, lineHeight: 15 }]}>→ {c.recommendation}</Text>
      ) : null}
    </View>
  );
}

type TimelineFilter = 'All' | 'Photos' | 'Care' | 'Insights';

/**
 * The one hero animation (§1.5): fills from empty on mount; on a score
 * change the ring drains slightly, then refills with a liquid ease while
 * the score counts up with it.
 */
function useLiquidScore(target: number): number {
  const [display, setDisplay] = useState(0);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    const from = prev.current ?? 0;
    if (target === prev.current) return;
    const mount = prev.current === null;
    prev.current = target;
    const dip = mount ? 0 : Math.max(0, Math.min(from, target) - 4);
    const start = Date.now();
    const D = mount ? 800 : 900;
    const id = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / D);
      let v: number;
      if (!mount && t < 0.25) {
        v = from + (dip - from) * (t / 0.25); // drain
      } else {
        const u = mount ? t : (t - 0.25) / 0.75;
        const e = 1 - Math.pow(1 - u, 3); // liquid ease-out refill
        v = dip + (target - dip) * e;
      }
      setDisplay(Math.round(v));
      if (t >= 1) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [target]);
  return display;
}

export default function PlantDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { plants, spots, sensors, settings, profile, calibrations, lightDaily, recordLightDay, logWaterAmount, dismissSoilJump, logCare, archivePlant, setPlantPhoto, renamePlant, setPotDimensions, setLightInverted } =
    useGreenr();
  const plant = plants.find((p) => p.id === id);
  const [depthInput, setDepthInput] = useState('');
  const [widthInput, setWidthInput] = useState('');
  const [dimsError, setDimsError] = useState<string | null>(null);
  const [potSizeEditing, setPotSizeEditing] = useState(false);
  const [shapeInput, setShapeInput] = useState<PotShape | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [careOpen, setCareOpen] = useState(false);
  const [signsOpen, setSignsOpen] = useState(false);
  const [waterOpen, setWaterOpen] = useState(false);
  const [jumpMl, setJumpMl] = useState('');
  const [customMl, setCustomMl] = useState('');
  const [waterLoggedMsg, setWaterLoggedMsg] = useState<string | null>(null);
  const [loggedCare, setLoggedCare] = useState<string | null>(null);
  const [filter, setFilter] = useState<TimelineFilter>('All');
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [photoAdded, setPhotoAdded] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  // Progressive disclosure: the page opens SIMPLE — score, what to do now, and
  // the four readings. Charts, care guide, trends and analysis sit behind one
  // toggle for anyone who wants them, instead of burying the answer in a wall.
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const spot = useMemo(() => spots.find((s) => s.id === plant?.spotId), [spots, plant]);
  const sensor = useMemo(() => sensors.find((s) => s.id === plant?.sensorId), [sensors, plant]);
  // The sensor reports on its own every ~3 h; this just shows the latest reading
  // and history (no live streaming).
  const { reading: liveReading, history: liveHistory, deviceId: liveDeviceId } = useLiveReading(
    typeof id === 'string' ? id : undefined,
  );
  const weather = useWeather(); // shares the cached location/weather; no extra prompt
  // Apply this sensor's calibration offsets so the whole screen — health,
  // status, watering, charts — uses corrected values consistently (§8/§6).
  // Device id first (real paired sensors), legacy demo sensor id as fallback.
  const cal = calibrationFor(calibrations, liveDeviceId, sensor?.id);
  const calReading = useMemo(
    () => (liveReading ? applyCalibration(liveReading, cal) : liveReading),
    [liveReading, cal],
  );
  const calHistory = useMemo(
    () => (cal ? liveHistory.map((r) => applyCalibration(r, cal)) : liveHistory),
    [liveHistory, cal],
  );
  // Multi-day daytime light average. The light metric is judged on this
  // accumulating average — not a single in-the-moment reading — so it gets more
  // accurate with each day of data. Today (and yesterday, if the window reaches
  // it) are computed from live history; older days come from the persisted store.
  const todayLight = useMemo(() => dayLight(calHistory), [calHistory]);
  const yesterdayLight = useMemo(() => dayLight(calHistory, Date.now() - 86400000), [calHistory]);
  const lightAvg = useMemo(
    () => recentLightAvg(lightDaily[plant?.id ?? ''] ?? [], todayLight),
    [lightDaily, plant?.id, todayLight],
  );
  /**
   * The light figure health actually scores against.
   *
   * The stored per-day history is only written while the plant screen is open,
   * so a sensor can gather light all day and still leave the store empty — which
   * left the Light metric stuck on "Awaiting daytime" every evening. Falling back
   * to the daytime average computed straight from the readings means an average
   * essentially always exists, and night simply reuses the day's measurement
   * instead of pretending we know nothing.
   */
  const lightAvgInput = useMemo(() => {
    if (lightAvg) return { avg: lightAvg.avg, days: lightAvg.days };
    const fromHistory = daytimeLightAvg(calHistory);
    return fromHistory ? { avg: fromHistory.avg, days: 1 } : null;
  }, [lightAvg, calHistory]);
  // Snapshot each day's light into the store so the average survives restarts and
  // keeps growing over calendar time (recordLightDay is a no-op when unchanged).
  useEffect(() => {
    if (!plant?.id) return;
    if (todayLight) recordLightDay(plant.id, todayLight);
    if (yesterdayLight) recordLightDay(plant.id, yesterdayLight);
  }, [plant?.id, todayLight, yesterdayLight, recordLightDay]);
  // What the soil is DOING: draining after a drink, settled, or drying out. This
  // is what stops a freshly watered plant scoring 0/30 for moisture.
  const soilDyn = useMemo(
    () => (plant && liveDeviceId ? soilDynamics(plant, calHistory, plant.comfortBand) : null),
    [plant, liveDeviceId, calHistory],
  );
  const waterReview = useMemo(
    () => (plant && liveDeviceId ? reviewWatering(plant, calHistory, plant.comfortBand) : null),
    [plant, liveDeviceId, calHistory],
  );
  // True from the moment a watering is logged until a fresh reading arrives.
  const justWatered = plant ? wateredSinceLastReading(plant, liveReading) : false;
  // …and once a reading HAS arrived, whether the pour actually showed up in the
  // soil. A logged watering that changes nothing is a real, actionable failure.
  const wateringMiss = plant && calHistory.length
    ? wateringDidNotRegister(plant, calHistory, plant.comfortBand)
    : null;
  /**
   * How long this pot really stays damp, read off the sensor's own dry-down
   * curve instead of the owner's estimate of it. `retention` is what every
   * moisture calculation on this screen should use — see lib/soilRetention.
   */
  const retentionEst = useMemo(
    () => (plant && liveDeviceId ? retentionEstimate(plant, calHistory) : null),
    [plant, liveDeviceId, calHistory],
  );
  const retention = retentionEst?.confident ? retentionEst.value : (plant?.soilRetention ?? null);
  /**
   * Explain the vertical moisture profile for THIS pot: the probe samples the
   * driest few centimetres, while the roots sit lower where a fixed-height
   * saturated layer keeps things wetter.
   */
  const soilProfileNote = useMemo(() => {
    if (!plant || !liveDeviceId) return null;
    const geo = { potHeightCm: plant.potHeightCm ?? 16, soilMix: plant.soilMix, soilRetention: retention };
    const reading = calReading?.soil_pct;
    if (reading == null) return null;
    // Invert the retention curve: what the probe read → how far the pot has
    // dried → what the roots below it are actually sitting in.
    const { rootZonePct, offset } = rootZoneFromReading(reading, geo);
    const pwt = perchedWaterTableCm(plant.soilMix ?? 'Standard mix', retention);
    return {
      geo,
      rootZonePct,
      offset,
      pwt,
      text: `The probe senses the top ${PROBE.insertCm} cm — the driest part of any pot, because height above the base IS suction. Below it a saturated layer about ${pwt.toFixed(1)} cm deep sits on the base, so the roots are holding roughly ${rootZonePct.toFixed(2)}% (${offset >= 0 ? '+' : ''}${offset.toFixed(2)} vs the probe). In this ${geo.potHeightCm} cm pot that layer is ${((pwt / geo.potHeightCm) * 100).toFixed(0)}% of the depth.`,
    };
  }, [plant, liveDeviceId, calReading, retention]);
  const settling = useMemo(() => (plant ? settlingState(plant) : null), [plant]);
  // The best substrate for this species, and whether what it is in now will do.
  const soilRecipe = useMemo(() => soilRecipeFor(plant?.species), [plant?.species]);
  /**
   * A watering the sensor saw and nobody recorded. Asking about it is how the
   * app recovers a measurement it would otherwise lose entirely.
   */
  // What the app is missing for this plant, and whether the probe can even read it.
  const setup = useMemo(() => (plant ? setupCompleteness(plant) : null), [plant]);
  const probe = useMemo(
    () =>
      plant && calHistory.length
        ? probeResolution(plant, calHistory, idealsFor(plant.species, plant.comfortBand).band)
        : null,
    [plant, calHistory],
  );
  const unlogged = useMemo(
    () => (plant && calHistory.length ? pendingWateringQuestion(plant, calHistory) : null),
    [plant, calHistory],
  );
  // How well the app's own amounts have held up against what was actually poured.
  const doseCheck = useMemo(
    () => (plant && calHistory.length ? doseAccuracy(plant, calHistory) : null),
    [plant, calHistory],
  );
  const soilFit = useMemo(
    () => mixVerdict(plant?.species, plant?.soilMix ?? null),
    [plant?.species, plant?.soilMix],
  );
  // "Is this spot actually working?" — only surfaced once several days of
  // readings independently agree, so a "move it" is never a knee-jerk call.
  const envIssues = useMemo(
    () =>
      plant && liveDeviceId
        ? confidentVerdicts({
            species: plant.species,
            plantName: plant.name,
            history: calHistory,
            ideal: idealsFor(plant.species, plant.comfortBand),
            unitsF: settings.unitsF,
            // Per-day light from the store: it remembers ~30 days, far beyond the
            // ~6 days of raw readings, so the light verdict has the most evidence.
            lightDaily: [...(lightDaily[plant.id] ?? []), ...(todayLight ? [todayLight] : [])],
            soilDyn,
          })
        : [],
    [plant, liveDeviceId, calHistory, settings.unitsF, lightDaily, todayLight, soilDyn],
  );
  // Multi-day averages for EVERY metric — a day is the honest unit, and these
  // get more trustworthy the longer the sensor runs.
  const norms = useMemo(
    () => ({
      soil: metricSummary(calHistory, 'soil'),
      temp: metricSummary(calHistory, 'temp'),
      humidity: metricSummary(calHistory, 'humidity'),
    }),
    [calHistory],
  );
  // Live health, computed from the sensor vs this species' ideals (§9). When
  // measured, it — not the seeded estimate — drives the hero ring (§3).
  const health = useMemo(
    () =>
      plant && liveDeviceId
        ? computeHealth(plant.species, plant.comfortBand, liveReading, liveHistory, settings.unitsF, cal, lightAvgInput, soilDyn)
        : null,
    [plant, liveDeviceId, liveReading, liveHistory, settings.unitsF, cal, lightAvgInput, soilDyn],
  );
  // A live sensor is authoritative: never show estimate visuals for it (§6).
  const sensored = liveDeviceId != null;
  const measured = !!health?.measured;
  const awaiting = sensored && !measured; // paired but no reading yet
  // Sensorless: a rigorous CARE-FIDELITY score from the user's logged behaviour
  // (rhythm, consistency, chosen spot, amounts) — no sensor, no invented
  // measurements. Null until there's enough logged behaviour to judge.
  const careScore = useMemo(
    () => (!sensored && plant ? computeCareScore(plant, spot) : null),
    [sensored, plant, spot],
  );
  // Sensorless + too new = no score at all yet ("building baseline"), because a
  // fresh plant's health simply isn't known — no invented numbers.
  const vit = plant
    ? vitalityFor(plant, sensored, liveReading, cal, settings.unitsF, lightAvgInput, careScore?.total ?? null)
    : null;
  const pending = !!vit?.pending;
  const showEstimate = !!plant?.estimate && !sensored && !pending && !careScore;
  const effectiveScore = measured ? health!.total : pending ? 0 : careScore?.total ?? plant?.score ?? 0;
  const displayScore = useLiquidScore(effectiveScore);

  // ── Every hook must run on EVERY render, so all of these sit above the
  // "plant not found" return. (React counts hooks positionally: returning early
  // while later hooks exist crashes with "rendered fewer/more hooks" the moment
  // a plant loads in after hydration.) Each one tolerates a missing plant.
  const ideal = idealsFor(plant?.species ?? '', plant?.comfortBand);
  const envLight = calReading?.light_lux ?? null;
  const envTemp = calReading?.temp_c ?? null;
  const envRh = calReading?.humidity_pct ?? null;
  const hasEnv = calReading != null;

  // Soil-hydration dynamics: infer poured volume from each watering's moisture
  // rise, learn the drying rate, and invert it into the efficient pour for the
  // plant's ideal interval. Sensored only (needs the moisture curve).
  const hydration = useMemo(
    () =>
      sensored && plant
        ? buildHydrationModel(
            calHistory,
            plant.waterLog,
            { size: plant.potSize, material: plant.potMaterial, cm: plant.potCm },
            ideal.band,
          )
        : null,
    [sensored, calHistory, plant, ideal.band],
  );
  const growth = useMemo(() => growthSummary(plant), [plant]);
  // Most recent logged pour with a known amount — powers a one-tap "repeat".
  const lastLoggedMl = useMemo(() => {
    const withMl = (plant?.waterLog ?? []).filter((w) => w.ml != null);
    return withMl.length ? (withMl[withMl.length - 1].ml as number) : null;
  }, [plant?.waterLog]);
  // Which species would thrive in THIS spot, from the sensor's real environment,
  // scored by the Habitat Suitability model. Memoized — it scans the whole DB.
  const spotMatches = useMemo(
    () =>
      hasEnv && plant
        ? plantsForEnvironment(envLight, envTemp, envRh, 5).filter((m) => m.species.common !== plant.species)
        : [],
    [hasEnv, envLight, envTemp, envRh, plant],
  );
  // How well THIS plant scores in its own spot — same math, comparable number.
  const selfMatch: Match | null = useMemo(
    () => (hasEnv && plant ? scoreSpeciesForEnvironment(plant.species, envLight, envTemp, envRh) : null),
    [hasEnv, envLight, envTemp, envRh, plant],
  );
  // The physically-grounded DLI estimate for this spot (log-photometry). Prefer
  // the accumulated multi-day light average when we have it.
  const dliHere = useMemo(() => {
    if (lightAvg) return estimateDli(lightAvg.avg);
    if (envLight != null) return estimateDli(envLight);
    return null;
  }, [lightAvg, envLight]);

  if (!plant) {
    return (
      <View style={{ flex: 1, backgroundColor: dark.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.body, { color: dark.inkMuted }]}>Plant not found.</Text>
      </View>
    );
  }

  const band = bandFor(effectiveScore);
  const toneColor = (t: Tone) =>
    t === 'good' ? accent.sage : t === 'warn' ? accent.sunbeam : t === 'bad' ? accent.clay : dark.inkMuted;
  const watering = liveDeviceId ? wateringAdvice(calHistory, ideal.band, plant.species) : null;
  // Outdoor plants fold the forecast into the watering call (rain → hold off;
  // heat → sooner). The sensor's drying trend stays the ground truth.
  const outdoor = !!spot?.outdoor;
  const schedule = liveDeviceId
    ? computeSchedule(calHistory, ideal.band, plant.species, { weather: weather.weather, outdoor })
    : null;
  const wImpact = weatherWateringImpact(weather.weather, outdoor);
  const insights = liveDeviceId ? insightsFor(calHistory, plant.species, ideal.band) : [];
  // Sensorless: the honest watering cycle (last watered + species cadence + logs)
  // and qualitative needs in words — no invented measurements.
  const estSchedule = !sensored ? estimateWaterSchedule(plant) : null;
  const qualNeeds = !sensored ? qualitativeNeeds(plant.species) : [];
  // Sensored: judge whether this spot's light suits it — from the MULTI-DAY
  // average once we have one (more days = more accurate), falling back to the
  // single-day daytime average until then.
  const bench = sensored
    ? lightAvg
      ? lightVerdict(lightAvg.avg, plant.species, ideal.dli, { days: lightAvg.days, hours: lightAvg.hours })
      : lightBenchmark(calHistory, plant.species, ideal.dli)
    : null;
  const careProfile = careProfileFor(plant.species);
  // Seasonal context + the personalized water plan (pot volume × species draw ×
  // measured climate × season — the real calculation, factors listed).
  const season = currentSeason();
  const seasonNotes = seasonalNotes(season);
  const userTips = tipsFor({ experience: profile?.experience, struggle: profile?.struggle, season, count: 3 });
  const groom = groomingTip(plant.species, profile?.experience);
  const plan = waterPlan({
    species: plant.species,
    potSize: plant.potSize,
    potMaterial: plant.potMaterial,
    potCm: plant.potCm,
    tempC: calReading?.temp_c,
    humidityPct: calReading?.humidity_pct,
    lightAvg: lightAvg?.avg ?? null,
  });
  const batteryPct = calReading?.battery_pct;
  // The efficient pour for this plant's ideal interval, learned from its own
  // moisture curve — the volume that lasts the target gap without overwatering.
  const efficientPour = hydration
    ? hydration.mlForDays(plan.intervalDays, calReading?.soil_pct ?? ideal.band[0], ideal.band)
    : null;
  /**
   * THE amount to pour — one number, used everywhere.
   *
   * There used to be three competing figures on this screen (a partial "refill to
   * mid-band", the calculated plan, and the learned pour), which left people
   * reading "water 500 ml" directly above "1050 ml every 7 days". Beyond being
   * confusing it was also poor practice: a partial top-up wets only part of the
   * root ball and leaves dry pockets. Correct watering is a THOROUGH soak until
   * it drains — so the volume is constant and only the timing changes.
   * Preference: the volume learned from this plant's own curve, else the
   * calculated plan.
   */
  // The ONE shared figure (lib/watering → recommendedPourMl), so Home, Forecast,
  // Care Mode and this screen can never disagree again.
  const pourEnv = {
    tempC: calReading?.temp_c,
    humidityPct: calReading?.humidity_pct,
    lightAvg: lightAvg?.avg ?? null,
    // With a live reading the amount is the MEASURED deficit, not a routine soak.
    soilPct: calReading?.soil_pct,
    targetPct: Math.round((ideal.band[0] + ideal.band[1]) / 2),
  };
  /**
   * The closed loop: dose → predict → observe → correct.
   *
   * `step` is what to pour now. Until this pot has taught us its own
   * millilitres-per-point, that is a deliberately modest TRIAL sized to produce a
   * clearly readable rise, together with the rise we expect. `outcome` reads the
   * next sensor report back and says whether the prediction held — and it is that
   * pairing, not the model, that the amount eventually rests on.
   */
  const calibration =
    hydration && hydration.fit.n >= 2
      ? { mlPerPoint: hydration.fit.k, pairs: hydration.fit.n, r2: hydration.fit.r2 }
      : null;
  /**
   * The shared decision (lib/waterAction) — the same one Home, Care Mode and the
   * alert engine use. This screen used to call `pourStep` directly, which doses
   * toward the MID-BAND target rather than the floor, so a plant sitting happily
   * at 31% in a 30–55% band was quoted a litre while Home correctly said nothing.
   *
   * Two distinct numbers, deliberately kept apart:
   *   actionMl  — pour this NOW. Zero unless the plant actually needs water.
   *   routineMl — what a normal drink for this plant is, for the schedule line
   *               and as the default when someone chooses to water anyway.
   */
  const action = waterAction({ plant, reading: calReading, history: calHistory });
  const step = action.step ?? pourStep(plant, pourEnv, calibration);
  const actionMl = action.ml;
  const routineMl = plan.ml;
  const pourMl = actionMl > 0 ? actionMl : routineMl;
  const outcome = calHistory.length ? pourOutcome(plant, calHistory) : null;
  // Volume scales with the CUBE of the diameter, so an unmeasured depth is the
  // biggest single source of error in every ml figure on this screen. When it's
  // missing, say so and ask — don't quote a confident number built on a guess.
  const potVol = potVolume(plant);

  /**
   * Growth conditions the sensor can already see. VPD is the one that explains
   * "everything is right but nothing is happening": above ~1.6 kPa stomata shut,
   * so CO2 stops coming in and growth halts regardless of light and water.
   */
  const air = calReading
    ? (() => {
        const kpa = vpdKpa(calReading.temp_c, calReading.humidity_pct);
        if (kpa == null) return null;
        const cat = getSpecies(plant.species)?.category;
        return vpdVerdict(kpa, cat === 'cactus' || cat === 'succulent');
      })()
    : null;
  const risks = calHistory.length ? pestRisks(calHistory, ideal.band) : [];
  const rootBound = rootBoundSignal(hydration);
  /**
   * Everything that shaped `pourMl`, in plain language. The amount is not a
   * lookup — it comes from the measured deficit, the pot's real volume, the
   * medium's leaching, the wall losses, and the depth physics. Showing the terms
   * is what makes it checkable rather than oracular.
   */
  const pourFactors = (() => {
    if (calReading?.soil_pct == null) return null;
    // Both of these must see the SAME retention the dose was computed with
    // (waterAction substitutes the measured value), or this explanation would
    // describe an amount the app never quoted.
    const wet = wettingFor({
      potMaterial: plant.potMaterial,
      soilMix: plant.soilMix,
      soilRetention: retention,
      hasDrainage: plant.hasDrainage,
    });
    const corr = plant.potHeightCm
      ? profileCorrection({
          potHeightCm: plant.potHeightCm,
          soilMix: plant.soilMix,
          soilRetention: retention,
        })
      : null;
    const style = waterProfileFor(plant.species).style;
    const out = [
      style === 'soak-and-dry'
        ? `Soil is ${calReading.soil_pct.toFixed(0)}%. ${plant.species} is a soak-and-dry plant, so it gets a thorough drenching now and then nothing until it is bone dry`
        : style === 'constantly-damp'
          ? `Soil is ${calReading.soil_pct.toFixed(0)}%. ${plant.species} must never dry out, so it is kept deliberately wet`
          : `Soil is ${calReading.soil_pct.toFixed(0)}% and ${plant.species} wants ${pourEnv.targetPct}%`,
      `${potVol.liters.toFixed(1)} L of mix (${potVol.basis})`,
      ...wet.notes,
    ];
    if (corr?.note) out.push(corr.note);
    return out;
  })();
  /**
   * What the pour WOULD be with the dimensions currently being typed. Showing
   * this live is the point of the whole prompt: the person can watch the
   * measurement they just took turn into the millilitres they should pour, so
   * it reads as one connected calculation rather than a form to fill in.
   */
  const draft = (() => {
    if (!potVol.heightAssumed) return null;
    const parse = (s: string) => {
      const n = parseFloat(s.replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    };
    const w = plant.potCm ?? parse(widthInput);
    const d = plant.potHeightCm ?? parse(depthInput);
    if (w == null || d == null || w < 5 || w > 80 || d < 3 || d > 100) return null;
    const shape = shapeInput ?? plant.potShape ?? 'tapered';
    const vol = potVolume({ potSize: plant.potSize, potCm: w, potHeightCm: d, potShape: shape });
    const ml = recommendedPourMl({ ...plant, potCm: w, potHeightCm: d, potShape: shape }, pourEnv);
    return { liters: vol.liters, ml, w, d };
  })();
  /**
   * Ask for the pot's real size. Kept OUT of the watering section on purpose:
   * that section only renders once there is soil history, so a plant still
   * awaiting its first reading could never be measured — which is exactly when
   * getting the volume right matters most.
   */
  const potSizePrompt = potVol.heightAssumed || potSizeEditing ? (

    <Card accentBorder={accent.clay}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Ionicons name="resize-outline" size={18} color={accent.clay} style={{ marginTop: 1 }} />
        <Text style={[type.caption, { color: dark.inkMuted, flex: 1, lineHeight: 19 }]}>
          <Text style={{ color: dark.ink }}>
            {potSizeEditing && !potVol.heightAssumed
              ? 'Update the pot size'
              : plant.potCm == null && plant.potHeightCm == null
                ? 'How big is this pot?'
                : plant.potCm == null
                  ? 'How wide is this pot?'
                  : 'How deep is this pot?'}
          </Text>{' '}
          {potSizeEditing && !potVol.heightAssumed
            ? `Currently ${potVol.basis} — ${potVol.liters.toFixed(1)} L of soil. Correct a mistyped figure, or put in the new pot's size after repotting.`
            : `Greenr is working from ${potVol.liters.toFixed(1)} L of soil (${potVol.basis}). Pot size is the biggest thing that moves this number — measure across the top and down to the soil, and the amount becomes properly accurate.`}
        </Text>
      </View>
      {/* Volume needs BOTH dimensions, so ask for whichever are
          missing — saving only one would silently change nothing.
          One labelled row per field: cramming them side by side made
          the boxes too narrow to read a typed decimal. */}
      {[
        (potSizeEditing || plant.potCm == null) && {
          key: 'w',
          label: 'Width across the top',
          hint: 'the widest point, rim to rim',
          value: widthInput,
          set: setWidthInput,
          placeholder: '18',
        },
        (potSizeEditing || plant.potHeightCm == null) && {
          key: 'd',
          label: 'Soil depth',
          hint: 'soil surface down to the base',
          value: depthInput,
          set: setDepthInput,
          placeholder: '16',
        },
      ]
        .filter((f): f is Exclude<typeof f, false> => f !== false)
        .map((f) => (
          <View key={f.key} style={{ marginTop: 10 }}>
            <Text style={[type.micro, { color: dark.ink }]}>{f.label}</Text>
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 1 }]}>
              {f.hint}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
              <TextInput
                value={f.value}
                onChangeText={f.set}
                placeholder={f.placeholder}
                placeholderTextColor={dark.inkMuted}
                keyboardType="decimal-pad"
                inputMode="decimal"
                style={{
                  width: 110,
                  paddingVertical: 11,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  backgroundColor: dark.surface2,
                  color: dark.ink,
                  fontSize: 18,
                  letterSpacing: 0.5,
                }}
              />
              <Text style={[type.body, { color: dark.inkMuted }]}>cm</Text>
            </View>
          </View>
        ))}
      {/* Shape is worth ±20% of the volume — a frustum is (1+k+k²)/3 of its
          cylinder — so it is asked alongside the two lengths, not assumed. */}
      <View style={{ marginTop: 12 }}>
        <Text style={[type.micro, { color: dark.ink }]}>Pot shape</Text>
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 1 }]}>
          how much it narrows towards the base
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          {(
            [
              ['straight', 'Straight'],
              ['tapered', 'Tapered'],
              ['very-tapered', 'Very tapered'],
            ] as [PotShape, string][]
          ).map(([val, label]) => {
            const on = (shapeInput ?? plant.potShape ?? 'tapered') === val;
            return (
              <Pressable
                key={val}
                onPress={() => setShapeInput(val)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 10,
                  alignItems: 'center',
                  backgroundColor: on ? `${accent.verdant}28` : dark.surface2,
                  borderWidth: 1,
                  borderColor: on ? accent.verdant : 'transparent',
                }}
              >
                <Text style={[type.micro, { color: on ? dark.ink : dark.inkMuted, fontWeight: on ? '700' : '400' }]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {/* The payoff, live: measurement → soil volume → millilitres. */}
      {draft && (
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            marginTop: 12,
            padding: 10,
            borderRadius: 10,
            backgroundColor: `${accent.verdant}18`,
          }}
        >
          <Ionicons name="arrow-forward-circle" size={16} color={accent.verdant} style={{ marginTop: 1 }} />
          <Text style={[type.micro, { color: dark.inkMuted, flex: 1, lineHeight: 16 }]}>
            {draft.w} × {draft.d} cm ={' '}
            <Text style={{ color: dark.ink }}>{draft.liters.toFixed(1)} L of soil</Text>, so
            this plant needs{' '}
            <Text style={[type.numBold as any, { color: accent.verdant }]}>
              {draft.ml} ml
            </Text>{' '}
            right now{pourMl !== draft.ml ? `, not the ${pourMl} ml estimated above` : ''}. Save
            to lock it in.
          </Text>
        </View>
      )}
      <Pressable
        onPress={() => {
          const parse = (s: string) => {
            const n = parseFloat(s.replace(',', '.'));
            return Number.isFinite(n) ? n : NaN;
          };
          const w = parse(widthInput);
          const d = parse(depthInput);
          const okW = Number.isFinite(w) && w >= 5 && w <= 80;
          const okD = Number.isFinite(d) && d >= 3 && d <= 100;
          const needW = potSizeEditing || plant.potCm == null;
          const needD = potSizeEditing || plant.potHeightCm == null;
          // Only save once everything still missing has a valid
          // value, so a half-filled form can't look like it worked.
          if ((!needW || okW) && (!needD || okD)) {
            const before = potVol;
            setPotDimensions(plant.id, {
              potCm: needW ? Math.round(w * 10) / 10 : null,
              potHeightCm: needD ? Math.round(d * 10) / 10 : null,
              potShape: shapeInput ?? plant.potShape ?? 'tapered',
            });
            // Repotting is a real horticultural event — a bigger pot changes
            // drying rate and watering volume for months, so it belongs in the
            // plant's history rather than silently changing the numbers.
            const after = potVolume({
              potSize: plant.potSize,
              potCm: needW ? Math.round(w * 10) / 10 : plant.potCm,
              potHeightCm: needD ? Math.round(d * 10) / 10 : plant.potHeightCm,
              potShape: shapeInput ?? plant.potShape ?? 'tapered',
            });
            if (!before.heightAssumed && Math.abs(after.liters - before.liters) > 0.2) {
              logCare(
                plant.id,
                `Pot size updated: ${before.liters.toFixed(1)} L → ${after.liters.toFixed(1)} L (${after.basis})`,
              );
            }
            setWidthInput('');
            setDepthInput('');
            setDimsError(null);
            setPotSizeEditing(false);
            setShapeInput(null);
          } else {
            setDimsError(
              needW && needD
                ? 'Enter both measurements — width 5–80 cm, depth 3–100 cm.'
                : needW
                  ? 'Enter the width across the top, between 5 and 80 cm.'
                  : 'Enter the soil depth, between 3 and 100 cm.',
            );
          }
        }}
        style={{
          marginTop: 12,
          paddingVertical: 12,
          borderRadius: 10,
          backgroundColor: accent.verdant,
          alignItems: 'center',
        }}
      >
        <Text style={[type.caption, { color: '#04140b', fontWeight: '700' }]}>
          {potSizeEditing && !potVol.heightAssumed ? 'Save new pot size' : 'Save pot size'}
        </Text>
      </Pressable>
      {potSizeEditing && (
        <Pressable
          onPress={() => {
            setPotSizeEditing(false);
            setWidthInput('');
            setDepthInput('');
            setDimsError(null);
          }}
          style={{ marginTop: 8, paddingVertical: 8, alignItems: 'center' }}
        >
          <Text style={[type.micro, { color: dark.inkMuted }]}>Cancel</Text>
        </Pressable>
      )}
      {dimsError && (
        <Text style={[type.micro, { color: accent.clay, marginTop: 8, lineHeight: 15 }]}>
          {dimsError}
        </Text>
      )}
    </Card>
  ) : null;

  /**
   * The ONE thing to do right now, shown at the very top of the page.
   *
   * Ranked by real urgency: roots rotting beats a dry pot beats a wrong spot.
   * It is derived from the live reading, so it clears itself the moment the
   * sensor shows the problem is fixed — nothing to dismiss, nothing to go stale.
   * Returns null when the plant is genuinely fine, and then the page opens calm.
   */
  const todo = (() => {
    if (!plant || !sensored) return null;
    // Just watered? Then every "needs water" prompt is stale until the sensor
    // reports again — otherwise tapping "log" appears to do nothing.
    if (justWatered)
      return {
        urgent: false,
        icon: 'checkmark-circle',
        title: 'Watered — waiting for the sensor to confirm',
        detail: `You logged a watering. The sensor reports every few hours, so the soil reading above is from before you poured. It'll update on the next report.`,
        action: null as string | null,
        onPress: () => {},
      };
    // The sensor HAS reported since the pour, and the soil never moved. Ranked
    // above "too dry" because the soil genuinely is dry — but repeating the same
    // instruction would just repeat the same failure.
    if (wateringMiss)
      return {
        urgent: true,
        icon: 'alert-circle',
        title: `That watering didn't reach the soil`,
        // Offer the retry directly: the failure mode is a pour that ran past the
        // root ball, and the fix is to pour again more slowly. Logging it again
        // also re-arms the check, so the next reading either confirms the second
        // attempt worked or says so once more.
        detail: wateringMiss.text,
        action: `Water again — log ${pourMl} ml`,
        onPress: () => doLogWater(pourMl),
      };
    // 1. Waterlogged — the fastest way to actually kill a plant.
    if (soilDyn?.drainageProblem)
      return {
        urgent: true,
        icon: 'warning',
        title: 'Water is not draining away',
        detail: soilDyn.detail,
        action: null as string | null,
        onPress: () => {},
      };
    // 2. Too dry — needs water now.
    if (watering?.tone === 'bad')
      return {
        urgent: true,
        icon: 'water',
        title: `Water ${plant.name} — about ${pourMl} ml`,
        detail: `${watering.detail} Pour slowly until it runs from the drainage holes, then empty the saucer.`,
        action: `Log ${pourMl} ml watering`,
        onPress: () => doLogWater(pourMl),
      };
    // 3. A confidently wrong spot (several days of readings agree).
    const worst = envIssues[0];
    if (worst)
      return {
        urgent: false,
        icon: worst.relocate ? 'move' : 'construct-outline',
        title: worst.headline,
        detail: `${worst.detail} ${worst.action}`,
        action: worst.relocate ? `Move ${plant.name} to another spot` : null,
        onPress: () => router.push({ pathname: '/move/[id]', params: { id: plant.id } }),
      };
    // 4. Drying out — worth doing, not urgent.
    if (watering?.tone === 'warn')
      return {
        urgent: false,
        icon: 'water-outline',
        title: `${plant.name} will want water soon`,
        detail: `${watering.detail} When you do, give it about ${pourMl} ml.`,
        action: `Log ${pourMl} ml watering`,
        onPress: () => doLogWater(pourMl),
      };
    return null;
  })();
  const growthLine = growthHeadline(growth);

  const doLogWater = (ml: number, source: WaterAmountSource = 'preset') => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Record the predicted rise ALONGSIDE the amount. Without it the next reading
    // can only say what happened, not whether we called it correctly — and it is
    // the comparison that calibrates this pot.
    const predicted =
      step.predictedRisePts != null && ml > 0 && step.ml > 0
        ? (step.predictedRisePts * ml) / step.ml
        : null;
    /*
     * Record what was POURED, what was SUGGESTED, and how the amount was arrived
     * at — all three, because only together do they let the app grade itself.
     * With just the amount it can say the soil rose; with the suggestion beside it
     * it can say "we asked for 900 ml and 400 was plenty", which is the correction
     * rather than the anecdote. And `source` is what stops a suggestion the owner
     * merely accepted from being read back later as a measurement of their pot.
     */
    logWaterAmount(plant.id, ml, { predictedRisePts: predicted, suggestedMl: pourMl, source });
    setWaterOpen(false);
    setCustomMl('');
    setWaterLoggedMsg(`Logged ${ml} ml 💧`);
    setTimeout(() => setWaterLoggedMsg((m) => (m ? null : m)), 1800);
  };

  const logCustomWater = () => {
    const ml = parseInt(customMl.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(ml) || ml <= 0) return;
    doLogWater(Math.min(ml, 5000), 'measured');
  };
  // The diagnose camera is a Greenr+ feature — route non-subscribers to the sheet.
  const openDiagnose = () =>
    settings.plus
      ? router.push({ pathname: '/diagnose/[id]', params: { id: plant.id } })
      : router.push('/plus');
  // Charts plot only real readings — a missing metric is skipped, never drawn as 0.
  const soilBars = calHistory.filter((r) => r.soil_pct != null);
  const lightBars = calHistory.filter((r) => r.light_lux != null);
  const events = plant.timeline.filter((e) => {
    if (filter === 'All') return true;
    if (filter === 'Photos') return e.kind === 'photo';
    if (filter === 'Care') return e.kind === 'care';
    return e.kind === 'insight' || e.kind === 'diagnosis' || e.kind === 'band-change';
  });

  if (showCamera) {
    return (
      <CameraCapture
        caption={`A new photo for ${plant.name}.`}
        onCapture={(uri) => {
          setPlantPhoto(plant.id, uri);
          setShowCamera(false);
          setPhotoAdded(true);
          setTimeout(() => setPhotoAdded(false), 2000);
        }}
        onCancel={() => setShowCamera(false)}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: dark.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 116 }} showsVerticalScrollIndicator={false}>
        {/* ── Hero ── */}
        <View style={{ borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden' }}>
          <LinearGradient colors={[dark.heroTop, dark.heroBottom]} style={{ paddingTop: insets.top + 8, paddingHorizontal: layout.margin, paddingBottom: 26 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
                <Ionicons name="chevron-back" size={24} color={dark.ink} />
              </Pressable>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {sensored && (
                  <Pressable
                    onPress={() => router.push(`/dashboard/${plant.id}` as any)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      minHeight: 36,
                      paddingHorizontal: 12,
                      borderRadius: 18,
                      backgroundColor: `${accent.verdant}22`,
                      borderWidth: 1,
                      borderColor: `${accent.verdant}55`,
                    }}
                  >
                    <Ionicons name="stats-chart" size={14} color={accent.verdant} />
                    <Text style={[type.caption, { color: accent.verdant }]}>Graphs</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => setMenuOpen(!menuOpen)} style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}>
                  <Ionicons name="ellipsis-horizontal" size={22} color={dark.ink} />
                </Pressable>
              </View>
            </View>

            {menuOpen && (
              <Card elevated style={{ position: 'absolute', right: 16, top: insets.top + 52, zIndex: 10, width: 200, gap: 4 }}>
                {['Rename', 'Move spot', 'Mark as gifted', 'Archive / Died'].map((item) => (
                  <Pressable
                    key={item}
                    onPress={() => {
                      setMenuOpen(false);
                      if (item === 'Rename') {
                        setRenameText(plant.name);
                        setRenameOpen(true);
                      } else if (item === 'Move spot') {
                        router.push({ pathname: '/move/[id]', params: { id: plant.id } });
                      } else if (item === 'Mark as gifted') {
                        archivePlant(plant.id, 'Gifted');
                        router.back();
                      } else if (item === 'Archive / Died') {
                        router.push({ pathname: '/autopsy/[id]', params: { id: plant.id } });
                      }
                    }}
                    style={{ minHeight: 40, justifyContent: 'center' }}
                  >
                    <Text style={[type.body, { color: item.includes('Died') ? accent.clay : dark.ink }]}>{item}</Text>
                  </Pressable>
                ))}
              </Card>
            )}

            {renameOpen && (
              <Card elevated style={{ marginTop: 4 }}>
                <Text style={[type.micro, { color: dark.inkMuted }]}>NAME</Text>
                <TextInput
                  value={renameText}
                  onChangeText={setRenameText}
                  autoFocus
                  style={[type.cardTitle, { color: dark.ink, marginTop: 4, minHeight: 36 }]}
                />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <GButton title="Cancel" kind="secondary" style={{ flex: 1, minHeight: 40 }} onPress={() => setRenameOpen(false)} />
                  <GButton
                    title="Save"
                    style={{ flex: 1, minHeight: 40 }}
                    onPress={() => {
                      if (renameText.trim()) renamePlant(plant.id, renameText.trim());
                      setRenameOpen(false);
                    }}
                  />
                </View>
              </Card>
            )}

            <View style={{ alignItems: 'center', marginTop: 6 }}>
              <Breathing enabled={!awaiting && !pending && effectiveScore >= 85}>
                {plant.photoUri ? (
                  <VitalityRing
                    score={awaiting || pending ? 0 : displayScore}
                    size={132}
                    estimate={showEstimate}
                    estimateBand={showEstimate ? plant.estimateBand : 0}
                    showLabel={false}
                    trackColor={dark.hairline}
                  >
                    <PlantAvatar photoUri={plant.photoUri} emoji={plant.emoji} size={96} />
                  </VitalityRing>
                ) : (
                  <VitalityRing
                    score={awaiting || pending ? 0 : displayScore}
                    size={132}
                    estimate={showEstimate}
                    estimateBand={showEstimate ? plant.estimateBand : 0}
                    subLabel={
                      awaiting
                        ? 'Awaiting reading'
                        : pending
                          ? 'Building baseline'
                          : showEstimate
                            ? `${band.word} · estimate`
                            : band.word
                    }
                    showLabel={!awaiting && !pending}
                    trackColor={dark.hairline}
                  />
                )}
              </Breathing>
              {awaiting ? (
                <Text style={[type.caption, { color: dark.inkMuted, marginTop: 10 }]}>Awaiting first reading</Text>
              ) : pending ? (
                <Text style={[type.caption, { color: dark.inkMuted, marginTop: 10 }]}>
                  N/A · Building baseline
                </Text>
              ) : plant.photoUri ? (
                <Text style={[type.num as any, { fontSize: 15, color: band.color, marginTop: 10 }]}>
                  {displayScore}
                  {showEstimate ? ` ±${plant.estimateBand}` : ''} · {band.word}
                </Text>
              ) : null}
              {pending && (
                <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4, textAlign: 'center' }]}>
                  Log a couple of waterings to start a care rating now, or reach day {BASELINE_DAYS} (day{' '}
                  {vit?.baselineDay ?? 1} now). A sensor scores it instantly.
                </Text>
              )}
              <Text
                style={[type.screenTitle, { color: dark.ink, marginTop: 14, paddingHorizontal: 16, textAlign: 'center' }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {plant.name}
              </Text>
              <Text style={[type.caption, { color: dark.inkMuted, marginTop: 3, paddingHorizontal: 16 }]} numberOfLines={1}>
                {plant.latin} · {spot?.name ?? '—'}
              </Text>
              {sensored ? (
                <Pressable onPress={() => router.push('/devices' as any)} style={{ marginTop: 10, flexDirection: 'row', gap: 6 }}>
                  <Chip label={measured ? 'Sensor connected · real data' : 'Sensor connected · awaiting reading'} color={accent.sage} />
                  {batteryPct != null && batteryPct >= 0 && (
                    <Chip
                      label={`🔋 ${Math.round(batteryPct)}%`}
                      color={batteryPct <= 20 ? accent.clay : batteryPct <= 40 ? accent.sunbeamText : accent.sage}
                    />
                  )}
                </Pressable>
              ) : sensor ? (
                <Pressable onPress={() => router.push(`/sensor/${sensor.id}`)} style={{ marginTop: 10 }}>
                  <Chip label={`${sensor.name} · soil ${sensor.latest.soilPct}%`} color={accent.verdant} />
                </Pressable>
              ) : (
                <Pressable onPress={() => router.push('/pair-device' as any)} style={{ marginTop: 10 }}>
                  <Chip label="Estimated — a sensor makes it exact" color={accent.sunbeamText} />
                </Pressable>
              )}
            </View>
          </LinearGradient>
        </View>

        <View style={{ paddingHorizontal: layout.margin }}>
          {/* ══════════ WHAT'S MISSING ══════════
              Shown high because it is the cheapest accuracy on the page and the
              only thing here the app cannot work out for itself. Only when a
              MATERIAL field is missing — the pot shape alone is not worth a
              card. */}
          {setup?.degraded && setup.worst && (
            <Card style={{ marginTop: 18, borderWidth: 1.5, borderColor: accent.sunbeam }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="construct-outline" size={18} color={accent.sunbeam} />
                <Text style={[type.micro, { color: accent.sunbeam, letterSpacing: 0.6, flex: 1 }]}>
                  GREENR IS MISSING SOMETHING
                </Text>
                <Text style={[type.numBold as any, { color: accent.sunbeam }]}>{setup.score}%</Text>
              </View>
              <Text style={[type.ritualTitle, { color: dark.ink, fontSize: 21, marginTop: 8 }]}>
                {setup.worst.label}
              </Text>
              <Text style={[type.body, { color: dark.inkMuted, marginTop: 8, lineHeight: 21 }]}>
                {setup.worst.consequence}
              </Text>
              {setup.gaps.length > 1 && (
                <Text style={[type.micro, { color: dark.inkMuted, marginTop: 8, lineHeight: 15 }]}>
                  Also missing: {setup.gaps.slice(1).map((g) => g.label.toLowerCase()).join(', ')}.
                </Text>
              )}
              <Pressable
                onPress={() => {
                  if (setup.worst!.fix === 'repot') router.push(`/repot/${plant.id}` as any);
                  else {
                    setWidthInput(String(plant.potCm ?? ''));
                    setDepthInput(String(plant.potHeightCm ?? ''));
                    setPotSizeEditing(true);
                  }
                }}
                style={{
                  minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: accent.sunbeam, marginTop: 14,
                }}
              >
                <Text style={[type.cardTitle, { color: '#08110B', fontSize: 15 }]}>Set it now</Text>
              </Pressable>
            </Card>
          )}

          {/* ══════════ DID YOU WATER? ══════════
              Placed above everything, including "do this now", because it is the
              cheapest high-value action on the screen: one tap turns a watering
              the sensor already witnessed into a measurement of this exact pot.
              Left unasked, that data is gone for good. */}
          {unlogged && (
            <Card style={{ marginTop: 18, borderWidth: 1.5, borderColor: accent.verdant }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="help-circle-outline" size={18} color={accent.verdant} />
                <Text style={[type.micro, { color: accent.verdant, letterSpacing: 0.6, flex: 1 }]}>
                  DID YOU WATER THIS?
                </Text>
              </View>
              <Text style={[type.ritualTitle, { color: dark.ink, fontSize: 21, marginTop: 8 }]}>
                Soil jumped {Math.round(unlogged.fromPct)}% → {Math.round(unlogged.settledPct ?? unlogged.peakPct)}%
              </Text>
              <Text style={[type.body, { color: dark.inkMuted, marginTop: 8, lineHeight: 21 }]}>
                {unlogged.text}
              </Text>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                {[
                  unlogged.estimatedMl ?? 250,
                  Math.max(25, Math.round(((unlogged.estimatedMl ?? 250) * 0.5) / 25) * 25),
                  Math.round(((unlogged.estimatedMl ?? 250) * 2) / 25) * 25,
                ]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map((ml, i) => (
                    <Pressable
                      key={ml}
                      onPress={() => {
                        logWaterAmount(plant.id, ml, {
                          at: new Date(unlogged.at).toISOString(),
                          source: 'preset',
                          predictedRisePts: unlogged.risePts,
                        });
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                        setWaterLoggedMsg(`Logged ${ml} ml 💧`);
                        setTimeout(() => setWaterLoggedMsg((m) => (m ? null : m)), 1800);
                      }}
                      style={{
                        flexGrow: 1, minWidth: 92, minHeight: 48, borderRadius: 12,
                        alignItems: 'center', justifyContent: 'center',
                        borderWidth: i === 0 ? 2 : 1,
                        borderColor: i === 0 ? accent.verdant : dark.hairline,
                        backgroundColor: dark.surface2,
                      }}
                    >
                      <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]}>{ml} ml</Text>
                      {i === 0 && (
                        <Text style={[type.micro, { color: accent.verdant }]}>
                          {unlogged.estimateBasis === 'measured' ? 'best guess' : 'rough guess'}
                        </Text>
                      )}
                    </Pressable>
                  ))}
              </View>

              {/* Typing the real number is worth far more than any preset, so the
                  input sits right here rather than behind another tap. */}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <View
                  style={{
                    flex: 1, flexDirection: 'row', alignItems: 'center', borderWidth: 1,
                    borderColor: dark.hairline, borderRadius: 12, paddingHorizontal: 12, minHeight: 48,
                  }}
                >
                  <TextInput
                    value={jumpMl}
                    onChangeText={setJumpMl}
                    placeholder="or type the exact amount"
                    placeholderTextColor={dark.inkMuted}
                    keyboardType="number-pad"
                    style={{ flex: 1, color: dark.ink, fontSize: 15, paddingVertical: 10 }}
                  />
                  <Text style={[type.caption, { color: dark.inkMuted }]}>ml</Text>
                </View>
                <Pressable
                  onPress={() => {
                    const ml = parseInt(jumpMl.replace(/[^0-9]/g, ''), 10);
                    if (!Number.isFinite(ml) || ml <= 0) return;
                    logWaterAmount(plant.id, Math.min(ml, 5000), {
                      at: new Date(unlogged.at).toISOString(),
                      source: 'measured',
                      predictedRisePts: unlogged.risePts,
                    });
                    setJumpMl('');
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                    setWaterLoggedMsg(`Logged ${Math.min(ml, 5000)} ml 💧`);
                    setTimeout(() => setWaterLoggedMsg((m) => (m ? null : m)), 1800);
                  }}
                  style={{
                    minHeight: 48, paddingHorizontal: 18, borderRadius: 12,
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: jumpMl ? accent.verdant : dark.surface2,
                  }}
                >
                  <Text style={[type.cardTitle, { color: jumpMl ? '#08110B' : dark.inkMuted, fontSize: 14 }]}>Log</Text>
                </Pressable>
              </View>

              <Pressable
                onPress={() => dismissSoilJump(plant.id, new Date(unlogged.at).toISOString())}
                style={{ minHeight: 40, justifyContent: 'center', marginTop: 6 }}
              >
                <Text style={[type.caption, { color: dark.inkMuted }]}>
                  No — that wasn&apos;t me watering
                </Text>
              </Pressable>
            </Card>
          )}

          {/* ══════════ DO THIS NOW ══════════
              The single most urgent thing, at the very top, before any data.
              Someone opening this page usually wants "is anything wrong, and what
              do I do?" — not a dashboard to interpret. It disappears by itself
              once the reading shows the problem is resolved. */}
          {todo && (
            <Card
              accentBorder={todo.urgent ? accent.clay : accent.sunbeam}
              style={{ marginTop: 18, borderWidth: 1.5, borderColor: todo.urgent ? accent.clay : accent.sunbeam }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name={todo.icon as any} size={18} color={todo.urgent ? accent.clay : accent.sunbeam} />
                <Text style={[type.micro, { color: todo.urgent ? accent.clay : accent.sunbeam, letterSpacing: 0.6 }]}>
                  {todo.urgent ? 'NEEDS YOU NOW' : 'WORTH DOING'}
                </Text>
              </View>
              <Text style={[type.ritualTitle, { color: dark.ink, fontSize: 21, marginTop: 8 }]}>
                {todo.title}
              </Text>
              <Text style={[type.body, { color: dark.inkMuted, marginTop: 6, lineHeight: 21 }]}>
                {todo.detail}
              </Text>
              {todo.action && (
                <GButton title={todo.action} onPress={todo.onPress} style={{ marginTop: 14, minHeight: 46 }} />
              )}
            </Card>
          )}

          {/* What the probe is really measuring, given how deep it sits and how
              deep the pot is. Water leaves a saturated layer of FIXED height on
              the pot's base, so the root zone is reliably wetter than the top
              few centimetres the probe samples. */}
          {/* Probe depth check. A capacitive blade averages moisture along its
              WHOLE length, so a half-inserted probe reads mostly air and the pot
              looks bone dry — the exact confusion of "it said water me, then I
              pushed it in and it said it was fine". */}
          {sensored && calReading?.soil_pct != null && calReading.soil_pct <= 1 && (
            <Card accentBorder={accent.sunbeam} style={{ marginTop: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="alert-circle" size={18} color={accent.sunbeam} />
                <Text style={[type.cardTitle, { color: accent.sunbeam, flex: 1, fontSize: 15 }]}>
                  Is the probe pushed all the way in?
                </Text>
              </View>
              <Text style={[type.body, { color: dark.inkMuted, marginTop: 8, lineHeight: 21 }]}>
                The soil is reading 0% — the same value the probe gives in open air. It senses along
                its whole blade, so if only part is buried it averages in the air above and reads far
                too dry. Push it into the soil up to the <Text style={{ color: dark.ink }}>white line</Text>,
                near the roots and not touching the pot wall. Readings settle within a couple of reports.
              </Text>
            </Card>
          )}

          {/* ── Sensor readings & health — every number with its meaning + action ── */}
          {liveDeviceId && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 20, marginBottom: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent.sage }} />
                <Text style={[type.micro, { color: accent.sage, letterSpacing: 0.5 }]}>
                  SENSOR READINGS{liveReading ? ` · ${new Date(liveReading.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
                </Text>
              </View>
              <Card>
                {health?.measured ? (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                      <VitalityRing score={health.total} size={58} showLabel={false} trackColor={dark.hairline} />
                      <View style={{ flex: 1 }}>
                        <Text style={[type.ritualTitle, { color: bandFor(health.total).color, fontSize: 26 }]}>
                          {health.total}%
                        </Text>
                        <Text style={[type.caption, { color: dark.inkMuted, marginTop: 1, lineHeight: 17 }]}>
                          {health.word} · {health.summary}
                        </Text>
                      </View>
                    </View>
                    {/* At a glance: the four numbers, no scoring maths. The full
                        breakdown is one tap away for anyone who wants it. */}
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                      {health.components.map((c) => (
                        <View
                          key={c.key}
                          style={{ flex: 1, alignItems: 'center', backgroundColor: dark.surface2, borderRadius: 10, paddingVertical: 9 }}
                        >
                          <Text style={{ fontSize: 15 }}>
                            {c.key === 'moisture' ? '💧' : c.key === 'light' ? '☀️' : c.key === 'temperature' ? '🌡️' : '💨'}
                          </Text>
                          <Text
                            style={[type.numBold as any, { color: healthTone(c.tone), fontSize: 14, marginTop: 3 }]}
                            numberOfLines={1}
                          >
                            {c.value.split(' ')[0]}
                          </Text>
                        </View>
                      ))}
                    </View>

                    <Pressable
                      onPress={() => setBreakdownOpen(!breakdownOpen)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, minHeight: 36 }}
                    >
                      <Text style={[type.caption, { color: accent.verdant, flex: 1 }]}>
                        {breakdownOpen ? 'Hide the score breakdown' : 'How is this score worked out?'}
                      </Text>
                      <Ionicons name={breakdownOpen ? 'chevron-up' : 'chevron-down'} size={16} color={accent.verdant} />
                    </Pressable>
                    {breakdownOpen && (
                      <>
                        <Hairline />
                        {health.components.map((c) => (
                          <HealthRow key={c.key} c={c} />
                        ))}
                        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 16, lineHeight: 15 }]}>
                          Health = the four readings summed (max 100), each judged against {plant.species}&apos;s
                          ideal ranges. Light is a relative index, so it&apos;s coarser than the measured metrics.
                        </Text>
                      </>
                    )}
                  </>
                ) : (
                  <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
                    Waiting for the first reading. The sensor wakes, reads, and reports on its own
                    about every 3 hours, then sleeps to save power (keep it on a wall charger or power
                    bank — a PC&apos;s USB port cuts power when the PC sleeps).
                  </Text>
                )}
                {liveReading && (() => {
                  // Honest scheduling line: once the predicted time has passed,
                  // stop showing a time in the past — say it's due/overdue, so a
                  // late sensor reads as "late", not as a wrong clock.
                  const nextAt = new Date(liveReading.created_at).getTime() + 10800 * 1000;
                  const lateMin = Math.round((Date.now() - nextAt) / 60000);
                  return (
                    <Text style={[type.micro, { color: lateMin > 30 ? accent.sunbeamText : dark.inkMuted, marginTop: 10, lineHeight: 15 }]}>
                      {lateMin < 0
                        ? `Reports on its own about every 3 h · next ~${new Date(nextAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`
                        : lateMin <= 30
                          ? 'Reports about every 3 h · next reading due now.'
                          : `Reports about every 3 h · running ${relTime(lateMin)} late — it retries every few minutes, so this catches up on its own.`}
                    </Text>
                  );
                })()}
                <Pressable
                  onPress={() => router.push(`/dashboard/${plant.id}` as any)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, minHeight: 32 }}
                >
                  <Ionicons name="stats-chart" size={14} color={accent.verdant} />
                  <Text style={[type.caption, { color: accent.verdant }]}>View full analytics</Text>
                </Pressable>
              </Card>

              {/* ── Multi-day norms: what this spot is USUALLY like ──
                  A single reading is a snapshot; the day average is the honest
                  measure, and it sharpens with every day the sensor runs. */}
              {detailsOpen && (norms.soil?.reliable || norms.temp?.reliable || norms.humidity?.reliable) && (
                <Card style={{ marginTop: 10 }}>
                  <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.4 }]}>
                    TYPICAL FOR THIS SPOT
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                    {([
                      ['Soil', norms.soil, (v: number) => `${Math.round(v)}%`],
                      ['Temp', norms.temp, (v: number) => (settings.unitsF ? `${Math.round((v * 9) / 5 + 32)}°F` : `${Math.round(v)}°C`)],
                      ['Humidity', norms.humidity, (v: number) => `${Math.round(v)}%`],
                    ] as [string, ReturnType<typeof metricSummary>, (v: number) => string][])
                      .filter(([, m]) => m != null)
                      .map(([label, m, fmt]) => (
                        <View key={label} style={{ flex: 1, backgroundColor: dark.surface2, borderRadius: 10, padding: 10 }}>
                          <Text style={[type.micro, { color: dark.inkMuted }]}>{label.toUpperCase()}</Text>
                          <Text style={[type.numBold as any, { color: dark.ink, fontSize: 18, marginTop: 2 }]}>
                            {fmt(m!.avg)}
                          </Text>
                          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 1 }]}>
                            {fmt(m!.low)}–{fmt(m!.high)}
                          </Text>
                        </View>
                      ))}
                  </View>
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10, lineHeight: 15 }]}>
                    Averaged across {Math.max(norms.soil?.days ?? 0, norms.temp?.days ?? 0, norms.humidity?.days ?? 0)}{' '}
                    day(s) of readings, weighted by how much of each day was covered — the range shows
                    the quietest and busiest days. Accuracy improves the longer the sensor runs.
                  </Text>
                </Card>
              )}
            </>
          )}

          {/* ── NEEDS ATTENTION — the spot itself isn't working ──
                 Only rendered for verdicts that passed the confidence tests
                 (enough days, most of them agreeing, a clear margin), because
                 "move your plant" is a big ask to get wrong. */}
          {envIssues.length > 0 && (
            <>
              <SectionHeader>Needs attention</SectionHeader>
              {envIssues.map((v) => (
                <Card
                  key={v.metric}
                  accentBorder={v.severity === 'act' ? accent.clay : accent.sunbeam}
                  style={{ marginBottom: 10 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Ionicons
                      name={
                        v.relocate
                          ? 'move'
                          : v.metric === 'humidity'
                            ? 'water-outline'
                            : v.metric === 'soil'
                              ? 'rainy-outline'
                              : 'alert-circle'
                      }
                      size={20}
                      color={v.severity === 'act' ? accent.clay : accent.sunbeam}
                    />
                    <Text
                      style={[
                        type.cardTitle,
                        { color: v.severity === 'act' ? accent.clay : accent.sunbeam, flex: 1, fontSize: 15 },
                      ]}
                    >
                      {v.headline}
                    </Text>
                  </View>
                  <Text style={[type.body, { color: dark.inkMuted, marginTop: 8, lineHeight: 21 }]}>
                    {v.detail}
                  </Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      gap: 8,
                      marginTop: 10,
                      padding: 10,
                      borderRadius: 10,
                      backgroundColor: `${accent.verdant}18`,
                    }}
                  >
                    <Ionicons name="arrow-forward-circle" size={15} color={accent.verdant} style={{ marginTop: 1 }} />
                    <Text style={[type.caption, { color: dark.ink, flex: 1, lineHeight: 18 }]}>{v.action}</Text>
                  </View>
                  {v.relocate && (
                    <Pressable
                      onPress={() => router.push({ pathname: '/move/[id]', params: { id: plant.id } })}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, minHeight: 36 }}
                    >
                      <Ionicons name="swap-horizontal" size={15} color={accent.verdant} />
                      <Text style={[type.caption, { color: accent.verdant }]}>Move {plant.name} to another spot</Text>
                    </Pressable>
                  )}
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 8, lineHeight: 15 }]}>
                    Based on {v.days} days of readings — {v.daysOut} of them outside the ideal range.
                  </Text>
                </Card>
              ))}
            </>
          )}

          {/* Conditions that stop a plant GROWING even when watering is perfect —
              and the pests those same conditions invite. All three come from the
              sensor stream already being collected; none needs a new input. */}
          {(air?.growthLimiting || risks.length > 0 || rootBound) && (
            <>
              <SectionHeader>Growing conditions</SectionHeader>
              {air && air.growthLimiting && (
                <Card accentBorder={air.tone === 'bad' ? accent.clay : accent.sunbeam}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Ionicons name="thermometer-outline" size={18} color={air.tone === 'bad' ? accent.clay : accent.sunbeam} style={{ marginTop: 1 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]}>{air.label}</Text>
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4, lineHeight: 17 }]}>
                        {air.detail}
                      </Text>
                      {air.fix && (
                        <Text style={[type.micro, { color: dark.ink, marginTop: 6, lineHeight: 17 }]}>
                          {air.fix}
                        </Text>
                      )}
                    </View>
                  </View>
                </Card>
              )}
              {risks.map((r) => (
                <Card key={r.key} accentBorder={r.level === 'likely' ? accent.clay : undefined}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Ionicons name="bug-outline" size={18} color={r.level === 'likely' ? accent.clay : accent.sunbeam} style={{ marginTop: 1 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]}>
                        {r.name} — {r.level === 'likely' ? 'likely' : 'worth watching'}
                      </Text>
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4, lineHeight: 17 }]}>
                        {r.because}
                      </Text>
                      <Text style={[type.micro, { color: dark.ink, marginTop: 6, lineHeight: 17 }]}>{r.action}</Text>
                    </View>
                  </View>
                </Card>
              ))}
              {rootBound && (
                <Card accentBorder={rootBound.confident ? accent.clay : undefined}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Ionicons name="git-branch-outline" size={18} color={accent.sunbeam} style={{ marginTop: 1 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]}>
                        Looks ready for a bigger pot
                      </Text>
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4, lineHeight: 17 }]}>
                        {rootBound.text}
                      </Text>
                    </View>
                  </View>
                </Card>
              )}
            </>
          )}

          {/* Pot size gates the accuracy of every ml figure below, so it is asked
              before them and independently of whether readings exist yet. */}
          <SectionHeader>Pot size</SectionHeader>
          {potSizePrompt ?? (
            // Known and confirmed: state what it IS, and keep a way back in — a
            // mistyped digit or a repot would otherwise be baked in permanently.
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="resize-outline" size={18} color={accent.verdant} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]}>
                    {plant.potCm} × {plant.potHeightCm} cm · {potVol.liters.toFixed(1)} L of soil
                  </Text>
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, lineHeight: 15 }]}>
                    {plant.potMaterial.toLowerCase()}
                    {plant.soilMix ? `, ${plant.soilMix.toLowerCase()}` : ''}
                    {plant.hasDrainage === false ? ', no drainage holes' : ''} — all of it feeds the
                    watering amount.
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    // Pre-fill with what is stored so a correction is a tweak,
                    // not a re-entry from scratch.
                    setWidthInput(String(plant.potCm ?? ''));
                    setDepthInput(String(plant.potHeightCm ?? ''));
                    setPotSizeEditing(true);
                  }}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: dark.surface2,
                  }}
                >
                  <Text style={[type.micro, { color: dark.ink, fontWeight: '700' }]}>Change</Text>
                </Pressable>
              </View>
            </Card>
          )}

          {/* ── Soil: what it should be potted in, and whether it already is ──
              Placed with pot size because they are the same decision made at the
              same moment, and both are read through the same retention model. A
              MAJOR mismatch is shown as an alert rather than a quiet link: it is
              the one care problem no amount of correct watering can compensate
              for, and the reason it stays quiet otherwise is that repotting a
              plant that is doing fine does more harm than good. */}
          <Card style={{ marginTop: 10, borderLeftWidth: soilFit.severity === 'major' ? 3 : 0, borderLeftColor: accent.clay }}>
            <Pressable
              onPress={() => router.push(`/repot/${plant.id}` as any)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              <Ionicons
                name={soilFit.matches ? 'checkmark-circle-outline' : soilFit.severity === 'major' ? 'alert-circle' : 'flask-outline'}
                size={18}
                color={soilFit.matches ? accent.verdant : soilFit.severity === 'major' ? accent.clay : accent.sunbeam}
              />
              <View style={{ flex: 1 }}>
                <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]}>{soilFit.headline}</Text>
                <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, lineHeight: 15 }]}>
                  {soilRecipe.headline} — {recipeLine(soilRecipe)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={dark.inkMuted} />
            </Pressable>
          </Card>

          {/* ── Watering: direct call from the sensor (replaces generic advice) ── */}
          {watering && (
            <>
              <SectionHeader>Watering</SectionHeader>

              {/* Soil BEHAVIOUR — draining after a drink, or genuinely waterlogged.
                  Shown above the verdict so a freshly watered plant reads as
                  "working normally" instead of alarming. */}
              {soilDyn && (soilDyn.draining || soilDyn.drainageProblem) && (
                <Card
                  accentBorder={soilDyn.drainageProblem ? accent.clay : accent.sage}
                  style={{ marginBottom: 10 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Ionicons
                      name={soilDyn.drainageProblem ? 'warning' : 'hourglass-outline'}
                      size={20}
                      color={soilDyn.drainageProblem ? accent.clay : accent.sage}
                    />
                    <Text style={[type.cardTitle, { color: soilDyn.drainageProblem ? accent.clay : accent.sage, flex: 1, fontSize: 15 }]}>
                      {soilDyn.headline}
                    </Text>
                  </View>
                  <Text style={[type.body, { color: dark.inkMuted, marginTop: 8, lineHeight: 21 }]}>
                    {soilDyn.detail}
                  </Text>
                  {soilDyn.draining && soilDyn.reachesIdealAt && (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        marginTop: 10,
                        padding: 10,
                        borderRadius: 10,
                        backgroundColor: `${accent.sage}18`,
                      }}
                    >
                      <Ionicons name="time-outline" size={15} color={accent.sage} />
                      <Text style={[type.caption, { color: dark.ink, flex: 1, lineHeight: 18 }]}>
                        Back in the ideal {ideal.band[0]}–{ideal.band[1]}% at about{' '}
                        <Text style={[type.numBold as any, { color: accent.sage }]}>
                          {soilDyn.reachesIdealAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        </Text>
                        {soilDyn.dryRatePerHour ? ` · drying ${soilDyn.dryRatePerHour.toFixed(1)}%/h` : ''}
                      </Text>
                    </View>
                  )}
                </Card>
              )}

              {/* Still settling in — gentler expectations, and no feeding yet. */}
              {settling && (
                <Card style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Ionicons name="leaf-outline" size={18} color={accent.verdant} style={{ marginTop: 1 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.3 }]}>
                        SETTLING IN · DAY {settling.daysIn + 1}
                      </Text>
                      <Text style={[type.caption, { color: dark.ink, marginTop: 3, lineHeight: 19 }]}>
                        {settling.note}
                      </Text>
                    </View>
                  </View>
                </Card>
              )}

              {/* Did the last watering actually do the job? Judged from what the
                  soil DID afterwards, not from what was poured. */}
              {waterReview && (
                <Card style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Ionicons
                      name={
                        waterReview.outcome === 'about-right'
                          ? 'checkmark-circle'
                          : waterReview.outcome === 'too-little'
                            ? 'arrow-down-circle'
                            : 'alert-circle'
                      }
                      size={18}
                      color={waterReview.outcome === 'about-right' ? accent.sage : accent.sunbeam}
                      style={{ marginTop: 1 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.3 }]}>
                        YOUR LAST WATERING
                      </Text>
                      <Text style={[type.caption, { color: dark.ink, marginTop: 3, lineHeight: 19 }]}>
                        {waterReview.text}
                      </Text>
                    </View>
                  </View>
                </Card>
              )}

              <Card accentBorder={watering.tone === 'bad' ? accent.clay : undefined}>
                <Text style={[type.ritualTitle, { color: toneColor(watering.tone), fontSize: 22 }]}>
                  {watering.verdict}
                </Text>
                <Text style={[type.body, { color: dark.inkMuted, marginTop: 6, lineHeight: 21 }]}>
                  {watering.detail}
                </Text>
                {/* ONE amount, stated once, matching the button and the plan. */}
                {actionMl > 0 && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 12,
                      backgroundColor: `${accent.verdant}18`,
                    }}
                  >
                    <Ionicons name="water" size={20} color={accent.verdant} />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.numBold as any, { color: accent.verdant, fontSize: 20 }]}>
                        {actionMl} ml
                      </Text>
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 1, lineHeight: 16 }]}>
                        {/* Big pours cannot be absorbed in one go: dry mix is
                            water-repellent and the flow channels down the sides,
                            which is the same failure the "didn't reach the soil"
                            alert catches after the fact. */}
                        {actionMl >= 800
                          ? `That's a lot at once — give it in ${Math.min(4, Math.ceil(actionMl / 500))} passes of about ${Math.round(actionMl / Math.min(4, Math.ceil(actionMl / 500)) / 25) * 25} ml, waiting a few minutes between each so it soaks in instead of running down the sides. Empty the saucer at the end.`
                          : plant.hasDrainage === false
                          ? 'Pour slowly and stop there — with no drainage holes the excess has nowhere to go.'
                          : waterProfileFor(plant.species).style === 'soak-and-dry'
                            ? `Drench it until water runs from the holes, empty the saucer — then give it nothing at all until the soil is bone dry, usually about ${Math.round(plan.intervalDays)} days. The long dry spell matters as much as the soak.`
                            : 'Pour slowly until it runs from the drainage holes, then empty the saucer.'}
                      </Text>
                    </View>
                  </View>
                )}
                {/* The experiment: a modest dose with a stated prediction, so the
                    next reading either confirms it or corrects this pot's model. */}
                {actionMl > 0 && step.isTrial && (
                  <View
                    style={{
                      marginTop: 10,
                      padding: 10,
                      borderRadius: 10,
                      backgroundColor: `${accent.sunbeam}18`,
                    }}
                  >
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Ionicons name="flask-outline" size={15} color={accent.sunbeam} style={{ marginTop: 1 }} />
                      <Text style={[type.micro, { color: dark.inkMuted, flex: 1, lineHeight: 16 }]}>
                        <Text style={{ color: dark.ink }}>Start smaller and measure.</Text> {step.note}
                      </Text>
                    </View>
                    {step.predictedRisePts != null && (
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6, lineHeight: 16 }]}>
                        Greenr predicts this will lift the soil about{' '}
                        <Text style={[type.numBold as any, { color: accent.sunbeam }]}>
                          {step.predictedRisePts.toFixed(0)} points
                        </Text>
                        , from {calReading?.soil_pct?.toFixed(0)}% to roughly{' '}
                        {Math.round((calReading?.soil_pct ?? 0) + step.predictedRisePts)}%. The next
                        reading checks that.
                      </Text>
                    )}
                  </View>
                )}
                {/* What the last pour actually did, versus what was claimed. */}
                {outcome && (
                  <View
                    style={{
                      flexDirection: 'row',
                      gap: 8,
                      marginTop: 10,
                      padding: 10,
                      borderRadius: 10,
                      backgroundColor: `${accent.verdant}18`,
                    }}
                  >
                    <Ionicons
                      name={outcome.accuracy != null && outcome.accuracy >= 0.8 && outcome.accuracy <= 1.25 ? 'checkmark-circle' : 'analytics-outline'}
                      size={15}
                      color={accent.verdant}
                      style={{ marginTop: 1 }}
                    />
                    <Text style={[type.micro, { color: dark.inkMuted, flex: 1, lineHeight: 16 }]}>
                      <Text style={{ color: dark.ink }}>Last watering, measured.</Text> {outcome.text}
                    </Text>
                  </View>
                )}
                {actionMl > 0 && step.basis === 'measured' && (
                  <View
                    style={{
                      flexDirection: 'row',
                      gap: 8,
                      marginTop: 10,
                      padding: 10,
                      borderRadius: 10,
                      backgroundColor: `${accent.verdant}18`,
                    }}
                  >
                    <Ionicons name="checkmark-done-circle" size={15} color={accent.verdant} style={{ marginTop: 1 }} />
                    <Text style={[type.micro, { color: dark.inkMuted, flex: 1, lineHeight: 16 }]}>
                      <Text style={{ color: dark.ink }}>Calibrated to this pot.</Text> {step.note} That
                      replaces the estimate — it is measured from your own waterings, so it already
                      accounts for the roots, the compost and how this pot actually drains.
                    </Text>
                  </View>
                )}
                {/* The number's working, so it can be checked rather than trusted. */}
                {actionMl > 0 && pourFactors && (
                  <View style={{ marginTop: 10 }}>
                    <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.3 }]}>
                      HOW THIS AMOUNT WAS WORKED OUT
                    </Text>
                    {pourFactors.map((f) => (
                      <View key={f} style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                        <Text style={[type.micro, { color: accent.verdant }]}>·</Text>
                        <Text style={[type.micro, { color: dark.inkMuted, flex: 1, lineHeight: 15 }]}>
                          {f}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
                {/* How THIS species wants to be watered — the curve behind the
                    numbers, in plain language. */}
                <View
                  style={{
                    flexDirection: 'row',
                    gap: 8,
                    marginTop: 12,
                    padding: 10,
                    borderRadius: 10,
                    backgroundColor: dark.surface2,
                  }}
                >
                  <Ionicons name="water-outline" size={15} color={accent.verdant} style={{ marginTop: 1 }} />
                  <Text style={[type.micro, { color: dark.inkMuted, flex: 1, lineHeight: 16 }]}>
                    {waterStyleNote(plant.species)}
                  </Text>
                </View>
                {watering.confidence === 'low' && (
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10, lineHeight: 15 }]}>
                    Still gathering history — accuracy climbs with every reading.
                  </Text>
                )}

                {/* the calculated plan: pot volume × species draw × measured climate × season */}
                <Hairline style={{ marginVertical: 12 }} />
                <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.3 }]}>
                  WATER PLAN — CALCULATED FOR THIS PLANT
                </Text>
                {/* States the SAME ml as the action above — only the timing differs. */}
                <Text style={[type.cardTitle, { color: dark.ink, marginTop: 4, fontSize: 15 }]}>
                  ≈{routineMl} ml about every {plan.intervalDays} day{plan.intervalDays === 1 ? '' : 's'}
                </Text>
                {plan.factors.map((f) => (
                  <View key={f.label} style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                    <Text style={[type.micro, { color: accent.verdant }]}>·</Text>
                    <Text style={[type.micro, { color: dark.inkMuted, flex: 1, lineHeight: 15 }]}>
                      <Text style={{ color: dark.ink }}>{f.label}</Text> — {f.effect}
                    </Text>
                  </View>
                ))}

                <Pressable
                  onPress={() => setWaterOpen(true)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, minHeight: 36 }}
                >
                  <Ionicons name="add-circle-outline" size={15} color={accent.verdant} />
                  <Text style={[type.caption, { color: accent.verdant }]}>Log a watering</Text>
                </Pressable>

                {/* Scheduled next watering — an exact date/time, not "check Friday" (§5) */}
                {schedule && (
                  <>
                    <Hairline style={{ marginVertical: 14 }} />
                    <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.3 }]}>
                      NEXT WATERING
                    </Text>
                    <Text
                      style={[
                        type.cardTitle,
                        { color: schedule.status === 'overdue' ? accent.clay : dark.ink, marginTop: 4 },
                      ]}
                    >
                      {schedule.whenLabel}
                    </Text>
                    <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4, lineHeight: 15 }]}>
                      {schedule.basis}
                      {schedule.confidence === 'low' ? ' (early estimate)' : ''}
                    </Text>
                    {wImpact.applies && (
                      <View
                        style={{
                          flexDirection: 'row',
                          gap: 7,
                          marginTop: 10,
                          padding: 9,
                          borderRadius: 10,
                          backgroundColor: `${wImpact.effect === 'delay' ? accent.verdant : accent.sunbeam}18`,
                        }}
                      >
                        <Ionicons
                          name={wImpact.effect === 'delay' ? 'rainy-outline' : 'flame-outline'}
                          size={14}
                          color={wImpact.effect === 'delay' ? accent.verdant : accent.sunbeam}
                          style={{ marginTop: 1 }}
                        />
                        <Text style={[type.micro, { color: dark.ink, flex: 1, lineHeight: 15 }]}>
                          {wImpact.note}
                        </Text>
                      </View>
                    )}
                    {schedule.checkAt && schedule.status === 'scheduled' && (
                      <Pressable
                        onPress={() =>
                          shareContent({
                            message: wateringIcs(plant.name, schedule.checkAt as Date),
                            title: `Water ${plant.name}`,
                            filename: `water-${plant.name.replace(/\s+/g, '-').toLowerCase()}.ics`,
                          })
                        }
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, minHeight: 36 }}
                      >
                        <Ionicons name="calendar-outline" size={15} color={accent.verdant} />
                        <Text style={[type.caption, { color: accent.verdant }]}>Add to calendar</Text>
                      </Pressable>
                    )}
                  </>
                )}
              </Card>
            </>
          )}

          {/* ── ONE door to everything else ──
                 The page above answers "how is it, and what do I do?". Charts,
                 trends, the care guide and the analysis live behind this, so the
                 answer is never buried under the evidence. */}
          <Pressable
            onPress={() => setDetailsOpen(!detailsOpen)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              marginTop: 16,
              paddingVertical: 15,
              paddingHorizontal: 16,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: dark.hairline,
              backgroundColor: dark.surface1,
            }}
          >
            <Ionicons name={detailsOpen ? 'chevron-up-circle' : 'options-outline'} size={20} color={accent.verdant} />
            <View style={{ flex: 1 }}>
              <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]}>
                {detailsOpen ? 'Hide the details' : 'See all the details'}
              </Text>
              {!detailsOpen && (
                <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, lineHeight: 15 }]}>
                  Charts, trends, seasonal care, the full care guide and how this spot suits it
                </Text>
              )}
            </View>
            <Ionicons name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={18} color={dark.inkMuted} />
          </Pressable>

          {/* ── What this probe can and cannot see in this pot ── */}
          {detailsOpen && sensored && probe && probe.mode !== 'direct' && (
            <Card style={{ marginTop: 14, borderLeftWidth: 3, borderLeftColor: accent.sunbeam }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="eye-off-outline" size={18} color={accent.sunbeam} />
                <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.4, flex: 1 }]}>
                  WHAT THE PROBE CAN SEE HERE
                </Text>
              </View>
              <Text style={[type.cardTitle, { color: dark.ink, marginTop: 8 }]}>{probe.headline}</Text>
              <Text style={[type.body, { color: dark.inkMuted, marginTop: 8, lineHeight: 21 }]}>
                {probe.detail}
              </Text>
              {/*
                THE RESCALED READING ITSELF — the thing rescaling is FOR, and the
                one thing this card never showed. `probeResolution` could return
                mode 'rescaled' and `relativeWetness` existed to act on it, but
                nothing anywhere called it, so a pot living between 5% and 12%
                was still only ever described to its owner as "9%".

                Note this is a DISPLAY transform and nothing more. The mapping is
                affine and monotone, so judging a rescaled reading against a
                rescaled threshold gives exactly the same verdict as judging the
                raw numbers — it changes what a person can read, never what the
                app decides. The threshold is shown alongside for the same
                reason: 68 means nothing until you know the floor is at 34.
              */}
              {probe.mode === 'rescaled' && calReading?.soil_pct != null && (
                <View style={{ marginTop: 12, backgroundColor: dark.surface2, borderRadius: 10, padding: 12 }}>
                  <Text style={[type.micro, { color: dark.inkMuted }]}>IN THIS POT&apos;S OWN RANGE</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 2 }}>
                    <Text style={[type.numBold as any, { color: accent.verdant, fontSize: 24 }]}>
                      {Math.round(relativeWetness(calReading.soil_pct, probe))}
                    </Text>
                    <Text style={[type.body, { color: dark.inkMuted, marginBottom: 3 }]}>
                      of 100 &middot; floor sits at {Math.round(relativeThreshold(ideal.band[0], probe))}
                    </Text>
                  </View>
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6, lineHeight: 16 }]}>
                    The raw {calReading.soil_pct.toFixed(1)}% is real but unreadable — this pot only ever
                    moves between {probe.observedLow.toFixed(1)}% and {probe.observedHigh.toFixed(1)}%. Stretched
                    across its own range, the same reading becomes something you can actually judge.
                  </Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <View style={{ flex: 1, backgroundColor: dark.surface2, borderRadius: 10, padding: 10 }}>
                  <Text style={[type.micro, { color: dark.inkMuted }]}>THIS POT&apos;S RANGE</Text>
                  <Text style={[type.numBold as any, { color: dark.ink, fontSize: 16 }]}>
                    {probe.observedLow.toFixed(0)}–{probe.observedHigh.toFixed(0)}%
                  </Text>
                </View>
                <View style={{ flex: 1, backgroundColor: dark.surface2, borderRadius: 10, padding: 10 }}>
                  <Text style={[type.micro, { color: dark.inkMuted }]}>SENSOR NOISE</Text>
                  <Text style={[type.numBold as any, { color: dark.ink, fontSize: 16 }]}>±{probe.noisePts}</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: dark.surface2, borderRadius: 10, padding: 10 }}>
                  <Text style={[type.micro, { color: dark.inkMuted }]}>USABLE STEPS</Text>
                  <Text style={[type.numBold as any, { color: probe.mode === 'time-based' ? accent.clay : accent.verdant, fontSize: 16 }]}>
                    {probe.signalToNoise}
                  </Text>
                </View>
              </View>
            </Card>
          )}

          {/* ── Was the amount we recommended right? Graded against real pours ── */}
          {detailsOpen && sensored && doseCheck && (
            <Card style={{ marginTop: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons
                  name={doseCheck.direction === 'good' ? 'checkmark-circle-outline' : 'construct-outline'}
                  size={18}
                  color={doseCheck.direction === 'good' ? accent.verdant : accent.sunbeam}
                />
                <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.4, flex: 1 }]}>
                  HOW ACCURATE GREENR&apos;S AMOUNTS HAVE BEEN
                </Text>
              </View>
              <Text style={[type.cardTitle, { color: dark.ink, marginTop: 8 }]}>{doseCheck.headline}</Text>
              <Text style={[type.body, { color: dark.inkMuted, marginTop: 8, lineHeight: 21 }]}>
                {doseCheck.detail}
              </Text>
              <View style={{ marginTop: 12, gap: 10 }}>
                {doseCheck.checks.slice(-3).reverse().map((c) => (
                  <View key={c.at}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[type.micro, { color: dark.inkMuted, flex: 1 }]}>
                        {relTime((Date.now() - c.at) / 60000)}
                      </Text>
                      <Text style={[type.micro, { color: dark.inkMuted }]}>suggested</Text>
                      <Text style={[type.numBold as any, { color: dark.inkMuted }]}>{c.suggestedMl} ml</Text>
                      <Ionicons name="arrow-forward" size={12} color={dark.inkMuted} />
                      <Text style={[type.micro, { color: dark.inkMuted }]}>poured</Text>
                      <Text style={[type.numBold as any, { color: accent.verdant }]}>{c.pouredMl} ml</Text>
                    </View>
                    <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, lineHeight: 15 }]}>
                      {c.verdict}
                    </Text>
                  </View>
                ))}
              </View>
              {doseCheck.skippedAssumed > 0 && (
                <Text style={[type.micro, { color: accent.sunbeam, marginTop: 10, lineHeight: 15 }]}>
                  {doseCheck.skippedAssumed} watering{doseCheck.skippedAssumed === 1 ? ' was' : 's were'} logged
                  without you stating an amount. Those record that you watered, but Greenr never treats its own
                  suggestion as proof its suggestion was right — so they cannot sharpen anything.
                </Text>
              )}
            </Card>
          )}

          {/* ── How well THIS compost holds water, measured from the dry-down ── */}
          {detailsOpen && sensored && retentionEst && (
            <Card style={{ marginTop: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons
                  name={retentionEst.confident ? 'water-outline' : 'hourglass-outline'}
                  size={18}
                  color={retentionEst.confident ? accent.verdant : accent.sunbeam}
                />
                <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.4, flex: 1 }]}>
                  HOW LONG THIS SOIL STAYS DAMP · MEASURED
                </Text>
              </View>
              <Text style={[type.cardTitle, { color: dark.ink, marginTop: 8 }]}>{retentionEst.headline}</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <View style={{ flex: 1, backgroundColor: dark.surface2, borderRadius: 10, padding: 10 }}>
                  <Text style={[type.micro, { color: dark.inkMuted }]}>DROPS BY</Text>
                  <Text style={[type.numBold as any, { color: accent.verdant, fontSize: 18 }]}>
                    {retentionEst.ptsPerDay.toFixed(1)}%/day
                  </Text>
                </View>
                <View style={{ flex: 1, backgroundColor: dark.surface2, borderRadius: 10, padding: 10 }}>
                  <Text style={[type.micro, { color: dark.inkMuted }]}>WATERED → DRY</Text>
                  <Text style={[type.numBold as any, { color: accent.verdant, fontSize: 18 }]}>
                    {retentionEst.dryDays < 1 ? retentionEst.dryDays.toFixed(1) : Math.round(retentionEst.dryDays)} days
                  </Text>
                </View>
                <View style={{ flex: 1, backgroundColor: dark.surface2, borderRadius: 10, padding: 10 }}>
                  <Text style={[type.micro, { color: dark.inkMuted }]}>VERDICT</Text>
                  <Text style={[type.caption, { color: dark.ink, marginTop: 2 }]}>
                    {RETENTION_LABEL[retentionEst.value]}
                  </Text>
                </View>
              </View>
              <Text style={[type.body, { color: dark.inkMuted, marginTop: 10, lineHeight: 21 }]}>
                {retentionEst.detail}
              </Text>
              <View style={{ marginTop: 10, gap: 4 }}>
                {retentionEst.runs.slice(-3).map((r) => (
                  <View key={r.startMs} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[type.micro, { color: dark.inkMuted, flex: 1 }]}>
                      {relTime((Date.now() - r.startMs) / 60000)} · {r.fromPct.toFixed(0)}% →{' '}
                      {r.toPct.toFixed(0)}% over {Math.round(r.hours)} h
                    </Text>
                    <Text style={[type.micro, { color: r.spanned ? accent.verdant : dark.inkMuted }]}>
                      {r.spanned ? 'full cycle' : 'partial'} · fit {(r.fit * 100).toFixed(0)}%
                    </Text>
                  </View>
                ))}
              </View>
              <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10, lineHeight: 15 }]}>
                This is how long the pot stays damp with THIS plant in THIS spot — a big, thirsty plant
                empties its pot faster than a cutting in the same compost. Greenr corrects for how dry
                the air was, not for how much the plant drinks.
              </Text>
            </Card>
          )}

          {detailsOpen && sensored && soilProfileNote && (
            <Card style={{ marginTop: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="layers-outline" size={18} color={accent.verdant} />
                <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.4, flex: 1 }]}>
                  WHAT THE PROBE IS MEASURING
                </Text>
              </View>
              <Text style={[type.body, { color: dark.inkMuted, marginTop: 8, lineHeight: 21 }]}>
                {soilProfileNote.text}
              </Text>
              <View style={{ marginTop: 10, gap: 4 }}>
                {profileBands(
                  soilProfileNote.geo,
                  calReading?.soil_pct != null ? inferWaterTableDepth(calReading.soil_pct, soilProfileNote.geo) : 0,
                ).map((b) => (
                  <View key={b.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[type.micro, { color: dark.inkMuted, width: 150 }]}>{b.label}</Text>
                    <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: dark.hairline, overflow: 'hidden' }}>
                      <View style={{ width: `${Math.round(b.pct)}%`, height: 6, backgroundColor: accent.verdant }} />
                    </View>
                    <Text style={[type.micro, { color: dark.ink, width: 52, textAlign: 'right' }]}>
                      {b.pct.toFixed(2)}%
                    </Text>
                  </View>
                ))}
              </View>
              {(() => {
                const fit = probeFit(soilProfileNote.geo);
                return fit.potTooShallow ? (
                  <Text style={[type.micro, { color: accent.sunbeam, marginTop: 10, lineHeight: 15 }]}>
                    {fit.note}
                  </Text>
                ) : null;
              })()}
              {!plant.potHeightCm && (
                <Text style={[type.micro, { color: accent.sunbeam, marginTop: 10, lineHeight: 15 }]}>
                  Assuming a 16 cm soil depth — set the real depth when you add or edit this plant and
                  these figures become exact for your pot.
                </Text>
              )}
            </Card>
          )}

          {/* ── Watering efficiency: volume learned from the moisture curve ── */}
          {detailsOpen && hydration && (
            <>
              <SectionHeader>Watering efficiency</SectionHeader>
              <Card>
                <Text style={[type.body, { color: dark.ink, lineHeight: 21 }]}>
                  Every time you water, the soil jumps up then dries at{' '}
                  {hydration.dryingPerDay != null ? (
                    <Text style={[type.numBold as any, { color: accent.verdant }]}>~{hydration.dryingPerDay}%/day</Text>
                  ) : (
                    'a rate Greenr is still learning'
                  )}
                  . Greenr reads the size of each jump to estimate how much you poured — so a bigger drink
                  simply lasts longer.
                </Text>
                <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6, lineHeight: 15 }]}>
                  Built from readings about every {hydration.reportIntervalH} h — the more often the sensor
                  reports, the sharper this gets. Stretches where it was offline aren&apos;t counted.
                </Text>

                {/* the efficient recommendation */}
                {efficientPour && (
                  <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: `${accent.verdant}18` }}>
                    <Text style={[type.micro, { color: accent.verdant, letterSpacing: 0.3 }]}>
                      MOST EFFICIENT POUR
                    </Text>
                    <Text style={[type.ritualTitle, { color: dark.ink, fontSize: 22, marginTop: 2 }]}>
                      {efficientPour.ml} ml
                      <Text style={[type.caption, { color: dark.inkMuted }]}> · lasts ~{Math.round(efficientPour.lastsDays)} days</Text>
                    </Text>
                    <Text style={[type.micro, { color: dark.inkMuted, marginTop: 3, lineHeight: 15 }]}>
                      Fills the soil to ~{efficientPour.peak}% — enough to reach {plant.species}&apos;s next-water point
                      in about {Math.round(efficientPour.lastsDays)} days.{' '}
                      {efficientPour.capped
                        ? `That's the most one pour can hold; past ~${hydration.saturationPct}% the water just drains away.`
                        : `Pouring much past that just drains out — wasted water.`}
                    </Text>
                  </View>
                )}

                {/* recent pours: estimated volume + how long each lasted */}
                {hydration.events.length > 0 && (
                  <>
                    <Hairline style={{ marginVertical: 12 }} />
                    <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.3, marginBottom: 6 }]}>
                      YOUR RECENT WATERINGS
                    </Text>
                    {hydration.events
                      .slice(-4)
                      .reverse()
                      .map((e, i) => (
                        <View key={e.at} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: i === 0 ? 0 : 8 }}>
                          <Ionicons name="water" size={14} color={accent.verdant} />
                          <Text style={[type.caption, { color: dark.ink, flex: 1 }]}>
                            {new Date(e.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            {e.loggedMl != null ? ` · you logged ${e.loggedMl} ml` : e.estMl != null ? ` · ~${e.estMl} ml poured` : ''}
                          </Text>
                          <Text style={[type.micro, { color: dark.inkMuted }]}>
                            {e.wateredEarly ? 'watered early' : e.lastedDays != null ? `lasted ${e.lastedDays}d` : 'drying…'}
                          </Text>
                        </View>
                      ))}
                  </>
                )}

                <Text style={[type.micro, { color: dark.inkMuted, marginTop: 12, lineHeight: 15 }]}>
                  {hydration.calibrated
                    ? `Calibrated to your pot from ${hydration.calibrationPairs} logged pour${hydration.calibrationPairs === 1 ? '' : 's'} — the volume estimate is tuned to this exact plant.`
                    : 'Volume is estimated from pot size. Log the amount when you water and Greenr locks the estimate to your real pot.'}
                </Text>
              </Card>
            </>
          )}

          {/* ── What Greenr has learned (from history) ── */}
          {detailsOpen && insights.length > 0 && (
            <>
              <SectionHeader>What Greenr has learned</SectionHeader>
              <Card>
                {insights.map((ins, i) => (
                  <View key={i}>
                    {i > 0 && <Hairline style={{ marginVertical: 12 }} />}
                    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                      <Ionicons name={ins.icon as any} size={18} color={accent.verdant} style={{ marginTop: 1 }} />
                      <Text style={[type.body, { color: dark.ink, flex: 1, lineHeight: 21 }]}>{ins.text}</Text>
                    </View>
                  </View>
                ))}
              </Card>
            </>
          )}

          {/* ── Sensorless: the honest watering cycle + needs in plain words ── */}
          {/* ── Sensorless CARE RATING — the honest score from logged behaviour ── */}
          {!sensored && careScore && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 20, marginBottom: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent.verdant }} />
                <Text style={[type.micro, { color: accent.verdant, letterSpacing: 0.5 }]}>
                  CARE RATING · {careScore.waterings} WATERING{careScore.waterings === 1 ? '' : 'S'} LOGGED
                </Text>
              </View>
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <VitalityRing score={careScore.total} size={58} showLabel={false} trackColor={dark.hairline} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.ritualTitle, { color: matchColor(careScore.total), fontSize: 26 }]}>
                      {careScore.total}
                      <Text style={[type.caption, { color: dark.inkMuted }]}> / 100 · {careScore.word}</Text>
                    </Text>
                    <Text style={[type.caption, { color: dark.inkMuted, marginTop: 1, lineHeight: 17 }]}>
                      {careScore.summary}
                    </Text>
                  </View>
                </View>

                {/* per-watering grade strip — the sensorless analogue of daily squares */}
                {careScore.history.length > 0 && (
                  <View style={{ marginTop: 14 }}>
                    <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.3, marginBottom: 6 }]}>
                      EACH WATERING, GRADED ON TIMING
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      {careScore.history.slice(-10).map((h, i) => (
                        <View
                          key={i}
                          style={{
                            flex: 1,
                            height: 22,
                            borderRadius: 4,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: `${matchColor(gradePct(h.grade))}33`,
                            borderWidth: 1,
                            borderColor: matchColor(gradePct(h.grade)),
                          }}
                        >
                          <Text style={[type.micro, { color: dark.ink, fontSize: 9 }]}>{Math.round(h.gapDays)}d</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={[type.micro, { color: dark.inkMuted, marginTop: 5, lineHeight: 14 }]}>
                      Days between waterings · green = well-timed, amber/red = too soon or too late.
                    </Text>
                  </View>
                )}

                <Hairline style={{ marginTop: 14 }} />
                {careScore.components.map((c) => (
                  <CareRow key={c.key} c={c} />
                ))}

                {/* confidence meter — grows as they log more, capped below a sensor's */}
                <View style={{ marginTop: 16 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.3 }]}>CONFIDENCE</Text>
                    <Text style={[type.micro, { color: dark.inkMuted }]}>{Math.round(careScore.confidence * 100)}%</Text>
                  </View>
                  <View style={{ height: 5, borderRadius: 3, backgroundColor: dark.hairline, overflow: 'hidden' }}>
                    <View style={{ width: `${Math.round(careScore.confidence * 100)}%`, height: 5, backgroundColor: accent.verdant }} />
                  </View>
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6, lineHeight: 15 }]}>
                    This score rates how well your logged care matches what {plant.species} needs — rhythm,
                    consistency, spot, and amounts. It sharpens every time you log, but a sensor is the only
                    way to measure the soil itself. Pair one to turn this into a live health score.
                  </Text>
                </View>
              </Card>
            </>
          )}

          {!sensored && estSchedule && (
            <>
              <SectionHeader>Watering</SectionHeader>
              <Card accentBorder={estSchedule.status === 'due' ? accent.sunbeam : undefined}>
                <Text
                  style={[
                    type.ritualTitle,
                    { color: estSchedule.status === 'due' ? accent.sunbeam : dark.ink, fontSize: 22 },
                  ]}
                >
                  {estSchedule.whenLabel}
                </Text>
                <Text style={[type.body, { color: dark.inkMuted, marginTop: 6, lineHeight: 21 }]}>
                  {estSchedule.detail}
                </Text>
                <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10, lineHeight: 15 }]}>
                  {estSchedule.learned
                    ? 'Timed from your own logged rhythm — keep logging and it stays sharp.'
                    : 'Log each watering and Greenr learns this plant’s real rhythm.'}
                </Text>

                {/* the calculated plan: pot volume × species draw × season */}
                <Hairline style={{ marginVertical: 12 }} />
                <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.3 }]}>
                  WATER PLAN — CALCULATED FOR THIS PLANT
                </Text>
                {/* States the SAME ml as the action above — only the timing differs. */}
                <Text style={[type.cardTitle, { color: dark.ink, marginTop: 4, fontSize: 15 }]}>
                  ≈{routineMl} ml about every {plan.intervalDays} day{plan.intervalDays === 1 ? '' : 's'}
                </Text>
                {plan.factors.map((f) => (
                  <View key={f.label} style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                    <Text style={[type.micro, { color: accent.verdant }]}>·</Text>
                    <Text style={[type.micro, { color: dark.inkMuted, flex: 1, lineHeight: 15 }]}>
                      <Text style={{ color: dark.ink }}>{f.label}</Text> — {f.effect}
                    </Text>
                  </View>
                ))}
                <GButton
                  title="＋ Log a watering"
                  onPress={() => setWaterOpen(true)}
                  style={{ marginTop: 12, minHeight: 44 }}
                />
                {/* other care worth logging — it all lands in the plant's history */}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  {(
                    [
                      ['🧪', 'Fertilized'],
                      ['💨', 'Misted'],
                      ['🪴', 'Repotted'],
                    ] as [string, string][]
                  ).map(([emoji, label]) => (
                    <Pressable
                      key={label}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                        logCare(plant.id, `${label} (logged)`);
                        setLoggedCare(label);
                        setTimeout(() => setLoggedCare((l) => (l === label ? null : l)), 2000);
                      }}
                      style={{
                        flex: 1,
                        minHeight: 40,
                        borderRadius: 10,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: 1,
                        borderColor: loggedCare === label ? accent.sage : dark.hairline,
                      }}
                    >
                      <Text style={[type.micro, { color: loggedCare === label ? accent.sage : dark.ink }]}>
                        {loggedCare === label ? '✓ Logged' : `${emoji} ${label}`}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </Card>

              <SectionHeader>What it needs</SectionHeader>
              <Card>
                {qualNeeds.map((n, i) => (
                  <View key={n.icon + i}>
                    {i > 0 && <Hairline style={{ marginVertical: 12 }} />}
                    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                      <Ionicons name={n.icon as any} size={18} color={accent.verdant} style={{ marginTop: 1 }} />
                      <Text style={[type.body, { color: dark.ink, flex: 1, lineHeight: 21 }]}>{n.text}</Text>
                    </View>
                  </View>
                ))}
                <Text style={[type.micro, { color: dark.inkMuted, marginTop: 12, lineHeight: 15 }]}>
                  Described in words because nothing here is measured yet — a sensor turns these into
                  live readings.
                </Text>
              </Card>
            </>
          )}

          {/* ── This season: automatic winter/summer care shifts ── */}
          {detailsOpen && (<>
          <SectionHeader>{`${SEASON_EMOJI[season]} ${SEASON_LABEL[season]} care`}</SectionHeader>
          <Card>
            <Text style={[type.micro, { color: dark.inkMuted, lineHeight: 15 }]}>
              Applied automatically — the watering plan above already reflects the season.
            </Text>
            {seasonNotes.map((n, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 10 }}>
                <Ionicons name={n.icon as any} size={17} color={accent.verdant} style={{ marginTop: 1 }} />
                <Text style={[type.body, { color: dark.ink, flex: 1, lineHeight: 21 }]}>{n.text}</Text>
              </View>
            ))}
          </Card>

          {/* ── Tips tuned to the user's survey (beginner ≠ expert) ── */}
          {detailsOpen && (userTips.length > 0 || groom) && (
            <>
              <SectionHeader>Tips for you</SectionHeader>
              <Card>
                <Text style={[type.micro, { color: dark.inkMuted, lineHeight: 15 }]}>
                  Matched to your experience{profile?.struggle && profile.struggle !== 'Honestly, not sure' ? ` and what you said goes wrong most (${profile.struggle.toLowerCase()})` : ''}.
                </Text>
                {[...(groom ? [groom] : []), ...userTips].map((t, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 10 }}>
                    <Ionicons name={t.icon as any} size={17} color={accent.sage} style={{ marginTop: 1 }} />
                    <Text style={[type.body, { color: dark.ink, flex: 1, lineHeight: 21 }]}>{t.text}</Text>
                  </View>
                ))}
              </Card>
            </>
          )}

          {/* ── Soil moisture (real sensor history) ── */}
          <SectionHeader>Soil moisture</SectionHeader>
          <Card>
            {liveDeviceId ? (
              soilBars.length >= 2 ? (
                <>
                  <View style={{ height: 84 }}>
                    {/* ideal comfort band shaded behind the bars */}
                    <View
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: `${ideal.band[0]}%`,
                        height: `${Math.max(0, ideal.band[1] - ideal.band[0])}%`,
                        backgroundColor: `${accent.sage}22`,
                        borderRadius: 3,
                      }}
                    />
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 84, gap: 3 }}>
                      {soilBars.map((r, i) => {
                        const v = Math.max(0, Math.min(100, r.soil_pct as number));
                        const color =
                          v < ideal.band[0] ? accent.clay : v > ideal.band[1] ? accent.sunbeam : accent.verdant;
                        return (
                          <View
                            key={i}
                            style={{
                              flex: 1,
                              height: `${Math.max(3, v)}%`,
                              backgroundColor: color,
                              borderRadius: 2,
                              opacity: 0.5 + 0.5 * (i / Math.max(1, soilBars.length - 1)),
                            }}
                          />
                        );
                      })}
                    </View>
                  </View>
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10, lineHeight: 15 }]}>
                    Ideal {ideal.band[0]}–{ideal.band[1]}% shaded · last {soilBars.length} readings · now{' '}
                    {calReading?.soil_pct != null ? `${Math.round(calReading.soil_pct)}%` : '—'}.
                  </Text>
                </>
              ) : (
                <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
                  Collecting readings — your soil history builds here as the sensor reports (about every
                  3 hours).
                </Text>
              )
            ) : (
              <Pressable onPress={() => router.push('/pair-device' as any)}>
                <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
                  No sensor yet — pair a Greenr sensor to track real soil moisture for {plant.name}.
                </Text>
                <Text style={[type.caption, { color: accent.verdant, marginTop: 8 }]}>Pair a sensor →</Text>
              </Pressable>
            )}
          </Card>

          </>)}

          {/* ── Light (real sensor history) ── */}
          {detailsOpen && liveDeviceId && (
            <>
              <SectionHeader>Light</SectionHeader>
              <Card>
                {lightBars.length >= 2 ? (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 84, gap: 3 }}>
                      {lightBars.map((r, i) => (
                        <View
                          key={i}
                          style={{
                            flex: 1,
                            height: `${Math.max(3, Math.min(100, r.light_lux as number))}%`,
                            backgroundColor: accent.sunbeam,
                            borderRadius: 2,
                            opacity: 0.5 + 0.5 * (i / Math.max(1, lightBars.length - 1)),
                          }}
                        />
                      ))}
                    </View>
                    <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10, lineHeight: 15 }]}>
                      Relative light (0–100) from your sensor · last {lightBars.length} readings · now{' '}
                      {calReading?.light_lux != null ? Math.round(calReading.light_lux) : '—'}. Taller bar = brighter.
                    </Text>
                    {/* Artificial light is real light — say so when it's counted,
                        and note the dark period plants still need. */}
                    {todayLight?.artificial && (
                      <View
                        style={{
                          flexDirection: 'row',
                          gap: 8,
                          marginTop: 10,
                          padding: 10,
                          borderRadius: 10,
                          backgroundColor: `${accent.sunbeam}18`,
                        }}
                      >
                        <Ionicons name="bulb-outline" size={15} color={accent.sunbeam} style={{ marginTop: 1 }} />
                        <Text style={[type.micro, { color: dark.inkMuted, flex: 1, lineHeight: 16 }]}>
                          <Text style={{ color: accent.sunbeam }}>Lamp light counted.</Text> A lamp or grow light was
                          bright enough after dark to drive photosynthesis, so those hours count toward{' '}
                          {plant.name}&apos;s light. Dim room lighting is ignored — below roughly 200–500 lux a plant
                          burns more energy than it makes. Most plants still want a few hours of real darkness each night.
                        </Text>
                      </View>
                    )}
                    {bench ? (
                      <View
                        style={{
                          flexDirection: 'row',
                          gap: 8,
                          marginTop: 12,
                          padding: 10,
                          borderRadius: 10,
                          backgroundColor: `${toneColor(bench.tone)}18`,
                        }}
                      >
                        <Ionicons
                          name={bench.tone === 'good' ? 'checkmark-circle' : 'alert-circle'}
                          size={16}
                          color={toneColor(bench.tone)}
                          style={{ marginTop: 1 }}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={[type.caption, { color: toneColor(bench.tone) }]}>{bench.headline}</Text>
                          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, lineHeight: 15 }]}>
                            {bench.detail}
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10, lineHeight: 15 }]}>
                        Spot verdict arrives after a full day of readings — Greenr checks whether this
                        spot gives {plant.name} the light it needs.
                      </Text>
                    )}
                    {/* DLI estimate — real photometry from the light index */}
                    {dliHere && (
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: dark.hairline }}>
                        <View style={{ flex: 1 }}>
                          <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.3 }]}>ESTIMATED DLI</Text>
                          <Text style={[type.numBold as any, { color: dark.ink, fontSize: 18, marginTop: 2 }]}>
                            {dliHere.dli.toFixed(1)} <Text style={[type.micro, { color: dark.inkMuted }]}>mol/m²/day</Text>
                          </Text>
                          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, lineHeight: 14 }]}>
                            {dliHere.low.toFixed(1)}–{dliHere.high.toFixed(1)} range · {dliBracket(dliHere.dli)}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.3 }]}>{plant.species.toUpperCase()} WANTS</Text>
                          <Text style={[type.numBold as any, { color: dark.ink, fontSize: 18, marginTop: 2 }]}>
                            {ideal.dli[0]}–{ideal.dli[1]} <Text style={[type.micro, { color: dark.inkMuted }]}>DLI</Text>
                          </Text>
                          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, lineHeight: 14 }]}>
                            from ~{Math.round(dliHere.lux).toLocaleString()} lux · {Math.round(dliHere.ppfd)} µmol/m²/s
                          </Text>
                        </View>
                      </View>
                    )}
                  </>
                ) : (
                  <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
                    Collecting light readings — this fills in as your sensor reports.
                  </Text>
                )}

                {/* One-tap fix for reversed LDR modules (they read HIGH in the dark) */}
                {liveDeviceId && (
                  <Pressable
                    onPress={() => setLightInverted(liveDeviceId, !cal?.lightInverted)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, minHeight: 40 }}
                  >
                    <Ionicons
                      name={cal?.lightInverted ? 'swap-vertical' : 'swap-vertical-outline'}
                      size={15}
                      color={cal?.lightInverted ? accent.sage : accent.verdant}
                    />
                    <Text style={[type.caption, { color: cal?.lightInverted ? accent.sage : accent.verdant, flex: 1 }]}>
                      {cal?.lightInverted
                        ? 'Reversed-sensor fix is ON (readings flipped) — tap to undo'
                        : 'Readings backwards? (bright when covered) Tap to flip this sensor'}
                    </Text>
                  </Pressable>
                )}
              </Card>
            </>
          )}

          {/* ── Care guide: full for sensorless plants; a collapsed reference when
                 a sensor already provides live data (the sensor IS the guide) ── */}
          {detailsOpen && careProfile && (
            <>
              {!sensored && <SectionHeader>Care guide</SectionHeader>}
              <Card style={sensored ? { marginTop: 10 } : undefined}>
                {sensored ? (
                  <Pressable
                    onPress={() => setCareOpen(!careOpen)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 }}
                  >
                    <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15, flex: 1 }]}>
                      About {plant.species} — care basics &amp; pet safety
                    </Text>
                    {careProfile.toxicity.cats === 'toxic' || careProfile.toxicity.dogs === 'toxic' ? (
                      <Chip label="Toxic to pets" color={accent.clay} />
                    ) : null}
                    <Ionicons name={careOpen ? 'chevron-up' : 'chevron-down'} size={16} color={dark.inkMuted} />
                  </Pressable>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[type.cardTitle, { color: dark.ink }]}>{plant.species}</Text>
                      <Text style={[type.micro, { color: dark.inkMuted, fontStyle: 'italic', marginTop: 1 }]}>
                        {plant.latin}
                      </Text>
                    </View>
                    <Chip
                      label={careProfile.verified ? '✓ Verified' : 'Category estimate'}
                      color={careProfile.verified ? accent.sage : accent.sunbeamText}
                    />
                  </View>
                )}

                {(!sensored || careOpen) && (
                  <>
                    {/* fact chips */}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                      <Fact label="Difficulty" value={careProfile.difficulty} />
                      <Fact label="Growth rate" value={careProfile.growthRate} />
                      <Fact label="Mature size" value={careProfile.matureSize} />
                      <Fact label="Hardiness" value={careProfile.hardinessZones} />
                      <Fact label="Placement" value={careProfile.placement} />
                    </View>

                    {/* pet toxicity — safety-forward */}
                    {(() => {
                      const t = toxSummary(careProfile.toxicity);
                      return (
                        <View
                          style={{
                            flexDirection: 'row',
                            gap: 8,
                            marginTop: 12,
                            padding: 10,
                            borderRadius: 12,
                            backgroundColor: `${t.color}18`,
                          }}
                        >
                          <Ionicons name={t.icon} size={16} color={t.color} style={{ marginTop: 1 }} />
                          <View style={{ flex: 1 }}>
                            <Text style={[type.micro, { color: t.color, letterSpacing: 0.3 }]}>
                              PET TOXICITY · {careProfile.toxicity.source}
                            </Text>
                            <Text style={[type.caption, { color: dark.ink, marginTop: 2, lineHeight: 18 }]}>
                              {t.text}
                            </Text>
                          </View>
                        </View>
                      );
                    })()}

                    {/* measurable care lines */}
                    <CareLine emoji="💧" label="Water" text={careProfile.moisture.note} />
                    <CareLine emoji="☀️" label="Light" text={careProfile.light.note} />
                    <CareLine emoji="🌡️" label="Temperature" text={careProfile.temperature.note} />
                    <CareLine emoji="💨" label="Humidity" text={careProfile.humidity.note} />
                    <CareLine
                      emoji="🪴"
                      label="Soil & drainage"
                      text={`${careProfile.soil.type}. Drainage: ${careProfile.soil.drainage.toLowerCase()}. ${careProfile.soil.potting}`}
                    />
                    <CareLine emoji="🧪" label="Fertilizer" text={careProfile.fertilizer} />

                    {/* expandable: seasonal, dormancy, diseases, pests, warning signs */}
                    <Pressable
                      onPress={() => setSignsOpen(!signsOpen)}
                      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, marginTop: 8 }}
                    >
                      <Text style={[type.caption, { color: accent.verdant, flex: 1 }]}>
                        {signsOpen ? 'Less detail' : 'Seasonal care, pests & warning signs'}
                      </Text>
                      <Ionicons name={signsOpen ? 'chevron-up' : 'chevron-down'} size={16} color={accent.verdant} />
                    </Pressable>
                    {signsOpen && (
                      <View>
                        <Hairline style={{ marginBottom: 4 }} />
                        <CareLine emoji="🍂" label="Seasonal adjustments" text={careProfile.seasonal} />
                        <CareLine emoji="😴" label="Dormancy" text={careProfile.dormancy} />
                        <CareLine emoji="🌱" label="Growth expectations" text={careProfile.growthExpectations} />
                        <CareLine emoji="🦠" label="Common diseases" text={careProfile.diseases} />
                        <CareLine emoji="🐛" label="Common pests" text={careProfile.pests} />
                        <CareLine emoji="💧" label="Signs of overwatering" text={careProfile.signs.overwatering} />
                        <CareLine emoji="🏜️" label="Signs of underwatering" text={careProfile.signs.underwatering} />
                        <CareLine emoji="🔆" label="Too much light" text={careProfile.signs.tooMuchLight} />
                        <CareLine emoji="🌑" label="Too little light" text={careProfile.signs.tooLittleLight} />
                      </View>
                    )}

                    {/* sources + honesty footer */}
                    <Hairline style={{ marginVertical: 12 }} />
                    <Text style={[type.micro, { color: dark.inkMuted, lineHeight: 15 }]}>
                      Sources: {careProfile.sources.join(' · ')}.
                      {!careProfile.verified &&
                        ' Values are typical for this plant’s category — accurate as a baseline, but not individually verified for this species.'}
                    </Text>
                  </>
                )}
              </Card>
            </>
          )}

          {/* ── Growth journal: the outcome dimension no sensor can read ── */}
          {detailsOpen && (
          <Card style={{ marginTop: 10 }} onPress={() => router.push(`/growth/${plant.id}` as any)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 22 }}>📈</Text>
              <View style={{ flex: 1 }}>
                <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]}>Growth journal</Text>
                <Text style={[type.micro, { color: growthLine ? accent.sage : dark.inkMuted, marginTop: 2, lineHeight: 15 }]}>
                  {growthLine ??
                    (growth.entries.length > 0
                      ? `${growth.entries.length} ${growth.entries.length === 1 ? 'entry' : 'entries'} logged`
                      : 'Track height, leaves & progress photos over time.')}
                </Text>
              </View>
              {growth.photos.length > 0 && (
                <Text style={[type.micro, { color: dark.inkMuted }]}>{growth.photos.length} 📷</Text>
              )}
              <Ionicons name="chevron-forward" size={16} color={dark.inkMuted} />
            </View>
          </Card>
          )}

          {/* ── Photo-check: for problems no sensor can see (pests, spots, yellowing) ── */}
          <Card style={{ marginTop: 10 }} onPress={openDiagnose}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 22 }}>🔍</Text>
              <View style={{ flex: 1 }}>
                <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]}>
                  Something look off?
                </Text>
                <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, lineHeight: 15 }]}>
                  Yellowing leaves, spots, pests — {sensored ? 'sensors can’t see these. ' : ''}Photo-check it.
                </Text>
              </View>
              {!settings.plus && <Chip label="Greenr+" color={accent.sunbeamText} />}
              <Ionicons name="chevron-forward" size={16} color={dark.inkMuted} />
            </View>
          </Card>

          {/* ── Spot fit for THIS plant (Habitat Suitability model) ── */}
          {detailsOpen && selfMatch && selfMatch.factors.length > 0 && (
            <>
              <SectionHeader>How well this spot suits {plant.name}</SectionHeader>
              <Card accentBorder={selfMatch.score < 42 ? accent.clay : undefined}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ alignItems: 'center', minWidth: 62 }}>
                    <Text style={[type.ritualTitle, { color: matchColor(selfMatch.score), fontSize: 30 }]}>
                      {selfMatch.score}
                    </Text>
                    <Text style={[type.micro, { color: dark.inkMuted }]}>/ 100</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.cardTitle, { color: matchColor(selfMatch.score), fontSize: 16 }]}>
                      {selfMatch.verdict}
                    </Text>
                    <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, lineHeight: 15 }]}>
                      {selfMatch.why}
                    </Text>
                  </View>
                </View>
                <Hairline style={{ marginVertical: 12 }} />
                {selfMatch.factors.map((f) => (
                  <FactorBar key={f.key} f={f} />
                ))}
                <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10, lineHeight: 15 }]}>
                  Habitat Suitability Index: each factor scored against {plant.species}&apos;s tolerance
                  curve, combined by weighted geometric mean (the scarcest factor limits the score).
                  {selfMatch.confidence < 0.7 ? ' Light is an uncalibrated estimate, so treat this as approximate.' : ''}
                </Text>
              </Card>
            </>
          )}

          {/* ── What thrives in this spot (compatibility from the sensor) ── */}
          {detailsOpen && spotMatches.length > 0 && (
            <>
              <SectionHeader>Thrives in this spot</SectionHeader>
              <Card>
                <Text style={[type.micro, { color: dark.inkMuted, marginBottom: 12, lineHeight: 15 }]}>
                  Every species ranked for this spot&apos;s measured light (≈{dliHere ? dliHere.dli.toFixed(1) : '—'} DLI),
                  temperature, and humidity — same suitability model, higher = better fit.
                </Text>
                {spotMatches.map((m, i) => (
                  <View key={m.species.common}>
                    {i > 0 && <Hairline style={{ marginVertical: 12 }} />}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text style={{ fontSize: 22 }}>{m.species.emoji}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]} numberOfLines={1}>
                          {m.species.common}
                        </Text>
                        <Text style={[type.micro, { color: dark.inkMuted }]} numberOfLines={1}>
                          {m.verdict}
                          {m.limiting ? ` · limited by ${m.limiting.label.toLowerCase()}` : ' · all factors in range'}
                        </Text>
                      </View>
                      <Text style={[type.numBold as any, { fontSize: 17, color: matchColor(m.score) }]}>
                        {m.score}
                      </Text>
                    </View>
                    {/* score bar */}
                    <View style={{ height: 5, borderRadius: 3, backgroundColor: dark.hairline, marginTop: 7, overflow: 'hidden' }}>
                      <View style={{ width: `${m.score}%`, height: 5, backgroundColor: matchColor(m.score) }} />
                    </View>
                  </View>
                ))}
              </Card>
            </>
          )}

          {/* ── History (accordion) ── */}
          <Card style={{ marginTop: 10 }}>
            <Pressable
              onPress={() => setTimelineOpen(!timelineOpen)}
              style={{ flexDirection: 'row', alignItems: 'center', minHeight: 36 }}
            >
              <Text style={[type.cardTitle, { color: dark.ink, flex: 1 }]}>History</Text>
              <Text style={[type.micro, { color: dark.inkMuted, marginRight: 8 }]}>
                {plant.timeline.length} events
              </Text>
              <Ionicons name={timelineOpen ? 'chevron-up' : 'chevron-down'} size={18} color={dark.inkMuted} />
            </Pressable>
            {timelineOpen && (
              <View style={{ marginTop: 10 }}>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                  {(['All', 'Photos', 'Care', 'Insights'] as TimelineFilter[]).map((f) => (
                    <Pressable
                      key={f}
                      onPress={() => setFilter(f)}
                      style={{
                        minHeight: 40,
                        justifyContent: 'center',
                        paddingHorizontal: 12,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: filter === f ? accent.verdant : dark.hairline,
                      }}
                    >
                      <Text style={[type.micro, { color: filter === f ? dark.ink : dark.inkMuted }]}>{f}</Text>
                    </Pressable>
                  ))}
                </View>
                {events.length === 0 && (
                  <Text style={[type.caption, { color: dark.inkMuted }]}>Nothing here yet.</Text>
                )}
                {events.map((e, i) => (
                  <View key={e.id}>
                    {i > 0 && <Hairline style={{ marginVertical: 10 }} />}
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <Ionicons
                        name={
                          e.kind === 'photo'
                            ? 'image-outline'
                            : e.kind === 'care'
                              ? 'water-outline'
                              : e.kind === 'band-change'
                                ? 'swap-vertical-outline'
                                : 'analytics-outline'
                        }
                        size={16}
                        color={dark.inkMuted}
                        style={{ marginTop: 2 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[type.body, { color: dark.ink, lineHeight: 20 }]}>{e.text}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 }}>
                          <Text style={[type.micro, { color: dark.inkMuted }]}>{daysAgoLabel(eventDaysAgo(e))}</Text>
                          {e.verified && <Chip label="✓ verified" color={accent.sage} />}
                        </View>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </Card>
        </View>
      </ScrollView>

      {/* ── Water amount sheet: logging the amount is what makes reminders exact ── */}
      {/* brief confirmation after any watering log */}
      {waterLoggedMsg && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: insets.bottom + 96,
            alignItems: 'center',
          }}
          pointerEvents="none"
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 22,
              backgroundColor: dark.surface2,
              borderWidth: 1,
              borderColor: accent.sage,
            }}
          >
            <Ionicons name="checkmark-circle" size={16} color={accent.sage} />
            <Text style={[type.caption, { color: dark.ink }]}>{waterLoggedMsg}</Text>
          </View>
        </View>
      )}

      {waterOpen && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: insets.bottom + 92,
            paddingHorizontal: layout.margin,
          }}
        >
          <Card elevated>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15, flex: 1 }]}>
                How much did you actually pour?
              </Text>
              <Pressable onPress={() => setWaterOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={18} color={dark.inkMuted} />
              </Pressable>
            </View>
            {/* The wording matters. Asking "how much water?" invites people to
                accept whatever the app proposed, and an accepted suggestion
                cannot test the suggestion. Asking what they POURED — and saying
                why — is what turns each watering into evidence. */}
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4, lineHeight: 15 }]}>
              Greenr suggested {pourMl} ml. Tell it the real amount, even if it was
              nothing like that — that is how it finds out whether the suggestion was right.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              {[
                { label: 'Splash', ml: 100 },
                { label: 'Cup', ml: 250 },
                { label: 'Soak', ml: 500 },
              ].map((o) => (
                <Pressable
                  key={o.label}
                  onPress={() => doLogWater(o.ml)}
                  style={{
                    flex: 1,
                    minHeight: 56,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: dark.hairline,
                  }}
                >
                  <Text style={[type.cardTitle, { color: dark.ink, fontSize: 14 }]}>{o.label}</Text>
                  <Text style={[type.micro, { color: dark.inkMuted }]}>~{o.ml} ml</Text>
                </Pressable>
              ))}
            </View>

            {/* Custom amount — a gardener who measured their pour can log it exactly */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: dark.hairline,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  minHeight: 48,
                }}
              >
                <TextInput
                  value={customMl}
                  onChangeText={(t) => setCustomMl(t.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  placeholder="Custom amount"
                  placeholderTextColor={dark.inkMuted}
                  onSubmitEditing={logCustomWater}
                  returnKeyType="done"
                  style={{ flex: 1, color: dark.ink, fontSize: 15 }}
                />
                <Text style={[type.caption, { color: dark.inkMuted }]}>ml</Text>
              </View>
              <Pressable
                onPress={logCustomWater}
                disabled={!customMl}
                style={{
                  paddingHorizontal: 18,
                  minHeight: 48,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: customMl ? accent.verdant : dark.surface2,
                }}
              >
                <Text style={[type.cardTitle, { color: customMl ? '#08110B' : dark.inkMuted, fontSize: 14 }]}>Log</Text>
              </Pressable>
            </View>

            {/* Repeat the last measured pour in one tap */}
            {lastLoggedMl != null && (
              <Pressable
                onPress={() => doLogWater(lastLoggedMl, 'measured')}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, minHeight: 32 }}
              >
                <Ionicons name="refresh" size={14} color={accent.verdant} />
                <Text style={[type.caption, { color: accent.verdant }]}>Repeat last pour — {lastLoggedMl} ml</Text>
              </Pressable>
            )}

            {/* Same number as the card above and the plan — never a third figure. */}
            <Pressable
              onPress={() => doLogWater(pourMl)}
              style={{
                minHeight: 48,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: accent.verdant,
                marginTop: 8,
              }}
            >
              <Text style={[type.cardTitle, { color: '#fff', fontSize: 14 }]}>
                Recommended for this plant — {pourMl} ml
              </Text>
            </Pressable>
            {efficientPour != null && (
              <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6, lineHeight: 14, textAlign: 'center' }]}>
                Learned from your plant&apos;s own drying curve
              </Text>
            )}
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 8, lineHeight: 15 }]}>
              {sensored
                ? 'The sensor verifies the pour on its next reading.'
                : 'Each log teaches Greenr this plant’s real rhythm — reminders get sharper.'}
            </Text>
          </Card>
        </View>
      )}

      {/* ── Log FAB: one unmissable button, every loggable action inside ── */}
      <View
        style={{ position: 'absolute', right: 16, bottom: insets.bottom + 18, left: 0, top: 0 }}
        pointerEvents="box-none"
      >
        <View style={{ position: 'absolute', right: 0, bottom: 0 }}>
          <LogFab
            actions={[
              { icon: '💧', label: 'Log watering', run: () => setWaterOpen(true) },
              { icon: '🧪', label: 'Log fertilizing', run: () => logCare(plant.id, 'Fertilized (logged)') },
              { icon: '💨', label: 'Log misting', run: () => logCare(plant.id, 'Misted (logged)') },
              { icon: '✂️', label: 'Log pruning', run: () => logCare(plant.id, 'Pruned (logged)') },
              { icon: '🪴', label: 'Log repotting', run: () => logCare(plant.id, 'Repotted (logged)') },
              { icon: '📷', label: photoAdded ? 'Photo added ✓' : 'Add a photo', run: () => setShowCamera(true) },
              { icon: '📈', label: 'Log growth', run: () => router.push(`/growth/${plant.id}` as any) },
              { icon: '🔍', label: settings.plus ? 'Diagnose (photo-check)' : 'Diagnose · Greenr+', run: openDiagnose },
            ]}
          />
        </View>
      </View>
    </View>
  );
}
