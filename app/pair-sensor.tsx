import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Card, GButton, Screen } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, dark, light, type } from '@/constants/theme';
import { useGreenr } from '@/lib/store';

/**
 * Sensor pairing S1–S9 (§5.1). Hardware is simulated: discovery, Wi-Fi,
 * linking, and both calibration points run on timers, but every screen,
 * state, and line of copy follows the spec.
 */

type Step =
  | 'intro' // S1
  | 'wake' // S2
  | 'search' // S3
  | 'wifi' // S4
  | 'linking' // S5
  | 'calDry' // S6
  | 'calWet' // S7
  | 'assign' // S8
  | 'upgrade'; // S9

const SENSOR_NAME = 'Greenr-4F2A';

function LiveCalibration({
  title,
  caption,
  baseValue,
  onStable,
}: {
  title: string;
  caption: string;
  baseValue: number;
  onStable: () => void;
}) {
  const [value, setValue] = useState(baseValue);
  const [stability, setStability] = useState(0);
  const started = useRef(Date.now());

  useEffect(() => {
    started.current = Date.now();
    const t = setInterval(() => {
      const elapsed = (Date.now() - started.current) / 1000;
      const settle = Math.min(1, elapsed / 3); // 3 s of stability required
      setValue(Math.round(baseValue + (1 - settle) * (Math.random() - 0.5) * 220));
      setStability(settle);
      if (settle >= 1) {
        clearInterval(t);
        setTimeout(onStable, 400); // auto-advance
      }
    }, 120);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseValue]);

  return (
    <Screen mode="light" scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Text style={[type.ritualTitle, { color: light.ink, textAlign: 'center' }]}>{title}</Text>
      <Text style={[type.body, { color: light.inkMuted, textAlign: 'center', marginTop: 10, paddingHorizontal: 12 }]}>
        {caption}
      </Text>
      <Text style={[type.numBold as any, { fontSize: 56, color: light.ink, marginTop: 36 }]}>
        {value}
      </Text>
      <Text style={[type.micro, { color: light.inkMuted }]}>raw reading</Text>
      <View style={{ width: '70%', height: 6, borderRadius: 3, backgroundColor: light.hairline, marginTop: 24 }}>
        <View style={{ width: `${stability * 100}%`, height: 6, borderRadius: 3, backgroundColor: accent.verdant }} />
      </View>
      <Text style={[type.micro, { color: light.inkMuted, marginTop: 8 }]}>
        {stability >= 1 ? 'Stable.' : 'Waiting for readings to settle…'}
      </Text>
    </Screen>
  );
}

export default function PairSensor() {
  const router = useRouter();
  const { plants, spots, pairSensor } = useGreenr();
  const [step, setStep] = useState<Step>('intro');
  const [found, setFound] = useState(false);
  const [password, setPassword] = useState('');
  const [linkTicks, setLinkTicks] = useState(0);
  const [plantId, setPlantId] = useState<string | null>(null);

  const plant = plants.find((p) => p.id === plantId);
  const spotOf = (id?: string) => spots.find((s) => s.id === id)?.name ?? '—';

  useEffect(() => {
    if (step === 'search') {
      setFound(false);
      const t = setTimeout(() => setFound(true), 2200);
      return () => clearTimeout(t);
    }
    if (step === 'linking') {
      setLinkTicks(0);
      const t = setInterval(() => setLinkTicks((n) => n + 1), 1100);
      return () => clearInterval(t);
    }
  }, [step]);

  useEffect(() => {
    if (step === 'linking' && linkTicks >= 3) {
      const t = setTimeout(() => setStep('calDry'), 500);
      return () => clearTimeout(t);
    }
  }, [step, linkTicks]);

  // S1 — intro
  if (step === 'intro') {
    return (
      <Screen mode="light" scroll={false} style={{ justifyContent: 'center' }}>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 84 }}>📡</Text>
          <Text style={[type.ritualTitle, { color: light.ink, marginTop: 20, textAlign: 'center' }]}>
            Add your Greenr Sensor.
          </Text>
          <Text style={[type.body, { color: light.inkMuted, marginTop: 10, textAlign: 'center' }]}>
            Takes about two minutes: connect, calibrate, assign.
          </Text>
        </View>
        <GButton title="Begin" onPress={() => setStep('wake')} style={{ marginTop: 32 }} />
        <GButton
          title="Scan a QR code instead"
          kind="secondary"
          mode="light"
          onPress={() => { router.dismiss(); router.push('/pair-device' as any); }}
          style={{ marginTop: 10 }}
        />
        <Pressable onPress={() => router.back()} style={{ alignSelf: 'center', marginTop: 12, minHeight: 44, justifyContent: 'center' }}>
          <Text style={[type.body, { color: light.inkMuted }]}>Cancel</Text>
        </Pressable>
      </Screen>
    );
  }

  // S2 — wake it
  if (step === 'wake') {
    return (
      <Screen mode="light" scroll={false} style={{ justifyContent: 'center' }}>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 72 }}>👆</Text>
          <Text style={[type.ritualTitle, { color: light.ink, marginTop: 20, textAlign: 'center' }]}>
            Wake it.
          </Text>
          <Text style={[type.body, { color: light.inkMuted, marginTop: 10, textAlign: 'center' }]}>
            Hold the button for 3 seconds until the light pulses green.
          </Text>
        </View>
        <GButton title="It's pulsing" onPress={() => setStep('search')} style={{ marginTop: 32 }} />
      </Screen>
    );
  }

  // S3 — searching
  if (step === 'search') {
    return (
      <Screen mode="light" scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <VitalityRing score={found ? 100 : 35} size={120} showLabel={false} trackColor={light.hairline} />
        <Text style={[type.body, { color: light.inkMuted, marginTop: 20 }]}>
          {found ? 'Found one.' : 'Searching nearby…'}
        </Text>
        {found && (
          <Card mode="light" style={{ marginTop: 20, width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12 }} onPress={() => setStep('wifi')}>
            <Ionicons name="checkmark-circle" size={24} color={accent.sage} />
            <View style={{ flex: 1 }}>
              <Text style={[type.cardTitle, { color: light.ink }]}>{SENSOR_NAME} found</Text>
              <Text style={[type.caption, { color: light.inkMuted }]}>Tap to connect</Text>
            </View>
          </Card>
        )}
        {!found && (
          <Text style={[type.micro, { color: light.inkMuted, marginTop: 30, textAlign: 'center' }]}>
            Still asleep? Hold 3 s again · Make sure you&apos;re within a few feet.
          </Text>
        )}
      </Screen>
    );
  }

  // S4 — Wi-Fi
  if (step === 'wifi') {
    return (
      <Screen mode="light">
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>
          Connect {SENSOR_NAME} to your Wi-Fi.
        </Text>
        <Card mode="light" style={{ marginTop: 20 }}>
          <Text style={[type.micro, { color: light.inkMuted }]}>NETWORK</Text>
          <Text style={[type.cardTitle, { color: light.ink, marginTop: 4 }]}>Home-2.4GHz</Text>
        </Card>
        <Card mode="light" style={{ marginTop: 10 }}>
          <Text style={[type.micro, { color: light.inkMuted }]}>PASSWORD</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={light.inkMuted}
            style={[type.cardTitle, { color: light.ink, marginTop: 4, minHeight: 32 }]}
          />
        </Card>
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 10, lineHeight: 16 }]}>
          Sensors see 2.4 GHz networks only — if yours is 5 GHz, most routers broadcast both.
        </Text>
        <GButton title="Connect" onPress={() => setStep('linking')} disabled={password.length < 4} style={{ marginTop: 24 }} />
      </Screen>
    );
  }

  // S5 — linking checklist
  if (step === 'linking') {
    const items = ['Joined your Wi-Fi', 'Reached Greenr', 'Registered to your account'];
    return (
      <Screen mode="light" scroll={false} style={{ justifyContent: 'center' }}>
        {items.map((label, i) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
            <Ionicons
              name={linkTicks > i ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={linkTicks > i ? accent.sage : light.inkMuted}
            />
            <Text style={[type.body, { color: linkTicks > i ? light.ink : light.inkMuted }]}>{label}</Text>
          </View>
        ))}
      </Screen>
    );
  }

  // S6 — dry point
  if (step === 'calDry') {
    return (
      <LiveCalibration
        title="Every instrument gets calibrated."
        caption="Hold the probe in the air. This teaches the sensor what completely dry reads as."
        baseValue={2870}
        onStable={() => setStep('calWet')}
      />
    );
  }

  // S7 — wet point
  if (step === 'calWet') {
    return (
      <LiveCalibration
        title="Now the wet point."
        caption="Stand the probe in a glass of water — electronics stay above the line."
        baseValue={1180}
        onStable={() => setStep('assign')}
      />
    );
  }

  // S8 — assign
  if (step === 'assign') {
    return (
      <Screen mode="light">
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>
          Which plant does this sensor live with?
        </Text>
        <Text style={[type.caption, { color: accent.verdant, marginTop: 8 }]}>
          Calibrated. Accuracy: instrument-grade for this probe.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
          {plants.filter((p) => !p.archived).map((p) => (
            <Card
              key={p.id}
              mode="light"
              style={{
                width: '48%',
                alignItems: 'center',
                borderWidth: 2,
                borderColor: plantId === p.id ? accent.verdant : 'transparent',
                opacity: p.sensorId ? 0.4 : 1,
              }}
              onPress={() => !p.sensorId && setPlantId(p.id)}
            >
              <Text style={{ fontSize: 30 }}>{p.emoji}</Text>
              <Text style={[type.cardTitle, { color: light.ink, marginTop: 6 }]} numberOfLines={1}>
                {p.name}
              </Text>
              <Text style={[type.micro, { color: light.inkMuted }]} numberOfLines={1}>
                {p.sensorId ? 'has a sensor' : spotOf(p.spotId)}
              </Text>
            </Card>
          ))}
          {/* a brand-new plant — loops through the add-plant flow (§5.1 S8) */}
          <Card
            mode="light"
            style={{ width: '48%', alignItems: 'center', borderWidth: 2, borderColor: 'transparent' }}
            onPress={() => {
              router.dismiss();
              router.push('/add-plant');
            }}
          >
            <Ionicons name="add-circle-outline" size={30} color={accent.verdant} />
            <Text style={[type.cardTitle, { color: accent.verdant, marginTop: 6 }]} numberOfLines={1}>
              New plant
            </Text>
            <Text style={[type.micro, { color: light.inkMuted }]} numberOfLines={1}>
              add it first, then pair
            </Text>
          </Card>
        </View>
        {plants.filter((p) => !p.archived).length === 0 && (
          <Card mode="light" style={{ marginTop: 4 }}>
            <Text style={[type.body, { color: light.inkMuted }]}>
              No plants yet — the sensor needs one to live with.
            </Text>
            <GButton
              title="Add a plant first"
              kind="secondary"
              mode="light"
              onPress={() => {
                router.dismiss();
                router.push('/add-plant');
              }}
              style={{ marginTop: 10 }}
            />
          </Card>
        )}
        {plant && (
          <Text style={[type.caption, { color: light.inkMuted, marginTop: 16 }]}>
            {plant.name} · {spotOf(plant.spotId)} — correct?
          </Text>
        )}
        <GButton
          title="Assign"
          disabled={!plant}
          onPress={() => {
            if (plantId) pairSensor(plantId);
            setStep('upgrade');
          }}
          style={{ marginTop: 12 }}
        />
      </Screen>
    );
  }

  // S9 — the upgrade moment (dark)
  return (
    <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
      <VitalityRing score={plant?.score ?? 76} size={120} subLabel="Stable">
        <Text style={{ fontSize: 34, position: 'absolute', opacity: 0.18 }}>{plant?.emoji ?? '🌿'}</Text>
      </VitalityRing>
      <Text style={[type.screenTitle, { color: dark.ink, marginTop: 18 }]}>
        Estimates ended.
      </Text>
      <Text style={[type.screenTitle, { color: dark.ink }]}>Measurements began.</Text>
      <Text style={[type.caption, { color: dark.inkMuted, marginTop: 14, textAlign: 'center', paddingHorizontal: 24 }]}>
        First reading within 3 hours; Greenr will backfill the score.
      </Text>
      <GButton
        title="Done"
        onPress={() => router.dismiss()}
        style={{ marginTop: 28, alignSelf: 'stretch' }}
      />
    </Screen>
  );
}
