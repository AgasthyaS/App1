import { Ionicons } from '@expo/vector-icons';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Redirect, Tabs, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { accent, dark, type } from '@/constants/theme';
import { useGreenr } from '@/lib/store';

/** §3 — Forecast · Garden · (+) · Home · You, center (+) raised Verdant. */

const TABS: { name: string; label: string; icon: string; iconActive: string }[] = [
  { name: 'index', label: 'Forecast', icon: 'trending-up-outline', iconActive: 'trending-up' },
  { name: 'garden', label: 'Garden', icon: 'leaf-outline', iconActive: 'leaf' },
  { name: 'home', label: 'Home', icon: 'grid-outline', iconActive: 'grid' },
  { name: 'you', label: 'You', icon: 'person-circle-outline', iconActive: 'person-circle' },
];

function GreenrTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const renderTab = (tabName: string) => {
    const routeIndex = state.routes.findIndex((r) => r.name === tabName);
    const route = state.routes[routeIndex];
    const meta = TABS.find((t) => t.name === tabName)!;
    const active = state.index === routeIndex;
    return (
      <Pressable
        key={tabName}
        onPress={() => navigation.navigate(route.name)}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 56 }}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={meta.label}
      >
        <Ionicons
          name={(active ? meta.iconActive : meta.icon) as any}
          size={24}
          color={active ? accent.verdant : dark.inkMuted}
        />
        <Text style={[type.micro, { color: active ? accent.verdant : dark.inkMuted, marginTop: 2 }]}>
          {meta.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: dark.surface1,
        borderTopWidth: 1,
        borderTopColor: dark.hairline,
        paddingBottom: insets.bottom,
        alignItems: 'center',
      }}
    >
      {renderTab('index')}
      {renderTab('garden')}
      <Pressable
        onPress={() => router.push('/add-sheet')}
        accessibilityRole="button"
        accessibilityLabel="Add"
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: accent.verdant,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: -14,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Ionicons name="add" size={26} color="#FFFFFF" />
      </Pressable>
      {renderTab('home')}
      {renderTab('you')}
    </View>
  );
}

export default function TabsLayout() {
  const { onboarded, profile, hydrated } = useGreenr();
  if (hydrated && !profile) return <Redirect href="/signin" />;
  if (hydrated && !onboarded) return <Redirect href="/onboarding" />;

  return (
    <Tabs
      tabBar={(props) => <GreenrTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: dark.bg } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="garden" />
      <Tabs.Screen name="home" />
      <Tabs.Screen name="you" />
    </Tabs>
  );
}
