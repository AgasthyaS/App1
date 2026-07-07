import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Breathing from '@/components/greenr/Breathing';
import CameraCapture from '@/components/greenr/CameraCapture';
import ForecastBar from '@/components/greenr/ForecastBar';
import PlantAvatar from '@/components/greenr/PlantAvatar';
import RangeRibbon from '@/components/greenr/RangeRibbon';
import { Card, Chip, GButton, Hairline, SectionHeader } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, bandFor, dark, layout, type } from '@/constants/theme';
import { adviceFor } from '@/lib/advice';
import { daysAgoLabel } from '@/lib/format';
import { useGreenr } from '@/lib/store';
import { useLiveReading } from '@/lib/useLiveReading';
import {
  humidityStatus,
  idealsFor,
  lightStatus,
  soilStatus,
  tempStatus,
  type Tone,
} from '@/lib/plantStatus';
import { plantsForEnvironment } from '@/lib/compatibility';
import { insightsFor } from '@/lib/insights';
import { careProfileFor } from '@/lib/plantCare';
import { computeHealth, type HealthComponent } from '@/lib/health';
import { applyCalibration } from '@/lib/calibration';
import type { Toxicity } from '@/lib/plants';
import { computeSchedule, wateringIcs } from '@/lib/schedule';
import { useWeather } from '@/lib/useWeather';
import { weatherWateringImpact } from '@/lib/weather';
import { shareContent } from '@/lib/platform';
import { wateringAdvice } from '@/lib/watering';
import { COMPONENT_MAX, ScoreComponents } from '@/lib/types';

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

const COMPONENT_LABELS: Record<keyof ScoreComponents, string> = {
  hydration: 'Hydration',
  light: 'Light',
  climate: 'Climate',
  consistency: 'Consistency',
  trend: 'Trend',
};

/** Evidence panels stay directional, not exact — the recipe is ours. */
function evidenceFor(key: keyof ScoreComponents, plantName: string, sensored: boolean): string {
  switch (key) {
    case 'hydration':
      return sensored
        ? 'Scored from time inside the comfort band, with a penalty for over-wet days. Inputs: sensor readings on your calibration, verified waterings.'
        : 'Scored from a drying model (pot, species, weather) fitted to your logged waterings. Modeled — a sensor replaces the model with measurement.';
    case 'light':
      return 'Scored against the light this species wants, from your spot audits and sensor readings over the last week.';
    case 'climate':
      return 'Scored from how many hours sat inside the temperature and humidity comfort bands.';
    case 'consistency':
      return `Scored from how reliably ${plantName} got care within a day of forecast over the last 12 weeks.`;
    case 'trend':
      return 'The direction of the last two weeks — recovering earns points, sliding loses them.';
  }
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

function severityColor(s: 'good' | 'caution' | 'critical'): string {
  return s === 'good' ? accent.sage : s === 'caution' ? accent.sunbeam : accent.clay;
}

export default function PlantDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { plants, spots, sensors, settings, calibrations, logWater, archivePlant, setPlantPhoto, renamePlant } =
    useGreenr();
  const plant = plants.find((p) => p.id === id);
  const [expanded, setExpanded] = useState<keyof ScoreComponents | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [careOpen, setCareOpen] = useState(false);
  const [filter, setFilter] = useState<TimelineFilter>('All');
  const [pokeAnswered, setPokeAnswered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [photoAdded, setPhotoAdded] = useState(false);
  const [showCamera, setShowCamera] = useState(false);

  const spot = useMemo(() => spots.find((s) => s.id === plant?.spotId), [spots, plant]);
  const sensor = useMemo(() => sensors.find((s) => s.id === plant?.sensorId), [sensors, plant]);
  const { reading: liveReading, history: liveHistory, deviceId: liveDeviceId } = useLiveReading(
    typeof id === 'string' ? id : undefined,
  );
  const weather = useWeather(); // shares the cached location/weather; no extra prompt
  // Apply this sensor's calibration offsets so the whole screen — health,
  // status, watering, charts — uses corrected values consistently (§8/§6).
  const cal = calibrations[sensor?.id ?? liveDeviceId ?? ''] ?? null;
  const calReading = useMemo(
    () => (liveReading ? applyCalibration(liveReading, cal) : liveReading),
    [liveReading, cal],
  );
  const calHistory = useMemo(
    () => (cal ? liveHistory.map((r) => applyCalibration(r, cal)) : liveHistory),
    [liveHistory, cal],
  );
  // Live health, computed from the sensor vs this species' ideals (§9). When
  // measured, it — not the seeded estimate — drives the hero ring (§3).
  const health = useMemo(
    () =>
      plant && liveDeviceId
        ? computeHealth(plant.species, plant.comfortBand, liveReading, liveHistory, settings.unitsF, cal)
        : null,
    [plant, liveDeviceId, liveReading, liveHistory, settings.unitsF, cal],
  );
  // A live sensor is authoritative: never show estimate visuals for it (§6).
  const sensored = liveDeviceId != null;
  const measured = !!health?.measured;
  const awaiting = sensored && !measured; // paired but no reading yet
  const showEstimate = !!plant?.estimate && !sensored;
  const effectiveScore = measured ? health!.total : plant?.score ?? 0;
  const displayScore = useLiquidScore(effectiveScore);

  if (!plant) {
    return (
      <View style={{ flex: 1, backgroundColor: dark.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.body, { color: dark.inkMuted }]}>Plant not found.</Text>
      </View>
    );
  }

  const band = bandFor(effectiveScore);
  const advice = adviceFor(plant, spot);
  const ideal = idealsFor(plant.species, plant.comfortBand);
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
  const careProfile = careProfileFor(plant.species);
  // Charts plot only real readings — a missing metric is skipped, never drawn as 0.
  const soilBars = calHistory.filter((r) => r.soil_pct != null);
  const lightBars = calHistory.filter((r) => r.light_lux != null);
  // Which species would thrive in THIS spot, from the sensor's real environment.
  const spotMatches =
    calReading != null
      ? plantsForEnvironment(calReading.light_lux, calReading.temp_c, calReading.humidity_pct, 5).filter(
          (m) => m.species.common !== plant.species,
        )
      : [];
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
              <Pressable onPress={() => setMenuOpen(!menuOpen)} style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}>
                <Ionicons name="ellipsis-horizontal" size={22} color={dark.ink} />
              </Pressable>
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
              <Breathing enabled={!awaiting && effectiveScore >= 85}>
                {plant.photoUri ? (
                  <VitalityRing
                    score={awaiting ? 0 : displayScore}
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
                    score={awaiting ? 0 : displayScore}
                    size={132}
                    estimate={showEstimate}
                    estimateBand={showEstimate ? plant.estimateBand : 0}
                    subLabel={awaiting ? 'Awaiting reading' : showEstimate ? `${band.word} · estimate` : band.word}
                    showLabel={!awaiting}
                    trackColor={dark.hairline}
                  />
                )}
              </Breathing>
              {plant.photoUri &&
                (awaiting ? (
                  <Text style={[type.caption, { color: dark.inkMuted, marginTop: 10 }]}>Awaiting first reading</Text>
                ) : (
                  <Text style={[type.num as any, { fontSize: 15, color: band.color, marginTop: 10 }]}>
                    {displayScore}
                    {showEstimate ? ` ±${plant.estimateBand}` : ''} · {band.word}
                  </Text>
                ))}
              <Text style={[type.screenTitle, { color: dark.ink, marginTop: 14 }]}>{plant.name}</Text>
              <Text style={[type.caption, { color: dark.inkMuted, marginTop: 3 }]}>
                {plant.latin} · {spot?.name ?? '—'}
              </Text>
              {sensored ? (
                <Pressable onPress={() => router.push('/devices' as any)} style={{ marginTop: 10 }}>
                  <Chip label={measured ? 'Sensor connected · live data' : 'Sensor connected · awaiting reading'} color={accent.sage} />
                </Pressable>
              ) : sensor ? (
                <Pressable onPress={() => router.push(`/sensor/${sensor.id}`)} style={{ marginTop: 10 }}>
                  <Chip label={`${sensor.name} · soil ${sensor.latest.soilPct}%`} color={accent.verdant} />
                </Pressable>
              ) : (
                <Pressable onPress={() => router.push('/pair-sensor')} style={{ marginTop: 10 }}>
                  <Chip label="Estimated — a sensor makes it exact" color={accent.sunbeamText} />
                </Pressable>
              )}
            </View>
          </LinearGradient>
        </View>

        <View style={{ paddingHorizontal: layout.margin }}>
          {/* ── Live sensor: plant-specific meaning, N/A until first reading ── */}
          {liveDeviceId && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 20, marginBottom: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent.sage }} />
                <Text style={[type.micro, { color: accent.sage, letterSpacing: 0.5 }]}>SENSOR CONNECTED</Text>
              </View>
              <Card>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 }}>
                  {[
                    { label: 'Soil', s: soilStatus(calReading?.soil_pct, ideal.band) },
                    { label: 'Light', s: lightStatus(calReading?.light_lux, ideal.dli) },
                    { label: 'Temperature', s: tempStatus(calReading?.temp_c, ideal.temp) },
                    { label: 'Humidity', s: humidityStatus(calReading?.humidity_pct, ideal.rhFloor) },
                  ].map(({ label, s }) => (
                    <View key={label} style={{ width: '50%', paddingRight: 8 }}>
                      <Text style={[type.cardTitle, { color: toneColor(s.tone), fontSize: 18 }]}>{s.label}</Text>
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>
                        {label}
                        {s.raw ? ` · ${s.raw}` : ''}
                      </Text>
                    </View>
                  ))}
                </View>
                <Text style={[type.micro, { color: dark.inkMuted, marginTop: 14, lineHeight: 15 }]}>
                  {liveReading
                    ? `Measured ${new Date(liveReading.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · judged against ${plant.species}'s ideal range`
                    : 'Waiting for the first reading — every metric shows N/A until your sensor reports.'}
                </Text>
                <Pressable
                  onPress={() => router.push(`/dashboard/${plant.id}` as any)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, minHeight: 32 }}
                >
                  <Ionicons name="stats-chart" size={14} color={accent.verdant} />
                  <Text style={[type.caption, { color: accent.verdant }]}>View full analytics</Text>
                </Pressable>
              </Card>
            </>
          )}

          {/* ── Plant health: transparent, live-computed breakdown (§9) ── */}
          {health?.measured && (
            <>
              <SectionHeader>Plant health</SectionHeader>
              <Card>
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
                <Hairline style={{ marginTop: 14 }} />
                {health.components.map((c) => (
                  <HealthRow key={c.key} c={c} />
                ))}
                <Text style={[type.micro, { color: dark.inkMuted, marginTop: 16, lineHeight: 15 }]}>
                  Score = sum of the five components (max 100), each judged against {plant.species}&apos;s ideal
                  ranges. Light is a relative index, so it&apos;s a coarser estimate than the measured metrics.
                </Text>
              </Card>
            </>
          )}

          {/* ── Watering: direct call from the sensor (replaces generic advice) ── */}
          {watering && (
            <>
              <SectionHeader>Watering</SectionHeader>
              <Card accentBorder={watering.tone === 'bad' ? accent.clay : undefined}>
                <Text style={[type.ritualTitle, { color: toneColor(watering.tone), fontSize: 22 }]}>
                  {watering.verdict}
                </Text>
                <Text style={[type.body, { color: dark.inkMuted, marginTop: 6, lineHeight: 21 }]}>
                  {watering.detail}
                </Text>
                {watering.confidence === 'low' && (
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10, lineHeight: 15 }]}>
                    Still gathering history — accuracy climbs with every reading.
                  </Text>
                )}

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

          {/* ── What Greenr has learned (from history) ── */}
          {insights.length > 0 && (
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

          {/* ── What it needs now (estimate path — only without a sensor) ── */}
          {!watering && (
          <><SectionHeader>What it needs now</SectionHeader>
          <Card>
            {advice.map((a, i) => (
              <View key={i}>
                {i > 0 && <Hairline style={{ marginVertical: 12 }} />}
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: `${severityColor(a.severity)}22`,
                    }}
                  >
                    <Ionicons name={a.icon as any} size={16} color={severityColor(a.severity)} />
                  </View>
                  <Text style={[type.body, { color: dark.ink, flex: 1, lineHeight: 21 }]}>{a.text}</Text>
                </View>
              </View>
            ))}
          </Card></>
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
                  30 minutes).
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

          {/* ── Light (real sensor history) ── */}
          {liveDeviceId && (
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
                  </>
                ) : (
                  <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
                    Collecting light readings — this fills in as your sensor reports.
                  </Text>
                )}
              </Card>
            </>
          )}

          {/* ── Care guide (measurable, from the plant database) ── */}
          {careProfile && (
            <>
              <SectionHeader>Care guide</SectionHeader>
              <Card>
                {/* header: species + verified/estimate honesty badge */}
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

                {/* fact chips */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  <Fact label="Difficulty" value={careProfile.difficulty} />
                  <Fact label="Growth rate" value={careProfile.growthRate} />
                  <Fact label="Mature size" value={careProfile.matureSize} />
                  <Fact label="Hardiness" value={careProfile.hardinessZones} />
                  <Fact label="Placement" value={careProfile.placement} />
                </View>

                {/* pet toxicity — safety-forward, always visible */}
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

                {/* measurable, always-visible care lines */}
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
                  onPress={() => setCareOpen(!careOpen)}
                  style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, marginTop: 8 }}
                >
                  <Text style={[type.caption, { color: accent.verdant, flex: 1 }]}>
                    {careOpen ? 'Less detail' : 'Seasonal care, pests & warning signs'}
                  </Text>
                  <Ionicons name={careOpen ? 'chevron-up' : 'chevron-down'} size={16} color={accent.verdant} />
                </Pressable>
                {careOpen && (
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
              </Card>
            </>
          )}

          {/* ── What thrives in this spot (compatibility from the sensor) ── */}
          {spotMatches.length > 0 && (
            <>
              <SectionHeader>Thrives in this spot</SectionHeader>
              <Card>
                <Text style={[type.micro, { color: dark.inkMuted, marginBottom: 10, lineHeight: 15 }]}>
                  Scored from this spot&apos;s live light, temperature, and humidity.
                </Text>
                {spotMatches.map((m, i) => (
                  <View key={m.species.common}>
                    {i > 0 && <Hairline style={{ marginVertical: 10 }} />}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text style={{ fontSize: 22 }}>{m.species.emoji}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]} numberOfLines={1}>
                          {m.species.common}
                        </Text>
                        <Text style={[type.micro, { color: dark.inkMuted }]} numberOfLines={1}>
                          {m.why}
                        </Text>
                      </View>
                      <Text
                        style={[
                          type.numBold as any,
                          { fontSize: 16, color: m.score >= 80 ? accent.sage : m.score >= 55 ? accent.sunbeam : accent.clay },
                        ]}
                      >
                        {m.score}%
                      </Text>
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
                          <Text style={[type.micro, { color: dark.inkMuted }]}>{daysAgoLabel(e.daysAgo)}</Text>
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

      {/* ── Sticky action bar ── */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          flexDirection: 'row',
          gap: 10,
          paddingHorizontal: layout.margin,
          paddingTop: 10,
          paddingBottom: insets.bottom + 10,
          backgroundColor: dark.surface1,
          borderTopWidth: 1,
          borderTopColor: dark.hairline,
        }}
      >
        <GButton
          title="Water"
          style={{ flex: 1, paddingHorizontal: 6 }}
          onPress={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            logWater(plant.id);
          }}
        />
        <GButton
          title={photoAdded ? 'Photo ✓' : plant.photoUri ? 'Change' : 'Photo'}
          kind="secondary"
          style={{ flex: 1, paddingHorizontal: 6 }}
          onPress={() => setShowCamera(true)}
        />
        <GButton
          title="Diagnose"
          kind="secondary"
          style={{ flex: 1, paddingHorizontal: 6 }}
          onPress={() =>
            settings.plus
              ? router.push({ pathname: '/diagnose/[id]', params: { id: plant.id } })
              : router.push('/plus')
          }
        />
      </View>
    </View>
  );
}
