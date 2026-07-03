import { useRouter } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';

import { GButton, Screen } from '@/components/greenr/UI';
import { dark, type } from '@/constants/theme';

export default function NotFound() {
  const router = useRouter();
  return (
    <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 44 }}>🌫️</Text>
      <Text style={[type.screenTitle, { color: dark.ink, fontSize: 22, marginTop: 14 }]}>
        Nothing grows here.
      </Text>
      <Text style={[type.caption, { color: dark.inkMuted, marginTop: 8, textAlign: 'center' }]}>
        This screen isn&apos;t registered — if you just updated the app, restart the dev server.
      </Text>
      <GButton
        title="Back to Forecast"
        onPress={() => router.replace('/(tabs)')}
        style={{ marginTop: 24, alignSelf: 'stretch' }}
      />
    </Screen>
  );
}
