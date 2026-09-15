/** Shared shapes for cloud sync. Mirrors public.records in supabase/schema.sql. */

export type Scope = 'personal' | 'project';
export type Role = 'owner' | 'editor' | 'viewer';

export interface CloudRecord {
  key: string;
  collection: string;
  item_id: string;
  project_id: string | null;
  data: unknown;
  deleted: boolean;
  /** Client clock (ms) of the edit. The newest edit wins. */
  modified_at: number;
  /** Server change sequence, set on pull. */
  seq?: number;
}

export interface PushResult {
  accepted: string[];
  /** The server already has a newer edit. */
  stale: string[];
  denied: { key: string; reason: string }[];
}

/** What the sync engine needs from a server. Implemented for Supabase in remote.ts and in memory for tests. */
export interface Remote {
  push(rows: CloudRecord[]): Promise<PushResult>;
  /** Records changed after a sequence number, oldest first. */
  pull(afterSeq: number, limit: number): Promise<CloudRecord[]>;
  /** Everything in one project (used when you're added to it). */
  pullProject(projectId: string): Promise<CloudRecord[]>;
  fetch(keys: string[]): Promise<CloudRecord[]>;
}

/** Thrown by a decoder that can't read a record yet (e.g. the journal is locked). The record waits in the inbox. */
export class NotReadableYet extends Error {}

/** One kind of item inside a store, e.g. the tasks of the planner store. */
export interface Collection<S = any> {
  /** Record collection name, e.g. 'task'. Must be unique across all bindings. */
  name: string;
  scope: Scope;
  /** The value whose identity changes whenever any item in the collection changes (usually the array). */
  source(state: S): unknown;
  items(state: S): Map<string, unknown>;
  /** Applies remote changes: a value to set, or null to delete. */
  apply(state: S, changes: Map<string, unknown | null>): Partial<S>;
  /** For project-scoped items: the project the item belongs to (a project returns its own id). */
  projectOf?(item: unknown, id: string): string | null;
  /** Before upload: strip secrets, encrypt. */
  encode?(item: unknown): unknown | Promise<unknown>;
  /** After download. Throw NotReadableYet to retry later. */
  decode?(data: unknown): unknown | Promise<unknown>;
  /** Keep an encoded record out of the next push (it stays queued), e.g. unencrypted data for an encrypted account. */
  shouldHold?(data: unknown): boolean;
}

/** A zustand store (or anything shaped like one) taking part in sync. */
export interface Binding<S = any> {
  name: string;
  getState(): S;
  setState(partial: Partial<S>): void;
  subscribe(listener: (state: S, prev: S) => void): () => void;
  /** False while the store is loading or locked; changes are neither tracked nor applied until ready. */
  isReady(): boolean;
  onReady(listener: () => void): () => void;
  collections: Collection<S>[];
}

export interface SyncMeta {
  version: 1;
  userId: string;
  /** Highest server seq applied. */
  cursor: number;
  /** modified_at of the version of each record this device has. */
  versions: Record<string, number>;
  /** Local edits not yet accepted by the server, by key (latest edit only). */
  outbox: Record<string, CloudRecord>;
  /** Downloaded records that couldn't be applied yet (store not ready, journal locked). */
  inbox: Record<string, CloudRecord>;
}

export interface MetaStore {
  load(): Promise<SyncMeta | null>;
  save(meta: SyncMeta): void;
  flush?(): Promise<void>;
}

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  pending: number;
  lastSyncedAt: number | null;
  error: string | null;
}
