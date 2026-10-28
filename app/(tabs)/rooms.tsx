import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AvatarButton, LargeTitle, NavButton, TAB_BAR_CLEARANCE } from '@/components/greenr/Native';
import PlantAvatar from '@/components/greenr/PlantAvatar';
import { Card, GButton, SectionHeader } from '@/components/greenr/UI';
import WeatherCard from '@/components/greenr/WeatherCard';
import { accent, dark, layout, type } from '@/constants/theme';
import { applyCalibration, calibrationFor } from '@/lib/calibration';
import { dliWord } from '@/lib/format';
import { activePlants, useGreenr } from '@/lib/store';
import { refreshReadings, useAllLiveReadings, useReadingsRefreshing } from '@/lib/useLiveReading';
import { useWeather } from '@/lib/useWeather';
import { cToF } from '@/lib/weather';

/**
 * Rooms — where your plants live. Each spot shows how bright it is in words,
 * its live climate when a sensor sits there, and who lives in it. Numbers are
 * only shown when something measured them; otherwise the spot says so.
 */

/** One icon per light level: low · medium · bright indirect · direct sun. */
function lightIcon(dli: number): string {
  if (dli >= 6) return 'sunny';
  if (dli >= 3) return 'partly-sunny';
  if (dli >= 1.5) return 'cloudy';
  return 'moon';
}

/** A warm wash whose strength follows how much light the spot gets. */
function sunWash(dli: number): string {
  const a = Math.min(0.13, Math.max(0.02, dli / 50));
  return `rgba(227, 170, 48, ${a.toFixed(2)})`;
}

export default function RoomsTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { plants: allPlants, spots, settings, calibrations, profile } = useGreenr();
  const plants = useMemo(() => activePlants(allPlants), [allPlants]);
  const liveReadings = useAllLiveReadings();
  const refreshing = useReadingsRefreshing();
  const weather = useWeather();

  const byRoom = useMemo(() => {
    const rooms = new Map<string, typeof spots>();
    for (const s of spots) rooms.set(s.room, [...(rooms.get(s.room) ?? []), s]);
    return [...rooms.entries()];
  }, [spots]);
  const occupants = (spotId: string) => plants.filter((p) => p.spotId === spotId);
  const bestFree = spots.filter((s) => occupants(s.id).length === 0).sort((a, b) => b.dli - a.dli)[0];
  const hasOutdoor = plants.some((p) => spots.find((s) => s.id === p.spotId)?.outdoor);

  // Live climate per spot: if a sensored plant sits there, its reading IS the
  // spot's real temperature and humidity.
  const liveForSpot = (spotId: string) => {
    const occ = plants.find((p) => p.spotId === spotId && liveReadings.get(p.id) != null);
    if (!occ) return null;
    return applyCalibration(
      liveReadings.get(occ.id)!,
      calibrationFor(calibrations, liveReadings.get(occ.id)?.device_id, occ.sensorId),
    );
  };
  const temp = (c: number) => (settings.unitsF ? `${Math.round(cToF(c))}°` : `${Math.round(c)}°`);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: dark.bg }}
      contentContainerStyle={{
        paddingHorizontal: layout.margin,
        paddingTop: insets.top + 8,
        paddingBottom: TAB_BAR_CLEARANCE + insets.bottom,
        width: '100%',
        maxWidth: 720,
        alignSelf: 'center',
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void refreshReadings();
            weather.refresh();
          }}
          tintColor={accent.verdant}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <LargeTitle
        overline={`${spots.length} spot${spots.length === 1 ? '' : 's'} · ${byRoom.length} room${byRoom.length === 1 ? '' : 's'}`}
        title="Rooms"
        right={
          <>
            <NavButton icon="add" label="Add" onPress={() => router.push('/add-sheet')} />
            <AvatarButton name={profile?.name ?? 'Gardener'} onPress={() => router.push('/you' as any)} />
          </>
        }
      />

      {/* current weather — only when something lives outdoors */}
      {hasOutdoor && <WeatherCard w={weather} unitsF={settings.unitsF} />}

      {byRoom.map(([room, roomSpots]) => (
        <View key={room}>
          <SectionHeader>{room}</SectionHeader>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {roomSpots.map((s) => {
              const occ = occupants(s.id);
              const live = liveForSpot(s.id);
              return (
                <Pressable
                  key={s.id}
                  onPress={() => router.push({ pathname: '/spot/[id]', params: { id: s.id } })}
                  style={({ pressed }) => ({
                    flexBasis: '47%',
                    flexGrow: 1,
                    borderRadius: 18,
                    overflow: 'hidden',
                    backgroundColor: dark.surface1,
                    borderWidth: 1,
                    borderColor: dark.cardBorder,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  })}
                >
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: sunWash(s.dli) }} />
                  <View style={{ padding: 14 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name={lightIcon(s.dli) as any} size={16} color={accent.sunbeam} />
                      <Text style={[type.caption, { color: dark.ink, fontWeight: '600', flex: 1 }]} numberOfLines={1}>
                        {dliWord(s.dli).charAt(0).toUpperCase() + dliWord(s.dli).slice(1)}
                      </Text>
                    </View>
                    {s.measuredBySensor && (
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]} numberOfLines={1}>
                        {s.dli.toFixed(1)} DLI · measured
                      </Text>
                    )}
                    <Text style={[type.cardTitle, { color: dark.ink, marginTop: 10 }]} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                      {live || s.measuredBySensor ? (
                        <>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                            <Ionicons name="thermometer-outline" size={13} color={dark.inkMuted} />
                            <Text style={[type.caption, { color: dark.inkMuted }]}>
                              {live
                                ? live.temp_c != null
                                  ? temp(live.temp_c)
                                  : '—'
                                : `${s.tempRange[0]}–${s.tempRange[1]}°`}
                            </Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                            <Ionicons name="water-outline" size={13} color={dark.inkMuted} />
                            <Text style={[type.caption, { color: dark.inkMuted }]}>
                              {live
                                ? live.humidity_pct != null
                                  ? `${Math.round(live.humidity_pct)}%`
                                  : '—'
                                : `${s.rh}%`}
                            </Text>
                          </View>
                          {live && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent.sage }} />}
                        </>
                      ) : (
                        <Text style={[type.caption, { color: dark.inkMuted }]}>Not measured yet</Text>
                      )}
                    </View>
                    <Text
                      style={[type.caption, { color: dark.inkMuted, marginTop: 8, fontStyle: s.note ? 'normal' : 'italic', opacity: s.note ? 1 : 0.75 }]}
                      numberOfLines={2}
                    >
                      {s.note?.trim() || 'Add a note about this spot'}
                    </Text>
                    <View style={{ flexDirection: 'row', marginTop: 10, minHeight: 30, alignItems: 'center' }}>
                      {occ.length > 0 ? (
                        occ.slice(0, 5).map((p, i) => (
                          <View
                            key={p.id}
                            style={{
                              marginLeft: i === 0 ? 0 : -8,
                              borderRadius: 16,
                              borderWidth: 2,
                              borderColor: dark.surface1,
                              backgroundColor: dark.surface1,
                            }}
                          >
                            <PlantAvatar photoUri={p.photoUri} emoji={p.emoji} size={28} framed />
                          </View>
                        ))
                      ) : bestFree?.id === s.id ? (
                        <View
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 999,
                            backgroundColor: `${accent.verdant}26`,
                          }}
                        >
                          <Text style={[type.micro, { color: accent.verdant }]}>Best free spot</Text>
                        </View>
                      ) : (
                        <Text style={[type.caption, { color: dark.inkMuted }]}>Empty</Text>
                      )}
                      {occ.length > 5 && (
                        <Text style={[type.caption, { color: dark.inkMuted, marginLeft: 6 }]}>+{occ.length - 5}</Text>
                      )}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      {spots.length > 0 && (
        <Text style={[type.caption, { color: dark.inkMuted, marginTop: 14, lineHeight: 18, marginHorizontal: 4 }]}>
          Temperatures and humidity appear once a sensor has been in the spot.
        </Text>
      )}

      {spots.length === 0 && (
        <Card style={{ alignItems: 'center', paddingVertical: 40, marginTop: 16 }}>
          <Ionicons name="home" size={40} color={accent.verdant} />
          <Text style={[type.cardTitle, { color: dark.ink, marginTop: 12 }]}>No rooms yet</Text>
          <Text style={[type.body, { color: dark.inkMuted, marginTop: 4, textAlign: 'center' }]}>
            Rooms appear as you add plants and tell Greenr where they live.
          </Text>
          <GButton title="Add plant" onPress={() => router.push('/add-plant')} style={{ marginTop: 16, alignSelf: 'stretch' }} />
        </Card>
      )}
    </ScrollView>
  );
}
