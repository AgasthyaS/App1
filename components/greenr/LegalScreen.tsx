import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, Screen } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { LEGAL, LEGAL_DOCS } from '@/lib/legal';

export interface LegalSection {
  heading: string;
  /** paragraphs; a leading "• " renders as a bullet */
  body: string[];
}

/** Shared reader layout for every legal document (see lib/legal.ts). */
export default function LegalScreen({
  title,
  effective = LEGAL.effective,
  intro,
  summary,
  sections,
}: {
  title: string;
  effective?: string;
  intro: string;
  /** "the short version" — a few plain bullets shown above the full text */
  summary?: string[];
  sections: LegalSection[];
}) {
  const router = useRouter();
  const others = LEGAL_DOCS.filter((d) => d.title !== title);
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24, flex: 1 }]}>{title}</Text>
      </View>
      <Text style={[type.micro, { color: dark.inkMuted, marginLeft: 6 }]}>Effective {effective}</Text>

      <Text style={[type.body, { color: dark.inkMuted, lineHeight: 22, marginTop: 16 }]}>{intro}</Text>

      {summary && summary.length > 0 && (
        <Card style={{ marginTop: 18 }}>
          <Text style={[type.sectionHeader, { color: accent.verdant, marginBottom: 4 }]}>The short version</Text>
          {summary.map((p, i) => (
            <View key={i} style={{ flexDirection: 'row', marginTop: 6 }}>
              <Text style={[type.body, { color: dark.ink, lineHeight: 21 }]}>•  </Text>
              <Text style={[type.body, { color: dark.ink, lineHeight: 21, flex: 1 }]}>{p}</Text>
            </View>
          ))}
        </Card>
      )}

      {sections.map((s, i) => (
        <View key={i} style={{ marginTop: 22 }}>
          <Text style={[type.cardTitle, { color: dark.ink, fontSize: 16 }]}>
            {i + 1}. {s.heading}
          </Text>
          {s.body.map((p, j) => {
            const bullet = p.startsWith('• ');
            return (
              <View key={j} style={{ flexDirection: 'row', marginTop: 8, paddingLeft: bullet ? 8 : 0 }}>
                {bullet && <Text style={[type.body, { color: dark.inkMuted, lineHeight: 22 }]}>•  </Text>}
                <Text style={[type.body, { color: dark.inkMuted, lineHeight: 22, flex: 1 }]}>
                  {bullet ? p.slice(2) : p}
                </Text>
              </View>
            );
          })}
        </View>
      ))}

      <Card style={{ marginTop: 28 }}>
        <Text style={[type.sectionHeader, { color: dark.inkMuted, marginBottom: 6 }]}>Contact</Text>
        <Text style={[type.body, { color: dark.ink, lineHeight: 21 }]}>{LEGAL.operator}</Text>
        <Text style={[type.caption, { color: dark.inkMuted, lineHeight: 18 }]}>{LEGAL.address}</Text>
        <Text style={[type.caption, { color: accent.verdant, lineHeight: 18, marginTop: 4 }]}>{LEGAL.supportEmail}</Text>
      </Card>

      <Text style={[type.sectionHeader, { color: dark.inkMuted, marginTop: 24, marginBottom: 4, marginLeft: 4 }]}>
        Other policies
      </Text>
      {others.map((d) => (
        <Pressable
          key={d.route}
          onPress={() => router.push(d.route as any)}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 40, gap: 10, opacity: pressed ? 0.7 : 1 })}
        >
          <Ionicons name={d.icon as any} size={16} color={dark.inkMuted} />
          <Text style={[type.body, { color: accent.verdant, flex: 1 }]}>{d.title}</Text>
          <Ionicons name="chevron-forward" size={16} color={dark.inkMuted} />
        </Pressable>
      ))}

      <Text style={[type.micro, { color: dark.inkMuted, lineHeight: 17, marginTop: 24 }]}>
        This document is written in plain language. It is not a substitute for legal advice; the operator
        should have counsel review it before public release.
      </Text>
    </Screen>
  );
}
