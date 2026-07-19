import { Buffer } from 'buffer';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

import {
  CHAR_ACK,
  CHAR_DATA,
  DATA_SERVICE,
  parseBatch,
  uploadBatch,
  type SyncResult,
} from './bleGatewayTypes';

/**
 * NATIVE implementation of the phone-as-gateway sync (react-native-ble-plx).
 *
 * This is the real "home gateway": while the app is alive it periodically scans
 * for nearby Greenr sensors advertising the data service, connects, drains the
 * buffer to the cloud, and ACKs so the sensor can skip its Wi-Fi fallback.
 *
 * Honest limitation: true always-on background scanning (app fully closed) needs
 * platform background-execution entitlements (iOS restricts this heavily). This
 * covers foreground + backgrounded-alive; the sensor's own Wi-Fi fallback
 * guarantees no data is lost regardless.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const isSupported = NativeModules.BlePlx != null;
export const supportsBackground = true;

let bleManager: any = null;
let scanning = false;

async function ensureManager(): Promise<any> {
  const { BleManager } = require('react-native-ble-plx');
  if (!bleManager) bleManager = new BleManager();
  if (Platform.OS === 'android') {
    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
  }
  return bleManager;
}

/** Drain one connected sensor's buffer to the cloud. */
async function drain(device: any): Promise<SyncResult | null> {
  const dev = await device.connect();
  await dev.discoverAllServicesAndCharacteristics();
  let uploaded = 0;
  let deviceId = '';
  for (let i = 0; i < 16; i++) {
    const ch = await dev.readCharacteristicForService(DATA_SERVICE, CHAR_DATA);
    const batch = parseBatch(Buffer.from(ch.value ?? '', 'base64').toString('utf8'));
    if (!batch || batch.rows.length === 0) break;
    deviceId = batch.dev;
    const n = await uploadBatch(batch);
    const ack = Buffer.from(String(batch.rows.length), 'utf8').toString('base64');
    await dev.writeCharacteristicWithResponseForService(DATA_SERVICE, CHAR_ACK, ack);
    uploaded += n;
    if (batch.rows.length < 8) break;
  }
  await dev.cancelConnection().catch(() => {});
  return deviceId ? { deviceId, uploaded } : null;
}

/** Scan for a fixed window, sync every Greenr sensor found (deduped). */
export async function syncNow(windowMs = 8000): Promise<SyncResult[]> {
  const manager = await ensureManager();
  const seen = new Set<string>();
  const results: SyncResult[] = [];

  await new Promise<void>((resolve) => {
    scanning = true;
    const timer = setTimeout(() => { manager.stopDeviceScan(); scanning = false; resolve(); }, windowMs);
    manager.startDeviceScan([DATA_SERVICE], null, async (error: any, device: any) => {
      if (error) { clearTimeout(timer); manager.stopDeviceScan(); scanning = false; resolve(); return; }
      if (!device || seen.has(device.id)) return;
      seen.add(device.id);
      try {
        const r = await drain(device);
        if (r) results.push(r);
      } catch { /* try again next window */ }
    });
  });
  return results;
}

let loopTimer: any = null;
/** Start the periodic home gateway (every ~15 min while the app is alive). */
export function startGateway(): void {
  if (loopTimer) return;
  const tick = () => { syncNow().catch(() => {}); };
  tick();
  loopTimer = setInterval(tick, 15 * 60 * 1000);
}
export function stopGateway(): void {
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
  if (scanning && bleManager) { try { bleManager.stopDeviceScan(); } catch { /* ignore */ } scanning = false; }
}
