import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, Text, View } from 'react-native';

import Sparkline from '@/components/greenr/Sparkline';
import { Card, Row, Screen, SectionHeader, StatusDot } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, dark, type } from '@/constants/theme';
import { activePlants, gardenAverage, useGreenr } from '@/lib/store';

/** You tab (§11) — identity, the stats band, collection, devices, Plus, settings. */
export default function YouTab() {
  const router = useRouter();
  const { plants: allPlants, sensors, spots, accuracy, settings, profile } = useGreenr();
  const plants = activePlants(allPlants);
  const avg = gardenAverage(plants);
  const hits = accuracy.filter((a) => a.hit).length;
  const accuracyPct = accuracy.length ? Math.round((hits / accuracy.length) * 100) : null;
  const name = profile?.name ?? 'Gardener';

  return (
    <Screen>
      {/* identity header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: dark.surface2,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: dark.hairline,
          }}
        >
          <Text style={[type.cardTitle, { color: dark.ink }]}>{name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[type.caption, { color: dark.inkMuted }]}>
            {profile
              ? `${profile.experience} of gardening · joined ${profile.joined}`
              : 'Gardener'}
          </Text>
        </View>
        {plants.length > 0 && <VitalityRing score={avg} size={56} />}
      </View>

      {/* stats band */}
      <SectionHeader>Stats</SectionHeader>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        <Card style={{ width: 180 }}>
          <Text style={[type.micro, { color: dark.inkMuted }]}>GARDEN VITALITY</Text>
          <Text style={[type.numHero as any, { fontSize: 32, color: dark.ink, marginTop: 6 }]}>
            {plants.length ? avg : '—'}
          </Text>
          {plants.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Sparkline trend14={plants[0]?.scoreTrend14 ?? []} width={60} height={18} color={accent.sage} />
            </View>
          )}
          {plants.some((p) => p.estimate) && (
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 8, lineHeight: 14 }]}>
              Partly estimated — a prediction, not a promise.
            </Text>
          )}
        </Card>
        <Card style={{ width: 180 }}>
          <Text style={[type.micro, { color: dark.inkMuted }]}>CARE CONSISTENCY</Text>
          <Text style={[type.numHero as any, { fontSize: 32, color: dark.ink, marginTop: 6 }]}>
            {plants.length ? '92%' : '—'}
          </Text>
          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6 }]}>
            verified care within a day of forecast, 12 weeks
          </Text>
        </Card>
        <Card style={{ width: 200 }} onPress={() => router.push('/accuracy')}>
          <Text style={[type.micro, { color: dark.inkMuted }]}>FORECAST ACCURACY</Text>
          <Text style={[type.numBold as any, { fontSize: 30, color: dark.ink, marginTop: 6 }]}>
            {accuracyPct != null ? `${accuracyPct}%` : '—'}
          </Text>
          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6 }]}>
            {accuracyPct != null
              ? `on your garden (±1 day, 90 d) — tap for the ledger`
              : 'builds as forecasts resolve'}
          </Text>
        </Card>
        <Card style={{ width: 200 }}>
          <Text style={[type.micro, { color: dark.inkMuted }]}>RECORDS</Text>
          {plants.length ? (
            <View style={{ marginTop: 6, gap: 4 }}>
              <Text style={[type.caption, { color: dark.ink }]}>Longest thriving run: 60 d</Text>
              <Text style={[type.caption, { color: dark.ink }]}>Plants rescued: 1</Text>
              <Text style={[type.caption, { color: dark.ink }]}>Verified waterings: 48</Text>
            </View>
          ) : (
            <Text style={[type.caption, { color: dark.inkMuted, marginTop: 6 }]}>none yet</Text>
          )}
        </Card>
        {plants.some((p) => p.estimate) && (
          <Card
            elevated
            style={{ width: 200, justifyContent: 'center' }}
            onPress={() => router.push('/pair-sensor')}
          >
            <Text style={[type.micro, { color: accent.verdant }]}>GREENR SENSOR</Text>
            <Text style={[type.cardTitle, { color: dark.ink, marginTop: 6, lineHeight: 22 }]}>
              These numbers are educated guesses.
            </Text>
            <Text style={[type.caption, { color: dark.inkMuted, marginTop: 4 }]}>
              A sensor in the soil makes them measurements →
            </Text>
          </Card>
        )}
      </ScrollView>
      {plants.some((p) => p.estimate) && (
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 8, lineHeight: 15 }]}>
          Stats on estimated plants are model predictions and can be off — Greenr says so rather
          than pretending. Sensors close the gap.
        </Text>
      )}

      {/* collection summary */}
      <SectionHeader>Collection</SectionHeader>
      <Card>
        <Row title={`${plants.length} plants`} value="Garden →" onPress={() => router.push('/garden')} />
        <Row title={`${sensors.length} sensors`} value="Devices →" onPress={() => router.push('/devices')} />
        <Row title={`${spots.length} spots`} value="Home →" onPress={() => router.push('/home')} />
      </Card>

      {/* devices */}
      <SectionHeader>Devices</SectionHeader>
      <Card>
        {sensors.length === 0 && (
          <Text style={[type.caption, { color: dark.inkMuted }]}>No sensors yet.</Text>
        )}
        {sensors.map((s) => (
          <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
            <Text
              style={[type.body, { color: dark.ink, flex: 1 }]}
              onPress={() => router.push(`/sensor/${s.id}`)}
            >
              {s.name}
            </Text>
            <Text style={[type.caption, { color: dark.inkMuted, marginRight: 10 }]}>{s.batteryPct}%</Text>
            <StatusDot status={s.status} />
          </View>
        ))}
        <Row title="Add sensor" onPress={() => router.push('/pair-sensor')} />
      </Card>

      {/* Greenr+ */}
      <SectionHeader>Greenr+</SectionHeader>
      <Card onPress={() => router.push('/plus')} elevated>
        {settings.plus ? (
          <Text style={[type.body, { color: dark.ink }]}>Plus · active</Text>
        ) : (
          <>
            <Text style={[type.cardTitle, { color: dark.ink }]}>See 10 days ahead</Text>
            <Text style={[type.caption, { color: dark.inkMuted, marginTop: 4 }]}>
              Forecasts beyond 48 h · full history · diagnostics
            </Text>
          </>
        )}
      </Card>

      {/* settings */}
      <SectionHeader>Settings</SectionHeader>
      <Card>
        <Row title="Settings" value="→" onPress={() => router.push('/settings')} />
        <Row title="How Greenr calculates" value="→" onPress={() => router.push('/methodology')} />
      </Card>
    </Screen>
  );
}
