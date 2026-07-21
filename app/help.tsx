import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, GButton, Hairline, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { shareContent } from '@/lib/platform';

interface Topic { q: string; a: string[]; cta?: { label: string; to: string } }

const TOPICS: { group: string; items: Topic[] }[] = [
  {
    group: 'Setting up a sensor',
    items: [
      {
        q: "The app can't find my sensor over Bluetooth",
        a: [
          'Make sure the sensor is plugged in and within a few feet of your phone.',
          'It only advertises over Bluetooth for its first few minutes — unplug it and plug it back in to restart that window.',
          'On the web, use Chrome or Edge (Safari can’t do in-app Bluetooth). On iPhone, use the Greenr app.',
          'When your phone asks to pair, enter the passkey printed on the sensor.',
        ],
        cta: { label: 'Set up Wi-Fi', to: '/wifi-setup' },
      },
      {
        q: 'It won’t join my Wi-Fi',
        a: [
          'The sensor only supports 2.4 GHz networks — not 5 GHz. Many routers name them the same; pick the 2.4 GHz one.',
          'Double-check the password (tap the eye icon to reveal it while typing).',
          'Move it closer to the router for setup, then back to the plant afterwards.',
        ],
      },
    ],
  },
  {
    group: 'Sensor problems',
    items: [
      {
        q: 'My sensor stopped reporting',
        a: [
          'Open Device health to see its status and last-seen time.',
          'Most often it’s power: use a wall charger or power bank, not a PC USB port (those cut power when the PC sleeps).',
          'If your Wi-Fi changed, re-run Wi-Fi setup.',
        ],
        cta: { label: 'Open device health', to: '/device-health' },
      },
      {
        q: 'The readings look wrong (e.g. soil stuck at 0%)',
        a: [
          '0% means the probe is reading dry — in air, or the tip isn’t in moist soil. Push it into damp soil and it climbs.',
          'If a value looks consistently off, calibrate that sensor: Devices → your sensor → Calibrate.',
          'If light reads backwards (bright when covered), flip it: on the plant’s Light card, tap “Readings backwards?”.',
        ],
      },
      {
        q: 'How long does the battery last?',
        a: [
          'It depends on your build and how often it reports. Turn on Home Bluetooth sync (Settings → Battery & sync) so your phone collects readings at home and the sensor’s Wi-Fi radio rests.',
          'You’ll get a low-battery reminder when it drops below 20%.',
        ],
      },
    ],
  },
  {
    group: 'Account & data',
    items: [
      {
        q: 'How do I export or delete my data?',
        a: ['Settings → Data has Export (JSON) and account controls. Deleting your account removes your stored garden.'],
        cta: { label: 'Open settings', to: '/settings' },
      },
      {
        q: 'Is my data private?',
        a: ['Your garden is yours. See the Privacy Policy for exactly what’s collected and how it’s used.'],
        cta: { label: 'Privacy policy', to: '/privacy' },
      },
    ],
  },
];

export default function Help() {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Help &amp; support</Text>
      </View>

      {/* quick actions */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <QuickAction icon="pulse-outline" label="Device health" onPress={() => router.push('/device-health' as any)} />
        <QuickAction icon="wifi-outline" label="Wi-Fi setup" onPress={() => router.push('/wifi-setup' as any)} />
        <QuickAction icon="calculator-outline" label="How it works" onPress={() => router.push('/methodology' as any)} />
      </View>

      {TOPICS.map((section) => (
        <View key={section.group}>
          <SectionHeader>{section.group}</SectionHeader>
          <Card>
            {section.items.map((t, i) => {
              const id = `${section.group}-${i}`;
              const isOpen = open === id;
              return (
                <View key={id}>
                  {i > 0 && <Hairline />}
                  <Pressable onPress={() => setOpen(isOpen ? null : id)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 46, gap: 10 }}>
                    <Text style={[type.body, { color: dark.ink, flex: 1, lineHeight: 20 }]}>{t.q}</Text>
                    <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={dark.inkMuted} />
                  </Pressable>
                  {isOpen && (
                    <View style={{ paddingBottom: 12, gap: 7 }}>
                      {t.a.map((line, j) => (
                        <View key={j} style={{ flexDirection: 'row', gap: 8 }}>
                          <Text style={[type.caption, { color: accent.verdant }]}>·</Text>
                          <Text style={[type.caption, { color: dark.inkMuted, flex: 1, lineHeight: 19 }]}>{line}</Text>
                        </View>
                      ))}
                      {t.cta && (
                        <GButton title={t.cta.label} kind="secondary" onPress={() => router.push(t.cta!.to as any)} style={{ marginTop: 6, minHeight: 42 }} />
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </Card>
        </View>
      ))}

      <SectionHeader>Still stuck?</SectionHeader>
      <Card>
        <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
          Reach us at <Text style={{ color: accent.verdant }}>support@greenr.app</Text> — include your sensor’s ID
          (from Device health) and what you’re seeing, and we’ll help.
        </Text>
        <GButton
          title="Email support"
          onPress={() => shareContent({ message: 'Hi Greenr team,\n\n(Describe the issue — include your sensor ID from Device health.)', title: 'Greenr support' })}
          style={{ marginTop: 12 }}
        />
      </Card>
    </Screen>
  );
}

function QuickAction({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, borderRadius: 14, borderWidth: 1, borderColor: dark.hairline, backgroundColor: dark.surface1, padding: 12, alignItems: 'center', gap: 6, minHeight: 78, justifyContent: 'center' }}>
      <Ionicons name={icon as any} size={22} color={accent.verdant} />
      <Text style={[type.micro, { color: dark.ink, textAlign: 'center' }]}>{label}</Text>
    </Pressable>
  );
}
