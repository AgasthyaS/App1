import { accent, dark, type } from '@/constants/theme';
import { forecastLabel } from '@/lib/format';
import { ForecastInfo } from '@/lib/types';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

/**
 * Forecast bar (§1.4): today → +10 d. Sage while projected in-range,
 * Sunbeam from the warning date, a Clay tick at the projected critical date.
 * Confidence renders as a soft width on the tick. Estimate mode is dashed.
 */

const DAYS = 10;
const BAR_H = 6;

export default function ForecastBar({
  forecast,
  estimate,
  height = 22,
  showLabel = true,
}: {
  forecast: ForecastInfo;
  estimate?: boolean;
  height?: number;
  showLabel?: boolean;
}) {
  const [w, setW] = useState(0);
  const x = (days: number) => Math.min(w, (days / DAYS) * w);
  const midY = height / 2;

  const warnX = forecast.warnInDays != null ? x(forecast.warnInDays) : w;
  const critX = forecast.criticalInDays != null ? x(forecast.criticalInDays) : null;
  const confW = x(forecast.confidenceDays) - x(0);

  const label =
    forecast.criticalInDays != null
      ? `CRIT ${forecast.criticalLabel ?? forecastLabel(forecast.criticalInDays)}`
      : estimate
        ? 'estimated'
        : `${DAYS} d clear`;
  const labelColor = forecast.criticalInDays != null ? accent.clay : dark.inkMuted;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height, flex: 1 }}>
        {w > 0 && (
        <Svg width={w} height={height}>
          {/* in-range segment */}
          <Rect
            x={0}
            y={midY - BAR_H / 2}
            width={warnX}
            height={BAR_H}
            rx={BAR_H / 2}
            fill={accent.sage}
            opacity={estimate ? 0.55 : 0.9}
          />
          {estimate && (
            // dashed overlay reads as "estimated" without relying on color
            <Line
              x1={0}
              x2={warnX}
              y1={midY}
              y2={midY}
              stroke={dark.bg}
              strokeWidth={BAR_H}
              strokeDasharray={[1, 7]}
              opacity={0.65}
            />
          )}
          {/* warning → critical segment */}
          {forecast.warnInDays != null && (
            <Rect
              x={warnX}
              y={midY - BAR_H / 2}
              width={(critX ?? w) - warnX}
              height={BAR_H}
              rx={BAR_H / 2}
              fill={accent.sunbeam}
              opacity={estimate ? 0.45 : 0.8}
            />
          )}
          {/* confidence blur + critical tick */}
          {critX != null && (
            <>
              <Rect
                x={critX - confW}
                y={midY - 9}
                width={confW * 2}
                height={18}
                rx={4}
                fill={accent.clay}
                opacity={0.18}
              />
              <Rect x={critX - 1.25} y={midY - 9} width={2.5} height={18} rx={1.25} fill={accent.clay} />
            </>
          )}
          </Svg>
        )}
      </View>
      {showLabel && (
        <Text style={[type.micro, { color: labelColor }]} numberOfLines={1}>
          {label}
        </Text>
      )}
    </View>
  );
}
