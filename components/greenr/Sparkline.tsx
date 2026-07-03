import { dark } from '@/constants/theme';
import React from 'react';
import { View } from 'react-native';

/**
 * 4-bar sparkline of the 14-day score trend (§4). Buckets the daily scores
 * into four bars; height encodes the bucket average.
 */
export default function Sparkline({
  trend14,
  width = 26,
  height = 14,
  color = dark.inkMuted,
}: {
  trend14: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const buckets = [0, 1, 2, 3].map((b) => {
    const slice = trend14.slice(Math.floor((b * trend14.length) / 4), Math.floor(((b + 1) * trend14.length) / 4));
    return slice.length ? slice.reduce((a, v) => a + v, 0) / slice.length : 0;
  });
  const barW = (width - 3 * 2) / 4;
  return (
    <View style={{ width, height, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
      {buckets.map((v, i) => (
        <View
          key={i}
          style={{
            width: barW,
            height: Math.max(2, (v / 100) * height),
            borderRadius: 1.5,
            backgroundColor: color,
            opacity: 0.5 + (i / 4) * 0.5, // most recent bucket reads strongest
          }}
        />
      ))}
    </View>
  );
}
