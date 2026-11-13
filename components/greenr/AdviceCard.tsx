import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import type { SensorCalibration } from '@/lib/calibration';
import type { Reading } from '@/lib/devices';
import { gradeLabel, recommendationFor, type EvidenceGrade, type RecommendationState } from '@/lib/recommendation';
import type { Plant } from '@/lib/types';

/**
 * What Greenr advises for this plant right now, and what that advice rests on.
 *
 * Collapsed, it is one line and a grade. Opened, it walks the chain the answer
 * came down — what was measured, what was worked out from it, how the substrate
 * and the species shift it, what this pot's own history adds — and then lists
 * the nine checks behind the grade, met or not. The point is that someone can
 * see WHY, and see which missing piece would make the answer better.
 */

const LOOK: Record<RecommendationState, { icon: string; tint: () => string }> = {
  'water-now': { icon: 'water', tint: () => accent.clay },
  retry: { icon: 'refresh', tint: () => accent.clay },
  waiting: { icon: 'time', tint: () => dark.inkMuted },
  drying: { icon: 'trending-down', tint: () => accent.sunbeam },
  'in-range': { icon: 'checkmark-circle', tint: () => accent.sage },
  'too-wet': { icon: 'rainy', tint: () => accent.sunbeam },
  'not-draining': { icon: 'alert-circle', tint: () => accent.clay },
  inconsistent: { icon: 'pulse', tint: () => accent.sunbeam },
  'insufficient-data': { icon: 'hourglass', tint: () => dark.inkMuted },
};

const GRADE_TINT: Record<EvidenceGrade, () => string> = {
  high: () => accent.sage,
  moderate: () => accent.verdant,
  low: () => accent.sunbeam,
  none: () => dark.inkMuted,
};

const STEPS: [key: 'measured' | 'calculated' | 'substrate' | 'plant' | 'history' | 'why' | 'reliability', label: string][] = [
  ['measured', 'Measured'],
  ['calculated', 'Worked out'],
  ['substrate', 'The substrate'],
  ['plant', 'This plant'],
  ['history', 'This pot’s history'],
  ['why', 'So'],
  ['reliability', 'How sure'],
];

export default function AdviceCard({ plant, reading, history, calibration, sensorKey }: {
  plant: Plant;
  /** calibration-corrected */
  reading: Reading | null;
  history: Reading[];
  calibration: SensorCalibration | null;
  /** id to open the calibration screen with, when there is a sensor */
  sensorKey?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rec = useMemo(
    () => recommendationFor({ plant, reading, history, calibration }),
    [plant, reading, history, calibration],
  );
  const look = LOOK[rec.state];
  const tint = look.tint();
  const met = rec.evidence.filter((e) => e.met).length;
  const unmet = (k: string) => rec.evidence.find((e) => e.key === k)?.met === false;

  return (
    <Card style={{ marginTop: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: `${tint}22` }}>
          <Ionicons name={look.icon as any} size={19} color={tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.cardTitle, { color: dark.ink }]}>{rec.headline}</Text>
          {rec.action ? <Text style={[type.body, { color: dark.inkMuted, marginTop: 3 }]}>{rec.action}</Text> : null}
        </View>
      </View>

      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide the reasoning' : 'Show the reasoning'}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginTop: 8 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: GRADE_TINT[rec.grade]() }}>
          {/* nine dots: the checklist at a glance */}
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {rec.evidence.map((e) => (
              <View key={e.key} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: e.met ? GRADE_TINT[rec.grade]() : dark.hairline }} />
            ))}
          </View>
          <Text style={[type.micro, { color: GRADE_TINT[rec.grade]() }]}>{gradeLabel(rec.grade)}</Text>
        </View>
        <Text style={[type.caption, { color: dark.inkMuted, flex: 1 }]}>{met} of {rec.evidence.length} checks</Text>
        <Text style={[type.caption, { color: accent.verdant }]}>{open ? 'Hide' : 'Why?'}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={accent.verdant} />
      </Pressable>

      {open && (
        <View style={{ marginTop: 4 }}>
          {STEPS.map(([key, label], i) => (
            <View key={key} style={{ flexDirection: 'row', gap: 10 }}>
              {/* the rail: a dot per step, joined */}
              <View style={{ alignItems: 'center', width: 12 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: key === 'why' ? tint : dark.inkMuted }} />
                {i < STEPS.length - 1 && <View style={{ flex: 1, width: 1, backgroundColor: dark.hairline }} />}
              </View>
              <View style={{ flex: 1, paddingBottom: 12 }}>
                <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.4 }]}>{label.toUpperCase()}</Text>
                <Text style={[type.caption, { color: dark.ink, lineHeight: 19, marginTop: 1 }]}>{rec.explain[key]}</Text>
              </View>
            </View>
          ))}

          <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.4, marginTop: 4 }]}>WHAT THE GRADE COUNTS</Text>
          {rec.evidence.map((e) => (
            <View key={e.key} style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Ionicons
                name={e.met ? 'checkmark-circle' : 'ellipse-outline'}
                size={16}
                color={e.met ? accent.sage : dark.inkMuted}
                style={{ marginTop: 1 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={[type.caption, { color: dark.ink }]}>
                  {e.label}{e.required ? ' · required' : ''}
                </Text>
                <Text style={[type.micro, { color: dark.inkMuted, lineHeight: 16 }]}>{e.detail}</Text>
              </View>
            </View>
          ))}
          <Text style={[type.micro, { color: dark.inkMuted, lineHeight: 16, marginTop: 10 }]}>
            The grade counts how much of this is measured rather than assumed. It is not a probability, and a
            well-founded answer can still be wrong.
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {unmet('substrate') && (
              <Chip label="Say what it’s potted in" onPress={() => router.push({ pathname: '/substrate/[id]', params: { id: plant.id } } as any)} />
            )}
            {unmet('own-range') && sensorKey && (
              <Chip label="Calibrate this sensor" onPress={() => router.push(`/calibrate/${sensorKey}` as any)} />
            )}
          </View>
        </View>
      )}
    </Card>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center',
        borderWidth: 1, borderColor: accent.verdant, opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={[type.caption, { color: accent.verdant }]}>{label}</Text>
    </Pressable>
  );
}
