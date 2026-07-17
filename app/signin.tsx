import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { GButton, Screen } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, light, type } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useGreenr } from '@/lib/store';
import { Profile } from '@/lib/types';

/**
 * Entry: real sign-in (Supabase — Google, email one-time code, or guest), then
 * a 30-second survey for new accounts. Returning accounts sync their profile
 * from the cloud and skip straight into the app.
 */

type Step = 'auth' | 'sent' | 'settling' | 0 | 1 | 2 | 3;

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
  const { setProfile, profile, hydrated } = useGreenr();
  const { user, enabled, sendMagicLink, signInWithGoogle } = useAuth();

  const [step, setStep] = useState<Step>('auth');
  const [email, setEmail] = useState('');
  const [method, setMethod] = useState<Profile['method']>('guest');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const joined = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  // Already fully set up (local profile, or one just synced from the cloud) →
  // into the app. The tabs gate handles the onboarding redirect from there.
  useEffect(() => {
    if (hydrated && profile) router.replace('/(tabs)');
  }, [hydrated, profile, router]);

  // Authenticated but no profile yet: could be a returning user whose profile
  // is still syncing, or a brand-new account. Give the cloud a beat, then show
  // the survey if nothing arrived.
  useEffect(() => {
    if (!user || profile) return;
    if (step !== 'auth' && step !== 'settling') return;
    setStep('settling');
    const provider = (user.app_metadata?.provider as string) || 'email';
    setMethod(provider === 'google' ? 'google' : 'email');
    const t = setTimeout(() => {
      setStep((s) => (s === 'settling' ? 0 : s));
    }, 1600);
    return () => clearTimeout(t);
  }, [user, profile, step]);

  const startSurvey = (m: Profile['method']) => {
    setMethod(m);
    setStep(0);
  };

  const onGoogle = async () => {
    setError(null);
    setBusy(true);
    const { error } = await signInWithGoogle();
    setBusy(false);
    if (error) setError(error);
    // On success the user effect above takes over (web redirects away entirely).
  };

  const onSendLink = async () => {
    setError(null);
    setBusy(true);
    const { error } = await sendMagicLink(email);
    setBusy(false);
    if (error) setError(error);
    else setStep('sent');
  };

  const answer = (key: string, value: string) => {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    if (typeof step === 'number' && step < QUESTIONS.length - 1) {
      setStep((step + 1) as Step);
    } else {
      const accountEmail = user?.email ?? (method === 'email' ? email.trim() : null);
      const name =
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name ||
        (accountEmail
          ? accountEmail.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
          : 'Gardener');
      setProfile({
        name,
        email: accountEmail,
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

  // Brief bridge while a returning user's cloud profile lands.
  if (step === 'settling') {
    return (
      <Screen mode="light" scroll={false} style={{ justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={accent.verdant} />
        <Text style={[type.body, { color: light.inkMuted, marginTop: 16 }]}>Setting up your garden…</Text>
      </Screen>
    );
  }

  // Magic link sent — the user finishes by tapping the link in their inbox.
  if (step === 'sent') {
    return (
      <Screen mode="light" scroll={false} style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Ionicons name="mail-outline" size={44} color={accent.verdant} />
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 18, textAlign: 'center' }]}>
          Check your email
        </Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 10, textAlign: 'center' }]}>
          We sent a sign-in link to {email}. Tap it and you'll be signed in — you can come right back here.
        </Text>
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 12, textAlign: 'center' }]}>
          No email after a minute? Check spam, or try again.
        </Text>
        {error && <Text style={[type.micro, { color: '#C0392B', marginTop: 10 }]}>{error}</Text>}
        <Pressable
          onPress={() => { setStep('auth'); setError(null); }}
          style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 18 }}
        >
          <Text style={[type.body, { color: accent.verdant }]}>Use a different email</Text>
        </Pressable>
      </Screen>
    );
  }

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

        {/* Apple — coming with the native app; needs the paid Apple Developer account. */}
        <Pressable
          disabled
          style={{
            minHeight: 52,
            borderRadius: 16,
            backgroundColor: light.surface1,
            borderWidth: 1,
            borderColor: light.hairline,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            opacity: 0.45,
          }}
        >
          <Ionicons name="logo-apple" size={18} color={light.ink} />
          <Text style={[type.cardTitle, { color: light.ink, fontSize: 15 }]}>Apple — coming soon</Text>
        </Pressable>

        <Pressable
          onPress={onGoogle}
          disabled={busy || !enabled}
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
            opacity: enabled ? 1 : 0.45,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          <Ionicons name="logo-google" size={18} color={light.ink} />
          <Text style={[type.cardTitle, { color: light.ink, fontSize: 15 }]}>
            {busy ? 'Opening Google…' : 'Continue with Google'}
          </Text>
        </Pressable>

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
        {error && <Text style={[type.micro, { color: '#C0392B', marginTop: 10 }]}>{error}</Text>}
        <GButton
          title={busy ? 'Sending link…' : 'Continue with email'}
          onPress={enabled ? onSendLink : () => startSurvey('email')}
          disabled={busy || !email.includes('@')}
          style={{ marginTop: 10 }}
        />

        <Pressable onPress={() => startSurvey('guest')} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 14 }}>
          <Text style={[type.body, { color: accent.verdant }]}>Continue as guest</Text>
        </Pressable>
        <Text style={[type.micro, { color: light.inkMuted, textAlign: 'center', marginTop: 8 }]}>
          {enabled
            ? 'Guest gardens stay on this device. Sign in to save yours to your account.'
            : 'Sign-in is stored on this device in this build — no account server yet.'}
        </Text>
        <Text style={[type.micro, { color: light.inkMuted, textAlign: 'center', marginTop: 14, lineHeight: 16 }]}>
          By continuing you agree to our{' '}
          <Text style={{ color: accent.verdant }} onPress={() => router.push('/terms' as any)}>
            Terms
          </Text>{' '}
          and{' '}
          <Text style={{ color: accent.verdant }} onPress={() => router.push('/privacy' as any)}>
            Privacy Policy
          </Text>
          .
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
