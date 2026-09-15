import type { DateKey, ID } from '../types';

/** Money is always stored as integer cents to avoid floating-point drift. */
export type Cents = number;

export type LedgerKind = 'personal' | 'business';

/**
 * How a ledger's profit is taxed in the estimate.
 * `schedule-c`: sole proprietorship / single-member LLC — profit is subject to income and self-employment tax.
 * `none`: tracked for budgeting only (personal money, or an S-corp/partnership handled elsewhere).
 */
export type TaxTreatment = 'schedule-c' | 'none';

/** A separate set of books: "Personal", "Studio LLC", … */
export interface Ledger {
  id: ID;
  name: string;
  kind: LedgerKind;
  taxTreatment: TaxTreatment;
  createdAt: number;
}

export type AccountType = 'checking' | 'savings' | 'credit' | 'cash' | 'investment' | 'loan' | 'other';

export interface Account {
  id: ID;
  ledgerId: ID;
  name: string;
  type: AccountType;
  openingBalance: Cents;
  archived: boolean;
}

export type TxnKind = 'income' | 'expense' | 'transfer';

/** Marks categories whose payments count as estimated tax paid. */
export type TaxRole = 'none' | 'federal-estimate' | 'state-estimate';

export interface Category {
  id: ID;
  name: string;
  kind: TxnKind;
  /** Free-form grouping for reports, e.g. "Home", "Business". */
  group: string;
  /** Share deductible when used in a business ledger (meals are 50%). */
  deductiblePct: 0 | 50 | 100;
  taxRole: TaxRole;
}

/** A person or business money moves to or from. */
export interface Counterparty {
  id: ID;
  name: string;
  notes: string;
  defaultCategoryId: ID | null;
}

export interface Transaction {
  id: ID;
  date: DateKey;
  /** Always positive; `kind` gives the direction. */
  amount: Cents;
  kind: TxnKind;
  /** Income: the account money arrives in. Expense/transfer: the account it leaves. */
  accountId: ID;
  /** Transfers only: the account money arrives in. */
  toAccountId: ID | null;
  /** Income: who paid you. Expense: who you paid. */
  counterpartyId: ID | null;
  categoryId: ID | null;
  description: string;
  notes: string;
  /** Fingerprint from CSV import, used to skip duplicates on re-import. */
  importKey: string | null;
  createdAt: number;
}

/** Auto-categorization: when an imported description contains `pattern`, apply these. */
export interface Rule {
  id: ID;
  pattern: string;
  counterpartyId: ID | null;
  categoryId: ID | null;
  createdAt: number;
}

export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';

/** Per-year inputs for the tax estimate. Everything is optional-ish and user-editable. */
export interface TaxProfile {
  filingStatus: FilingStatus;
  /** State with real brackets, or 'flat' to use `stateRatePct`. Missing on older saved profiles. */
  state?: 'ME' | 'flat';
  /** Flat approximation of state + local income tax, as a percent of AGI (used when state is 'flat'). */
  stateRatePct: number;
  /** State tax withheld from wages this year. */
  stateWithholding?: Cents;
  /** Last year's total state income tax, for the state safe-harbor amount. */
  priorYearStateTax?: Cents | null;
  /** Expected full-year W-2 wages and federal withholding from a job, if any. */
  w2Wages: Cents;
  w2Withholding: Cents;
  /** Interest, dividends and other taxable income not tracked as business income. */
  otherIncome: Cents;
  /** Last year's total federal tax and AGI, for the safe-harbor amount. */
  priorYearTax: Cents | null;
  priorYearAgi: Cents | null;
  /** Use instead of the standard deduction when larger. */
  itemizedDeductions: Cents | null;
  /** Expected full-year business profit; null = project from year-to-date. */
  profitOverride: Cents | null;
}

/** Column mapping for a CSV import, remembered per account so the next file from that bank maps itself. */
export interface ImportMapping {
  /** The header row joined with commas; the mapping is reused only when it matches. */
  signature: string;
  date: number;
  description: number;
  /** signed: one amount column. split: separate debit/credit columns. type: unsigned amount plus a Credit/Debit column. */
  mode: 'signed' | 'split' | 'type';
  amount: number;
  debit: number;
  credit: number;
  typeColumn: number;
  /** The bank's own category column, used as a hint when no rule matches (-1 if none). */
  categoryColumn: number;
  positiveIs: 'in' | 'out';
  dateFormat: 'auto' | 'mdy' | 'dmy' | 'ymd';
}

export interface FinanceData {
  ledgers: Ledger[];
  accounts: Account[];
  categories: Category[];
  counterparties: Counterparty[];
  transactions: Transaction[];
  rules: Rule[];
  taxProfiles: Record<string, TaxProfile>;
  importMappings: Record<ID, ImportMapping>;
}
