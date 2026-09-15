import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ID } from '../types';
import type { Account, Category, Counterparty, FinanceData, ImportMapping, Ledger, Rule, TaxProfile, Transaction } from './types';
import { uid } from '../store';
import { todayKey } from '../lib/dates';
import { normalize } from './csv';

const cat = (id: string, name: string, kind: Category['kind'], group: string, deductiblePct: Category['deductiblePct'] = 0, taxRole: Category['taxRole'] = 'none'): Category => ({
  id,
  name,
  kind,
  group,
  deductiblePct,
  taxRole,
});

export const DEFAULT_CATEGORIES: Category[] = [
  cat('inc-wages', 'Wages & salary', 'income', 'Income'),
  cat('inc-clients', 'Client payments', 'income', 'Income'),
  cat('inc-sales', 'Sales', 'income', 'Income'),
  cat('inc-interest', 'Interest & dividends', 'income', 'Income'),
  cat('inc-refunds', 'Refunds', 'income', 'Income'),
  cat('inc-gifts', 'Gifts received', 'income', 'Income'),
  cat('inc-other', 'Other income', 'income', 'Income'),

  cat('exp-housing', 'Rent & mortgage', 'expense', 'Home'),
  cat('exp-utilities', 'Utilities', 'expense', 'Home'),
  cat('exp-groceries', 'Groceries', 'expense', 'Food'),
  cat('exp-dining', 'Dining out', 'expense', 'Food'),
  cat('exp-transport', 'Transportation & fuel', 'expense', 'Getting around'),
  cat('exp-health', 'Health & fitness', 'expense', 'Health'),
  cat('exp-insurance', 'Insurance', 'expense', 'Home'),
  cat('exp-shopping', 'Shopping', 'expense', 'Lifestyle'),
  cat('exp-entertainment', 'Entertainment', 'expense', 'Lifestyle'),
  cat('exp-subscriptions', 'Subscriptions', 'expense', 'Lifestyle'),
  cat('exp-travel', 'Travel', 'expense', 'Lifestyle'),
  cat('exp-education', 'Education', 'expense', 'Growth'),
  cat('exp-giving', 'Gifts & donations', 'expense', 'Giving'),
  cat('exp-personal', 'Personal care', 'expense', 'Lifestyle'),
  cat('exp-fees', 'Fees & interest', 'expense', 'Money'),
  cat('exp-other', 'Other spending', 'expense', 'Other'),

  cat('biz-software', 'Software & subscriptions', 'expense', 'Business', 100),
  cat('biz-advertising', 'Advertising & marketing', 'expense', 'Business', 100),
  cat('biz-supplies', 'Office supplies', 'expense', 'Business', 100),
  cat('biz-equipment', 'Equipment', 'expense', 'Business', 100),
  cat('biz-contractors', 'Contract labor', 'expense', 'Business', 100),
  cat('biz-professional', 'Legal & accounting', 'expense', 'Business', 100),
  cat('biz-travel', 'Business travel', 'expense', 'Business', 100),
  cat('biz-meals', 'Business meals', 'expense', 'Business', 50),
  cat('biz-phone', 'Phone & internet', 'expense', 'Business', 100),
  cat('biz-vehicle', 'Vehicle expenses', 'expense', 'Business', 100),
  cat('biz-training', 'Training & education', 'expense', 'Business', 100),
  cat('biz-fees', 'Bank & payment fees', 'expense', 'Business', 100),
  cat('biz-insurance', 'Business insurance', 'expense', 'Business', 100),

  cat('tax-federal', 'Federal estimated tax', 'expense', 'Taxes', 0, 'federal-estimate'),
  cat('tax-state', 'State estimated tax', 'expense', 'Taxes', 0, 'state-estimate'),
  cat('tax-other', 'Other tax payments', 'expense', 'Taxes'),

  cat('xfer-transfer', 'Transfer between accounts', 'transfer', 'Transfers'),
  cat('xfer-card', 'Credit card payment', 'transfer', 'Transfers'),
  cat('xfer-draw', 'Owner draw', 'transfer', 'Transfers'),
  cat('xfer-contribution', 'Owner contribution', 'transfer', 'Transfers'),
  cat('xfer-savings', 'Savings & investing', 'transfer', 'Transfers'),
];

export const emptyFinance = (): FinanceData => ({
  ledgers: [{ id: 'personal', name: 'Personal', kind: 'personal', taxTreatment: 'none', createdAt: 0 }],
  accounts: [{ id: 'personal-checking', ledgerId: 'personal', name: 'Checking', type: 'checking', openingBalance: 0, archived: false }],
  categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
  counterparties: [],
  transactions: [],
  rules: [],
  taxProfiles: {},
  importMappings: {},
});

export const newTransaction = (t: Partial<Transaction> = {}): Transaction => ({
  id: uid(),
  date: todayKey(),
  amount: 0,
  kind: 'expense',
  accountId: '',
  toAccountId: null,
  counterpartyId: null,
  categoryId: null,
  description: '',
  notes: '',
  importKey: null,
  createdAt: Date.now(),
  ...t,
});

interface FinanceActions {
  addLedger(l: Partial<Ledger>): ID;
  updateLedger(id: ID, patch: Partial<Ledger>): void;
  deleteLedger(id: ID): void;
  addAccount(a: Partial<Account>): ID;
  updateAccount(id: ID, patch: Partial<Account>): void;
  deleteAccount(id: ID): void;
  addCategory(c: Partial<Category>): ID;
  updateCategory(id: ID, patch: Partial<Category>): void;
  deleteCategory(id: ID): void;
  /** Finds a counterparty by name (case-insensitive) or creates it. */
  ensureCounterparty(name: string): ID;
  updateCounterparty(id: ID, patch: Partial<Counterparty>): void;
  /** Re-points every transaction and rule from `fromId` to `intoId`, then deletes `fromId`. */
  mergeCounterparty(fromId: ID, intoId: ID): void;
  deleteCounterparty(id: ID): void;
  addTransactions(ts: Partial<Transaction>[]): number;
  updateTransaction(id: ID, patch: Partial<Transaction>): void;
  updateTransactions(ids: ID[], patch: Partial<Transaction>): void;
  deleteTransactions(ids: ID[]): void;
  addRule(r: Partial<Rule>): ID;
  updateRule(id: ID, patch: Partial<Rule>): void;
  deleteRule(id: ID): void;
  /** Applies rules to uncategorized transactions; returns how many changed. */
  applyRules(): number;
  setTaxProfile(year: number, profile: TaxProfile): void;
  saveImportMapping(accountId: ID, mapping: ImportMapping): void;
  replaceAll(data: FinanceData): void;
}

export type FinanceStore = FinanceData & FinanceActions;

const patchList = <T extends { id: ID }>(list: T[], id: ID, p: Partial<T>) => list.map((x) => (x.id === id ? { ...x, ...p } : x));

/** The first rule whose pattern appears in the description. Longer patterns win, being more specific. */
export function matchRule(rules: Rule[], description: string): Rule | undefined {
  const text = normalize(description);
  return [...rules]
    .filter((r) => r.pattern.trim())
    .sort((a, b) => b.pattern.length - a.pattern.length)
    .find((r) => text.includes(normalize(r.pattern)));
}

export const useFinance = create<FinanceStore>()(
  persist(
    (set, get) => ({
      ...emptyFinance(),

      addLedger: (l) => {
        const ledger: Ledger = { id: uid(), name: 'New ledger', kind: 'business', taxTreatment: 'schedule-c', createdAt: Date.now(), ...l };
        set((s) => ({ ledgers: [...s.ledgers, ledger] }));
        return ledger.id;
      },
      updateLedger: (id, p) => set((s) => ({ ledgers: patchList(s.ledgers, id, p) })),
      deleteLedger: (id) => {
        const accountIds = new Set(get().accounts.filter((a) => a.ledgerId === id).map((a) => a.id));
        set((s) => ({
          ledgers: s.ledgers.filter((l) => l.id !== id),
          accounts: s.accounts.filter((a) => a.ledgerId !== id),
          transactions: s.transactions.filter((t) => !accountIds.has(t.accountId)).map((t) => (t.toAccountId && accountIds.has(t.toAccountId) ? { ...t, toAccountId: null } : t)),
        }));
      },

      addAccount: (a) => {
        const account: Account = { id: uid(), ledgerId: get().ledgers[0]?.id ?? '', name: 'New account', type: 'checking', openingBalance: 0, archived: false, ...a };
        set((s) => ({ accounts: [...s.accounts, account] }));
        return account.id;
      },
      updateAccount: (id, p) => set((s) => ({ accounts: patchList(s.accounts, id, p) })),
      deleteAccount: (id) =>
        set((s) => ({
          accounts: s.accounts.filter((a) => a.id !== id),
          transactions: s.transactions.filter((t) => t.accountId !== id).map((t) => (t.toAccountId === id ? { ...t, toAccountId: null } : t)),
        })),

      addCategory: (c) => {
        const category: Category = { id: uid(), name: 'New category', kind: 'expense', group: 'Other', deductiblePct: 0, taxRole: 'none', ...c };
        set((s) => ({ categories: [...s.categories, category] }));
        return category.id;
      },
      updateCategory: (id, p) => set((s) => ({ categories: patchList(s.categories, id, p) })),
      deleteCategory: (id) =>
        set((s) => ({
          categories: s.categories.filter((c) => c.id !== id),
          transactions: s.transactions.map((t) => (t.categoryId === id ? { ...t, categoryId: null } : t)),
          rules: s.rules.map((r) => (r.categoryId === id ? { ...r, categoryId: null } : r)),
          counterparties: s.counterparties.map((c) => (c.defaultCategoryId === id ? { ...c, defaultCategoryId: null } : c)),
        })),

      ensureCounterparty: (name) => {
        const clean = name.trim();
        const existing = get().counterparties.find((c) => c.name.toLowerCase() === clean.toLowerCase());
        if (existing) return existing.id;
        const cp: Counterparty = { id: uid(), name: clean, notes: '', defaultCategoryId: null };
        set((s) => ({ counterparties: [...s.counterparties, cp] }));
        return cp.id;
      },
      updateCounterparty: (id, p) => set((s) => ({ counterparties: patchList(s.counterparties, id, p) })),
      mergeCounterparty: (fromId, intoId) =>
        set((s) => ({
          counterparties: s.counterparties.filter((c) => c.id !== fromId),
          transactions: s.transactions.map((t) => (t.counterpartyId === fromId ? { ...t, counterpartyId: intoId } : t)),
          rules: s.rules.map((r) => (r.counterpartyId === fromId ? { ...r, counterpartyId: intoId } : r)),
        })),
      deleteCounterparty: (id) =>
        set((s) => ({
          counterparties: s.counterparties.filter((c) => c.id !== id),
          transactions: s.transactions.map((t) => (t.counterpartyId === id ? { ...t, counterpartyId: null } : t)),
          rules: s.rules.map((r) => (r.counterpartyId === id ? { ...r, counterpartyId: null } : r)),
        })),

      addTransactions: (ts) => {
        const made = ts.map((t) => newTransaction(t));
        set((s) => ({ transactions: [...s.transactions, ...made] }));
        return made.length;
      },
      updateTransaction: (id, p) => set((s) => ({ transactions: patchList(s.transactions, id, p) })),
      updateTransactions: (ids, p) => {
        const set_ = new Set(ids);
        set((s) => ({ transactions: s.transactions.map((t) => (set_.has(t.id) ? { ...t, ...p } : t)) }));
      },
      deleteTransactions: (ids) => {
        const gone = new Set(ids);
        set((s) => ({ transactions: s.transactions.filter((t) => !gone.has(t.id)) }));
      },

      addRule: (r) => {
        const rule: Rule = { id: uid(), pattern: '', counterpartyId: null, categoryId: null, createdAt: Date.now(), ...r };
        set((s) => ({ rules: [...s.rules, rule] }));
        return rule.id;
      },
      updateRule: (id, p) => set((s) => ({ rules: patchList(s.rules, id, p) })),
      deleteRule: (id) => set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),
      applyRules: () => {
        const { rules, counterparties } = get();
        const defaults = new Map(counterparties.map((c) => [c.id, c.defaultCategoryId]));
        let changed = 0;
        set((s) => ({
          transactions: s.transactions.map((t) => {
            if (t.categoryId && t.counterpartyId) return t;
            const rule = matchRule(rules, t.description);
            const counterpartyId = t.counterpartyId ?? rule?.counterpartyId ?? null;
            const categoryId = t.categoryId ?? rule?.categoryId ?? (counterpartyId ? defaults.get(counterpartyId) ?? null : null);
            if (counterpartyId === t.counterpartyId && categoryId === t.categoryId) return t;
            changed++;
            return { ...t, counterpartyId, categoryId };
          }),
        }));
        return changed;
      },

      setTaxProfile: (year, profile) => set((s) => ({ taxProfiles: { ...s.taxProfiles, [year]: profile } })),
      saveImportMapping: (accountId, mapping) => set((s) => ({ importMappings: { ...s.importMappings, [accountId]: mapping } })),
      replaceAll: (data) => set({ ...emptyFinance(), ...data }),
    }),
    {
      name: 'meridian:finance',
      version: 1,
      partialize: (s): FinanceData => ({
        ledgers: s.ledgers,
        accounts: s.accounts,
        categories: s.categories,
        counterparties: s.counterparties,
        transactions: s.transactions,
        rules: s.rules,
        taxProfiles: s.taxProfiles,
        importMappings: s.importMappings,
      }),
    },
  ),
);

export const exportFinance = (): FinanceData => {
  const { ledgers, accounts, categories, counterparties, transactions, rules, taxProfiles, importMappings } = useFinance.getState();
  return { ledgers, accounts, categories, counterparties, transactions, rules, taxProfiles, importMappings };
};
