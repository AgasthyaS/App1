import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';

import { Card, Row, Screen, SectionHeader } from '@/components/greenr/UI';
import { dark, type } from '@/constants/theme';
import { BUILD_STAMP } from '@/lib/build';
import { useGreenr } from '@/lib/store';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIMES = ['8:00', '9:00', '10:00', '18:00'];
const QUIET: [string, string][] = [
  ['21:00', '08:00'],
  ['22:00', '07:00'],
  ['23:00', '09:00'],
];

/** Settings (§11), grouped. Every row acts. */
export default function SettingsScreen() {
  const router = useRouter();
  const greenr = useGreenr();
  const { settings, setSettings, demo, loadDemoGarden, resetApp, profile, signOut } = greenr;

  const cycle = <T,>(list: readonly T[], current: T): T =>
    list[(list.findIndex((v) => JSON.stringify(v) === JSON.stringify(current)) + 1) % list.length];

  const exportAll = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      plants: greenr.plants,
      spots: greenr.spots,
      sensors: greenr.sensors,
      settings: greenr.settings,
    };
    Share.share({ message: JSON.stringify(payload, null, 2), title: 'Greenr export' }).catch(() => {});
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Settings</Text>
      </View>

      <SectionHeader>Briefing</SectionHeader>
      <Card>
        <Row
          title="Briefing day"
          value={settings.briefingDay}
          onPress={() => setSettings({ briefingDay: cycle(DAYS, settings.briefingDay) })}
        />
        <Row
          title="Time"
          value={settings.briefingTime}
          onPress={() => setSettings({ briefingTime: cycle(TIMES, settings.briefingTime) })}
        />
      </Card>

      <SectionHeader>Notifications</SectionHeader>
      <Card>
        <Text style={[type.caption, { color: dark.inkMuted, lineHeight: 18 }]}>
          Weekly briefing (1) + forecast emergencies (predicted critical &lt;48 h, max 1 per plant
          per 48 h) + hardware failures. Nothing else pushes. Quiet hours 21:00–08:00; emergencies
          queue to 08:00.
        </Text>
        <Row
          title="Emergency lead time"
          value={`${settings.emergencyLeadHours} h`}
          onPress={() =>
            setSettings({ emergencyLeadHours: settings.emergencyLeadHours === 48 ? 24 : 48 })
          }
        />
        <Row
          title="Quiet hours"
          value={`${settings.quietHours[0]}–${settings.quietHours[1]}`}
          onPress={() => setSettings({ quietHours: cycle(QUIET, settings.quietHours) })}
        />
      </Card>

      <SectionHeader>Units</SectionHeader>
      <Card>
        <Row
          title="Temperature"
          value={settings.unitsF ? '°F' : '°C'}
          onPress={() => setSettings({ unitsF: !settings.unitsF })}
        />
      </Card>

      <SectionHeader>Voice</SectionHeader>
      <Card>
        <Row
          title="Copy warmth"
          value={settings.voice}
          onPress={() =>
            setSettings({ voice: settings.voice === 'Standard' ? 'Warm' : 'Standard' })
          }
        />
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4 }]}>
          Changes notification and briefing copy warmth only — the data never changes.
        </Text>
      </Card>

      <SectionHeader>Appearance</SectionHeader>
      <Card>
        <Row
          title="Ritual surfaces"
          value={settings.appearance}
          onPress={() =>
            setSettings({
              appearance:
                settings.appearance === 'Dark' ? 'Light' : settings.appearance === 'Light' ? 'System' : 'Dark',
            })
          }
        />
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4 }]}>
          Instrument surfaces stay dark regardless.
        </Text>
      </Card>

      <SectionHeader>Data &amp; privacy</SectionHeader>
      <Card>
        <Row title="Export all data" value="JSON" onPress={exportAll} />
        <Row
          title="Anonymized research"
          value={settings.researchOptIn ? 'On' : 'Off'}
          onPress={() => setSettings({ researchOptIn: !settings.researchOptIn })}
        />
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4 }]}>
          Your readings and outcomes, stripped of identity, improve care models for everyone.
        </Text>
        <Row
          title="Delete account"
          danger
          onPress={() =>
            Alert.alert('Delete account', 'Full and immediate. This cannot be undone.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: resetApp },
            ])
          }
        />
      </Card>

      <SectionHeader>Account</SectionHeader>
      <Card>
        <Row
          title={profile?.name ?? 'Guest'}
          value={
            profile?.method === 'email'
              ? profile.email ?? ''
              : profile
                ? `via ${profile.method[0].toUpperCase()}${profile.method.slice(1)}`
                : ''
          }
        />
        {profile && (
          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>
            {profile.experience} gardening · {profile.plantCount} plants · {profile.where.toLowerCase()} ·
            struggles with {profile.struggle.toLowerCase()}
          </Text>
        )}
        <Row
          title="Sign out"
          danger
          onPress={() =>
            Alert.alert('Sign out?', 'Your garden stays on this device; you can sign back in anytime.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Sign out',
                style: 'destructive',
                onPress: () => {
                  signOut();
                  router.replace('/(tabs)'); // the gate bounces to sign-in
                },
              },
            ])
          }
        />
      </Card>

      <SectionHeader>Testing</SectionHeader>
      <Card>
        <Row
          title={demo ? 'Demo garden loaded' : 'Load demo garden'}
          value={demo ? 'On' : ''}
          onPress={() => {
            if (!demo) loadDemoGarden();
          }}
        />
        <Row
          title="Reset app (fresh install)"
          danger
          onPress={() =>
            Alert.alert('Reset app', 'Clears all plants, spots, sensors, and settings.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Reset',
                style: 'destructive',
                onPress: () => {
                  resetApp();
                  router.replace('/(tabs)'); // fresh install → sign-in gate
                },
              },
            ])
          }
        />
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4 }]}>
          The demo garden never persists — turn it off with a reset. A fresh install starts empty.
        </Text>
      </Card>

      <SectionHeader>About</SectionHeader>
      <Card>
        <Row title="Version" value={`2.0.0 · ${BUILD_STAMP}`} />
        <Row title="How Greenr calculates" value="→" onPress={() => router.push('/methodology')} />
        <Row
          title="Privacy policy"
          value="→"
          onPress={() =>
            Alert.alert(
              'Privacy',
              'Your readings stay on this device in this build. The anonymized-research toggle controls whether outcomes would be shared, stripped of identity, in a release build.',
            )
          }
        />
        <Row
          title="Terms"
          value="→"
          onPress={() => Alert.alert('Terms', 'Prototype build — terms ship with the release version.')}
        />
      </Card>
    </Screen>
  );
}
