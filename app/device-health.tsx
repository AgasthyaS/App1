import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, GButton, Hairline, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { type EnrichedDevice } from '@/lib/useDevices';
import { useMyDevices } from '@/lib/useDevices';
import { useSensorUploadHealth } from '@/lib/useLiveReading';
import type { UploadHealth } from '@/lib/uploadHealth';
import { useGreenr } from '@/lib/store';

type Health = 'good' | 'warn' | 'bad';
interface Issue { tone: Health; text: string; fix?: string }

/*
 * The verdict now comes from `uploadHealth` rather than from the connection dot.
 *
 * The dot only ever answered "did anything arrive recently", which misses the
 * failure that actually costs data: a sensor delivering half its readings is
 * never late enough to look offline, but half the drying curve is gone and every
 * watering amount derived from it gets vaguer. `uploadHealth` measures delivery
 * against the cadence the device was CONFIGURED with, so a slowdown cannot pass
 * itself off as the new normal.
 */
function assess(d: EnrichedDevice, up: UploadHealth | undefined): { health: Health; issues: Issue[]; battery: number | null } {
  const issues: Issue[] = [];
  const battery = d.latest?.battery_pct ?? d.device.battery_pct ?? null;

  if (up && up.state !== 'steady') {
    issues.push({
      tone: up.severity >= 65 ? 'bad' : 'warn',
      text: up.headline,
      fix: up.action ? `${up.detail} ${up.action}` : up.detail,
    });
  }
  if (battery != null && battery >= 0 && battery < 20) {
    issues.push({ tone: battery < 10 ? 'bad' : 'warn', text: `Battery low (${Math.round(battery)}%)`, fix: 'Recharge or swap the battery so it keeps reporting.' });
  }
  if (!d.device.plant_key) {
    issues.push({ tone: 'warn', text: 'Not assigned to a plant', fix: 'Assign it in Devices so its readings power a plant.' });
  }

  const health: Health = issues.some((i) => i.tone === 'bad') ? 'bad' : issues.some((i) => i.tone === 'warn') ? 'warn' : 'good';
  return { health, issues, battery };
}

const toneColor = (h: Health) => (h === 'good' ? accent.sage : h === 'warn' ? accent.sunbeam : accent.clay);

export default function DeviceHealth() {
  const router = useRouter();
  const { plants } = useGreenr();
  const { devices, loading, reload } = useMyDevices();
  const [helpOpen, setHelpOpen] = useState(false);

  const { list: upload } = useSensorUploadHealth();
  const uploadById = new Map(upload.map((u) => [u.deviceId, u]));

  const rows = devices.map((d) => {
    const plant = plants.find((p) => p.id === d.device.plant_key);
    const up = uploadById.get(d.device.id);
    return { d, plant: plant?.name ?? null, up, ...assess(d, up) };
  });
  const needAttention = rows.filter((r) => r.health !== 'good').length;
  const online = rows.filter((r) => (r.up ? r.up.state === 'steady' : r.d.connection.status === 'online')).length;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24, flex: 1 }]}>Device health</Text>
        <Pressable onPress={reload} style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}>
          <Ionicons name="refresh" size={20} color={dark.inkMuted} />
        </Pressable>
      </View>

      {/* summary */}
      {devices.length > 0 && (
        <Card style={{ marginTop: 12, flexDirection: 'row', gap: 20 }}>
          <View>
            <Text style={[type.numHero as any, { fontSize: 30, color: online === rows.length ? accent.sage : dark.ink }]}>{online}/{rows.length}</Text>
            <Text style={[type.micro, { color: dark.inkMuted }]}>reporting</Text>
          </View>
          <View>
            <Text style={[type.numHero as any, { fontSize: 30, color: needAttention ? accent.sunbeam : accent.sage }]}>{needAttention}</Text>
            <Text style={[type.micro, { color: dark.inkMuted }]}>need attention</Text>
          </View>
        </Card>
      )}

      {loading && devices.length === 0 && (
        <Text style={[type.body, { color: dark.inkMuted, marginTop: 24, textAlign: 'center' }]}>Loading…</Text>
      )}
      {!loading && devices.length === 0 && (
        <Card style={{ marginTop: 12 }}>
          <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>No sensors paired yet.</Text>
          <GButton title="Pair a sensor" onPress={() => router.push('/pair-device' as any)} style={{ marginTop: 12 }} />
        </Card>
      )}

      {rows.map(({ d, plant, up, health, issues, battery }) => {
        const w = d.device.wake_seconds;
        const cadence = w >= 3600 ? `every ${Math.round(w / 3600)} h` : `every ${Math.round(w / 60)} min`;
        const next = d.device.last_seen
          ? new Date(new Date(d.device.last_seen).getTime() + Math.max(w, 30) * 1000)
          : null;
        return (
          <Card key={d.device.id} style={{ marginTop: 12 }} accentBorder={health === 'bad' ? accent.clay : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: toneColor(health) }} />
              <Text style={[type.cardTitle, { color: dark.ink, flex: 1 }]} numberOfLines={1}>
                {d.device.label?.trim() || 'Greenr sensor'}
              </Text>
              <Text style={[type.micro, { color: dark.inkMuted }]}>ID {d.device.id.slice(0, 8)}</Text>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
              <Field label="Plant" value={plant ?? 'Unassigned'} />
              <Field label="Status" value={d.connection.status} tone={toneColor(health)} />
              <Field label="Battery" value={battery == null || battery < 0 ? 'Not reported' : `${Math.round(battery)}%`} tone={battery != null && battery >= 0 && battery < 20 ? accent.clay : undefined} />
              <Field label="Last seen" value={d.connection.sinceLabel} />
              <Field label="Reporting" value={cadence} />
              {/* Delivery is the number the old screen had no way to show: not
                  "is it on now" but "how much of what it owed has it paid". */}
              <Field
                label="Delivered"
                value={up?.deliveredShare == null ? '—' : `${Math.round(up.deliveredShare * 100)}% of ${up.windowDays} d`}
                tone={up?.deliveredShare != null && up.deliveredShare < 0.7 ? accent.sunbeam : undefined}
              />
              <Field label="Next report" value={next ? (next.getTime() < Date.now() ? 'overdue' : `~${next.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`) : '—'} />
            </View>

            {issues.length > 0 && (
              <View style={{ marginTop: 10, gap: 8 }}>
                {issues.map((iss, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 8, padding: 9, borderRadius: 10, backgroundColor: `${toneColor(iss.tone)}18` }}>
                    <Ionicons name={iss.tone === 'bad' ? 'alert-circle' : 'warning-outline'} size={15} color={toneColor(iss.tone)} style={{ marginTop: 1 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.caption, { color: dark.ink }]}>{iss.text}</Text>
                      {iss.fix && <Text style={[type.micro, { color: dark.inkMuted, marginTop: 1, lineHeight: 15 }]}>{iss.fix}</Text>}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </Card>
        );
      })}

      {/* firmware / OTA */}
      {devices.length > 0 && (
        <Card style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Ionicons name="cloud-download-outline" size={20} color={accent.verdant} />
          <View style={{ flex: 1 }}>
            <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]}>Automatic updates</Text>
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, lineHeight: 15 }]}>
              Your sensors update their firmware over the air on their own — no cables. New fixes and
              features arrive automatically.
            </Text>
          </View>
        </Card>
      )}

      {/* reconnection help */}
      {devices.length > 0 && (
        <Card style={{ marginTop: 12 }}>
          <Pressable onPress={() => setHelpOpen(!helpOpen)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 36 }}>
            <Ionicons name="help-buoy-outline" size={18} color={accent.verdant} />
            <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15, flex: 1, marginLeft: 10 }]}>A sensor won't come back online?</Text>
            <Ionicons name={helpOpen ? 'chevron-up' : 'chevron-down'} size={16} color={dark.inkMuted} />
          </Pressable>
          {helpOpen && (
            <View style={{ marginTop: 8, gap: 8 }}>
              {[
                'Confirm it has power — a wall charger or power bank, not a PC USB port (those cut power when the PC sleeps).',
                'Your Wi-Fi must be 2.4 GHz — the sensor can’t see 5 GHz networks.',
                'If your Wi-Fi name or password changed, re-run setup: Devices → the sensor → Set up Wi-Fi.',
                'Move it closer to the router to rule out range, then move it back once it reports.',
                'Still stuck? Unplug it for 10 seconds and plug it back in to restart the cycle.',
              ].map((t, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={[type.caption, { color: accent.verdant }]}>{i + 1}.</Text>
                  <Text style={[type.caption, { color: dark.inkMuted, flex: 1, lineHeight: 19 }]}>{t}</Text>
                </View>
              ))}
              <GButton title="Set up Wi-Fi again" kind="secondary" onPress={() => router.push('/wifi-setup' as any)} style={{ marginTop: 6 }} />
            </View>
          )}
        </Card>
      )}
    </Screen>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ width: '33.3%', marginBottom: 8 }}>
      <Text style={[type.micro, { color: dark.inkMuted }]}>{label.toUpperCase()}</Text>
      <Text style={[type.caption, { color: tone ?? dark.ink, marginTop: 1, textTransform: 'capitalize' }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}
