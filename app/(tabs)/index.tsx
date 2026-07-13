import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, GButton } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, dark, layout, type } from '@/constants/theme';
import { applyCalibration, calibrationFor } from '@/lib/calibration';
import { estimateWaterSchedule, type EstimateSchedule } from '@/lib/estimate';
import { idealsFor } from '@/lib/plantStatus';
import { mlNeeded } from '@/lib/watering';
import { gardenVitalityAvg, vitalityFor } from '@/lib/health';
import { storedLightAvg } from '@/lib/insights';
import { computeSchedule, type WaterSchedule } from '@/lib/schedule';
import { activePlants, useGreenr } from '@/lib/store';
import { useAllLiveReadings, useAllReadingHistories } from '@/lib/useLiveReading';
import { useWeather } from '@/lib/useWeather';
import { cToF } from '@/lib/weather';
import { Plant } from '@/lib/types';

/**
 * Forecast (§4, Option B) — everything AHEAD: the days-ahead weather, each
 * plant's projected next-watering date, and the week's care schedule. Current
 * readings, health and alerts live on Home, so nothing is duplicated.
 */

/** Sort key so the soonest-thirsty plants surface first, sensored or not. */
function scheduleSort(s: WaterSchedule | undefined, est: EstimateSchedule | undefined): number {
  if (s) {
    if (s.status === 'overdue') return -1;
    if (s.nextWaterAt) return (s.nextWaterAt.getTime() - Date.now()) / 86400000;
    return 400;
  }
  if (est) {
    if (est.status === 'due') return 0;
    if (est.dueAt) return (est.dueAt.getTime() - Date.now()) / 86400000 + 0.1;
    return 500;
  }
  return 999;
}

function WeatherAhead({ w, unitsF }: { w: ReturnType<typeof useWeather>; unitsF: boolean }) {
  const daily = w.weather?.daily;
  if (!daily || daily.length < 2) return null;
  const temp = (c: number) => `${Math.round(unitsF ? cToF(c) : c)}°`;
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 18 }}>
        <Text style={[type.sectionHeader as any, { color: dark.inkMuted }]}>WEATHER AHEAD</Text>
      </View>
      <Card style={{ marginTop: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {daily.slice(0, 5).map((d, i) => {
            const wd = i === 0 ? 'Today' : new Date(d.date + 'T00:00').toLocaleDateString('en-US', { weekday: 'short' });
            return (
              <View key={d.date} style={{ alignItems: 'center', flex: 1 }}>
                <Text style={[type.micro, { color: dark.inkMuted }]}>{wd}</Text>
                <Text style={{ fontSize: 20, marginVertical: 3 }}>{d.emoji}</Text>
                <Text style={[type.caption, { color: dark.ink }]}>{temp(d.tempMaxC)}</Text>
                <Text style={[type.micro, { color: dark.inkMuted }]}>{temp(d.tempMinC)}</Text>
                <Text style={[type.micro, { color: d.rainProbPct >= 50 ? accent.verdant : dark.inkMuted, marginTop: 2 }]}>
                  ☔{d.rainProbPct}%
                </Text>
              </View>
            );
          })}
        </View>
      </Card>
    </>
  );
}

function ForecastRow({
  plant,
  hasSensor,
  schedule,
  estimate,
  refillMl,
  onPress,
}: {
  plant: Plant;
  hasSensor: boolean;
  schedule?: WaterSchedule;
  estimate?: EstimateSchedule;
  /** exact ml to pour when the sensor says it's dry right now */
  refillMl?: number | null;
  onPress: () => void;
}) {
  // Sensored plants project a real next-watering date from the drying trend (§5).
  if (hasSensor) {
    const s = schedule;
    const overdue = s?.status === 'overdue';
    return (
      <Card onPress={onPress} accentBorder={overdue ? accent.clay : undefined} style={{ marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="water-outline" size={16} color={accent.verdant} />
          <Text style={[type.cardTitle, { color: dark.ink, flex: 1 }]} numberOfLines={1}>
            {plant.name}
          </Text>
          <Text style={[type.cardTitle, { color: overdue ? accent.clay : dark.ink, fontSize: 15 }]} numberOfLines={1}>
            {s ? s.whenLabel : 'Gathering readings'}
          </Text>
        </View>
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6, lineHeight: 15 }]} numberOfLines={2}>
          {s && s.status !== 'unknown'
            ? s.basis
            : 'A watering date appears once the sensor has logged a few readings.'}
        </Text>
        {overdue && refillMl != null && (
          <Text style={[type.caption, { color: accent.clay, marginTop: 6 }]}>
            Add about <Text style={type.numBold as any}>{refillMl} ml</Text> to bring it back into range.
          </Text>
        )}
        {s?.weatherNote ? (
          <Text style={[type.micro, { color: accent.verdant, marginTop: 4, lineHeight: 15 }]} numberOfLines={2}>
            {s.weatherNote}
          </Text>
        ) : null}
      </Card>
    );
  }

  // Sensorless plants: the honest watering cycle — last watered + the species'
  // typical rhythm (learned from logs over time). No opaque bars, no fake scores.
  const est = estimate ?? estimateWaterSchedule(plant);
  const due = est.status === 'due';
  return (
    <Card onPress={onPress} accentBorder={due ? accent.sunbeam : undefined} style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="water-outline" size={16} color={due ? accent.sunbeam : dark.inkMuted} />
        <Text style={[type.cardTitle, { color: dark.ink, flex: 1 }]} numberOfLines={1}>
          {plant.name}
        </Text>
        <Text style={[type.cardTitle, { color: due ? accent.sunbeam : dark.ink, fontSize: 15 }]} numberOfLines={1}>
          {est.whenLabel}
        </Text>
      </View>
      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6, lineHeight: 15 }]} numberOfLines={2}>
        {est.detail}
      </Text>
    </Card>
  );
}

export default function ForecastTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { plants: allPlants, spots, tasks, briefingOpened, settings, calibrations, lightDaily } = useGreenr();
  const liveReadings = useAllLiveReadings();
  const histories = useAllReadingHistories();
  const weather = useWeather();
  const [refreshing, setRefreshing] = useState(false);

  const plants = useMemo(() => activePlants(allPlants), [allPlants]);

  // Project each sensored plant's next watering from its drying history + weather.
  // History is calibration-corrected first so offsets shift the projection too.
  const schedules = useMemo(() => {
    const m = new Map<string, WaterSchedule>();
    plants.forEach((p) => {
      if (!liveReadings.has(p.id)) return;
      const outdoor = !!spots.find((s) => s.id === p.spotId)?.outdoor;
      const cal = calibrationFor(calibrations, liveReadings.get(p.id)?.device_id, p.sensorId);
      const hist = (histories.get(p.id) ?? []).map((r) => applyCalibration(r, cal));
      m.set(
        p.id,
        computeSchedule(hist, p.comfortBand, p.species, {
          weather: weather.weather,
          outdoor,
        }),
      );
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plants, liveReadings, histories, spots, weather.weather, calibrations]);

  // Sensorless plants get the honest last-watered cycle instead of a model bar.
  const estimates = useMemo(() => {
    const m = new Map<string, EstimateSchedule>();
    plants.forEach((p) => {
      if (!liveReadings.has(p.id)) m.set(p.id, estimateWaterSchedule(p));
    });
    return m;
  }, [plants, liveReadings]);

  const sorted = useMemo(
    () =>
      [...plants].sort(
        (a, b) =>
          scheduleSort(schedules.get(a.id), estimates.get(a.id)) -
          scheduleSort(schedules.get(b.id), estimates.get(b.id)),
      ),
    [plants, schedules, estimates],
  );

  const avg = useMemo(
    () =>
      gardenVitalityAvg(
        plants.map((p) => ({
          plant: p,
          hasSensor: liveReadings.has(p.id),
          reading: liveReadings.get(p.id) ?? null,
          calibration: calibrationFor(calibrations, liveReadings.get(p.id)?.device_id, p.sensorId),
          lightAvg: storedLightAvg(lightDaily[p.id]),
        })),
        settings.unitsF,
      ),
    [plants, liveReadings, calibrations, lightDaily, settings.unitsF],
  );

  // Healthy = plants whose vitality is actually known and ≥70.
  const healthy = useMemo(
    () =>
      plants.filter((p) => {
        const v = vitalityFor(
          p,
          liveReadings.has(p.id),
          liveReadings.get(p.id) ?? null,
          calibrationFor(calibrations, liveReadings.get(p.id)?.device_id, p.sensorId),
          settings.unitsF,
          storedLightAvg(lightDaily[p.id]),
        );
        return !v.awaiting && !v.pending && v.score >= 70;
      }).length,
    [plants, liveReadings, calibrations, lightDaily, settings.unitsF],
  );

  const dueSoon = sorted.filter((p) => {
    const s = schedules.get(p.id);
    if (s) return s.status === 'overdue' || (s.nextWaterAt != null && s.nextWaterAt.getTime() - Date.now() < 3 * 86400000);
    const est = estimates.get(p.id);
    return !!est && (est.status === 'due' || (est.dueAt != null && est.dueAt.getTime() - Date.now() < 2 * 86400000));
  }).length;

  // Weather panels only matter when something actually lives outdoors.
  const hasOutdoor = plants.some((p) => spots.find((s) => s.id === p.spotId)?.outdoor);

  const day = new Date().getDay();
  const showFullBriefing = day === 0 || day === 1 || (!briefingOpened && day <= 3);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    weather.refresh();
    setTimeout(() => setRefreshing(false), 700);
  }, [weather]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: dark.bg }}
      contentContainerStyle={{ paddingHorizontal: layout.margin, paddingTop: insets.top + 8, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.verdant} />}
      showsVerticalScrollIndicator={false}
    >
      {/* Header — the state of the garden in one line */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.screenTitle, { color: dark.ink }]}>Forecast</Text>
        {avg != null && (
          <Pressable onPress={() => router.push('/you')} accessibilityLabel={`Garden average ${avg}`}>
            <VitalityRing score={avg} size={28} showLabel={false} />
          </Pressable>
        )}
      </View>
      <Text style={[type.caption, { color: dark.inkMuted, marginTop: 3 }]}>
        {plants.length === 0
          ? 'The week ahead'
          : `${avg != null ? `${healthy} of ${plants.length} healthy` : `${plants.length} plant${plants.length === 1 ? '' : 's'} · building baselines`} · ${
              dueSoon > 0 ? `${dueSoon} need${dueSoon === 1 ? 's' : ''} water soon` : 'no watering due soon'
            }`}
      </Text>

      {/* Weather ahead — only when something lives outdoors */}
      {hasOutdoor && <WeatherAhead w={weather} unitsF={settings.unitsF} />}

      {/* Briefing */}
      {plants.length === 0 ? null : showFullBriefing ? (
        <Card elevated style={{ marginTop: 14 }}>
          <Text style={[type.cardTitle, { color: dark.ink }]}>This week&apos;s briefing</Text>
          <Text style={[type.caption, { color: dark.inkMuted, marginTop: 4 }]}>
            {plants.length} plant{plants.length === 1 ? '' : 's'} · {tasks.reduce((a, t) => a + t.minutes, 0)} min of care
          </Text>
          <GButton title="Open briefing" onPress={() => router.push('/briefing')} style={{ marginTop: 12 }} />
        </Card>
      ) : (
        <Card style={{ marginTop: 14, paddingVertical: 12 }} onPress={() => router.push('/briefing')}>
          <Text style={[type.caption, { color: dark.inkMuted }]}>
            Next briefing: {settings.briefingDay} {settings.briefingTime}
          </Text>
        </Card>
      )}

      {/* Watering schedule */}
      <View style={{ marginTop: 16 }}>
        {sorted.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Text style={{ fontSize: 40 }}>🌿</Text>
            <Text style={[type.body, { color: dark.inkMuted, marginTop: 10, textAlign: 'center' }]}>
              Add your first plant — Greenr starts projecting its care right away.
            </Text>
            <GButton title="Add plant" onPress={() => router.push('/add-plant')} style={{ marginTop: 14 }} />
          </Card>
        ) : (
          <>
            <Text style={[type.sectionHeader as any, { color: dark.inkMuted, marginBottom: 8 }]}>WATERING SCHEDULE</Text>
            {sorted.map((p) => {
              // Exact refill for plants the sensor says are dry right now.
              let refillMl: number | null = null;
              const raw = liveReadings.get(p.id);
              if (raw) {
                const r = applyCalibration(raw, calibrationFor(calibrations, raw.device_id, p.sensorId));
                const [lo, hi] = idealsFor(p.species, p.comfortBand).band;
                if (r.soil_pct != null && r.soil_pct < lo) {
                  refillMl = mlNeeded(p.potSize, p.potMaterial, r.soil_pct, Math.round((lo + hi) / 2), p.potCm);
                }
              }
              return (
                <ForecastRow
                  key={p.id}
                  plant={p}
                  hasSensor={liveReadings.has(p.id)}
                  schedule={schedules.get(p.id)}
                  estimate={estimates.get(p.id)}
                  refillMl={refillMl}
                  onPress={() => router.push(`/plant/${p.id}`)}
                />
              );
            })}
          </>
        )}
      </View>

      {estimates.size > 0 && (
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4, lineHeight: 15 }]}>
          Sensorless dates are timed from your logged waterings and each species&apos; typical rhythm —
          a sensor makes them exact.
        </Text>
      )}
    </ScrollView>
  );
}
