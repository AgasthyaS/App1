import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';

import { Card, Chip, GButton, Hairline, Screen, SectionHeader, StatusDot } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { relTime, signalWord } from '@/lib/format';
import { activePlants, useGreenr } from '@/lib/store';

/** Sensor Detail (§5.2) — every reading traceable, every control live. */
export default function SensorDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const {
    sensors,
    plants,
    spots,
    settings,
    readNow,
    reassignSensor,
    recalibrateSensor,
    installFirmware,
    forgetSensor,
  } = useGreenr();
  const [logOpen, setLogOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [troubleshootOpen, setTroubleshootOpen] = useState(false);
  const [readRequested, setReadRequested] = useState(false);
  const [recalibrated, setRecalibrated] = useState(false);
  const [installing, setInstalling] = useState(false);

  const sensor = sensors.find((s) => s.id === id);
  const plant = plants.find((p) => p.id === sensor?.plantId);
  const spot = spots.find((s) => s.id === plant?.spotId);

  if (!sensor) {
    return (
      <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.body, { color: dark.inkMuted }]}>
          This sensor is no longer registered.
        </Text>
        <GButton title="Back" kind="secondary" onPress={() => router.back()} style={{ marginTop: 16 }} />
      </Screen>
    );
  }

  const batteryColor =
    sensor.batteryPct < 10 ? accent.clay : sensor.batteryPct < 20 ? accent.sunbeam : dark.ink;
  const watch = sensor.wakeIntervalMins <= 30;
  const nextWakeMins = Math.max(0, sensor.wakeIntervalMins - sensor.lastReadingMinsAgo);

  const soilOut =
    plant && (sensor.latest.soilPct < plant.comfortBand[0] || sensor.latest.soilPct > plant.comfortBand[1]);

  const measurements = [
    { label: 'Soil', value: `${sensor.latest.soilPct}%`, color: soilOut ? accent.clay : dark.ink },
    { label: 'Light pace', value: `${sensor.latest.dli.toFixed(1)} DLI`, color: dark.ink },
    { label: 'Temp', value: `${settings.unitsF ? sensor.latest.tempF + '°F' : Math.round(((sensor.latest.tempF - 32) * 5) / 9) + '°C'}`, color: dark.ink },
    { label: 'Humidity', value: `${sensor.latest.rhPct}% RH`, color: dark.ink },
  ];

  // synthesized recent-wake log rows
  const log = Array.from({ length: 8 }, (_, i) => ({
    time: relTime(sensor.lastReadingMinsAgo + i * sensor.wakeIntervalMins),
    soil: Math.max(5, sensor.latest.soilPct + i * 2),
    dli: Math.max(0, sensor.latest.dli - (i % 4) * 0.6).toFixed(1),
    temp: sensor.latest.tempF - (i % 3),
    rh: sensor.latest.rhPct + (i % 5) - 2,
    batt: Math.min(100, sensor.batteryPct + Math.floor(i / 3)),
  }));

  const exportCsv = () => {
    if (!settings.plus) {
      router.push('/plus');
      return;
    }
    const header = 'time,soil_pct,dli,temp_f,rh_pct,battery_pct';
    const rows = log.map((r) => `${r.time},${r.soil},${r.dli},${r.temp},${r.rh},${r.batt}`);
    Share.share({ message: [header, ...rows].join('\n'), title: `${sensor.name} readings` }).catch(() => {});
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={{ fontSize: 28 }}>📡</Text>
        <View style={{ flex: 1 }}>
          <Text style={[type.screenTitle, { color: dark.ink, fontSize: 22 }]}>{sensor.name}</Text>
          <StatusDot status={sensor.status} />
        </View>
      </View>

      {/* assignment */}
      <Card style={{ marginTop: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { color: dark.ink }]}>
              {plant ? `${plant.name} · ${spot?.name ?? '—'}` : 'Unassigned'}
            </Text>
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>
              Reassigning archives this stream to the plant&apos;s history and starts fresh.
            </Text>
          </View>
          <Pressable onPress={() => setReassignOpen(!reassignOpen)} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={[type.body, { color: accent.verdant }]}>
              {reassignOpen ? 'Cancel' : 'Reassign'}
            </Text>
          </Pressable>
        </View>
        {reassignOpen && (
          <View style={{ marginTop: 10 }}>
            <Hairline style={{ marginBottom: 8 }} />
            {activePlants(plants)
              .filter((p) => p.id !== sensor.plantId)
              .map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    reassignSensor(sensor.id, p.id);
                    setReassignOpen(false);
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
                >
                  <Text style={{ fontSize: 18 }}>{p.emoji}</Text>
                  <Text style={[type.body, { color: dark.ink, flex: 1 }]}>{p.name}</Text>
                  {p.sensorId && <Text style={[type.micro, { color: dark.inkMuted }]}>has a sensor</Text>}
                </Pressable>
              ))}
            {activePlants(plants).filter((p) => p.id !== sensor.plantId).length === 0 && (
              <Text style={[type.caption, { color: dark.inkMuted }]}>No other plants to assign.</Text>
            )}
          </View>
        )}
      </Card>

      {/* status 2×2 */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
        <Card style={{ width: '48%' }}>
          <Text style={[type.micro, { color: dark.inkMuted }]}>BATTERY</Text>
          <Text style={[type.numBold as any, { fontSize: 24, color: batteryColor, marginTop: 4 }]}>
            {sensor.batteryPct}%
          </Text>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: dark.hairline, marginTop: 8 }}>
            <View style={{ width: `${sensor.batteryPct}%`, height: 4, borderRadius: 2, backgroundColor: batteryColor === dark.ink ? accent.sage : batteryColor }} />
          </View>
          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6 }]}>{sensor.batteryEta} left</Text>
        </Card>
        <Card style={{ width: '48%' }}>
          <Text style={[type.micro, { color: dark.inkMuted }]}>SIGNAL</Text>
          <Text style={[type.numBold as any, { fontSize: 24, color: dark.ink, marginTop: 4 }]}>
            {signalWord(sensor.rssiDbm)}
          </Text>
          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6 }]}>{sensor.rssiDbm} dBm</Text>
        </Card>
        <Card style={{ width: '48%' }}>
          <Text style={[type.micro, { color: dark.inkMuted }]}>LAST READING</Text>
          <Text style={[type.numBold as any, { fontSize: 17, color: dark.ink, marginTop: 4 }]}>
            {sensor.lastReadingMinsAgo === 0 ? 'just now' : relTime(sensor.lastReadingMinsAgo)}
          </Text>
          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6 }]}>
            next wake ~{nextWakeMins} min
          </Text>
          <Pressable
            onPress={() => {
              readNow(sensor.id);
              setReadRequested(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            }}
            style={{ marginTop: 8, minHeight: 32, justifyContent: 'center' }}
          >
            <Text style={[type.caption, { color: readRequested ? accent.sage : accent.verdant }]}>
              {readRequested ? 'Fresh reading received' : 'Read now'}
            </Text>
          </Pressable>
        </Card>
        <Card style={{ width: '48%' }}>
          <Text style={[type.micro, { color: dark.inkMuted }]}>MODE</Text>
          <Text style={[type.numBold as any, { fontSize: 17, color: dark.ink, marginTop: 4 }]}>
            {watch ? 'Watch mode' : 'Standard'}
          </Text>
          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6 }]}>
            every {watch ? `${sensor.wakeIntervalMins} min` : `${sensor.wakeIntervalMins / 60} h`}
          </Text>
          {watch && plant && (
            <View style={{ marginTop: 8 }}>
              <Chip label={`Auto — ${plant.name} near critical`} color={accent.sunbeam} />
            </View>
          )}
        </Card>
      </View>

      {/* latest sample */}
      <SectionHeader>Latest sample</SectionHeader>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {measurements.map((m) => (
            <View key={m.label} style={{ alignItems: 'center', flex: 1, paddingHorizontal: 2 }}>
              <Text
                style={[type.numBold as any, { fontSize: 15, color: m.color }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {m.value}
              </Text>
              <Text style={[type.micro, { color: dark.inkMuted, marginTop: 3 }]}>{m.label}</Text>
            </View>
          ))}
        </View>
        <Hairline style={{ marginVertical: 12 }} />
        <Text style={[type.micro, { color: dark.inkMuted }]}>
          raw {sensor.latest.rawAdc} → {sensor.latest.soilPct}% via your calibration
        </Text>
      </Card>

      {/* calibration */}
      <SectionHeader>Calibration</SectionHeader>
      <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={[type.body, { color: dark.ink }]}>
            Calibrated {sensor.calibratedOn} · dry {sensor.calDry} / wet {sensor.calWet}
          </Text>
          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>
            Repotted into different soil? Recalibrate — soil changes the curve.
          </Text>
        </View>
        <Pressable
          onPress={() => {
            recalibrateSensor(sensor.id);
            setRecalibrated(true);
          }}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={[type.body, { color: recalibrated ? accent.sage : accent.verdant }]}>
            {recalibrated ? 'Done ✓' : 'Recalibrate'}
          </Text>
        </Pressable>
      </Card>

      {/* firmware */}
      <SectionHeader>Firmware</SectionHeader>
      <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[type.body, { color: dark.ink, flex: 1 }]}>{sensor.firmware}</Text>
        {installing ? (
          <Text style={[type.caption, { color: accent.sage }]}>
            Installing on next wake — no action needed
          </Text>
        ) : sensor.updateAvailable ? (
          <Pressable
            onPress={() => {
              installFirmware(sensor.id);
              setInstalling(true);
            }}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={[type.body, { color: accent.verdant }]}>Update available</Text>
          </Pressable>
        ) : (
          <Text style={[type.caption, { color: dark.inkMuted }]}>up to date</Text>
        )}
      </Card>

      {/* reading log */}
      <SectionHeader>Reading log</SectionHeader>
      <Card>
        <Pressable onPress={() => setLogOpen(!logOpen)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32 }}>
          <Text style={[type.body, { color: dark.ink, flex: 1 }]}>Last {log.length} wakes</Text>
          <Ionicons name={logOpen ? 'chevron-up' : 'chevron-down'} size={16} color={dark.inkMuted} />
        </Pressable>
        {logOpen && (
          <View style={{ marginTop: 10 }}>
            {log.map((r, i) => (
              <View key={i} style={{ flexDirection: 'row', paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: dark.hairline }}>
                <Text style={[type.micro, { color: dark.inkMuted, flex: 1.4 }]}>{r.time}</Text>
                <Text style={[type.micro, { color: dark.ink, flex: 0.8 }]}>{r.soil}%</Text>
                <Text style={[type.micro, { color: dark.ink, flex: 0.8 }]}>{r.dli}</Text>
                <Text style={[type.micro, { color: dark.ink, flex: 0.8 }]}>{r.temp}°</Text>
                <Text style={[type.micro, { color: dark.ink, flex: 0.8 }]}>{r.rh}%</Text>
                <Text style={[type.micro, { color: dark.inkMuted, flex: 0.8 }]}>{r.batt}%</Text>
              </View>
            ))}
            <Pressable onPress={exportCsv} style={{ marginTop: 8, minHeight: 32, justifyContent: 'center' }}>
              <Text style={[type.caption, { color: accent.verdant }]}>
                Export CSV{settings.plus ? '' : ' — Greenr+'}
              </Text>
            </Pressable>
          </View>
        )}
      </Card>

      {/* footer */}
      <View style={{ marginTop: 24, gap: 10 }}>
        <GButton
          title={troubleshootOpen ? 'Hide troubleshooting' : 'Troubleshoot'}
          kind="secondary"
          onPress={() => setTroubleshootOpen(!troubleshootOpen)}
        />
        {troubleshootOpen && (
          <Card>
            {[
              '1. Check the battery seat — remove and reseat the cell.',
              '2. Re-run Wi-Fi setup: hold the button 3 s until it pulses, then pair again.',
              '3. Recalibrate if the plant was repotted.',
              '4. Still silent? Contact support@greenr.app with the sensor name.',
            ].map((step) => (
              <Text key={step} style={[type.caption, { color: dark.ink, lineHeight: 20 }]}>
                {step}
              </Text>
            ))}
          </Card>
        )}
        <GButton
          title="Forget this sensor"
          kind="destructive"
          onPress={() =>
            Alert.alert(
              'Forget this sensor?',
              `${sensor.name} will be removed. History stays with ${plant?.name ?? 'the plant'}; its scores continue as estimates.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Forget',
                  style: 'destructive',
                  onPress: () => {
                    forgetSensor(sensor.id);
                    router.back();
                  },
                },
              ],
            )
          }
        />
        <Text style={[type.micro, { color: dark.inkMuted, textAlign: 'center' }]}>
          History stays with the plant.
        </Text>
      </View>
    </Screen>
  );
}
