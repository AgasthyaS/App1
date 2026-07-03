import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, Screen, SectionHeader } from '@/components/greenr/UI';
import { dark, type } from '@/constants/theme';

/** "How Greenr calculates" (§11 About) — every formula published, in-app. */

const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Vitality Score (0–100)',
    body: 'Hydration /40 + Light /25 + Climate /15 + Consistency /10 + Trend ±10.\nEvery component row in Plant Detail expands to its inputs and arithmetic — nothing is a black box.',
  },
  {
    title: 'Hydration /40',
    body: 'Sensored: 40 × share of the last 14 days inside the species comfort band, minus 2 per over-wet day.\nManual: the same, from a drying model (pot size, material, species, weather evaporation) fitted to your logged waterings. Model uncertainty is the ± you see on the score.',
  },
  {
    title: 'Light /25',
    body: '25 × min(measured DLI ÷ species target, 1), averaged over 7 days.\nDLI comes from a sensor where present, else your 10-second phone audits.',
  },
  {
    title: 'Climate /15',
    body: '15 × share of hours inside the species temperature and humidity bands.\nIndoor spots: sensor or weather-derived estimate. Outdoor spots: local forecast.',
  },
  {
    title: 'Consistency /10',
    body: '10 × share of the last 12 weeks where care landed within a day of the forecast. Verified (sensor-seen) care counts fully; logged care counts at 0.8.',
  },
  {
    title: 'Trend ±10',
    body: 'The 14-day slope of the daily score, clamped to ±10. Rewards recovery, flags slow declines before they look bad.',
  },
  {
    title: 'Forecasts',
    body: 'Each plant\'s drying rate is fitted from its own history, adjusted for the weather ahead. The tick you see is the projected band exit; the blur is the confidence interval. Every prediction lands in the Accuracy Ledger against what actually happened — misses included.',
  },
  {
    title: 'Estimates vs. measurements',
    body: 'Dashed ring = modeled, with a ± band. Solid ring = measured by a sensor with your calibration. The app never argues the upgrade — it shows it.',
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
