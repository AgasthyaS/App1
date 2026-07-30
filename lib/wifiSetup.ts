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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The device from the previous session. Chrome keeps GATT state per device, so
 * starting a second setup without tearing the first one down throws
 * "Connection already in progress" and the retry silently fails.
 */
let activeDevice: any = null;

/** Drop any previous link and give the browser a moment to release it. */
async function releaseActive(): Promise<void> {
  if (!activeDevice) return;
  try {
    if (activeDevice.gatt?.connected) activeDevice.gatt.disconnect();
  } catch {
    /* already gone */
  }
  activeDevice = null;
  await sleep(400); // Chrome needs a beat before it will accept a new connect
}

/**
 * Connect, tolerating the two states a retry runs into: a link that is already
 * open (reuse it) and one that is still tearing down ("already in progress" →
 * wait and try again).
 */
async function connectGatt(device: any): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (device.gatt?.connected) return device.gatt;
    try {
      return await device.gatt.connect();
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      const busy = /already in progress|in progress|InvalidState/i.test(msg);
      if (!busy || attempt === 3) throw e;
      await sleep(600 * (attempt + 1));
    }
  }
  throw new Error('Could not open a Bluetooth connection to the sensor.');
}

async function startWeb(): Promise<WifiSetupSession> {
  await releaseActive(); // never stack a new session on a stale one

  const device = await g.navigator.bluetooth.requestDevice({
    filters: [{ services: [PROV_SERVICE] }],
  });
  activeDevice = device;

  const server = await connectGatt(device);
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
      if (activeDevice === device) activeDevice = null;
    },
  };
}
