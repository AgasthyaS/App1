import { accent, dark, type } from '@/constants/theme';
import { MoisturePoint } from '@/lib/types';
import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

/**
 * The Range Ribbon (§1.4) — CGM-style soil-moisture chart, v2.
 * Everything is labeled: the comfort band, the over-wet zone, the axis, and
 * a legend. Estimated (no-sensor) charts say so plainly.
 */

const PERIODS = [7, 14, 30, 90] as const;
const H = 170;
const PAD_TOP = 10;
const PAD_BOTTOM = 20;
const GUTTER = 34; // left axis labels

export default function RangeRibbon({
  history,
  band,
  timeInRangePct,
  estimate,
  lockedBeyond7d,
  onLockedPress,
}: {
  history: MoisturePoint[];
  band: [number, number];
  timeInRangePct: number;
  /** modeled, not measured — renders the honesty line */
  estimate?: boolean;
  /** free tier: history beyond 7 d is Plus (§10) */
  lockedBeyond7d?: boolean;
  onLockedPress?: () => void;
}) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(14);
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  const plotW = Math.max(0, w - GUTTER);
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const y = (m: number) => PAD_TOP + plotH * (1 - m / 100);
  const x = (daysAgo: number) => GUTTER + plotW - (daysAgo / period) * plotW;

  const pts = useMemo(
    () =>
      history
        .filter((p) => p.daysAgo <= period)
        .sort((a, b) => b.daysAgo - a.daysAgo),
    [history, period],
  );

  const { solidPath, gapPath, waterDots } = useMemo(() => {
    let solid = '';
    let gaps = '';
    let pen = false;
    let gapPen = false;
    const dots: { cx: number; cy: number }[] = [];
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
    }
    return { solidPath: solid, gapPath: gaps, waterDots: dots };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, w, period]);

  const overWetTall = y(band[1]) - PAD_TOP > 26;

  return (
    <View>
      <Text style={[type.body, { color: dark.ink }]}>
        Time in the comfort band:{' '}
        <Text style={[type.numBold as any, { fontSize: 15, color: timeInRangePct >= 75 ? accent.sage : accent.sunbeam }]}>
          {timeInRangePct}%
        </Text>
        <Text style={{ color: dark.inkMuted }}> · last {period} days</Text>
      </Text>

      <View onLayout={onLayout} style={{ height: H, marginTop: 12 }}>
        {w > 0 && (
          <Svg width={w} height={H}>
            {/* over-wet zone */}
            <Rect x={GUTTER} y={PAD_TOP} width={plotW} height={Math.max(0, y(band[1]) - PAD_TOP)} fill={accent.clay} opacity={0.12} />
            {overWetTall && (
              <SvgText x={GUTTER + 8} y={PAD_TOP + 16} fill={accent.clay} opacity={0.85} fontSize={10} fontFamily="Inter_500Medium">
                too wet — root-rot risk
              </SvgText>
            )}
            {/* comfort ribbon */}
            <Rect x={GUTTER} y={y(band[1])} width={plotW} height={y(band[0]) - y(band[1])} fill={accent.sage} opacity={0.16} />
            <SvgText x={GUTTER + 8} y={y(band[1]) + 15} fill={accent.sage} fontSize={10} fontFamily="Inter_500Medium">
              comfort band
            </SvgText>
            <Line x1={GUTTER} x2={w} y1={y(band[1])} y2={y(band[1])} stroke={accent.sage} opacity={0.35} strokeWidth={1} />
            <Line x1={GUTTER} x2={w} y1={y(band[0])} y2={y(band[0])} stroke={accent.sage} opacity={0.35} strokeWidth={1} />
            {/* axis labels: band bounds + 0 */}
            <SvgText x={GUTTER - 6} y={y(band[1]) + 3.5} fill={dark.inkMuted} fontSize={10} textAnchor="end" fontFamily="Inter_500Medium">
              {band[1]}%
            </SvgText>
            <SvgText x={GUTTER - 6} y={y(band[0]) + 3.5} fill={dark.inkMuted} fontSize={10} textAnchor="end" fontFamily="Inter_500Medium">
              {band[0]}%
            </SvgText>
            <SvgText x={GUTTER - 6} y={y(0) + 3.5} fill={dark.inkMuted} fontSize={10} textAnchor="end" fontFamily="Inter_500Medium">
              dry
            </SvgText>
            {/* trace */}
            {!!gapPath && (
              <Path d={gapPath} stroke={dark.inkMuted} strokeWidth={2} fill="none" strokeDasharray={[3, 5]} />
            )}
            {!!solidPath && (
              <Path
                d={solidPath}
                stroke={dark.ink}
                strokeWidth={2}
                fill="none"
                strokeDasharray={estimate ? [6, 4] : undefined}
              />
            )}
            {waterDots.map((d, i) => (
              <Circle key={i} cx={d.cx} cy={d.cy} r={4} fill={accent.verdant} stroke={dark.surface1} strokeWidth={1.5} />
            ))}
          </Svg>
        )}
        {/* x labels */}
        <View style={{ position: 'absolute', bottom: 0, left: GUTTER, right: 0, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={[type.micro, { color: dark.inkMuted }]}>{period} days ago</Text>
          <Text style={[type.micro, { color: dark.inkMuted }]}>today</Text>
        </View>
      </View>

      {/* legend */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 14, height: 2, backgroundColor: dark.ink, borderRadius: 1 }} />
          <Text style={[type.micro, { color: dark.inkMuted }]}>soil moisture</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: accent.verdant }} />
          <Text style={[type.micro, { color: dark.inkMuted }]}>watering</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 14, height: 8, backgroundColor: accent.sage, opacity: 0.4, borderRadius: 2 }} />
          <Text style={[type.micro, { color: dark.inkMuted }]}>happy zone</Text>
        </View>
      </View>

      {estimate && (
        <Text style={[type.micro, { color: accent.sunbeamText, marginTop: 8, lineHeight: 15 }]}>
          Modeled estimate, not a measurement — the real curve needs a Greenr Sensor in the soil.
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
