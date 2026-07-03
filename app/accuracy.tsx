import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, Hairline, Screen } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { useGreenr } from '@/lib/store';

/** The Accuracy Ledger (§11) — every prediction vs. outcome, misses included. */
export default function AccuracyLedger() {
  const router = useRouter();
  const { accuracy } = useGreenr();
  const hits = accuracy.filter((a) => a.hit).length;
  const pct = accuracy.length ? Math.round((hits / accuracy.length) * 100) : 0;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Accuracy Ledger</Text>
      </View>

      {accuracy.length === 0 ? (
        <Card style={{ marginTop: 16 }}>
          <Text style={[type.body, { color: dark.inkMuted }]}>
            The ledger fills in as forecasts resolve — every prediction against what actually
            happened, misses included.
          </Text>
        </Card>
      ) : (
        <>
          <Card style={{ marginTop: 16 }}>
            <Text style={[type.body, { color: dark.ink, lineHeight: 22 }]}>
              Greenr has been{' '}
              <Text style={[type.numBold as any, { fontSize: 15, color: dark.ink }]}>{pct}%</Text>{' '}
              accurate on your garden (±1 day, 90 d) — {hits} of {accuracy.length} predictions.
            </Text>
          </Card>
          <Card style={{ marginTop: 10 }}>
            {accuracy.map((a, i) => (
              <View key={a.id}>
                {i > 0 && <Hairline style={{ marginVertical: 12 }} />}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Ionicons
                    name={a.hit ? 'checkmark-circle-outline' : 'close-circle-outline'}
                    size={18}
                    color={a.hit ? accent.sage : accent.sunbeam}
                    style={{ marginTop: 1 }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.body, { color: dark.ink }]}>{a.plant}</Text>
                    <Text style={[type.caption, { color: dark.inkMuted, marginTop: 2 }]}>
                      Predicted: {a.predicted} · Outcome: {a.outcome}
                    </Text>
                    {a.missReason && (
                      <Text style={[type.caption, { color: accent.sunbeamText, marginTop: 2 }]}>
                        {a.missReason}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
