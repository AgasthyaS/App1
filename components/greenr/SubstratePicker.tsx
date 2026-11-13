import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { accent, dark, light, type } from '@/constants/theme';
import {
  MIX_BUILDER_IDS, PRESETS, componentById, recipeText, resolveSubstrate, vgTheta,
  type MixturePart, type ResolvedSubstrate, type SubstratePreset, type SubstrateSpec,
} from '@/lib/substrate';

/**
 * Choosing what a plant is potted in.
 *
 * Three levels, each one tap deeper than the last, so nobody has to read about
 * soil physics to add a plant: a short list of common mixes, the full list
 * behind "More", and a build-your-own for people who mix their own. "Not sure"
 * is a first-class answer.
 *
 * Under the choice sits a small readout of what it means — how much water it
 * holds and how much air — because that, not the name, is what changes the
 * advice. Every figure there is an estimate and is drawn as a range.
 */

const ICON: Record<string, string> = {
  'potting-mix': 'leaf',
  'succulent-mix': 'sunny',
  'aroid-mix': 'grid',
  'orchid-mix': 'flower',
  'coco-coir': 'ellipse',
  'dense-compost': 'water',
  'seed-mix': 'egg',
  'compost-mix': 'refresh-circle',
  'peat-moss': 'layers',
  sphagnum: 'cloud',
  pumice: 'diamond',
  'sandy-soil': 'apps',
  'loamy-soil': 'earth',
  'clay-soil': 'square',
};

const GROUP_TITLE: Record<SubstratePreset['group'], string> = {
  potting: 'Potting mixes',
  specialist: 'Specialist mixes',
  single: 'Single materials',
  garden: 'Garden soil',
};

/** Parts a new custom mix starts from. */
const STARTER: MixturePart[] = [
  { component: 'potting-mix', parts: 3 },
  { component: 'perlite', parts: 1 },
];

function specKey(s: SubstrateSpec | null | undefined): string {
  if (!s) return '';
  return s.kind === 'preset' ? `preset:${s.id}` : s.kind === 'unknown' ? 'unknown' : 'custom';
}

/** Water held and air at container capacity, as fractions with ranges where known. */
export function substrateFigures(r: ResolvedSubstrate) {
  if (r.properties) {
    return { water: r.properties.containerCapacity, air: r.properties.airSpace, ranged: true };
  }
  const cc = vgTheta(r.vg, 10);
  const air = Math.max(0, r.vg.thetaS - cc);
  return { water: { low: cc, mid: cc, high: cc }, air: { low: air, mid: air, high: air }, ranged: false };
}

const drainWord = (air: number) =>
  air >= 0.3 ? 'Drains very fast' : air >= 0.2 ? 'Drains freely' : air >= 0.12 ? 'Drains moderately' : 'Drains slowly';
const holdWord = (water: number) =>
  water >= 0.62 ? 'holds a lot of water' : water >= 0.45 ? 'holds a moderate amount of water' : 'holds little water';

function RangeBar({ label, range, color, t }: {
  label: string;
  range: { low: number; mid: number; high: number };
  color: string;
  t: { ink: string; inkMuted: string; hairline: string };
}) {
  const pct = (x: number) => `${Math.max(0, Math.min(100, Math.round(x * 100)))}%` as const;
  const spread = range.high - range.low > 0.015;
  return (
    <View style={{ marginTop: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[type.caption, { color: t.ink }]}>{label}</Text>
        <Text style={[type.caption, { color: t.inkMuted, fontVariant: ['tabular-nums'] }]}>
          {spread ? `${Math.round(range.low * 100)}–${Math.round(range.high * 100)}%` : `about ${Math.round(range.mid * 100)}%`}
        </Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: t.hairline, marginTop: 5, overflow: 'hidden' }}>
        {/* the plausible range, faint… */}
        <View style={{ position: 'absolute', left: pct(range.low), width: pct(Math.max(0.01, range.high - range.low)), top: 0, bottom: 0, backgroundColor: color, opacity: 0.28 }} />
        {/* …and the working estimate, solid */}
        <View style={{ position: 'absolute', left: 0, width: pct(range.mid), top: 0, bottom: 0, backgroundColor: color, opacity: spread ? 0.55 : 1, borderRadius: 4 }} />
        <View style={{ position: 'absolute', left: pct(range.mid), width: 2, marginLeft: -1, top: 0, bottom: 0, backgroundColor: color }} />
      </View>
    </View>
  );
}

/** What the current choice means, in two bars and two sentences. */
export function SubstrateSummary({ spec, mode = 'light', legacyMix }: {
  spec: SubstrateSpec | null | undefined;
  mode?: 'light' | 'dark';
  legacyMix?: Parameters<typeof resolveSubstrate>[1];
}) {
  const t = mode === 'dark' ? dark : light;
  const r = useMemo(() => resolveSubstrate(spec, legacyMix), [spec, legacyMix]);
  const f = substrateFigures(r);
  const unknown = r.knowledge === 'unknown';
  return (
    <View style={{ borderRadius: 16, borderWidth: 1, borderColor: t.hairline, backgroundColor: t.surface1, padding: 14 }}>
      <Text style={[type.cardTitle, { color: t.ink, fontSize: 15 }]}>
        {unknown ? 'Assuming a general potting mix' : `${drainWord(f.air.mid)}, ${holdWord(f.water.mid)}`}
      </Text>
      {r.parts.length > 1 && (
        <Text style={[type.caption, { color: t.inkMuted, marginTop: 2 }]}>{recipeText(r)}</Text>
      )}
      <RangeBar label="Water held after draining" range={f.water} color={accent.verdant} t={t} />
      <RangeBar label="Air around the roots" range={f.air} color={accent.sage} t={t} />
      <Text style={[type.micro, { color: t.inkMuted, marginTop: 10, lineHeight: 16 }]}>
        {f.ranged || unknown ? 'Estimate. ' : 'Reference figure. '}
        {r.provenance}
      </Text>
      {r.properties?.notes.map((n) => (
        <View key={n} style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
          <Ionicons name="information-circle-outline" size={14} color={t.inkMuted} style={{ marginTop: 1 }} />
          <Text style={[type.micro, { color: t.inkMuted, flex: 1, lineHeight: 16 }]}>{n}</Text>
        </View>
      ))}
    </View>
  );
}

function Row({ icon, label, blurb, selected, onPress, t }: {
  icon: string; label: string; blurb: string; selected: boolean; onPress: () => void;
  t: { ink: string; inkMuted: string; hairline: string; surface1: string };
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 56,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 14,
        borderWidth: 2,
        borderColor: selected ? accent.verdant : t.hairline,
        backgroundColor: selected ? `${accent.verdant}14` : t.surface1,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? accent.verdant : t.hairline }}>
        <Ionicons name={icon as any} size={16} color={selected ? '#FFFFFF' : t.inkMuted} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { color: t.ink, fontWeight: '600' }]}>{label}</Text>
        <Text style={[type.caption, { color: t.inkMuted }]}>{blurb}</Text>
      </View>
      {selected && <Ionicons name="checkmark-circle" size={20} color={accent.verdant} />}
    </Pressable>
  );
}

export default function SubstratePicker({ value, onChange, mode = 'light', showSummary = true }: {
  value: SubstrateSpec | null;
  onChange: (spec: SubstrateSpec) => void;
  mode?: 'light' | 'dark';
  showSummary?: boolean;
}) {
  const t = mode === 'dark' ? dark : light;
  const current = specKey(value);
  const isCustom = value?.kind === 'custom';
  const chosenPreset = value?.kind === 'preset' ? PRESETS.find((p) => p.id === value.id) : undefined;
  // Open "More" straight away when the saved choice lives there.
  const [more, setMore] = useState(!!chosenPreset && !chosenPreset.common);
  const [parts, setParts] = useState<MixturePart[]>(isCustom ? value.parts : STARTER);

  const total = parts.reduce((s, p) => s + p.parts, 0);
  const setPart = (component: string, n: number) => {
    const next = [...parts.filter((p) => p.component !== component), ...(n > 0 ? [{ component, parts: n }] : [])];
    setParts(next);
    if (next.length) onChange({ kind: 'custom', parts: next });
  };

  const presetRow = (p: SubstratePreset) => (
    <Row
      key={p.id}
      t={t}
      icon={ICON[p.id] ?? 'ellipse-outline'}
      label={p.label}
      blurb={p.blurb}
      selected={current === `preset:${p.id}`}
      onPress={() => onChange({ kind: 'preset', id: p.id })}
    />
  );

  const common = PRESETS.filter((p) => p.common);
  const rest = PRESETS.filter((p) => !p.common);
  const groups = (['potting', 'specialist', 'single', 'garden'] as const)
    .map((g) => ({ g, items: rest.filter((p) => p.group === g) }))
    .filter((x) => x.items.length);

  return (
    <View>
      <View style={{ gap: 8 }}>
        {common.map(presetRow)}
        <Row
          t={t}
          icon="options"
          label="My own mix"
          blurb={isCustom ? recipeText(resolveSubstrate(value)) || 'Choose ingredients' : 'Choose ingredients and proportions'}
          selected={isCustom}
          onPress={() => onChange({ kind: 'custom', parts })}
        />
        <Row
          t={t}
          icon="help"
          label="Not sure"
          blurb="Greenr will learn it from how the pot dries"
          selected={current === 'unknown'}
          onPress={() => onChange({ kind: 'unknown' })}
        />
      </View>

      {isCustom && (
        <View style={{ marginTop: 12, borderRadius: 16, borderWidth: 1, borderColor: t.hairline, backgroundColor: t.surface1, padding: 12 }}>
          <Text style={[type.micro, { color: t.inkMuted, letterSpacing: 0.4 }]}>
            INGREDIENTS · BY VOLUME, IN PARTS (SCOOPS, POTS, HANDFULS)
          </Text>
          {MIX_BUILDER_IDS.map((id) => {
            const c = componentById(id)!;
            const n = parts.find((p) => p.component === id)?.parts ?? 0;
            return (
              <View key={id} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, borderTopWidth: 1, borderTopColor: t.hairline }}>
                <Text style={[type.body, { color: n ? t.ink : t.inkMuted, flex: 1 }]} numberOfLines={1}>{c.label}</Text>
                <Text style={[type.caption, { color: t.inkMuted, width: 44, textAlign: 'right', fontVariant: ['tabular-nums'] }]}>
                  {n && total ? `${Math.round((n / total) * 100)}%` : ''}
                </Text>
                <Pressable
                  onPress={() => setPart(id, Math.max(0, n - 1))}
                  disabled={n === 0 || (n === 1 && parts.length === 1)}
                  accessibilityLabel={`Less ${c.label}`}
                  hitSlop={6}
                  style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: n === 0 || (n === 1 && parts.length === 1) ? 0.3 : 1 }}
                >
                  <Ionicons name="remove-circle-outline" size={24} color={t.inkMuted} />
                </Pressable>
                <Text style={[type.cardTitle, { color: t.ink, width: 22, textAlign: 'center', fontVariant: ['tabular-nums'] }]}>{n}</Text>
                <Pressable
                  onPress={() => setPart(id, Math.min(12, n + 1))}
                  disabled={n >= 12 || (n === 0 && parts.length >= 6)}
                  accessibilityLabel={`More ${c.label}`}
                  hitSlop={6}
                  style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: n >= 12 || (n === 0 && parts.length >= 6) ? 0.3 : 1 }}
                >
                  <Ionicons name="add-circle" size={24} color={accent.verdant} />
                </Pressable>
              </View>
            );
          })}
          <Text style={[type.micro, { color: t.inkMuted, marginTop: 8, lineHeight: 16 }]}>
            Up to six ingredients. Rough proportions are fine — the estimate below shows how much they matter.
          </Text>
        </View>
      )}

      <Pressable onPress={() => setMore(!more)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <Text style={[type.caption, { color: accent.verdant }]}>{more ? 'Fewer options' : 'More options — seed mix, peat, garden soil textures'}</Text>
        <Ionicons name={more ? 'chevron-up' : 'chevron-down'} size={14} color={accent.verdant} />
      </Pressable>
      {more && groups.map(({ g, items }) => (
        <View key={g} style={{ marginBottom: 10 }}>
          <Text style={[type.micro, { color: t.inkMuted, letterSpacing: 0.4, marginBottom: 6 }]}>{GROUP_TITLE[g].toUpperCase()}</Text>
          <View style={{ gap: 8 }}>{items.map(presetRow)}</View>
        </View>
      ))}

      {showSummary && value && (
        <View style={{ marginTop: 8 }}>
          <SubstrateSummary spec={value} mode={mode} />
        </View>
      )}
    </View>
  );
}
