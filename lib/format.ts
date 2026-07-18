/** Formatting rules (§1.7). */

import type { TimelineEvent } from './types';

/**
 * The TRUE age of a timeline event in days. Events are written once with
 * `daysAgo` frozen at creation (usually 0), so reading that field directly
 * makes everything look like "today" forever — and breaks any "recent?" check
 * built on it. This derives the real age from the creation timestamp: the `at`
 * field when present, else the epoch-ms the app embeds in ids ("tl-<ms>"),
 * else the stored daysAgo (seeded demo events carry authored ages).
 */
export function eventDaysAgo(e: TimelineEvent, now = Date.now()): number {
  if (e.at) {
    const t = new Date(e.at).getTime();
    if (Number.isFinite(t)) return Math.max(0, (now - t) / 86400000);
  }
  const m = /^tl-(\d{12,})$/.exec(e.id);
  if (m) return Math.max(0, (now - Number(m[1])) / 86400000);
  return e.daysAgo;
}

export function relTime(minsAgo: number): string {
  if (minsAgo < 60) return `${Math.round(minsAgo)} min ago`;
  if (minsAgo < 24 * 60) return `${Math.round(minsAgo / 60)} h ago`;
  const d = new Date(Date.now() - minsAgo * 60000);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function daysAgoLabel(daysAgo: number): string {
  if (daysAgo < 1) return `${Math.max(1, Math.round(daysAgo * 24))} h ago`;
  if (daysAgo < 2) return 'Yesterday';
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Thu AM" style label for a projected date n days out. */
export function forecastLabel(inDays: number): string {
  const d = new Date(Date.now() + inDays * 86400000);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const frac = inDays % 1;
  return `${weekday} ${frac < 0.5 ? 'AM' : 'PM'}`;
}

export function clockNow(): string {
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function signalWord(dbm: number): 'Strong' | 'OK' | 'Weak' {
  if (dbm >= -60) return 'Strong';
  if (dbm >= -70) return 'OK';
  return 'Weak';
}

export function dliWord(dli: number): string {
  if (dli >= 6) return 'direct sun';
  if (dli >= 3) return 'bright indirect';
  if (dli >= 1.5) return 'medium light';
  return 'low light';
}
