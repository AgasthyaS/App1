import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListGroup, ListRow } from '@/components/greenr/Native';
import { StatusDot } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, dark, layout, type } from '@/constants/theme';
import { calibrationFor } from '@/lib/calibration';
import { careScoreValue } from '@/lib/careScore';
import { connectionFrom } from '@/lib/devices';
import { eventDaysAgo } from '@/lib/format';
import { gardenVitalityAvg, vitalityFor } from '@/lib/health';
import { wateringsLogged as countWaterings } from '@/lib/careLog';
import { storedLightAvg } from '@/lib/insights';
import { shareContent } from '@/lib/platform';
import { activePlants, useGreenr } from '@/lib/store';
import type { Plant, SensorStatus } from '@/lib/types';
import { useAllLiveReadings } from '@/lib/useLiveReading';
import { useMyDevices } from '@/lib/useDevices';

/**
 * Account — opened from the avatar on every tab, like the App Store's. Who you
 * are, three honest numbers, your sensors, and settings, as grouped lists.
 */

function Stat({ label, value, hint, tint, small }: { label: string; value: string; hint: string; tint?: string; small?: boolean }) {
  return (
    <View
      style={{
        flexBasis: '30%',
        flexGrow: 1,
        backgroundColor: dark.surface1,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: dark.cardBorder,
        padding: 12,
      }}
    >
      <Text style={[type.numBold as any, { color: tint ?? dark.ink, fontSize: small ? 16 : 24, minHeight: 30 }]}>{value}</Text>
      <Text style={[type.caption, { color: dark.ink, marginTop: 2, fontWeight: '600' }]}>{label}</Text>
      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, lineHeight: 15 }]} numberOfLines={2}>
        {hint}
      </Text>
    </View>
  );
}

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { plants: allPlants, sensors, spots, settings, profile, calibrations, lightDaily, accuracy } = useGreenr();
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
  const name = profile?.name ?? 'Gardener';
  const hits = accuracy.filter((a) => a.hit).length;
  const accuracyPct = accuracy.length ? Math.round((hits / accuracy.length) * 100) : null;
  const sensoredCount = plants.filter((p) => liveReadings.has(p.id)).length;
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

  // Real derived stats — from the plants' own logged timelines.
  const careEvents = plants.flatMap((p) => p.timeline).filter((e) => e.kind === 'care');
  // Counted from the watering log itself — the same count every other screen uses.
  const wateringsLogged = countWaterings(plants);
  const verifiedCare = careEvents.filter((e) => e.verified).length;
  const consistency = careEvents.length && deviceCount > 0 ? Math.round((verifiedCare / careEvents.length) * 100) : null;
  const learningCount = plants.filter((p) =>
    vitalityFor(
      p,
      liveReadings.has(p.id),
      liveReadings.get(p.id) ?? null,
      calibrationFor(calibrations, liveReadings.get(p.id)?.device_id, p.sensorId),
      settings.unitsF,
      storedLightAvg(lightDaily[p.id]),
      careFor(p),
    ).pending,
  ).length;
  // Consecutive weeks (incl. this one) with at least one logged action.
  const careStreak = (() => {
    const DAY = 86400000;
    const now = Date.now();
    const times: number[] = [];
    plants.forEach((p) => {
      (p.waterLog ?? []).forEach((w) => times.push(+new Date(w.at)));
      (p.growth ?? []).forEach((g) => times.push(+new Date(g.at)));
      p.timeline
        .filter((e) => e.kind === 'care' || e.kind === 'photo')
        .forEach((e) => times.push(now - eventDaysAgo(e) * DAY));
    });
    const weeks = new Set(times.map((t) => Math.floor((now - t) / (7 * DAY))));
    let streak = 0;
    while (weeks.has(streak)) streak++;
    return streak;
  })();

  return (
    <View style={{ flex: 1, backgroundColor: dark.bg }}>
      {/* sheet grabber + Done, as an iOS page sheet */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: insets.top + 8,
          paddingHorizontal: layout.margin,
          paddingBottom: 6,
        }}
      >
        <View style={{ width: 60 }} />
        <Text style={[type.cardTitle, { color: dark.ink }]}>Account</Text>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          hitSlop={10}
          style={{ width: 60, alignItems: 'flex-end' }}
        >
          <Text style={[type.cardTitle, { color: accent.verdant }]}>Done</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: layout.margin,
          paddingBottom: insets.bottom + 40,
          width: '100%',
          maxWidth: 720,
          alignSelf: 'center',
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* identity */}
        <View style={{ alignItems: 'center', marginTop: 14 }}>
          <View
            style={{
              width: 84,
              height: 84,
              borderRadius: 42,
              backgroundColor: accent.verdant,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={[type.screenTitle, { color: '#FFFFFF' }]}>{name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={[type.ritualTitle, { color: dark.ink, marginTop: 12, fontSize: 24 }]}>{name}</Text>
          {profile && (
            <Text style={[type.caption, { color: dark.inkMuted, marginTop: 2 }]}>
              {/^just starting/i.test(profile.experience) ? 'Just starting out' : `${profile.experience} of gardening`} · joined {profile.joined}
            </Text>
          )}
        </View>

        {/* three honest numbers */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
          <View
            style={{
              flexBasis: '30%',
              flexGrow: 1,
              backgroundColor: dark.surface1,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: dark.cardBorder,
              padding: 12,
              alignItems: 'flex-start',
            }}
          >
            {avg != null ? (
              <VitalityRing score={avg} size={40} showLabel={false} trackColor={dark.hairline} />
            ) : (
              <Text style={[type.numBold as any, { color: dark.ink, fontSize: 20 }]}>
                Learning
              </Text>
            )}
            <Text style={[type.caption, { color: dark.ink, marginTop: 6, fontWeight: '600' }]}>
              {avg != null ? `Garden ${avg}` : 'Garden'}
            </Text>
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]} numberOfLines={2}>
              {avg != null
                ? 'average health'
                : learningCount > 0
                  ? `${learningCount} plant${learningCount === 1 ? '' : 's'} getting a first score`
                  : 'learning your plants'}
            </Text>
          </View>
          <Stat
            label="Streak"
            value={careStreak > 0 ? `${careStreak} wk` : '—'}
            hint={careStreak > 0 ? 'weeks of care in a row' : 'log care to start one'}
            tint={careStreak > 0 ? accent.sage : dark.inkMuted}
          />
          {deviceCount > 0 ? (
            <Stat
              label="Verified"
              value={consistency != null ? `${consistency}%` : '—'}
              hint={consistency != null ? `${verifiedCare} of ${careEvents.length} by sensor` : 'waterings a sensor confirmed'}
            />
          ) : (
            <Stat label="Verified" value="No sensor yet" hint="a sensor confirms each watering" tint={dark.inkMuted} small />
          )}
        </View>

        <Text style={[type.caption, { color: dark.inkMuted, marginTop: 8, marginHorizontal: 4, lineHeight: 18 }]}>
          {plants.length === 0
            ? 'Add a plant to begin.'
            : `${avg != null ? `${thrivingNow} of ${plants.length} thriving` : 'Learning'}${sensoredCount ? ` · ${sensoredCount} sensored` : ''} · ${wateringsLogged} watering${wateringsLogged === 1 ? '' : 's'} logged.`}
        </Text>

        <ListGroup header="Your garden">
          <ListRow icon="leaf" title="Plants" value={String(plants.length)} onPress={() => router.push('/plants' as any)} />
          <ListRow icon="home" iconColor="#5B8DB8" title="Rooms" value={String(spots.length)} onPress={() => router.push('/rooms' as any)} />
          <ListRow icon="bar-chart" iconColor="#8A6FB0" title="Garden report" onPress={() => router.push('/report' as any)} />
          <ListRow
            icon="checkmark-done"
            iconColor={accent.sage}
            title="Forecast accuracy"
            value={accuracyPct != null ? `${accuracyPct}%` : undefined}
            subtitle={accuracyPct != null ? `on your garden (±1 day, 90 days)` : 'Builds as forecasts resolve'}
            onPress={() => router.push('/accuracy')}
          />
        </ListGroup>

        <ListGroup header="Sensors">
          {devices.map((d) => {
            const conn = connectionFrom(d.device.last_seen, d.device.wake_seconds);
            return (
              <ListRow
                key={d.device.id}
                icon="hardware-chip"
                iconColor="#4F8A8B"
                title={d.device.label?.trim() || 'Greenr sensor'}
                subtitle={conn.sinceLabel}
                right={<StatusDot status={connToStatus(conn.status)} />}
                onPress={() => router.push('/devices')}
              />
            );
          })}
          {sensors.map((s) => (
            <ListRow
              key={s.id}
              icon="hardware-chip"
              iconColor="#4F8A8B"
              title={s.name}
              subtitle={`Battery ${s.batteryPct}%`}
              right={<StatusDot status={s.status} />}
              onPress={() => router.push(`/sensor/${s.id}`)}
            />
          ))}
          {deviceCount === 0 ? (
            <ListRow
              icon="add"
              title="Pair a sensor"
              subtitle="Turns estimates into measurements"
              onPress={() => router.push('/pair-device' as any)}
            />
          ) : (
            <ListRow icon="settings" iconColor="#4F8A8B" title="Manage sensors" onPress={() => router.push('/devices')} />
          )}
          {deviceCount > 0 && (
            <ListRow icon="pulse" iconColor={accent.sunbeam} title="Sensor health" onPress={() => router.push('/device-health' as any)} />
          )}
        </ListGroup>

        <ListGroup header="Greenr+">
          <ListRow
            icon="sparkles"
            iconColor={accent.warm}
            title={settings.plus ? 'Greenr+ is active' : 'Greenr+'}
            subtitle={settings.plus ? undefined : '10-day forecasts, full history, photo diagnosis'}
            onPress={() => router.push('/plus')}
          />
        </ListGroup>

        <ListGroup header="Settings">
          <ListRow icon="settings" iconColor="#7D8790" title="Settings" onPress={() => router.push('/settings')} />
          <ListRow icon="notifications" iconColor={accent.clay} title="Notifications" onPress={() => router.push('/notifications' as any)} />
          <ListRow icon="people" iconColor="#5B8DB8" title="Household & sharing" onPress={() => router.push('/household' as any)} />
          <ListRow icon="lock-closed" iconColor="#4F8A8B" title="Security & privacy" onPress={() => router.push('/security' as any)} />
        </ListGroup>

        <ListGroup header="Support">
          <ListRow icon="help-buoy" iconColor="#5B8DB8" title="Help" onPress={() => router.push('/help' as any)} />
          <ListRow icon="information-circle" iconColor="#7D8790" title="About Greenr" onPress={() => router.push('/about' as any)} />
          <ListRow
            icon="share"
            iconColor={accent.verdant}
            title="Share Greenr"
            chevron={false}
            onPress={() =>
              shareContent({
                message: `I'm growing healthier plants with Greenr — it reads your soil, light, temperature and humidity and tells you exactly what each plant needs: https://greenr-app.vercel.app`,
                title: 'Greenr',
              })
            }
          />
        </ListGroup>
      </ScrollView>
    </View>
  );
}
