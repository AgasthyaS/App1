import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, GButton, Screen } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { dliWord } from '@/lib/format';
import { useGreenr } from '@/lib/store';
import { Plant, Spot } from '@/lib/types';

/**
 * The placement engine, plant view (§7.3): every spot with a fit score and
 * the projected vitality delta. Executing the move re-baselines expectations
 * for 7 days (noted in the timeline by the store).
 */

function fitFor(plant: Plant, spot: Spot): { fit: number; delta: number } {
  // species light appetite proxied by the current component gap
  const target = plant.species === 'Snake plant' ? 2.5 : plant.species === 'Cherry tomato' ? 12 : 4;
  const ratio = Math.min(spot.dli / target, 1.4);
  const fit = Math.round(Math.max(20, Math.min(98, 100 * (1 - Math.abs(1 - ratio) * 0.8))));
  const currentLight = plant.components.light;
  const projectedLight = Math.round(25 * Math.min(spot.dli / target, 1));
  const delta = Math.max(-20, Math.min(20, projectedLight - currentLight));
  return { fit, delta };
}

export default function MoveSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { plants, spots, movePlant } = useGreenr();
  const plant = plants.find((p) => p.id === id);
  const [chosen, setChosen] = useState<string | null>(null);

  if (!plant) {
    return (
      <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.body, { color: dark.inkMuted }]}>Plant not found.</Text>
      </Screen>
    );
  }

  const ranked = spots
    .map((s) => ({ spot: s, ...fitFor(plant, s) }))
    .sort((a, b) => b.fit - a.fit);
  const goodFits = ranked.filter((r) => r.fit >= 70 && r.spot.id !== plant.spotId).length;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Move {plant.name}</Text>
          <Text style={[type.caption, { color: dark.inkMuted }]}>
            Fits {goodFits} of {spots.length - 1} other spots
          </Text>
        </View>
      </View>

      <View style={{ marginTop: 14, gap: 10 }}>
        {ranked.map(({ spot, fit, delta }) => {
          const current = spot.id === plant.spotId;
          return (
            <Card
              key={spot.id}
              onPress={() => !current && setChosen(spot.id)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                borderWidth: 2,
                borderColor: chosen === spot.id ? accent.verdant : 'transparent',
                opacity: current ? 0.55 : 1,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[type.cardTitle, { color: dark.ink }]}>
                  {spot.name}
                  {current ? '  ·  current' : ''}
                </Text>
                <Text style={[type.caption, { color: dark.inkMuted, marginTop: 2 }]}>
                  {spot.room} · {spot.dli.toFixed(1)} DLI — {dliWord(spot.dli)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[type.numBold as any, { fontSize: 17, color: fit >= 80 ? accent.sage : fit >= 60 ? dark.ink : dark.inkMuted }]}>
                  {fit}
                </Text>
                {!current && delta !== 0 && (
                  <Text style={[type.micro, { color: delta > 0 ? accent.sage : accent.sunbeam }]}>
                    projected {Math.min(100, Math.max(0, plant.score + delta))} ({delta > 0 ? '+' : ''}{delta})
                  </Text>
                )}
              </View>
            </Card>
          );
        })}
      </View>

      <GButton
        title="Plan the move"
        disabled={!chosen}
        onPress={() => {
          if (chosen) movePlant(plant.id, chosen);
          router.back();
        }}
        style={{ marginTop: 20 }}
      />
      <Text style={[type.micro, { color: dark.inkMuted, textAlign: 'center', marginTop: 10 }]}>
        The score is shielded from the transition dip for 7 days.
      </Text>
    </Screen>
  );
}

