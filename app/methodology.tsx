import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, Screen, SectionHeader } from '@/components/greenr/UI';
import { dark, type } from '@/constants/theme';

/** "How Greenr calculates" (§11 About) — every formula published, in-app. */

/**
 * Plain-language principles only — the exact weights, formulas, and model
 * internals are Greenr's recipe and stay out of the app.
 */
const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'The Vitality Score',
    body: 'A 0–100 read of how your plant is doing, blended from five signals: hydration, light, climate, care consistency, and its recent trend. Each species weighs them differently — a fern forgives dim light; a tomato does not.',
  },
  {
    title: 'Where the numbers come from',
    body: 'With a Greenr Sensor: real readings from the soil, on your calibration. Without one: a model built from your pot, species, spot, and logged care. Modeled numbers always carry a ± band and say "estimate" — they are educated guesses, and we label them as such.',
  },
  {
    title: 'Forecasts',
    body: 'Greenr learns how fast each plant drinks and projects it forward, adjusted for the weather ahead. Predictions can be wrong — every one is checked against what actually happened in your Accuracy Ledger, misses included.',
  },
  {
    title: 'Advice',
    body: 'Watering advice includes an exact amount, sized to your pot. Light, humidity, and heat advice comes from comparing your spot to what the species wants.',
  },
  {
    title: 'What we keep private',
    body: 'The exact formulas, weights, and models are Greenr\'s recipe and stay ours. What you always get: the inputs behind any number, the honesty labels on estimates, and a public record of our forecast accuracy.',
  },
];

export default function Methodology() {
  const router = useRouter();
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>How Greenr calculates</Text>
      </View>
      {SECTIONS.map((s) => (
        <View key={s.title}>
          <SectionHeader>{s.title}</SectionHeader>
          <Card>
            <Text style={[type.body, { color: dark.ink, lineHeight: 22 }]}>{s.body}</Text>
          </Card>
        </View>
      ))}
    </Screen>
  );
}
