import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { ListGroup, ListRow } from '@/components/greenr/Native';
import { Screen } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { LEGAL, LEGAL_DOCS, LEGAL_PLACEHOLDERS_REMAIN } from '@/lib/legal';

/** Every policy in one list. */
export default function Legal() {
  const router = useRouter();
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Legal</Text>
      </View>
      <Text style={[type.micro, { color: dark.inkMuted, marginLeft: 6 }]}>All policies effective {LEGAL.effective}</Text>

      {__DEV__ && LEGAL_PLACEHOLDERS_REMAIN && (
        <Text style={[type.caption, { color: accent.sunbeam, marginTop: 12, lineHeight: 18 }]}>
          Dev build: lib/legal.ts still has [placeholder] operator details. Fill them in before release.
        </Text>
      )}

      <ListGroup style={{ marginTop: 16 }}>
        {LEGAL_DOCS.map((d) => (
          <ListRow
            key={d.route}
            icon={d.icon}
            iconColor="#4F8A8B"
            title={d.title}
            subtitle={d.blurb}
            onPress={() => router.push(d.route as any)}
          />
        ))}
      </ListGroup>

      <Text style={[type.caption, { color: dark.inkMuted, marginTop: 16, marginHorizontal: 4, lineHeight: 18 }]}>
        Questions about any of these? Email {LEGAL.supportEmail}.
      </Text>
    </Screen>
  );
}
