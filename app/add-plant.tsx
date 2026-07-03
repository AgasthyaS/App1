import { useRouter } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';

import AddPlantWizard from '@/components/greenr/AddPlantWizard';
import { GButton, Screen } from '@/components/greenr/UI';
import { dark, type } from '@/constants/theme';
import { activePlants, useGreenr } from '@/lib/store';

export default function AddPlantModal() {
  const router = useRouter();
  const { addPlant, plants, settings } = useGreenr();

  // Free covers 3 plants; sensored plants are exempt — a sensor is a seat (§10)
  const seats = activePlants(plants).filter((p) => !p.sensorId).length;
  if (!settings.plus && seats >= 3) {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center' }}>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>
          Free covers 3 plants.
        </Text>
        <Text style={[type.body, { color: dark.inkMuted, marginTop: 10, lineHeight: 22 }]}>
          Plants with a Greenr Sensor don&apos;t count against the limit — a sensor is a seat.
          Greenr+ removes the limit entirely.
        </Text>
        <GButton
          title="See Greenr+"
          onPress={() => {
            router.back();
            router.push('/plus');
          }}
          style={{ marginTop: 24 }}
        />
        <GButton title="Not now" kind="secondary" onPress={() => router.back()} style={{ marginTop: 10 }} />
      </Screen>
    );
  }

  return (
    <AddPlantWizard
      onDone={(plant) => {
        addPlant(plant);
        router.dismiss();
        router.push(`/plant/${plant.id}`);
      }}
    />
  );
}
