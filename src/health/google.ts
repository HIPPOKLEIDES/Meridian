/**
 * Google Health API client (the successor to the Fitbit Web API, which Google retires in September 2026).
 *
 * Runs entirely in the browser: Google Identity Services issues a short-lived access token in a popup,
 * and the token is kept in memory only (never persisted or exported). Reference:
 * https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints
 */
import type { DateKey } from '../types';
import type { Metric, SyncedMetric } from './types';
import { addDays, toKey } from '../lib/dates';

export const HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
];

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://health.googleapis.com/v4/users/me/dataTypes';

/** API responses are loosely typed and read defensively. */
type Json = any;

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; expires_in?: number; error?: string; error_description?: string }) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }): TokenClient;
          revoke(token: string, done: () => void): void;
        };
      };
    };
  }
}

let token: { value: string; expiresAt: number } | null = null;
let gisPromise: Promise<void> | null = null;

/** Load Google Identity Services ahead of time so the sign-in popup opens directly from a click. */
export function preloadGoogleSignIn(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('Could not load Google sign-in. Check your connection.'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

export const isSignedIn = () => !!token && token.expiresAt > Date.now() + 30_000;

/** Must be called from a click handler so the popup isn't blocked. */
export function signIn(clientId: string, forceConsent = false): Promise<void> {
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) return Promise.reject(new Error('Google sign-in is still loading. Try again in a moment.'));
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: HEALTH_SCOPES.join(' '),
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || 'Google did not return an access token.'));
          return;
        }
        token = { value: resp.access_token, expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000 };
        resolve();
      },
      error_callback: (err) => reject(new Error(err.message || (err.type === 'popup_closed' ? 'The sign-in window was closed.' : 'Sign-in failed.'))),
    });
    client.requestAccessToken({ prompt: forceConsent ? 'consent' : '' });
  });
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token.value, () => undefined);
  token = null;
}

/** An error from the Google Health API, keeping its status (e.g. INVALID_ARGUMENT) for fallbacks. */
export class GoogleHealthError extends Error {
  constructor(
    message: string,
    readonly status: string,
  ) {
    super(message);
  }
}

async function call(path: string, init: RequestInit = {}): Promise<Json> {
  if (!isSignedIn()) throw new Error('Not signed in to Google (tokens last an hour). Connect again.');
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token!.value}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let status = String(res.status);
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
      status = body?.error?.status ?? status;
      // Google puts the specific reason (which field, what's wrong) in the details.
      const reasons = (body?.error?.details ?? [])
        .flatMap((d: Json) => [...(d.fieldViolations ?? []).map((v: Json) => `${v.field}: ${v.description}`), d.reason].filter(Boolean))
        .filter((r: string) => r && !message.includes(r));
      if (reasons.length) message = `${message} (${reasons.join('; ')})`;
    } catch {
      /* non-JSON error body */
    }
    throw new GoogleHealthError(message, status);
  }
  return res.json();
}

/** For tests: install an access token without the Google sign-in popup. */
export function setAccessTokenForTests(value: string | null) {
  token = value ? { value, expiresAt: Date.now() + 3_600_000 } : null;
}

const civilDate = (k: DateKey) => {
  const [year, month, day] = k.split('-').map(Number);
  return { year, month, day };
};

const keyOf = (d: Json): DateKey | null =>
  d && d.year ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null;

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN);

/**
 * The exclusive end of a civil range that stops at `end` (inclusive), but never in the future:
 * for today it's the current time, since the last window may be shorter than a day.
 */
function civilEndAfter(end: DateKey, now = new Date()) {
  const today = toKey(now);
  if (end < today) return { date: civilDate(addDays(end, 1)) };
  return { date: civilDate(today), time: { hours: now.getHours(), minutes: now.getMinutes(), seconds: now.getSeconds() } };
}

/** Per-day aggregates, in chunks within the API's 90-day range limit. */
async function dailyRollUp(type: string, start: DateKey, end: DateKey): Promise<Json[]> {
  const out: Json[] = [];
  for (let s = start; s <= end; s = addDays(s, 90)) {
    const e = addDays(s, 89) < end ? addDays(s, 89) : end;
    let pageToken: string | undefined;
    do {
      const body = { range: { start: { date: civilDate(s) }, end: civilEndAfter(e) }, windowSizeDays: 1, pageSize: 1000, ...(pageToken ? { pageToken } : {}) };
      const page = await call(`/${type}/dataPoints:dailyRollUp`, { method: 'POST', body: JSON.stringify(body) });
      out.push(...(page.rollupDataPoints ?? []));
      pageToken = page.nextPageToken || undefined;
    } while (pageToken);
  }
  return out;
}

async function listPoints(type: string, filter: string, pageSize = 1000): Promise<Json[]> {
  const out: Json[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ filter, pageSize: String(pageSize) });
    if (pageToken) q.set('pageToken', pageToken);
    const page = await call(`/${type}/dataPoints?${q}`);
    out.push(...(page.dataPoints ?? []));
    pageToken = page.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

type Point = { date: DateKey; value: number };

const fromRollup = (points: Json[], pick: (point: Json) => number): Point[] =>
  points
    .map((p) => ({ date: keyOf(p.civilStartTime?.date), value: pick(p) }))
    .filter((p): p is Point => !!p.date && Number.isFinite(p.value));

/** Adds up interval data points (e.g. per-minute steps) into one value per civil day. */
function sumByDay(points: Json[], field: string, pick: (value: Json) => number, start: DateKey, end: DateKey): Point[] {
  const byDate = new Map<DateKey, number>();
  for (const p of points) {
    const value = p[field];
    const date = keyOf(value?.interval?.civilStartTime?.date);
    const n = pick(value ?? {});
    if (!date || date < start || date > end || !Number.isFinite(n)) continue;
    byDate.set(date, (byDate.get(date) ?? 0) + n);
  }
  return [...byDate.entries()].map(([date, value]) => ({ date, value }));
}

/** The latest sample on each civil day (API results are newest first, but don't rely on it). */
function latestByDay(points: Json[], field: string, pick: (value: Json) => number, start: DateKey, end: DateKey): Point[] {
  const best = new Map<DateKey, { at: string; value: number }>();
  for (const p of points) {
    const value = p[field];
    const date = keyOf(value?.sampleTime?.civilTime?.date);
    const at = String(value?.sampleTime?.physicalTime ?? '');
    const n = pick(value ?? {});
    if (!date || date < start || date > end || !Number.isFinite(n)) continue;
    const current = best.get(date);
    if (!current || at > current.at) best.set(date, { at, value: n });
  }
  return [...best.entries()].map(([date, { value }]) => ({ date, value }));
}

const civilRangeFilter = (field: string, start: DateKey, end: DateKey) => `${field} >= "${start}" AND ${field} < "${addDays(end, 1)}"`;

/**
 * Daily totals for an interval data type. Uses the server-side daily roll-up, and if Google rejects that request
 * falls back to listing the raw intervals and adding them up here (slower, same result).
 */
async function dailyTotals(type: string, field: string, start: DateKey, end: DateKey, fromRollupValue: (v: Json) => number, fromPoint: (v: Json) => number) {
  try {
    return fromRollup(await dailyRollUp(type, start, end), (p) => fromRollupValue(p[field] ?? {}));
  } catch (e) {
    if (!(e instanceof GoogleHealthError) || !['INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'UNIMPLEMENTED', '400'].includes(e.status)) throw e;
    const points = await listPoints(type, civilRangeFilter(`${type.replace(/-/g, '_')}.interval.civil_start_time`, start, end), 10000);
    return sumByDay(points, field, fromPoint, start, end);
  }
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export const SYNC_LABELS: Record<SyncedMetric, string> = {
  steps: 'Steps',
  weight: 'Weight',
  restingHeartRate: 'Resting heart rate',
  sleep: 'Sleep',
  activeZoneMinutes: 'Active zone minutes',
  bodyFat: 'Body fat',
};

export async function fetchMetric(source: SyncedMetric, metric: Metric, start: DateKey, end: DateKey): Promise<Point[]> {
  switch (source) {
    case 'steps':
      return (await dailyTotals('steps', 'steps', start, end, (v) => num(v.countSum), (v) => num(v.count))).filter((p) => p.value > 0);
    case 'activeZoneMinutes':
      return dailyTotals(
        'active-zone-minutes',
        'activeZoneMinutes',
        start,
        end,
        (v) => num(v.sumInFatBurnHeartZone ?? 0) + num(v.sumInCardioHeartZone ?? 0) + num(v.sumInPeakHeartZone ?? 0),
        (v) => num(v.activeZoneMinutes),
      );
    case 'weight': {
      const toLb = /lb/i.test(metric.unit);
      const points = await listPoints('weight', civilRangeFilter('weight.sample_time.civil_time', start, end));
      return latestByDay(points, 'weight', (v) => num(v.weightGrams) / 1000, start, end).map((p) => ({
        date: p.date,
        value: round(toLb ? p.value * 2.20462 : p.value, 1),
      }));
    }
    case 'bodyFat': {
      const points = await listPoints('body-fat', civilRangeFilter('body_fat.sample_time.civil_time', start, end));
      return latestByDay(points, 'bodyFat', (v) => num(v.percentage), start, end).map((p) => ({ date: p.date, value: round(p.value, 1) }));
    }
    case 'restingHeartRate':
      return (await listPoints('daily-resting-heart-rate', civilRangeFilter('daily_resting_heart_rate.date', start, end)))
        .map((p) => ({ date: keyOf(p.dailyRestingHeartRate?.date), value: num(p.dailyRestingHeartRate?.beatsPerMinute) }))
        .filter((p): p is Point => !!p.date && p.date >= start && p.date <= end && Number.isFinite(p.value));
    case 'sleep': {
      const sessions = await listPoints('sleep', `sleep.interval.end_time >= "${new Date(start + 'T00:00:00').toISOString()}"`, 25);
      const byDate = new Map<DateKey, number>();
      for (const s of sessions) {
        const endTime = s.sleep?.interval?.endTime;
        const minutes = num(s.sleep?.summary?.minutesAsleep);
        if (!endTime || !Number.isFinite(minutes)) continue;
        // A night's sleep belongs to the morning it ends on.
        const date = toKey(new Date(endTime));
        if (date > end) continue;
        byDate.set(date, (byDate.get(date) ?? 0) + minutes);
      }
      return [...byDate.entries()].map(([date, minutes]) => ({ date, value: round(minutes / 60, 2) }));
    }
  }
}
