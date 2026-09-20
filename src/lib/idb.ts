import { useEffect, useState } from 'react';
import type { StateStorage } from 'zustand/middleware';

/**
 * Minimal IndexedDB access. Notes and images live here instead of localStorage,
 * which browsers cap at around 5 MB per site.
 */
const DB_NAME = 'meridian';
const VERSION = 1;
export const STORES = { kv: 'kv', assets: 'assets' } as const;
type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of Object.values(STORES)) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

const wrap = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function idbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).put(value, key));
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

export async function idbKeys(store: StoreName): Promise<string[]> {
  const db = await open();
  return (await wrap(db.transaction(store).objectStore(store).getAllKeys())).map(String);
}

export async function idbClear(store: StoreName): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).clear());
}

/** Ask the browser not to evict this site's storage under disk pressure (a no-op where unsupported). */
export function requestPersistentStorage() {
  navigator.storage?.persist?.().catch(() => undefined);
}

/**
 * IndexedDB-backed storage for zustand's persist middleware. Writes are debounced (typing would otherwise
 * re-serialize the whole store on every keystroke) and flushed when the tab is hidden or closed.
 */
const queued = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function flushIdb() {
  if (timer) clearTimeout(timer);
  timer = null;
  for (const [key, value] of queued) idbSet(STORES.kv, key, value).catch((e) => console.error(`Saving ${key} failed`, e));
  queued.clear();
}
// Guarded so the stores can also be imported outside a browser (tests, tooling).
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushIdb);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushIdb());
}

export const idbStateStorage: StateStorage = {
  getItem: async (name) => (await idbGet<string>(STORES.kv, name)) ?? null,
  setItem: (name, value) => {
    queued.set(name, value);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flushIdb, 400);
  },
  removeItem: (name) => idbDelete(STORES.kv, name),
};

interface Hydratable {
  persist: { hasHydrated: () => boolean; onFinishHydration: (fn: () => void) => () => void };
}

/** True once a store persisted in IndexedDB has finished loading. */
export function useHydrated(store: Hydratable) {
  const [ready, setReady] = useState(() => store.persist.hasHydrated());
  useEffect(() => {
    if (ready) return;
    const unsub = store.persist.onFinishHydration(() => setReady(true));
    if (store.persist.hasHydrated()) setReady(true);
    return unsub;
  }, [ready, store]);
  return ready;
}
