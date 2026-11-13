import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';

import ObservationCard from '@/components/greenr/ObservationCard';
import { Card, GButton, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { applyCalibration, calibrationFor } from '@/lib/calibration';
import { checkup, unexplainedText } from '@/lib/checkup';
import { storedLightAvg } from '@/lib/insights';
import { OBSERVATION_LABEL } from '@/lib/observations';
import { useGreenr } from '@/lib/store';
import { useLiveReading } from '@/lib/useLiveReading';

/**
 * Check-up: what the sensors show, what you see, and where the two meet.
 *
 * No photo analysis and no percentages — see lib/checkup.ts for why, and for the
 * (short, published) list of symptom-and-condition pairings it draws on.
 */
export default function Checkup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { plants, calibrations, lightDaily, settings, addDiagnosis } = useGreenr();
  const plant = plants.find((p) => p.id === id);
  const { reading, deviceId } = useLiveReading(plant?.id);

  const result = useMemo(() => {
    if (!plant) return null;
    const cal = calibrationFor(calibrations, deviceId, plant.sensorId);
    return checkup({
      plant,
      reading: reading && cal ? applyCalibration(reading, cal) : reading,
      lightAvg: storedLightAvg(lightDaily[plant.id])?.avg ?? null,
      unitsF: settings.unitsF,
    });
  }, [plant, reading, deviceId, calibrations, lightDaily, settings.unitsF]);

  if (!plant || !result) {
    return (
      <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.body, { color: dark.inkMuted }]}>That plant is no longer in your garden.</Text>
        <GButton title="Go back" kind="secondary" onPress={() => router.back()} style={{ marginTop: 16 }} />
      </Screen>
    );
  }

  const toneColor = (t: string) => (t === 'good' ? accent.sage : t === 'warn' ? accent.sunbeam : t === 'bad' ? accent.clay : dark.inkMuted);
  const toneIcon = (t: string) => (t === 'good' ? 'checkmark-circle' : t === 'unknown' ? 'help-circle' : 'alert-circle');
  const offCount = result.measured.filter((m) => m.tone === 'warn' || m.tone === 'bad').length;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Close" style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="close" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24, flex: 1 }]} numberOfLines={1}>Check-up · {plant.name}</Text>
      </View>

      <SectionHeader>What the sensors show</SectionHeader>
      {result.noSensor ? (
        <Card>
          <Text style={[type.body, { color: dark.ink }]}>No sensor readings for this plant.</Text>
          <Text style={[type.caption, { color: dark.inkMuted, marginTop: 4, lineHeight: 19 }]}>
            Without a sensor Greenr cannot check its conditions. You can still note what you see below, and it
            is kept in the plant’s history.
          </Text>
        </Card>
      ) : (
        <Card>
          <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]}>
            {offCount === 0 ? 'Everything measured is in range' : `${offCount} of ${result.measured.length} measurements out of range`}
          </Text>
          {result.measured.map((m) => (
            <View key={m.key} style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Ionicons name={toneIcon(m.tone) as any} size={18} color={toneColor(m.tone)} style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={[type.body, { color: dark.ink }]}>{m.label}</Text>
                  <Text style={[type.body, { color: dark.inkMuted, fontVariant: ['tabular-nums'] }]}>{m.value}</Text>
                </View>
                <Text style={[type.caption, { color: dark.inkMuted, lineHeight: 18 }]}>{m.detail}</Text>
              </View>
            </View>
          ))}
          <Text style={[type.micro, { color: dark.inkMuted, lineHeight: 16, marginTop: 12 }]}>
            In-range conditions do not prove a plant is healthy. They rule out the causes a sensor can see.
          </Text>
        </Card>
      )}

      <ObservationCard plant={plant} />

      {(result.leads.length > 0 || result.unexplained.length > 0) && (
        <>
          <SectionHeader>Worth checking</SectionHeader>
          {result.leads.map((l) => (
            <Card key={`${l.symptom}-${l.with}`} style={{ marginBottom: 10 }} accentBorder={accent.sunbeam}>
              <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]}>{l.title}</Text>
              <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4, lineHeight: 16 }]}>
                You noted {OBSERVATION_LABEL[l.symptom].toLowerCase()} · {l.basis}
              </Text>
              <Text style={[type.caption, { color: dark.ink, marginTop: 8, lineHeight: 19 }]}>{l.check}</Text>
            </Card>
          ))}
          {result.unexplained.length > 0 && (
            <Card>
              <Text style={[type.caption, { color: dark.ink, lineHeight: 19 }]}>{unexplainedText(result.unexplained)}</Text>
            </Card>
          )}
          <Text style={[type.micro, { color: dark.inkMuted, lineHeight: 16, marginTop: 10, marginHorizontal: 4 }]}>
            These pair what you reported with a measured condition that commonly causes it. They are leads, not a
            diagnosis: the same symptom often has more than one cause.
          </Text>
          {result.leads.length > 0 && (
            <GButton
              title="Save to this plant’s history"
              kind="secondary"
              style={{ marginTop: 14 }}
              track="checkup.save"
              onPress={() => {
                addDiagnosis(plant.id, `Check-up: ${result.leads.map((l) => l.title.toLowerCase()).join('; ')}.`);
                router.back();
              }}
            />
          )}
        </>
      )}
    </Screen>
  );
}
