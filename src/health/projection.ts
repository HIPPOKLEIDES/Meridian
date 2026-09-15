import type { DateKey } from '../types';
import type { HealthGoal, Injury, Measurement, Metric } from './types';
import { addDays, diffDays } from '../lib/dates';

export interface DailyPoint {
  date: DateKey;
  value: number;
}

/** One value per day, combining same-day readings per the metric's aggregate rule. */
export function dailySeries(metric: Metric, measurements: Measurement[]): DailyPoint[] {
  const byDate = new Map<DateKey, number[]>();
  for (const m of measurements) {
    if (m.metricId !== metric.id) continue;
    const list = byDate.get(m.date) ?? [];
    list.push(m.value);
    byDate.set(m.date, list);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, values]) => ({
      date,
      value:
        metric.aggregate === 'sum'
          ? values.reduce((s, v) => s + v, 0)
          : metric.aggregate === 'avg'
            ? values.reduce((s, v) => s + v, 0) / values.length
            : values[values.length - 1],
    }));
}

export interface LinearFit {
  slope: number;
  intercept: number;
  /** Standard error of the slope. */
  slopeSE: number;
  n: number;
  r2: number;
  origin: DateKey;
}

/** Ordinary least squares of value against day number (days since `origin`). */
export function fitLine(points: DailyPoint[]): LinearFit | null {
  if (points.length < 2) return null;
  const origin = points[0].date;
  const xs = points.map((p) => diffDays(origin, p.date));
  const ys = points.map((p) => p.value);
  const n = points.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const sse = xs.reduce((s, x, i) => s + (ys[i] - (intercept + slope * x)) ** 2, 0);
  const slopeSE = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : Math.abs(slope);
  return { slope, intercept, slopeSE, n, r2: syy === 0 ? 1 : 1 - sse / syy, origin };
}

export const valueAt = (fit: LinearFit, date: DateKey) => fit.intercept + fit.slope * diffDays(fit.origin, date);

/** Recent window used for rates: the last `days` of data, widened until it holds enough points. */
export function recentWindow(points: DailyPoint[], days = 42, minPoints = 4): DailyPoint[] {
  if (!points.length) return [];
  const last = points[points.length - 1].date;
  let window = points.filter((p) => diffDays(p.date, last) <= days);
  if (window.length < minPoints) window = points.slice(-minPoints);
  return window;
}

const MAX_FORECAST_DAYS = 365 * 5;
/** 80% interval: ±1.28 standard errors on the slope. */
const Z80 = 1.2816;

export type ForecastStatus = 'achieved' | 'on-track' | 'behind' | 'wrong-way' | 'flat' | 'no-data' | 'insufficient';

export interface Forecast {
  status: ForecastStatus;
  /** Latest daily value (or 7-day average for `average` goals). */
  current: number | null;
  startValue: number | null;
  /** 0–1 of the way from start to target. */
  progress: number;
  /** Units per week at the recent trend. */
  ratePerWeek: number | null;
  /** Units per week needed to hit the deadline from the current value. */
  requiredPerWeek: number | null;
  eta: DateKey | null;
  /** Faster / slower ends of an 80% range; null means "no reliable bound". */
  etaEarly: DateKey | null;
  etaLate: DateKey | null;
  fit: LinearFit | null;
  window: DailyPoint[];
  /** For average goals: share of the last 30 logged days at or past target. */
  hitRate: number | null;
}

/** Days from `from` until the fitted line crosses `target`, or null if it never does. */
function daysToCross(fit: LinearFit, from: DateKey, target: number, slope: number): number | null {
  const now = valueAt(fit, from);
  if (slope === 0) return null;
  const days = (target - now) / slope;
  return days >= 0 && days <= MAX_FORECAST_DAYS ? days : null;
}

export function forecastGoal(goal: HealthGoal, metric: Metric, measurements: Measurement[], today: DateKey): Forecast {
  const all = dailySeries(metric, measurements);
  const base: Forecast = {
    status: 'no-data',
    current: null,
    startValue: null,
    progress: 0,
    ratePerWeek: null,
    requiredPerWeek: null,
    eta: null,
    etaEarly: null,
    etaLate: null,
    fit: null,
    window: [],
    hitRate: null,
  };
  if (!all.length) return base;

  const beforeStart = all.filter((p) => p.date <= goal.startDate);
  const startPoint = beforeStart.length ? beforeStart[beforeStart.length - 1] : all[0];
  const sinceStart = all.filter((p) => p.date >= startPoint.date);
  const last = all[all.length - 1];

  if (goal.kind === 'average') {
    const recent = all.filter((p) => diffDays(p.date, last.date) < 7);
    const avg = recent.reduce((s, p) => s + p.value, 0) / recent.length;
    const higherIsBetter = metric.direction !== 'decrease';
    const meets = (v: number) => (higherIsBetter ? v >= goal.target : v <= goal.target);
    const month = all.filter((p) => diffDays(p.date, last.date) < 30);
    return {
      ...base,
      status: meets(avg) ? 'on-track' : 'behind',
      current: avg,
      startValue: startPoint.value,
      progress: goal.target === 0 ? 1 : Math.max(0, Math.min(1, higherIsBetter ? avg / goal.target : goal.target / avg)),
      hitRate: month.filter((p) => meets(p.value)).length / month.length,
      window: recent,
    };
  }

  const increasing = goal.target >= startPoint.value;
  const reached = increasing ? last.value >= goal.target : last.value <= goal.target;
  const span = goal.target - startPoint.value;
  const progress = span === 0 ? 1 : Math.max(0, Math.min(1, (last.value - startPoint.value) / span));
  const window = recentWindow(sinceStart.length >= 2 ? sinceStart : all);
  const fit = fitLine(window);
  const forecast: Forecast = { ...base, current: last.value, startValue: startPoint.value, progress, fit, window };

  if (goal.deadline && goal.deadline > today) {
    forecast.requiredPerWeek = ((goal.target - last.value) / Math.max(1, diffDays(today, goal.deadline))) * 7;
  }
  if (reached) return { ...forecast, status: 'achieved', progress: 1 };
  if (!fit || window.length < 3 || diffDays(window[0].date, window[window.length - 1].date) < 5) {
    return { ...forecast, status: 'insufficient' };
  }

  forecast.ratePerWeek = fit.slope * 7;
  const towardTarget = increasing ? fit.slope > 0 : fit.slope < 0;
  // A trend smaller than its own noise isn't a trend.
  if (Math.abs(fit.slope) < fit.slopeSE * 0.5) return { ...forecast, status: 'flat' };
  if (!towardTarget) return { ...forecast, status: 'wrong-way' };

  const from = last.date;
  const mid = daysToCross(fit, from, goal.target, fit.slope);
  const fast = daysToCross(fit, from, goal.target, fit.slope + Math.sign(fit.slope) * Z80 * fit.slopeSE);
  const slowSlope = fit.slope - Math.sign(fit.slope) * Z80 * fit.slopeSE;
  const slow = Math.sign(slowSlope) === Math.sign(fit.slope) ? daysToCross(fit, from, goal.target, slowSlope) : null;

  forecast.eta = mid === null ? null : addDays(from, Math.ceil(mid));
  forecast.etaEarly = fast === null ? null : addDays(from, Math.ceil(fast));
  forecast.etaLate = slow === null ? null : addDays(from, Math.ceil(slow));
  const onTime = !goal.deadline || (forecast.eta !== null && forecast.eta <= goal.deadline);
  return { ...forecast, status: forecast.eta && onTime ? 'on-track' : 'behind' };
}

export interface RecoveryForecast {
  latestPain: number | null;
  firstPain: number | null;
  /** Pain points per week (negative = improving). */
  ratePerWeek: number | null;
  /** When pain is projected to reach ≤ 1. */
  painFreeBy: DateKey | null;
  expectedBy: DateKey | null;
  /** Share of the expected recovery time already elapsed. */
  elapsed: number | null;
  fit: LinearFit | null;
}

export function forecastRecovery(injury: Injury, today: DateKey): RecoveryForecast {
  const points = [...injury.checkIns]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((c) => ({ date: c.date, value: c.pain }));
  const expectedBy = injury.expectedWeeks ? addDays(injury.startedOn, Math.round(injury.expectedWeeks * 7)) : null;
  const elapsed = injury.expectedWeeks
    ? Math.max(0, Math.min(1, diffDays(injury.startedOn, today) / (injury.expectedWeeks * 7)))
    : null;
  const out: RecoveryForecast = {
    latestPain: points.length ? points[points.length - 1].value : null,
    firstPain: points.length ? points[0].value : null,
    ratePerWeek: null,
    painFreeBy: null,
    expectedBy,
    elapsed,
    fit: null,
  };
  const window = recentWindow(points, 21, 3);
  const fit = window.length >= 3 ? fitLine(window) : null;
  if (!fit) return out;
  out.fit = fit;
  out.ratePerWeek = fit.slope * 7;
  if (out.latestPain !== null && out.latestPain <= 1) return { ...out, painFreeBy: points[points.length - 1].date };
  if (fit.slope < 0) {
    const days = daysToCross(fit, points[points.length - 1].date, 1, fit.slope);
    out.painFreeBy = days === null ? null : addDays(points[points.length - 1].date, Math.ceil(days));
  }
  return out;
}

export const latestValue = (metric: Metric, measurements: Measurement[]) => {
  const s = dailySeries(metric, measurements);
  return s.length ? s[s.length - 1] : null;
};

/** Value closest to `daysAgo` before the latest reading, for "vs last week" deltas. */
export function valueDaysBefore(series: DailyPoint[], daysAgo: number): DailyPoint | null {
  if (!series.length) return null;
  const last = series[series.length - 1].date;
  const target = addDays(last, -daysAgo);
  let best: DailyPoint | null = null;
  for (const p of series) {
    if (p.date > target) break;
    best = p;
  }
  return best && diffDays(best.date, target) <= Math.max(3, daysAgo / 2) ? best : null;
}

export const fmtValue = (v: number | null | undefined, metric: Pick<Metric, 'decimals' | 'unit'>, withUnit = true) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  const s = v.toLocaleString(undefined, { maximumFractionDigits: metric.decimals, minimumFractionDigits: 0 });
  return withUnit && metric.unit ? `${s} ${metric.unit}` : s;
};
