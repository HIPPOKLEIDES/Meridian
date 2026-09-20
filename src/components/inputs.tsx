import { useState, type ReactNode } from 'react';
import type { CheckItem, DateKey, HabitStep, Minutes } from '../types';
import { WEEKDAY_LETTER, WEEKDAY_SHORT, fmtClock, parseClock } from '../lib/dates';
import { uid } from '../store';
import { CheckButton, Icon } from './common';
import { HABIT_STEP_MINUTES } from '../lib/plan';

export function Checklist({
  items,
  onChange,
  placeholder = 'Add a subtask…',
  trailing,
}: {
  items: CheckItem[];
  onChange: (items: CheckItem[]) => void;
  placeholder?: string;
  /** Extra controls for each item, e.g. its scheduled time. */
  trailing?: (item: CheckItem) => ReactNode;
}) {
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim();
    if (!t) return;
    onChange([...items, { id: uid(), text: t, done: false }]);
    setText('');
  };
  return (
    <div className="checklist">
      {items.map((item) => (
        <div key={item.id} className={`checklist-item${item.done ? ' is-done' : ''}`}>
          <CheckButton
            size="sm"
            checked={item.done}
            onToggle={() => onChange(items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))}
          />
          <input
            className="input bare"
            value={item.text}
            onChange={(e) => onChange(items.map((i) => (i.id === item.id ? { ...i, text: e.target.value } : i)))}
          />
          {trailing?.(item)}
          <button
            type="button"
            className="btn icon ghost sm"
            aria-label="Remove"
            onClick={() => onChange(items.filter((i) => i.id !== item.id))}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
      <div className="checklist-add">
        <Icon name="plus" size={14} />
        <input
          className="input bare"
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      </div>
    </div>
  );
}

/** Editable habit steps, each optionally at its own time of day. */
export function StepList({
  steps,
  onChange,
  defaultStart,
}: {
  steps: HabitStep[];
  onChange: (steps: HabitStep[]) => void;
  /** Where a step's clock starts when you first give it a time. */
  defaultStart?: Minutes;
}) {
  const [text, setText] = useState('');
  const patch = (id: string, change: Partial<HabitStep>) => onChange(steps.map((s) => (s.id === id ? { ...s, ...change } : s)));
  const add = () => {
    const t = text.trim();
    if (!t) return;
    onChange([...steps, { id: uid(), text: t }]);
    setText('');
  };
  // Each new time follows on from the last one that has a time.
  const nextStart = (index: number) => {
    for (let i = index - 1; i >= 0; i--) {
      const prev = steps[i];
      if (prev.start !== null && prev.start !== undefined) return Math.min(1435, prev.start + Math.max(5, prev.duration ?? HABIT_STEP_MINUTES));
    }
    return defaultStart ?? 7 * 60;
  };
  return (
    <div className="checklist">
      {steps.map((step, i) => (
        <div key={step.id} className="checklist-item">
          <span className="step-num">{i + 1}</span>
          <input className="input bare" value={step.text} onChange={(e) => patch(step.id, { text: e.target.value })} />
          {step.start === null || step.start === undefined ? (
            <button
              type="button"
              className="btn icon ghost sm"
              aria-label={`Give “${step.text}” a time`}
              title="Give this step a time"
              onClick={() => patch(step.id, { start: nextStart(i), duration: step.duration ?? HABIT_STEP_MINUTES })}
            >
              <Icon name="clock" size={14} />
            </button>
          ) : (
            <span className="step-time">
              <TimeInput value={step.start} onChange={(start) => patch(step.id, { start })} />
              <input
                className="input sm step-minutes"
                type="number"
                min={5}
                step={5}
                aria-label={`Minutes for “${step.text}”`}
                value={step.duration ?? HABIT_STEP_MINUTES}
                onChange={(e) => patch(step.id, { duration: Math.max(5, Number(e.target.value) || 5) })}
              />
              <span className="muted small step-min-label">min</span>
              <button
                type="button"
                className="btn icon ghost sm"
                aria-label={`Remove the time from “${step.text}”`}
                title="Any time during the habit"
                onClick={() => patch(step.id, { start: null })}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          )}
          <button type="button" className="btn icon ghost sm" aria-label="Remove step" onClick={() => onChange(steps.filter((s) => s.id !== step.id))}>
            <Icon name="trash" size={14} />
          </button>
        </div>
      ))}
      <div className="checklist-add">
        <Icon name="plus" size={14} />
        <input
          className="input bare"
          value={text}
          placeholder="Add a step…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      </div>
    </div>
  );
}

export function DayPicker({ days, onChange }: { days: number[]; onChange: (days: number[]) => void }) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const set = new Set(days);
  return (
    <div className="daypicker">
      <div className="daypicker-days">
        {order.map((d) => (
          <button
            key={d}
            type="button"
            className={set.has(d) ? 'is-on' : ''}
            aria-pressed={set.has(d)}
            title={WEEKDAY_SHORT[d]}
            onClick={() => onChange(set.has(d) ? days.filter((x) => x !== d) : [...days, d].sort())}
          >
            {WEEKDAY_LETTER[d]}
          </button>
        ))}
      </div>
      <div className="daypicker-presets">
        <button type="button" className="link" onClick={() => onChange([0, 1, 2, 3, 4, 5, 6])}>
          Every day
        </button>
        <button type="button" className="link" onClick={() => onChange([1, 2, 3, 4, 5])}>
          Weekdays
        </button>
        <button type="button" className="link" onClick={() => onChange([0, 6])}>
          Weekends
        </button>
      </div>
    </div>
  );
}

/** `<input type="time">` bound to minutes. As an end time, 00:00 means midnight at the end of the day. */
export function TimeInput({
  value,
  onChange,
  isEnd,
}: {
  value: Minutes;
  onChange: (m: Minutes) => void;
  isEnd?: boolean;
}) {
  return (
    <input
      className="input"
      type="time"
      step={300}
      value={fmtClock(value >= 1440 ? 0 : value)}
      onChange={(e) => {
        const m = parseClock(e.target.value);
        if (m === null) return;
        onChange(isEnd && m === 0 ? 1440 : m);
      }}
    />
  );
}

export function DateInput({
  value,
  onChange,
}: {
  value: DateKey | null;
  onChange: (d: DateKey | null) => void;
}) {
  return (
    <input className="input" type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
  );
}
