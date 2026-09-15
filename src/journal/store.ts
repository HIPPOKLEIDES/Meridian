import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { DateKey, ID } from '../types';
import type { Journal, JournalData, JournalEntry } from './types';
import { uid } from '../store';
import { flushIdb, requestPersistentStorage } from '../lib/idb';
import { sound } from '../lib/sound';
import {
  closeVault,
  currentVaultInfo,
  detectLock,
  dropVault,
  encryptedSnapshot,
  hasLocalEnvelope,
  hasVaultKey,
  journalStorage,
  JOURNAL_KEY,
  markUnlocked,
  openVault,
  restoreEncrypted,
  sameVault,
  sealVault,
  setLoaded,
  switchToAccountKey,
  useJournalLock,
} from './vault';
import { isEncryptedVault, useAccountVault } from './account';
import { addDays } from '../lib/dates';

export const DEFAULT_JOURNAL_ID = 'daily';
const JOURNAL_VERSION = 1;

export const emptyJournal = (): JournalData => ({
  journals: [{ id: DEFAULT_JOURNAL_ID, name: 'Daily', color: 1, prompts: [], createdAt: 0 }],
  entries: [],
});

interface JournalActions {
  addJournal(name: string): ID;
  updateJournal(id: ID, patch: Partial<Journal>): void;
  /** Deletes the journal and its entries. The last journal can't be deleted. */
  deleteJournal(id: ID): void;
  /** Creates the day's entry if needed, then applies the patch. Empty entries are removed. */
  saveEntry(journalId: ID, date: DateKey, patch: Partial<Pick<JournalEntry, 'text' | 'mood'>>): void;
  replaceAll(data: JournalData): void;
}

export type JournalStore = JournalData & JournalActions;

export const useJournal = create<JournalStore>()(
  persist(
    (set, get) => ({
      ...emptyJournal(),

      addJournal: (name) => {
        const used = new Set(get().journals.map((j) => j.color));
        const journal: Journal = { id: uid(), name, color: [1, 2, 3, 4, 5, 6, 7, 8].find((c) => !used.has(c)) ?? 1, prompts: [], createdAt: Date.now() };
        set((s) => ({ journals: [...s.journals, journal] }));
        return journal.id;
      },
      updateJournal: (id, patch) => set((s) => ({ journals: s.journals.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),
      deleteJournal: (id) =>
        set((s) =>
          s.journals.length <= 1 ? {} : { journals: s.journals.filter((j) => j.id !== id), entries: s.entries.filter((e) => e.journalId !== id) },
        ),

      saveEntry: (journalId, date, patch) => {
        requestPersistentStorage();
        set((s) => {
          const existing = s.entries.find((e) => e.journalId === journalId && e.date === date);
          const next: JournalEntry = existing
            ? { ...existing, ...patch, updatedAt: Date.now() }
            : { id: uid(), journalId, date, text: '', mood: null, createdAt: Date.now(), updatedAt: Date.now(), ...patch };
          const empty = !next.text.trim() && next.mood === null;
          const others = s.entries.filter((e) => e !== existing);
          return { entries: empty ? others : [...others, next] };
        });
      },

      replaceAll: (data) => set({ ...emptyJournal(), ...data, journals: data.journals?.length ? data.journals : emptyJournal().journals }),
    }),
    {
      name: JOURNAL_KEY,
      version: JOURNAL_VERSION,
      storage: createJSONStorage(() => journalStorage),
      partialize: (s): JournalData => ({ journals: s.journals, entries: s.entries }),
      // Loading waits until we know whether the journal is encrypted (see below).
      skipHydration: true,
    },
  ),
);

detectLock().then(async (status) => {
  if (status !== 'plain') return;
  // Another device encrypted this account's journal: stay locked until the passphrase is entered here.
  if (isEncryptedVault(useAccountVault.getState().vault)) {
    useJournalLock.setState({ status: 'locked', loaded: false });
    return;
  }
  await useJournal.persist.rehydrate();
  setLoaded(true);
});

/** True when the journal is loaded and readable (not locked). */
export const useJournalReady = () => useJournalLock((s) => s.loaded && (s.status === 'plain' || s.status === 'unlocked'));

export const exportJournal = (): JournalData => {
  const { journals, entries } = useJournal.getState();
  return { journals, entries };
};

const persistedJson = () => JSON.stringify({ state: exportJournal(), version: JOURNAL_VERSION });

/** Writes the current journal right away (used after the encryption setting changes). */
async function saveNow() {
  await journalStorage.setItem(JOURNAL_KEY, persistedJson());
  flushIdb();
}

type VaultEvent = 'encrypted' | 'decrypted' | 'rekeyed' | 'replaced';
const vaultListeners = new Set<(event: VaultEvent) => void>();

/** Cloud sync listens here to re-upload journal records when the encryption changes. */
export function onJournalVaultChange(fn: (event: VaultEvent) => void) {
  vaultListeners.add(fn);
  return () => void vaultListeners.delete(fn);
}
const emitVault = (event: VaultEvent) => vaultListeners.forEach((fn) => fn(event));

/** The passphrase opens this device's journal but not the account's (or the other way round). */
export class JournalKeyMismatch extends Error {
  constructor(readonly opensAccount: boolean) {
    super(
      opensAccount
        ? 'That passphrase opens your account’s journal, but this device’s copy was encrypted with a different one.'
        : 'That passphrase opens this device’s journal, but your account’s journal uses a different one. Enter the passphrase you set on your other device.',
    );
  }
}

export async function unlockJournal(passphrase: string) {
  const account = useAccountVault.getState().vault;
  const localEnvelope = await hasLocalEnvelope();
  let switched = false;

  if (localEnvelope) {
    try {
      await openVault(passphrase);
    } catch (e) {
      // Maybe it's the account's passphrase and this device's copy is stale.
      if (isEncryptedVault(account) && (await switchToAccountKey(passphrase, account))) {
        await closeVault();
        throw new JournalKeyMismatch(true);
      }
      throw e;
    }
    await useJournal.persist.rehydrate();
    if (isEncryptedVault(account) && !sameVault(account)) {
      if (!(await switchToAccountKey(passphrase, account))) {
        await closeVault();
        useJournal.setState(emptyJournal());
        throw new JournalKeyMismatch(false);
      }
      switched = true;
    }
  } else {
    // This device's copy is unencrypted; adopt the account's key.
    if (!isEncryptedVault(account)) throw new Error('The journal is not encrypted');
    if (!(await switchToAccountKey(passphrase, account))) throw new Error('That passphrase didn’t work');
    await useJournal.persist.rehydrate();
    switched = true;
  }

  setLoaded(true);
  markUnlocked();
  if (switched) {
    await saveNow();
    emitVault('rekeyed');
  }
  sound('unlock');
  await reconcileVault();
}

/** Discards this device's journal and starts from the account's copy (after a key mismatch). */
export async function replaceJournalWithAccount(passphrase: string) {
  const account = useAccountVault.getState().vault;
  if (!isEncryptedVault(account) || !(await switchToAccountKey(passphrase, account))) throw new Error('That passphrase didn’t work');
  useJournal.setState(emptyJournal());
  setLoaded(true);
  markUnlocked();
  await saveNow();
  emitVault('replaced');
  sound('unlock');
}

const beforeLock = new Set<() => void>();

/** Registers a callback that saves unsaved edits right before the journal locks. */
export function onBeforeLock(fn: () => void) {
  beforeLock.add(fn);
  return () => void beforeLock.delete(fn);
}

/** Saves any unsaved typing, then clears the journal from memory. */
export async function lockJournal() {
  beforeLock.forEach((fn) => fn());
  await closeVault();
  useJournal.setState(emptyJournal());
  sound('lock');
}

/** Turns on encryption, or sets a new passphrase if it's already on. Applies to all your devices when signed in. */
export async function encryptJournal(passphrase: string) {
  await sealVault(passphrase);
  await saveNow();
  useAccountVault.getState().setVault(currentVaultInfo());
  emitVault('encrypted');
}

/** Turns encryption off. `fromAccount`: another device already did, so there's nothing to re-upload. */
export async function decryptJournal(fromAccount = false) {
  dropVault();
  await saveNow();
  if (fromAccount) return;
  useAccountVault.getState().setVault({ off: true });
  emitVault('decrypted');
}

let reconciling = false;

/** Brings this device in line with the account's encryption setting (which may have changed on another device). */
export async function reconcileVault() {
  if (reconciling) return;
  reconciling = true;
  try {
    const { status, loaded } = useJournalLock.getState();
    const account = useAccountVault.getState().vault;
    if (status === 'checking') return;
    if (isEncryptedVault(account)) {
      if ((status === 'plain' && loaded) || (status === 'unlocked' && !sameVault(account))) await lockJournal();
    } else if (account && 'off' in account) {
      if (status === 'unlocked') await decryptJournal(true);
    } else if (status === 'unlocked' && hasVaultKey()) {
      // Encrypted here before the account knew: publish this device's setting.
      useAccountVault.getState().setVault(currentVaultInfo());
    }
  } finally {
    reconciling = false;
  }
}

useAccountVault.subscribe((state, prev) => {
  if (state.vault !== prev.vault) void reconcileVault();
});

/** For backups: the journal stays encrypted if it is encrypted here. */
export async function exportJournalForBackup(): Promise<{ journal?: JournalData; journalEncrypted?: string }> {
  const encrypted = await encryptedSnapshot(persistedJson);
  return encrypted ? { journalEncrypted: encrypted } : { journal: exportJournal() };
}

export async function importJournalFromBackup(data: { journal?: JournalData; journalEncrypted?: string }) {
  if (data.journalEncrypted) {
    await restoreEncrypted(data.journalEncrypted);
    useJournal.setState(emptyJournal());
  } else if (data.journal) {
    resetJournal(data.journal);
  }
}

/** Replaces the journal with unencrypted data (samples, erase, plain backups). */
export function resetJournal(data: JournalData = emptyJournal()) {
  dropVault();
  useJournal.getState().replaceAll(data);
  setLoaded(true);
}

export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

export const tagsIn = (text: string) => [...new Set([...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1].toLowerCase()))];

/** Consecutive days with writing, ending today (or yesterday if today is still blank). */
export function journalStreak(entries: JournalEntry[], today: DateKey): number {
  const days = new Set(entries.filter((e) => e.text.trim()).map((e) => e.date));
  let day = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

/** Built-in prompts for a blank page, rotated by date so they change day to day. */
export const PROMPTS = [
  "What's taking up the most space in your head right now?",
  'What went well today, even something small?',
  'What drained you today, and what gave you energy?',
  "What's something you're avoiding? Why?",
  'If today had a headline, what would it be?',
  'What would make tomorrow a good day?',
  'Who did you connect with today? How did it feel?',
  'What are you grateful for right now?',
  "What's a worry you can let go of, and what's one you should act on?",
  'What did you learn about yourself this week?',
];
