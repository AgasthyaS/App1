import { Buffer } from 'buffer';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

import {
  CHAR_CREDS,
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
      if (state === 'PoweredOn') {
        clearTimeout(timer);
        sub.remove();
        resolve();
      }
    }, true);
  });

  // Scan for the first sensor advertising the setup service.
  const found: any = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      manager.stopDeviceScan();
      reject(new Error('No sensor found nearby. Is it plugged in with its setup window open?'));
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
