import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LineChart, type Point } from '@/components/greenr/LineChart';
import { Card, Chip, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, layout, type } from '@/constants/theme';
import { applyCalibration, calibrationFor } from '@/lib/calibration';
import { getDeviceIdForPlant, getReadingsSince, type Reading } from '@/lib/devices';
import { GRADE_WORD, metricTrend, overallGrade, rateMetrics, type Grade, type MetricRating } from '@/lib/rating';
import { useGreenr } from '@/lib/store';

type Range = 'day' | 'week' | 'month';
const RANGES: { key: Range; label: string; ms: number }[] = [
  { key: 'day', label: 'Day', ms: 864e5 },
  { key: 'week', label: 'Week', ms: 7 * 864e5 },
  { key: 'month', label: 'Month', ms: 30 * 864e5 },
];

const gradeColor = (g: Grade | null | undefined) =>
  g === 'excellent' ? accent.sage : g === 'good' ? accent.verdant : g === 'fair' ? accent.sunbeam : g === 'poor' ? accent.clay : dark.inkMuted;

const METRIC_COLOR: Record<string, string> = {
  soil: accent.verdant,
  light: accent.sunbeam,
  temperature: '#E8956B',
  humidity: '#6BB8E8',
};

/**
 * Full analytics for one plant. Two lenses on the same real data:
 *   • AVERAGE — the multi-day rating (the plant's real rank; steadier with
 *     every day of data), plus readable trend charts.
 *   • ONE DAY — tap any recent day to see how that day went, metric by metric.
 */
export default function Dashboard() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { plants, settings, calibrations } = useGreenr();
  const plant = plants.find((p) => p.id === id);

  const [range, setRange] = useState<Range>('week');
  const [readings, setReadings] = useState<Reading[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** null = the Average lens; a YYYY-MM-DD key = that day's lens */
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const plantKey = typeof id === 'string' ? id : undefined;

  // Always fetch the last 30 days — ratings need up to 14, charts slice a window.
  useEffect(() => {
    if (!plantKey) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const dev = await getDeviceIdForPlant(plantKey);
      if (!alive) return;
      setDeviceId(dev);
      if (dev) {
        const rows = await getReadingsSince(dev, Date.now() - 30 * 864e5);
        if (alive) setReadings(rows);
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [plantKey]);

  // Apply this sensor's calibration so analytics match every other screen.
  const cal = calibrationFor(calibrations, deviceId, plant?.sensorId);
  const calReadings = useMemo(
    () => (cal ? readings.map((r) => applyCalibration(r, cal)) : readings),
    [readings, cal],
  );

  const ratings: MetricRating[] = useMemo(
    () => (plant ? rateMetrics(calReadings, plant.species, plant.comfortBand, settings.unitsF) : []),
    [calReadings, plant, settings.unitsF],
  );
  const overall = overallGrade(ratings);
  const dayOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const m of ratings) for (const d of m.days) keys.add(d.day);
    return [...keys].sort().slice(-7);
  }, [ratings]);

  const latest = calReadings.length ? calReadings[calReadings.length - 1] : null;
  const battery = latest?.battery_pct;

  // Chart window: the range tab, or the selected day when one is tapped.
  const windowed = useMemo(() => {
    if (selectedDay) {
      const from = new Date(`${selectedDay}T00:00:00`).getTime();
      return calReadings.filter((r) => {
        const t = new Date(r.created_at).getTime();
        return t >= from && t < from + 864e5;
      });
    }
    const since = Date.now() - (RANGES.find((r) => r.key === range)?.ms ?? 7 * 864e5);
    return calReadings.filter((r) => new Date(r.created_at).getTime() >= since);
  }, [calReadings, range, selectedDay]);

  const series = (pick: (r: Reading) => number | null): Point[] =>
    windowed
      .map((r) => ({ t: new Date(r.created_at).getTime(), v: pick(r) }))
      .filter((p): p is Point => p.v != null);

  if (!plant) {
    return (
      <View style={{ flex: 1, backgroundColor: dark.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.body, { color: dark.inkMuted }]}>Plant not found.</Text>
      </View>
    );
  }

  const unitsF = settings.unitsF;
  const charts = [
    { key: 'soil', label: 'Soil moisture', unit: '%', data: series((r) => r.soil_pct), band: plant.comfortBand as [number, number] | undefined },
    { key: 'light', label: 'Light', unit: '', data: series((r) => r.light_lux), band: undefined },
    { key: 'temperature', label: 'Temperature', unit: unitsF ? '°F' : '°C', data: series((r) => (r.temp_c == null ? null : unitsF ? (r.temp_c * 9) / 5 + 32 : r.temp_c)), band: undefined },
    { key: 'humidity', label: 'Humidity', unit: '%', data: series((r) => r.humidity_pct), band: undefined },
  ];

  const selectedDayLabel = selectedDay
    ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: dark.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 60, paddingHorizontal: layout.margin }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <Pressable onPress={() => router.back()} style={{ minHeight: 40, minWidth: 40, justifyContent: 'center' }}>
            <Ionicons name="chevron-back" size={24} color={dark.ink} />
          </Pressable>
          <Text style={[type.screenTitle, { color: dark.ink, flex: 1 }]} numberOfLines={1}>
            {plant.name} · Analytics
          </Text>
          {battery != null && battery >= 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons
                name={battery > 60 ? 'battery-full' : battery > 25 ? 'battery-half' : 'battery-dead'}
                size={18}
                color={battery <= 20 ? accent.clay : dark.inkMuted}
              />
              <Text style={[type.micro, { color: battery <= 20 ? accent.clay : dark.inkMuted }]}>
                {Math.round(battery)}%
              </Text>
            </View>
          )}
        </View>

        {!deviceId && !loading ? (
          <Card style={{ marginTop: 12 }}>
            <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
              No sensor paired to {plant.name} yet. Pair one to unlock real analytics.
            </Text>
          </Card>
        ) : loading ? (
          <Text style={[type.body, { color: dark.inkMuted, marginTop: 24, textAlign: 'center' }]}>Loading…</Text>
        ) : calReadings.length === 0 ? (
          <Card style={{ marginTop: 12 }}>
            <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
              No readings yet. Data builds here as your sensor reports (about every 3 hours).
            </Text>
          </Card>
        ) : (
          <>
            {/* ── lens selector: the real (average) rating, or any single day ── */}
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 8, letterSpacing: 0.4 }]}>VIEW</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  onPress={() => setSelectedDay(null)}
                  style={{
                    minHeight: 40,
                    paddingHorizontal: 14,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: selectedDay == null ? accent.verdant : dark.surface1,
                  }}
                >
                  <Text style={[type.caption, { color: selectedDay == null ? '#08110B' : dark.inkMuted }]}>
                    ★ Average
                  </Text>
                </Pressable>
                {dayOptions.map((d) => {
                  const label = new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
                  const active = selectedDay === d;
                  return (
                    <Pressable
                      key={d}
                      onPress={() => setSelectedDay(active ? null : d)}
                      style={{
                        minHeight: 40,
                        paddingHorizontal: 12,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: active ? accent.verdant : dark.surface1,
                      }}
                    >
                      <Text style={[type.caption, { color: active ? '#08110B' : dark.inkMuted }]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            {/* ── the rating card ── */}
            <SectionHeader>{selectedDay ? `How ${selectedDayLabel} went` : 'Real rating · multi-day average'}</SectionHeader>
            <Card>
              {!selectedDay && overall && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <Text style={[type.ritualTitle, { color: gradeColor(overall.grade), fontSize: 24 }]}>
                    {overall.word}
                  </Text>
                  <Chip label={`${ratings[0]?.days.length ?? 0} days of data`} color={dark.inkMuted} />
                </View>
              )}
              {!selectedDay && (
                <Text style={[type.micro, { color: dark.inkMuted, lineHeight: 15, marginBottom: 6 }]}>
                  Each metric is ranked on its average across recent days — one odd afternoon can&apos;t
                  swing it. The more days collected, the more accurate this gets.
                </Text>
              )}
              {ratings.map((m, i) => {
                const dayEntry = selectedDay ? m.days.find((d) => d.day === selectedDay) : null;
                const value = selectedDay ? dayEntry?.avg ?? null : m.average;
                const grade = selectedDay ? dayEntry?.grade ?? null : m.grade;
                return (
                  <View key={m.key} style={{ marginTop: i === 0 ? 6 : 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name={m.icon as any} size={15} color={METRIC_COLOR[m.key]} />
                      <Text style={[type.caption, { color: dark.ink, flex: 1 }]}>{m.label}</Text>
                      <Text style={[type.num as any, { color: dark.inkMuted, fontSize: 12 }]}>
                        {value != null ? `${value}${m.unit}` : 'no data'}
                      </Text>
                      <Text style={[type.numBold as any, { color: gradeColor(grade), fontSize: 13, minWidth: 62, textAlign: 'right' }]}>
                        {grade ? GRADE_WORD[grade] : '—'}
                      </Text>
                    </View>
                    {/* per-day strip: 7 tappable squares, colored by that day's grade */}
                    {!selectedDay && m.days.length > 0 && (
                      <View style={{ flexDirection: 'row', gap: 4, marginTop: 6, marginLeft: 23 }}>
                        {m.days.slice(-7).map((d) => (
                          <Pressable
                            key={d.day}
                            onPress={() => setSelectedDay(d.day)}
                            style={{
                              flex: 1,
                              height: 18,
                              borderRadius: 4,
                              backgroundColor: `${gradeColor(d.grade)}55`,
                              borderWidth: 1,
                              borderColor: gradeColor(d.grade),
                            }}
                          />
                        ))}
                      </View>
                    )}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, marginLeft: 23, gap: 6 }}>
                      <Text style={[type.micro, { color: dark.inkMuted, flex: 1, lineHeight: 14 }]}>
                        {m.idealText}
                      </Text>
                      {!selectedDay && (() => {
                        const tr = metricTrend(m.days);
                        if (!tr) return null;
                        const arrow = tr.direction === 'rising' ? '↑' : tr.direction === 'falling' ? '↓' : '→';
                        return (
                          <Text style={[type.micro, { color: dark.inkMuted }]}>
                            {arrow} {tr.direction === 'steady' ? 'steady' : `${tr.perDay > 0 ? '+' : ''}${tr.perDay}${m.unit}/day`}
                          </Text>
                        );
                      })()}
                    </View>
                  </View>
                );
              })}
              {!selectedDay && (
                <Text style={[type.micro, { color: dark.inkMuted, marginTop: 12, lineHeight: 15 }]}>
                  Tap a colored square (or a day above) to see how that single day went.
                </Text>
              )}
            </Card>

            {/* ── charts ── */}
            {!selectedDay && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                {RANGES.map((r) => (
                  <Pressable
                    key={r.key}
                    onPress={() => setRange(r.key)}
                    style={{
                      flex: 1,
                      minHeight: 40,
                      borderRadius: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: range === r.key ? dark.surface2 : dark.surface1,
                      borderWidth: 1,
                      borderColor: range === r.key ? accent.verdant : 'transparent',
                    }}
                  >
                    <Text style={[type.caption, { color: range === r.key ? dark.ink : dark.inkMuted }]}>{r.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10 }]}>
              {windowed.length} readings{selectedDay ? ` on ${selectedDayLabel}` : ''} · shaded band = ideal range
            </Text>
            {charts.map((c) => (
              <View key={c.label}>
                <SectionHeader>{c.label}</SectionHeader>
                <Card>
                  <LineChart data={c.data} color={METRIC_COLOR[c.key]} unit={c.unit} band={c.band} />
                </Card>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}
