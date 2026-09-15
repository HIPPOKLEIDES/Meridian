import { useMemo, useState } from 'react';
import type { FilingStatus, TaxProfile } from './types';
import { useFinance } from './store';
import { defaultTaxProfile, estimateTaxes, type Installment, type LedgerTotals } from './tax';
import { FILING_LABELS } from './taxRules';
import { STATE_OPTIONS, type StateCode } from './stateTax';
import { fmtMoney } from './money';
import { MoneyInput } from './shared';
import { Empty, Field, Icon } from '../components/common';
import { diffDays, fmtDateShort, fromKey, relativeDays, todayKey } from '../lib/dates';
import { navigate } from '../lib/hooks';

const pct = (r: number | null, digits = 0) => (r === null ? '–' : `${(r * 100).toFixed(digits)}%`);
const money = (c: number) => fmtMoney(Math.round(c), { whole: true });

export function TaxesTab() {
  const data = useFinance();
  const today = todayKey();
  const currentYear = fromKey(today).getFullYear();
  const [year, setYear] = useState(currentYear);
  const years = [...new Set([currentYear, currentYear - 1, ...Object.keys(data.taxProfiles).map(Number)])].sort((a, b) => b - a);
  const profile = data.taxProfiles[year] ?? defaultTaxProfile();
  const setProfile = (p: Partial<TaxProfile>) => data.setTaxProfile(year, { ...profile, ...p });
  const est = useMemo(() => estimateTaxes(data, profile, year, today), [data, profile, year, today]);
  const hasBusiness = data.ledgers.some((l) => l.taxTreatment === 'schedule-c');
  const next = est.installments.find((i) => i.status === 'past-due') ?? est.installments.find((i) => i.status === 'next');
  const st = est.calc.state;
  const stateName = st.code === 'flat' ? 'State' : st.name;
  const anyEstimates = est.estimatesRequired || est.stateEstimatesRequired;

  return (
    <>
      <div className="toolbar">
        <label className="inline-label">
          Tax year
          <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <span className="small muted">
          Uses {est.rules.year} federal figures ({est.rules.source}){st.source && `, and ${st.source}`}.
        </span>
      </div>
      {!est.exactRules && (
        <div className="notice is-error">
          Meridian doesn't have {year} federal tax tables yet, so this uses {est.rules.year}'s. Update <code>src/finance/taxRules.ts</code> when the IRS publishes them.
        </div>
      )}
      {!st.exactRules && (
        <div className="notice is-error">
          Meridian doesn't have {year} {st.name} tables yet, so this uses {st.rulesYear}'s. Update <code>src/finance/stateTax.ts</code> when Maine Revenue Services publishes them.
        </div>
      )}

      <section className="card tax-hero">
        {!hasBusiness ? (
          <div className="stack">
            <b>No self-employment income to estimate.</b>
            <span className="small">Mark a business ledger as “Taxed as self-employment (Schedule C)” in Setup to see quarterly estimates.</span>
            <button className="btn" onClick={() => navigate('finance/setup')}>
              Open setup
            </button>
          </div>
        ) : !anyEstimates ? (
          <div className="stack tight">
            <span className="stat-label">Estimated payments</span>
            <span className="hero-value">Probably not needed for {year}</span>
            <span className="small">
              Projected tax after withholding is {money(Math.max(0, est.calc.federalTotal - est.withholding))} federal and{' '}
              {money(Math.max(0, est.calc.stateTax - est.stateWithholding))} {stateName}. Estimated payments are generally required only when
              you'd owe $1,000 or more.
            </span>
          </div>
        ) : next ? (
          <div className="tax-next">
            <div className="stack tight">
              <span className="stat-label">
                {next.status === 'past-due' ? 'Past due' : 'Next payment'} · Q{next.n} · due {fromKey(next.due).toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' })}
                {next.status !== 'past-due' && ` (${relativeDays(diffDays(today, next.due))})`}
              </span>
              <span className="hero-value">{money(next.federalToPay + next.stateToPay)}</span>
              <span className="small">
                {money(next.federalToPay)} to the IRS · {money(next.stateToPay)} to {stateName}
              </span>
            </div>
            <div className="stack tight tax-next-side">
              {est.setAsideRate !== null && (
                <span className="small">
                  Set aside about <b>{pct(est.setAsideRate)}</b> of each business payment for taxes.
                </span>
              )}
              <div className="row tight wrap">
                <a className="btn" href="https://www.irs.gov/payments/direct-pay" target="_blank" rel="noreferrer">
                  IRS Direct Pay <Icon name="right" size={14} />
                </a>
                {st.payUrl && (
                  <a className="btn" href={st.payUrl} target="_blank" rel="noreferrer">
                    {st.payLabel} <Icon name="right" size={14} />
                  </a>
                )}
              </div>
              <span className="small muted">Record payments under “Federal estimated tax” and “State estimated tax” so they count here.</span>
            </div>
          </div>
        ) : (
          <div className="stack tight">
            <span className="stat-label">Estimated payments</span>
            <span className="hero-value">All caught up for {year}</span>
            {est.setAsideRate !== null && <span className="small">Keep setting aside about {pct(est.setAsideRate)} of business income.</span>}
          </div>
        )}
      </section>

      {hasBusiness && anyEstimates && <InstallmentTable installments={est.installments} today={today} stateName={stateName} />}

      <div className="two-col">
        <section className="card stack">
          <h3 className="card-title">Your situation in {year}</h3>
          <div className="row wrap">
            <Field label="Filing status">
              <select className="input" value={profile.filingStatus} onChange={(e) => setProfile({ filingStatus: e.target.value as FilingStatus })}>
                {Object.entries(FILING_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="State">
              <select className="input" value={profile.state ?? 'flat'} onChange={(e) => setProfile({ state: e.target.value as StateCode })}>
                {STATE_OPTIONS.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            {(profile.state ?? 'flat') === 'flat' && (
              <Field label="State + local rate (%)" hint="A flat approximation of your state's income tax.">
                <input className="input" type="number" min={0} max={15} step={0.1} value={profile.stateRatePct} onChange={(e) => setProfile({ stateRatePct: Math.max(0, Number(e.target.value) || 0) })} />
              </Field>
            )}
          </div>
          <div className="row wrap">
            <Field label="W-2 wages for the year">
              <MoneyInput value={profile.w2Wages} onChange={(c) => setProfile({ w2Wages: c ?? 0 })} />
            </Field>
            <Field label="Federal tax withheld from wages">
              <MoneyInput value={profile.w2Withholding} onChange={(c) => setProfile({ w2Withholding: c ?? 0 })} />
            </Field>
            {profile.w2Wages > 0 && (
              <Field label={`${stateName} tax withheld from wages`}>
                <MoneyInput value={profile.stateWithholding ?? 0} onChange={(c) => setProfile({ stateWithholding: c ?? 0 })} />
              </Field>
            )}
          </div>
          <div className="row wrap">
            <Field label="Other taxable income" hint="Interest, dividends, side income outside your ledgers.">
              <MoneyInput value={profile.otherIncome} onChange={(c) => setProfile({ otherIncome: c ?? 0 })} />
            </Field>
            <Field label="Itemized deductions (optional)" hint="Used only if larger than the standard deduction.">
              <MoneyInput allowEmpty placeholder="Standard deduction" value={profile.itemizedDeductions} onChange={(c) => setProfile({ itemizedDeductions: c })} />
            </Field>
          </div>
          <div className="row wrap">
            <Field label={`Total tax on your ${year - 1} return`} hint="Line 24 of Form 1040. Enables the safe-harbor amount.">
              <MoneyInput allowEmpty placeholder="Unknown" value={profile.priorYearTax} onChange={(c) => setProfile({ priorYearTax: c })} />
            </Field>
            <Field label={`${year - 1} adjusted gross income`} hint="Over $150,000 means the safe harbor is 110%.">
              <MoneyInput allowEmpty placeholder="Unknown" value={profile.priorYearAgi} onChange={(c) => setProfile({ priorYearAgi: c })} />
            </Field>
            <Field label={`Total ${stateName} tax on your ${year - 1} return`} hint={st.code === 'ME' ? 'From Form 1040ME. Enables the Maine safe-harbor amount.' : 'Enables the state safe-harbor amount.'}>
              <MoneyInput allowEmpty placeholder="Unknown" value={profile.priorYearStateTax ?? null} onChange={(c) => setProfile({ priorYearStateTax: c })} />
            </Field>
          </div>
          <Field label="Expected full-year business profit (optional)" hint={`Leave blank to project from year-to-date (${pct(est.fractionOfYear)} of the year has passed).`}>
            <MoneyInput allowEmpty placeholder={`Projected: ${money(est.projectedProfit)}`} value={profile.profitOverride} onChange={(c) => setProfile({ profitOverride: c })} />
          </Field>
        </section>

        <section className="card">
          <h3 className="card-title">How the estimate adds up</h3>
          <dl className="calc">
            <Line label="Business profit so far" value={est.ytdProfit} />
            <Line
              label={est.projected ? `Projected for the full year (from ${pct(est.fractionOfYear)} of the year)` : profile.profitOverride !== null ? 'Your full-year profit estimate' : 'Full-year business profit'}
              value={est.projectedProfit}
              strong
            />
            {profile.w2Wages > 0 && <Line label="W-2 wages" value={profile.w2Wages} />}
            {profile.otherIncome > 0 && <Line label="Other income" value={profile.otherIncome} />}
            <Line label="Less: half of self-employment tax" value={-est.calc.halfSe} />
            <Line label="Adjusted gross income (approx.)" value={est.calc.agi} strong />
            <Line label={est.calc.itemized ? 'Less: itemized deductions' : `Less: standard deduction (${FILING_LABELS[profile.filingStatus].toLowerCase()})`} value={-est.calc.deduction} />
            <Line label="Less: qualified business income deduction (20%)" value={-est.calc.qbiDeduction} note={est.calc.qbiMayBeLimited ? 'May be limited at this income; not modeled.' : undefined} />
            <Line label="Taxable income" value={est.calc.taxable} strong />
            <Line label={`Income tax (top bracket ${pct(est.calc.marginal)})`} value={est.calc.incomeTax} />
            <Line
              label="Self-employment tax"
              value={est.calc.seTax}
              note={`Social Security ${money(est.calc.ssTax)} + Medicare ${money(est.calc.medicareTax + est.calc.addlMedicare)}`}
            />
            <Line label="Total federal tax" value={est.calc.federalTotal} strong />
            {est.withholding > 0 && <Line label="Less: withheld from wages" value={-est.withholding} />}
            <Line
              label="Required through estimates (federal)"
              value={est.estimatesRequired ? Math.max(0, est.safeHarbor.required - est.withholding) : 0}
              note={
                est.safeHarbor.prior !== null
                  ? `Lower of 90% of this year (${money(est.safeHarbor.current90)}) and ${est.safeHarbor.prior > (profile.priorYearTax ?? 0) ? '110%' : '100%'} of last year (${money(est.safeHarbor.prior)}).`
                  : `90% of this year's projected tax. Add last year's tax to see if the safe harbor is lower.`
              }
            />
            <Line label="Federal estimates paid" value={est.federalPaid} />

            {st.code === 'ME' ? (
              <>
                <Line label="Maine: federal AGI" value={est.calc.agi} strong />
                <Line label={est.calc.itemized ? 'Less: itemized deductions' : 'Less: Maine standard deduction'} value={-(st.deduction ?? 0)} />
                <Line label="Less: personal exemption" value={-(st.exemptions ?? 0)} note="Maine doesn't allow the federal QBI deduction." />
                <Line label="Maine taxable income" value={st.taxable ?? 0} strong />
                <Line label={`Maine income tax (top bracket ${pct(st.marginal, 2)})`} value={est.calc.stateTax} strong note="High-income phase-outs of the deduction and exemption aren't modeled." />
              </>
            ) : (
              <Line label={`State & local (${profile.stateRatePct}% of AGI)`} value={est.calc.stateTax} strong />
            )}
            {est.stateWithholding > 0 && <Line label="Less: withheld from wages" value={-est.stateWithholding} />}
            <Line
              label={`Required through estimates (${stateName})`}
              value={est.stateEstimatesRequired ? Math.max(0, est.stateSafeHarbor.required - est.stateWithholding) : 0}
              note={
                est.stateSafeHarbor.prior !== null
                  ? `Lower of 90% of this year (${money(est.stateSafeHarbor.current90)}) and last year's tax (${money(est.stateSafeHarbor.prior)}; 110% is used when last year's federal AGI was over $150,000, to be safe).`
                  : `90% of this year's projected tax. Add last year's ${stateName} tax to see if the safe harbor is lower.`
              }
            />
            <Line label={`${stateName} estimates paid`} value={est.statePaid} />
          </dl>
          <p className="small muted">
            Effective rate {pct(est.effectiveRate, 1)} of income. This is an estimate from your own records. It leaves out credits, capital gains,
            retirement contributions, self-employed health insurance and state-specific rules, so check it with a tax professional before
            relying on it.
          </p>
        </section>
      </div>

      {est.businesses.map((b) => (
        <BusinessSummary key={b.ledger.id} totals={b} year={year} />
      ))}
    </>
  );
}

function Line({ label, value, strong, note }: { label: string; value: number; strong?: boolean; note?: string }) {
  return (
    <div className={`calc-line${strong ? ' is-strong' : ''}`}>
      <dt>
        {label}
        {note && <span className="calc-note">{note}</span>}
      </dt>
      <dd>{money(value)}</dd>
    </div>
  );
}

function InstallmentTable({ installments, today, stateName }: { installments: Installment[]; today: string; stateName: string }) {
  const label: Record<Installment['status'], string> = { covered: 'Covered', 'past-due': 'Past due', next: 'Next', upcoming: 'Upcoming' };
  return (
    <section className="card flush">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="align-left">Installment</th>
              <th className="num">Due</th>
              <th className="num">Federal share</th>
              <th className="num">Federal paid</th>
              <th className="num">{stateName} share</th>
              <th className="num">{stateName} paid</th>
              <th className="num">Still to pay</th>
              <th className="align-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {installments.map((i) => (
              <tr key={i.n} className={i.status === 'next' ? 'is-selected' : ''}>
                <td className="align-left">Q{i.n}</td>
                <td className="num nowrap">{fmtDateShort(i.due)}{i.due.slice(0, 4) !== today.slice(0, 4) ? `, ${i.due.slice(0, 4)}` : ''}</td>
                <td className="num">{money(i.federalRequired)}</td>
                <td className="num">{i.federalPaid ? money(i.federalPaid) : '–'}</td>
                <td className="num">{money(i.stateRequired)}</td>
                <td className="num">{i.statePaid ? money(i.statePaid) : '–'}</td>
                <td className="num">
                  <b>{i.federalToPay + i.stateToPay > 0 ? money(i.federalToPay + i.stateToPay) : '–'}</b>
                </td>
                <td className="align-left">
                  <span className={`status-chip is-${i.status}`}>
                    {i.status === 'covered' && <Icon name="check" size={12} />}
                    {label[i.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted table-foot">
        Shares assume equal quarterly installments. “Paid” shows payments dated in each installment's window; “still to pay” is the running total
        required by that date minus everything paid so far. Maine uses the same due dates as the IRS. Payment periods aren't calendar quarters:
        the June payment covers April–May and the September payment covers June–August.
      </p>
    </section>
  );
}

function BusinessSummary({ totals, year }: { totals: LedgerTotals; year: number }) {
  return (
    <section className="card stack">
      <header className="card-head">
        <div>
          <h3 className="card-title">
            {totals.ledger.name} · {year}
          </h3>
          <span className="small muted">Schedule C style summary, year to date</span>
        </div>
        <div className="big-line">
          <span className="muted small">Net profit</span>
          <span className="stat-value">{money(totals.profit)}</span>
        </div>
      </header>
      {totals.uncategorized > 0 && (
        <div className="notice is-error">
          {money(totals.uncategorized)} of spending is uncategorized and not counted as deductible.{' '}
          <button className="link" onClick={() => navigate('finance/transactions/uncategorized')}>
            Categorize it
          </button>
        </div>
      )}
      <div className="three-col">
        <div>
          <div className="group-label">Income {money(totals.income)}</div>
          {totals.incomeLines.length === 0 ? <Empty>No income recorded.</Empty> : (
            <ul className="top-list">
              {totals.incomeLines.map((l) => (
                <li key={l.name}>
                  <span>{l.name}</span>
                  <b>{money(l.amount)}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="group-label">
            Expenses {money(totals.expenses)} · deductible {money(totals.deductible)}
          </div>
          {totals.expenseLines.length === 0 ? <Empty>No expenses recorded.</Empty> : (
            <ul className="top-list">
              {totals.expenseLines.map((l) => (
                <li key={l.name}>
                  <span>
                    {l.name}
                    {l.deductible !== l.amount && <span className="muted"> ({money(l.deductible)} deductible)</span>}
                  </span>
                  <b>{money(l.amount)}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="group-label">Who paid you</div>
          {totals.payers.length === 0 ? <Empty>No payers yet.</Empty> : (
            <ul className="top-list">
              {totals.payers.map((p) => (
                <li key={p.counterparty?.id ?? 'none'}>
                  <span>{p.counterparty?.name ?? 'Unknown payer'}</span>
                  <b>{money(p.amount)}</b>
                </li>
              ))}
            </ul>
          )}
          <p className="small muted">Compare with the 1099-NEC and 1099-K forms you receive in January.</p>
        </div>
      </div>
    </section>
  );
}
