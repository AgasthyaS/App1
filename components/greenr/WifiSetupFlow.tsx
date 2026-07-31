import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { Card, GButton } from '@/components/greenr/UI';
import { accent, light, type } from '@/constants/theme';
import {
  isWifiSetupSupported,
  startWifiSetup,
  type SetupStatus,
  type WifiSetupSession,
} from '@/lib/wifiSetup';
import { isAlreadyConfigured, isChooserCancelled } from '@/lib/wifiSetupTypes';

/**
 * Sensor Wi-Fi setup.
 *
 * Primary path (Ring-style): the sensor advertises over Bluetooth while it has
 * no Wi-Fi. The app finds it, shows the networks IT can see, and the user picks
 * theirs and types the password right here — the app hands the credentials to
 * the sensor, which connects and remembers them. No switching Wi-Fi networks.
 *
 * Fallback path (no in-browser Bluetooth here — e.g. iOS Safari/Firefox):
 * setup NEEDS Bluetooth, so the fallback explains where to get it. (Firmware
 * v3+ no longer broadcasts a setup hotspot; the old captive-portal steps died
 * with it.)
 */

const MANUAL_STEPS: { icon: string; text: string }[] = [
  { icon: 'power-outline', text: 'Give the sensor power and keep it near you. Until it has Wi-Fi it keeps offering itself over Bluetooth — there’s no time limit, so set it up whenever suits you.' },
  { icon: 'logo-chrome', text: 'Open greenr-app.vercel.app in Chrome or Edge (computer or Android) — those browsers can talk to the sensor over Bluetooth. On iPhone, use the Greenr app.' },
  { icon: 'bluetooth-outline', text: 'Go to Wi-Fi setup there and tap “Find my sensor”, then pick your network and enter its password.' },
  { icon: 'checkmark-circle-outline', text: 'The sensor saves your Wi-Fi permanently and starts reporting — this is a one-time step.' },
];

type Phase = 'intro' | 'searching' | 'form' | 'sending' | 'success' | 'unsure' | 'manual';

/** How long to wait for confirmation before offering a way forward. */
const CONFIRM_TIMEOUT_MS = 45000;

export function WifiSetupFlow({
  onDone,
  doneCta,
  onSkip,
  skipLabel,
  verify,
}: {
  onDone: () => void;
  /** Label of the confirm button on the manual/instruction path. */
  doneCta: string;
  onSkip?: () => void;
  skipLabel?: string;
  /**
   * Optional independent success check — resolves true once the sensor has
   * actually reported to the cloud. Far more reliable than the Bluetooth "ok",
   * which is frequently lost when the sensor powers up its Wi-Fi radio.
   */
  verify?: () => Promise<boolean>;
}) {
  // No in-app Bluetooth here (e.g. iOS Safari) → go straight to the manual steps.
  const [phase, setPhase] = useState<Phase>(isWifiSetupSupported ? 'intro' : 'manual');
  const [session, setSession] = useState<WifiSetupSession | null>(null);
  const [ssid, setSsid] = useState('');
  const [otherSsid, setOtherSsid] = useState('');
  const [useOther, setUseOther] = useState(false);
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sessionRef = useRef<WifiSetupSession | null>(null);

  // Always drop the BLE link when leaving.
  useEffect(() => () => sessionRef.current?.disconnect(), []);

  // React to the sensor's own status pushes.
  useEffect(() => {
    if (status === 'ok') {
      setPhase('success');
      sessionRef.current?.disconnect();
      const t = setTimeout(onDone, 1200);
      return () => clearTimeout(t);
    }
    if (status === 'fail') {
      setErr('That password didn’t work. Double-check it and try again.');
      setPhase('form');
    }
  }, [status, onDone]);

  /**
   * While waiting, confirm success the reliable way — by asking the cloud
   * whether the sensor has reported — and NEVER wait forever. The Bluetooth
   * "ok" is often lost because bringing up Wi-Fi drops the BLE link, which
   * previously left this screen spinning with no way out.
   */
  useEffect(() => {
    if (phase !== 'sending') return;
    let alive = true;
    const startedAt = Date.now();

    const poll = setInterval(async () => {
      if (!alive) return;
      if (verify) {
        try {
          if (await verify()) {
            if (!alive) return;
            sessionRef.current?.disconnect();
            setPhase('success');
            setTimeout(onDone, 1200);
            return;
          }
        } catch {
          // network hiccup — keep waiting, the timeout below is the backstop
        }
      }
      if (alive && Date.now() - startedAt > CONFIRM_TIMEOUT_MS) setPhase('unsure');
    }, 3000);

    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [phase, verify, onDone]);

  const search = async () => {
    setErr(null);
    setStatus(null);
    // Always tear down a previous link first — a lingering one makes the browser
    // refuse the next connect with "Connection already in progress".
    try { sessionRef.current?.disconnect(); } catch { /* already gone */ }
    sessionRef.current = null;
    setSession(null);
    setPhase('searching');
    try {
      const s = await startWifiSetup();
      s.onStatus(setStatus);
      sessionRef.current = s;
      setSession(s);
      if (s.networks[0]) setSsid(s.networks[0]);
      else setUseOther(true);
      setPhase('form');
    } catch (e) {
      setPhase('intro');
      const msg = e instanceof Error ? e.message : '';
      if (isAlreadyConfigured(e)) {
        // Not a failure — the sensor is up and running on Wi-Fi already.
        setErr(
          'That sensor is already set up and running, so it isn’t offering Wi-Fi setup. Check Device health to see its latest report. To move it to a different network, let it fail to connect a few times (it reopens setup automatically) or hold its setup button if fitted.',
        );
      } else if (isChooserCancelled(e)) {
        // Chrome throws NotFoundError both for "you cancelled" and "nothing
        // matched". Saying nothing here is what made this look broken.
        setErr(
          'No sensor appeared. A sensor that already has Wi-Fi only shows up briefly, and a new one advertises in short bursts — unplug it, plug it back in, and tap “Find my sensor” within about 30 seconds.',
        );
      } else if (/in progress|InvalidState/i.test(msg)) {
        setErr(
          'Bluetooth is busy with an earlier connection. Wait ~10 seconds and try again. If it persists, remove “greenr-…” from your computer’s Bluetooth settings, then retry.',
        );
      } else {
        setErr(msg || 'Could not reach the sensor. Make sure it has power and is nearby.');
      }
    }
  };

  const connect = async () => {
    const chosen = useOther ? otherSsid.trim() : ssid;
    if (!session || !chosen) return;
    setErr(null);
    setStatus('connecting');
    setPhase('sending');
    try {
      await session.sendCredentials(chosen, password);
    } catch {
      setErr('Couldn’t send that to the sensor. Move a bit closer and try again.');
      setPhase('form');
    }
  };

  // ── Success ──
  if (phase === 'success') {
    return (
      <View style={{ alignItems: 'center', paddingTop: 20 }}>
        <Ionicons name="checkmark-circle" size={56} color={accent.sage} />
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 14, textAlign: 'center' }]}>
          Sensor is on your Wi-Fi
        </Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 8, textAlign: 'center' }]}>
          It saved the network and is starting to report.
        </Text>
      </View>
    );
  }

  // ── Manual captive-portal fallback ──
  if (phase === 'manual') {
    return (
      <View>
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>Connect it to your Wi-Fi</Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 6 }]}>
          The sensor remembers the network afterwards — this is a one-time step.
        </Text>
        <View style={{ marginTop: 14, gap: 8 }}>
          {MANUAL_STEPS.map((s, i) => (
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
          Sensor not showing up? Unplug it and plug it back in — that restarts its Bluetooth
          setup window.
        </Text>
        <GButton title={doneCta} onPress={onDone} style={{ marginTop: 16 }} />
        {isWifiSetupSupported && (
          <GButton title="Use in-app setup instead" kind="ghost" mode="light" onPress={() => setPhase('intro')} style={{ marginTop: 8 }} />
        )}
        {onSkip && (
          <GButton title={skipLabel ?? 'Skip for now'} kind="ghost" mode="light" onPress={onSkip} style={{ marginTop: 8 }} />
        )}
      </View>
    );
  }

  // ── Searching ──
  if (phase === 'searching') {
    return (
      <View style={{ alignItems: 'center', paddingTop: 30 }}>
        <ActivityIndicator color={accent.verdant} />
        <Text style={[type.body, { color: light.inkMuted, marginTop: 16, textAlign: 'center' }]}>
          Looking for your sensor…
        </Text>
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 8, textAlign: 'center', lineHeight: 16 }]}>
          Keep it powered and close to your phone. If it doesn’t appear, unplug it and plug it back
          in — that wakes it into fast setup mode.
        </Text>
      </View>
    );
  }

  // ── Sending credentials / connecting ──
  if (phase === 'sending') {
    return (
      <View style={{ alignItems: 'center', paddingTop: 30 }}>
        <ActivityIndicator color={accent.verdant} />
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 16, textAlign: 'center' }]}>
          Connecting your sensor…
        </Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 8, textAlign: 'center' }]}>
          Handing it the Wi-Fi and waiting for it to join, then checking that it reached the
          cloud. This usually takes 10–30 seconds.
        </Text>
        <GButton
          title="Continue anyway"
          kind="ghost"
          mode="light"
          onPress={() => {
            sessionRef.current?.disconnect();
            onDone();
          }}
          style={{ marginTop: 22 }}
        />
      </View>
    );
  }

  // ── Couldn't confirm: never leave the user stuck ──
  if (phase === 'unsure') {
    return (
      <View style={{ paddingTop: 20 }}>
        <View style={{ alignItems: 'center' }}>
          <Ionicons name="help-circle-outline" size={48} color={accent.sunbeamText} />
          <Text style={[type.ritualTitle, { color: light.ink, marginTop: 12, textAlign: 'center' }]}>
            Couldn’t confirm it yet
          </Text>
        </View>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 10, lineHeight: 22 }]}>
          Your sensor may well be connected — the Bluetooth link often drops the moment it powers
          up its Wi-Fi radio, so we lose the confirmation even when setup worked.
        </Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 10, lineHeight: 22 }]}>
          Carry on with setup and check Device health in a few minutes. If it still hasn’t
          reported, run Wi-Fi setup again and double-check the password.
        </Text>
        <GButton
          title="Continue"
          onPress={() => {
            sessionRef.current?.disconnect();
            onDone();
          }}
          style={{ marginTop: 18 }}
        />
        <GButton
          title="Try Wi-Fi setup again"
          kind="secondary"
          // Start over from a clean link — the old one is almost certainly dead
          // (the sensor dropped it when it switched to Wi-Fi), and reusing it is
          // what produces "Connection already in progress".
          onPress={search}
          style={{ marginTop: 10 }}
        />
      </View>
    );
  }

  // ── Form: pick network + password ──
  if (phase === 'form' && session) {
    const chosen = useOther ? otherSsid.trim() : ssid;
    return (
      <View>
        <Text style={[type.micro, { color: accent.sage, marginTop: 8 }]}>CONNECTED TO {session.deviceName.toUpperCase()} ✓</Text>
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 6 }]}>Pick your Wi-Fi</Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 6 }]}>
          Choose your home network and enter its password — we’ll hand it to the sensor.
        </Text>

        {/* networks the sensor can see */}
        {session.networks.length > 0 && !useOther && (
          <View style={{ marginTop: 14, gap: 8 }}>
            {session.networks.slice(0, 6).map((n) => (
              <Card
                key={n}
                mode="light"
                onPress={() => setSsid(n)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 2, borderColor: ssid === n ? accent.verdant : 'transparent' }}
              >
                <Ionicons name="wifi" size={18} color={accent.verdant} />
                <Text style={[type.body, { color: light.ink, flex: 1 }]} numberOfLines={1}>{n}</Text>
                {ssid === n && <Ionicons name="checkmark-circle" size={18} color={accent.verdant} />}
              </Card>
            ))}
            <Pressable onPress={() => setUseOther(true)} style={{ minHeight: 40, justifyContent: 'center' }}>
              <Text style={[type.caption, { color: accent.verdant }]}>My network isn’t listed →</Text>
            </Pressable>
          </View>
        )}

        {/* manual SSID */}
        {(useOther || session.networks.length === 0) && (
          <View style={{ marginTop: 14 }}>
            <Text style={[type.micro, { color: light.inkMuted, marginBottom: 4 }]}>NETWORK NAME</Text>
            <TextInput
              value={otherSsid}
              onChangeText={setOtherSsid}
              autoCapitalize="none"
              placeholder="Your Wi-Fi name (SSID)"
              placeholderTextColor={light.inkMuted}
              style={[type.body, inputStyle]}
            />
            {session.networks.length > 0 && (
              <Pressable onPress={() => setUseOther(false)} style={{ minHeight: 36, justifyContent: 'center' }}>
                <Text style={[type.caption, { color: accent.verdant }]}>← Back to the list</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* password */}
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 14, marginBottom: 4 }]}>PASSWORD</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPass}
            autoCapitalize="none"
            placeholder="Wi-Fi password"
            placeholderTextColor={light.inkMuted}
            style={[type.body, inputStyle, { flex: 1 }]}
          />
          <Pressable onPress={() => setShowPass((v) => !v)} style={{ padding: 10 }}>
            <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={20} color={light.inkMuted} />
          </Pressable>
        </View>
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 6 }]}>
          Only 2.4 GHz networks are supported (most sensors can’t see 5 GHz).
        </Text>

        {err && <Text style={[type.micro, { color: '#C0392B', marginTop: 10 }]}>{err}</Text>}

        <GButton title="Connect" onPress={connect} disabled={!chosen} style={{ marginTop: 16 }} />
        <GButton title="Can’t connect? See the checklist" kind="ghost" mode="light" onPress={() => setPhase('manual')} style={{ marginTop: 8 }} />
      </View>
    );
  }

  // ── Intro ──
  return (
    <View>
      <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>Connect it to your Wi-Fi</Text>
      <Text style={[type.body, { color: light.inkMuted, marginTop: 6, lineHeight: 22 }]}>
        Set it up right here — no switching Wi-Fi networks. Give the sensor power, keep it close,
        and we’ll find it over Bluetooth. There’s no rush: it stays findable until you’re ready.
      </Text>

      <Card mode="light" style={{ marginTop: 16, gap: 10 }}>
        {[
          ['bluetooth-outline', 'Find your sensor'],
          ['wifi-outline', 'Pick your home Wi-Fi'],
          ['lock-closed-outline', 'Type the password once — done'],
        ].map(([icon, label]) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Ionicons name={icon as any} size={20} color={accent.verdant} />
            <Text style={[type.body, { color: light.ink }]}>{label}</Text>
          </View>
        ))}
      </Card>

      {err && <Text style={[type.micro, { color: '#C0392B', marginTop: 12 }]}>{err}</Text>}

      <GButton title="Find my sensor" onPress={search} style={{ marginTop: 16 }} />
      <GButton title="Can’t connect? See the checklist" kind="ghost" mode="light" onPress={() => setPhase('manual')} style={{ marginTop: 8 }} />
      {onSkip && (
        <GButton title={skipLabel ?? 'Skip for now'} kind="ghost" mode="light" onPress={onSkip} style={{ marginTop: 8 }} />
      )}
    </View>
  );
}

const inputStyle = {
  color: light.ink,
  backgroundColor: light.surface1,
  borderWidth: 1,
  borderColor: light.hairline,
  borderRadius: 14,
  paddingHorizontal: 14,
  minHeight: 48,
} as const;
