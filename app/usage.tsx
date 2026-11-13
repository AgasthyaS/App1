import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, GButton, Hairline, Row, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import {
  clearLocalUsage,
  deleteMyUploadedUsage,
  fetchGlobalUsage,
  flush,
  getLocalUsage,
  globalPrivacyControl,
  uploadStatus,
  type GlobalUsageRow,
  type LocalUsage,
} from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import { confirmAction, notify } from '@/lib/platform';
import { useGreenr } from '@/lib/store';

const RANGES = [7, 30, 90] as const;
const GROUPS: { prefix: string; label: string }[] = [
  { prefix: 'screen:', label: 'Screens opened' },
  { prefix: 'tap:', label: 'Taps' },
  { prefix: 'action:', label: 'Things done' },
];

/** "tap:home.weekly_briefing" → "home · weekly briefing" */
function labelFor(name: string): string {
  return name
    .replace(/^[a-z]+:/, '')
    .replace(/\[id\]/g, '…')
    .replace(/[./]/g, ' · ')
    .replace(/_/g, ' ');
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function CountRow({ name, count, sub }: { name: string; count: number; sub?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, gap: 10 }}>
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { color: dark.ink }]} numberOfLines={1}>
          {labelFor(name)}
        </Text>
        {sub ? <Text style={[type.micro, { color: dark.inkMuted }]}>{sub}</Text> : null}
      </View>
      <Text style={[type.cardTitle, { color: dark.ink, fontVariant: ['tabular-nums'] }]}>{count.toLocaleString()}</Text>
    </View>
  );
}

/**
 * Usage — how often screens are opened and things are tapped. Admins (listed in
 * `analytics_admins`, see supabase-analytics.sql) see totals across every user;
 * everyone sees exactly what this device has recorded about them.
 */
export default function Usage() {
  const router = useRouter();
  const { settings, setSettings } = useGreenr();
  const { user } = useAuth();
  const [local, setLocal] = useState<LocalUsage | null>(null);
  const [global, setGlobal] = useState<GlobalUsageRow[] | null>(null);
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [, bump] = useState(0);

  const loadLocal = useCallback(() => {
    getLocalUsage().then(setLocal);
  }, []);

  useEffect(loadLocal, [loadLocal]);

  useEffect(() => {
    let cancelled = false;
    // Upload what's queued first so the totals include this session.
    flush().then(() => fetchGlobalUsage(days)).then((rows) => {
      if (!cancelled) setGlobal(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [days, user?.id]);

  const status = uploadStatus();
  const gpc = globalPrivacyControl();
  const entries = Object.entries(local?.counts ?? {}).sort((a, b) => b[1].n - a[1].n);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Usage</Text>
      </View>

      {global && (
        <>
          <Card onPress={() => router.push('/explorer' as any)} style={{ marginTop: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name="analytics" size={18} color={accent.verdant} />
              <View style={{ flex: 1 }}>
                <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]}>Data explorer</Text>
                <Text style={[type.micro, { color: dark.inkMuted }]}>Plants, sensors, reading quality, advice outcomes, AI cost</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={dark.inkMuted} />
            </View>
          </Card>
          <SectionHeader>All users</SectionHeader>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            {RANGES.map((d) => (
              <Pressable
                key={d}
                onPress={() => setDays(d)}
                style={{
                  paddingHorizontal: 12,
                  minHeight: 32,
                  justifyContent: 'center',
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: d === days ? accent.verdant : dark.cardBorder,
                  backgroundColor: d === days ? `${accent.verdant}22` : 'transparent',
                }}
              >
                <Text style={[type.caption, { color: d === days ? accent.verdant : dark.inkMuted }]}>{d} days</Text>
              </Pressable>
            ))}
          </View>
          {GROUPS.map((g) => {
            const rows = global.filter((r) => r.name.startsWith(g.prefix));
            if (rows.length === 0) return null;
            return (
              <Card key={g.prefix} style={{ marginBottom: 10 }}>
                <Text style={[type.sectionHeader, { color: dark.inkMuted, marginBottom: 4 }]}>{g.label}</Text>
                {rows.map((r, i) => (
                  <View key={r.name}>
                    {i > 0 && <Hairline />}
                    <CountRow
                      name={r.name}
                      count={r.total}
                      sub={`${r.people.toLocaleString()} ${r.people === 1 ? 'person' : 'people'} · last ${ago(r.last_at)}`}
                    />
                  </View>
                ))}
              </Card>
            );
          })}
          {global.length === 0 && (
            <Card>
              <Text style={[type.caption, { color: dark.inkMuted }]}>Nothing recorded in the last {days} days yet.</Text>
            </Card>
          )}
        </>
      )}

      <SectionHeader>On this device</SectionHeader>
      <Card>
        <Text style={[type.caption, { color: dark.inkMuted, lineHeight: 18 }]}>
          This is everything Greenr&apos;s usage analytics has recorded here
          {local ? ` since ${new Date(local.since).toLocaleDateString()}` : ''}: which screens were opened,
          which buttons were tapped, and how many times. Nothing you type, no plant names, photos or
          location.
        </Text>
        <Row
          title="Usage analytics"
          value={gpc ? 'Off (browser privacy signal)' : settings.analyticsOptIn ? 'On' : 'Off'}
          onPress={gpc ? undefined : () => setSettings({ analyticsOptIn: !settings.analyticsOptIn })}
        />
        {status.configured && (
          <Text style={[type.micro, { color: status.last && !status.last.ok ? accent.sunbeam : dark.inkMuted }]}>
            {status.last
              ? status.last.ok
                ? `Last upload ${ago(status.last.at)} · ${status.queued} waiting`
                : `Last upload was rejected (${status.last.error}) — has supabase-analytics.sql been run?`
              : `${status.queued} waiting to upload`}
          </Text>
        )}
      </Card>

      {GROUPS.map((g) => {
        const rows = entries.filter(([name]) => name.startsWith(g.prefix));
        if (rows.length === 0) return null;
        return (
          <Card key={g.prefix} style={{ marginTop: 10 }}>
            <Text style={[type.sectionHeader, { color: dark.inkMuted, marginBottom: 4 }]}>{g.label}</Text>
            {rows.map(([name, c], i) => (
              <View key={name}>
                {i > 0 && <Hairline />}
                <CountRow name={name} count={c.n} sub={`last ${ago(c.last)}`} />
              </View>
            ))}
          </Card>
        );
      })}
      {local && entries.length === 0 && (
        <Card style={{ marginTop: 10 }}>
          <Text style={[type.caption, { color: dark.inkMuted }]}>Nothing recorded on this device.</Text>
        </Card>
      )}

      <GButton
        title="Clear this device’s usage data"
        kind="secondary"
        style={{ marginTop: 20 }}
        onPress={() =>
          confirmAction({
            title: 'Clear usage data?',
            message: 'Resets the counters on this device. Anything already uploaded stays until you delete it below.',
            confirmLabel: 'Clear',
            destructive: true,
            onConfirm: async () => {
              await clearLocalUsage();
              loadLocal();
              bump((n) => n + 1);
            },
          })
        }
      />
      {user && status.configured && (
        <GButton
          title="Delete my uploaded usage data"
          kind="destructive"
          style={{ marginTop: 10 }}
          onPress={() =>
            confirmAction({
              title: 'Delete uploaded usage data?',
              message: 'Permanently removes every usage event stored with your account. Your garden is not affected.',
              confirmLabel: 'Delete',
              destructive: true,
              onConfirm: async () => {
                const { error } = await deleteMyUploadedUsage();
                notify(error ? `Couldn’t delete: ${error}` : 'Your uploaded usage data was deleted.');
              },
            })
          }
        />
      )}
    </Screen>
  );
}
