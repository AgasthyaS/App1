import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import CameraCapture from '@/components/greenr/CameraCapture';
import PlantAvatar from '@/components/greenr/PlantAvatar';
import { LineChart } from '@/components/greenr/LineChart';
import { Card, GButton, Hairline, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, layout, type } from '@/constants/theme';
import { growthHeadline, growthSummary } from '@/lib/growth';
import { useGreenr } from '@/lib/store';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** A stat tile for the growth hero. */
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[type.micro, { color: dark.inkMuted, letterSpacing: 0.3 }]}>{label}</Text>
      <Text style={[type.numBold as any, { color: dark.ink, fontSize: 20, marginTop: 2 }]}>{value}</Text>
      {sub ? <Text style={[type.micro, { color: dark.inkMuted, marginTop: 1 }]}>{sub}</Text> : null}
    </View>
  );
}

export default function GrowthJournal() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { plants, logGrowth } = useGreenr();
  const plant = plants.find((p) => p.id === id);

  const [capturing, setCapturing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | undefined>(undefined);
  const [height, setHeight] = useState('');
  const [leaves, setLeaves] = useState('');
  const [note, setNote] = useState('');

  const summary = useMemo(() => (plant ? growthSummary(plant) : null), [plant]);

  if (!plant || !summary) {
    return (
      <View style={{ flex: 1, backgroundColor: dark.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.body, { color: dark.inkMuted }]}>Plant not found.</Text>
      </View>
    );
  }

  if (capturing) {
    return (
      <CameraCapture
        caption={`A progress photo for ${plant.name}.`}
        onCapture={(uri) => {
          setPhotoUri(uri);
          setCapturing(false);
        }}
        onCancel={() => setCapturing(false)}
      />
    );
  }

  const resetForm = () => {
    setPhotoUri(undefined);
    setHeight('');
    setLeaves('');
    setNote('');
    setFormOpen(false);
  };

  const canSave = !!photoUri || height.trim() !== '' || leaves.trim() !== '' || note.trim() !== '';
  const save = () => {
    const h = parseFloat(height.replace(',', '.'));
    const l = parseInt(leaves, 10);
    logGrowth(plant.id, {
      photoUri,
      heightCm: Number.isFinite(h) ? Math.round(h * 10) / 10 : null,
      leaves: Number.isFinite(l) ? l : null,
      note: note.trim() || undefined,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    resetForm();
  };

  const first = summary.photos[0];
  const latest = summary.photos[summary.photos.length - 1];
  const headline = growthHeadline(summary);
  const unitsLabel = summary.heightPerMonth != null ? 'cm' : '';

  return (
    <View style={{ flex: 1, backgroundColor: dark.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 120, paddingHorizontal: layout.margin }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Pressable onPress={() => router.back()} style={{ minHeight: 40, minWidth: 40, justifyContent: 'center' }}>
            <Ionicons name="chevron-back" size={24} color={dark.ink} />
          </Pressable>
          <Text style={[type.screenTitle, { color: dark.ink, flex: 1 }]} numberOfLines={1}>
            {plant.name} · Growth
          </Text>
        </View>

        {/* ── Hero: headline + stats ── */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <PlantAvatar photoUri={plant.photoUri} emoji={plant.emoji} size={54} />
            <View style={{ flex: 1 }}>
              <Text style={[type.cardTitle, { color: dark.ink }]}>Growth journal</Text>
              <Text style={[type.micro, { color: headline ? accent.sage : dark.inkMuted, marginTop: 2, lineHeight: 16 }]}>
                {headline ?? 'Log a photo or a measurement to start tracking how it grows.'}
              </Text>
            </View>
          </View>
          {(summary.heightDeltaCm != null || summary.latestLeaves != null || summary.daysTracked != null) && (
            <>
              <Hairline style={{ marginVertical: 12 }} />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {summary.latestHeight != null && (
                  <Stat
                    label="HEIGHT"
                    value={`${summary.latestHeight} cm`}
                    sub={summary.heightDeltaCm != null && summary.heightDeltaCm !== 0 ? `${summary.heightDeltaCm > 0 ? '+' : ''}${summary.heightDeltaCm} cm total` : undefined}
                  />
                )}
                {summary.latestLeaves != null && (
                  <Stat
                    label="LEAVES"
                    value={`${summary.latestLeaves}`}
                    sub={summary.leavesDelta != null && summary.leavesDelta !== 0 ? `${summary.leavesDelta > 0 ? '+' : ''}${summary.leavesDelta}` : undefined}
                  />
                )}
                {summary.daysTracked != null && <Stat label="TRACKED" value={`${summary.daysTracked} d`} sub={`${summary.entries.length} entries`} />}
              </View>
            </>
          )}
        </Card>

        {/* ── Then vs now ── */}
        {first && latest && first.id !== latest.id && (
          <>
            <SectionHeader>Then &amp; now</SectionHeader>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {[first, latest].map((e, i) => (
                <View key={e.id} style={{ flex: 1 }}>
                  <Image source={{ uri: e.photoUri }} style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: 14, backgroundColor: dark.surface2 }} contentFit="cover" />
                  <Text style={[type.micro, { color: dark.inkMuted, marginTop: 6 }]}>
                    {i === 0 ? 'First' : 'Latest'} · {fmtDate(e.at)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── Height / leaves charts ── */}
        {summary.heightSeries.length >= 2 && (
          <>
            <SectionHeader>Height over time</SectionHeader>
            <Card>
              <LineChart data={summary.heightSeries} color={accent.verdant} unit="cm" />
              {summary.heightPerMonth != null && (
                <Text style={[type.micro, { color: dark.inkMuted, marginTop: 8, lineHeight: 15 }]}>
                  Trend: {summary.heightPerMonth > 0 ? '+' : ''}{summary.heightPerMonth} {unitsLabel}/month (least-squares fit over {summary.heightSeries.length} measurements).
                </Text>
              )}
            </Card>
          </>
        )}
        {summary.leavesSeries.length >= 2 && (
          <>
            <SectionHeader>Leaf count</SectionHeader>
            <Card>
              <LineChart data={summary.leavesSeries} color={accent.sunbeam} unit="" />
            </Card>
          </>
        )}

        {/* ── All photos ── */}
        {summary.photos.length > 0 && (
          <>
            <SectionHeader>Progress photos</SectionHeader>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {summary.photos
                  .slice()
                  .reverse()
                  .map((e) => (
                    <View key={e.id}>
                      <Image source={{ uri: e.photoUri }} style={{ width: 120, height: 160, borderRadius: 12, backgroundColor: dark.surface2 }} contentFit="cover" />
                      <Text style={[type.micro, { color: dark.inkMuted, marginTop: 5 }]}>{fmtDate(e.at)}</Text>
                      {(e.heightCm != null || e.leaves != null) && (
                        <Text style={[type.micro, { color: dark.inkMuted }]}>
                          {[e.heightCm != null ? `${e.heightCm} cm` : null, e.leaves != null ? `${e.leaves} lvs` : null].filter(Boolean).join(' · ')}
                        </Text>
                      )}
                    </View>
                  ))}
              </View>
            </ScrollView>
          </>
        )}

        {/* ── Entry log ── */}
        {summary.entries.length > 0 && (
          <>
            <SectionHeader>Journal</SectionHeader>
            <Card>
              {summary.entries
                .slice()
                .reverse()
                .map((e, i) => (
                  <View key={e.id}>
                    {i > 0 && <Hairline style={{ marginVertical: 10 }} />}
                    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                      <Ionicons name={e.photoUri ? 'camera-outline' : 'analytics-outline'} size={16} color={dark.inkMuted} style={{ marginTop: 2 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={[type.caption, { color: dark.ink }]}>
                          {[e.heightCm != null ? `${e.heightCm} cm tall` : null, e.leaves != null ? `${e.leaves} leaves` : null, e.photoUri ? 'photo' : null]
                            .filter(Boolean)
                            .join(' · ') || 'Note'}
                        </Text>
                        {e.note ? <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2, lineHeight: 15 }]}>{e.note}</Text> : null}
                        <Text style={[type.micro, { color: dark.inkMuted, marginTop: 2 }]}>{fmtDate(e.at)}</Text>
                      </View>
                    </View>
                  </View>
                ))}
            </Card>
          </>
        )}

        {summary.entries.length === 0 && (
          <Card style={{ marginTop: 10 }}>
            <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
              Nothing logged yet. Snap a photo and jot the height every couple of weeks — Greenr turns it
              into a growth chart and a then-and-now you can actually see.
            </Text>
          </Card>
        )}
      </ScrollView>

      {/* ── Log form sheet ── */}
      {formOpen && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0 }}>
          <Pressable onPress={() => setFormOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} />
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: dark.surface1, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: layout.margin, paddingBottom: insets.bottom + 20, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[type.cardTitle, { color: dark.ink, flex: 1 }]}>Log growth</Text>
              <Pressable onPress={() => setFormOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={dark.inkMuted} />
              </Pressable>
            </View>

            <Pressable
              onPress={() => setCapturing(true)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: dark.hairline }}
            >
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={{ width: 48, height: 48, borderRadius: 8 }} contentFit="cover" />
              ) : (
                <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: dark.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="camera" size={22} color={accent.verdant} />
                </View>
              )}
              <Text style={[type.body, { color: dark.ink, flex: 1 }]}>{photoUri ? 'Photo added — tap to retake' : 'Add a progress photo'}</Text>
              <Ionicons name="chevron-forward" size={16} color={dark.inkMuted} />
            </Pressable>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={[type.micro, { color: dark.inkMuted, marginBottom: 4 }]}>HEIGHT (CM)</Text>
                <TextInput
                  value={height}
                  onChangeText={setHeight}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 32"
                  placeholderTextColor={dark.inkMuted}
                  style={{ color: dark.ink, backgroundColor: dark.surface2, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, fontSize: 15 }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[type.micro, { color: dark.inkMuted, marginBottom: 4 }]}>LEAVES</Text>
                <TextInput
                  value={leaves}
                  onChangeText={setLeaves}
                  keyboardType="number-pad"
                  placeholder="e.g. 12"
                  placeholderTextColor={dark.inkMuted}
                  style={{ color: dark.ink, backgroundColor: dark.surface2, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, fontSize: 15 }}
                />
              </View>
            </View>
            <View>
              <Text style={[type.micro, { color: dark.inkMuted, marginBottom: 4 }]}>NOTE (OPTIONAL)</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="New leaf unfurling, repotted, etc."
                placeholderTextColor={dark.inkMuted}
                style={{ color: dark.ink, backgroundColor: dark.surface2, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, fontSize: 15 }}
              />
            </View>
            <GButton title="Save entry" onPress={save} style={{ opacity: canSave ? 1 : 0.5 }} disabled={!canSave} />
          </View>
        </View>
      )}

      {/* ── Log FAB ── */}
      {!formOpen && (
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            setFormOpen(true);
          }}
          style={{
            position: 'absolute',
            right: 18,
            bottom: insets.bottom + 18,
            height: 56,
            borderRadius: 28,
            paddingHorizontal: 20,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: accent.verdant,
            shadowColor: '#000',
            shadowOpacity: 0.35,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 8,
          }}
        >
          <Ionicons name="add" size={24} color="#08110B" />
          <Text style={[type.cardTitle, { color: '#08110B', fontSize: 15 }]}>Log growth</Text>
        </Pressable>
      )}
    </View>
  );
}
