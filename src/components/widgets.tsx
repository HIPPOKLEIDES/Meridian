import { useState } from 'react';
import { sound } from '../lib/sound';
import type { DateKey, ID, Priority, Task } from '../types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { blockersOf, byId, isOverdue, PRIORITIES, taskArea } from '../lib/tasks';
import { addDays, fmtRange, todayKey } from '../lib/dates';
import { useNow } from '../lib/hooks';
import { AreaDot, AreaSelect, CheckButton, Icon, PriorityBadge } from './common';
import { TaskAssignees } from '../cloud/ui/Assignees';

export function TaskRow({
  task,
  tasks,
  showProject = true,
  priorityEditable = false,
}: {
  task: Task;
  /** Lookup of all tasks, for lock state. */
  tasks: Record<ID, Task>;
  showProject?: boolean;
  priorityEditable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const project = useStore((s) => (task.projectId ? s.projects.find((p) => p.id === task.projectId) : undefined));
  const projects = useStore((s) => s.projects);
  const setStatus = useStore((s) => s.setTaskStatus);
  const toggleSubtask = useStore((s) => s.toggleSubtask);
  const updateTask = useStore((s) => s.updateTask);
  const open = useUI((s) => s.open);
  const blockers = blockersOf(task, tasks);
  const locked = blockers.length > 0 && task.status !== 'done';
  const done = task.status === 'done';
  const subDone = task.subtasks.filter((s) => s.done).length;
  const overdue = isOverdue(task, todayKey());
  const areaId = taskArea(task, byId(projects));

  return (
    <div className={`task-row${done ? ' is-done' : ''}${locked ? ' is-locked' : ''}`}>
      <div className="task-row-main" onClick={() => open({ kind: 'task', id: task.id })}>
        <CheckButton
          checked={done}
          disabled={locked}
          title={locked ? `Locked until ${blockers.map((b) => b.title).join(', ')} ${blockers.length === 1 ? 'is' : 'are'} done` : undefined}
          onToggle={() => setStatus(task.id, done ? 'todo' : 'done')}
        />
        <div className="task-row-text">
          <div className="task-row-title">
            {task.title || 'Untitled task'}
            {task.status === 'doing' && <span className="badge">In progress</span>}
          </div>
          <div className="task-row-meta">
            <AreaDot areaId={areaId} />
            {showProject && project && <span>{project.name}</span>}
            {(task.startDate || task.endDate) && (
              <span className={overdue ? 'is-overdue' : ''}>
                <Icon name="calendar" size={12} /> {fmtRange(task.startDate, task.endDate)}
                {overdue && ' · overdue'}
              </span>
            )}
            {locked && (
              <span>
                <Icon name="lock" size={12} /> after {blockers.map((b) => b.title).join(', ')}
              </span>
            )}
          </div>
        </div>
        <TaskAssignees task={task} />
        {task.subtasks.length > 0 && (
          <button
            type="button"
            className={`subtask-count${expanded ? ' is-open' : ''}`}
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {subDone}/{task.subtasks.length}
            <Icon name="down" size={12} />
          </button>
        )}
        {priorityEditable ? (
          <select
            className={`prio-select prio-${task.priority}`}
            value={task.priority}
            aria-label="Priority"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => updateTask(task.id, { priority: e.target.value as Priority })}
          >
            {PRIORITIES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        ) : (
          <PriorityBadge priority={task.priority} compact />
        )}
      </div>
      {expanded && (
        <div className="task-row-subtasks">
          {task.subtasks.map((st) => (
            <label key={st.id} className={`subtask${st.done ? ' is-done' : ''}`}>
              <CheckButton size="sm" checked={st.done} onToggle={() => toggleSubtask(task.id, st.id)} />
              <span>{st.text}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function QuickAddTask({ defaults, placeholder = 'Add a task and press Enter' }: { defaults: Partial<Task>; placeholder?: string }) {
  const addTask = useStore((s) => s.addTask);
  const [title, setTitle] = useState('');
  return (
    <form
      className="quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        addTask({ ...defaults, title: title.trim() });
        setTitle('');
      }}
    >
      <Icon name="plus" size={14} />
      <input className="input bare" value={title} placeholder={placeholder} onChange={(e) => setTitle(e.target.value)} />
    </form>
  );
}

const fmtElapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function TimerCard() {
  const timer = useStore((s) => s.timer);
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const areas = useStore((s) => s.areas);
  const start = useStore((s) => s.startTimer);
  const stop = useStore((s) => s.stopTimer);
  const discard = useStore((s) => s.discardTimer);
  const now = useNow(1000);
  const [label, setLabel] = useState('');
  const [areaId, setAreaId] = useState<ID | null>(null);
  const [taskId, setTaskId] = useState<ID | null>(null);

  if (timer) {
    const area = areas.find((a) => a.id === timer.areaId);
    return (
      <section className="card timer is-running">
        <div className="timer-live">
          <span className="pulse" style={{ background: area ? `var(--series-${area.slot})` : 'var(--unassigned)' }} />
          <div>
            <div className="timer-label">{timer.label || 'Untitled'}</div>
            <div className="muted small">{area?.name ?? 'No area'} · started {new Date(timer.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
          <span className="timer-elapsed">{fmtElapsed(now.getTime() - timer.startedAt)}</span>
        </div>
        <div className="row tight">
          <button
            className="btn primary"
            onClick={() => {
              sound('stop');
              stop();
            }}
          >
            <Icon name="stop" /> Stop &amp; log
          </button>
          <button className="btn ghost" onClick={discard}>
            Discard
          </button>
        </div>
      </section>
    );
  }

  const openTasks = tasks.filter((t) => t.status !== 'done');
  return (
    <section className="card timer">
      <h3 className="card-title">
        <Icon name="clock" /> Track time
      </h3>
      <form
        className="timer-form"
        onSubmit={(e) => {
          e.preventDefault();
          sound('start');
          start({ label: label.trim(), areaId, taskId });
          setLabel('');
        }}
      >
        <input className="input" placeholder="What are you working on?" value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className="row tight">
          <AreaSelect value={areaId} onChange={setAreaId} />
          <select
            className="input"
            value={taskId ?? ''}
            onChange={(e) => {
              const t = tasks.find((x) => x.id === e.target.value);
              setTaskId(t?.id ?? null);
              if (t) {
                if (!label) setLabel(t.title);
                if (!areaId) setAreaId(taskArea(t, byId(projects)));
              }
            }}
          >
            <option value="">No task</option>
            {openTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <button className="btn primary" type="submit">
            <Icon name="play" /> Start
          </button>
        </div>
      </form>
    </section>
  );
}

export function MiniTimer() {
  const timer = useStore((s) => s.timer);
  const stop = useStore((s) => s.stopTimer);
  const now = useNow(1000);
  if (!timer) return null;
  return (
    <div className="mini-timer">
      <span className="pulse" />
      <div className="mini-timer-text">
        <span className="mini-timer-label">{timer.label || 'Timer'}</span>
        <span className="mini-timer-time">{fmtElapsed(now.getTime() - timer.startedAt)}</span>
      </div>
      <button
        className="btn icon sm"
        onClick={() => {
          sound('stop');
          stop();
        }}
        aria-label="Stop timer"
        title="Stop and log"
      >
        <Icon name="stop" size={14} />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function DateNav({ date, onChange }: { date: DateKey; onChange: (d: DateKey) => void }) {
  return (
    <div className="date-nav">
      <button className="btn icon" aria-label="Previous day" onClick={() => onChange(addDays(date, -1))}>
        <Icon name="left" />
      </button>
      <button className="btn" onClick={() => onChange(todayKey())} disabled={date === todayKey()}>
        Today
      </button>
      <button className="btn icon" aria-label="Next day" onClick={() => onChange(addDays(date, 1))}>
        <Icon name="right" />
      </button>
      <input className="input" type="date" value={date} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </div>
  );
}

