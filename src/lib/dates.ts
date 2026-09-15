import type { DateKey, Minutes } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');

export const toKey = (d: Date): DateKey => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const fromKey = (k: DateKey): Date => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const todayKey = (): DateKey => toKey(new Date());

export const addDays = (k: DateKey, n: number): DateKey => {
  const d = fromKey(k);
  d.setDate(d.getDate() + n);
  return toKey(d);
};

/** Whole days from `a` to `b` (DST-safe). */
export const diffDays = (a: DateKey, b: DateKey): number => {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
};

export const weekday = (k: DateKey): number => fromKey(k).getDay();

export const startOfWeek = (k: DateKey, weekStartsOn: 0 | 1): DateKey => {
  const offset = (weekday(k) - weekStartsOn + 7) % 7;
  return addDays(k, -offset);
};

/** Inclusive list of date keys from `a` to `b`. */
export const rangeKeys = (a: DateKey, b: DateKey): DateKey[] => {
  const out: DateKey[] = [];
  for (let k = a, i = 0; k <= b && i < 5000; k = addDays(k, 1), i++) out.push(k);
  return out;
};

/** 42 cells (6 weeks) covering the given month. */
export const monthGrid = (year: number, month: number, weekStartsOn: 0 | 1): DateKey[] => {
  const first = toKey(new Date(year, month, 1));
  const start = startOfWeek(first, weekStartsOn);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
};

export const nowMinutes = (d = new Date()): Minutes => d.getHours() * 60 + d.getMinutes();

export const fmtClock = (m: Minutes): string => {
  const mm = ((Math.round(m) % 1440) + 1440) % 1440;
  if (Math.round(m) === 1440) return '24:00';
  return `${pad(Math.floor(mm / 60))}:${pad(mm % 60)}`;
};

export const parseClock = (s: string): Minutes | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 1440 ? v : null;
};

export const fmtDuration = (min: number): string => {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

export const fmtHours = (min: number): string => {
  const h = min / 60;
  return h >= 10 ? `${Math.round(h)}h` : `${Math.round(h * 10) / 10}h`;
};

/** "today", "tomorrow", "in 5 days" for a day count from today. */
export const relativeDays = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export const fmtDateLong = (k: DateKey): string =>
  fromKey(k).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export const fmtDateShort = (k: DateKey): string =>
  fromKey(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const fmtMonth = (year: number, month: number): string =>
  new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

export const fmtRange = (a: DateKey | null, b: DateKey | null): string => {
  if (!a && !b) return '';
  const s = a ?? b!;
  const e = b ?? a!;
  return s === e ? fmtDateShort(s) : `${fmtDateShort(s)} – ${fmtDateShort(e)}`;
};

/** Human summary of a weekday set, e.g. "Every day", "Weekdays", "Mon, Wed, Fri". */
export const fmtDays = (days: number[]): string => {
  const set = [...new Set(days)].sort();
  if (set.length === 7) return 'Every day';
  if (set.length === 0) return 'Never';
  if (set.join() === '1,2,3,4,5') return 'Weekdays';
  if (set.join() === '0,6') return 'Weekends';
  return set.map((d) => WEEKDAY_SHORT[d]).join(', ');
};
