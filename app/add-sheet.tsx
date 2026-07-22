import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Hairline } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { useGreenr } from '@/lib/store';

/** The (+) sheet (§3): Add plant · Add sensor · Scan in store (Plus). */
export default function AddSheet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings } = useGreenr();

  const rows = [
    {
      icon: 'leaf-outline',
      title: 'Add plant',
      sub: 'Photo → species → first score',
      go: () => {
        router.back();
        router.push('/add-plant');
      },
    },
    {
      icon: 'sparkles-outline',
      title: 'Suggest a plant',
      sub: 'Not sure what to grow? Pick by your climate',
      go: () => {
        router.back();
        router.push('/suggest');
      },
    },
    {
      icon: 'hardware-chip-outline',
      title: 'Add sensor',
      sub: 'Scan its QR → Wi-Fi setup in-app → pick its plant',
      go: () => {
        router.back();
        router.push('/pair-device' as any);
      },
    },
    {
      icon: 'barcode-outline',
      title: 'Scan in store',
      sub: settings.plus ? 'Verdict against your mapped spots' : 'Greenr+ — verdict against your mapped spots',
      go: () => {
        router.back();
        router.push(settings.plus ? '/scan' : '/plus');
      },
    },
  ];

  return (
    <Pressable style={{ flex: 1, backgroundColor: '#00000088' }} onPress={() => router.back()}>
      <View style={{ flex: 1 }} />
      <View
        style={{
          backgroundColor: dark.surface2,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: insets.bottom + 16,
        }}
      >
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: dark.hairline, alignSelf: 'center', marginBottom: 10 }} />
        {rows.map((r, i) => (
          <View key={r.title}>
            {i > 0 && <Hairline />}
            <Pressable onPress={r.go} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64 }}>
              <Ionicons name={r.icon as any} size={22} color={accent.verdant} />
              <View style={{ flex: 1 }}>
                <Text style={[type.cardTitle, { color: dark.ink }]}>{r.title}</Text>
                <Text style={[type.caption, { color: dark.inkMuted, marginTop: 1 }]}>{r.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={dark.inkMuted} />
            </Pressable>
          </View>
        ))}
      </View>
    </Pressable>
  );
}
