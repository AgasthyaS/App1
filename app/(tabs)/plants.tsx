import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AvatarButton,
  LargeTitle,
  LearningBar,
  ListGroup,
  NavButton,
  Segmented,
  TAB_BAR_CLEARANCE,
} from '@/components/greenr/Native';
import Breathing from '@/components/greenr/Breathing';
import PlantAvatar from '@/components/greenr/PlantAvatar';
import { Card, GButton } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, dark, layout, type } from '@/constants/theme';
import { attentionFor, byAttention, type Attention } from '@/lib/attention';
import { applyCalibration, calibrationFor } from '@/lib/calibration';
import { careScoreValue } from '@/lib/careScore';
import { estimateWaterSchedule } from '@/lib/estimate';
import { BASELINE_DAYS, vitalityFor } from '@/lib/health';
import { storedLightAvg } from '@/lib/insights';
import { idealsFor, lightStatus, soilStatus, tempStatus } from '@/lib/plantStatus';
import { listPourMl } from '@/lib/pourAmount';
import { activePlants, useGreenr } from '@/lib/store';
import { Plant } from '@/lib/types';
import { useAllLiveReadings, useAllReadingHistories } from '@/lib/useLiveReading';

/**
 * Plants — the collection as a clean list. Each row says, in words, what (if
 * anything) the plant needs; the rating is `attentionFor`, the same verdict
 * Today sorts on, so the two cannot disagree.
 *
 * Swipe a row left to log a watering; long-press for half / double amounts.
 */

type SortKey = 'care' | 'room' | 'score' | 'recent';

const levelColor = (level: Attention['level']): string =>
  level === 'urgent' ? accent.clay : level === 'soon' || level === 'watch' ? accent.sunbeam : accent.sage;

export default function PlantsTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { plants: allPlants, spots, logWaterAmount, calibrations, settings, lightDaily, profile } = useGreenr();
  const plants = activePlants(allPlants);
  const liveReadings = useAllLiveReadings();
  const histories = useAllReadingHistories();
  const [sort, setSort] = useState<SortKey>('care');
  const [query, setQuery] = useState('');
  const [quickFor, setQuickFor] = useState<string | null>(null);
  const [grid, setGrid] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const calFor = (p: Plant) => calibrationFor(calibrations, liveReadings.get(p.id)?.device_id, p.sensorId);

  const attention = (p: Plant): Attention =>
    attentionFor({
      plant: p,
      reading: liveReadings.get(p.id) ?? null,
      history: histories.get(p.id) ?? [],
      calibration: calFor(p),
      lightDaily: lightDaily[p.id] ?? null,
      hasSensor: liveReadings.has(p.id) || !!p.sensorId,
    });

  const vitality = (p: Plant) =>
    vitalityFor(
      p,
      liveReadings.has(p.id),
      liveReadings.get(p.id) ?? null,
      calFor(p),
      settings.unitsF,
      storedLightAvg(lightDaily[p.id]),
      liveReadings.has(p.id) ? null : careScoreValue(p, spots.find((s) => s.id === p.spotId)),
    );

  /** The amount to pour — the same number the plant screen quotes. */
  const pourFor = (p: Plant): number => {
    const raw = liveReadings.get(p.id);
    const cal = calFor(p);
    const hist = (histories.get(p.id) ?? []).map((h) => applyCalibration(h, cal));
    return listPourMl(p, raw ? applyCalibration(raw, cal) : null, hist, lightDaily[p.id]);
  };

  const logWater = (p: Plant, ml: number, suggested: number) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    logWaterAmount(p.id, ml, { suggestedMl: suggested, source: 'preset' });
    setQuickFor(null);
    setToast(`Logged ${ml} ml for ${p.name}`);
    setTimeout(() => setToast(null), 1800);
  };

  const roomName = (id: string) => spots.find((s) => s.id === id)?.room ?? 'No room';
  const spotName = (id: string) => spots.find((s) => s.id === id)?.name;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = plants.filter(
      (p) => !q || p.name.toLowerCase().includes(q) || p.species.toLowerCase().includes(q),
    );
    const att = new Map(filtered.map((p) => [p.id, attention(p)]));
    if (sort === 'room') {
      const m = new Map<string, Plant[]>();
      filtered
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((p) => m.set(roomName(p.spotId), [...(m.get(roomName(p.spotId)) ?? []), p]));
      return { att, list: [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])) };
    }
    if (sort === 'score') {
      return { att, list: [['', filtered.sort((a, b) => a.score - b.score)]] as [string, Plant[]][] };
    }
    if (sort === 'recent') {
      return { att, list: [['', filtered.sort((a, b) => a.addedDaysAgo - b.addedDaysAgo)]] as [string, Plant[]][] };
    }
    return { att, list: [['', filtered.sort((a, b) => byAttention(att.get(a.id)!, att.get(b.id)!))]] as [string, Plant[]][] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plants, sort, query, liveReadings, histories, calibrations, lightDaily, spots]);

  const statusFor = (p: Plant, a: Attention, v: ReturnType<typeof vitality>): { text: string; color: string } => {
    if (a.level !== 'fine' && a.level !== 'unknown') return { text: `${a.label} · ${a.reason}`, color: levelColor(a.level) };
    if (v.awaiting) return { text: 'Waiting for the sensor’s first reading', color: dark.inkMuted };
    if (v.pending) {
      return { text: estimateWaterSchedule(p).whenLabel, color: dark.inkMuted };
    }
    if (!v.sensored) return { text: `${v.word} · ${estimateWaterSchedule(p).whenLabel}`, color: dark.inkMuted };
    // A fine sensored plant: the three readings in words, as the old Home list said.
    const raw = liveReadings.get(p.id);
    if (raw) {
      const r = applyCalibration(raw, calFor(p));
      const ideal = idealsFor(p.species, p.comfortBand);
      return {
        text: `${v.word} · Soil ${soilStatus(r.soil_pct, ideal.band).label} · ${lightStatus(r.light_lux, ideal.dli).label} · ${tempStatus(r.temp_c, ideal.temp).label}`,
        color: accent.sage,
      };
    }
    return { text: v.word, color: accent.sage };
  };

  return (
    <View style={{ flex: 1, backgroundColor: dark.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: layout.margin,
          paddingTop: insets.top + 8,
          paddingBottom: TAB_BAR_CLEARANCE + insets.bottom,
          width: '100%',
          maxWidth: 720,
          alignSelf: 'center',
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <LargeTitle
          overline={`${plants.length} plant${plants.length === 1 ? '' : 's'}`}
          title="Plants"
          right={
            <>
              <NavButton icon="add" label="Add plant" onPress={() => router.push('/add-sheet')} />
              <AvatarButton name={profile?.name ?? 'Gardener'} onPress={() => router.push('/you' as any)} />
            </>
          }
        />

        {plants.length > 0 && (
          <>
            {/* search field */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                marginTop: 8,
                paddingHorizontal: 12,
                minHeight: 40,
                borderRadius: 12,
                backgroundColor: dark.surface2,
                borderWidth: 1,
                borderColor: dark.cardBorder,
              }}
            >
              <Ionicons name="search" size={17} color={dark.inkMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
                placeholderTextColor={dark.inkMuted}
                style={[type.body, { flex: 1, color: dark.ink, paddingVertical: 8, outlineStyle: 'none' } as any]}
                returnKeyType="search"
                autoCorrect={false}
              />
              {query ? (
                <Pressable onPress={() => setQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={17} color={dark.inkMuted} />
                </Pressable>
              ) : null}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <Segmented
              style={{ flex: 1 }}
              value={sort}
              onChange={setSort}
              options={[
                { value: 'care', label: 'Needs care' },
                { value: 'room', label: 'Room' },
                { value: 'score', label: 'Score' },
                { value: 'recent', label: 'Newest' },
              ]}
            />
            <NavButton
              icon={grid ? 'list' : 'grid'}
              label={grid ? 'Show as list' : 'Show as grid'}
              tint={dark.inkMuted}
              onPress={() => setGrid(!grid)}
            />
            </View>
          </>
        )}

        {plants.length === 0 && (
          <Card style={{ alignItems: 'center', paddingVertical: 40, marginTop: 16 }}>
            <Ionicons name="leaf" size={40} color={accent.verdant} />
            <Text style={[type.cardTitle, { color: dark.ink, marginTop: 12 }]}>No plants yet</Text>
            <Text style={[type.body, { color: dark.inkMuted, marginTop: 4, textAlign: 'center' }]}>
              Add one and Greenr starts working out its care right away.
            </Text>
            <GButton title="Add plant" onPress={() => router.push('/add-plant')} style={{ marginTop: 16, alignSelf: 'stretch' }} />
          </Card>
        )}

        {grid && (
          <View style={{ marginTop: 14 }}>
            {groups.list.map(([room, list]) => (
              <View key={room || 'all'}>
                {room ? (
                  <Text style={[type.sectionHeader, { color: dark.inkMuted, marginTop: 20, marginBottom: 8, marginLeft: 4 }]}>{room}</Text>
                ) : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {list.map((p) => {
                    const v = vitality(p);
                    const a = groups.att.get(p.id)!;
                    const noScore = v.awaiting || v.pending;
                    const status = statusFor(p, a, v);
                    const ml = pourFor(p);
                    // The score coloured by what it means — the same thresholds as the words.
                    const scoreColor = v.score >= 85 ? accent.sage : v.score >= 70 ? dark.ink : v.score >= 50 ? accent.sunbeam : accent.clay;
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => router.push(`/plant/${p.id}`)}
                        onLongPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                          setQuickFor(quickFor === p.id ? null : p.id);
                        }}
                        style={({ pressed }) => ({
                          flexBasis: '47%',
                          flexGrow: 1,
                          alignItems: 'center',
                          padding: 14,
                          borderRadius: 18,
                          borderWidth: 1,
                          borderColor: dark.cardBorder,
                          backgroundColor: pressed ? dark.surface2 : dark.surface1,
                        })}
                      >
                        <Breathing enabled={!noScore && v.score >= 85}>
                          <VitalityRing
                            score={noScore ? 0 : v.score}
                            size={84}
                            estimate={v.estimate}
                            estimateBand={v.estimateBand}
                            showLabel={false}
                            trackColor={dark.hairline}
                          >
                            <PlantAvatar photoUri={p.photoUri} emoji={p.emoji} size={60} />
                          </VitalityRing>
                        </Breathing>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10, maxWidth: '100%' }}>
                          <Text style={[type.cardTitle, { color: dark.ink, flexShrink: 1 }]} numberOfLines={1}>
                            {p.name}
                          </Text>
                          {(v.sensored || p.sensorId) && <Ionicons name="hardware-chip-outline" size={12} color={dark.inkMuted} />}
                          {p.watchMode && <Ionicons name="pulse-outline" size={12} color={accent.sunbeam} />}
                        </View>
                        <Text style={[type.caption, { color: dark.inkMuted }]} numberOfLines={1}>
                          {spotName(p.spotId) ?? p.species}
                        </Text>
                        <Text style={[type.numHero as any, { fontSize: 24, marginTop: 4, color: noScore ? dark.inkMuted : scoreColor }]}>
                          {noScore ? '—' : v.score}
                          {v.estimate && !noScore ? <Text style={[type.micro, { color: dark.inkMuted }]}> ±{v.estimateBand}</Text> : null}
                        </Text>
                        <Text style={[type.caption, { color: status.color, textAlign: 'center', marginTop: 2 }]} numberOfLines={2}>
                          {status.text}
                        </Text>
                        {v.pending && (
                          <LearningBar compact day={v.baselineDay ?? 1} of={BASELINE_DAYS} style={{ marginTop: 8, alignSelf: 'stretch' }} />
                        )}
                        {quickFor === p.id && (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, alignSelf: 'stretch' }}>
                            {[0.5, 1, 2].map((f) => {
                              const amt = Math.max(25, Math.round((ml * f) / 25) * 25);
                              return (
                                <GButton
                                  key={f}
                                  title={`${amt} ml`}
                                  kind={f === 1 ? 'primary' : 'secondary'}
                                  style={{ flexGrow: 1, minHeight: 36, paddingHorizontal: 8 }}
                                  onPress={() => logWater(p, amt, ml)}
                                />
                              );
                            })}
                            {p.sensorId && (
                              <GButton
                                title="Sensor"
                                kind="secondary"
                                style={{ flexGrow: 1, minHeight: 36, paddingHorizontal: 8 }}
                                onPress={() => router.push(`/sensor/${p.sensorId}`)}
                              />
                            )}
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        )}

        {!grid && groups.list.map(([room, list]) => (
          <ListGroup key={room || 'all'} header={room || undefined} inset={78} style={{ marginTop: room ? 0 : 14 }}>
            {list.map((p) => {
              const v = vitality(p);
              const a = groups.att.get(p.id)!;
              const noScore = v.awaiting || v.pending;
              const status = statusFor(p, a, v);
              const ml = pourFor(p);
              return (
                <View key={p.id}>
                  <Swipeable
                    friction={2}
                    rightThreshold={40}
                    overshootRight={false}
                    renderRightActions={(_p, _t, methods) => (
                      <Pressable
                        onPress={() => {
                          logWater(p, ml, ml);
                          methods.close();
                        }}
                        style={{ width: 96, backgroundColor: accent.verdant, alignItems: 'center', justifyContent: 'center', gap: 2 }}
                      >
                        <Ionicons name="water" size={22} color="#FFFFFF" />
                        <Text style={[type.micro, { color: '#FFFFFF' }]}>{ml} ml</Text>
                      </Pressable>
                    )}
                  >
                    <Pressable
                      onPress={() => router.push(`/plant/${p.id}`)}
                      onLongPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                        setQuickFor(quickFor === p.id ? null : p.id);
                      }}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 14,
                        paddingVertical: 12,
                        paddingHorizontal: 14,
                        backgroundColor: pressed ? dark.surface2 : dark.surface1,
                      })}
                    >
                      <Breathing enabled={!noScore && v.score >= 85}>
                        <VitalityRing
                          score={noScore ? 0 : v.score}
                          size={52}
                          estimate={v.estimate}
                          estimateBand={v.estimateBand}
                          showLabel={false}
                          trackColor={dark.hairline}
                        >
                          <PlantAvatar photoUri={p.photoUri} emoji={p.emoji} size={40} />
                        </VitalityRing>
                      </Breathing>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={[type.cardTitle, { color: dark.ink, flexShrink: 1 }]} numberOfLines={1}>
                            {p.name}
                          </Text>
                          {(v.sensored || p.sensorId) && (
                            <Ionicons name="hardware-chip-outline" size={13} color={dark.inkMuted} />
                          )}
                          {p.watchMode && <Ionicons name="pulse-outline" size={13} color={accent.sunbeam} />}
                        </View>
                        <Text style={[type.caption, { color: dark.inkMuted, marginTop: 1 }]} numberOfLines={1}>
                          {sort === 'room' ? spotName(p.spotId) ?? p.species : `${p.species}${spotName(p.spotId) ? ` · ${spotName(p.spotId)}` : ''}`}
                        </Text>
                        <Text style={[type.caption, { color: status.color, marginTop: 2 }]} numberOfLines={1}>
                          {status.text}
                        </Text>
                        {v.pending && (
                          <LearningBar compact day={v.baselineDay ?? 1} of={BASELINE_DAYS} style={{ marginTop: 6, maxWidth: 220 }} />
                        )}
                      </View>
                      {!noScore && (
                        <Text style={[type.numBold as any, { color: dark.ink, fontSize: 17 }]}>
                          {v.score}
                          {v.estimate ? <Text style={[type.micro, { color: dark.inkMuted }]}> ±{v.estimateBand}</Text> : null}
                        </Text>
                      )}
                      <Ionicons name="chevron-forward" size={16} color={dark.inkMuted} style={{ opacity: 0.7 }} />
                    </Pressable>
                  </Swipeable>

                  {/* long-press quick amounts — naming the amount turns every
                      quick log into a measurement of the pot */}
                  {quickFor === p.id && (
                    <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 12, backgroundColor: dark.surface1 }}>
                      {[
                        { label: 'Half', factor: 0.5 },
                        { label: `${ml} ml`, factor: 1 },
                        { label: 'Double', factor: 2 },
                      ].map((o) => {
                        const amt = Math.max(25, Math.round((ml * o.factor) / 25) * 25);
                        return (
                          <GButton
                            key={o.label}
                            title={o.factor === 1 ? o.label : `${o.label} · ${amt}`}
                            kind={o.factor === 1 ? 'primary' : 'secondary'}
                            style={{ flex: 1, minHeight: 40 }}
                            onPress={() => logWater(p, amt, ml)}
                          />
                        );
                      })}
                      {p.sensorId && (
                        <GButton
                          title="Sensor"
                          kind="secondary"
                          style={{ flex: 1, minHeight: 40 }}
                          onPress={() => router.push(`/sensor/${p.sensorId}`)}
                        />
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </ListGroup>
        ))}

        {plants.length > 0 && (
          <Text style={[type.caption, { color: dark.inkMuted, textAlign: 'center', marginTop: 14 }]}>
            {grid ? 'Hold a plant for quick watering amounts' : 'Swipe left on a plant to log a watering · hold for other amounts'}
          </Text>
        )}
      </ScrollView>

      {toast && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: 0, right: 0, bottom: TAB_BAR_CLEARANCE + insets.bottom - 20, alignItems: 'center' }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 999,
              backgroundColor: dark.ink,
            }}
          >
            <Ionicons name="checkmark-circle" size={18} color={accent.sage} />
            <Text style={[type.caption, { color: dark.bg, fontWeight: '600' }]}>{toast}</Text>
          </View>
        </View>
      )}
    </View>
  );
}
