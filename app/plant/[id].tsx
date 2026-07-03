import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ForecastBar from '@/components/greenr/ForecastBar';
import RangeRibbon from '@/components/greenr/RangeRibbon';
import { Card, Chip, GButton, Hairline, SectionHeader } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, bandFor, dark, layout, type } from '@/constants/theme';
import { daysAgoLabel } from '@/lib/format';
import { useGreenr } from '@/lib/store';
import { COMPONENT_MAX, ScoreComponents } from '@/lib/types';

const COMPONENT_LABELS: Record<keyof ScoreComponents, string> = {
  hydration: 'Hydration',
  light: 'Light',
  climate: 'Climate',
  consistency: 'Consistency',
  trend: 'Trend',
};

/** Evidence panel copy — the CalcResult pattern: nothing is a black box (§6.2). */
function evidenceFor(key: keyof ScoreComponents, plantName: string, sensored: boolean): string {
  switch (key) {
    case 'hydration':
      return sensored
        ? `Formula: 40 × time-in-band (14 d), penalized 2 pts per over-wet day.\nInputs: soil moisture every wake (your calibration), comfort band from the species DB.\nSource: sensor readings, verified waterings.`
        : `Formula: 40 × modeled time-in-band (14 d).\nInputs: pot size + material drying model, logged waterings, weather-derived evaporation.\nThe model carries uncertainty — a sensor replaces it with measurement.`;
    case 'light':
      return `Formula: 25 × min(DLI ÷ target, 1), averaged over 7 d.\nInputs: spot audit DLI, species target from the DB.`;
    case 'climate':
      return `Formula: 15 × share of hours inside the temp and RH comfort bands.\nInputs: spot profile; RH from sensor where present, else weather estimate.`;
    case 'consistency':
      return `Formula: 10 × share of the last 12 weeks with care within a day of forecast.\nInputs: verified and logged care events for ${plantName}.`;
    case 'trend':
      return `Formula: ±10 from the 14-day score slope, clamped.\nInputs: daily component scores.`;
  }
}

type TimelineFilter = 'All' | 'Photos' | 'Care' | 'Insights';

/**
 * The one hero animation (§1.5): on a score change the ring drains slightly,
 * then refills with a 900 ms liquid ease while the score counts up with it.
 */
function useLiquidScore(target: number): number {
  const [display, setDisplay] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    if (target === prev.current) return;
    const from = prev.current;
    prev.current = target;
    const dip = Math.max(0, Math.min(from, target) - 4);
    const start = Date.now();
    const D = 900;
    const id = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / D);
      let v: number;
      if (t < 0.25) {
        v = from + (dip - from) * (t / 0.25); // drain
      } else {
        const u = (t - 0.25) / 0.75;
        const e = 1 - Math.pow(1 - u, 3); // liquid ease-out refill
        v = dip + (target - dip) * e;
      }
      setDisplay(Math.round(v));
      if (t >= 1) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [target]);
  return display;
}

export default function PlantDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { plants, spots, sensors, settings, logWater, archivePlant, addPhoto, renamePlant } = useGreenr();
  const plant = plants.find((p) => p.id === id);
  const [expanded, setExpanded] = useState<keyof ScoreComponents | null>(null);
  const [filter, setFilter] = useState<TimelineFilter>('All');
  const [pokeAnswered, setPokeAnswered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [photoAdded, setPhotoAdded] = useState(false);

  const spot = useMemo(() => spots.find((s) => s.id === plant?.spotId), [spots, plant]);
  const sensor = useMemo(() => sensors.find((s) => s.id === plant?.sensorId), [sensors, plant]);
  const displayScore = useLiquidScore(plant?.score ?? 0);

  if (!plant) {
    return (
      <View style={{ flex: 1, backgroundColor: dark.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.body, { color: dark.inkMuted }]}>Plant not found.</Text>
      </View>
    );
  }

  const band = bandFor(plant.score);
  const bestSpot = spots
    .filter((s) => s.id !== plant.spotId)
    .sort((a, b) => b.dli - a.dli)[0];
  const lightIsLimiting = plant.components.light <= COMPONENT_MAX.light - 6;

  const events = plant.timeline.filter((e) => {
    if (filter === 'All') return true;
    if (filter === 'Photos') return e.kind === 'photo';
    if (filter === 'Care') return e.kind === 'care';
    return e.kind === 'insight' || e.kind === 'diagnosis' || e.kind === 'band-change';
  });

  return (
    <View style={{ flex: 1, backgroundColor: dark.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 1 · Hero */}
        <View
          style={{
            paddingTop: insets.top + 8,
            paddingHorizontal: layout.margin,
            paddingBottom: 20,
            backgroundColor: dark.surface1,
            borderBottomLeftRadius: 28,
            borderBottomRightRadius: 28,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
              <Ionicons name="chevron-back" size={24} color={dark.ink} />
            </Pressable>
            <Pressable onPress={() => setMenuOpen(!menuOpen)} style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}>
              <Ionicons name="ellipsis-horizontal" size={22} color={dark.ink} />
            </Pressable>
          </View>
          {menuOpen && (
            <Card elevated style={{ position: 'absolute', right: 16, top: insets.top + 52, zIndex: 10, width: 200, gap: 4 }}>
              {['Edit', 'Move spot', 'Mark as gifted', 'Archive / Died'].map((item) => (
                <Pressable
                  key={item}
                  onPress={() => {
                    setMenuOpen(false);
                    if (item === 'Edit') {
                      setRenameText(plant.name);
                      setRenameOpen(true);
                    } else if (item === 'Move spot') {
                      router.push({ pathname: '/move/[id]', params: { id: plant.id } });
                    } else if (item === 'Mark as gifted') {
                      archivePlant(plant.id, 'Gifted');
                      router.back();
                    } else if (item === 'Archive / Died') {
                      router.push({ pathname: '/autopsy/[id]', params: { id: plant.id } });
                    }
                  }}
                  style={{ minHeight: 40, justifyContent: 'center' }}
                >
                  <Text style={[type.body, { color: item.includes('Died') ? accent.clay : dark.ink }]}>{item}</Text>
                </Pressable>
              ))}
            </Card>
          )}
          {renameOpen && (
            <Card elevated style={{ marginTop: 4 }}>
              <Text style={[type.micro, { color: dark.inkMuted }]}>NAME</Text>
              <TextInput
                value={renameText}
                onChangeText={setRenameText}
                autoFocus
                style={[type.cardTitle, { color: dark.ink, marginTop: 4, minHeight: 36 }]}
              />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <GButton title="Cancel" kind="secondary" style={{ flex: 1, minHeight: 40 }} onPress={() => setRenameOpen(false)} />
                <GButton
                  title="Save"
                  style={{ flex: 1, minHeight: 40 }}
                  onPress={() => {
                    if (renameText.trim()) renamePlant(plant.id, renameText.trim());
                    setRenameOpen(false);
                  }}
                />
              </View>
            </Card>
          )}
          <View style={{ alignItems: 'center', marginTop: 4 }}>
            <VitalityRing
              score={displayScore}
              size={120}
              estimate={plant.estimate}
              estimateBand={plant.estimateBand}
              subLabel={plant.estimate ? `${band.word} (estimate)` : band.word}
              trackColor={dark.hairline}
            />
            <Text style={[type.screenTitle, { color: dark.ink, marginTop: 12 }]}>{plant.name}</Text>
            <Text style={[type.caption, { color: dark.inkMuted, marginTop: 2 }]}>
              {plant.latin} · {spot?.name ?? '—'}
            </Text>
            {sensor && (
              <Pressable onPress={() => router.push(`/sensor/${sensor.id}`)} style={{ marginTop: 8 }}>
                <Chip label={`${sensor.name} · soil ${sensor.latest.soilPct}%`} color={accent.verdant} />
              </Pressable>
            )}
          </View>
        </View>

        <View style={{ paddingHorizontal: layout.margin }}>
          {/* 2 · Score breakdown */}
          <SectionHeader>Score breakdown</SectionHeader>
          <Card>
            {(Object.keys(COMPONENT_LABELS) as (keyof ScoreComponents)[]).map((key, i) => {
              const val = plant.components[key];
              const max = COMPONENT_MAX[key];
              const open = expanded === key;
              return (
                <View key={key}>
                  {i > 0 && <Hairline style={{ marginVertical: 10 }} />}
                  <Pressable
                    onPress={() => setExpanded(open ? null : key)}
                    style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32 }}
                  >
                    <Text style={[type.body, { color: dark.ink, width: 104 }]}>
                      {COMPONENT_LABELS[key]}
                    </Text>
                    <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: dark.hairline, marginHorizontal: 10 }}>
                      <View
                        style={{
                          width: `${Math.max(0, (val / max) * 100)}%`,
                          height: 4,
                          borderRadius: 2,
                          backgroundColor: val / max >= 0.75 ? accent.sage : val / max >= 0.5 ? accent.sunbeam : accent.clay,
                        }}
                      />
                    </View>
                    <Text style={[type.num as any, { fontSize: 14, color: dark.ink }]}>
                      {key === 'trend' && val > 0 ? '+' : ''}
                      {val}/{max}
                    </Text>
                    <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={dark.inkMuted} style={{ marginLeft: 6 }} />
                  </Pressable>
                  {open && (
                    <Text style={[type.caption, { color: dark.inkMuted, marginTop: 8, lineHeight: 18 }]}>
                      {evidenceFor(key, plant.name, !!plant.sensorId)}
                    </Text>
                  )}
                  {key === 'hydration' && plant.estimate && (
                    <View style={{ marginTop: 8 }}>
                      {pokeAnswered ? (
                        <Text style={[type.caption, { color: accent.sage }]}>
                          Noted — the ± tightens on the next model pass.
                        </Text>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={[type.caption, { color: dark.inkMuted, flex: 1 }]}>
                            It&apos;s been 6 days — is the top inch dry?
                          </Text>
                          <GButton title="Dry" kind="secondary" style={{ minHeight: 36, paddingHorizontal: 12 }} onPress={() => setPokeAnswered(true)} />
                          <GButton title="Damp" kind="secondary" style={{ minHeight: 36, paddingHorizontal: 12 }} onPress={() => setPokeAnswered(true)} />
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </Card>

          {/* 3 · Forecast strip */}
          <SectionHeader>10-day forecast</SectionHeader>
          <Card>
            <ForecastBar forecast={plant.forecast} estimate={plant.estimate} height={30} />
            <Text style={[type.caption, { color: dark.inkMuted, marginTop: 10 }]}>
              {plant.forecast.action}
            </Text>
            {!settings.plus && (
              <Pressable onPress={() => router.push('/plus')} style={{ marginTop: 10 }}>
                <View style={{ opacity: 0.35 }}>
                  <ForecastBar
                    forecast={{ ...plant.forecast, criticalInDays: null, warnInDays: 6, confidenceDays: 2, action: '' }}
                    estimate
                    height={22}
                    showLabel={false}
                  />
                </View>
                <Text style={[type.caption, { color: accent.verdant, marginTop: 6 }]}>
                  See 10 days ahead — Greenr+
                </Text>
              </Pressable>
            )}
          </Card>

          {/* 4 · Range Ribbon */}
          <SectionHeader>Soil moisture</SectionHeader>
          <Card>
            <RangeRibbon
              history={plant.moistureHistory}
              band={plant.comfortBand}
              timeInRangePct={plant.timeInRangePct}
              lockedBeyond7d={!settings.plus}
              onLockedPress={() => router.push('/plus')}
            />
          </Card>

          {/* 5 · Environment */}
          <SectionHeader>Environment</SectionHeader>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {[
                { label: 'Light', value: `${spot?.dli.toFixed(1) ?? '—'} DLI` },
                { label: 'Temp', value: spot ? `${spot.tempRange[0]}–${spot.tempRange[1]}°` : '—' },
                { label: 'Humidity', value: spot ? `${spot.rh}% RH` : '—' },
              ].map((s) => (
                <View key={s.label} style={{ alignItems: 'center', flex: 1, paddingHorizontal: 2 }}>
                  <Text
                    style={[type.numBold as any, { fontSize: 16, color: dark.ink }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {s.value}
                  </Text>
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>{s.label}</Text>
                </View>
              ))}
            </View>
            {lightIsLimiting && bestSpot && (
              <>
                <Hairline style={{ marginVertical: 12 }} />
                <Pressable onPress={() => router.push({ pathname: '/move/[id]', params: { id: plant.id } })}>
                  <Text style={[type.caption, { color: accent.verdant }]}>
                    The {bestSpot.name.toLowerCase()} would raise Light toward {COMPONENT_MAX.light}/{COMPONENT_MAX.light} · projected score {Math.min(100, plant.score + 8)} (+8) — tap to plan the move
                  </Text>
                </Pressable>
              </>
            )}
          </Card>

          {/* 6 · Timeline */}
          <SectionHeader>Timeline</SectionHeader>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            {(['All', 'Photos', 'Care', 'Insights'] as TimelineFilter[]).map((f) => (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={{
                  minHeight: 44,
                  justifyContent: 'center',
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: filter === f ? accent.verdant : dark.hairline,
                }}
              >
                <Text style={[type.micro, { color: filter === f ? dark.ink : dark.inkMuted }]}>{f}</Text>
              </Pressable>
            ))}
          </View>
          <Card>
            {events.length === 0 && (
              <Text style={[type.caption, { color: dark.inkMuted }]}>Nothing here yet.</Text>
            )}
            {events.map((e, i) => (
              <View key={e.id}>
                {i > 0 && <Hairline style={{ marginVertical: 10 }} />}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Ionicons
                    name={
                      e.kind === 'photo'
                        ? 'image-outline'
                        : e.kind === 'care'
                          ? 'water-outline'
                          : e.kind === 'band-change'
                            ? 'swap-vertical-outline'
                            : 'analytics-outline'
                    }
                    size={16}
                    color={dark.inkMuted}
                    style={{ marginTop: 2 }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.body, { color: dark.ink, lineHeight: 20 }]}>{e.text}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 }}>
                      <Text style={[type.micro, { color: dark.inkMuted }]}>{daysAgoLabel(e.daysAgo)}</Text>
                      {e.verified && <Chip label="✓ verified" color={accent.sage} />}
                    </View>
                  </View>
                </View>
              </View>
            ))}
          </Card>
        </View>
      </ScrollView>

      {/* 7 · Sticky action bar */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          flexDirection: 'row',
          gap: 10,
          paddingHorizontal: layout.margin,
          paddingTop: 10,
          paddingBottom: insets.bottom + 10,
          backgroundColor: dark.surface1,
          borderTopWidth: 1,
          borderTopColor: dark.hairline,
        }}
      >
        <GButton
          title="Water"
          style={{ flex: 1, paddingHorizontal: 6 }}
          onPress={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            logWater(plant.id);
          }}
        />
        <GButton
          title={photoAdded ? 'Photo ✓' : 'Photo'}
          kind="secondary"
          style={{ flex: 1, paddingHorizontal: 6 }}
          onPress={() => {
            if (photoAdded) return;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            addPhoto(plant.id);
            setPhotoAdded(true);
            setTimeout(() => setPhotoAdded(false), 2000);
          }}
        />
        <GButton
          title="Diagnose"
          kind="secondary"
          style={{ flex: 1, paddingHorizontal: 6 }}
          onPress={() =>
            settings.plus
              ? router.push({ pathname: '/diagnose/[id]', params: { id: plant.id } })
              : router.push('/plus')
          }
        />
      </View>
    </View>
  );
}
