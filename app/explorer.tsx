import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Card, Hairline, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * Data explorer — the operator's view of the dataset.
 *
 * One RPC (`admin_overview`, see supabase/migrations) that answers only for
 * accounts listed in `analytics_admins`, and returns counts, never rows. The
 * three "what the data says" tables below it are the gated aggregates anyone
 * signed in may read: they stay EMPTY until a group has at least 15 distinct
 * plants from at least 5 growers, and an empty table here is the honest state of
 * a young dataset, not a fault.
 */
const RANGES = [7, 30, 90] as const;
type Row = Record<string, string | number | null>;

export default function Explorer() {
  const router = useRouter();
  const { user } = useAuth();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [overview, setOverview] = useState<any | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [aggregates, setAggregates] = useState<{ drying: Row[]; vpd: Row[]; outcomes: Row[]; coverage: Row[] }>({ drying: [], vpd: [], outcomes: [], coverage: [] });

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      if (!supabase || !user) {
        setDenied(supabase ? 'Sign in to see this.' : 'No account server is configured in this build.');
        setLoading(false);
        return;
      }
      const [o, drying, vpd, outcomes, coverage] = await Promise.all([
        supabase.rpc('admin_overview', { p_days: days }),
        supabase.from('substrate_drying').select('*').limit(40),
        supabase.from('drying_by_vpd').select('*').order('vpd_bucket_kpa').limit(40),
        supabase.from('recommendation_outcomes').select('*').limit(60),
        supabase.from('v_data_coverage').select('*').order('plants', { ascending: false }).limit(15),
      ]);
      if (!alive) return;
      if (o.error) {
        setOverview(null);
        setDenied(/not authorized/i.test(o.error.message)
          ? 'This account is not listed as an operator. Add it to analytics_admins in the SQL editor.'
          : `Not available: ${o.error.message}. Has the platform migration been run?`);
      } else {
        setOverview(o.data);
        setDenied(null);
      }
      setAggregates({
        drying: (drying.data as Row[]) ?? [],
        vpd: (vpd.data as Row[]) ?? [],
        outcomes: (outcomes.data as Row[]) ?? [],
        coverage: (coverage.data as Row[]) ?? [],
      });
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [days, user]);

  const n = (v: unknown) => (typeof v === 'number' ? v.toLocaleString() : v == null ? '—' : String(v));
  const pct = (v: unknown) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—');

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back" style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Data explorer</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        {RANGES.map((d) => (
          <Pressable
            key={d}
            onPress={() => setDays(d)}
            style={{ paddingHorizontal: 12, minHeight: 32, justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: d === days ? accent.verdant : dark.cardBorder, backgroundColor: d === days ? `${accent.verdant}22` : 'transparent' }}
          >
            <Text style={[type.caption, { color: d === days ? accent.verdant : dark.inkMuted }]}>{d} days</Text>
          </Pressable>
        ))}
        {loading && <ActivityIndicator color={accent.verdant} style={{ marginLeft: 8 }} />}
      </View>

      {denied && (
        <Card style={{ marginTop: 14 }}>
          <Text style={[type.caption, { color: dark.inkMuted, lineHeight: 19 }]}>{denied}</Text>
        </Card>
      )}

      {overview && (
        <>
          <SectionHeader>The dataset</SectionHeader>
          <Card>
            <Grid items={[
              ['Active plants', n(overview.dataset.plants_active)],
              ['Accounts with plants', n(overview.dataset.accounts_with_plants)],
              ['Research opt-ins', n(overview.dataset.research_opt_ins)],
              ['Sensors reporting', `${n(overview.dataset.devices_reporting)} of ${n(overview.dataset.devices_claimed)}`],
              [`Readings · ${days} d`, n(overview.dataset.readings_in_window)],
              ['Readings · all time', n(overview.dataset.readings_total)],
              ['Care events', n(overview.dataset.care_events)],
              ['Observations', n(overview.dataset.observations)],
            ]} />
          </Card>

          <SectionHeader>How much is measured, not assumed</SectionHeader>
          <Card>
            <Grid items={[
              ['Substrate specified', n(overview.coverage.plants_with_substrate)],
              ['Drying measured', n(overview.coverage.plants_with_measured_drying)],
              ['Dose measured', n(overview.coverage.plants_with_measured_dose)],
              ['Sensors on factory scale', n(overview.data_quality.devices_factory_scale)],
            ]} />
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10, lineHeight: 16 }]}>
              Counts of plants. These are the plants whose data can teach the models anything; the rest are
              running on reference values.
            </Text>
          </Card>

          <SectionHeader>Reading quality · {days} days</SectionHeader>
          <Card>
            <Grid items={[
              ['Flagged', pct(overview.data_quality.flagged_share)],
              ['Probe not in soil', n(overview.data_quality.probe_not_in_soil)],
              ['Probe disconnected', n(overview.data_quality.probe_disconnected)],
              ['Light at a rail', n(overview.data_quality.light_at_rail)],
              ['Without a plant', n(overview.data_quality.readings_without_plant)],
            ]} />
          </Card>

          <Table title="Species" rows={overview.coverage.top_species} cols={[['species', 'Species'], ['plants', 'Plants'], ['growers', 'Growers']]} />
          <Table title="Substrates in use" rows={overview.coverage.top_substrates} cols={[['label', 'Substrate'], ['plants', 'Plants'], ['growers', 'Growers']]} />
          <Table title={`Advice issued · ${days} days`} rows={overview.recommendations} cols={[['state', 'State'], ['grade', 'Grade'], ['issued', 'Issued'], ['followed', 'Followed'], ['plants', 'Plants']]} empty="No advice logged in this window." />

          <SectionHeader>Photo identification · {days} days</SectionHeader>
          <Card>
            <Grid items={[
              ['Attempts', n(overview.identifications.attempts)],
              ['First answer accepted', n(overview.identifications.confirmed)],
              ['Alternative chosen', n(overview.identifications.alternative)],
              ['Corrected by owner', n(overview.identifications.corrected)],
              ['Second model used', n(overview.identifications.escalated)],
            ]} />
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10, lineHeight: 16 }]}>
              “Corrected” ÷ attempts is the nearest thing to a field error rate: the owner looked at the
              suggestion and picked something else.
            </Text>
          </Card>
          <Table title={`AI usage · ${days} days`} rows={overview.ai} cols={[['model', 'Model'], ['requests', 'Calls'], ['cache_hits', 'Cached'], ['errors', 'Errors'], ['cost_usd', 'Est. $']]} empty="No AI calls in this window." />
        </>
      )}

      <SectionHeader>What the data says</SectionHeader>
      <Text style={[type.micro, { color: dark.inkMuted, marginHorizontal: 4, marginBottom: 8, lineHeight: 16 }]}>
        Opted-in growers only. A row appears once it rests on at least 15 distinct plants from 5 growers.
        Associations, not causes.
      </Text>
      <Table title="Drying time by substrate" rows={aggregates.drying} cols={[['label', 'Substrate'], ['sample_plants', 'Plants'], ['dry_down_days_median', 'Median days'], ['dry_down_days_p25', 'p25'], ['dry_down_days_p75', 'p75']]} empty="Not enough plants with a measured dry-down yet." bare />
      <Table title="Drying rate by air dryness (VPD)" rows={aggregates.vpd} cols={[['vpd_bucket_kpa', 'kPa'], ['sample_plants', 'Plants'], ['dry_points_per_day_median', 'Points/day']]} empty="Not enough plants per VPD bucket yet." bare />
      <Table title="Advice outcomes by model version" rows={aggregates.outcomes} cols={[['model_version', 'Model'], ['state', 'State'], ['issued', 'Issued'], ['followed', 'Followed'], ['median_rise_points', 'Median rise']]} empty="Not enough plants with logged advice yet." bare />
      <Table title="Health-log coverage by species" rows={aggregates.coverage} cols={[['species', 'Species'], ['plants', 'Plants'], ['growers', 'Growers'], ['deaths', 'Deaths']]} empty="No health-log entries visible to this account." bare />
    </Screen>
  );
}

function Grid({ items }: { items: [string, string][] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {items.map(([label, value]) => (
        <View key={label} style={{ width: '50%', paddingVertical: 8, paddingRight: 8 }}>
          <Text style={[type.cardTitle, { color: dark.ink, fontVariant: ['tabular-nums'] }]}>{value}</Text>
          <Text style={[type.micro, { color: dark.inkMuted }]}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function Table({ title, rows, cols, empty = 'Nothing yet.', bare }: {
  title: string; rows: Row[] | null | undefined; cols: [key: string, label: string][]; empty?: string; bare?: boolean;
}) {
  const list = rows ?? [];
  const cell = (v: unknown) =>
    typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2)) : v == null ? '—' : String(v);
  return (
    <View style={{ marginTop: bare ? 10 : 0 }}>
      {!bare && <SectionHeader>{title}</SectionHeader>}
      <Card>
        {bare && <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15, marginBottom: 6 }]}>{title}</Text>}
        {list.length === 0 ? (
          <Text style={[type.caption, { color: dark.inkMuted }]}>{empty}</Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', paddingBottom: 6 }}>
              {cols.map(([k, label], i) => (
                <Text key={k} style={[type.micro, { color: dark.inkMuted, flex: i === 0 ? 2.2 : 1, textAlign: i === 0 ? 'left' : 'right' }]} numberOfLines={1}>{label}</Text>
              ))}
            </View>
            {list.map((r, ri) => (
              <View key={ri}>
                <Hairline />
                <View style={{ flexDirection: 'row', minHeight: 34, alignItems: 'center' }}>
                  {cols.map(([k], i) => (
                    <Text key={k} style={[type.caption, { color: dark.ink, flex: i === 0 ? 2.2 : 1, textAlign: i === 0 ? 'left' : 'right', fontVariant: ['tabular-nums'] }]} numberOfLines={1}>
                      {cell(r[k])}
                    </Text>
                  ))}
                </View>
              </View>
            ))}
          </>
        )}
      </Card>
    </View>
  );
}
