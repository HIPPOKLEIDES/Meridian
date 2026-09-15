import { useState } from 'react';
import type { ID } from '../types';
import type { HealthGoal, Metric } from './types';
import { useHealth } from './store';
import { dailySeries, fmtValue, forecastGoal } from './projection';
import { describeForecast, fmtRate, useHealthColor } from './describe';
import { GoalEditor } from './editors';
import { Empty, Icon, Progress } from '../components/common';
import { TrendChart } from '../components/TrendChart';
import { addDays, fmtDateShort, todayKey } from '../lib/dates';

export function GoalsTab() {
  const goals = useHealth((s) => s.goals);
  const metrics = useHealth((s) => s.metrics);
  const [editing, setEditing] = useState<{ id: ID | null } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const active = goals.filter((g) => !g.archived);
  const archived = goals.filter((g) => g.archived);

  return (
    <>
      <div className="toolbar">
        <button className="btn primary" onClick={() => setEditing({ id: null })}>
          <Icon name="plus" /> New goal
        </button>
        <span className="small muted">
          Arrival dates come from a straight-line trend through your recent readings (the last six weeks), with an 80% range.
        </span>
      </div>
      {active.length === 0 ? (
        <section className="card">
          <Empty>No goals yet. Pick a measurement and a target, and you'll see how long it should take.</Empty>
        </section>
      ) : (
        <div className="goal-grid">
          {active.map((g) => {
            const metric = metrics.find((m) => m.id === g.metricId);
            return metric ? <GoalCard key={g.id} goal={g} metric={metric} onEdit={() => setEditing({ id: g.id })} /> : null;
          })}
        </div>
      )}
      {archived.length > 0 && (
        <div>
          <button className="group-label link" onClick={() => setShowArchived(!showArchived)}>
            <Icon name={showArchived ? 'down' : 'right'} size={12} /> Archived <span className="muted">{archived.length}</span>
          </button>
          {showArchived && (
            <div className="goal-grid">
              {archived.map((g) => {
                const metric = metrics.find((m) => m.id === g.metricId);
                return metric ? <GoalCard key={g.id} goal={g} metric={metric} onEdit={() => setEditing({ id: g.id })} /> : null;
              })}
            </div>
          )}
        </div>
      )}
      {editing && <GoalEditor id={editing.id} onClose={() => setEditing(null)} />}
    </>
  );
}

function GoalCard({ goal, metric, onEdit }: { goal: HealthGoal; metric: Metric; onEdit: () => void }) {
  const measurements = useHealth((s) => s.measurements);
  const color = useHealthColor();
  const today = todayKey();
  const f = forecastGoal(goal, metric, measurements, today);
  const text = describeForecast(goal, metric, f, today);
  const from = goal.kind === 'average' ? addDays(today, -30) : goal.startDate < addDays(today, -365) ? addDays(today, -365) : goal.startDate;
  const points = dailySeries(metric, measurements).filter((p) => p.date >= from);

  return (
    <section className={`card goal-card${goal.archived ? ' is-archived' : ''}`}>
      <header className="card-head">
        <div>
          <h3 className="goal-title">
            {metric.name} {goal.kind === 'average' ? '7-day average' : '→'} {fmtValue(goal.target, metric)}
          </h3>
          {goal.note && <p className="small muted">{goal.note}</p>}
        </div>
        <button className="btn icon ghost" aria-label="Edit goal" onClick={onEdit}>
          <Icon name="edit" />
        </button>
      </header>
      <div className={`forecast tone-${text.tone}`}>
        <b>{text.headline}</b>
        <span>{text.detail}</span>
      </div>
      <div className="goal-stats">
        <div>
          <span className="stat-label">{goal.kind === 'average' ? 'Average' : 'Now'}</span>
          <b>{fmtValue(f.current, metric)}</b>
        </div>
        {goal.kind === 'reach' && (
          <div>
            <span className="stat-label">Started</span>
            <b>{fmtValue(f.startValue, metric)}</b>
          </div>
        )}
        {goal.kind === 'reach' && (
          <div>
            <span className="stat-label">Rate</span>
            <b>{f.ratePerWeek !== null ? fmtRate(f.ratePerWeek, metric) : '–'}</b>
          </div>
        )}
        <div>
          <span className="stat-label">{goal.kind === 'average' ? 'Days met' : 'Estimate'}</span>
          <b>{goal.kind === 'average' ? `${Math.round((f.hitRate ?? 0) * 100)}%` : f.eta ? fmtDateShort(f.eta) : '–'}</b>
        </div>
        {goal.deadline && (
          <div>
            <span className="stat-label">Deadline</span>
            <b>{fmtDateShort(goal.deadline)}</b>
          </div>
        )}
      </div>
      <Progress value={f.progress} label="Progress toward goal" />
      <TrendChart
        points={points}
        color={color}
        height={200}
        format={(v) => fmtValue(v, metric, false)}
        target={goal.target}
        deadline={goal.deadline}
        projection={
          f.fit && f.eta && (f.status === 'on-track' || f.status === 'behind')
            ? { fit: f.fit, from: f.window[0].date, to: f.eta, early: f.etaEarly, late: f.etaLate }
            : null
        }
      />
    </section>
  );
}
