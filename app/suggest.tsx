import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Card, GButton, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, light, type } from '@/constants/theme';
import { ClimateKind, ClimateRead, PlantSuggestion, climateFromLatitude, suggestionsFor } from '@/lib/climate';

/**
 * "What should I plant?" — for people who don't know what to grow. With the
 * phone's location it reads a coarse climate and suggests species that thrive
 * in the area; each one taps straight into the add-plant flow. Location is
 * optional — a manual climate picker is always offered.
 */

type Phase = 'intro' | 'locating' | 'results';

const MANUAL: { kind: ClimateKind; label: string; emoji: string }[] = [
  { kind: 'tropical', label: 'Tropical / warm all year', emoji: '🌴' },
  { kind: 'hot-dry', label: 'Hot summers, mild winters', emoji: '🏜️' },
  { kind: 'temperate', label: 'Four seasons', emoji: '🍂' },
  { kind: 'cold', label: 'Cold winters', emoji: '❄️' },
];

export default function Suggest() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('intro');
  const [climate, setClimate] = useState<ClimateRead | null>(null);
  const [suggestions, setSuggestions] = useState<PlantSuggestion[]>([]);
  const [place, setPlace] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const month = new Date().getMonth();

  const show = (read: ClimateRead, lat: number) => {
    setClimate(read);
    setSuggestions(suggestionsFor(read.kind, lat, month));
    setPhase('results');
  };

  const useLocation = async () => {
    setError(null);
    setPhase('locating');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission was declined — pick your climate below instead.');
        setPhase('intro');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      const lat = pos.coords.latitude;
      try {
        const geo = await Location.reverseGeocodeAsync({
          latitude: lat,
          longitude: pos.coords.longitude,
        });
        const g = geo[0];
        if (g) setPlace([g.city, g.region].filter(Boolean).join(', ') || g.country || null);
      } catch {
        // reverse geocode is best-effort
      }
      show(climateFromLatitude(lat), lat);
    } catch {
      setError('Could not read your location — pick your climate below instead.');
      setPhase('intro');
    }
  };

  const pickManual = (kind: ClimateKind) => {
    // manual pick: assume northern mid-latitude for seasonality
    const latByKind: Record<ClimateKind, number> = { tropical: 10, 'hot-dry': 30, temperate: 42, cold: 55 };
    show(climateFromLatitude(latByKind[kind]), latByKind[kind]);
  };

  const goAdd = (s: PlantSuggestion) => {
    // swap this modal for the add-plant modal in one step (no GO_BACK flicker)
    router.replace({
      pathname: '/add-plant',
      params: { species: s.species, outdoor: s.where === 'outdoor' ? '1' : '0' },
    });
  };

  if (phase === 'locating') {
    return (
      <Screen mode="light" scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={accent.verdant} size="large" />
        <Text style={[type.body, { color: light.inkMuted, marginTop: 18 }]}>
          Reading your area&apos;s climate…
        </Text>
      </Screen>
    );
  }

  if (phase === 'results' && climate) {
    return (
      <Screen mode="light">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Pressable onPress={() => setPhase('intro')} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
            <Ionicons name="chevron-back" size={24} color={light.ink} />
          </Pressable>
          <Text style={[type.ritualTitle, { color: light.ink, fontSize: 24 }]}>What thrives here</Text>
        </View>

        <Card mode="light" style={{ marginTop: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="location" size={16} color={accent.verdant} />
            <Text style={[type.cardTitle, { color: light.ink, fontSize: 15 }]}>
              {place ?? climate.label}
            </Text>
          </View>
          <Text style={[type.body, { color: light.inkMuted, marginTop: 6 }]}>{climate.summary}</Text>
        </Card>

        <SectionHeader mode="light">Recommended for you</SectionHeader>
        <View style={{ gap: 10 }}>
          {suggestions.map((s, i) => (
            <Card
              key={`${s.species}-${i}`}
              mode="light"
              onPress={() => goAdd(s)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}
            >
              <Text style={{ fontSize: 34 }}>{s.emoji}</Text>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[type.cardTitle, { color: light.ink }]}>{s.species}</Text>
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 8,
                      backgroundColor: s.where === 'outdoor' ? `${accent.sage}33` : `${accent.verdant}22`,
                    }}
                  >
                    <Text style={[type.micro, { color: s.where === 'outdoor' ? accent.sunbeamText : accent.verdant }]}>
                      {s.where}
                    </Text>
                  </View>
                </View>
                <Text style={[type.caption, { color: light.inkMuted, marginTop: 3, lineHeight: 17 }]}>
                  {s.reason}
                </Text>
              </View>
              <Ionicons name="add-circle" size={26} color={accent.verdant} />
            </Card>
          ))}
        </View>
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 14, textAlign: 'center' }]}>
          Tap any plant to add it — Greenr will start tracking it right away.
        </Text>
      </Screen>
    );
  }

  // intro
  return (
    <Screen mode="light">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={light.ink} />
        </Pressable>
      </View>
      <Text style={[type.ritualHeadline, { color: light.ink, marginTop: 4 }]}>
        Not sure what to plant?
      </Text>
      <Text style={[type.body, { color: light.inkMuted, marginTop: 10, lineHeight: 22 }]}>
        Share your location and Greenr suggests plants that thrive in your climate and season —
        right now, where you are.
      </Text>

      <GButton title="Use my location" onPress={useLocation} style={{ marginTop: 24 }} />
      {error && (
        <Text style={[type.caption, { color: accent.clay, marginTop: 10, textAlign: 'center' }]}>
          {error}
        </Text>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 20 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: light.hairline }} />
        <Text style={[type.micro, { color: light.inkMuted }]}>or pick your climate</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: light.hairline }} />
      </View>

      <View style={{ gap: 10 }}>
        {MANUAL.map((m) => (
          <Card
            key={m.kind}
            mode="light"
            onPress={() => pickManual(m.kind)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}
          >
            <Text style={{ fontSize: 26 }}>{m.emoji}</Text>
            <Text style={[type.cardTitle, { color: light.ink, fontSize: 15, flex: 1 }]}>{m.label}</Text>
            <Ionicons name="chevron-forward" size={18} color={light.inkMuted} />
          </Card>
        ))}
      </View>
      <Text style={[type.micro, { color: light.inkMuted, marginTop: 16, textAlign: 'center', lineHeight: 15 }]}>
        Location is used only to read your climate — it isn&apos;t stored or shared.
      </Text>
    </Screen>
  );
}
