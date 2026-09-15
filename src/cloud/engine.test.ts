import { describe, expect, it } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { SyncEngine } from './engine';
import type { Binding, CloudRecord, Collection, MetaStore, PushResult, Remote, Role, SyncMeta } from './types';
import { NotReadableYet } from './types';

// ───────── An in-memory server with the same rules as supabase/schema.sql ─────────

class MemoryServer {
  seq = 0;
  rows = new Map<string, CloudRecord & { owner_id: string }>();
  members = new Map<string, Map<string, Role>>();
  online = true;

  role(projectId: string, user: string) {
    return this.members.get(projectId)?.get(user) ?? null;
  }
  visible(row: CloudRecord & { owner_id: string }, user: string) {
    return row.project_id === null ? row.owner_id === user : this.role(row.project_id, user) !== null;
  }
  canWrite(row: CloudRecord, user: string, existing?: CloudRecord & { owner_id: string }) {
    const projectItem = ['project', 'task', 'note'].includes(row.collection);
    if (!projectItem) return row.key.startsWith(`${user}:`) && (!existing || existing.owner_id === user);
    if (row.collection === 'project') {
      const claimed = this.members.has(row.item_id);
      if (!claimed) return true;
      const role = this.role(row.item_id, user);
      if (row.deleted && existing && !existing.deleted) return role === 'owner';
      return role === 'owner' || role === 'editor';
    }
    const check = (projectId: string | null, owner: string) =>
      projectId === null ? owner === user : ['owner', 'editor'].includes(this.role(projectId, user) ?? '');
    return (!existing || check(existing.project_id, existing.owner_id)) && check(row.project_id, existing?.owner_id ?? user);
  }

  remote(user: string): Remote {
    const guard = () => {
      if (!this.online) throw new Error('Network down');
    };
    return {
      push: async (rows) => {
        guard();
        const result: PushResult = { accepted: [], stale: [], denied: [] };
        for (const row of structuredClone(rows)) {
          const existing = this.rows.get(row.key);
          if (!this.canWrite(row, user, existing)) {
            result.denied.push({ key: row.key, reason: 'permission denied' });
            continue;
          }
          if (existing && existing.modified_at > row.modified_at) {
            result.stale.push(row.key);
            continue;
          }
          if (row.collection === 'project' && !this.members.has(row.item_id)) this.members.set(row.item_id, new Map([[user, 'owner']]));
          this.rows.set(row.key, { ...row, owner_id: existing?.owner_id ?? user, seq: ++this.seq });
          result.accepted.push(row.key);
        }
        return result;
      },
      pull: async (after, limit) => {
        guard();
        return [...this.rows.values()]
          .filter((r) => r.seq! > after && this.visible(r, user))
          .sort((a, b) => a.seq! - b.seq!)
          .slice(0, limit)
          .map((r) => structuredClone(r));
      },
      pullProject: async (projectId) => {
        guard();
        return [...this.rows.values()].filter((r) => r.project_id === projectId && this.visible(r, user)).map((r) => structuredClone(r));
      },
      fetch: async (keys) => {
        guard();
        return keys.map((k) => this.rows.get(k)).filter((r): r is NonNullable<typeof r> => !!r && this.visible(r, user)).map((r) => structuredClone(r));
      },
    };
  }
}

// ───────── A tiny "app": planner store with areas, projects and tasks ─────────

interface Task {
  id: string;
  title: string;
  projectId: string | null;
}
interface Planner {
  areas: { id: string; name: string; target: number }[];
  projects: { id: string; name: string }[];
  tasks: Task[];
}

const listCollection = <K extends keyof Planner>(name: string, field: K, scope: 'personal' | 'project', projectOf?: (item: any, id: string) => string | null): Collection<Planner> => ({
  name,
  scope,
  source: (s) => s[field],
  items: (s) => new Map((s[field] as { id: string }[]).map((x) => [x.id, x])),
  apply: (s, changes) => {
    const list = (s[field] as { id: string }[]).filter((x) => !changes.has(x.id) || changes.get(x.id) !== null).map((x) => (changes.has(x.id) ? (changes.get(x.id) as { id: string }) : x));
    for (const [id, value] of changes) if (value !== null && !list.some((x) => x.id === id)) list.push(value as { id: string });
    return { [field]: list } as Partial<Planner>;
  },
  projectOf,
});

const plannerCollections = [
  listCollection('area', 'areas', 'personal'),
  listCollection('project', 'projects', 'project', (_, id) => id),
  listCollection('task', 'tasks', 'project', (t: Task) => t.projectId),
];

function makeBinding(store: StoreApi<Planner>, name = 'planner', ready = { value: true }, listeners = new Set<() => void>()): Binding<Planner> {
  return {
    name,
    getState: store.getState,
    setState: (p) => store.setState(p),
    subscribe: (fn) => store.subscribe(fn),
    isReady: () => ready.value,
    onReady: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    collections: plannerCollections,
  };
}

class MemoryMeta implements MetaStore {
  value: SyncMeta | null = null;
  async load() {
    return this.value ? structuredClone(this.value) : null;
  }
  save(meta: SyncMeta) {
    this.value = structuredClone(meta);
  }
}

const defaults = (): Planner => ({ areas: [{ id: 'career', name: 'Career', target: 35 }], projects: [], tasks: [] });

let clock = 1_000;
const now = () => ++clock;

function device(server: MemoryServer, user: string, opts: { initial?: Partial<Planner>; meta?: MemoryMeta; roles?: () => Map<string, Role> } = {}) {
  const store = createStore<Planner>()(() => ({ ...defaults(), ...opts.initial }));
  const meta = opts.meta ?? new MemoryMeta();
  const denied: string[] = [];
  const readOnly: string[] = [];
  const make = () =>
    new SyncEngine({
      userId: user,
      remote: server.remote(user),
      bindings: [makeBinding(store)],
      meta,
      now,
      roleOf: (pid) => server.role(pid, user),
      onDenied: (d) => denied.push(...d.map((x) => x.key)),
      onReadOnly: (p) => readOnly.push(p),
    });
  const engine = make();
  return { store, meta, engine, denied, readOnly, make };
}

const set = (store: StoreApi<Planner>, fn: (s: Planner) => Partial<Planner>) => store.setState(fn(store.getState()));
const settle = async (...engines: SyncEngine[]) => {
  for (let i = 0; i < 2; i++) for (const e of engines) await e.syncNow();
};

describe('SyncEngine', () => {
  it('syncs a user between two devices', async () => {
    const server = new MemoryServer();
    const a = device(server, 'ana');
    const b = device(server, 'ana');
    await a.engine.start();
    await b.engine.start();

    set(a.store, (s) => ({ tasks: [...s.tasks, { id: 't1', title: 'Write notes', projectId: null }] }));
    await settle(a.engine, b.engine);
    expect(b.store.getState().tasks).toEqual([{ id: 't1', title: 'Write notes', projectId: null }]);

    set(b.store, (s) => ({ tasks: s.tasks.map((t) => ({ ...t, title: 'Write better notes' })) }));
    await settle(b.engine, a.engine);
    expect(a.store.getState().tasks[0].title).toBe('Write better notes');
    expect(a.engine.pendingCount()).toBe(0);
    expect(b.engine.pendingCount()).toBe(0);
  });

  it('resolves offline edits to the same item by last write', async () => {
    const server = new MemoryServer();
    const a = device(server, 'ana', { initial: { tasks: [{ id: 't1', title: 'Original', projectId: null }] } });
    const b = device(server, 'ana');
    await a.engine.start();
    await b.engine.start();
    expect(b.store.getState().tasks[0].title).toBe('Original');

    server.online = false;
    set(a.store, (s) => ({ tasks: s.tasks.map((t) => ({ ...t, title: 'From A' })) }));
    set(b.store, (s) => ({ tasks: s.tasks.map((t) => ({ ...t, title: 'From B (later)' })) }));
    await a.engine.syncNow();
    expect(a.engine.getStatus().phase).toBe('error');
    server.online = true;
    // A reconnects first, but B's edit is newer and wins everywhere.
    await settle(a.engine, b.engine, a.engine);
    expect(a.store.getState().tasks[0].title).toBe('From B (later)');
    expect(b.store.getState().tasks[0].title).toBe('From B (later)');
  });

  it('propagates deletions without resurrecting them', async () => {
    const server = new MemoryServer();
    const a = device(server, 'ana', { initial: { tasks: [{ id: 't1', title: 'Temp', projectId: null }] } });
    const b = device(server, 'ana');
    await a.engine.start();
    await b.engine.start();
    set(b.store, () => ({ tasks: [] }));
    await settle(b.engine, a.engine, b.engine);
    expect(a.store.getState().tasks).toEqual([]);
    expect(server.rows.get('task:t1')?.deleted).toBe(true);
    expect(b.store.getState().tasks).toEqual([]);
  });

  it("doesn't let a new device's defaults overwrite the account", async () => {
    const server = new MemoryServer();
    const a = device(server, 'ana');
    await a.engine.start();
    set(a.store, (s) => ({ areas: s.areas.map((x) => ({ ...x, target: 20 })) }));
    await a.engine.syncNow();

    const fresh = device(server, 'ana');
    await fresh.engine.start();
    expect(fresh.store.getState().areas[0].target).toBe(20);
    expect(server.rows.get('ana:area:career')?.data).toMatchObject({ target: 20 });
  });

  it('uploads data that existed before signing in', async () => {
    const server = new MemoryServer();
    const a = device(server, 'ana', { initial: { tasks: [{ id: 'old', title: 'From before', projectId: null }] } });
    await a.engine.start();
    expect(server.rows.get('task:old')?.data).toMatchObject({ title: 'From before' });
  });

  it('picks up edits made while sync was not running', async () => {
    const server = new MemoryServer();
    const a = device(server, 'ana', { initial: { tasks: [{ id: 't1', title: 'One', projectId: null }, { id: 't2', title: 'Two', projectId: null }] } });
    await a.engine.start();
    a.engine.stop();

    set(a.store, (s) => ({ tasks: [{ ...s.tasks[0], title: 'One (edited offline)' }] }));
    const restarted = a.make();
    await restarted.start();
    expect(server.rows.get('task:t1')?.data).toMatchObject({ title: 'One (edited offline)' });
    expect(server.rows.get('task:t2')?.deleted).toBe(true);
  });

  it('shares projects with members and respects roles', async () => {
    const server = new MemoryServer();
    const ana = device(server, 'ana');
    const ben = device(server, 'ben');
    const cat = device(server, 'cat');
    await Promise.all([ana.engine.start(), ben.engine.start(), cat.engine.start()]);

    set(ana.store, () => ({ projects: [{ id: 'p1', name: 'Mod' }], tasks: [{ id: 't1', title: 'Design', projectId: 'p1' }] }));
    await ana.engine.syncNow();
    await ben.engine.syncNow();
    expect(ben.store.getState().projects).toEqual([]);

    server.members.get('p1')!.set('ben', 'editor');
    server.members.get('p1')!.set('cat', 'viewer');
    await ben.engine.backfillProject('p1');
    await cat.engine.backfillProject('p1');
    expect(ben.store.getState().tasks.map((t) => t.title)).toEqual(['Design']);

    set(ben.store, (s) => ({ tasks: [...s.tasks, { id: 't2', title: 'Loot tables', projectId: 'p1' }] }));
    await settle(ben.engine, ana.engine, cat.engine);
    expect(ana.store.getState().tasks.map((t) => t.title).sort()).toEqual(['Design', 'Loot tables']);
    expect(cat.store.getState().tasks).toHaveLength(2);

    // Viewers can't change anything: the edit is undone on the spot.
    set(cat.store, (s) => ({ tasks: s.tasks.map((t) => ({ ...t, title: 'Viewer was here' })) }));
    expect(cat.store.getState().tasks.map((t) => t.title).sort()).toEqual(['Design', 'Loot tables']);
    expect(cat.readOnly).toContain('p1');
    expect(cat.engine.pendingCount()).toBe(0);

    // Removing a member drops the project from their device.
    server.members.get('p1')!.delete('ben');
    ben.engine.dropProject('p1');
    expect(ben.store.getState().projects).toEqual([]);
    expect(ben.store.getState().tasks).toEqual([]);
  });

  it('keeps project deletions visible to members', async () => {
    const server = new MemoryServer();
    const ana = device(server, 'ana', { initial: { projects: [{ id: 'p1', name: 'Mod' }], tasks: [{ id: 't1', title: 'Design', projectId: 'p1' }] } });
    const ben = device(server, 'ben');
    await ana.engine.start();
    server.members.get('p1')!.set('ben', 'editor');
    await ben.engine.start();
    expect(ben.store.getState().tasks).toHaveLength(1);

    // Deleting a task sends a tombstone that keeps its project, so members hear about it.
    set(ana.store, () => ({ tasks: [] }));
    await ana.engine.syncNow();
    expect(server.rows.get('task:t1')).toMatchObject({ deleted: true, project_id: 'p1' });
    await ben.engine.syncNow();
    expect(ben.store.getState().tasks).toEqual([]);

    // Deleting the whole project clears it from members' devices too.
    set(ana.store, () => ({ projects: [] }));
    await ana.engine.syncNow();
    await ben.engine.syncNow();
    expect(ben.store.getState().projects).toEqual([]);
  });

  it("restores project items that vanished while sync wasn't running instead of deleting them for everyone", async () => {
    const server = new MemoryServer();
    const ana = device(server, 'ana', { initial: { projects: [{ id: 'p1', name: 'Mod' }], tasks: [{ id: 't1', title: 'Design', projectId: 'p1' }] } });
    await ana.engine.start();
    server.members.get('p1')!.set('ben', 'editor');
    const ben = device(server, 'ben');
    await ben.engine.start();
    ben.engine.stop();

    // Ben imports an old backup without the shared project, then sync starts again.
    set(ben.store, () => ({ projects: [], tasks: [] }));
    await ben.make().start();
    await new Promise((r) => setTimeout(r, 0));
    expect(server.rows.get('task:t1')?.deleted).toBe(false);
    expect(server.rows.get('project:p1')?.deleted).toBe(false);
    expect(ben.store.getState().tasks.map((t) => t.title)).toEqual(['Design']);
  });

  it('reports writes the server refuses and restores its version', async () => {
    const server = new MemoryServer();
    const ana = device(server, 'ana', { initial: { projects: [{ id: 'p1', name: 'Mod' }] } });
    await ana.engine.start();
    const ben = device(server, 'ben', { initial: { projects: [{ id: 'p1', name: 'Same id, different project' }] } });
    await ben.engine.start();
    expect(ben.denied).toContain('project:p1');
    expect(server.rows.get('project:p1')?.data).toMatchObject({ name: 'Mod' });
  });

  it('holds unreadable records until the store is ready, then applies them', async () => {
    const server = new MemoryServer();
    const locked = { value: false };
    const a = device(server, 'ana');
    await a.engine.start();
    set(a.store, () => ({ tasks: [{ id: 'secret', title: 'Sealed', projectId: null }] }));
    await a.engine.syncNow();

    const store = createStore<Planner>()(() => defaults());
    const listeners = new Set<() => void>();
    const binding = makeBinding(store, 'planner', { get value() { return !locked.value; } } as { value: boolean }, listeners);
    const key = { available: false };
    binding.collections = plannerCollections.map((c) =>
      c.name === 'task'
        ? { ...c, decode: (d: unknown) => { if (!key.available) throw new NotReadableYet(); return d; } }
        : c,
    );
    const engine = new SyncEngine({ userId: 'ana', remote: server.remote('ana'), bindings: [binding], meta: new MemoryMeta(), now });
    await engine.start();
    expect(store.getState().tasks).toEqual([]);

    key.available = true;
    listeners.forEach((l) => l());
    await new Promise((r) => setTimeout(r, 0));
    expect(store.getState().tasks.map((t) => t.title)).toEqual(['Sealed']);
  });

  it('awaits async encoders and keeps only the latest edit per record', async () => {
    const server = new MemoryServer();
    const store = createStore<Planner>()(() => defaults());
    const binding = makeBinding(store);
    const seen: string[] = [];
    binding.collections = plannerCollections.map((c) =>
      c.name === 'task'
        ? { ...c, encode: async (t: unknown) => { await new Promise((r) => setTimeout(r, 5)); seen.push((t as Task).title); return { sealed: (t as Task).title }; } }
        : c,
    );
    const engine = new SyncEngine({ userId: 'ana', remote: server.remote('ana'), bindings: [binding], meta: new MemoryMeta(), now });
    await engine.start();
    set(store, () => ({ tasks: [{ id: 't1', title: 'v1', projectId: null }] }));
    set(store, () => ({ tasks: [{ id: 't1', title: 'v2', projectId: null }] }));
    await engine.syncNow();
    expect(seen).toEqual(['v1', 'v2']);
    expect(server.rows.get('task:t1')?.data).toEqual({ sealed: 'v2' });
  });
});
