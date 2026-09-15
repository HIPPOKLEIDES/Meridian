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

async function call(path: string, init: RequestInit = {}): Promise<Json> {
  if (!isSignedIn()) throw new Error('Not signed in to Google (tokens last an hour). Connect again.');
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token!.value}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return res.json();
}

const civil = (k: DateKey) => {
  const [year, month, day] = k.split('-').map(Number);
  return { date: { year, month, day }, time: { hours: 0, minutes: 0, seconds: 0 } };
};

const keyOf = (d: Json): DateKey | null =>
  d && d.year ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null;

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN);

/** Per-day aggregates, chunked to the API's 90-day range limit. */
async function dailyRollUp(type: string, start: DateKey, end: DateKey): Promise<Json[]> {
  const out: Json[] = [];
  for (let s = start; s <= end; s = addDays(s, 90)) {
    const e = addDays(s, 89) < end ? addDays(s, 89) : end;
    let pageToken: string | undefined;
    do {
      const body = { range: { start: civil(s), end: civil(addDays(e, 1)) }, windowSizeDays: 1, pageSize: 1000, pageToken };
      const page = await call(`/${type}/dataPoints:dailyRollUp`, { method: 'POST', body: JSON.stringify(body) });
      out.push(...(page.rollupDataPoints ?? []));
      pageToken = page.nextPageToken || undefined;
    } while (pageToken);
  }
  return out;
}

async function listPoints(type: string, filter: string): Promise<Json[]> {
  const out: Json[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ filter, pageSize: '1000' });
    if (pageToken) q.set('pageToken', pageToken);
    const page = await call(`/${type}/dataPoints?${q}`);
    out.push(...(page.dataPoints ?? []));
    pageToken = page.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

type Point = { date: DateKey; value: number };

const fromRollup = (points: Json[], pick: (value: Json) => number): Point[] =>
  points
    .map((p) => ({ date: keyOf(p.civilStartTime?.date), value: pick(p.value ?? {}) }))
    .filter((p): p is Point => !!p.date && Number.isFinite(p.value));

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
      return fromRollup(await dailyRollUp('steps', start, end), (v) => num(v.steps?.countSum)).filter((p) => p.value > 0);
    case 'weight': {
      const toLb = /lb/i.test(metric.unit);
      return fromRollup(await dailyRollUp('weight', start, end), (v) => {
        const kg = num(v.weight?.weightKilogramsAvg);
        return round(toLb ? kg * 2.20462 : kg, 1);
      });
    }
    case 'bodyFat':
      return fromRollup(await dailyRollUp('body-fat', start, end), (v) => round(num(v.bodyFat?.bodyFatPercentageAvg), 1));
    case 'activeZoneMinutes':
      return fromRollup(await dailyRollUp('active-zone-minutes', start, end), (v) => {
        const a = v.activeZoneMinutes ?? {};
        return num(a.sumInFatBurnHeartZone ?? 0) + num(a.sumInCardioHeartZone ?? 0) + num(a.sumInPeakHeartZone ?? 0);
      });
    case 'restingHeartRate':
      return (await listPoints('daily-resting-heart-rate', `dailyRestingHeartRate.date >= "${start}"`))
        .map((p) => ({ date: keyOf(p.dailyRestingHeartRate?.date), value: num(p.dailyRestingHeartRate?.beatsPerMinute) }))
        .filter((p): p is Point => !!p.date && p.date <= end && Number.isFinite(p.value));
    case 'sleep': {
      const sessions = await listPoints('sleep', `sleep.interval.end_time >= "${new Date(start + 'T00:00:00').toISOString()}"`);
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
