/**
 * Shared contract for Ring-style sensor Wi-Fi provisioning over Bluetooth.
 * The transport is platform-split (wifiSetup.ts = web, wifiSetup.native.ts =
 * native) so the web bundle never pulls in the native BLE module; both files
 * implement the same surface using these types + helpers.
 *
 * The UUIDs must match the sensor firmware's provisioning GATT service.
 */

export const PROV_SERVICE = 'c0de0001-feed-4b1e-9d0b-c0ffee000001';
export const CHAR_NETWORKS = 'c0de0002-feed-4b1e-9d0b-c0ffee000001';
export const CHAR_CREDS = 'c0de0003-feed-4b1e-9d0b-c0ffee000001';
export const CHAR_STATUS = 'c0de0004-feed-4b1e-9d0b-c0ffee000001';

export type SetupStatus = 'waiting' | 'connecting' | 'ok' | 'fail';

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

export function parseNetworks(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((n) => typeof n === 'string');
  } catch {
    // sensor sent something unexpected; manual entry still works
  }
  return [];
}

/** True when the user closed the browser's device chooser without picking. */
export function isChooserCancelled(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'NotFoundError';
}

/**
 * Thrown when we DID reach the sensor but it isn't offering setup — i.e. it is
 * already on Wi-Fi and running normally, so it only advertises its data service.
 * The UI turns this into an explanation rather than a failure.
 */
export const ALREADY_CONFIGURED = 'GREENR_ALREADY_CONFIGURED';
export function isAlreadyConfigured(err: unknown): boolean {
  return (err as { message?: string } | null)?.message === ALREADY_CONFIGURED;
}
