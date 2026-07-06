import jsQR from 'jsqr';
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

/**
 * Web QR scanner: streams the camera into a hidden canvas and decodes frames
 * with jsQR. Works in Chrome/Edge/Firefox and iOS/Android Safari (needs HTTPS,
 * which the deployed site is). Falls back with a message if the camera is
 * blocked — the manual code box is always available underneath.
 */
export function QRScanner({ onScan }: { onScan: (data: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        v.setAttribute('playsinline', 'true');
        await v.play();

        const scan = () => {
          if (stopped) return;
          const v2 = videoRef.current;
          if (v2 && v2.videoWidth) {
            canvas.width = v2.videoWidth;
            canvas.height = v2.videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v2, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(img.data, img.width, img.height);
              if (code?.data) { onScan(code.data); return; }
            }
          }
          raf = requestAnimationFrame(scan);
        };
        raf = requestAnimationFrame(scan);
      } catch {
        setErr('Camera unavailable — allow camera access, or paste the code below.');
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onScan]);

  if (err) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <Text style={{ color: '#fff', textAlign: 'center' }}>{err}</Text>
      </View>
    );
  }

  // Raw <video> element (rendered by react-dom on web).
  return React.createElement('video', {
    ref: videoRef,
    autoPlay: true,
    muted: true,
    playsInline: true,
    style: { width: '100%', height: '100%', objectFit: 'cover' },
  });
}
