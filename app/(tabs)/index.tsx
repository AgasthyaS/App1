import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AvatarButton,
  CheckCircle,
  IconTile,
  LargeTitle,
  ListGroup,
  ListRow,
  NavButton,
  TAB_BAR_CLEARANCE,
} from '@/components/greenr/Native';
import PlantAvatar from '@/components/greenr/PlantAvatar';
import { Card, GButton } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, dark, layout, type } from '@/constants/theme';
import { type AlertLevel, notificationsFor } from '@/lib/alerts';
import { attentionFor, byAttention, type Attention } from '@/lib/attention';
import { applyCalibration, calibrationFor } from '@/lib/calibration';
import { careScoreValue } from '@/lib/careScore';
import { estimateWaterSchedule, type EstimateSchedule } from '@/lib/estimate';
import { gardenVitalityAvg, vitalityFor } from '@/lib/health';
import { careThisWeekLine } from '@/lib/careLog';
import { newMilestones } from '@/lib/milestones';
import { storedLightAvg } from '@/lib/insights';
import { computeSchedule, type WaterSchedule } from '@/lib/schedule';
import { retentionEstimate } from '@/lib/soilRetention';
import { soilDynamics, wateredSinceLastReading, wateringDidNotRegister } from '@/lib/soilDynamics';
import { listPourMl } from '@/lib/pourAmount';
import { activePlants, useGreenr } from '@/lib/store';
import { Plant } from '@/lib/types';
import {
  refreshReadings,
  useAllLiveReadings,
  useAllReadingHistories,
  useReadingsRefreshing,
  useSensorUploadHealth,
} from '@/lib/useLiveReading';
import { useWeather } from '@/lib/useWeather';
import { waterAction } from '@/lib/waterAction';
import { cToF, weatherIconFor } from '@/lib/weather';

/**
 * Today — the one screen most people need. It answers, in order:
 *   1. How is everything?            (one sentence)
 *   2. What do I need to do?          (a to-do list you can tick off)
 *   3. What's coming?                 (each plant's next watering)
 *
 * Every verdict here is `attentionFor` / `waterAction` — the same decisions the
 * plant screen makes — so the list and the plant can never disagree.
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

const isWaterTask = (a: Attention) => /^(water|retry water)/i.test(a.label);

const levelColor = (level: Attention['level']): string =>
  level === 'urgent' ? accent.clay : level === 'soon' || level === 'watch' ? accent.sunbeam : accent.verdant;

/** An icon for each kind of "worth a look" verdict. */
function attentionIcon(a: Attention): string {
  const l = a.label.toLowerCase();
  if (l.includes('move')) return 'move';
  if (l.includes('air')) return 'thermometer';
  if (l.includes('salt')) return 'flask';
  if (l.includes('soil')) return 'layers';
  if (l.includes('probe')) return 'hardware-chip';
  if (l.includes('missing')) return 'construct';
  if (l.includes('wet') || l.includes('waterlogged')) return 'rainy';
  if (l.includes('did you water')) return 'help';
  return 'alert';
}

function WeatherStrip({ w, unitsF }: { w: ReturnType<typeof useWeather>; unitsF: boolean }) {
  const daily = w.weather?.daily;
  if (!daily || daily.length < 2) return null;
  const temp = (c: number) => `${Math.round(unitsF ? cToF(c) : c)}°`;
  return (
    <Card style={{ marginTop: 10, paddingVertical: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {daily.slice(0, 5).map((d, i) => {
          const wd = i === 0 ? 'Today' : new Date(d.date + 'T00:00').toLocaleDateString('en-US', { weekday: 'short' });
          return (
            <View key={d.date} style={{ alignItems: 'center', flex: 1, gap: 4 }}>
              <Text style={[type.micro, { color: dark.inkMuted }]}>{wd}</Text>
              <Ionicons name={weatherIconFor(d.emoji) as any} size={22} color={accent.sunbeam} />
              <Text style={[type.num as any, { color: dark.ink, fontSize: 15 }]}>{temp(d.tempMaxC)}</Text>
              <Text style={[type.micro, { color: dark.inkMuted }]}>{temp(d.tempMinC)}</Text>
              {d.rainProbPct >= 30 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Ionicons name="umbrella" size={10} color={accent.verdant} />
                  <Text style={[type.micro, { color: accent.verdant, fontSize: 11 }]}>{d.rainProbPct}%</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

export default function TodayTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { plants: allPlants, spots, settings, setSettings, calibrations, lightDaily, profile, logWaterAmount, briefingOpened } = useGreenr();
  const liveReadings = useAllLiveReadings();
  const histories = useAllReadingHistories();
  const refreshing = useReadingsRefreshing();
  const { fleet } = useSensorUploadHealth();
  const weather = useWeather();
  // Ticked this session — kept on the list (struck through) so the tick is
  // seen to land, rather than the row vanishing under the finger.
  const [done, setDone] = useState<Record<string, number>>({});

  const plants = useMemo(() => activePlants(allPlants), [allPlants]);
  const calFor = (p: Plant) => calibrationFor(calibrations, liveReadings.get(p.id)?.device_id, p.sensorId);
  const careFor = (p: Plant) =>
    liveReadings.has(p.id) ? null : careScoreValue(p, spots.find((s) => s.id === p.spotId));

  // Next watering from each sensored plant's drying history + weather.
  const schedules = useMemo(() => {
    const m = new Map<string, WaterSchedule>();
    plants.forEach((p) => {
      if (!liveReadings.has(p.id)) return;
      const outdoor = !!spots.find((s) => s.id === p.spotId)?.outdoor;
      const cal = calibrationFor(calibrations, liveReadings.get(p.id)?.device_id, p.sensorId);
      const hist = (histories.get(p.id) ?? []).map((r) => applyCalibration(r, cal));
      // Follow this pot's fitted dry-down curve where one exists.
      const ret = retentionEstimate(p, hist);
      const decay = ret ? { tauDays: ret.tauObservedDays, residual: ret.residual } : null;
      m.set(p.id, computeSchedule(hist, p.comfortBand, p.species, { weather: weather.weather, outdoor, decay }));
    });
    return m;
  }, [plants, liveReadings, histories, spots, weather.weather, calibrations]);

  const estimates = useMemo(() => {
    const m = new Map<string, EstimateSchedule>();
    plants.forEach((p) => {
      if (!liveReadings.has(p.id)) m.set(p.id, estimateWaterSchedule(p));
    });
    return m;
  }, [plants, liveReadings]);

  const attention = useMemo(() => {
    const m = new Map<string, Attention>();
    plants.forEach((p) => {
      const raw = liveReadings.get(p.id) ?? null;
      m.set(
        p.id,
        attentionFor({
          plant: p,
          reading: raw,
          history: histories.get(p.id) ?? [],
          calibration: calibrationFor(calibrations, raw?.device_id, p.sensorId),
          lightDaily: lightDaily[p.id] ?? null,
          hasSensor: liveReadings.has(p.id),
        }),
      );
    });
    return m;
  }, [plants, liveReadings, histories, calibrations, lightDaily]);

  /** The amount to pour — the same number the plant screen quotes. */
  const pourFor = (p: Plant): number => {
    const raw = liveReadings.get(p.id);
    const cal = calFor(p);
    const hist = (histories.get(p.id) ?? []).map((h) => applyCalibration(h, cal));
    return listPourMl(p, raw ? applyCalibration(raw, cal) : null, hist, lightDaily[p.id]);
  };

  // Alerts across sensored plants, using live weather for outdoor rain-delay —
  // the same feed the old Home tab showed, kept so nothing it said is lost.
  const alerts = useMemo(() => {
    const items: { id: string; plantId: string; level: AlertLevel; text: string }[] = [];
    plants.forEach((p) => {
      if (!liveReadings.has(p.id)) return;
      const outdoor = !!spots.find((s) => s.id === p.spotId)?.outdoor;
      const raw = liveReadings.get(p.id) ?? null;
      const cal = calibrationFor(calibrations, raw?.device_id, p.sensorId);
      const hist = (histories.get(p.id) ?? []).map((h) => applyCalibration(h, cal));
      const calRaw = raw ? applyCalibration(raw, cal) : null;
      // One decision, one number — the alert must not recompute its own.
      const act = waterAction({ plant: p, reading: calRaw, history: hist });
      notificationsFor({
        plantName: p.name,
        species: p.species,
        band: p.comfortBand,
        reading: calRaw,
        soilDyn: hist.length ? soilDynamics(p, hist, p.comfortBand) : null,
        justWatered: wateredSinceLastReading(p, raw),
        wateringMiss: hist.length ? wateringDidNotRegister(p, hist, p.comfortBand) : null,
        pourMl: act.ml > 0 ? act.ml : null,
        outdoor,
        weather: weather.weather,
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
      }).forEach((a, i) => items.push({ id: `${p.id}-${i}`, plantId: p.id, level: a.level, text: a.text }));
    });
    const order: Record<AlertLevel, number> = { bad: 0, warn: 1, info: 2 };
    return items.sort((a, b) => order[a.level] - order[b.level]);
  }, [plants, liveReadings, histories, spots, weather.weather, calibrations]);

  const sorted = useMemo(
    () =>
      [...plants].sort((a, b) => {
        const at = attention.get(a.id);
        const bt = attention.get(b.id);
        if (at && bt) {
          const d = byAttention(at, bt);
          if (d !== 0) return d;
        }
        return scheduleSort(schedules.get(a.id), estimates.get(a.id)) - scheduleSort(schedules.get(b.id), estimates.get(b.id));
      }),
    [plants, schedules, estimates, attention],
  );

  // A plant without a sensor is rated "No sensor" by `attentionFor`, so its
  // timing estimate is what says it is due — as the old Forecast and Home did.
  const estDue = (p: Plant) => estimates.get(p.id)?.status === 'due';
  const todo = sorted.filter((p) => {
    const a = attention.get(p.id);
    return done[p.id] != null || estDue(p) || (a && (a.level === 'urgent' || a.level === 'soon'));
  });
  const worthALook = sorted.filter((p) => !todo.includes(p) && attention.get(p.id)?.level === 'watch');
  const comingUp = sorted.filter((p) => !todo.includes(p) && !worthALook.includes(p));

  const avg = useMemo(
    () =>
      gardenVitalityAvg(
        plants.map((p) => ({
          plant: p,
          hasSensor: liveReadings.has(p.id),
          reading: liveReadings.get(p.id) ?? null,
          calibration: calFor(p),
          lightAvg: storedLightAvg(lightDaily[p.id]),
          careScore: careFor(p),
        })),
        settings.unitsF,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plants, liveReadings, calibrations, lightDaily, settings.unitsF, spots],
  );

  const healthy = plants.filter((p) => {
    const v = vitalityFor(p, liveReadings.has(p.id), liveReadings.get(p.id) ?? null, calFor(p), settings.unitsF, storedLightAvg(lightDaily[p.id]), careFor(p));
    return !v.awaiting && !v.pending && v.score >= 70;
  }).length;

  const wins = newMilestones(plants, settings.milestonesSeen);
  const careLogged = careThisWeekLine(plants);

  const open = todo.filter((p) => done[p.id] == null).length;
  const dueSoon = sorted.filter((p) => {
    const s = schedules.get(p.id);
    if (s) return s.status === 'overdue' || (s.nextWaterAt != null && s.nextWaterAt.getTime() - Date.now() < 3 * 86400000);
    const est = estimates.get(p.id);
    return !!est && (est.status === 'due' || (est.dueAt != null && est.dueAt.getTime() - Date.now() < 2 * 86400000));
  }).length;
  const day = new Date().getDay();
  const showFullBriefing = day === 0 || day === 1 || (!briefingOpened && day <= 3);
  const headline =
    plants.length === 0
      ? 'Welcome to Greenr.'
      : open === 0
        ? 'Everything’s taken care of.'
        : open === 1
          ? '1 plant needs you today.'
          : `${open} plants need you today.`;
  const subline =
    plants.length === 0
      ? 'Add a plant and Greenr will tell you exactly when and how much to water it.'
      : `${
          avg != null
            ? `${healthy} of ${plants.length} plants are healthy`
            : `${plants.length} plant${plants.length === 1 ? '' : 's'}`
        } · ${dueSoon > 0 ? `${dueSoon} need${dueSoon === 1 ? 's' : ''} water in the next few days` : 'no watering due soon'}.`;

  const hasOutdoor = plants.some((p) => spots.find((s) => s.id === p.spotId)?.outdoor);
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const whenFor = (p: Plant): string => {
    const s = schedules.get(p.id);
    if (s) {
      const why = s.weatherNote || (s.status !== 'unknown' ? s.basis : 'A date appears once the sensor has logged a few readings.');
      return `${s.whenLabel}${why ? `
${why}` : ''}`;
    }
    const est = estimates.get(p.id) ?? estimateWaterSchedule(p);
    return `${est.whenLabel}${est.detail ? `
${est.detail}` : ''}`;
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: dark.bg }}
      contentContainerStyle={{
        paddingHorizontal: layout.margin,
        paddingTop: insets.top + 8,
        paddingBottom: TAB_BAR_CLEARANCE + insets.bottom,
        width: '100%',
        maxWidth: 720,
        alignSelf: 'center',
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void refreshReadings();
            weather.refresh();
          }}
          tintColor={accent.verdant}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <LargeTitle
        overline={today}
        title="Today"
        right={
          <>
            <NavButton icon="add" label="Add" onPress={() => router.push('/add-sheet')} />
            <AvatarButton name={profile?.name ?? 'Gardener'} onPress={() => router.push('/you' as any)} />
          </>
        }
      />

      {/* The state of the garden in one sentence. */}
      <Card style={{ marginTop: 8, paddingVertical: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ flex: 1 }}>
            <Text style={[type.ritualTitle, { color: dark.ink, fontSize: 24, lineHeight: 30 }]}>{headline}</Text>
            <Text style={[type.body, { color: dark.inkMuted, marginTop: 6 }]}>{subline}</Text>
          </View>
          {avg != null && <VitalityRing score={avg} size={64} showLabel trackColor={dark.hairline} />}
        </View>
        {plants.length === 0 && (
          <GButton title="Add your first plant" onPress={() => router.push('/add-plant')} style={{ marginTop: 16 }} />
        )}
      </Card>

      {/* Early wins, each celebrated once. */}
      {wins.length > 0 && (
        <Card style={{ marginTop: 10, borderColor: `${accent.verdant}66` }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="trophy" size={18} color={accent.warm} />
            <Text style={[type.cardTitle, { color: dark.ink, flex: 1 }]}>
              {wins.length === 1 ? 'Nice work' : `${wins.length} milestones reached`}
            </Text>
          </View>
          {wins.map((m) => (
            <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }}>
              <IconTile icon={m.icon} color={accent.verdant} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { color: dark.ink, fontWeight: '600' }]}>{m.title}</Text>
                <Text style={[type.caption, { color: dark.inkMuted }]}>{m.detail}</Text>
              </View>
            </View>
          ))}
          <GButton
            title="Keep going"
            kind="secondary"
            style={{ marginTop: 14, minHeight: 40 }}
            onPress={() => setSettings({ milestonesSeen: [...(settings.milestonesSeen ?? []), ...wins.map((m) => m.id)] })}
          />
        </Card>
      )}

      {/* Sensors not reporting — everything below is derived from readings, so
          if they stopped, the rest of the screen is history rather than news.
          Renders nothing when the sensors are fine. */}
      {fleet && (
        <ListGroup style={{ marginTop: 10 }}>
          <ListRow
            icon={fleet.severity >= 65 ? 'cloud-offline' : 'alert-circle'}
            iconColor={fleet.severity >= 65 ? accent.clay : accent.sunbeam}
            title={fleet.headline}
            subtitle={fleet.detail}
            onPress={() => router.push('/device-health' as any)}
          />
        </ListGroup>
      )}

      {todo.length > 0 && (
        <ListGroup header="To do" inset={54}>
          {todo.map((p) => {
            const a = attention.get(p.id)!;
            const ticked = done[p.id] != null;
            const water = ticked || estDue(p) || isWaterTask(a);
            const ml = ticked ? done[p.id] : water ? pourFor(p) : 0;
            return (
              <ListRow
                key={p.id}
                left={
                  water ? (
                    <CheckCircle
                      done={ticked}
                      color={accent.verdant}
                      onPress={() => {
                        if (ticked) return;
                        logWaterAmount(p.id, ml, { suggestedMl: ml, source: 'preset' });
                        setDone((d) => ({ ...d, [p.id]: ml }));
                      }}
                    />
                  ) : (
                    <IconTile icon={attentionIcon(a)} color={levelColor(a.level)} size={28} />
                  )
                }
                title={water ? (ticked ? `Watered ${p.name}` : `Water ${p.name}`) : `${a.label} — ${p.name}`}
                subtitle={
                  ticked
                    ? `Logged ${ml} ml${liveReadings.has(p.id) ? ' · the sensor will confirm it' : ''}`
                    : estDue(p)
                      ? `About ${ml} ml · ${estimates.get(p.id)!.whenLabel} — check the soil first`
                      : water
                        ? `About ${ml} ml · ${a.reason}`
                        : a.reason
                }
                subtitleLines={3}
                onPress={() => router.push(`/plant/${p.id}`)}
              />
            );
          })}
        </ListGroup>
      )}

      {worthALook.length > 0 && (
        <ListGroup header="Worth a look">
          {worthALook.map((p) => {
            const a = attention.get(p.id)!;
            return (
              <ListRow
                key={p.id}
                icon={attentionIcon(a)}
                iconColor={levelColor(a.level)}
                title={`${p.name} · ${a.label}`}
                subtitle={a.reason}
                subtitleLines={3}
                onPress={() => router.push(`/plant/${p.id}`)}
              />
            );
          })}
        </ListGroup>
      )}

      {alerts.length > 0 && (
        <ListGroup header="Alerts from your sensors">
          {alerts.slice(0, 5).map((a) => (
            <ListRow
              key={a.id}
              icon={a.level === 'bad' ? 'alert-circle' : a.level === 'warn' ? 'warning' : 'information-circle'}
              iconColor={a.level === 'bad' ? accent.clay : a.level === 'warn' ? accent.sunbeam : accent.verdant}
              title={a.text}
              titleLines={3}
              onPress={() => router.push(`/plant/${a.plantId}`)}
            />
          ))}
        </ListGroup>
      )}

      {hasOutdoor && (weather.weather?.daily?.length ?? 0) >= 2 && (
        <>
          <Text style={[type.sectionHeader, { color: dark.inkMuted, marginTop: 24, marginBottom: 0, marginLeft: 4 }]}>
            Weather
          </Text>
          <WeatherStrip w={weather} unitsF={settings.unitsF} />
        </>
      )}

      {comingUp.length > 0 && (
        <ListGroup
          header="Coming up"
          inset={66}
          footer={
            estimates.size > 0
              ? 'Plants without a sensor are timed from your logged waterings and each species’ usual rhythm.'
              : undefined
          }
        >
          {comingUp.map((p) => (
            <ListRow
              key={p.id}
              left={<PlantAvatar photoUri={p.photoUri} emoji={p.emoji} size={40} framed />}
              title={p.name}
              subtitle={whenFor(p)}
              subtitleLines={4}
              onPress={() => router.push(`/plant/${p.id}`)}
            />
          ))}
        </ListGroup>
      )}

      {plants.length > 0 && (
        <ListGroup header="This week" style={{ marginBottom: 8 }}>
          <ListRow
            icon="newspaper"
            iconColor={accent.verdantDeep}
            title="Weekly briefing"
            subtitle={
              [showFullBriefing ? 'Ready now' : `Next: ${settings.briefingDay} ${settings.briefingTime}`, careLogged]
                .filter(Boolean)
                .join(' · ')
            }
            right={showFullBriefing ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent.verdant }} /> : undefined}
            onPress={() => router.push('/briefing')}
          />
        </ListGroup>
      )}

      {plants.length === 0 && (
        <Pressable onPress={() => router.push('/pair-device' as any)} style={{ marginTop: 10 }}>
          <Text style={[type.caption, { color: accent.verdant, textAlign: 'center' }]}>Have a Greenr sensor? Pair it</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
