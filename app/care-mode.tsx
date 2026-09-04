import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import PlantAvatar from '@/components/greenr/PlantAvatar';
import { Card, GButton, Screen } from '@/components/greenr/UI';
import { accent, light, type } from '@/constants/theme';
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

  const advance = () => setIndex((i) => i + 1);

  /** The watering task waiting on an amount, if any. */
  const [askAmountFor, setAskAmountFor] = useState<typeof task | null>(null);

  /** Record the stated amount, then carry on through the session. */
  const confirmAmount = (ml: number) => {
    const t = askAmountFor;
    if (!t) return;
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
    setSkipped((n) => n + 1);
    advance();
  };

  // Storage still hydrating — don't flash "nothing needs you" prematurely.
  if (!hydrated) {
    return (
      <Screen mode="light" scroll={false}>
        <View />
      </Screen>
    );
  }

  // end card — session summary (counts only; no invented projections)
  if (finished || session.length === 0) {
    return (
      <Screen mode="light" scroll={false} style={{ justifyContent: 'center' }}>
        <Text style={[type.ritualTitle, { color: light.ink }]}>
          {session.length === 0 ? 'Nothing needs you right now.' : 'Session complete.'}
        </Text>
        {session.length === 0 ? (
          <Text style={[type.body, { color: light.inkMuted, marginTop: 12, lineHeight: 22 }]}>
            Every reading is in range and no waterings are due. Tasks appear here the moment a
            sensor reports a problem or a watering comes due.
          </Text>
        ) : (
          <Card mode="light" style={{ marginTop: 20 }}>
            <Text style={[type.body, { color: light.ink }]}>
              {doneCount} of {session.length} tasks done
            </Text>
            {(loggedWater > 0 || loggedFeed > 0 || skipped > 0) && (
              <Text style={[type.caption, { color: light.inkMuted, marginTop: 6 }]}>
                {[
                  loggedWater > 0 ? `${loggedWater} watering${loggedWater === 1 ? '' : 's'} logged` : null,
                  loggedFeed > 0 ? `${loggedFeed} feeding${loggedFeed === 1 ? '' : 's'} logged` : null,
                  skipped > 0 ? `${skipped} skipped (they'll come back next session)` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            )}
            <Text style={[type.caption, { color: light.inkMuted, marginTop: 8, lineHeight: 18 }]}>
              Sensored plants confirm on their next reading (~3 h); logged waterings and feedings
              sharpen every schedule and show up in each plant&apos;s history.
            </Text>
          </Card>
        )}
        <GButton title="Done" onPress={() => router.back()} style={{ marginTop: 20 }} />
      </Screen>
    );
  }

  const kindIcon: Record<DerivedTask['kind'], string> = {
    water: '💧',
    'water-check': '💧',
    hold: '✋',
    light: '☀️',
    humidity: '💨',
    feed: '🧪',
  };

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
      <Screen mode="light" scroll={false} style={{ justifyContent: 'center' }}>
        <Text style={[type.ritualTitle, { color: light.ink }]}>How much did you pour?</Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 10, lineHeight: 22 }]}>
          Greenr suggested {suggested} ml for {askAmountFor.plantName}. Telling it the real amount —
          even if it was nothing like that — is what makes every future amount for this pot right.
        </Text>
        <View style={{ gap: 10, marginTop: 22 }}>
          {options.map((ml) => (
            <GButton key={ml} title={`${ml} ml`} onPress={() => confirmAmount(ml)} />
          ))}
          <GButton
            title="I didn't measure it"
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
        </View>
      </Screen>
    );
  }

  return (
    <Screen mode="light" scroll={false}>
      {/* progress dots */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 }}>
        {session.map((_, i) => (
          <View
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: i < index ? accent.verdant : i === index ? light.ink : light.hairline,
            }}
          />
        ))}
      </View>
      <Text style={[type.micro, { color: light.inkMuted, textAlign: 'center', marginTop: 8 }]}>
        Task {index + 1} of {session.length}
        {task.minutes > 0 ? ` · ~${task.minutes} min` : ''}
      </Text>
      <Pressable
        onPress={() => router.back()}
        style={{ position: 'absolute', right: 16, top: 54, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name="close" size={24} color={light.inkMuted} />
      </Pressable>

      <View style={{ flex: 1, justifyContent: 'center' }}>
        <View style={{ alignItems: 'center' }}>
          {plant && <PlantAvatar photoUri={plant.photoUri} emoji={plant.emoji} size={84} />}
          <Text style={{ fontSize: 30, marginTop: 8 }}>{kindIcon[task.kind]}</Text>
        </View>
        <Text style={[type.ritualTitle, { color: light.ink, textAlign: 'center', marginTop: 16, fontSize: 24, lineHeight: 32 }]}>
          {task.title}
        </Text>
        <Text style={[type.body, { color: light.inkMuted, textAlign: 'center', marginTop: 12, lineHeight: 22 }]}>
          {task.why}
        </Text>
        {task.sensorVerifies && (
          <Text style={[type.micro, { color: light.inkMuted, textAlign: 'center', marginTop: 14 }]}>
            The sensor confirms this on its next reading.
          </Text>
        )}
      </View>

      <View style={{ gap: 10, paddingBottom: 16 }}>
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
          <Text style={[type.body, { color: light.inkMuted }]}>Skip for now</Text>
        </Pressable>
      </View>
    </Screen>
  );
}
