import { describe, expect, it } from 'vitest';
import { newBlock, newProject, newTask } from '../store';
import { planForDate } from './plan';
import { hasTimeframeOn, nextTimeframe, placeTimeframe, suggestedStart, timeframesOf } from './timeframes';

// 2026-09-15 is a Tuesday (weekday 2).
const today = '2026-09-15';

describe('timeframes', () => {
  const a = newBlock({ taskId: 't1', date: '2026-09-17', start: 14 * 60, end: 15 * 60 });
  const b = newBlock({ taskId: 't1', date: today, start: 9 * 60, end: 10 * 60 });
  const weekly = newBlock({ taskId: 't2', date: '2026-09-01', start: 8 * 60, end: 9 * 60, repeatDays: [1, 4] });
  const other = newBlock({ taskId: null, date: today, start: 11 * 60, end: 12 * 60 });
  const blocks = [a, b, weekly, other];

  it('lists a task’s timeframes in date and time order', () => {
    expect(timeframesOf('t1', blocks).map((x) => x.id)).toEqual([b.id, a.id]);
  });

  it('finds whether a task is planned on a day, including repeats', () => {
    expect(hasTimeframeOn('t1', blocks, today)).toBe(true);
    expect(hasTimeframeOn('t2', blocks, '2026-09-17')).toBe(true); // Thursday
    expect(hasTimeframeOn('t2', blocks, today)).toBe(false);
  });

  it('finds the next timeframe that is not over yet', () => {
    expect(nextTimeframe('t1', blocks, today, 9 * 60 + 30)?.block.id).toBe(b.id);
    expect(nextTimeframe('t1', blocks, today, 10 * 60)?.block.id).toBe(a.id);
    expect(nextTimeframe('t2', blocks, today, 0)).toMatchObject({ date: '2026-09-17', start: 480 });
    expect(nextTimeframe('t3', blocks, today, 0)).toBeNull();
  });

  it('places dropped timeframes on the 15-minute grid within the day', () => {
    expect(placeTimeframe(9 * 60 + 7)).toEqual({ start: 540, end: 600 });
    expect(placeTimeframe(23 * 60 + 50)).toEqual({ start: 1380, end: 1440 });
    expect(placeTimeframe(600, 30)).toEqual({ start: 600, end: 630 });
  });

  it('suggests the next whole hour today and 9:00 on other days', () => {
    expect(suggestedStart(today, today, 13 * 60 + 5)).toBe(14 * 60);
    expect(suggestedStart('2026-09-20', today, 13 * 60)).toBe(9 * 60);
  });

  it('shows a timeframe with its task’s current title and area on the clock', () => {
    const project = newProject({ id: 'p', areaId: 'career' });
    const task = newTask({ id: 't1', title: 'Renamed task', projectId: 'p', status: 'done' });
    const plan = planForDate({ blocks: [{ ...b, title: 'Old title' }], habits: [], tasks: [task], projects: [project] }, today);
    expect(plan[0]).toMatchObject({ title: 'Renamed task', areaId: 'career', taskId: 't1', done: true });
  });
});
