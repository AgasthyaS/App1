import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Card, Chip, GButton, Hairline, Row, Screen, SectionHeader, StatusDot } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { isCalibrated } from '@/lib/calibration';
import { assignDeviceToPlant, renameDevice, releaseDevice } from '@/lib/devices';
import { confirmAction, notify } from '@/lib/platform';
import { activePlants, useGreenr } from '@/lib/store';
import type { SensorStatus } from '@/lib/types';
import { useMyDevices, type EnrichedDevice } from '@/lib/useDevices';
import { isSupabaseConfigured } from '@/lib/supabase';

const connToSensorStatus = (s: 'online' | 'idle' | 'offline'): SensorStatus =>
  s === 'online' ? 'online' : s === 'idle' ? 'late' : 'offline';

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ width: '33.3%', paddingVertical: 6, paddingRight: 8 }}>
      <Text style={[type.micro, { color: dark.inkMuted }]}>{label.toUpperCase()}</Text>
      <Text style={[type.caption, { color: tone ?? dark.ink, marginTop: 2 }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** §7 — full device manager over the account's real Supabase sensors. */
export default function Devices() {
  const router = useRouter();
  const { plants, spots, sensors, calibrations } = useGreenr();
  const { devices, loading, reload } = useMyDevices();

  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<'rename' | 'assign' | null>(null);
  const [renameText, setRenameText] = useState('');

  const openActions = (id: string) => {
    setOpenId(openId === id ? null : id);
    setMode(null);
  };

  const doRename = async (id: string) => {
    const label = renameText.trim();
    if (label) await renameDevice(id, label);
    setMode(null);
    reload();
  };

  const doAssign = async (id: string, plantId: string) => {
    await assignDeviceToPlant(id, plantId);
    setMode(null);
    reload();
  };

  const doRemove = (d: EnrichedDevice) => {
    confirmAction({
      title: 'Remove this sensor?',
      message: `${d.device.label ?? 'This sensor'} will be released from your account. You can pair it again anytime.`,
      confirmLabel: 'Remove',
      destructive: true,
      onConfirm: async () => {
        const { error } = await releaseDevice(d.device.id);
        if (error) notify('Removed from plant', 'Full account removal needs the release_device function installed; the sensor was unassigned for now.');
        reload();
      },
    });
  };

  const renderDevice = (d: EnrichedDevice) => {
    const { device, latest, connection } = d;
    const name = device.label?.trim() || 'Greenr sensor';
    const plant = plants.find((p) => p.id === device.plant_key);
    const spot = spots.find((s) => s.id === plant?.spotId);
    const batt = latest?.battery_pct ?? device.battery_pct;
    const battStr = batt == null || batt < 0 ? 'Not reported' : `${Math.round(batt)}%`;
    // The reporting cadence the device is currently set to (idle is ~3 h).
    const w = device.wake_seconds;
    const modeStr = w >= 3600 ? `Every ${Math.round(w / 3600)} h` : `Every ${Math.round(w / 60)} min`;
    // When to expect the next report — a quiet sensor is scheduled, not broken.
    const nextReport = device.last_seen
      ? new Date(new Date(device.last_seen).getTime() + Math.max(device.wake_seconds, 30) * 1000)
      : null;
    const nextStr = !nextReport
      ? '—'
      : nextReport.getTime() < Date.now()
        ? 'overdue — check its power'
        : `~${nextReport.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    const cal = isCalibrated(calibrations[device.id]);
    const isOpen = openId === device.id;

    return (
      <Card key={device.id} style={{ marginBottom: 10 }}>
        <Pressable onPress={() => openActions(device.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontSize: 22 }}>📡</Text>
          <View style={{ flex: 1 }}>
            <Text style={[type.cardTitle, { color: dark.ink }]} numberOfLines={1}>
              {name}
            </Text>
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 1 }]}>
              ID {device.id.slice(0, 8)} · {connection.sinceLabel}
            </Text>
          </View>
          <StatusDot status={connToSensorStatus(connection.status)} />
          <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={dark.inkMuted} />
        </Pressable>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, borderTopWidth: 1, borderTopColor: dark.hairline, paddingTop: 6 }}>
          <Field label="Plant" value={plant?.name ?? 'Unassigned'} tone={plant ? dark.ink : accent.sunbeamText} />
          <Field label="Zone" value={spot?.name ?? '—'} />
          <Field label="Battery" value={battStr} tone={typeof batt === 'number' && batt >= 0 && batt < 15 ? accent.clay : undefined} />
          <Field label="Last update" value={connection.sinceLabel} />
          <Field label="Reporting" value={modeStr} />
          <Field
            label="Next report"
            value={nextStr}
            tone={nextStr.startsWith('overdue') ? accent.sunbeamText : undefined}
          />
        </View>
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 4 }]}>
          Signal: {connection.quality} · Wi-Fi · Calibration: {cal ? 'applied' : 'not set'} · Runs on its own —
          keep it on a wall charger or power bank (a PC&apos;s USB port cuts power when the PC sleeps).
        </Text>

        {isOpen && (
          <View style={{ marginTop: 12 }}>
            <Hairline style={{ marginBottom: 10 }} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <ActionBtn icon="create-outline" label="Rename" onPress={() => { setMode(mode === 'rename' ? null : 'rename'); setRenameText(device.label ?? ''); }} />
              <ActionBtn icon="leaf-outline" label="Assign" onPress={() => setMode(mode === 'assign' ? null : 'assign')} />
              <ActionBtn icon="options-outline" label="Calibrate" onPress={() => router.push(`/calibrate/${device.id}` as any)} />
              <ActionBtn icon="trash-outline" label="Remove" danger onPress={() => doRemove(d)} />
            </View>

            {mode === 'rename' && (
              <View style={{ marginTop: 12 }}>
                <Text style={[type.micro, { color: dark.inkMuted }]}>DEVICE NAME</Text>
                <TextInput
                  value={renameText}
                  onChangeText={setRenameText}
                  autoFocus
                  placeholder="e.g. Living room monstera"
                  placeholderTextColor={dark.inkMuted}
                  style={{ color: dark.ink, backgroundColor: dark.surface2, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, marginTop: 4, fontSize: 15 }}
                />
                <GButton title="Save name" onPress={() => doRename(device.id)} style={{ marginTop: 10, minHeight: 42 }} />
              </View>
            )}

            {mode === 'assign' && (
              <View style={{ marginTop: 12 }}>
                <Text style={[type.micro, { color: dark.inkMuted, marginBottom: 4 }]}>ASSIGN TO PLANT</Text>
                {activePlants(plants).length === 0 && (
                  <Text style={[type.caption, { color: dark.inkMuted }]}>Add a plant first, then assign this sensor.</Text>
                )}
                {activePlants(plants).map((p) => (
                  <Pressable key={p.id} onPress={() => doAssign(device.id, p.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
                    <Text style={{ fontSize: 18 }}>{p.emoji}</Text>
                    <Text style={[type.body, { color: dark.ink, flex: 1 }]}>{p.name}</Text>
                    {device.plant_key === p.id && <Chip label="current" color={accent.sage} />}
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
      </Card>
    );
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Devices</Text>
      </View>

      {/* Real sensors on the account */}
      {isSupabaseConfigured ? (
        <>
          <SectionHeader>Your sensors</SectionHeader>
          {loading && devices.length === 0 ? (
            <Card>
              <Text style={[type.caption, { color: dark.inkMuted }]}>Loading your sensors…</Text>
            </Card>
          ) : devices.length === 0 ? (
            <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
              <Text style={{ fontSize: 34 }}>📡</Text>
              <Text style={[type.body, { color: dark.inkMuted, marginTop: 10, textAlign: 'center' }]}>
                No sensors paired yet. Pair a Greenr sensor to track real soil, light, temperature and humidity.
              </Text>
              <GButton title="Pair a sensor" onPress={() => router.push('/pair-device' as any)} style={{ marginTop: 14 }} />
              <Pressable onPress={() => router.push('/wifi-setup' as any)} style={{ marginTop: 10, minHeight: 44, justifyContent: 'center' }}>
                <Text style={[type.caption, { color: accent.verdant }]}>New sensor? Connect it to Wi-Fi first</Text>
              </Pressable>
            </Card>
          ) : (
            <>
              {devices.map(renderDevice)}
              <Row title="Pair another sensor" onPress={() => router.push('/pair-device' as any)} />
              <Row title="Connect a sensor to Wi-Fi" onPress={() => router.push('/wifi-setup' as any)} />
            </>
          )}
        </>
      ) : (
        <Card style={{ marginTop: 12 }}>
          <Text style={[type.caption, { color: dark.inkMuted, lineHeight: 18 }]}>
            Cloud sync isn&apos;t configured in this build, so live sensors can&apos;t be managed here.
          </Text>
        </Card>
      )}

      {/* Demo/local sensors, only when present (testing) */}
      {sensors.length > 0 && (
        <>
          <SectionHeader>Demo sensors</SectionHeader>
          <Card>
            {sensors.map((s, i) => {
              const plant = plants.find((p) => p.id === s.plantId);
              return (
                <View key={s.id}>
                  {i > 0 && <Hairline style={{ marginVertical: 10 }} />}
                  <Pressable onPress={() => router.push(`/sensor/${s.id}`)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 12 }}>
                    <Text style={{ fontSize: 20 }}>📡</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[type.body, { color: dark.ink }]}>{s.name}</Text>
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 1 }]}>
                        {plant ? plant.name : 'Unassigned'} · {s.batteryPct}%
                      </Text>
                    </View>
                    <StatusDot status={s.status} />
                    <Ionicons name="chevron-forward" size={16} color={dark.inkMuted} />
                  </Pressable>
                </View>
              );
            })}
          </Card>
        </>
      )}
    </Screen>
  );
}

function ActionBtn({ icon, label, onPress, danger }: { icon: any; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 12,
        minHeight: 40,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: danger ? `${accent.clay}66` : dark.hairline,
      }}
    >
      <Ionicons name={icon} size={14} color={danger ? accent.clay : accent.verdant} />
      <Text style={[type.caption, { color: danger ? accent.clay : dark.ink }]}>{label}</Text>
    </Pressable>
  );
}
