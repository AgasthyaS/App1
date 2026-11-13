import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import {
  BootButtonArt,
  HotspotOnArt,
  JoinHotspotArt,
  PortalArt,
  ReportingArt,
} from '@/components/greenr/SetupArt';
import { Card, GButton } from '@/components/greenr/UI';
import { accent, light, type } from '@/constants/theme';
import {
  isWifiSetupSupported,
  startWifiSetup,
  type SetupStatus,
  type WifiSetupSession,
} from '@/lib/wifiSetup';
import { isAlreadyConfigured, isChooserCancelled } from '@/lib/wifiSetupTypes';

/**
 * Sensor Wi-Fi setup.
 *
 * Primary path: the setup hotspot. Until it has Wi-Fi, the sensor broadcasts an
 * open network called "greenr-setup"; joining it pops up a setup page served by
 * the sensor itself (firmware/greenr_sensor, runSetup). This needs no Bluetooth
 * and no app, so it works on every phone and browser — and it is the ONLY path
 * on stock firmware, which ships with USE_BLE_SETUP 0.
 *
 * Secondary path (builds flashed with USE_BLE_SETUP 1, on platforms that can do
 * Bluetooth): the app finds the sensor, lists the networks it can see, and hands
 * it the password directly.
 *
 * Either way, when the caller passes `verify`, success is confirmed from the
 * cloud — the sensor uploads the moment it joins — so the guide moves on by
 * itself instead of asking the person to judge whether it worked.
 */

interface GuideStep {
  Art: () => React.JSX.Element;
  title: string;
  body: string;
  tip?: string;
}

const GUIDE: GuideStep[] = [
  {
    Art: HotspotOnArt,
    title: 'Power on the sensor',
    body: 'Connect its battery, or plug it into a wall USB adapter, and keep it within a few metres of you. Within about 10 seconds it starts its own setup Wi-Fi network called “greenr-setup”.',
    tip: 'On USB power it waits as long as you need. On battery it closes after 20 minutes to save power: press the sensor’s RST button to open it again.',
  },
  {
    Art: JoinHotspotArt,
    title: 'Join “greenr-setup”',
    body: 'Open your phone’s Settings → Wi-Fi and tap “greenr-setup”. It has no password.',
    tip: 'Your phone may warn “No internet connection”. That’s expected — choose Stay connected / Keep Wi-Fi.',
  },
  {
    Art: PortalArt,
    title: 'Choose your home Wi-Fi',
    body: 'A setup page opens by itself. Pick your home network, type its password and tap Connect.',
    tip: 'Page didn’t open? Open your browser and go to 192.168.4.1. Only 2.4 GHz networks show up.',
  },
  {
    Art: ReportingArt,
    title: 'Rejoin your home Wi-Fi',
    body: 'Switch your phone back to your normal Wi-Fi. The sensor saves the network for good and sends its first reading within a minute.',
    tip: 'If “greenr-setup” reappears, the password was wrong — join it again and retry.',
  },
];

const TROUBLE: { q: string; a: string; boot?: boolean }[] = [
  {
    q: 'I don’t see “greenr-setup”',
    a: 'The sensor only offers it while it has no saved Wi-Fi. Press its RST button (or unplug and replug it) and wait 10 seconds. If it was set up before, make it forget the old network: tap RST, then within 2 seconds press and hold BOOT for 3 seconds.',
    boot: true,
  },
  {
    q: 'My phone keeps leaving “greenr-setup”',
    a: 'Phones drop networks without internet. When asked, choose Stay connected (Android) or just stay on the setup page (iPhone). Turning off mobile data for a minute also helps.',
  },
  {
    q: 'The setup page didn’t open',
    a: 'While joined to “greenr-setup”, open any browser and type 192.168.4.1 into the address bar (http, not https).',
  },
  {
    q: 'My home network isn’t in the list',
    a: 'The sensor can only use 2.4 GHz Wi-Fi. Many routers show a separate 2.4 GHz name — pick that one. Moving the sensor closer to the router helps too.',
  },
  {
    q: 'It connected, but no reading arrives',
    a: 'On battery, check it is charged. On USB, use a wall adapter: computer ports sleep and cut power. Then look at Device health in a few minutes.',
  },
];

type Phase = 'guide' | 'intro' | 'searching' | 'form' | 'sending' | 'success' | 'unsure';

/** How long to wait for confirmation before offering a way forward. */
const CONFIRM_TIMEOUT_MS = 45000;

export function WifiSetupFlow({
  onDone,
  doneCta,
  onSkip,
  skipLabel,
  verify,
  onIdentified,
  startWith = 'hotspot',
}: {
  /** 'bluetooth' when the caller needs the sensor's identity read over BLE (no-QR pairing). */
  startWith?: 'hotspot' | 'bluetooth';
  onDone: () => void;
  /** Label of the confirm button at the end of the hotspot guide. */
  doneCta: string;
  onSkip?: () => void;
  skipLabel?: string;
  /**
   * Optional independent success check — resolves true once the sensor has
   * actually reported to the cloud. Far more reliable than the Bluetooth "ok",
   * which is frequently lost when the sensor powers up its Wi-Fi radio.
   */
  verify?: () => Promise<boolean>;
  /**
   * Called with the sensor's id + key the moment they're read over Bluetooth
   * (firmware exposes them on the encrypted link). Lets the caller CLAIM the
   * device with no QR code. Only fires when the firmware provides them.
   */
  onIdentified?: (deviceId: string, deviceKey: string) => void;
}) {
  // The hotspot works with every firmware build and every phone, so it leads.
  const [phase, setPhase] = useState<Phase>(startWith === 'bluetooth' && isWifiSetupSupported ? 'intro' : 'guide');
  const [page, setPage] = useState(0);
  const [trouble, setTrouble] = useState<number | null>(null);
  const [session, setSession] = useState<WifiSetupSession | null>(null);
  const [ssid, setSsid] = useState('');
  const [otherSsid, setOtherSsid] = useState('');
  const [useOther, setUseOther] = useState(false);
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sessionRef = useRef<WifiSetupSession | null>(null);

  // Always drop the BLE link when leaving.
  useEffect(() => () => sessionRef.current?.disconnect(), []);

  // React to the sensor's own status pushes.
  useEffect(() => {
    if (status === 'ok') {
      setPhase('success');
      sessionRef.current?.disconnect();
      const t = setTimeout(onDone, 1200);
      return () => clearTimeout(t);
    }
    if (status === 'fail') {
      setErr('That password didn’t work. Double-check it and try again.');
      setPhase('form');
    }
  }, [status, onDone]);

  /**
   * While waiting, confirm success the reliable way — by asking the cloud
   * whether the sensor has reported — and NEVER wait forever. The Bluetooth
   * "ok" is often lost because bringing up Wi-Fi drops the BLE link, which
   * previously left this screen spinning with no way out.
   */
  useEffect(() => {
    if (phase !== 'sending') return;
    let alive = true;
    const startedAt = Date.now();

    const poll = setInterval(async () => {
      if (!alive) return;
      if (verify) {
        try {
          if (await verify()) {
            if (!alive) return;
            sessionRef.current?.disconnect();
            setPhase('success');
            setTimeout(onDone, 1200);
            return;
          }
        } catch {
          // network hiccup — keep waiting, the timeout below is the backstop
        }
      }
      if (alive && Date.now() - startedAt > CONFIRM_TIMEOUT_MS) setPhase('unsure');
    }, 3000);

    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [phase, verify, onDone]);

  /**
   * On the hotspot path nothing talks back to the app, so watch the cloud: the
   * sensor's first upload is the proof, and the guide finishes by itself.
   */
  useEffect(() => {
    if (phase !== 'guide' || !verify) return;
    let alive = true;
    const poll = setInterval(async () => {
      try {
        if (alive && (await verify())) {
          setPhase('success');
          setTimeout(onDone, 1500);
        }
      } catch {
        // offline for a moment — keep watching
      }
    }, 4000);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [phase, verify, onDone]);

  const search = async () => {
    setErr(null);
    setStatus(null);
    // Always tear down a previous link first — a lingering one makes the browser
    // refuse the next connect with "Connection already in progress".
    try { sessionRef.current?.disconnect(); } catch { /* already gone */ }
    sessionRef.current = null;
    setSession(null);
    setPhase('searching');
    try {
      const s = await startWifiSetup();
      s.onStatus(setStatus);
      sessionRef.current = s;
      setSession(s);
      // If the sensor handed us its identity over Bluetooth, claim it now — no
      // QR needed. (Older firmware doesn't, so this simply doesn't fire.)
      if (s.deviceId && s.deviceKey) onIdentified?.(s.deviceId, s.deviceKey);
      if (s.networks[0]) setSsid(s.networks[0]);
      else setUseOther(true);
      setPhase('form');
    } catch (e) {
      setPhase('intro');
      const msg = e instanceof Error ? e.message : '';
      if (isAlreadyConfigured(e)) {
        // Not a failure — the sensor is up and running on Wi-Fi already.
        setErr(
          'That sensor is already set up and running, so it isn’t offering Wi-Fi setup. Check Device health to see its latest report. To move it to a different network, let it fail to connect a few times (it reopens setup automatically) or hold its setup button if fitted.',
        );
      } else if (/permission/i.test(msg)) {
        // Bluetooth (or, on older phones, location) permission was declined.
        setErr(
          'Greenr needs Bluetooth permission to find your sensor. Enable it in your phone’s Settings → Apps → Greenr → Permissions, then tap “Find my sensor” again.',
        );
      } else if (/bluetooth.*(off|disabled)|powered ?off|turn (it |on)/i.test(msg)) {
        setErr('Turn Bluetooth on in your phone settings, then tap “Find my sensor” again.');
      } else if (isChooserCancelled(e)) {
        // Chrome throws NotFoundError both for "you cancelled" and "nothing
        // matched". Saying nothing here is what made this look broken.
        setErr(
          'No sensor appeared. Bluetooth setup only works on sensors built with it switched on — if yours isn’t listed, use the “greenr-setup” hotspot instead.',
        );
      } else if (/in progress|InvalidState/i.test(msg)) {
        setErr(
          'Bluetooth is busy with an earlier connection. Wait ~10 seconds and try again. If it persists, remove “greenr-…” from your phone’s Bluetooth settings, then retry.',
        );
      } else if (/no sensor found|not found|timeout|timed out/i.test(msg)) {
        setErr(
          'Couldn’t find your sensor over Bluetooth. Most sensors set up through the “greenr-setup” hotspot instead — tap “Use the setup hotspot instead” below.',
        );
      } else {
        setErr(msg || 'Could not reach the sensor. Make sure it has power and is nearby, or use the setup hotspot.');
      }
    }
  };

  const connect = async () => {
    const chosen = useOther ? otherSsid.trim() : ssid;
    if (!session || !chosen) return;
    setErr(null);
    setStatus('connecting');
    setPhase('sending');
    try {
      await session.sendCredentials(chosen, password);
    } catch {
      setErr('Couldn’t send that to the sensor. Move a bit closer and try again.');
      setPhase('form');
    }
  };

  // ── Success ──
  if (phase === 'success') {
    return (
      <View style={{ alignItems: 'center', paddingTop: 20 }}>
        <Ionicons name="checkmark-circle" size={56} color={accent.sage} />
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 14, textAlign: 'center' }]}>
          Sensor is on your Wi-Fi
        </Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 8, textAlign: 'center' }]}>
          It saved the network and is starting to report.
        </Text>
      </View>
    );
  }

  // ── Hotspot guide (primary) ──
  if (phase === 'guide') {
    const step = GUIDE[page];
    const last = page === GUIDE.length - 1;
    return (
      <View>
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>Connect it to your Wi-Fi</Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 4 }]}>
          A one-time step — about two minutes. Works on any phone.
        </Text>

        <View style={{ marginTop: 14 }}>
          <step.Art />
        </View>

        {/* page dots, tappable */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 }}>
          {GUIDE.map((g, i) => (
            <Pressable key={g.title} onPress={() => setPage(i)} hitSlop={8}>
              <View style={{ width: i === page ? 20 : 8, height: 8, borderRadius: 4, backgroundColor: i <= page ? accent.verdant : light.hairline }} />
            </Pressable>
          ))}
        </View>

        <Text style={[type.micro, { color: accent.verdant, marginTop: 12, letterSpacing: 0.5 }]}>
          STEP {page + 1} OF {GUIDE.length}
        </Text>
        <Text style={[type.cardTitle, { color: light.ink, fontSize: 18, marginTop: 2 }]}>{step.title}</Text>
        <Text style={[type.body, { color: light.ink, marginTop: 6, lineHeight: 22 }]}>{step.body}</Text>
        {step.tip && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Ionicons name="bulb-outline" size={16} color={accent.sunbeamText} style={{ marginTop: 2 }} />
            <Text style={[type.caption, { color: light.inkMuted, flex: 1, lineHeight: 18 }]}>{step.tip}</Text>
          </View>
        )}

        {verify && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
            <ActivityIndicator size="small" color={accent.verdant} />
            <Text style={[type.caption, { color: light.inkMuted, flex: 1 }]}>
              Watching for your sensor — this moves on by itself once it reports.
            </Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          {page > 0 && (
            <GButton title="Back" kind="secondary" mode="light" onPress={() => setPage(page - 1)} style={{ flex: 1 }} />
          )}
          <GButton
            title={last ? doneCta : 'Next'}
            track={last ? 'pair.wifi_guide_done' : undefined}
            onPress={() => (last ? onDone() : setPage(page + 1))}
            style={{ flex: 2 }}
          />
        </View>

        {/* troubleshooting */}
        <Text style={[type.sectionHeader, { color: light.inkMuted, marginTop: 24, marginBottom: 6 }]}>Having trouble?</Text>
        <Card mode="light" style={{ paddingVertical: 4 }}>
          {TROUBLE.map((t, i) => {
            const open = trouble === i;
            return (
              <View key={t.q} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: light.hairline }}>
                <Pressable
                  onPress={() => setTrouble(open ? null : i)}
                  style={{ flexDirection: 'row', alignItems: 'center', minHeight: 46, gap: 8 }}
                >
                  <Text style={[type.body, { color: light.ink, flex: 1 }]}>{t.q}</Text>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={light.inkMuted} />
                </Pressable>
                {open && (
                  <View style={{ paddingBottom: 12 }}>
                    <Text style={[type.caption, { color: light.inkMuted, lineHeight: 19 }]}>{t.a}</Text>
                    {t.boot && (
                      <View style={{ marginTop: 10 }}>
                        <BootButtonArt />
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </Card>

        {isWifiSetupSupported && (
          <GButton title="Set up over Bluetooth instead" kind="ghost" mode="light" onPress={() => setPhase('intro')} style={{ marginTop: 10 }} />
        )}
        {onSkip && (
          <GButton title={skipLabel ?? 'Skip for now'} kind="ghost" mode="light" onPress={onSkip} style={{ marginTop: 4 }} />
        )}
      </View>
    );
  }

  // ── Searching ──
  if (phase === 'searching') {
    return (
      <View style={{ alignItems: 'center', paddingTop: 30 }}>
        <ActivityIndicator color={accent.verdant} />
        <Text style={[type.body, { color: light.inkMuted, marginTop: 16, textAlign: 'center' }]}>
          Looking for your sensor…
        </Text>
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 8, textAlign: 'center', lineHeight: 16 }]}>
          Keep it powered and close to your phone. If it doesn’t appear, press its RST button, or unplug it and plug it back
          in.
        </Text>
      </View>
    );
  }

  // ── Sending credentials / connecting ──
  if (phase === 'sending') {
    return (
      <View style={{ alignItems: 'center', paddingTop: 30 }}>
        <ActivityIndicator color={accent.verdant} />
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 16, textAlign: 'center' }]}>
          Connecting your sensor…
        </Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 8, textAlign: 'center' }]}>
          Handing it the Wi-Fi and waiting for it to join, then checking that it reached the
          cloud. This usually takes 10–30 seconds.
        </Text>
        <GButton
          title="Continue anyway"
          kind="ghost"
          mode="light"
          onPress={() => {
            sessionRef.current?.disconnect();
            onDone();
          }}
          style={{ marginTop: 22 }}
        />
      </View>
    );
  }

  // ── Couldn't confirm: never leave the user stuck ──
  if (phase === 'unsure') {
    return (
      <View style={{ paddingTop: 20 }}>
        <View style={{ alignItems: 'center' }}>
          <Ionicons name="help-circle-outline" size={48} color={accent.sunbeamText} />
          <Text style={[type.ritualTitle, { color: light.ink, marginTop: 12, textAlign: 'center' }]}>
            Couldn’t confirm it yet
          </Text>
        </View>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 10, lineHeight: 22 }]}>
          Your sensor may well be connected — the Bluetooth link often drops the moment it powers
          up its Wi-Fi radio, so we lose the confirmation even when setup worked.
        </Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 10, lineHeight: 22 }]}>
          Carry on with setup and check Device health in a few minutes. If it still hasn’t
          reported, run Wi-Fi setup again and double-check the password.
        </Text>
        <GButton
          title="Continue"
          onPress={() => {
            sessionRef.current?.disconnect();
            onDone();
          }}
          style={{ marginTop: 18 }}
        />
        <GButton
          title="Try Wi-Fi setup again"
          kind="secondary"
          // Start over from a clean link — the old one is almost certainly dead
          // (the sensor dropped it when it switched to Wi-Fi), and reusing it is
          // what produces "Connection already in progress".
          onPress={search}
          style={{ marginTop: 10 }}
        />
      </View>
    );
  }

  // ── Form: pick network + password ──
  if (phase === 'form' && session) {
    const chosen = useOther ? otherSsid.trim() : ssid;
    return (
      <View>
        <Text style={[type.micro, { color: accent.sage, marginTop: 8 }]}>CONNECTED TO {session.deviceName.toUpperCase()} ✓</Text>
        <Text style={[type.ritualTitle, { color: light.ink, marginTop: 6 }]}>Pick your Wi-Fi</Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 6 }]}>
          Choose your home network and enter its password — we’ll hand it to the sensor.
        </Text>

        {/* networks the sensor can see */}
        {session.networks.length > 0 && !useOther && (
          <View style={{ marginTop: 14, gap: 8 }}>
            {session.networks.slice(0, 6).map((n) => (
              <Card
                key={n}
                mode="light"
                onPress={() => setSsid(n)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 2, borderColor: ssid === n ? accent.verdant : 'transparent' }}
              >
                <Ionicons name="wifi" size={18} color={accent.verdant} />
                <Text style={[type.body, { color: light.ink, flex: 1 }]} numberOfLines={1}>{n}</Text>
                {ssid === n && <Ionicons name="checkmark-circle" size={18} color={accent.verdant} />}
              </Card>
            ))}
            <Pressable onPress={() => setUseOther(true)} style={{ minHeight: 40, justifyContent: 'center' }}>
              <Text style={[type.caption, { color: accent.verdant }]}>My network isn’t listed →</Text>
            </Pressable>
          </View>
        )}

        {/* manual SSID */}
        {(useOther || session.networks.length === 0) && (
          <View style={{ marginTop: 14 }}>
            <Text style={[type.micro, { color: light.inkMuted, marginBottom: 4 }]}>NETWORK NAME</Text>
            <TextInput
              value={otherSsid}
              onChangeText={setOtherSsid}
              autoCapitalize="none"
              placeholder="Your Wi-Fi name (SSID)"
              placeholderTextColor={light.inkMuted}
              style={[type.body, inputStyle]}
            />
            {session.networks.length > 0 && (
              <Pressable onPress={() => setUseOther(false)} style={{ minHeight: 36, justifyContent: 'center' }}>
                <Text style={[type.caption, { color: accent.verdant }]}>← Back to the list</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* password */}
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 14, marginBottom: 4 }]}>PASSWORD</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPass}
            autoCapitalize="none"
            placeholder="Wi-Fi password"
            placeholderTextColor={light.inkMuted}
            style={[type.body, inputStyle, { flex: 1 }]}
          />
          <Pressable onPress={() => setShowPass((v) => !v)} style={{ padding: 10 }}>
            <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={20} color={light.inkMuted} />
          </Pressable>
        </View>
        <Text style={[type.micro, { color: light.inkMuted, marginTop: 6 }]}>
          Only 2.4 GHz networks are supported (most sensors can’t see 5 GHz).
        </Text>

        {err && <Text style={[type.micro, { color: '#C0392B', marginTop: 10 }]}>{err}</Text>}

        <GButton title="Connect" onPress={connect} disabled={!chosen} style={{ marginTop: 16 }} />
        <GButton title="Use the setup hotspot instead" kind="ghost" mode="light" onPress={() => setPhase('guide')} style={{ marginTop: 8 }} />
      </View>
    );
  }

  // ── Intro ──
  return (
    <View>
      <Text style={[type.ritualTitle, { color: light.ink, marginTop: 8 }]}>Connect it to your Wi-Fi</Text>
      <Text style={[type.body, { color: light.inkMuted, marginTop: 6, lineHeight: 22 }]}>
        For sensors built with Bluetooth setup: keep it powered and close, and we’ll find it and hand
        it your Wi-Fi — no switching networks.
      </Text>

      <Card mode="light" style={{ marginTop: 16, gap: 10 }}>
        {[
          ['bluetooth-outline', 'Find your sensor'],
          ['wifi-outline', 'Pick your home Wi-Fi'],
          ['lock-closed-outline', 'Type the password once — done'],
        ].map(([icon, label]) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Ionicons name={icon as any} size={20} color={accent.verdant} />
            <Text style={[type.body, { color: light.ink }]}>{label}</Text>
          </View>
        ))}
      </Card>

      {err && <Text style={[type.micro, { color: '#C0392B', marginTop: 12 }]}>{err}</Text>}

      <GButton title="Find my sensor" onPress={search} style={{ marginTop: 16 }} />
      <GButton title="Use the setup hotspot instead" kind="ghost" mode="light" onPress={() => setPhase('guide')} style={{ marginTop: 8 }} />
      {onSkip && (
        <GButton title={skipLabel ?? 'Skip for now'} kind="ghost" mode="light" onPress={onSkip} style={{ marginTop: 8 }} />
      )}
    </View>
  );
}

const inputStyle = {
  color: light.ink,
  backgroundColor: light.surface1,
  borderWidth: 1,
  borderColor: light.hairline,
  borderRadius: 14,
  paddingHorizontal: 14,
  minHeight: 48,
} as const;
