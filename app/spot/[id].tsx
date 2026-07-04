import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Card, Chip, GButton, Hairline, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { dliWord } from '@/lib/format';
import { useGreenr } from '@/lib/store';

/** Spot detail (§7.2): measured profile, light history, occupants with fit, what thrives here. */

const THRIVE_DB = [
  { name: 'Cherry tomato', emoji: '🍅', minDli: 8, maxDli: 30, outdoorOnly: true },
  { name: 'Lavender', emoji: '💜', minDli: 6, maxDli: 30, outdoorOnly: true },
  { name: 'Fiddle-leaf fig', emoji: '🌳', minDli: 4, maxDli: 8 },
  { name: 'Monstera', emoji: '🌿', minDli: 2.5, maxDli: 7 },
  { name: 'Golden pothos', emoji: '🍃', minDli: 1, maxDli: 5 },
  { name: 'Calathea', emoji: '🪴', minDli: 1.5, maxDli: 4 },
  { name: 'Boston fern', emoji: '🌱', minDli: 1, maxDli: 3.5 },
  { name: 'Snake plant', emoji: '🌵', minDli: 0.5, maxDli: 6 },
];

function fitScore(dli: number, min: number, max: number): number {
  if (dli < min) return Math.max(20, Math.round(90 - (min - dli) * 22));
  if (dli > max) return Math.max(20, Math.round(90 - (dli - max) * 10));
  return Math.round(88 + 10 * (1 - Math.abs(dli - (min + max) / 2) / ((max - min) / 2 || 1)));
}

export default function SpotDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { spots, plants } = useGreenr();
  const spot = spots.find((s) => s.id === id);

  const occupants = useMemo(
    () => plants.filter((p) => p.spotId === id && !p.archived),
    [plants, id],
  );

  const lightHistory = useMemo(() => {
    if (!spot) return '';
    // 30-day light mini-chart: gentle seasonal drift + daily noise
    const w = 300;
    const h = 48;
    let d = '';
    for (let i = 0; i <= 30; i++) {
      const x = (i / 30) * w;
      const v = spot.dli * (0.82 + 0.18 * Math.sin(i / 5) + ((i * 7919) % 13) / 90);
      const y = h - Math.min(1, v / (spot.dli * 1.3)) * h;
      d += `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
    }
    return d;
  }, [spot]);

  if (!spot) {
    return (
      <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.body, { color: dark.inkMuted }]}>Spot not found.</Text>
      </Screen>
    );
  }

  const thrives = THRIVE_DB
    .filter((t) => !t.outdoorOnly || spot.outdoor)
    .map((t) => ({ ...t, fit: fitScore(spot.dli, t.minDli, t.maxDli) }))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, 5);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>{spot.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[type.caption, { color: dark.inkMuted }]}>{spot.room}</Text>
            {spot.outdoor && <Chip label="Outdoor" color={accent.sunbeam} />}
          </View>
        </View>
      </View>

      {/* measured profile with source labels */}
      <SectionHeader>Profile</SectionHeader>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {[
            {
              value: `${spot.dli.toFixed(1)} DLI`,
              label: dliWord(spot.dli),
              src: spot.measuredBySensor ? 'from sensor' : 'estimated',
            },
            {
              value: `${spot.tempRange[0]}–${spot.tempRange[1]}°`,
              label: 'temp',
              src: spot.outdoor ? 'local forecast' : spot.measuredBySensor ? 'from sensor' : 'estimated',
            },
            {
              value: `${spot.rh}% RH`,
              label: 'humidity',
              src: spot.outdoor ? 'local forecast' : spot.measuredBySensor ? 'from sensor' : 'estimated from weather',
            },
          ].map((m) => (
            <View key={m.label} style={{ alignItems: 'center', flex: 1, paddingHorizontal: 2 }}>
              <Text
                style={[type.numBold as any, { fontSize: 16, color: dark.ink }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {m.value}
              </Text>
              <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>{m.label}</Text>
              <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, opacity: 0.7, textAlign: 'center' }]}>
                {m.src}
              </Text>
            </View>
          ))}
        </View>
        {spot.seasonalNote && (
          <>
            <Hairline style={{ marginVertical: 12 }} />
            <Text style={[type.caption, { color: accent.sunbeamText }]}>{spot.seasonalNote}</Text>
          </>
        )}
      </Card>

      {/* 30-day light history */}
      <SectionHeader>Light · 30 days</SectionHeader>
      <Card>
        <Svg width="100%" height={48} viewBox="0 0 300 48" preserveAspectRatio="none">
          <Path d={lightHistory} stroke={accent.sage} strokeWidth={2} fill="none" />
        </Svg>
      </Card>

      {/* occupants */}
      <SectionHeader>Occupants</SectionHeader>
      <Card>
        {occupants.length === 0 && (
          <Text style={[type.caption, { color: dark.inkMuted }]}>Empty — a free spot.</Text>
        )}
        {occupants.map((p, i) => (
          <View key={p.id}>
            {i > 0 && <Hairline style={{ marginVertical: 10 }} />}
            <Pressable
              onPress={() => router.push(`/plant/${p.id}`)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}
            >
              <Text style={{ fontSize: 24 }}>{p.emoji}</Text>
              <Text style={[type.body, { color: dark.ink, flex: 1 }]}>{p.name}</Text>
              <Text style={[type.num as any, { fontSize: 14, color: dark.inkMuted }]}>
                fit {fitScore(spot.dli, 1.5, 6)}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={dark.inkMuted} />
            </Pressable>
          </View>
        ))}
      </Card>

      {/* what thrives here */}
      <SectionHeader>What thrives here</SectionHeader>
      <Card>
        {thrives.map((t, i) => (
          <View key={t.name}>
            {i > 0 && <Hairline style={{ marginVertical: 10 }} />}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 22 }}>{t.emoji}</Text>
              <Text style={[type.body, { color: dark.ink, flex: 1 }]}>{t.name}</Text>
              <Text style={[type.numBold as any, { fontSize: 14, color: t.fit >= 80 ? accent.sage : dark.inkMuted }]}>
                {t.fit}
              </Text>
            </View>
          </View>
        ))}
      </Card>

      {spot.measuredBySensor ? (
        <Text style={[type.micro, { color: dark.inkMuted, textAlign: 'center', marginTop: 20 }]}>
          Light here is measured by a Greenr Sensor.
        </Text>
      ) : (
        <>
          <GButton
            title="Measure this spot exactly"
            kind="secondary"
            onPress={() => router.push('/pair-sensor')}
            style={{ marginTop: 20 }}
          />
          <Text style={[type.micro, { color: dark.inkMuted, textAlign: 'center', marginTop: 8 }]}>
            This spot&apos;s light is an estimate from your description. A Greenr Sensor reads it
            exactly.
          </Text>
        </>
      )}
    </Screen>
  );
}

