import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';

import { accent, dark, type } from '@/constants/theme';

export interface FabAction {
  icon: string; // emoji
  label: string;
  run: () => void;
}

/**
 * The plant screen's log button. Opening it should feel like the app is
 * unfolding, not popping: the button springs and rotates its + into an ×, and
 * the actions stagger upward one after another (each with its own spring), so
 * the eye follows the sequence. Closing reverses it quickly. Every press carries
 * a haptic tick so the motion is felt as well as seen.
 *
 * The page behind is NOT dimmed — the action pills are opaque and legible on
 * their own, and keeping the plant visible makes the menu feel like part of the
 * screen rather than a modal over it. A transparent full-screen catcher still
 * closes the menu on an outside tap.
 */
export function LogFab({ actions }: { actions: FabAction[] }) {
  const [open, setOpen] = useState(false);
  // Kept mounted through the closing animation so items animate out, not vanish.
  const [visible, setVisible] = useState(false);

  const progress = useRef(new Animated.Value(0)).current; // 0 closed → 1 open
  const press = useRef(new Animated.Value(0)).current; // 0 idle → 1 pressed
  const items = useRef(actions.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (open) setVisible(true);

    const stagger = actions.map((_, i) =>
      Animated.spring(items[open ? actions.length - 1 - i : i], {
        toValue: open ? 1 : 0,
        useNativeDriver: true,
        friction: 7,
        tension: 90,
      }),
    );

    Animated.parallel([
      Animated.spring(progress, {
        toValue: open ? 1 : 0,
        useNativeDriver: true,
        friction: open ? 6 : 9,
        tension: open ? 80 : 120,
      }),
      // 28 ms apart — quick enough to feel like one gesture, slow enough to read.
      Animated.stagger(open ? 28 : 18, open ? stagger : stagger.reverse()),
    ]).start(({ finished }) => {
      if (finished && !open) setVisible(false);
    });
  }, [open, actions, items, progress]);

  const toggle = () => {
    Haptics.impactAsync(open ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setOpen((o) => !o);
  };

  const choose = (a: FabAction) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setOpen(false);
    // Let the close animation start before the next screen/sheet takes over.
    setTimeout(() => a.run(), 90);
  };

  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '135deg'] });
  const scale = Animated.multiply(
    progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }),
    press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] }),
  );

  return (
    <>
      {/* Invisible catcher: tapping anywhere off the menu closes it. Deliberately
          NOT dimmed — the page stays fully visible behind the actions. */}
      {visible && (
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={toggle}
          accessibilityLabel="Close log menu"
        />
      )}

      <View style={{ alignItems: 'flex-end' }} pointerEvents="box-none">
        {visible && (
          <View style={{ marginBottom: 12, gap: 8, alignItems: 'flex-end' }}>
            {actions.map((a, i) => {
              const v = items[i];
              return (
                <Animated.View
                  key={a.label}
                  style={{
                    opacity: v,
                    transform: [
                      // Rises from behind the button and settles into place.
                      { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
                      { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) },
                    ],
                  }}
                >
                  <Pressable
                    onPress={() => choose(a)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      minHeight: 46,
                      paddingLeft: 16,
                      paddingRight: 14,
                      borderRadius: 23,
                      backgroundColor: pressed ? dark.hairline : dark.surface2,
                      borderWidth: 1,
                      borderColor: dark.hairline,
                    })}
                  >
                    <Text style={[type.body, { color: dark.ink }]}>{a.label}</Text>
                    <Text style={{ fontSize: 18 }}>{a.icon}</Text>
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
        )}

        <Animated.View style={{ transform: [{ scale }] }}>
          <Pressable
            onPress={toggle}
            onPressIn={() =>
              Animated.timing(press, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
            }
            onPressOut={() =>
              Animated.spring(press, { toValue: 0, friction: 5, tension: 200, useNativeDriver: true }).start()
            }
            accessibilityLabel={open ? 'Close log menu' : 'Log care for this plant'}
            accessibilityRole="button"
            style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: accent.verdant,
              shadowColor: '#000',
              shadowOpacity: 0.35,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              elevation: 8,
            }}
          >
            <Animated.View style={{ transform: [{ rotate }] }}>
              <Ionicons name="add" size={30} color="#08110B" />
            </Animated.View>
          </Pressable>
        </Animated.View>

        {/* The caption fades out as the menu takes over. */}
        <Animated.Text
          style={[
            type.micro,
            {
              color: dark.inkMuted,
              marginTop: 4,
              alignSelf: 'center',
              opacity: progress.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' }),
            },
          ]}
        >
          Log
        </Animated.Text>
      </View>
    </>
  );
}
