import { useCallback, useEffect, useMemo } from 'react';
import { sound } from '../lib/sound';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useConnection,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ID, Task } from '../types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { CheckButton, Icon, PriorityBadge } from '../components/common';
import { byId, flowState, layoutFlow, NODE_W, wouldCycle, type FlowState } from '../lib/tasks';
import { fmtRange } from '../lib/dates';
import { useResolvedTheme } from '../lib/hooks';

type TaskNodeData = { task: Task; state: FlowState; blockers: number };
type TaskNode = Node<TaskNodeData, 'task'>;

const STATE_LABEL: Record<FlowState, string> = { done: 'Done', available: 'Ready', locked: 'Locked' };

function TaskNodeView({ data, selected }: NodeProps<TaskNode>) {
  const { task, state } = data;
  const setStatus = useStore((s) => s.setTaskStatus);
  const subDone = task.subtasks.filter((s) => s.done).length;
  // While a link is being dragged, the whole card becomes a drop target, not just its left dot.
  const connectingFrom = useConnection((c) => (c.inProgress ? c.fromNode.id : null));
  const dropTarget = connectingFrom !== null && connectingFrom !== task.id;
  return (
    <div className={`flow-node is-${state}${selected ? ' is-selected' : ''}`} style={{ width: NODE_W }}>
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <div className="flow-node-head">
        <span className="nodrag">
          <CheckButton
            size="sm"
            checked={state === 'done'}
            disabled={state === 'locked'}
            title={state === 'locked' ? 'Finish the tasks leading into this one first' : undefined}
            onToggle={() => setStatus(task.id, task.status === 'done' ? 'todo' : 'done')}
          />
        </span>
        <span className="flow-node-title">{task.title || 'Untitled task'}</span>
      </div>
      <div className="flow-node-meta">
        <span className={`flow-state is-${state}`}>
          {state === 'locked' && <Icon name="lock" size={11} />}
          {state === 'done' && <Icon name="check" size={11} />}
          {task.status === 'doing' && state !== 'done' ? 'In progress' : STATE_LABEL[state]}
        </span>
        <PriorityBadge priority={task.priority} compact />
        {task.subtasks.length > 0 && (
          <span>
            {subDone}/{task.subtasks.length}
          </span>
        )}
        {(task.startDate || task.endDate) && <span>{fmtRange(task.startDate, task.endDate)}</span>}
      </div>
      <Handle type="source" position={Position.Right} className="flow-handle" />
      {dropTarget && <Handle id="drop" type="target" position={Position.Left} className="flow-drop-target" />}
    </div>
  );
}

const nodeTypes = { task: TaskNodeView };

export function FlowMap({ projectId }: { projectId: ID }) {
  return (
    <ReactFlowProvider>
      <FlowCanvas projectId={projectId} />
    </ReactFlowProvider>
  );
}

/** Positions for every task: saved ones as-is, new ones stacked below the existing map. */
function positionsFor(tasks: Task[]) {
  const placed = tasks.filter((t) => t.flow);
  if (!placed.length) return layoutFlow(tasks);
  const out: Record<ID, { x: number; y: number }> = {};
  const minX = Math.min(...placed.map((t) => t.flow!.x));
  let y = Math.max(...placed.map((t) => t.flow!.y)) + 140;
  for (const t of tasks) {
    if (t.flow) out[t.id] = t.flow;
    else {
      out[t.id] = { x: minX, y };
      y += 110;
    }
  }
  return out;
}

function FlowCanvas({ projectId }: { projectId: ID }) {
  const allTasks = useStore((s) => s.tasks);
  const addDependency = useStore((s) => s.addDependency);
  const removeDependency = useStore((s) => s.removeDependency);
  const updateTask = useStore((s) => s.updateTask);
  const open = useUI((s) => s.open);
  const toast = useUI((s) => s.toast);
  const theme = useResolvedTheme();
  const { fitView, screenToFlowPosition } = useReactFlow();

  const map = useMemo(() => byId(allTasks), [allTasks]);
  const tasks = useMemo(() => allTasks.filter((t) => t.projectId === projectId), [allTasks, projectId]);

  const buildNodes = useCallback(
    (prev: TaskNode[]): TaskNode[] => {
      const pos = positionsFor(tasks);
      const selected = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      return tasks.map((t) => ({
        id: t.id,
        type: 'task',
        position: pos[t.id],
        data: { task: t, state: flowState(t, map), blockers: t.dependsOn.length },
        selected: selected.has(t.id),
        deletable: false,
      }));
    },
    [tasks, map],
  );

  const buildEdges = useCallback(
    (prev: Edge[]): Edge[] => {
      const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return tasks.flatMap((t) =>
        t.dependsOn
          .filter((d) => map[d]?.projectId === projectId)
          .map((d) => {
            const met = map[d].status === 'done';
            const id = `${d}->${t.id}`;
            return {
              id,
              source: d,
              target: t.id,
              selected: selected.has(id),
              className: met ? 'flow-edge is-met' : 'flow-edge',
              animated: met && t.status !== 'done',
              markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: met ? '#0ca30c' : theme === 'dark' ? '#6b6a64' : '#a8a69e' },
            };
          }),
      );
    },
    [tasks, map, projectId, theme],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<TaskNode>(buildNodes([]));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(buildEdges([]));

  useEffect(() => setNodes((prev) => buildNodes(prev)), [buildNodes, setNodes]);
  useEffect(() => setEdges((prev) => buildEdges(prev)), [buildEdges, setEdges]);

  const isValidConnection = useCallback(
    (c: Edge | Connection) => !!c.source && !!c.target && !wouldCycle(map, c.target, c.source),
    [map],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (addDependency(c.target, c.source)) sound('connect');
      else toast('That link would make a loop, so it was not added', 'error');
    },
    [addDependency, toast],
  );

  const onNodeDragStop = (_: unknown, __: unknown, dragged: TaskNode[]) => {
    // Persist the dragged nodes, plus any still on computed positions so they don't shuffle afterwards.
    const moved = new Map(dragged.map((n) => [n.id, n.position]));
    for (const n of nodes) {
      const pos = moved.get(n.id) ?? (map[n.id]?.flow ? null : n.position);
      if (pos) updateTask(n.id, { flow: pos });
    }
  };

  const autoArrange = () => {
    const pos = layoutFlow(tasks);
    for (const t of tasks) updateTask(t.id, { flow: pos[t.id] });
    requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
  };

  const addTask = () => {
    const pane = document.querySelector('.flow-wrap')?.getBoundingClientRect();
    const center = pane
      ? screenToFlowPosition({ x: pane.left + pane.width / 2, y: pane.top + pane.height / 2 })
      : { x: 0, y: 0 };
    open({ kind: 'task', id: null, draft: { projectId, flow: { x: center.x - NODE_W / 2, y: center.y - 30 } } });
  };

  return (
    <div className="flow-wrap">
      <ReactFlow<TaskNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onEdgesDelete={(deleted) => deleted.forEach((e) => removeDependency(e.target, e.source))}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={(_, n) => open({ kind: 'task', id: n.id })}
        deleteKeyCode={['Backspace', 'Delete']}
        colorMode={theme}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
        minZoom={0.2}
      >
        <Background gap={24} size={1.2} />
        <Controls showInteractive={false} />
        <Panel position="top-left" className="flow-panel">
          <button className="btn primary sm" onClick={addTask}>
            <Icon name="plus" size={14} /> Task
          </button>
          <button className="btn sm" onClick={autoArrange} disabled={!tasks.length}>
            <Icon name="layout" size={14} /> Auto-arrange
          </button>
        </Panel>
        <Panel position="top-right" className="flow-panel flow-legend">
          <span>
            <i className="legend-swatch is-done" /> Done
          </span>
          <span>
            <i className="legend-swatch is-available" /> Ready
          </span>
          <span>
            <i className="legend-swatch is-locked" /> Locked
          </span>
        </Panel>
        <Panel position="bottom-center" className="flow-hint">
          {tasks.length === 0
            ? 'Add a task to start mapping this project.'
            : 'Drag from a task’s right dot to another task to make it a prerequisite · Select a link and press Delete to remove it · Double-click to edit'}
        </Panel>
      </ReactFlow>
    </div>
  );
}
