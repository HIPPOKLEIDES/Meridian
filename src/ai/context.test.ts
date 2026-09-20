import { describe, expect, it } from 'vitest';
import { newHabit, newTask } from '../store';
import { newGoal } from '../goals/store';
import { buildContext } from './context';
import type { ContextSources } from './context';

const TODAY = '2026-09-21';

const sources = (over: Partial<ContextSources> = {}): ContextSources => ({
  core: {
    areas: [{ id: 'health', name: 'Health', slot: 3, weeklyTargetHours: 5 }],
    projects: [],
    tasks: [],
    habits: [],
    entries: [],
    ...over.core,
  },
  goals: { goals: [], reviews: [], reviewDay: 0, ...over.goals },
  journal: { journals: [{ id: 'j', name: 'Daily', color: 1, prompts: [], createdAt: 0 }], entries: [], ...over.journal },
  health: over.health,
});

const options = { today: TODAY, includeJournalText: false, includeHealth: false, journalLocked: false };

describe('the snapshot sent to the coach', () => {
  it('summarizes a habit as strength, streak and a fortnight of marks', () => {
    const habit = newHabit({
      title: 'Morning run',
      areaId: 'health',
      days: [1, 3, 5],
      start: 7 * 60,
      duration: 40,
      startDate: '2026-08-01',
      log: { '2026-09-14': { done: true, steps: [] }, '2026-09-16': { done: true, steps: [] }, '2026-09-18': { done: false, steps: [] } },
    });
    const { habits } = buildContext(sources({ core: { ...sources().core, habits: [habit] } }), options);
    expect(habits[0]).toMatchObject({ title: 'Morning run', area: 'Health', days: 'Mon, Wed, Fri', time: '07:00', minutes: 40, streak: 0, lastDone: '2026-09-16' });
    expect(habits[0].recent).toMatch(/^[01?]+$/);
    expect(habits[0].strength).toBeGreaterThan(0);
  });

  it('separates overdue, in-progress and stale tasks', () => {
    const old = Date.now() - 60 * 86_400_000;
    const tasks = [
      newTask({ title: 'Renew passport', endDate: '2026-09-10' }),
      newTask({ title: 'Draft the talk', status: 'doing' }),
      newTask({ title: 'Someday: learn Portuguese', createdAt: old }),
      newTask({ title: 'Finished thing', status: 'done', completedAt: Date.now() }),
    ];
    const { tasks: out } = buildContext(sources({ core: { ...sources().core, tasks } }), options);
    expect(out.open).toBe(3);
    expect(out.doneLast30).toBe(1);
    expect(out.overdue.map((t) => t.title)).toEqual(['Renew passport']);
    expect(out.inProgress.map((t) => t.title)).toEqual(['Draft the talk']);
    expect(out.stale.map((t) => t.title)).toEqual(['Someday: learn Portuguese']);
  });

  it('counts hours per area against the week before', () => {
    const entries = [
      { id: 'a', label: 'Run', date: '2026-09-20', start: 420, end: 480, areaId: 'health', taskId: null, habitId: null },
      { id: 'b', label: 'Run', date: '2026-09-12', start: 420, end: 450, areaId: 'health', taskId: null, habitId: null },
    ];
    const { areas } = buildContext(sources({ core: { ...sources().core, entries } }), options);
    expect(areas[0]).toMatchObject({ name: 'Health', weeklyTargetHours: 5, hoursLast7: 1, hoursPrev7: 0.5 });
  });

  it('keeps journal text out unless it is asked for, and out entirely when locked', () => {
    const journal = {
      journals: sources().journal.journals,
      entries: [{ id: 'e', journalId: 'j', date: '2026-09-20', text: 'A private thing I wrote', mood: 4 as const, createdAt: 0, updatedAt: 0 }],
    };
    const quiet = buildContext(sources({ journal }), options);
    expect(JSON.stringify(quiet)).not.toContain('A private thing');
    expect(quiet.journal).toMatchObject({ entries: 1, last30MoodAverage: 4 });

    const shared = buildContext(sources({ journal }), { ...options, includeJournalText: true });
    expect(JSON.stringify(shared)).toContain('A private thing');

    const locked = buildContext(sources({ journal }), { ...options, journalLocked: true });
    expect(locked.journal).toEqual({ locked: true });
  });

  it('describes a goal by its check-ins, milestones and practices', () => {
    const goal = newGoal({
      title: 'Speak up more in groups',
      why: 'I leave meetings with things unsaid',
      status: 'active',
      milestones: [{ id: 'm1', text: 'Ask one question per meeting', doneOn: '2026-09-01' }, { id: 'm2', text: 'Lead a discussion', doneOn: null }],
      checkIns: [{ id: 'c', date: '2026-09-07', rating: 6, answers: [], note: '', next: 'Sit nearer the front' }],
    });
    const { goals } = buildContext(sources({ goals: { goals: [goal], reviews: [], reviewDay: 0 } }), options);
    expect(goals[0]).toMatchObject({
      title: 'Speak up more in groups',
      status: 'active',
      daysSinceCheckIn: 14,
      milestones: { done: 1, total: 2, open: ['Lead a discussion'] },
    });
    expect(goals[0].lastCheckIn).toMatchObject({ rating: 6, next: 'Sit nearer the front' });
  });
});
