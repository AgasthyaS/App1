import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';

import { SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';

/*
 * Apple-style building blocks. These are what make a screen read like a native
 * iOS app: a large title with its accessories, inset grouped lists, disclosure
 * rows, round action buttons, a segmented control and Weather-style tiles.
 */

/** Space a scrolling tab screen leaves at the bottom so its last row clears the floating tab bar. */
export const TAB_BAR_CLEARANCE = 110;

/** Large title with an optional overline (e.g. the date) and accessories on the right. */
export function LargeTitle({
  title,
  overline,
  right,
}: {
  title: string;
  overline?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginBottom: 6 }}>
      <View style={{ flex: 1 }}>
        {overline ? (
          <Text style={[type.sectionHeader, { color: dark.inkMuted }]} numberOfLines={1}>
            {overline}
          </Text>
        ) : null}
        <Text style={[type.screenTitle, { color: dark.ink, marginTop: 2 }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {right ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 4 }}>{right}</View> : null}
    </View>
  );
}

/** A round, quiet icon button for navigation-bar accessories. */
export function NavButton({
  icon,
  onPress,
  label,
  tint,
}: {
  icon: string;
  onPress: () => void;
  label: string;
  tint?: string;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: dark.surface1,
        borderWidth: 1,
        borderColor: dark.cardBorder,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon as any} size={21} color={tint ?? accent.verdant} />
    </Pressable>
  );
}

/** The person's initial in a circle — opens the account page. */
export function AvatarButton({ name, onPress }: { name: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel="Account"
      hitSlop={6}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <LinearGradient
        colors={[accent.verdant, accent.verdantDeep]}
        style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={[type.cardTitle, { color: '#FFFFFF', fontSize: 16 }]}>
          {(name.trim().charAt(0) || 'G').toUpperCase()}
        </Text>
      </LinearGradient>
    </Pressable>
  );
}

/** Inset grouped list (iOS Settings style). Falsy children are skipped. */
export function ListGroup({
  children,
  header,
  footer,
  style,
  inset = 56,
}: {
  children: React.ReactNode;
  header?: string;
  footer?: string;
  style?: StyleProp<ViewStyle>;
  /** where the row separators start — under the text, not the icon */
  inset?: number;
}) {
  const rows = React.Children.toArray(children).filter(Boolean);
  if (rows.length === 0) return null;
  return (
    <View style={style}>
      {header ? <SectionHeader>{header}</SectionHeader> : null}
      <View
        style={{
          backgroundColor: dark.surface1,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: dark.cardBorder,
          overflow: 'hidden',
        }}
      >
        {rows.map((r, i) => (
          <View key={i}>
            {i > 0 && <View style={{ height: 1, backgroundColor: dark.hairline, marginLeft: inset }} />}
            {r}
          </View>
        ))}
      </View>
      {footer ? (
        <Text style={[type.caption, { color: dark.inkMuted, marginTop: 6, marginHorizontal: 16, lineHeight: 18 }]}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

/** Tinted rounded-square icon, as used in iOS Settings. */
export function IconTile({ icon, color, size = 30 }: { icon: string; color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.27,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon as any} size={size * 0.57} color="#FFFFFF" />
    </View>
  );
}

/** A row inside a ListGroup: icon tile, title, optional subtitle/value + chevron. */
export function ListRow({
  icon,
  iconColor,
  title,
  subtitle,
  value,
  onPress,
  danger,
  chevron = true,
  left,
  right,
  titleLines = 1,
  subtitleLines = 2,
}: {
  titleLines?: number;
  subtitleLines?: number;
  icon?: string;
  iconColor?: string;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  chevron?: boolean;
  left?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 50,
        paddingVertical: 10,
        paddingHorizontal: 14,
        backgroundColor: pressed ? dark.surface2 : 'transparent',
      })}
    >
      {left ?? (icon ? <IconTile icon={icon} color={danger ? accent.clay : iconColor ?? accent.verdant} /> : null)}
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { color: danger ? accent.clay : dark.ink }]} numberOfLines={titleLines}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[type.caption, { color: dark.inkMuted, marginTop: 1, lineHeight: 18 }]} numberOfLines={subtitleLines}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {value != null && (
        <Text style={[type.body, { color: dark.inkMuted }]} numberOfLines={1}>
          {value}
        </Text>
      )}
      {onPress && chevron && (
        <Ionicons name="chevron-forward" size={16} color={dark.inkMuted} style={{ opacity: 0.7 }} />
      )}
    </Pressable>
  );
}

/**
 * A titled section that stays folded until asked for — progressive disclosure.
 * The one-line summary says what is inside, so nobody has to open it to find out.
 */
export function Disclosure({
  icon,
  iconColor,
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  icon: string;
  iconColor?: string;
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <View style={{ marginTop: 10 }}>
      <Pressable
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onToggle();
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 60,
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: dark.cardBorder,
          backgroundColor: pressed ? dark.surface2 : dark.surface1,
        })}
      >
        <IconTile icon={icon} color={iconColor ?? accent.verdant} />
        <View style={{ flex: 1 }}>
          <Text style={[type.body, { color: dark.ink, fontWeight: '600' }]}>{title}</Text>
          {subtitle ? (
            <Text style={[type.caption, { color: dark.inkMuted, marginTop: 1 }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={dark.inkMuted} />
      </Pressable>
      {open ? <View>{children}</View> : null}
    </View>
  );
}

/** Round action button with a label underneath (Contacts / Wallet style). */
export function ActionButton({
  icon,
  label,
  onPress,
  prominent,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  prominent?: boolean;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ flex: 1, alignItems: 'center', transform: [{ scale: pressed ? 0.94 : 1 }] })}
    >
      <View
        style={{
          width: '100%',
          height: 60,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          backgroundColor: prominent ? accent.verdant : dark.surface1,
          borderWidth: 1,
          borderColor: prominent ? accent.verdant : dark.cardBorder,
        }}
      >
        <Ionicons name={icon as any} size={21} color={prominent ? '#FFFFFF' : accent.verdant} />
        <Text style={[type.micro, { color: prominent ? '#FFFFFF' : dark.ink }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

/** iOS segmented control. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          padding: 2,
          borderRadius: 10,
          backgroundColor: dark.surface2,
          borderWidth: 1,
          borderColor: dark.cardBorder,
        },
        style,
      ]}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              if (on) return;
              Haptics.selectionAsync().catch(() => {});
              onChange(o.value);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{
              flex: 1,
              minHeight: 32,
              borderRadius: 8,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? dark.surface1 : 'transparent',
              shadowColor: '#000',
              shadowOpacity: on ? 0.12 : 0,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
            }}
          >
            <Text style={[type.caption, { color: on ? dark.ink : dark.inkMuted, fontWeight: on ? '600' : '400' }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One vital-sign tile (Weather-app style): icon + label, big value, status. */
export function VitalTile({
  icon,
  label,
  value,
  status,
  tone,
  onPress,
}: {
  icon: string;
  label: string;
  value: string;
  status?: string;
  tone: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexBasis: '47%',
        flexGrow: 1,
        backgroundColor: dark.surface1,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: dark.cardBorder,
        padding: 14,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name={icon as any} size={14} color={dark.inkMuted} />
        <Text style={[type.sectionHeader, { color: dark.inkMuted, fontSize: 12 }]}>{label}</Text>
      </View>
      <Text
        style={[type.numBold as any, { color: dark.ink, fontSize: value.length > 7 ? 19 : 28, marginTop: 8, minHeight: 34 }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {status ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tone }} />
          <Text style={[type.caption, { color: dark.inkMuted, flex: 1 }]} numberOfLines={1}>
            {status}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * "Day 3 of 10 · learning your plant's rhythm" — the first ten days shown as
 * progress rather than as a missing score.
 */
export function LearningBar({
  day,
  of,
  label,
  compact,
  style,
}: {
  day: number;
  of: number;
  label?: string;
  /** a slim single-line version for list rows */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const d = Math.max(1, Math.min(of, Math.round(day)));
  if (compact) {
    return (
      <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>
        <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: dark.hairline, overflow: 'hidden' }}>
          <View style={{ width: `${(d / of) * 100}%`, height: 4, borderRadius: 2, backgroundColor: accent.verdant }} />
        </View>
        <Text style={[type.micro, { color: dark.inkMuted }]}>Day {d} of {of}</Text>
      </View>
    );
  }
  return (
    <View style={[{ gap: 6 }, style]}>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {Array.from({ length: of }, (_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 5,
              borderRadius: 3,
              backgroundColor: i < d ? accent.verdant : dark.hairline,
            }}
          />
        ))}
      </View>
      <Text style={[type.caption, { color: dark.inkMuted }]}>
        Day {d} of {of} · {label ?? 'learning your plant’s rhythm'}
      </Text>
    </View>
  );
}

/** A check circle that fills with a spring when ticked (Reminders style). */
export function CheckCircle({ done, onPress, color }: { done: boolean; onPress: () => void; color?: string }) {
  const c = color ?? accent.verdant;
  return (
    <Pressable
      onPress={() => {
        if (!done) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onPress();
      }}
      hitSlop={10}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      style={({ pressed }) => ({
        width: 28,
        height: 28,
        borderRadius: 14,
        borderWidth: 2,
        borderColor: done ? c : dark.inkMuted,
        backgroundColor: done ? c : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ scale: pressed ? 0.85 : 1 }],
      })}
    >
      {done && <Ionicons name="checkmark" size={17} color="#FFFFFF" />}
    </Pressable>
  );
}
