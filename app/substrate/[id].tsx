import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import SubstratePicker from '@/components/greenr/SubstratePicker';
import { Card, GButton, Row, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { applyCalibration, calibrationFor } from '@/lib/calibration';
import { getSpecies, waterProfileFor } from '@/lib/plants';
import { idealsFor } from '@/lib/plantStatus';
import { containerThresholds, perchedWaterTableCm } from '@/lib/soilProfile';
import { retentionEstimate } from '@/lib/soilRetention';
import { useGreenr } from '@/lib/store';
import { PRESET_FOR_LEGACY, resolveSubstrate, type SubstrateSpec } from '@/lib/substrate';
import { useLiveReading } from '@/lib/useLiveReading';

/**
 * What a plant is potted in — and what that does to how its readings are read.
 *
 * The picker is the same one the add-plant flow uses. Below it this screen shows
 * the consequence in this plant's own pot: where "full" and "running low" land on
 * the sensor's scale for the chosen substrate, against where the species wants to
 * sit. That comparison is the reason the question is worth answering.
 */
export default function SubstrateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { plants, calibrations, setSubstrate } = useGreenr();
  const plant = plants.find((p) => p.id === id);
  const { history, deviceId } = useLiveReading(plant?.id);

  const initial: SubstrateSpec | null = plant?.substrate
    ?? (plant?.soilMix ? { kind: 'preset', id: PRESET_FOR_LEGACY[plant.soilMix] } : null);
  const [choice, setChoice] = useState<SubstrateSpec | null>(initial);
  const [repotted, setRepotted] = useState(false);
  const [saved, setSaved] = useState(false);

  const details = useMemo(() => {
    if (!plant || !choice) return null;
    const geo = {
      potHeightCm: typeof plant.potHeightCm === 'number' && plant.potHeightCm > 0 ? plant.potHeightCm : 16,
      soilMix: plant.soilMix ?? null,
      substrate: choice,
      probeDepthCm: plant.probeDepthCm ?? null,
    };
    const th = containerThresholds(geo);
    const band = idealsFor(plant.species, plant.comfortBand).band;
    const cal = calibrationFor(calibrations, deviceId, plant.sensorId);
    const hist = cal ? history.map((h) => applyCalibration(h, cal)) : history;
    return {
      th,
      band,
      pwt: perchedWaterTableCm(plant.soilMix ?? 'Standard mix', null, choice),
      measured: hist.length ? retentionEstimate({ ...plant, substrate: choice }, hist) : null,
      soakAndDry: waterProfileFor(plant.species).style === 'soak-and-dry',
      assumedDepth: !(typeof plant.potHeightCm === 'number' && plant.potHeightCm > 0),
    };
  }, [plant, choice, calibrations, deviceId, history]);

  if (!plant) {
    return (
      <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.body, { color: dark.inkMuted }]}>That plant is no longer in your garden.</Text>
        <GButton title="Go back" kind="secondary" onPress={() => router.back()} style={{ marginTop: 16 }} />
      </Screen>
    );
  }

  const before = resolveSubstrate(plant.substrate, plant.soilMix);
  const after = choice ? resolveSubstrate(choice, plant.soilMix) : before;
  const changed = !plant.substrate || before.key !== after.key;
  // Naming the same medium more precisely is not a change of medium.
  const sameMedium = before.key === after.key || before.vg === after.vg;
  const species = getSpecies(plant.species);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back" style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24, flex: 1 }]} numberOfLines={1}>What it’s potted in</Text>
      </View>
      <Text style={[type.body, { color: dark.inkMuted, marginTop: 6, lineHeight: 22 }]}>
        The sensor reports how wet the soil is on its own scale. How wet is “enough” depends on what the soil
        is: orchid bark is nearly out of water at a reading where coir is still soaked.
      </Text>

      <SectionHeader>{plant.name}</SectionHeader>
      <SubstratePicker value={choice} onChange={(s) => { setChoice(s); setSaved(false); }} mode="dark" />

      {details && choice && (
        <>
          <SectionHeader>In this pot</SectionHeader>
          <Card>
            <Scale
              capacity={details.th.capacityReading}
              refill={details.th.refillReading}
              band={details.band}
              showRefill={!details.soakAndDry && after.knowledge !== 'unknown' && !details.th.unreliable}
            />
            <Text style={[type.caption, { color: dark.ink, lineHeight: 19, marginTop: 12 }]}>
              {details.th.unreliable
                ? `In ${after.label.toLowerCase()} the top of this pot barely changes between full and dry, so the probe has little to read. Greenr will lean on timing and on how the pot behaves rather than on the number.`
                : `Just after draining, the sensor should read about ${Math.round(details.th.capacityReading)}. The water a plant can take freely runs out near ${Math.round(details.th.refillReading)}.`}
            </Text>
            <Text style={[type.caption, { color: dark.inkMuted, lineHeight: 19, marginTop: 8 }]}>
              {details.soakAndDry
                ? `${species?.common ?? plant.species} is a soak-and-dry plant, so Greenr waits for its own floor of ${details.band[0]} whatever the mix.`
                : details.th.refillReading > details.band[0] + 2
                  ? `${species?.common ?? plant.species} is fine down to ${details.band[0]}, so between ${Math.round(details.th.refillReading)} and ${details.band[0]} Greenr will say it is drying, and ask for water at ${details.band[0]}.`
                  : `${species?.common ?? plant.species} wants water at ${details.band[0]}, before this mix runs low, so the plant’s own floor decides.`}
            </Text>
            <Text style={[type.micro, { color: dark.inkMuted, lineHeight: 16, marginTop: 8 }]}>
              About {details.pwt.toFixed(1)} cm at the bottom of the pot stays saturated after watering in this mix.
              {details.assumedDepth ? ' Pot depth is not set, so a 16 cm pot is assumed.' : ''} These are model
              estimates on the sensor’s 0–100 index, not measured water contents.
            </Text>
          </Card>

          {details.measured?.confident && (
            <Card style={{ marginTop: 10 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Ionicons name="analytics" size={18} color={accent.sage} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]}>Measured in this pot</Text>
                  <Text style={[type.caption, { color: dark.inkMuted, lineHeight: 19, marginTop: 2 }]}>
                    {details.measured.headline} This is from the sensor’s own record and outranks any figure above.
                  </Text>
                </View>
              </View>
            </Card>
          )}
        </>
      )}

      {changed && choice && !sameMedium && (
        <>
          <SectionHeader>What changed?</SectionHeader>
          <Card>
            <Row title="I repotted it into this" value={repotted ? '●' : '○'} onPress={() => setRepotted(true)} />
            <Row title="It was always in this — I’m correcting it" value={!repotted ? '●' : '○'} onPress={() => setRepotted(false)} />
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6, lineHeight: 16 }]}>
              Either way, what Greenr had learned about how this pot dries is set aside, because it was learned
              against a different mix. Readings and the care log are kept.
            </Text>
          </Card>
        </>
      )}

      <GButton
        title={saved ? 'Saved' : changed ? 'Save' : 'No change'}
        disabled={!choice || !changed || saved}
        track="substrate.save"
        onPress={() => {
          if (!choice) return;
          setSubstrate(plant.id, choice, repotted ? 'repot' : 'owner-edit');
          setSaved(true);
        }}
        style={{ marginTop: 20 }}
      />
    </Screen>
  );
}

/** The sensor's 0–100 scale with this substrate's marks and the species' comfortable band. */
function Scale({ capacity, refill, band, showRefill }: {
  capacity: number; refill: number; band: [number, number]; showRefill: boolean;
}) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, v))}%` as const;
  return (
    <View>
      <View style={{ height: 34 }}>
        {/* the track */}
        <View style={{ position: 'absolute', left: 0, right: 0, top: 13, height: 8, borderRadius: 4, backgroundColor: dark.hairline }} />
        {/* where the species is comfortable */}
        <View style={{ position: 'absolute', left: pct(band[0]), width: pct(band[1] - band[0]), top: 13, height: 8, borderRadius: 4, backgroundColor: accent.sage, opacity: 0.55 }} />
        {showRefill && <Mark at={refill} color={accent.sunbeam} />}
        <Mark at={capacity} color={accent.verdant} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[type.micro, { color: dark.inkMuted }]}>0 · air</Text>
        <Text style={[type.micro, { color: dark.inkMuted }]}>100 · water</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
        <Legend color={accent.verdant} label={`Full ≈ ${Math.round(capacity)}`} />
        {showRefill && <Legend color={accent.sunbeam} label={`Running low ≈ ${Math.round(refill)}`} />}
        <Legend color={accent.sage} label={`Plant’s range ${band[0]}–${band[1]}`} block />
      </View>
    </View>
  );
}

function Mark({ at, color }: { at: number; color: string }) {
  return (
    <View style={{ position: 'absolute', left: `${Math.max(0, Math.min(100, at))}%`, top: 6, marginLeft: -2, width: 4, height: 22, borderRadius: 2, backgroundColor: color }} />
  );
}

function Legend({ color, label, block }: { color: string; label: string; block?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: block ? 14 : 4, height: block ? 8 : 14, borderRadius: 2, backgroundColor: color, opacity: block ? 0.55 : 1 }} />
      <Text style={[type.caption, { color: dark.ink }]}>{label}</Text>
    </View>
  );
}
