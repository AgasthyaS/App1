import { accent, bandFor, dark } from '@/constants/theme';
import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * The Vitality Ring (§1.4): circular gauge, round caps, 40° gap at the
 * bottom. Fill sweeps clockwise from the left cap, 0–100. Estimate mode
 * renders the stroke dashed with a ± band under the score.
 */

const GAP_DEG = 40; // centered at the bottom
const START = 90 + GAP_DEG / 2; // left cap angle (screen degrees, cw from +x)
const SWEEP = 360 - GAP_DEG;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, sweepDeg: number) {
  const a = polar(cx, cy, r, fromDeg);
  const b = polar(cx, cy, r, fromDeg + sweepDeg);
  const large = sweepDeg > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

export interface VitalityRingProps {
  score: number;
  size: 120 | 72 | 56 | 28 | number;
  estimate?: boolean;
  estimateBand?: number;
  /** show the score + band word in the center (off for 28pt inline rings) */
  showLabel?: boolean;
  /** override band word line, e.g. "Stable (estimate)" */
  subLabel?: string;
  trackColor?: string;
  children?: React.ReactNode; // e.g. a plant photo circle behind the label
}

export function ringColor(score: number): string {
  // 70–84 is a sage→sunbeam gradient band in the spec; a single blended
  // stop keeps the SVG simple while preserving the band read.
  if (score >= 85) return accent.sage;
  if (score >= 70) return '#B3A04A'; // sage→sunbeam midpoint
  if (score >= 50) return accent.sunbeam;
  return accent.clay;
}

export default function VitalityRing({
  score,
  size,
  estimate,
  estimateBand = 0,
  showLabel,
  subLabel,
  trackColor = dark.hairline,
  children,
}: VitalityRingProps) {
  const stroke = Math.max(2, size * 0.08);
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const clamped = Math.max(0, Math.min(100, score));
  const fillSweep = (clamped / 100) * SWEEP;
  const color = ringColor(clamped);
  const dash = estimate ? [stroke * 1.2, stroke * 0.9] : undefined;
  const label = showLabel ?? size >= 56;
  const band = bandFor(clamped);

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        estimate
          ? `Vitality ${clamped}, plus-minus ${estimateBand}, ${band.word}, estimated`
          : `Vitality ${clamped}, ${band.word}, measured`
      }
    >
      {children}
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Path
          d={arcPath(cx, cy, r, START, SWEEP)}
          stroke={trackColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={dash}
        />
        {fillSweep > 1 && (
          <Path
            d={arcPath(cx, cy, r, START, fillSweep)}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={dash}
          />
        )}
      </Svg>
      {label && (
        <View style={{ alignItems: 'center' }}>
          <Text
            style={{
              fontFamily: 'Inter_700Bold',
              fontVariant: ['tabular-nums'],
              fontSize: size * 0.26,
              color: dark.ink,
            }}
          >
            {clamped}
            {estimate && estimateBand > 0 && (
              <Text style={{ fontSize: size * 0.13, color: dark.inkMuted }}>
                {' '}±{estimateBand}
              </Text>
            )}
          </Text>
          {size >= 72 && (
            <Text
              style={{
                fontFamily: 'Inter_500Medium',
                fontSize: 11,
                color: dark.inkMuted,
                marginTop: 1,
              }}
              numberOfLines={1}
            >
              {subLabel ?? band.word}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
