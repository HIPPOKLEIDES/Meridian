import { describe, expect, it } from 'vitest';
import { newBlock, newHabit, newTask } from '../store';
import { isMoment, planForDate } from './plan';

const DATE = '2026-09-21'; // a Monday

describe('the day plan', () => {
  it('shows a scheduled subtask under its own name', () => {
    const task = newTask({ title: 'Build the shelf', subtasks: [{ id: 's1', text: 'Sand the edges', done: false }] });
    const blocks = [
      newBlock({ taskId: task.id, subtaskId: 's1', date: DATE, start: 9 * 60, end: 10 * 60 }),
      newBlock({ taskId: task.id, date: DATE, start: 14 * 60, end: 15 * 60 }),
    ];
    const [subtask, whole] = planForDate({ blocks, habits: [], tasks: [task], projects: [] }, DATE);
    expect(subtask.title).toBe('Sand the edges');
    expect(subtask.parentTitle).toBe('Build the shelf');
    expect(whole.title).toBe('Build the shelf');
    expect(whole.parentTitle).toBeUndefined();
  });

  it('marks a subtask done on its own, and when the whole task is done', () => {
    const done = newTask({ title: 'Build the shelf', subtasks: [{ id: 's1', text: 'Sand the edges', done: true }] });
    const blocks = [newBlock({ taskId: done.id, subtaskId: 's1', date: DATE, start: 9 * 60, end: 10 * 60 })];
    expect(planForDate({ blocks, habits: [], tasks: [done], projects: [] }, DATE)[0].done).toBe(true);

    const open = { ...done, subtasks: [{ id: 's1', text: 'Sand the edges', done: false }], status: 'done' as const };
    const openBlocks = [newBlock({ taskId: open.id, subtaskId: 's1', date: DATE, start: 9 * 60, end: 10 * 60 })];
    expect(planForDate({ blocks: openBlocks, habits: [], tasks: [open], projects: [] }, DATE)[0].done).toBe(true);
  });

  it('puts timed habit steps on the clock, even when the habit itself has no time', () => {
    const habit = newHabit({
      title: 'Morning run',
      start: null,
      startDate: '2026-01-01',
      steps: [
        { id: 'w', text: 'Warm up', start: 7 * 60, duration: 10 },
        { id: 'r', text: 'Run', start: 7 * 60 + 10 },
        { id: 'c', text: 'Stretch' },
      ],
      log: { [DATE]: { done: false, steps: ['w'] } },
    });
    const items = planForDate({ blocks: [], habits: [habit], tasks: [], projects: [] }, DATE);
    expect(items.map((i) => i.title)).toEqual(['Warm up', 'Run']);
    expect(items[0]).toMatchObject({ kind: 'habit', id: habit.id, stepId: 'w', parentTitle: 'Morning run', done: true, end: 7 * 60 + 10 });
    // No duration of its own: the default length.
    expect(items[1].end - items[1].start).toBe(10);
  });

  it('keeps zero-length things at zero, for what takes no time', () => {
    const habit = newHabit({
      title: 'Drink water',
      start: 10 * 60,
      duration: 0,
      startDate: '2026-01-01',
      steps: [{ id: 'g2', text: 'Second glass', start: 14 * 60, duration: 0 }],
    });
    const items = planForDate({ blocks: [], habits: [habit], tasks: [], projects: [] }, DATE);
    expect(items.map((i) => [i.title, i.start, i.end])).toEqual([
      ['Drink water', 600, 600],
      ['Second glass', 840, 840],
    ]);
    expect(items.every(isMoment)).toBe(true);
  });

  it('leaves out steps of a habit that is not scheduled that day', () => {
    const habit = newHabit({ title: 'Morning run', days: [0], startDate: '2026-01-01', steps: [{ id: 'w', text: 'Warm up', start: 7 * 60 }] });
    expect(planForDate({ blocks: [], habits: [habit], tasks: [], projects: [] }, DATE)).toEqual([]);
  });
});
