import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { checksByFormula, runFormulaChecks } from '@/lib/formulaCheck';

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
  const [open, setOpen] = useState(false);
  // Pure and deterministic, so it is safe to run on render.
  const report = useMemo(() => runFormulaChecks(), []);
  const groups = useMemo(() => checksByFormula(report), [report]);
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

      {/*
        THE ARITHMETIC, CHECKING ITSELF.

        Every figure on every screen is the end of a chain of physics, and a
        transposed coefficient anywhere in it still produces a plausible number
        of millilitres. So each formula is checked here against a value published
        somewhere other than this codebase — saturation vapour pressure at 20 °C
        is 2.3388 kPa in every physics table ever printed — and against the
        relationships it must satisfy for ANY input: water content falls as
        suction rises, doubling a pot's diameter quadruples its volume, an
        inverse inverts.

        It runs on this device, now, with no model and no network involved, so it
        gives the same verdict every time. That is what makes it a check rather
        than an opinion.
      */}
      <SectionHeader>The maths, checked</SectionHeader>
      <Card accentBorder={report.sound ? accent.sage : accent.clay}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons
            name={report.sound ? 'shield-checkmark-outline' : 'alert-circle-outline'}
            size={18}
            color={report.sound ? accent.sage : accent.clay}
          />
          <Text style={[type.cardTitle, { color: dark.ink, flex: 1 }]}>
            {report.sound
              ? `All ${report.checks.length} checks pass`
              : `${report.failed} of ${report.checks.length} checks FAILED`}
          </Text>
        </View>
        <Text style={[type.body, { color: dark.inkMuted, marginTop: 8, lineHeight: 21 }]}>
          Each formula below is tested two ways: against a figure published outside this app, and
          against the relationships it has to obey whatever the inputs are. Nothing here consults a
          model or the network, so it reaches the same verdict on every device, every time.
        </Text>

        <Pressable
          onPress={() => setOpen(!open)}
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, marginTop: 4 }}
        >
          <Text style={[type.body, { color: accent.verdant, flex: 1 }]}>
            {open ? 'Hide the workings' : 'Show all ' + report.checks.length + ' checks'}
          </Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={accent.verdant} />
        </Pressable>

        {open && groups.map((g) => (
          <View key={g.formula} style={{ marginTop: 12 }}>
            <Text style={[type.caption, { color: dark.ink }]}>{g.formula}</Text>
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, lineHeight: 15 }]}>{g.source}</Text>
            {g.checks.map((c) => (
              <View key={c.id} style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                <Ionicons
                  name={c.passed ? 'checkmark-circle' : 'close-circle'}
                  size={14}
                  color={c.passed ? accent.sage : accent.clay}
                  style={{ marginTop: 2 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[type.micro, { color: dark.ink, lineHeight: 16 }]}>{c.statement}</Text>
                  {c.got != null && c.expected != null && (
                    <Text style={[type.micro, { color: dark.inkMuted, marginTop: 1 }]}>
                      computed {c.got.toPrecision(5)} · published {c.expected.toPrecision(5)}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        ))}
      </Card>
    </Screen>
  );
}
