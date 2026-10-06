import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text } from 'react-native';

/** Native QR scanner (iOS/Android) via expo-camera. */
export function QRScanner({ onScan }: { onScan: (data: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const done = React.useRef(false);

  if (!permission?.granted) {
    return (
      <Pressable
        onPress={requestPermission}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}
      >
        <Ionicons name="camera-outline" size={40} color="#fff" />
        <Text style={{ color: '#fff', marginTop: 8 }}>Tap to enable the camera</Text>
      </Pressable>
    );
  }

  return (
    <CameraView
      style={{ flex: 1 }}
      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={({ data }) => {
        if (done.current) return;
        done.current = true;
        onScan(data);
      }}
    />
  );
}
