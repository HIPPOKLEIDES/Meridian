import { useMemo, useState } from 'react';
import type { Project, ProjectStatus } from '../types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { AreaTag, Empty, Icon, PriorityBadge, Progress, Segmented } from '../components/common';
import { QuickAddTask, TaskRow } from '../components/widgets';
import { byId, compareTasks, flowState, PRIORITIES, priorityRank } from '../lib/tasks';
import { navigate } from '../lib/hooks';
import { FlowMap } from './FlowMap';
import { NotesTab } from '../notes/NotesTab';
import { useNotes } from '../notes/store';
import { PlanSwitch } from '../goals/GoalsView';
import { ShareButton } from '../cloud/ui/ShareDialog';

export function ProjectsView() {
  const projects = useStore((s) => s.projects);
  const open = useUI((s) => s.open);
  const [filter, setFilter] = useState<ProjectStatus | 'all'>('active');
  const shown = projects
    .filter((p) => filter === 'all' || p.status === filter)
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.createdAt - b.createdAt);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="page-sub">Group tasks, set priorities, and map what unlocks what.</p>
        </div>
        <div className="row tight wrap">
          <PlanSwitch current="projects" />
          <button className="btn primary" onClick={() => open({ kind: 'project', id: null })}>
            <Icon name="plus" /> New project
          </button>
        </div>
      </header>
      <div className="toolbar">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'paused', label: 'Paused' },
            { value: 'done', label: 'Done' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <section className="card">
          <Empty>{projects.length ? 'No projects with this status.' : 'No projects yet. Create one to start organizing tasks.'}</Empty>
        </section>
      ) : (
        <div className="project-grid">
          {shown.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const allTasks = useStore((s) => s.tasks);
  const map = useMemo(() => byId(allTasks), [allTasks]);
  const tasks = allTasks.filter((t) => t.projectId === project.id);
  const states = tasks.map((t) => flowState(t, map));
  const done = states.filter((s) => s === 'done').length;
  const available = tasks.filter((_, i) => states[i] === 'available').sort(compareTasks);
  const locked = states.filter((s) => s === 'locked').length;
  const noteCount = useNotes((s) => s.notes.filter((n) => n.projectId === project.id && (n.kind === 'page' || n.kind === 'board')).length);

  return (
    <button className="card project-card" onClick={() => navigate(`projects/${project.id}`)}>
      <div className="project-card-head">
        <h3>{project.name}</h3>
        <PriorityBadge priority={project.priority} />
      </div>
      {project.description && <p className="project-card-desc">{project.description}</p>}
      <div className="project-card-meta">
        <AreaTag areaId={project.areaId} />
        {project.status !== 'active' && <span className="badge">{project.status}</span>}
      </div>
      <div className="project-card-progress">
        <Progress value={tasks.length ? done / tasks.length : 0} label="Tasks done" />
        <span className="small muted">
          {done}/{tasks.length} done
        </span>
      </div>
      <div className="project-card-foot small">
        <span>
          <b>{available.length}</b> ready
        </span>
        <span>
          <Icon name="lock" size={12} /> <b>{locked}</b> locked
        </span>
        {noteCount > 0 && (
          <span>
            <Icon name="edit" size={12} /> <b>{noteCount}</b> note{noteCount === 1 ? '' : 's'}
          </span>
        )}
        {available[0] && <span className="muted project-card-next">Next: {available[0].title}</span>}
      </div>
    </button>
  );
}

export function ProjectDetail({ id, tab, sub }: { id: string; tab?: string; sub?: string }) {
  const project = useStore((s) => s.projects.find((p) => p.id === id));
  const allTasks = useStore((s) => s.tasks);
  const open = useUI((s) => s.open);
  const map = useMemo(() => byId(allTasks), [allTasks]);
  const [showDone, setShowDone] = useState(false);

  if (!project) {
    return (
      <div className="page">
        <Empty>
          That project no longer exists. <button className="link" onClick={() => navigate('projects')}>Back to projects</button>
        </Empty>
      </div>
    );
  }

  const view = tab === 'flow' || tab === 'notes' ? tab : 'tasks';
  const tasks = allTasks.filter((t) => t.projectId === id).sort(compareTasks);
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const doneTasks = tasks.filter((t) => t.status === 'done');
  const states = tasks.map((t) => flowState(t, map));

  return (
    <div className={`page${view !== 'tasks' ? ' page-wide page-fill' : ''}`}>
      <button className="link back" onClick={() => navigate('projects')}>
        <Icon name="left" size={14} /> Projects
      </button>
      <header className="page-head">
        <div>
          <h1>{project.name}</h1>
          <div className="detail-meta">
            <PriorityBadge priority={project.priority} />
            <AreaTag areaId={project.areaId} />
            <span className="muted">
              {states.filter((s) => s === 'done').length}/{tasks.length} done · {states.filter((s) => s === 'available').length} ready ·{' '}
              {states.filter((s) => s === 'locked').length} locked
            </span>
          </div>
        </div>
        <div className="row tight">
          <Segmented
            value={view}
            onChange={(v) => navigate(`projects/${id}${v === 'tasks' ? '' : `/${v}`}`)}
            options={[
              { value: 'tasks', label: <><Icon name="list" size={14} /> Tasks</> },
              { value: 'flow', label: <><Icon name="flow" size={14} /> Task map</> },
              { value: 'notes', label: <><Icon name="edit" size={14} /> Notes</> },
            ]}
          />
          <ShareButton project={project} />
          <button className="btn" onClick={() => open({ kind: 'project', id })}>
            <Icon name="edit" /> Edit
          </button>
        </div>
      </header>

      {view === 'flow' ? (
        <FlowMap projectId={id} />
      ) : view === 'notes' ? (
        <NotesTab projectId={id} noteId={sub} />
      ) : (
        <>
          {project.description && <p className="notes">{project.description}</p>}
          <section className="card">
            <QuickAddTask defaults={{ projectId: id }} placeholder="Add a task to this project" />
            {openTasks.length === 0 && <Empty>No open tasks. Add one above.</Empty>}
            {PRIORITIES.map((p) => {
              const items = openTasks.filter((t) => t.priority === p.id);
              if (!items.length) return null;
              return (
                <div key={p.id} className="task-group">
                  <div className="group-label">
                    <PriorityBadge priority={p.id} /> <span className="muted">{items.length}</span>
                  </div>
                  {items.map((t) => (
                    <TaskRow key={t.id} task={t} tasks={map} showProject={false} priorityEditable />
                  ))}
                </div>
              );
            })}
            {doneTasks.length > 0 && (
              <div className="task-group">
                <button className="group-label link" onClick={() => setShowDone(!showDone)}>
                  <Icon name={showDone ? 'down' : 'right'} size={12} /> Done <span className="muted">{doneTasks.length}</span>
                </button>
                {showDone && doneTasks.map((t) => <TaskRow key={t.id} task={t} tasks={map} showProject={false} />)}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
