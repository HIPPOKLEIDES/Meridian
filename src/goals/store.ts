import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { DateKey, ID } from '../types';
import type { CheckIn, GoalsData, LifeGoal } from './types';
import { DEFAULT_PROMPTS } from './types';
import { uid } from '../store';
import { idbStateStorage, useHydrated } from '../lib/idb';
import { addDays, weekday } from '../lib/dates';

export const newGoal = (g: Partial<LifeGoal> = {}): LifeGoal => ({
  id: uid(),
  title: '',
  why: '',
  vision: '',
  status: 'active',
  horizon: 'season',
  areaId: null,
  milestones: [],
  signals: [],
  checkIns: [],
  wins: [],
  habitIds: [],
  projectIds: [],
  tag: '',
  prompts: [...DEFAULT_PROMPTS],
  notes: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...g,
});

export const emptyGoals = (): GoalsData => ({ goals: [], reviews: [], reviewDay: 0 });

/** Fills fields added after a goal was saved (older data and backups). */
const normalizeGoal = (g: Partial<LifeGoal>): LifeGoal =>
  newGoal({
    ...g,
    tag: g.tag ?? '',
    prompts: g.prompts ?? [...DEFAULT_PROMPTS],
    checkIns: (g.checkIns ?? []).map((c: Partial<CheckIn>) => ({ note: '', next: '', ...c, answers: c.answers ?? [] }) as CheckIn),
  });

const normalize = (data: Partial<GoalsData>): GoalsData => ({
  goals: (data.goals ?? []).map(normalizeGoal),
  reviews: data.reviews ?? [],
  reviewDay: data.reviewDay ?? 0,
});

interface GoalsActions {
  /** Creates a goal and returns its id. */
  addGoal(g: Partial<LifeGoal>): ID;
  /** Applies a change to one goal; the updater receives the current goal. */
  updateGoal(id: ID, change: Partial<LifeGoal> | ((g: LifeGoal) => Partial<LifeGoal>)): void;
  deleteGoal(id: ID): void;
  /** Adds a check-in, replacing any earlier one on the same day. */
  saveCheckIn(id: ID, checkIn: Omit<CheckIn, 'id'>): void;
  setReviewDay(day: number): void;
  completeReview(goalIds: ID[], date: DateKey): void;
  replaceAll(data: Partial<GoalsData>): void;
}

export type GoalsStore = GoalsData & GoalsActions;

export const useGoals = create<GoalsStore>()(
  persist(
    (set) => ({
      ...emptyGoals(),
      addGoal: (g) => {
        const goal = newGoal(g);
        set((s) => ({ goals: [...s.goals, goal] }));
        return goal.id;
      },
      updateGoal: (id, change) =>
        set((s) => ({
          goals: s.goals.map((g) => (g.id === id ? { ...g, ...(typeof change === 'function' ? change(g) : change), updatedAt: Date.now() } : g)),
        })),
      deleteGoal: (id) => set((s) => ({ goals: s.goals.filter((g) => g.id !== id), reviews: s.reviews.map((r) => ({ ...r, goalIds: r.goalIds.filter((x) => x !== id) })) })),
      saveCheckIn: (id, checkIn) =>
        set((s) => ({
          goals: s.goals.map((g) =>
            g.id === id ? { ...g, checkIns: [...g.checkIns.filter((c) => c.date !== checkIn.date), { ...checkIn, id: uid() }], updatedAt: Date.now() } : g,
          ),
        })),
      setReviewDay: (reviewDay) => set({ reviewDay }),
      completeReview: (goalIds, date) => set((s) => ({ reviews: [...s.reviews.filter((r) => r.date !== date), { id: uid(), date, goalIds }] })),
      replaceAll: (data) => set(normalize(data)),
    }),
    {
      name: 'meridian:goals',
      version: 2,
      storage: createJSONStorage(() => idbStateStorage),
      partialize: (s): GoalsData => ({ goals: s.goals, reviews: s.reviews, reviewDay: s.reviewDay }),
      migrate: (persisted) => normalize(persisted as Partial<GoalsData>),
    },
  ),
);

export const useGoalsReady = () => useHydrated(useGoals);

export const exportGoals = (): GoalsData => {
  const { goals, reviews, reviewDay } = useGoals.getState();
  return { goals, reviews, reviewDay };
};

export const sortedCheckIns = (g: LifeGoal) => [...g.checkIns].sort((a, b) => (a.date < b.date ? 1 : -1));

export const latestCheckIn = (g: LifeGoal): CheckIn | undefined => sortedCheckIns(g)[0];

/** Momentum from recent check-ins: the average of the last three against the three before. */
export function momentum(g: LifeGoal): 'rising' | 'steady' | 'slipping' | null {
  const sorted = [...g.checkIns].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (sorted.length < 2) return null;
  const recent = sorted.slice(-3);
  const before = sorted.slice(-6, -3);
  const avg = (xs: typeof sorted) => xs.reduce((s, c) => s + c.rating, 0) / xs.length;
  const base = before.length ? avg(before) : sorted[0].rating;
  const diff = avg(recent) - base;
  return diff >= 0.75 ? 'rising' : diff <= -0.75 ? 'slipping' : 'steady';
}

/** Reviews done up to this many days before the review day count for that week. */
const EARLY_DAYS = 2;

/**
 * Where the weekly review stands. `dueDate` is the latest review day on or before today; the review for it
 * counts as done if one happened on or after two days before it. `early` means next week's window is already open.
 */
export function reviewStatus(data: Pick<GoalsData, 'reviews' | 'reviewDay'>, today: DateKey) {
  const dueDate = addDays(today, -((weekday(today) - data.reviewDay + 7) % 7));
  const nextDate = addDays(dueDate, 7);
  const last = [...data.reviews].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const doneFor = (d: DateKey) => !!last && last.date >= addDays(d, -EARLY_DAYS);
  const due = !doneFor(dueDate);
  const early = !due && today >= addDays(nextDate, -EARLY_DAYS) && !doneFor(nextDate);
  return { due, early, dueDate, nextDate, last };
}
