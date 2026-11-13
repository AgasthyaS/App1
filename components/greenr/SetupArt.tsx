import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { accent, light } from '@/constants/theme';

/**
 * Illustrations for sensor setup. Each one mirrors what the person will actually
 * see — the real "greenr-setup" network name, the firmware's own setup page
 * (firmware/greenr_sensor, handlePortalRoot) — so the picture can be matched
 * against the screen in their hand.
 *
 * Colours are read at render time (the palette is repainted on appearance change).
 */

/** The firmware setup page's button colour, so the drawing matches the real page. */
const PORTAL_GREEN = '#5a8c4a';
const BOARD = '#1F3B4D';
/** Same stack as the charts (RangeRibbon) so SVG text matches on web. */
const FONT = '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';

function Frame({ children, ratio = 300 / 170 }: { children: React.ReactNode; ratio?: number }) {
  return (
    <View
      style={{
        width: '100%',
        aspectRatio: ratio,
        borderRadius: 18,
        overflow: 'hidden',
        backgroundColor: light.surface2,
        borderWidth: 1,
        borderColor: light.hairline,
      }}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 300 ${Math.round(300 / ratio)}`}>
        {children}
      </Svg>
    </View>
  );
}

/** A phone outline; children draw inside a screen whose top-left is (x+6, y+14). */
function Phone({ x, y, w = 110, h = 150, children }: { x: number; y: number; w?: number; h?: number; children?: React.ReactNode }) {
  return (
    <G>
      <Rect x={x} y={y} width={w} height={h} rx={16} fill={light.ink} />
      <Rect x={x + 6} y={y + 14} width={w - 12} height={h - 24} rx={6} fill="#FFFFFF" />
      <Rect x={x + w / 2 - 14} y={y + 5} width={28} height={4} rx={2} fill="#FFFFFF" opacity={0.35} />
      <G transform={`translate(${x + 6}, ${y + 14})`}>{children}</G>
    </G>
  );
}

function WifiGlyph({ x, y, s = 1, color }: { x: number; y: number; s?: number; color: string }) {
  return (
    <G transform={`translate(${x}, ${y}) scale(${s})`}>
      <Path d="M-8 -3 A11 11 0 0 1 8 -3" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" />
      <Path d="M-5 0 A7 7 0 0 1 5 0" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" />
      <Circle cx={0} cy={3.5} r={1.8} fill={color} />
    </G>
  );
}

function Lock({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <G transform={`translate(${x}, ${y})`}>
      <Path d="M-3 -1 V-4 A3 3 0 0 1 3 -4 V-1" stroke={color} strokeWidth={1.4} fill="none" />
      <Rect x={-4.5} y={-1} width={9} height={7} rx={1.5} fill={color} />
    </G>
  );
}

function Tick({ x, y, r = 10, color = accent.sage }: { x: number; y: number; r?: number; color?: string }) {
  return (
    <G>
      <Circle cx={x} cy={y} r={r} fill={color} />
      <Path
        d={`M${x - r * 0.45} ${y} L${x - r * 0.1} ${y + r * 0.35} L${x + r * 0.5} ${y - r * 0.35}`}
        stroke="#FFFFFF"
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </G>
  );
}

function Cross({ x, y, r = 10 }: { x: number; y: number; r?: number }) {
  const d = r * 0.4;
  return (
    <G>
      <Circle cx={x} cy={y} r={r} fill={accent.clay} />
      <Path d={`M${x - d} ${y - d} L${x + d} ${y + d} M${x + d} ${y - d} L${x - d} ${y + d}`} stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" />
    </G>
  );
}

function Label({ x, y, children, size = 9, color, weight = '400', anchor = 'middle' }: {
  x: number; y: number; children: React.ReactNode; size?: number; color?: string; weight?: '400' | '600' | '700'; anchor?: 'start' | 'middle' | 'end';
}) {
  return (
    <SvgText x={x} y={y} fontSize={size} fill={color ?? light.inkMuted} fontWeight={weight} textAnchor={anchor} fontFamily={FONT}>
      {children}
    </SvgText>
  );
}

/** The sensor stake: a head with the electronics, a probe below. */
function Sensor({ x, y, scale = 1, qr = false }: { x: number; y: number; scale?: number; qr?: boolean }) {
  return (
    <G transform={`translate(${x}, ${y}) scale(${scale})`}>
      <Rect x={-20} y={0} width={40} height={34} rx={7} fill={BOARD} />
      <Circle cx={12} cy={8} r={2.4} fill={accent.sage} />
      {qr ? <Qr x={-12} y={6} size={22} /> : <Label x={0} y={22} size={7} color="#FFFFFF" weight="600">greenr</Label>}
      <Path d="M-9 34 L-9 78 L0 88 L9 78 L9 34 Z" fill="#2E5A44" />
      <Line x1={-9} y1={56} x2={9} y2={56} stroke="#FFFFFF" strokeWidth={1.2} strokeDasharray="2 2" />
    </G>
  );
}

/** A fixed, QR-looking pattern — decorative, it encodes nothing. */
const QR_BITS = [
  '1110101', '1010010', '1110111', '0001010', '1011101', '0100110', '1101011',
];
function Qr({ x, y, size }: { x: number; y: number; size: number }) {
  const c = size / 7;
  return (
    <G>
      <Rect x={x - 1.5} y={y - 1.5} width={size + 3} height={size + 3} fill="#FFFFFF" rx={1.5} />
      {QR_BITS.flatMap((row, r) =>
        row.split('').map((b, col) =>
          b === '1' ? <Rect key={`${r}-${col}`} x={x + col * c} y={y + r * c} width={c} height={c} fill={light.ink} /> : null,
        ),
      )}
    </G>
  );
}

function Pot({ x, y, w = 90, h = 70 }: { x: number; y: number; w?: number; h?: number }) {
  const inset = w * 0.12;
  return (
    <G>
      <Path d={`M${x} ${y} H${x + w} L${x + w - inset} ${y + h} H${x + inset} Z`} fill="#C7774E" />
      <Rect x={x - 4} y={y - 8} width={w + 8} height={12} rx={3} fill="#B56A43" />
      <Path d={`M${x + 2} ${y + 4} H${x + w - 2} L${x + w - 3} ${y + 12} H${x + 3} Z`} fill="#5B4332" />
    </G>
  );
}

// ───────────────────────────────── Scenes ─────────────────────────────────

/** Step 0 — what you need: power from a wall adapter or a battery, not a laptop port. */
export function PowerArt() {
  return (
    <Frame>
      <Pot x={30} y={95} />
      <Sensor x={75} y={22} />
      {/* cable from the sensor head to the wall adapter */}
      <Path d="M95 40 C 140 40, 150 80, 196 80" stroke={light.ink} strokeWidth={3} fill="none" strokeLinecap="round" />
      <Rect x={196} y={66} width={34} height={28} rx={5} fill="#FFFFFF" stroke={light.ink} strokeWidth={2} />
      <Rect x={230} y={73} width={8} height={4} fill={light.ink} />
      <Rect x={230} y={83} width={8} height={4} fill={light.ink} />
      <Tick x={230} y={62} />
      <Label x={216} y={112} color={light.ink} weight="600">USB adapter or battery</Label>
      {/* laptop: crossed out */}
      <G opacity={0.85}>
        <Rect x={200} y={122} width={32} height={19} rx={3} fill="none" stroke={light.inkMuted} strokeWidth={2} />
        <Path d="M194 144 H238" stroke={light.inkMuted} strokeWidth={3} strokeLinecap="round" />
        <Cross x={242} y={122} r={8} />
        <Label x={216} y={162} size={8}>not a laptop (it sleeps)</Label>
      </G>
    </Frame>
  );
}

/** Step 1 — scan the QR on the sensor. */
export function ScanArt() {
  return (
    <Frame>
      <Sensor x={80} y={30} scale={1.35} qr />
      <Phone x={160} y={12}>
        <Rect x={0} y={0} width={98} height={126} fill="#111" />
        {/* viewfinder corners */}
        {[
          [22, 30, 1, 1], [76, 30, -1, 1], [22, 84, 1, -1], [76, 84, -1, -1],
        ].map(([cx, cy, dx, dy], i) => (
          <Path key={i} d={`M${cx} ${cy + 12 * dy} V${cy} H${cx + 12 * dx}`} stroke={accent.sage} strokeWidth={3} fill="none" strokeLinecap="round" />
        ))}
        <Qr x={34} y={42} size={30} />
        <Label x={49} y={108} color="#FFFFFF" size={8}>Hold steady…</Label>
      </Phone>
      <Path d="M118 70 H150" stroke={accent.verdant} strokeWidth={2} strokeDasharray="3 3" />
      <Path d="M146 66 L152 70 L146 74" stroke={accent.verdant} strokeWidth={2} fill="none" />
    </Frame>
  );
}

/** Wi-Fi step 1 — power on; it opens its own setup network. */
export function HotspotOnArt() {
  return (
    <Frame>
      <Pot x={40} y={100} />
      <Sensor x={85} y={44} />
      {[12, 22, 32].map((r, i) => (
        <Path key={r} d={`M${85 - r} ${38 - i * 2} A${r} ${r} 0 0 1 ${85 + r} ${38 - i * 2}`} stroke={accent.verdant} strokeWidth={2.5} fill="none" strokeLinecap="round" opacity={1 - i * 0.25} />
      ))}
      <Rect x={160} y={60} width={118} height={40} rx={10} fill="#FFFFFF" stroke={accent.verdant} strokeWidth={1.5} />
      <WifiGlyph x={180} y={80} color={accent.verdant} />
      <Label x={196} y={78} anchor="start" color={light.ink} weight="700" size={11}>greenr-setup</Label>
      <Label x={196} y={91} anchor="start" size={8}>open · no password</Label>
      <Label x={219} y={122} size={8}>Appears within ~10 seconds</Label>
    </Frame>
  );
}

/** Wi-Fi step 2 — join "greenr-setup" in the phone's Wi-Fi settings. */
export function JoinHotspotArt() {
  const rows: { name: string; open?: boolean; on?: boolean }[] = [
    { name: 'greenr-setup', open: true, on: true },
    { name: 'Home Wi-Fi' },
    { name: 'Neighbour' },
  ];
  return (
    <Frame>
      <Phone x={95} y={10}>
        <Label x={8} y={18} anchor="start" color={light.ink} weight="700" size={11}>Wi-Fi</Label>
        <Label x={8} y={32} anchor="start" size={7}>CHOOSE A NETWORK…</Label>
        {rows.map((r, i) => (
          <G key={r.name}>
            <Rect x={4} y={38 + i * 24} width={90} height={21} rx={5} fill={r.on ? `${accent.verdant}22` : '#FFFFFF'} stroke={r.on ? accent.verdant : light.hairline} />
            <Label x={10} y={52 + i * 24} anchor="start" color={r.on ? light.ink : light.inkMuted} weight={r.on ? '700' : '400'} size={8.5}>{r.name}</Label>
            {!r.open && <Lock x={74} y={48 + i * 24} color={light.inkMuted} />}
            <WifiGlyph x={86} y={49 + i * 24} s={0.55} color={r.on ? accent.verdant : light.inkMuted} />
          </G>
        ))}
      </Phone>
      {/* tap */}
      <Circle cx={176} cy={74} r={9} fill={accent.verdant} opacity={0.25} />
      <Circle cx={176} cy={74} r={4} fill={accent.verdant} />
      <Label x={254} y={66} color={light.ink} weight="600" size={9}>Tap it</Label>
      <Label x={254} y={79} size={8}>no lock =</Label>
      <Label x={254} y={90} size={8}>no password</Label>
      <Label x={48} y={110} size={8}>Your home Wi-Fi</Label>
      <Label x={48} y={121} size={8}>stays saved</Label>
    </Frame>
  );
}

/** Wi-Fi step 3 — the setup page that pops up. Mirrors the firmware's page. */
export function PortalArt() {
  return (
    <Frame>
      <Phone x={105} y={6} h={158}>
        <Label x={49} y={18} color={light.ink} weight="700" size={8}>Connect your sensor</Label>
        <Label x={8} y={36} anchor="start" size={6.5}>NETWORK</Label>
        <Rect x={6} y={40} width={86} height={18} rx={4} fill="#FFFFFF" stroke={light.hairline} />
        <Label x={11} y={52} anchor="start" color={light.ink} size={8}>Home Wi-Fi</Label>
        <Path d="M82 47 L85 51 L88 47" stroke={light.inkMuted} strokeWidth={1.4} fill="none" />
        <Label x={8} y={72} anchor="start" size={6.5}>PASSWORD</Label>
        <Rect x={6} y={76} width={86} height={18} rx={4} fill="#FFFFFF" stroke={light.hairline} />
        <Label x={11} y={89} anchor="start" color={light.ink} size={10}>••••••••</Label>
        <Rect x={6} y={104} width={86} height={20} rx={5} fill={PORTAL_GREEN} />
        <Label x={49} y={117} color="#FFFFFF" weight="700" size={8.5}>Connect</Label>
      </Phone>
      <Circle cx={196} cy={138} r={9} fill={accent.verdant} opacity={0.25} />
      <Circle cx={196} cy={138} r={4} fill={accent.verdant} />
      <Label x={52} y={60} size={8} color={light.ink} weight="600">Opens by itself</Label>
      <Label x={52} y={72} size={7.5}>If not, open a</Label>
      <Label x={52} y={83} size={7.5}>browser and go to</Label>
      <Label x={52} y={94} size={7.5}>192.168.4.1</Label>
      <Label x={262} y={60} size={8} color={light.ink} weight="600">Pick your home</Label>
      <Label x={262} y={72} size={8} color={light.ink} weight="600">network</Label>
      <Label x={262} y={86} size={8}>2.4 GHz only</Label>
    </Frame>
  );
}

/** Wi-Fi step 4 — back to home Wi-Fi; the sensor reports in. */
export function ReportingArt() {
  return (
    <Frame>
      <Phone x={20} y={10}>
        <Label x={8} y={18} anchor="start" color={light.ink} weight="700" size={11}>Wi-Fi</Label>
        <Rect x={4} y={30} width={90} height={22} rx={5} fill={`${accent.sage}22`} stroke={accent.sage} />
        <Label x={10} y={44} anchor="start" color={light.ink} weight="700" size={8.5}>Home Wi-Fi</Label>
        <Path d="M78 41 L81 44 L87 37" stroke={accent.sage} strokeWidth={2} fill="none" strokeLinecap="round" />
        <Rect x={4} y={56} width={90} height={22} rx={5} fill="#FFFFFF" stroke={light.hairline} />
        <Label x={10} y={70} anchor="start" size={8.5}>greenr-setup</Label>
        <Label x={49} y={104} size={7}>Rejoin your normal Wi-Fi</Label>
      </Phone>
      <Sensor x={175} y={64} scale={0.8} />
      <Path d="M190 62 C 205 40, 220 34, 236 34" stroke={accent.verdant} strokeWidth={2} strokeDasharray="3 3" fill="none" />
      {/* cloud */}
      <Path d="M236 44 a12 12 0 0 1 2 -24 a16 16 0 0 1 30 4 a10 10 0 0 1 2 20 Z" fill="#FFFFFF" stroke={accent.verdant} strokeWidth={2} />
      <Tick x={276} y={22} r={8} />
      <Label x={252} y={66} size={8} color={light.ink} weight="600">First reading</Label>
      <Label x={252} y={78} size={8}>in under a minute</Label>
    </Frame>
  );
}

/** Placement — how deep, and where in the pot. */
export function ProbeDepthArt() {
  const cx = 110;
  return (
    <Frame>
      {/* pot cross-section */}
      <Path d="M50 60 H170 L156 160 H64 Z" fill="#C7774E" />
      <Path d="M56 66 H164 L152 154 H68 Z" fill="#6E5140" />
      {/* roots */}
      <Path d="M90 70 C 85 95, 70 105, 75 130 M90 70 C 95 100, 100 110, 96 140 M90 70 C 80 90, 110 100, 104 120" stroke="#C9B48C" strokeWidth={1.5} fill="none" />
      {/* stem */}
      <Path d="M90 66 C 88 40, 80 28, 70 18 M90 50 C 98 36, 110 30, 120 26" stroke="#557A3C" strokeWidth={3} fill="none" strokeLinecap="round" />
      <Path d="M70 18 c -14 -2 -18 10 -6 14 c 8 2 10 -8 6 -14 Z M120 26 c 12 -4 18 8 6 12 c -8 2 -10 -6 -6 -12 Z" fill="#6E9B4E" />
      {/* the probe, inserted to its line */}
      <Rect x={cx + 14} y={22} width={22} height={24} rx={5} fill={BOARD} />
      <Path d={`M${cx + 19} 46 V112 L${cx + 25} 120 L${cx + 31} 112 V46 Z`} fill="#2E5A44" />
      <Line x1={cx + 8} y1={66} x2={cx + 42} y2={66} stroke="#FFFFFF" strokeWidth={1.5} strokeDasharray="3 2" />
      {/* callouts */}
      <Path d="M160 34 H200" stroke={light.inkMuted} strokeWidth={1} />
      <Label x={204} y={31} anchor="start" size={8.5} color={light.ink} weight="600">Electronics stay</Label>
      <Label x={204} y={42} anchor="start" size={8.5} color={light.ink} weight="600">above the soil</Label>
      <Path d="M154 66 H200" stroke={light.inkMuted} strokeWidth={1} />
      <Label x={204} y={64} anchor="start" size={8.5} color={light.ink} weight="600">Push in up to</Label>
      <Label x={204} y={75} anchor="start" size={8.5} color={light.ink} weight="600">the white line</Label>
      <Path d="M141 110 H200" stroke={light.inkMuted} strokeWidth={1} />
      <Label x={204} y={106} anchor="start" size={8.5} color={light.ink} weight="600">Halfway between</Label>
      <Label x={204} y={117} anchor="start" size={8.5} color={light.ink} weight="600">stem and rim</Label>
      <Label x={204} y={140} anchor="start" size={8}>Firm the soil around it</Label>
      <Label x={204} y={151} anchor="start" size={8}>so there are no air gaps</Label>
    </Frame>
  );
}

/** Troubleshooting — hold BOOT to restart setup. */
export function BootButtonArt() {
  return (
    <Frame ratio={300 / 130}>
      <Rect x={40} y={30} width={150} height={70} rx={6} fill={BOARD} />
      <Rect x={95} y={45} width={46} height={40} rx={3} fill="#9AA6AE" />
      <Label x={118} y={69} size={7} color={BOARD} weight="700">ESP32-C3</Label>
      <Rect x={20} y={56} width={22} height={18} rx={3} fill="#9AA6AE" />
      {[['RST', 60], ['BOOT', 170]].map(([name, x]) => (
        <G key={name as string}>
          <Rect x={(x as number) - 9} y={78} width={18} height={14} rx={3} fill="#E8E8E8" />
          <Circle cx={x as number} cy={85} r={4.5} fill={name === 'BOOT' ? accent.verdant : '#555'} />
          <Label x={x as number} y={72} size={7} color="#FFFFFF" weight="700">{name}</Label>
        </G>
      ))}
      <Circle cx={170} cy={85} r={14} fill="none" stroke={accent.verdant} strokeWidth={2} strokeDasharray="4 3" />
      <Label x={250} y={58} size={10} color={light.ink} weight="700">Hold BOOT</Label>
      <Label x={250} y={72} size={10} color={light.ink} weight="700">for 3 seconds</Label>
      <Label x={250} y={88} size={8}>within 2 seconds of</Label>
      <Label x={250} y={99} size={8}>tapping RST</Label>
    </Frame>
  );
}
