import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, GButton, Hairline, Screen } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, dark, type } from '@/constants/theme';
import { dliWord } from '@/lib/format';
import { useGreenr } from '@/lib/store';
import { Spot } from '@/lib/types';

/**
 * Scan in store (§7.4, Plus): species ID → instant verdict against the
 * user's real mapped spots. "Buy it for that sill or not at all."
 */

const CANDIDATES = [
  { name: 'Fiddle-leaf fig', latin: 'Ficus lyrata', emoji: '🌳', target: 5 },
  { name: 'Calathea', latin: 'Goeppertia orbifolia', emoji: '🪴', target: 2.5 },
  { name: 'Lavender', latin: 'Lavandula angustifolia', emoji: '💜', target: 14 },
];

function fitAt(spot: Spot, target: number): number {
  const ratio = Math.min(spot.dli / target, 1.4);
  return Math.round(Math.max(15, Math.min(98, 100 * (1 - Math.abs(1 - ratio) * 0.85))));
}

export default function StoreScanner() {
  const router = useRouter();
  const { spots, plants } = useGreenr();
  const [step, setStep] = useState<'camera' | 'analyzing' | 'verdict'>('camera');
  const [pick, setPick] = useState(CANDIDATES[0]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (step !== 'analyzing') return;
    const t = setTimeout(() => setStep('verdict'), 2200);
    return () => clearTimeout(t);
  }, [step]);

  if (spots.length === 0) {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center' }}>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>
          Map a spot first.
        </Text>
        <Text style={[type.body, { color: dark.inkMuted, marginTop: 10, lineHeight: 22 }]}>
          The scanner judges a plant against your real spots — measure at least one and come back.
        </Text>
        <GButton title="Back" kind="secondary" onPress={() => router.back()} style={{ marginTop: 20 }} />
      </Screen>
    );
  }

  if (step === 'camera') {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center' }}>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Scan in store</Text>
        <Text style={[type.caption, { color: dark.inkMuted, marginTop: 6 }]}>
          Point at the plant you&apos;re tempted by. (Pick one to simulate.)
        </Text>
        <View style={{ marginTop: 16, gap: 10 }}>
          {CANDIDATES.map((c) => (
            <Card
              key={c.name}
              onPress={() => {
                setPick(c);
                setStep('analyzing');
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}
            >
              <Text style={{ fontSize: 30 }}>{c.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[type.cardTitle, { color: dark.ink }]}>{c.name}</Text>
                <Text style={[type.caption, { color: dark.inkMuted, fontStyle: 'italic' }]}>{c.latin}</Text>
              </View>
              <Ionicons name="scan-outline" size={20} color={accent.verdant} />
            </Card>
          ))}
        </View>
        <Pressable onPress={() => router.back()} style={{ alignSelf: 'center', marginTop: 16, minHeight: 44, justifyContent: 'center' }}>
          <Text style={[type.body, { color: dark.inkMuted }]}>Cancel</Text>
        </Pressable>
      </Screen>
    );
  }

  if (step === 'analyzing') {
    return (
      <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <VitalityRing score={55} size={72} showLabel={false} />
        <Text style={[type.body, { color: dark.inkMuted, marginTop: 20 }]}>
          Checking {pick.name} against your {spots.length} mapped spots…
        </Text>
      </Screen>
    );
  }

  const ranked = spots
    .map((s) => ({ spot: s, fit: fitAt(s, pick.target) }))
    .sort((a, b) => b.fit - a.fit);
  const best = ranked[0];
  const occupied = plants.some((p) => !p.archived && p.spotId === best.spot.id);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <Text style={{ fontSize: 34 }}>{pick.emoji}</Text>
        <View>
          <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>{pick.name}</Text>
          <Text style={[type.caption, { color: dark.inkMuted, fontStyle: 'italic' }]}>{pick.latin}</Text>
        </View>
      </View>

      <Card elevated style={{ marginTop: 16 }}>
        {best.fit >= 70 ? (
          <Text style={[type.body, { color: dark.ink, lineHeight: 22 }]}>
            Thrives on the{' '}
            <Text style={{ color: accent.sage }}>
              {best.spot.name.toLowerCase()} ({best.fit})
            </Text>
            {ranked.filter((r) => r.fit >= 70).length === 1
              ? ' · struggles everywhere else you’ve mapped. Buy it for that spot or not at all.'
              : '.'}
            {occupied ? ' That spot is currently occupied.' : ''}
          </Text>
        ) : (
          <Text style={[type.body, { color: dark.ink, lineHeight: 22 }]}>
            Struggles everywhere you&apos;ve mapped — best fit is only {best.fit} at the{' '}
            {best.spot.name.toLowerCase()}. Leave it on the shelf.
          </Text>
        )}
      </Card>

      <Card style={{ marginTop: 10 }}>
        {ranked.map(({ spot, fit }, i) => (
          <View key={spot.id}>
            {i > 0 && <Hairline style={{ marginVertical: 8 }} />}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { color: dark.ink }]}>{spot.name}</Text>
                <Text style={[type.micro, { color: dark.inkMuted }]}>
                  {spot.dli.toFixed(1)} DLI — {dliWord(spot.dli)}
                </Text>
              </View>
              <Text style={[type.numBold as any, { fontSize: 16, color: fit >= 70 ? accent.sage : dark.inkMuted }]}>
                {fit}
              </Text>
            </View>
          </View>
        ))}
      </Card>

      {best.fit >= 70 && (
        <GButton
          title={saved ? 'Saved to wishlist ✓' : `Wishlist it — reserve the ${best.spot.name.toLowerCase()}`}
          kind={saved ? 'secondary' : 'primary'}
          onPress={() => setSaved(true)}
          style={{ marginTop: 16 }}
        />
      )}
      <GButton title="Done" kind="secondary" onPress={() => router.back()} style={{ marginTop: 10 }} />
    </Screen>
  );
}
