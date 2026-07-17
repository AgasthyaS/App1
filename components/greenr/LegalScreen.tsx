import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { Screen } from '@/components/greenr/UI';
import { dark, type } from '@/constants/theme';

export interface LegalSection {
  heading: string;
  /** paragraphs; a leading "• " renders as a bullet */
  body: string[];
}

/** Shared reader layout for the Privacy Policy and Terms screens. */
export default function LegalScreen({
  title,
  effective,
  intro,
  sections,
}: {
  title: string;
  effective: string;
  intro: string;
  sections: LegalSection[];
}) {
  const router = useRouter();
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>{title}</Text>
      </View>
      <Text style={[type.micro, { color: dark.inkMuted, marginLeft: 6 }]}>Effective {effective}</Text>

      <Text style={[type.body, { color: dark.inkMuted, lineHeight: 22, marginTop: 16 }]}>{intro}</Text>

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

      <Text style={[type.micro, { color: dark.inkMuted, lineHeight: 17, marginTop: 28 }]}>
        This document is provided for the Greenr application. It is written in plain language and is not
        a substitute for legal advice; the operator should have counsel review it before public release.
      </Text>
    </Screen>
  );
}
