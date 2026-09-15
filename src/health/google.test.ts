import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMetric, setAccessTokenForTests } from './google';
import type { Metric } from './types';

/**
 * Request and response shapes follow Google's published API definition
 * (https://health.googleapis.com/$discovery/rest?version=v4).
 */

const metric = (unit = 'lb'): Metric => ({ id: 'm', name: 'M', unit, decimals: 1, direction: 'neutral', aggregate: 'last', source: null, createdAt: 0 });

type Handler = (url: URL, init: RequestInit | undefined) => { status?: number; body: unknown };
let calls: { url: URL; body: unknown }[] = [];

function mockApi(handler: Handler) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const { status = 200, body } = handler(url, init);
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

const date = (k: string) => {
  const [year, month, day] = k.split('-').map(Number);
  return { year, month, day };
};

beforeEach(() => {
  calls = [];
  setAccessTokenForTests('test-token');
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 15, 13, 42, 0));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Google Health sync requests', () => {
  it('rolls up steps per day with a range that never ends in the future', async () => {
    mockApi(() => ({
      body: {
        rollupDataPoints: [
          { civilStartTime: { date: date('2026-09-14') }, steps: { countSum: '8123' } },
          { civilStartTime: { date: date('2026-09-15') }, steps: { countSum: '0' } },
        ],
      },
    }));
    const points = await fetchMetric('steps', metric(), '2026-09-14', '2026-09-15');
    expect(points).toEqual([{ date: '2026-09-14', value: 8123 }]);
    expect(calls[0].url.pathname).toBe('/v4/users/me/dataTypes/steps/dataPoints:dailyRollUp');
    expect(calls[0].body).toEqual({
      range: { start: { date: date('2026-09-14') }, end: { date: date('2026-09-15'), time: { hours: 13, minutes: 42, seconds: 0 } } },
      windowSizeDays: 1,
      pageSize: 1000,
    });
  });

  it('ends past ranges at the following midnight', async () => {
    mockApi(() => ({ body: { rollupDataPoints: [] } }));
    await fetchMetric('steps', metric(), '2026-09-01', '2026-09-10');
    expect((calls[0].body as { range: unknown }).range).toEqual({ start: { date: date('2026-09-01') }, end: { date: date('2026-09-11') } });
  });

  it('falls back to adding up raw intervals when Google rejects the roll-up', async () => {
    mockApi((url) =>
      url.pathname.endsWith(':dailyRollUp')
        ? { status: 400, body: { error: { code: 400, message: 'Invalid argument in request.', status: 'INVALID_ARGUMENT' } } }
        : {
            body: {
              dataPoints: [
                { activeZoneMinutes: { activeZoneMinutes: '2', heartRateZone: 'CARDIO', interval: { civilStartTime: { date: date('2026-09-14') } } } },
                { activeZoneMinutes: { activeZoneMinutes: '1', heartRateZone: 'FAT_BURN', interval: { civilStartTime: { date: date('2026-09-14') } } } },
                { activeZoneMinutes: { activeZoneMinutes: '2', heartRateZone: 'PEAK', interval: { civilStartTime: { date: date('2026-09-15') } } } },
              ],
            },
          },
    );
    const points = await fetchMetric('activeZoneMinutes', metric('min'), '2026-09-14', '2026-09-15');
    expect(points).toEqual([
      { date: '2026-09-14', value: 3 },
      { date: '2026-09-15', value: 2 },
    ]);
    expect(calls[1].url.pathname).toBe('/v4/users/me/dataTypes/active-zone-minutes/dataPoints');
    expect(calls[1].url.searchParams.get('filter')).toBe(
      'active_zone_minutes.interval.civil_start_time >= "2026-09-14" AND active_zone_minutes.interval.civil_start_time < "2026-09-16"',
    );
  });

  it('shows the specific reason Google gives for a rejected request', async () => {
    mockApi(() => ({
      status: 403,
      body: {
        error: {
          message: 'Permission denied.',
          status: 'PERMISSION_DENIED',
          details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
        },
      },
    }));
    await expect(fetchMetric('steps', metric(), '2026-09-14', '2026-09-15')).rejects.toThrow('Permission denied. (ACCESS_TOKEN_SCOPE_INSUFFICIENT)');
  });

  it('reads weight samples in grams and keeps the latest per day', async () => {
    mockApi(() => ({
      body: {
        dataPoints: [
          { weight: { weightGrams: 81000, sampleTime: { physicalTime: '2026-09-14T20:00:00Z', civilTime: { date: date('2026-09-14') } } } },
          { weight: { weightGrams: 80500, sampleTime: { physicalTime: '2026-09-14T07:00:00Z', civilTime: { date: date('2026-09-14') } } } },
        ],
      },
    }));
    expect(await fetchMetric('weight', metric('lb'), '2026-09-14', '2026-09-15')).toEqual([{ date: '2026-09-14', value: 178.6 }]);
    expect(await fetchMetric('weight', metric('kg'), '2026-09-14', '2026-09-15')).toEqual([{ date: '2026-09-14', value: 81 }]);
    expect(calls[0].url.searchParams.get('filter')).toBe('weight.sample_time.civil_time >= "2026-09-14" AND weight.sample_time.civil_time < "2026-09-16"');
  });

  it('reads body fat samples', async () => {
    mockApi(() => ({
      body: { dataPoints: [{ bodyFat: { percentage: 18.24, sampleTime: { physicalTime: '2026-09-14T07:00:00Z', civilTime: { date: date('2026-09-14') } } } }] },
    }));
    expect(await fetchMetric('bodyFat', metric('%'), '2026-09-01', '2026-09-15')).toEqual([{ date: '2026-09-14', value: 18.2 }]);
    expect(calls[0].url.pathname).toBe('/v4/users/me/dataTypes/body-fat/dataPoints');
    expect(calls[0].url.searchParams.get('filter')).toContain('body_fat.sample_time.civil_time >= "2026-09-01"');
  });

  it('filters resting heart rate with the snake_case daily summary field', async () => {
    mockApi(() => ({ body: { dataPoints: [{ dailyRestingHeartRate: { date: date('2026-09-14'), beatsPerMinute: '58' } }] } }));
    expect(await fetchMetric('restingHeartRate', metric('bpm'), '2026-09-01', '2026-09-15')).toEqual([{ date: '2026-09-14', value: 58 }]);
    expect(calls[0].url.searchParams.get('filter')).toBe('daily_resting_heart_rate.date >= "2026-09-01" AND daily_resting_heart_rate.date < "2026-09-16"');
  });

  it('follows page tokens', async () => {
    mockApi((url) =>
      url.searchParams.get('pageToken')
        ? { body: { dataPoints: [{ dailyRestingHeartRate: { date: date('2026-09-13'), beatsPerMinute: '60' } }] } }
        : { body: { dataPoints: [{ dailyRestingHeartRate: { date: date('2026-09-14'), beatsPerMinute: '58' } }], nextPageToken: 'next' } },
    );
    expect(await fetchMetric('restingHeartRate', metric('bpm'), '2026-09-01', '2026-09-15')).toHaveLength(2);
  });
});
