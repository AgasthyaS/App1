import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { dark, type } from '@/constants/theme';

export interface Point { t: number; v: number } // t = epoch ms, v = value

/**
 * Time-series line chart from real readings. Scales to the data, draws a soft
 * area + line, and shows an optional ideal band. Sparse data is fine — it just
 * plots the few points it has.
 */
export function LineChart({
  data,
  color,
  unit = '',
  height = 150,
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
  const W = 320;
  const H = height;
  const pad = 6;

  if (data.length === 0) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.caption, { color: dark.inkMuted }]}>No readings in this range yet.</Text>
      </View>
    );
  }

  const vals = data.map((d) => d.v);
  const lo = yMin ?? Math.min(...vals, band ? band[0] : Infinity);
  const hi = yMax ?? Math.max(...vals, band ? band[1] : -Infinity);
  const span = hi - lo || 1;
  const t0 = data[0].t;
  const t1 = data[data.length - 1].t;
  const tSpan = t1 - t0 || 1;

  const x = (t: number) => pad + ((t - t0) / tSpan) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (H - pad * 2);

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(d.t).toFixed(1)} ${y(d.v).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(t1).toFixed(1)} ${H - pad} L ${x(t0).toFixed(1)} ${H - pad} Z`;
  const last = data[data.length - 1];

  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {band && (
          <Line
            x1={0}
            x2={W}
            y1={(y(band[0]) + y(band[1])) / 2}
            y2={(y(band[0]) + y(band[1])) / 2}
            stroke={color}
            strokeOpacity={0.12}
            strokeWidth={y(band[0]) - y(band[1])}
          />
        )}
        <Path d={area} fill={color} fillOpacity={0.1} />
        <Path d={line} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />
        <Circle cx={x(last.t)} cy={y(last.v)} r={3.5} fill={color} />
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <Text style={[type.micro, { color: dark.inkMuted }]}>
          {Math.round(lo)}
          {unit}
        </Text>
        <Text style={[type.micro, { color: dark.inkMuted }]}>
          now {Math.round(last.v)}
          {unit}
        </Text>
        <Text style={[type.micro, { color: dark.inkMuted }]}>
          {Math.round(hi)}
          {unit}
        </Text>
      </View>
    </View>
  );
}
