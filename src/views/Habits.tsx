import type { Habit } from '../types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { AreaTag, CheckButton, Empty, Icon, Progress, areaColor } from '../components/common';
import { CompletionGrid, StrengthChart } from '../components/charts';
import { fmtClock, fmtDays, fmtDuration, todayKey } from '../lib/dates';
import { currentStrength, HALF_LIFE, isScheduled, strengthLabel, streakStats } from '../lib/habits';
import { navigate } from '../lib/hooks';

export function HabitsView({ selectedId }: { selectedId?: string }) {
  const habits = useStore((s) => s.habits);
  const open = useUI((s) => s.open);
  const today = todayKey();
  const active = habits.filter((h) => !h.archived).sort((a, b) => (a.start ?? 2000) - (b.start ?? 2000));
  const archived = habits.filter((h) => h.archived);
  const selected = habits.find((h) => h.id === selectedId) ?? active[0];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Habits</h1>
          <p className="page-sub">Repeat them on schedule and watch them become automatic.</p>
        </div>
        <button className="btn primary" onClick={() => open({ kind: 'habit', id: null })}>
          <Icon name="plus" /> New habit
        </button>
      </header>

      {habits.length === 0 ? (
        <section className="card">
          <Empty>No habits yet. Create one, give it a schedule and a time of day, and it will show up on your clock.</Empty>
        </section>
      ) : (
        <div className="split">
          <div className="split-list">
            {active.map((h) => (
              <HabitListItem key={h.id} habit={h} selected={selected?.id === h.id} today={today} />
            ))}
            {archived.length > 0 && (
              <>
                <div className="group-label">Archived</div>
                {archived.map((h) => (
                  <HabitListItem key={h.id} habit={h} selected={selected?.id === h.id} today={today} />
                ))}
              </>
            )}
          </div>
          {selected && <HabitDetail habit={selected} today={today} />}
        </div>
      )}
    </div>
  );
}

function HabitListItem({ habit, selected, today }: { habit: Habit; selected: boolean; today: string }) {
  const toggle = useStore((s) => s.toggleHabit);
  const area = useStore((s) => s.areas.find((a) => a.id === habit.areaId));
  const strength = currentStrength(habit, today);
  const due = isScheduled(habit, today);
  return (
    <div
      className={`habit-card${selected ? ' is-selected' : ''}${habit.archived ? ' is-archived' : ''}`}
      onClick={() => navigate(`habits/${habit.id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`habits/${habit.id}`)}
    >
      <div className="habit-card-top">
        {due && !habit.archived ? (
          <CheckButton checked={!!habit.log[today]?.done} onToggle={() => toggle(habit.id, today)} title="Done today" />
        ) : (
          <span className="check-placeholder" title="Not scheduled today" />
        )}
        <div className="habit-card-text">
          <div className="habit-row-title">{habit.title}</div>
          <div className="habit-row-meta">
            {fmtDays(habit.days)} · {habit.start === null ? 'any time' : fmtClock(habit.start)}
          </div>
        </div>
        <span className="streak" title="Current streak">
          <Icon name="flame" size={13} />
          {streakStats(habit, today).current}
        </span>
      </div>
      <div className="habit-card-strength">
        <span className="meter" style={{ ['--meter-color' as string]: areaColor(area) }}>
          <Progress value={strength} label="Habit strength" />
        </span>
        <span className="small muted">
          {Math.round(strength * 100)}% · {strengthLabel(strength)}
        </span>
      </div>
    </div>
  );
}

function HabitDetail({ habit, today }: { habit: Habit; today: string }) {
  const open = useUI((s) => s.open);
  const area = useStore((s) => s.areas.find((a) => a.id === habit.areaId));
  const stats = streakStats(habit, today);
  const strength = currentStrength(habit, today);
  const color = areaColor(area);
  const totalDone = Object.values(habit.log).filter((d) => d.done).length;

  return (
    <section className="card detail">
      <header className="card-head">
        <div>
          <h2 className="detail-title">{habit.title}</h2>
          <div className="detail-meta">
            {fmtDays(habit.days)} · {habit.start === null ? 'Any time' : fmtClock(habit.start)}
            {habit.duration > 0 && ` · ${fmtDuration(habit.duration)}`}
            <AreaTag areaId={habit.areaId} />
          </div>
        </div>
        <button className="btn" onClick={() => open({ kind: 'habit', id: habit.id })}>
          <Icon name="edit" /> Edit
        </button>
      </header>
      {habit.notes && <p className="notes">{habit.notes}</p>}

      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Strength</span>
          <span className="stat-value">{Math.round(strength * 100)}%</span>
          <span className="stat-foot">{strengthLabel(strength)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Current streak</span>
          <span className="stat-value">{stats.current}</span>
          <span className="stat-foot">best {stats.best}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Last 30 scheduled</span>
          <span className="stat-value">{Math.round(stats.rate30 * 100)}%</span>
          <span className="stat-foot">completed</span>
        </div>
        <div className="stat">
          <span className="stat-label">All-time</span>
          <span className="stat-value">{totalDone}</span>
          <span className="stat-foot">completions</span>
        </div>
      </div>

      <div className="detail-section">
        <h3 className="section-title">How engrained it is</h3>
        <StrengthChart habit={habit} today={today} color={color} />
        <p className="small muted">
          Each scheduled day pulls strength toward 100% when done and toward 0% when missed. {HALF_LIFE} completions in a row reach
          50%; about 66 (the typical time for a habit to become automatic) reach 95%+. One miss only dents it.
        </p>
      </div>

      <div className="detail-section">
        <h3 className="section-title">History</h3>
        <CompletionGrid habit={habit} today={today} color={color} />
        <p className="small muted">Click a past day to mark it done or undone.</p>
      </div>

      {habit.steps.length > 0 && (
        <div className="detail-section">
          <h3 className="section-title">Steps</h3>
          <ol className="steps">
            {habit.steps.map((s) => (
              <li key={s.id}>{s.text}</li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
