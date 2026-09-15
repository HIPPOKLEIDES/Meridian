import type { StoreApi, UseBoundStore } from 'zustand';
import type { Binding, Collection, Scope } from './types';
import { useStore } from '../store';
import { useHealth } from '../health/store';
import { useFinance } from '../finance/store';
import { useNotes } from '../notes/store';
import { useGoals } from '../goals/store';
import { useJournal } from '../journal/store';
import { hasVaultKey, openJson, sealJson, useJournalLock, type VaultInfo } from '../journal/vault';
import type { Envelope } from '../journal/crypto';
import { isEncryptedVault, useAccountVault, type AccountVault } from '../journal/account';

/**
 * How each local store maps to synced records. Collection names are part of the stored record keys, so
 * never rename one; add a new name instead.
 */

type AnyState = Record<string, unknown>;
type WithId = { id: string };

/** An array of items with ids, e.g. tasks. */
function list<S extends AnyState>(
  name: string,
  field: keyof S & string,
  scope: Scope = 'personal',
  extra: Partial<Collection<S>> = {},
): Collection<S> {
  return {
    name,
    scope,
    source: (s) => s[field],
    items: (s) => new Map(((s[field] as WithId[] | undefined) ?? []).map((x) => [x.id, x])),
    apply: (s, changes) => {
      const current = (s[field] as WithId[] | undefined) ?? [];
      const next: WithId[] = [];
      for (const item of current) {
        if (!changes.has(item.id)) next.push(item);
        else if (changes.get(item.id) !== null) next.push(changes.get(item.id) as WithId);
      }
      const present = new Set(current.map((x) => x.id));
      for (const [id, value] of changes) if (value !== null && !present.has(id)) next.push(value as WithId);
      return { [field]: next } as Partial<S>;
    },
    ...extra,
  };
}

/** An object keyed by id, e.g. meal plans by week. */
function record<S extends AnyState>(name: string, field: keyof S & string): Collection<S> {
  return {
    name,
    scope: 'personal',
    source: (s) => s[field],
    items: (s) => new Map(Object.entries((s[field] as Record<string, unknown> | undefined) ?? {})),
    apply: (s, changes) => {
      const next = { ...((s[field] as Record<string, unknown> | undefined) ?? {}) };
      for (const [id, value] of changes) {
        if (value === null) delete next[id];
        else next[id] = value;
      }
      return { [field]: next } as Partial<S>;
    },
  };
}

/** A single value, e.g. settings. A null value counts as "not set". */
function single<S extends AnyState>(name: string, field: keyof S & string, extra: Partial<Collection<S>> = {}): Collection<S> {
  return {
    name,
    scope: 'personal',
    source: (s) => s[field],
    items: (s) => (s[field] === null || s[field] === undefined ? new Map() : new Map([['value', s[field]]])),
    apply: (_s, changes) => ({ [field]: changes.get('value') ?? null }) as Partial<S>,
    ...extra,
  };
}

interface Persisted {
  persist?: { hasHydrated(): boolean; onFinishHydration(fn: () => void): () => void };
}

function storeBinding<S extends AnyState>(
  name: string,
  store: UseBoundStore<StoreApi<S>> & Persisted,
  collections: Collection<S>[],
  readiness?: Pick<Binding<S>, 'isReady' | 'onReady'>,
): Binding<S> {
  return {
    name,
    getState: store.getState,
    setState: (partial) => store.setState(partial),
    subscribe: (fn) => store.subscribe(fn),
    isReady: readiness?.isReady ?? (() => store.persist?.hasHydrated() ?? true),
    onReady: readiness?.onReady ?? ((fn) => store.persist?.onFinishHydration(fn) ?? (() => undefined)),
    collections,
  };
}

const projectOf = (item: unknown) => ((item as { projectId?: string | null }).projectId ?? null);

// ───────── Journal: sealed with the vault key when encryption is on ─────────

interface Sealed {
  sealed: Envelope;
}
const isSealed = (data: unknown): data is Sealed => !!data && typeof data === 'object' && 'sealed' in data;

const journalCodec: Partial<Collection> = {
  encode: (item) => (hasVaultKey() ? sealJson(item).then((sealed) => ({ sealed })) : item),
  decode: (data) => (isSealed(data) ? openJson(data.sealed) : data),
  // Never upload readable journal data to an account whose journal is encrypted.
  shouldHold: (data) => isEncryptedVault(useAccountVault.getState().vault) && !isSealed(data),
};

const journalReady = () => {
  const s = useJournalLock.getState();
  return s.loaded && (s.status === 'plain' || s.status === 'unlocked');
};

export const JOURNAL_BINDING = 'journal';

export function createBindings(): Binding[] {
  return [
    storeBinding('planner', useStore as never, [
      list('area', 'areas'),
      list('project', 'projects', 'project', { projectOf: (_item, id) => id }),
      list('task', 'tasks', 'project', { projectOf }),
      list('habit', 'habits'),
      list('block', 'blocks'),
      list('time-entry', 'entries'),
      single('timer', 'timer'),
      single('settings', 'settings'),
    ]),
    storeBinding('health', useHealth as never, [
      list('metric', 'metrics'),
      list('measurement', 'measurements'),
      list('health-goal', 'goals'),
      list('injury', 'injuries'),
      list('recipe', 'recipes'),
      record('meal-plan', 'mealPlans'),
      single('health-google', 'google'),
      single('nutrition', 'nutrition', {
        // The USDA API key stays on this device.
        encode: (item) => ({ ...(item as object), fdcApiKey: '' }),
        apply: (s, changes) => {
          const value = changes.get('value') as { fdcApiKey?: string } | null | undefined;
          const local = (s as { nutrition?: { fdcApiKey?: string } }).nutrition;
          return value ? ({ nutrition: { ...value, fdcApiKey: local?.fdcApiKey ?? '' } } as never) : {};
        },
      }),
    ]),
    storeBinding('finance', useFinance as never, [
      list('ledger', 'ledgers'),
      list('account', 'accounts'),
      list('category', 'categories'),
      list('counterparty', 'counterparties'),
      list('transaction', 'transactions'),
      list('rule', 'rules'),
      record('tax-profile', 'taxProfiles'),
      record('import-mapping', 'importMappings'),
    ]),
    storeBinding('notes', useNotes as never, [list('note', 'notes', 'project', { projectOf })]),
    storeBinding('goals', useGoals as never, [
      list('goal', 'goals'),
      list('goal-review', 'reviews'),
      single('goal-settings', 'reviewDay'),
    ]),
    storeBinding(
      JOURNAL_BINDING,
      useJournal as never,
      [list('journal', 'journals', 'personal', journalCodec), list('journal-entry', 'entries', 'personal', journalCodec)],
      {
        isReady: journalReady,
        onReady: (fn) =>
          useJournalLock.subscribe((state, prev) => {
            const wasReady = prev.loaded && (prev.status === 'plain' || prev.status === 'unlocked');
            if (!wasReady && journalReady() && state) fn();
          }),
      },
    ),
    storeBinding('journal-vault', useAccountVault as never, [
      {
        name: 'journal-vault',
        scope: 'personal',
        source: (s: { vault: AccountVault }) => s.vault,
        items: (s: { vault: AccountVault }) => (s.vault ? new Map<string, unknown>([['value', s.vault]]) : new Map()),
        apply: (_s, changes) => ({ vault: (changes.get('value') as VaultInfo | { off: true } | null) ?? null }),
      },
    ]),
  ];
}
