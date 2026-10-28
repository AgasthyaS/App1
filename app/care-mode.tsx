import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconTile, NavButton } from '@/components/greenr/Native';
import PlantAvatar from '@/components/greenr/PlantAvatar';
import { GButton } from '@/components/greenr/UI';
import { accent, dark, layout, type } from '@/constants/theme';
import { deriveCareTasks, type DerivedTask } from '@/lib/careTasks';
import { useGreenr } from '@/lib/store';
import { useAllLiveReadings, useAllReadingHistories } from '@/lib/useLiveReading';
import { useWeather } from '@/lib/useWeather';

/**
 * Care Mode: guided session, one task per card, big and unhurried. Tasks are
 * DERIVED LIVE from the same data everything else uses — a plant reading 7%
 * soil shows up here as "Water — add ~250 ml"; a spot that benchmarked too dim
 * shows up as "Move to a brighter spot". Completing a water task logs the
 * watering (which is what teaches the app your rhythm); nothing is staged.
 */

/** What each kind of task looks like: an icon, a colour and a one-word label. */
function kindStyle(kind: DerivedTask['kind']): { icon: string; color: string; label: string } {
  switch (kind) {
    case 'water':
      return { icon: 'water', color: accent.verdant, label: 'Water' };
    case 'water-check':
      return { icon: 'water-outline', color: accent.verdant, label: 'Check & water' };
    case 'hold':
      return { icon: 'hand-left', color: accent.sunbeam, label: 'Hold off' };
    case 'light':
      return { icon: 'sunny', color: accent.sunbeam, label: 'Light' };
    case 'humidity':
      return { icon: 'cloud', color: '#5B8DB8', label: 'Humidity' };
    case 'feed':
      return { icon: 'flask', color: '#8A6FB0', label: 'Feed' };
  }
}

/** Full-screen frame shared by every state of the session. */
function Frame({
  children,
  onClose,
  header,
}: {
  children: React.ReactNode;
  onClose: () => void;
  header?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: dark.bg }}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 560,
          alignSelf: 'center',
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 16,
          paddingHorizontal: layout.margin,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
          <View style={{ width: 38 }} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[type.cardTitle, { color: dark.ink }]}>Care Mode</Text>
          </View>
          <NavButton icon="close" label="Close Care Mode" tint={dark.inkMuted} onPress={onClose} />
        </View>
        {header}
        {children}
      </View>
    </View>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View
      style={{
        flexBasis: '22%',
        flexGrow: 1,
        alignItems: 'center',
        paddingVertical: 14,
        borderRadius: 14,
        backgroundColor: dark.surface1,
        borderWidth: 1,
        borderColor: dark.cardBorder,
      }}
    >
      <Text style={[type.numBold as any, { color, fontSize: 26 }]}>{value}</Text>
      <Text style={[type.caption, { color: dark.inkMuted, marginTop: 2 }]}>{label}</Text>
    </View>
  );
}

export default function CareMode() {
  const router = useRouter();
  const { plants, spots, calibrations, lightDaily, hydrated, logWaterAmount, logCare } = useGreenr();
  const liveReadings = useAllLiveReadings();
  const histories = useAllReadingHistories();
  const weather = useWeather();

  // Derive once storage has hydrated and whenever new sensor data lands, but
  // NOT when plants change — completing a task must not reshuffle the session.
  const session: DerivedTask[] = useMemo(
    () =>
      hydrated
        ? deriveCareTasks({
            plants,
            spots,
            readings: liveReadings,
            histories,
            calibrations,
            lightDaily,
            weather: weather.weather,
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, liveReadings.size, histories.size],
  );

  const [index, setIndex] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [loggedWater, setLoggedWater] = useState(0);
  const [loggedFeed, setLoggedFeed] = useState(0);
  const [skipped, setSkipped] = useState(0);

  const task = session[index];
  const plant = plants.find((p) => p.id === task?.plantId);
  const finished = index >= session.length;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const advance = () => setIndex((i) => i + 1);

  /** The watering task waiting on an amount, if any. */
  const [askAmountFor, setAskAmountFor] = useState<typeof task | null>(null);

  /** Record the stated amount, then carry on through the session. */
  const confirmAmount = (ml: number) => {
    const t = askAmountFor;
    if (!t) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    logWaterAmount(t.plantId, ml, { suggestedMl: t.ml, source: 'preset' });
    setLoggedWater((n) => n + 1);
    setDoneCount((n) => n + 1);
    setAskAmountFor(null);
    advance();
  };

  const complete = () => {
    if (!task) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (task.kind === 'water' || task.kind === 'water-check') {
      /*
       * Ask, rather than assume. Completing the task used to log the SUGGESTED
       * amount as though it had been poured, which is the one kind of log that
       * can never calibrate anything — the app would be grading its own
       * suggestion against itself. Opening the amount picker costs one tap and
       * turns the most common watering path in the app from a dead end into the
       * main source of measurements.
       */
      setAskAmountFor(task);
      return;
    } else if (task.kind === 'light') {
      logCare(task.plantId, 'Moved to a brighter spot (from Care Mode).');
    } else if (task.kind === 'humidity') {
      logCare(task.plantId, 'Raised humidity nearby (from Care Mode).');
    } else if (task.kind === 'feed') {
      logCare(task.plantId, 'Fertilized (from Care Mode).');
      setLoggedFeed((n) => n + 1);
    }
    setDoneCount((n) => n + 1);
    advance();
  };

  const skip = () => {
    Haptics.selectionAsync().catch(() => {});
    setSkipped((n) => n + 1);
    advance();
  };

  // Storage still hydrating — don't flash "nothing needs you" prematurely.
  if (!hydrated) {
    return <View style={{ flex: 1, backgroundColor: dark.bg }} />;
  }

  // end card — session summary (counts only; no invented projections)
  if (finished || session.length === 0) {
    const empty = session.length === 0;
    return (
      <Frame onClose={close}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <View
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: `${accent.verdant}22`,
            }}
          >
            <Ionicons name={empty ? 'leaf' : 'checkmark-circle'} size={56} color={accent.verdant} />
          </View>
          <Text style={[type.ritualTitle, { color: dark.ink, marginTop: 20, textAlign: 'center' }]}>
            {empty ? 'Nothing needs you right now' : 'Session complete'}
          </Text>
          <Text style={[type.body, { color: dark.inkMuted, marginTop: 10, textAlign: 'center', maxWidth: 400 }]}>
            {empty
              ? 'Every reading is in range and no waterings are due. Tasks appear here the moment a sensor reports a problem or a watering comes due.'
              : `${doneCount} of ${session.length} task${session.length === 1 ? '' : 's'} done. Sensored plants confirm on their next reading (about 3 hours), and every log sharpens each plant’s schedule.`}
          </Text>
          {!empty && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 24, alignSelf: 'stretch' }}>
              <Stat value={doneCount} label="Done" color={accent.verdant} />
              <Stat value={loggedWater} label="Watered" color={dark.ink} />
              <Stat value={loggedFeed} label="Fed" color={dark.ink} />
              <Stat value={skipped} label="Skipped" color={skipped > 0 ? accent.sunbeam : dark.inkMuted} />
            </View>
          )}
          {!empty && skipped > 0 && (
            <Text style={[type.caption, { color: dark.inkMuted, marginTop: 10, textAlign: 'center' }]}>
              Skipped tasks come back next session.
            </Text>
          )}
        </View>
        <GButton title="Done" onPress={close} />
      </Frame>
    );
  }

  const progress = (
    <View style={{ marginTop: 10 }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {session.map((_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: i < index ? accent.verdant : i === index ? `${accent.verdant}88` : dark.hairline,
            }}
          />
        ))}
      </View>
      <Text style={[type.caption, { color: dark.inkMuted, textAlign: 'center', marginTop: 8 }]}>
        Task {index + 1} of {session.length}
        {task && task.minutes > 0 ? ` · about ${task.minutes} min` : ''}
      </Text>
    </View>
  );

  /* The amount question. It blocks the session on purpose: this is the moment
     the information exists, and a "skip" that silently logs the suggestion is
     how the calibration got poisoned in the first place. Not knowing is a valid
     answer — it just records the watering without an amount. */
  if (askAmountFor) {
    const suggested = askAmountFor.ml ?? 250;
    const options = [
      Math.max(25, Math.round((suggested * 0.5) / 25) * 25),
      suggested,
      Math.round((suggested * 2) / 25) * 25,
    ].filter((v, i, a) => a.indexOf(v) === i);
    return (
      <Frame onClose={close} header={progress}>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ alignItems: 'center' }}>
            <IconTile icon="water" color={accent.verdant} size={56} />
          </View>
          <Text style={[type.ritualTitle, { color: dark.ink, marginTop: 18, textAlign: 'center' }]}>
            How much did you pour?
          </Text>
          <Text style={[type.body, { color: dark.inkMuted, marginTop: 10, textAlign: 'center' }]}>
            Greenr suggested {suggested} ml for {askAmountFor.plantName}. Telling it the real amount — even if it was
            nothing like that — is what makes every future amount for this pot right.
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 24 }}>
            {options.map((ml) => {
              const isSuggested = ml === suggested;
              return (
                <Pressable
                  key={ml}
                  onPress={() => confirmAmount(ml)}
                  accessibilityRole="button"
                  accessibilityLabel={`${ml} millilitres`}
                  style={({ pressed }) => ({
                    flex: 1,
                    alignItems: 'center',
                    paddingVertical: 18,
                    borderRadius: 16,
                    borderWidth: isSuggested ? 2 : 1,
                    borderColor: isSuggested ? accent.verdant : dark.cardBorder,
                    backgroundColor: pressed ? dark.surface2 : dark.surface1,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  })}
                >
                  <Text style={[type.numBold as any, { color: dark.ink, fontSize: 22 }]}>{ml}</Text>
                  <Text style={[type.caption, { color: dark.inkMuted }]}>ml</Text>
                  {isSuggested && (
                    <Text style={[type.micro, { color: accent.verdant, marginTop: 4 }]}>Suggested</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
        <GButton
          title="I didn’t measure it"
          kind="secondary"
          onPress={() => {
            const t = askAmountFor;
            // Records THAT it was watered, with no amount — honest, and it
            // still mutes the "needs water" prompt until the sensor confirms.
            logWaterAmount(t.plantId, null, { suggestedMl: t.ml, source: 'assumed' });
            setLoggedWater((n) => n + 1);
            setDoneCount((n) => n + 1);
            setAskAmountFor(null);
            advance();
          }}
        />
      </Frame>
    );
  }

  const k = kindStyle(task.kind);

  return (
    <Frame onClose={close} header={progress}>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <View
          style={{
            alignItems: 'center',
            paddingHorizontal: 20,
            paddingTop: 28,
            paddingBottom: 24,
            borderRadius: 24,
            backgroundColor: dark.surface1,
            borderWidth: 1,
            borderColor: dark.cardBorder,
          }}
        >
          {/* the plant, with the task's icon pinned to it */}
          <View>
            {plant ? (
              <PlantAvatar photoUri={plant.photoUri} emoji={plant.emoji} size={104} framed />
            ) : (
              <View style={{ width: 104, height: 104 }} />
            )}
            <View
              style={{
                position: 'absolute',
                right: -4,
                bottom: -4,
                borderRadius: 12,
                borderWidth: 3,
                borderColor: dark.surface1,
              }}
            >
              <IconTile icon={k.icon} color={k.color} size={36} />
            </View>
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              marginTop: 18,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: `${k.color}22`,
            }}
          >
            <Text style={[type.micro, { color: k.color, fontWeight: '600' }]}>
              {k.label.toUpperCase()}
              {plant ? ` · ${plant.name.toUpperCase()}` : ''}
            </Text>
          </View>

          <Text style={[type.ritualTitle, { color: dark.ink, textAlign: 'center', marginTop: 12, fontSize: 26, lineHeight: 32 }]}>
            {task.title}
          </Text>
          <Text style={[type.body, { color: dark.inkMuted, textAlign: 'center', marginTop: 10 }]}>{task.why}</Text>

          {task.sensorVerifies && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 }}>
              <Ionicons name="hardware-chip-outline" size={14} color={accent.sage} />
              <Text style={[type.caption, { color: dark.inkMuted }]}>The sensor confirms this on its next reading</Text>
            </View>
          )}
        </View>
      </View>

      <View style={{ gap: 6, marginTop: 16 }}>
        <GButton
          title={
            task.kind === 'water' || task.kind === 'water-check'
              ? task.ml != null
                ? `Done — log ~${task.ml} ml`
                : 'Done — log watering'
              : task.kind === 'feed'
                ? 'Done — log feeding'
                : task.kind === 'hold'
                  ? 'Got it'
                  : 'Done'
          }
          onPress={complete}
        />
        <Pressable onPress={skip} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[type.body, { color: accent.verdant }]}>Skip for now</Text>
        </Pressable>
      </View>
    </Frame>
  );
}
