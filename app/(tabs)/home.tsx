import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Chip, SectionHeader } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import WeatherCard from '@/components/greenr/WeatherCard';
import { accent, bandFor, dark, layout, type } from '@/constants/theme';
import { type AlertLevel, notificationsFor } from '@/lib/alerts';
import { applyCalibration, calibrationFor } from '@/lib/calibration';
import { careScoreValue } from '@/lib/careScore';
import { estimateWaterSchedule } from '@/lib/estimate';
import { dliWord } from '@/lib/format';
import { BASELINE_DAYS, gardenVitalityAvg, vitalityFor } from '@/lib/health';
import { storedLightAvg } from '@/lib/insights';
import { idealsFor, lightStatus, soilStatus, tempStatus } from '@/lib/plantStatus';
import { activePlants, useGreenr } from '@/lib/store';
import { soilDynamics, wateredSinceLastReading, wateringDidNotRegister } from '@/lib/soilDynamics';
import { refreshReadings, useAllLiveReadings, useAllReadingHistories, useReadingsRefreshing, useSensorUploadHealth } from '@/lib/useLiveReading';
import { useWeather } from '@/lib/useWeather';
import { waterAction } from '@/lib/waterAction';
import { cToF } from '@/lib/weather';
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
  const { plants: allPlants, spots, settings, calibrations, lightDaily } = useGreenr();
  const plants = useMemo(() => activePlants(allPlants), [allPlants]);
  const liveReadings = useAllLiveReadings();
  const histories = useAllReadingHistories();   // needed to tell "draining" from "over-watered"
  const readingsRefreshing = useReadingsRefreshing();
  // Whether the numbers below are still being fed. Every card on this screen
  // shows a soil percentage, and a fortnight-old one looks exactly like a fresh
  // one — which is how three dead sensors went unnoticed for thirteen days.
  const { fleet } = useSensorUploadHealth();
  const weather = useWeather();
  const insets = useSafeAreaInsets();

  const calFor = (p: Plant) =>
    calibrationFor(calibrations, liveReadings.get(p.id)?.device_id, p.sensorId);
  // Judge light on the plant's accumulated multi-day daytime average (null until
  // it's built up any days → health falls back to the live reading).
  const lightFor = (p: Plant) => storedLightAvg(lightDaily[p.id]);
  // Sensorless plants score on care fidelity (null when a sensor is present or
  // there's not enough logged behaviour yet).
  const careFor = (p: Plant) =>
    liveReadings.has(p.id) ? null : careScoreValue(p, spots.find((s) => s.id === p.spotId));

  const avg = useMemo(
    () =>
      gardenVitalityAvg(
        plants.map((p) => ({
          plant: p,
          hasSensor: liveReadings.has(p.id),
          reading: liveReadings.get(p.id) ?? null,
          calibration: calFor(p),
          lightAvg: lightFor(p),
          careScore: careFor(p),
        })),
        settings.unitsF,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plants, liveReadings, calibrations, lightDaily, settings.unitsF, spots],
  );

  // Alerts across sensored plants, using live weather for outdoor rain-delay.
  const alerts = useMemo(() => {
    const items: { id: string; level: AlertLevel; text: string }[] = [];
    plants.forEach((p) => {
      if (!liveReadings.has(p.id)) return;
      const outdoor = !!spots.find((s) => s.id === p.spotId)?.outdoor;
      const raw = liveReadings.get(p.id) ?? null;
      const hist = (histories.get(p.id) ?? []).map((h) => applyCalibration(h, calFor(p)));
      const cal = raw ? applyCalibration(raw, calFor(p)) : null;
      // One decision, one number — the alert must not recompute its own.
      const act = waterAction({ plant: p, reading: cal, history: hist });
      notificationsFor({
        plantName: p.name,
        species: p.species,
        band: p.comfortBand,
        // Alerts judge the calibration-corrected reading (incl. flipped light).
        reading: raw ? applyCalibration(raw, calFor(p)) : raw,
        // Keeps "over-watered" quiet while a pot is simply draining after a drink.
        soilDyn: hist.length ? soilDynamics(p, hist, p.comfortBand) : null,
        // Mute "water me" between logging a pour and the sensor confirming it.
        justWatered: wateredSinceLastReading(p, raw),
        // …and speak up if the sensor DID report and the soil never moved.
        wateringMiss: hist.length ? wateringDidNotRegister(p, hist, p.comfortBand) : null,
        pourMl: act.ml > 0 ? act.ml : null,
        outdoor,
        weather: weather.weather,
        // Every field the watering model reads — omitting any of them makes this
        // alert quote a different amount from the plant screen.
        pot: {
          size: p.potSize,
          material: p.potMaterial,
          cm: p.potCm,
          heightCm: p.potHeightCm,
          shape: p.potShape,
          soilMix: p.soilMix,
          soilRetention: p.soilRetention,
          hasDrainage: p.hasDrainage,
        },
      }).forEach((a, i) => items.push({ id: `${p.id}-${i}`, level: a.level, text: a.text }));
    });
    const order: Record<AlertLevel, number> = { bad: 0, warn: 1, info: 2 };
    return items.sort((a, b) => order[a.level] - order[b.level]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plants, liveReadings, histories, spots, weather.weather, calibrations]);

  const byRoom = useMemo(() => {
    const rooms = new Map<string, Spot[]>();
    for (const s of spots) rooms.set(s.room, [...(rooms.get(s.room) ?? []), s]);
    return [...rooms.entries()];
  }, [spots]);
  const occupants = (spotId: string) => plants.filter((p) => p.spotId === spotId);
  const bestFree = spots.filter((s) => occupants(s.id).length === 0).sort((a, b) => b.dli - a.dli)[0];

  const nowLine = (p: Plant) => {
    const hasSensor = liveReadings.has(p.id);
    const v = vitalityFor(p, hasSensor, liveReadings.get(p.id) ?? null, calFor(p), settings.unitsF, lightFor(p), careFor(p));
    if (!v.sensored) {
      // No sensor: the honest cycle from last-watered + species rhythm.
      const est = estimateWaterSchedule(p);
      return {
        text: est.status === 'due' ? `${est.whenLabel} — check the soil` : est.whenLabel,
        tone: est.status === 'due' ? accent.sunbeam : dark.inkMuted,
      };
    }
    if (v.awaiting) return { text: 'Awaiting first reading', tone: dark.inkMuted };
    const reading = applyCalibration(liveReadings.get(p.id)!, calFor(p));
    const ideal = idealsFor(p.species, p.comfortBand);
    const soil = soilStatus(reading.soil_pct, ideal.band);
    // The SAME decision the plant screen makes — see lib/waterAction. Home used
    // to re-derive it here and drifted: it could say a plant was fine while the
    // plant screen told you to add a litre, or quote a full soak where the plant
    // screen quoted a trial dose.
    const hist = (histories.get(p.id) ?? []).map((h) => applyCalibration(h, calFor(p)));
    const act = waterAction({ plant: p, reading, history: hist });
    if (act.kind === 'retry') return { text: act.line, tone: accent.clay };
    if (act.kind === 'waiting') return { text: act.line, tone: dark.inkMuted };
    if (act.kind === 'water') return { text: act.line, tone: accent.clay };
    if (act.kind === 'hold') return { text: act.line, tone: accent.sunbeam };
    const light = lightStatus(reading.light_lux, ideal.dli);
    const temp = tempStatus(reading.temp_c, ideal.temp);
    return { text: `Soil ${soil.label} · ${light.label} · ${temp.label}`, tone: dark.inkMuted };
  };

  // Weather matters on Home only when something actually lives outdoors.
  const hasOutdoor = plants.some((p) => spots.find((s) => s.id === p.spotId)?.outdoor);
  // Live climate per spot: if a sensored plant sits there, its reading IS the
  // spot's real temperature/humidity.
  const liveForSpot = (spotId: string) => {
    const occ = plants.find((p) => p.spotId === spotId && liveReadings.get(p.id) != null);
    if (!occ) return null;
    return applyCalibration(liveReadings.get(occ.id)!, calFor(occ));
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: dark.bg }}
      contentContainerStyle={{ paddingHorizontal: layout.margin, paddingTop: insets.top + 8, paddingBottom: 32 }}
      // Pulling to refresh used to reload the WEATHER and nothing else, so the
      // one gesture people use when a reading looks stale was the one gesture
      // that could not update it.
      refreshControl={
        <RefreshControl
          refreshing={readingsRefreshing}
          onRefresh={() => { void refreshReadings(); weather.refresh(); }}
          tintColor={accent.verdant}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.screenTitle, { color: dark.ink }]}>Home</Text>
        {avg != null && <VitalityRing score={avg} size={28} showLabel={false} />}
      </View>
      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>Right now in your garden</Text>

      {/*
        SENSORS NOT REPORTING. Deliberately above the weather and the alerts:
        everything under it is derived from readings, so if the readings stopped
        the rest of this screen is history rather than news. It renders nothing
        at all when the sensors are fine — a banner that is always there is a
        banner nobody reads.
      */}
      {fleet && (
        <Pressable onPress={() => router.push('/device-health' as any)}>
          <Card
            style={{ marginTop: 10 }}
            accentBorder={fleet.severity >= 65 ? accent.clay : accent.sunbeam}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons
                name={fleet.severity >= 65 ? 'cloud-offline-outline' : 'alert-circle-outline'}
                size={16}
                color={fleet.severity >= 65 ? accent.clay : accent.sunbeam}
              />
              <Text style={[type.cardTitle, { color: dark.ink, flex: 1 }]}>{fleet.headline}</Text>
              <Ionicons name="chevron-forward" size={14} color={dark.inkMuted} />
            </View>
            <Text style={[type.body, { color: dark.inkMuted, marginTop: 6 }]}>{fleet.detail}</Text>
          </Card>
        </Pressable>
      )}

      {/* current weather — only when something lives outdoors */}
      {hasOutdoor && <WeatherCard w={weather} unitsF={settings.unitsF} />}

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
            const v = vitalityFor(p, hasSensor, liveReadings.get(p.id) ?? null, calFor(p), settings.unitsF, lightFor(p), careFor(p));
            const line = nowLine(p);
            const noScore = v.awaiting || v.pending;
            const spotName = spots.find((s) => s.id === p.spotId)?.name;
            return (
              <Card key={p.id} onPress={() => router.push(`/plant/${p.id}`)} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <VitalityRing
                    score={noScore ? 0 : v.score}
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
                      <Text style={[type.numBold as any, { color: noScore ? dark.inkMuted : bandFor(v.score).color, fontSize: 15 }]}>
                        {noScore ? 'N/A' : v.score}
                        {v.estimate ? <Text style={[type.micro, { color: dark.inkMuted }]}> ±{v.estimateBand}</Text> : null}
                      </Text>
                    </View>
                    <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]} numberOfLines={1}>
                      {p.species}
                      {spotName ? ` · ${spotName}` : ''}
                      {v.pending ? ` · score by day ${BASELINE_DAYS}` : ''}
                    </Text>
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
                  // Real numbers only: a live sensor in this spot, or a
                  // sensor-measured spot. Otherwise honest words, not fake %.
                  const live = liveForSpot(s.id);
                  const climateLine = live
                    ? `🌡 ${
                        live.temp_c != null
                          ? settings.unitsF
                            ? `${Math.round(cToF(live.temp_c))}°F`
                            : `${Math.round(live.temp_c)}°C`
                          : '—'
                      } · 💧 ${live.humidity_pct != null ? `${Math.round(live.humidity_pct)}%` : '—'} (live)`
                    : s.measuredBySensor
                      ? `🌡 ${s.tempRange[0]}–${s.tempRange[1]}° · 💧 ${s.rh}% RH`
                      : '🌡 💧 not measured yet';
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
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6 }]}>
                        ☀ {s.measuredBySensor ? `${s.dli.toFixed(1)} DLI` : `${dliWord(s.dli)} (your description)`}
                      </Text>
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>{climateLine}</Text>
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
