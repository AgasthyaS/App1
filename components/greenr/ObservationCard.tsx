import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { eventDaysAgo } from '@/lib/format';
import { OBSERVATION_ICON, OBSERVATION_LABEL, OBSERVATION_ORDER, isConcern } from '@/lib/observations';
import { useGreenr } from '@/lib/store';
import type { ObservationKind, Plant } from '@/lib/types';

/**
 * "How does it look?" — the one input no sensor gives.
 *
 * A sensor reports the conditions a plant is in; only its owner can say what the
 * plant is doing about them. Two taps: what you see, and (for a problem) how
 * bad. It is recorded as what was SEEN. Greenr does not turn "yellowing" into a
 * diagnosis here — the sensor history beside it is what narrows the cause.
 */
const SEVERITY: [1 | 2 | 3, string][] = [[1, 'Slight'], [2, 'Clear'], [3, 'Severe']];

export default function ObservationCard({ plant }: { plant: Plant }) {
  const { logObservation } = useGreenr();
  const [picked, setPicked] = useState<ObservationKind | null>(null);
  const [saved, setSaved] = useState<ObservationKind | null>(null);
  const recent = (plant.observations ?? []).slice(0, 3);

  const save = (kind: ObservationKind, severity?: 1 | 2 | 3) => {
    logObservation(plant.id, { kind, severity });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setPicked(null);
    setSaved(kind);
  };

  return (
    <Card style={{ marginTop: 18 }}>
      <Text style={[type.cardTitle, { color: dark.ink }]}>How does it look?</Text>
      <Text style={[type.caption, { color: dark.inkMuted, marginTop: 2, lineHeight: 18 }]}>
        Sensors measure the conditions. Only you can see the plant. A note now and then is what lets Greenr
        tell which conditions actually suit it.
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {OBSERVATION_ORDER.map((k) => {
          const on = picked === k;
          const tint = isConcern(k) ? accent.sunbeam : accent.sage;
          return (
            <Pressable
              key={k}
              onPress={() => {
                setSaved(null);
                // Good news needs no severity; a concern asks how bad.
                if (!isConcern(k)) save(k);
                else setPicked(on ? null : k);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 12,
                borderRadius: 20, borderWidth: 1.5,
                borderColor: on ? tint : dark.hairline,
                backgroundColor: on ? `${tint}22` : 'transparent',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name={OBSERVATION_ICON[k] as any} size={15} color={on ? tint : dark.inkMuted} />
              <Text style={[type.caption, { color: dark.ink }]}>{OBSERVATION_LABEL[k]}</Text>
            </Pressable>
          );
        })}
      </View>

      {picked && (
        <View style={{ marginTop: 12 }}>
          <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.4 }]}>HOW MUCH?</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            {SEVERITY.map(([n, label]) => (
              <Pressable
                key={n}
                onPress={() => save(picked, n)}
                style={({ pressed }) => ({
                  flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: dark.surface2, borderWidth: 1, borderColor: dark.hairline, opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={[type.body, { color: dark.ink }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {saved && (
        <Text style={[type.caption, { color: accent.sage, marginTop: 10 }]}>
          Noted: {OBSERVATION_LABEL[saved].toLowerCase()}. It’s in this plant’s history.
        </Text>
      )}

      {recent.length > 0 && (
        <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: dark.hairline, paddingTop: 10, gap: 6 }}>
          {recent.map((o) => {
            const days = Math.round(eventDaysAgo({ id: o.id, at: o.at, daysAgo: 0, kind: 'insight', text: '' }));
            return (
              <View key={o.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name={OBSERVATION_ICON[o.kind] as any} size={14} color={isConcern(o.kind) ? accent.sunbeam : accent.sage} />
                <Text style={[type.caption, { color: dark.ink, flex: 1 }]}>
                  {OBSERVATION_LABEL[o.kind]}
                  {o.severity ? ` · ${SEVERITY[o.severity - 1][1].toLowerCase()}` : ''}
                </Text>
                <Text style={[type.micro, { color: dark.inkMuted }]}>{days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}</Text>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}
