import { Image } from 'expo-image';
import React from 'react';
import { Text, View } from 'react-native';

import { accent } from '@/constants/theme';

/**
 * A plant's picture: the user's photo (circle-cropped) if they took one,
 * otherwise the species emoji. Used inside Vitality Rings and cards.
 */
export default function PlantAvatar({
  photoUri,
  emoji,
  size,
  framed,
}: {
  photoUri?: string;
  emoji: string;
  size: number;
  /** draw the emoji on a soft circle, so list rows line up like photos */
  framed?: boolean;
}) {
  if (photoUri) {
    return (
      <Image
        source={{ uri: photoUri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        transition={150}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: framed ? `${accent.verdant}22` : 'transparent',
      }}
    >
      <Text style={{ fontSize: size * (framed ? 0.52 : 0.66) }}>{emoji}</Text>
    </View>
  );
}
