import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GButton, Hairline } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { useGreenr } from '@/lib/store';

/**
 * The Plus half-sheet (§10): feature list, price toggle, restore. One-tap
 * dismiss. No countdown timers, no fake discounts.
 */
export default function PlusSheet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings, setPlus } = useGreenr();
  const [yearly, setYearly] = useState(true);

  const features = [
    'Forecasts beyond 48 h and crisis prediction',
    'Full history + ribbons beyond 7 days',
    'Diagnostics and autopsies',
    'Unlimited plants and spots',
    'Placement deltas + store scanner',
    'Accuracy ledger detail · CSV export',
  ];

  return (
    <Pressable style={{ flex: 1, backgroundColor: '#00000088' }} onPress={() => router.back()}>
      <View style={{ flex: 1 }} />
      <Pressable
        onPress={(e) => e.stopPropagation()}
        style={{
          backgroundColor: dark.surface2,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: insets.bottom + 16,
        }}
      >
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: dark.hairline, alignSelf: 'center', marginBottom: 14 }} />
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Greenr+</Text>

        {settings.plus ? (
          <>
            <Text style={[type.body, { color: dark.ink, marginTop: 12 }]}>
              Plus is active on this account.
            </Text>
            <GButton title="Done" onPress={() => router.back()} style={{ marginTop: 20 }} />
          </>
        ) : (
          <>
            <View style={{ marginTop: 14, gap: 8 }}>
              {features.map((f) => (
                <Text key={f} style={[type.body, { color: dark.ink }]}>
                  · {f}
                </Text>
              ))}
            </View>
            <Hairline style={{ marginVertical: 16 }} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {(
                [
                  [false, '$4.99 / month'],
                  [true, '$39.99 / year'],
                ] as [boolean, string][]
              ).map(([isYearly, label]) => (
                <Pressable
                  key={label}
                  onPress={() => setYearly(isYearly)}
                  style={{
                    flex: 1,
                    minHeight: 52,
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: dark.surface1,
                    borderWidth: 2,
                    borderColor: yearly === isYearly ? accent.verdant : dark.hairline,
                  }}
                >
                  <Text style={[type.body, { color: dark.ink }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <GButton
              title="Continue"
              onPress={() => {
                setPlus(true);
                router.back();
              }}
              style={{ marginTop: 14 }}
            />
            <Pressable onPress={() => router.back()} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
              <Text style={[type.caption, { color: dark.inkMuted }]}>Restore purchases</Text>
            </Pressable>
          </>
        )}
      </Pressable>
    </Pressable>
  );
}
