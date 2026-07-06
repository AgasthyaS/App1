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
import { careFor } from '@/lib/plantCare';
import { wateringAdvice } from '@/lib/watering';
import { COMPONENT_MAX, ScoreComponents } from '@/lib/types';

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
  const { plants, spots, sensors, settings, logWater, archivePlant, setPlantPhoto, renamePlant } = useGreenr();
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
  const displayScore = useLiquidScore(plant?.score ?? 0);
  const { reading: liveReading, history: liveHistory, deviceId: liveDeviceId } = useLiveReading(
    typeof id === 'string' ? id : undefined,
  );

  if (!plant) {
    return (
      <View style={{ flex: 1, backgroundColor: dark.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.body, { color: dark.inkMuted }]}>Plant not found.</Text>
      </View>
    );
  }

  const band = bandFor(plant.score);
  const advice = adviceFor(plant, spot);
  const ideal = idealsFor(plant.species, plant.comfortBand);
  const toneColor = (t: Tone) =>
    t === 'good' ? accent.sage : t === 'warn' ? accent.sunbeam : t === 'bad' ? accent.clay : dark.inkMuted;
  const watering = liveDeviceId ? wateringAdvice(liveHistory, ideal.band, plant.species) : null;
  const insights = liveDeviceId ? insightsFor(liveHistory, plant.species, ideal.band) : [];
  const care = careFor(plant.species);
  // Which species would thrive in THIS spot, from the sensor's real environment.
  const spotMatches =
    liveReading != null
      ? plantsForEnvironment(liveReading.light_lux, liveReading.temp_c, liveReading.humidity_pct, 5).filter(
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
              <Breathing enabled={plant.score >= 85}>
                {plant.photoUri ? (
                  <VitalityRing
                    score={displayScore}
                    size={132}
                    estimate={plant.estimate}
                    estimateBand={plant.estimateBand}
                    showLabel={false}
                    trackColor={dark.hairline}
                  >
                    <PlantAvatar photoUri={plant.photoUri} emoji={plant.emoji} size={96} />
                  </VitalityRing>
                ) : (
                  <VitalityRing
                    score={displayScore}
                    size={132}
                    estimate={plant.estimate}
                    estimateBand={plant.estimateBand}
                    subLabel={plant.estimate ? `${band.word} · estimate` : band.word}
                    trackColor={dark.hairline}
                  />
                )}
              </Breathing>
              {plant.photoUri && (
                <Text style={[type.num as any, { fontSize: 15, color: band.color, marginTop: 10 }]}>
                  {displayScore}
                  {plant.estimate ? ` ±${plant.estimateBand}` : ''} · {band.word}
                </Text>
              )}
              <Text style={[type.screenTitle, { color: dark.ink, marginTop: 14 }]}>{plant.name}</Text>
              <Text style={[type.caption, { color: dark.inkMuted, marginTop: 3 }]}>
                {plant.latin} · {spot?.name ?? '—'}
              </Text>
              {sensor ? (
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
                    { label: 'Soil', s: soilStatus(liveReading?.soil_pct, ideal.band) },
                    { label: 'Light', s: lightStatus(liveReading?.light_lux, ideal.dli) },
                    { label: 'Temperature', s: tempStatus(liveReading?.temp_c, ideal.temp) },
                    { label: 'Humidity', s: humidityStatus(liveReading?.humidity_pct, ideal.rhFloor) },
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
              liveHistory.length >= 2 ? (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 84, gap: 3 }}>
                    {liveHistory.map((r, i) => (
                      <View
                        key={i}
                        style={{
                          flex: 1,
                          height: `${Math.max(4, Math.min(100, r.soil_pct ?? 0))}%`,
                          backgroundColor: accent.verdant,
                          borderRadius: 2,
                          opacity: 0.45 + 0.55 * (i / Math.max(1, liveHistory.length - 1)),
                        }}
                      />
                    ))}
                  </View>
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10, lineHeight: 15 }]}>
                    Last {liveHistory.length} readings · now {liveReading?.soil_pct ?? '—'}%. History keeps
                    filling in as your sensor reports.
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
                {liveHistory.length >= 2 ? (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 84, gap: 3 }}>
                      {liveHistory.map((r, i) => (
                        <View
                          key={i}
                          style={{
                            flex: 1,
                            height: `${Math.max(4, Math.min(100, r.light_lux ?? 0))}%`,
                            backgroundColor: accent.sunbeam,
                            borderRadius: 2,
                            opacity: 0.45 + 0.55 * (i / Math.max(1, liveHistory.length - 1)),
                          }}
                        />
                      ))}
                    </View>
                    <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10, lineHeight: 15 }]}>
                      Relative light (0–100) from your sensor · now {liveReading?.light_lux ?? '—'}. Taller
                      bar = brighter at that reading.
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

          {/* ── Care guide (from the knowledge base) ── */}
          {care && (
            <Card style={{ marginTop: 10 }}>
              <Pressable
                onPress={() => setCareOpen(!careOpen)}
                style={{ flexDirection: 'row', alignItems: 'center', minHeight: 36 }}
              >
                <Text style={[type.cardTitle, { color: dark.ink, flex: 1 }]}>
                  {plant.species} care guide
                </Text>
                <Ionicons name={careOpen ? 'chevron-up' : 'chevron-down'} size={18} color={dark.inkMuted} />
              </Pressable>
              {careOpen && (
                <View style={{ marginTop: 8 }}>
                  {(
                    [
                      ['💧', 'Signs of overwatering', care.overwatering],
                      ['🏜️', 'Signs of underwatering', care.underwatering],
                      ['☀️', 'Too much light', care.tooMuchLight],
                      ['🌑', 'Too little light', care.tooLittleLight],
                      ['🌱', 'Growth', care.growth],
                      ['🧪', 'Fertilizer', care.fertilizer],
                      ['😴', 'Dormancy', care.dormancy],
                      ['🐛', 'Common pests', care.pests],
                      ['🪴', 'Potting', care.potting],
                    ] as [string, string, string][]
                  ).map(([emoji, label, text], i) => (
                    <View key={label}>
                      {i > 0 && <Hairline style={{ marginVertical: 10 }} />}
                      <Text style={[type.caption, { color: dark.inkMuted }]}>
                        {emoji} {label}
                      </Text>
                      <Text style={[type.body, { color: dark.ink, marginTop: 3, lineHeight: 21 }]}>{text}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Card>
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
