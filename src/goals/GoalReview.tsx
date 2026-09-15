import { useMemo, useState } from 'react';
import type { ID } from '../types';
import type { GoalStatus, LifeGoal } from './types';
import { HORIZON_LABELS, isOpenGoal, STATUS_LABELS } from './types';
import { latestCheckIn, momentum, reviewStatus, useGoals, useGoalsReady } from './store';
import { CheckInForm, MentionList, useTaggedEntries } from './parts';
import { MOMENTUM_TEXT, SignalLogForm, signalTrend, WinQuickAdd } from './GoalsView';
import { Empty, Icon, Progress } from '../components/common';
import { addDays, fmtDateShort, todayKey, WEEKDAY_SHORT } from '../lib/dates';
import { navigate } from '../lib/hooks';
import { sound } from '../lib/sound';

const HORIZON_ORDER = { season: 0, year: 1, someday: 2 } as const;

/** A guided pass through every open goal: look back, reflect, pick the next step. */
export function GoalReview() {
  const ready = useGoalsReady();
  const goals = useGoals((s) => s.goals);
  const reviews = useGoals((s) => s.reviews);
  const reviewDay = useGoals((s) => s.reviewDay);
  const setReviewDay = useGoals((s) => s.setReviewDay);
  const completeReview = useGoals((s) => s.completeReview);
  const today = todayKey();
  // The goal list is fixed when the review starts, so changing a status mid-review doesn't reshuffle steps.
  const [queue, setQueue] = useState<ID[] | null>(null);
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState<ID[]>([]);
  const open = useMemo(() => goals.filter(isOpenGoal).sort((a, b) => HORIZON_ORDER[a.horizon] - HORIZON_ORDER[b.horizon]), [goals]);
  const [picked, setPicked] = useState<Set<ID> | null>(null);
  const selected = picked ?? new Set(open.map((g) => g.id));

  if (!ready) return <div className="page"><Empty>Loading goals…</Empty></div>;

  const status = reviewStatus({ reviews, reviewDay }, today);
  const since = status.last?.date ?? addDays(today, -7);

  if (!queue) {
    return (
      <div className="page review-page">
        <button className="link back" onClick={() => navigate('goals')}>
          <Icon name="left" size={14} /> Goals
        </button>
        <header className="page-head">
          <div>
            <h1>Weekly review</h1>
            <p className="page-sub">
              {status.last ? `Last review ${fmtDateShort(status.last.date)}. ` : ''}For each goal: look back at the week, answer its prompts, and pick one small next step.
            </p>
          </div>
        </header>
        <section className="card stack">
          <h3 className="card-title">Goals to review</h3>
          {open.length === 0 ? (
            <Empty>No active or exploring goals.</Empty>
          ) : (
            <ul className="review-pick">
              {open.map((g) => (
                <li key={g.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(g.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(g.id);
                        else next.delete(g.id);
                        setPicked(next);
                      }}
                    />
                    <span>{g.title || 'Untitled goal'}</span>
                    <span className="small muted">
                      {HORIZON_LABELS[g.horizon]}
                      {latestCheckIn(g) ? ` · last check-in ${fmtDateShort(latestCheckIn(g)!.date)}` : ' · never checked in'}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="row tight wrap">
            <button
              className="btn primary"
              disabled={selected.size === 0}
              onClick={() => {
                setQueue(open.filter((g) => selected.has(g.id)).map((g) => g.id));
                setStep(0);
              }}
            >
              Start ({selected.size})
            </button>
            <span className="spacer" />
            <label className="row tight small muted">
              Review day
              <select className="input sm" value={reviewDay} onChange={(e) => setReviewDay(Number(e.target.value))}>
                {WEEKDAY_SHORT.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      </div>
    );
  }

  const finish = () => {
    completeReview(saved, today);
    sound('complete');
    navigate('goals');
  };

  if (step >= queue.length) {
    const reviewed = goals.filter((g) => queue.includes(g.id));
    return (
      <div className="page review-page">
        <header className="page-head">
          <div>
            <h1>Review summary</h1>
            <p className="page-sub">
              {saved.length} of {queue.length} goal{queue.length === 1 ? '' : 's'} checked in. Your next steps also show on Today.
            </p>
          </div>
        </header>
        <section className="card">
          <ul className="review-summary">
            {reviewed.map((g) => {
              const c = g.checkIns.find((x) => x.date === today);
              return (
                <li key={g.id}>
                  <div>
                    <b>{g.title || 'Untitled goal'}</b>
                    {g.status !== 'active' && <span className={`badge status-${g.status}`}>{STATUS_LABELS[g.status]}</span>}
                  </div>
                  {c ? (
                    <span className="small">
                      <b>{c.rating}/10</b>
                      {c.next ? <span className="muted"> · Next: {c.next}</span> : null}
                    </span>
                  ) : (
                    <span className="small muted">Skipped</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <div className="row tight">
          <button className="btn" onClick={() => setStep(queue.length - 1)}>
            <Icon name="left" size={14} /> Back
          </button>
          <span className="spacer" />
          <button className="btn primary" onClick={finish}>
            Finish review
          </button>
        </div>
      </div>
    );
  }

  const goal = goals.find((g) => g.id === queue[step]);
  const next = () => setStep((s) => s + 1);

  return (
    <div className="page page-wide review-page">
      <div className="review-progress">
        <button className="link back" onClick={() => (confirm('Leave the review? Check-ins you saved are kept.') ? navigate('goals') : undefined)}>
          <Icon name="x" size={14} /> Exit
        </button>
        <Progress value={step / queue.length} label="Review progress" />
        <span className="small muted nowrap">
          {step + 1} of {queue.length}
        </span>
      </div>
      {goal ? (
        <ReviewStep
          key={goal.id}
          goal={goal}
          since={since}
          onSaved={() => {
            setSaved((s) => (s.includes(goal.id) ? s : [...s, goal.id]));
            next();
          }}
          onSkip={next}
          onBack={step > 0 ? () => setStep(step - 1) : undefined}
        />
      ) : (
        <Empty>
          This goal was deleted.{' '}
          <button className="link" onClick={next}>
            Continue
          </button>
        </Empty>
      )}
    </div>
  );
}

function ReviewStep({ goal, since, onSaved, onSkip, onBack }: { goal: LifeGoal; since: string; onSaved: () => void; onSkip: () => void; onBack?: () => void }) {
  const updateGoal = useGoals((s) => s.updateGoal);
  const today = todayKey();
  const last = [...goal.checkIns].filter((c) => c.date < today).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const lookBackFrom = last && last.date < since ? last.date : since;
  const { locked, entries } = useTaggedEntries(goal.tag, lookBackFrom);
  const wins = goal.wins.filter((w) => w.date >= lookBackFrom).sort((a, b) => (a.date < b.date ? 1 : -1));
  const milestones = goal.milestones.filter((m) => m.doneOn && m.doneOn >= lookBackFrom);
  const trend = momentum(goal);

  return (
    <div className="review-step">
      <header className="goal-head">
        <div>
          <h1 className="review-title">{goal.title || 'Untitled goal'}</h1>
          {goal.why && <p className="page-sub">{goal.why}</p>}
        </div>
        <div className="row tight">
          <select
            className="input sm"
            aria-label="Status"
            value={goal.status}
            onChange={(e) => updateGoal(goal.id, { status: e.target.value as GoalStatus })}
          >
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button className="btn sm ghost" onClick={() => navigate(`goals/${goal.id}`)}>
            Open goal
          </button>
        </div>
      </header>

      <div className="goal-layout">
        <div className="stack">
          <section className="card stack">
            <h3 className="card-title">Since {fmtDateShort(lookBackFrom)}</h3>
            {last ? (
              <div className="review-last">
                <span className="small muted">
                  Last check-in {fmtDateShort(last.date)}: <b className="ink">{last.rating}/10</b>
                  {trend ? ` · ${MOMENTUM_TEXT[trend]}` : ''}
                </span>
                {last.next && (
                  <div className="forecast tone-good goal-next">
                    <b>You planned</b>
                    <span>{last.next}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="small muted">First check-in for this goal.</p>
            )}
            {milestones.length > 0 && (
              <div className="small">
                <span className="muted">Milestones reached: </span>
                {milestones.map((m) => m.text).join(', ')}
              </div>
            )}
            <div className="stack tight">
              <span className="field-label">Wins</span>
              {wins.length ? (
                <ul className="wins">
                  {wins.map((w) => (
                    <li key={w.id}>
                      <span className="small muted">{fmtDateShort(w.date)}</span>
                      <span className="wins-text">{w.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="small muted">None logged. Anything worth adding?</span>
              )}
              <WinQuickAdd goal={goal} />
            </div>
            {goal.signals.length > 0 && (
              <div className="stack tight">
                <span className="field-label">Signals</span>
                {goal.signals.map((s) => {
                  const { latest, improving } = signalTrend(s);
                  return (
                    <div key={s.id} className="review-signal">
                      <span className="small">
                        <b>{s.name}</b> {s.unit && <span className="muted">{s.unit}</span>} · latest {latest ? `${latest.value} (${fmtDateShort(latest.date)})` : '–'}
                        {improving !== null && <span className="muted"> · {improving ? 'improving' : 'heading the wrong way'}</span>}
                      </span>
                      <SignalLogForm goal={goal} signal={s} compact />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          <section className="card stack">
            <h3 className="card-title">From your journal {goal.tag && <span className="muted small">#{goal.tag}</span>}</h3>
            {locked ? (
              <p className="small muted">
                <Icon name="lock" size={12} /> The journal is locked, so tagged entries can't be shown.
              </p>
            ) : !goal.tag ? (
              <p className="small muted">This goal has no journal tag yet. Set one on the goal page.</p>
            ) : entries.length === 0 ? (
              <p className="small muted">No entries tagged #{goal.tag} since {fmtDateShort(lookBackFrom)}.</p>
            ) : (
              <MentionList entries={entries} tag={goal.tag} limit={3} />
            )}
          </section>
        </div>
        <section className="card stack">
          <h3 className="card-title">Reflect</h3>
          <CheckInForm
            goal={goal}
            fixedDate={today}
            submitLabel="Save & next"
            onSaved={onSaved}
            extraActions={
              <>
                <button type="button" className="btn ghost" onClick={onSkip}>
                  Skip
                </button>
                {onBack && (
                  <button type="button" className="btn ghost" onClick={onBack}>
                    Back
                  </button>
                )}
              </>
            }
          />
        </section>
      </div>
    </div>
  );
}
