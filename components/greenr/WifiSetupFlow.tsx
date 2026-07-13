import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';

import { Card, GButton } from '@/components/greenr/UI';
import { accent, light, type } from '@/constants/theme';

/**
 * Sensor Wi-Fi setup instructions for the captive-portal firmware (v2,
 * WiFiManager): the sensor broadcasts a "greenr-setup" hotspot; joining it
 * pops up a page where the user picks their home Wi-Fi. Works on every phone
 * with no app permissions — including iPhone, where in-browser Bluetooth
 * isn't allowed.
 *
 * (A Bluetooth version of this flow lives in lib/wifiSetup.ts, kept for the
 * future native iPhone/Android build — see git history for the BLE UI.)
 */

const STEPS: { icon: string; text: string }[] = [
  { icon: 'power-outline', text: 'Plug the sensor in. For its first 3 minutes it broadcasts its own Wi-Fi network.' },
  { icon: 'settings-outline', text: 'On your phone, open Settings → Wi-Fi and join the network called “greenr-setup”.' },
  { icon: 'globe-outline', text: 'A setup page pops up by itself (like hotel Wi-Fi). Pick your home Wi-Fi and type its password.' },
  { icon: 'checkmark-circle-outline', text: 'The page confirms, the “greenr-setup” network disappears, and your phone rejoins your own Wi-Fi. Come back here.' },
];

export function WifiSetupFlow({
  onDone,
  doneCta,
  onSkip,
  skipLabel,
}: {
  onDone: () => void;
  /** Label of the confirm button. */
  doneCta: string;
  onSkip?: () => void;
  skipLabel?: string;
}) {
  return (
    <View>
      <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>
        Connect it to your Wi-Fi
      </Text>
      <Text style={[type.body, { color: light.inkMuted, marginTop: 6 }]}>
        The sensor remembers the network afterwards — this is a one-time step.
      </Text>

      <View style={{ marginTop: 14, gap: 8 }}>
        {STEPS.map((s, i) => (
          <Card key={s.icon} mode="light" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Ionicons name={s.icon as any} size={20} color={accent.verdant} />
            <Text style={[type.body, { color: light.ink, flex: 1, lineHeight: 20 }]}>
              <Text style={{ color: light.inkMuted }}>{i + 1}. </Text>
              {s.text}
            </Text>
          </Card>
        ))}
      </View>

      <Text style={[type.micro, { color: light.inkMuted, marginTop: 12, lineHeight: 16 }]}>
        No “greenr-setup” network? Unplug the sensor and plug it back in — the
        3-minute setup window restarts. If the setup page doesn&apos;t pop up on
        its own, open a browser and go to 192.168.4.1.
      </Text>

      <GButton title={doneCta} onPress={onDone} style={{ marginTop: 16 }} />
      {onSkip && (
        <GButton
          title={skipLabel ?? 'Skip for now'}
          kind="ghost"
          mode="light"
          onPress={onSkip}
          style={{ marginTop: 8 }}
        />
      )}
    </View>
  );
}
