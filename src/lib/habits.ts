import type { DateKey, Habit } from '../types';
import { addDays, weekday } from './dates';

/**
 * Habit strength model.
 *
 * Each scheduled occurrence nudges strength toward 1 (done) or 0 (missed):
 *   s = s · m + done · (1 − m)
 * with m = 0.5^(1/HALF_LIFE). Strength therefore reaches 50% after HALF_LIFE
 * consecutive completions and ~97% after 66 — the median time-to-automaticity
 * found by Lally et al. (2010). A miss costs a little; a long lapse erodes it.
 */
export const HALF_LIFE = 13;
const M = Math.pow(0.5, 1 / HALF_LIFE);

export const STRENGTH_LEVELS = [
  { min: 0.9, label: 'Engrained' },
  { min: 0.7, label: 'Strong' },
  { min: 0.4, label: 'Building' },
  { min: 0.15, label: 'Forming' },
  { min: 0, label: 'New' },
];

export const strengthLabel = (s: number) => STRENGTH_LEVELS.find((l) => s >= l.min)!.label;

export const isScheduled = (h: Habit, date: DateKey) => date >= h.startDate && h.days.includes(weekday(date));

export const effectiveStart = (h: Habit): DateKey => {
  let start = h.startDate;
  for (const k of Object.keys(h.log)) if (h.log[k].done && k < start) start = k;
  return start;
};

export interface StrengthPoint {
  date: DateKey;
  value: number;
  done: boolean;
}

/**
 * Strength after each scheduled occurrence up to `until`. Today (if unfinished)
 * is treated as still pending rather than a miss. A completion on an
 * unscheduled day counts as a bonus occurrence.
 */
export function strengthSeries(h: Habit, until: DateKey, today: DateKey): StrengthPoint[] {
  const out: StrengthPoint[] = [];
  let s = 0;
  const start = effectiveStart(h);
  for (let d = start, i = 0; d <= until && i < 20000; d = addDays(d, 1), i++) {
    const done = !!h.log[d]?.done;
    const scheduled = h.days.includes(weekday(d)) && d >= h.startDate;
    if (!scheduled && !done) continue;
    if (d >= today && !done) break;
    s = s * M + (done ? 1 - M : 0);
    out.push({ date: d, value: s, done });
  }
  return out;
}

export const currentStrength = (h: Habit, today: DateKey) => {
  const series = strengthSeries(h, today, today);
  return series.length ? series[series.length - 1].value : 0;
};

export interface StreakStats {
  current: number;
  best: number;
  /** Completion rate over the last 30 scheduled days (excluding a pending today). */
  rate30: number;
}

export function streakStats(h: Habit, today: DateKey): StreakStats {
  const occurrences: boolean[] = [];
  const start = effectiveStart(h);
  for (let d = start, i = 0; d <= today && i < 20000; d = addDays(d, 1), i++) {
    const done = !!h.log[d]?.done;
    if (!isScheduled(h, d)) continue;
    if (d === today && !done) break;
    occurrences.push(done);
  }
  let best = 0;
  let run = 0;
  for (const done of occurrences) {
    run = done ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const recent = occurrences.slice(-30);
  return {
    current: run,
    best,
    rate30: recent.length ? recent.filter(Boolean).length / recent.length : 0,
  };
}
