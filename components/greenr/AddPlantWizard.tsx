import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Card, GButton, Screen } from '@/components/greenr/UI';
import { accent, dark, light, type } from '@/constants/theme';
import { identifyPlant, issueAdvice, recordIdentificationDecision, type IdentifyError, type IdentifyResult } from '@/lib/identify';
import { genPlantId } from '@/lib/ids';
import { dliWord } from '@/lib/format';
import { ALL_SPECIES, PlantSpecies, getSpecies, searchSpecies, topMatches, type CategoryKey } from '@/lib/plants';
import { useGreenr } from '@/lib/store';
import { resolveSubstrate, type SubstrateSpec } from '@/lib/substrate';
import { Plant, PotMaterial, PotShape, PotSize, SoilMix, SoilRetention, Spot } from '@/lib/types';
import CameraCapture from './CameraCapture';
import SubstratePicker from './SubstratePicker';

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

/**
 * GUIDED LIGHT. "How bright is it?" is a question people answer badly — a room
 * that feels bright to us can be a tenth of what a plant needs. Distance from the
 * window and the way it faces are things anyone can answer accurately, and
 * together they set the light far better.
 *
 * Distance gives the light at a south-facing window (daily light integral,
 * mol/m²/day): it falls off steeply, roughly halving with every metre or so into
 * the room. Direction then scales it — a south window gets sun most of the day,
 * east and west for half of it, north none directly (northern hemisphere).
 */
const WINDOW_DISTANCE: { key: string; label: string; hint: string; dli: number }[] = [
  { key: 'sill', label: 'On the windowsill', hint: 'Right against the glass', dli: 10 },
  { key: 'near', label: 'About 1 m away', hint: 'An arm’s length from the window', dli: 4.5 },
  { key: 'mid', label: '2–3 m away', hint: 'Across part of the room', dli: 2 },
  { key: 'far', label: 'Away from windows', hint: 'A hallway, a back corner', dli: 0.8 },
];
const WINDOW_FACING: { key: string; label: string; factor: number }[] = [
  { key: 'south', label: 'South', factor: 1 },
  { key: 'west', label: 'West', factor: 0.8 },
  { key: 'east', label: 'East', factor: 0.7 },
  { key: 'north', label: 'North', factor: 0.35 },
  { key: 'unsure', label: 'Not sure', factor: 0.65 },
];

/** DLI for an indoor spot from its window distance and direction. */
function guidedDli(distance: string | null, facing: string | null): number {
  const d = WINDOW_DISTANCE.find((x) => x.key === distance) ?? WINDOW_DISTANCE[1];
  const f = WINDOW_FACING.find((x) => x.key === facing) ?? WINDOW_FACING[4];
  // Far from any window the light is mostly reflected, so direction matters little.
  const factor = d.key === 'far' ? Math.max(0.75, f.factor) : f.factor;
  return Math.round(d.dli * factor * 10) / 10;
}

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
  const [windowDistance, setWindowDistance] = useState<string | null>(null);
  const [windowFacing, setWindowFacing] = useState<string | null>(null);
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
  const [substrate, setSubstrate] = useState<SubstrateSpec>({ kind: 'preset', id: 'potting-mix' });
  // The four-way class the older tables key on, kept in step with the choice.
  const soilMix: SoilMix = resolveSubstrate(substrate).legacyClass;
  // Photo identification: null until a photo has been taken.
  const [ident, setIdent] = useState<{ status: 'loading' } | IdentifyResult | IdentifyError | null>(null);
  // How the species was settled, recorded with the plant and against the suggestion.
  const decision = useRef<{ via: 'owner' | 'photo' | 'photo-corrected'; action: 'confirmed' | 'chose-alternative' | 'corrected' | null }>({ via: 'owner', action: null });
  const identSeq = useRef(0);
  const [soilRetention, setSoilRetention] = useState<SoilRetention | null>(null);
  const [ownedDays, setOwnedDays] = useState<number>(0);

  const matches = useMemo(() => topMatches(), []);
  const results = useMemo(() => (query.trim() ? searchSpecies(query, 60) : []), [query]);
  const browseResults = useMemo(() => {
    if (browse == null) return [];
    const cats = new Set(BROWSE_GROUPS[browse].cats);
    return ALL_SPECIES.filter((s) => cats.has(s.category)).sort((a, b) => a.common.localeCompare(b.common));
  }, [browse]);

  /**
   * `from` says where the choice came from, so the record shows whether the
   * photo suggestion was right: its first answer, one of its alternatives, or
   * something the owner found themselves after it suggested otherwise.
   */
  const pick = (s: PlantSpecies, from: 'top' | 'alternative' | 'search' = 'search') => {
    const hadSuggestion = !!ident && 'ok' in ident && ident.ok && ident.identification.candidates.length > 0;
    decision.current =
      from === 'top' ? { via: 'photo', action: 'confirmed' }
        : from === 'alternative' ? { via: 'photo', action: 'chose-alternative' }
          : hadSuggestion ? { via: 'photo-corrected', action: 'corrected' }
            : { via: 'owner', action: null };
    setSpecies(s);
    setName(s.common);
    setStep('details');
  };

  const runIdentification = (uri: string) => {
    const seq = ++identSeq.current;
    setIdent({ status: 'loading' });
    identifyPlant(uri).then((r) => {
      // A retake while this was in flight supersedes it.
      if (seq === identSeq.current) setIdent(r);
    });
  };

  const createSpot = () => {
    const level = LIGHT_LEVELS.find((l) => l.key === lightLevel) ?? LIGHT_LEVELS[1];
    const dli = newSpotOutdoor ? level.dli : guidedDli(windowDistance, windowFacing);
    const spot: Spot = {
      id: `sp-${Date.now().toString(36)}`,
      name: newSpotName.trim(),
      room: newSpotOutdoor ? 'Outdoors' : 'Living room',
      dli,
      tempRange: newSpotOutdoor ? [58, 94] : [68, 75],
      rh: newSpotOutdoor ? 48 : 55,
      measuredBySensor: false,
      outdoor: newSpotOutdoor || undefined,
      seasonalNote: newSpotOutdoor
        ? 'Weather-driven — temp and RH come from the local forecast.'
        : 'Light estimated from the window distance and direction you gave.',
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
      substrate,
      identifiedBy: decision.current.via,
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
    if (ident && 'ok' in ident && ident.ok && decision.current.action) {
      void recordIdentificationDecision(ident.id, decision.current.action, species.common, plant.id);
    }
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
          runIdentification(uri);
        }}
        onCancel={() => setStep('identify')}
      />
    );
  }

  // ── O2b: identify (search or browse the full 1000+ catalog) ──
  if (step === 'identify') {
    const showResults = query.trim().length > 0;
    const showBrowse = !showResults && browse != null;
    return (
      <Screen mode="light">
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>Which is it?</Text>

        {/* ── What the photo suggests. A suggestion, never a decision: the owner picks. ── */}
        {photoUri && ident && (
          <View style={{ marginTop: 14, borderRadius: 18, borderWidth: 1, borderColor: light.hairline, backgroundColor: light.surface1, padding: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Image source={{ uri: photoUri }} style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: light.hairline }} />
              <View style={{ flex: 1 }}>
                {'status' in ident ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator size="small" color={accent.verdant} />
                    <Text style={[type.body, { color: light.ink }]}>Looking at your photo…</Text>
                  </View>
                ) : !ident.ok ? (
                  <>
                    <Text style={[type.body, { color: light.ink, fontWeight: '600' }]}>
                      {ident.reason === 'daily-limit' ? 'Photo limit reached for today' : 'Couldn’t identify from the photo'}
                    </Text>
                    <Text style={[type.caption, { color: light.inkMuted, marginTop: 2, lineHeight: 18 }]}>{ident.message}</Text>
                  </>
                ) : !ident.identification.is_plant ? (
                  <>
                    <Text style={[type.body, { color: light.ink, fontWeight: '600' }]}>That doesn’t look like a plant</Text>
                    <Text style={[type.caption, { color: light.inkMuted, marginTop: 2 }]}>Retake the photo, or search by name below.</Text>
                  </>
                ) : ident.identification.candidates.length === 0 ? (
                  <>
                    <Text style={[type.body, { color: light.ink, fontWeight: '600' }]}>Not sure what this is</Text>
                    <Text style={[type.caption, { color: light.inkMuted, marginTop: 2 }]}>
                      {issueAdvice(ident.identification.image_issue) ?? 'Try another angle, or search by name below.'}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={[type.body, { color: light.ink, fontWeight: '600' }]}>From your photo</Text>
                    <Text style={[type.caption, { color: light.inkMuted, marginTop: 2 }]}>
                      A suggestion — tap the one that’s right, or search below.
                    </Text>
                  </>
                )}
              </View>
            </View>

            {'ok' in ident && ident.ok && ident.identification.is_plant && ident.matches.map((m, i) => {
              const c = m.candidate;
              const word = c.confidence === 'high' ? 'Likely' : c.confidence === 'medium' ? 'Possible' : 'Unsure';
              const tint = c.confidence === 'high' ? accent.verdant : c.confidence === 'medium' ? accent.sunbeamText : light.inkMuted;
              return (
                <View key={c.latin} style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: light.hairline }}>
                  <Pressable
                    disabled={!m.species}
                    onPress={() => m.species && pick(m.species, i === 0 ? 'top' : 'alternative')}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.7 : 1 })}
                  >
                    <Text style={{ fontSize: 28 }}>{m.species?.emoji ?? '🌿'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[type.cardTitle, { color: light.ink, fontSize: 16 }]}>{m.species?.common ?? c.common}</Text>
                      <Text style={[type.caption, { color: light.inkMuted, fontStyle: 'italic' }]}>
                        {c.latin}{c.rank === 'genus' ? ' (genus)' : c.rank === 'family' ? ' (family)' : ''}
                      </Text>
                      {c.features ? <Text style={[type.micro, { color: light.inkMuted, marginTop: 2, lineHeight: 15 }]}>{c.features}</Text> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: tint }}>
                        <Text style={[type.micro, { color: tint }]}>{word}</Text>
                      </View>
                      {m.species ? <Ionicons name="chevron-forward" size={16} color={light.inkMuted} /> : null}
                    </View>
                  </Pressable>
                  {!m.species && (
                    <Text style={[type.micro, { color: light.inkMuted, marginTop: 6, lineHeight: 15 }]}>
                      {m.sameGenus.length
                        ? `Greenr has care records for these ${c.latin.split(' ')[0]} — pick yours:`
                        : 'Greenr has no care record for this one yet. Search below for the closest match.'}
                    </Text>
                  )}
                  {!m.species && m.sameGenus.length > 0 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {m.sameGenus.map((s) => (
                        <Pressable
                          key={s.common}
                          onPress={() => pick(s, 'alternative')}
                          style={{ minHeight: 36, paddingHorizontal: 10, borderRadius: 18, borderWidth: 1, borderColor: light.hairline, justifyContent: 'center' }}
                        >
                          <Text style={[type.caption, { color: light.ink }]}>{s.common}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}

            {'ok' in ident && ident.ok && ident.identification.is_plant && ident.identification.candidates.length > 0
              && issueAdvice(ident.identification.image_issue) && (
              <Text style={[type.micro, { color: accent.sunbeamText, marginTop: 10, lineHeight: 15 }]}>
                {issueAdvice(ident.identification.image_issue)}
              </Text>
            )}

            {!('status' in ident) && (
              <View style={{ marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: light.hairline }}>
                {'ok' in ident && ident.ok && (
                  <Text style={[type.micro, { color: light.inkMuted, lineHeight: 15 }]}>
                    Suggested by AI from the photo. It can be wrong, especially between similar species.
                  </Text>
                )}
                <Pressable onPress={() => { setIdent(null); setStep('camera'); }} hitSlop={8} style={{ minHeight: 40, justifyContent: 'center', alignSelf: 'flex-start' }}>
                  <Text style={[type.caption, { color: accent.verdant }]}>Retake photo</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        <Text style={[type.body, { color: light.inkMuted, marginTop: 14 }]}>
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
          {!showResults && !showBrowse && (
            <Text style={[type.micro, { color: light.inkMuted, marginBottom: 8, letterSpacing: 0.4 }]}>POPULAR</Text>
          )}
          {!showResults && !showBrowse &&
            matches.map((s) => (
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
                <Ionicons name="chevron-forward" size={16} color={light.inkMuted} />
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
        <Text style={[type.caption, { color: light.inkMuted, marginTop: 4, marginBottom: 10, lineHeight: 18 }]}>
          The same sensor reading means different things in different mixes: bark is nearly empty at a
          reading that is still wet in coir. Telling Greenr sets where "full" and "needs water" sit.
        </Text>
        <SubstratePicker value={substrate} onChange={setSubstrate} mode="light" />

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

          {newSpotOutdoor ? (
            <Text style={[type.caption, { color: light.inkMuted, marginTop: 14 }]}>
              Outdoor light and temperature come from your local forecast.
            </Text>
          ) : (
            <>
              <Text style={[type.caption, { color: light.ink, marginTop: 14, fontWeight: '600' }]}>How far from the window?</Text>
              <View style={{ gap: 8, marginTop: 6 }}>
                {WINDOW_DISTANCE.map((d) => (
                  <Pressable
                    key={d.key}
                    onPress={() => {
                      setWindowDistance(d.key);
                      setLightLevel('guided');
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      minHeight: 50,
                      paddingHorizontal: 14,
                      borderRadius: 12,
                      backgroundColor: light.bg,
                      borderWidth: 2,
                      borderColor: windowDistance === d.key ? accent.verdant : 'transparent',
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[type.cardTitle, { color: light.ink, fontSize: 15 }]}>{d.label}</Text>
                      <Text style={[type.micro, { color: light.inkMuted }]}>{d.hint}</Text>
                    </View>
                    {windowDistance === d.key && <Ionicons name="checkmark-circle" size={20} color={accent.verdant} />}
                  </Pressable>
                ))}
              </View>

              {windowDistance !== 'far' && (
                <>
                  <Text style={[type.caption, { color: light.ink, marginTop: 14, fontWeight: '600' }]}>Which way does the window face?</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                    {WINDOW_FACING.map((f) => (
                      <Pressable
                        key={f.key}
                        onPress={() => setWindowFacing(f.key)}
                        style={{
                          minHeight: 44,
                          paddingHorizontal: 16,
                          borderRadius: 12,
                          justifyContent: 'center',
                          backgroundColor: windowFacing === f.key ? accent.verdant : light.bg,
                        }}
                      >
                        <Text style={[type.caption, { color: windowFacing === f.key ? '#FFFFFF' : light.ink, fontWeight: '600' }]}>
                          {f.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={[type.micro, { color: light.inkMuted, marginTop: 6 }]}>
                    In the southern hemisphere, swap north and south.
                  </Text>
                </>
              )}

              {windowDistance && (
                <Text style={[type.caption, { color: accent.verdant, marginTop: 10 }]}>
                  That works out to {dliWord(guidedDli(windowDistance, windowFacing))}.
                </Text>
              )}
            </>
          )}

          <GButton
            title="Add this spot"
            kind="secondary"
            mode="light"
            onPress={createSpot}
            disabled={!newSpotName.trim() || (newSpotOutdoor ? false : !windowDistance)}
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
