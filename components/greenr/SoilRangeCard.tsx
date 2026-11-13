import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { Card, GButton } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import type { SensorCalibration } from '@/lib/calibration';
import type { Reading } from '@/lib/devices';
import { FACTORY_SOIL_ENDPOINTS, endpointsValid, soilIndex } from '@/lib/sensing/moisture';
import { useGreenr } from '@/lib/store';

/**
 * Give one sensor its own scale.
 *
 * Every probe reads a little differently in open air and in water, and the board
 * it is wired to changes the numbers again. Until these two readings are
 * captured the sensor uses a factory pair measured on a different unit, which
 * puts a fixed error on everything it reports.
 *
 * The capture uses the sensor's most recent RAW reading. The sensor only reports
 * every few hours, but it also reads the moment it powers up — so the
 * instructions are: put the probe where it needs to be, unplug and replug the
 * sensor, wait for the reading to appear here, then capture.
 */
const AGE_OK_MIN = 20;

export default function SoilRangeCard({ sensorKey, calibration, latest }: {
  sensorKey: string;
  calibration: SensorCalibration;
  /** the newest reading from this sensor, uncalibrated */
  latest: Reading | null;
}) {
  const { setSoilEndpoint } = useGreenr();
  const [manual, setManual] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const e = calibration.soilEndpoints ?? {};
  const done = endpointsValid(e);
  const raw = latest?.soil_raw ?? null;
  const ageMin = latest ? (Date.now() - new Date(latest.created_at).getTime()) / 60000 : null;
  const fresh = raw != null && ageMin != null && ageMin <= AGE_OK_MIN;
  const typed = parseInt(manual, 10);
  const value = Number.isFinite(typed) ? typed : fresh ? raw : null;

  const capture = (end: 'dry' | 'wet') => {
    if (value == null) return;
    const before = JSON.stringify(calibration.soilEndpoints ?? {});
    setSoilEndpoint(sensorKey, end, value);
    setManual('');
    // The store refuses implausible counts and drops a reversed pair; say what happened.
    setTimeout(() => setNote(
      value < 200 || value > 4095
        ? 'That count is outside what a connected probe produces, so it was not saved.'
        : `Saved ${value} as the ${end === 'dry' ? 'in-air' : 'in-water'} reading.${before === '{}' ? ' Now capture the other end.' : ''}`,
    ), 0);
  };

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={done ? 'checkmark-circle' : 'options-outline'} size={18} color={done ? accent.sage : accent.sunbeam} />
        <Text style={[type.cardTitle, { color: dark.ink, fontSize: 16, flex: 1 }]}>
          {done ? 'This sensor has its own scale' : 'Using the factory scale'}
        </Text>
      </View>
      <Text style={[type.caption, { color: dark.inkMuted, lineHeight: 19, marginTop: 6 }]}>
        {done
          ? `In air it reads ${e.dryAdc}, in water ${e.wetAdc}. Every moisture figure for this sensor is worked out between those two.`
          : `Readings are scaled between ${FACTORY_SOIL_ENDPOINTS.dryAdc} (air) and ${FACTORY_SOIL_ENDPOINTS.wetAdc} (water), measured on a different unit. Capturing this sensor’s own two readings removes that error — it takes five minutes, once.`}
      </Text>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <End label="In open air" value={e.dryAdc} hint="0 on the scale" />
        <End label="In water, to the line" value={e.wetAdc} hint="100 on the scale" />
      </View>

      <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.4, marginTop: 14 }]}>HOW</Text>
      {[
        'Wipe the probe dry and hold it in the air, touching nothing. Unplug the sensor and plug it back in: it takes a reading as it starts.',
        'When a fresh raw reading shows below, tap “Capture air”.',
        'Stand the probe in a glass of water up to its white line — electronics dry — and restart the sensor again.',
        'Tap “Capture water”. Then put it back in the pot.',
      ].map((s, i) => (
        <View key={s} style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          <Text style={[type.caption, { color: accent.verdant, width: 14 }]}>{i + 1}</Text>
          <Text style={[type.caption, { color: dark.ink, flex: 1, lineHeight: 19 }]}>{s}</Text>
        </View>
      ))}

      <View style={{ marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: dark.surface2 }}>
        <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.4 }]}>LATEST RAW READING</Text>
        <Text style={[type.numBold as any, { color: fresh ? dark.ink : dark.inkMuted, fontSize: 26, marginTop: 2 }]}>
          {raw ?? '—'}
        </Text>
        <Text style={[type.micro, { color: fresh ? accent.sage : accent.sunbeam, marginTop: 2, lineHeight: 16 }]}>
          {raw == null
            ? 'No raw reading from this sensor yet.'
            : fresh
              ? `${Math.max(0, Math.round(ageMin!))} min old — recent enough to capture.${done ? ` Reads ${Math.round(soilIndex(raw, e as any))} on this sensor’s scale.` : ''}`
              : `${Math.round(ageMin! / 60)} h old — restart the sensor for a fresh one, or type the count from its serial output below.`}
        </Text>
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
          One end captured. The sensor keeps the factory scale until both are in, and the in-air count must be at
          least 400 above the in-water one.
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
