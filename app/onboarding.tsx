import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import AddPlantWizard from '@/components/greenr/AddPlantWizard';
import { Card, GButton, Screen } from '@/components/greenr/UI';
import { accent, light, type } from '@/constants/theme';
import { useGreenr } from '@/lib/store';

/**
 * First-launch onboarding (§2.2). O1 promise → O2–O5 add-plant wizard →
 * O6 the permission ask → lands on Forecast (O7's inline card lives there).
 * Goal: first Vitality Score in 90 seconds.
 */

type Phase = 'promise' | 'wizard' | 'permission';

export default function Onboarding() {
  const router = useRouter();
  const { addPlant, completeOnboarding } = useGreenr();
  const [phase, setPhase] = useState<Phase>('promise');

  const finish = () => {
    completeOnboarding();
    router.replace('/(tabs)');
  };

  if (phase === 'promise') {
    return (
      <Screen mode="light" scroll={false} style={{ justifyContent: 'flex-end', paddingBottom: 48 }}>
        {/* full-bleed plant photo stand-in */}
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '52%',
            backgroundColor: '#DDE5D2',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 110 }}>🪟🌿</Text>
        </View>
        <Text style={[type.ritualHeadline, { color: light.ink }]}>
          Know exactly how your plants are doing.
        </Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 12, lineHeight: 22 }]}>
          Greenr measures, scores, and forecasts your plants&apos; health — and briefs you once a
          week.
        </Text>
        <GButton title="Add your first plant" onPress={() => setPhase('wizard')} style={{ marginTop: 28 }} />
        <Pressable
          onPress={() => {
            // jumps to pairing (§2.2 O1), which loops back into add-plant via Assign
            completeOnboarding();
            router.replace('/(tabs)');
            router.push('/pair-sensor');
          }}
          style={{ marginTop: 14, minHeight: 44, justifyContent: 'center', alignSelf: 'center' }}
        >
          <Text style={[type.micro, { color: light.inkMuted }]}>I have a Greenr Sensor</Text>
        </Pressable>
      </Screen>
    );
  }

  if (phase === 'wizard') {
    return (
      <AddPlantWizard
        onDone={(plant) => {
          addPlant(plant);
          setPhase('permission');
        }}
      />
    );
  }

  // O6 — the permission ask (light)
  return (
    <Screen mode="light" scroll={false} style={{ justifyContent: 'center' }}>
      <Text style={[type.ritualTitle, { color: light.ink }]}>One briefing a week.</Text>
      <Text style={[type.body, { color: light.inkMuted, marginTop: 12, lineHeight: 22 }]}>
        Every Sunday: your garden&apos;s scores, what changed, and what needs you — about 10
        minutes of care. Between briefings, Greenr only interrupts for a genuine emergency.
      </Text>
      {/* preview render of a real briefing notification */}
      <Card mode="light" style={{ marginTop: 24 }}>
        <Text style={[type.micro, { color: light.inkMuted }]}>GREENR · Sunday 9:00</Text>
        <Text style={[type.cardTitle, { color: light.ink, marginTop: 4 }]}>Your Sunday briefing</Text>
        <Text style={[type.caption, { color: light.inkMuted, marginTop: 2 }]}>
          4 of 6 thriving · Calathea needs attention · ~11 min of care.
        </Text>
      </Card>
      <GButton title="Sounds right" onPress={finish} style={{ marginTop: 28 }} />
      <Pressable onPress={finish} style={{ marginTop: 12, minHeight: 44, justifyContent: 'center', alignSelf: 'center' }}>
        <Text style={[type.body, { color: accent.verdant }]}>Not now</Text>
      </Pressable>
    </Screen>
  );
}
