import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { GButton, Screen } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, light, type } from '@/constants/theme';
import { useGreenr } from '@/lib/store';
import { Profile } from '@/lib/types';

/**
 * Entry: sign in (simulated locally — no backend yet), then a 30-second
 * survey. The answers personalize the You tab and tune the care voice.
 */

type Step = 'auth' | 0 | 1 | 2 | 3;

const QUESTIONS: { key: keyof Pick<Profile, 'experience' | 'plantCount' | 'where' | 'struggle'>; title: string; sub: string; options: string[] }[] = [
  {
    key: 'experience',
    title: 'How long have you been gardening?',
    sub: 'No wrong answers — this tunes how much Greenr explains.',
    options: ['Just starting', 'Under a year', '1–5 years', '5+ years'],
  },
  {
    key: 'plantCount',
    title: 'How many plants live with you?',
    sub: 'A rough count is fine.',
    options: ['None yet', '1–3', '4–10', 'More than 10'],
  },
  {
    key: 'where',
    title: 'Where do they grow?',
    sub: 'Outdoor spots use live weather instead of indoor estimates.',
    options: ['Indoors', 'Outdoors', 'Both'],
  },
  {
    key: 'struggle',
    title: 'What goes wrong most often?',
    sub: 'Greenr watches this one hardest for you.',
    options: ['Watering', 'Light', 'Pests', 'Honestly, not sure'],
  },
];

export default function SignIn() {
  const router = useRouter();
  const { setProfile } = useGreenr();
  const [step, setStep] = useState<Step>('auth');
  const [email, setEmail] = useState('');
  const [method, setMethod] = useState<Profile['method']>('guest');
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const joined = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  const startSurvey = (m: Profile['method']) => {
    setMethod(m);
    setStep(0);
  };

  const answer = (key: string, value: string) => {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    if (typeof step === 'number' && step < QUESTIONS.length - 1) {
      setStep((step + 1) as Step);
    } else {
      const name =
        method === 'email' && email.includes('@')
          ? email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
          : method === 'guest'
            ? 'Gardener'
            : 'Gardener';
      setProfile({
        name,
        email: method === 'email' ? email.trim() : null,
        method,
        experience: next.experience ?? '—',
        plantCount: next.plantCount ?? '—',
        where: next.where ?? '—',
        struggle: next.struggle ?? '—',
        joined,
      });
      router.replace('/onboarding');
    }
  };

  if (step === 'auth') {
    return (
      <Screen mode="light" scroll={false} style={{ justifyContent: 'center' }}>
        <View style={{ alignItems: 'center', marginBottom: 28 }}>
          <VitalityRing score={88} size={72} showLabel={false} trackColor={light.hairline} />
          <Text style={[type.ritualHeadline, { color: light.ink, marginTop: 18, textAlign: 'center' }]}>
            greenr
          </Text>
          <Text style={[type.body, { color: light.inkMuted, marginTop: 6, textAlign: 'center' }]}>
            Know exactly how your plants are doing.
          </Text>
        </View>

        {(
          [
            ['logo-apple', 'Continue with Apple', 'apple'],
            ['logo-google', 'Continue with Google', 'google'],
          ] as [string, string, Profile['method']][]
        ).map(([icon, label, m]) => (
          <Pressable
            key={m}
            onPress={() => startSurvey(m)}
            style={({ pressed }) => ({
              minHeight: 52,
              borderRadius: 16,
              backgroundColor: light.surface1,
              borderWidth: 1,
              borderColor: light.hairline,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              marginTop: 10,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            })}
          >
            <Ionicons name={icon as any} size={18} color={light.ink} />
            <Text style={[type.cardTitle, { color: light.ink, fontSize: 15 }]}>{label}</Text>
          </Pressable>
        ))}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 18 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: light.hairline }} />
          <Text style={[type.micro, { color: light.inkMuted }]}>or</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: light.hairline }} />
        </View>

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@email.com"
          placeholderTextColor={light.inkMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          style={[
            type.body,
            {
              color: light.ink,
              backgroundColor: light.surface1,
              borderWidth: 1,
              borderColor: light.hairline,
              borderRadius: 16,
              paddingHorizontal: 16,
              minHeight: 52,
            },
          ]}
        />
        <GButton
          title="Continue with email"
          onPress={() => startSurvey('email')}
          disabled={!email.includes('@')}
          style={{ marginTop: 10 }}
        />

        <Pressable onPress={() => startSurvey('guest')} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 14 }}>
          <Text style={[type.body, { color: accent.verdant }]}>Continue as guest</Text>
        </Pressable>
        <Text style={[type.micro, { color: light.inkMuted, textAlign: 'center', marginTop: 8 }]}>
          Sign-in is stored on this device in this build — no account server yet.
        </Text>
      </Screen>
    );
  }

  const q = QUESTIONS[step];
  return (
    <Screen mode="light" scroll={false} style={{ justifyContent: 'center' }}>
      {/* progress dots */}
      <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 26 }}>
        {QUESTIONS.map((_, i) => (
          <View
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: i < step ? accent.verdant : i === step ? light.ink : light.hairline,
            }}
          />
        ))}
      </View>
      <Text style={[type.ritualTitle, { color: light.ink }]}>{q.title}</Text>
      <Text style={[type.body, { color: light.inkMuted, marginTop: 8 }]}>{q.sub}</Text>
      <View style={{ marginTop: 22, gap: 10 }}>
        {q.options.map((opt) => (
          <Pressable
            key={opt}
            onPress={() => answer(q.key, opt)}
            style={({ pressed }) => ({
              minHeight: 56,
              borderRadius: 16,
              backgroundColor: light.surface1,
              borderWidth: 1,
              borderColor: light.hairline,
              justifyContent: 'center',
              paddingHorizontal: 18,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            })}
          >
            <Text style={[type.cardTitle, { color: light.ink, fontSize: 16 }]}>{opt}</Text>
          </Pressable>
        ))}
      </View>
      {typeof step === 'number' && step > 0 && (
        <Pressable onPress={() => setStep((step - 1) as Step)} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 16 }}>
          <Text style={[type.body, { color: light.inkMuted }]}>Back</Text>
        </Pressable>
      )}
    </Screen>
  );
}
