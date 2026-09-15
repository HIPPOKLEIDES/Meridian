import { useMemo } from 'react';
import { useHealth } from './store';
import { dailySeries, fmtValue, forecastGoal, forecastRecovery, valueDaysBefore } from './projection';
import { describeForecast, useHealthArea, useHealthColor } from './describe';
import { MeasurementsTab } from './Measurements';
import { GoalsTab } from './Goals';
import { InjuriesTab } from './Injuries';
import { ConnectTab } from './Connect';
import { NutritionTab } from './NutritionTab';
import { useStore } from '../store';
import { CheckButton, Empty, Icon, Progress, Segmented } from '../components/common';
import { ColumnChart, Sparkline } from '../components/TrendChart';
import { addDays, diffDays, fmtDateShort, fmtDuration, fmtHours, startOfWeek, todayKey } from '../lib/dates';
import { currentStrength, isScheduled, strengthLabel } from '../lib/habits';
import { navigate } from '../lib/hooks';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'measurements', label: 'Measurements' },
  { value: 'goals', label: 'Goals' },
  { value: 'nutrition', label: 'Nutrition' },
  { value: 'injuries', label: 'Injuries' },
  { value: 'connect', label: 'Fitbit & Google' },
];

export function HealthView({ tab, id }: { tab?: string; id?: string }) {
  const current = TABS.find((t) => t.value === tab)?.value ?? 'overview';
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Health</h1>
          <p className="page-sub">Measurements, goals, recovery and time spent on your health.</p>
        </div>
        <Segmented value={current} onChange={(v) => navigate(v === 'overview' ? 'health' : `health/${v}`)} options={TABS} />
      </header>
      {current === 'overview' && <HealthOverview />}
      {current === 'measurements' && <MeasurementsTab selectedId={id} />}
      {current === 'goals' && <GoalsTab />}
      {current === 'nutrition' && <NutritionTab sub={id} />}
      {current === 'injuries' && <InjuriesTab selectedId={id} />}
      {current === 'connect' && <ConnectTab />}
    </div>
  );
}

function HealthOverview() {
  const metrics = useHealth((s) => s.metrics);
  const measurements = useHealth((s) => s.measurements);
  const goals = useHealth((s) => s.goals);
  const injuries = useHealth((s) => s.injuries);
  const color = useHealthColor();
  const today = todayKey();

  const tiles = useMemo(
    () =>
      metrics
        .map((m) => ({ metric: m, series: dailySeries(m, measurements) }))
        .filter((t) => t.series.length > 0),
    [metrics, measurements],
  );

  const activeGoals = goals.filter((g) => !g.archived);
  const healing = injuries.filter((i) => i.status !== 'healed');

  return (
    <>
      {tiles.length === 0 && activeGoals.length === 0 && (
        <div className="banner">
          <div>
            Log a measurement, set a goal, or connect Fitbit through Google Health to fill this page.
          </div>
          <button className="btn primary" onClick={() => navigate('health/measurements')}>
            Log a measurement
          </button>
        </div>
      )}

      {tiles.length > 0 && (
        <div className="stat-row">
          {tiles.map(({ metric, series }) => {
            const latest = series[series.length - 1];
            const prev = valueDaysBefore(series, 7);
            const delta = prev ? latest.value - prev.value : null;
            const better =
              delta === null || delta === 0 || metric.direction === 'neutral'
                ? 'neutral'
                : (delta > 0) === (metric.direction === 'increase')
                  ? 'good'
                  : 'bad';
            return (
              <button key={metric.id} className="card stat stat-tile" onClick={() => navigate(`health/measurements/${metric.id}`)}>
                <span className="stat-label">{metric.name}</span>
                <span className="stat-value">
                  {fmtValue(latest.value, metric, false)}
                  {metric.unit && <span className="stat-unit"> {metric.unit}</span>}
                </span>
                <span className="stat-trend">
                  <Sparkline points={series.slice(-30)} color={color} />
                  {delta !== null && (
                    <span className={`delta is-${better}`}>
                      {delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {fmtValue(Math.abs(delta), metric)} vs last week
                    </span>
                  )}
                </span>
                <span className="stat-foot">{latest.date === today ? 'Today' : fmtDateShort(latest.date)}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="two-col">
        <HealthTimeCard />
        <section className="card">
          <header className="card-head">
            <h3 className="card-title">Goals</h3>
            <button className="btn sm ghost" onClick={() => navigate('health/goals')}>
              All goals <Icon name="right" size={14} />
            </button>
          </header>
          {activeGoals.length === 0 ? (
            <Empty>No goals yet.</Empty>
          ) : (
            <div className="goal-mini-list">
              {activeGoals.map((g) => {
                const metric = metrics.find((m) => m.id === g.metricId);
                if (!metric) return null;
                const f = forecastGoal(g, metric, measurements, today);
                const text = describeForecast(g, metric, f, today);
                return (
                  <button key={g.id} className="goal-mini" onClick={() => navigate('health/goals')}>
                    <div className="goal-mini-head">
                      <b>
                        {metric.name} {g.kind === 'average' ? 'avg' : '→'} {fmtValue(g.target, metric)}
                      </b>
                      <span className={`tone tone-${text.tone}`}>{text.headline}</span>
                    </div>
                    <Progress value={f.progress} label={`${metric.name} goal progress`} />
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="two-col">
        <section className="card">
          <header className="card-head">
            <h3 className="card-title">Healing</h3>
            <button className="btn sm ghost" onClick={() => navigate('health/injuries')}>
              Injuries <Icon name="right" size={14} />
            </button>
          </header>
          {healing.length === 0 ? (
            <Empty>No active injuries.</Empty>
          ) : (
            healing.map((inj) => {
              const r = forecastRecovery(inj, today);
              return (
                <button key={inj.id} className="goal-mini" onClick={() => navigate(`health/injuries/${inj.id}`)}>
                  <div className="goal-mini-head">
                    <b>
                      {inj.name}
                      {inj.bodyPart && <span className="muted"> · {inj.bodyPart}</span>}
                    </b>
                    <span className="muted small">Day {diffDays(inj.startedOn, today) + 1}</span>
                  </div>
                  <div className="small muted">
                    {r.latestPain !== null ? `Pain ${r.latestPain}/10` : 'No check-ins yet'}
                    {r.ratePerWeek !== null && ` · ${r.ratePerWeek < 0 ? 'improving' : r.ratePerWeek > 0 ? 'worsening' : 'steady'}`}
                    {r.painFreeBy && ` · pain-free around ${fmtDateShort(r.painFreeBy)}`}
                  </div>
                  {r.elapsed !== null && <Progress value={r.elapsed} label="Expected recovery time elapsed" />}
                </button>
              );
            })
          )}
        </section>
        <HealthHabitsCard />
      </div>
    </>
  );
}

function HealthTimeCard() {
  const entries = useStore((s) => s.entries);
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);
  const area = useHealthArea();
  const color = useHealthColor();
  const today = todayKey();
  const thisWeek = startOfWeek(today, weekStartsOn);
  const weeks = Array.from({ length: 10 }, (_, i) => addDays(thisWeek, -(9 - i) * 7));
  const minutes = weeks.map((ws) => {
    const we = addDays(ws, 6);
    return entries.filter((e) => area && e.areaId === area.id && e.date >= ws && e.date <= we).reduce((s, e) => s + e.end - e.start, 0);
  });
  const current = minutes[minutes.length - 1];
  const target = area?.weeklyTargetHours ?? null;
  const avg = minutes.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, minutes.length - 1);

  return (
    <section className="card">
      <header className="card-head">
        <h3 className="card-title">Time on health</h3>
        <span className="small muted">avg {fmtHours(avg)} / week</span>
      </header>
      {!area ? (
        <Empty>Add a “Health” life area to track time here.</Empty>
      ) : (
        <>
          <div className="big-line">
            <span className="stat-value">{fmtDuration(current)}</span>
            <span className="muted">this week{target ? ` of ${target}h` : ''}</span>
          </div>
          {target ? (
            <span className="meter" style={{ ['--meter-color' as string]: color }}>
              <Progress value={current / (target * 60)} label="Weekly health target" />
            </span>
          ) : null}
          <ColumnChart
            height={170}
            groups={weeks.map((ws, i) => ({ key: ws, label: fmtDateShort(ws), title: `Week of ${fmtDateShort(ws)}`, values: [minutes[i] / 60] }))}
            series={[{ name: 'Hours', color }]}
            format={(v) => fmtDuration(v * 60)}
            axisFormat={(v) => `${v}h`}
          />
        </>
      )}
    </section>
  );
}

function HealthHabitsCard() {
  const habits = useStore((s) => s.habits);
  const toggle = useStore((s) => s.toggleHabit);
  const area = useHealthArea();
  const today = todayKey();
  const list = habits.filter((h) => !h.archived && area && h.areaId === area.id);
  return (
    <section className="card">
      <header className="card-head">
        <h3 className="card-title">Health habits</h3>
        <button className="btn sm ghost" onClick={() => navigate('habits')}>
          Habits <Icon name="right" size={14} />
        </button>
      </header>
      {list.length === 0 ? (
        <Empty>No habits in the Health area yet.</Empty>
      ) : (
        list.map((h) => {
          const s = currentStrength(h, today);
          const due = isScheduled(h, today);
          return (
            <div key={h.id} className="habit-strength-row">
              {due ? (
                <CheckButton checked={!!h.log[today]?.done} onToggle={() => toggle(h.id, today)} title="Done today" />
              ) : (
                <span className="check-placeholder" />
              )}
              <button className="link-plain" onClick={() => navigate(`habits/${h.id}`)}>
                {h.title}
              </button>
              <Progress value={s} label="Habit strength" />
              <span className="small muted nowrap">
                {Math.round(s * 100)}% {strengthLabel(s).toLowerCase()}
              </span>
            </div>
          );
        })
      )}
    </section>
  );
}
