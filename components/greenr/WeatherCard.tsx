import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { accent, dark, type } from '@/constants/theme';
import type { UseWeather } from '@/lib/useWeather';
import { cToF, kphToMph, uvWord } from '@/lib/weather';
import { Card } from './UI';

/**
 * Current-conditions card (§10). Pure presentation of the useWeather hook —
 * real Open-Meteo data, honest empty/denied/loading states, no placeholders.
 */
export default function WeatherCard({ w, unitsF }: { w: UseWeather; unitsF: boolean }) {
  const { weather, place, status, loading, enable, refresh } = w;

  const temp = (c: number) => `${Math.round(unitsF ? cToF(c) : c)}°${unitsF ? 'F' : 'C'}`;
  const wind = (kph: number) => (unitsF ? `${Math.round(kphToMph(kph))} mph` : `${Math.round(kph)} km/h`);
  const timeOf = (iso: string) =>
    iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—';

  if (!weather && status === 'idle') {
    return (
      <Card style={{ marginTop: 10 }} onPress={enable}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="partly-sunny-outline" size={20} color={accent.verdant} />
          <View style={{ flex: 1 }}>
            <Text style={[type.cardTitle, { color: dark.ink, fontSize: 15 }]}>Enable local weather</Text>
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>
              Uses your location to adjust outdoor watering with the forecast.
            </Text>
          </View>
          {loading ? <ActivityIndicator color={accent.verdant} /> : <Ionicons name="chevron-forward" size={16} color={dark.inkMuted} />}
        </View>
      </Card>
    );
  }

  if (!weather && status === 'denied') {
    return (
      <Card style={{ marginTop: 10 }} onPress={enable}>
        <Text style={[type.caption, { color: dark.inkMuted, lineHeight: 18 }]}>
          Location is off, so local weather is unavailable. Enable location access to tune outdoor
          watering to the forecast. Tap to try again.
        </Text>
      </Card>
    );
  }

  if (!weather) {
    return (
      <Card style={{ marginTop: 10 }} onPress={refresh}>
        <Text style={[type.caption, { color: dark.inkMuted }]}>
          {loading ? 'Loading weather…' : 'Weather unavailable right now. Tap to retry.'}
        </Text>
      </Card>
    );
  }

  const c = weather.current;
  const today = weather.daily[0];
  const ageMin = Math.round((Date.now() - weather.fetchedAt) / 60000);

  const Stat = ({ icon, label, value }: { icon: any; label: string; value: string }) => (
    <View style={{ width: '25%', paddingVertical: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name={icon} size={12} color={dark.inkMuted} />
        <Text style={[type.micro, { color: dark.inkMuted }]}>{label}</Text>
      </View>
      <Text style={[type.num as any, { color: dark.ink, fontSize: 14, marginTop: 2 }]}>{value}</Text>
    </View>
  );

  return (
    <Card style={{ marginTop: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.3, flex: 1 }]}>
          CURRENT WEATHER{place ? ` · ${place.toUpperCase()}` : ''}
        </Text>
        <Pressable onPress={refresh} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          {loading ? (
            <ActivityIndicator color={dark.inkMuted} size="small" />
          ) : (
            <Ionicons name="refresh" size={12} color={dark.inkMuted} />
          )}
          <Text style={[type.micro, { color: dark.inkMuted }]}>{ageMin <= 0 ? 'now' : `${ageMin}m`}</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
        <Text style={{ fontSize: 40 }}>{c.emoji}</Text>
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={[type.numHero as any, { color: dark.ink, fontSize: 30 }]}>{temp(c.tempC)}</Text>
          <Text style={[type.caption, { color: dark.inkMuted }]}>{c.description}</Text>
        </View>
        {today && (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[type.caption, { color: dark.ink }]}>
              H {temp(today.tempMaxC)} · L {temp(today.tempMinC)}
            </Text>
            <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>
              ☔ {today.rainProbPct}% today
            </Text>
          </View>
        )}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, borderTopWidth: 1, borderTopColor: dark.hairline, paddingTop: 6 }}>
        <Stat icon="water-outline" label="Humidity" value={`${Math.round(c.humidityPct)}%`} />
        <Stat icon="sunny-outline" label="UV" value={`${Math.round(c.uvIndex)} ${uvWord(c.uvIndex)}`} />
        <Stat icon="navigate-outline" label="Wind" value={wind(c.windKph)} />
        <Stat icon="rainy-outline" label="Rain" value={`${today?.rainProbPct ?? 0}%`} />
      </View>
      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6 }]}>
        ↑ Sunrise {timeOf(weather.sunrise)} · ↓ Sunset {timeOf(weather.sunset)}
      </Text>
    </Card>
  );
}
