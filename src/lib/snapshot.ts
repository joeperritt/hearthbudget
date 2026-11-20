import { useSyncExternalStore } from 'react';

/**
 * Last-known screen data per signed-in user, so the app can show it instantly
 * and refresh quietly. Every read/write is guarded; anything missing, corrupted
 * or from another format version reads as "no snapshot".
 */
export const SNAPSHOT_VERSION = 1;
const PREFIX = 'perritt-snap:';

const keyFor = (userId: string, part: string) => `${PREFIX}${userId}:${part}`;

export function readSnapshot<T>(userId: string | null | undefined, part: string): T | null {
  if (!userId) return null;
  try {
    const raw = window.localStorage.getItem(keyFor(userId, part));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== SNAPSHOT_VERSION || parsed.u !== userId || !('d' in parsed)) return null;
    return parsed.d as T;
  } catch {
    return null;
  }
}

export function writeSnapshot(userId: string | null | undefined, part: string, data: unknown) {
  if (!userId) return;
  try {
    window.localStorage.setItem(keyFor(userId, part), JSON.stringify({ v: SNAPSHOT_VERSION, u: userId, t: Date.now(), d: data }));
  } catch { /* storage full or unavailable: ignore */ }
}

/** Removes every user's snapshots (used on sign out). */
export function clearSnapshots() {
  try {
    const ls = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.startsWith(PREFIX)) keys.push(k); }
    keys.forEach(k => ls.removeItem(k));
  } catch { /* ignore */ }
}

// Quiet background-refresh indicator.
let active = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export function trackRefresh<T>(p: PromiseLike<T> | T): Promise<T> {
  active++; emit();
  return Promise.resolve(p).finally(() => { active = Math.max(0, active - 1); emit(); });
}

export function useRefreshing() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => active > 0,
    () => false,
  );
}
