import { useEffect, useState } from 'react';
import type { DateKey, ID } from '../types';
import type { Account, Cents, Category, FinanceData, Transaction, TxnKind } from './types';
import { useFinance } from './store';
import { fmtMoney, parseMoney, toDollars } from './money';
import { addDays, fromKey, toKey } from '../lib/dates';

/** 'all' or a ledger id. */
export type Scope = string;

export const accountsInScope = (accounts: Account[], scope: Scope) =>
  new Set(accounts.filter((a) => scope === 'all' || a.ledgerId === scope).map((a) => a.id));

/** Does this transaction touch the scope? Transfers between two in-scope accounts are internal. */
export function inScope(t: Transaction, ids: Set<ID>) {
  return ids.has(t.accountId) || (!!t.toAccountId && ids.has(t.toAccountId));
}

/** Signed effect on the scope: + money in, − money out, 0 for internal transfers. */
export function scopedAmount(t: Transaction, ids: Set<ID>): Cents {
  if (t.kind === 'income') return ids.has(t.accountId) ? t.amount : 0;
  if (t.kind === 'expense') return ids.has(t.accountId) ? -t.amount : 0;
  const out = ids.has(t.accountId);
  const into = !!t.toAccountId && ids.has(t.toAccountId);
  return out && !into ? -t.amount : into && !out ? t.amount : 0;
}

/**
 * Patch that assigns a category, converting the transaction's kind when the category is of another kind
 * (e.g. an imported "VISA PAYMENT" expense becomes a transfer; the money keeps flowing the same way).
 */
export function categoryPatch(t: Transaction, c: Category | undefined): Partial<Transaction> {
  if (!c || c.kind === t.kind) return { categoryId: c?.id ?? null };
  const moneyIn = t.kind === 'income' || (t.kind === 'transfer' && !t.accountId);
  if (c.kind === 'transfer') {
    return moneyIn
      ? { categoryId: c.id, kind: 'transfer', accountId: '', toAccountId: t.accountId }
      : { categoryId: c.id, kind: 'transfer', toAccountId: null };
  }
  if (t.kind === 'transfer') {
    return { categoryId: c.id, kind: c.kind, accountId: t.accountId || t.toAccountId || '', toAccountId: null };
  }
  return { categoryId: c.id, kind: c.kind };
}

export function flowLabel(t: Transaction, data: Pick<FinanceData, 'accounts' | 'counterparties'>) {
  const account = (id: ID | null) => (id ? data.accounts.find((a) => a.id === id)?.name : undefined) ?? 'Other account';
  const person = (t.counterpartyId && data.counterparties.find((c) => c.id === t.counterpartyId)?.name) || 'Unknown';
  if (t.kind === 'income') return { from: person, to: account(t.accountId) };
  if (t.kind === 'expense') return { from: account(t.accountId), to: person };
  return { from: t.accountId ? account(t.accountId) : 'Other account', to: account(t.toAccountId) };
}

export type Period = 'month' | 'q1' | 'q2' | 'q3' | 'q4' | 'year' | '12m';

export const QUARTERS = ['q1', 'q2', 'q3', 'q4'] as const;

export const isQuarter = (p: Period): p is (typeof QUARTERS)[number] => (QUARTERS as readonly string[]).includes(p);

/**
 * Date range for a period. Quarters and "year" are calendar periods of `year`, cut off at today.
 * A quarter that hasn't started returns a range whose start is after its end.
 */
export function periodRange(period: Period, year: number, today: DateKey): [DateKey, DateKey] {
  const d = fromKey(today);
  const upTo = (end: DateKey): DateKey => (end > today ? today : end);
  if (period === 'month') return [toKey(new Date(d.getFullYear(), d.getMonth(), 1)), today];
  if (period === '12m') return [addDays(today, -364), today];
  if (period === 'year') return [`${year}-01-01`, upTo(`${year}-12-31`)];
  const q = Number(period[1]);
  return [toKey(new Date(year, (q - 1) * 3, 1)), upTo(toKey(new Date(year, q * 3, 0)))];
}

export const monthOf = (date: DateKey) => date.slice(0, 7);

export function CategorySelect({
  value,
  onChange,
  kinds,
  emptyLabel = 'Uncategorized',
  className = 'input',
}: {
  value: ID | null;
  onChange: (id: ID | null) => void;
  kinds?: TxnKind[];
  emptyLabel?: string;
  className?: string;
}) {
  const categories = useFinance((s) => s.categories);
  const groups: [string, Category[]][] = (['expense', 'income', 'transfer'] as TxnKind[])
    .filter((k) => !kinds || kinds.includes(k))
    .map((k) => [k === 'expense' ? 'Spending' : k === 'income' ? 'Income' : 'Transfers', categories.filter((c) => c.kind === k)]);
  return (
    <select className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label="Category">
      <option value="">{emptyLabel}</option>
      {groups.map(([label, cats]) => (
        <optgroup key={label} label={label}>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function AccountSelect({
  value,
  onChange,
  emptyLabel,
  className = 'input',
}: {
  value: ID | null;
  onChange: (id: ID | null) => void;
  emptyLabel?: string;
  className?: string;
}) {
  const ledgers = useFinance((s) => s.ledgers);
  const accounts = useFinance((s) => s.accounts);
  return (
    <select className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label="Account">
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {ledgers.map((l) => (
        <optgroup key={l.id} label={l.name}>
          {accounts
            .filter((a) => a.ledgerId === l.id && !a.archived)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Dollar text field bound to cents; commits a parsed value on every valid keystroke. */
export function MoneyInput({
  value,
  onChange,
  placeholder = '0.00',
  allowEmpty,
  className = 'input',
}: {
  value: Cents | null;
  onChange: (c: Cents | null) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(toDollars(value));
  // Only overwrite what the user typed when the value changed from outside.
  useEffect(() => {
    setText((current) => (parseMoney(current) === value || (current.trim() === '' && value === null) ? current : toDollars(value)));
  }, [value]);
  return (
    <input
      className={className}
      inputMode="decimal"
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value.trim() === '') onChange(allowEmpty ? null : 0);
        else {
          const c = parseMoney(e.target.value);
          if (c !== null) onChange(c);
        }
      }}
    />
  );
}

export function Amount({ cents, kind }: { cents: Cents; kind?: 'in' | 'out' | 'neutral' }) {
  const k = kind ?? (cents > 0 ? 'in' : cents < 0 ? 'out' : 'neutral');
  return <span className={`amount is-${k}`}>{k === 'in' ? fmtMoney(Math.abs(cents), { sign: true }) : k === 'out' ? fmtMoney(-Math.abs(cents)) : fmtMoney(Math.abs(cents))}</span>;
}
