import type { Binding, CloudRecord, Collection, MetaStore, Remote, Role, SyncMeta, SyncStatus } from './types';
import { NotReadableYet } from './types';

/**
 * Offline-first sync between local stores and a Remote.
 *
 * - Local edits are detected by diffing store snapshots (stores update immutably, so a changed item is a new
 *   object). Each edit becomes an outbox record stamped with the device clock, and only the latest edit per
 *   record is kept.
 * - Push sends the outbox. The server keeps whichever edit is newest (last write wins per record).
 * - Pull reads records past a server sequence cursor and applies them unless this device holds a newer
 *   unpushed edit.
 * - On start, every item is compared with a hash of the last synced version, so edits made while sync wasn't
 *   running (signed out, app closed before saving the outbox) are still picked up. The very first run pulls
 *   before comparing, so fresh defaults on a new device don't overwrite the account's data.
 */

const PULL_LIMIT = 1000;
const PUSH_BATCH = 200;
/** Re-read slightly behind the cursor so a write that committed late with a lower seq isn't skipped. */
const SEQ_OVERLAP = 200;
const MAX_RETRY_MS = 60_000;

export const recordKey = (userId: string, collection: Collection, id: string) =>
  collection.scope === 'project' ? `${collection.name}:${id}` : `${userId}:${collection.name}:${id}`;

/** 32-bit FNV-1a of the JSON form; only used to notice changes. */
export function hashItem(value: unknown): number {
  const s = JSON.stringify(value) ?? 'undefined';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Per collection, per item: hash of the last known version and (for project items) its project. */
type Known = Record<string, Record<string, [hash: number, projectId: string | null]>>;
type Meta = SyncMeta & { known: Known };

export const emptyMeta = (userId: string): Meta => ({ version: 1, userId, cursor: 0, versions: {}, outbox: {}, inbox: {}, known: {} });

export interface EngineOptions {
  userId: string;
  remote: Remote;
  bindings: Binding[];
  meta: MetaStore;
  now?: () => number;
  isOnline?: () => boolean;
  /** Your role in a project, or null if it isn't shared (or not known yet). */
  roleOf?: (projectId: string) => Role | null;
  onStatus?: (status: SyncStatus) => void;
  onDenied?: (denied: { key: string; collection: string; reason: string }[]) => void;
  /** A local edit to a view-only project was undone. */
  onReadOnly?: (projectId: string) => void;
  /** Remote changes were applied to local stores. */
  onApplied?: (records: CloudRecord[]) => void;
  /** The server accepted these local changes. */
  onPushed?: (records: CloudRecord[]) => void;
}

type Changes = Map<Collection, Map<string, unknown | null>>;

export class SyncEngine {
  private meta: Meta;
  private initialPullDone = false;
  private snapshots = new Map<Binding, unknown>();
  private applying = new Set<Binding>();
  private unsubs: (() => void)[] = [];
  private byName = new Map<string, { binding: Binding; collection: Collection }>();
  private encodeChain: Promise<void> = Promise.resolve();
  private syncing: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private lastTick = 0;
  private stopped = false;
  private status: SyncStatus = { phase: 'idle', pending: 0, lastSyncedAt: null, error: null };

  constructor(private readonly options: EngineOptions) {
    this.meta = emptyMeta(options.userId);
    for (const binding of options.bindings) {
      for (const collection of binding.collections) {
        if (this.byName.has(collection.name)) throw new Error(`Duplicate sync collection ${collection.name}`);
        this.byName.set(collection.name, { binding, collection });
      }
    }
  }

  private get now() {
    return this.options.now ?? Date.now;
  }

  async start() {
    const loaded = (await this.options.meta.load()) as Meta | null;
    if (loaded && loaded.version === 1 && loaded.userId === this.options.userId) {
      this.meta = { ...emptyMeta(this.options.userId), ...loaded, known: loaded.known ?? {} };
      this.initialPullDone = true;
    }
    this.lastTick = Math.max(0, ...Object.values(this.meta.outbox).map((r) => r.modified_at));
    for (const binding of this.options.bindings) this.attach(binding);
    this.emit();
    await this.syncNow();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.options.meta.save(this.meta);
  }

  getStatus() {
    return this.status;
  }

  /** Records waiting to be pushed, for display. */
  pendingCount() {
    return Object.keys(this.meta.outbox).length;
  }

  requestSync(delay = 800) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), delay);
  }

  syncNow(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.syncing) {
      this.again = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      do {
        this.again = false;
        this.setStatus({ phase: 'syncing', error: null });
        try {
          await this.encodeChain;
          if (this.initialPullDone) await this.push();
          await this.pull();
          if (!this.initialPullDone) {
            this.initialPullDone = true;
            for (const binding of this.options.bindings) if (binding.isReady()) this.reconcile(binding);
            await this.encodeChain;
            await this.push();
          }
          this.failures = 0;
          this.setStatus({ phase: 'idle', lastSyncedAt: this.now(), error: null });
        } catch (e) {
          this.failures++;
          const offline = this.options.isOnline ? !this.options.isOnline() : false;
          this.setStatus({ phase: offline ? 'offline' : 'error', error: e instanceof Error ? e.message : String(e) });
          this.requestSync(Math.min(MAX_RETRY_MS, 1000 * 2 ** this.failures));
          break;
        }
      } while (this.again && !this.stopped);
    })().finally(() => {
      this.syncing = null;
      this.saveMeta();
    });
    return this.syncing;
  }

  /** Pulls everything in a project you just gained access to. */
  async backfillProject(projectId: string) {
    const rows = await this.options.remote.pullProject(projectId);
    await this.applyRemote(rows);
    this.saveMeta();
  }

  /** Removes a project and its items from this device without telling the server (you lost access). */
  dropProject(projectId: string) {
    for (const binding of this.options.bindings) {
      const changes: Changes = new Map();
      for (const collection of binding.collections) {
        if (collection.scope !== 'project') continue;
        const removed = new Map<string, null>();
        for (const [id, item] of collection.items(binding.getState())) {
          if (collection.projectOf?.(item, id) !== projectId) continue;
          removed.set(id, null);
          const key = recordKey(this.options.userId, collection, id);
          delete this.meta.outbox[key];
          delete this.meta.versions[key];
          delete this.meta.inbox[key];
          delete this.meta.known[collection.name]?.[id];
        }
        if (removed.size) changes.set(collection, removed);
      }
      if (changes.size) this.applyToBinding(binding, changes);
    }
    this.saveMeta();
    this.emit();
  }

  /** Queues every item of a binding for upload (e.g. after the journal's encryption changed). */
  enqueueAll(bindingName: string) {
    const binding = this.options.bindings.find((b) => b.name === bindingName);
    if (!binding || !binding.isReady()) return;
    const state = binding.getState();
    for (const collection of binding.collections) {
      for (const [id, item] of collection.items(state)) {
        if (!this.isReadOnly(collection, item, id)) this.enqueue(collection, id, item);
      }
    }
    this.requestSync(100);
  }

  /** Re-encodes queued records (e.g. after the journal key changed), keeping their edit times. */
  reencodeOutbox(bindingName: string) {
    const binding = this.options.bindings.find((b) => b.name === bindingName);
    if (!binding || !binding.isReady()) return;
    const state = binding.getState();
    for (const collection of binding.collections) {
      const items = collection.items(state);
      for (const record of Object.values(this.meta.outbox)) {
        if (record.collection !== collection.name || record.deleted) continue;
        const item = items.get(record.item_id);
        if (item === undefined) continue;
        const encoded = collection.encode ? collection.encode(item) : item;
        const put = (data: unknown) => {
          const current = this.meta.outbox[record.key];
          if (current && current.modified_at === record.modified_at) this.putOutbox({ ...record, data });
        };
        if (encoded instanceof Promise) this.encodeChain = this.encodeChain.then(async () => put(await encoded)).catch(() => undefined);
        else put(encoded);
      }
    }
    this.requestSync(100);
  }

  /** Forgets what this device knows about a binding's records and downloads them again. */
  async resync(bindingName: string) {
    const binding = this.options.bindings.find((b) => b.name === bindingName);
    if (!binding) return;
    const names = new Set(binding.collections.map((c) => c.name));
    for (const table of [this.meta.outbox, this.meta.inbox]) {
      for (const [key, record] of Object.entries(table)) if (names.has(record.collection)) delete table[key];
    }
    for (const collection of binding.collections) {
      delete this.meta.known[collection.name];
      const prefix = recordKey(this.options.userId, collection, '');
      for (const key of Object.keys(this.meta.versions)) if (key.startsWith(prefix)) delete this.meta.versions[key];
    }
    this.meta.cursor = 0;
    this.saveMeta();
    await this.syncNow();
  }

  // ───────── Tracking local changes ─────────

  private attach(binding: Binding) {
    const track = () => {
      if (this.stopped) return;
      this.snapshots.set(binding, binding.getState());
      if (this.initialPullDone) this.reconcile(binding);
      void this.drainInbox(binding);
    };
    if (binding.isReady()) track();
    this.unsubs.push(binding.onReady(track));
    this.unsubs.push(binding.subscribe((state) => this.onChange(binding, state)));
  }

  private onChange(binding: Binding, state: unknown) {
    if (this.stopped || this.applying.has(binding) || !binding.isReady()) return;
    const prev = this.snapshots.get(binding);
    this.snapshots.set(binding, state);
    if (prev === undefined || prev === state) return;

    const reverts: Changes = new Map();
    const blocked = new Set<string>();
    for (const collection of binding.collections) {
      if (collection.source(prev) === collection.source(state)) continue;
      const before = collection.items(prev);
      const after = collection.items(state);
      const revert = (id: string, value: unknown | null, projectId: string | null) => {
        if (!reverts.has(collection)) reverts.set(collection, new Map());
        reverts.get(collection)!.set(id, value);
        if (projectId) blocked.add(projectId);
      };
      for (const [id, item] of after) {
        const old = before.get(id);
        if (old === item) continue;
        const locked = this.readOnlyProject(collection, item, id) ?? (old !== undefined ? this.readOnlyProject(collection, old, id) : null);
        if (locked) revert(id, old ?? null, locked);
        else this.enqueue(collection, id, item);
      }
      for (const [id, old] of before) {
        if (after.has(id)) continue;
        const locked = this.readOnlyProject(collection, old, id);
        if (locked) revert(id, old, locked);
        else this.enqueue(collection, id, null, old);
      }
    }
    if (reverts.size) {
      this.applyToBinding(binding, reverts);
      blocked.forEach((p) => this.options.onReadOnly?.(p));
    }
  }

  /** Compares every item with the hash of its last known version and queues the differences. */
  private reconcile(binding: Binding) {
    const state = binding.getState();
    const restore: string[] = [];
    for (const collection of binding.collections) {
      const known = this.meta.known[collection.name] ?? {};
      const items = collection.items(state);
      for (const [id, item] of items) {
        if (known[id]?.[0] === hashItem(item)) continue;
        const key = recordKey(this.options.userId, collection, id);
        if (this.meta.outbox[key] || this.meta.inbox[key]) continue;
        if (!this.isReadOnly(collection, item, id)) this.enqueue(collection, id, item);
      }
      for (const [id, [, projectId]] of Object.entries(known)) {
        if (items.has(id)) continue;
        const key = recordKey(this.options.userId, collection, id);
        if (this.meta.outbox[key] || this.meta.inbox[key]) continue;
        // Something in a project vanished while sync wasn't watching (e.g. a backup was imported). That's
        // too risky to pass on to the project's other members, so bring back the server's copy instead.
        if (projectId) restore.push(key);
        else this.enqueue(collection, id, null, null);
      }
    }
    this.snapshots.set(binding, state);
    if (restore.length) void this.restore(restore);
  }

  private async restore(keys: string[]) {
    try {
      const rows = await this.options.remote.fetch(keys);
      await this.applyRemote(rows, true);
    } catch {
      // Offline: the next reconcile tries again.
    }
  }

  private readOnlyProject(collection: Collection, item: unknown, id: string): string | null {
    if (collection.scope !== 'project' || !this.options.roleOf) return null;
    const projectId = collection.projectOf?.(item, id) ?? null;
    return projectId && this.options.roleOf(projectId) === 'viewer' ? projectId : null;
  }

  private isReadOnly(collection: Collection, item: unknown, id: string) {
    return this.readOnlyProject(collection, item, id) !== null;
  }

  /** A strictly increasing device clock, so two edits in the same millisecond still order. */
  private tick() {
    this.lastTick = Math.max(this.now(), this.lastTick + 1);
    return this.lastTick;
  }

  private enqueue(collection: Collection, id: string, item: unknown | null, previous?: unknown) {
    const key = recordKey(this.options.userId, collection, id);
    const known = (this.meta.known[collection.name] ??= {});
    const source = item ?? previous;
    // A tombstone keeps the item's project, so the project's members hear about the deletion.
    const projectId =
      collection.scope !== 'project'
        ? null
        : source != null
          ? collection.projectOf?.(source, id) ?? null
          : known[id]?.[1] ?? this.meta.outbox[key]?.project_id ?? null;
    const base = { key, collection: collection.name, item_id: id, project_id: projectId, modified_at: this.tick() };
    if (item === null) {
      delete known[id];
      this.putOutbox({ ...base, data: null, deleted: true });
      return;
    }
    known[id] = [hashItem(item), projectId];
    const encoded = collection.encode ? collection.encode(item) : item;
    if (encoded instanceof Promise) {
      this.encodeChain = this.encodeChain
        .then(async () => this.putOutbox({ ...base, data: await encoded, deleted: false }))
        .catch((e) => console.warn(`Couldn't prepare ${key} for sync`, e));
    } else {
      this.putOutbox({ ...base, data: encoded, deleted: false });
    }
  }

  private putOutbox(record: CloudRecord) {
    const existing = this.meta.outbox[record.key];
    if (existing && existing.modified_at > record.modified_at) return;
    this.meta.outbox[record.key] = record;
    this.saveMeta();
    this.emit();
    this.requestSync();
  }

  // ───────── Push & pull ─────────

  private async push() {
    const order = (r: CloudRecord) => (r.collection === 'project' ? 0 : 1);
    const held = (r: CloudRecord) => (r.deleted ? false : !!this.byName.get(r.collection)?.collection.shouldHold?.(r.data));
    const ops = Object.values(this.meta.outbox)
      .filter((r) => !held(r))
      .sort((a, b) => order(a) - order(b) || a.modified_at - b.modified_at);
    if (!ops.length) return;
    const refetch: string[] = [];
    const denied: { key: string; collection: string; reason: string }[] = [];
    const pushed: CloudRecord[] = [];
    for (let i = 0; i < ops.length; i += PUSH_BATCH) {
      const batch = ops.slice(i, i + PUSH_BATCH);
      const sent = new Map(batch.map((r) => [r.key, r]));
      const result = await this.options.remote.push(batch);
      const settle = (key: string) => {
        const current = this.meta.outbox[key];
        if (current && current.modified_at === sent.get(key)?.modified_at) delete this.meta.outbox[key];
      };
      for (const key of result.accepted) {
        pushed.push(sent.get(key)!);
        settle(key);
        this.meta.versions[key] = Math.max(this.meta.versions[key] ?? 0, sent.get(key)!.modified_at);
      }
      for (const key of result.stale) {
        settle(key);
        refetch.push(key);
      }
      for (const d of result.denied) {
        settle(d.key);
        refetch.push(d.key);
        denied.push({ key: d.key, collection: sent.get(d.key)?.collection ?? '', reason: d.reason });
      }
      this.saveMeta();
      this.emit();
    }
    if (refetch.length) {
      // Bring back the server's version of anything we couldn't write.
      const rows = await this.options.remote.fetch(refetch);
      await this.applyRemote(rows, true);
    }
    if (pushed.length) this.options.onPushed?.(pushed);
    if (denied.length) this.options.onDenied?.(denied);
  }

  private async pull() {
    let after = Math.max(0, this.meta.cursor - SEQ_OVERLAP);
    for (;;) {
      const rows = await this.options.remote.pull(after, PULL_LIMIT);
      if (!rows.length) break;
      await this.applyRemote(rows);
      const last = rows[rows.length - 1].seq ?? after;
      this.meta.cursor = Math.max(this.meta.cursor, last);
      after = last;
      if (rows.length < PULL_LIMIT) break;
    }
  }

  private async applyRemote(rows: CloudRecord[], force = false) {
    const perBinding = new Map<Binding, Changes>();
    const versions = new Map<string, number>();
    const rowOf = new Map<string, CloudRecord>();
    const applied: CloudRecord[] = [];
    const deletedProjects: string[] = [];
    for (const row of rows) {
      const entry = this.byName.get(row.collection);
      if (!entry) continue;
      const { binding, collection } = entry;
      const pending = this.meta.outbox[row.key];
      if (pending && pending.modified_at > row.modified_at) continue;
      const have = this.meta.versions[row.key];
      if (!pending && !force && have !== undefined && have >= row.modified_at) continue;
      if (!binding.isReady()) {
        this.meta.inbox[row.key] = row;
        continue;
      }
      let value: unknown | null = null;
      if (!row.deleted) {
        try {
          value = collection.decode ? await collection.decode(row.data) : row.data;
        } catch (e) {
          if (e instanceof NotReadableYet) this.meta.inbox[row.key] = row;
          else console.warn(`Couldn't read ${row.key}`, e);
          continue;
        }
      }
      if (!perBinding.has(binding)) perBinding.set(binding, new Map());
      const changes = perBinding.get(binding)!;
      if (!changes.has(collection)) changes.set(collection, new Map());
      changes.get(collection)!.set(row.item_id, value);
      versions.set(row.key, row.modified_at);
      rowOf.set(row.key, row);
      applied.push(row);
      if (row.collection === 'project' && row.deleted) deletedProjects.push(row.item_id);
    }

    for (const [binding, changes] of perBinding) {
      if (!binding.isReady()) {
        // The store went away (e.g. the journal locked) while decoding: keep these for later.
        for (const [collection, items] of changes) {
          for (const id of items.keys()) {
            const row = rowOf.get(recordKey(this.options.userId, collection, id));
            if (row) this.meta.inbox[row.key] = row;
          }
        }
        continue;
      }
      // A local edit may have landed while decoding; the newer one wins.
      for (const [collection, items] of changes) {
        for (const id of [...items.keys()]) {
          const key = recordKey(this.options.userId, collection, id);
          const pending = this.meta.outbox[key];
          if (pending && pending.modified_at > (versions.get(key) ?? 0)) {
            items.delete(id);
            continue;
          }
          delete this.meta.outbox[key];
          delete this.meta.inbox[key];
          this.meta.versions[key] = versions.get(key)!;
          const known = (this.meta.known[collection.name] ??= {});
          const value = items.get(id);
          if (value === null) delete known[id];
          else known[id] = [hashItem(value), rowOf.get(key)?.project_id ?? null];
        }
      }
      this.applyToBinding(binding, changes);
    }

    for (const projectId of deletedProjects) this.dropProject(projectId);
    if (applied.length) {
      this.saveMeta();
      this.emit();
      this.options.onApplied?.(applied);
    }
  }

  private applyToBinding(binding: Binding, changes: Changes) {
    this.applying.add(binding);
    try {
      let merged = binding.getState() as Record<string, unknown>;
      const partial: Record<string, unknown> = {};
      for (const [collection, items] of changes) {
        if (!items.size) continue;
        const next = collection.apply(merged, items) as Record<string, unknown>;
        Object.assign(partial, next);
        merged = { ...merged, ...next };
      }
      if (Object.keys(partial).length) binding.setState(partial);
    } finally {
      this.applying.delete(binding);
    }
    this.snapshots.set(binding, binding.getState());
  }

  private async drainInbox(binding: Binding) {
    const names = new Set(binding.collections.map((c) => c.name));
    const rows = Object.values(this.meta.inbox)
      .filter((r) => names.has(r.collection))
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    if (!rows.length) return;
    for (const r of rows) delete this.meta.inbox[r.key];
    await this.applyRemote(rows);
    this.saveMeta();
  }

  // ───────── Bookkeeping ─────────

  private saveMeta() {
    this.options.meta.save(this.meta);
  }

  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch, pending: this.pendingCount() };
    this.options.onStatus?.(this.status);
  }

  private emit() {
    this.setStatus({});
  }
}
