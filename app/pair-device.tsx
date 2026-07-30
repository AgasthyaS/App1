import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { QRScanner } from '@/components/greenr/QRScanner';
import { Card, GButton, Screen } from '@/components/greenr/UI';
import { WifiSetupFlow } from '@/components/greenr/WifiSetupFlow';
import { accent, light, type } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import {
  assignDeviceToPlant,
  deviceSeenSince,
  getLatestReading,
  parsePairing,
  registerDevice,
  type Reading,
} from '@/lib/devices';
import { useGreenr } from '@/lib/store';

/**
 * Real sensor pairing: scan the QR on the device (phone) or paste its code
 * (web), which claims the device for this account. Then assign it to a plant
 * and watch the first live reading land.
 */

type Step = 'scan' | 'linking' | 'wifi' | 'assign' | 'done';

export default function PairDevice() {
  const router = useRouter();
  const { user, enabled, initializing } = useAuth();
  const { plants } = useGreenr();

  const [step, setStep] = useState<Step>('scan');
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [plantId, setPlantId] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [scanning, setScanning] = useState(false);
  // When the Wi-Fi step began — anything the device reports after this proves
  // the new credentials took (rather than an older, pre-setup report).
  const [wifiStartedAt, setWifiStartedAt] = useState(() => Date.now());

  // The camera fires onScan repeatedly while the code is in frame, so a ref
  // (not state, which updates a tick later) guards against claiming twice.
  const claiming = useRef(false);

  const claim = async (raw: string) => {
    if (claiming.current) return;
    const parsed = parsePairing(raw);
    if (!parsed) { setError("That doesn't look like a Greenr sensor code."); return; }
    claiming.current = true;
    setError(null);
    setScanning(false);
    setStep('linking');
    const { error } = await registerDevice(parsed.id, parsed.key);
    claiming.current = false;
    if (error) { setError(error); setStep('scan'); return; }
    setDeviceId(parsed.id);
    setWifiStartedAt(Date.now());     // baseline for confirming the sensor reports
    setStep('wifi');
  };

  // Poll for the first reading once we're on the done screen.
  useEffect(() => {
    if (step !== 'done' || !deviceId) return;
    let alive = true;
    const tick = async () => {
      const r = await getLatestReading(deviceId);
      if (alive && r) setReading(r);
    };
    tick();
    const iv = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, [step, deviceId]);

  // A sensor is claimed BY an account, so a real signed-in user is required —
  // not merely a configured backend. (Checking `enabled` alone let signed-out
  // users reach the scanner and fail later with a raw database error.)
  if (!initializing && (!enabled || !user)) {
    return (
      <Screen mode="light" scroll={false} style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Ionicons name="person-circle-outline" size={44} color={light.inkMuted} />
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 12, textAlign: 'center' }]}>
          Sign in to pair a sensor
        </Text>
        <Text style={[type.body, { color: light.inkMuted, textAlign: 'center', marginTop: 8 }]}>
          {enabled
            ? 'Sensors are linked to your account so their readings follow you across devices.'
            : 'Accounts aren’t configured in this build yet.'}
        </Text>
        {enabled && (
          <GButton title="Sign in" onPress={() => router.replace('/signin')} style={{ marginTop: 18, alignSelf: 'stretch' }} />
        )}
        <GButton title="Go back" kind="secondary" onPress={() => router.back()} style={{ marginTop: 10, alignSelf: 'stretch' }} />
      </Screen>
    );
  }

  // --- scan / enter code ---
  if (step === 'scan') {
    return (
      <Screen mode="light" scroll={false} style={{ justifyContent: 'center' }}>
        <Text style={[type.micro, { color: light.inkMuted, textAlign: 'center', letterSpacing: 0.5 }]}>
          STEP 1 OF 3 · LINK IT TO YOUR ACCOUNT
        </Text>
        <Text style={[type.ritualTitle, { color: light.ink, textAlign: 'center', marginTop: 6 }]}>
          Scan your sensor's QR code
        </Text>
        <Text style={[type.body, { color: light.inkMuted, textAlign: 'center', marginTop: 8 }]}>
          It's on the device (or its box). After this, step 2 connects it to your Wi-Fi
          right here in the app, and step 3 picks which plant it lives with.
        </Text>

        <View style={{ height: 260, borderRadius: 20, overflow: 'hidden', marginTop: 22, backgroundColor: '#000' }}>
          {scanning ? (
            <QRScanner onScan={(data) => { if (step === 'scan') claim(data); }} />
          ) : (
            <Pressable onPress={() => setScanning(true)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="qr-code-outline" size={44} color="#fff" />
              <Text style={{ color: '#fff', marginTop: 10 }}>Tap to scan the QR code</Text>
            </Pressable>
          )}
        </View>

        <Text style={[type.micro, { color: light.inkMuted, textAlign: 'center', marginTop: 18 }]}>
          Or enter the code printed under the QR:
        </Text>
        <TextInput
          value={manual}
          onChangeText={setManual}
          placeholder="greenr://pair?d=…"
          placeholderTextColor={light.inkMuted}
          autoCapitalize="none"
          style={[type.body, {
            color: light.ink, backgroundColor: light.surface1, borderWidth: 1, borderColor: light.hairline,
            borderRadius: 14, paddingHorizontal: 14, minHeight: 48, marginTop: 8,
          }]}
        />
        {error && <Text style={[type.micro, { color: '#C0392B', marginTop: 10 }]}>{error}</Text>}
        <GButton title="Pair sensor" onPress={() => claim(manual)} disabled={!manual.trim()} style={{ marginTop: 12 }} />
        <GButton
          title="Skip to Wi-Fi setup — Find my sensor"
          kind="secondary"
          onPress={() => router.push('/wifi-setup' as any)}
          style={{ marginTop: 10 }}
        />
        <Text style={[type.micro, { color: light.inkMuted, textAlign: 'center', marginTop: 6, lineHeight: 15 }]}>
          Already paired, or just need to get it online? Wi-Fi setup finds it over Bluetooth.
        </Text>
        <Pressable onPress={() => router.back()} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center', marginTop: 4 }}>
          <Text style={[type.body, { color: light.inkMuted }]}>Cancel</Text>
        </Pressable>
      </Screen>
    );
  }

  if (step === 'linking') {
    return (
      <Screen mode="light" scroll={false} style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Ionicons name="link" size={40} color={accent.verdant} />
        <Text style={[type.body, { color: light.inkMuted, marginTop: 14 }]}>Linking sensor to your account…</Text>
      </Screen>
    );
  }

  // --- give the sensor Wi-Fi (skippable if it's already online) ---
  if (step === 'wifi') {
    return (
      <Screen mode="light">
        <Text style={[type.micro, { color: accent.sage, marginTop: 8 }]}>
          PAIRED ✓ · STEP 2 OF 3 — CONNECT IT TO WI-FI
        </Text>
        <WifiSetupFlow
          onDone={() => setStep('assign')}
          doneCta="Continue"
          onSkip={() => setStep('assign')}
          skipLabel="Already on Wi-Fi — skip"
          // Confirm from the cloud, not just Bluetooth: the sensor uploads the
          // moment it joins, so a fresh last_seen proves setup worked even if
          // the BLE link dropped before it could report back.
          verify={deviceId ? () => deviceSeenSince(deviceId, wifiStartedAt) : undefined}
        />
      </Screen>
    );
  }

  // --- assign to a plant ---
  if (step === 'assign') {
    const active = plants.filter((p) => !p.archived);
    return (
      <Screen mode="light">
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 8, letterSpacing: 0.5 }]}>
          STEP 3 OF 3 · PICK ITS PLANT
        </Text>
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 6 }]}>Almost done</Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 8 }]}>
          Which plant does this sensor live with?
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
          {active.map((p) => (
            <Card key={p.id} mode="light"
              style={{ width: '48%', alignItems: 'center', borderWidth: 2, borderColor: plantId === p.id ? accent.verdant : 'transparent' }}
              onPress={() => setPlantId(p.id)}>
              <Text style={{ fontSize: 30 }}>{p.emoji}</Text>
              <Text style={[type.cardTitle, { color: light.ink, marginTop: 6 }]} numberOfLines={1}>{p.name}</Text>
            </Card>
          ))}
        </View>
        {active.length === 0 && (
          <Text style={[type.body, { color: light.inkMuted, marginTop: 12 }]}>
            No plants yet — you can assign the sensor later from the plant's screen.
          </Text>
        )}
        <GButton
          title={plantId ? 'Assign & finish' : 'Skip for now'}
          onPress={async () => {
            if (deviceId && plantId) await assignDeviceToPlant(deviceId, plantId);
            setStep('done');
          }}
          style={{ marginTop: 16 }}
        />
      </Screen>
    );
  }

  // --- done: waiting for / showing first reading ---
  const V = ({ label, value }: { label: string; value: string }) => (
    <Card mode="light" style={{ width: '47%', alignItems: 'center' }}>
      <Text style={[type.numBold as any, { fontSize: 24, color: light.ink }]}>{value}</Text>
      <Text style={[type.micro, { color: light.inkMuted, marginTop: 2 }]}>{label}</Text>
    </Card>
  );
  const num = (v: number | null) => (v != null ? String(v) : '—');
  return (
    <Screen mode="light" scroll={false} style={{ justifyContent: 'center' }}>
      <View style={{ alignItems: 'center' }}>
        <Ionicons name="checkmark-circle" size={54} color={accent.sage} />
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 12, textAlign: 'center' }]}>
          Sensor connected.
        </Text>
      </View>
      {reading ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 20, justifyContent: 'center' }}>
            <V label="soil moisture" value={`${num(reading.soil_pct)}%`} />
            <V label="light" value={num(reading.light_lux)} />
            <V label="temp" value={`${num(reading.temp_c)}°C`} />
            <V label="humidity" value={`${num(reading.humidity_pct)}%`} />
          </View>
          <Text style={[type.micro, { color: light.inkMuted, textAlign: 'center', marginTop: 12 }]}>
            Soil at 0% means the probe is reading dry (e.g. in the air). Put it in
            moist soil or water and it climbs.
          </Text>
        </>
      ) : (
        <Text style={[type.body, { color: light.inkMuted, textAlign: 'center', marginTop: 24 }]}>
          Waiting for the first reading… it lands within a few minutes of the sensor waking.
        </Text>
      )}
      <GButton
        title="Done"
        onPress={() => {
          try { if (router.canDismiss()) { router.dismiss(); return; } } catch {}
          router.replace('/(tabs)');
        }}
        style={{ marginTop: 24 }}
      />
    </Screen>
  );
}
