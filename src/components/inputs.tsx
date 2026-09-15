import { useState } from 'react';
import type { CheckItem, DateKey, Minutes } from '../types';
import { WEEKDAY_LETTER, WEEKDAY_SHORT, fmtClock, parseClock } from '../lib/dates';
import { uid } from '../store';
import { CheckButton, Icon } from './common';

export function Checklist({
  items,
  onChange,
  placeholder = 'Add a subtask…',
}: {
  items: CheckItem[];
  onChange: (items: CheckItem[]) => void;
  placeholder?: string;
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

/** Editable list of plain strings (habit steps). */
export function StepList({
  steps,
  onChange,
}: {
  steps: { id: string; text: string }[];
  onChange: (steps: { id: string; text: string }[]) => void;
}) {
  const asItems = steps.map((s) => ({ ...s, done: false }));
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim();
    if (!t) return;
    onChange([...steps, { id: uid(), text: t }]);
    setText('');
  };
  return (
    <div className="checklist">
      {asItems.map((item, i) => (
        <div key={item.id} className="checklist-item">
          <span className="step-num">{i + 1}</span>
          <input
            className="input bare"
            value={item.text}
            onChange={(e) => onChange(steps.map((s) => (s.id === item.id ? { ...s, text: e.target.value } : s)))}
          />
          <button
            type="button"
            className="btn icon ghost sm"
            aria-label="Remove step"
            onClick={() => onChange(steps.filter((s) => s.id !== item.id))}
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
