import { create } from 'zustand';
import type { StateStorage } from 'zustand/middleware';
import { flushIdb, idbGet, idbSet, idbStateStorage, STORES } from '../lib/idb';
import { decryptString, deriveKey, encryptString, envelopeSalt, fromB64, parseEnvelope, PBKDF2_ITERATIONS, randomSalt, toB64, type Envelope } from './crypto';
import { NotReadableYet } from '../cloud/types';

/**
 * Lock state for the journal.
 * - checking: reading storage at startup
 * - plain: not encrypted
 * - locked: encrypted, no key in memory. Nothing is loaded and every write is refused.
 * - unlocked: encrypted, key in memory for this tab only (never persisted)
 */
export type LockStatus = 'checking' | 'plain' | 'locked' | 'unlocked';

export const useJournalLock = create<{ status: LockStatus; /** The store holds the real journal (not the empty placeholder). */ loaded: boolean }>(() => ({
  status: 'checking',
  loaded: false,
}));

export const setLoaded = (loaded: boolean) => useJournalLock.setState({ loaded });

export const JOURNAL_KEY = 'meridian:journal';

interface Session {
  key: CryptoKey;
  salt: Uint8Array;
  iterations: number;
  /** A small ciphertext used to check a re-entered passphrase without touching the journal itself. */
  check: Envelope;
}

let session: Session | null = null;
let seq = 0;
let pending: Promise<void> = Promise.resolve();

const setStatus = (status: LockStatus) => useJournalLock.setState({ status });
const isWritable = () => {
  const { status } = useJournalLock.getState();
  return status === 'plain' || status === 'unlocked';
};

/** Persist storage for the journal: transparently encrypts while a session key exists. */
export const journalStorage: StateStorage = {
  getItem: async (name) => {
    const raw = (await idbGet<string>(STORES.kv, name)) ?? null;
    const env = parseEnvelope(raw);
    if (!env) return raw;
    if (!session) throw new Error('The journal is locked');
    return decryptString(session.key, env);
  },
  setItem: (name, value) => {
    if (!isWritable()) return;
    const n = ++seq;
    const s = session;
    if (!s) {
      idbStateStorage.setItem(name, value);
      return;
    }
    // Encryption is async; only the newest snapshot is written, so an older one can't land last.
    const job = encryptString(s.key, s.salt, s.iterations, value).then((env) => {
      if (n === seq) idbStateStorage.setItem(name, JSON.stringify(env));
    });
    pending = pending.then(() => job);
    return job;
  },
  removeItem: (name) => idbStateStorage.removeItem(name),
};

/** Reads storage once at startup to see whether the journal is encrypted. */
export async function detectLock(): Promise<LockStatus> {
  const env = parseEnvelope(await idbGet<string>(STORES.kv, JOURNAL_KEY));
  const status: LockStatus = env ? 'locked' : 'plain';
  setStatus(status);
  return status;
}

async function startSession(passphrase: string, salt: Uint8Array, iterations: number): Promise<Session> {
  const key = await deriveKey(passphrase, salt, iterations);
  return { key, salt, iterations, check: await encryptString(key, salt, iterations, 'meridian') };
}

/**
 * Derives the key and verifies it against what's stored. The status stays `locked` so the caller can
 * reload the store before anything is allowed to write; call `markUnlocked` afterwards.
 */
export async function openVault(passphrase: string): Promise<void> {
  const env = parseEnvelope(await idbGet<string>(STORES.kv, JOURNAL_KEY));
  if (!env) throw new Error('The journal is not encrypted');
  const key = await deriveKey(passphrase, envelopeSalt(env), env.iterations);
  try {
    await decryptString(key, env);
  } catch {
    throw new Error('That passphrase didn’t work');
  }
  session = { key, salt: envelopeSalt(env), iterations: env.iterations, check: await encryptString(key, envelopeSalt(env), env.iterations, 'meridian') };
}

export const markUnlocked = () => setStatus('unlocked');

/** Turns encryption on, or changes the passphrase. The caller then re-saves the journal. */
export async function sealVault(passphrase: string) {
  session = await startSession(passphrase, randomSalt(), PBKDF2_ITERATIONS);
  setStatus('unlocked');
}

export async function verifyPassphrase(passphrase: string): Promise<boolean> {
  if (!session) return false;
  try {
    const key = await deriveKey(passphrase, session.salt, session.iterations);
    await decryptString(key, session.check);
    return true;
  } catch {
    return false;
  }
}

/** Waits for in-flight encrypted saves, writes them, then forgets the key. */
export async function closeVault() {
  await pending;
  flushIdb();
  seq++;
  session = null;
  useJournalLock.setState({ status: 'locked', loaded: false });
}

/** Removes encryption (after the caller verified the passphrase), or resets for erase/sample/import. */
export function dropVault() {
  seq++;
  session = null;
  setStatus('plain');
}

/** The stored journal as an encrypted envelope, for backups. Null when the journal isn't encrypted. */
export async function encryptedSnapshot(plainPersisted: () => string): Promise<string | null> {
  const { status } = useJournalLock.getState();
  if (status === 'plain' || status === 'checking') return null;
  if (session) return JSON.stringify(await encryptString(session.key, session.salt, session.iterations, plainPersisted()));
  return (await idbGet<string>(STORES.kv, JOURNAL_KEY)) ?? null;
}

/** Replaces the stored journal with an encrypted backup and locks it. */
export async function restoreEncrypted(raw: string) {
  if (!parseEnvelope(raw)) throw new Error('The encrypted journal in this backup is unreadable');
  await pending;
  flushIdb();
  seq++;
  session = null;
  useJournalLock.setState({ status: 'locked', loaded: false });
  await idbSet(STORES.kv, JOURNAL_KEY, raw);
}

// ───────── Account-wide vault (for cloud sync) ─────────

/**
 * What another device needs to open this account's journal: the key-derivation salt and a check value
 * encrypted with the key. Never the key or the passphrase.
 */
export interface VaultInfo {
  salt: string;
  iterations: number;
  check: Envelope;
}

export const hasVaultKey = () => session !== null;

export const sameVault = (info: VaultInfo) => !!session && toB64(session.salt) === info.salt;

export function currentVaultInfo(): VaultInfo | null {
  return session ? { salt: toB64(session.salt), iterations: session.iterations, check: session.check } : null;
}

/** Switches the key to another device's vault if the passphrase opens it. Doesn't change the lock status. */
export async function switchToAccountKey(passphrase: string, info: VaultInfo): Promise<boolean> {
  const salt = fromB64(info.salt);
  const key = await deriveKey(passphrase, salt, info.iterations);
  try {
    await decryptString(key, info.check);
  } catch {
    return false;
  }
  await pending;
  seq++;
  session = { key, salt, iterations: info.iterations, check: info.check };
  return true;
}

export async function hasLocalEnvelope() {
  return parseEnvelope(await idbGet<string>(STORES.kv, JOURNAL_KEY)) !== null;
}

/** Encrypts one synced record with the vault key. */
export async function sealJson(value: unknown): Promise<Envelope> {
  const s = session;
  if (!s) throw new Error('The journal is locked');
  return encryptString(s.key, s.salt, s.iterations, JSON.stringify(value));
}

/** Decrypts one synced record, or throws NotReadableYet if the journal is locked or uses another key. */
export async function openJson(env: Envelope): Promise<unknown> {
  const s = session;
  if (!s || env.salt !== toB64(s.salt)) throw new NotReadableYet('The journal is locked');
  return JSON.parse(await decryptString(s.key, env));
}
