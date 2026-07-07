import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ForecastBar from '@/components/greenr/ForecastBar';
import { Card, GButton } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, dark, layout, type } from '@/constants/theme';
import { adviceFor, primaryAction } from '@/lib/advice';
import { gardenVitalityAvg } from '@/lib/health';
import { computeSchedule, type WaterSchedule } from '@/lib/schedule';
import { activePlants, useGreenr } from '@/lib/store';
import { useAllLiveReadings, useAllReadingHistories } from '@/lib/useLiveReading';
import { useWeather } from '@/lib/useWeather';
import { cToF } from '@/lib/weather';
import { Plant, Spot } from '@/lib/types';

/**
 * Forecast (§4, Option B) — everything AHEAD: the days-ahead weather, each
 * plant's projected next-watering date, and the week's care schedule. Current
 * readings, health and alerts live on Home, so nothing is duplicated.
 */

function estimateUrgency(p: Plant): number {
  if (p.forecast.criticalInDays != null) return p.forecast.criticalInDays;
  if (p.forecast.warnInDays != null) return 100 + p.forecast.warnInDays;
  return 1000 + (100 - p.score);
}

/** Sort key so the soonest-thirsty plants surface first, sensored or not. */
function scheduleSort(p: Plant, s: WaterSchedule | undefined): number {
  if (s) {
    if (s.status === 'overdue') return -1;
    if (s.nextWaterAt) return (s.nextWaterAt.getTime() - Date.now()) / 86400000;
    return 400;
  }
  return estimateUrgency(p);
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
  spot,
  hasSensor,
  schedule,
  onPress,
}: {
  plant: Plant;
  spot?: Spot;
  hasSensor: boolean;
  schedule?: WaterSchedule;
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
        {s?.weatherNote ? (
          <Text style={[type.micro, { color: accent.verdant, marginTop: 4, lineHeight: 15 }]} numberOfLines={2}>
            {s.weatherNote}
          </Text>
        ) : null}
      </Card>
    );
  }

  // Estimate plants: the model forecast + next action.
  const critical48 = plant.forecast.criticalInDays != null && plant.forecast.criticalInDays <= 2;
  const envFlag = adviceFor(plant, spot).find((a) => a.severity !== 'good' && !a.icon.startsWith('water'));
  return (
    <Card onPress={onPress} accentBorder={critical48 ? accent.clay : undefined} style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <VitalityRing score={plant.score} size={24} estimate={plant.estimate} showLabel={false} />
        <Text style={[type.cardTitle, { color: dark.ink, flex: 1 }]} numberOfLines={1}>
          {plant.name}
        </Text>
        <Text style={[type.micro, { color: dark.inkMuted }]}>estimate</Text>
      </View>
      <View style={{ marginTop: 12 }}>
        <ForecastBar forecast={plant.forecast} estimate={plant.estimate} />
      </View>
      <Text style={[type.caption, { color: critical48 ? accent.clay : dark.ink, marginTop: 8 }]}>
        {primaryAction(plant)}
      </Text>
      {envFlag && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <Ionicons name={envFlag.icon as any} size={12} color={accent.sunbeam} />
          <Text style={[type.micro, { color: dark.inkMuted, flex: 1 }]} numberOfLines={1}>
            {envFlag.text.split('—')[0].trim()}
          </Text>
        </View>
      )}
    </Card>
  );
}

export default function ForecastTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { plants: allPlants, spots, tasks, briefingOpened, settings, calibrations } = useGreenr();
  const liveReadings = useAllLiveReadings();
  const histories = useAllReadingHistories();
  const weather = useWeather();
  const [refreshing, setRefreshing] = useState(false);

  const plants = useMemo(() => activePlants(allPlants), [allPlants]);

  // Project each sensored plant's next watering from its drying history + weather.
  const schedules = useMemo(() => {
    const m = new Map<string, WaterSchedule>();
    plants.forEach((p) => {
      if (!liveReadings.has(p.id)) return;
      const outdoor = !!spots.find((s) => s.id === p.spotId)?.outdoor;
      m.set(
        p.id,
        computeSchedule(histories.get(p.id) ?? [], p.comfortBand, p.species, {
          weather: weather.weather,
          outdoor,
        }),
      );
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plants, liveReadings, histories, spots, weather.weather]);

  const sorted = useMemo(
    () => [...plants].sort((a, b) => scheduleSort(a, schedules.get(a.id)) - scheduleSort(b, schedules.get(b.id))),
    [plants, schedules],
  );

  const avg = useMemo(
    () =>
      gardenVitalityAvg(
        plants.map((p) => ({
          plant: p,
          hasSensor: liveReadings.has(p.id),
          reading: liveReadings.get(p.id) ?? null,
          calibration: p.sensorId ? calibrations[p.sensorId] : null,
        })),
        settings.unitsF,
      ),
    [plants, liveReadings, calibrations, settings.unitsF],
  );

  const dueSoon = sorted.filter((p) => {
    const s = schedules.get(p.id);
    if (s) return s.status === 'overdue' || (s.nextWaterAt != null && s.nextWaterAt.getTime() - Date.now() < 3 * 86400000);
    return p.forecast.criticalInDays != null && p.forecast.criticalInDays <= 3;
  }).length;

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
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.screenTitle, { color: dark.ink }]}>Forecast</Text>
        <Pressable onPress={() => router.push('/you')} accessibilityLabel={`Garden average ${avg}`}>
          <VitalityRing score={avg} size={28} showLabel={false} />
        </Pressable>
      </View>
      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>
        {plants.length === 0
          ? 'The week ahead'
          : dueSoon > 0
            ? `${dueSoon} plant${dueSoon === 1 ? '' : 's'} need water in the next few days`
            : 'Nothing needs water in the next few days'}
      </Text>

      {/* Weather ahead */}
      <WeatherAhead w={weather} unitsF={settings.unitsF} />

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
            {sorted.map((p) => (
              <ForecastRow
                key={p.id}
                plant={p}
                spot={spots.find((s) => s.id === p.spotId)}
                hasSensor={liveReadings.has(p.id)}
                schedule={schedules.get(p.id)}
                onPress={() => router.push(`/plant/${p.id}`)}
              />
            ))}
          </>
        )}
      </View>

      {plants.some((p) => p.estimate && !liveReadings.has(p.id)) && (
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4 }]}>
          Estimated forecasts come from a drying model — a sensor makes the date exact.
        </Text>
      )}
    </ScrollView>
  );
}
