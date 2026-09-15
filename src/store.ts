import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AppData,
  Area,
  DateKey,
  Habit,
  HabitDay,
  ID,
  Project,
  RunningTimer,
  Settings,
  Task,
  TaskStatus,
  TimeBlock,
  TimeEntry,
} from './types';
import { nowMinutes, toKey, todayKey } from './lib/dates';
import { byId, dependentsOf, isLocked, wouldCycle } from './lib/tasks';
import { useUI } from './ui';
import { currentUserId } from './cloud/session';
import { sound } from './lib/sound';

export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

export const DEFAULT_AREAS: Area[] = [
  { id: 'social', name: 'Social', slot: 1, weeklyTargetHours: 8 },
  { id: 'career', name: 'Career', slot: 2, weeklyTargetHours: 35 },
  { id: 'health', name: 'Health', slot: 3, weeklyTargetHours: 5 },
  { id: 'knowledge', name: 'Knowledge', slot: 4, weeklyTargetHours: 7 },
];

export const emptyData = (): AppData => ({
  areas: DEFAULT_AREAS.map((a) => ({ ...a })),
  projects: [],
  tasks: [],
  habits: [],
  blocks: [],
  entries: [],
  timer: null,
  settings: { theme: 'system', weekStartsOn: 1 },
});

export const newTask = (t: Partial<Task> = {}): Task => ({
  id: uid(),
  title: '',
  notes: '',
  projectId: null,
  areaId: null,
  priority: 'medium',
  status: 'todo',
  startDate: null,
  endDate: null,
  subtasks: [],
  dependsOn: [],
  flow: null,
  createdAt: Date.now(),
  completedAt: null,
  createdBy: currentUserId(),
  ...t,
});

export const newHabit = (h: Partial<Habit> = {}): Habit => ({
  id: uid(),
  title: '',
  notes: '',
  areaId: null,
  days: [0, 1, 2, 3, 4, 5, 6],
  start: null,
  duration: 15,
  steps: [],
  logTime: true,
  log: {},
  startDate: todayKey(),
  archived: false,
  createdAt: Date.now(),
  ...h,
});

export const newProject = (p: Partial<Project> = {}): Project => ({
  id: uid(),
  name: '',
  description: '',
  areaId: null,
  priority: 'medium',
  status: 'active',
  createdAt: Date.now(),
  ...p,
});

export const newBlock = (b: Partial<TimeBlock> = {}): TimeBlock => ({
  id: uid(),
  title: '',
  date: todayKey(),
  start: 9 * 60,
  end: 10 * 60,
  repeatDays: [],
  areaId: null,
  taskId: null,
  ...b,
});

export const newEntry = (e: Partial<TimeEntry> = {}): TimeEntry => ({
  id: uid(),
  label: '',
  date: todayKey(),
  start: Math.max(0, nowMinutes() - 60),
  end: nowMinutes(),
  areaId: null,
  taskId: null,
  habitId: null,
  ...e,
});

/** Keep the auto-logged time entry for a habit/day in sync with its done state. */
function syncHabitEntry(entries: TimeEntry[], h: Habit, date: DateKey, done: boolean): TimeEntry[] {
  const rest = entries.filter((e) => !(e.habitId === h.id && e.date === date));
  if (!done || !h.logTime || h.duration <= 0) return rest;
  const fallback = date === todayKey() ? nowMinutes() - h.duration : 12 * 60;
  const end = Math.min(1440, Math.max(h.duration, (h.start ?? fallback) + h.duration));
  return [
    ...rest,
    newEntry({ label: h.title, date, start: end - h.duration, end, areaId: h.areaId, habitId: h.id }),
  ];
}

const patchList = <T extends { id: ID }>(list: T[], id: ID, patch: Partial<T>) =>
  list.map((x) => (x.id === id ? { ...x, ...patch } : x));

interface Actions {
  addArea(a?: Partial<Area>): ID;
  updateArea(id: ID, patch: Partial<Area>): void;
  deleteArea(id: ID): void;

  addProject(p: Partial<Project>): ID;
  updateProject(id: ID, patch: Partial<Project>): void;
  deleteProject(id: ID, withTasks: boolean): void;

  addTask(t: Partial<Task>): ID;
  updateTask(id: ID, patch: Partial<Task>): void;
  deleteTask(id: ID): void;
  setTaskStatus(id: ID, status: TaskStatus): void;
  toggleSubtask(taskId: ID, subId: ID): void;
  /** Returns false if the link would create a cycle. */
  addDependency(taskId: ID, prereqId: ID): boolean;
  removeDependency(taskId: ID, prereqId: ID): void;

  addHabit(h: Partial<Habit>): ID;
  updateHabit(id: ID, patch: Partial<Habit>): void;
  deleteHabit(id: ID): void;
  toggleHabit(id: ID, date: DateKey): void;
  toggleHabitStep(id: ID, date: DateKey, stepId: ID): void;

  addBlock(b: Partial<TimeBlock>): ID;
  updateBlock(id: ID, patch: Partial<TimeBlock>): void;
  deleteBlock(id: ID): void;

  addEntry(e: Partial<TimeEntry>): ID;
  updateEntry(id: ID, patch: Partial<TimeEntry>): void;
  deleteEntry(id: ID): void;

  startTimer(t: Omit<RunningTimer, 'startedAt'>): void;
  stopTimer(): void;
  discardTimer(): void;

  updateSettings(patch: Partial<Settings>): void;
  replaceAll(data: AppData): void;
}

export type Store = AppData & Actions;

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...emptyData(),

      addArea: (a = {}) => {
        const used = new Set(get().areas.map((x) => x.slot));
        const slot = [1, 2, 3, 4, 5, 6, 7, 8].find((s) => !used.has(s)) ?? 8;
        const area: Area = { id: uid(), name: 'New area', slot, weeklyTargetHours: null, ...a };
        set((s) => ({ areas: [...s.areas, area] }));
        return area.id;
      },
      updateArea: (id, patch) => set((s) => ({ areas: patchList(s.areas, id, patch) })),
      deleteArea: (id) =>
        set((s) => {
          const clear = <T extends { areaId: ID | null }>(xs: T[]) =>
            xs.map((x) => (x.areaId === id ? { ...x, areaId: null } : x));
          return {
            areas: s.areas.filter((a) => a.id !== id),
            projects: clear(s.projects),
            tasks: clear(s.tasks),
            habits: clear(s.habits),
            blocks: clear(s.blocks),
            entries: clear(s.entries),
            timer: s.timer?.areaId === id ? { ...s.timer, areaId: null } : s.timer,
          };
        }),

      addProject: (p) => {
        const project = newProject(p);
        set((s) => ({ projects: [...s.projects, project] }));
        return project.id;
      },
      updateProject: (id, patch) => set((s) => ({ projects: patchList(s.projects, id, patch) })),
      deleteProject: (id, withTasks) => {
        const { tasks } = get();
        if (withTasks) {
          for (const t of tasks.filter((t) => t.projectId === id)) get().deleteTask(t.id);
        } else {
          set((s) => ({ tasks: s.tasks.map((t) => (t.projectId === id ? { ...t, projectId: null, flow: null } : t)) }));
        }
        set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
      },

      addTask: (t) => {
        const task = newTask(t);
        set((s) => ({ tasks: [...s.tasks, task] }));
        return task.id;
      },
      updateTask: (id, patch) => {
        // Status goes through setTaskStatus so completedAt and unlock toasts stay consistent.
        const { status, ...rest } = patch;
        if (Object.keys(rest).length) set((s) => ({ tasks: patchList(s.tasks, id, rest) }));
        if (status) get().setTaskStatus(id, status);
      },
      deleteTask: (id) =>
        set((s) => ({
          tasks: s.tasks
            .filter((t) => t.id !== id)
            .map((t) => (t.dependsOn.includes(id) ? { ...t, dependsOn: t.dependsOn.filter((d) => d !== id) } : t)),
          // One-off timeframes for the task go with it; repeating blocks stay, just unlinked.
          blocks: s.blocks.filter((b) => b.taskId !== id || b.repeatDays.length).map((b) => (b.taskId === id ? { ...b, taskId: null } : b)),
          entries: s.entries.map((e) => (e.taskId === id ? { ...e, taskId: null } : e)),
          timer: s.timer?.taskId === id ? { ...s.timer, taskId: null } : s.timer,
        })),
      setTaskStatus: (id, status) => {
        const before = byId(get().tasks);
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id
              ? { ...t, status, completedAt: status === 'done' ? t.completedAt ?? Date.now() : null }
              : t,
          ),
        }));
        if (status !== 'done') return;
        const after = get().tasks;
        const afterMap = byId(after);
        const unlocked = dependentsOf(id, after).filter(
          (t) => t.status !== 'done' && isLocked(before[t.id], before) && !isLocked(t, afterMap),
        );
        if (unlocked.length) {
          useUI.getState().toast(`Unlocked: ${unlocked.map((t) => t.title || 'Untitled').join(', ')}`, 'unlock');
        }
      },
      toggleSubtask: (taskId, subId) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? { ...t, subtasks: t.subtasks.map((st) => (st.id === subId ? { ...st, done: !st.done } : st)) }
              : t,
          ),
        })),
      addDependency: (taskId, prereqId) => {
        const tasks = byId(get().tasks);
        if (!tasks[taskId] || !tasks[prereqId] || wouldCycle(tasks, taskId, prereqId)) return false;
        if (tasks[taskId].dependsOn.includes(prereqId)) return true;
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, dependsOn: [...t.dependsOn, prereqId] } : t)),
        }));
        return true;
      },
      removeDependency: (taskId, prereqId) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, dependsOn: t.dependsOn.filter((d) => d !== prereqId) } : t,
          ),
        })),

      addHabit: (h) => {
        const habit = newHabit(h);
        set((s) => ({ habits: [...s.habits, habit] }));
        return habit.id;
      },
      updateHabit: (id, patch) => set((s) => ({ habits: patchList(s.habits, id, patch) })),
      deleteHabit: (id) =>
        set((s) => ({
          habits: s.habits.filter((h) => h.id !== id),
          entries: s.entries.map((e) => (e.habitId === id ? { ...e, habitId: null } : e)),
        })),
      toggleHabit: (id, date) =>
        set((s) => {
          const h = s.habits.find((x) => x.id === id);
          if (!h) return {};
          const done = !h.log[date]?.done;
          const day: HabitDay = { done, steps: done ? h.steps.map((st) => st.id) : [] };
          return {
            habits: patchList(s.habits, id, { log: { ...h.log, [date]: day } }),
            entries: syncHabitEntry(s.entries, h, date, done),
          };
        }),
      toggleHabitStep: (id, date, stepId) =>
        set((s) => {
          const h = s.habits.find((x) => x.id === id);
          if (!h) return {};
          const prev = h.log[date] ?? { done: false, steps: [] };
          const steps = prev.steps.includes(stepId)
            ? prev.steps.filter((x) => x !== stepId)
            : [...prev.steps, stepId];
          const done = h.steps.length > 0 && h.steps.every((st) => steps.includes(st.id));
          if (done && !prev.done) sound('complete');
          return {
            habits: patchList(s.habits, id, { log: { ...h.log, [date]: { done, steps } } }),
            entries: done === prev.done ? s.entries : syncHabitEntry(s.entries, h, date, done),
          };
        }),

      addBlock: (b) => {
        const block = newBlock(b);
        set((s) => ({ blocks: [...s.blocks, block] }));
        return block.id;
      },
      updateBlock: (id, patch) => set((s) => ({ blocks: patchList(s.blocks, id, patch) })),
      deleteBlock: (id) => set((s) => ({ blocks: s.blocks.filter((b) => b.id !== id) })),

      addEntry: (e) => {
        const entry = newEntry(e);
        set((s) => ({ entries: [...s.entries, entry] }));
        return entry.id;
      },
      updateEntry: (id, patch) => set((s) => ({ entries: patchList(s.entries, id, patch) })),
      deleteEntry: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

      startTimer: (t) => {
        if (get().timer) get().stopTimer();
        set({ timer: { ...t, startedAt: Date.now() } });
      },
      stopTimer: () => {
        const t = get().timer;
        if (!t) return;
        const end = new Date();
        if (end.getTime() - t.startedAt < 60_000) {
          set({ timer: null });
          useUI.getState().toast('Timer ran under a minute, so nothing was logged');
          return;
        }
        // Split across midnight so each entry belongs to exactly one day.
        const made: TimeEntry[] = [];
        let cur = new Date(t.startedAt);
        while (cur < end) {
          const dayEnd = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
          const segEnd = dayEnd < end ? dayEnd : end;
          const startMin = nowMinutes(cur);
          const endMin = segEnd === dayEnd ? 1440 : nowMinutes(segEnd);
          if (endMin > startMin) {
            made.push(
              newEntry({ label: t.label, date: toKey(cur), start: startMin, end: endMin, areaId: t.areaId, taskId: t.taskId }),
            );
          }
          cur = dayEnd;
        }
        set((s) => ({ timer: null, entries: [...s.entries, ...made] }));
      },
      discardTimer: () => set({ timer: null }),

      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      replaceAll: (data) => set({ ...emptyData(), ...data }),
    }),
    {
      name: 'meridian:data',
      version: 1,
      partialize: (s): AppData => ({
        areas: s.areas,
        projects: s.projects,
        tasks: s.tasks,
        habits: s.habits,
        blocks: s.blocks,
        entries: s.entries,
        timer: s.timer,
        settings: s.settings,
      }),
    },
  ),
);

export const exportData = (): AppData => {
  const s = useStore.getState();
  const { areas, projects, tasks, habits, blocks, entries, timer, settings } = s;
  return { areas, projects, tasks, habits, blocks, entries, timer, settings };
};
