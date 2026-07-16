import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { accent, dark, type } from '@/constants/theme';

export interface Point { t: number; v: number } // t = epoch ms, v = value

/**
 * Time-series chart built to be READ, not decoded: labeled y-axis grid lines,
 * real time labels along the bottom, the species' ideal range shaded green,
 * a dashed line at the period average, and a min/avg/max/now summary strip.
 * Sparse data is fine — it just plots the points it has.
 */
export function LineChart({
  data,
  color,
  unit = '',
  height = 160,
  band,
  yMin,
  yMax,
}: {
  data: Point[];
  color: string;
  unit?: string;
  height?: number;
  band?: [number, number]; // shaded ideal range
  yMin?: number;
  yMax?: number;
}) {
  const W = 340;
  const H = height;
  const padL = 34; // room for y labels
  const padR = 8;
  const padT = 8;
  const padB = 18; // room for time labels

  if (data.length === 0) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.caption, { color: dark.inkMuted }]}>No readings in this range yet.</Text>
      </View>
    );
  }

  const vals = data.map((d) => d.v);
  const dataLo = Math.min(...vals, band ? band[0] : Infinity);
  const dataHi = Math.max(...vals, band ? band[1] : -Infinity);
  const pad = Math.max((dataHi - dataLo) * 0.1, 1);
  const lo = yMin ?? Math.floor(dataLo - pad);
  const hi = yMax ?? Math.ceil(dataHi + pad);
  const span = hi - lo || 1;
  const t0 = data[0].t;
  const t1 = data[data.length - 1].t;
  const tSpan = t1 - t0 || 1;

  const x = (t: number) => padL + ((t - t0) / tSpan) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / span) * (H - padT - padB);

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(d.t).toFixed(1)} ${y(d.v).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(t1).toFixed(1)} ${(H - padB).toFixed(1)} L ${x(t0).toFixed(1)} ${(H - padB).toFixed(1)} Z`;
  const last = data[data.length - 1];
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);

  // y grid: lo / mid / hi ticks
  const ticks = [lo, lo + span / 2, hi];

  // time labels: start, middle, end — with dates when the span crosses days
  const fmtT = (t: number) => {
    const d = new Date(t);
    return tSpan > 2 * 864e5
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : d.toLocaleTimeString('en-US', { hour: 'numeric' });
  };

  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* ideal range, shaded */}
        {band && (
          <Rect
            x={padL}
            y={Math.min(y(band[0]), y(band[1]))}
            width={W - padL - padR}
            height={Math.abs(y(band[0]) - y(band[1]))}
            fill={accent.sage}
            fillOpacity={0.13}
            rx={3}
          />
        )}
        {/* y grid + labels */}
        {ticks.map((tv, i) => (
          <React.Fragment key={i}>
            <Line x1={padL} x2={W - padR} y1={y(tv)} y2={y(tv)} stroke={dark.hairline} strokeWidth={1} />
            <SvgText x={padL - 5} y={y(tv) + 3.5} fontSize={9.5} fill={dark.inkMuted} textAnchor="end">
              {`${Math.round(tv)}${unit}`}
            </SvgText>
          </React.Fragment>
        ))}
        {/* period average, dashed */}
        <Line x1={padL} x2={W - padR} y1={y(avg)} y2={y(avg)} stroke={color} strokeOpacity={0.55} strokeWidth={1} strokeDasharray="4 4" />
        {/* the data */}
        <Path d={area} fill={color} fillOpacity={0.1} />
        <Path d={line} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />
        <Circle cx={x(last.t)} cy={y(last.v)} r={3.5} fill={color} />
        {/* time labels */}
        <SvgText x={padL} y={H - 5} fontSize={9.5} fill={dark.inkMuted} textAnchor="start">
          {fmtT(t0)}
        </SvgText>
        {tSpan > 0 && (
          <SvgText x={(padL + W - padR) / 2} y={H - 5} fontSize={9.5} fill={dark.inkMuted} textAnchor="middle">
            {fmtT(t0 + tSpan / 2)}
          </SvgText>
        )}
        <SvgText x={W - padR} y={H - 5} fontSize={9.5} fill={dark.inkMuted} textAnchor="end">
          {fmtT(t1)}
        </SvgText>
      </Svg>
      {/* summary strip — the numbers people actually want */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        {(
          [
            ['LOW', min],
            ['AVG', avg],
            ['HIGH', max],
            ['NOW', last.v],
          ] as [string, number][]
        ).map(([label, v]) => (
          <View key={label} style={{ alignItems: 'center', minWidth: 56 }}>
            <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.4 }]}>{label}</Text>
            <Text style={[type.numBold as any, { color: label === 'NOW' ? color : dark.ink, fontSize: 13, marginTop: 1 }]}>
              {Math.round(v * 10) / 10}
              {unit}
            </Text>
          </View>
        ))}
      </View>
      {band && (
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 5 }]}>
          Green band = this plant&apos;s ideal range · dashed line = period average
        </Text>
      )}
    </View>
  );
}
