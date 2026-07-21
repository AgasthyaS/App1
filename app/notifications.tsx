import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';

import { Card, Hairline, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { buildNotificationFeed, type FeedItem } from '@/lib/notificationCenter';
import { activePlants, useGreenr } from '@/lib/store';
import { useAllLiveReadings, useAllReadingHistories } from '@/lib/useLiveReading';

function whenLabel(at: number | null): string {
  if (at == null) return 'now';
  const d = new Date(at);
  const diff = at - Date.now();
  if (diff > 0) {
    const h = Math.round(diff / 3600000);
    if (h < 1) return 'soon';
    if (h < 24) return `in ${h} h`;
    return d.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }
  const ago = Date.now() - at;
  const days = Math.floor(ago / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} d ago`;
}

function FeedRow({ item, color }: { item: FeedItem; color: string }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/plant/${item.plantId}` as any)}
      style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 10 }}
    >
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: `${color}22`, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
        <Ionicons name={item.icon as any} size={16} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.caption, { color: dark.ink, lineHeight: 19 }]}>{item.title}</Text>
        {item.body ? (
          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, lineHeight: 15 }]} numberOfLines={2}>
            {item.body}
          </Text>
        ) : null}
      </View>
      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>{whenLabel(item.at)}</Text>
    </Pressable>
  );
}

export default function NotificationCenter() {
  const router = useRouter();
  const { plants, spots, settings, calibrations, lightDaily, setSettings } = useGreenr();
  const readings = useAllLiveReadings();
  const histories = useAllReadingHistories();

  const feed = useMemo(
    () => buildNotificationFeed({ plants, spots, readings, histories, calibrations, lightDaily, settings }),
    [plants, spots, readings, histories, calibrations, lightDaily, settings],
  );

  const muted = new Set(settings.mutedPlantIds ?? []);
  const toggleMute = (id: string) => {
    const next = new Set(muted);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSettings({ mutedPlantIds: [...next] });
  };

  const empty = feed.now.length === 0 && feed.upcoming.length === 0 && feed.recent.length === 0;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Notifications</Text>
      </View>

      {empty && (
        <Card style={{ marginTop: 16 }}>
          <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
            All clear — nothing needs you, nothing scheduled, no recent activity. Alerts and reminders
            show up here as they happen.
          </Text>
        </Card>
      )}

      {feed.now.length > 0 && (
        <>
          <SectionHeader>Needs attention</SectionHeader>
          <Card>
            {feed.now.map((i, idx) => (
              <View key={i.id}>
                {idx > 0 && <Hairline />}
                <FeedRow item={i} color={accent.clay} />
              </View>
            ))}
          </Card>
        </>
      )}

      {feed.upcoming.length > 0 && (
        <>
          <SectionHeader>Coming up</SectionHeader>
          <Card>
            {feed.upcoming.map((i, idx) => (
              <View key={i.id}>
                {idx > 0 && <Hairline />}
                <FeedRow item={i} color={accent.verdant} />
              </View>
            ))}
          </Card>
          {!settings.remindersEnabled && (
            <Pressable onPress={() => router.push('/settings')} style={{ minHeight: 40, justifyContent: 'center', marginTop: 6 }}>
              <Text style={[type.caption, { color: accent.verdant }]}>
                Turn on reminders in Settings to actually receive these →
              </Text>
            </Pressable>
          )}
        </>
      )}

      {feed.recent.length > 0 && (
        <>
          <SectionHeader>Recent activity</SectionHeader>
          <Card>
            {feed.recent.map((i, idx) => (
              <View key={i.id}>
                {idx > 0 && <Hairline />}
                <FeedRow item={i} color={dark.inkMuted} />
              </View>
            ))}
          </Card>
        </>
      )}

      {/* per-plant mute */}
      {activePlants(plants).length > 0 && (
        <>
          <SectionHeader>Mute a plant</SectionHeader>
          <Card>
            <Text style={[type.micro, { color: dark.inkMuted, lineHeight: 15, marginBottom: 6 }]}>
              Muted plants never send reminders or alerts (their data is still tracked).
            </Text>
            {activePlants(plants).map((p, idx) => (
              <View key={p.id}>
                {idx > 0 && <Hairline />}
                <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 10 }}>
                  <Text style={{ fontSize: 18 }}>{p.emoji}</Text>
                  <Text style={[type.body, { color: dark.ink, flex: 1 }]} numberOfLines={1}>{p.name}</Text>
                  <Switch
                    value={!muted.has(p.id)}
                    onValueChange={() => toggleMute(p.id)}
                    trackColor={{ true: accent.verdant, false: dark.hairline }}
                    thumbColor="#fff"
                  />
                </View>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
