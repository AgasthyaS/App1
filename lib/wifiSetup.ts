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
 * WEB transport for sensor Wi-Fi provisioning (Web Bluetooth — Chrome/Edge on
 * desktop or Android; not iOS Safari). This is the default module resolution;
 * native platforms use wifiSetup.native.ts instead.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const g: any = typeof globalThis !== 'undefined' ? globalThis : {};

export { isChooserCancelled } from './wifiSetupTypes';
export type { SetupStatus, WifiSetupSession } from './wifiSetupTypes';

export const isWifiSetupSupported = typeof g.navigator?.bluetooth?.requestDevice === 'function';

export function startWifiSetup(): Promise<WifiSetupSession> {
  return startWeb();
}

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
    onStatus: (cb) => {
      statusCb = cb;
    },
    disconnect: () => {
      try {
        device.gatt?.disconnect();
      } catch {
        /* already gone */
      }
    },
  };
}
