import { useMemo, useState } from 'react';
import type { DateKey, Habit, ID, Project, Task, TaskStatus, TimeBlock, TimeEntry } from '../types';
import { newBlock, newEntry, newHabit, newProject, newTask, useStore } from '../store';
import { useUI, type Dialog } from '../ui';
import { byId, blockersOf, dependentsOf, PRIORITIES, taskArea, wouldCycle } from '../lib/tasks';
import { fmtClock, fmtDuration, todayKey } from '../lib/dates';
import { useNotes } from '../notes/store';
import { AreaSelect, Field, Icon, Modal, PriorityBadge, Segmented } from './common';
import { Checklist, DateInput, DayPicker, StepList, TimeInput } from './inputs';
import { AssigneePicker } from '../cloud/ui/Assignees';

export function DialogHost() {
  const dialog = useUI((s) => s.dialog);
  if (!dialog) return null;
  // Keyed so switching between two items of the same kind remounts with fresh draft state.
  const key = `${dialog.kind}:${dialog.id ?? 'new'}`;
  return <DialogSwitch key={key} dialog={dialog} />;
}

function DialogSwitch({ dialog }: { dialog: Dialog }) {
  switch (dialog.kind) {
    case 'task':
      return <TaskEditor id={dialog.id} draft={dialog.draft} />;
    case 'habit':
      return <HabitEditor id={dialog.id} draft={dialog.draft} />;
    case 'block':
      return <BlockEditor id={dialog.id} draft={dialog.draft} on={dialog.on} />;
    case 'entry':
      return <EntryEditor id={dialog.id} draft={dialog.draft} />;
    case 'project':
      return <ProjectEditor id={dialog.id} draft={dialog.draft} />;
  }
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'doing', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

function TaskEditor({ id, draft }: { id: ID | null; draft?: Partial<Task> }) {
  const store = useStore();
  const close = useUI((s) => s.close);
  const existing = id ? store.tasks.find((t) => t.id === id) : undefined;
  const [t, setT] = useState<Task>(() => (existing ? structuredClone(existing) : newTask(draft)));
  const set = (patch: Partial<Task>) => setT((prev) => ({ ...prev, ...patch }));

  const map = useMemo(() => ({ ...byId(store.tasks), [t.id]: t }), [store.tasks, t]);
  const projects = byId(store.projects);
  const blockers = blockersOf(t, map);
  const dependents = existing ? dependentsOf(t.id, store.tasks) : [];
  const candidates = store.tasks
    .filter((c) => c.id !== t.id && !t.dependsOn.includes(c.id))
    .filter((c) => (t.projectId ? c.projectId === t.projectId : true))
    .filter((c) => !wouldCycle(map, t.id, c.id));
  const logged = store.entries.filter((e) => e.taskId === t.id).reduce((sum, e) => sum + e.end - e.start, 0);
  const inheritedArea = t.projectId ? projects[t.projectId]?.areaId : null;

  if (id && !existing) return null;

  const save = () => {
    let { startDate, endDate } = t;
    if (startDate && !endDate) endDate = startDate;
    if (endDate && !startDate) startDate = endDate;
    if (startDate && endDate && endDate < startDate) [startDate, endDate] = [endDate, startDate];
    const final: Task = { ...t, title: t.title.trim() || 'Untitled task', startDate, endDate };
    if (existing) store.updateTask(t.id, final);
    else store.addTask(final);
    close();
  };

  return (
    <Modal
      title={existing ? 'Edit task' : 'New task'}
      onClose={close}
      wide
      footer={
        <>
          {existing && (
            <button
              className="btn danger ghost"
              onClick={() => {
                if (confirm(`Delete “${existing.title}”?`)) {
                  store.deleteTask(existing.id);
                  close();
                }
              }}
            >
              <Icon name="trash" /> Delete
            </button>
          )}
          {existing && (
            <button
              className="btn ghost"
              onClick={() => {
                store.startTimer({ label: t.title, areaId: taskArea(t, projects), taskId: t.id });
                close();
              }}
            >
              <Icon name="play" /> Track time
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            {existing ? 'Save' : 'Create task'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-main">
          <input
            className="input title-input"
            autoFocus={!existing}
            placeholder="Task name"
            value={t.title}
            onChange={(e) => set({ title: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <textarea
            className="input"
            rows={3}
            placeholder="Notes"
            value={t.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
          <div className="field">
            <span className="field-label">
              Subtasks
              {t.subtasks.length > 0 && (
                <span className="muted">
                  {' '}
                  · {t.subtasks.filter((s) => s.done).length}/{t.subtasks.length}
                </span>
              )}
            </span>
            <Checklist items={t.subtasks} onChange={(subtasks) => set({ subtasks })} />
          </div>

          <div className="field">
            <span className="field-label">Unlocks after</span>
            {blockers.length > 0 && t.status !== 'done' && (
              <div className="notice">
                <Icon name="lock" size={14} /> Locked until {blockers.map((b) => `“${b.title}”`).join(', ')}{' '}
                {blockers.length === 1 ? 'is' : 'are'} done.
              </div>
            )}
            <div className="chips">
              {t.dependsOn.map((depId) => {
                const dep = map[depId];
                if (!dep) return null;
                return (
                  <span key={depId} className={`chip${dep.status === 'done' ? ' is-done' : ''}`}>
                    {dep.status === 'done' ? <Icon name="check" size={12} /> : <Icon name="lock" size={12} />}
                    {dep.title}
                    <button
                      type="button"
                      aria-label={`Remove ${dep.title}`}
                      onClick={() => set({ dependsOn: t.dependsOn.filter((d) => d !== depId) })}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                );
              })}
              {candidates.length > 0 && (
                <select
                  className="input sm"
                  value=""
                  onChange={(e) => e.target.value && set({ dependsOn: [...t.dependsOn, e.target.value] })}
                >
                  <option value="">+ Add prerequisite…</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              )}
              {!candidates.length && !t.dependsOn.length && (
                <span className="muted small">{t.projectId ? 'No other tasks in this project yet.' : 'No other tasks yet.'}</span>
              )}
            </div>
            {dependents.length > 0 && (
              <span className="field-hint">Completing this unlocks: {dependents.map((d) => d.title).join(', ')}</span>
            )}
          </div>
        </div>

        <div className="form-side">
          <Field label="Status">
            <Segmented value={t.status} options={STATUS_OPTIONS} onChange={(status) => set({ status })} />
          </Field>
          <Field label="Priority">
            <Segmented
              value={t.priority}
              options={PRIORITIES.map((p) => ({ value: p.id, label: <PriorityBadge priority={p.id} /> }))}
              onChange={(priority) => set({ priority })}
            />
          </Field>
          <Field label="Project">
            <select
              className="input"
              value={t.projectId ?? ''}
              onChange={(e) => set({ projectId: e.target.value || null, flow: null })}
            >
              <option value="">No project</option>
              {store.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <AssigneePicker projectId={t.projectId} value={t.assigneeIds ?? []} onChange={(assigneeIds) => set({ assigneeIds })} />
          <Field label="Area">
            <AreaSelect
              value={t.areaId}
              onChange={(areaId) => set({ areaId })}
              emptyLabel={
                inheritedArea
                  ? `From project (${store.areas.find((a) => a.id === inheritedArea)?.name ?? '—'})`
                  : 'No area'
              }
            />
          </Field>
          <div className="row">
            <Field label="Starts">
              <DateInput value={t.startDate} onChange={(startDate) => set({ startDate })} />
            </Field>
            <Field label="Ends">
              <DateInput value={t.endDate} onChange={(endDate) => set({ endDate })} />
            </Field>
          </div>
          {(t.startDate || t.endDate) && (
            <button type="button" className="link small" onClick={() => set({ startDate: null, endDate: null })}>
              Clear dates
            </button>
          )}
          {logged > 0 && <p className="muted small">Time logged: {fmtDuration(logged)}</p>}
        </div>
      </div>
    </Modal>
  );
}

function HabitEditor({ id, draft }: { id: ID | null; draft?: Partial<Habit> }) {
  const store = useStore();
  const close = useUI((s) => s.close);
  const existing = id ? store.habits.find((h) => h.id === id) : undefined;
  const [h, setH] = useState<Habit>(() => (existing ? structuredClone(existing) : newHabit(draft)));
  const set = (patch: Partial<Habit>) => setH((prev) => ({ ...prev, ...patch }));
  if (id && !existing) return null;

  const save = () => {
    const final = { ...h, title: h.title.trim() || 'Untitled habit' };
    if (existing) store.updateHabit(h.id, final);
    else store.addHabit(final);
    close();
  };

  return (
    <Modal
      title={existing ? 'Edit habit' : 'New habit'}
      onClose={close}
      footer={
        <>
          {existing && (
            <button
              className="btn danger ghost"
              onClick={() => {
                if (confirm(`Delete “${existing.title}” and its history?`)) {
                  store.deleteHabit(existing.id);
                  close();
                }
              }}
            >
              <Icon name="trash" /> Delete
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            {existing ? 'Save' : 'Create habit'}
          </button>
        </>
      }
    >
      <div className="stack">
        <input
          className="input title-input"
          autoFocus={!existing}
          placeholder="Habit, e.g. Morning run"
          value={h.title}
          onChange={(e) => set({ title: e.target.value })}
        />
        <Field label="Repeats on">
          <DayPicker days={h.days} onChange={(days) => set({ days })} />
        </Field>
        <div className="row">
          <Field label="Time of day">
            <div className="row tight">
              <select
                className="input"
                value={h.start === null ? 'any' : 'set'}
                onChange={(e) => set({ start: e.target.value === 'any' ? null : 7 * 60 })}
              >
                <option value="any">Any time</option>
                <option value="set">At a set time</option>
              </select>
              {h.start !== null && <TimeInput value={h.start} onChange={(start) => set({ start })} />}
            </div>
          </Field>
          <Field label="Duration (min)">
            <input
              className="input"
              type="number"
              min={0}
              step={5}
              value={h.duration}
              onChange={(e) => set({ duration: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Field>
        </div>
        <div className="row">
          <Field label="Area">
            <AreaSelect value={h.areaId} onChange={(areaId) => set({ areaId })} />
          </Field>
          <Field label="Tracking since">
            <DateInput value={h.startDate} onChange={(d) => set({ startDate: d ?? todayKey() })} />
          </Field>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={h.logTime} onChange={(e) => set({ logTime: e.target.checked })} />
          Log {fmtDuration(h.duration)} to its area each time it's checked off
        </label>
        <Field label="Steps" hint="Checking every step completes the habit for the day.">
          <StepList steps={h.steps} onChange={(steps) => set({ steps })} />
        </Field>
        <textarea
          className="input"
          rows={2}
          placeholder="Notes, e.g. why this habit matters"
          value={h.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
        {existing && (
          <label className="toggle">
            <input type="checkbox" checked={h.archived} onChange={(e) => set({ archived: e.target.checked })} />
            Archived (hidden from today and the clock)
          </label>
        )}
      </div>
    </Modal>
  );
}

function TaskLinkSelect({ value, onChange }: { value: ID | null; onChange: (task: Task | null) => void }) {
  const tasks = useStore((s) => s.tasks);
  const open = tasks.filter((t) => t.status !== 'done' || t.id === value);
  return (
    <select
      className="input"
      value={value ?? ''}
      onChange={(e) => onChange(tasks.find((t) => t.id === e.target.value) ?? null)}
    >
      <option value="">No task</option>
      {open.map((t) => (
        <option key={t.id} value={t.id}>
          {t.title}
        </option>
      ))}
    </select>
  );
}

function BlockEditor({ id, draft, on }: { id: ID | null; draft?: Partial<TimeBlock>; on?: DateKey }) {
  const store = useStore();
  const close = useUI((s) => s.close);
  const toast = useUI((s) => s.toast);
  const existing = id ? store.blocks.find((b) => b.id === id) : undefined;
  const [b, setB] = useState<TimeBlock>(() => (existing ? structuredClone(existing) : newBlock(draft)));
  const set = (patch: Partial<TimeBlock>) => setB((prev) => ({ ...prev, ...patch }));
  const projects = byId(store.projects);
  if (id && !existing) return null;

  const valid = b.end > b.start;
  const save = () => {
    if (!valid) return;
    const final = { ...b, title: b.title.trim() || 'Untitled block' };
    if (existing) store.updateBlock(b.id, final);
    else store.addBlock(final);
    close();
  };

  return (
    <Modal
      title={existing ? 'Edit time block' : 'Block out time'}
      onClose={close}
      footer={
        <>
          {existing && (
            <button
              className="btn danger ghost"
              onClick={() => {
                store.deleteBlock(existing.id);
                close();
              }}
            >
              <Icon name="trash" /> Delete
            </button>
          )}
          {existing && (
            <button
              className="btn ghost"
              title="Record this block as time actually spent"
              onClick={() => {
                store.addEntry({
                  label: b.title,
                  date: on ?? b.date,
                  start: b.start,
                  end: b.end,
                  areaId: b.areaId,
                  taskId: b.taskId,
                });
                toast(`Logged ${fmtDuration(b.end - b.start)} for “${b.title}”`);
                close();
              }}
            >
              <Icon name="check" /> Log as spent
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={!valid}>
            {existing ? 'Save' : 'Add block'}
          </button>
        </>
      }
    >
      <div className="stack">
        <input
          className="input title-input"
          autoFocus={!existing}
          placeholder="What is this time for?"
          value={b.title}
          onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <div className="row">
          <Field label={b.repeatDays.length ? 'Starting' : 'Date'}>
            <DateInput value={b.date} onChange={(date) => date && set({ date })} />
          </Field>
          <Field label="From">
            <TimeInput value={b.start} onChange={(start) => set({ start })} />
          </Field>
          <Field label="To">
            <TimeInput value={b.end} isEnd onChange={(end) => set({ end })} />
          </Field>
        </div>
        {!valid && <div className="notice">The block must end after it starts (it can't cross midnight).</div>}
        <Field label="Repeat on" hint={b.repeatDays.length ? 'Edits apply to every occurrence.' : 'Leave empty for a one-off block.'}>
          <DayPicker days={b.repeatDays} onChange={(repeatDays) => set({ repeatDays })} />
        </Field>
        <div className="row">
          <Field label="Area">
            <AreaSelect value={b.areaId} onChange={(areaId) => set({ areaId })} />
          </Field>
          <Field label="For task">
            <TaskLinkSelect
              value={b.taskId}
              onChange={(task) =>
                set({
                  taskId: task?.id ?? null,
                  title: b.title || task?.title || '',
                  areaId: b.areaId ?? (task ? taskArea(task, projects) : null),
                })
              }
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function EntryEditor({ id, draft }: { id: ID | null; draft?: Partial<TimeEntry> }) {
  const store = useStore();
  const close = useUI((s) => s.close);
  const existing = id ? store.entries.find((e) => e.id === id) : undefined;
  const [en, setEn] = useState<TimeEntry>(() => (existing ? structuredClone(existing) : newEntry(draft)));
  const set = (patch: Partial<TimeEntry>) => setEn((prev) => ({ ...prev, ...patch }));
  const projects = byId(store.projects);
  const habit = en.habitId ? store.habits.find((h) => h.id === en.habitId) : undefined;
  if (id && !existing) return null;

  const valid = en.end > en.start;
  const save = () => {
    if (!valid) return;
    const final = { ...en, label: en.label.trim() || 'Untitled' };
    if (existing) store.updateEntry(en.id, final);
    else store.addEntry(final);
    close();
  };

  return (
    <Modal
      title={existing ? 'Edit logged time' : 'Log time'}
      onClose={close}
      footer={
        <>
          {existing && (
            <button
              className="btn danger ghost"
              onClick={() => {
                store.deleteEntry(existing.id);
                close();
              }}
            >
              <Icon name="trash" /> Delete
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={!valid}>
            {existing ? 'Save' : 'Log time'}
          </button>
        </>
      }
    >
      <div className="stack">
        <input
          className="input title-input"
          autoFocus={!existing}
          placeholder="What did you spend time on?"
          value={en.label}
          onChange={(e) => set({ label: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <div className="row">
          <Field label="Date">
            <DateInput value={en.date} onChange={(date) => date && set({ date })} />
          </Field>
          <Field label="From">
            <TimeInput value={en.start} onChange={(start) => set({ start })} />
          </Field>
          <Field label="To">
            <TimeInput value={en.end} isEnd onChange={(end) => set({ end })} />
          </Field>
        </div>
        <p className="muted small">
          {valid ? `${fmtClock(en.start)}–${fmtClock(en.end)} · ${fmtDuration(en.end - en.start)}` : 'End must be after start.'}
          {habit && ` · Logged automatically by the habit “${habit.title}”`}
        </p>
        <div className="row">
          <Field label="Area">
            <AreaSelect value={en.areaId} onChange={(areaId) => set({ areaId })} />
          </Field>
          <Field label="For task">
            <TaskLinkSelect
              value={en.taskId}
              onChange={(task) =>
                set({
                  taskId: task?.id ?? null,
                  label: en.label || task?.title || '',
                  areaId: en.areaId ?? (task ? taskArea(task, projects) : null),
                })
              }
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function ProjectEditor({ id, draft }: { id: ID | null; draft?: Partial<Project> }) {
  const store = useStore();
  const close = useUI((s) => s.close);
  const existing = id ? store.projects.find((p) => p.id === id) : undefined;
  const [p, setP] = useState<Project>(() => (existing ? structuredClone(existing) : newProject(draft)));
  const set = (patch: Partial<Project>) => setP((prev) => ({ ...prev, ...patch }));
  if (id && !existing) return null;

  const save = () => {
    const final = { ...p, name: p.name.trim() || 'Untitled project' };
    if (existing) store.updateProject(p.id, final);
    else {
      store.addProject(final);
      window.location.hash = `#/projects/${final.id}`;
    }
    close();
  };

  const remove = () => {
    if (!existing) return;
    const count = store.tasks.filter((t) => t.projectId === existing.id).length;
    const noteCount = useNotes.getState().notes.filter((n) => n.projectId === existing.id).length;
    if (!confirm(`Delete the project “${existing.name}”${noteCount ? ` and its ${noteCount} note${noteCount === 1 ? '' : 's'}` : ''}?`)) return;
    const withTasks = count > 0 && confirm(`Also delete its ${count} task${count === 1 ? '' : 's'}? Cancel keeps them as unassigned tasks.`);
    store.deleteProject(existing.id, withTasks);
    useNotes.getState().deleteProjectNotes(existing.id);
    window.location.hash = '#/projects';
    close();
  };

  return (
    <Modal
      title={existing ? 'Edit project' : 'New project'}
      onClose={close}
      footer={
        <>
          {existing && (
            <button className="btn danger ghost" onClick={remove}>
              <Icon name="trash" /> Delete
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            {existing ? 'Save' : 'Create project'}
          </button>
        </>
      }
    >
      <div className="stack">
        <input
          className="input title-input"
          autoFocus={!existing}
          placeholder="Project name"
          value={p.name}
          onChange={(e) => set({ name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <textarea
          className="input"
          rows={3}
          placeholder="What does done look like?"
          value={p.description}
          onChange={(e) => set({ description: e.target.value })}
        />
        <Field label="Priority">
          <Segmented
            value={p.priority}
            options={PRIORITIES.map((x) => ({ value: x.id, label: x.label }))}
            onChange={(priority) => set({ priority })}
          />
        </Field>
        <div className="row">
          <Field label="Area" hint="Tasks without their own area count toward this one.">
            <AreaSelect value={p.areaId} onChange={(areaId) => set({ areaId })} />
          </Field>
          <Field label="Status">
            <select
              className="input"
              value={p.status}
              onChange={(e) => set({ status: e.target.value as Project['status'] })}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="done">Done</option>
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}
