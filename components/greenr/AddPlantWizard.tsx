import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Card, GButton, Screen } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, dark, light, type } from '@/constants/theme';
import { genPlantId } from '@/lib/ids';
import { dliWord } from '@/lib/format';
import { useGreenr } from '@/lib/store';
import { Plant, PotMaterial, PotSize, Spot } from '@/lib/types';

/**
 * O2–O5 (§2.2): camera → identify → name & pot → spot + light audit → first
 * score. Capture steps live light (ritual), the first score lands dark
 * (instrument). Camera and metering are simulated in this build.
 */

const SPECIES = [
  { common: 'Monstera', latin: 'Monstera deliciosa', confidence: 96, emoji: '🌿', band: [30, 55] as [number, number] },
  { common: 'Golden pothos', latin: 'Epipremnum aureum', confidence: 88, emoji: '🍃', band: [25, 50] as [number, number] },
  { common: 'Calathea', latin: 'Goeppertia orbifolia', confidence: 81, emoji: '🪴', band: [35, 60] as [number, number] },
  { common: 'Boston fern', latin: 'Nephrolepis exaltata', confidence: 74, emoji: '🌱', band: [45, 70] as [number, number] },
  { common: 'Snake plant', latin: 'Dracaena trifasciata', confidence: 69, emoji: '🌵', band: [15, 40] as [number, number] },
  { common: 'Cherry tomato', latin: 'Solanum lycopersicum', confidence: 64, emoji: '🍅', band: [40, 65] as [number, number] },
  { common: 'Lavender', latin: 'Lavandula angustifolia', confidence: 58, emoji: '💜', band: [15, 40] as [number, number] },
];

type Step = 'camera' | 'identify' | 'details' | 'spot' | 'audit' | 'score';

export default function AddPlantWizard({ onDone }: { onDone: (plant: Plant) => void }) {
  const { spots, addSpot } = useGreenr();
  const [step, setStep] = useState<Step>('camera');
  const [species, setSpecies] = useState(SPECIES[0]);
  const [name, setName] = useState('');
  const [potSize, setPotSize] = useState<PotSize>('M');
  const [potMaterial, setPotMaterial] = useState<PotMaterial>('Terracotta');
  const [spotId, setSpotId] = useState<string | null>(spots[0]?.id ?? null);
  const [newSpotName, setNewSpotName] = useState('');
  const [newSpotOutdoor, setNewSpotOutdoor] = useState(false);
  const [auditPct, setAuditPct] = useState(0);
  const [auditLux, setAuditLux] = useState(0);
  const [auditResult, setAuditResult] = useState<number | null>(null);
  const auditTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const estScore = 74;
  const estBand = 9;

  useEffect(() => () => {
    if (auditTimer.current) clearInterval(auditTimer.current);
  }, []);

  const startAudit = () => {
    setStep('audit');
    setAuditPct(0);
    setAuditResult(null);
    const startedAt = Date.now();
    const baseLux = newSpotOutdoor ? 42000 : 9500;
    auditTimer.current = setInterval(() => {
      const t = (Date.now() - startedAt) / 10000; // 10-second meter (§2.2 O4b)
      setAuditPct(Math.min(1, t));
      setAuditLux(Math.round(baseLux + Math.sin(t * 12) * baseLux * 0.09 + Math.random() * 400));
      if (t >= 1) {
        if (auditTimer.current) clearInterval(auditTimer.current);
        setAuditResult(newSpotOutdoor ? 18.4 : 4.1);
      }
    }, 120);
  };

  const createSpotFromAudit = () => {
    const spot: Spot = {
      id: `sp-${Date.now().toString(36)}`,
      name: newSpotName.trim(),
      room: newSpotOutdoor ? 'Outdoors' : 'Living room',
      dli: auditResult ?? (newSpotOutdoor ? 18.4 : 4.1),
      tempRange: newSpotOutdoor ? [58, 94] : [68, 75],
      rh: newSpotOutdoor ? 48 : 55,
      measuredBySensor: false,
      outdoor: newSpotOutdoor || undefined,
      seasonalNote: newSpotOutdoor
        ? 'Weather-driven — temp and RH come from the local forecast.'
        : undefined,
    };
    addSpot(spot);
    setSpotId(spot.id);
    setStep('score');
  };

  const finish = () => {
    const plant: Plant = {
      id: genPlantId(),
      name: name.trim() || species.common,
      species: species.common,
      latin: species.latin,
      emoji: species.emoji,
      spotId: spotId ?? spots[0]?.id ?? '',
      potSize,
      potMaterial,
      score: estScore,
      estimate: true,
      estimateBand: estBand,
      sensorId: null,
      components: { hydration: 26, light: 20, climate: 12, consistency: 8, trend: 8 },
      comfortBand: species.band,
      moistureHistory: [{ daysAgo: 0, moisture: Math.round((species.band[0] + species.band[1]) / 2) }],
      scoreTrend14: Array(14).fill(estScore),
      forecast: { warnInDays: 5, criticalInDays: null, confidenceDays: 2, action: 'Check ~Fri' },
      timeline: [{ id: 'tl-new', daysAgo: 0, kind: 'photo', text: 'First photo added' }],
      timeInRangePct: 100,
      addedDaysAgo: 0,
    };
    onDone(plant);
  };

  // ── O2: camera ──
  if (step === 'camera') {
    return (
      <Screen mode="light" scroll={false} style={{ justifyContent: 'center' }}>
        <View
          style={{
            aspectRatio: 3 / 4,
            borderRadius: 24,
            backgroundColor: '#20291F',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {/* leaf-corner frame guide */}
          {([0, 1, 2, 3] as const).map((c) => (
            <View
              key={c}
              style={{
                position: 'absolute',
                width: 28,
                height: 28,
                borderColor: '#FFFFFF88',
                top: c < 2 ? 18 : undefined,
                bottom: c >= 2 ? 18 : undefined,
                left: c % 2 === 0 ? 18 : undefined,
                right: c % 2 === 1 ? 18 : undefined,
                borderTopWidth: c < 2 ? 2 : 0,
                borderBottomWidth: c >= 2 ? 2 : 0,
                borderLeftWidth: c % 2 === 0 ? 2 : 0,
                borderRightWidth: c % 2 === 1 ? 2 : 0,
              }}
            />
          ))}
          <Text style={{ fontSize: 84 }}>{species.emoji}</Text>
          <Text style={[type.caption, { color: '#FFFFFFAA', marginTop: 10 }]}>
            Photograph the whole plant if you can.
          </Text>
        </View>
        <Pressable
          onPress={() => setStep('identify')}
          accessibilityLabel="Shutter"
          style={{
            alignSelf: 'center',
            marginTop: 24,
            width: 68,
            height: 68,
            borderRadius: 34,
            borderWidth: 4,
            borderColor: light.ink,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: light.ink }} />
        </Pressable>
      </Screen>
    );
  }

  // ── O2b: identify ──
  if (step === 'identify') {
    return (
      <Screen mode="light">
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>Which is it?</Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 6 }]}>
          Top matches for your photo.
        </Text>
        {SPECIES.slice(0, 3).map((s) => (
          <Card
            key={s.latin}
            mode="light"
            style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 14 }}
            onPress={() => {
              setSpecies(s);
              setName(s.common);
              setStep('details');
            }}
          >
            <Text style={{ fontSize: 34 }}>{s.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[type.cardTitle, { color: light.ink }]}>{s.common}</Text>
              <Text style={[type.caption, { color: light.inkMuted, fontStyle: 'italic' }]}>{s.latin}</Text>
            </View>
            <Text style={[type.numBold as any, { fontSize: 15, color: accent.verdant }]}>{s.confidence}%</Text>
          </Card>
        ))}
        <Pressable onPress={() => { setSpecies(SPECIES[3]); setName(SPECIES[3].common); setStep('details'); }} style={{ marginTop: 16, minHeight: 44, justifyContent: 'center' }}>
          <Text style={[type.body, { color: accent.verdant }]}>None of these — search all species</Text>
        </Pressable>
      </Screen>
    );
  }

  // ── O3: name & pot ──
  if (step === 'details') {
    return (
      <Screen mode="light">
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>Name &amp; pot</Text>
        <Text style={[type.caption, { color: light.inkMuted, marginTop: 12 }]}>
          {species.common} — rename if you like
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          style={[
            type.cardTitle,
            {
              color: light.ink,
              backgroundColor: light.surface1,
              borderRadius: 14,
              padding: 14,
              marginTop: 8,
            },
          ]}
        />
        <Text style={[type.caption, { color: light.inkMuted, marginTop: 20 }]}>Pot size</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          {(
            [
              ['S', '< 15 cm'],
              ['M', '15–25 cm'],
              ['L', '> 25 cm'],
            ] as [PotSize, string][]
          ).map(([sz, hint]) => (
            <Pressable
              key={sz}
              onPress={() => setPotSize(sz)}
              style={{
                flex: 1,
                minHeight: 64,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: light.surface1,
                borderWidth: 2,
                borderColor: potSize === sz ? accent.verdant : 'transparent',
              }}
            >
              <Text style={{ fontSize: sz === 'S' ? 16 : sz === 'M' ? 22 : 28 }}>🪴</Text>
              <Text style={[type.micro, { color: light.inkMuted, marginTop: 2 }]}>{hint}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[type.caption, { color: light.inkMuted, marginTop: 20 }]}>Pot material</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          {(['Terracotta', 'Plastic', 'Ceramic'] as PotMaterial[]).map((m) => (
            <Pressable
              key={m}
              onPress={() => setPotMaterial(m)}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: light.surface1,
                borderWidth: 2,
                borderColor: potMaterial === m ? accent.verdant : 'transparent',
              }}
            >
              <Text style={[type.caption, { color: light.ink }]}>{m}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 8 }]}>
          Terracotta dries ~2× faster — we account for it.
        </Text>
        <GButton title="Continue" onPress={() => setStep('spot')} style={{ marginTop: 28 }} />
      </Screen>
    );
  }

  // ── O4: give it a spot ──
  if (step === 'spot') {
    return (
      <Screen mode="light">
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>Where does it live?</Text>
        {spots.map((s) => (
          <Card
            key={s.id}
            mode="light"
            style={{
              marginTop: 10,
              flexDirection: 'row',
              alignItems: 'center',
              borderWidth: 2,
              borderColor: spotId === s.id ? accent.verdant : 'transparent',
            }}
            onPress={() => setSpotId(s.id)}
          >
            <View style={{ flex: 1 }}>
              <Text style={[type.cardTitle, { color: light.ink }]}>{s.name}</Text>
              <Text style={[type.caption, { color: light.inkMuted }]}>
                {s.room} · {s.dli.toFixed(1)} DLI — {dliWord(s.dli)}
              </Text>
            </View>
            {spotId === s.id && <Ionicons name="checkmark-circle" size={22} color={accent.verdant} />}
          </Card>
        ))}
        <Card mode="light" style={{ marginTop: 10 }}>
          <TextInput
            value={newSpotName}
            onChangeText={setNewSpotName}
            placeholder={
              spots.length === 0
                ? 'Name its spot (“East windowsill”, “Balcony rail”)'
                : 'Or name a new spot (“East windowsill”)'
            }
            placeholderTextColor={light.inkMuted}
            style={[type.body, { color: light.ink, minHeight: 32 }]}
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            {([false, true] as const).map((out) => (
              <Pressable
                key={String(out)}
                onPress={() => setNewSpotOutdoor(out)}
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: light.bg,
                  borderWidth: 2,
                  borderColor: newSpotOutdoor === out ? accent.verdant : 'transparent',
                }}
              >
                <Text style={[type.caption, { color: light.ink }]}>
                  {out ? 'Outdoor' : 'Indoor'}
                </Text>
              </Pressable>
            ))}
          </View>
          {newSpotOutdoor && (
            <Text style={[type.micro, { color: light.inkMuted, marginTop: 8 }]}>
              Outdoor spots take temperature and humidity from the local forecast.
            </Text>
          )}
          <GButton
            title="Measure this spot"
            kind="secondary"
            mode="light"
            onPress={startAudit}
            disabled={!newSpotName.trim()}
            style={{ marginTop: 10 }}
          />
        </Card>
        <GButton title="Continue" onPress={() => setStep('score')} disabled={!spotId} style={{ marginTop: 24 }} />
      </Screen>
    );
  }

  // ── O4b: light audit ──
  if (step === 'audit') {
    return (
      <Screen mode="light" scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
        {auditResult == null ? (
          <>
            <Text style={[type.ritualTitle, { color: light.ink, textAlign: 'center' }]}>
              Measuring light
            </Text>
            <Text style={[type.body, { color: light.inkMuted, textAlign: 'center', marginTop: 10 }]}>
              Place your phone where the plant sits, screen up, for 10 seconds.
            </Text>
            <View style={{ marginTop: 36 }}>
              <VitalityRing score={auditPct * 100} size={120} showLabel={false} trackColor={light.hairline} />
              <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={[type.numBold as any, { fontSize: 22, color: light.ink }]}>
                  {auditLux.toLocaleString()}
                </Text>
                <Text style={[type.micro, { color: light.inkMuted }]}>lux</Text>
              </View>
            </View>
          </>
        ) : (
          <Card mode="light" style={{ width: '100%' }}>
            <Text style={[type.cardTitle, { color: light.ink }]}>
              {newSpotName.trim() || 'This spot'}: ~{auditResult.toFixed(1)} DLI — {dliWord(auditResult)}.
            </Text>
            <Text style={[type.body, { color: light.inkMuted, marginTop: 6 }]}>
              {newSpotOutdoor
                ? 'Full outdoor sun. Weather drives its temperature and humidity.'
                : 'Good for most tropicals. Temperature and humidity estimates attach from local weather.'}
            </Text>
            <GButton title="Use this spot" onPress={createSpotFromAudit} style={{ marginTop: 16 }} />
          </Card>
        )}
      </Screen>
    );
  }

  // ── O5: first score (dark) ──
  return (
    <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center' }}>
      <VitalityRing score={estScore} size={120} estimate estimateBand={estBand} subLabel="Stable (estimate)">
        <Text style={{ fontSize: 34, position: 'absolute', opacity: 0.18 }}>{species.emoji}</Text>
      </VitalityRing>
      <Text style={[type.screenTitle, { color: dark.ink, marginTop: 16 }]}>
        {name.trim() || species.common}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
        {[
          { label: 'Light ✓', ok: true },
          { label: 'Climate ✓', ok: true },
          { label: 'Hydration ±', ok: false },
        ].map((c) => (
          <View
            key={c.label}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: c.ok ? accent.sage : dark.hairline,
            }}
          >
            <Text style={[type.micro, { color: c.ok ? accent.sage : dark.inkMuted }]}>{c.label}</Text>
          </View>
        ))}
      </View>
      <Text style={[type.caption, { color: dark.inkMuted, textAlign: 'center', marginTop: 18, paddingHorizontal: 20 }]}>
        Estimates tighten as Greenr learns your plant. A Greenr Sensor makes them exact.
      </Text>
      <GButton title="Done" onPress={finish} style={{ marginTop: 26, alignSelf: 'stretch' }} />
    </Screen>
  );
}
