import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import PlantAvatar from '@/components/greenr/PlantAvatar';
import { Card, GButton, Screen } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { accent, light, type } from '@/constants/theme';
import { shareContent } from '@/lib/platform';
import { gardenAverage, useGreenr } from '@/lib/store';

/**
 * Care Mode (§8.4): guided session, one task per card, big and unhurried.
 * Sensor-equipped tasks verify live; skip is judgment-free.
 */

type Verify = 'idle' | 'waiting' | 'verified';

export default function CareMode() {
  const router = useRouter();
  const { tasks, plants, hydrated, completeTask, skipTask, logWater, resetCareSession } = useGreenr();
  // freeze the task list once state is hydrated so completing tasks doesn't reshuffle the session
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const session = useMemo(() => tasks.filter((t) => !t.done), [hydrated]);
  const [index, setIndex] = useState(0);
  const [verify, setVerify] = useState<Verify>('idle');
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const task = session[index];
  const plant = plants.find((p) => p.id === task?.plantId);
  const finished = index >= session.length;

  const advance = () => {
    setVerify('idle');
    setIndex((i) => i + 1);
  };

  const check = () => {
    if (!task) return;
    if (task.title.toLowerCase().startsWith('water')) logWater(task.plantId);
    if (task.verifiable) {
      setVerify('waiting');
      timer.current = setTimeout(() => {
        setVerify('verified');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setVerifiedCount((n) => n + 1);
        completeTask(task.id, true);
        setDoneCount((n) => n + 1);
        timer.current = setTimeout(advance, 1400);
      }, 1800);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      completeTask(task.id, false);
      setDoneCount((n) => n + 1);
      advance();
    }
  };

  const skip = () => {
    if (!task) return;
    skipTask(task.id);
    advance();
  };

  // end card — session summary
  if (finished || session.length === 0) {
    const projected = Math.min(100, gardenAverage(plants) + 2);
    return (
      <Screen mode="light" scroll={false} style={{ justifyContent: 'center' }}>
        <Text style={[type.ritualTitle, { color: light.ink }]}>
          {session.length === 0 ? 'Nothing needs you.' : 'Session complete.'}
        </Text>
        {session.length > 0 && (
          <Card mode="light" style={{ marginTop: 20 }}>
            <Text style={[type.body, { color: light.ink }]}>
              {doneCount} of {session.length} tasks done · {verifiedCount} verified by sensor
            </Text>
            <Text style={[type.body, { color: light.inkMuted, marginTop: 8 }]}>
              Projected garden score next Sunday:{' '}
              <Text style={[type.numBold as any, { fontSize: 15, color: light.ink }]}>{projected}</Text>
            </Text>
          </Card>
        )}
        <GButton
          title="Share"
          kind="secondary"
          mode="light"
          onPress={() =>
            shareContent({
              title: 'My Greenr week',
              message: `Garden vitality ${gardenAverage(plants)} — ${doneCount} of ${session.length || 0} care tasks done this week, ${verifiedCount} verified by sensor. 🌿 greenr`,
            })
          }
          style={{ marginTop: 20 }}
        />
        <GButton
          title="Done"
          onPress={() => {
            resetCareSession();
            router.back();
          }}
          style={{ marginTop: 10 }}
        />
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
      <Pressable onPress={() => router.back()} style={{ position: 'absolute', right: 16, top: 54, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="close" size={24} color={light.inkMuted} />
      </Pressable>

      <View style={{ flex: 1, justifyContent: 'center' }}>
        <View style={{ alignItems: 'center' }}>
          {plant && (
            <VitalityRing score={plant.score} size={120} estimate={plant.estimate} estimateBand={plant.estimateBand} showLabel={false} trackColor={light.hairline}>
              <PlantAvatar photoUri={plant.photoUri} emoji={plant.emoji} size={84} />
            </VitalityRing>
          )}
        </View>
        <Text style={[type.ritualTitle, { color: light.ink, textAlign: 'center', marginTop: 24, fontSize: 24, lineHeight: 32 }]}>
          {task.title}
        </Text>
        <Text style={[type.body, { color: light.inkMuted, textAlign: 'center', marginTop: 12, lineHeight: 22 }]}>
          {task.why}
        </Text>

        {verify === 'waiting' && (
          <Text style={[type.caption, { color: light.inkMuted, textAlign: 'center', marginTop: 20 }]}>
            Waiting for the sensor…
          </Text>
        )}
        {verify === 'verified' && (
          <Text style={[type.cardTitle, { color: accent.verdant, textAlign: 'center', marginTop: 20 }]}>
            Verified — soil {plant ? `${plant.comfortBand[0] - 8}% → ${Math.round((plant.comfortBand[0] + plant.comfortBand[1]) / 2 + 8)}%` : 'in range'}
          </Text>
        )}
      </View>

      <View style={{ gap: 10, paddingBottom: 16 }}>
        <GButton
          title={verify === 'waiting' ? 'Verifying…' : 'Done'}
          onPress={check}
          disabled={verify !== 'idle'}
        />
        <Pressable onPress={skip} disabled={verify !== 'idle'} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[type.body, { color: light.inkMuted }]}>
            Skip — I&apos;ll re-forecast around it
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}
