import type { DateKey, ID, Priority, Project, Task } from '../types';

export const PRIORITIES: { id: Priority; label: string; rank: number }[] = [
  { id: 'urgent', label: 'Urgent', rank: 0 },
  { id: 'high', label: 'High', rank: 1 },
  { id: 'medium', label: 'Medium', rank: 2 },
  { id: 'low', label: 'Low', rank: 3 },
];

export const priorityRank = (p: Priority) => PRIORITIES.find((x) => x.id === p)!.rank;
export const priorityLabel = (p: Priority) => PRIORITIES.find((x) => x.id === p)!.label;

export const byId = <T extends { id: ID }>(items: T[]): Record<ID, T> =>
  Object.fromEntries(items.map((i) => [i.id, i]));

/** Unfinished prerequisites of a task. */
export const blockersOf = (task: Task, tasks: Record<ID, Task>): Task[] =>
  task.dependsOn.map((id) => tasks[id]).filter((t): t is Task => !!t && t.status !== 'done');

export const isLocked = (task: Task, tasks: Record<ID, Task>) => blockersOf(task, tasks).length > 0;

export type FlowState = 'done' | 'available' | 'locked';

export const flowState = (task: Task, tasks: Record<ID, Task>): FlowState =>
  task.status === 'done' ? 'done' : isLocked(task, tasks) ? 'locked' : 'available';

/** Tasks that list `taskId` as a prerequisite. */
export const dependentsOf = (taskId: ID, tasks: Task[]) => tasks.filter((t) => t.dependsOn.includes(taskId));

/** True if making `prereqId` a prerequisite of `taskId` would create a loop. */
export function wouldCycle(tasks: Record<ID, Task>, taskId: ID, prereqId: ID): boolean {
  if (taskId === prereqId) return true;
  const seen = new Set<ID>();
  const stack = [prereqId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = tasks[id];
    if (t) stack.push(...t.dependsOn);
  }
  return false;
}

export const taskSpan = (t: Task): [DateKey, DateKey] | null => {
  const s = t.startDate ?? t.endDate;
  const e = t.endDate ?? t.startDate;
  if (!s || !e) return null;
  return s <= e ? [s, e] : [e, s];
};

export const isActiveOn = (t: Task, date: DateKey) => {
  const span = taskSpan(t);
  return !!span && span[0] <= date && date <= span[1];
};

export const isOverdue = (t: Task, today: DateKey) => {
  const span = taskSpan(t);
  return t.status !== 'done' && !!span && span[1] < today;
};

export const taskArea = (t: Task, projects: Record<ID, Project>): ID | null =>
  t.areaId ?? (t.projectId ? projects[t.projectId]?.areaId ?? null : null);

export const compareTasks = (a: Task, b: Task) => {
  if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1;
  const p = priorityRank(a.priority) - priorityRank(b.priority);
  if (p) return p;
  const ad = taskSpan(a)?.[1] ?? '9999';
  const bd = taskSpan(b)?.[1] ?? '9999';
  if (ad !== bd) return ad < bd ? -1 : 1;
  return a.createdAt - b.createdAt;
};

export const NODE_W = 220;
const COL_GAP = 90;
const ROW_H = 120;

/** Layered left-to-right layout: each task sits one column right of its deepest prerequisite. */
export function layoutFlow(tasks: Task[]): Record<ID, { x: number; y: number }> {
  const map = byId(tasks);
  const depth: Record<ID, number> = {};
  const visiting = new Set<ID>();
  const depthOf = (id: ID): number => {
    if (depth[id] !== undefined) return depth[id];
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const prereqs = map[id].dependsOn.filter((p) => map[p]);
    const d = prereqs.length ? Math.max(...prereqs.map(depthOf)) + 1 : 0;
    visiting.delete(id);
    return (depth[id] = d);
  };
  const columns: Task[][] = [];
  for (const t of [...tasks].sort(compareTasks)) {
    const d = depthOf(t.id);
    (columns[d] ??= []).push(t);
  }
  const tallest = Math.max(1, ...columns.map((c) => c?.length ?? 0));
  const out: Record<ID, { x: number; y: number }> = {};
  columns.forEach((col, ci) => {
    if (!col) return;
    const offset = ((tallest - col.length) * ROW_H) / 2;
    col.forEach((t, ri) => {
      out[t.id] = { x: ci * (NODE_W + COL_GAP), y: offset + ri * ROW_H };
    });
  });
  return out;
}
