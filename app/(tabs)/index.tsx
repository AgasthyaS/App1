import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ForecastBar from '@/components/greenr/ForecastBar';
import Sparkline from '@/components/greenr/Sparkline';
import { Card, GButton } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import WeatherCard from '@/components/greenr/WeatherCard';
import { useWeather } from '@/lib/useWeather';
import { accent, bandFor, dark, layout, type } from '@/constants/theme';
import { adviceFor, primaryAction } from '@/lib/advice';
import { BUILD_STAMP } from '@/lib/build';
import { clockNow } from '@/lib/format';
import { notificationsFor, type AlertLevel } from '@/lib/alerts';
import type { Reading } from '@/lib/devices';
import { applyCalibration, type SensorCalibration } from '@/lib/calibration';
import { computeHealth } from '@/lib/health';
import { idealsFor, lightStatus, soilStatus, tempStatus, type Tone } from '@/lib/plantStatus';
import { activePlants, gardenAverage, useGreenr } from '@/lib/store';
import { useAllLiveReadings } from '@/lib/useLiveReading';
import { Plant, Spot } from '@/lib/types';

const toneColor = (t: Tone) =>
  t === 'good' ? accent.sage : t === 'warn' ? accent.sunbeam : t === 'bad' ? accent.clay : dark.inkMuted;

function urgency(p: Plant): number {
  if (p.forecast.criticalInDays != null) return p.forecast.criticalInDays;
  if (p.forecast.warnInDays != null) return 100 + p.forecast.warnInDays;
  return 1000 + (100 - p.score);
}

function PlantRow({
  plant,
  spot,
  hasSensor,
  reading,
  calibration,
  onPress,
}: {
  plant: Plant;
  spot?: Spot;
  hasSensor?: boolean;
  reading?: Reading | null;
  calibration?: SensorCalibration | null;
  onPress: () => void;
}) {
  // Sensored plants show real, live-computed health (§3/§9) — never a seeded
  // score. N/A until the first reading; no fabricated numbers.
  if (hasSensor) {
    const r = reading ? applyCalibration(reading, calibration) : reading;
    const ideal = idealsFor(plant.species, plant.comfortBand);
    const soil = soilStatus(r?.soil_pct, ideal.band);
    const light = lightStatus(r?.light_lux, ideal.dli);
    const temp = tempStatus(r?.temp_c, ideal.temp);
    const health = computeHealth(plant.species, plant.comfortBand, reading ?? null, [], true, calibration);
    const hColor = health.measured ? bandFor(health.total).color : dark.inkMuted;
    return (
      <Card onPress={onPress} style={{ marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {health.measured ? (
            <VitalityRing score={health.total} size={28} showLabel={false} trackColor={dark.hairline} />
          ) : (
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: accent.sage }} />
          )}
          <Text style={[type.cardTitle, { color: dark.ink, flex: 1 }]} numberOfLines={1}>
            {plant.name}
          </Text>
          {health.measured ? (
            <Text style={[type.numBold as any, { color: hColor, fontSize: 17 }]} numberOfLines={1}>
              {health.total}
              <Text style={[type.caption, { color: dark.inkMuted }]}> · {health.word}</Text>
            </Text>
          ) : (
            <Text style={[type.cardTitle, { color: dark.inkMuted, fontSize: 15 }]}>N/A</Text>
          )}
        </View>
        <Text style={[type.micro, { color: accent.sage, marginTop: 6, letterSpacing: 0.5 }]}>
          SENSOR CONNECTED · LIVE HEALTH
        </Text>
        <Text style={[type.caption, { color: dark.inkMuted, marginTop: 6 }]} numberOfLines={1}>
          {reading
            ? `Soil ${soil.label} · Light ${light.label} · ${temp.label}`
            : 'Waiting for the first reading — values show N/A'}
        </Text>
      </Card>
    );
  }

  const critical48 = plant.forecast.criticalInDays != null && plant.forecast.criticalInDays <= 2;
  const declining =
    plant.scoreTrend14[plant.scoreTrend14.length - 1] < plant.scoreTrend14[0] - 3;
  // one environment flag beyond watering, when there is one
  const envFlag = adviceFor(plant, spot).find(
    (a) => a.severity !== 'good' && !a.icon.startsWith('water'),
  );
  return (
    <Card onPress={onPress} accentBorder={critical48 ? accent.clay : undefined} style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <VitalityRing score={plant.score} size={28} estimate={plant.estimate} showLabel={false} />
        <Text style={[type.cardTitle, { color: dark.ink, flex: 1, marginRight: 4 }]} numberOfLines={1}>
          {plant.name}
        </Text>
        <Text style={[type.numBold as any, { fontSize: 17, color: dark.ink, flexShrink: 0 }]} numberOfLines={1}>
          {plant.score}
          {plant.estimate && (
            <Text style={[type.caption, { color: dark.inkMuted }]}> ±{plant.estimateBand}</Text>
          )}
        </Text>
        <Sparkline trend14={plant.scoreTrend14} />
        <Text
          style={[type.micro, { color: declining ? accent.sunbeam : dark.inkMuted, flexShrink: 0 }]}
          numberOfLines={1}
        >
          {declining ? 'declining' : 'stable'}
        </Text>
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
  const liveReadings = useAllLiveReadings(); // plantId → latest reading (or null); auto-refreshes
  const weather = useWeather(); // live local weather; auto-refreshes, honest empty states
  const [refreshing, setRefreshing] = useState(false);

  // Personalized alerts across sensored plants (only the ones needing attention).
  const alerts = useMemo(() => {
    const items: { plantId: string; level: AlertLevel; text: string }[] = [];
    activePlants(allPlants).forEach((p) => {
      if (!liveReadings.has(p.id)) return;
      const outdoor = !!spots.find((s) => s.id === p.spotId)?.outdoor;
      notificationsFor({
        plantName: p.name,
        species: p.species,
        band: p.comfortBand,
        reading: liveReadings.get(p.id) ?? null,
        outdoor,
        weather: weather.weather,
      }).forEach((a) => items.push({ plantId: p.id, level: a.level, text: a.text }));
    });
    const order: Record<AlertLevel, number> = { bad: 0, warn: 1, info: 2 };
    return items.sort((a, b) => order[a.level] - order[b.level]);
  }, [allPlants, liveReadings, spots, weather.weather]);
  const [asOf, setAsOf] = useState(clockNow());

  const plants = useMemo(() => activePlants(allPlants), [allPlants]);
  const sorted = useMemo(() => [...plants].sort((a, b) => urgency(a) - urgency(b)), [plants]);
  const avg = gardenAverage(plants);
  const thriving = plants.filter((p) => p.score >= 85).length;
  const careMinutes = tasks.reduce((a, t) => a + t.minutes, 0);
  const hasManual = plants.some((p) => p.estimate);

  const day = new Date().getDay(); // 0 Sun
  const showFullBriefing = day === 0 || day === 1 || (!briefingOpened && day <= 3);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    weather.refresh();
    setTimeout(() => {
      setAsOf(clockNow());
      setRefreshing(false);
    }, 700);
  }, [weather]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: dark.bg }}
      contentContainerStyle={{
        paddingHorizontal: layout.margin,
        paddingTop: insets.top + 8,
        paddingBottom: 32,
      }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.verdant} />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Header row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.screenTitle, { color: dark.ink }]}>Forecast</Text>
        <Pressable onPress={() => router.push('/you')} accessibilityLabel={`Garden average ${avg}`}>
          <VitalityRing score={avg} size={28} showLabel={false} />
        </Pressable>
      </View>
      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>
        Readings as of {asOf} · {BUILD_STAMP}
      </Text>

      {/* Live local weather — real Open-Meteo data (§10) */}
      <WeatherCard w={weather} unitsF={settings.unitsF} />

      {/* Briefing card (contextual, §4) */}
      {plants.length === 0 ? null : showFullBriefing ? (
        <Card elevated style={{ marginTop: 14 }}>
          <Text style={[type.cardTitle, { color: dark.ink }]}>This week&apos;s briefing</Text>
          <Text style={[type.caption, { color: dark.inkMuted, marginTop: 4 }]}>
            {thriving} of {plants.length} thriving · {careMinutes} min of care
          </Text>
          <GButton title="Start Care Mode" onPress={() => router.push('/briefing')} style={{ marginTop: 12 }} />
        </Card>
      ) : (
        <Card style={{ marginTop: 14, paddingVertical: 12 }} onPress={() => router.push('/briefing')}>
          <Text style={[type.caption, { color: dark.inkMuted }]}>Next briefing: Sunday 9:00</Text>
        </Card>
      )}

      {/* Real alerts — personalized from each plant's live reading vs its ideals */}
      {alerts.length > 0 && (
        <Card
          style={{ marginTop: 10 }}
          accentBorder={alerts.some((a) => a.level === 'bad') ? accent.clay : accent.sunbeam}
        >
          <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.5, marginBottom: 8 }]}>
            NEEDS ATTENTION
          </Text>
          {alerts.slice(0, 5).map((a, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 26 }}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: a.level === 'bad' ? accent.clay : a.level === 'warn' ? accent.sunbeam : accent.verdant,
                }}
              />
              <Text style={[type.caption, { color: dark.ink, flex: 1 }]} numberOfLines={1}>
                {a.text}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {/* Forecast list */}
      <View style={{ marginTop: 16 }}>
        {sorted.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Text style={{ fontSize: 40 }}>🌿</Text>
            <Text style={[type.body, { color: dark.inkMuted, marginTop: 10, textAlign: 'center' }]}>
              Add your first plant — Greenr starts measuring immediately.
            </Text>
            <GButton title="Add plant" onPress={() => router.push('/add-plant')} style={{ marginTop: 14 }} />
          </Card>
        ) : (
          sorted.map((p) => (
            <PlantRow
              key={p.id}
              plant={p}
              spot={spots.find((s) => s.id === p.spotId)}
              hasSensor={liveReadings.has(p.id)}
              reading={liveReadings.get(p.id)}
              calibration={p.sensorId ? calibrations[p.sensorId] : null}
              onPress={() => router.push(`/plant/${p.id}`)}
            />
          ))
        )}
      </View>

      {hasManual && (
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4 }]}>
          Dashed = estimated. Sensors make forecasts exact.
        </Text>
      )}

      {/* O7 — the inline nudge after the first plant (§2.2) */}
      {plants.length > 0 && plants.length < 3 && (
        <Card style={{ marginTop: 12, paddingVertical: 12 }} onPress={() => router.push('/add-plant')}>
          <Text style={[type.caption, { color: dark.inkMuted }]}>
            Add the rest of your plants — scores get more useful side by side.
          </Text>
        </Card>
      )}
    </ScrollView>
  );
}
