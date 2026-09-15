import { useMemo, useState } from 'react';
import type { ID } from '../types';
import { useFinance } from './store';
import type { AccountType } from './types';
import { accountsInScope, Amount, inScope, isQuarter, monthOf, periodRange, QUARTERS, scopedAmount, type Period, type Scope } from './shared';
import { fmtMoney, fmtMoneyCompact } from './money';
import { defaultTaxProfile, estimateTaxes } from './tax';
import { TransactionsTab } from './Transactions';
import { PeopleTab } from './People';
import { ImportTab } from './Import';
import { TaxesTab } from './Taxes';
import { SetupTab } from './Setup';
import { Empty, Icon, Segmented } from '../components/common';
import { ColumnChart } from '../components/TrendChart';
import { diffDays, fmtDateShort, fromKey, relativeDays, todayKey } from '../lib/dates';
import { navigate } from '../lib/hooks';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'transactions', label: 'Transactions' },
  { value: 'people', label: 'Payees & payers' },
  { value: 'import', label: 'Import' },
  { value: 'taxes', label: 'Taxes' },
  { value: 'setup', label: 'Setup' },
];

const INCOME_COLOR = 'var(--series-1)';
const SPENDING_COLOR = 'var(--series-2)';

export function FinanceView({ tab, id }: { tab?: string; id?: string }) {
  const ledgers = useFinance((s) => s.ledgers);
  const [scope, setScope] = useState<Scope>('all');
  const current = TABS.find((t) => t.value === tab)?.value ?? 'overview';
  const scoped = current === 'overview' || current === 'transactions' || current === 'people';
  const validScope = scope === 'all' || ledgers.some((l) => l.id === scope) ? scope : 'all';

  return (
    <div className={`page${current === 'transactions' ? ' page-wide' : ''}`}>
      <header className="page-head">
        <div>
          <h1>Finance</h1>
          <p className="page-sub">Where money comes from, where it goes, and what to set aside for taxes.</p>
        </div>
        <Segmented value={current} onChange={(v) => navigate(v === 'overview' ? 'finance' : `finance/${v}`)} options={TABS} />
      </header>
      {scoped && ledgers.length > 1 && (
        <div className="toolbar">
          <Segmented value={validScope} onChange={setScope} options={[{ value: 'all', label: 'All books' }, ...ledgers.map((l) => ({ value: l.id, label: l.name }))]} />
        </div>
      )}
      {current === 'overview' && <FinanceOverview scope={validScope} />}
      {current === 'transactions' && <TransactionsTab key={id ?? ''} scope={validScope} preset={id} />}
      {current === 'people' && <PeopleTab scope={validScope} />}
      {current === 'import' && <ImportTab />}
      {current === 'taxes' && <TaxesTab />}
      {current === 'setup' && <SetupTab />}
    </div>
  );
}

function FinanceOverview({ scope }: { scope: Scope }) {
  const data = useFinance();
  const today = todayKey();
  const currentYear = fromKey(today).getFullYear();
  const [period, setPeriod] = useState<Period>('year');
  const [year, setYear] = useState(currentYear);
  const ids = useMemo(() => accountsInScope(data.accounts, scope), [data.accounts, scope]);
  const [from, to] = periodRange(period, year, today);
  const calendarPeriod = isQuarter(period) || period === 'year';
  const cats = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);
  const firstYear = data.transactions.reduce((y, t) => Math.min(y, Number(t.date.slice(0, 4))), currentYear);
  const years = Array.from({ length: currentYear - firstYear + 1 }, (_, i) => currentYear - i);

  const stats = useMemo(() => {
    const inRange = data.transactions.filter((t) => t.date >= from && t.date <= to && inScope(t, ids));
    let income = 0;
    let spending = 0;
    let taxes = 0;
    let transfersNet = 0;
    const byCategory = new Map<string, number>();
    const payers = new Map<string, number>();
    const payees = new Map<string, number>();
    for (const t of inRange) {
      const signed = scopedAmount(t, ids);
      if (t.kind === 'transfer') {
        transfersNet += signed;
        continue;
      }
      if (signed > 0) {
        income += signed;
        const k = t.counterpartyId ?? 'none';
        payers.set(k, (payers.get(k) ?? 0) + signed);
      } else if (signed < 0) {
        const cat = t.categoryId ? cats.get(t.categoryId) : undefined;
        if (cat?.taxRole && cat.taxRole !== 'none') taxes -= signed;
        else spending -= signed;
        const ck = t.categoryId ?? 'none';
        byCategory.set(ck, (byCategory.get(ck) ?? 0) - signed);
        const k = t.counterpartyId ?? 'none';
        payees.set(k, (payees.get(k) ?? 0) - signed);
      }
    }
    // Calendar periods chart that year's twelve months; rolling periods chart the last twelve.
    const months: string[] = [];
    const d = fromKey(today);
    for (let i = 0; i < 12; i++) {
      const m = calendarPeriod ? new Date(year, i, 1) : new Date(d.getFullYear(), d.getMonth() - 11 + i, 1);
      months.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
    }
    const monthly = new Map(months.map((m) => [m, [0, 0]]));
    for (const t of data.transactions) {
      if (t.kind === 'transfer' || !inScope(t, ids)) continue;
      const row = monthly.get(monthOf(t.date));
      if (!row) continue;
      const signed = scopedAmount(t, ids);
      if (signed > 0) row[0] += signed;
      else row[1] -= signed;
    }
    const top = (m: Map<string, number>, n = 6) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    return { income, spending, taxes, transfersNet, byCategory: top(byCategory, 9), payers: top(payers), payees: top(payees), months, monthly };
  }, [data.transactions, from, to, ids, cats, today, calendarPeriod, year]);

  const uncategorized = data.transactions.filter((t) => !t.categoryId && inScope(t, ids)).length;
  const name = (cpId: ID) => data.counterparties.find((c) => c.id === cpId)?.name ?? 'Unknown';
  const net = stats.income - stats.spending - stats.taxes;
  const maxCategory = stats.byCategory[0]?.[1] ?? 1;
  const notStarted = from > to;
  const highlight = new Set(stats.months.filter((m) => m >= monthOf(from) && m <= monthOf(to)));
  const periodLabel =
    period === 'month'
      ? 'This month'
      : period === '12m'
        ? 'Last 12 months'
        : period === 'year'
          ? year === currentYear
            ? `${year} to date`
            : String(year)
          : `${period.toUpperCase()} ${year}`;

  const showTax = scope === 'all' || data.ledgers.find((l) => l.id === scope)?.taxTreatment === 'schedule-c';
  const tax = showTax && data.ledgers.some((l) => l.taxTreatment === 'schedule-c') ? estimateTaxes(data, data.taxProfiles[currentYear] ?? defaultTaxProfile(), currentYear, today) : null;
  const anyEstimates = !!tax && (tax.estimatesRequired || tax.stateEstimatesRequired);
  const nextTax = anyEstimates ? tax!.installments.find((i) => i.status === 'past-due' || i.status === 'next') : undefined;
  // Whatever is still owed in estimates for the rest of the year, so cash can be shown net of it.
  const lastInstallment = tax?.installments[tax.installments.length - 1];
  const taxStillDue = anyEstimates && lastInstallment ? lastInstallment.federalToPay + lastInstallment.stateToPay : 0;

  if (data.transactions.length === 0) {
    return (
      <section className="card stack">
        <Empty>No transactions yet. Import a CSV from your bank, or add transactions by hand.</Empty>
        <div className="row tight">
          <button className="btn primary" onClick={() => navigate('finance/import')}>
            <Icon name="upload" /> Import a CSV
          </button>
          <button className="btn" onClick={() => navigate('finance/setup')}>
            Set up accounts
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="toolbar">
        <Segmented
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'month', label: 'This month' },
            ...QUARTERS.map((q) => {
              const [qs, qe] = periodRange(q, year, today);
              return { value: q as Period, label: q.toUpperCase(), disabled: qs > qe, title: qs > qe ? `${q.toUpperCase()} ${year} hasn't started` : undefined };
            }),
            { value: 'year', label: year === currentYear ? 'Year to date' : 'Full year' },
            { value: '12m', label: '12 months' },
          ]}
        />
        {calendarPeriod && years.length > 1 && (
          <select
            className="input"
            value={year}
            aria-label="Year"
            onChange={(e) => {
              const y = Number(e.target.value);
              setYear(y);
              // A future quarter of the newly chosen year isn't selectable.
              if (isQuarter(period)) {
                const [qs, qe] = periodRange(period, y, today);
                if (qs > qe) setPeriod('year');
              }
            }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        )}
        <span className="small muted">
          {periodLabel}
          {!notStarted && ` · ${fmtDateShort(from)} – ${fmtDateShort(to)}`}
        </span>
      </div>

      <div className="stat-row">
        <div className="card stat">
          <span className="stat-label">
            <span className="swatch" style={{ background: INCOME_COLOR }} /> Money in
          </span>
          <span className="stat-value">{fmtMoney(stats.income, { whole: true })}</span>
          <span className="stat-foot">income, excluding transfers</span>
        </div>
        <div className="card stat">
          <span className="stat-label">
            <span className="swatch" style={{ background: SPENDING_COLOR }} /> Spending
          </span>
          <span className="stat-value">{fmtMoney(stats.spending, { whole: true })}</span>
          <span className="stat-foot">{stats.taxes ? `plus ${fmtMoney(stats.taxes, { whole: true })} in tax payments` : 'excluding transfers'}</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Net</span>
          <span className={`stat-value ${net >= 0 ? 'is-in' : 'is-out'}`}>{fmtMoney(net, { whole: true, sign: true })}</span>
          <span className="stat-foot">{stats.income > 0 ? `${Math.round((net / stats.income) * 100)}% of income kept` : '–'}</span>
        </div>
        {scope !== 'all' && stats.transfersNet !== 0 && (
          <div className="card stat">
            <span className="stat-label">Transfers</span>
            <span className="stat-value">{fmtMoney(stats.transfersNet, { whole: true, sign: true })}</span>
            <span className="stat-foot">{stats.transfersNet > 0 ? 'moved in from other books' : 'moved out to other books'}</span>
          </div>
        )}
      </div>

      {(uncategorized > 0 || nextTax) && (
        <div className="callouts">
          {uncategorized > 0 && (
            <button className="callout" onClick={() => navigate('finance/transactions/uncategorized')}>
              <Icon name="tag" /> <b>{uncategorized}</b> uncategorized transaction{uncategorized === 1 ? '' : 's'} <Icon name="right" size={14} />
            </button>
          )}
          {nextTax && (
            <button className="callout" onClick={() => navigate('finance/taxes')}>
              <Icon name="calendar" /> Estimated tax: <b>{fmtMoney(nextTax.federalToPay + nextTax.stateToPay, { whole: true })}</b> due {fmtDateShort(nextTax.due)}
              {nextTax.status === 'past-due' ? ' (past due)' : ` · ${relativeDays(diffDays(today, nextTax.due))}`} <Icon name="right" size={14} />
            </button>
          )}
        </div>
      )}

      <section className="card">
        <header className="card-head">
          <h3 className="card-title">{calendarPeriod ? `Month by month, ${year}` : 'Last 12 months'}</h3>
          {calendarPeriod && period !== 'year' && <span className="small muted">{period.toUpperCase()} highlighted</span>}
        </header>
        <div className="legend-list">
          <span className="legend-item">
            <span className="swatch" style={{ background: INCOME_COLOR }} /> Money in
          </span>
          <span className="legend-item">
            <span className="swatch" style={{ background: SPENDING_COLOR }} /> Money out
          </span>
        </div>
        <ColumnChart
          groups={stats.months.map((m) => {
            const [y, mo] = m.split('-').map(Number);
            const date = new Date(y, mo - 1, 1);
            return {
              key: m,
              label: date.toLocaleDateString(undefined, { month: 'short' }),
              title: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
              values: stats.monthly.get(m)!,
            };
          })}
          series={[
            { name: 'Money in', color: INCOME_COLOR },
            { name: 'Money out', color: SPENDING_COLOR },
          ]}
          format={(v) => fmtMoney(v, { whole: true })}
          axisFormat={fmtMoneyCompact}
          highlight={period === 'month' || (calendarPeriod && period !== 'year') ? highlight : undefined}
        />
      </section>

      <div className="two-col">
        <section className="card">
          <h3 className="card-title">Where it went</h3>
          {stats.byCategory.length === 0 ? (
            <Empty>No spending in this period.</Empty>
          ) : (
            <ul className="hbars">
              {stats.byCategory.map(([catId, amount]) => (
                <li key={catId}>
                  <button className="hbar-label link-plain" onClick={() => navigate(catId === 'none' ? 'finance/transactions/uncategorized' : 'finance/transactions')}>
                    {catId === 'none' ? 'Uncategorized' : cats.get(catId)?.name ?? 'Unknown'}
                  </button>
                  <span className="hbar-track">
                    <span className="hbar-fill" style={{ width: `${(amount / maxCategory) * 100}%`, background: SPENDING_COLOR }} />
                  </span>
                  <span className="hbar-value">{fmtMoney(amount, { whole: true })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <BalancesCard ids={ids} taxStillDue={taxStillDue} />
      </div>

      <div className="two-col">
        <section className="card">
          <h3 className="card-title">Who paid you</h3>
          {stats.payers.length === 0 ? (
            <Empty>No income in this period.</Empty>
          ) : (
            <ul className="top-list">
              {stats.payers.map(([id, amount]) => (
                <li key={id}>
                  <button className="link-plain" onClick={() => id !== 'none' && navigate(`finance/transactions/cp-${id}`)}>
                    {id === 'none' ? 'Unknown' : name(id)}
                  </button>
                  <b className="amount is-in">{fmtMoney(amount, { whole: true })}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h3 className="card-title">Who you paid</h3>
          {stats.payees.length === 0 ? (
            <Empty>No spending in this period.</Empty>
          ) : (
            <ul className="top-list">
              {stats.payees.map(([id, amount]) => (
                <li key={id}>
                  <button className="link-plain" onClick={() => id !== 'none' && navigate(`finance/transactions/cp-${id}`)}>
                    {id === 'none' ? 'Unknown' : name(id)}
                  </button>
                  <b>{fmtMoney(amount, { whole: true })}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

const BALANCE_GROUPS: { id: string; label: string; types: AccountType[] }[] = [
  { id: 'liquid', label: 'Cash: checking & savings', types: ['checking', 'savings', 'cash'] },
  { id: 'investments', label: 'Investments', types: ['investment'] },
  { id: 'debt', label: 'Credit cards & loans', types: ['credit', 'loan'] },
  { id: 'other', label: 'Other', types: ['other'] },
];

function BalancesCard({ ids, taxStillDue }: { ids: Set<ID>; taxStillDue: number }) {
  const data = useFinance();
  const balances = data.accounts
    .filter((a) => ids.has(a.id) && !a.archived)
    .map((a) => {
      const one = new Set([a.id]);
      return { a, balance: a.openingBalance + data.transactions.reduce((s, t) => s + scopedAmount(t, one), 0) };
    });
  const groups = BALANCE_GROUPS.map((g) => {
    const rows = balances.filter((b) => g.types.includes(b.a.type));
    return { ...g, rows, total: rows.reduce((s, r) => s + r.balance, 0) };
  }).filter((g) => g.rows.length > 0);
  const total = (id: string) => groups.find((g) => g.id === id)?.total ?? 0;
  const liquid = total('liquid');
  const netWorth = balances.reduce((s, b) => s + b.balance, 0);
  const ledgerName = (id: ID) => data.ledgers.find((l) => l.id === id)?.name;
  // Negative card and loan balances are money owed; a negative bank balance is an overdraft.
  const shown = (c: number, debt: boolean) =>
    debt ? (
      <>
        <Amount cents={c} kind="neutral" />
        {c < 0 ? ' owed' : c > 0 ? ' credit' : ''}
      </>
    ) : (
      <span className={c < 0 ? 'is-out' : ''}>{fmtMoney(c)}</span>
    );

  return (
    <section className="card">
      <h3 className="card-title">Balances</h3>
      {balances.length === 0 ? (
        <Empty>No open accounts in these books.</Empty>
      ) : (
        <>
          <div className="balance-summary">
            <div>
              <span className="stat-label">Liquid</span>
              <b>{fmtMoney(liquid, { whole: true })}</b>
            </div>
            {groups.some((g) => g.id === 'investments') && (
              <div>
                <span className="stat-label">Investments</span>
                <b>{fmtMoney(total('investments'), { whole: true })}</b>
              </div>
            )}
            {groups.some((g) => g.id === 'debt') && (
              <div>
                <span className="stat-label">Owed</span>
                <b>{fmtMoney(Math.abs(Math.min(0, total('debt'))), { whole: true })}</b>
              </div>
            )}
            <div>
              <span className="stat-label">Net worth</span>
              <b className={netWorth < 0 ? 'is-out' : ''}>{fmtMoney(netWorth, { whole: true })}</b>
            </div>
          </div>
          {groups.map((g) => (
            <div key={g.id} className="balance-group">
              <div className="balance-group-head">
                <span>{g.label}</span>
                <b>{shown(g.total, g.id === 'debt')}</b>
              </div>
              <ul className="top-list">
                {g.rows.map(({ a, balance }) => (
                  <li key={a.id}>
                    <span>
                      {a.name} <span className="muted small">· {ledgerName(a.ledgerId)}</span>
                    </span>
                    <span className="amount">{shown(balance, g.id === 'debt')}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {taxStillDue > 0 && (
            <div className="balance-group-head is-note">
              <span>Liquid after the {fmtMoney(taxStillDue, { whole: true })} in estimated taxes still due this year</span>
              <b>{fmtMoney(liquid - taxStillDue, { whole: true })}</b>
            </div>
          )}
        </>
      )}
      <p className="small muted">Opening balance plus every recorded transaction. Set opening balances and account types in Setup.</p>
    </section>
  );
}
