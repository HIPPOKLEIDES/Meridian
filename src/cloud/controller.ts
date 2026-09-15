import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SyncEngine } from './engine';
import { createBindings, JOURNAL_BINDING } from './bindings';
import { getSupabase } from './client';
import { initAuth, signOut } from './auth';
import { useSession, type SessionUser } from './session';
import { SupabaseRemote } from './remote';
import { acceptEmailInvites, acceptInviteLink, refreshMemberships, roleOf, useSharing } from './sharing';
import { refreshImages, startAssetSync } from './assets';
import type { MetaStore, SyncMeta, SyncStatus } from './types';
import { flushIdb, idbDelete, idbGet, idbSet, STORES } from '../lib/idb';
import { eraseAll } from '../lib/backup';
import { useStore } from '../store';
import { useHealth } from '../health/store';
import { useFinance } from '../finance/store';
import { useNotes } from '../notes/store';
import { useGoals } from '../goals/store';
import { onJournalVaultChange, useJournal } from '../journal/store';
import { hasLocalEnvelope, useJournalLock } from '../journal/vault';
import { useAccountVault } from '../journal/account';
import { useUI } from '../ui';

/** Which account this device's local data belongs to. */
const OWNER_KEY = 'meridian:local-owner';

export interface Problem {
  key: string;
  collection: string;
  reason: string;
  at: number;
}

export type Decision = { kind: 'firstSignIn' | 'otherAccount'; accountHasData: boolean };

interface CloudState {
  status: SyncStatus;
  realtime: boolean;
  running: boolean;
  problems: Problem[];
  /** Waiting for the user to decide what happens to this device's data on sign-in. */
  decision: Decision | null;
}

export const useCloud = create<CloudState>(() => ({
  status: { phase: 'idle', pending: 0, lastSyncedAt: null, error: null },
  realtime: false,
  running: false,
  problems: [],
  decision: null,
}));

let engine: SyncEngine | null = null;
let teardown: (() => void)[] = [];
let knownProjects: Set<string> | null = null;
let userChange: Promise<void> = Promise.resolve();

function idbMeta(userId: string): MetaStore {
  const key = `meridian:sync:${userId}`;
  let latest: SyncMeta | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = async () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (latest) await idbSet(STORES.kv, key, latest);
  };
  return {
    load: async () => (await idbGet<SyncMeta>(STORES.kv, key)) ?? null,
    save: (meta) => {
      latest = meta;
      timer ??= setTimeout(() => void write(), 500);
    },
    flush: write,
  };
}

const waitForHydration = (store: { persist: { hasHydrated(): boolean; onFinishHydration(fn: () => void): () => void } }) =>
  new Promise<void>((resolve) => {
    if (store.persist.hasHydrated()) return resolve();
    const unsub = store.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });

/** Whether this device holds anything the user made (not just the built-in defaults). */
async function hasLocalData() {
  await Promise.all([waitForHydration(useNotes), waitForHydration(useGoals)]);
  const core = useStore.getState();
  const journal = useJournalLock.getState();
  return (
    core.tasks.length > 0 ||
    core.projects.length > 0 ||
    core.habits.length > 0 ||
    core.entries.length > 0 ||
    core.blocks.length > 0 ||
    useHealth.getState().measurements.length > 0 ||
    useFinance.getState().transactions.length > 0 ||
    useNotes.getState().notes.length > 0 ||
    useGoals.getState().goals.length > 0 ||
    (journal.loaded ? useJournal.getState().entries.length > 0 : await hasLocalEnvelope())
  );
}

export async function startCloud() {
  await initAuth();
  useSession.subscribe((state, prev) => {
    if (state.user?.id !== prev.user?.id) queueUserChange(state.user);
  });
  queueUserChange(useSession.getState().user);
}

function queueUserChange(user: SessionUser | null) {
  userChange = userChange.then(() => onUserChanged(user)).catch((e) => console.error('Cloud sync failed to start', e));
}

async function onUserChanged(user: SessionUser | null) {
  await stopEngine();
  useCloud.setState({ decision: null });
  if (!user) return;
  const owner = localStorage.getItem(OWNER_KEY);
  if (owner === user.id) return startEngine(user);
  if (!owner && !(await hasLocalData())) {
    localStorage.setItem(OWNER_KEY, user.id);
    return startEngine(user);
  }
  let accountHasData = false;
  try {
    accountHasData = await new SupabaseRemote(getSupabase()!).hasAnyRecords();
  } catch {
    // Offline: assume the account may have data, so nothing is overwritten by mistake.
    accountHasData = true;
  }
  useCloud.setState({ decision: { kind: owner ? 'otherAccount' : 'firstSignIn', accountHasData } });
}

/**
 * What to do with this device's data when signing in:
 * - merge: upload it into the account (the newest edit wins where both have the same item)
 * - useAccount: erase this device and download the account
 * - cancel: sign out again
 */
export async function resolveDecision(choice: 'merge' | 'useAccount' | 'cancel') {
  const user = useSession.getState().user;
  useCloud.setState({ decision: null });
  if (!user || choice === 'cancel') {
    if (user) await signOut();
    return;
  }
  if (choice === 'useAccount') await resetDevice();
  localStorage.setItem(OWNER_KEY, user.id);
  await startEngine(user);
}

/** Erases local data and sync bookkeeping (not the account). */
async function resetDevice() {
  const previous = localStorage.getItem(OWNER_KEY);
  await eraseAll();
  useAccountVault.getState().setVault(null);
  if (previous) {
    await idbDelete(STORES.kv, `meridian:sync:${previous}`);
    localStorage.removeItem(`meridian:uploaded-assets:${previous}`);
  }
  localStorage.removeItem(OWNER_KEY);
}

async function startEngine(user: SessionUser) {
  const sb = getSupabase();
  if (!sb) return;
  const remote = new SupabaseRemote(sb);
  knownProjects = null;
  const toast = useUI.getState().toast;

  const current = new SyncEngine({
    userId: user.id,
    remote,
    bindings: createBindings(),
    meta: idbMeta(user.id),
    isOnline: () => navigator.onLine,
    roleOf,
    onStatus: (status) => useCloud.setState({ status }),
    onDenied: (denied) => {
      const at = Date.now();
      useCloud.setState((s) => ({ problems: [...denied.map((d) => ({ ...d, at })), ...s.problems].slice(0, 30) }));
      toast(`${denied.length} change${denied.length === 1 ? '' : 's'} couldn’t be saved to your account. See Settings → Account.`, 'error');
    },
    onReadOnly: () => toast('You can view this project but not change it.', 'error'),
    onPushed: (records) => {
      // A newly uploaded project now has you as its owner on the server.
      if (records.some((r) => r.collection === 'project')) void syncMemberships();
    },
    onApplied: (records) => {
      if (records.some((r) => r.collection === 'note')) refreshImages();
      if (records.some((r) => r.collection === 'project')) void syncMemberships();
    },
  });
  engine = current;
  useCloud.setState({ running: true });

  try {
    const joined = await acceptEmailInvites();
    if (joined.length) toast(`You joined ${joined.length} shared project${joined.length === 1 ? '' : 's'}.`, 'unlock');
  } catch {
    // Offline or not confirmed yet; invites wait for the next start.
  }
  await syncMemberships();

  teardown.push(startAssetSync(sb, user.id, roleOf));
  teardown.push(
    onJournalVaultChange((event) => {
      if (engine !== current) return;
      if (event === 'rekeyed') current.reencodeOutbox(JOURNAL_BINDING);
      else if (event === 'replaced') void current.resync(JOURNAL_BINDING);
      // Encryption turned on/off here: fetch recent edits first, then re-upload every entry in its new form.
      else void current.syncNow().then(() => current.enqueueAll(JOURNAL_BINDING));
    }),
  );

  const channel: RealtimeChannel = sb
    .channel(`meridian:${user.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'records' }, () => current.requestSync(300))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members' }, () => void syncMemberships())
    .subscribe((status) => useCloud.setState({ realtime: status === 'SUBSCRIBED' }));
  teardown.push(() => void sb.removeChannel(channel));

  // Live updates cover most changes; polling is the fallback when the realtime connection is down.
  // Without it: every 15 s while you're looking, every minute in a background tab.
  const poll = setInterval(() => {
    const { realtime, status } = useCloud.getState();
    const visible = document.visibilityState === 'visible';
    const interval = realtime ? 120_000 : visible ? 15_000 : 60_000;
    // While syncing, or after a failure (the engine retries with backoff), leave it alone.
    if (status.phase !== 'idle' || (status.lastSyncedAt && Date.now() - status.lastSyncedAt < interval)) return;
    void current.syncNow();
    if (!realtime) void syncMemberships();
  }, 5_000);
  const onOnline = () => void current.syncNow();
  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      void current.syncNow();
      void syncMemberships();
    }
  };
  const onHide = () => void current.syncNow();
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pagehide', onHide);
  teardown.push(() => {
    clearInterval(poll);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pagehide', onHide);
  });

  await current.start();
}

async function stopEngine() {
  teardown.forEach((fn) => fn());
  teardown = [];
  if (engine) {
    engine.stop();
    engine = null;
    flushIdb();
  }
  knownProjects = null;
  useSharing.setState({ loaded: false, members: {}, invites: {} });
  useCloud.setState({ running: false, realtime: false });
}

let membershipSync: Promise<void> | null = null;

/** Reloads memberships; downloads projects you were just added to and removes ones you lost. */
export function syncMemberships(): Promise<void> {
  membershipSync ??= (async () => {
    try {
      const projects = await refreshMemberships();
      const active = engine;
      if (!active) return;
      if (knownProjects) {
        for (const id of projects) if (!knownProjects.has(id)) await active.backfillProject(id);
        for (const id of knownProjects) if (!projects.has(id)) active.dropProject(id);
      }
      knownProjects = projects;
    } catch {
      // Offline; memberships refresh on the next sync.
    } finally {
      membershipSync = null;
    }
  })();
  return membershipSync;
}

export const syncNow = () => engine?.syncNow() ?? Promise.resolve();

/**
 * Runs a bulk change (like importing a backup) with sync stopped, then restarts it. On restart the engine
 * compares everything with what it last synced: personal changes upload, and anything missing from shared
 * projects is restored from the server rather than deleted for everyone.
 */
export async function withSyncPaused<T>(fn: () => Promise<T>): Promise<T> {
  const user = useSession.getState().user;
  const wasRunning = !!engine;
  if (wasRunning) {
    await engine!.syncNow();
    await stopEngine();
  }
  try {
    return await fn();
  } finally {
    if (wasRunning && user && useSession.getState().user?.id === user.id) await startEngine(user);
  }
}

/** Joins a project from an invite link and downloads it. Returns the project id. */
export async function joinProject(token: string): Promise<string> {
  const projectId = await acceptInviteLink(token);
  await syncMemberships();
  await engine?.backfillProject(projectId);
  return projectId;
}

/** Signs out. With `removeLocalData`, also erases everything from this device (your account keeps it). */
export async function signOutOfCloud(removeLocalData: boolean) {
  await engine?.syncNow();
  await stopEngine();
  await signOut();
  if (removeLocalData) await resetDevice();
}
