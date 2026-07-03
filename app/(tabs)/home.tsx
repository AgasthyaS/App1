import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';

import { Card, Chip, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { dliWord } from '@/lib/format';
import { activePlants, useGreenr } from '@/lib/store';
import { Spot } from '@/lib/types';

/**
 * Home Map (§7.1): spot cards grouped by room; the light-intensity tint
 * behind each card IS the heatmap. Empty measured spots get the
 * "Best free spot" chip.
 */

function tintFor(dli: number): string {
  // deep Sage = bright → near-transparent = dim
  const a = Math.min(0.4, Math.max(0.04, dli / 12));
  return `rgba(138, 155, 110, ${a.toFixed(2)})`;
}

export default function HomeTab() {
  const router = useRouter();
  const { spots, plants } = useGreenr();

  const byRoom = useMemo(() => {
    const rooms = new Map<string, Spot[]>();
    for (const s of spots) {
      rooms.set(s.room, [...(rooms.get(s.room) ?? []), s]);
    }
    return [...rooms.entries()];
  }, [spots]);

  const occupants = (spotId: string) => activePlants(plants).filter((p) => p.spotId === spotId);
  const measured = spots.filter((s) => s.measuredBySensor).length;
  const bestFree = spots
    .filter((s) => occupants(s.id).length === 0)
    .sort((a, b) => b.dli - a.dli)[0];

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text style={[type.screenTitle, { color: dark.ink }]}>Home</Text>
        <Text style={[type.caption, { color: dark.inkMuted }]}>
          {spots.length} spots · {measured} measured by sensor
        </Text>
      </View>

      {spots.length === 0 && (
        <Card style={{ alignItems: 'center', paddingVertical: 40, marginTop: 16 }}>
          <Text style={[type.body, { color: dark.inkMuted }]}>
            Create your first spot — takes 10 seconds.
          </Text>
        </Card>
      )}

      {byRoom.map(([room, roomSpots]) => (
        <View key={room}>
          <SectionHeader>{room}</SectionHeader>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {roomSpots.map((s) => {
              const occ = occupants(s.id);
              return (
                <Card
                  key={s.id}
                  onPress={() => router.push({ pathname: '/spot/[id]', params: { id: s.id } })}
                  style={{ width: '48%', backgroundColor: dark.surface1, overflow: 'hidden' }}
                >
                  <View
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: tintFor(s.dli),
                    }}
                  />
                  <Text style={[type.cardTitle, { color: dark.ink }]} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6 }]}>
                    ☀ {s.dli.toFixed(1)} DLI
                  </Text>
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>
                    🌡 {s.tempRange[0]}–{s.tempRange[1]}°
                  </Text>
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>
                    💧 {s.rh}% RH
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
    </Screen>
  );
}
