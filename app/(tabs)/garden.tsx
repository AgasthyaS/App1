import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import Breathing from '@/components/greenr/Breathing';
import PlantAvatar from '@/components/greenr/PlantAvatar';
import { Card, GButton, Screen } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, dark, type } from '@/constants/theme';
import { primaryAction } from '@/lib/advice';
import { activePlants, useGreenr } from '@/lib/store';
import { Plant } from '@/lib/types';

type SortKey = 'Urgency' | 'Score' | 'Room' | 'Recent';
const SORTS: SortKey[] = ['Urgency', 'Score', 'Room', 'Recent'];

export default function GardenTab() {
  const router = useRouter();
  const { plants: allPlants, spots, logWater } = useGreenr();
  const plants = activePlants(allPlants);
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

  const statusLine = (p: Plant) => (p.score >= 85 ? 'Thriving' : primaryAction(p));

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
        {sorted.map((p) => (
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
                <Breathing enabled={p.score >= 85}>
                  <VitalityRing score={p.score} size={84} estimate={p.estimate} estimateBand={p.estimateBand} showLabel={false}>
                    <PlantAvatar photoUri={p.photoUri} emoji={p.emoji} size={58} />
                  </VitalityRing>
                </Breathing>
                <View style={{ alignItems: grid ? 'center' : 'flex-start', flex: grid ? undefined : 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Text style={[type.cardTitle, { color: dark.ink, fontSize: 18 }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {p.sensorId && <Ionicons name="hardware-chip-outline" size={12} color={dark.inkMuted} />}
                    {p.watchMode && <Ionicons name="pulse-outline" size={12} color={accent.sunbeam} />}
                  </View>
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 1 }]} numberOfLines={1}>
                    {spotName(p.spotId)}
                  </Text>
                  <Text style={[type.numHero as any, { fontSize: 22, color: dark.ink, marginTop: 6 }]}>
                    {p.score}
                    {p.estimate && <Text style={[type.micro, { color: dark.inkMuted }]}> ±{p.estimateBand}</Text>}
                  </Text>
                  <Text
                    style={[
                      type.caption,
                      {
                        marginTop: 4,
                        textAlign: grid ? 'center' : 'left',
                        color: p.score >= 85 ? accent.sage : p.forecast.criticalInDays != null ? accent.sunbeam : dark.inkMuted,
                      },
                    ]}
                    numberOfLines={2}
                  >
                    {statusLine(p)}
                  </Text>
                </View>
              </View>
            </Pressable>

            {/* long-press quick actions */}
            {quickFor === p.id && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <GButton
                  title="Log water"
                  kind="secondary"
                  style={{ flex: 1, minHeight: 44 }}
                  onPress={() => {
                    logWater(p.id);
                    setQuickFor(null);
                  }}
                />
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
        ))}
      </View>
    </Screen>
  );
}
