import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Card, GButton, Screen } from '@/components/greenr/UI';
import { accent, dark, light, type } from '@/constants/theme';
import { genPlantId } from '@/lib/ids';
import { dliWord } from '@/lib/format';
import { ALL_SPECIES, PlantSpecies, getSpecies, searchSpecies, topMatches, type CategoryKey } from '@/lib/plants';
import { useGreenr } from '@/lib/store';
import { Plant, PotMaterial, PotSize, Spot } from '@/lib/types';
import CameraCapture from './CameraCapture';

/**
 * Add plant: camera → identify → name & pot → spot → first score. Capture
 * steps live light (ritual), the first score lands dark (instrument). Light
 * is described, not measured — the sensor is what measures it exactly.
 * A preset species (from location suggestions) skips straight to name & pot.
 * Species come from the plant database (hundreds), searchable in identify.
 */

/** Honest light description — the user tells us roughly how bright the spot
 *  is; a sensor is what turns "bright" into an exact reading. */
const LIGHT_LEVELS: { key: string; label: string; hint: string; dli: number; emoji: string }[] = [
  { key: 'low', label: 'Low', hint: 'A dim corner, away from windows', dli: 0.8, emoji: '🌑' },
  { key: 'medium', label: 'Medium', hint: 'A few feet from a window', dli: 2.3, emoji: '🌥️' },
  { key: 'bright', label: 'Bright', hint: 'Right beside a bright window', dli: 4.5, emoji: '⛅' },
  { key: 'direct', label: 'Direct sun', hint: 'Hours of direct sun, or outdoors', dli: 16, emoji: '☀️' },
];

type Step = 'camera' | 'identify' | 'details' | 'spot' | 'water' | 'score';

/** Browse groups for the 1000+ catalog — search is exact, browsing is how you
 *  discover. Each chip maps to one or more categories. */
const BROWSE_GROUPS: { label: string; emoji: string; cats: CategoryKey[] }[] = [
  { label: 'Houseplants', emoji: '🌿', cats: ['tropical', 'vine', 'fern', 'palm'] },
  { label: 'Succulents & cacti', emoji: '🌵', cats: ['succulent', 'cactus'] },
  { label: 'Herbs', emoji: '🌿', cats: ['herb'] },
  { label: 'Vegetables', emoji: '🥬', cats: ['vegetable'] },
  { label: 'Flowers', emoji: '🌸', cats: ['flowering', 'bulb'] },
  { label: 'Shrubs & trees', emoji: '🌳', cats: ['shrub', 'tree'] },
  { label: 'Orchids', emoji: '🌺', cats: ['orchid'] },
  { label: 'Grasses', emoji: '🎋', cats: ['grass'] },
  { label: 'Carnivorous', emoji: '🪰', cats: ['carnivorous'] },
];

/** "When did you last water it?" — seeds the watering cycle so the first
 *  reminder is timed to THIS plant, not a generic "check Friday". */
const WATER_OPTIONS: { key: string; label: string; daysAgo: number | null }[] = [
  { key: 'today', label: 'Today', daysAgo: 0 },
  { key: 'yesterday', label: 'Yesterday', daysAgo: 1 },
  { key: 'few', label: 'A few days ago', daysAgo: 3 },
  { key: 'week', label: 'About a week ago', daysAgo: 7 },
  { key: 'longer', label: 'Two weeks or more', daysAgo: 14 },
  { key: 'unsure', label: 'Not sure', daysAgo: null },
];

export interface AddPlantWizardProps {
  onDone: (plant: Plant) => void;
  /** preset from a location suggestion — jumps past camera/identify */
  initialSpeciesName?: string;
  initialOutdoor?: boolean;
}

export default function AddPlantWizard({ onDone, initialSpeciesName, initialOutdoor }: AddPlantWizardProps) {
  const { spots, addSpot } = useGreenr();
  const preset = getSpecies(initialSpeciesName);

  const [step, setStep] = useState<Step>(preset ? 'details' : 'camera');
  const [species, setSpecies] = useState<PlantSpecies>(preset ?? topMatches()[0] ?? ALL_SPECIES[0]);
  const [name, setName] = useState(preset?.common ?? '');
  const [query, setQuery] = useState('');
  const [potSize, setPotSize] = useState<PotSize>('M');
  const [potMaterial, setPotMaterial] = useState<PotMaterial>('Terracotta');
  const [spotId, setSpotId] = useState<string | null>(spots[0]?.id ?? null);
  const [newSpotName, setNewSpotName] = useState('');
  const [newSpotOutdoor, setNewSpotOutdoor] = useState(!!initialOutdoor);
  const [lightLevel, setLightLevel] = useState<string | null>(initialOutdoor ? 'direct' : null);
  const [photoUri, setPhotoUri] = useState<string | undefined>(undefined);
  const [lastWatered, setLastWatered] = useState<string | null>(null);
  const [browse, setBrowse] = useState<number | null>(null);
  const [potCmText, setPotCmText] = useState('');

  const matches = useMemo(() => topMatches(), []);
  const results = useMemo(() => (query.trim() ? searchSpecies(query, 60) : []), [query]);
  const browseResults = useMemo(() => {
    if (browse == null) return [];
    const cats = new Set(BROWSE_GROUPS[browse].cats);
    return ALL_SPECIES.filter((s) => cats.has(s.category)).sort((a, b) => a.common.localeCompare(b.common));
  }, [browse]);

  const pick = (s: PlantSpecies) => {
    setSpecies(s);
    setName(s.common);
    setStep('details');
  };

  const createSpot = () => {
    const level = LIGHT_LEVELS.find((l) => l.key === lightLevel) ?? LIGHT_LEVELS[1];
    const spot: Spot = {
      id: `sp-${Date.now().toString(36)}`,
      name: newSpotName.trim(),
      room: newSpotOutdoor ? 'Outdoors' : 'Living room',
      dli: level.dli,
      tempRange: newSpotOutdoor ? [58, 94] : [68, 75],
      rh: newSpotOutdoor ? 48 : 55,
      measuredBySensor: false,
      outdoor: newSpotOutdoor || undefined,
      seasonalNote: newSpotOutdoor
        ? 'Weather-driven — temp and RH come from the local forecast.'
        : 'Light is estimated from your description — a Greenr Sensor measures it exactly.',
    };
    addSpot(spot);
    setSpotId(spot.id);
    setStep('water');
  };

  const finish = () => {
    const now = new Date();
    const wateredOpt = WATER_OPTIONS.find((o) => o.key === lastWatered);
    const lastWateredAt =
      wateredOpt?.daysAgo != null
        ? new Date(now.getTime() - wateredOpt.daysAgo * 86400000).toISOString()
        : null;
    // Internal model seed only — never shown until the 10-day baseline passes
    // (or instantly with a sensor). See vitalityFor().
    const estScore = 74;
    const plant: Plant = {
      id: genPlantId(),
      name: name.trim() || species.common,
      species: species.common,
      latin: species.latin,
      emoji: species.emoji,
      photoUri,
      spotId: spotId ?? spots[0]?.id ?? '',
      potSize,
      potMaterial,
      potCm: (() => {
        const n = parseFloat(potCmText);
        return Number.isFinite(n) && n >= 5 && n <= 80 ? n : null;
      })(),
      addedAt: now.toISOString(),
      lastWateredAt,
      waterLog: lastWateredAt ? [{ at: lastWateredAt, ml: null }] : [],
      score: estScore,
      estimate: true,
      estimateBand: 9,
      sensorId: null,
      components: { hydration: 26, light: 20, climate: 12, consistency: 8, trend: 8 },
      comfortBand: species.band,
      moistureHistory: [{ daysAgo: 0, moisture: Math.round((species.band[0] + species.band[1]) / 2) }],
      scoreTrend14: Array(14).fill(estScore),
      forecast: { warnInDays: null, criticalInDays: null, confidenceDays: 2, action: 'Check the soil' },
      timeline: [{ id: 'tl-new', daysAgo: 0, kind: 'photo', text: photoUri ? 'First photo added' : 'Added to garden' }],
      timeInRangePct: 100,
      addedDaysAgo: 0,
    };
    onDone(plant);
  };

  // ── O2: camera (in-app — never leaves the app, so no black screen) ──
  if (step === 'camera') {
    return (
      <CameraCapture
        caption="Photograph your plant — it becomes its picture. Or tap ✕ to skip."
        onCapture={(uri) => {
          setPhotoUri(uri);
          setStep('identify');
        }}
        onCancel={() => setStep('identify')}
      />
    );
  }

  // ── O2b: identify (search or browse the full 1000+ catalog) ──
  if (step === 'identify') {
    const showResults = query.trim().length > 0;
    const showBrowse = !showResults && browse != null;
    const confidences = [96, 88, 81];
    return (
      <Screen mode="light">
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>Which is it?</Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 6 }]}>
          Search {ALL_SPECIES.length.toLocaleString()} plants, or browse by type.
        </Text>

        {/* search */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: light.surface1,
            borderRadius: 14,
            paddingHorizontal: 14,
            marginTop: 14,
            borderWidth: 1,
            borderColor: light.hairline,
          }}
        >
          <Ionicons name="search" size={16} color={light.inkMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name (e.g. hoya, basil, cactus)"
            placeholderTextColor={light.inkMuted}
            autoCorrect={false}
            style={[type.body, { color: light.ink, flex: 1, minHeight: 48 }]}
          />
          {showResults && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={light.inkMuted} />
            </Pressable>
          )}
        </View>

        {/* browse-by-type chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
          {BROWSE_GROUPS.map((g, i) => (
            <Pressable
              key={g.label}
              onPress={() => setBrowse(browse === i ? null : i)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: 12,
                minHeight: 40,
                borderRadius: 20,
                backgroundColor: browse === i ? accent.verdant : light.surface1,
                borderWidth: 1,
                borderColor: browse === i ? accent.verdant : light.hairline,
              }}
            >
              <Text style={{ fontSize: 13 }}>{g.emoji}</Text>
              <Text style={[type.caption, { color: browse === i ? '#fff' : light.ink }]}>{g.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView style={{ marginTop: 12 }} keyboardShouldPersistTaps="handled">
          {!showResults && !showBrowse &&
            matches.map((s, i) => (
              <Card
                key={s.common}
                mode="light"
                style={{ marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 14 }}
                onPress={() => pick(s)}
              >
                <Text style={{ fontSize: 34 }}>{s.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[type.cardTitle, { color: light.ink }]}>{s.common}</Text>
                  <Text style={[type.caption, { color: light.inkMuted, fontStyle: 'italic' }]}>{s.latin}</Text>
                </View>
                <Text style={[type.numBold as any, { fontSize: 15, color: accent.verdant }]}>
                  {confidences[i] ?? 70}%
                </Text>
              </Card>
            ))}

          {showResults && results.length === 0 && (
            <Text style={[type.body, { color: light.inkMuted, marginTop: 8 }]}>
              No match — try a simpler word, or the common name.
            </Text>
          )}

          {showBrowse && (
            <Text style={[type.micro, { color: light.inkMuted, marginBottom: 6 }]}>
              {browseResults.length} plants · A–Z
            </Text>
          )}

          {(showResults ? results : showBrowse ? browseResults : []).map((s) => (
            <Pressable
              key={s.common}
              onPress={() => pick(s)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 10,
                paddingHorizontal: 6,
                borderBottomWidth: 1,
                borderBottomColor: light.hairline,
              }}
            >
              <Text style={{ fontSize: 26 }}>{s.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[type.cardTitle, { color: light.ink, fontSize: 15 }]}>{s.common}</Text>
                <Text style={[type.caption, { color: light.inkMuted, fontStyle: 'italic' }]}>{s.latin}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={light.inkMuted} />
            </Pressable>
          ))}
        </ScrollView>
      </Screen>
    );
  }

  // ── O3: name & pot ──
  if (step === 'details') {
    return (
      <Screen mode="light">
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>Name &amp; pot</Text>
        <Text style={[type.caption, { color: light.inkMuted, marginTop: 12 }]}>
          {species.common} — rename if you like
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          style={[
            type.cardTitle,
            {
              color: light.ink,
              backgroundColor: light.surface1,
              borderRadius: 14,
              padding: 14,
              marginTop: 8,
            },
          ]}
        />
        <Text style={[type.caption, { color: light.inkMuted, marginTop: 20 }]}>Pot size</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          {(
            [
              ['S', '< 15 cm'],
              ['M', '15–25 cm'],
              ['L', '> 25 cm'],
            ] as [PotSize, string][]
          ).map(([sz, hint]) => (
            <Pressable
              key={sz}
              onPress={() => setPotSize(sz)}
              style={{
                flex: 1,
                minHeight: 64,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: light.surface1,
                borderWidth: 2,
                borderColor: potSize === sz ? accent.verdant : 'transparent',
              }}
            >
              <Text style={{ fontSize: sz === 'S' ? 16 : sz === 'M' ? 22 : 28 }}>🪴</Text>
              <Text style={[type.micro, { color: light.inkMuted, marginTop: 2 }]}>{hint}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[type.caption, { color: light.inkMuted, marginTop: 20 }]}>Pot material</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          {(['Terracotta', 'Plastic', 'Ceramic'] as PotMaterial[]).map((m) => (
            <Pressable
              key={m}
              onPress={() => setPotMaterial(m)}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: light.surface1,
                borderWidth: 2,
                borderColor: potMaterial === m ? accent.verdant : 'transparent',
              }}
            >
              <Text style={[type.caption, { color: light.ink }]}>{m}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 8 }]}>
          Terracotta dries ~2× faster — we account for it.
        </Text>

        <Text style={[type.caption, { color: light.inkMuted, marginTop: 20 }]}>
          Pot diameter (optional)
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <TextInput
            value={potCmText}
            onChangeText={setPotCmText}
            keyboardType="numeric"
            placeholder="e.g. 18"
            placeholderTextColor={light.inkMuted}
            style={[
              type.cardTitle,
              {
                color: light.ink,
                backgroundColor: light.surface1,
                borderRadius: 14,
                paddingHorizontal: 14,
                minHeight: 48,
                width: 110,
              },
            ]}
          />
          <Text style={[type.body, { color: light.inkMuted }]}>cm across the top</Text>
        </View>
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 6, lineHeight: 15 }]}>
          Same species, different pot = different water needs. Measuring makes the ml amounts exact;
          skip it and Greenr uses the size bucket above.
        </Text>

        <GButton title="Continue" onPress={() => setStep('spot')} style={{ marginTop: 28 }} />
      </Screen>
    );
  }

  // ── O4: give it a spot ──
  if (step === 'spot') {
    return (
      <Screen mode="light">
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>Where does it live?</Text>
        {spots.map((s) => (
          <Card
            key={s.id}
            mode="light"
            style={{
              marginTop: 10,
              flexDirection: 'row',
              alignItems: 'center',
              borderWidth: 2,
              borderColor: spotId === s.id ? accent.verdant : 'transparent',
            }}
            onPress={() => setSpotId(s.id)}
          >
            <View style={{ flex: 1 }}>
              <Text style={[type.cardTitle, { color: light.ink }]}>{s.name}</Text>
              <Text style={[type.caption, { color: light.inkMuted }]}>
                {s.room} · {s.dli.toFixed(1)} DLI — {dliWord(s.dli)}
              </Text>
            </View>
            {spotId === s.id && <Ionicons name="checkmark-circle" size={22} color={accent.verdant} />}
          </Card>
        ))}
        <Card mode="light" style={{ marginTop: 10 }}>
          <Text style={[type.caption, { color: light.inkMuted }]}>Or add a new spot</Text>
          <TextInput
            value={newSpotName}
            onChangeText={setNewSpotName}
            placeholder={
              spots.length === 0
                ? 'Name it (“East windowsill”, “Balcony rail”)'
                : 'Name it (“East windowsill”)'
            }
            placeholderTextColor={light.inkMuted}
            style={[type.body, { color: light.ink, minHeight: 36, marginTop: 4 }]}
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            {([false, true] as const).map((out) => (
              <Pressable
                key={String(out)}
                onPress={() => {
                  setNewSpotOutdoor(out);
                  if (out) setLightLevel('direct');
                }}
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: light.bg,
                  borderWidth: 2,
                  borderColor: newSpotOutdoor === out ? accent.verdant : 'transparent',
                }}
              >
                <Text style={[type.caption, { color: light.ink }]}>{out ? 'Outdoor' : 'Indoor'}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[type.caption, { color: light.inkMuted, marginTop: 14 }]}>How bright is it?</Text>
          <View style={{ gap: 8, marginTop: 6 }}>
            {LIGHT_LEVELS.map((l) => (
              <Pressable
                key={l.key}
                onPress={() => setLightLevel(l.key)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  minHeight: 52,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  backgroundColor: light.bg,
                  borderWidth: 2,
                  borderColor: lightLevel === l.key ? accent.verdant : 'transparent',
                }}
              >
                <Text style={{ fontSize: 20 }}>{l.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[type.cardTitle, { color: light.ink, fontSize: 15 }]}>{l.label}</Text>
                  <Text style={[type.micro, { color: light.inkMuted }]}>{l.hint}</Text>
                </View>
                {lightLevel === l.key && <Ionicons name="checkmark-circle" size={20} color={accent.verdant} />}
              </Pressable>
            ))}
          </View>
          <Text style={[type.micro, { color: light.inkMuted, marginTop: 8, lineHeight: 15 }]}>
            This is an estimate from your description. A Greenr Sensor measures the exact light and
            makes the score precise.
          </Text>

          <GButton
            title="Add this spot"
            kind="secondary"
            mode="light"
            onPress={createSpot}
            disabled={!newSpotName.trim() || !lightLevel}
            style={{ marginTop: 12 }}
          />
        </Card>
        <GButton title="Continue" onPress={() => setStep('water')} disabled={!spotId} style={{ marginTop: 24 }} />
      </Screen>
    );
  }

  // ── O5: when was it last watered? (times the first reminder honestly) ──
  if (step === 'water') {
    return (
      <Screen mode="light">
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>
          When did you last water it?
        </Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 6, lineHeight: 21 }]}>
          This times your first reminder to {name.trim() || species.common}&apos;s actual cycle —
          not a generic day of the week.
        </Text>
        <View style={{ gap: 8, marginTop: 16 }}>
          {WATER_OPTIONS.map((o) => (
            <Pressable
              key={o.key}
              onPress={() => setLastWatered(o.key)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: 52,
                paddingHorizontal: 14,
                borderRadius: 12,
                backgroundColor: light.surface1,
                borderWidth: 2,
                borderColor: lastWatered === o.key ? accent.verdant : 'transparent',
              }}
            >
              <Text style={[type.cardTitle, { color: light.ink, fontSize: 15, flex: 1 }]}>{o.label}</Text>
              {lastWatered === o.key && <Ionicons name="checkmark-circle" size={20} color={accent.verdant} />}
            </Pressable>
          ))}
        </View>
        {lastWatered === 'unsure' && (
          <Text style={[type.micro, { color: light.inkMuted, marginTop: 10, lineHeight: 15 }]}>
            No problem — log the next watering and the cycle starts from there.
          </Text>
        )}
        <GButton title="Continue" onPress={() => setStep('score')} disabled={!lastWatered} style={{ marginTop: 24 }} />
      </Screen>
    );
  }

  // ── O6: done (dark) — honest about what happens next; no invented score ──
  return (
    <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 120,
          height: 120,
          borderRadius: 60,
          borderWidth: 3,
          borderStyle: 'dashed',
          borderColor: dark.hairline,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 44 }}>{species.emoji}</Text>
      </View>
      <Text style={[type.screenTitle, { color: dark.ink, marginTop: 16 }]}>
        {name.trim() || species.common}
      </Text>
      <Text style={[type.caption, { color: dark.inkMuted, textAlign: 'center', marginTop: 12, paddingHorizontal: 24, lineHeight: 19 }]}>
        Added. Its health score appears once Greenr has watched it for about 10 days — or instantly
        with a Greenr Sensor. Watering reminders start now, timed from your answers.
      </Text>
      <GButton title="Done" onPress={finish} style={{ marginTop: 26, alignSelf: 'stretch' }} />
    </Screen>
  );
}
