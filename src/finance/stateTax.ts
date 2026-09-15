import type { Cents, FilingStatus, TaxProfile } from './types';

export type StateCode = 'ME' | 'flat';

export const STATE_OPTIONS: { code: StateCode; name: string }[] = [
  { code: 'ME', name: 'Maine' },
  { code: 'flat', name: 'Other state (flat rate)' },
];

interface StateYearRules {
  year: number;
  source: string;
  /** [upper bound of bracket in dollars, marginal rate]; the last bound is Infinity. */
  brackets: Record<FilingStatus, [number, number][]>;
  standardDeduction: Record<FilingStatus, number>;
  /** Per person: the taxpayer, plus a spouse on a joint return. */
  personalExemption: number;
}

const maine = (low: number, mid: number): [number, number][] => [
  [low, 0.058],
  [mid, 0.0675],
  [Infinity, 0.0715],
];

/** Maine Revenue Services individual income tax rate schedules. Update each year like the federal tables. */
const MAINE: Record<number, StateYearRules> = {
  2026: {
    year: 2026,
    source: 'Maine Revenue Services 2026 rate schedules, standard deduction and personal exemption',
    brackets: {
      single: maine(27_400, 64_850),
      mfs: maine(27_400, 64_850),
      hoh: maine(41_100, 97_300),
      mfj: maine(54_850, 129_750),
    },
    standardDeduction: { single: 15_300, mfs: 15_300, hoh: 22_950, mfj: 30_600 },
    personalExemption: 5_300,
  },
};

export interface StateResult {
  code: StateCode;
  name: string;
  tax: Cents;
  /** Only for bracket-based states. */
  taxable: Cents | null;
  deduction: Cents | null;
  exemptions: Cents | null;
  marginal: number | null;
  rulesYear: number | null;
  exactRules: boolean;
  source: string | null;
  /** Where to pay online. */
  payUrl: string | null;
  payLabel: string | null;
}

const bracketTax = (taxable: Cents, brackets: [number, number][]) => {
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
};

/**
 * State income tax from federal AGI. Maine starts from federal AGI and subtracts its own standard deduction
 * (or itemized deductions) and personal exemptions; the federal QBI deduction doesn't carry over.
 * High-income phase-outs of Maine's deduction and exemption are not modeled.
 */
export function computeStateTax(profile: TaxProfile, federalAgi: Cents, year: number): StateResult {
  const code: StateCode = profile.state ?? 'flat';
  if (code === 'ME') {
    const years = Object.keys(MAINE).map(Number).sort((a, b) => a - b);
    const rulesYear = MAINE[year] ? year : year < years[0] ? years[0] : years[years.length - 1];
    const r = MAINE[rulesYear];
    const status = profile.filingStatus;
    const deduction = Math.max(r.standardDeduction[status] * 100, profile.itemizedDeductions ?? 0);
    const exemptions = r.personalExemption * 100 * (status === 'mfj' ? 2 : 1);
    const taxable = Math.max(0, federalAgi - deduction - exemptions);
    const { tax, marginal } = bracketTax(taxable, r.brackets[status]);
    return {
      code,
      name: 'Maine',
      tax,
      taxable,
      deduction,
      exemptions,
      marginal,
      rulesYear,
      exactRules: rulesYear === year,
      source: r.source,
      payUrl: 'https://revenue.maine.gov/',
      payLabel: 'Maine Tax Portal',
    };
  }
  return {
    code,
    name: 'State',
    tax: (Math.max(0, federalAgi) * profile.stateRatePct) / 100,
    taxable: null,
    deduction: null,
    exemptions: null,
    marginal: null,
    rulesYear: null,
    exactRules: true,
    source: null,
    payUrl: null,
    payLabel: null,
  };
}
