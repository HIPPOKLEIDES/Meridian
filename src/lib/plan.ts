import type { AppData, DateKey, ID, Minutes, TimeBlock } from '../types';
import { weekday } from './dates';
import { isScheduled } from './habits';

export interface PlanItem {
  key: string;
  kind: 'block' | 'habit';
  id: ID;
  title: string;
  start: Minutes;
  end: Minutes;
  areaId: ID | null;
  /** Habits only. */
  done?: boolean;
  repeating: boolean;
}

export const blockOccursOn = (b: TimeBlock, date: DateKey) =>
  b.repeatDays.length ? date >= b.date && b.repeatDays.includes(weekday(date)) : b.date === date;

/** Everything planned on the day clock for a date: time blocks plus timed habits. */
export function planForDate(data: Pick<AppData, 'blocks' | 'habits'>, date: DateKey): PlanItem[] {
  const items: PlanItem[] = [];
  for (const b of data.blocks) {
    if (!blockOccursOn(b, date)) continue;
    items.push({
      key: `b:${b.id}`,
      kind: 'block',
      id: b.id,
      title: b.title,
      start: b.start,
      end: b.end,
      areaId: b.areaId,
      repeating: b.repeatDays.length > 0,
    });
  }
  for (const h of data.habits) {
    if (h.archived || h.start === null || !isScheduled(h, date)) continue;
    items.push({
      key: `h:${h.id}`,
      kind: 'habit',
      id: h.id,
      title: h.title,
      start: h.start,
      end: Math.min(1440, h.start + Math.max(5, h.duration)),
      areaId: h.areaId,
      done: !!h.log[date]?.done,
      repeating: true,
    });
  }
  return items.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Assign overlapping intervals to lanes (greedy), returning lane index per item and lane count. */
export function assignLanes<T extends { start: number; end: number }>(items: T[]): { lanes: number[]; count: number } {
  const order = items.map((_, i) => i).sort((a, b) => items[a].start - items[b].start);
  const laneEnds: number[] = [];
  const lanes: number[] = new Array(items.length);
  for (const i of order) {
    let lane = laneEnds.findIndex((end) => end <= items[i].start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = items[i].end;
    lanes[i] = lane;
  }
  return { lanes, count: Math.max(1, laneEnds.length) };
}
