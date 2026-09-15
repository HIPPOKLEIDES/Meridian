import type { DateKey, ID } from '../types';

/**
 * A life goal: an aspiration that moves forward through practice, evidence and reflection rather than
 * a fixed task list, e.g. "Speak up more in groups" or "Feel at home in a new city".
 */
export type GoalStatus = 'exploring' | 'active' | 'paused' | 'achieved' | 'released';

/** Rough time frame, not a deadline. */
export type GoalHorizon = 'season' | 'year' | 'someday';

export interface Milestone {
  id: ID;
  text: string;
  doneOn: DateKey | null;
}

/** A number that shows whether things are changing, e.g. pages written per week. */
export interface Signal {
  id: ID;
  name: string;
  unit: string;
  /** Which way is better. */
  better: 'up' | 'down';
  target: number | null;
  entries: { id: ID; date: DateKey; value: number; note: string }[];
}

/** A periodic "how's it going?" with a 1–10 rating and answers to the goal's reflection prompts. */
export interface CheckIn {
  id: ID;
  date: DateKey;
  rating: number;
  answers: { prompt: string; text: string }[];
  /** Free-form note (older check-ins, or goals without prompts). */
  note: string;
  /** The next small thing to try. */
  next: string;
}

export interface Win {
  id: ID;
  date: DateKey;
  text: string;
}

export interface LifeGoal {
  id: ID;
  title: string;
  /** Why this matters. */
  why: string;
  /** What it would look and feel like if it worked. */
  vision: string;
  status: GoalStatus;
  horizon: GoalHorizon;
  areaId: ID | null;
  milestones: Milestone[];
  signals: Signal[];
  checkIns: CheckIn[];
  wins: Win[];
  /** Habits that act as the practices behind this goal. */
  habitIds: ID[];
  projectIds: ID[];
  /** Journal entries containing #tag show on the goal. Lowercase, no '#'. */
  tag: string;
  /** Questions asked at each check-in. */
  prompts: string[];
  notes: string;
  createdAt: number;
  updatedAt: number;
}

/** A completed weekly review. */
export interface Review {
  id: ID;
  date: DateKey;
  goalIds: ID[];
}

export interface GoalsData {
  goals: LifeGoal[];
  reviews: Review[];
  /** Weekday (0 = Sunday) the weekly review is due. */
  reviewDay: number;
}

export const DEFAULT_PROMPTS = ['What did I try?', 'What happened?', 'What did I learn?'];

export const isOpenGoal = (g: LifeGoal) => g.status === 'active' || g.status === 'exploring';

/** Lowercase tag made of letters, digits, - and _. */
export const cleanTag = (s: string) =>
  s
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .slice(0, 40);

const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'and', 'or', 'in', 'on', 'at', 'for', 'with', 'my', 'more', 'be', 'get', 'become', 'improve', 'better', 'up']);

/** Suggests a short tag from a title: its first two meaningful words. */
export const suggestTag = (title: string) => {
  const words = title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const meaningful = words.filter((w) => !STOP.has(w));
  return cleanTag((meaningful.length ? meaningful : words).slice(0, 2).join('-'));
};

export const STATUS_LABELS: Record<GoalStatus, string> = {
  exploring: 'Exploring',
  active: 'Active',
  paused: 'Paused',
  achieved: 'Achieved',
  released: 'Let go',
};

export const HORIZON_LABELS: Record<GoalHorizon, string> = {
  season: 'This season',
  year: 'This year',
  someday: 'Someday',
};
