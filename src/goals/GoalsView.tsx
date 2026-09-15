import { useEffect, useMemo, useRef, useState } from 'react';
import type { ID } from '../types';
import type { GoalHorizon, GoalStatus, LifeGoal, Signal } from './types';
import { HORIZON_LABELS, STATUS_LABELS, suggestTag } from './types';
import { latestCheckIn, momentum, sortedCheckIns, useGoals, useGoalsReady } from './store';
import { CheckInForm, JournalCard, ReviewBanner, useTaggedEntries } from './parts';
import { uid, useStore } from '../store';
import { AreaSelect, AreaTag, CheckButton, Empty, Icon, Progress, Segmented } from '../components/common';
import { DateInput } from '../components/inputs';
import { Sparkline, TrendChart } from '../components/TrendChart';
import { fitLine } from '../health/projection';
import { byId, flowState } from '../lib/tasks';
import { currentStrength, isScheduled, strengthLabel } from '../lib/habits';
import { addDays, fmtDateShort, todayKey } from '../lib/dates';
import { navigate } from '../lib/hooks';

/** Switch between Projects (defined work) and Goals (open-ended aims). */
export function PlanSwitch({ current }: { current: 'projects' | 'goals' }) {
  return (
    <Segmented
      value={current}
      onChange={(v) => navigate(v)}
      options={[
        { value: 'projects', label: <><Icon name="projects" size={14} /> Projects</> },
        { value: 'goals', label: <><Icon name="target" size={14} /> Goals</> },
      ]}
    />
  );
}

export function GoalsView({ id }: { id?: string }) {
  const ready = useGoalsReady();
  if (!ready) return <div className="page"><Empty>Loading goals…</Empty></div>;
  return id ? <GoalDetail id={id} /> : <GoalsList />;
}

type Filter = 'open' | 'paused' | 'closed' | 'all';
const inFilter = (g: LifeGoal, f: Filter) =>
  f === 'all' || (f === 'open' ? g.status === 'exploring' || g.status === 'active' : f === 'paused' ? g.status === 'paused' : g.status === 'achieved' || g.status === 'released');

export const MOMENTUM_TEXT = { rising: '▲ rising', steady: '• steady', slipping: '▼ slipping' } as const;

function GoalsList() {
  const goals = useGoals((s) => s.goals);
  const addGoal = useGoals((s) => s.addGoal);
  const [filter, setFilter] = useState<Filter>('open');
  const shown = goals.filter((g) => inFilter(g, filter));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Goals</h1>
          <p className="page-sub">Open-ended aims you move toward through practice, small wins and honest reflection.</p>
        </div>
        <div className="row tight wrap">
          <PlanSwitch current="goals" />
          <button className="btn primary" onClick={() => navigate(`goals/${addGoal({})}`)}>
            <Icon name="plus" /> New goal
          </button>
        </div>
      </header>
      <ReviewBanner />
      <div className="toolbar">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'In progress' },
            { value: 'paused', label: 'Paused' },
            { value: 'closed', label: 'Achieved & let go' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <section className="card">
          <Empty>
            {goals.length
              ? 'No goals here.'
              : 'No goals yet. Goals are for things that don’t fit a task list, like getting fitter, feeling more confident or building better friendships.'}
          </Empty>
        </section>
      ) : (
        (['season', 'year', 'someday'] as GoalHorizon[]).map((h) => {
          const group = shown.filter((g) => g.horizon === h);
          if (!group.length) return null;
          return (
            <div key={h} className="stack tight">
              <div className="group-label">{HORIZON_LABELS[h]}</div>
              <div className="project-grid">
                {group.map((g) => (
                  <GoalCard key={g.id} goal={g} />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function GoalCard({ goal: g }: { goal: LifeGoal }) {
  const habits = useStore((s) => s.habits);
  const today = todayKey();
  const last = latestCheckIn(g);
  const trend = momentum(g);
  const { entries } = useTaggedEntries(g.tag, addDays(today, -30));
  const ratings = [...g.checkIns].sort((a, b) => (a.date < b.date ? -1 : 1)).map((c) => ({ date: c.date, value: c.rating }));
  const practices = habits.filter((h) => g.habitIds.includes(h.id));
  const avgStrength = practices.length ? practices.reduce((s, h) => s + currentStrength(h, today), 0) / practices.length : null;
  const done = g.milestones.filter((m) => m.doneOn).length;

  return (
    <button className="card project-card goal-card-list" onClick={() => navigate(`goals/${g.id}`)}>
      <div className="project-card-head">
        <h3 className={g.title ? undefined : 'muted'}>{g.title || 'Untitled goal'}</h3>
        <span className={`badge status-${g.status}`}>{STATUS_LABELS[g.status]}</span>
      </div>
      {g.why && <p className="project-card-desc">{g.why}</p>}
      <div className="goal-pulse">
        <div>
          <span className="stat-label">How it's going</span>
          <b className="goal-rating">{last ? `${last.rating}/10` : '–'}</b>
          {trend && <span className={`small trend-${trend}`}>{MOMENTUM_TEXT[trend]}</span>}
        </div>
        {ratings.length >= 2 && <Sparkline points={ratings.slice(-12)} color="var(--series-1)" width={110} height={34} />}
      </div>
      <div className="project-card-foot small">
        {g.milestones.length > 0 && (
          <span>
            <Icon name="check" size={12} />
            <b>
              {done}/{g.milestones.length}
            </b>
            milestones
          </span>
        )}
        {g.wins.length > 0 && (
          <span>
            <b>{g.wins.length}</b> win{g.wins.length === 1 ? '' : 's'}
          </span>
        )}
        {avgStrength !== null && (
          <span>
            <Icon name="habits" size={12} /> {practices.length} practice{practices.length === 1 ? '' : 's'} · {Math.round(avgStrength * 100)}%
          </span>
        )}
        {entries.length > 0 && (
          <span title={`Journal entries tagged #${g.tag} in the last 30 days`}>
            <Icon name="journal" size={12} /> {entries.length}
          </span>
        )}
        <AreaTag areaId={g.areaId} />
      </div>
    </button>
  );
}

/* ───────── Detail ───────── */

function GoalDetail({ id }: { id: ID }) {
  const goal = useGoals((s) => s.goals.find((g) => g.id === id));
  const updateGoal = useGoals((s) => s.updateGoal);
  const deleteGoal = useGoals((s) => s.deleteGoal);
  const today = todayKey();
  const { entries: mentions } = useTaggedEntries(goal?.tag ?? '');

  if (!goal) {
    return (
      <div className="page">
        <Empty>
          That goal no longer exists.{' '}
          <button className="link" onClick={() => navigate('goals')}>
            Back to goals
          </button>
        </Empty>
      </div>
    );
  }

  const patch = (p: Partial<LifeGoal>) => updateGoal(goal.id, p);
  const last = latestCheckIn(goal);
  const trend = momentum(goal);
  const recentWins = goal.wins.filter((w) => w.date >= addDays(today, -30)).length;

  return (
    <div className="page page-wide">
      <button className="link back" onClick={() => navigate('goals')}>
        <Icon name="left" size={14} /> Goals
      </button>
      <header className="goal-head">
        <input
          className="note-title"
          value={goal.title}
          placeholder="Untitled goal"
          aria-label="Goal title"
          autoFocus={!goal.title}
          onChange={(e) => patch({ title: e.target.value })}
          onBlur={() => !goal.tag && goal.title.trim() && patch({ tag: suggestTag(goal.title) })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div className="row tight wrap">
          <select className="input" value={goal.status} aria-label="Status" onChange={(e) => patch({ status: e.target.value as GoalStatus })}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select className="input" value={goal.horizon} aria-label="Horizon" onChange={(e) => patch({ horizon: e.target.value as GoalHorizon })}>
            {Object.entries(HORIZON_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <AreaSelect value={goal.areaId} onChange={(areaId) => patch({ areaId })} />
          <button
            className="btn icon ghost"
            aria-label="Delete goal"
            onClick={() => {
              if (confirm(`Delete “${goal.title || 'Untitled goal'}” with its check-ins, signals and wins?`)) {
                deleteGoal(goal.id);
                navigate('goals');
              }
            }}
          >
            <Icon name="trash" />
          </button>
        </div>
      </header>

      <div className="stat-row">
        <div className="card stat">
          <span className="stat-label">How it's going</span>
          <span className="stat-value">{last ? `${last.rating}/10` : '–'}</span>
          <span className="stat-foot">{trend ? MOMENTUM_TEXT[trend] : last ? `checked in ${fmtDateShort(last.date)}` : 'check in to start a trend'}</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Milestones</span>
          <span className="stat-value">
            {goal.milestones.filter((m) => m.doneOn).length}/{goal.milestones.length}
          </span>
          <span className="stat-foot">reached</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Wins</span>
          <span className="stat-value">{goal.wins.length}</span>
          <span className="stat-foot">{recentWins} in the last 30 days</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Journal entries</span>
          <span className="stat-value">{mentions.length}</span>
          <span className="stat-foot">{goal.tag ? `tagged #${goal.tag}` : 'no tag yet'}</span>
        </div>
      </div>

      {last?.next && (
        <div className="forecast tone-good goal-next">
          <b>Next small step</b>
          <span>{last.next}</span>
        </div>
      )}

      <div className="goal-layout">
        <div className="stack">
          <WhyCard goal={goal} />
          <CheckInsCard goal={goal} />
          <JournalCard key={`${goal.id}:${goal.tag}`} goal={goal} />
          <SignalsCard goal={goal} />
          <NotesCard goal={goal} />
        </div>
        <div className="stack">
          <MilestonesCard goal={goal} />
          <WinsCard goal={goal} />
          <PracticesCard goal={goal} />
          <ProjectsCard goal={goal} />
        </div>
      </div>
    </div>
  );
}

/** Textarea that keeps its own draft and saves on blur, so typing doesn't rewrite the store each keystroke. */
function DraftArea({ value, onSave, placeholder, rows = 3 }: { value: string; onSave: (v: string) => void; placeholder: string; rows?: number }) {
  const [draft, setDraft] = useState(value);
  const shown = useRef(value);
  const draftNow = useRef(draft);
  draftNow.current = draft;
  // Follow changes from other devices unless something unsaved is typed here.
  useEffect(() => {
    if (draftNow.current === shown.current) setDraft(value);
    shown.current = value;
  }, [value]);
  return <textarea className="input" rows={rows} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onSave(draft)} />;
}

function WhyCard({ goal }: { goal: LifeGoal }) {
  const updateGoal = useGoals((s) => s.updateGoal);
  return (
    <section className="card stack">
      <label className="field">
        <span className="field-label">Why it matters</span>
        <DraftArea key={`why-${goal.id}`} value={goal.why} placeholder="What's driving this? What changes if it works?" onSave={(why) => updateGoal(goal.id, { why })} />
      </label>
      <label className="field">
        <span className="field-label">What it looks like when it's working</span>
        <DraftArea
          key={`vision-${goal.id}`}
          value={goal.vision}
          placeholder="Concrete signs: how you'd feel, what you'd be doing, what others would notice."
          onSave={(vision) => updateGoal(goal.id, { vision })}
        />
      </label>
    </section>
  );
}

function CheckInsCard({ goal }: { goal: LifeGoal }) {
  const updateGoal = useGoals((s) => s.updateGoal);
  const [showAll, setShowAll] = useState(false);
  const sorted = sortedCheckIns(goal);
  const points = [...sorted].reverse().map((c) => ({ date: c.date, value: c.rating }));

  return (
    <section className="card stack">
      <header className="card-head">
        <h3 className="card-title">Check-ins</h3>
        <span className="small muted">Usually done in the weekly review</span>
      </header>
      {points.length >= 2 && <TrendChart points={points} color="var(--series-1)" height={170} yMin={0} yMax={10} format={(v) => String(Math.round(v))} />}
      <CheckInForm key={goal.id} goal={goal} />
      {sorted.length > 0 && (
        <ul className="checkin-list">
          {(showAll ? sorted : sorted.slice(0, 4)).map((c) => (
            <li key={c.id}>
              <div className="checkin-list-head">
                <b>{c.rating}/10</b>
                <span className="small muted">{fmtDateShort(c.date)}</span>
                <span className="spacer" />
                <button
                  className="btn icon ghost sm"
                  aria-label="Delete check-in"
                  onClick={() => updateGoal(goal.id, (g) => ({ checkIns: g.checkIns.filter((x) => x.id !== c.id) }))}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
              {c.answers.map((a) => (
                <p key={a.prompt} className="small checkin-answer">
                  <span className="muted">{a.prompt}</span> {a.text}
                </p>
              ))}
              {c.note && <p className="small">{c.note}</p>}
              {c.next && <p className="small muted">Next: {c.next}</p>}
            </li>
          ))}
        </ul>
      )}
      {sorted.length > 4 && (
        <button className="link small" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${sorted.length}`}
        </button>
      )}
    </section>
  );
}

function SignalsCard({ goal }: { goal: LifeGoal }) {
  const updateGoal = useGoals((s) => s.updateGoal);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [better, setBetter] = useState<'up' | 'down'>('up');
  const [target, setTarget] = useState('');

  return (
    <section className="card stack">
      <header className="card-head">
        <div>
          <h3 className="card-title">Signals</h3>
          <p className="small muted">Optional numbers that hint whether things are changing, like pages written per week or a 5K time.</p>
        </div>
        {!adding && (
          <button className="btn sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> Signal
          </button>
        )}
      </header>
      {adding && (
        <form
          className="signal-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const t = Number(target);
            updateGoal(goal.id, (g) => ({
              signals: [...g.signals, { id: uid(), name: name.trim(), unit: unit.trim(), better, target: target.trim() && Number.isFinite(t) ? t : null, entries: [] }],
            }));
            setName('');
            setUnit('');
            setTarget('');
            setAdding(false);
          }}
        >
          <input className="input" autoFocus placeholder="Name, e.g. Pages written" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="Unit, e.g. per week" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <Segmented
            value={better}
            onChange={setBetter}
            options={[
              { value: 'up', label: 'Higher is better' },
              { value: 'down', label: 'Lower is better' },
            ]}
          />
          <input className="input num-wide" inputMode="decimal" placeholder="Target (optional)" value={target} onChange={(e) => setTarget(e.target.value)} />
          <div className="row tight">
            <button className="btn primary sm" type="submit">
              Add signal
            </button>
            <button className="btn ghost sm" type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {goal.signals.length === 0 && !adding && <Empty>No signals. Plenty of goals are better judged by reflection than by numbers.</Empty>}
      {goal.signals.map((s) => (
        <SignalBlock key={s.id} goal={goal} signal={s} />
      ))}
    </section>
  );
}

export function signalTrend(s: Signal) {
  const points = [...s.entries].sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => ({ date: e.date, value: e.value }));
  const fit = points.length >= 3 ? fitLine(points.slice(-8)) : null;
  const weekly = fit ? fit.slope * 7 : null;
  const improving = weekly !== null && Math.abs(weekly) > 0.01 ? weekly > 0 === (s.better === 'up') : null;
  return { points, improving, latest: points[points.length - 1] };
}

export function SignalLogForm({ goal, signal: s, compact }: { goal: LifeGoal; signal: Signal; compact?: boolean }) {
  const updateGoal = useGoals((st) => st.updateGoal);
  const today = todayKey();
  const [date, setDate] = useState(today);
  const [value, setValue] = useState('');
  return (
    <form
      className="row tight wrap"
      onSubmit={(e) => {
        e.preventDefault();
        const v = Number(value);
        if (value.trim() === '' || !Number.isFinite(v)) return;
        updateGoal(goal.id, (g) => ({
          signals: g.signals.map((x) => (x.id === s.id ? { ...x, entries: [...x.entries.filter((en) => en.date !== date), { id: uid(), date, value: v, note: '' }] } : x)),
        }));
        setValue('');
      }}
    >
      {!compact && <DateInput value={date} onChange={(d) => setDate(d ?? today)} />}
      <input className="input num-wide" inputMode="decimal" placeholder={`Value${s.unit ? ` (${s.unit})` : ''}`} value={value} onChange={(e) => setValue(e.target.value)} />
      <button className="btn sm" type="submit">
        Log
      </button>
    </form>
  );
}

function SignalBlock({ goal, signal: s }: { goal: LifeGoal; signal: Signal }) {
  const updateGoal = useGoals((st) => st.updateGoal);
  const { points, improving, latest } = useMemo(() => signalTrend(s), [s]);

  return (
    <div className="signal-block">
      <div className="signal-head">
        <b>{s.name}</b>
        {s.unit && <span className="small muted">{s.unit}</span>}
        {latest && (
          <span className="small">
            latest <b>{latest.value}</b>
            {s.target !== null && <span className="muted"> · target {s.target}</span>}
          </span>
        )}
        {improving !== null && <span className={`small tone ${improving ? 'tone-good' : 'tone-warn'}`}>{improving ? 'improving' : 'heading the wrong way'}</span>}
        <span className="spacer" />
        <button
          className="btn icon ghost sm"
          aria-label={`Delete ${s.name}`}
          onClick={() => confirm(`Delete the “${s.name}” signal and its values?`) && updateGoal(goal.id, (g) => ({ signals: g.signals.filter((x) => x.id !== s.id) }))}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
      {points.length > 0 && <TrendChart points={points} color="var(--series-3)" height={150} target={s.target} targetLabel="Target" format={(v) => String(Math.round(v * 10) / 10)} />}
      <SignalLogForm goal={goal} signal={s} />
    </div>
  );
}

function NotesCard({ goal }: { goal: LifeGoal }) {
  const updateGoal = useGoals((s) => s.updateGoal);
  return (
    <section className="card stack">
      <h3 className="card-title">Notes</h3>
      <DraftArea key={`notes-${goal.id}`} rows={5} value={goal.notes} placeholder="Ideas, resources, advice, what you've learned…" onSave={(notes) => updateGoal(goal.id, { notes })} />
    </section>
  );
}

function MilestonesCard({ goal }: { goal: LifeGoal }) {
  const updateGoal = useGoals((s) => s.updateGoal);
  const [text, setText] = useState('');
  const today = todayKey();
  const sorted = [...goal.milestones].sort((a, b) => (a.doneOn ? 1 : 0) - (b.doneOn ? 1 : 0));
  return (
    <section className="card stack">
      <header className="card-head">
        <h3 className="card-title">Milestones</h3>
        <span className="small muted">In any order</span>
      </header>
      {sorted.map((m) => (
        <div key={m.id} className={`milestone${m.doneOn ? ' is-done' : ''}`}>
          <CheckButton
            checked={!!m.doneOn}
            onToggle={() => updateGoal(goal.id, (g) => ({ milestones: g.milestones.map((x) => (x.id === m.id ? { ...x, doneOn: x.doneOn ? null : today } : x)) }))}
          />
          <span className="milestone-text">{m.text}</span>
          {m.doneOn && <span className="small muted">{fmtDateShort(m.doneOn)}</span>}
          <button className="btn icon ghost sm" aria-label="Remove milestone" onClick={() => updateGoal(goal.id, (g) => ({ milestones: g.milestones.filter((x) => x.id !== m.id) }))}>
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
      <form
        className="quick-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          updateGoal(goal.id, (g) => ({ milestones: [...g.milestones, { id: uid(), text: text.trim(), doneOn: null }] }));
          setText('');
        }}
      >
        <Icon name="plus" size={14} />
        <input className="input bare" placeholder="Add a milestone and press Enter" value={text} onChange={(e) => setText(e.target.value)} />
      </form>
    </section>
  );
}

export function WinQuickAdd({ goal }: { goal: LifeGoal }) {
  const updateGoal = useGoals((s) => s.updateGoal);
  const [text, setText] = useState('');
  return (
    <form
      className="quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        updateGoal(goal.id, (g) => ({ wins: [...g.wins, { id: uid(), date: todayKey(), text: text.trim() }] }));
        setText('');
      }}
    >
      <Icon name="plus" size={14} />
      <input className="input bare" placeholder="Log a win and press Enter" value={text} onChange={(e) => setText(e.target.value)} />
    </form>
  );
}

function WinsCard({ goal }: { goal: LifeGoal }) {
  const updateGoal = useGoals((s) => s.updateGoal);
  const wins = [...goal.wins].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <section className="card stack">
      <header className="card-head">
        <h3 className="card-title">Small wins</h3>
        <span className="small muted">Evidence it's working</span>
      </header>
      <WinQuickAdd goal={goal} />
      {wins.length === 0 ? (
        <Empty>Nothing logged yet. Small counts.</Empty>
      ) : (
        <ul className="wins">
          {wins.slice(0, 12).map((w) => (
            <li key={w.id}>
              <span className="small muted">{fmtDateShort(w.date)}</span>
              <span className="wins-text">{w.text}</span>
              <button className="btn icon ghost sm" aria-label="Remove win" onClick={() => updateGoal(goal.id, (g) => ({ wins: g.wins.filter((x) => x.id !== w.id) }))}>
                <Icon name="x" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PracticesCard({ goal }: { goal: LifeGoal }) {
  const updateGoal = useGoals((s) => s.updateGoal);
  const habits = useStore((s) => s.habits);
  const toggle = useStore((s) => s.toggleHabit);
  const addHabit = useStore((s) => s.addHabit);
  const [newTitle, setNewTitle] = useState('');
  const today = todayKey();
  const linked = habits.filter((h) => goal.habitIds.includes(h.id));
  const candidates = habits.filter((h) => !h.archived && !goal.habitIds.includes(h.id));
  return (
    <section className="card stack">
      <header className="card-head">
        <h3 className="card-title">Practices</h3>
        <span className="small muted">Habits that move this forward</span>
      </header>
      {linked.map((h) => {
        const s = currentStrength(h, today);
        return (
          <div key={h.id} className="habit-strength-row">
            {isScheduled(h, today) ? <CheckButton checked={!!h.log[today]?.done} onToggle={() => toggle(h.id, today)} title="Done today" /> : <span className="check-placeholder" />}
            <button className="link-plain" onClick={() => navigate(`habits/${h.id}`)}>
              {h.title}
            </button>
            <Progress value={s} label="Habit strength" />
            <span className="small muted nowrap">
              {Math.round(s * 100)}% {strengthLabel(s).toLowerCase()}
            </span>
            <button className="btn icon ghost sm" aria-label={`Unlink ${h.title}`} onClick={() => updateGoal(goal.id, (g) => ({ habitIds: g.habitIds.filter((x) => x !== h.id) }))}>
              <Icon name="x" size={13} />
            </button>
          </div>
        );
      })}
      {candidates.length > 0 && (
        <select className="input sm" value="" onChange={(e) => e.target.value && updateGoal(goal.id, (g) => ({ habitIds: [...g.habitIds, e.target.value] }))}>
          <option value="">+ Link an existing habit…</option>
          {candidates.map((h) => (
            <option key={h.id} value={h.id}>
              {h.title}
            </option>
          ))}
        </select>
      )}
      <form
        className="quick-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newTitle.trim()) return;
          const habitId = addHabit({ title: newTitle.trim(), areaId: goal.areaId });
          updateGoal(goal.id, (g) => ({ habitIds: [...g.habitIds, habitId] }));
          setNewTitle('');
        }}
      >
        <Icon name="plus" size={14} />
        <input className="input bare" placeholder="New daily habit for this goal" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
      </form>
    </section>
  );
}

function ProjectsCard({ goal }: { goal: LifeGoal }) {
  const updateGoal = useGoals((s) => s.updateGoal);
  const projects = useStore((s) => s.projects);
  const tasks = useStore((s) => s.tasks);
  const map = useMemo(() => byId(tasks), [tasks]);
  const linked = projects.filter((p) => goal.projectIds.includes(p.id));
  const candidates = projects.filter((p) => !goal.projectIds.includes(p.id));
  return (
    <section className="card stack">
      <header className="card-head">
        <h3 className="card-title">Projects</h3>
        <span className="small muted">Concrete work toward this</span>
      </header>
      {linked.map((p) => {
        const own = tasks.filter((t) => t.projectId === p.id);
        const done = own.filter((t) => flowState(t, map) === 'done').length;
        return (
          <div key={p.id} className="habit-strength-row">
            <Icon name="projects" size={14} />
            <button className="link-plain" onClick={() => navigate(`projects/${p.id}`)}>
              {p.name}
            </button>
            <Progress value={own.length ? done / own.length : 0} label="Project progress" />
            <span className="small muted nowrap">
              {done}/{own.length} tasks
            </span>
            <button className="btn icon ghost sm" aria-label={`Unlink ${p.name}`} onClick={() => updateGoal(goal.id, (g) => ({ projectIds: g.projectIds.filter((x) => x !== p.id) }))}>
              <Icon name="x" size={13} />
            </button>
          </div>
        );
      })}
      {candidates.length > 0 && (
        <select className="input sm" value="" onChange={(e) => e.target.value && updateGoal(goal.id, (g) => ({ projectIds: [...g.projectIds, e.target.value] }))}>
          <option value="">+ Link a project…</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {!linked.length && !candidates.length && <Empty>No projects yet.</Empty>}
    </section>
  );
}
