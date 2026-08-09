import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Card, GButton, Screen } from '@/components/greenr/UI';
import { accent, dark, light, type } from '@/constants/theme';
import { genPlantId } from '@/lib/ids';
import { dliWord } from '@/lib/format';
import { ALL_SPECIES, PlantSpecies, getSpecies, searchSpecies, topMatches, type CategoryKey } from '@/lib/plants';
import { useGreenr } from '@/lib/store';
import { Plant, PotMaterial, PotShape, PotSize, SoilMix, SoilRetention, Spot } from '@/lib/types';
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
  const [potShape, setPotShape] = useState<PotShape>('tapered');
  const [potHeightText, setPotHeightText] = useState('');
  // Each of these drives a real calculation, not just a profile field:
  // drainage + mix set how fast the soil should drain/dry; ownership age decides
  // whether the plant is still settling in.
  const [hasDrainage, setHasDrainage] = useState<boolean>(true);
  const [soilMix, setSoilMix] = useState<SoilMix>('Standard mix');
  const [soilRetention, setSoilRetention] = useState<SoilRetention | null>(null);
  const [ownedDays, setOwnedDays] = useState<number>(0);

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
      hasDrainage,
      soilMix,
      soilRetention: soilRetention ?? undefined,
      potHeightCm: (() => {
        const n = parseFloat(potHeightText);
        return Number.isFinite(n) && n >= 4 && n <= 100 ? n : null;
      })(),
      ownedSince: new Date(Date.now() - ownedDays * 86400000).toISOString(),
      potShape,
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

        <Text style={[type.micro, { color: accent.verdant, marginTop: 22, letterSpacing: 0.4 }]}>
          HOW WIDE IS THE POT? · REQUIRED
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
          Same species, different pot = different water needs. Volume grows with the CUBE of the
          width, so this is the single biggest influence on every ml amount Greenr gives you.
        </Text>

        {/* Taper. A pot is a frustum, so its volume is (1+k+k²)/3 of the
            enclosing cylinder for k = base ÷ top. That is a ±20% swing on soil
            volume, and therefore on every watering amount. */}
        <Text style={[type.micro, { color: accent.verdant, marginTop: 22, letterSpacing: 0.4 }]}>
          WHAT SHAPE IS IT?
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          {(
            [
              ['straight', 'Straight'],
              ['tapered', 'Tapered'],
              ['very-tapered', 'Very tapered'],
            ] as [PotShape, string][]
          ).map(([val, label]) => (
            <Pressable
              key={val}
              onPress={() => setPotShape(val)}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 12,
                alignItems: 'center',
                backgroundColor: light.surface1,
                borderWidth: 2,
                borderColor: potShape === val ? accent.verdant : 'transparent',
              }}
            >
              <Text style={[type.caption, { color: light.ink }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 6, lineHeight: 15 }]}>
          How much it narrows towards the base. A straight-sided pot holds about a
          fifth more soil than a strongly tapered one of the same width.
        </Text>

        {/* Soil DEPTH — as important as diameter, and for a different reason.
            The saturated layer at a pot's base is a fixed height set by the mix,
            so it fills most of a shallow bowl but little of a deep pot. */}
        <Text style={[type.micro, { color: accent.verdant, marginTop: 22, letterSpacing: 0.4 }]}>
          HOW DEEP IS THE SOIL? · REQUIRED
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <TextInput
            value={potHeightText}
            onChangeText={setPotHeightText}
            keyboardType="numeric"
            placeholder="e.g. 16"
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
          <Text style={[type.body, { color: light.inkMuted, flex: 1 }]}>cm from soil surface to the base</Text>
        </View>
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 6, lineHeight: 15 }]}>
          The probe reads the top 6.5 cm, while water always leaves a saturated layer on the pot&apos;s
          base whose height depends on the compost, not the pot. Without the depth Greenr cannot work
          out what the roots below the probe are sitting in — so this one is needed.
        </Text>
        {(() => {
          const h = parseFloat(potHeightText);
          if (!Number.isFinite(h) || h >= 6.5) return null;
          // Rare, but real: bonsai trays and seed pans are shallower than the blade.
          return (
            <Card mode="light" style={{ marginTop: 10, flexDirection: 'row', gap: 10 }}>
              <Ionicons name="information-circle" size={18} color={accent.verdant} />
              <Text style={[type.micro, { color: light.ink, flex: 1, lineHeight: 16 }]}>
                That&apos;s shallower than the probe ({h.toFixed(1)} cm vs 6.5 cm), so part of the blade
                will sit in the air and read low. Greenr corrects for that — push the probe in at a
                slight angle if you can, to bury more of it.
              </Text>
            </Card>
          );
        })()}

        {/* Drainage holes — the single biggest factor in whether watering hurts
            or helps, so it directly sets how long "draining" is allowed to last
            before Greenr calls it waterlogged. */}
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 22, letterSpacing: 0.4 }]}>
          DOES THE POT HAVE DRAINAGE HOLES?
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          {([['Yes', true], ['No', false]] as [string, boolean][]).map(([label, val]) => (
            <Pressable
              key={label}
              onPress={() => setHasDrainage(val)}
              style={{
                flex: 1,
                minHeight: 48,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: hasDrainage === val ? accent.verdant : light.hairline,
                backgroundColor: light.surface1,
              }}
            >
              <Text style={[type.body, { color: light.ink }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 6, lineHeight: 15 }]}>
          {hasDrainage === false
            ? 'Without holes, water can only leave by evaporation — Greenr will warn much sooner about soggy roots and suggest smaller pours.'
            : 'Greenr uses this to know how long the soil should take to drain after you water.'}
        </Text>

        {/* Soil mix — sets the expected drying speed, so "water in 3 days" is
            based on this pot's real behaviour, not a species average. */}
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 22, letterSpacing: 0.4 }]}>
          WHAT’S IT POTTED IN?
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {(['Standard mix', 'Gritty / cactus', 'Chunky / aroid', 'Dense / heavy'] as SoilMix[]).map((m) => (
            <Pressable
              key={m}
              onPress={() => setSoilMix(m)}
              style={{
                minHeight: 44,
                paddingHorizontal: 14,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: soilMix === m ? accent.verdant : light.hairline,
                backgroundColor: light.surface1,
              }}
            >
              <Text style={[type.caption, { color: light.ink }]}>{m}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 6, lineHeight: 15 }]}>
          Grit sheds water in hours; dense soil holds it for a day or more. This sets how fast Greenr
          expects the soil to dry, and so when watering is really due.
        </Text>

        {/* How long they've owned it — a plant still settling into a new home gets
            gentler advice and lower growth expectations. */}
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 22, letterSpacing: 0.4 }]}>
          HOW LONG HAVE YOU HAD IT?
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {([
            ['Just got it', 0],
            ['A few months', 90],
            ['About a year', 365],
            ['Years', 1095],
          ] as [string, number][]).map(([label, days]) => (
            <Pressable
              key={label}
              onPress={() => setOwnedDays(days)}
              style={{
                minHeight: 44,
                paddingHorizontal: 14,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: ownedDays === days ? accent.verdant : light.hairline,
                backgroundColor: light.surface1,
              }}
            >
              <Text style={[type.caption, { color: light.ink }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 6, lineHeight: 15 }]}>
          {ownedDays === 0
            ? 'New arrivals spend a few weeks re-establishing roots — Greenr keeps advice gentle and won’t read early droop as a problem.'
            : 'An established plant can be judged on its own history rather than species averages.'}
        </Text>

        {/* OPTIONAL calibration. The retention model is built from published
            curves for generic substrates; real composts vary hugely with brand,
            age and how much perlite is in them. This one observation — which
            needs no instruments — tunes the curve to the soil actually in the
            pot, which is the single biggest source of error otherwise. */}
        <Text style={[type.micro, { color: accent.verdant, marginTop: 22, letterSpacing: 0.4 }]}>
          HOW LONG DOES IT STAY DAMP? · OPTIONAL · SHARPENS SENSOR ACCURACY
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {([
            ['A day or two', 'fast'],
            ['3–5 days', 'typical'],
            ['About a week', 'retentive'],
            ['Over a week', 'very-retentive'],
          ] as [string, SoilRetention][]).map(([label, val]) => (
            <Pressable
              key={val}
              onPress={() => setSoilRetention(soilRetention === val ? null : val)}
              style={{
                minHeight: 44,
                paddingHorizontal: 14,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: soilRetention === val ? accent.verdant : light.hairline,
                backgroundColor: light.surface1,
              }}
            >
              <Text style={[type.caption, { color: light.ink }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 6, lineHeight: 15 }]}>
          After a thorough watering, roughly how long before the soil feels dry again? Greenr models
          water retention from published data for generic composts, but yours may hold water quite
          differently. This answer calibrates the curve to your actual soil straight away. It is
          genuinely optional: once the sensor has watched a couple of dry-downs Greenr measures this
          for itself — from how slowly the moisture actually falls — and uses the measurement instead.
        </Text>

        {(() => {
          // Soil volume needs BOTH dimensions — width alone or depth alone leaves
          // the estimate on its fallback bucket, and every ml figure in the app is
          // built on that volume. So both are required here rather than one.
          const h = parseFloat(potHeightText);
          const w = parseFloat(potCmText);
          const okH = Number.isFinite(h) && h >= 4 && h <= 100;
          const okW = Number.isFinite(w) && w >= 5 && w <= 80;
          const valid = okH && okW;
          return (
            <>
              {!valid && (
                <Text style={[type.micro, { color: accent.clay, marginTop: 16 }]}>
                  {!okW && !okH
                    ? 'Enter the pot width (5–80 cm) and soil depth (4–100 cm) to continue.'
                    : !okW
                      ? 'Enter the pot width across the top (5–80 cm) to continue.'
                      : 'Enter the soil depth (4–100 cm) to continue.'}
                </Text>
              )}
              <GButton
                title="Continue"
                disabled={!valid}
                onPress={() => setStep('spot')}
                style={{ marginTop: valid ? 28 : 8 }}
              />
            </>
          );
        })()}
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
