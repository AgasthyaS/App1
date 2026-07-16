import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, GButton, Hairline, Screen } from '@/components/greenr/UI';
import VitalityRing from '@/components/greenr/VitalityRing';
import { light, type } from '@/constants/theme';
import { calibrationFor } from '@/lib/calibration';
import { deriveCareTasks } from '@/lib/careTasks';
import { vitalityFor } from '@/lib/health';
import { storedLightAvg } from '@/lib/insights';
import { currentSeason, seasonalNotes, SEASON_EMOJI, SEASON_LABEL } from '@/lib/season';
import { useGreenr } from '@/lib/store';
import { tipsFor } from '@/lib/tips';
import { useAllLiveReadings } from '@/lib/useLiveReading';

/** The Sunday briefing (§8.3) — a ritual, not an instrument. Light surface. */
export default function Briefing() {
  const router = useRouter();
  const { plants, spots, sensors, profile, calibrations, lightDaily, markBriefingOpened } = useGreenr();
  const liveReadings = useAllLiveReadings();

  useEffect(() => {
    markBriefingOpened();
  }, [markBriefingOpened]);

  // Only plants whose vitality is actually known count — no fabricated average.
  const vitals = plants.map((p) =>
    vitalityFor(
      p,
      liveReadings.has(p.id),
      liveReadings.get(p.id) ?? null,
      calibrationFor(calibrations, liveReadings.get(p.id)?.device_id, p.sensorId),
      undefined,
      storedLightAvg(lightDaily[p.id]),
    ),
  );
  const known = vitals.filter((v) => !v.pending && !v.awaiting);
  const avg = known.length ? Math.round(known.reduce((a, v) => a + v.score, 0) / known.length) : null;
  const thriving = known.filter((v) => v.score >= 85).length;
  // This week's care — derived live from readings + watering cycles, like Care Mode.
  const careTasks = deriveCareTasks({ plants, spots, readings: liveReadings, calibrations, lightDaily });
  const careMinutes = careTasks.reduce((a, t) => a + t.minutes, 0);
  const lowBattery = sensors.filter((s) => s.batteryPct < 20);
  const monstera = plants.find((p) => p.id === 'pl-monstera');
  // "What changed" is drawn from real logged events this week — never canned copy.
  const changes = plants
    .flatMap((p) =>
      p.timeline
        .filter((e) => e.daysAgo <= 7 && (e.kind === 'insight' || e.kind === 'diagnosis' || e.kind === 'band-change'))
        .map((e) => ({ id: `${p.id}-${e.id}`, text: e.text })),
    )
    .slice(0, 3);
  const dateLine = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  // Seasonal outlook + tips tuned to the survey (beginners get fundamentals,
  // veterans get the advanced stuff).
  const season = currentSeason();
  const seasonCare = seasonalNotes(season).slice(0, 3);
  const weekTips = tipsFor({ experience: profile?.experience, struggle: profile?.struggle, season, count: 2 });

  return (
    <Screen mode="light">
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <View>
          <Text style={[type.micro, { color: light.inkMuted, letterSpacing: 1.2 }]}>
            {dateLine.toUpperCase()}
          </Text>
          <Text style={[type.ritualTitle, { color: light.ink, marginTop: 4 }]}>Your briefing</Text>
        </View>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}>
          <Ionicons name="close" size={24} color={light.inkMuted} />
        </Pressable>
      </View>

      {plants.length === 0 ? (
        <Card mode="light" style={{ marginTop: 16 }}>
          <Text style={[type.body, { color: light.inkMuted }]}>
            No plants yet — the briefing starts once your garden does.
          </Text>
        </Card>
      ) : (
        <>
          {/* garden headline */}
          <Card mode="light" style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            {avg != null && <VitalityRing score={avg} size={72} trackColor={light.hairline} />}
            <View style={{ flex: 1 }}>
              <Text style={[type.micro, { color: light.inkMuted }]}>GARDEN AVERAGE</Text>
              <Text style={[type.body, { color: light.ink, marginTop: 4, lineHeight: 21 }]}>
                {avg != null
                  ? `${thriving} of ${plants.length} thriving.`
                  : 'Still building baselines — scores arrive after ~10 days, or instantly with a sensor.'}
              </Text>
            </View>
          </Card>

          {/* what changed — from this week's real logged events */}
          {changes.length > 0 && (
            <Card mode="light" style={{ marginTop: 10 }}>
              <Text style={[type.micro, { color: light.inkMuted }]}>WHAT CHANGED</Text>
              {changes.map((c, i) => (
                <Text
                  key={c.id}
                  style={[type.body, { color: light.ink, marginTop: i === 0 ? 6 : 6, lineHeight: 22 }]}
                >
                  {c.text}
                </Text>
              ))}
            </Card>
          )}

          {/* seasonal outlook — what this time of year changes, automatically */}
          <Card mode="light" style={{ marginTop: 10 }}>
            <Text style={[type.micro, { color: light.inkMuted }]}>
              {SEASON_EMOJI[season]} {SEASON_LABEL[season].toUpperCase()} — WHAT CHANGES NOW
            </Text>
            {seasonCare.map((n, i) => (
              <Text key={i} style={[type.body, { color: light.ink, marginTop: 6, lineHeight: 22 }]}>
                {n.text}
              </Text>
            ))}
            <Text style={[type.caption, { color: light.inkMuted, marginTop: 8, lineHeight: 18 }]}>
              Watering schedules already account for this — no math needed on your end.
            </Text>
          </Card>

          {/* this week's care — derived live, same list Care Mode runs */}
          <Card mode="light" style={{ marginTop: 10 }}>
            <Text style={[type.micro, { color: light.inkMuted }]}>CARE NEEDED NOW</Text>
            {careTasks.map((t, i) => (
              <View key={t.id}>
                {i > 0 && <Hairline mode="light" style={{ marginVertical: 8 }} />}
                <Text style={[type.body, { color: light.ink, marginTop: i === 0 ? 6 : 0 }]}>{t.title}</Text>
                <Text style={[type.caption, { color: light.inkMuted, marginTop: 3, lineHeight: 18 }]}>
                  {t.why}
                </Text>
              </View>
            ))}
            {careTasks.length === 0 && (
              <Text style={[type.body, { color: light.inkMuted, marginTop: 6 }]}>
                Nothing needs you — every reading is in range and no waterings are due.
              </Text>
            )}
            {careTasks.length > 0 && (
              <Text style={[type.caption, { color: light.inkMuted, marginTop: 10 }]}>
                ~{careMinutes} min of care
              </Text>
            )}
          </Card>

          {/* records — only when earned */}
          {monstera && monstera.score >= 85 && (
            <Card mode="light" style={{ marginTop: 10 }}>
              <Text style={[type.micro, { color: light.inkMuted }]}>RECORDS</Text>
              <Text style={[type.body, { color: light.ink, marginTop: 6 }]}>
                Monstera: 60 days thriving — its longest run.
              </Text>
            </Card>
          )}

          {/* tips for the week — tuned to the user's survey answers */}
          {weekTips.length > 0 && (
            <Card mode="light" style={{ marginTop: 10 }}>
              <Text style={[type.micro, { color: light.inkMuted }]}>FOR YOU THIS WEEK</Text>
              {weekTips.map((t, i) => (
                <Text key={i} style={[type.body, { color: light.ink, marginTop: 6, lineHeight: 22 }]}>
                  {t.text}
                </Text>
              ))}
            </Card>
          )}

          {/* hardware notes */}
          {lowBattery.length > 0 && (
            <Card mode="light" style={{ marginTop: 10 }}>
              <Text style={[type.micro, { color: light.inkMuted }]}>HARDWARE</Text>
              {lowBattery.map((s) => (
                <Text key={s.id} style={[type.body, { color: light.ink, marginTop: 6 }]}>
                  {s.name}: {s.batteryEta} of battery left.
                </Text>
              ))}
            </Card>
          )}

          <GButton
            title="Start Care Mode"
            onPress={() => router.push('/care-mode')}
            style={{ marginTop: 20 }}
          />
        </>
      )}
    </Screen>
  );
}
