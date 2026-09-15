import { useMemo, useState } from 'react';
import type { Area } from '../types';
import { useStore } from '../store';
import { Icon, Progress, Segmented } from '../components/common';
import { AreaColumns, type DayAreaTotals } from '../components/charts';
import { addDays, fmtDateShort, fmtDuration, fmtHours, fromKey, rangeKeys, startOfWeek, todayKey } from '../lib/dates';

type Range = 'week' | '7' | '14' | '30';
type Series = Area | { id: 'none'; name: string; slot: 0; weeklyTargetHours: null };

export function AreasView() {
  const areas = useStore((s) => s.areas);
  const entries = useStore((s) => s.entries);
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);
  const [range, setRange] = useState<Range>('7');
  const [showTable, setShowTable] = useState(false);
  const today = todayKey();
  const weekStart = startOfWeek(today, weekStartsOn);

  const days = range === 'week' ? rangeKeys(weekStart, addDays(weekStart, 6)) : rangeKeys(addDays(today, -(Number(range) - 1)), today);
  const first = days[0];
  const last = days[days.length - 1];

  const { byDay, series, totals, topLabels, weekTotals } = useMemo(() => {
    const inRange = entries.filter((e) => e.date >= first && e.date <= last);
    const byDay: DayAreaTotals[] = days.map((date) => ({ date, byArea: {} }));
    const index = Object.fromEntries(days.map((d, i) => [d, i]));
    const totals: Record<string, number> = {};
    const labels: Record<string, Record<string, number>> = {};
    for (const e of inRange) {
      const key = e.areaId && areas.some((a) => a.id === e.areaId) ? e.areaId : 'none';
      const min = e.end - e.start;
      const day = byDay[index[e.date]];
      day.byArea[key] = (day.byArea[key] ?? 0) + min;
      totals[key] = (totals[key] ?? 0) + min;
      const label = e.label || 'Untitled';
      (labels[key] ??= {})[label] = (labels[key][label] ?? 0) + min;
    }
    const weekTotals: Record<string, number> = {};
    const weekEnd = addDays(weekStart, 6);
    for (const e of entries) {
      if (e.date < weekStart || e.date > weekEnd || !e.areaId) continue;
      weekTotals[e.areaId] = (weekTotals[e.areaId] ?? 0) + e.end - e.start;
    }
    const series: Series[] = [...areas];
    if (totals.none) series.push({ id: 'none', name: 'No area', slot: 0, weeklyTargetHours: null });
    const topLabels = Object.fromEntries(
      Object.entries(labels).map(([k, v]) => [k, Object.entries(v).sort((a, b) => b[1] - a[1]).slice(0, 4)]),
    );
    return { byDay, series, totals, topLabels, weekTotals };
  }, [entries, areas, first, last, weekStart]);

  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  const fill = (slot: number) => (slot ? `var(--series-${slot})` : 'var(--unassigned)');

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Life areas</h1>
          <p className="page-sub">
            {fmtHours(grand)} logged · {fmtDateShort(first)} – {fmtDateShort(last)}
          </p>
        </div>
        <Segmented<Range>
          value={range}
          onChange={setRange}
          options={[
            { value: 'week', label: 'This week' },
            { value: '7', label: '7 days' },
            { value: '14', label: '14 days' },
            { value: '30', label: '30 days' },
          ]}
        />
      </header>

      <div className="stat-row">
        {series.map((a) => {
          const min = totals[a.id] ?? 0;
          const target = a.weeklyTargetHours;
          const week = weekTotals[a.id] ?? 0;
          return (
            <div key={a.id} className="card stat">
              <span className="stat-label">
                <span className="dot" style={{ background: fill(a.slot) }} /> {a.name}
              </span>
              <span className="stat-value">{fmtHours(min)}</span>
              <span className="stat-foot">{grand ? Math.round((min / grand) * 100) : 0}% of logged time</span>
              {target ? (
                <div className="target">
                  <span className="meter" style={{ ['--meter-color' as string]: fill(a.slot) }}>
                    <Progress value={week / (target * 60)} label={`${a.name} weekly target`} />
                  </span>
                  <span className="stat-foot">
                    {fmtHours(week)} of {target}h this week
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <section className="card">
        <header className="card-head">
          <h3 className="card-title">Hours per day</h3>
          <button className="btn sm ghost" onClick={() => setShowTable(!showTable)}>
            <Icon name="list" size={14} /> {showTable ? 'Hide table' : 'Show table'}
          </button>
        </header>
        <div className="legend-list">
          {series.map((a) => (
            <span key={a.id} className="legend-item">
              <span className="swatch" style={{ background: fill(a.slot) }} />
              {a.name}
            </span>
          ))}
        </div>
        <AreaColumns days={byDay} areas={series} />
        {showTable && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Day</th>
                  {series.map((a) => (
                    <th key={a.id}>{a.name}</th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {byDay.map((d) => (
                  <tr key={d.date}>
                    <td>{fromKey(d.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    {series.map((a) => (
                      <td key={a.id}>{d.byArea[a.id] ? fmtDuration(d.byArea[a.id]) : '–'}</td>
                    ))}
                    <td>
                      <b>{fmtDuration(Object.values(d.byArea).reduce((x, y) => x + y, 0))}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h3 className="card-title">Where the time went</h3>
        <div className="top-grid">
          {series
            .filter((a) => topLabels[a.id]?.length)
            .map((a) => (
              <div key={a.id}>
                <div className="group-label">
                  <span className="dot" style={{ background: fill(a.slot) }} /> {a.name}
                </div>
                <ul className="top-list">
                  {topLabels[a.id].map(([label, min]) => (
                    <li key={label}>
                      <span>{label}</span>
                      <b>{fmtDuration(min)}</b>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          {grand === 0 && <p className="muted">No time logged in this range yet.</p>}
        </div>
      </section>

      <ManageAreas />
    </div>
  );
}

function ManageAreas() {
  const areas = useStore((s) => s.areas);
  const addArea = useStore((s) => s.addArea);
  const updateArea = useStore((s) => s.updateArea);
  const deleteArea = useStore((s) => s.deleteArea);
  return (
    <section className="card">
      <header className="card-head">
        <h3 className="card-title">Manage areas</h3>
        <button className="btn sm" onClick={() => addArea()} disabled={areas.length >= 8}>
          <Icon name="plus" size={14} /> Area
        </button>
      </header>
      <div className="area-rows">
        {areas.map((a) => (
          <div key={a.id} className="area-row">
            <input className="input" value={a.name} aria-label="Area name" onChange={(e) => updateArea(a.id, { name: e.target.value })} />
            <div className="swatches" role="radiogroup" aria-label="Color">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => (
                <button
                  key={slot}
                  type="button"
                  role="radio"
                  aria-checked={a.slot === slot}
                  aria-label={`Color ${slot}`}
                  className={`swatch-btn${a.slot === slot ? ' is-on' : ''}`}
                  style={{ background: `var(--series-${slot})` }}
                  onClick={() => updateArea(a.id, { slot })}
                />
              ))}
            </div>
            <label className="inline-label">
              Weekly target
              <input
                className="input num"
                type="number"
                min={0}
                placeholder="–"
                value={a.weeklyTargetHours ?? ''}
                onChange={(e) => updateArea(a.id, { weeklyTargetHours: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
              />
              h
            </label>
            <button
              className="btn icon ghost"
              aria-label={`Delete ${a.name}`}
              onClick={() => confirm(`Delete the “${a.name}” area? Anything assigned to it becomes unassigned.`) && deleteArea(a.id)}
            >
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </div>
      <p className="small muted">Colors come from a palette checked for color-blind separation. Give each area its own color.</p>
    </section>
  );
}
