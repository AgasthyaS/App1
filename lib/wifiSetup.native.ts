import { Buffer } from 'buffer';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

import {
  CHAR_CREDS,
  CHAR_DEVICE,
  CHAR_NETWORKS,
  CHAR_STATUS,
  PROV_SERVICE,
  parseNetworks,
  type SetupStatus,
  type WifiSetupSession,
} from './wifiSetupTypes';

/**
 * NATIVE transport for sensor Wi-Fi provisioning (react-native-ble-plx; needs a
 * dev/production build, not Expo Go). Isolated in this .native file so the web
 * bundle never imports the BLE module.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export { isChooserCancelled } from './wifiSetupTypes';
export type { SetupStatus, WifiSetupSession } from './wifiSetupTypes';

export const isWifiSetupSupported = NativeModules.BlePlx != null; // present in dev builds, absent in Expo Go

let bleManager: any = null;

export function startWifiSetup(): Promise<WifiSetupSession> {
  return startNative();
}

async function startNative(): Promise<WifiSetupSession> {
  const { BleManager } = require('react-native-ble-plx');
  if (!bleManager) bleManager = new BleManager();
  const manager = bleManager;

  if (Platform.OS === 'android') {
    // BLUETOOTH_SCAN/CONNECT cover Android 12+; ACCESS_FINE_LOCATION is what
    // older Android needs to allow a BLE scan. Request all and confirm the user
    // actually granted enough to scan, so a denial becomes a clear message
    // instead of a cryptic scan failure later.
    const res = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    const granted = PermissionsAndroid.RESULTS.GRANTED;
    const canScan =
      res[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === granted ||
      res[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === granted;
    if (!canScan) {
      throw new Error(
        'Greenr needs Bluetooth permission to find your sensor. Turn it on in Settings → Apps → Greenr → Permissions, then try again.',
      );
    }
  }

  // Wait for the radio to be ready (iOS reports "Unknown" briefly on launch).
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.remove();
      reject(new Error('Bluetooth is off — turn it on in Settings and try again.'));
    }, 10000);
    const sub = manager.onStateChange((state: string) => {
      if (state === 'PoweredOn') {
        clearTimeout(timer);
        sub.remove();
        resolve();
      }
    }, true);
  });

  // Clear any half-open link from a previous attempt BEFORE scanning. Without
  // this, a sensor the phone still thinks it's connected to makes the next
  // connect fail with "Bluetooth is busy with an earlier connection" — and no
  // amount of waiting fixes it, because nothing ever closed the old link.
  try {
    manager.stopDeviceScan();
    const stale = await manager.connectedDevices([PROV_SERVICE]);
    for (const d of stale ?? []) await manager.cancelDeviceConnection(d.id).catch(() => {});
  } catch {
    // nothing connected (or the platform doesn't support the query) — fine
  }

  // Scan for the first sensor advertising the setup service.
  const found: any = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      manager.stopDeviceScan();
      reject(new Error('No sensor found nearby. Is it powered on and in setup mode?'));
    }, 15000);
    manager.startDeviceScan([PROV_SERVICE], null, (error: any, d: any) => {
      if (error) {
        clearTimeout(timer);
        manager.stopDeviceScan();
        reject(error);
        return;
      }
      if (d) {
        clearTimeout(timer);
        manager.stopDeviceScan();
        resolve(d);
      }
    });
  });

  // Connect, retrying once through a forced disconnect — this is the exact case
  // that produced the stuck "busy" state users couldn't get out of.
  let device: any;
  try {
    device = await found.connect();
  } catch {
    await manager.cancelDeviceConnection(found.id).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    device = await found.connect();
  }
  await device.discoverAllServicesAndCharacteristics();

  const netChar = await device.readCharacteristicForService(PROV_SERVICE, CHAR_NETWORKS);
  const networks = parseNetworks(Buffer.from(netChar.value ?? '', 'base64').toString('utf8'));

  // The device's identity (firmware v8+), so we can claim it with no QR. Older
  // firmware won't have this characteristic — ignore and fall back to the QR.
  let deviceId: string | undefined;
  let deviceKey: string | undefined;
  try {
    const idChar = await device.readCharacteristicForService(PROV_SERVICE, CHAR_DEVICE);
    const [id, key] = Buffer.from(idChar.value ?? '', 'base64').toString('utf8').split('\n');
    if (id && key) { deviceId = id.trim(); deviceKey = key.trim(); }
  } catch {
    // no identity characteristic — the QR/code path still works
  }

  let statusCb: ((s: SetupStatus) => void) | null = null;
  device.monitorCharacteristicForService(PROV_SERVICE, CHAR_STATUS, (err: any, ch: any) => {
    if (ch?.value) statusCb?.(Buffer.from(ch.value, 'base64').toString('utf8') as SetupStatus);
  });

  return {
    deviceName: device.name ?? 'greenr sensor',
    deviceId,
    deviceKey,
    networks,
    sendCredentials: async (ssid, password) => {
      const payload = Buffer.from(`${ssid}\n${password}`, 'utf8').toString('base64');
      await device.writeCharacteristicWithResponseForService(PROV_SERVICE, CHAR_CREDS, payload);
    },
    onStatus: (cb) => {
      statusCb = cb;
    },
    disconnect: () => {
      device.cancelConnection().catch(() => {
        /* already gone */
      });
    },
  };
}
