export type ID = string;
/** Local calendar date, `YYYY-MM-DD`. Never a UTC timestamp. */
export type DateKey = string;
/** Minutes from local midnight, 0–1440. */
export type Minutes = number;

export type Priority = 'urgent' | 'high' | 'medium' | 'low';

/** A life area that time is attributed to (social, career, health, knowledge…). */
export interface Area {
  id: ID;
  name: string;
  /** Categorical color slot 1–8; the CSS vars `--series-N` resolve it per theme. */
  slot: number;
  weeklyTargetHours: number | null;
}

export interface CheckItem {
  id: ID;
  text: string;
  done: boolean;
}

export type TaskStatus = 'todo' | 'doing' | 'done';

export interface Task {
  id: ID;
  title: string;
  notes: string;
  projectId: ID | null;
  /** Null means "inherit from project". */
  areaId: ID | null;
  priority: Priority;
  status: TaskStatus;
  /** A task may span several days; both null = unscheduled. */
  startDate: DateKey | null;
  endDate: DateKey | null;
  subtasks: CheckItem[];
  /** Prerequisites: this task is locked until every one of these is done. */
  dependsOn: ID[];
  /** Position on its project's flow map. */
  flow: { x: number; y: number } | null;
  createdAt: number;
  completedAt: number | null;
  /** Account ids of the people this task is assigned to (shared projects). */
  assigneeIds?: string[];
  /** Account id of whoever created the task, when signed in. */
  createdBy?: string | null;
}

export type ProjectStatus = 'active' | 'paused' | 'done';

export interface Project {
  id: ID;
  name: string;
  description: string;
  areaId: ID | null;
  priority: Priority;
  status: ProjectStatus;
  createdAt: number;
}

export interface HabitStep {
  id: ID;
  text: string;
}

/** One day's record for a habit. `steps` holds the ids of checked steps. */
export interface HabitDay {
  done: boolean;
  steps: ID[];
}

export interface Habit {
  id: ID;
  title: string;
  notes: string;
  areaId: ID | null;
  /** Weekdays the habit is scheduled on, 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** Scheduled start time, or null for "any time of day". */
  start: Minutes | null;
  duration: Minutes;
  steps: HabitStep[];
  /** When checked off, log `duration` minutes to the habit's area. */
  logTime: boolean;
  log: Record<DateKey, HabitDay>;
  startDate: DateKey;
  archived: boolean;
  createdAt: number;
}

/** A planned slot on the day clock. */
export interface TimeBlock {
  id: ID;
  title: string;
  /** First (or only) date of the block. */
  date: DateKey;
  start: Minutes;
  end: Minutes;
  /** Weekdays it repeats on from `date` onward; empty = one-off. */
  repeatDays: number[];
  areaId: ID | null;
  taskId: ID | null;
}

/** Time actually spent — from the timer, a completed habit, or manual entry. */
export interface TimeEntry {
  id: ID;
  label: string;
  date: DateKey;
  start: Minutes;
  end: Minutes;
  areaId: ID | null;
  taskId: ID | null;
  habitId: ID | null;
}

export interface RunningTimer {
  startedAt: number;
  label: string;
  areaId: ID | null;
  taskId: ID | null;
}

export type ThemeSetting = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemeSetting;
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: 0 | 1;
}

export interface AppData {
  areas: Area[];
  projects: Project[];
  tasks: Task[];
  habits: Habit[];
  blocks: TimeBlock[];
  entries: TimeEntry[];
  timer: RunningTimer | null;
  settings: Settings;
}
