import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';

import AddPlantWizard from '@/components/greenr/AddPlantWizard';
import { GButton, Screen } from '@/components/greenr/UI';
import { dark, type } from '@/constants/theme';
import { closeModal, toTabsThen } from '@/lib/nav';
import { activePlants, useGreenr } from '@/lib/store';

export default function AddPlantModal() {
  const { species, outdoor } = useLocalSearchParams<{ species?: string; outdoor?: string }>();
  const { addPlant, plants, settings } = useGreenr();

  // Free accounts can track up to 3 plants total. Greenr+ removes the limit.
  const FREE_PLANT_LIMIT = 3;
  const count = activePlants(plants).length;
  if (!settings.plus && count >= FREE_PLANT_LIMIT) {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center' }}>
        <Text style={{ fontSize: 40 }}>🌿</Text>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24, marginTop: 12 }]}>
          You&apos;ve reached 3 plants
        </Text>
        <Text style={[type.body, { color: dark.inkMuted, marginTop: 10, lineHeight: 22 }]}>
          Free accounts can track up to {FREE_PLANT_LIMIT} plants. Upgrade to Greenr+ to grow your
          garden without limits — plus photo diagnosis and more.
        </Text>
        <GButton title="See Greenr+" onPress={() => toTabsThen('/plus')} style={{ marginTop: 24 }} />
        <GButton title="Not now" kind="secondary" onPress={closeModal} style={{ marginTop: 10 }} />
      </Screen>
    );
  }

  return (
    <AddPlantWizard
      initialSpeciesName={species}
      initialOutdoor={outdoor === '1'}
      onDone={(plant) => {
        addPlant(plant);
        // clear the whole add flow (incl. suggest) so plant detail sits on tabs
        toTabsThen(`/plant/${plant.id}`);
      }}
    />
  );
}
