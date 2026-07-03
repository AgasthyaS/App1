import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, Hairline, Row, Screen, StatusDot } from '@/components/greenr/UI';
import { dark, type } from '@/constants/theme';
import { useGreenr } from '@/lib/store';

/** Devices (§11): sensor list rows → Sensor Detail. */
export default function Devices() {
  const router = useRouter();
  const { sensors, plants } = useGreenr();

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Devices</Text>
      </View>

      <Card style={{ marginTop: 16 }}>
        {sensors.length === 0 && (
          <Text style={[type.body, { color: dark.inkMuted }]}>No sensors yet.</Text>
        )}
        {sensors.map((s, i) => {
          const plant = plants.find((p) => p.id === s.plantId);
          return (
            <View key={s.id}>
              {i > 0 && <Hairline style={{ marginVertical: 10 }} />}
              <Pressable
                onPress={() => router.push(`/sensor/${s.id}`)}
                style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 12 }}
              >
                <Text style={{ fontSize: 20 }}>📡</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: dark.ink }]}>{s.name}</Text>
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 1 }]}>
                    {plant ? plant.name : 'Unassigned'} · {s.batteryPct}%
                  </Text>
                </View>
                <StatusDot status={s.status} />
                <Ionicons name="chevron-forward" size={16} color={dark.inkMuted} />
              </Pressable>
            </View>
          );
        })}
        <Hairline style={{ marginVertical: 10 }} />
        <Row title="Add sensor" onPress={() => router.push('/pair-sensor')} />
      </Card>
    </Screen>
  );
}
