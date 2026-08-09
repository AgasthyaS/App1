import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, GButton, Hairline, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { useGreenr } from '@/lib/store';
import { mixVerdict, recipeLine, recipeVolumes, soilRecipeFor, WATER_QUALITY_NOTE } from '@/lib/soilRecipe';
import { perchedWaterTableCm } from '@/lib/soilProfile';
import { expectedDrainHours } from '@/lib/soilDynamics';
import { potVolume } from '@/lib/watering';
import type { SoilMix } from '@/lib/types';

/**
 * REPOTTING — what to put this plant in, and what changing it would actually do.
 *
 * The recommendation itself comes from lib/soilRecipe. What this screen adds is
 * the CONSEQUENCE: because every recipe names a retention bucket, the app can run
 * the same van Genuchten model it uses for the sensor against both the current
 * mix and the proposed one, and show the difference in the two numbers that
 * actually matter — how deep the permanently-saturated layer at the bottom of the
 * pot will be, and how long the pot will take to shed a watering.
 *
 * That turns "use a chunkier mix" from advice into a prediction the user can hold
 * the app to afterwards, since the sensor will measure both.
 */

const MIX_OPTIONS: SoilMix[] = ['Gritty / cactus', 'Chunky / aroid', 'Standard mix', 'Dense / heavy'];

export default function RepotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { plants, repotPlant } = useGreenr();
  const plant = plants.find((p) => p.id === id);
  const [chosen, setChosen] = useState<SoilMix | null>(null);
  const [done, setDone] = useState(false);

  const recipe = useMemo(() => soilRecipeFor(plant?.species), [plant?.species]);
  const verdict = useMemo(() => mixVerdict(plant?.species, plant?.soilMix ?? null), [plant?.species, plant?.soilMix]);

  if (!plant) {
    return (
      <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.body, { color: dark.inkMuted }]}>Plant not found.</Text>
      </Screen>
    );
  }

  const target = chosen ?? recipe.mix;
  const vol = potVolume({
    potSize: plant.potSize,
    potCm: plant.potCm,
    potHeightCm: plant.potHeightCm,
    potShape: plant.potShape,
  });
  const parts = recipeVolumes(recipe, vol.liters);

  /**
   * What the change does to the physics. Both figures come from the same
   * functions the sensor logic uses, with only the mix swapped — so this is the
   * model's own prediction, not a separate marketing number.
   */
  const effect = (() => {
    const from = plant.soilMix ?? null;
    if (!from || from === target) return null;
    const pwtNow = perchedWaterTableCm(from);
    const pwtNew = perchedWaterTableCm(target);
    const drainNow = expectedDrainHours({ ...plant, soilMix: from });
    const drainNew = expectedDrainHours({ ...plant, soilMix: target });
    return { from, pwtNow, pwtNew, drainNow, drainNew };
  })();

  const tone = verdict.severity === 'major' ? accent.clay : verdict.severity === 'minor' ? accent.sunbeam : accent.verdant;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Repot {plant.name}</Text>
          <Text style={[type.caption, { color: dark.inkMuted }]}>{plant.species}</Text>
        </View>
      </View>

      {/* ── The verdict on what it is in now ── */}
      <Card style={{ marginTop: 16, borderLeftWidth: 3, borderLeftColor: tone }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons
            name={verdict.matches ? 'checkmark-circle' : verdict.severity === 'major' ? 'alert-circle' : 'information-circle'}
            size={18}
            color={tone}
          />
          <Text style={[type.cardTitle, { color: dark.ink, flex: 1 }]}>{verdict.headline}</Text>
        </View>
        <Text style={[type.body, { color: dark.inkMuted, marginTop: 8, lineHeight: 21 }]}>{verdict.detail}</Text>
      </Card>

      {/* ── The recipe ── */}
      <SectionHeader>What to pot it in</SectionHeader>
      <Card>
        <Text style={[type.cardTitle, { color: dark.ink }]}>{recipe.headline}</Text>
        <Text style={[type.micro, { color: accent.verdant, marginTop: 4, letterSpacing: 0.3 }]}>
          {recipe.basisNote.toUpperCase()}
        </Text>
        <Text style={[type.body, { color: dark.inkMuted, marginTop: 10, lineHeight: 21 }]}>{recipe.why}</Text>

        <Hairline style={{ marginVertical: 12 }} />
        <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.4 }]}>THE MIX, BY VOLUME</Text>
        <Text style={[type.body, { color: dark.ink, marginTop: 6, lineHeight: 21 }]}>{recipeLine(recipe)}</Text>

        {parts.length > 0 && (
          <>
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 12, letterSpacing: 0.4 }]}>
              FOR THIS {vol.liters.toFixed(1)} L POT{vol.heightAssumed ? ' (DEPTH ASSUMED)' : ''}
            </Text>
            <View style={{ marginTop: 6, gap: 6 }}>
              {parts.map((c) => (
                <View key={c.name} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <Text style={[type.numBold as any, { color: accent.verdant, width: 58 }]}>{c.liters} L</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.caption, { color: dark.ink }]}>{c.name}</Text>
                    <Text style={[type.micro, { color: dark.inkMuted, lineHeight: 15 }]}>{c.role}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        <Hairline style={{ marginVertical: 12 }} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Fact label="pH" value={`${recipe.ph[0]}–${recipe.ph[1]}`} />
          <Fact label="Drainage" value={recipe.drainage} />
          <Fact label="Best time" value={recipe.bestTime} />
        </View>
        {recipe.phNote && (
          <Text style={[type.micro, { color: accent.sunbeam, marginTop: 10, lineHeight: 15 }]}>{recipe.phNote}</Text>
        )}
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10, lineHeight: 15 }]}>
          Water: {WATER_QUALITY_NOTE[recipe.water]}
        </Text>
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6, lineHeight: 15 }]}>{recipe.repotEvery}</Text>
      </Card>

      {/* ── What will actively harm it ── */}
      <SectionHeader>Avoid</SectionHeader>
      <Card>
        {recipe.avoid.map((a) => (
          <View key={a} style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            <Ionicons name="close-circle-outline" size={16} color={accent.clay} style={{ marginTop: 2 }} />
            <Text style={[type.body, { color: dark.inkMuted, flex: 1, lineHeight: 21 }]}>{a}</Text>
          </View>
        ))}
        {recipe.amendments?.map((a) => (
          <View key={a} style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            <Ionicons name="add-circle-outline" size={16} color={accent.verdant} style={{ marginTop: 2 }} />
            <Text style={[type.body, { color: dark.inkMuted, flex: 1, lineHeight: 21 }]}>{a}</Text>
          </View>
        ))}
      </Card>

      {/* ── What the change would do, per the app's own model ── */}
      {effect && (
        <>
          <SectionHeader>What changing it would do</SectionHeader>
          <Card>
            <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
              Greenr models {target.toLowerCase()} with a different retention curve from{' '}
              {effect.from.toLowerCase()}, so the switch changes two things it already measures:
            </Text>
            <View style={{ marginTop: 12, gap: 10 }}>
              <Delta
                label="Saturated layer at the base"
                from={`${effect.pwtNow.toFixed(1)} cm`}
                to={`${effect.pwtNew.toFixed(1)} cm`}
                note="The band of permanently wet soil sitting on the bottom of every pot. Shallower is safer for roots."
                better={effect.pwtNew < effect.pwtNow}
              />
              <Delta
                label="Time to drain after watering"
                from={`${Math.round(effect.drainNow)} h`}
                to={`${Math.round(effect.drainNew)} h`}
                note="How long the pot stays above its ideal band after a thorough soak."
                better={effect.drainNew < effect.drainNow}
              />
            </View>
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 12, lineHeight: 15 }]}>
              These are predictions from the same model the sensor readings run through — so once you
              repot, the probe will measure whether they were right.
            </Text>
          </Card>
        </>
      )}

      {/* ── Record it ── */}
      <SectionHeader>Record the repot</SectionHeader>
      <Card>
        <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
          Once you have done it, tell Greenr what it is in now. Every moisture number is read through
          the mix, so this is what keeps the readings honest.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {MIX_OPTIONS.map((m) => {
            const selected = (chosen ?? plant.soilMix) === m;
            const recommended = m === recipe.mix;
            return (
              <Pressable
                key={m}
                onPress={() => { setChosen(m); setDone(false); }}
                style={{
                  minHeight: 44,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 12,
                  borderWidth: 2,
                  borderColor: selected ? accent.verdant : dark.hairline,
                  backgroundColor: dark.surface2,
                }}
              >
                <Text style={[type.caption, { color: dark.ink }]}>{m}</Text>
                {recommended && (
                  <Text style={[type.micro, { color: accent.verdant }]}>recommended</Text>
                )}
              </Pressable>
            );
          })}
        </View>
        <GButton
          title={done ? 'Saved' : 'Save — repotted today'}
          disabled={done || (chosen ?? plant.soilMix) == null}
          onPress={() => {
            const mix = chosen ?? plant.soilMix;
            if (!mix) return;
            repotPlant(plant.id, { soilMix: mix });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            setDone(true);
          }}
          style={{ marginTop: 14 }}
        />
        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 10, lineHeight: 15 }]}>
          Saving also starts the 21-day settling window: fresh mix already carries nutrients, so
          Greenr will hold off feeding advice and read early droop as adjustment rather than a
          watering fault.
        </Text>
      </Card>
    </Screen>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ backgroundColor: dark.surface2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, flexGrow: 1, minWidth: '30%' }}>
      <Text style={[type.micro, { color: dark.inkMuted }]}>{label.toUpperCase()}</Text>
      <Text style={[type.caption, { color: dark.ink, marginTop: 2 }]}>{value}</Text>
    </View>
  );
}

function Delta({ label, from, to, note, better }: { label: string; from: string; to: string; note: string; better: boolean }) {
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[type.caption, { color: dark.ink, flex: 1 }]}>{label}</Text>
        <Text style={[type.numBold as any, { color: dark.inkMuted }]}>{from}</Text>
        <Ionicons name="arrow-forward" size={14} color={dark.inkMuted} />
        <Text style={[type.numBold as any, { color: better ? accent.verdant : accent.sunbeam }]}>{to}</Text>
      </View>
      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, lineHeight: 15 }]}>{note}</Text>
    </View>
  );
}
