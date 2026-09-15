import type { DateKey, ID } from '../types';

/** A separate stream of entries, e.g. "Daily", "Gratitude", "Dreams". */
export interface Journal {
  id: ID;
  name: string;
  /** Categorical color slot 1–8. */
  color: number;
  /** Shown on a blank page; empty uses the built-in rotation. */
  prompts: string[];
  createdAt: number;
}

/** 1 = awful … 5 = great. */
export type Mood = 1 | 2 | 3 | 4 | 5;

/** One entry per journal per day; write as much as you like in it. */
export interface JournalEntry {
  id: ID;
  journalId: ID;
  date: DateKey;
  text: string;
  mood: Mood | null;
  createdAt: number;
  updatedAt: number;
}

export interface JournalData {
  journals: Journal[];
  entries: JournalEntry[];
}

/** Diverging scale: red for rough days, neutral in the middle, blue for good ones. */
export const moodColor = (m: Mood) =>
  m === 1
    ? 'var(--series-8)'
    : m === 2
      ? 'color-mix(in srgb, var(--series-8) 55%, var(--grid))'
      : m === 3
        ? 'var(--axis)'
        : m === 4
          ? 'color-mix(in srgb, var(--series-1) 55%, var(--grid))'
          : 'var(--series-1)';

export const MOODS: { value: Mood; label: string }[] = [
  { value: 1, label: 'Awful' },
  { value: 2, label: 'Low' },
  { value: 3, label: 'Okay' },
  { value: 4, label: 'Good' },
  { value: 5, label: 'Great' },
];
