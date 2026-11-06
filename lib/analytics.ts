import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';

import { supabase } from './supabase';

/**
 * USAGE ANALYTICS — how often people open and tap things.
 *
 * Two event kinds, both plain counters:
 *
 *   screen:<route>   recorded automatically whenever a route is shown
 *                    (route *templates* — "plant/[id]", never the id itself)
 *   tap:<area.thing> recorded when a pressable with a `track` name is pressed
 *
 * Every event is counted on the device (the Usage screen reads these) and, when
 * Supabase is configured, queued and uploaded in small batches to the
 * `analytics_events` table (supabase-analytics.sql).
 *
 * ──────────────────────────── WHAT IS NEVER SENT ────────────────────────────
 *
 * No plant names, notes, photos, emails, coordinates or free text. Names must
 * match a strict slug pattern and props are limited to a few short primitives,
 * so a careless call site cannot leak something it shouldn't. The whole thing
 * is gated on Settings → Usage analytics; turning that off discards anything
 * queued and stops every write immediately.
 */

const COUNTS_KEY = 'greenr.usage.v1';
const INSTALL_KEY = 'greenr.install.v1';
const TABLE = 'analytics_events';

/** Same pattern the table's check constraint enforces — a bad name would reject the whole batch. */
const NAME_RE = /^[a-z0-9_.:/\[\]-]{1,80}$/;
const MAX_PROPS = 6;
const MAX_PROP_LEN = 60;
const FLUSH_EVERY_MS = 30_000;
const FLUSH_AT = 25;
/** Offline for a long time? Keep the newest events, not an unbounded queue. */
const MAX_QUEUE = 500;
/** Events recorded before consent is known (first frames after launch). */
const MAX_PENDING = 50;
/** Consecutive failed uploads before the queued batch is given up on. */
const MAX_FAILURES = 5;

export type EventProps = Record<string, string | number | boolean>;

export interface UsageCount {
  n: number;
  /** ISO timestamp of the most recent occurrence */
  last: string;
}

export interface LocalUsage {
  /** when this device started counting */
  since: string;
  counts: Record<string, UsageCount>;
}

export interface GlobalUsageRow {
  name: string;
  total: number;
  /** distinct signed-in users + signed-out installs */
  people: number;
  last_at: string;
}

interface QueuedEvent {
  name: string;
  props: EventProps;
  occurred_at: string;
}

/** null until the store hydrates and we know whether the user opted out. */
let consent: boolean | null = null;
let userId: string | null = null;
let installId: string | null = null;
let local: LocalUsage = { since: new Date().toISOString(), counts: {} };
let loaded = false;
let pending: QueuedEvent[] = [];
let queue: QueuedEvent[] = [];
let flushing = false;
let failures = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let lastUpload: { at: string; ok: boolean; error?: string } | null = null;

const appVersion = Constants.expoConfig?.version ?? 'unknown';

function randomId(): string {
  const bytes = new Uint8Array(12);
  const c = (globalThis as any).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const loading: Promise<void> = (async () => {
  // Static web export prerenders in Node — there's no storage to read there.
  if (Platform.OS === 'web' && typeof window === 'undefined') return;
  try {
    const [rawCounts, rawInstall] = await Promise.all([
      AsyncStorage.getItem(COUNTS_KEY),
      AsyncStorage.getItem(INSTALL_KEY),
    ]);
    if (rawCounts) {
      const saved = JSON.parse(rawCounts) as LocalUsage;
      // Merge, so anything counted in the first frames isn't lost.
      for (const [k, v] of Object.entries(local.counts)) {
        const prev = saved.counts[k];
        saved.counts[k] = { n: (prev?.n ?? 0) + v.n, last: v.last };
      }
      local = saved;
    }
    installId = rawInstall ?? randomId();
    if (!rawInstall) AsyncStorage.setItem(INSTALL_KEY, installId).catch(() => {});
  } catch {
    installId = installId ?? randomId();
  } finally {
    loaded = true;
    if (Object.keys(local.counts).length) persistSoon(); // save anything counted while loading
  }
})();

function sanitizeProps(props?: EventProps): EventProps {
  if (!props) return {};
  const out: EventProps = {};
  for (const [k, v] of Object.entries(props).slice(0, MAX_PROPS)) {
    if (!/^[a-z0-9_]{1,24}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, MAX_PROP_LEN);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

function persistSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    AsyncStorage.setItem(COUNTS_KEY, JSON.stringify(local)).catch(() => {});
  }, 1000);
}

function record(ev: QueuedEvent) {
  const prev = local.counts[ev.name];
  local.counts[ev.name] = { n: (prev?.n ?? 0) + 1, last: ev.occurred_at };
  if (loaded) persistSoon();
  if (!supabase) return;
  queue.push(ev);
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  if (queue.length >= FLUSH_AT) flush();
}

/**
 * Count one occurrence of `name`. Safe to call anywhere, any time — it never
 * throws, never awaits, and is a no-op once the user has opted out.
 */
export function track(name: string, props?: EventProps): void {
  if (consent === false) return;
  if (!NAME_RE.test(name)) {
    if (__DEV__) console.warn(`[analytics] dropped invalid event name "${name}"`);
    return;
  }
  const ev: QueuedEvent = { name, props: sanitizeProps(props), occurred_at: new Date().toISOString() };
  if (consent === null) {
    if (pending.length < MAX_PENDING) pending.push(ev);
    return;
  }
  record(ev);
}

/** Records a route view. `segments` come from expo-router's useSegments(). */
export function trackScreen(segments: readonly string[]): void {
  const route = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')'))).join('/');
  track(`screen:${route || 'home'}`);
}

/**
 * A browser's Global Privacy Control signal is honoured as an opt-out on the
 * web, whatever the in-app setting says (the Privacy Policy promises this).
 */
export function globalPrivacyControl(): boolean {
  return Platform.OS === 'web' && typeof navigator !== 'undefined' && (navigator as any).globalPrivacyControl === true;
}

/** Applies the user's choice. Off discards everything not yet uploaded. */
export function setAnalyticsEnabled(on: boolean): void {
  consent = on && !globalPrivacyControl();
  if (consent) {
    const early = pending;
    pending = [];
    early.forEach(record);
    startTimers();
  } else {
    pending = [];
    queue = [];
    stopTimers();
  }
}

/** Only used to scope "delete my events" and the admin summary to an account. */
export function setAnalyticsUser(id: string | null): void {
  userId = id;
}

/** Uploads queued events. A failed batch is retried a few times, then dropped. */
export async function flush(): Promise<void> {
  if (!supabase || flushing || consent !== true || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, queue.length);
  await loading;
  try {
    const { error } = await supabase.from(TABLE).insert(
      batch.map((e) => ({
        // No user_id: the table defaults it to auth.uid(), i.e. whoever holds the
        // session at upload time. Sending the recorder's id instead would be
        // rejected by RLS after a sign-out, and the batch would block the queue.
        install_id: installId,
        name: e.name,
        props: e.props,
        platform: Platform.OS,
        app_version: appVersion,
        occurred_at: e.occurred_at,
      })),
    );
    if (error) throw error;
    failures = 0;
    lastUpload = { at: new Date().toISOString(), ok: true };
  } catch (e: any) {
    // Offline is worth waiting out; a batch the server keeps refusing is not.
    const offline = /network|fetch|timeout/i.test(e?.message ?? '');
    if (offline || ++failures < MAX_FAILURES) queue = [...batch, ...queue].slice(-MAX_QUEUE);
    else failures = 0;
    lastUpload = { at: new Date().toISOString(), ok: false, error: e?.message ?? String(e) };
  } finally {
    flushing = false;
  }
}

let appStateSub: { remove: () => void } | null = null;

function startTimers() {
  if (!flushTimer) flushTimer = setInterval(flush, FLUSH_EVERY_MS);
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') flush(); // backgrounded — the OS may not give us another chance
    });
  }
}

function stopTimers() {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  appStateSub?.remove();
  appStateSub = null;
}

/** This device's counters, for the Usage screen. */
export async function getLocalUsage(): Promise<LocalUsage> {
  await loading;
  return { since: local.since, counts: { ...local.counts } };
}

export function uploadStatus(): { queued: number; last: typeof lastUpload; configured: boolean } {
  return { queued: queue.length, last: lastUpload, configured: !!supabase };
}

/** Wipes this device's counters and queue (fresh install id too). */
export async function clearLocalUsage(): Promise<void> {
  await loading;
  local = { since: new Date().toISOString(), counts: {} };
  queue = [];
  pending = [];
  installId = randomId();
  await Promise.all([
    AsyncStorage.removeItem(COUNTS_KEY),
    AsyncStorage.setItem(INSTALL_KEY, installId),
  ]).catch(() => {});
}

/** Deletes every event uploaded under the signed-in account. */
export async function deleteMyUploadedUsage(): Promise<{ error: string | null }> {
  if (!supabase || !userId) return { error: null };
  const { error } = await supabase.from(TABLE).delete().eq('user_id', userId);
  return { error: error?.message ?? null };
}

/**
 * Totals across every user. Only answers for accounts listed in
 * `analytics_admins`; everyone else gets null and sees just their own device.
 */
export async function fetchGlobalUsage(days: number): Promise<GlobalUsageRow[] | null> {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase.rpc('analytics_summary', { p_days: days });
  if (error || !Array.isArray(data)) return null;
  return data.map((r: any) => ({ ...r, total: Number(r.total), people: Number(r.people) }));
}
