import { useMemo, useState } from 'react';
import type { ID } from '../types';
import type { Metric } from './types';
import { useHealth } from './store';
import { dailySeries, fmtValue, forecastGoal } from './projection';
import { useHealthColor } from './describe';
import { MetricEditor } from './editors';
import { SYNC_LABELS } from './google';
import { Empty, Icon, Segmented } from '../components/common';
import { DateInput } from '../components/inputs';
import { TrendChart } from '../components/TrendChart';
import { addDays, fmtDateShort, todayKey } from '../lib/dates';
import { navigate } from '../lib/hooks';

export function MeasurementsTab({ selectedId }: { selectedId?: string }) {
  const metrics = useHealth((s) => s.metrics);
  const measurements = useHealth((s) => s.measurements);
  const [editing, setEditing] = useState<{ id: ID | null } | null>(null);
  const selected = metrics.find((m) => m.id === selectedId) ?? metrics[0];

  return (
    <div className="split">
      <div className="split-list">
        <button className="btn" onClick={() => setEditing({ id: null })}>
          <Icon name="plus" /> Custom measurement
        </button>
        {metrics.map((m) => {
          const series = dailySeries(m, measurements);
          const latest = series[series.length - 1];
          return (
            <button
              key={m.id}
              className={`habit-card metric-card${selected?.id === m.id ? ' is-selected' : ''}`}
              onClick={() => navigate(`health/measurements/${m.id}`)}
            >
              <div className="habit-card-top">
                <div className="habit-card-text">
                  <div className="habit-row-title">{m.name}</div>
                  <div className="habit-row-meta">
                    {latest ? `${fmtValue(latest.value, m)} · ${fmtDateShort(latest.date)}` : 'No readings'}
                  </div>
                </div>
                {m.source && <span className="badge" title={`Can sync ${SYNC_LABELS[m.source]} from Google Health`}>sync</span>}
              </div>
            </button>
          );
        })}
      </div>
      {selected ? <MetricDetail metric={selected} onEdit={() => setEditing({ id: selected.id })} /> : <Empty>No measurements.</Empty>}
      {editing && (
        <MetricEditor
          id={editing.id}
          onClose={(savedId) => {
            setEditing(null);
            if (savedId && !editing.id) navigate(`health/measurements/${savedId}`);
          }}
        />
      )}
    </div>
  );
}

type Range = '30' | '90' | '365' | 'all';

function MetricDetail({ metric, onEdit }: { metric: Metric; onEdit: () => void }) {
  const measurements = useHealth((s) => s.measurements);
  const goals = useHealth((s) => s.goals);
  const addMeasurement = useHealth((s) => s.addMeasurement);
  const deleteMeasurement = useHealth((s) => s.deleteMeasurement);
  const color = useHealthColor();
  const today = todayKey();
  const [range, setRange] = useState<Range>('90');
  const [date, setDate] = useState(today);
  const [valueText, setValueText] = useState('');
  const [note, setNote] = useState('');
  const [showAll, setShowAll] = useState(false);

  const series = useMemo(() => dailySeries(metric, measurements), [metric, measurements]);
  const shown = range === 'all' ? series : series.filter((p) => p.date >= addDays(today, -Number(range)));
  const goal = goals.find((g) => !g.archived && g.metricId === metric.id && g.kind === 'reach');
  const forecast = goal ? forecastGoal(goal, metric, measurements, today) : null;
  const readings = measurements.filter((m) => m.metricId === metric.id).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const value = Number(valueText);
  const valid = valueText.trim() !== '' && Number.isFinite(value);

  return (
    <section className="card detail">
      <header className="card-head">
        <div>
          <h2 className="detail-title">{metric.name}</h2>
          <div className="detail-meta">
            {metric.unit && <span>in {metric.unit}</span>}
            <span>{series.length} days logged</span>
            {metric.source && <span className="muted">Syncs from Google Health ({SYNC_LABELS[metric.source]})</span>}
          </div>
        </div>
        <button className="btn" onClick={onEdit}>
          <Icon name="edit" /> Edit
        </button>
      </header>

      <form
        className="log-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          addMeasurement({ metricId: metric.id, date, value, note: note.trim(), source: 'manual' });
          setValueText('');
          setNote('');
        }}
      >
        <DateInput value={date} onChange={(d) => setDate(d ?? today)} />
        <input
          className="input"
          inputMode="decimal"
          placeholder={`Value${metric.unit ? ` (${metric.unit})` : ''}`}
          value={valueText}
          onChange={(e) => setValueText(e.target.value)}
        />
        <input className="input grow" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn primary" type="submit" disabled={!valid}>
          <Icon name="plus" /> Log
        </button>
      </form>

      <div className="detail-section">
        <div className="section-head">
          <h3 className="section-title">Trend</h3>
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: '30', label: '30d' },
              { value: '90', label: '90d' },
              { value: '365', label: '1y' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
        <TrendChart
          points={shown}
          color={color}
          format={(v) => fmtValue(v, metric, false)}
          target={goal?.target}
          projection={
            forecast?.fit && forecast.eta && (forecast.status === 'on-track' || forecast.status === 'behind')
              ? { fit: forecast.fit, from: forecast.window[0].date, to: forecast.eta, early: forecast.etaEarly, late: forecast.etaLate }
              : null
          }
          deadline={goal?.deadline}
        />
      </div>

      <div className="detail-section">
        <h3 className="section-title">Readings</h3>
        {readings.length === 0 ? (
          <Empty>No readings yet. Log one above.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Value</th>
                  <th>Note</th>
                  <th>Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(showAll ? readings : readings.slice(0, 15)).map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDateShort(r.date)}</td>
                    <td>{fmtValue(r.value, metric)}</td>
                    <td className="cell-note">{r.note}</td>
                    <td>{r.source === 'google' ? 'Google Health' : 'Manual'}</td>
                    <td>
                      <button className="btn icon ghost sm" aria-label="Delete reading" onClick={() => deleteMeasurement(r.id)}>
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {readings.length > 15 && (
              <button className="link small" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show fewer' : `Show all ${readings.length}`}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
