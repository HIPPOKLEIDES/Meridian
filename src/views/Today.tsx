import { useMemo, useState } from 'react';
import type { DateKey, Habit } from '../types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { DayClock } from '../components/DayClock';
import { AreaDot, CheckButton, Empty, Icon } from '../components/common';
import { DateNav, QuickAddTask, TaskRow, TimerCard } from '../components/widgets';
import { fmtClock, fmtDateLong, fmtDateShort, fmtDuration, nowMinutes, todayKey } from '../lib/dates';
import { isScheduled, streakStats } from '../lib/habits';
import { planForDate } from '../lib/plan';
import { byId, compareTasks, isActiveOn, isOverdue } from '../lib/tasks';
import { navigate } from '../lib/hooks';
import { loadAllSamples } from '../lib/backup';
import { DEFAULT_JOURNAL_ID, useJournal, useJournalReady, wordCount } from '../journal/store';
import { useJournalLock } from '../journal/vault';
import { MOODS, moodColor } from '../journal/types';
import { latestCheckIn, reviewStatus, useGoals } from '../goals/store';
import { isOpenGoal } from '../goals/types';
import { useTasksForMe } from '../cloud/ui/Assignees';
import { DEFAULT_TIMEFRAME_MINUTES, hasTimeframeOn, nextTimeframe, suggestedStart } from '../lib/timeframes';
import { beginTaskDrag } from '../lib/taskDrag';

export function TodayView({ date }: { date: DateKey }) {
  const today = todayKey();
  const isToday = date === today;
  const empty = useStore((s) => !s.tasks.length && !s.habits.length && !s.blocks.length && !s.entries.length);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{isToday ? 'Today' : date < today ? 'Past day' : 'Upcoming day'}</h1>
          <p className="page-sub">{fmtDateLong(date)}</p>
        </div>
        <DateNav date={date} onChange={(d) => navigate(d === today ? 'today' : `today/${d}`)} />
      </header>

      {empty && (
        <div className="banner">
          <div>
            <b>Welcome to Meridian.</b> Start adding habits, tasks and time blocks, or load some sample data to look around first.
          </div>
          <button className="btn primary" onClick={() => loadAllSamples()}>
            Load sample data
          </button>
        </div>
      )}

      <div className="today-grid">
        <div className="today-left">
          <section className="card clock-card">
            <DayClock date={date} />
            <PlanTray date={date} />
          </section>
          <AgendaCard date={date} />
        </div>
        <div className="today-right">
          {isToday && <TimerCard />}
          <HabitsCard date={date} />
          <TasksCard date={date} />
          {date <= today && <JournalCard date={date} />}
          <NextStepsCard />
          <LoggedCard date={date} />
        </div>
      </div>
    </div>
  );
}

function AgendaCard({ date }: { date: DateKey }) {
  const blocks = useStore((s) => s.blocks);
  const habits = useStore((s) => s.habits);
  const open = useUI((s) => s.open);
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const plan = useMemo(() => planForDate({ blocks, habits, tasks, projects }, date), [blocks, habits, tasks, projects, date]);
  return (
    <section className="card">
      <header className="card-head">
        <h3 className="card-title">Planned</h3>
        <button className="btn sm" onClick={() => open({ kind: 'block', id: null, draft: { date } })}>
          <Icon name="plus" size={14} /> Block out time
        </button>
      </header>
      {plan.length === 0 ? (
        <Empty>Nothing planned yet. Drag around the outer ring of the clock to block out time.</Empty>
      ) : (
        <ul className="agenda">
          {plan.map((p) => (
            <li key={p.key}>
              <button
                className={`agenda-item${p.kind === 'habit' && p.done ? ' is-done' : ''}`}
                onClick={() =>
                  p.kind === 'block' ? open({ kind: 'block', id: p.id, on: date }) : open({ kind: 'habit', id: p.id })
                }
              >
                <span className="agenda-time">
                  {fmtClock(p.start)}–{fmtClock(p.end)}
                </span>
                <AreaDot areaId={p.areaId} />
                <span className="agenda-title">{p.title}</span>
                <span className="agenda-kind">
                  {p.kind === 'habit' ? (p.done ? 'habit · done' : 'habit') : p.repeating ? 'repeats' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HabitsCard({ date }: { date: DateKey }) {
  const habits = useStore((s) => s.habits);
  const open = useUI((s) => s.open);
  const due = habits
    .filter((h) => !h.archived && isScheduled(h, date))
    .sort((a, b) => (a.start ?? 2000) - (b.start ?? 2000));
  const doneCount = due.filter((h) => h.log[date]?.done).length;
  return (
    <section className="card">
      <header className="card-head">
        <h3 className="card-title">
          Habits {due.length > 0 && <span className="muted">· {doneCount}/{due.length}</span>}
        </h3>
        <button className="btn sm" onClick={() => open({ kind: 'habit', id: null })}>
          <Icon name="plus" size={14} /> Habit
        </button>
      </header>
      {due.length === 0 ? (
        <Empty>No habits scheduled for this day.</Empty>
      ) : (
        <div className="habit-list">
          {due.map((h) => (
            <HabitDueRow key={h.id} habit={h} date={date} />
          ))}
        </div>
      )}
    </section>
  );
}

function HabitDueRow({ habit, date }: { habit: Habit; date: DateKey }) {
  const toggle = useStore((s) => s.toggleHabit);
  const toggleStep = useStore((s) => s.toggleHabitStep);
  const [expanded, setExpanded] = useState(false);
  const day = habit.log[date];
  const done = !!day?.done;
  const streak = streakStats(habit, todayKey()).current;
  const future = date > todayKey();
  return (
    <div className={`habit-row${done ? ' is-done' : ''}`}>
      <div className="habit-row-main">
        <CheckButton checked={done} disabled={future} title={future ? 'Can’t complete a future day' : undefined} onToggle={() => toggle(habit.id, date)} />
        <button className="habit-row-text" onClick={() => navigate(`habits/${habit.id}`)}>
          <span className="habit-row-title">{habit.title}</span>
          <span className="habit-row-meta">
            <AreaDot areaId={habit.areaId} />
            {habit.start === null ? 'Any time' : fmtClock(habit.start)} · {fmtDuration(habit.duration)}
          </span>
        </button>
        {streak > 1 && (
          <span className="streak" title={`${streak} in a row`}>
            <Icon name="flame" size={13} />
            {streak}
          </span>
        )}
        {habit.steps.length > 0 && (
          <button
            type="button"
            className={`subtask-count${expanded ? ' is-open' : ''}`}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {day?.steps.filter((id) => habit.steps.some((s) => s.id === id)).length ?? 0}/{habit.steps.length}
            <Icon name="down" size={12} />
          </button>
        )}
      </div>
      {expanded && (
        <div className="task-row-subtasks">
          {habit.steps.map((st) => {
            const checked = !!day?.steps.includes(st.id);
            return (
              <label key={st.id} className={`subtask${checked ? ' is-done' : ''}`}>
                <CheckButton size="sm" checked={checked} disabled={future} onToggle={() => toggleStep(habit.id, date, st.id)} />
                <span>{st.text}</span>
                {st.start !== null && st.start !== undefined && <span className="subtask-when-chip">{fmtClock(st.start)}</span>}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TasksCard({ date }: { date: DateKey }) {
  const allTasks = useStore((s) => s.tasks);
  const map = useMemo(() => byId(allTasks), [allTasks]);
  const tasks = useTasksForMe(allTasks);
  const isToday = date === todayKey();
  const overdue = isToday ? tasks.filter((t) => isOverdue(t, date)).sort(compareTasks) : [];
  const blocks = useStore((s) => s.blocks);
  const active = tasks.filter((t) => isActiveOn(t, date) || (t.status !== 'done' && hasTimeframeOn(t.id, blocks, date))).sort(compareTasks);
  const inProgress = isToday
    ? tasks.filter((t) => t.status === 'doing' && !isActiveOn(t, date) && !isOverdue(t, date)).sort(compareTasks)
    : [];
  const groups = [
    { label: 'Overdue', items: overdue },
    { label: 'Scheduled', items: active },
    { label: 'Also in progress', items: inProgress },
  ].filter((g) => g.items.length);

  return (
    <section className="card">
      <header className="card-head">
        <h3 className="card-title">Tasks</h3>
        <button className="btn sm ghost" onClick={() => navigate('tasks')}>
          All tasks <Icon name="right" size={14} />
        </button>
      </header>
      <QuickAddTask defaults={{ startDate: date, endDate: date }} placeholder="Add a task for this day" />
      {groups.length === 0 ? (
        <Empty>No tasks on this day.</Empty>
      ) : (
        groups.map((g) => (
          <div key={g.label} className="task-group">
            {groups.length > 1 && <div className="group-label">{g.label}</div>}
            {g.items.map((t) => (
              <TaskRow key={t.id} task={t} tasks={map} draggable date={date} />
            ))}
          </div>
        ))
      )}
    </section>
  );
}

function LoggedCard({ date }: { date: DateKey }) {
  const entries = useStore((s) => s.entries);
  const areas = useStore((s) => s.areas);
  const open = useUI((s) => s.open);
  const day = entries.filter((e) => e.date === date).sort((a, b) => a.start - b.start);
  const total = day.reduce((s, e) => s + e.end - e.start, 0);
  const rows = [...areas, { id: null, name: 'No area', slot: 0 }]
    .map((a) => ({ a, min: day.filter((e) => e.areaId === a.id).reduce((s, e) => s + e.end - e.start, 0) }))
    .filter((r) => r.min > 0);
  const fill = (slot: number) => (slot ? `var(--series-${slot})` : 'var(--unassigned)');

  return (
    <section className="card">
      <header className="card-head">
        <h3 className="card-title">
          Time logged {total > 0 && <span className="muted">· {fmtDuration(total)}</span>}
        </h3>
        <button className="btn sm" onClick={() => open({ kind: 'entry', id: null, draft: { date } })}>
          <Icon name="plus" size={14} /> Log time
        </button>
      </header>
      {day.length === 0 ? (
        <Empty>Nothing logged yet. Use the timer, check off habits, or drag around the clock's inner ring.</Empty>
      ) : (
        <>
          <div className="share-bar" role="img" aria-label="Share of logged time by area">
            {rows.map((r) => (
              <span key={r.a.id ?? 'none'} style={{ flexGrow: r.min, background: fill(r.a.slot) }} title={`${r.a.name}: ${fmtDuration(r.min)}`} />
            ))}
          </div>
          <div className="legend-list">
            {rows.map((r) => (
              <span key={r.a.id ?? 'none'} className="legend-item">
                <span className="dot" style={{ background: fill(r.a.slot) }} />
                {r.a.name} <b>{fmtDuration(r.min)}</b>
              </span>
            ))}
          </div>
          <ul className="entry-list">
            {day.map((e) => (
              <li key={e.id}>
                <button className="agenda-item" onClick={() => open({ kind: 'entry', id: e.id })}>
                  <span className="agenda-time">
                    {fmtClock(e.start)}–{fmtClock(e.end)}
                  </span>
                  <AreaDot areaId={e.areaId} />
                  <span className="agenda-title">{e.label || 'Untitled'}</span>
                  <span className="agenda-kind">{fmtDuration(e.end - e.start)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function JournalCard({ date }: { date: DateKey }) {
  const entry = useJournal((s) => s.entries.find((e) => e.journalId === DEFAULT_JOURNAL_ID && e.date === date));
  const ready = useJournalReady();
  const locked = useJournalLock((s) => s.status === 'locked');
  const path = `journal/${DEFAULT_JOURNAL_ID}${date === todayKey() ? '' : `/${date}`}`;
  const words = entry ? wordCount(entry.text) : 0;
  const firstLine = entry?.text.trim().split('\n').find((l) => l.trim());
  return (
    <section className="card">
      <header className="card-head">
        <h3 className="card-title">
          Journal {words > 0 && <span className="muted">· {words} words</span>}
        </h3>
        <button className="btn sm" onClick={() => navigate(path)}>
          <Icon name={locked ? 'lock' : 'journal'} size={14} /> {locked ? 'Unlock' : words ? 'Keep writing' : 'Write'}
        </button>
      </header>
      {locked ? (
        <Empty>The journal is locked.</Empty>
      ) : !ready ? null : entry && (firstLine || entry.mood) ? (
        <button className="entry-preview" onClick={() => navigate(path)}>
          {entry.mood && (
            <span className="entry-preview-head small muted">
              <span className="dot" style={{ background: moodColor(entry.mood) }} /> {MOODS[entry.mood - 1].label}
            </span>
          )}
          {firstLine && <span className="entry-preview-text">{firstLine}</span>}
        </button>
      ) : (
        <Empty>Nothing written for this day yet.</Empty>
      )}
    </section>
  );
}

/** The "next small step" from each active goal's latest check-in, plus the weekly review when it's due. */
function NextStepsCard() {
  const goals = useGoals((s) => s.goals);
  const reviews = useGoals((s) => s.reviews);
  const reviewDay = useGoals((s) => s.reviewDay);
  const steps = goals
    .filter((g) => g.status === 'active')
    .map((g) => ({ g, next: latestCheckIn(g)?.next }))
    .filter((x): x is { g: (typeof goals)[number]; next: string } => !!x.next);
  const review = reviewStatus({ reviews, reviewDay }, todayKey());
  const showReview = (review.due || review.early) && goals.some(isOpenGoal);
  if (!steps.length && !showReview) return null;
  return (
    <section className="card">
      <header className="card-head">
        <h3 className="card-title">Goal next steps</h3>
        <button className={`btn sm${showReview ? ' primary' : ' ghost'}`} onClick={() => navigate(showReview ? 'goals/review' : 'goals')}>
          {showReview ? (review.due ? 'Weekly review due' : 'Weekly review') : 'All goals'}
        </button>
      </header>
      <ul className="next-steps">
        {steps.map(({ g, next }) => (
          <li key={g.id}>
            <span>{next}</span>
            <button className="link-plain small muted" onClick={() => navigate(`goals/${g.id}`)}>
              {g.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Open tasks to drag onto the clock (or schedule with a tap), right under it. */
function PlanTray({ date }: { date: DateKey }) {
  const allTasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const blocks = useStore((s) => s.blocks);
  const open = useUI((s) => s.open);
  const mine = useTasksForMe(allTasks);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const today = todayKey();
  const nowMin = nowMinutes(new Date());
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  const q = query.trim().toLowerCase();
  // Tasks meant for this day come first, then the rest by priority.
  const relevance = (t: (typeof mine)[number]) => (isActiveOn(t, date) || isOverdue(t, date) || t.status === 'doing' ? 0 : 1);
  const candidates = mine
    .filter((t) => t.status !== 'done' && (!q || t.title.toLowerCase().includes(q)))
    .sort((a, b) => relevance(a) - relevance(b) || compareTasks(a, b));
  const shown = expanded || q ? candidates.slice(0, 40) : candidates.slice(0, 5);

  if (!mine.some((t) => t.status !== 'done')) return null;

  return (
    <div className="plan-tray">
      <div className="plan-tray-head">
        <span className="small">
          <b>Plan tasks</b> <span className="muted">· drag onto the clock{date === today ? '' : ` for ${fmtDateLong(date)}`}</span>
        </span>
        <input className="input sm plan-tray-search" placeholder="Find a task…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a task to plan" />
      </div>
      {shown.length === 0 ? (
        <p className="small muted">No open tasks match.</p>
      ) : (
        <ul className="plan-tray-list">
          {shown.map((t) => {
            const next = nextTimeframe(t.id, blocks, today, nowMin);
            const start = suggestedStart(date, today, nowMin);
            return (
              <li key={t.id} className="plan-tray-item">
                <button
                  type="button"
                  className="drag-handle"
                  aria-label={`Drag “${t.title || 'Untitled task'}” onto the clock`}
                  onPointerDown={(e) => beginTaskDrag(e, { id: t.id, title: t.title || 'Untitled task' })}
                >
                  <Icon name="grip" size={14} />
                </button>
                <button type="button" className="plan-tray-title" onClick={() => open({ kind: 'task', id: t.id })}>
                  <span className="plan-tray-name">{t.title || 'Untitled task'}</span>
                  <span className="small muted">
                    {[t.projectId ? projectName.get(t.projectId) : null, next ? `next ${next.date === today ? 'today' : fmtDateShort(next.date)} ${fmtClock(next.start)}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn sm ghost"
                  title="Choose a time without dragging"
                  onClick={() =>
                    open({
                      kind: 'block',
                      id: null,
                      draft: { title: t.title, taskId: t.id, date, start, end: Math.min(1440, start + DEFAULT_TIMEFRAME_MINUTES) },
                    })
                  }
                >
                  <Icon name="plus" size={13} /> Plan
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!q && candidates.length > 5 && (
        <button className="link small" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show all ${candidates.length} open tasks`}
        </button>
      )}
    </div>
  );
}
