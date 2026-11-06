import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';

import { accent, light, type } from '@/constants/theme';

export const PAIR_STEPS = ['Link', 'Wi-Fi', 'Plant', 'Place'] as const;

/** Progress across sensor setup: done steps get a tick, the current one is filled. */
export function SetupStepper({ current, steps = PAIR_STEPS }: { current: number; steps?: readonly string[] }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 4, marginBottom: 14 }}>
      {steps.map((label, i) => {
        const done = i < current;
        const now = i === current;
        const color = done || now ? accent.verdant : light.hairline;
        return (
          <React.Fragment key={label}>
            {i > 0 && (
              <View style={{ flex: 1, height: 2, marginTop: 11, backgroundColor: i <= current ? accent.verdant : light.hairline }} />
            )}
            <View style={{ alignItems: 'center', width: 54 }}>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: now || done ? color : 'transparent',
                  borderWidth: 2,
                  borderColor: color,
                }}
              >
                {done ? (
                  <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                ) : (
                  <Text style={[type.micro, { color: now ? '#FFFFFF' : light.inkMuted, fontWeight: '700' }]}>{i + 1}</Text>
                )}
              </View>
              <Text style={[type.micro, { color: now ? light.ink : light.inkMuted, marginTop: 4, fontWeight: now ? '600' : '400' }]}>
                {label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}
