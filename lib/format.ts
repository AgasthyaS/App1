/** Formatting rules (§1.7). */

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
