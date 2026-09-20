import { uid, useStore } from '../store';
import { useGoals } from '../goals/store';
import { fmtClock, fmtDays, todayKey } from '../lib/dates';
import type { Proposal } from './proposals';

/** Turning an accepted proposal into a real change, and describing one before it is accepted. */

const areaIdByName = (name: string | undefined) => {
  if (!name) return undefined;
  const match = useStore.getState().areas.find((a) => a.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  return match?.id;
};

const projectIdByName = (name: string | undefined) => {
  if (!name) return undefined;
  const match = useStore.getState().projects.find((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  return match?.id;
};

export interface ProposalCard {
  /** "New habit", "Change to “Morning run”"… */
  heading: string;
  subject: string;
  /** The specifics, one per line. */
  lines: string[];
  /** Set when the thing it refers to has since been deleted or renamed away. */
  problem?: string;
}

const timeLabel = (start: number | null | undefined) => (start === null ? 'any time' : start === undefined ? undefined : fmtClock(start));

export function describeProposal(p: Proposal): ProposalCard {
  const core = useStore.getState();
  const goals = useGoals.getState();
  const lines: string[] = [];
  const push = (label: string, value: string | undefined) => value && lines.push(`${label}: ${value}`);

  if (p.kind === 'new_habit' || p.kind === 'adjust_habit') {
    const habit = p.targetId ? core.habits.find((h) => h.id === p.targetId) : undefined;
    if (p.kind === 'adjust_habit' && !habit) return { heading: 'Change a habit', subject: 'This habit', lines: [], problem: 'That habit no longer exists.' };
    if (p.archive) lines.push('Retire it (kept in the archive, off Today and the clock)');
    push('Name', p.title);
    push('Days', p.days && fmtDays(p.days));
    push('Time', timeLabel(p.start));
    push('Length', p.minutes === undefined ? undefined : p.minutes === 0 ? 'takes no time' : `${p.minutes} min`);
    push('Steps', p.steps?.join(' → '));
    push('Area', p.areaName);
    return { heading: p.kind === 'new_habit' ? 'New habit' : 'Change a habit', subject: habit?.title || p.title || 'Habit', lines };
  }

  if (p.kind === 'new_goal' || p.kind === 'adjust_goal') {
    const goal = p.targetId ? goals.goals.find((g) => g.id === p.targetId) : undefined;
    if (p.kind === 'adjust_goal' && !goal) return { heading: 'Change a goal', subject: 'This goal', lines: [], problem: 'That goal no longer exists.' };
    push('Name', p.title);
    push('Status', p.status);
    push('Horizon', p.horizon);
    push('Why', p.why);
    push('What it looks like', p.vision);
    push('Check-in questions', p.prompts?.join(' · '));
    push(p.kind === 'new_goal' ? 'Milestones' : 'Add milestones', p.milestones?.join(' · '));
    push('Journal tag', p.tag && `#${p.tag}`);
    push('Area', p.areaName);
    return { heading: p.kind === 'new_goal' ? 'New goal' : 'Change a goal', subject: goal?.title || p.title || 'Goal', lines };
  }

  const task = p.targetId ? core.tasks.find((t) => t.id === p.targetId) : undefined;
  if (p.kind === 'adjust_task' && !task) return { heading: 'Change a task', subject: 'This task', lines: [], problem: 'That task no longer exists.' };
  push('Name', p.title);
  push('Project', p.projectName);
  push('Priority', p.priority);
  push('Status', p.taskStatus);
  push('Starts', p.startDate === null ? 'cleared' : p.startDate);
  push('Due', p.endDate === null ? 'cleared' : p.endDate);
  push('Notes', p.notes);
  return { heading: p.kind === 'new_task' ? 'New task' : 'Change a task', subject: task?.title || p.title || 'Task', lines };
}

/** Applies a proposal and returns a sentence describing what changed. Throws if its subject is gone. */
export function applyProposal(p: Proposal): string {
  const store = useStore.getState();
  const goals = useGoals.getState();

  switch (p.kind) {
    case 'new_habit': {
      const minutes = p.minutes ?? 15;
      store.addHabit({
        title: p.title,
        days: p.days ?? [0, 1, 2, 3, 4, 5, 6],
        start: p.start === undefined ? null : p.start,
        duration: minutes,
        steps: (p.steps ?? []).map((text) => ({ id: uid(), text })),
        areaId: areaIdByName(p.areaName) ?? null,
        logTime: minutes > 0,
        notes: p.rationale,
        startDate: todayKey(),
      });
      return `Added the habit “${p.title}”`;
    }
    case 'adjust_habit': {
      const habit = store.habits.find((h) => h.id === p.targetId);
      if (!habit) throw new Error('That habit no longer exists.');
      const area = areaIdByName(p.areaName);
      store.updateHabit(habit.id, {
        ...(p.title ? { title: p.title } : {}),
        ...(p.days ? { days: p.days } : {}),
        ...(p.start !== undefined ? { start: p.start } : {}),
        ...(p.minutes !== undefined ? { duration: p.minutes, logTime: p.minutes > 0 && habit.logTime } : {}),
        ...(p.steps ? { steps: p.steps.map((text) => ({ id: uid(), text })) } : {}),
        ...(area ? { areaId: area } : {}),
        ...(p.archive ? { archived: true } : {}),
      });
      return `Updated “${p.title || habit.title}”`;
    }
    case 'new_goal': {
      goals.addGoal({
        title: p.title,
        why: p.why ?? '',
        vision: p.vision ?? '',
        horizon: p.horizon ?? 'season',
        status: p.status ?? 'exploring',
        areaId: areaIdByName(p.areaName) ?? null,
        ...(p.prompts ? { prompts: p.prompts } : {}),
        milestones: (p.milestones ?? []).map((text) => ({ id: uid(), text, doneOn: null })),
        tag: p.tag ?? '',
        notes: p.rationale,
      });
      return `Added the goal “${p.title}”`;
    }
    case 'adjust_goal': {
      const goal = goals.goals.find((g) => g.id === p.targetId);
      if (!goal) throw new Error('That goal no longer exists.');
      goals.updateGoal(goal.id, (g) => ({
        ...(p.title ? { title: p.title } : {}),
        ...(p.status ? { status: p.status } : {}),
        ...(p.horizon ? { horizon: p.horizon } : {}),
        ...(p.why ? { why: p.why } : {}),
        ...(p.vision ? { vision: p.vision } : {}),
        ...(p.prompts ? { prompts: p.prompts } : {}),
        ...(p.tag ? { tag: p.tag } : {}),
        // Milestones are added, never replaced: the ones already there may be half done.
        ...(p.milestones ? { milestones: [...g.milestones, ...p.milestones.map((text) => ({ id: uid(), text, doneOn: null }))] } : {}),
      }));
      return `Updated “${p.title || goal.title}”`;
    }
    case 'new_task': {
      store.addTask({
        title: p.title,
        notes: p.notes ?? '',
        projectId: projectIdByName(p.projectName) ?? null,
        priority: p.priority ?? 'medium',
        startDate: p.startDate ?? null,
        endDate: p.endDate ?? null,
      });
      return `Added the task “${p.title}”`;
    }
    case 'adjust_task': {
      const task = store.tasks.find((t) => t.id === p.targetId);
      if (!task) throw new Error('That task no longer exists.');
      const project = projectIdByName(p.projectName);
      store.updateTask(task.id, {
        ...(p.title ? { title: p.title } : {}),
        ...(p.priority ? { priority: p.priority } : {}),
        ...(p.taskStatus ? { status: p.taskStatus } : {}),
        ...(p.startDate !== undefined ? { startDate: p.startDate } : {}),
        ...(p.endDate !== undefined ? { endDate: p.endDate } : {}),
        ...(p.notes ? { notes: p.notes } : {}),
        ...(project ? { projectId: project } : {}),
      });
      return `Updated “${p.title || task.title}”`;
    }
  }
}
