import type { ID, Minutes, Priority } from '../types';
import type { GoalHorizon, GoalStatus } from '../goals/types';
import { parseClock } from '../lib/dates';

/**
 * Changes the coach can offer to make: a new habit, a tweak to one, a goal, a task.
 *
 * Nothing here is applied on its own. Each proposal is shown as a card with an Apply button, and
 * everything coming back from the model is checked here first — names are trimmed, ids must exist,
 * days must be days. A model that asks for something unsupported is simply ignored.
 */

export type ProposalKind = 'new_habit' | 'adjust_habit' | 'new_goal' | 'adjust_goal' | 'new_task' | 'adjust_task';

export interface Proposal {
  kind: ProposalKind;
  /** What this change is meant to do, in the coach's words. */
  rationale: string;
  /** The thing being changed, for adjust_*. */
  targetId?: ID;
  title?: string;
  /** Habits: weekdays, 0 = Sunday. */
  days?: number[];
  /** Habits: minutes from midnight, or null for "any time". */
  start?: Minutes | null;
  minutes?: number;
  steps?: string[];
  areaName?: string;
  archive?: boolean;
  /** Goals. */
  why?: string;
  vision?: string;
  horizon?: GoalHorizon;
  status?: GoalStatus;
  prompts?: string[];
  milestones?: string[];
  tag?: string;
  /** Tasks. */
  projectName?: string;
  priority?: Priority;
  taskStatus?: 'todo' | 'doing' | 'done';
  startDate?: string | null;
  endDate?: string | null;
  notes?: string;
}

const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low'];
const HORIZONS: GoalHorizon[] = ['season', 'year', 'someday'];
const GOAL_STATUS: GoalStatus[] = ['exploring', 'active', 'paused', 'achieved', 'released'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const list = (v: unknown, max = 20): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => str(x, 200)).filter((x): x is string => !!x).slice(0, max);
  return out.length ? out : undefined;
};
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);

const days = (v: unknown): number[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = [...new Set(v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  return out.length ? out : undefined;
};

/** "07:30" → 450; "any"/null → null; anything else → undefined (leave it alone). */
const time = (v: unknown): Minutes | null | undefined => {
  if (v === null || (typeof v === 'string' && /^(any|any time|none)$/i.test(v))) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.min(1439, Math.round(v)));
  if (typeof v !== 'string') return undefined;
  const parsed = parseClock(v.trim());
  return parsed === null ? undefined : parsed;
};

const minutes = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 600 ? Math.round(v) : undefined);
const date = (v: unknown) => (v === null ? null : typeof v === 'string' && DATE.test(v.trim()) ? v.trim() : undefined);
const oneOf = <T extends string>(v: unknown, allowed: T[]): T | undefined => (typeof v === 'string' && (allowed as string[]).includes(v) ? (v as T) : undefined);

export interface KnownIds {
  habits: ReadonlySet<ID>;
  goals: ReadonlySet<ID>;
  tasks: ReadonlySet<ID>;
}

/**
 * Turns whatever the model sent into proposals we are willing to show.
 * Anything unrecognisable, or pointing at something that no longer exists, is dropped.
 */
export function parseProposals(input: unknown, known: KnownIds): Proposal[] {
  const changes = (input as { changes?: unknown })?.changes;
  if (!Array.isArray(changes)) return [];
  const out: Proposal[] = [];
  for (const raw of changes.slice(0, 12)) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    const kind = oneOf(c.kind, ['new_habit', 'adjust_habit', 'new_goal', 'adjust_goal', 'new_task', 'adjust_task'] as ProposalKind[]);
    if (!kind) continue;
    const targetId = str(c.id, 64) ?? str(c.target_id, 64);
    const p: Proposal = { kind, rationale: str(c.rationale, 600) ?? '', targetId };

    if (kind === 'adjust_habit' && (!targetId || !known.habits.has(targetId))) continue;
    if (kind === 'adjust_goal' && (!targetId || !known.goals.has(targetId))) continue;
    if (kind === 'adjust_task' && (!targetId || !known.tasks.has(targetId))) continue;

    p.title = str(c.title, 120);
    p.days = days(c.days);
    p.start = time(c.start);
    p.minutes = minutes(c.minutes);
    p.steps = list(c.steps, 12);
    p.areaName = str(c.area, 60);
    p.archive = bool(c.archive);
    p.why = str(c.why, 600);
    p.vision = str(c.vision, 600);
    p.horizon = oneOf(c.horizon, HORIZONS);
    p.status = oneOf(c.status, GOAL_STATUS);
    p.prompts = list(c.prompts, 6);
    p.milestones = list(c.milestones, 8);
    p.tag = str(c.tag, 32)?.replace(/^#/, '').toLowerCase();
    p.projectName = str(c.project, 80);
    p.priority = oneOf(c.priority, PRIORITIES);
    p.taskStatus = oneOf(c.task_status, ['todo', 'doing', 'done'] as const);
    p.startDate = date(c.start_date);
    p.endDate = date(c.end_date);
    p.notes = str(c.notes, 1000);

    // Something new needs a name; a tweak needs at least one change.
    if ((kind === 'new_habit' || kind === 'new_goal' || kind === 'new_task') && !p.title) continue;
    if (kind.startsWith('adjust_') && !Object.entries(p).some(([k, v]) => !['kind', 'rationale', 'targetId'].includes(k) && v !== undefined)) continue;
    out.push(p);
  }
  return out;
}

/** The schema Claude fills in. Kept flat and plainly named: models do better with that than with unions. */
export const PROPOSE_TOOL = {
  name: 'propose_changes',
  description:
    'Offer concrete changes to the person’s habits, goals or tasks. Each one is shown to them as a card they can apply or ignore, so propose only changes you would defend, and explain each in `rationale`. Never use this to restate what they already have.',
  input_schema: {
    type: 'object',
    properties: {
      changes: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['new_habit', 'adjust_habit', 'new_goal', 'adjust_goal', 'new_task', 'adjust_task'],
              description: 'What sort of change this is.',
            },
            id: { type: 'string', description: 'For adjust_*: the id of the habit, goal or task from the snapshot.' },
            rationale: { type: 'string', description: 'One or two sentences on why, addressed to the person.' },
            title: { type: 'string', description: 'Name of the habit, goal or task.' },
            days: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'Habits: weekdays it runs on, 0 = Sunday.' },
            start: { type: 'string', description: 'Habits: time of day as "HH:MM" (24-hour), or "any".' },
            minutes: { type: 'integer', description: 'Habits: how long it takes. 0 means it takes no time.' },
            steps: { type: 'array', items: { type: 'string' }, description: 'Habits: the steps it is made of.' },
            area: { type: 'string', description: 'Name of an existing life area, exactly as it appears in the snapshot.' },
            archive: { type: 'boolean', description: 'adjust_habit: retire the habit instead of changing it.' },
            why: { type: 'string', description: 'Goals: why this matters to them.' },
            vision: { type: 'string', description: 'Goals: what it looks like when it is working.' },
            horizon: { type: 'string', enum: ['season', 'year', 'someday'], description: 'Goals: rough time frame.' },
            status: { type: 'string', enum: ['exploring', 'active', 'paused', 'achieved', 'released'], description: 'adjust_goal: new status.' },
            prompts: { type: 'array', items: { type: 'string' }, description: 'Goals: questions to ask at each check-in.' },
            milestones: { type: 'array', items: { type: 'string' }, description: 'Goals: unordered markers of progress.' },
            tag: { type: 'string', description: 'Goals: the journal #tag that links entries to this goal.' },
            project: { type: 'string', description: 'Tasks: name of an existing project.' },
            priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
            task_status: { type: 'string', enum: ['todo', 'doing', 'done'] },
            start_date: { type: 'string', description: 'Tasks: YYYY-MM-DD, or null to clear.' },
            end_date: { type: 'string', description: 'Tasks: due date, YYYY-MM-DD, or null to clear.' },
            notes: { type: 'string' },
          },
          required: ['kind', 'rationale'],
        },
      },
    },
    required: ['changes'],
  },
} as const;
