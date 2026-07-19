import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, Row, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { BUILD_STAMP } from '@/lib/build';
import * as bleGateway from '@/lib/bleGateway';
import * as notifications from '@/lib/notifications';
import { confirmAction, notify, shareContent } from '@/lib/platform';
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
  const { settings, setSettings, resetApp, profile, signOut } = greenr;
  const { signOut: authSignOut, enabled: authEnabled, deleteAccount } = useAuth();

  const cycle = <T,>(list: readonly T[], current: T): T =>
    list[(list.findIndex((v) => JSON.stringify(v) === JSON.stringify(current)) + 1) % list.length];

  const [reminderNote, setReminderNote] = useState<string | null>(null);
  const supported = notifications.isSupported();
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const syncNearby = async () => {
    if (!bleGateway.isSupported) {
      setSyncNote('This browser can’t use Bluetooth. Use the phone app for sensor sync.');
      return;
    }
    setSyncing(true);
    setSyncNote(null);
    try {
      const results = await bleGateway.syncNow();
      const total = results.reduce((a, r) => a + r.uploaded, 0);
      setSyncNote(
        results.length === 0
          ? 'No Greenr sensor found nearby in setup range.'
          : `Synced ${results.length} sensor${results.length === 1 ? '' : 's'} · ${total} reading${total === 1 ? '' : 's'} uploaded.`,
      );
    } catch (e) {
      setSyncNote(e instanceof Error && /cancel|NotFound/i.test(e.message) ? null : 'Couldn’t reach the sensor. Move closer and try again.');
    } finally {
      setSyncing(false);
    }
  };

  const toggleReminders = async () => {
    if (settings.remindersEnabled) {
      setSettings({ remindersEnabled: false });
      await notifications.cancelAll();
      setReminderNote(null);
      return;
    }
    if (!supported) {
      setReminderNote('This browser doesn’t support notifications. Use the phone app for care reminders.');
      return;
    }
    const status = await notifications.ensurePermission();
    if (status === 'granted') {
      setSettings({ remindersEnabled: true });
      setReminderNote(null);
      notifications.sendTest();
    } else {
      setReminderNote(
        'Notifications are blocked. Turn them on for Greenr in your browser or phone settings, then try again.',
      );
    }
  };

  const exportAll = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      plants: greenr.plants,
      spots: greenr.spots,
      sensors: greenr.sensors,
      settings: greenr.settings,
    };
    shareContent({ message: JSON.stringify(payload, null, 2), title: 'Greenr export', filename: 'greenr-export.json' });
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

      <SectionHeader>Reminders</SectionHeader>
      <Card>
        <Text style={[type.caption, { color: dark.inkMuted, lineHeight: 18 }]}>
          A nudge when a plant needs watering, moving to better light, feeding, more humidity, or a
          sensor recharge — scheduled from each plant’s real cadence and kept out of your quiet hours.{' '}
          {notifications.backgroundDelivery
            ? 'Delivered even when the app is closed.'
            : 'On the web these arrive while Greenr is open in a tab; install the phone app for reminders when it’s closed.'}
        </Text>
        <Row
          title="Care reminders"
          value={settings.remindersEnabled ? 'On' : 'Off'}
          onPress={toggleReminders}
        />
        {settings.remindersEnabled && (
          <Row title="Send a test reminder" value="→" onPress={() => notifications.sendTest()} />
        )}
        {reminderNote && (
          <Text style={[type.caption, { color: accent.clay, lineHeight: 18, marginTop: 6 }]}>
            {reminderNote}
          </Text>
        )}
      </Card>

      <SectionHeader>Battery &amp; sync</SectionHeader>
      <Card>
        <Text style={[type.caption, { color: dark.inkMuted, lineHeight: 18 }]}>
          Home Bluetooth sync saves your sensors&apos; battery: when you&apos;re home, your phone
          collects readings over Bluetooth so the sensor&apos;s power-hungry Wi-Fi stays off. When
          you&apos;re away, each sensor falls back to Wi-Fi on its own so your data stays current.
          {bleGateway.supportsBackground
            ? ' Runs automatically in the background.'
            : ' On the web this is manual — the phone app does it automatically.'}
        </Text>
        {bleGateway.supportsBackground && (
          <Row
            title="Home Bluetooth sync"
            value={settings.bleGatewayEnabled ? 'On' : 'Off'}
            onPress={() => setSettings({ bleGatewayEnabled: !settings.bleGatewayEnabled })}
          />
        )}
        <Row title={syncing ? 'Searching…' : 'Sync a nearby sensor now'} value="→" onPress={syncing ? undefined : syncNearby} />
        {syncNote && (
          <Text style={[type.caption, { color: accent.sage, lineHeight: 18, marginTop: 6 }]}>{syncNote}</Text>
        )}
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
            confirmAction({
              title: 'Delete account',
              message: 'Full and immediate. This cannot be undone.',
              confirmLabel: 'Delete',
              destructive: true,
              onConfirm: resetApp,
            })
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
            confirmAction({
              title: 'Sign out?',
              message: authEnabled
                ? 'Your garden is saved to your account — sign back in on any device to pick up where you left off.'
                : 'Your garden stays on this device; you can sign back in anytime.',
              confirmLabel: 'Sign out',
              destructive: true,
              onConfirm: () => {
                authSignOut(); // end the Supabase session
                signOut(); // clear this device
                router.replace('/(tabs)'); // the gate bounces to sign-in
              },
            })
          }
        />
        {authEnabled && profile && (
          <Row
            title="Delete account"
            danger
            onPress={() =>
              confirmAction({
                title: 'Delete account?',
                message:
                  'This permanently erases your account and your whole garden — plants, spots, sensors, everything, on every device. This cannot be undone. You can sign up fresh afterward.',
                confirmLabel: 'Delete forever',
                destructive: true,
                onConfirm: async () => {
                  const { error } = await deleteAccount(); // cloud data + login
                  resetApp(); // wipe this device
                  if (error) notify('Account data cleared. Sign up again anytime.');
                  else notify('Account deleted.');
                  router.replace('/(tabs)'); // gate → fresh sign-in
                },
              })
            }
          />
        )}
      </Card>

      <SectionHeader>Data</SectionHeader>
      <Card>
        <Row
          title="Reset app (fresh install)"
          danger
          onPress={() =>
            confirmAction({
              title: 'Reset app',
              message: 'Clears all plants, spots, sensors, and settings on this device.',
              confirmLabel: 'Reset',
              destructive: true,
              onConfirm: () => {
                resetApp();
                router.replace('/(tabs)'); // fresh install → sign-in gate
              },
            })
          }
        />
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4 }]}>
          A fresh install starts empty. Your account&apos;s garden stays saved in the cloud.
        </Text>
      </Card>

      <SectionHeader>About</SectionHeader>
      <Card>
        <Row title="Version" value={`2.0.0 · ${BUILD_STAMP}`} />
        <Row title="How Greenr calculates" value="→" onPress={() => router.push('/methodology')} />
        <Row title="Privacy policy" value="→" onPress={() => router.push('/privacy' as any)} />
        <Row title="Terms of Service" value="→" onPress={() => router.push('/terms' as any)} />
      </Card>
    </Screen>
  );
}
