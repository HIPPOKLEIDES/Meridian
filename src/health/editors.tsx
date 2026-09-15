import { useState } from 'react';
import type { ID } from '../types';
import type { HealthGoal, Injury, Metric } from './types';
import { newGoal, newInjury, newMetric, useHealth } from './store';
import { Field, Icon, Modal, Segmented } from '../components/common';
import { DateInput } from '../components/inputs';
import { todayKey } from '../lib/dates';

function Footer({ onDelete, onCancel, onSave, saveLabel }: { onDelete?: () => void; onCancel: () => void; onSave: () => void; saveLabel: string }) {
  return (
    <>
      {onDelete && (
        <button className="btn danger ghost" onClick={onDelete}>
          <Icon name="trash" /> Delete
        </button>
      )}
      <span className="spacer" />
      <button className="btn" onClick={onCancel}>
        Cancel
      </button>
      <button className="btn primary" onClick={onSave}>
        {saveLabel}
      </button>
    </>
  );
}

const numberOr = (s: string, fallback: number | null) => (s.trim() === '' || Number.isNaN(Number(s)) ? fallback : Number(s));

export function MetricEditor({ id, onClose }: { id: ID | null; onClose: (savedId?: ID) => void }) {
  const store = useHealth();
  const existing = id ? store.metrics.find((m) => m.id === id) : undefined;
  const [m, setM] = useState<Metric>(() => (existing ? { ...existing } : newMetric()));
  const set = (p: Partial<Metric>) => setM((prev) => ({ ...prev, ...p }));
  const save = () => {
    const final = { ...m, name: m.name.trim() || 'Untitled metric' };
    if (existing) store.updateMetric(m.id, final);
    else store.addMetric(final);
    onClose(final.id);
  };
  return (
    <Modal
      title={existing ? 'Edit measurement type' : 'New measurement type'}
      onClose={() => onClose()}
      footer={
        <Footer
          saveLabel={existing ? 'Save' : 'Create'}
          onCancel={() => onClose()}
          onSave={save}
          onDelete={
            existing
              ? () => {
                  if (confirm(`Delete “${existing.name}”, all its readings and goals?`)) {
                    store.deleteMetric(existing.id);
                    onClose();
                  }
                }
              : undefined
          }
        />
      }
    >
      <div className="stack">
        <input
          className="input title-input"
          autoFocus={!existing}
          placeholder="e.g. Waist, Bench press 1RM, Blood pressure (systolic)"
          value={m.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        <div className="row">
          <Field label="Unit">
            <input className="input" placeholder="lb, cm, min…" value={m.unit} onChange={(e) => set({ unit: e.target.value })} />
          </Field>
          <Field label="Decimals">
            <input className="input" type="number" min={0} max={3} value={m.decimals} onChange={(e) => set({ decimals: Math.max(0, Math.min(3, Number(e.target.value) || 0)) })} />
          </Field>
        </div>
        <Field label="Better when it">
          <Segmented
            value={m.direction}
            onChange={(direction) => set({ direction })}
            options={[
              { value: 'increase', label: 'Goes up' },
              { value: 'decrease', label: 'Goes down' },
              { value: 'neutral', label: 'Depends on the goal' },
            ]}
          />
        </Field>
        <Field label="Several readings in one day" hint="Steps or water add up; weight keeps the last reading.">
          <Segmented
            value={m.aggregate}
            onChange={(aggregate) => set({ aggregate })}
            options={[
              { value: 'last', label: 'Keep the last' },
              { value: 'avg', label: 'Average them' },
              { value: 'sum', label: 'Add them up' },
            ]}
          />
        </Field>
      </div>
    </Modal>
  );
}

export function GoalEditor({ id, metricId, onClose }: { id: ID | null; metricId?: ID; onClose: () => void }) {
  const store = useHealth();
  const existing = id ? store.goals.find((g) => g.id === id) : undefined;
  const [g, setG] = useState<HealthGoal>(() => (existing ? { ...existing } : newGoal({ metricId: metricId ?? store.metrics[0]?.id })));
  const [targetText, setTargetText] = useState(existing ? String(existing.target) : '');
  const set = (p: Partial<HealthGoal>) => setG((prev) => ({ ...prev, ...p }));
  const metric = store.metrics.find((m) => m.id === g.metricId);
  const target = numberOr(targetText, null);
  const save = () => {
    if (target === null) return;
    const final = { ...g, target };
    if (existing) store.updateGoal(g.id, final);
    else store.addGoal(final);
    onClose();
  };
  return (
    <Modal
      title={existing ? 'Edit goal' : 'New health goal'}
      onClose={onClose}
      footer={
        <Footer
          saveLabel={existing ? 'Save' : 'Create goal'}
          onCancel={onClose}
          onSave={save}
          onDelete={
            existing
              ? () => {
                  store.deleteGoal(existing.id);
                  onClose();
                }
              : undefined
          }
        />
      }
    >
      <div className="stack">
        <div className="row">
          <Field label="Measurement">
            <select className="input" value={g.metricId} onChange={(e) => set({ metricId: e.target.value })}>
              {store.metrics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Target${metric?.unit ? ` (${metric.unit})` : ''}`}>
            <input className="input" inputMode="decimal" autoFocus value={targetText} onChange={(e) => setTargetText(e.target.value)} />
          </Field>
        </div>
        <Field label="Kind of goal">
          <Segmented
            value={g.kind}
            onChange={(kind) => set({ kind })}
            options={[
              { value: 'reach', label: 'Reach a value' },
              { value: 'average', label: 'Keep a 7-day average' },
            ]}
          />
        </Field>
        <div className="row">
          <Field label="Measure progress from">
            <DateInput value={g.startDate} onChange={(d) => set({ startDate: d ?? todayKey() })} />
          </Field>
          <Field label="Deadline (optional)">
            <DateInput value={g.deadline} onChange={(deadline) => set({ deadline })} />
          </Field>
        </div>
        <textarea className="input" rows={2} placeholder="Why it matters" value={g.note} onChange={(e) => set({ note: e.target.value })} />
        {existing && (
          <label className="toggle">
            <input type="checkbox" checked={g.archived} onChange={(e) => set({ archived: e.target.checked })} /> Archived
          </label>
        )}
      </div>
    </Modal>
  );
}

export function InjuryEditor({ id, onClose }: { id: ID | null; onClose: () => void }) {
  const store = useHealth();
  const existing = id ? store.injuries.find((i) => i.id === id) : undefined;
  const [inj, setInj] = useState<Injury>(() => (existing ? { ...existing } : newInjury()));
  const set = (p: Partial<Injury>) => setInj((prev) => ({ ...prev, ...p }));
  const save = () => {
    const final = { ...inj, name: inj.name.trim() || 'Injury' };
    if (existing) store.updateInjury(inj.id, final);
    else store.addInjury(final);
    onClose();
  };
  return (
    <Modal
      title={existing ? 'Edit injury' : 'Log an injury'}
      onClose={onClose}
      footer={
        <Footer
          saveLabel={existing ? 'Save' : 'Add injury'}
          onCancel={onClose}
          onSave={save}
          onDelete={
            existing
              ? () => {
                  if (confirm(`Delete “${existing.name}” and its check-ins?`)) {
                    store.deleteInjury(existing.id);
                    onClose();
                  }
                }
              : undefined
          }
        />
      }
    >
      <div className="stack">
        <input className="input title-input" autoFocus={!existing} placeholder="What happened? e.g. Strained hamstring" value={inj.name} onChange={(e) => set({ name: e.target.value })} />
        <div className="row">
          <Field label="Where">
            <input className="input" placeholder="Left knee" value={inj.bodyPart} onChange={(e) => set({ bodyPart: e.target.value })} />
          </Field>
          <Field label="Started">
            <DateInput value={inj.startedOn} onChange={(d) => set({ startedOn: d ?? todayKey() })} />
          </Field>
          <Field label="Expected recovery (weeks)">
            <input
              className="input"
              type="number"
              min={0}
              step={0.5}
              value={inj.expectedWeeks ?? ''}
              onChange={(e) => set({ expectedWeeks: numberOr(e.target.value, null) })}
            />
          </Field>
        </div>
        <div className="row">
          <Field label="Status">
            <select
              className="input"
              value={inj.status}
              onChange={(e) => {
                const status = e.target.value as Injury['status'];
                set({ status, healedOn: status === 'healed' ? inj.healedOn ?? todayKey() : null });
              }}
            >
              <option value="active">Active</option>
              <option value="recovering">Recovering</option>
              <option value="healed">Healed</option>
            </select>
          </Field>
          {inj.status === 'healed' && (
            <Field label="Healed on">
              <DateInput value={inj.healedOn} onChange={(healedOn) => set({ healedOn })} />
            </Field>
          )}
        </div>
        <Field label="Avoid while healing">
          <input className="input" placeholder="Running downhill, heavy squats" value={inj.avoid} onChange={(e) => set({ avoid: e.target.value })} />
        </Field>
        <textarea className="input" rows={3} placeholder="Diagnosis, treatment plan, what helps" value={inj.notes} onChange={(e) => set({ notes: e.target.value })} />
      </div>
    </Modal>
  );
}
