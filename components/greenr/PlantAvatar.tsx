import { Image } from 'expo-image';
import React from 'react';
import { Text, View } from 'react-native';

/**
 * A plant's picture: the user's photo (circle-cropped) if they took one,
 * otherwise the species emoji. Used inside Vitality Rings and cards.
 */
export default function PlantAvatar({
  photoUri,
  emoji,
  size,
}: {
  photoUri?: string;
  emoji: string;
  size: number;
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
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.66 }}>{emoji}</Text>
    </View>
  );
}
