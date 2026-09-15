import type { DateKey } from '../types';
import type { HealthGoal, Metric } from './types';
import type { Forecast } from './projection';
import { fmtValue } from './projection';
import { diffDays, fmtDateShort, fromKey } from '../lib/dates';
import { useStore } from '../store';
import { areaColor } from '../components/common';

/** The core "Health" life area (by id, else by name), used for colors and time totals. */
export function useHealthArea() {
  return useStore((s) => s.areas.find((a) => a.id === 'health') ?? s.areas.find((a) => /health|fitness/i.test(a.name)));
}

export function useHealthColor() {
  const area = useHealthArea();
  return area ? areaColor(area) : 'var(--series-3)';
}

const fmtDate = (d: DateKey) => {
  const date = fromKey(d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
};

export const fmtRate = (perWeek: number, metric: Metric) => {
  const sign = perWeek > 0 ? '+' : perWeek < 0 ? '−' : '';
  return `${sign}${fmtValue(Math.abs(perWeek), { ...metric, decimals: Math.max(metric.decimals, 1) })}/week`;
};

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export function describeForecast(goal: HealthGoal, metric: Metric, f: Forecast, today: DateKey): { headline: string; detail: string; tone: Tone } {
  const target = fmtValue(goal.target, metric);
  if (goal.kind === 'average') {
    if (f.current === null) return { headline: 'No readings yet', detail: `Log ${metric.name.toLowerCase()} to start tracking.`, tone: 'neutral' };
    const detail = `7-day average ${fmtValue(f.current, metric)} against a goal of ${target}; met on ${Math.round((f.hitRate ?? 0) * 100)}% of the last 30 logged days.`;
    return f.status === 'on-track'
      ? { headline: 'Meeting your goal', detail, tone: 'good' }
      : { headline: 'Below your goal', detail, tone: 'warn' };
  }
  switch (f.status) {
    case 'no-data':
      return { headline: 'No readings yet', detail: `Log ${metric.name.toLowerCase()} to get an estimate.`, tone: 'neutral' };
    case 'achieved':
      return { headline: 'Goal reached', detail: `Latest reading ${fmtValue(f.current, metric)} meets your target of ${target}.`, tone: 'good' };
    case 'insufficient':
      return { headline: 'Need more data', detail: 'Log at least 3 readings spread over a week or more to estimate an arrival date.', tone: 'neutral' };
    case 'flat':
      return { headline: 'Holding steady', detail: `No clear trend in recent readings${f.ratePerWeek !== null ? ` (${fmtRate(f.ratePerWeek, metric)})` : ''}, so there's no arrival date yet.`, tone: 'warn' };
    case 'wrong-way':
      return { headline: 'Moving away from the goal', detail: `The recent trend is ${fmtRate(f.ratePerWeek ?? 0, metric)}, heading away from ${target}.`, tone: 'bad' };
  }
  const rate = fmtRate(f.ratePerWeek ?? 0, metric);
  if (!f.eta) {
    return { headline: 'A long way off', detail: `At ${rate} it would take more than five years to reach ${target}.`, tone: 'warn' };
  }
  const range =
    f.etaEarly && f.etaLate && f.etaEarly !== f.etaLate
      ? ` (likely between ${fmtDate(f.etaEarly)} and ${fmtDate(f.etaLate)})`
      : f.etaEarly && !f.etaLate
        ? ` (possibly as soon as ${fmtDate(f.etaEarly)}, though the trend is noisy)`
        : '';
  const base = `At ${rate} you'd reach ${target} around ${fmtDate(f.eta)}${range}.`;
  if (!goal.deadline) return { headline: `On pace for ${fmtDateShort(f.eta)}`, detail: base, tone: 'good' };
  if (f.status === 'on-track') {
    const spare = diffDays(f.eta, goal.deadline);
    return {
      headline: `On pace for ${fmtDateShort(f.eta)}`,
      detail: `${base} That's ${spare} day${spare === 1 ? '' : 's'} ahead of your ${fmtDate(goal.deadline)} deadline.`,
      tone: 'good',
    };
  }
  const need = f.requiredPerWeek !== null ? ` To make ${fmtDate(goal.deadline)} you'd need ${fmtRate(f.requiredPerWeek, metric)}.` : '';
  return { headline: goal.deadline < today ? 'Deadline passed' : 'Behind your deadline', detail: base + need, tone: 'warn' };
}
