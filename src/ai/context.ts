import type { AppData, DateKey, Task } from '../types';
import type { GoalsData } from '../goals/types';
import type { JournalData } from '../journal/types';
import type { HealthData } from '../health/types';
import { addDays, diffDays, fmtClock, fmtDays } from '../lib/dates';
import { currentStrength, isScheduled, streakStats, strengthLabel } from '../lib/habits';
import { compareTasks, isOverdue } from '../lib/tasks';
import { latestCheckIn, reviewStatus } from '../goals/store';

/**
 * The picture of your week that the coach is given.
 *
 * It is deliberately small and readable: counts, rates and titles rather than raw history, so the
 * request stays cheap and you can see exactly what leaves the device (Coach → what gets sent).
 * Journal text and health readings are only included when you turn them on.
 */

export interface ContextOptions {
  today: DateKey;
  includeJournalText: boolean;
  includeHealth: boolean;
  /** An encrypted journal that is locked can't be read, so it is left out entirely. */
  journalLocked: boolean;
}

export interface ContextSources {
  core: Pick<AppData, 'areas' | 'projects' | 'tasks' | 'habits' | 'entries'>;
  goals: GoalsData;
  journal: JournalData;
  health?: HealthData;
}

const LIMITS = { habits: 40, tasks: 12, projects: 20, goals: 20, journal: 14 };

const round = (n: number, places = 1) => Number(n.toFixed(places));
const trim = (s: string, n = 240) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** Hours logged per area over the `days` days ending the day before `end` (inclusive of `end`). */
function hoursByArea(entries: AppData['entries'], from: DateKey, to: DateKey) {
  const out = new Map<string | null, number>();
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    out.set(e.areaId, (out.get(e.areaId) ?? 0) + (e.end - e.start) / 60);
  }
  return out;
}

export function buildContext({ core, goals, journal, health }: ContextSources, opts: ContextOptions) {
  const { today } = opts;
  const areaName = (id: string | null) => core.areas.find((a) => a.id === id)?.name ?? null;
  const projectName = (id: string | null) => core.projects.find((p) => p.id === id)?.name ?? null;
  const week = hoursByArea(core.entries, addDays(today, -6), today);
  const prevWeek = hoursByArea(core.entries, addDays(today, -13), addDays(today, -7));

  const areas = core.areas.map((a) => ({
    name: a.name,
    weeklyTargetHours: a.weeklyTargetHours,
    hoursLast7: round(week.get(a.id) ?? 0),
    hoursPrev7: round(prevWeek.get(a.id) ?? 0),
  }));

  const habits = core.habits
    .filter((h) => !h.archived)
    .slice(0, LIMITS.habits)
    .map((h) => {
      const streak = streakStats(h, today);
      const last14 = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13))
        .filter((d) => isScheduled(h, d))
        .map((d) => (h.log[d]?.done ? '1' : d === today ? '?' : '0'))
        .join('');
      const doneDates = Object.keys(h.log).filter((d) => h.log[d]?.done).sort();
      return {
        id: h.id,
        title: h.title || 'Untitled habit',
        area: areaName(h.areaId),
        days: fmtDays(h.days),
        time: h.start === null ? 'any time' : fmtClock(h.start),
        minutes: h.duration,
        steps: h.steps.map((s) => (s.start === null || s.start === undefined ? s.text : `${s.text} at ${fmtClock(s.start)}`)),
        strength: round(currentStrength(h, today), 2),
        strengthLabel: strengthLabel(currentStrength(h, today)),
        streak: streak.current,
        bestStreak: streak.best,
        rate30: round(streak.rate30, 2),
        /** Oldest to newest over the last fortnight: 1 done, 0 missed, ? still open. */
        recent: last14,
        lastDone: doneDates.at(-1) ?? null,
        startedTracking: h.startDate,
        notes: h.notes ? trim(h.notes, 160) : undefined,
      };
    });

  const open = core.tasks.filter((t) => t.status !== 'done');
  const line = (t: Task) => ({
    id: t.id,
    title: t.title || 'Untitled',
    priority: t.priority,
    status: t.status,
    project: projectName(t.projectId),
    due: t.endDate,
    starts: t.startDate,
    subtasks: t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length} done` : undefined,
    tags: t.tags?.length ? t.tags : undefined,
    ageDays: Math.max(0, Math.round((Date.now() - t.createdAt) / 86_400_000)),
  });
  const soon = addDays(today, 7);
  const tasks = {
    open: open.length,
    doneLast30: core.tasks.filter((t) => t.status === 'done' && t.completedAt && Date.now() - t.completedAt < 30 * 86_400_000).length,
    overdue: open.filter((t) => isOverdue(t, today)).sort(compareTasks).slice(0, LIMITS.tasks).map(line),
    inProgress: open.filter((t) => t.status === 'doing').sort(compareTasks).slice(0, LIMITS.tasks).map(line),
    dueThisWeek: open
      .filter((t) => t.endDate && t.endDate >= today && t.endDate <= soon && !isOverdue(t, today))
      .sort(compareTasks)
      .slice(0, LIMITS.tasks)
      .map(line),
    /** Open, undated, untouched for a month: the ones that quietly rot. */
    stale: open
      .filter((t) => !t.startDate && !t.endDate && t.status === 'todo' && Date.now() - t.createdAt > 30 * 86_400_000)
      .slice(0, LIMITS.tasks)
      .map(line),
  };

  const projects = core.projects.slice(0, LIMITS.projects).map((p) => {
    const mine = core.tasks.filter((t) => t.projectId === p.id);
    return {
      id: p.id,
      name: p.name || 'Untitled project',
      status: p.status,
      area: areaName(p.areaId),
      openTasks: mine.filter((t) => t.status !== 'done').length,
      doneTasks: mine.filter((t) => t.status === 'done').length,
      nextTask: mine.filter((t) => t.status !== 'done').sort(compareTasks)[0]?.title ?? null,
      description: p.description ? trim(p.description, 160) : undefined,
    };
  });

  const goalList = goals.goals
    .filter((g) => g.status !== 'released')
    .slice(0, LIMITS.goals)
    .map((g) => {
      const last = latestCheckIn(g);
      return {
        id: g.id,
        title: g.title || 'Untitled goal',
        status: g.status,
        horizon: g.horizon,
        area: areaName(g.areaId),
        why: g.why ? trim(g.why) : undefined,
        vision: g.vision ? trim(g.vision) : undefined,
        tag: g.tag || undefined,
        prompts: g.prompts,
        checkIns: g.checkIns.length,
        daysSinceCheckIn: last ? diffDays(last.date, today) : null,
        lastCheckIn: last
          ? { date: last.date, rating: last.rating, next: last.next || undefined, answers: last.answers.filter((a) => a.text).map((a) => ({ prompt: a.prompt, text: trim(a.text, 200) })) }
          : null,
        milestones: { done: g.milestones.filter((m) => m.doneOn).length, total: g.milestones.length, open: g.milestones.filter((m) => !m.doneOn).map((m) => m.text).slice(0, 8) },
        signals: g.signals.map((s) => {
          const latest = [...s.entries].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
          return { name: s.name, unit: s.unit, better: s.better, target: s.target, latest: latest ? { date: latest.date, value: latest.value } : null };
        }),
        practices: g.habitIds.map((id) => core.habits.find((h) => h.id === id)?.title).filter(Boolean),
        projects: g.projectIds.map((id) => projectName(id)).filter(Boolean),
        recentWins: g.wins.filter((w) => diffDays(w.date, today) <= 30).map((w) => w.text).slice(0, 5),
      };
    });

  const review = reviewStatus(goals, today);

  const entries = [...journal.entries].sort((a, b) => (a.date < b.date ? 1 : -1));
  const recent = entries.slice(0, LIMITS.journal);
  const withMood = entries.filter((e) => e.mood !== null).slice(0, 30);
  const journalSummary = opts.journalLocked
    ? { locked: true as const }
    : {
        entries: journal.entries.length,
        last30MoodAverage: withMood.length ? round(withMood.reduce((s, e) => s + (e.mood ?? 0), 0) / withMood.length, 2) : null,
        recent: recent.map((e) => ({
          date: e.date,
          journal: journal.journals.find((j) => j.id === e.journalId)?.name ?? 'Journal',
          mood: e.mood,
          words: e.text.trim() ? e.text.trim().split(/\s+/).length : 0,
          ...(opts.includeJournalText ? { text: trim(e.text, 1200) } : {}),
        })),
      };

  const healthSummary =
    opts.includeHealth && health
      ? {
          metrics: health.metrics
            .map((m) => {
              const mine = health.measurements.filter((x) => x.metricId === m.id).sort((a, b) => (a.date < b.date ? 1 : -1));
              if (!mine.length) return null;
              const within = (days: number) => mine.filter((x) => diffDays(x.date, today) <= days);
              const mean = (xs: typeof mine) => (xs.length ? round(xs.reduce((s, x) => s + x.value, 0) / xs.length, m.decimals) : null);
              return { name: m.name, unit: m.unit, latest: { date: mine[0].date, value: mine[0].value }, average7: mean(within(7)), average30: mean(within(30)) };
            })
            .filter(Boolean),
          injuries: health.injuries.filter((i) => i.status !== 'healed').map((i) => ({ name: i.name, status: i.status })),
        }
      : undefined;

  return {
    today,
    areas,
    habits,
    tasks,
    projects,
    goals: goalList,
    goalReview: { due: review.due, dueDate: review.dueDate, lastReview: review.last?.date ?? null },
    journal: journalSummary,
    ...(healthSummary ? { health: healthSummary } : {}),
  };
}

export type CoachContext = ReturnType<typeof buildContext>;

/** The snapshot as it is sent, and as it is shown in "what gets sent". */
export const contextText = (context: CoachContext) => JSON.stringify(context, null, 1);
