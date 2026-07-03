import { accent, dark, type } from '@/constants/theme';
import { MoisturePoint } from '@/lib/types';
import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

/**
 * The Range Ribbon (§1.4) — CGM-style moisture chart. Comfort band renders
 * as a translucent Sage ribbon, the over-wet zone above tints translucent
 * Clay, the trace weaves through in 2pt Ink, watering events are Verdant dots.
 */

const PERIODS = [7, 14, 30, 90] as const;
const H = 160;
const PAD_TOP = 8;
const PAD_BOTTOM = 18;

export default function RangeRibbon({
  history,
  band,
  timeInRangePct,
  lockedBeyond7d,
  onLockedPress,
}: {
  history: MoisturePoint[];
  band: [number, number];
  timeInRangePct: number;
  /** free tier: history beyond 7 d is Plus (§10) */
  lockedBeyond7d?: boolean;
  onLockedPress?: () => void;
}) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(14);
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const y = (m: number) => PAD_TOP + plotH * (1 - m / 100);
  const x = (daysAgo: number) => w - (daysAgo / period) * w;

  const pts = useMemo(
    () =>
      history
        .filter((p) => p.daysAgo <= period)
        .sort((a, b) => b.daysAgo - a.daysAgo),
    [history, period],
  );

  const { solidPath, gapPath, waterDots, outsideAnnotation } = useMemo(() => {
    let solid = '';
    let gaps = '';
    let pen = false;
    let gapPen = false;
    const dots: { cx: number; cy: number }[] = [];
    let daysOverWet = 0;
    for (const p of pts) {
      const px = x(p.daysAgo);
      const py = y(p.moisture);
      if (p.gap) {
        gaps += `${gapPen ? 'L' : 'M'} ${px.toFixed(1)} ${py.toFixed(1)} `;
        gapPen = true;
        pen = false;
      } else {
        solid += `${pen ? 'L' : 'M'} ${px.toFixed(1)} ${py.toFixed(1)} `;
        pen = true;
        gapPen = false;
      }
      if (p.watered) dots.push({ cx: px, cy: py });
      if (p.moisture > band[1]) daysOverWet += 0.5;
    }
    return {
      solidPath: solid,
      gapPath: gaps,
      waterDots: dots,
      outsideAnnotation:
        daysOverWet >= 3 ? `${Math.round(daysOverWet)} days over-wet in this window` : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, w, period]);

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text style={[type.body, { color: dark.ink }]}>
          Time in range:{' '}
          <Text style={[type.numBold as any, { fontSize: 15, color: dark.ink }]}>
            {timeInRangePct}%
          </Text>
          <Text style={{ color: dark.inkMuted }}> ({period} d)</Text>
        </Text>
      </View>

      <View onLayout={onLayout} style={{ height: H, marginTop: 12 }}>
        {w > 0 && (
          <Svg width={w} height={H}>
            {/* over-wet zone */}
            <Rect x={0} y={PAD_TOP} width={w} height={Math.max(0, y(band[1]) - PAD_TOP)} fill={accent.clay} opacity={0.13} />
            {/* comfort ribbon */}
            <Rect x={0} y={y(band[1])} width={w} height={y(band[0]) - y(band[1])} fill={accent.sage} opacity={0.18} />
            <Line x1={0} x2={w} y1={y(band[1])} y2={y(band[1])} stroke={accent.sage} opacity={0.35} strokeWidth={1} />
            <Line x1={0} x2={w} y1={y(band[0])} y2={y(band[0])} stroke={accent.sage} opacity={0.35} strokeWidth={1} />
            {/* trace */}
            {!!gapPath && (
              <Path d={gapPath} stroke={dark.inkMuted} strokeWidth={2} fill="none" strokeDasharray={[3, 5]} />
            )}
            {!!solidPath && <Path d={solidPath} stroke={dark.ink} strokeWidth={2} fill="none" />}
            {waterDots.map((d, i) => (
              <Circle key={i} cx={d.cx} cy={d.cy} r={3.5} fill={accent.verdant} stroke={dark.surface1} strokeWidth={1.5} />
            ))}
          </Svg>
        )}
        {/* x labels */}
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={[type.micro, { color: dark.inkMuted }]}>{period} d ago</Text>
          <Text style={[type.micro, { color: dark.inkMuted }]}>now</Text>
        </View>
      </View>

      {outsideAnnotation && (
        <Text style={[type.caption, { color: accent.sunbeamText, marginTop: 6 }]}>
          {outsideAnnotation}
        </Text>
      )}

      {/* period toggle — 44pt touch targets (§14) */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {PERIODS.map((p) => {
          const locked = lockedBeyond7d && p > 7;
          const active = p === period;
          return (
            <Pressable
              key={p}
              onPress={() => (locked ? onLockedPress?.() : setPeriod(p))}
              style={{
                minHeight: 44,
                paddingHorizontal: 14,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? dark.surface2 : 'transparent',
                borderWidth: 1,
                borderColor: active ? accent.verdant : dark.hairline,
              }}
            >
              <Text
                style={[
                  type.micro,
                  { color: locked ? dark.inkMuted : active ? dark.ink : dark.inkMuted },
                ]}
              >
                {p} d{locked ? ' ·  Plus' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
