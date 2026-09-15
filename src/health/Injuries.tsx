import { useState } from 'react';
import type { ID } from '../types';
import type { Injury } from './types';
import { useHealth } from './store';
import { forecastRecovery } from './projection';
import { useHealthArea, useHealthColor } from './describe';
import { InjuryEditor } from './editors';
import { useStore } from '../store';
import { CheckButton, Empty, Icon, Progress } from '../components/common';
import { DateInput } from '../components/inputs';
import { TrendChart } from '../components/TrendChart';
import { diffDays, fmtDateShort, todayKey } from '../lib/dates';
import { currentStrength, isScheduled, strengthLabel } from '../lib/habits';
import { navigate } from '../lib/hooks';

export function InjuriesTab({ selectedId }: { selectedId?: string }) {
  const injuries = useHealth((s) => s.injuries);
  const [editing, setEditing] = useState<{ id: ID | null } | null>(null);
  const [showHealed, setShowHealed] = useState(false);
  const open = injuries
    .filter((i) => i.status !== 'healed')
    .sort((a, b) => (a.id === selectedId ? -1 : b.id === selectedId ? 1 : a.startedOn < b.startedOn ? 1 : -1));
  const healed = injuries.filter((i) => i.status === 'healed');

  return (
    <>
      <div className="toolbar">
        <button className="btn primary" onClick={() => setEditing({ id: null })}>
          <Icon name="plus" /> Log an injury
        </button>
        <span className="small muted">Recovery estimates come from your own pain check-ins. They're a trend, not medical advice.</span>
      </div>
      {open.length === 0 ? (
        <section className="card">
          <Empty>Nothing to heal right now.</Empty>
        </section>
      ) : (
        open.map((inj) => <InjuryCard key={inj.id} injury={inj} onEdit={() => setEditing({ id: inj.id })} />)
      )}
      {healed.length > 0 && (
        <div>
          <button className="group-label link" onClick={() => setShowHealed(!showHealed)}>
            <Icon name={showHealed ? 'down' : 'right'} size={12} /> Healed <span className="muted">{healed.length}</span>
          </button>
          {showHealed &&
            healed.map((inj) => (
              <div key={inj.id} className="healed-row">
                <b>{inj.name}</b>
                <span className="muted">{inj.bodyPart}</span>
                <span className="small muted">
                  {fmtDateShort(inj.startedOn)} – {inj.healedOn ? fmtDateShort(inj.healedOn) : '?'}
                  {inj.healedOn && ` · ${Math.round(diffDays(inj.startedOn, inj.healedOn) / 7)} weeks`}
                </span>
                <button className="btn sm ghost" onClick={() => setEditing({ id: inj.id })}>
                  Edit
                </button>
              </div>
            ))}
        </div>
      )}
      {editing && <InjuryEditor id={editing.id} onClose={() => setEditing(null)} />}
    </>
  );
}

function InjuryCard({ injury, onEdit }: { injury: Injury; onEdit: () => void }) {
  const addCheckIn = useHealth((s) => s.addCheckIn);
  const deleteCheckIn = useHealth((s) => s.deleteCheckIn);
  const updateInjury = useHealth((s) => s.updateInjury);
  const color = useHealthColor();
  const today = todayKey();
  const r = forecastRecovery(injury, today);
  const [date, setDate] = useState(today);
  const [pain, setPain] = useState(r.latestPain ?? 5);
  const [mobility, setMobility] = useState('');
  const [note, setNote] = useState('');
  const [showLog, setShowLog] = useState(false);
  const checkIns = [...injury.checkIns].sort((a, b) => (a.date < b.date ? -1 : 1));
  const day = diffDays(injury.startedOn, today) + 1;

  let summary = 'Add a few check-ins to see how recovery is trending.';
  if (r.ratePerWeek !== null) {
    const trend =
      r.ratePerWeek < -0.05
        ? `Pain is dropping about ${Math.abs(r.ratePerWeek).toFixed(1)} points a week`
        : r.ratePerWeek > 0.05
          ? `Pain is rising about ${r.ratePerWeek.toFixed(1)} points a week — worth checking in with your clinician`
          : 'Pain has plateaued';
    summary = `${trend}${r.painFreeBy && r.painFreeBy > today ? `. On this trend you'd be close to pain-free around ${fmtDateShort(r.painFreeBy)}` : ''}.`;
    if (r.expectedBy && r.painFreeBy && r.painFreeBy > today) {
      const diff = diffDays(r.expectedBy, r.painFreeBy);
      summary += diff > 3 ? ` That's ${diff} days later than expected.` : diff < -3 ? ` That's ${-diff} days ahead of the expected recovery.` : ' That lines up with the expected recovery.';
    }
  }

  return (
    <section className="card detail">
      <header className="card-head">
        <div>
          <h2 className="detail-title">{injury.name}</h2>
          <div className="detail-meta">
            {injury.bodyPart && <span>{injury.bodyPart}</span>}
            <span>
              Day {day} · since {fmtDateShort(injury.startedOn)}
            </span>
            <select
              className="input sm"
              value={injury.status}
              aria-label="Status"
              onChange={(e) => {
                const status = e.target.value as Injury['status'];
                updateInjury(injury.id, { status, healedOn: status === 'healed' ? today : null });
              }}
            >
              <option value="active">Active</option>
              <option value="recovering">Recovering</option>
              <option value="healed">Healed</option>
            </select>
          </div>
        </div>
        <button className="btn" onClick={onEdit}>
          <Icon name="edit" /> Edit
        </button>
      </header>

      {r.expectedBy && r.elapsed !== null && (
        <div className="recovery-progress">
          <div className="small">
            Week {Math.ceil(day / 7)} of about {injury.expectedWeeks} · expected by {fmtDateShort(r.expectedBy)}
          </div>
          <Progress value={r.elapsed} label="Expected recovery time elapsed" />
        </div>
      )}

      <div className="two-col tight">
        <div className="detail-section">
          <h3 className="section-title">Pain over time</h3>
          <TrendChart
            points={checkIns.map((c) => ({ date: c.date, value: c.pain }))}
            color={color}
            height={190}
            format={(v) => `${Math.round(v * 10) / 10}`}
            yMin={0}
            yMax={10}
            target={1}
            targetLabel="Pain-free"
            projection={
              r.fit && r.painFreeBy && r.painFreeBy > (checkIns[checkIns.length - 1]?.date ?? today)
                ? { fit: r.fit, from: r.fit.origin, to: r.painFreeBy, early: null, late: null }
                : null
            }
            deadline={r.expectedBy}
            deadlineLabel="Expected"
          />
          <p className="small">{summary}</p>
        </div>

        <div className="detail-section">
          <h3 className="section-title">How does it feel today?</h3>
          <form
            className="checkin-form"
            onSubmit={(e) => {
              e.preventDefault();
              const mob = mobility.trim() === '' ? null : Math.max(0, Math.min(100, Number(mobility)));
              addCheckIn(injury.id, { date, pain, mobility: Number.isFinite(mob) ? mob : null, note: note.trim() });
              setNote('');
            }}
          >
            <label className="pain-slider">
              <span>
                Pain <b>{pain}</b>/10
              </span>
              <input type="range" min={0} max={10} step={1} value={pain} onChange={(e) => setPain(Number(e.target.value))} />
            </label>
            <div className="row tight">
              <DateInput value={date} onChange={(d) => setDate(d ?? today)} />
              <input className="input" inputMode="numeric" placeholder="Mobility %" value={mobility} onChange={(e) => setMobility(e.target.value)} />
            </div>
            <input className="input" placeholder="Note, e.g. stairs fine, sore after run" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn primary" type="submit">
              Save check-in
            </button>
          </form>
          {injury.avoid && (
            <div className="notice">
              <Icon name="x" size={14} /> Avoid: {injury.avoid}
            </div>
          )}
          {injury.notes && <p className="notes small">{injury.notes}</p>}
        </div>
      </div>

      <RehabHabits injury={injury} />

      <div>
        <button className="group-label link" onClick={() => setShowLog(!showLog)}>
          <Icon name={showLog ? 'down' : 'right'} size={12} /> Check-in log <span className="muted">{checkIns.length}</span>
        </button>
        {showLog && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Pain</th>
                  <th>Mobility</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...checkIns].reverse().map((c) => (
                  <tr key={c.id}>
                    <td>{fmtDateShort(c.date)}</td>
                    <td>{c.pain}/10</td>
                    <td>{c.mobility !== null ? `${c.mobility}%` : '–'}</td>
                    <td className="cell-note">{c.note}</td>
                    <td>
                      <button className="btn icon ghost sm" aria-label="Delete check-in" onClick={() => deleteCheckIn(injury.id, c.id)}>
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function RehabHabits({ injury }: { injury: Injury }) {
  const habits = useStore((s) => s.habits);
  const toggle = useStore((s) => s.toggleHabit);
  const addHabit = useStore((s) => s.addHabit);
  const updateInjury = useHealth((s) => s.updateInjury);
  const healthArea = useHealthArea();
  const today = todayKey();
  const linked = habits.filter((h) => injury.rehabHabitIds.includes(h.id));
  const candidates = habits.filter((h) => !h.archived && !injury.rehabHabitIds.includes(h.id));

  return (
    <div className="detail-section">
      <h3 className="section-title">Rehab routine</h3>
      {linked.length === 0 && <p className="small muted">Link the habits that make up your rehab (exercises, icing, stretches) to see how consistent you've been.</p>}
      {linked.map((h) => {
        const s = currentStrength(h, today);
        return (
          <div key={h.id} className="habit-strength-row">
            {isScheduled(h, today) ? (
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
            <button
              className="btn icon ghost sm"
              aria-label={`Unlink ${h.title}`}
              onClick={() => updateInjury(injury.id, { rehabHabitIds: injury.rehabHabitIds.filter((x) => x !== h.id) })}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        );
      })}
      <div className="row tight wrap">
        {candidates.length > 0 && (
          <select
            className="input sm"
            value=""
            onChange={(e) => e.target.value && updateInjury(injury.id, { rehabHabitIds: [...injury.rehabHabitIds, e.target.value] })}
          >
            <option value="">+ Link an existing habit…</option>
            {candidates.map((h) => (
              <option key={h.id} value={h.id}>
                {h.title}
              </option>
            ))}
          </select>
        )}
        <button
          className="btn sm"
          onClick={() => {
            const id = addHabit({ title: `${injury.bodyPart || injury.name} rehab`, areaId: healthArea?.id ?? null, duration: 15 });
            updateInjury(injury.id, { rehabHabitIds: [...injury.rehabHabitIds, id] });
            navigate(`habits/${id}`);
          }}
        >
          <Icon name="plus" size={14} /> New rehab habit
        </button>
      </div>
    </div>
  );
}
