import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { Card, GButton } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import type { SensorCalibration } from '@/lib/calibration';
import { getLatestReading, type Reading } from '@/lib/devices';
import { effectiveSoilEndpoints } from '@/lib/sensing/autoCalibration';
import { ADC_MAX, FACTORY_SOIL_ENDPOINTS, endpointsValid, soilIndex } from '@/lib/sensing/moisture';
import { useGreenr } from '@/lib/store';

/**
 * Give one sensor its own scale.
 *
 * The soil probe does not report moisture. It reports a number from 0 to 4095
 * (high = dry) that depends on the probe AND on the board reading it — an
 * ESP32-C3 turns the same voltage into a different number from the original
 * ESP32. To turn it into a moisture index the app needs two reference numbers
 * from THIS probe on THIS board: what it reads in open air (index 0) and standing
 * in water (index 100). Until both are captured it borrows a pair measured on a
 * different unit, and every reading carries that unit's error.
 *
 * Most sensors never need this screen: the air end is measured automatically
 * during setup and the water end estimated from it (lib/sensing/autoCalibration).
 * Capturing here replaces the automatic values with measured ones — the water
 * end above all, which is the one the automatic scale can only estimate.
 *
 * The capture uses the sensor's newest RAW reading, fetched directly from the
 * database (so it works before the sensor is assigned to a plant) and refreshed
 * every few seconds while this card is open. The sensor takes a reading the
 * moment it starts, so the steps are: put the probe in place, press its RST
 * button, wait for the number here to update, capture.
 */
const AGE_OK_MIN = 20;
const POLL_MS = 5000;

export default function SoilRangeCard({ sensorKey, calibration }: {
  /** the device id */
  sensorKey: string;
  calibration: SensorCalibration;
}) {
  const { setSoilEndpoint } = useGreenr();
  const [latest, setLatest] = useState<Reading | null>(null);
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [manual, setManual] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      setLatest(await getLatestReading(sensorKey));
    } finally {
      setChecking(false);
      setNow(Date.now());
    }
  }, [sensorKey]);

  useEffect(() => {
    void refresh();
    const iv = setInterval(() => { void refresh(); }, POLL_MS);
    return () => clearInterval(iv);
  }, [refresh]);

  const e = calibration.soilEndpoints ?? {};
  const done = endpointsValid(e);
  const auto = calibration.soilEndpointsAuto ?? null;
  // What readings are actually converted with right now, and where each end came from.
  const scale = effectiveSoilEndpoints(calibration.soilEndpoints, auto);
  const usingOwn = scale.source !== 'factory';
  const endHint = (end: 'dry' | 'wet'): string => {
    const own = end === 'dry' ? e.dryAdc : e.wetAdc;
    if (own != null && (done || scale.source === 'mixed')) return 'captured by you';
    if (!usingOwn) return end === 'dry' ? '0 on the scale' : '100 on the scale';
    if (end === 'dry' && auto?.method === 'air') return 'measured at setup';
    return 'estimated';
  };
  const raw = latest?.soil_raw ?? null;
  const ageMin = latest ? (now - new Date(latest.created_at).getTime()) / 60000 : null;
  const fresh = raw != null && ageMin != null && ageMin <= AGE_OK_MIN;
  const typed = parseInt(manual, 10);
  const value = Number.isFinite(typed) ? typed : fresh ? raw : null;
  const clipped = value != null && value >= ADC_MAX - 5;

  const capture = (end: 'dry' | 'wet') => {
    if (value == null) return;
    const before = JSON.stringify(calibration.soilEndpoints ?? {});
    setSoilEndpoint(sensorKey, end, value);
    setManual('');
    // The store refuses implausible counts and drops a reversed pair; say what happened.
    setTimeout(() => setNote(
      value < 200 || value > ADC_MAX
        ? 'That count is outside what a connected probe produces, so it was not saved.'
        : `Saved ${value} as the ${end === 'dry' ? 'in-air' : 'in-water'} reading.${before === '{}' ? ' Now capture the other end.' : ''}`,
    ), 0);
  };

  const ageWords = (m: number) =>
    m < 1 ? 'just now' : m < 60 ? `${Math.round(m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons
          name={done || scale.source === 'auto-air' ? 'checkmark-circle' : 'options-outline'}
          size={18}
          color={done ? accent.sage : scale.source === 'auto-air' ? accent.verdant : accent.sunbeam}
        />
        <Text style={[type.cardTitle, { color: dark.ink, fontSize: 16, flex: 1 }]}>
          {done
            ? 'This sensor has its own scale'
            : scale.source === 'auto-air'
              ? 'Calibrated automatically'
              : scale.source === 'auto-data'
                ? 'Scale estimated from its readings'
                : scale.source === 'mixed'
                  ? 'Partly captured'
                  : 'Using the factory scale'}
        </Text>
      </View>
      <Text style={[type.caption, { color: dark.inkMuted, lineHeight: 19, marginTop: 6 }]}>
        {done
          ? `In air it reads ${e.dryAdc}, in water ${e.wetAdc}. Every moisture figure for this sensor is worked out between those two.`
          : scale.source === 'auto-air'
            ? `Its in-air reading, ${scale.endpoints.dryAdc}, was measured during setup. Its in-water reading, about ${scale.endpoints.wetAdc}, is estimated from that. Capturing the water reading below makes the scale exact.`
            : scale.source === 'auto-data'
              ? `There was no in-air reading at setup, so the scale (${scale.endpoints.dryAdc} to ${scale.endpoints.wetAdc}) is estimated from the range this sensor has reported. Capturing both readings below makes it exact.`
              : scale.source === 'mixed'
                ? `Scaled between ${scale.endpoints.dryAdc} (air) and ${scale.endpoints.wetAdc} (water); one end is yours, the other ${auto ? 'worked out automatically' : 'estimated'}. Capture the other end to finish.`
                : `Readings are scaled between ${FACTORY_SOIL_ENDPOINTS.dryAdc} (air) and ${FACTORY_SOIL_ENDPOINTS.wetAdc} (water), numbers measured on a different sensor and board. Capturing this sensor’s own two readings removes that error. It takes five minutes, once.`}
      </Text>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <End label="In open air" value={usingOwn ? scale.endpoints.dryAdc : e.dryAdc} hint={endHint('dry')} />
        <End label="In water, to the line" value={usingOwn ? scale.endpoints.wetAdc : e.wetAdc} hint={endHint('wet')} />
      </View>

      <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.4, marginTop: 14 }]}>HOW</Text>
      {[
        'Pull the probe out of the pot, wipe it dry, and hold it by the top in open air, with your fingers away from the blade.',
        'Press the RST button on the sensor. It takes a reading straight away and uploads it in about 15 seconds. When the number below updates, tap “Capture air”.',
        'Stand the probe in a glass of water up to its white line, not deeper. The electronics above the line must stay dry. Press RST again.',
        'When the number updates, tap “Capture water”. Then push the probe back into the pot to its line and press RST once more.',
      ].map((s, i) => (
        <View key={s} style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          <Text style={[type.caption, { color: accent.verdant, width: 14 }]}>{i + 1}</Text>
          <Text style={[type.caption, { color: dark.ink, flex: 1, lineHeight: 19 }]}>{s}</Text>
        </View>
      ))}

      <View style={{ marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: dark.surface2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.4, flex: 1 }]}>LATEST RAW READING</Text>
          {checking ? (
            <ActivityIndicator size="small" color={dark.inkMuted} />
          ) : (
            <Pressable onPress={() => void refresh()} hitSlop={8} accessibilityLabel="Check for a new reading">
              <Ionicons name="refresh" size={16} color={accent.verdant} />
            </Pressable>
          )}
        </View>
        <Text style={[type.numBold as any, { color: fresh ? dark.ink : dark.inkMuted, fontSize: 26, marginTop: 2 }]}>
          {raw ?? '—'}
        </Text>
        <Text style={[type.micro, { color: fresh ? accent.sage : accent.sunbeam, marginTop: 2, lineHeight: 16 }]}>
          {raw == null
            ? latest
              ? 'The newest reading has no raw count (older firmware). Type the count from the sensor’s Serial Monitor below.'
              : 'No reading from this sensor yet. Press its RST button; this checks again every few seconds.'
            : fresh
              ? `Taken ${ageWords(ageMin!)}, recent enough to capture.${usingOwn ? ` Reads ${Math.round(soilIndex(raw, scale.endpoints))} on this sensor’s scale.` : ''}`
              : `Taken ${ageWords(ageMin!)}. Press the sensor’s RST button for a fresh one; this checks every few seconds.`}
        </Text>
        {clipped && (
          <Text style={[type.micro, { color: accent.sunbeam, marginTop: 6, lineHeight: 16 }]}>
            {ADC_MAX} is the top of the scale, so the true air value is at least this. Fine to capture as the air
            end; very dry soil will then read 0.
          </Text>
        )}
        <TextInput
          value={manual}
          onChangeText={(t) => { setManual(t.replace(/[^0-9]/g, '').slice(0, 4)); setNote(null); }}
          placeholder="Or type a raw count (200–4095)"
          placeholderTextColor={dark.inkMuted}
          keyboardType="number-pad"
          style={[type.body, { color: dark.ink, borderWidth: 1, borderColor: dark.hairline, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, marginTop: 10 }]}
        />
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <GButton title="Capture air" kind="secondary" disabled={value == null} onPress={() => capture('dry')} style={{ flex: 1 }} />
        <GButton title="Capture water" kind="secondary" disabled={value == null} onPress={() => capture('wet')} style={{ flex: 1 }} />
      </View>
      {note && <Text style={[type.caption, { color: accent.sage, marginTop: 10, lineHeight: 18 }]}>{note}</Text>}
      {!done && (e.dryAdc != null || e.wetAdc != null) && (
        <Text style={[type.micro, { color: accent.sunbeam, marginTop: 8, lineHeight: 16 }]}>
          {scale.source === 'mixed'
            ? 'One end captured. The other end is worked out automatically until you capture it too. The in-air count must be at least 400 above the in-water one.'
            : 'One end captured. Until the other end can be worked out, the factory scale is used. The in-air count must be at least 400 above the in-water one.'}
        </Text>
      )}
    </Card>
  );
}

function End({ label, value, hint }: { label: string; value?: number; hint: string }) {
  return (
    <View style={{ flex: 1, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: value != null ? accent.sage : dark.hairline }}>
      <Text style={[type.micro, { color: dark.inkMuted }]}>{label}</Text>
      <Text style={[type.numBold as any, { color: value != null ? dark.ink : dark.inkMuted, fontSize: 20, marginTop: 2 }]}>
        {value ?? 'not set'}
      </Text>
      <Text style={[type.micro, { color: dark.inkMuted }]}>{hint}</Text>
    </View>
  );
}
