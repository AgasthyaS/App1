import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, GButton, Hairline, Screen } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, light, type } from '@/constants/theme';
import { gardenAverage, useGreenr } from '@/lib/store';

/** The Sunday briefing (§8.3) — a ritual, not an instrument. Light surface. */
export default function Briefing() {
  const router = useRouter();
  const { plants, tasks, sensors, markBriefingOpened } = useGreenr();

  useEffect(() => {
    markBriefingOpened();
  }, [markBriefingOpened]);

  const avg = gardenAverage(plants);
  const careMinutes = tasks.filter((t) => !t.done).reduce((a, t) => a + t.minutes, 0);
  const lowBattery = sensors.filter((s) => s.batteryPct < 20);
  const monstera = plants.find((p) => p.id === 'pl-monstera');
  const dateLine = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Screen mode="light">
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <View>
          <Text style={[type.micro, { color: light.inkMuted, letterSpacing: 1.2 }]}>
            {dateLine.toUpperCase()}
          </Text>
          <Text style={[type.ritualTitle, { color: light.ink, marginTop: 4 }]}>Your briefing</Text>
        </View>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}>
          <Ionicons name="close" size={24} color={light.inkMuted} />
        </Pressable>
      </View>

      {plants.length === 0 ? (
        <Card mode="light" style={{ marginTop: 16 }}>
          <Text style={[type.body, { color: light.inkMuted }]}>
            No plants yet — the briefing starts once your garden does.
          </Text>
        </Card>
      ) : (
        <>
          {/* garden headline */}
          <Card mode="light" style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <VitalityRing score={avg} size={72} trackColor={light.hairline} />
            <View style={{ flex: 1 }}>
              <Text style={[type.micro, { color: light.inkMuted }]}>GARDEN AVERAGE</Text>
              <Text style={[type.body, { color: light.ink, marginTop: 4, lineHeight: 21 }]}>
                <Text style={{ color: accent.verdant }}>Up 3 from last week.</Text>{' '}
                {plants.filter((p) => p.score >= 85).length} of {plants.length} thriving.
              </Text>
            </View>
          </Card>

          {/* what changed — 2–3 evidence sentences max */}
          <Card mode="light" style={{ marginTop: 10 }}>
            <Text style={[type.micro, { color: light.inkMuted }]}>WHAT CHANGED</Text>
            <Text style={[type.body, { color: light.ink, marginTop: 6, lineHeight: 22 }]}>
              Humidity recovered after you moved the humidifier — Fern +11.
            </Text>
            <Text style={[type.body, { color: light.ink, marginTop: 6, lineHeight: 22 }]}>
              Calathea: RH at Desk corner averaged 44% vs its 55% floor — the main driver of its
              slide to 61.
            </Text>
          </Card>

          {/* this week's care */}
          <Card mode="light" style={{ marginTop: 10 }}>
            <Text style={[type.micro, { color: light.inkMuted }]}>THIS WEEK&apos;S CARE</Text>
            {tasks.filter((t) => !t.done).map((t, i) => (
              <View key={t.id}>
                {i > 0 && <Hairline mode="light" style={{ marginVertical: 8 }} />}
                <Text style={[type.body, { color: light.ink, marginTop: i === 0 ? 6 : 0 }]}>{t.title}</Text>
              </View>
            ))}
            {tasks.filter((t) => !t.done).length === 0 && (
              <Text style={[type.body, { color: light.inkMuted, marginTop: 6 }]}>
                Nothing needs you this week.
              </Text>
            )}
            <Text style={[type.caption, { color: light.inkMuted, marginTop: 10 }]}>
              ~{careMinutes} min of care
            </Text>
          </Card>

          {/* records — only when earned */}
          {monstera && monstera.score >= 85 && (
            <Card mode="light" style={{ marginTop: 10 }}>
              <Text style={[type.micro, { color: light.inkMuted }]}>RECORDS</Text>
              <Text style={[type.body, { color: light.ink, marginTop: 6 }]}>
                Monstera: 60 days thriving — its longest run.
              </Text>
            </Card>
          )}

          {/* hardware notes */}
          {lowBattery.length > 0 && (
            <Card mode="light" style={{ marginTop: 10 }}>
              <Text style={[type.micro, { color: light.inkMuted }]}>HARDWARE</Text>
              {lowBattery.map((s) => (
                <Text key={s.id} style={[type.body, { color: light.ink, marginTop: 6 }]}>
                  {s.name}: {s.batteryEta} of battery left.
                </Text>
              ))}
            </Card>
          )}

          <GButton
            title="Start Care Mode"
            onPress={() => router.push('/care-mode')}
            style={{ marginTop: 20 }}
          />
        </>
      )}
    </Screen>
  );
}
