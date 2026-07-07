import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Chip, SectionHeader } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import WeatherCard from '@/components/greenr/WeatherCard';
import { accent, bandFor, dark, layout, type } from '@/constants/theme';
import { primaryAction } from '@/lib/advice';
import { type AlertLevel, notificationsFor } from '@/lib/alerts';
import { applyCalibration } from '@/lib/calibration';
import { dliWord } from '@/lib/format';
import { gardenVitalityAvg, vitalityFor } from '@/lib/health';
import { idealsFor, lightStatus, soilStatus, tempStatus } from '@/lib/plantStatus';
import { activePlants, useGreenr } from '@/lib/store';
import { useAllLiveReadings } from '@/lib/useLiveReading';
import { useWeather } from '@/lib/useWeather';
import { Plant, Spot } from '@/lib/types';

/**
 * Home (§4, Option B) — everything happening RIGHT NOW: current weather, alerts,
 * each plant's live health + today's single action, and the rooms map. The
 * Forecast tab owns everything ahead (dates, schedules), so nothing duplicates.
 */

function tintFor(dli: number): string {
  const a = Math.min(0.4, Math.max(0.04, dli / 12));
  return `rgba(138, 155, 110, ${a.toFixed(2)})`;
}

export default function HomeTab() {
  const router = useRouter();
  const { plants: allPlants, spots, settings, calibrations } = useGreenr();
  const plants = useMemo(() => activePlants(allPlants), [allPlants]);
  const liveReadings = useAllLiveReadings();
  const weather = useWeather();
  const insets = useSafeAreaInsets();

  const calFor = (p: Plant) => (p.sensorId ? calibrations[p.sensorId] : null);

  const avg = useMemo(
    () =>
      gardenVitalityAvg(
        plants.map((p) => ({
          plant: p,
          hasSensor: liveReadings.has(p.id),
          reading: liveReadings.get(p.id) ?? null,
          calibration: calFor(p),
        })),
        settings.unitsF,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plants, liveReadings, calibrations, settings.unitsF],
  );

  // Alerts across sensored plants, using live weather for outdoor rain-delay.
  const alerts = useMemo(() => {
    const items: { id: string; level: AlertLevel; text: string }[] = [];
    plants.forEach((p) => {
      if (!liveReadings.has(p.id)) return;
      const outdoor = !!spots.find((s) => s.id === p.spotId)?.outdoor;
      notificationsFor({
        plantName: p.name,
        species: p.species,
        band: p.comfortBand,
        reading: liveReadings.get(p.id) ?? null,
        outdoor,
        weather: weather.weather,
      }).forEach((a, i) => items.push({ id: `${p.id}-${i}`, level: a.level, text: a.text }));
    });
    const order: Record<AlertLevel, number> = { bad: 0, warn: 1, info: 2 };
    return items.sort((a, b) => order[a.level] - order[b.level]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plants, liveReadings, spots, weather.weather]);

  const byRoom = useMemo(() => {
    const rooms = new Map<string, Spot[]>();
    for (const s of spots) rooms.set(s.room, [...(rooms.get(s.room) ?? []), s]);
    return [...rooms.entries()];
  }, [spots]);
  const occupants = (spotId: string) => plants.filter((p) => p.spotId === spotId);
  const bestFree = spots.filter((s) => occupants(s.id).length === 0).sort((a, b) => b.dli - a.dli)[0];

  const nowLine = (p: Plant) => {
    const hasSensor = liveReadings.has(p.id);
    const v = vitalityFor(p, hasSensor, liveReadings.get(p.id) ?? null, calFor(p), settings.unitsF);
    if (!v.sensored) return { text: primaryAction(p), tone: dark.inkMuted };
    if (v.awaiting) return { text: 'Awaiting first reading', tone: dark.inkMuted };
    const reading = applyCalibration(liveReadings.get(p.id)!, calFor(p));
    const ideal = idealsFor(p.species, p.comfortBand);
    const soil = soilStatus(reading.soil_pct, ideal.band);
    if (reading.soil_pct != null && reading.soil_pct < ideal.band[0])
      return { text: `Water now — soil ${Math.round(reading.soil_pct)}%`, tone: accent.clay };
    if (reading.soil_pct != null && reading.soil_pct > ideal.band[1])
      return { text: `Let it dry — soil ${Math.round(reading.soil_pct)}%`, tone: accent.sunbeam };
    const light = lightStatus(reading.light_lux, ideal.dli);
    const temp = tempStatus(reading.temp_c, ideal.temp);
    return { text: `Soil ${soil.label} · ${light.label} · ${temp.label}`, tone: dark.inkMuted };
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: dark.bg }}
      contentContainerStyle={{ paddingHorizontal: layout.margin, paddingTop: insets.top + 8, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => weather.refresh()} tintColor={accent.verdant} />}
      showsVerticalScrollIndicator={false}
    >
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.screenTitle, { color: dark.ink }]}>Home</Text>
        {plants.length > 0 && <VitalityRing score={avg} size={28} showLabel={false} />}
      </View>
      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>Right now in your garden</Text>

      {/* current weather */}
      <WeatherCard w={weather} unitsF={settings.unitsF} />

      {/* alerts */}
      {alerts.length > 0 && (
        <Card style={{ marginTop: 10 }} accentBorder={alerts.some((a) => a.level === 'bad') ? accent.clay : accent.sunbeam}>
          <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.5, marginBottom: 8 }]}>NEEDS ATTENTION</Text>
          {alerts.slice(0, 5).map((a) => (
            <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 26 }}>
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

      {/* plants now */}
      {plants.length > 0 && (
        <>
          <SectionHeader>Your plants now</SectionHeader>
          {plants.map((p) => {
            const hasSensor = liveReadings.has(p.id);
            const v = vitalityFor(p, hasSensor, liveReadings.get(p.id) ?? null, calFor(p), settings.unitsF);
            const line = nowLine(p);
            return (
              <Card key={p.id} onPress={() => router.push(`/plant/${p.id}`)} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <VitalityRing
                    score={v.awaiting ? 0 : v.score}
                    size={40}
                    estimate={v.estimate}
                    estimateBand={v.estimateBand}
                    showLabel={false}
                    trackColor={dark.hairline}
                  />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[type.cardTitle, { color: dark.ink, flex: 1 }]} numberOfLines={1}>
                        {p.name}
                      </Text>
                      {v.sensored && <Ionicons name="hardware-chip-outline" size={12} color={accent.sage} />}
                      <Text style={[type.numBold as any, { color: v.awaiting ? dark.inkMuted : bandFor(v.score).color, fontSize: 15 }]}>
                        {v.awaiting ? 'N/A' : v.score}
                        {v.estimate ? <Text style={[type.micro, { color: dark.inkMuted }]}> ±{v.estimateBand}</Text> : null}
                      </Text>
                    </View>
                    <Text style={[type.caption, { color: line.tone, marginTop: 3 }]} numberOfLines={1}>
                      {line.text}
                    </Text>
                  </View>
                </View>
              </Card>
            );
          })}
        </>
      )}

      {/* rooms map */}
      {spots.length > 0 && (
        <>
          <SectionHeader>Rooms</SectionHeader>
          {byRoom.map(([room, roomSpots]) => (
            <View key={room} style={{ marginBottom: 6 }}>
              <Text style={[type.micro, { color: dark.inkMuted, marginBottom: 6 }]}>{room.toUpperCase()}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {roomSpots.map((s) => {
                  const occ = occupants(s.id);
                  return (
                    <Card
                      key={s.id}
                      onPress={() => router.push({ pathname: '/spot/[id]', params: { id: s.id } })}
                      style={{ width: '48%', backgroundColor: dark.surface1, overflow: 'hidden' }}
                    >
                      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: tintFor(s.dli) }} />
                      <Text style={[type.cardTitle, { color: dark.ink }]} numberOfLines={1}>
                        {s.name}
                      </Text>
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6 }]}>☀ {s.dli.toFixed(1)} DLI</Text>
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>
                        🌡 {s.tempRange[0]}–{s.tempRange[1]}° · 💧 {s.rh}% RH
                      </Text>
                      <View style={{ flexDirection: 'row', marginTop: 8, gap: 4, minHeight: 22, alignItems: 'center' }}>
                        {occ.length > 0 ? (
                          occ.map((p) => (
                            <Text key={p.id} style={{ fontSize: 16 }}>
                              {p.emoji}
                            </Text>
                          ))
                        ) : bestFree?.id === s.id ? (
                          <Chip label={`Best free spot — ${dliWord(s.dli)}`} color={accent.verdant} />
                        ) : (
                          <Text style={[type.micro, { color: dark.inkMuted }]}>empty</Text>
                        )}
                      </View>
                    </Card>
                  );
                })}
              </View>
            </View>
          ))}
        </>
      )}

      {plants.length === 0 && spots.length === 0 && (
        <Card style={{ alignItems: 'center', paddingVertical: 40, marginTop: 16 }}>
          <Text style={{ fontSize: 40 }}>🌿</Text>
          <Text style={[type.body, { color: dark.inkMuted, marginTop: 10, textAlign: 'center' }]}>
            Add your first plant or spot to see it here.
          </Text>
        </Card>
      )}
    </ScrollView>
  );
}
