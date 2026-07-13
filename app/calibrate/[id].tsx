import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Card, Chip, GButton, Hairline, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import {
  METRIC_LABELS,
  RECOMMENDED_DAYS,
  computeOffset,
  daysSince,
  emptyCalibration,
  isOverdue,
  type CalMetricKey,
} from '@/lib/calibration';
import { useGreenr } from '@/lib/store';

const METRICS: CalMetricKey[] = ['moisture', 'temperature', 'humidity', 'light'];

/**
 * Sensor calibration (§8). For each metric the user enters what a trusted
 * reference reads and what the sensor currently shows; the difference becomes a
 * stored offset (with date + history) that corrects every future reading.
 */
export default function Calibrate() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { sensors, calibrations, calibrateMetric, setLightInverted } = useGreenr();
  const key = typeof id === 'string' ? id : '';
  const sensor = sensors.find((s) => s.id === key);
  const cal = calibrations[key] ?? emptyCalibration();
  const inverted = !!cal.lightInverted;

  const [openMetric, setOpenMetric] = useState<CalMetricKey | null>(null);
  const [ref, setRef] = useState('');
  const [meas, setMeas] = useState('');
  const [savedKey, setSavedKey] = useState<CalMetricKey | null>(null);

  const openForm = (m: CalMetricKey) => {
    setOpenMetric(openMetric === m ? null : m);
    setRef('');
    setMeas('');
  };

  const preview = () => {
    const r = parseFloat(ref);
    const m = parseFloat(meas);
    if (Number.isNaN(r) || Number.isNaN(m)) return null;
    return computeOffset(r, m);
  };

  const save = (m: CalMetricKey) => {
    const r = parseFloat(ref);
    const me = parseFloat(meas);
    if (Number.isNaN(r) || Number.isNaN(me)) return;
    calibrateMetric(key, m, r, me);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setSavedKey(m);
    setOpenMetric(null);
    setTimeout(() => setSavedKey((k) => (k === m ? null : k)), 2200);
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Calibrate</Text>
      </View>
      <Text style={[type.caption, { color: dark.inkMuted, marginTop: 4, lineHeight: 18 }]}>
        {sensor ? `${sensor.name} · ` : ''}Enter what a trusted reference reads and what the sensor
        shows now. Greenr stores the difference and corrects every future reading with it.
      </Text>

      {METRICS.map((m) => {
        const cm = cal[m];
        const { label, unit } = METRIC_LABELS[m];
        const since = daysSince(cm.calibratedAt);
        const overdue = isOverdue(cm, m);
        const off = preview();
        return (
          <View key={m}>
            <SectionHeader>{label}</SectionHeader>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  {cm.calibratedAt ? (
                    <>
                      <Text style={[type.cardTitle, { color: dark.ink, fontSize: 16 }]}>
                        Offset {cm.offset >= 0 ? '+' : ''}
                        {cm.offset}
                        {unit}
                      </Text>
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>
                        Calibrated {since === 0 ? 'today' : `${since} day${since === 1 ? '' : 's'} ago`} ·
                        recheck every {RECOMMENDED_DAYS[m]} days
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={[type.cardTitle, { color: dark.inkMuted, fontSize: 16 }]}>
                        Not calibrated
                      </Text>
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>
                        Readings are used as-is · recommended every {RECOMMENDED_DAYS[m]} days
                      </Text>
                    </>
                  )}
                </View>
                {savedKey === m ? (
                  <Chip label="Saved ✓" color={accent.sage} />
                ) : overdue ? (
                  <Chip label="Overdue" color={accent.sunbeamText} />
                ) : null}
                <Pressable onPress={() => openForm(m)} style={{ minHeight: 44, justifyContent: 'center', paddingLeft: 8 }}>
                  <Text style={[type.body, { color: accent.verdant }]}>
                    {openMetric === m ? 'Cancel' : 'Calibrate'}
                  </Text>
                </Pressable>
              </View>

              {m === 'light' && (
                <View style={{ marginTop: 12 }}>
                  <Hairline style={{ marginBottom: 10 }} />
                  <Pressable
                    onPress={() => setLightInverted(key, !inverted)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
                  >
                    <Ionicons
                      name={inverted ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={inverted ? accent.verdant : dark.inkMuted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.body, { color: dark.ink }]}>Reversed light sensor</Text>
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, lineHeight: 15 }]}>
                        Some LDR modules read HIGH in the dark and LOW in bright light. Turn this on
                        if shining a light makes the reading drop — the app flips it (100 − reading)
                        everywhere.
                      </Text>
                    </View>
                  </Pressable>
                  {inverted && (
                    <Text style={[type.micro, { color: accent.sage, marginTop: 4 }]}>
                      ✓ Flipping readings — bright now reads high.
                    </Text>
                  )}
                </View>
              )}

              {openMetric === m && (
                <View style={{ marginTop: 12 }}>
                  <Hairline style={{ marginBottom: 12 }} />
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[type.micro, { color: dark.inkMuted }]}>REFERENCE ({unit})</Text>
                      <TextInput
                        value={ref}
                        onChangeText={setRef}
                        keyboardType="numeric"
                        placeholder="should read"
                        placeholderTextColor={dark.inkMuted}
                        style={{
                          color: dark.ink,
                          backgroundColor: dark.surface2,
                          borderRadius: 10,
                          paddingHorizontal: 12,
                          minHeight: 44,
                          marginTop: 4,
                          fontSize: 16,
                        }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[type.micro, { color: dark.inkMuted }]}>SENSOR NOW ({unit})</Text>
                      <TextInput
                        value={meas}
                        onChangeText={setMeas}
                        keyboardType="numeric"
                        placeholder="reads now"
                        placeholderTextColor={dark.inkMuted}
                        style={{
                          color: dark.ink,
                          backgroundColor: dark.surface2,
                          borderRadius: 10,
                          paddingHorizontal: 12,
                          minHeight: 44,
                          marginTop: 4,
                          fontSize: 16,
                        }}
                      />
                    </View>
                  </View>
                  {off != null && (
                    <Text style={[type.caption, { color: dark.ink, marginTop: 10 }]}>
                      New offset: {off >= 0 ? '+' : ''}
                      {off}
                      {unit} — every reading will be adjusted by this.
                    </Text>
                  )}
                  <GButton
                    title="Save calibration"
                    onPress={() => save(m)}
                    disabled={off == null}
                    style={{ marginTop: 12 }}
                  />
                </View>
              )}

              {cm.history.length > 0 && (
                <View style={{ marginTop: 10 }}>
                  <Hairline style={{ marginBottom: 8 }} />
                  <Text style={[type.micro, { color: dark.inkMuted, marginBottom: 4 }]}>HISTORY</Text>
                  {cm.history.slice(0, 4).map((h, i) => (
                    <Text key={i} style={[type.micro, { color: dark.inkMuted, lineHeight: 16 }]}>
                      {new Date(h.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ·
                      ref {h.reference}
                      {unit}, sensor {h.measured}
                      {unit} → {h.offset >= 0 ? '+' : ''}
                      {h.offset}
                      {unit}
                    </Text>
                  ))}
                </View>
              )}
            </Card>
          </View>
        );
      })}

      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 16, lineHeight: 15 }]}>
        Calibration is stored with your account and applied to plant health and watering
        automatically. Recalibrate after repotting (moisture) or if a reading looks off.
      </Text>
    </Screen>
  );
}
