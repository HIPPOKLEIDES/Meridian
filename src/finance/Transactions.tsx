import { useMemo, useState } from 'react';
import type { ID } from '../types';
import type { Transaction, TxnKind } from './types';
import { newTransaction, useFinance } from './store';
import { accountsInScope, AccountSelect, Amount, CategorySelect, categoryPatch, flowLabel, inScope, MoneyInput, scopedAmount, type Scope } from './shared';
import { fmtMoney } from './money';
import { cleanPayee } from './csv';
import { Empty, Field, Icon, Modal, Segmented } from '../components/common';
import { DateInput } from '../components/inputs';
import { fmtDateShort, todayKey } from '../lib/dates';
import { useUI } from '../ui';

export function TransactionsTab({ scope, preset }: { scope: Scope; preset?: string }) {
  const data = useFinance();
  const toast = useUI((s) => s.toast);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | TxnKind>('all');
  const [accountId, setAccountId] = useState<ID | null>(null);
  const [categoryId, setCategoryId] = useState<string>(preset === 'uncategorized' ? 'none' : 'all');
  const [counterpartyId, setCounterpartyId] = useState<string>(preset?.startsWith('cp-') ? preset.slice(3) : 'all');
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);
  const [selected, setSelected] = useState<Set<ID>>(new Set());
  const [editing, setEditing] = useState<{ id: ID | null } | null>(null);

  const ids = useMemo(() => accountsInScope(data.accounts, scope), [data.accounts, scope]);
  const cats = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.transactions
      .filter((t) => inScope(t, ids))
      .filter((t) => kind === 'all' || t.kind === kind)
      .filter((t) => !accountId || t.accountId === accountId || t.toAccountId === accountId)
      .filter((t) => (categoryId === 'all' ? true : categoryId === 'none' ? !t.categoryId : t.categoryId === categoryId))
      .filter((t) => counterpartyId === 'all' || t.counterpartyId === counterpartyId)
      .filter((t) => (!from || t.date >= from) && (!to || t.date <= to))
      .filter((t) => {
        if (!q) return true;
        const cp = t.counterpartyId ? data.counterparties.find((c) => c.id === t.counterpartyId)?.name ?? '' : '';
        return `${t.description} ${t.notes} ${cp} ${(t.amount / 100).toFixed(2)}`.toLowerCase().includes(q);
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
  }, [data.transactions, data.counterparties, ids, kind, accountId, categoryId, counterpartyId, from, to, query]);

  const totalIn = rows.reduce((s, t) => s + Math.max(0, scopedAmount(t, ids)), 0);
  const totalOut = rows.reduce((s, t) => s + Math.min(0, scopedAmount(t, ids)), 0);
  const allShownSelected = rows.slice(0, limit).every((t) => selected.has(t.id)) && rows.length > 0;
  const toggle = (id: ID) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const makeRule = (t: Transaction) => {
    const pattern = prompt('Categorize future imports whose description contains:', cleanPayee(t.description).split(' ')[0] || t.description);
    if (!pattern?.trim()) return;
    data.addRule({ pattern: pattern.trim(), counterpartyId: t.counterpartyId, categoryId: t.categoryId });
    const changed = data.applyRules();
    toast(`Rule added${changed ? ` and applied to ${changed} uncategorized transaction${changed === 1 ? '' : 's'}` : ''}`);
  };

  return (
    <>
      <div className="toolbar">
        <input className="input search" placeholder="Search description, payee, amount…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'income', label: 'In' },
            { value: 'expense', label: 'Out' },
            { value: 'transfer', label: 'Transfers' },
          ]}
        />
        <AccountSelect value={accountId} onChange={setAccountId} emptyLabel="All accounts" />
        <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category filter">
          <option value="all">All categories</option>
          <option value="none">Uncategorized</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="input" value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)} aria-label="Payee or payer filter">
          <option value="all">Anyone</option>
          {[...data.counterparties].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="inline-label">
          From <DateInput value={from} onChange={setFrom} />
        </label>
        <label className="inline-label">
          to <DateInput value={to} onChange={setTo} />
        </label>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setEditing({ id: null })}>
          <Icon name="plus" /> Transaction
        </button>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <b>{selected.size} selected</b>
          <CategorySelect
            value={null}
            emptyLabel="Set category…"
            className="input sm"
            onChange={(c) => {
              if (!c) return;
              for (const t of data.transactions) if (selected.has(t.id)) data.updateTransaction(t.id, categoryPatch(t, cats.get(c)));
              toast(`Categorized ${selected.size} transaction${selected.size === 1 ? '' : 's'}`);
            }}
          />
          <select
            className="input sm"
            value=""
            onChange={(e) => e.target.value && data.updateTransactions([...selected], { counterpartyId: e.target.value })}
          >
            <option value="">Set payee/payer…</option>
            {data.counterparties.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            className="btn sm danger ghost"
            onClick={() => {
              if (!confirm(`Delete ${selected.size} transaction${selected.size === 1 ? '' : 's'}?`)) return;
              data.deleteTransactions([...selected]);
              setSelected(new Set());
            }}
          >
            <Icon name="trash" size={14} /> Delete
          </button>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <section className="card flush">
        {rows.length === 0 ? (
          <Empty>No transactions match. Import a bank CSV or add one by hand.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table txn-table">
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      aria-label="Select all shown"
                      checked={allShownSelected}
                      onChange={() => setSelected(allShownSelected ? new Set() : new Set(rows.slice(0, limit).map((t) => t.id)))}
                    />
                  </th>
                  <th>Date</th>
                  <th>From → To</th>
                  <th>Category</th>
                  <th className="num">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((t) => {
                  const flow = flowLabel(t, data);
                  const signed = scopedAmount(t, ids);
                  return (
                    <tr key={t.id} className={selected.has(t.id) ? 'is-selected' : ''}>
                      <td className="col-check">
                        <input type="checkbox" aria-label="Select transaction" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                      </td>
                      <td className="nowrap">{fmtDateShort(t.date)}</td>
                      <td className="cell-flow">
                        <div className="flow">
                          <span>{flow.from}</span>
                          <Icon name="right" size={12} />
                          <span>{flow.to}</span>
                        </div>
                        {t.description && <div className="cell-sub">{t.description}</div>}
                      </td>
                      <td>
                        <CategorySelect
                          className={`input sm cat-select${t.categoryId ? '' : ' is-empty'}`}
                          value={t.categoryId}
                          onChange={(c) => data.updateTransaction(t.id, categoryPatch(t, c ? cats.get(c) : undefined))}
                        />
                      </td>
                      <td className="num">
                        <Amount cents={signed === 0 ? t.amount : signed} kind={signed === 0 ? 'neutral' : undefined} />
                      </td>
                      <td className="row-actions">
                        <button className="btn icon ghost sm" title="Make a rule from this" aria-label="Make a rule from this" onClick={() => makeRule(t)}>
                          <Icon name="tag" size={14} />
                        </button>
                        <button className="btn icon ghost sm" aria-label="Edit transaction" onClick={() => setEditing({ id: t.id })}>
                          <Icon name="edit" size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>
                    {rows.length} transaction{rows.length === 1 ? '' : 's'} · in {fmtMoney(totalIn)} · out {fmtMoney(-totalOut)}
                  </td>
                  <td className="num">
                    <Amount cents={totalIn + totalOut} />
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
            {rows.length > limit && (
              <button className="btn ghost show-more" onClick={() => setLimit(limit + 200)}>
                Show more ({rows.length - limit} left)
              </button>
            )}
          </div>
        )}
      </section>
      {editing && <TransactionEditor id={editing.id} onClose={() => setEditing(null)} />}
    </>
  );
}

export function TransactionEditor({ id, onClose }: { id: ID | null; onClose: () => void }) {
  const store = useFinance();
  const existing = id ? store.transactions.find((t) => t.id === id) : undefined;
  const [t, setT] = useState<Transaction>(() =>
    existing ? { ...existing } : newTransaction({ accountId: store.accounts[0]?.id ?? '', date: todayKey() }),
  );
  const [person, setPerson] = useState(() => store.counterparties.find((c) => c.id === existing?.counterpartyId)?.name ?? '');
  const [makeDefault, setMakeDefault] = useState(false);
  const set = (p: Partial<Transaction>) => setT((prev) => ({ ...prev, ...p }));
  const valid = t.amount > 0 && (t.kind !== 'transfer' ? !!t.accountId : !!(t.accountId || t.toAccountId));

  const save = () => {
    if (!valid) return;
    const counterpartyId = t.kind !== 'transfer' && person.trim() ? store.ensureCounterparty(person) : null;
    const final = { ...t, counterpartyId, toAccountId: t.kind === 'transfer' ? t.toAccountId : null };
    if (existing) store.updateTransaction(t.id, final);
    else store.addTransactions([final]);
    if (makeDefault && counterpartyId && t.categoryId) store.updateCounterparty(counterpartyId, { defaultCategoryId: t.categoryId });
    onClose();
  };

  const personField = (
    <Field label={t.kind === 'income' ? 'Paid by' : 'Paid to'}>
      <input className="input" list="counterparty-names" value={person} placeholder="Person or business" onChange={(e) => setPerson(e.target.value)} />
      <datalist id="counterparty-names">
        {store.counterparties.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
    </Field>
  );

  return (
    <Modal
      title={existing ? 'Edit transaction' : 'New transaction'}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <button
              className="btn danger ghost"
              onClick={() => {
                store.deleteTransactions([existing.id]);
                onClose();
              }}
            >
              <Icon name="trash" /> Delete
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={save}>
            {existing ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Segmented
          value={t.kind}
          onChange={(kind) => set({ kind, categoryId: store.categories.find((c) => c.id === t.categoryId)?.kind === kind ? t.categoryId : null })}
          options={[
            { value: 'expense', label: 'Money out' },
            { value: 'income', label: 'Money in' },
            { value: 'transfer', label: 'Transfer' },
          ]}
        />
        <div className="row">
          <Field label="Amount ($)">
            <MoneyInput value={t.amount} onChange={(c) => set({ amount: Math.abs(c ?? 0) })} />
          </Field>
          <Field label="Date">
            <DateInput value={t.date} onChange={(date) => date && set({ date })} />
          </Field>
        </div>
        <div className="row">
          {t.kind === 'income' ? (
            <>
              {personField}
              <Field label="Into account">
                <AccountSelect value={t.accountId} onChange={(a) => set({ accountId: a ?? '' })} />
              </Field>
            </>
          ) : t.kind === 'expense' ? (
            <>
              <Field label="From account">
                <AccountSelect value={t.accountId} onChange={(a) => set({ accountId: a ?? '' })} />
              </Field>
              {personField}
            </>
          ) : (
            <>
              <Field label="From account">
                <AccountSelect value={t.accountId || null} emptyLabel="Outside Meridian" onChange={(a) => set({ accountId: a ?? '' })} />
              </Field>
              <Field label="To account">
                <AccountSelect value={t.toAccountId} emptyLabel="Outside Meridian" onChange={(a) => set({ toAccountId: a })} />
              </Field>
            </>
          )}
        </div>
        <Field label="Category">
          <CategorySelect value={t.categoryId} kinds={[t.kind]} onChange={(categoryId) => set({ categoryId })} />
        </Field>
        {t.kind !== 'transfer' && person.trim() && t.categoryId && (
          <label className="toggle small">
            <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} /> Use this category for {person.trim()} by default
          </label>
        )}
        <input className="input" placeholder="Description (as on the statement)" value={t.description} onChange={(e) => set({ description: e.target.value })} />
        <textarea className="input" rows={2} placeholder="Notes, e.g. what it was for (handy at tax time)" value={t.notes} onChange={(e) => set({ notes: e.target.value })} />
      </div>
    </Modal>
  );
}
