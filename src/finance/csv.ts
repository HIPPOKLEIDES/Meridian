import type { DateKey } from '../types';
import type { Cents, ImportMapping } from './types';
import { parseMoney } from './money';

/** RFC 4180-ish CSV parser: quoted fields, escaped quotes, CRLF, and a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export type DateFormat = ImportMapping['dateFormat'];

const pad = (n: number) => String(n).padStart(2, '0');

export function parseDate(raw: string, format: DateFormat): DateKey | null {
  const s = raw.trim().split(/[ T]/)[0];
  const parts = s.split(/[/.-]/).map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  let [a, b, c] = parts.map(Number);
  let y: number, m: number, d: number;
  const fmt = format === 'auto' ? (parts[0].length === 4 ? 'ymd' : a > 12 ? 'dmy' : 'mdy') : format;
  if (fmt === 'ymd') [y, m, d] = [a, b, c];
  else if (fmt === 'dmy') [d, m, y] = [a, b, c];
  else [m, d, y] = [a, b, c];
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Guess which columns hold what, from the header row. */
export function guessColumns(header: string[]) {
  const find = (...patterns: RegExp[]) => {
    for (const p of patterns) {
      const i = header.findIndex((h) => p.test(h));
      if (i !== -1) return i;
    }
    return -1;
  };
  return {
    date: find(/^(posted|posting|transaction)?\s*date$/i, /date/i),
    description: find(/^description$/i, /payee|merchant|name/i, /description|details|memo/i),
    amount: find(/^amount$/i, /amount/i),
    debit: find(/debit|withdrawal|money out|paid out/i),
    credit: find(/credit|deposit|money in|paid in/i),
  };
}

const NOISE = [
  /\b(pos|debit card|dbt crd|checkcard|check card|visa|mastercard|purchase|recurring|preauthorized|pre-auth|ach|web|ppd|ccd|online|transfer to|transfer from|withdrawal|deposit)\b/gi,
  /\b(zelle|venmo|cash app|paypal|payment from|payment to|payment|thank you)\b/gi,
  // Point-of-sale prefixes: Toast "TST*", Square "SQ *", Shopify "SP *".
  /\b(tst|sq|sp)\s*\*/gi,
  /\b(card|crd)\s*(ending|#)?\s*\d{4}\b/gi,
  /\b[xX*]{2,}\d{2,}\b/g,
  /#\s*\d+/g,
  /\b\d{2}\/\d{2}(\/\d{2,4})?\b/g,
  /\b\d{6,}\b/g,
  /\b(id|ref|conf|trace)[:#]?\s*\w+/gi,
  /\s[A-Z]{2}\s*$/,
];

/** Turn "DEBIT CARD PURCHASE XXXX1234 WHOLEFDS MKT #10234 AUSTIN TX" into something like "Wholefds Mkt Austin". */
export function cleanPayee(description: string): string {
  const tidy = (x: string) =>
    x
      .replace(/[*_]+/g, ' ')
      .replace(/\s\d{3,5}\s*$/, ' ')
      .replace(/^[\s\-–:]+|[\s\-–:]+$/g, '')
      .replace(/\s{2,}/g, ' ');
  // Bank of America ACH lines look like "CENTRAL MAINE POWER DES:WEB PMT ID:12345 INDN:… CO ID:… PPD"; the payee is before DES:.
  const achPayee = /^(.+?)\s+DES:/i.exec(description)?.[1];
  let s = ` ${achPayee ?? description} `;
  s = s
    .replace(/\b(confirmation#?|conf#?)\s*\S+/gi, ' ')
    .replace(/\bX{3,}\w*/gi, ' ')
    // Reference codes that mix letters and digits, like the "2K4RT8" in "AMAZON MKTPL*2K4RT8".
    .replace(/\*\s*\w+/g, ' ')
    .replace(/\b(?=\w*\d)(?=\w*[a-z])\w{5,}\b/gi, ' ');
  for (const p of NOISE) s = s.replace(p, ' ');
  s = tidy(s);
  // If cleaning stripped nearly everything ("VISA CARD PAYMENT"), keep the original wording.
  if (s.replace(/[^a-z]/gi, '').length < 3 || /^(card|check|bank|account|mobile|online)$/i.test(s)) s = tidy(description);
  if (!s) return description.trim();
  const words = s
    .split(' ')
    .filter((w) => /[a-z0-9]/i.test(w))
    .slice(0, 4);
  // Keep short all-caps abbreviations (MKT, CVS, USA, LLC); title-case everything else.
  const keepCaps = (w: string) => w.length <= 3 && /^[A-Z&]+$/.test(w) && (!/[AEIOU]/.test(w) || ['USA', 'US', 'LLC', 'IRS', 'ATM'].includes(w));
  return words.map((w) => (keepCaps(w) ? w : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ');
}

export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Index of the real header row. Some exports (Bank of America checking/savings) start with a summary block
 * — "Description,,Summary Amt." / beginning & ending balances — before the transaction table.
 */
export function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const g = guessColumns(rows[i]);
    if (g.date !== -1 && (g.amount !== -1 || (g.debit !== -1 && g.credit !== -1))) return i;
  }
  return 0;
}

const hasColumns = (header: string[], ...names: string[]) =>
  names.every((n) => header.some((h) => h.trim().toLowerCase() === n.toLowerCase()));

/** Name of a recognized bank export, from its header row. */
export function detectBank(header: string[]): string | null {
  if (hasColumns(header, 'Date', 'Description', 'Amount', 'Running Bal.')) return 'Bank of America checking or savings';
  if (hasColumns(header, 'Posted Date', 'Payee', 'Amount')) return 'Bank of America credit card';
  if (hasColumns(header, 'Transaction Date', 'Post Date', 'Description', 'Category', 'Type', 'Amount')) return 'Chase credit card';
  if (hasColumns(header, 'Details', 'Posting Date', 'Description', 'Amount', 'Type', 'Balance')) return 'Chase checking';
  if (hasColumns(header, 'Transaction Description', 'Transaction Date', 'Transaction Amount')) return 'Capital One 360';
  if (hasColumns(header, 'Transaction Date', 'Posted Date', 'Description', 'Debit', 'Credit')) return 'Capital One credit card';
  return null;
}

/** Best-guess mapping from the header and a sample of rows. */
export function suggestMapping(header: string[], body: string[][]): ImportMapping {
  const g = guessColumns(header);
  const typeColumn = header.findIndex((h) => /^(transaction\s*)?type$/i.test(h.trim()));
  const categoryColumn = header.findIndex((h) => /^(transaction\s*)?category$/i.test(h.trim()));
  let mode: ImportMapping['mode'] = 'signed';
  if (g.amount === -1 && g.debit !== -1 && g.credit !== -1) mode = 'split';
  else if (g.amount !== -1 && typeColumn !== -1) {
    // Unsigned amounts with a Credit/Debit column (e.g. Capital One 360).
    const sample = body.slice(0, 60);
    const amounts = sample.map((r) => parseMoney(r[g.amount] ?? '')).filter((v): v is number => v !== null);
    const types = sample.map((r) => (r[typeColumn] ?? '').trim()).filter(Boolean);
    if (amounts.length && amounts.every((v) => v >= 0) && types.length && types.every((t) => /credit|debit|deposit|withdrawal/i.test(t))) {
      mode = 'type';
    }
  }
  return {
    signature: header.join(','),
    date: Math.max(0, g.date),
    description: g.description === -1 ? Math.min(1, header.length - 1) : g.description,
    mode,
    amount: g.amount === -1 ? Math.min(2, header.length - 1) : g.amount,
    debit: g.debit,
    credit: g.credit,
    typeColumn,
    categoryColumn,
    positiveIs: 'in',
    dateFormat: 'auto',
  };
}

export interface ParsedRow {
  date: DateKey | null;
  description: string;
  /** + money in, − money out; null when the row has no usable amount. */
  signed: Cents | null;
  bankCategory: string;
  bankType: string;
}

export function readRow(r: string[], m: ImportMapping): ParsedRow {
  const date = parseDate(r[m.date] ?? '', m.dateFormat);
  const description = (r[m.description] ?? '').trim();
  const bankCategory = m.categoryColumn >= 0 ? (r[m.categoryColumn] ?? '').trim() : '';
  const bankType = m.typeColumn >= 0 ? (r[m.typeColumn] ?? '').trim() : '';
  let signed: Cents | null = null;
  if (m.mode === 'signed') {
    const v = parseMoney(r[m.amount] ?? '');
    signed = v === null ? null : m.positiveIs === 'in' ? v : -v;
  } else if (m.mode === 'split') {
    const out = m.debit >= 0 ? parseMoney(r[m.debit] ?? '') ?? 0 : 0;
    const inn = m.credit >= 0 ? parseMoney(r[m.credit] ?? '') ?? 0 : 0;
    signed = out === 0 && inn === 0 ? null : Math.abs(inn) - Math.abs(out);
  } else {
    const v = parseMoney(r[m.amount] ?? '');
    signed = v === null ? null : /credit|deposit/i.test(bankType) ? Math.abs(v) : -Math.abs(v);
  }
  // Bank of America lists the opening balance as a row with no amount.
  if (/^beginning balance/i.test(description)) signed = null;
  return { date, description, signed, bankCategory, bankType };
}

const BANK_CATEGORY_HINTS: [RegExp, string][] = [
  [/grocer/i, 'exp-groceries'],
  [/food|drink|dining|restaurant/i, 'exp-dining'],
  [/gas|automotive|fuel/i, 'exp-transport'],
  [/travel|airfare|lodging/i, 'exp-travel'],
  [/shopping|merchandise/i, 'exp-shopping'],
  [/entertainment/i, 'exp-entertainment'],
  [/health|wellness|medical/i, 'exp-health'],
  [/bills|utilities|phone|internet|cable/i, 'exp-utilities'],
  [/personal/i, 'exp-personal'],
  [/gift|donation/i, 'exp-giving'],
  [/education/i, 'exp-education'],
  [/insurance/i, 'exp-insurance'],
  [/fees|adjustment/i, 'exp-fees'],
];

export type HintSource = 'card-payment' | 'transfer' | 'tax-payment' | 'bank-category' | 'interest' | 'refund';

/** Category suggestions from what the bank tells us, used after rules and payee defaults. */
export function hintCategory(row: ParsedRow, accountType: string): { categoryId: string; source: HintSource } | null {
  const d = row.description;
  const signed = row.signed ?? 0;
  if (accountType === 'credit' && signed > 0 && (/payment/i.test(row.bankType) || /payment|thank you|autopay/i.test(d))) {
    return { categoryId: 'xfer-card', source: 'card-payment' };
  }
  if (accountType !== 'credit' && signed < 0) {
    if (/credit\s*(card|crd)|payment to crd|card\s*services|\b(chase|capital one|amex|american express|discover|citi|barclays)\b.*\b(epay|autopay|pmt|payment)\b/i.test(d)) {
      return { categoryId: 'xfer-card', source: 'card-payment' };
    }
  }
  if (signed < 0 && /usataxpymt|\birs\b.*(1040|est)/i.test(d)) return { categoryId: 'tax-federal', source: 'tax-payment' };
  if (signed < 0 && /maine revenue|me revenue|state of maine.*tax|maine.*est(imated)? tax/i.test(d)) return { categoryId: 'tax-state', source: 'tax-payment' };
  // "Deposit from BANK OF AMERICA" / "Withdrawal to …" is how Capital One 360 shows moves to and from a linked bank.
  if (/online banking transfer|transfer (to|from)|des:\s*transfer|capital one.*(transfer|360)|^(deposit from|withdrawal to)\b/i.test(d)) {
    return { categoryId: 'xfer-transfer', source: 'transfer' };
  }
  if (signed < 0 && row.bankCategory) {
    const hit = BANK_CATEGORY_HINTS.find(([re]) => re.test(row.bankCategory));
    if (hit) return { categoryId: hit[1], source: 'bank-category' };
  }
  if (signed > 0 && /interest/i.test(d)) return { categoryId: 'inc-interest', source: 'interest' };
  if (signed > 0 && accountType === 'credit' && /return|refund/i.test(`${row.bankType} ${d}`)) return { categoryId: 'inc-refunds', source: 'refund' };
  return null;
}
