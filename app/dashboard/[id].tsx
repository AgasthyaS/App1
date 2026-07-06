import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LineChart, type Point } from '@/components/greenr/LineChart';
import { Card, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, layout, type } from '@/constants/theme';
import { getDeviceIdForPlant, getReadingsSince, type Reading } from '@/lib/devices';
import { idealsFor } from '@/lib/plantStatus';
import { useGreenr } from '@/lib/store';

type Range = 'day' | 'week' | 'month' | 'year';
const RANGES: { key: Range; label: string; ms: number }[] = [
  { key: 'day', label: 'Day', ms: 864e5 },
  { key: 'week', label: 'Week', ms: 7 * 864e5 },
  { key: 'month', label: 'Month', ms: 30 * 864e5 },
  { key: 'year', label: 'Year', ms: 365 * 864e5 },
];

/** Full analytics dashboard for one plant — real sensor history, fitness-app style. */
export default function Dashboard() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { plants } = useGreenr();
  const plant = plants.find((p) => p.id === id);

  const [range, setRange] = useState<Range>('week');
  const [readings, setReadings] = useState<Reading[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const plantKey = typeof id === 'string' ? id : undefined;

  useEffect(() => {
    if (!plantKey) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const dev = await getDeviceIdForPlant(plantKey);
      if (!alive) return;
      setDeviceId(dev);
      if (dev) {
        const since = Date.now() - (RANGES.find((r) => r.key === range)?.ms ?? 7 * 864e5);
        const rows = await getReadingsSince(dev, since);
        if (alive) setReadings(rows);
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [plantKey, range]);

  const ideal = plant ? idealsFor(plant.species, plant.comfortBand) : null;

  const series = (pick: (r: Reading) => number | null): Point[] =>
    readings
      .map((r) => ({ t: new Date(r.created_at).getTime(), v: pick(r) }))
      .filter((p): p is Point => p.v != null);

  const charts = useMemo(
    () => [
      { label: 'Soil moisture', unit: '%', color: accent.verdant, data: series((r) => r.soil_pct), band: plant?.comfortBand },
      { label: 'Light', unit: '', color: accent.sunbeam, data: series((r) => r.light_lux) },
      { label: 'Temperature', unit: '°C', color: '#E8956B', data: series((r) => r.temp_c) },
      { label: 'Humidity', unit: '%', color: '#6BB8E8', data: series((r) => r.humidity_pct) },
    ],
    [readings, plant],
  );

  if (!plant) {
    return (
      <View style={{ flex: 1, backgroundColor: dark.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.body, { color: dark.inkMuted }]}>Plant not found.</Text>
      </View>
    );
  }

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
        </View>

        {/* range tabs */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 8 }}>
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
                backgroundColor: range === r.key ? accent.verdant : dark.surface1,
              }}
            >
              <Text style={[type.caption, { color: range === r.key ? '#08110B' : dark.inkMuted }]}>{r.label}</Text>
            </Pressable>
          ))}
        </View>

        {!deviceId ? (
          <Card style={{ marginTop: 12 }}>
            <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
              No sensor paired to {plant.name} yet. Pair one to unlock real analytics.
            </Text>
          </Card>
        ) : loading ? (
          <Text style={[type.body, { color: dark.inkMuted, marginTop: 24, textAlign: 'center' }]}>Loading…</Text>
        ) : readings.length === 0 ? (
          <Card style={{ marginTop: 12 }}>
            <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
              No readings in this range yet. Data builds as your sensor reports — check the Day view for the
              latest.
            </Text>
          </Card>
        ) : (
          <>
            <Text style={[type.micro, { color: dark.inkMuted, marginBottom: 8 }]}>
              {readings.length} readings · judged against {plant.species}&apos;s ideal ranges
            </Text>
            {charts.map((c) => (
              <View key={c.label}>
                <SectionHeader>{c.label}</SectionHeader>
                <Card>
                  <LineChart data={c.data} color={c.color} unit={c.unit} band={c.band as [number, number] | undefined} />
                </Card>
              </View>
            ))}
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 16, lineHeight: 15 }]}>
              Watering history, drying rate, health score, and growth trends arrive as more data accumulates.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}
