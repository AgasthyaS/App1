import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Appearance, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { applyAppearance, currentScheme, dark } from '@/constants/theme';
import { AuthProvider } from '@/lib/auth';
import { GreenrProvider } from '@/lib/store';
import { BleGatewaySync } from '@/lib/useBleGateway';
import { ReminderSync } from '@/lib/useReminders';

export default function RootLayout() {
  // The web build is pre-rendered on a server that cannot know the viewer's
  // appearance, so nothing is drawn until the client has mounted and the palette
  // has been matched to the device. It is one frame — the same blank field the
  // font loader used to show.
  const [mounted, setMounted] = useState(false);
  // Bumped when the appearance flips, remounting the tree so every screen
  // re-reads the repainted palette (the colours are read at render time).
  const [scheme, setScheme] = useState(currentScheme());

  useEffect(() => {
    applyAppearance(Appearance.getColorScheme());
    setScheme(currentScheme());
    setMounted(true);
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      if (applyAppearance(colorScheme)) setScheme(currentScheme());
    });
    return () => sub.remove();
  }, []);

  if (!mounted) {
    return <View style={{ flex: 1, backgroundColor: dark.bg }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: dark.bg }}>
      <SafeAreaProvider>
        <AuthProvider>
          <GreenrProvider>
            <ReminderSync />
            <BleGatewaySync />
            <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
            <Stack
              key={scheme}
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: dark.bg },
                animation: 'slide_from_right',
                animationDuration: 280,
                gestureEnabled: true,
              }}
            >
              <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
              <Stack.Screen name="signin" options={{ animation: 'fade' }} />
              <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
              <Stack.Screen name="add-sheet" options={{ presentation: 'transparentModal', animation: 'slide_from_bottom' }} />
              <Stack.Screen name="plus" options={{ presentation: 'transparentModal', animation: 'slide_from_bottom' }} />
              <Stack.Screen name="you" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
              <Stack.Screen name="about" />
              <Stack.Screen name="add-plant" options={{ presentation: 'modal' }} />
              <Stack.Screen name="pair-sensor" options={{ presentation: 'modal' }} />
              <Stack.Screen name="pair-device" options={{ presentation: 'modal' }} />
              <Stack.Screen name="care-mode" options={{ presentation: 'fullScreenModal' }} />
              <Stack.Screen name="diagnose/[id]" options={{ presentation: 'modal' }} />
              <Stack.Screen name="dashboard/[id]" />
              <Stack.Screen name="growth/[id]" />
              <Stack.Screen name="climate/[id]" />
              <Stack.Screen name="autopsy/[id]" options={{ presentation: 'modal' }} />
              <Stack.Screen name="move/[id]" options={{ presentation: 'modal' }} />
              <Stack.Screen name="scan" options={{ presentation: 'modal' }} />
              <Stack.Screen name="suggest" options={{ presentation: 'modal' }} />
              <Stack.Screen name="privacy" options={{ presentation: 'modal' }} />
              <Stack.Screen name="terms" options={{ presentation: 'modal' }} />
              <Stack.Screen name="notifications" />
              <Stack.Screen name="device-health" />
              <Stack.Screen name="report" />
              <Stack.Screen name="help" />
              <Stack.Screen name="security" />
              <Stack.Screen name="household" />
            </Stack>
          </GreenrProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
