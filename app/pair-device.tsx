import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';

import { Card, GButton, Screen } from '@/components/greenr/UI';
import { accent, light, type } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import {
  assignDeviceToPlant,
  getLatestReading,
  parsePairing,
  registerDevice,
  requestReadNow,
  type Reading,
} from '@/lib/devices';
import { useGreenr } from '@/lib/store';

/**
 * Real sensor pairing: scan the QR on the device (phone) or paste its code
 * (web), which claims the device for this account. Then assign it to a plant
 * and watch the first live reading land.
 */

type Step = 'scan' | 'linking' | 'assign' | 'done';

export default function PairDevice() {
  const router = useRouter();
  const { enabled } = useAuth();
  const { plants } = useGreenr();

  const [step, setStep] = useState<Step>('scan');
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [plantId, setPlantId] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const useCamera = Platform.OS !== 'web';

  const claim = async (raw: string) => {
    setError(null);
    const parsed = parsePairing(raw);
    if (!parsed) { setError("That doesn't look like a Greenr sensor code."); return; }
    setStep('linking');
    const { error } = await registerDevice(parsed.id, parsed.key);
    if (error) { setError(error); setStep('scan'); return; }
    setDeviceId(parsed.id);
    requestReadNow(parsed.id); // nudge it to report soon
    setStep('assign');
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

  if (!enabled) {
    return (
      <Screen mode="light" scroll={false} style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Text style={[type.body, { color: light.inkMuted, textAlign: 'center' }]}>
          Sign in first to pair a sensor to your account.
        </Text>
        <GButton title="Go back" onPress={() => router.back()} style={{ marginTop: 16 }} />
      </Screen>
    );
  }

  // --- scan / enter code ---
  if (step === 'scan') {
    return (
      <Screen mode="light" scroll={false} style={{ justifyContent: 'center' }}>
        <Text style={[type.ritualTitle, { color: light.ink, textAlign: 'center' }]}>
          Scan your sensor's QR code
        </Text>
        <Text style={[type.body, { color: light.inkMuted, textAlign: 'center', marginTop: 8 }]}>
          It's on the device (or its box). This links the sensor to your account.
        </Text>

        {useCamera && (
          <View style={{ height: 260, borderRadius: 20, overflow: 'hidden', marginTop: 22, backgroundColor: '#000' }}>
            {permission?.granted ? (
              <CameraView
                style={{ flex: 1 }}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => { if (step === 'scan') claim(data); }}
              />
            ) : (
              <Pressable onPress={requestPermission} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="camera-outline" size={40} color="#fff" />
                <Text style={{ color: '#fff', marginTop: 8 }}>Tap to enable the camera</Text>
              </Pressable>
            )}
          </View>
        )}

        <Text style={[type.micro, { color: light.inkMuted, textAlign: 'center', marginTop: 18 }]}>
          {useCamera ? 'Or enter the code underneath the QR:' : 'Enter the code printed under the QR:'}
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
        <Pressable onPress={() => router.back()} style={{ alignSelf: 'center', marginTop: 12, minHeight: 44, justifyContent: 'center' }}>
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

  // --- assign to a plant ---
  if (step === 'assign') {
    const active = plants.filter((p) => !p.archived);
    return (
      <Screen mode="light">
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>Paired! ✅</Text>
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
    <Card mode="light" style={{ flex: 1, alignItems: 'center' }}>
      <Text style={[type.numBold as any, { fontSize: 26, color: light.ink }]}>{value}</Text>
      <Text style={[type.micro, { color: light.inkMuted, marginTop: 2 }]}>{label}</Text>
    </Card>
  );
  return (
    <Screen mode="light" scroll={false} style={{ justifyContent: 'center' }}>
      <View style={{ alignItems: 'center' }}>
        <Ionicons name="checkmark-circle" size={54} color={accent.sage} />
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 12, textAlign: 'center' }]}>
          Sensor connected.
        </Text>
      </View>
      {reading ? (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 24 }}>
          <V label="light" value={reading.light_lux != null ? String(reading.light_lux) : '—'} />
          <V label="soil %" value={reading.soil_pct != null ? String(reading.soil_pct) : '—'} />
          <V label="temp °C" value={reading.temp_c != null ? String(reading.temp_c) : '—'} />
        </View>
      ) : (
        <Text style={[type.body, { color: light.inkMuted, textAlign: 'center', marginTop: 24 }]}>
          Waiting for the first reading… it lands within a few minutes of the sensor waking.
        </Text>
      )}
      <GButton title="Done" onPress={() => router.dismiss()} style={{ marginTop: 28 }} />
    </Screen>
  );
}
