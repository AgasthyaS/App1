import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import RangeRibbon from '@/components/greenr/RangeRibbon';
import { Card, GButton, Screen } from '@/components/greenr/UI';
import { dark, light, type } from '@/constants/theme';
import { useGreenr } from '@/lib/store';

/**
 * The autopsy (§9.3): respectful, clinical, two screens. No cartoon grief,
 * no guilt language. The finding cites the data.
 */

const CAUSES = ['Overwatered', 'Underwatered', 'Not enough light', 'Pests', 'Not sure'];

export default function Autopsy() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { plants, spots, archivePlant } = useGreenr();
  const plant = plants.find((p) => p.id === id);
  const spot = spots.find((s) => s.id === plant?.spotId);
  const [screen, setScreen] = useState<1 | 2>(1);
  const [guess, setGuess] = useState<string | null>(null);

  if (!plant) {
    return (
      <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.body, { color: dark.inkMuted }]}>Plant not found.</Text>
      </Screen>
    );
  }

  // the fatal pattern, read from the data
  const overWet = plant.timeInRangePct < 75;
  const lowLight = (spot?.dli ?? 3) < 1.5;
  const finding = overWet
    ? `Soil sat above the band for extended runs — consistent with root rot, not light. Time in range was ${plant.timeInRangePct}% over the final weeks.`
    : lowLight
      ? `Light averaged ${spot?.dli.toFixed(1)} DLI against a higher species target — a sustained deficit the watering record can't explain away.`
      : `The record shows care within range; the pattern points to factors Greenr doesn't measure — pests or root disease brought in with the pot.`;
  const change = overWet
    ? 'Next time: let the top inch dry fully between waterings, and favor terracotta for this species.'
    : lowLight
      ? `Next time: place this species at ≥ 2.5 DLI — the ${spot?.name ?? 'same spot'} measured below that.`
      : 'Next time: quarantine new plants for two weeks and inspect roots at repotting.';

  if (screen === 1) {
    return (
      <Screen mode="light" scroll={false} style={{ justifyContent: 'center' }}>
        <Text style={[type.ritualTitle, { color: light.ink }]}>
          Mark {plant.name} as died?
        </Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 10, lineHeight: 22 }]}>
          Greenr will read the full record and show what the data says happened.
        </Text>
        <Text style={[type.caption, { color: light.inkMuted, marginTop: 24 }]}>
          Your guess, if you have one:
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {CAUSES.map((c) => (
            <Pressable
              key={c}
              onPress={() => setGuess(c)}
              style={{
                minHeight: 44,
                paddingHorizontal: 14,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: light.surface1,
                borderWidth: 2,
                borderColor: guess === c ? '#5B8A72' : 'transparent',
              }}
            >
              <Text style={[type.caption, { color: light.ink }]}>{c}</Text>
            </Pressable>
          ))}
        </View>
        <GButton title="Continue" onPress={() => setScreen(2)} style={{ marginTop: 28 }} />
        <Pressable onPress={() => router.back()} style={{ alignSelf: 'center', marginTop: 12, minHeight: 44, justifyContent: 'center' }}>
          <Text style={[type.body, { color: light.inkMuted }]}>Cancel</Text>
        </Pressable>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={[type.screenTitle, { color: dark.ink, marginTop: 8 }]}>
        What the data shows.
      </Text>

      <Card style={{ marginTop: 16 }}>
        <RangeRibbon
          history={plant.moistureHistory}
          band={plant.comfortBand}
          timeInRangePct={plant.timeInRangePct}
        />
      </Card>

      <Card style={{ marginTop: 10 }}>
        <Text style={[type.body, { color: dark.ink, lineHeight: 22 }]}>{finding}</Text>
        {guess && guess !== 'Not sure' && (
          <Text style={[type.caption, { color: dark.inkMuted, marginTop: 8 }]}>
            Your guess: {guess.toLowerCase()}.
          </Text>
        )}
        <Text style={[type.body, { color: dark.ink, lineHeight: 22, marginTop: 12 }]}>{change}</Text>
      </Card>

      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 14, textAlign: 'center' }]}>
        Archived to your garden&apos;s history.
      </Text>

      <GButton
        title="Plant something new here"
        onPress={() => {
          archivePlant(plant.id, finding);
          router.dismissAll();
          router.push('/add-plant');
        }}
        style={{ marginTop: 16 }}
      />
      <GButton
        title="Close"
        kind="secondary"
        onPress={() => {
          archivePlant(plant.id, finding);
          router.dismissAll();
        }}
        style={{ marginTop: 10 }}
      />
    </Screen>
  );
}

