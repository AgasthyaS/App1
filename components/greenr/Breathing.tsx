import React, { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/**
 * Gentle breathing for thriving plants (§1.5-adjacent): a slow 1↔1.02 scale
 * loop. Subtle enough to read as life, not motion.
 */
export default function Breathing({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (enabled) {
      scale.value = withRepeat(
        withTiming(1.025, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
    } else {
      scale.value = withTiming(1, { duration: 200 });
    }
  }, [enabled, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
