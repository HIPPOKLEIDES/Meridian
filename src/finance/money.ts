import type { Cents } from './types';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

export const fmtMoney = (c: Cents, opts: { whole?: boolean; sign?: boolean } = {}) => {
  const s = (opts.whole ? usdWhole : usd).format(Math.abs(c) / 100);
  if (c < 0) return `−${s}`;
  return opts.sign && c > 0 ? `+${s}` : s;
};

export const fmtMoneyCompact = (c: Cents) => (Math.abs(c) < 100_000 ? fmtMoney(c, { whole: true }) : usdCompact.format(c / 100));

/** Parses "1,234.56", "$-12", "(45.00)", "12.3-" → cents. Returns null if it isn't a number. */
export function parseMoney(raw: string): Cents | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/[$€£\s,]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return negative ? -cents : cents;
}

export const toDollars = (c: Cents | null) => (c === null ? '' : String(c / 100));
