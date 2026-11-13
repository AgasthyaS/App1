import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { QRScanner } from '@/components/greenr/QRScanner';
import { PowerArt, ProbeDepthArt, ScanArt } from '@/components/greenr/SetupArt';
import { SetupStepper } from '@/components/greenr/SetupStepper';
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
import { isWifiSetupSupported } from '@/lib/wifiSetup';

const PREP: { icon: string; text: string }[] = [
  { icon: 'hardware-chip-outline', text: 'Your Greenr sensor — its QR code is on the back and on the box' },
  { icon: 'flash-outline', text: 'Power: a charged battery, or a wall USB adapter. Not a laptop port: laptops sleep and cut power' },
  { icon: 'wifi-outline', text: 'Your home Wi-Fi name and password (a 2.4 GHz network)' },
  { icon: 'time-outline', text: 'About 3 minutes, close to the sensor' },
];

/**
 * Real sensor pairing: a checklist of what's needed, then scan the QR on the
 * device (phone) or paste its code (web), which claims the device for this
 * account. Then Wi-Fi, assign it to a plant, and show how to put it in the soil
 * while the first live reading lands.
 */

type Step = 'prep' | 'scan' | 'linking' | 'wifi' | 'assign' | 'done';

export default function PairDevice() {
  const router = useRouter();
  const { user, enabled, initializing } = useAuth();
  const { plants } = useGreenr();

  const [step, setStep] = useState<Step>('prep');
  // true when pairing without a QR: the sensor's identity is read over Bluetooth
  const [viaBluetooth, setViaBluetooth] = useState(false);
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

  // --- what you need ---
  if (step === 'prep') {
    return (
      <Screen mode="light">
        <SetupStepper current={0} />
        <Text style={[type.ritualTitle, { color: light.ink }]}>Before you start</Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 6 }]}>
          Setting up a sensor takes about three minutes. Here’s what you’ll need.
        </Text>
        <View style={{ marginTop: 16 }}>
          <PowerArt />
        </View>
        <Card mode="light" style={{ marginTop: 14, gap: 12 }}>
          {PREP.map((p) => (
            <View key={p.icon} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name={p.icon as any} size={20} color={accent.verdant} />
              <Text style={[type.body, { color: light.ink, flex: 1, lineHeight: 20 }]}>{p.text}</Text>
            </View>
          ))}
        </Card>
        <GButton title="I’m ready" track="pair.prep_ready" onPress={() => setStep('scan')} style={{ marginTop: 18 }} />
        <Pressable onPress={() => router.back()} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center', marginTop: 4 }}>
          <Text style={[type.body, { color: light.inkMuted }]}>Not now</Text>
        </Pressable>
      </Screen>
    );
  }

  // --- scan / enter code ---
  if (step === 'scan') {
    return (
      <Screen mode="light">
        <SetupStepper current={0} />
        <Text style={[type.ritualTitle, { color: light.ink }]}>Scan your sensor’s QR code</Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 6 }]}>
          This links the sensor to your account so only you can see its readings.
        </Text>

        <View style={{ marginTop: 16 }}>
          {scanning ? (
            <View style={{ height: 280, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000' }}>
              <QRScanner onScan={(data) => { if (step === 'scan') claim(data); }} />
            </View>
          ) : (
            <ScanArt />
          )}
        </View>
        {!scanning && (
          <GButton title="Start scanning" track="pair.scan_start" onPress={() => setScanning(true)} style={{ marginTop: 14 }} />
        )}
        {scanning && (
          <Text style={[type.caption, { color: light.inkMuted, textAlign: 'center', marginTop: 10 }]}>
            Fill the frame with the QR code and hold still. Good light helps.
          </Text>
        )}

        <Text style={[type.micro, { color: light.inkMuted, marginTop: 20 }]}>
          Camera not working? Type the code printed under the QR:
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
        <GButton title="Pair with this code" kind="secondary" mode="light" onPress={() => claim(manual)} disabled={!manual.trim()} style={{ marginTop: 10 }} />
        {isWifiSetupSupported && (
          <>
            <GButton
              title="No code? Find it over Bluetooth"
              kind="ghost"
              mode="light"
              onPress={() => { setError(null); setViaBluetooth(true); setWifiStartedAt(Date.now()); setStep('wifi'); }}
              style={{ marginTop: 6 }}
            />
            <Text style={[type.micro, { color: light.inkMuted, textAlign: 'center', lineHeight: 15 }]}>
              Only for sensors built with Bluetooth setup.
            </Text>
          </>
        )}
        <Pressable onPress={() => setStep('prep')} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center', marginTop: 4 }}>
          <Text style={[type.body, { color: light.inkMuted }]}>Back</Text>
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
        <SetupStepper current={1} />
        {deviceId && (
          <Text style={[type.micro, { color: accent.sage }]}>LINKED TO YOUR ACCOUNT ✓</Text>
        )}
        <WifiSetupFlow
          startWith={viaBluetooth && !deviceId ? 'bluetooth' : 'hotspot'}
          onDone={() => setStep('assign')}
          doneCta="Continue"
          onSkip={() => setStep('assign')}
          skipLabel="Already on Wi-Fi — skip"
          // Confirm from the cloud, not just Bluetooth: the sensor uploads the
          // moment it joins, so a fresh last_seen proves setup worked even if
          // the BLE link dropped before it could report back.
          verify={deviceId ? () => deviceSeenSince(deviceId, wifiStartedAt) : undefined}
          // No-QR path: the sensor hands us its id+key over Bluetooth, so we
          // claim it right here. (When paired via QR, deviceId is already set.)
          onIdentified={async (id, key) => {
            if (deviceId) return;
            const { error } = await registerDevice(id, key);
            if (error) { setError(error); setStep('scan'); return; }
            setDeviceId(id);
            setWifiStartedAt(Date.now());
          }}
        />
      </Screen>
    );
  }

  // --- assign to a plant ---
  if (step === 'assign') {
    const active = plants.filter((p) => !p.archived);
    return (
      <Screen mode="light">
        <SetupStepper current={2} />
        <Text style={[type.ritualTitle, { color: light.ink }]}>Which plant is it for?</Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 8 }]}>
          Its readings will appear on that plant’s page.
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
        {error && <Text style={[type.micro, { color: '#C0392B', marginTop: 12 }]}>{error}</Text>}
        <GButton
          title={plantId ? 'Assign & finish' : 'Skip for now'}
          onPress={async () => {
            if (deviceId && plantId) {
              const { error: assignErr } = await assignDeviceToPlant(deviceId, plantId);
              if (assignErr) {
                // Don't move on pretending it linked — the plant would show nothing.
                setError(`Couldn’t link the sensor to that plant: ${assignErr}. Try again.`);
                return;
              }
            }
            setError(null);
            setStep('done');
          }}
          style={{ marginTop: 16 }}
        />
      </Screen>
    );
  }

  // --- done: only claim success if the sensor ACTUALLY reported ---
  const V = ({ label, value }: { label: string; value: string }) => (
    <Card mode="light" style={{ width: '47%', alignItems: 'center' }}>
      <Text style={[type.numBold as any, { fontSize: 24, color: light.ink }]}>{value}</Text>
      <Text style={[type.micro, { color: light.inkMuted, marginTop: 2 }]}>{label}</Text>
    </Card>
  );
  const num = (v: number | null) => (v != null ? String(v) : '—');
  // Is this sensor actually alive? Either it reported since setup began, OR its
  // last reading is recent enough that it's clearly still on its normal cycle —
  // a sensor that's been online for weeks shouldn't be told it "needs Wi-Fi"
  // just because we happened to pair it between two 3-hourly readings.
  const readingMs = reading ? new Date(reading.created_at).getTime() : 0;
  const ONE_CYCLE_MS = 3.5 * 60 * 60 * 1000; // one ~3 h reporting cycle, plus slack
  const reportedNow =
    reading != null && (readingMs >= wifiStartedAt || Date.now() - readingMs < ONE_CYCLE_MS);
  return (
    <Screen mode="light">
      <SetupStepper current={3} />
      <View style={{ alignItems: 'center' }}>
        <Ionicons
          name={reportedNow ? 'checkmark-circle' : 'time-outline'}
          size={54}
          color={reportedNow ? accent.sage : accent.sunbeamText}
        />
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 12, textAlign: 'center' }]}>
          {reportedNow ? 'Sensor connected.' : 'Linked — waiting for its first reading'}
        </Text>
      </View>
      {reportedNow && reading ? (
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
        <>
          <Text style={[type.body, { color: light.inkMuted, textAlign: 'center', marginTop: 18, lineHeight: 22 }]}>
            The sensor is linked to your account, but it hasn’t sent a reading yet — so
            it probably still needs its Wi-Fi.
          </Text>
          <GButton
            title="Show the Wi-Fi steps again"
            kind="secondary"
            mode="light"
            onPress={() => { setWifiStartedAt(Date.now()); setStep('wifi'); }}
            style={{ marginTop: 14 }}
          />
          <Text style={[type.micro, { color: light.inkMuted, textAlign: 'center', marginTop: 8 }]}>
            This screen updates by itself the moment the first reading arrives.
          </Text>
          {reading && (
            <Text style={[type.micro, { color: light.inkMuted, textAlign: 'center', marginTop: 12 }]}>
              Its last reading was {new Date(reading.created_at).toLocaleString()} — from before this setup.
            </Text>
          )}
        </>
      )}
      <Text style={[type.cardTitle, { color: light.ink, fontSize: 18, marginTop: 28 }]}>Put it in the soil</Text>
      <Text style={[type.body, { color: light.inkMuted, marginTop: 4, marginBottom: 12 }]}>
        Where the probe sits decides how good its readings are.
      </Text>
      <ProbeDepthArt />
      <Card mode="light" style={{ marginTop: 12, gap: 10 }}>
        {[
          ['arrow-down-outline', 'Push it in up to the line. Deeper wets the electronics; shallower reads only the dry top layer.'],
          ['resize-outline', 'Halfway between the stem and the rim, where the roots drink. Not touching the pot wall.'],
          ['sunny-outline', 'The top facing up and uncovered, so its light reading is real.'],
          ['water-outline', 'Water around it, not onto it.'],
        ].map(([icon, text]) => (
          <View key={icon} style={{ flexDirection: 'row', gap: 12 }}>
            <Ionicons name={icon as any} size={18} color={accent.verdant} style={{ marginTop: 1 }} />
            <Text style={[type.caption, { color: light.ink, flex: 1, lineHeight: 19 }]}>{text}</Text>
          </View>
        ))}
      </Card>

      <GButton
        title={plantId ? 'See it on your plant' : 'Done'}
        onPress={() => {
          // Land the user on the plant they linked, so the sensor readings are
          // right there instead of them hunting for them from the home tab.
          if (plantId) { router.replace({ pathname: '/plant/[id]', params: { id: plantId } }); return; }
          try { if (router.canDismiss()) { router.dismiss(); return; } } catch {}
          router.replace('/(tabs)');
        }}
        style={{ marginTop: 24 }}
      />
    </Screen>
  );
}
