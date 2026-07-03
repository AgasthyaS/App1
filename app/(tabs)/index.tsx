import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ForecastBar from '@/components/greenr/ForecastBar';
import Sparkline from '@/components/greenr/Sparkline';
import { Card, GButton } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, dark, layout, type } from '@/constants/theme';
import { adviceFor, primaryAction } from '@/lib/advice';
import { BUILD_STAMP } from '@/lib/build';
import { clockNow } from '@/lib/format';
import { activePlants, gardenAverage, useGreenr } from '@/lib/store';
import { Plant, Spot } from '@/lib/types';

function urgency(p: Plant): number {
  if (p.forecast.criticalInDays != null) return p.forecast.criticalInDays;
  if (p.forecast.warnInDays != null) return 100 + p.forecast.warnInDays;
  return 1000 + (100 - p.score);
}

function PlantRow({ plant, spot, onPress }: { plant: Plant; spot?: Spot; onPress: () => void }) {
  const critical48 = plant.forecast.criticalInDays != null && plant.forecast.criticalInDays <= 2;
  const declining =
    plant.scoreTrend14[plant.scoreTrend14.length - 1] < plant.scoreTrend14[0] - 3;
  // one environment flag beyond watering, when there is one
  const envFlag = adviceFor(plant, spot).find(
    (a) => a.severity !== 'good' && !a.icon.startsWith('water'),
  );
  return (
    <Card onPress={onPress} accentBorder={critical48 ? accent.clay : undefined} style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <VitalityRing score={plant.score} size={28} estimate={plant.estimate} showLabel={false} />
        <Text style={[type.cardTitle, { color: dark.ink, flex: 1, marginRight: 4 }]} numberOfLines={1}>
          {plant.name}
        </Text>
        <Text style={[type.numBold as any, { fontSize: 17, color: dark.ink, flexShrink: 0 }]} numberOfLines={1}>
          {plant.score}
          {plant.estimate && (
            <Text style={[type.caption, { color: dark.inkMuted }]}> ±{plant.estimateBand}</Text>
          )}
        </Text>
        <Sparkline trend14={plant.scoreTrend14} />
        <Text
          style={[type.micro, { color: declining ? accent.sunbeam : dark.inkMuted, flexShrink: 0 }]}
          numberOfLines={1}
        >
          {declining ? 'declining' : 'stable'}
        </Text>
      </View>
      <View style={{ marginTop: 12 }}>
        <ForecastBar forecast={plant.forecast} estimate={plant.estimate} />
      </View>
      <Text style={[type.caption, { color: critical48 ? accent.clay : dark.ink, marginTop: 8 }]}>
        {primaryAction(plant)}
      </Text>
      {envFlag && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <Ionicons name={envFlag.icon as any} size={12} color={accent.sunbeam} />
          <Text style={[type.micro, { color: dark.inkMuted, flex: 1 }]} numberOfLines={1}>
            {envFlag.text.split('—')[0].trim()}
          </Text>
        </View>
      )}
    </Card>
  );
}

export default function ForecastTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { plants: allPlants, spots, tasks, briefingOpened } = useGreenr();
  const [refreshing, setRefreshing] = useState(false);
  const [asOf, setAsOf] = useState(clockNow());

  const plants = useMemo(() => activePlants(allPlants), [allPlants]);
  const sorted = useMemo(() => [...plants].sort((a, b) => urgency(a) - urgency(b)), [plants]);
  const avg = gardenAverage(plants);
  const thriving = plants.filter((p) => p.score >= 85).length;
  const careMinutes = tasks.reduce((a, t) => a + t.minutes, 0);
  const hasManual = plants.some((p) => p.estimate);

  const day = new Date().getDay(); // 0 Sun
  const showFullBriefing = day === 0 || day === 1 || (!briefingOpened && day <= 3);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => {
      setAsOf(clockNow());
      setRefreshing(false);
    }, 700);
  }, []);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: dark.bg }}
      contentContainerStyle={{
        paddingHorizontal: layout.margin,
        paddingTop: insets.top + 8,
        paddingBottom: 32,
      }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.verdant} />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Header row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.screenTitle, { color: dark.ink }]}>Forecast</Text>
        <Pressable onPress={() => router.push('/you')} accessibilityLabel={`Garden average ${avg}`}>
          <VitalityRing score={avg} size={28} showLabel={false} />
        </Pressable>
      </View>
      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>
        Readings as of {asOf} · {BUILD_STAMP}
      </Text>

      {/* Briefing card (contextual, §4) */}
      {plants.length === 0 ? null : showFullBriefing ? (
        <Card elevated style={{ marginTop: 14 }}>
          <Text style={[type.cardTitle, { color: dark.ink }]}>This week&apos;s briefing</Text>
          <Text style={[type.caption, { color: dark.inkMuted, marginTop: 4 }]}>
            {thriving} of {plants.length} thriving · {careMinutes} min of care
          </Text>
          <GButton title="Start Care Mode" onPress={() => router.push('/briefing')} style={{ marginTop: 12 }} />
        </Card>
      ) : (
        <Card style={{ marginTop: 14, paddingVertical: 12 }} onPress={() => router.push('/briefing')}>
          <Text style={[type.caption, { color: dark.inkMuted }]}>Next briefing: Sunday 9:00</Text>
        </Card>
      )}

      {/* Weather strip — only when it matters (§4) */}
      {plants.length > 0 && (
        <Card style={{ marginTop: 10, paddingVertical: 12 }} accentBorder={accent.sunbeam}>
          <Text style={[type.caption, { color: dark.ink }]}>
            Heat advisory Fri–Sun (94°) — drying accelerated ~2 days garden-wide.
          </Text>
        </Card>
      )}

      {/* Forecast list */}
      <View style={{ marginTop: 16 }}>
        {sorted.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Text style={{ fontSize: 40 }}>🌿</Text>
            <Text style={[type.body, { color: dark.inkMuted, marginTop: 10, textAlign: 'center' }]}>
              Add your first plant — Greenr starts measuring immediately.
            </Text>
            <GButton title="Add plant" onPress={() => router.push('/add-plant')} style={{ marginTop: 14 }} />
          </Card>
        ) : (
          sorted.map((p) => (
            <PlantRow
              key={p.id}
              plant={p}
              spot={spots.find((s) => s.id === p.spotId)}
              onPress={() => router.push(`/plant/${p.id}`)}
            />
          ))
        )}
      </View>

      {hasManual && (
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4 }]}>
          Dashed = estimated. Sensors make forecasts exact.
        </Text>
      )}

      {/* O7 — the inline nudge after the first plant (§2.2) */}
      {plants.length > 0 && plants.length < 3 && (
        <Card style={{ marginTop: 12, paddingVertical: 12 }} onPress={() => router.push('/add-plant')}>
          <Text style={[type.caption, { color: dark.inkMuted }]}>
            Add the rest of your plants — scores get more useful side by side.
          </Text>
        </Card>
      )}
    </ScrollView>
  );
}
