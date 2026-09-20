import { describe, expect, it } from 'vitest';
import type { PlanItem } from './plan';
import { dueReminders } from './reminders';

const item = (p: Partial<PlanItem>): PlanItem => ({
  key: 'b:1',
  kind: 'block',
  id: '1',
  title: 'Deep work',
  start: 9 * 60,
  end: 10 * 60,
  areaId: null,
  repeating: false,
  ...p,
});

const DATE = '2026-09-20';
const none = new Set<string>();

describe('reminders', () => {
  it('warns about anything starting within the lead time', () => {
    const items = [item({ start: 9 * 60 }), item({ key: 'b:2', start: 11 * 60 })];
    const due = dueReminders(items, DATE, 8 * 60 + 52, 10, none);
    expect(due.map((r) => r.title)).toEqual(['Deep work']);
    expect(due[0].body).toBe('In 8 min · 09:00–10:00');
    expect(due[0].minutesAway).toBe(8);
  });

  it('says when something is starting now, and never warns about the past', () => {
    expect(dueReminders([item({ start: 9 * 60 })], DATE, 9 * 60, 10, none)[0].body).toMatch(/^Starting now/);
    expect(dueReminders([item({ start: 9 * 60 })], DATE, 9 * 60 + 1, 10, none)).toEqual([]);
  });

  it('skips what is already done and what has been announced', () => {
    const habit = item({ key: 'h:1', kind: 'habit', title: 'Morning run', start: 7 * 60, end: 7 * 60 + 30, done: true });
    expect(dueReminders([habit], DATE, 6 * 60 + 55, 10, none)).toEqual([]);

    const pending = { ...habit, done: false };
    const [first] = dueReminders([pending], DATE, 6 * 60 + 55, 10, none);
    expect(first.key).toBe(`${DATE}:h:1:420`);
    expect(dueReminders([pending], DATE, 6 * 60 + 56, 10, new Set([first.key]))).toEqual([]);
  });

  it('names what a subtask or habit step belongs to, soonest first', () => {
    const items = [
      item({ key: 'b:2', title: 'Sand the edges', parentTitle: 'Build the shelf', start: 9 * 60 + 30 }),
      item({ key: 'h:1:s1', kind: 'habit', title: 'Warm up', parentTitle: 'Morning run', start: 9 * 60, end: 9 * 60 + 10 }),
    ];
    const due = dueReminders(items, DATE, 8 * 60 + 45, 60, none);
    expect(due.map((r) => r.title)).toEqual(['Warm up', 'Sand the edges']);
    expect(due[0].body).toBe('In 15 min · 09:00–09:10 · Morning run');
  });
});
