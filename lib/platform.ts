import { Alert, Platform, Share } from 'react-native';

/**
 * Cross-platform wrappers for native APIs that degrade in a browser.
 * The NATIVE branch calls the identical React Native API as before — app
 * behavior is unchanged; only the web branch is new.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const g: any = typeof globalThis !== 'undefined' ? globalThis : {};

/** Share text. Web: Web Share API → clipboard → file download fallback. */
export async function shareContent(opts: { message: string; title?: string; filename?: string }) {
  if (Platform.OS !== 'web') {
    try {
      await Share.share({ message: opts.message, title: opts.title });
    } catch {
      // user cancelled or unsupported
    }
    return;
  }

  const nav = g.navigator;
  if (nav?.share) {
    try {
      await nav.share({ title: opts.title, text: opts.message });
      return;
    } catch {
      // fall through to clipboard/download
    }
  }
  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(opts.message);
      g.alert?.('Copied to clipboard.');
      return;
    } catch {
      // fall through to download
    }
  }
  try {
    const blob = new g.Blob([opts.message], { type: 'text/plain' });
    const url = g.URL.createObjectURL(blob);
    const a = g.document.createElement('a');
    a.href = url;
    a.download = opts.filename ?? 'greenr-export.txt';
    a.click();
    g.URL.revokeObjectURL(url);
  } catch {
    // nothing more we can do
  }
}

/** Confirm a (possibly destructive) action. Web: window.confirm. */
export function confirmAction(opts: {
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  if (Platform.OS !== 'web') {
    Alert.alert(opts.title, opts.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: opts.confirmLabel ?? 'OK',
        style: opts.destructive ? 'destructive' : 'default',
        onPress: opts.onConfirm,
      },
    ]);
    return;
  }
  const ok = g.confirm?.(opts.message ? `${opts.title}\n\n${opts.message}` : opts.title);
  if (ok) opts.onConfirm();
}

/** Simple info popup. Web: window.alert. */
export function notify(title: string, message?: string) {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message);
    return;
  }
  g.alert?.(message ? `${title}\n\n${message}` : title);
}
