import { Ionicons } from '@expo/vector-icons';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { accent, light, type } from '@/constants/theme';
import { pickPlantPhoto } from '@/lib/photo';

/**
 * In-app camera (§2.2 O2 — "native camera with a leaf-corner frame guide").
 * It renders inside the app as a React view, so capturing never launches an
 * external activity and never pauses the JS host — which is what caused the
 * black screen when using the OS camera. Returns a small data-URI photo.
 */

async function shrink(uri: string): Promise<string> {
  const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 720 } }], {
    compress: 0.6,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  return out.base64 ? `data:image/jpeg;base64,${out.base64}` : out.uri;
}

export default function CameraCapture({
  onCapture,
  onCancel,
  caption = 'Photograph the whole plant if you can.',
}: {
  onCapture: (dataUri: string) => void;
  onCancel: () => void;
  caption?: string;
}) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [busy, setBusy] = useState(false);
  const camRef = useRef<CameraView>(null);

  const fromLibrary = async () => {
    const uri = await pickPlantPhoto();
    if (uri) onCapture(uri);
  };

  // permission not yet decided
  if (!permission) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  // permission denied — offer library instead
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: light.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Ionicons name="camera-outline" size={40} color={light.inkMuted} />
        <Text style={[type.cardTitle, { color: light.ink, marginTop: 14, textAlign: 'center' }]}>
          Camera access needed
        </Text>
        <Text style={[type.body, { color: light.inkMuted, marginTop: 8, textAlign: 'center' }]}>
          Allow the camera to photograph your plant, or choose an existing photo.
        </Text>
        <Pressable
          onPress={requestPermission}
          style={{ marginTop: 20, minHeight: 48, paddingHorizontal: 24, borderRadius: 14, backgroundColor: accent.verdant, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={[type.cardTitle, { color: '#fff', fontSize: 15 }]}>Allow camera</Text>
        </Pressable>
        <Pressable onPress={fromLibrary} style={{ marginTop: 12, minHeight: 44, justifyContent: 'center' }}>
          <Text style={[type.body, { color: accent.verdant }]}>Choose from library</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={{ marginTop: 6, minHeight: 44, justifyContent: 'center' }}>
          <Text style={[type.body, { color: light.inkMuted }]}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  const capture = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const shot = await camRef.current?.takePictureAsync({ quality: 0.7, skipProcessing: true });
      if (shot?.uri) {
        const small = await shrink(shot.uri);
        onCapture(small);
        return;
      }
    } catch {
      // fall through, stay on camera
    }
    setBusy(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView ref={camRef} style={{ flex: 1 }} facing={facing} />

      {/* leaf-corner frame guide */}
      <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 40, left: 24, right: 24, bottom: 200 }}>
        {([0, 1, 2, 3] as const).map((c) => (
          <View
            key={c}
            style={{
              position: 'absolute',
              width: 30,
              height: 30,
              borderColor: '#FFFFFFAA',
              top: c < 2 ? 0 : undefined,
              bottom: c >= 2 ? 0 : undefined,
              left: c % 2 === 0 ? 0 : undefined,
              right: c % 2 === 1 ? 0 : undefined,
              borderTopWidth: c < 2 ? 3 : 0,
              borderBottomWidth: c >= 2 ? 3 : 0,
              borderLeftWidth: c % 2 === 0 ? 3 : 0,
              borderRightWidth: c % 2 === 1 ? 3 : 0,
            }}
          />
        ))}
      </View>

      {/* top bar */}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
        <Pressable onPress={onCancel} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#00000066', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={22} color="#fff" />
        </Pressable>
        <Pressable
          onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#00000066', alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="camera-reverse-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      <Text style={[type.caption, { color: '#FFFFFFCC', textAlign: 'center', position: 'absolute', bottom: 168, left: 24, right: 24 }]}>
        {caption}
      </Text>

      {/* controls */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: insets.bottom + 20,
          paddingTop: 16,
          alignItems: 'center',
        }}
      >
        <Pressable
          onPress={capture}
          accessibilityLabel="Take photo"
          style={{ width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' }} />
          )}
        </Pressable>
        <Pressable onPress={fromLibrary} style={{ marginTop: 14, minHeight: 44, justifyContent: 'center' }}>
          <Text style={[type.body, { color: '#fff' }]}>Choose from library</Text>
        </Pressable>
      </View>
    </View>
  );
}
