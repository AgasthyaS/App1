import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Card, GButton, Row, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { confirmAction, notify, shareContent } from '@/lib/platform';
import { useGreenr } from '@/lib/store';
import { supabase } from '@/lib/supabase';


type MfaState = 'unknown' | 'off' | 'on' | 'enrolling';

export default function Security() {
  const router = useRouter();
  const greenr = useGreenr();
  const { settings, setSettings, resetApp } = greenr;
  const { user, enabled, deleteAccount, signOut } = useAuth();

  const [mfa, setMfa] = useState<MfaState>('unknown');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const mfaApi = (supabase as any)?.auth?.mfa;

  useEffect(() => {
    if (!mfaApi || !user) { setMfa('off'); return; }
    mfaApi.listFactors().then((res: any) => {
      const verified = (res?.data?.totp ?? []).some((f: any) => f.status === 'verified');
      setMfa(verified ? 'on' : 'off');
    }).catch(() => setMfa('off'));
  }, [mfaApi, user]);

  const startEnroll = async () => {
    if (!mfaApi) { setNote('Two-factor sign-in isn’t available on this build yet.'); return; }
    setBusy(true); setNote(null);
    try {
      const { data, error } = await mfaApi.enroll({ factorType: 'totp' });
      if (error) throw error;
      setFactorId(data.id);
      setSecret(data.totp?.secret ?? null);
      setMfa('enrolling');
    } catch (e: any) {
      setNote(e?.message ?? 'Could not start two-factor setup.');
    } finally { setBusy(false); }
  };

  const verifyEnroll = async () => {
    if (!mfaApi || !factorId) return;
    setBusy(true); setNote(null);
    try {
      const ch = await mfaApi.challenge({ factorId });
      if (ch.error) throw ch.error;
      const { error } = await mfaApi.verify({ factorId, challengeId: ch.data.id, code: code.trim() });
      if (error) throw error;
      setMfa('on'); setSecret(null); setCode('');
      notify('Two-factor authentication is on.');
    } catch (e: any) {
      setNote(e?.message ?? 'That code didn’t match. Try the current one from your app.');
    } finally { setBusy(false); }
  };

  const disableMfa = async () => {
    if (!mfaApi) return;
    const factors = await mfaApi.listFactors();
    const f = (factors?.data?.totp ?? [])[0];
    if (f) await mfaApi.unenroll({ factorId: f.id });
    setMfa('off');
  };

  const signOutEverywhere = () => {
    confirmAction({
      title: 'Sign out of all devices?',
      message: 'You’ll need to sign in again everywhere.',
      confirmLabel: 'Sign out all',
      onConfirm: async () => {
        try { await (supabase as any)?.auth?.signOut({ scope: 'global' }); } catch { /* fall back */ }
        await signOut();
        router.replace('/(tabs)');
      },
    });
  };

  const exportAll = () => {
    shareContent({
      message: JSON.stringify({ exportedAt: new Date().toISOString(), plants: greenr.plants, spots: greenr.spots, settings: greenr.settings }, null, 2),
      title: 'Greenr export', filename: 'greenr-export.json',
    });
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Security &amp; privacy</Text>
      </View>

      <SectionHeader>Account</SectionHeader>
      <Card>
        <Text style={[type.body, { color: dark.ink }]}>{user?.email ?? 'Guest (this device only)'}</Text>
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>
          {enabled ? (user ? 'Signed in — synced to your account' : 'Not signed in') : 'Local build — no account server'}
        </Text>
      </Card>

      <SectionHeader>Two-factor authentication</SectionHeader>
      <Card>
        <Text style={[type.caption, { color: dark.inkMuted, lineHeight: 18 }]}>
          Adds a second step at sign-in using an authenticator app (Google Authenticator, Authy, 1Password).
          Strongly recommended once real money and data are involved.
        </Text>
        {mfa === 'on' ? (
          <Row title="Two-factor sign-in" value="On ✓" onPress={() => confirmAction({ title: 'Turn off two-factor?', message: 'Your account will be less protected.', confirmLabel: 'Turn off', destructive: true, onConfirm: disableMfa })} />
        ) : mfa === 'enrolling' ? (
          <View style={{ marginTop: 10 }}>
            <Text style={[type.micro, { color: dark.inkMuted }]}>1. Add this key to your authenticator app:</Text>
            <Text selectable style={[type.numBold as any, { color: accent.verdant, fontSize: 15, marginTop: 4, letterSpacing: 1 }]}>{secret}</Text>
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10 }]}>2. Enter the 6-digit code it shows:</Text>
            <TextInput
              value={code} onChangeText={(t) => setCode(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad"
              placeholder="123456" placeholderTextColor={dark.inkMuted}
              style={{ color: dark.ink, backgroundColor: dark.surface2, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, marginTop: 4, fontSize: 16, letterSpacing: 3 }}
            />
            <GButton title={busy ? 'Verifying…' : 'Turn on two-factor'} onPress={verifyEnroll} disabled={busy || code.length < 6} style={{ marginTop: 10 }} />
          </View>
        ) : (
          <GButton title={busy ? 'Starting…' : 'Set up two-factor'} onPress={startEnroll} disabled={busy || !user} style={{ marginTop: 10 }} />
        )}
        {!user && mfa !== 'on' && <Text style={[type.micro, { color: dark.inkMuted, marginTop: 8 }]}>Sign in first to enable two-factor.</Text>}
        {note && <Text style={[type.micro, { color: accent.clay, marginTop: 8 }]}>{note}</Text>}
      </Card>

      <SectionHeader>Sessions</SectionHeader>
      <Card>
        <Row title="Sign out of all devices" value="→" onPress={signOutEverywhere} />
      </Card>

      <SectionHeader>Your data</SectionHeader>
      <Card>
        <Row title="Export all data" value="JSON" onPress={exportAll} />
        <Row title="Anonymized research" value={settings.researchOptIn ? 'On' : 'Off'} onPress={() => setSettings({ researchOptIn: !settings.researchOptIn })} />
        <Row title="Privacy policy" value="→" onPress={() => router.push('/privacy' as any)} />
        <Row title="Terms of Service" value="→" onPress={() => router.push('/terms' as any)} />
        <Row
          title="Delete account"
          danger
          onPress={() => confirmAction({
            title: 'Delete account', message: 'Full and immediate. This cannot be undone.', confirmLabel: 'Delete', destructive: true,
            onConfirm: async () => { if (enabled) { const { error } = await deleteAccount(); notify(error ? 'Could not delete' : 'Account deleted.'); } else resetApp(); router.replace('/(tabs)'); },
          })}
        />
      </Card>
    </Screen>
  );
}
