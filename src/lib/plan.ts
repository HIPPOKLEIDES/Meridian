import type { AppData, DateKey, ID, Minutes, TimeBlock } from '../types';
import { weekday } from './dates';
import { isScheduled } from './habits';
import { byId, taskArea } from './tasks';

export interface PlanItem {
  key: string;
  kind: 'block' | 'habit';
  id: ID;
  title: string;
  start: Minutes;
  end: Minutes;
  areaId: ID | null;
  /** Habits: done today. Task timeframes: the task (or its subtask) is done. */
  done?: boolean;
  repeating: boolean;
  /** Set for a task's timeframe. */
  taskId?: ID | null;
  /** For a scheduled subtask or habit step: the thing it belongs to. */
  parentTitle?: string;
  /** Set when the item is one subtask of `taskId`. */
  subtaskId?: ID | null;
  /** Set when the item is one step of the habit `id`. */
  stepId?: ID | null;
}

/** How long a habit step is assumed to take when it has a time but no duration of its own. */
export const HABIT_STEP_MINUTES = 10;

export const blockOccursOn = (b: TimeBlock, date: DateKey) =>
  b.repeatDays.length ? date >= b.date && b.repeatDays.includes(weekday(date)) : b.date === date;

/**
 * Everything planned on the day clock for a date: time blocks (including task timeframes) plus timed habits.
 * With tasks and projects given, a timeframe shows its task's current title and area.
 */
export function planForDate(data: Pick<AppData, 'blocks' | 'habits'> & Partial<Pick<AppData, 'tasks' | 'projects'>>, date: DateKey): PlanItem[] {
  const items: PlanItem[] = [];
  const tasks = data.tasks ? byId(data.tasks) : {};
  const projects = data.projects ? byId(data.projects) : {};
  for (const b of data.blocks) {
    if (!blockOccursOn(b, date)) continue;
    const task = b.taskId ? tasks[b.taskId] : undefined;
    // A block can be for one subtask, in which case that is what the clock shows.
    const subtask = task && b.subtaskId ? task.subtasks.find((st) => st.id === b.subtaskId) : undefined;
    items.push({
      key: `b:${b.id}`,
      kind: 'block',
      id: b.id,
      title: subtask?.text || task?.title || b.title,
      start: b.start,
      end: b.end,
      areaId: b.areaId ?? (task ? taskArea(task, projects) : null),
      repeating: b.repeatDays.length > 0,
      taskId: b.taskId,
      parentTitle: subtask ? task?.title : undefined,
      subtaskId: subtask ? b.subtaskId : null,
      done: task ? (subtask ? subtask.done || task.status === 'done' : task.status === 'done') : undefined,
    });
  }
  for (const h of data.habits) {
    if (h.archived || !isScheduled(h, date)) continue;
    if (h.start !== null) {
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
    // Steps with a time of their own sit on the clock next to the habit.
    for (const step of h.steps) {
      if (step.start === null || step.start === undefined) continue;
      items.push({
        key: `h:${h.id}:${step.id}`,
        kind: 'habit',
        id: h.id,
        title: step.text,
        parentTitle: h.title,
        stepId: step.id,
        start: step.start,
        end: Math.min(1440, step.start + Math.max(5, step.duration ?? HABIT_STEP_MINUTES)),
        areaId: h.areaId,
        done: !!h.log[date]?.steps.includes(step.id) || !!h.log[date]?.done,
        repeating: true,
      });
    }
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
