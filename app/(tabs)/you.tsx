import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Card, Row, Screen, SectionHeader, StatusDot } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, dark, type } from '@/constants/theme';
import { calibrationFor } from '@/lib/calibration';
import { careScoreValue } from '@/lib/careScore';
import { connectionFrom } from '@/lib/devices';
import { gardenVitalityAvg, vitalityFor } from '@/lib/health';
import { storedLightAvg } from '@/lib/insights';
import { activePlants, useGreenr } from '@/lib/store';
import type { Plant, SensorStatus } from '@/lib/types';
import { useAllLiveReadings } from '@/lib/useLiveReading';
import { useMyDevices } from '@/lib/useDevices';

/** You tab (§11) — identity, the stats band, collection, devices, Plus, settings. */
export default function YouTab() {
  const router = useRouter();
  const { plants: allPlants, sensors, spots, accuracy, settings, profile, calibrations, lightDaily } = useGreenr();
  const plants = activePlants(allPlants);
  const liveReadings = useAllLiveReadings();
  const { devices } = useMyDevices();
  const deviceCount = sensors.length + devices.length;
  const connToStatus = (s: 'online' | 'idle' | 'offline'): SensorStatus =>
    s === 'online' ? 'online' : s === 'idle' ? 'late' : 'offline';
  const careFor = (p: Plant) =>
    liveReadings.has(p.id) ? null : careScoreValue(p, spots.find((s) => s.id === p.spotId));
  const avg = gardenVitalityAvg(
    plants.map((p) => ({
      plant: p,
      hasSensor: liveReadings.has(p.id),
      reading: liveReadings.get(p.id) ?? null,
      calibration: calibrationFor(calibrations, liveReadings.get(p.id)?.device_id, p.sensorId),
      lightAvg: storedLightAvg(lightDaily[p.id]),
      careScore: careFor(p),
    })),
    settings.unitsF,
  );
  // A plant with a live sensor is measured, not estimated — exclude it from the
  // "estimated" stats language (§6).
  const hasEstimated = plants.some((p) => p.estimate && !liveReadings.has(p.id));
  const hits = accuracy.filter((a) => a.hit).length;
  const accuracyPct = accuracy.length ? Math.round((hits / accuracy.length) * 100) : null;
  const name = profile?.name ?? 'Gardener';

  // Real derived stats (§3 — no hardcoded demo numbers). Care events come from
  // the plants' own logged timelines; vitality from live readings.
  const careEvents = plants.flatMap((p) => p.timeline).filter((e) => e.kind === 'care');
  const wateringsLogged = careEvents.length;
  const verifiedCare = careEvents.filter((e) => e.verified).length;
  const consistency = wateringsLogged ? Math.round((verifiedCare / wateringsLogged) * 100) : null;
  // Care streak — consecutive weeks (incl. this one) with at least one logged
  // action, from real timestamps (waterings, growth entries, care/photo events).
  const careStreak = (() => {
    const DAY = 86400000;
    const now = Date.now();
    const times: number[] = [];
    plants.forEach((p) => {
      (p.waterLog ?? []).forEach((w) => times.push(+new Date(w.at)));
      (p.growth ?? []).forEach((g) => times.push(+new Date(g.at)));
      p.timeline
        .filter((e) => e.kind === 'care' || e.kind === 'photo')
        .forEach((e) => times.push(now - e.daysAgo * DAY));
    });
    const weeks = new Set(times.map((t) => Math.floor((now - t) / (7 * DAY))));
    let streak = 0;
    while (weeks.has(streak)) streak++;
    return streak;
  })();
  const thrivingNow = plants.filter((p) => {
    const v = vitalityFor(
      p,
      liveReadings.has(p.id),
      liveReadings.get(p.id) ?? null,
      calibrationFor(calibrations, liveReadings.get(p.id)?.device_id, p.sensorId),
      settings.unitsF,
      storedLightAvg(lightDaily[p.id]),
      careFor(p),
    );
    return !v.awaiting && !v.pending && v.score >= 85;
  }).length;
  const sensoredCount = plants.filter((p) => liveReadings.has(p.id)).length;

  return (
    <Screen>
      {/* identity header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: dark.surface2,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: dark.hairline,
          }}
        >
          <Text style={[type.cardTitle, { color: dark.ink }]}>{name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[type.caption, { color: dark.inkMuted }]}>
            {profile
              ? `${profile.experience} of gardening · joined ${profile.joined}`
              : 'Gardener'}
          </Text>
        </View>
        {avg != null && <VitalityRing score={avg} size={56} />}
      </View>

      {/* stats band */}
      <SectionHeader>Stats</SectionHeader>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        <Card style={{ width: 180 }}>
          <Text style={[type.micro, { color: dark.inkMuted }]}>GARDEN VITALITY</Text>
          <Text style={[type.numHero as any, { fontSize: 32, color: avg != null ? dark.ink : dark.inkMuted, marginTop: 6 }]}>
            {avg != null ? avg : 'N/A'}
          </Text>
          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6, lineHeight: 14 }]}>
            {plants.length === 0
              ? 'add a plant to begin'
              : avg == null
                ? 'appears once a sensor reports, or after ~10 days of tracking'
                : `${thrivingNow} of ${plants.length} thriving${sensoredCount ? ` · ${sensoredCount} sensored` : ''}`}
          </Text>
          {hasEstimated && avg != null && (
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6, lineHeight: 14 }]}>
              Partly estimated — a prediction, not a promise.
            </Text>
          )}
        </Card>
        <Card style={{ width: 180 }}>
          <Text style={[type.micro, { color: dark.inkMuted }]}>CARE CONSISTENCY</Text>
          <Text style={[type.numHero as any, { fontSize: 32, color: dark.ink, marginTop: 6 }]}>
            {consistency != null ? `${consistency}%` : '—'}
          </Text>
          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6 }]}>
            {consistency != null
              ? `${verifiedCare} of ${wateringsLogged} waterings sensor-verified`
              : 'builds as you log and verify care'}
          </Text>
        </Card>
        <Card style={{ width: 180 }}>
          <Text style={[type.micro, { color: dark.inkMuted }]}>CARE STREAK</Text>
          <Text style={[type.numHero as any, { fontSize: 32, color: careStreak > 0 ? accent.sage : dark.inkMuted, marginTop: 6 }]}>
            {careStreak > 0 ? `${careStreak}` : '—'}
            {careStreak > 0 ? <Text style={[type.micro, { color: dark.inkMuted }]}> wk</Text> : null}
          </Text>
          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6, lineHeight: 14 }]}>
            {careStreak > 0
              ? `${careStreak} week${careStreak === 1 ? '' : 's'} running with logged care — keep it going`
              : 'log any care this week to start a streak'}
          </Text>
        </Card>
        <Card style={{ width: 200 }} onPress={() => router.push('/accuracy')}>
          <Text style={[type.micro, { color: dark.inkMuted }]}>FORECAST ACCURACY</Text>
          <Text style={[type.numBold as any, { fontSize: 30, color: dark.ink, marginTop: 6 }]}>
            {accuracyPct != null ? `${accuracyPct}%` : '—'}
          </Text>
          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6 }]}>
            {accuracyPct != null
              ? `on your garden (±1 day, 90 d) — tap for the ledger`
              : 'builds as forecasts resolve'}
          </Text>
        </Card>
        <Card style={{ width: 200 }}>
          <Text style={[type.micro, { color: dark.inkMuted }]}>YOUR GARDEN</Text>
          {plants.length ? (
            <View style={{ marginTop: 6, gap: 4 }}>
              <Text style={[type.caption, { color: dark.ink }]}>Plants: {plants.length}</Text>
              <Text style={[type.caption, { color: dark.ink }]}>Thriving now: {thrivingNow}</Text>
              <Text style={[type.caption, { color: dark.ink }]}>Waterings logged: {wateringsLogged}</Text>
            </View>
          ) : (
            <Text style={[type.caption, { color: dark.inkMuted, marginTop: 6 }]}>none yet</Text>
          )}
        </Card>
        {hasEstimated && (
          <Card
            elevated
            style={{ width: 200, justifyContent: 'center' }}
            onPress={() => router.push('/pair-sensor')}
          >
            <Text style={[type.micro, { color: accent.verdant }]}>GREENR SENSOR</Text>
            <Text style={[type.cardTitle, { color: dark.ink, marginTop: 6, lineHeight: 22 }]}>
              These numbers are educated guesses.
            </Text>
            <Text style={[type.caption, { color: dark.inkMuted, marginTop: 4 }]}>
              A sensor in the soil makes them measurements →
            </Text>
          </Card>
        )}
      </ScrollView>
      {hasEstimated && (
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 8, lineHeight: 15 }]}>
          Stats on estimated plants are model predictions and can be off — Greenr says so rather
          than pretending. Sensors close the gap.
        </Text>
      )}

      {/* collection summary */}
      <SectionHeader>Collection</SectionHeader>
      <Card>
        <Row title={`${plants.length} plant${plants.length === 1 ? '' : 's'}`} value="Garden →" onPress={() => router.push('/garden')} />
        <Row title={`${deviceCount} sensor${deviceCount === 1 ? '' : 's'}`} value="Devices →" onPress={() => router.push('/devices')} />
        <Row title={`${spots.length} spot${spots.length === 1 ? '' : 's'}`} value="Home →" onPress={() => router.push('/home')} />
      </Card>

      {/* devices */}
      <SectionHeader>Devices</SectionHeader>
      <Card>
        {deviceCount === 0 && (
          <Text style={[type.caption, { color: dark.inkMuted }]}>No sensors paired yet.</Text>
        )}
        {devices.map((d) => {
          const conn = connectionFrom(d.device.last_seen);
          return (
            <Pressable
              key={d.device.id}
              onPress={() => router.push('/devices')}
              style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}
            >
              <Text style={[type.body, { color: dark.ink, flex: 1 }]} numberOfLines={1}>
                {d.device.label?.trim() || 'Greenr sensor'}
              </Text>
              <Text style={[type.caption, { color: dark.inkMuted, marginRight: 10 }]}>{conn.sinceLabel}</Text>
              <StatusDot status={connToStatus(conn.status)} />
            </Pressable>
          );
        })}
        {sensors.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => router.push(`/sensor/${s.id}`)}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}
          >
            <Text style={[type.body, { color: dark.ink, flex: 1 }]}>{s.name}</Text>
            <Text style={[type.caption, { color: dark.inkMuted, marginRight: 10 }]}>{s.batteryPct}%</Text>
            <StatusDot status={s.status} />
          </Pressable>
        ))}
        <Row title="Manage & pair sensors" value="→" onPress={() => router.push('/devices')} />
      </Card>

      {/* Greenr+ */}
      <SectionHeader>Greenr+</SectionHeader>
      <Card onPress={() => router.push('/plus')} elevated>
        {settings.plus ? (
          <Text style={[type.body, { color: dark.ink }]}>Plus · active</Text>
        ) : (
          <>
            <Text style={[type.cardTitle, { color: dark.ink }]}>See 10 days ahead</Text>
            <Text style={[type.caption, { color: dark.inkMuted, marginTop: 4 }]}>
              Forecasts beyond 48 h · full history · diagnostics
            </Text>
          </>
        )}
      </Card>

      {/* settings */}
      <SectionHeader>Settings</SectionHeader>
      <Card>
        <Row title="Settings" value="→" onPress={() => router.push('/settings')} />
        <Row title="How Greenr calculates" value="→" onPress={() => router.push('/methodology')} />
      </Card>
    </Screen>
  );
}
