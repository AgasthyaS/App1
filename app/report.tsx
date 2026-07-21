import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, GButton, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { eventDaysAgo } from '@/lib/format';
import { growthSummary } from '@/lib/growth';
import { shareContent } from '@/lib/platform';
import { activePlants, useGreenr } from '@/lib/store';

const DAY = 86400000;

export default function GardenReport() {
  const router = useRouter();
  const { plants: allPlants, profile } = useGreenr();
  const plants = useMemo(() => activePlants(allPlants), [allPlants]);
  const now = Date.now();
  const monthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const stats = useMemo(() => {
    const within = (ms: number) => now - ms < 30 * DAY;

    let waterings = 0;
    let careActions = 0;
    let photos = 0;
    let heightGain = 0;
    let leavesGain = 0;
    let topGrower: { name: string; cm: number } | null = null;
    let newPlants = 0;

    for (const p of plants) {
      if (p.addedAt && within(new Date(p.addedAt).getTime())) newPlants++;

      (p.waterLog ?? []).forEach((w) => { if (within(new Date(w.at).getTime())) waterings++; });
      p.timeline.forEach((e) => {
        const at = now - eventDaysAgo(e, now) * DAY;
        if (!within(at)) return;
        if (e.kind === 'care') careActions++;
        if (e.kind === 'photo') photos++;
      });

      const g = growthSummary(p);
      // growth within the last ~30 days
      const recent = g.heightSeries.filter((s) => within(s.t));
      if (recent.length >= 2) {
        const gain = recent[recent.length - 1].v - recent[0].v;
        heightGain += Math.max(0, gain);
        if (gain > 0 && (!topGrower || gain > topGrower.cm)) topGrower = { name: p.name, cm: Math.round(gain * 10) / 10 };
      }
      const leaves = g.leavesSeries.filter((s) => within(s.t));
      if (leaves.length >= 2) leavesGain += Math.max(0, leaves[leaves.length - 1].v - leaves[0].v);
    }

    // Care streak (weeks with any logged action), same method as the You tab.
    const times: number[] = [];
    plants.forEach((p) => {
      (p.waterLog ?? []).forEach((w) => times.push(+new Date(w.at)));
      (p.growth ?? []).forEach((gr) => times.push(+new Date(gr.at)));
      p.timeline.filter((e) => e.kind === 'care' || e.kind === 'photo').forEach((e) => times.push(now - eventDaysAgo(e, now) * DAY));
    });
    const weeks = new Set(times.map((t) => Math.floor((now - t) / (7 * DAY))));
    let streak = 0;
    while (weeks.has(streak)) streak++;

    return { waterings, careActions, photos, heightGain: Math.round(heightGain * 10) / 10, leavesGain, topGrower, newPlants, streak };
  }, [plants, now]);

  const share = () => {
    const lines = [
      `🌿 My Greenr garden — ${monthName}`,
      `${plants.length} plants · ${stats.waterings} waterings logged · ${stats.streak}-week care streak`,
      stats.heightGain > 0 ? `📈 ${stats.heightGain} cm of new growth` : null,
      stats.topGrower ? `🌱 Top grower: ${stats.topGrower.name} (+${stats.topGrower.cm} cm)` : null,
    ].filter(Boolean);
    shareContent({ message: lines.join('\n'), title: 'My Greenr garden' });
  };

  const nothing = stats.waterings === 0 && stats.careActions === 0 && stats.heightGain === 0 && plants.length === 0;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Garden report</Text>
      </View>
      <Text style={[type.micro, { color: dark.inkMuted, marginLeft: 6, letterSpacing: 0.4 }]}>{monthName.toUpperCase()}</Text>

      {nothing ? (
        <Card style={{ marginTop: 16 }}>
          <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
            Your first monthly report builds as you add plants and log care. Come back once you&apos;ve
            watered a few times.
          </Text>
        </Card>
      ) : (
        <>
          {/* headline tiles */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
            <Tile value={`${plants.length}`} label="plants growing" color={accent.sage} />
            <Tile value={`${stats.waterings}`} label="waterings logged" color={accent.verdant} />
            <Tile value={`${stats.streak}`} label={`week streak`} color={accent.sage} />
            <Tile value={stats.heightGain > 0 ? `+${stats.heightGain}` : '—'} label="cm grown" color={accent.verdant} />
          </View>

          <SectionHeader>This month</SectionHeader>
          <Card>
            <Line icon="water" text={`${stats.waterings} watering${stats.waterings === 1 ? '' : 's'} logged`} />
            <Line icon="checkmark-circle-outline" text={`${stats.careActions} care action${stats.careActions === 1 ? '' : 's'} (feeding, misting, pruning…)`} />
            <Line icon="camera-outline" text={`${stats.photos} progress photo${stats.photos === 1 ? '' : 's'} taken`} />
            {stats.newPlants > 0 && <Line icon="add-circle-outline" text={`${stats.newPlants} new plant${stats.newPlants === 1 ? '' : 's'} added`} />}
            {stats.leavesGain > 0 && <Line icon="leaf-outline" text={`+${stats.leavesGain} new leaves counted`} />}
          </Card>

          {stats.topGrower && (
            <>
              <SectionHeader>Star of the month</SectionHeader>
              <Card>
                <Text style={[type.cardTitle, { color: dark.ink }]}>🌱 {stats.topGrower.name}</Text>
                <Text style={[type.caption, { color: dark.inkMuted, marginTop: 4 }]}>
                  Grew {stats.topGrower.cm} cm — the most in your garden this month.
                </Text>
              </Card>
            </>
          )}

          <GButton title="Share my garden" onPress={share} style={{ marginTop: 20 }} />
          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10, textAlign: 'center', lineHeight: 15 }]}>
            Everything here is from your own logged care and measurements — real, not estimated.
          </Text>
        </>
      )}
    </Screen>
  );
}

function Tile({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <View style={{ flexGrow: 1, minWidth: '45%', borderRadius: 14, borderWidth: 1, borderColor: dark.hairline, backgroundColor: dark.surface1, padding: 14 }}>
      <Text style={[type.numHero as any, { fontSize: 30, color }]}>{value}</Text>
      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>{label}</Text>
    </View>
  );
}

function Line({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 34 }}>
      <Ionicons name={icon as any} size={17} color={accent.verdant} />
      <Text style={[type.body, { color: dark.ink, flex: 1 }]}>{text}</Text>
    </View>
  );
}
