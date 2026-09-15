import { useMemo, useState } from 'react';
import type { Project, Task } from '../types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { AreaSelect, Empty, Icon, Segmented } from '../components/common';
import { QuickAddTask, TaskRow } from '../components/widgets';
import { byId, compareTasks, isOverdue, PRIORITIES, taskArea, taskSpan } from '../lib/tasks';
import { addDays, todayKey } from '../lib/dates';
import { useTasksForMe } from '../cloud/ui/Assignees';

type StatusFilter = 'open' | 'done' | 'all';
type GroupBy = 'priority' | 'project' | 'date';

export function TasksView() {
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const open = useUI((s) => s.open);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('open');
  const [projectId, setProjectId] = useState<string>('all');
  const [areaId, setAreaId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('priority');
  const [everyone, setEveryone] = useState(false);
  const mine = useTasksForMe(tasks);
  const anyShared = mine.length !== tasks.length;

  const map = useMemo(() => byId(tasks), [tasks]);
  const projectMap = useMemo(() => byId(projects), [projects]);

  const filtered = (everyone ? tasks : mine)
    .filter((t) => (status === 'all' ? true : status === 'done' ? t.status === 'done' : t.status !== 'done'))
    .filter((t) => (projectId === 'all' ? true : projectId === 'none' ? !t.projectId : t.projectId === projectId))
    .filter((t) => (areaId ? taskArea(t, projectMap) === areaId : true))
    .filter((t) => {
      const q = query.trim().toLowerCase();
      const tagQuery = q.replace(/^#/, '');
      return (
        !q ||
        t.title.toLowerCase().includes(q) ||
        t.notes.toLowerCase().includes(q) ||
        t.subtasks.some((s) => s.text.toLowerCase().includes(q)) ||
        (t.tags ?? []).some((tag) => tag.toLowerCase().includes(tagQuery))
      );
    })
    .sort(compareTasks);

  const groups = groupTasks(filtered, groupBy, projectMap);
  const defaults: Partial<Task> = {
    projectId: projectId !== 'all' && projectId !== 'none' ? projectId : null,
    areaId,
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Tasks</h1>
          <p className="page-sub">
            {tasks.filter((t) => t.status !== 'done').length} open · {tasks.filter((t) => t.status === 'done').length} done
          </p>
        </div>
        <button className="btn primary" onClick={() => open({ kind: 'task', id: null, draft: defaults })}>
          <Icon name="plus" /> New task
        </button>
      </header>

      <div className="toolbar">
        <input className="input search" placeholder="Search tasks…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {anyShared && (
          <Segmented
            value={everyone ? 'everyone' : 'mine'}
            onChange={(v) => setEveryone(v === 'everyone')}
            options={[
              { value: 'mine', label: 'Mine', title: 'Your tasks, plus tasks assigned to you in shared projects' },
              { value: 'everyone', label: 'Everyone’s' },
            ]}
          />
        )}
        <Segmented<StatusFilter>
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'done', label: 'Done' },
            { value: 'all', label: 'All' },
          ]}
        />
        <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="all">All projects</option>
          <option value="none">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <AreaSelect value={areaId} onChange={setAreaId} emptyLabel="All areas" />
        <span className="spacer" />
        <label className="inline-label">
          Group by
          <Segmented<GroupBy>
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: 'priority', label: 'Priority' },
              { value: 'project', label: 'Project' },
              { value: 'date', label: 'Date' },
            ]}
          />
        </label>
      </div>

      <section className="card">
        <QuickAddTask defaults={defaults} />
        {filtered.length === 0 ? (
          <Empty>{tasks.length ? 'No tasks match these filters.' : 'No tasks yet. Add one above.'}</Empty>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="task-group">
              <div className="group-label">
                {g.label} <span className="muted">{g.items.length}</span>
              </div>
              {g.items.map((t) => (
                <TaskRow key={t.id} task={t} tasks={map} showProject={groupBy !== 'project'} />
              ))}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function groupTasks(tasks: Task[], by: GroupBy, projects: Record<string, Project>) {
  const groups = new Map<string, Task[]>();
  const push = (label: string, t: Task) => groups.set(label, [...(groups.get(label) ?? []), t]);
  if (by === 'priority') {
    for (const p of PRIORITIES) groups.set(p.label, []);
    for (const t of tasks) push(PRIORITIES.find((p) => p.id === t.priority)!.label, t);
  } else if (by === 'project') {
    for (const t of tasks) push(t.projectId ? projects[t.projectId]?.name ?? 'Unknown project' : 'No project', t);
  } else {
    const today = todayKey();
    const weekEnd = addDays(today, 7);
    for (const label of ['Overdue', 'Today', 'Next 7 days', 'Later', 'Unscheduled', 'Done']) groups.set(label, []);
    for (const t of tasks) {
      const span = taskSpan(t);
      if (t.status === 'done') push('Done', t);
      else if (!span) push('Unscheduled', t);
      else if (isOverdue(t, today)) push('Overdue', t);
      else if (span[0] <= today) push('Today', t);
      else if (span[0] <= weekEnd) push('Next 7 days', t);
      else push('Later', t);
    }
  }
  return [...groups.entries()].filter(([, items]) => items.length).map(([label, items]) => ({ label, items }));
}
