import type { AccountType, Category, TxnKind } from './types';
import { useFinance } from './store';
import { CategorySelect, MoneyInput } from './shared';
import { Icon } from '../components/common';
import { useUI } from '../ui';

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit', label: 'Credit card' },
  { value: 'cash', label: 'Cash' },
  { value: 'investment', label: 'Investment' },
  { value: 'loan', label: 'Loan' },
  { value: 'other', label: 'Other' },
];

const ACCOUNT_TEMPLATES: { label: string; name: string; type: AccountType }[] = [
  { label: 'Bank of America checking', name: 'BofA Checking', type: 'checking' },
  { label: 'Bank of America credit card', name: 'BofA Credit Card', type: 'credit' },
  { label: 'Capital One 360 savings', name: 'Capital One 360 Savings', type: 'savings' },
  { label: 'Chase Amazon Prime Visa', name: 'Amazon Prime Visa', type: 'credit' },
  { label: 'Investment or retirement account', name: 'Brokerage', type: 'investment' },
  { label: 'Blank account', name: 'New account', type: 'checking' },
];

export function SetupTab() {
  const s = useFinance();
  const toast = useUI((u) => u.toast);

  return (
    <>
      <section className="card stack">
        <header className="card-head">
          <div>
            <h3 className="card-title">Ledgers</h3>
            <p className="small muted">Keep personal money and each business in its own books. Sole proprietorships and single-member LLCs are taxed on Schedule C.</p>
          </div>
          <button className="btn sm" onClick={() => s.addLedger({ name: 'New business' })}>
            <Icon name="plus" size={14} /> Ledger
          </button>
        </header>
        <div className="setup-rows">
          {s.ledgers.map((l) => (
            <div key={l.id} className="setup-row">
              <input className="input" value={l.name} aria-label="Ledger name" onChange={(e) => s.updateLedger(l.id, { name: e.target.value })} />
              <select className="input" value={l.kind} aria-label="Kind" onChange={(e) => s.updateLedger(l.id, { kind: e.target.value as 'personal' | 'business' })}>
                <option value="personal">Personal</option>
                <option value="business">Business</option>
              </select>
              <select className="input" value={l.taxTreatment} aria-label="Tax treatment" onChange={(e) => s.updateLedger(l.id, { taxTreatment: e.target.value as 'schedule-c' | 'none' })}>
                <option value="schedule-c">Taxed as self-employment (Schedule C)</option>
                <option value="none">Not in the tax estimate</option>
              </select>
              <button
                className="btn icon ghost"
                aria-label={`Delete ${l.name}`}
                disabled={s.ledgers.length === 1}
                onClick={() => confirm(`Delete “${l.name}”, its accounts and all their transactions?`) && s.deleteLedger(l.id)}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card stack">
        <header className="card-head">
          <div>
            <h3 className="card-title">Accounts</h3>
            <p className="small muted">Checking, savings and cash count as liquid; investment accounts and cards/loans are totaled separately.</p>
          </div>
          <select
            className="input sm"
            value=""
            aria-label="Add account"
            onChange={(e) => {
              const t = ACCOUNT_TEMPLATES.find((x) => x.label === e.target.value);
              if (t) s.addAccount({ name: t.name, type: t.type, ledgerId: s.ledgers[0]?.id });
            }}
          >
            <option value="">+ Add account…</option>
            {ACCOUNT_TEMPLATES.map((t) => (
              <option key={t.label} value={t.label}>
                {t.label}
              </option>
            ))}
          </select>
        </header>
        <div className="setup-rows">
          {s.accounts.map((a) => (
            <div key={a.id} className={`setup-row${a.archived ? ' is-muted' : ''}`}>
              <input className="input" value={a.name} aria-label="Account name" onChange={(e) => s.updateAccount(a.id, { name: e.target.value })} />
              <select className="input" value={a.ledgerId} aria-label="Ledger" onChange={(e) => s.updateAccount(a.id, { ledgerId: e.target.value })}>
                {s.ledgers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <select className="input" value={a.type} aria-label="Type" onChange={(e) => s.updateAccount(a.id, { type: e.target.value as AccountType })}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <label className="inline-label">
                Opening balance
                <MoneyInput className="input money" value={a.openingBalance} onChange={(c) => s.updateAccount(a.id, { openingBalance: c ?? 0 })} />
              </label>
              <label className="toggle small">
                <input type="checkbox" checked={a.archived} onChange={(e) => s.updateAccount(a.id, { archived: e.target.checked })} /> Closed
              </label>
              <button className="btn icon ghost" aria-label={`Delete ${a.name}`} onClick={() => confirm(`Delete “${a.name}” and its transactions?`) && s.deleteAccount(a.id)}>
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card stack">
        <header className="card-head">
          <div>
            <h3 className="card-title">Rules</h3>
            <p className="small muted">When an imported description contains the text, the payee and category are filled in for you.</p>
          </div>
          <div className="row tight">
            <button
              className="btn sm"
              onClick={() => {
                const n = s.applyRules();
                toast(n ? `Filled in ${n} transaction${n === 1 ? '' : 's'}` : 'Nothing left for the rules to fill in');
              }}
            >
              Apply to uncategorized
            </button>
            <button className="btn sm" onClick={() => s.addRule({ pattern: '' })}>
              <Icon name="plus" size={14} /> Rule
            </button>
          </div>
        </header>
        <div className="setup-rows">
          {s.rules.length === 0 && <p className="small muted">No rules yet. You can also create one from any transaction with the tag button.</p>}
          {s.rules.map((r) => (
            <div key={r.id} className="setup-row">
              <label className="inline-label">
                Contains
                <input className="input" value={r.pattern} placeholder="e.g. WHOLEFDS" onChange={(e) => s.updateRule(r.id, { pattern: e.target.value })} />
              </label>
              <select className="input" value={r.counterpartyId ?? ''} aria-label="Payee or payer" onChange={(e) => s.updateRule(r.id, { counterpartyId: e.target.value || null })}>
                <option value="">Any payee</option>
                {[...s.counterparties].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <CategorySelect value={r.categoryId} emptyLabel="No category" onChange={(categoryId) => s.updateRule(r.id, { categoryId })} />
              <button className="btn icon ghost" aria-label="Delete rule" onClick={() => s.deleteRule(r.id)}>
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card stack">
        <header className="card-head">
          <div>
            <h3 className="card-title">Categories</h3>
            <p className="small muted">
              “Deductible” applies to spending in a Schedule C ledger. Mark the categories you use for estimated tax payments so they count
              toward what you've paid.
            </p>
          </div>
        </header>
        {(['expense', 'income', 'transfer'] as TxnKind[]).map((kind) => (
          <div key={kind} className="stack tight">
            <div className="row tight">
              <div className="group-label">{kind === 'expense' ? 'Spending' : kind === 'income' ? 'Income' : 'Transfers'}</div>
              <button className="btn sm ghost" onClick={() => s.addCategory({ kind, group: kind === 'transfer' ? 'Transfers' : 'Other' })}>
                <Icon name="plus" size={14} /> Add
              </button>
            </div>
            <div className="setup-rows">
              {s.categories
                .filter((c) => c.kind === kind)
                .map((c) => (
                  <div key={c.id} className="setup-row">
                    <input className="input" value={c.name} aria-label="Category name" onChange={(e) => s.updateCategory(c.id, { name: e.target.value })} />
                    <input className="input group-input" value={c.group} aria-label="Group" placeholder="Group" onChange={(e) => s.updateCategory(c.id, { group: e.target.value })} />
                    {kind === 'expense' && (
                      <>
                        <select className="input" value={c.deductiblePct} aria-label="Deductible share" onChange={(e) => s.updateCategory(c.id, { deductiblePct: Number(e.target.value) as Category['deductiblePct'] })}>
                          <option value={0}>Not deductible</option>
                          <option value={50}>50% deductible</option>
                          <option value={100}>Fully deductible</option>
                        </select>
                        <select className="input" value={c.taxRole} aria-label="Tax payment" onChange={(e) => s.updateCategory(c.id, { taxRole: e.target.value as Category['taxRole'] })}>
                          <option value="none">Not a tax payment</option>
                          <option value="federal-estimate">Federal estimated tax</option>
                          <option value="state-estimate">State estimated tax</option>
                        </select>
                      </>
                    )}
                    <button className="btn icon ghost" aria-label={`Delete ${c.name}`} onClick={() => confirm(`Delete “${c.name}”? Its transactions become uncategorized.`) && s.deleteCategory(c.id)}>
                      <Icon name="trash" />
                    </button>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
