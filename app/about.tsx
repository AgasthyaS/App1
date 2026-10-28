import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListGroup, ListRow } from '@/components/greenr/Native';
import { accent, dark, layout, type } from '@/constants/theme';
import { useGreenr } from '@/lib/store';

/**
 * About — the "how do I know this is right?" pages in one place: how every
 * number is calculated, how often Greenr's forecasts came true, and the legal
 * pages. They used to be scattered across the account screen.
 */
export default function AboutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accuracy } = useGreenr();
  const hits = accuracy.filter((a) => a.hit).length;
  const pct = accuracy.length ? Math.round((hits / accuracy.length) * 100) : null;
  const version = Constants.expoConfig?.version ?? '';

  return (
    <View style={{ flex: 1, backgroundColor: dark.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: layout.margin,
          paddingTop: insets.top + 4,
          paddingBottom: insets.bottom + 40,
          width: '100%',
          maxWidth: 720,
          alignSelf: 'center',
        }}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, alignSelf: 'flex-start' }}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={24} color={accent.verdant} />
          <Text style={[type.body, { color: accent.verdant }]}>Back</Text>
        </Pressable>

        <View style={{ alignItems: 'center', marginTop: 10 }}>
          <View
            style={{
              width: 76,
              height: 76,
              borderRadius: 20,
              backgroundColor: accent.verdant,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="leaf" size={40} color="#FFFFFF" />
          </View>
          <Text style={[type.ritualTitle, { color: dark.ink, marginTop: 12 }]}>Greenr</Text>
          {version ? (
            <Text style={[type.caption, { color: dark.inkMuted, marginTop: 2 }]}>Version {version}</Text>
          ) : null}
          <Text style={[type.body, { color: dark.inkMuted, marginTop: 10, textAlign: 'center', maxWidth: 360 }]}>
            Real readings from the soil, turned into one clear answer: what your plant needs, and when.
          </Text>
        </View>

        <ListGroup header="How Greenr works">
          <ListRow
            icon="calculator"
            iconColor="#5B8DB8"
            title="How Greenr calculates"
            subtitle="Every formula, with its sources"
            onPress={() => router.push('/methodology')}
          />
          <ListRow
            icon="checkmark-done"
            iconColor={accent.sage}
            title="Forecast accuracy"
            subtitle={pct != null ? `${pct}% of ${accuracy.length} forecasts came true` : 'Fills in as forecasts resolve'}
            onPress={() => router.push('/accuracy')}
          />
        </ListGroup>

        <ListGroup header="Legal">
          <ListRow icon="hand-left" iconColor="#4F8A8B" title="Privacy policy" onPress={() => router.push('/privacy' as any)} />
          <ListRow icon="document-text" iconColor="#7D8790" title="Terms of service" onPress={() => router.push('/terms' as any)} />
        </ListGroup>
      </ScrollView>
    </View>
  );
}
