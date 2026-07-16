import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { Card, GButton, Hairline, Screen } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, dark, type } from '@/constants/theme';
import { useGreenr } from '@/lib/store';
import { Plant, Spot } from '@/lib/types';

/**
 * Diagnose (§9.1, Plus): photo → ~4 s analysis → ranked differential with
 * evidence for AND against each finding, then a plan with one-tap add to
 * the next Care Mode. Analysis is simulated; the evidence is real plant data.
 */

type Step = 'camera' | 'analyzing' | 'findings';

interface Finding {
  name: string;
  prob: number;
  evidenceFor: string;
  evidenceAgainst: string;
}

function buildDifferential(plant: Plant, spot?: Spot): Finding[] {
  const findings: Finding[] = [];
  const rhLow = (spot?.rh ?? 55) < 50;
  const lightLow = (spot?.dli ?? 3) < 2;
  const overWet = plant.timeInRangePct < 70;

  findings.push({
    name: 'Humidity stress',
    prob: rhLow ? 78 : 12,
    evidenceFor: rhLow
      ? `RH averaged ${spot?.rh}% vs 55% floor; leaf-edge browning pattern.`
      : 'Leaf-edge browning pattern only.',
    evidenceAgainst: rhLow ? '—' : `RH averaged ${spot?.rh}% — inside the comfort band.`,
  });
  findings.push({
    name: 'Overwatering',
    prob: overWet ? 61 : 9,
    evidenceFor: overWet ? `Time in range only ${plant.timeInRangePct}% over 14 d.` : '—',
    evidenceAgainst: overWet ? '—' : `Moisture in range ${plant.timeInRangePct}% of the last 14 d.`,
  });
  findings.push({
    name: 'Light debt',
    prob: lightLow ? 54 : 8,
    evidenceFor: lightLow
      ? `${spot?.dli.toFixed(1)} DLI vs the species target — sustained deficit.`
      : '—',
    evidenceAgainst: lightLow ? '—' : `${spot?.dli.toFixed(1)} DLI meets the species target.`,
  });
  return findings.sort((a, b) => b.prob - a.prob);
}

export default function Diagnose() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { plants, spots, settings, addDiagnosis, addTasks } = useGreenr();
  const plant = plants.find((p) => p.id === id);
  const spot = spots.find((s) => s.id === plant?.spotId);
  const [step, setStep] = useState<Step>('camera');
  const [planAdded, setPlanAdded] = useState(false);

  useEffect(() => {
    if (step !== 'analyzing') return;
    const t = setTimeout(() => setStep('findings'), 4000);
    return () => clearTimeout(t);
  }, [step]);

  // Photo diagnosis is a Greenr+ feature — everyone else sees the upgrade path.
  if (!settings.plus) {
    return (
      <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 40 }}>🔍</Text>
        <Text style={[type.ritualTitle, { color: dark.ink, marginTop: 12, textAlign: 'center' }]}>
          Photo diagnosis is a Greenr+ feature
        </Text>
        <Text style={[type.body, { color: dark.inkMuted, marginTop: 10, textAlign: 'center', lineHeight: 22 }]}>
          Point the camera at a struggling plant and get a ranked differential — with the
          evidence for and against each finding — plus a care plan.
        </Text>
        <GButton title="See Greenr+" onPress={() => router.push('/plus')} style={{ marginTop: 20, alignSelf: 'stretch' }} />
        <Pressable onPress={() => router.back()} style={{ minHeight: 44, justifyContent: 'center', marginTop: 6 }}>
          <Text style={[type.body, { color: dark.inkMuted }]}>Not now</Text>
        </Pressable>
      </Screen>
    );
  }

  if (!plant) {
    return (
      <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.body, { color: dark.inkMuted }]}>Plant not found.</Text>
      </Screen>
    );
  }

  const findings = buildDifferential(plant, spot);
  const top = findings[0];

  if (step === 'camera') {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center' }}>
        <View
          style={{
            aspectRatio: 3 / 4,
            borderRadius: 24,
            backgroundColor: dark.surface2,
            alignItems: 'center',
            justifyContent: 'center',
            // web: cap the 3:4 frame so the shutter stays on screen
            ...(Platform.OS === 'web' ? { width: '100%', maxWidth: 300, alignSelf: 'center' } : null),
          }}
        >
          <Text style={{ fontSize: 84 }}>{plant.emoji}</Text>
          <Text style={[type.caption, { color: dark.inkMuted, marginTop: 10, textAlign: 'center', paddingHorizontal: 24 }]}>
            Photograph the worst leaf, then the whole plant.
          </Text>
        </View>
        <Pressable
          onPress={() => setStep('analyzing')}
          accessibilityLabel="Shutter"
          style={{
            alignSelf: 'center',
            marginTop: 24,
            width: 68,
            height: 68,
            borderRadius: 34,
            borderWidth: 4,
            borderColor: dark.ink,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: dark.ink }} />
        </Pressable>
        <Pressable onPress={() => router.back()} style={{ alignSelf: 'center', marginTop: 12, minHeight: 44, justifyContent: 'center' }}>
          <Text style={[type.body, { color: dark.inkMuted }]}>Cancel</Text>
        </Pressable>
      </Screen>
    );
  }

  if (step === 'analyzing') {
    return (
      <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <VitalityRing score={62} size={72} showLabel={false} />
        <Text style={[type.body, { color: dark.inkMuted, marginTop: 20 }]}>
          Reading the leaf against 30 days of data…
        </Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Findings</Text>
      </View>

      <Card style={{ marginTop: 14 }}>
        {findings.map((f, i) => (
          <View key={f.name}>
            {i > 0 && <Hairline style={{ marginVertical: 12 }} />}
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={[type.cardTitle, { color: dark.ink, flex: 1 }]}>{f.name}</Text>
              <Text style={[type.numBold as any, { fontSize: 17, color: i === 0 ? accent.sunbeam : dark.inkMuted }]}>
                {f.prob}%
              </Text>
            </View>
            <Text style={[type.caption, { color: dark.inkMuted, marginTop: 6, lineHeight: 18 }]}>
              For: {f.evidenceFor}
            </Text>
            <Text style={[type.caption, { color: dark.inkMuted, marginTop: 2, lineHeight: 18 }]}>
              Against: {f.evidenceAgainst}
            </Text>
          </View>
        ))}
      </Card>

      <Card style={{ marginTop: 10 }}>
        <Text style={[type.micro, { color: dark.inkMuted }]}>THE PLAN</Text>
        <Text style={[type.body, { color: dark.ink, marginTop: 8, lineHeight: 21 }]}>
          1. Move a small humidifier within 3 ft — projected RH 55%+, leaf damage stops in ~2 weeks.
        </Text>
        <Text style={[type.body, { color: dark.ink, marginTop: 6, lineHeight: 21 }]}>
          2. Trim the browned edges with clean shears — they won&apos;t recover.
        </Text>
        {planAdded ? (
          <Text style={[type.caption, { color: accent.sage, marginTop: 12 }]}>
            Added to Sunday&apos;s Care Mode.
          </Text>
        ) : (
          <GButton
            title="Add to next Care Mode"
            onPress={() => {
              addTasks([
                {
                  id: `task-dx-${Date.now()}`,
                  plantId: plant.id,
                  title: `Move a humidifier within 3 ft of the ${plant.name}`,
                  why: `${top.name} at ${top.prob}% — ${top.evidenceFor}`,
                  minutes: 5,
                  verifiable: false,
                },
              ]);
              addDiagnosis(plant.id, `Diagnosis: ${top.name} (${top.prob}%). ${top.evidenceFor}`);
              setPlanAdded(true);
            }}
            style={{ marginTop: 12 }}
          />
        )}
      </Card>

      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 12, lineHeight: 16 }]}>
        This diagnosis lands in the timeline and, with your research toggle on, the anonymized
        outcome dataset.
      </Text>
      <GButton title="Done" kind="secondary" onPress={() => router.back()} style={{ marginTop: 16 }} />
    </Screen>
  );
}

