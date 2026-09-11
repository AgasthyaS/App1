import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import Breathing from '@/components/greenr/Breathing';
import PlantAvatar from '@/components/greenr/PlantAvatar';
import { Card, GButton, Screen } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, dark, type } from '@/constants/theme';
import { waterAmount } from '@/lib/advice';
import { estimateWaterSchedule } from '@/lib/estimate';
import { calibrationFor } from '@/lib/calibration';
import { careScoreValue } from '@/lib/careScore';
import { attentionFor, type Attention } from '@/lib/attention';
import { vitalityFor } from '@/lib/health';
import { storedLightAvg } from '@/lib/insights';
import { activePlants, useGreenr } from '@/lib/store';
import { useAllLiveReadings, useAllReadingHistories } from '@/lib/useLiveReading';
import { Plant } from '@/lib/types';

/**
 * A vitality score, coloured by what it means rather than by whether it is
 * excellent. The thresholds match the words `vitalityFor` already uses, so the
 * colour and the caption can never say different things.
 */
const scoreColor = (score: number): string =>
  score >= 85 ? accent.sage : score >= 70 ? dark.ink : score >= 50 ? accent.sunbeam : accent.clay;

/** The rating's own urgency colour, shared with the first tab's list. */
const levelColor = (level: Attention['level']): string =>
  level === 'urgent' ? accent.clay
    : level === 'soon' ? accent.sunbeam
      : level === 'watch' ? accent.sunbeam
        : dark.inkMuted;

type SortKey = 'Urgency' | 'Score' | 'Room' | 'Recent';
const SORTS: SortKey[] = ['Urgency', 'Score', 'Room', 'Recent'];

export default function GardenTab() {
  const router = useRouter();
  const { plants: allPlants, spots, logWaterAmount, calibrations, settings, lightDaily } = useGreenr();
  const plants = activePlants(allPlants);
  const liveReadings = useAllLiveReadings();
  const histories = useAllReadingHistories();
  /*
   * WHAT IS ACTUALLY WRONG WITH THIS PLANT, not just how well it scores.
   *
   * The card showed a vitality ring and a number, and those answer "how is it
   * doing" without answering "what do I do". A plant whose probe has fallen out
   * of the soil and a plant that is perfectly fine both render as a ring and two
   * digits; the one piece of information that would send someone to the right
   * pot was on a different tab.
   *
   * `attentionFor` is the same verdict the first tab sorts on, so the two cannot
   * disagree — it is read here, not recomputed.
   */
  const attention = (p: Plant): Attention =>
    attentionFor({
      plant: p,
      reading: liveReadings.get(p.id) ?? null,
      history: histories.get(p.id) ?? [],
      calibration: calibrationFor(calibrations, liveReadings.get(p.id)?.device_id, p.sensorId),
      lightDaily: lightDaily[p.id] ?? null,
      hasSensor: liveReadings.has(p.id) || !!p.sensorId,
    });

  const vitality = (p: Plant) =>
    vitalityFor(
      p,
      liveReadings.has(p.id),
      liveReadings.get(p.id) ?? null,
      calibrationFor(calibrations, liveReadings.get(p.id)?.device_id, p.sensorId),
      settings.unitsF,
      storedLightAvg(lightDaily[p.id]),
      liveReadings.has(p.id) ? null : careScoreValue(p, spots.find((s) => s.id === p.spotId)),
    );
  const [sort, setSort] = useState<SortKey>('Urgency');
  const [grid, setGrid] = useState(true);
  const [quickFor, setQuickFor] = useState<string | null>(null);

  const spotName = (id: string) => spots.find((s) => s.id === id)?.name ?? '—';
  const roomName = (id: string) => spots.find((s) => s.id === id)?.room ?? '—';

  const sorted = useMemo(() => {
    const arr = [...plants];
    switch (sort) {
      case 'Score':
        return arr.sort((a, b) => a.score - b.score);
      case 'Room':
        return arr.sort((a, b) => roomName(a.spotId).localeCompare(roomName(b.spotId)));
      case 'Recent':
        return arr.sort((a, b) => a.addedDaysAgo - b.addedDaysAgo);
      default:
        return arr.sort((a, b) => {
          const ua = a.forecast.criticalInDays ?? a.forecast.warnInDays ?? 99;
          const ub = b.forecast.criticalInDays ?? b.forecast.warnInDays ?? 99;
          return ua - ub;
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plants, sort]);

  // Sensorless status = the honest watering cycle, not a fabricated action.
  const statusLine = (p: Plant) => estimateWaterSchedule(p).whenLabel;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text style={[type.screenTitle, { color: dark.ink }]}>Garden</Text>
        <Text style={[type.caption, { color: dark.inkMuted }]}>{plants.length} plants</Text>
      </View>

      {/* sort + view controls */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 }}>
        {SORTS.map((s) => (
          <Pressable
            key={s}
            onPress={() => setSort(s)}
            style={{
              minHeight: 44,
              justifyContent: 'center',
              paddingHorizontal: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: sort === s ? accent.verdant : dark.hairline,
            }}
          >
            <Text style={[type.micro, { color: sort === s ? dark.ink : dark.inkMuted }]}>{s}</Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => setGrid(!grid)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={grid ? 'list-outline' : 'grid-outline'} size={20} color={dark.inkMuted} />
        </Pressable>
      </View>

      {plants.length === 0 && (
        <Card style={{ alignItems: 'center', paddingVertical: 40, marginTop: 16 }}>
          <Text style={{ fontSize: 40 }}>🌿</Text>
          <Text style={[type.body, { color: dark.inkMuted, marginTop: 10 }]}>Add your first plant</Text>
          <GButton title="Add plant" onPress={() => router.push('/add-plant')} style={{ marginTop: 14 }} />
        </Card>
      )}

      {/* grid (2-wide) or list */}
      <View
        style={{
          flexDirection: grid ? 'row' : 'column',
          flexWrap: 'wrap',
          gap: 10,
          marginTop: 16,
        }}
      >
        {sorted.map((p) => {
          const v = vitality(p);
          const at = attention(p);
          const noScore = v.awaiting || v.pending;
          return (
          <Card
            key={p.id}
            onPress={() => router.push(`/plant/${p.id}`)}
            style={grid ? { width: '48%', alignItems: 'center' } : undefined}
          >
            <Pressable
              onLongPress={() => setQuickFor(quickFor === p.id ? null : p.id)}
              onPress={() => router.push(`/plant/${p.id}`)}
              style={{ alignItems: grid ? 'center' : 'flex-start', width: '100%' }}
            >
              <View style={{ flexDirection: grid ? 'column' : 'row', alignItems: 'center', gap: grid ? 10 : 14, width: '100%' }}>
                <Breathing enabled={!noScore && v.score >= 85}>
                  <VitalityRing score={noScore ? 0 : v.score} size={84} estimate={v.estimate} estimateBand={v.estimateBand} showLabel={false}>
                    <PlantAvatar photoUri={p.photoUri} emoji={p.emoji} size={58} />
                  </VitalityRing>
                </Breathing>
                <View style={{ alignItems: grid ? 'center' : 'flex-start', flex: grid ? undefined : 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' }}>
                    <Text
                      style={[type.cardTitle, { color: dark.ink, fontSize: 18, flexShrink: 1 }]}
                      numberOfLines={1}
                    >
                      {p.name}
                    </Text>
                    {(v.sensored || p.sensorId) && <Ionicons name="hardware-chip-outline" size={12} color={accent.sage} />}
                    {p.watchMode && <Ionicons name="pulse-outline" size={12} color={accent.sunbeam} />}
                  </View>
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 1 }]} numberOfLines={1}>
                    {spotName(p.spotId)}
                  </Text>
                  {/*
                    THE SCORE, COLOURED BY WHAT IT MEANS. A good score was picked
                    out in green and everything else — 84 and 24 alike — rendered
                    in the same muted grey as the room name. So the one card on
                    the page that needed to catch the eye was the one drawn most
                    quietly, and the colour carried no information below 85.
                  */}
                  <Text
                    style={[
                      type.numHero as any,
                      { fontSize: 26, marginTop: 6, color: noScore ? dark.inkMuted : scoreColor(v.score) },
                    ]}
                  >
                    {noScore ? 'N/A' : v.score}
                    {v.estimate && <Text style={[type.micro, { color: dark.inkMuted }]}> ±{v.estimateBand}</Text>}
                  </Text>

                  {/* What to DO about it — the same verdict the first tab sorts on. */}
                  {at.level !== 'fine' && (
                    <View
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5,
                        paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
                        backgroundColor: `${levelColor(at.level)}22`,
                      }}
                    >
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: levelColor(at.level) }} />
                      <Text style={[type.micro, { color: levelColor(at.level) }]} numberOfLines={1}>
                        {at.label}
                      </Text>
                    </View>
                  )}

                  <Text
                    style={[
                      type.caption,
                      {
                        marginTop: 4,
                        textAlign: grid ? 'center' : 'left',
                        color: noScore ? dark.inkMuted : v.score >= 85 ? accent.sage : dark.inkMuted,
                      },
                    ]}
                    numberOfLines={2}
                  >
                    {v.awaiting
                      ? 'Awaiting first reading'
                      : v.sensored
                        ? v.word
                        : v.pending
                          ? `Building baseline · ${statusLine(p)}`
                          : statusLine(p)}
                  </Text>
                </View>
              </View>
            </Pressable>

            {/* long-press quick actions */}
            {quickFor === p.id && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                {/* Three amounts instead of one "log water" button.
                    A single button had to assume an amount, and an assumed
                    amount can never calibrate the pot — so the quick action was
                    structurally incapable of teaching the app anything. Naming
                    the amount costs the same one tap and turns every watering
                    into a measurement. */}
                {[
                  { label: 'Half', factor: 0.5 },
                  { label: `${waterAmount(p).ml} ml`, factor: 1 },
                  { label: 'Double', factor: 2 },
                ].map((o) => {
                  const ml = Math.max(25, Math.round((waterAmount(p).ml * o.factor) / 25) * 25);
                  return (
                    <GButton
                      key={o.label}
                      title={o.label}
                      kind="secondary"
                      style={{ flex: 1, minHeight: 44 }}
                      onPress={() => {
                        logWaterAmount(p.id, ml, {
                          suggestedMl: waterAmount(p).ml,
                          source: 'preset',
                        });
                        setQuickFor(null);
                      }}
                    />
                  );
                })}
                {p.sensorId && (
                  <GButton
                    title="Sensor"
                    kind="secondary"
                    style={{ flex: 1, minHeight: 44 }}
                    onPress={() => router.push(`/sensor/${p.sensorId}`)}
                  />
                )}
              </View>
            )}
          </Card>
          );
        })}
      </View>
    </Screen>
  );
}
