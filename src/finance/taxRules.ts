import type { FilingStatus } from './types';

/**
 * Federal figures used by the estimate, in dollars. Update once a year when the IRS publishes
 * inflation adjustments (Rev. Proc. each October) and SSA announces the wage base.
 */
export interface YearRules {
  year: number;
  source: string;
  /** [upper bound of bracket, marginal rate]; the last bound is Infinity. */
  brackets: Record<FilingStatus, [number, number][]>;
  standardDeduction: Record<FilingStatus, number>;
  /** Social Security portion of self-employment tax stops at this much combined wages + SE earnings. */
  ssWageBase: number;
  /** Additional 0.9% Medicare tax threshold (not inflation-indexed). */
  addlMedicareThreshold: Record<FilingStatus, number>;
  /** Above this taxable income the QBI deduction can be limited (W-2 wage / SSTB rules, not modeled). */
  qbiThreshold: Record<FilingStatus, number>;
}

const bracketSet = (bounds: number[]): [number, number][] => {
  const rates = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
  return rates.map((r, i) => [bounds[i] ?? Infinity, r]);
};

const ADDL_MEDICARE: Record<FilingStatus, number> = { single: 200_000, hoh: 200_000, mfj: 250_000, mfs: 125_000 };

export const TAX_RULES: Record<number, YearRules> = {
  2025: {
    year: 2025,
    source: 'IRS Rev. Proc. 2024-40 as amended by the One Big Beautiful Bill Act; SSA 2025 wage base',
    brackets: {
      single: bracketSet([11_925, 48_475, 103_350, 197_300, 250_525, 626_350]),
      mfj: bracketSet([23_850, 96_950, 206_700, 394_600, 501_050, 751_600]),
      mfs: bracketSet([11_925, 48_475, 103_350, 197_300, 250_525, 375_800]),
      hoh: bracketSet([17_000, 64_850, 103_350, 197_300, 250_500, 626_350]),
    },
    standardDeduction: { single: 15_750, mfj: 31_500, mfs: 15_750, hoh: 23_625 },
    ssWageBase: 176_100,
    addlMedicareThreshold: ADDL_MEDICARE,
    qbiThreshold: { single: 197_300, hoh: 197_300, mfs: 197_300, mfj: 394_600 },
  },
  2026: {
    year: 2026,
    source: 'IRS Rev. Proc. 2025-32; SSA 2026 wage base',
    brackets: {
      single: bracketSet([12_400, 50_400, 105_700, 201_775, 256_225, 640_600]),
      mfj: bracketSet([24_800, 100_800, 211_400, 403_550, 512_450, 768_700]),
      mfs: bracketSet([12_400, 50_400, 105_700, 201_775, 256_225, 384_350]),
      hoh: bracketSet([17_700, 67_450, 105_700, 201_775, 256_200, 640_600]),
    },
    standardDeduction: { single: 16_100, mfj: 32_200, mfs: 16_100, hoh: 24_150 },
    ssWageBase: 184_500,
    addlMedicareThreshold: ADDL_MEDICARE,
    qbiThreshold: { single: 201_775, hoh: 201_775, mfs: 201_775, mfj: 403_500 },
  },
};

export const FILING_LABELS: Record<FilingStatus, string> = {
  single: 'Single',
  mfj: 'Married filing jointly',
  mfs: 'Married filing separately',
  hoh: 'Head of household',
};

/** Rules for a year, falling back to the closest known year (flagged so the UI can warn). */
export function rulesFor(year: number): { rules: YearRules; exact: boolean } {
  if (TAX_RULES[year]) return { rules: TAX_RULES[year], exact: true };
  const years = Object.keys(TAX_RULES).map(Number).sort((a, b) => a - b);
  const closest = year < years[0] ? years[0] : years[years.length - 1];
  return { rules: TAX_RULES[closest], exact: false };
}
