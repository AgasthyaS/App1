import { accent, dark, layout, light, type } from '@/constants/theme';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleProp,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Shared GREENR primitives. Dark = instrument, light = ritual (§1.1). */

export function Screen({
  children,
  mode = 'dark',
  scroll = true,
  padded = true,
  style,
}: {
  children: React.ReactNode;
  mode?: 'dark' | 'light';
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const bg = mode === 'dark' ? dark.bg : light.bg;
  const inner: StyleProp<ViewStyle> = [
    { paddingTop: insets.top + 8, paddingBottom: 32 },
    padded && { paddingHorizontal: layout.margin },
    style,
  ];
  if (!scroll) {
    return <View style={[{ flex: 1, backgroundColor: bg }, inner]}>{children}</View>;
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: bg }}
      contentContainerStyle={inner}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

export function Card({
  children,
  mode = 'dark',
  elevated,
  style,
  onPress,
  accentBorder,
}: {
  children: React.ReactNode;
  mode?: 'dark' | 'light';
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /** 2px left border color (e.g. Clay for <48h critical rows) */
  accentBorder?: string;
}) {
  const t = mode === 'dark' ? dark : light;
  const base: StyleProp<ViewStyle> = [
    {
      backgroundColor: elevated ? t.surface2 : t.surface1,
      borderRadius: layout.cardRadius,
      padding: layout.cardPadding,
      // a whisper of a border gives depth without shadows on dark (§1.3)
      borderWidth: 1,
      borderColor: mode === 'dark' ? 'rgba(255,255,255,0.05)' : t.hairline,
    },
    mode === 'light' && {
      shadowColor: '#3D2B1F',
      shadowOpacity: 0.07,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    accentBorder ? { borderLeftWidth: 2, borderLeftColor: accentBorder } : null,
    style,
  ];
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [base, pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] }]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={base}>{children}</View>;
}

export function SectionHeader({
  children,
  mode = 'dark',
  style,
}: {
  children: React.ReactNode;
  mode?: 'dark' | 'light';
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      style={[
        type.sectionHeader,
        { color: mode === 'dark' ? dark.inkMuted : light.inkMuted, marginBottom: 8, marginTop: 20 },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function GButton({
  title,
  onPress,
  kind = 'primary',
  mode = 'dark',
  style,
  disabled,
}: {
  title: string;
  onPress?: () => void;
  kind?: 'primary' | 'secondary' | 'destructive' | 'ghost';
  mode?: 'dark' | 'light';
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}) {
  const t = mode === 'dark' ? dark : light;
  const fg =
    kind === 'primary' ? '#FFFFFF' : kind === 'destructive' ? accent.clay : kind === 'ghost' ? accent.verdant : t.ink;
  const press = () => {
    Haptics.selectionAsync().catch(() => {});
    onPress?.();
  };
  const shape: ViewStyle = {
    minHeight: layout.touchTarget + 4,
    borderRadius: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  };
  if (kind === 'primary') {
    return (
      <Pressable
        onPress={press}
        disabled={disabled}
        style={({ pressed }) => [
          shape,
          { opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
          style,
        ]}
      >
        <LinearGradient
          colors={[accent.verdant, accent.verdantDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
        />
        <Text style={[type.cardTitle, { color: fg, fontSize: 16 }]}>{title}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={press}
      disabled={disabled}
      style={({ pressed }) => [
        shape,
        {
          backgroundColor: kind === 'secondary' ? t.surface2 : 'transparent',
          borderWidth: kind === 'destructive' ? 1 : kind === 'secondary' ? 1 : 0,
          borderColor: kind === 'destructive' ? accent.clay : mode === 'dark' ? 'rgba(255,255,255,0.07)' : t.hairline,
          opacity: disabled ? 0.4 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        style,
      ]}
    >
      <Text style={[type.cardTitle, { color: fg, fontSize: 16 }]}>{title}</Text>
    </Pressable>
  );
}

export function Hairline({ mode = 'dark', style }: { mode?: 'dark' | 'light'; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[{ height: 1, backgroundColor: mode === 'dark' ? dark.hairline : light.hairline }, style]}
    />
  );
}

export function Chip({
  label,
  color = dark.inkMuted,
  mode = 'dark',
}: {
  label: string;
  color?: string;
  mode?: 'dark' | 'light';
}) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: color,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={[type.micro, { color }]}>{label}</Text>
    </View>
  );
}

export function StatusDot({ status }: { status: 'online' | 'late' | 'offline' }) {
  const color =
    status === 'online' ? accent.sage : status === 'late' ? accent.sunbeam : accent.clay;
  const word = status === 'online' ? 'Online' : status === 'late' ? 'Late' : 'Offline';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={[type.caption, { color }]}>{word}</Text>
    </View>
  );
}

/** Generic settings-style row. */
export function Row({
  title,
  value,
  onPress,
  mode = 'dark',
  danger,
}: {
  title: string;
  value?: string;
  onPress?: () => void;
  mode?: 'dark' | 'light';
  danger?: boolean;
}) {
  const t = mode === 'dark' ? dark : light;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        minHeight: layout.touchTarget,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={[type.body, { color: danger ? accent.clay : t.ink }]}>{title}</Text>
      {value != null && <Text style={[type.body, { color: t.inkMuted }]}>{value}</Text>}
    </Pressable>
  );
}
