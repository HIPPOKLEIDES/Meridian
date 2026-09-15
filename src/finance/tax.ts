import type { DateKey, ID } from '../types';
import type { Cents, Counterparty, FinanceData, Ledger, TaxProfile, TaxRole } from './types';
import type { YearRules } from './taxRules';
import { rulesFor } from './taxRules';
import { computeStateTax } from './stateTax';
import { diffDays, toKey } from '../lib/dates';

export const defaultTaxProfile = (): TaxProfile => ({
  filingStatus: 'single',
  state: 'ME',
  stateRatePct: 5,
  stateWithholding: 0,
  priorYearStateTax: null,
  w2Wages: 0,
  w2Withholding: 0,
  otherIncome: 0,
  priorYearTax: null,
  priorYearAgi: null,
  itemizedDeductions: null,
  profitOverride: null,
});

export interface CategoryLine {
  categoryId: ID | null;
  name: string;
  amount: Cents;
  deductible: Cents;
}

export interface LedgerTotals {
  ledger: Ledger;
  income: Cents;
  expenses: Cents;
  deductible: Cents;
  uncategorized: Cents;
  profit: Cents;
  incomeLines: CategoryLine[];
  expenseLines: CategoryLine[];
  payers: { counterparty: Counterparty | null; amount: Cents }[];
}

/** Income, expenses and deductible expenses for one ledger over a date range. Transfers and tax payments are excluded. */
export function ledgerTotals(data: FinanceData, ledger: Ledger, from: DateKey, to: DateKey): LedgerTotals {
  const accounts = new Set(data.accounts.filter((a) => a.ledgerId === ledger.id).map((a) => a.id));
  const cats = new Map(data.categories.map((c) => [c.id, c]));
  const people = new Map(data.counterparties.map((c) => [c.id, c]));
  const income = new Map<string, CategoryLine>();
  const expense = new Map<string, CategoryLine>();
  const payers = new Map<string, Cents>();
  const totals = { income: 0, expenses: 0, deductible: 0, uncategorized: 0 };

  for (const t of data.transactions) {
    if (t.date < from || t.date > to || t.kind === 'transfer' || !accounts.has(t.accountId)) continue;
    const cat = t.categoryId ? cats.get(t.categoryId) : undefined;
    if (cat && cat.taxRole !== 'none') continue;
    const key = cat?.id ?? 'none';
    const name = cat?.name ?? 'Uncategorized';
    if (t.kind === 'income') {
      totals.income += t.amount;
      const line = income.get(key) ?? { categoryId: cat?.id ?? null, name, amount: 0, deductible: 0 };
      line.amount += t.amount;
      income.set(key, line);
      const payer = t.counterpartyId ?? 'none';
      payers.set(payer, (payers.get(payer) ?? 0) + t.amount);
    } else {
      totals.expenses += t.amount;
      const deductible = cat ? Math.round((t.amount * cat.deductiblePct) / 100) : 0;
      if (!cat) totals.uncategorized += t.amount;
      totals.deductible += deductible;
      const line = expense.get(key) ?? { categoryId: cat?.id ?? null, name, amount: 0, deductible: 0 };
      line.amount += t.amount;
      line.deductible += deductible;
      expense.set(key, line);
    }
  }
  const byAmount = (a: { amount: Cents }, b: { amount: Cents }) => b.amount - a.amount;
  return {
    ledger,
    ...totals,
    profit: totals.income - totals.deductible,
    incomeLines: [...income.values()].sort(byAmount),
    expenseLines: [...expense.values()].sort(byAmount),
    payers: [...payers.entries()].map(([id, amount]) => ({ counterparty: people.get(id) ?? null, amount })).sort(byAmount),
  };
}

function bracketTax(taxable: Cents, brackets: [number, number][]) {
  let tax = 0;
  let lower = 0;
  let marginal = brackets[0][1];
  for (const [upperDollars, rate] of brackets) {
    const upper = upperDollars * 100;
    if (taxable > lower) {
      tax += (Math.min(taxable, upper) - lower) * rate;
      marginal = rate;
    }
    lower = upper;
  }
  return { tax, marginal };
}

/** The federal + state calculation for a given full-year business profit. */
function calculate(p: TaxProfile, r: YearRules, profit: Cents, year: number) {
  const status = p.filingStatus;
  const seEarnings = Math.max(0, profit) * 0.9235;
  const hasSe = seEarnings >= 400 * 100;
  const ssRoom = Math.max(0, r.ssWageBase * 100 - p.w2Wages);
  const ssTax = hasSe ? 0.124 * Math.min(seEarnings, ssRoom) : 0;
  const medicareTax = hasSe ? 0.029 * seEarnings : 0;
  const addlRoom = Math.max(0, r.addlMedicareThreshold[status] * 100 - p.w2Wages);
  const addlMedicare = hasSe ? 0.009 * Math.max(0, seEarnings - addlRoom) : 0;
  const halfSe = (ssTax + medicareTax) / 2;
  const agi = p.w2Wages + p.otherIncome + profit - halfSe;
  const standard = r.standardDeduction[status] * 100;
  const deduction = Math.max(standard, p.itemizedDeductions ?? 0);
  const beforeQbi = Math.max(0, agi - deduction);
  const qbiBase = Math.max(0, profit - halfSe);
  const qbiDeduction = Math.min(0.2 * qbiBase, 0.2 * beforeQbi);
  const taxable = Math.max(0, beforeQbi - qbiDeduction);
  const { tax: incomeTax, marginal } = bracketTax(taxable, r.brackets[status]);
  const seTax = ssTax + medicareTax + addlMedicare;
  const state = computeStateTax(p, agi, year);
  return {
    seEarnings,
    ssTax,
    medicareTax,
    addlMedicare,
    seTax,
    halfSe,
    agi,
    deduction,
    itemized: deduction > standard,
    qbiDeduction,
    qbiMayBeLimited: qbiBase > 0 && beforeQbi > r.qbiThreshold[status] * 100,
    taxable,
    incomeTax,
    marginal,
    federalTotal: incomeTax + seTax,
    state,
    stateTax: state.tax,
  };
}

/** Next business day on or after the date (federal holidays are not accounted for). */
function businessDay(y: number, m: number, d: number): DateKey {
  const date = new Date(y, m - 1, d);
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
  return toKey(date);
}

export const installmentDueDates = (year: number): DateKey[] => [
  businessDay(year, 4, 15),
  businessDay(year, 6, 15),
  businessDay(year, 9, 15),
  businessDay(year + 1, 1, 15),
];

export type InstallmentStatus = 'covered' | 'past-due' | 'next' | 'upcoming';

export interface Installment {
  n: number;
  due: DateKey;
  /** Payments dated in (previous due date, this due date] count toward this installment. */
  from: DateKey;
  federalRequired: Cents;
  federalPaid: Cents;
  stateRequired: Cents;
  statePaid: Cents;
  /** Shortfall to pay by this date, counting everything paid so far. */
  federalToPay: Cents;
  stateToPay: Cents;
  status: InstallmentStatus;
}

export interface TaxEstimate {
  year: number;
  rules: YearRules;
  exactRules: boolean;
  fractionOfYear: number;
  businesses: LedgerTotals[];
  ytdProfit: Cents;
  projectedProfit: Cents;
  projected: boolean;
  calc: ReturnType<typeof calculate>;
  withholding: Cents;
  safeHarbor: { current90: Cents; prior: Cents | null; required: Cents; basis: 'current' | 'prior' };
  estimatesRequired: boolean;
  stateWithholding: Cents;
  stateSafeHarbor: { current90: Cents; prior: Cents | null; required: Cents };
  stateEstimatesRequired: boolean;
  installments: Installment[];
  federalPaid: Cents;
  statePaid: Cents;
  /** Extra tax caused by the business, as a share of its profit: a sensible "set aside" rate. */
  setAsideRate: number | null;
  effectiveRate: number | null;
}

export function estimateTaxes(data: FinanceData, profile: TaxProfile, year: number, today: DateKey): TaxEstimate {
  const { rules, exact } = rulesFor(year);
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const fraction = today < start ? 0 : today > end ? 1 : (diffDays(start, today) + 1) / (diffDays(start, end) + 1);

  const businesses = data.ledgers.filter((l) => l.taxTreatment === 'schedule-c').map((l) => ledgerTotals(data, l, start, end));
  const ytdProfit = businesses.reduce((s, b) => s + b.profit, 0);
  const projected = profile.profitOverride === null && fraction > 0 && fraction < 1;
  const projectedProfit =
    profile.profitOverride ?? (fraction >= 1 ? ytdProfit : fraction <= 0 ? 0 : Math.round(ytdProfit / Math.max(fraction, 1 / 12)));

  const calc = calculate(profile, rules, projectedProfit, year);
  const withoutBusiness = calculate(profile, rules, 0, year);

  // Safe harbor: the lower of 90% of this year's tax and last year's tax (110% when last year's AGI was high).
  const highIncome = (profile.priorYearAgi ?? 0) > (profile.filingStatus === 'mfs' ? 75_000_00 : 150_000_00);
  const priorHarbor = (tax: Cents | null | undefined) => (tax === null || tax === undefined ? null : Math.round(tax * (highIncome ? 1.1 : 1)));
  const current90 = Math.round(calc.federalTotal * 0.9);
  const prior = priorHarbor(profile.priorYearTax);
  const required = prior === null ? current90 : Math.min(current90, prior);
  const withholding = profile.w2Withholding;
  const estimatesRequired = calc.federalTotal - withholding >= 1000_00 && required - withholding > 0;

  const stateWithholding = profile.stateWithholding ?? 0;
  const stateCurrent90 = Math.round(calc.stateTax * 0.9);
  const statePrior = priorHarbor(profile.priorYearStateTax);
  const stateRequired = statePrior === null ? stateCurrent90 : Math.min(stateCurrent90, statePrior);
  // Maine, like the IRS, requires estimates only when you'd owe $1,000 or more after withholding.
  const stateEstimatesRequired = calc.stateTax - stateWithholding >= 1000_00 && stateRequired - stateWithholding > 0;

  const roleOf = new Map(data.categories.map((c) => [c.id, c.taxRole]));
  const payments = (role: TaxRole) =>
    data.transactions.filter((t) => t.kind === 'expense' && t.categoryId && roleOf.get(t.categoryId) === role);
  const fedPayments = payments('federal-estimate');
  const statePayments = payments('state-estimate');

  const dues = installmentDueDates(year);
  const perFederal = estimatesRequired ? Math.max(0, required - withholding) / 4 : 0;
  const perState = stateEstimatesRequired ? Math.max(0, stateRequired - stateWithholding) / 4 : 0;
  const windowOf = (i: number) => ({ from: i === 0 ? `${year}-01-16` : dues[i - 1], to: dues[i] });
  const inWindow = (i: number) => (t: { date: DateKey }) => {
    const w = windowOf(i);
    return (i === 0 ? t.date >= w.from : t.date > w.from) && t.date <= w.to;
  };
  const sum = (ts: { amount: Cents }[]) => ts.reduce((s, t) => s + t.amount, 0);
  // Everything paid toward the year so far; a late payment still catches up earlier installments.
  const fedTotal = sum(fedPayments.filter((t) => dues.some((_, i) => inWindow(i)(t))));
  const stateTotal = sum(statePayments.filter((t) => dues.some((_, i) => inWindow(i)(t))));
  let nextAssigned = false;
  const installments: Installment[] = dues.map((due, i) => {
    const { from } = windowOf(i);
    const federalPaid = sum(fedPayments.filter(inWindow(i)));
    const statePaid = sum(statePayments.filter(inWindow(i)));
    const federalToPay = Math.max(0, Math.round(perFederal * (i + 1) - fedTotal));
    const stateToPay = Math.max(0, Math.round(perState * (i + 1) - stateTotal));
    let status: InstallmentStatus;
    if (federalToPay === 0 && stateToPay === 0) status = 'covered';
    else if (due < today) status = 'past-due';
    else if (!nextAssigned) {
      status = 'next';
      nextAssigned = true;
    } else status = 'upcoming';
    return {
      n: i + 1,
      due,
      from,
      federalRequired: Math.round(perFederal),
      federalPaid,
      stateRequired: Math.round(perState),
      statePaid,
      federalToPay,
      stateToPay,
      status,
    };
  });

  const businessTax = calc.federalTotal + calc.stateTax - (withoutBusiness.federalTotal + withoutBusiness.stateTax);
  const grossIncome = profile.w2Wages + profile.otherIncome + projectedProfit;
  return {
    year,
    rules,
    exactRules: exact,
    fractionOfYear: fraction,
    businesses,
    ytdProfit,
    projectedProfit,
    projected,
    calc,
    withholding,
    safeHarbor: { current90, prior, required, basis: prior !== null && prior < current90 ? 'prior' : 'current' },
    estimatesRequired,
    stateWithholding,
    stateSafeHarbor: { current90: stateCurrent90, prior: statePrior, required: stateRequired },
    stateEstimatesRequired,
    installments,
    federalPaid: fedTotal,
    statePaid: stateTotal,
    setAsideRate: projectedProfit > 0 ? businessTax / projectedProfit : null,
    effectiveRate: grossIncome > 0 ? (calc.federalTotal + calc.stateTax) / grossIncome : null,
  };
}
