import { useMemo, useState } from 'react';
import type { ID } from '../types';
import { useFinance } from './store';
import { accountsInScope, CategorySelect, scopedAmount, type Scope } from './shared';
import { fmtMoney } from './money';
import { Empty, Icon } from '../components/common';
import { fmtDateShort } from '../lib/dates';
import { navigate } from '../lib/hooks';

export function PeopleTab({ scope }: { scope: Scope }) {
  const data = useFinance();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'volume' | 'in' | 'out' | 'name' | 'recent'>('volume');
  const ids = useMemo(() => accountsInScope(data.accounts, scope), [data.accounts, scope]);

  const rows = useMemo(() => {
    const stats = new Map<ID, { in: number; out: number; count: number; last: string }>();
    for (const t of data.transactions) {
      if (!t.counterpartyId) continue;
      const signed = scopedAmount(t, ids);
      if (signed === 0) continue;
      const s = stats.get(t.counterpartyId) ?? { in: 0, out: 0, count: 0, last: '' };
      if (signed > 0) s.in += signed;
      else s.out -= signed;
      s.count++;
      if (t.date > s.last) s.last = t.date;
      stats.set(t.counterpartyId, s);
    }
    const q = query.trim().toLowerCase();
    return data.counterparties
      .map((c) => ({ c, s: stats.get(c.id) ?? { in: 0, out: 0, count: 0, last: '' } }))
      .filter((r) => (scope === 'all' || r.s.count > 0) && (!q || r.c.name.toLowerCase().includes(q)))
      .sort((a, b) =>
        sort === 'name'
          ? a.c.name.localeCompare(b.c.name)
          : sort === 'in'
            ? b.s.in - a.s.in
            : sort === 'out'
              ? b.s.out - a.s.out
              : sort === 'recent'
                ? b.s.last.localeCompare(a.s.last)
                : b.s.in + b.s.out - (a.s.in + a.s.out),
      );
  }, [data.transactions, data.counterparties, ids, query, sort, scope]);

  const sortHeader = (key: typeof sort, label: string, num = false) => (
    <th className={num ? 'num' : ''}>
      <button className={`sort-btn${sort === key ? ' is-on' : ''}`} onClick={() => setSort(key)}>
        {label}
      </button>
    </th>
  );

  return (
    <>
      <div className="toolbar">
        <input className="input search" placeholder="Search people & businesses…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="small muted">Everyone who has paid you or been paid. Rename, set a default category, or merge duplicates from imports.</span>
      </div>
      <section className="card flush">
        {rows.length === 0 ? (
          <Empty>No payees or payers yet. They're created as you add or import transactions.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {sortHeader('name', 'Name')}
                  {sortHeader('in', 'Received from', true)}
                  {sortHeader('out', 'Paid to', true)}
                  {sortHeader('recent', 'Last', true)}
                  <th className="align-left">Default category</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, s }) => (
                  <tr key={c.id}>
                    <td className="align-left">
                      <input className="input bare name-input" value={c.name} aria-label="Name" onChange={(e) => data.updateCounterparty(c.id, { name: e.target.value })} />
                      <div className="cell-sub">
                        {s.count} transaction{s.count === 1 ? '' : 's'}
                      </div>
                    </td>
                    <td className="num">{s.in ? <span className="amount is-in">{fmtMoney(s.in)}</span> : '–'}</td>
                    <td className="num">{s.out ? fmtMoney(s.out) : '–'}</td>
                    <td className="num nowrap">{s.last ? fmtDateShort(s.last) : '–'}</td>
                    <td className="align-left">
                      <CategorySelect className="input sm" value={c.defaultCategoryId} emptyLabel="None" onChange={(id) => data.updateCounterparty(c.id, { defaultCategoryId: id })} />
                    </td>
                    <td className="row-actions">
                      <button className="btn icon ghost sm" title="See transactions" aria-label="See transactions" onClick={() => navigate(`finance/transactions/cp-${c.id}`)}>
                        <Icon name="list" size={14} />
                      </button>
                      <select
                        className="input sm merge-select"
                        value=""
                        aria-label="Merge into"
                        onChange={(e) => {
                          const into = data.counterparties.find((x) => x.id === e.target.value);
                          if (into && confirm(`Merge “${c.name}” into “${into.name}”? All its transactions move over.`)) data.mergeCounterparty(c.id, into.id);
                        }}
                      >
                        <option value="">Merge into…</option>
                        {data.counterparties
                          .filter((x) => x.id !== c.id)
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
