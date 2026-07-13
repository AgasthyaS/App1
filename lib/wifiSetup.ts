import { Buffer } from 'buffer';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

/**
 * Ring-style sensor Wi-Fi setup over Bluetooth.
 *
 * The firmware (v3) advertises a BLE service while the sensor has no working
 * Wi-Fi. The app connects, reads the list of networks the sensor can see,
 * sends "ssid\npassword", and watches a status characteristic flip from
 * "connecting" to "ok" (saved to the device's flash) or "fail" (bad password —
 * just send again). After "ok" the sensor turns Bluetooth off and begins its
 * normal Wi-Fi → Supabase cycle.
 *
 * Two transports behind one interface:
 *  - web:    Web Bluetooth (Chrome/Edge on desktop or Android; not iOS Safari)
 *  - native: react-native-ble-plx (needs a dev/production build — not Expo Go)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const g: any = typeof globalThis !== 'undefined' ? globalThis : {};

// Must match the UUIDs in the sensor firmware.
const PROV_SERVICE = 'c0de0001-feed-4b1e-9d0b-c0ffee000001';
const CHAR_NETWORKS = 'c0de0002-feed-4b1e-9d0b-c0ffee000001';
const CHAR_CREDS = 'c0de0003-feed-4b1e-9d0b-c0ffee000001';
const CHAR_STATUS = 'c0de0004-feed-4b1e-9d0b-c0ffee000001';

export type SetupStatus = 'waiting' | 'connecting' | 'ok' | 'fail';

export const isWifiSetupSupported =
  Platform.OS === 'web'
    ? typeof g.navigator?.bluetooth?.requestDevice === 'function'
    : NativeModules.BlePlx != null; // present in dev builds, absent in Expo Go

export interface WifiSetupSession {
  /** e.g. "greenr-3F2A" — matches the sticker/serial. */
  deviceName: string;
  /** Wi-Fi networks the sensor can see, strongest first. */
  networks: string[];
  /** Send credentials; progress arrives via the onStatus callback. */
  sendCredentials: (ssid: string, password: string) => Promise<void>;
  /** Subscribe to status updates ("connecting" | "ok" | "fail"). */
  onStatus: (cb: (s: SetupStatus) => void) => void;
  disconnect: () => void;
}

function parseNetworks(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((n) => typeof n === 'string');
  } catch {
    // sensor sent something unexpected; manual entry still works
  }
  return [];
}

/**
 * Find the sensor and open a setup session. On web this must be called from a
 * click handler (the browser shows its device chooser); on native it scans for
 * up to 15 s and takes the first greenr sensor in setup mode.
 */
export function startWifiSetup(): Promise<WifiSetupSession> {
  return Platform.OS === 'web' ? startWeb() : startNative();
}

/** True when the user closed the browser's device chooser without picking. */
export function isChooserCancelled(err: unknown): boolean {
  return (err as any)?.name === 'NotFoundError' && Platform.OS === 'web';
}

// ---------------------------------------------------------------- web ----

async function startWeb(): Promise<WifiSetupSession> {
  const device = await g.navigator.bluetooth.requestDevice({
    filters: [{ services: [PROV_SERVICE] }],
  });
  const server = await device.gatt.connect();
  const svc = await server.getPrimaryService(PROV_SERVICE);

  const netChar = await svc.getCharacteristic(CHAR_NETWORKS);
  const networks = parseNetworks(new TextDecoder().decode(await netChar.readValue()));

  let statusCb: ((s: SetupStatus) => void) | null = null;
  const statusChar = await svc.getCharacteristic(CHAR_STATUS);
  await statusChar.startNotifications();
  statusChar.addEventListener('characteristicvaluechanged', (e: any) => {
    statusCb?.(new TextDecoder().decode(e.target.value) as SetupStatus);
  });

  const credsChar = await svc.getCharacteristic(CHAR_CREDS);

  return {
    deviceName: device.name ?? 'greenr sensor',
    networks,
    sendCredentials: async (ssid, password) => {
      await credsChar.writeValue(new TextEncoder().encode(`${ssid}\n${password}`));
    },
    onStatus: (cb) => { statusCb = cb; },
    disconnect: () => {
      try { device.gatt?.disconnect(); } catch { /* already gone */ }
    },
  };
}

// ------------------------------------------------------------- native ----

let bleManager: any = null;

async function startNative(): Promise<WifiSetupSession> {
  const { BleManager } = require('react-native-ble-plx');
  if (!bleManager) bleManager = new BleManager();
  const manager = bleManager;

  if (Platform.OS === 'android') {
    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
  }

  // Wait for the radio to be ready (iOS reports "Unknown" briefly on launch).
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.remove();
      reject(new Error('Bluetooth is off — turn it on in Settings and try again.'));
    }, 10000);
    const sub = manager.onStateChange((state: string) => {
      if (state === 'PoweredOn') { clearTimeout(timer); sub.remove(); resolve(); }
    }, true);
  });

  // Scan for the first sensor advertising the setup service.
  const found: any = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      manager.stopDeviceScan();
      reject(new Error('No sensor found nearby. Is it plugged in with its setup window open?'));
    }, 15000);
    manager.startDeviceScan([PROV_SERVICE], null, (error: any, d: any) => {
      if (error) { clearTimeout(timer); manager.stopDeviceScan(); reject(error); return; }
      if (d) { clearTimeout(timer); manager.stopDeviceScan(); resolve(d); }
    });
  });

  const device = await found.connect();
  await device.discoverAllServicesAndCharacteristics();

  const netChar = await device.readCharacteristicForService(PROV_SERVICE, CHAR_NETWORKS);
  const networks = parseNetworks(Buffer.from(netChar.value ?? '', 'base64').toString('utf8'));

  let statusCb: ((s: SetupStatus) => void) | null = null;
  device.monitorCharacteristicForService(PROV_SERVICE, CHAR_STATUS, (err: any, ch: any) => {
    if (ch?.value) statusCb?.(Buffer.from(ch.value, 'base64').toString('utf8') as SetupStatus);
  });

  return {
    deviceName: device.name ?? 'greenr sensor',
    networks,
    sendCredentials: async (ssid, password) => {
      const payload = Buffer.from(`${ssid}\n${password}`, 'utf8').toString('base64');
      await device.writeCharacteristicWithResponseForService(PROV_SERVICE, CHAR_CREDS, payload);
    },
    onStatus: (cb) => { statusCb = cb; },
    disconnect: () => {
      device.cancelConnection().catch(() => { /* already gone */ });
    },
  };
}
