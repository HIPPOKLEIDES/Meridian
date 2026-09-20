import type { DateKey, ID, Minutes, TimeBlock } from '../types';
import { addDays, WEEKDAY_SHORT, weekday } from './dates';
import { blockOccursOn } from './plan';

/**
 * Timeframes: time blocks linked to a task (`TimeBlock.taskId`), i.e. when you plan to work on it.
 * A task can have any number, on any days, one-off or repeating.
 */

export const SNAP_MINUTES = 15;
export const DEFAULT_TIMEFRAME_MINUTES = 60;

export const timeframesOf = (taskId: ID, blocks: TimeBlock[]) =>
  blocks.filter((b) => b.taskId === taskId).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start));

export const hasTimeframeOn = (taskId: ID, blocks: TimeBlock[], date: DateKey) => blocks.some((b) => b.taskId === taskId && blockOccursOn(b, date));

export interface Occurrence {
  block: TimeBlock;
  date: DateKey;
  start: Minutes;
  end: Minutes;
}

/**
 * The next time a task is planned: later today (not yet over) or on a future day, looking ahead up to `horizonDays`.
 * Pass `subtaskId` to ask about one subtask's own times instead of the task's.
 */
export function nextTimeframe(
  taskId: ID,
  blocks: TimeBlock[],
  today: DateKey,
  nowMin: Minutes,
  { subtaskId, horizonDays = 60 }: { subtaskId?: ID | null; horizonDays?: number } = {},
): Occurrence | null {
  let best: Occurrence | null = null;
  for (const b of blocks) {
    if (b.taskId !== taskId) continue;
    if (subtaskId !== undefined && (b.subtaskId ?? null) !== subtaskId) continue;
    let date: DateKey | null = null;
    if (!b.repeatDays.length) {
      if (b.date > today || (b.date === today && b.end > nowMin)) date = b.date;
    } else {
      for (let i = 0; i <= horizonDays; i++) {
        const d = addDays(today, i);
        if (blockOccursOn(b, d) && (i > 0 || b.end > nowMin)) {
          date = d;
          break;
        }
      }
    }
    if (!date) continue;
    if (!best || date < best.date || (date === best.date && b.start < best.start)) best = { block: b, date, start: b.start, end: b.end };
  }
  return best;
}

export const snapMinutes = (m: number, step = SNAP_MINUTES) => Math.max(0, Math.min(1440, Math.round(m / step) * step));

/** A timeframe starting near `minute` (snapped), keeping its length and staying within the day. */
export function placeTimeframe(minute: number, duration = DEFAULT_TIMEFRAME_MINUTES): { start: Minutes; end: Minutes } {
  const length = Math.max(SNAP_MINUTES, Math.min(1440, duration));
  const start = Math.min(snapMinutes(minute), 1440 - length);
  return { start, end: start + length };
}

/** Start of the next whole hour (for "schedule" buttons), or 9:00 on another day. */
export function suggestedStart(date: DateKey, today: DateKey, nowMin: Minutes): Minutes {
  if (date !== today) return 9 * 60;
  return Math.min(23 * 60, Math.ceil((nowMin + 1) / 60) * 60);
}

export const describeRepeat = (days: number[]) => (days.length === 7 ? 'every day' : `every ${[...days].sort().map((d) => WEEKDAY_SHORT[d]).join(', ')}`);

export const isOnWeekday = (b: TimeBlock, date: DateKey) => b.repeatDays.includes(weekday(date));
