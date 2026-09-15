import type { DateKey } from '../types';
import type { Counterparty, FinanceData, Transaction } from './types';
import { emptyFinance, newTransaction } from './store';
import { uid } from '../store';
import { addDays, fromKey, todayKey } from '../lib/dates';
import { mulberry32 } from '../lib/sample';
import { installmentDueDates } from './tax';

/** About a year of personal and freelance-business money, ending today. */
export function sampleFinance(): FinanceData {
  const rand = mulberry32(99);
  const today = todayKey();
  const year = fromKey(today).getFullYear();
  const data = emptyFinance();

  data.ledgers.push({ id: 'studio', name: 'Studio LLC', kind: 'business', taxTreatment: 'schedule-c', createdAt: 0 });
  data.accounts = [
    { id: 'personal-checking', ledgerId: 'personal', name: 'BofA Checking', type: 'checking', openingBalance: 4_200_00, archived: false },
    { id: 'personal-savings', ledgerId: 'personal', name: 'Capital One 360 Savings', type: 'savings', openingBalance: 12_000_00, archived: false },
    { id: 'personal-card', ledgerId: 'personal', name: 'BofA Credit Card', type: 'credit', openingBalance: 0, archived: false },
    { id: 'amazon-card', ledgerId: 'personal', name: 'Amazon Prime Visa', type: 'credit', openingBalance: 0, archived: false },
    { id: 'retirement', ledgerId: 'personal', name: 'Roth IRA', type: 'investment', openingBalance: 24_500_00, archived: false },
    { id: 'studio-checking', ledgerId: 'studio', name: 'BofA Business Checking', type: 'checking', openingBalance: 6_500_00, archived: false },
  ];

  const people: Record<string, Counterparty> = {};
  const who = (name: string, defaultCategoryId: string | null = null) =>
    (people[name] ??= { id: uid(), name, notes: '', defaultCategoryId }).id;

  const txns: Transaction[] = [];
  /** Running card balances, so each monthly payment pays off what was actually charged. */
  const owed: Record<string, number> = {};
  const add = (date: DateKey, kind: Transaction['kind'], dollars: number, accountId: string, categoryId: string | null, counterparty: string | null, description: string, toAccountId: string | null = null) => {
    if (date > today) return;
    if (kind === 'expense') owed[accountId] = (owed[accountId] ?? 0) + dollars;
    if (kind === 'transfer' && toAccountId) owed[toAccountId] = (owed[toAccountId] ?? 0) - dollars;
    txns.push(
      newTransaction({
        date,
        kind,
        amount: Math.round(dollars * 100),
        accountId,
        toAccountId,
        categoryId,
        counterpartyId: counterparty ? who(counterparty) : null,
        description,
      }),
    );
  };
  const vary = (base: number, pct: number) => Math.round(base * (1 + (rand() * 2 - 1) * pct) * 100) / 100;

  const start = addDays(today, -365);
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const date = fromKey(d);
    const dom = date.getDate();
    const dow = date.getDay();

    // Business income: retainer + project invoices.
    if (dom === 1) add(d, 'income', 3_500, 'studio-checking', 'inc-clients', 'Northwind Coffee Co.', 'ACH DEPOSIT NORTHWIND COFFEE RETAINER');
    if (dom === 12 && rand() < 0.75) add(d, 'income', vary(4_800, 0.35), 'studio-checking', 'inc-clients', 'Brightline Apps', 'STRIPE TRANSFER BRIGHTLINE APPS');
    if (dom === 22 && rand() < 0.5) add(d, 'income', vary(2_200, 0.4), 'studio-checking', 'inc-clients', 'Juniper & Co. Architects', 'MOBILE DEPOSIT JUNIPER CO');

    // Business expenses.
    if (dom === 3) add(d, 'expense', 54.99, 'studio-checking', 'biz-software', 'Adobe', 'ADOBE *CREATIVE CLOUD');
    if (dom === 5) add(d, 'expense', 20, 'studio-checking', 'biz-software', 'Figma', 'FIGMA MONTHLY');
    if (dom === 8) add(d, 'expense', 85, 'studio-checking', 'biz-phone', 'Verizon', 'VERIZON WIRELESS PAYMENT');
    if (dom === 18 && rand() < 0.45) add(d, 'expense', vary(900, 0.3), 'studio-checking', 'biz-contractors', 'Sam Okafor (illustrator)', 'ZELLE TO SAM OKAFOR');
    if (dow === 3 && rand() < 0.25) add(d, 'expense', vary(62, 0.4), 'studio-checking', 'biz-meals', 'Café Bloom', 'CAFE BLOOM CLIENT LUNCH');
    if (dom === 27 && rand() < 0.2) add(d, 'expense', vary(340, 0.5), 'studio-checking', 'biz-equipment', 'B&H Photo', 'B&H PHOTO VIDEO');
    if (dom === 15 && date.getMonth() === 2) add(d, 'expense', 450, 'studio-checking', 'biz-professional', 'Harbor CPA', 'HARBOR CPA TAX PREP');
    if (dom === 28) add(d, 'expense', 15, 'studio-checking', 'biz-fees', 'Stripe', 'STRIPE FEES');

    // Owner draw to personal.
    if (dom === 2) add(d, 'transfer', 5_000, 'studio-checking', 'xfer-draw', null, 'TRANSFER TO PERSONAL CHECKING', 'personal-checking');

    // Personal.
    if (dom === 1) add(d, 'expense', 1_850, 'personal-checking', 'exp-housing', 'Maple Street Apartments', 'RENT MAPLE STREET APTS');
    if (dom === 10) add(d, 'expense', vary(120, 0.25), 'personal-checking', 'exp-utilities', 'City Power & Light', 'CITY POWER LIGHT AUTOPAY');
    if (dom === 14) add(d, 'expense', 65, 'personal-checking', 'exp-utilities', 'Fiberlink Internet', 'FIBERLINK INTERNET');
    if (dow === 6) add(d, 'expense', vary(128, 0.3), 'personal-card', 'exp-groceries', 'Whole Foods Market', 'WHOLEFDS MKT #10234');
    if (dow === 2 && rand() < 0.6) add(d, 'expense', vary(34, 0.4), 'personal-card', 'exp-groceries', "Trader Joe's", "TRADER JOE'S #552");
    if ((dow === 5 || dow === 6) && rand() < 0.55) add(d, 'expense', vary(58, 0.5), 'personal-card', 'exp-dining', ['Luigi’s Trattoria', 'Pho House', 'The Green Fork'][Math.floor(rand() * 3)], 'RESTAURANT');
    if (dow === 1 && rand() < 0.5) add(d, 'expense', vary(45, 0.25), 'personal-card', 'exp-transport', 'Shell', 'SHELL OIL 57442');
    if (dom === 6) add(d, 'expense', 49, 'personal-card', 'exp-health', 'Summit Climbing Gym', 'SUMMIT CLIMBING MEMBERSHIP');
    if (dom === 9) add(d, 'expense', 15.49, 'personal-card', 'exp-subscriptions', 'Netflix', 'NETFLIX.COM');
    if ((dom === 7 || dom === 20) && rand() < 0.6) add(d, 'expense', vary(65, 0.6), 'amazon-card', 'exp-shopping', 'Amazon', 'AMAZON MKTPL*2K4RT8');
    if (dom === 23 && (owed['amazon-card'] ?? 0) > 0) add(d, 'transfer', owed['amazon-card'], 'personal-checking', 'xfer-card', null, 'CHASE CREDIT CRD DES:EPAY', 'amazon-card');
    if (dom === 25 && (owed['personal-card'] ?? 0) > 0) add(d, 'transfer', owed['personal-card'], 'personal-checking', 'xfer-card', null, 'BANK OF AMERICA CREDIT CARD BILL PAYMENT', 'personal-card');
    if (dom === 26) add(d, 'transfer', 500, 'personal-checking', 'xfer-savings', null, 'TRANSFER TO SAVINGS', 'personal-savings');
    if (dom === 28) add(d, 'income', vary(38, 0.1), 'personal-savings', 'inc-interest', 'Evergreen Bank', 'INTEREST PAYMENT');
  }

  // Estimated tax payments for the installments already due this year.
  for (const due of installmentDueDates(year)) {
    if (due >= today || !due.startsWith(String(year))) continue;
    add(addDays(due, -2), 'expense', 3_900, 'personal-checking', 'tax-federal', 'IRS', 'IRS USATAXPYMT 1040ES');
    add(addDays(due, -2), 'expense', 1_250, 'personal-checking', 'tax-state', 'Maine Revenue Services', 'MAINE REVENUE SVC DES:EST TAX');
  }
  // One uncategorized import to show the review flow.
  add(addDays(today, -3), 'expense', 212.4, 'studio-checking', null, null, 'SQ *PRINTWORKS STUDIO 8842');

  data.transactions = txns.sort((a, b) => (a.date < b.date ? -1 : 1));
  data.counterparties = Object.values(people);
  const byName = (n: string) => people[n]?.id ?? null;
  data.rules = [
    { id: uid(), pattern: 'WHOLEFDS', counterpartyId: byName('Whole Foods Market'), categoryId: 'exp-groceries', createdAt: 0 },
    { id: uid(), pattern: 'ADOBE', counterpartyId: byName('Adobe'), categoryId: 'biz-software', createdAt: 0 },
    { id: uid(), pattern: 'NETFLIX', counterpartyId: byName('Netflix'), categoryId: 'exp-subscriptions', createdAt: 0 },
    { id: uid(), pattern: 'IRS USATAXPYMT', counterpartyId: byName('IRS'), categoryId: 'tax-federal', createdAt: 0 },
  ];
  data.taxProfiles = {
    [year]: {
      filingStatus: 'single',
      state: 'ME',
      stateRatePct: 5,
      stateWithholding: 0,
      priorYearStateTax: 4_800_00,
      w2Wages: 0,
      w2Withholding: 0,
      otherIncome: 400_00,
      priorYearTax: 14_200_00,
      priorYearAgi: 88_000_00,
      itemizedDeductions: null,
      profitOverride: null,
    },
  };
  return data;
}
