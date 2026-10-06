import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Card, Hairline, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { applyCalibration, calibrationFor } from '@/lib/calibration';
import {
  buildDayRecords,
  mergeDayRecords,
  sameSeasonLastYear,
  seasonComparison,
  seasonSummaries,
  type DayRecord,
} from '@/lib/climateLog';
import { localDayKey } from '@/lib/insights';
import { SEASON_EMOJI } from '@/lib/season';
import { useGreenr } from '@/lib/store';
import { useAllReadingHistories } from '@/lib/useLiveReading';
import { cToF } from '@/lib/weather';

/**
 * THE RECORD: what this plant has actually lived through.
 *
 * Every other screen answers "how is it right now". This one answers "what has
 * it been like" — which day last week the soil dropped, whether this summer is
 * warmer than the last one, what the pot does in a November with the heating on.
 *
 * The figures are DAILY AVERAGES rather than readings, because a reading is a
 * snapshot of whenever the sensor happened to wake: soil measured right after a
 * watering, temperature measured as the afternoon sun crossed the shelf. And
 * every average carries how many hours the sensor actually covered, because a
 * fortnight of silence in August is not a cool August and should not be allowed
 * to look like one.
 */

const fmt = (v: number | null | undefined, unit: string, dp = 0): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(dp)}${unit}`;

/** A day heading a person can read, from a YYYY-MM-DD key. */
function dayLabel(day: string, todayKey: string): string {
  if (day === todayKey) return 'Today';
  const [y, m, d] = day.split('-').map((n) => parseInt(n, 10));
  const date = new Date(y, (m || 1) - 1, d || 1);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === localDayKey(yesterday.getTime())) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: dark.surface2, borderRadius: 10, padding: 10 }}>
      <Text style={[type.micro, { color: dark.inkMuted }]}>{label}</Text>
      <Text style={[type.numBold as any, { color: dark.ink, fontSize: 18, marginTop: 1 }]}>{value}</Text>
      {sub ? <Text style={[type.micro, { color: dark.inkMuted, marginTop: 1 }]}>{sub}</Text> : null}
    </View>
  );
}

export default function ClimateHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { plants, settings, calibrations, climateDaily } = useGreenr();
  const histories = useAllReadingHistories();
  const plant = plants.find((p) => p.id === id);

  const [tab, setTab] = useState<'days' | 'seasons'>('days');
  const [openDay, setOpenDay] = useState<string | null>(null);

  const F = settings.unitsF;
  const temp = (c: number | null | undefined) =>
    c == null || !Number.isFinite(c) ? '—' : `${(F ? cToF(c) : c).toFixed(1)}${F ? '°F' : '°C'}`;

  /*
   * The stored record plus whatever the live window adds, merged the same way
   * the store merges it — so this screen shows today's partial day immediately
   * rather than waiting for the next write.
   */
  const records: DayRecord[] = useMemo(() => {
    if (!plant) return [];
    const raw = histories.get(plant.id) ?? [];
    const cal = calibrationFor(calibrations, raw[0]?.device_id, plant.sensorId);
    const calibrated = cal ? raw.map((r) => applyCalibration(r, cal)) : raw;
    return mergeDayRecords(climateDaily?.[plant.id] ?? [], buildDayRecords(calibrated));
  }, [plant, histories, calibrations, climateDaily]);

  const seasons = useMemo(() => seasonSummaries(records), [records]);
  const todayKey = localDayKey();
  const newestFirst = useMemo(() => [...records].reverse(), [records]);

  if (!plant) {
    return (
      <Screen>
        <Text style={[type.body, { color: dark.inkMuted, marginTop: 40 }]}>Plant not found.</Text>
      </Screen>
    );
  }

  const thisSeason = seasons[0] ?? null;
  const lastYear = thisSeason ? sameSeasonLastYear(seasons, thisSeason) : null;
  const comparison = thisSeason ? seasonComparison(thisSeason, lastYear) : null;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]} numberOfLines={1}>
            {plant.name}&apos;s record
          </Text>
          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 1 }]}>
            {records.length} day{records.length === 1 ? '' : 's'} of measured history
          </Text>
        </View>
      </View>

      {/* day / season switch */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
        {(['days', 'seasons'] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={{
              flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
              backgroundColor: tab === t ? accent.verdant : dark.surface2,
            }}
          >
            <Text style={[type.caption, { color: tab === t ? dark.bg : dark.inkMuted, textTransform: 'capitalize' }]}>
              {t === 'days' ? 'Day by day' : 'By season'}
            </Text>
          </Pressable>
        ))}
      </View>

      {records.length === 0 && (
        <Card style={{ marginTop: 14 }}>
          <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
            Nothing recorded yet. Greenr folds each day of sensor readings into one row — the average,
            the low and the high — and keeps about two years of them, so this fills in from the first
            full day the sensor reports.
          </Text>
        </Card>
      )}

      {/* ───────────────────────────── DAY BY DAY ───────────────────────────── */}
      {tab === 'days' && records.length > 0 && (
        <ScrollView style={{ marginTop: 14 }} showsVerticalScrollIndicator={false}>
          {newestFirst.map((d) => {
            const open = openDay === d.day;
            const thin = d.hours < 4;
            return (
              <Card key={d.day} style={{ marginBottom: 8 }}>
                <Pressable
                  onPress={() => setOpenDay(open ? null : d.day)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]}>
                      {dayLabel(d.day, todayKey)}
                    </Text>
                    <Text style={[type.micro, { color: dark.inkMuted, marginTop: 1 }]}>
                      {d.day}
                      {thin ? ` · only ${d.hours.toFixed(0)} h covered` : ''}
                    </Text>
                  </View>
                  <Text style={[type.numBold as any, { color: thin ? dark.inkMuted : dark.ink, fontSize: 17 }]}>
                    {fmt(d.soil, '%')}
                  </Text>
                  <Text style={[type.caption, { color: dark.inkMuted }]}>{temp(d.temp)}</Text>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={dark.inkMuted} />
                </Pressable>

                {open && (
                  <View style={{ marginTop: 10 }}>
                    <Hairline style={{ marginBottom: 10 }} />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Metric
                        label="SOIL"
                        value={fmt(d.soil, '%')}
                        sub={d.soilMin != null ? `${d.soilMin.toFixed(0)}–${d.soilMax?.toFixed(0)}%` : undefined}
                      />
                      <Metric
                        label="TEMPERATURE"
                        value={temp(d.temp)}
                        sub={d.tempMin != null ? `${temp(d.tempMin)}–${temp(d.tempMax)}` : undefined}
                      />
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <Metric label="HUMIDITY" value={fmt(d.humidity, '%')} />
                      <Metric label="LIGHT" value={fmt(d.light, '')} />
                    </View>
                    <Text style={[type.micro, { color: dark.inkMuted, marginTop: 8, lineHeight: 15 }]}>
                      Averaged across {d.hours.toFixed(0)} hours the sensor actually covered, weighted by
                      time — so a burst of readings in one hour cannot pull the day toward it.
                      {thin ? ' Too little of this day was covered for the average to be worth much.' : ''}
                    </Text>
                  </View>
                )}
              </Card>
            );
          })}
        </ScrollView>
      )}

      {/* ───────────────────────────── BY SEASON ────────────────────────────── */}
      {tab === 'seasons' && records.length > 0 && (
        <ScrollView style={{ marginTop: 14 }} showsVerticalScrollIndicator={false}>
          {comparison && (
            <Card style={{ marginBottom: 10 }} accentBorder={accent.verdant}>
              <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.4 }]}>
                THIS SEASON AGAINST THE SAME ONE LAST YEAR
              </Text>
              <Text style={[type.body, { color: dark.ink, marginTop: 6, lineHeight: 21 }]}>{comparison}</Text>
            </Card>
          )}
          {seasons.length <= 1 && (
            <Card style={{ marginBottom: 10 }}>
              <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
                One season so far. The comparison that matters — this summer against last summer — needs a
                year of history, and Greenr keeps two so it will be there.
              </Text>
            </Card>
          )}

          {seasons.map((s) => (
            <Card key={s.key} style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 18 }}>{SEASON_EMOJI[s.season]}</Text>
                <Text style={[type.cardTitle, { color: dark.ink, flex: 1 }]}>{s.label}</Text>
                <Text style={[type.micro, { color: s.thin ? accent.sunbeam : dark.inkMuted }]}>
                  {s.days} day{s.days === 1 ? '' : 's'}
                </Text>
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Metric
                  label="SOIL"
                  value={fmt(s.soil, '%')}
                  sub={s.soilMin != null ? `${s.soilMin.toFixed(0)}–${s.soilMax?.toFixed(0)}%` : undefined}
                />
                <Metric
                  label="TEMPERATURE"
                  value={temp(s.temp)}
                  sub={s.tempMin != null ? `${temp(s.tempMin)}–${temp(s.tempMax)}` : undefined}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Metric label="HUMIDITY" value={fmt(s.humidity, '%')} />
                <Metric label="LIGHT" value={fmt(s.light, '')} />
              </View>

              {s.thin && (
                <Text style={[type.micro, { color: accent.sunbeam, marginTop: 8, lineHeight: 15 }]}>
                  Only {s.days} usable days in this season, so treat these as indicative. A season needs
                  about a fortnight of covered days before its average is worth comparing.
                </Text>
              )}
            </Card>
          ))}
        </ScrollView>
      )}

      <SectionHeader>How these are worked out</SectionHeader>
      <Card style={{ marginBottom: 24 }}>
        <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
          Each day is a time-weighted average of that day&apos;s readings, so an uneven trace — a burst of
          readings in one hour and then a gap — is not skewed toward whenever they bunched up. Gaps
          longer than four and a half hours are not bridged, because what happened while the sensor was
          dark is genuinely unknown. Seasons average those days rather than the raw readings, weighted by
          how much of each day was covered.
        </Text>
      </Card>
    </Screen>
  );
}
