import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Card, GButton, Screen } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, dark, light, type } from '@/constants/theme';
import { genPlantId } from '@/lib/ids';
import { dliWord } from '@/lib/format';
import { ALL_SPECIES, PlantSpecies, getSpecies, searchSpecies, topMatches } from '@/lib/plants';
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

type Step = 'camera' | 'identify' | 'details' | 'spot' | 'score';

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

  const matches = useMemo(() => topMatches(), []);
  const results = useMemo(() => (query.trim() ? searchSpecies(query, 40) : []), [query]);

  const estScore = 74;
  const estBand = 9;

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
    setStep('score');
  };

  const finish = () => {
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
      score: estScore,
      estimate: true,
      estimateBand: estBand,
      sensorId: null,
      components: { hydration: 26, light: 20, climate: 12, consistency: 8, trend: 8 },
      comfortBand: species.band,
      moistureHistory: [{ daysAgo: 0, moisture: Math.round((species.band[0] + species.band[1]) / 2) }],
      scoreTrend14: Array(14).fill(estScore),
      forecast: { warnInDays: 5, criticalInDays: null, confidenceDays: 2, action: 'Check ~Fri' },
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

  // ── O2b: identify (searchable across the full database) ──
  if (step === 'identify') {
    const showResults = query.trim().length > 0;
    const confidences = [96, 88, 81];
    return (
      <Screen mode="light">
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>Which is it?</Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 6 }]}>
          Pick a match, or search {ALL_SPECIES.length}+ species.
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

        <ScrollView style={{ marginTop: 12 }} keyboardShouldPersistTaps="handled">
          {!showResults &&
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

          {showResults &&
            results.map((s) => (
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
        <GButton title="Continue" onPress={() => setStep('score')} disabled={!spotId} style={{ marginTop: 24 }} />
      </Screen>
    );
  }

  // ── O5: first score (dark) ──
  return (
    <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
      <VitalityRing score={estScore} size={120} estimate estimateBand={estBand} subLabel="Stable (estimate)">
        <Text style={{ fontSize: 34, position: 'absolute', opacity: 0.18 }}>{species.emoji}</Text>
      </VitalityRing>
      <Text style={[type.screenTitle, { color: dark.ink, marginTop: 16 }]}>
        {name.trim() || species.common}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
        {[
          { label: 'Light ✓', ok: true },
          { label: 'Climate ✓', ok: true },
          { label: 'Hydration ±', ok: false },
        ].map((c) => (
          <View
            key={c.label}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: c.ok ? accent.sage : dark.hairline,
            }}
          >
            <Text style={[type.micro, { color: c.ok ? accent.sage : dark.inkMuted }]}>{c.label}</Text>
          </View>
        ))}
      </View>
      <Text style={[type.caption, { color: dark.inkMuted, textAlign: 'center', marginTop: 18, paddingHorizontal: 20 }]}>
        Estimates tighten as Greenr learns your plant. A Greenr Sensor makes them exact.
      </Text>
      <GButton title="Done" onPress={finish} style={{ marginTop: 26, alignSelf: 'stretch' }} />
    </Screen>
  );
}
