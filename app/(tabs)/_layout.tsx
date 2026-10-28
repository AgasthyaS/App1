import { Ionicons } from '@expo/vector-icons';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { accent, currentScheme, dark, type } from '@/constants/theme';
import { useGreenr } from '@/lib/store';
import { useResearchSync } from '@/lib/useResearchSync';

/**
 * Three tabs — Today · Plants · Rooms — in a floating glass bar, the way iOS
 * now draws its tab bar. Adding things lives in each screen's navigation bar
 * (+), and the account page opens from the avatar, so the bar is navigation
 * only. Route names stay as they were so every existing link still resolves.
 */

const TABS: { name: string; label: string; icon: string; iconActive: string }[] = [
  { name: 'index', label: 'Today', icon: 'today-outline', iconActive: 'today' },
  { name: 'plants', label: 'Plants', icon: 'leaf-outline', iconActive: 'leaf' },
  { name: 'rooms', label: 'Rooms', icon: 'home-outline', iconActive: 'home' },
];

function GlassTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingBottom: Math.max(insets.bottom, 12) }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: 420,
          paddingHorizontal: 20,
        }}
      >
        <View
          style={{
            borderRadius: 32,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: dark.cardBorder,
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 8 },
            elevation: 12,
          }}
        >
          <BlurView
            intensity={60}
            tint={currentScheme() === 'light' ? 'light' : 'dark'}
            style={{ flexDirection: 'row', padding: 6, backgroundColor: dark.glass }}
          >
            {TABS.map((meta) => {
              const routeIndex = state.routes.findIndex((r) => r.name === meta.name);
              if (routeIndex < 0) return null;
              const route = state.routes[routeIndex];
              const active = state.index === routeIndex;
              return (
                <Pressable
                  key={meta.name}
                  onPress={() => {
                    if (!active) Haptics.selectionAsync().catch(() => {});
                    navigation.navigate(route.name);
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={meta.label}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 52,
                    borderRadius: 26,
                    backgroundColor: active ? `${accent.verdant}26` : 'transparent',
                  }}
                >
                  <Ionicons
                    name={(active ? meta.iconActive : meta.icon) as any}
                    size={23}
                    color={active ? accent.verdant : dark.inkMuted}
                  />
                  <Text
                    style={[
                      type.micro,
                      { fontSize: 11, color: active ? accent.verdant : dark.inkMuted, marginTop: 2, fontWeight: active ? '600' : '500' },
                    ]}
                  >
                    {meta.label}
                  </Text>
                </Pressable>
              );
            })}
          </BlurView>
        </View>
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const { onboarded, profile, hydrated } = useGreenr();
  // Mounted here because it needs the garden AND the sensor histories, which
  // live in different places and only meet inside the tab tree. Runs a few times
  // a day, never on a user action, and fails silently by design.
  useResearchSync();
  if (hydrated && !profile) return <Redirect href="/signin" />;
  if (hydrated && !onboarded) return <Redirect href="/onboarding" />;

  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: dark.bg } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="plants" />
      <Tabs.Screen name="rooms" />
    </Tabs>
  );
}
