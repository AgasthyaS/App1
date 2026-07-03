import {
  Figtree_400Regular,
  Figtree_700Bold,
} from '@expo-google-fonts/figtree';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { dark } from '@/constants/theme';
import { GreenrProvider } from '@/lib/store';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Figtree_400Regular,
    Figtree_700Bold,
  });

  if (!fontsLoaded) {
    // splash field: Midnight Canopy, nothing else (§2.1)
    return <View style={{ flex: 1, backgroundColor: dark.bg }} />;
  }

  return (
    <SafeAreaProvider>
      <GreenrProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: dark.bg },
            animation: 'fade',
            animationDuration: 200,
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
          <Stack.Screen name="add-sheet" options={{ presentation: 'transparentModal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="plus" options={{ presentation: 'transparentModal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="add-plant" options={{ presentation: 'modal' }} />
          <Stack.Screen name="pair-sensor" options={{ presentation: 'modal' }} />
          <Stack.Screen name="care-mode" options={{ presentation: 'fullScreenModal' }} />
          <Stack.Screen name="diagnose/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="autopsy/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="move/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="scan" options={{ presentation: 'modal' }} />
        </Stack>
      </GreenrProvider>
    </SafeAreaProvider>
  );
}
