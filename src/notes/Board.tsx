import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { sound } from '../lib/sound';
import {
  Background,
  ConnectionMode,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  NodeResizer,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore as useFlowStore,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ID } from '../types';
import type { Board, BoardEdge, BoardNode, CardData, FrameData, ImageData, NoteNode } from './types';
import { findByTitle, useNotes } from './store';
import { renderMarkdown } from './markdown';
import { imageFrom, saveImage, useAssetUrl } from './assets';
import { uid } from '../store';
import { Icon, Segmented } from '../components/common';
import { useResolvedTheme } from '../lib/hooks';

type CardNode = Node<CardData, 'card'>;
type ImageNode = Node<ImageData, 'image'>;
type FrameNode = Node<FrameData, 'frame'>;
type AnyNode = CardNode | ImageNode | FrameNode;
type BoardFlowEdge = Edge<{ dashed: boolean }>;

interface BoardContextValue {
  projectId: ID;
  openNote: (id: ID) => void;
  openTitle: (title: string) => void;
}
const BoardContext = createContext<BoardContextValue | null>(null);

const slotColor = (slot: number | null) => (slot ? `var(--series-${slot})` : 'var(--axis)');
const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

/* ───────── Conversions between stored boards and React Flow ───────── */

function toFlowNodes(board: Board): AnyNode[] {
  return board.nodes.map((n) => {
    const base = { id: n.id, position: { x: n.x, y: n.y } };
    if (n.type === 'card') return { ...base, type: 'card', data: n.data, width: n.w, ...(n.h ? { height: n.h } : {}) } as CardNode;
    if (n.type === 'image') return { ...base, type: 'image', data: n.data, width: n.w, height: n.h } as ImageNode;
    return { ...base, type: 'frame', data: n.data, width: n.w, height: n.h, zIndex: -1 } as FrameNode;
  });
}

const edgeStyle = (dashed: boolean) => (dashed ? { strokeDasharray: '6 5' } : undefined);

function toFlowEdges(board: Board): BoardFlowEdge[] {
  return board.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    label: e.label || undefined,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    style: edgeStyle(e.dashed),
    data: { dashed: e.dashed },
  }));
}

function fromFlow(nodes: AnyNode[], edges: BoardFlowEdge[]): Board {
  const dims = (n: AnyNode) => ({ w: Math.round(n.width ?? n.measured?.width ?? 200), h: Math.round(n.height ?? n.measured?.height ?? 120) });
  return {
    nodes: nodes.map((n): BoardNode => {
      const pos = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
      const { w, h } = dims(n);
      if (n.type === 'card') return { id: n.id, type: 'card', ...pos, w, h: n.height ? Math.round(n.height) : null, data: n.data };
      if (n.type === 'image') return { id: n.id, type: 'image', ...pos, w, h, data: n.data };
      return { id: n.id, type: 'frame', ...pos, w, h, data: (n as FrameNode).data };
    }),
    edges: edges.map(
      (e): BoardEdge => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        label: typeof e.label === 'string' ? e.label : '',
        dashed: !!e.data?.dashed,
      }),
    ),
  };
}

/* ───────── Node views ───────── */

function Handles() {
  return (
    <>
      {SIDES.map((p) => (
        <Handle key={p} id={p} type="source" position={p} className="board-handle" />
      ))}
    </>
  );
}

/**
 * Edge strips and corners for resizing, always present so you can grab any edge on hover.
 * Rendered beside (not inside) the node's content, whose overflow clipping would otherwise cut the grab areas in half.
 */
function Resizer({ minWidth, minHeight }: { minWidth: number; minHeight: number }) {
  return <NodeResizer isVisible minWidth={minWidth} minHeight={minHeight} lineClassName="board-resize-line" handleClassName="board-resize-handle" />;
}

function CardView({ id, data, selected }: NodeProps<CardNode>) {
  const ctx = useContext(BoardContext)!;
  const notes = useNotes((s) => s.notes);
  const url = useAssetUrl(data.imageId);
  const body = useMemo(() => (data.body.trim() ? renderMarkdown(data.body, { allowStyles: false }) : ''), [data.body]);
  const linked = data.noteIds.map((nid) => notes.find((n) => n.id === nid)).filter((n): n is NoteNode => !!n);
  const img = (cls: string) => url && <img className={`${cls}${data.pixelated ? ' pixelated' : ''}`} src={url} alt="" draggable={false} />;
  return (
    <>
      <Resizer minWidth={140} minHeight={56} />
      <Handles />
      <div className={`board-card${selected ? ' is-selected' : ''}`} style={{ '--card': slotColor(data.color) } as CSSProperties} data-id={id}>
        {data.imageStyle === 'cover' && img('board-card-cover')}
        <div className="board-card-head">
          {data.imageStyle === 'icon' && img('board-card-icon')}
          <b>{data.title || 'Untitled card'}</b>
        </div>
        {body && (
          <div
            className="board-card-body"
            dangerouslySetInnerHTML={{ __html: body }}
            onClick={(e) => {
              const link = (e.target as HTMLElement).closest('a.note-link') as HTMLAnchorElement | null;
              if (link) {
                e.preventDefault();
                ctx.openTitle(link.dataset.noteTitle ?? '');
              }
            }}
          />
        )}
        {linked.length > 0 && (
          <div className="board-card-links nodrag">
            {linked.map((n) => (
              <button key={n.id} type="button" className="board-note-chip" onClick={() => ctx.openNote(n.id)} title={`Open ${n.title}`}>
                <Icon name={n.kind === 'board' ? 'flow' : 'list'} size={11} /> {n.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ImageView({ data, selected }: NodeProps<ImageNode>) {
  const url = useAssetUrl(data.assetId);
  return (
    <>
      <Resizer minWidth={32} minHeight={32} />
      <Handles />
      <figure className={`board-image${selected ? ' is-selected' : ''}`}>
        {url ? <img className={data.pixelated ? 'pixelated' : ''} src={url} alt={data.caption} draggable={false} /> : <div className="board-image-missing">Image not found</div>}
        {data.caption && <figcaption>{data.caption}</figcaption>}
      </figure>
    </>
  );
}

function FrameView({ data, selected }: NodeProps<FrameNode>) {
  return (
    <>
      <Resizer minWidth={160} minHeight={100} />
      <div className={`board-frame${selected ? ' is-selected' : ''}`} style={{ '--card': slotColor(data.color) } as CSSProperties}>
        <div className="board-frame-title">{data.title || 'Frame'}</div>
      </div>
    </>
  );
}

const nodeTypes = { card: CardView, image: ImageView, frame: FrameView };

/* ───────── Board ───────── */

export function BoardView({ note, onOpenNote }: { note: NoteNode; onOpenNote: (id: ID) => void }) {
  return (
    <ReactFlowProvider>
      <BoardCanvas note={note} onOpenNote={onOpenNote} />
    </ReactFlowProvider>
  );
}

const newCard = (x: number, y: number, patch: Partial<CardData> = {}): CardNode => ({
  id: uid(),
  type: 'card',
  position: { x, y },
  width: 200,
  data: { title: 'New card', body: '', color: null, imageId: null, imageStyle: 'icon', pixelated: false, noteIds: [], ...patch },
  selected: true,
});

/** Natural size of an uploaded image; tiny pixel art is scaled up and kept crisp. */
async function imageSize(file: File) {
  const bmp = await createImageBitmap(file);
  const small = Math.max(bmp.width, bmp.height) <= 64;
  const scale = small ? Math.floor(96 / Math.max(bmp.width, bmp.height)) || 1 : Math.min(1, 320 / bmp.width);
  return { w: Math.round(bmp.width * scale), h: Math.round(bmp.height * scale), pixelated: small };
}

function BoardCanvas({ note, onOpenNote }: { note: NoteNode; onOpenNote: (id: ID) => void }) {
  const notes = useNotes((s) => s.notes);
  const updateNote = useNotes((s) => s.updateNote);
  const addNote = useNotes((s) => s.addNote);
  const theme = useResolvedTheme();
  const { screenToFlowPosition, fitView } = useReactFlow();
  // Resize strips live in canvas units; scale them so they stay a comfortable size on screen at any zoom.
  const zoom = useFlowStore((s) => s.transform[2]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const board = note.board ?? { nodes: [], edges: [] };
  const [nodes, setNodes, onNodesChange] = useNodesState<AnyNode>(toFlowNodes(board));
  const [edges, setEdges, onEdgesChange] = useEdgesState<BoardFlowEdge>(toFlowEdges(board));
  const [snap, setSnap] = useState(false);
  const lastSaved = useRef(JSON.stringify(board));
  const latest = useRef({ nodes, edges });
  latest.current = { nodes, edges };

  // Show changes from collaborators or other devices when there are no unsaved edits on this canvas.
  useEffect(() => {
    const incoming = JSON.stringify(note.board ?? { nodes: [], edges: [] });
    if (incoming === lastSaved.current) return;
    if (JSON.stringify(fromFlow(latest.current.nodes, latest.current.edges)) !== lastSaved.current) return;
    lastSaved.current = incoming;
    const fresh = note.board ?? { nodes: [], edges: [] };
    const selectedNodes = new Set(latest.current.nodes.filter((n) => n.selected).map((n) => n.id));
    const selectedEdges = new Set(latest.current.edges.filter((e) => e.selected).map((e) => e.id));
    setNodes(toFlowNodes(fresh).map((n) => (selectedNodes.has(n.id) ? ({ ...n, selected: true } as AnyNode) : n)));
    setEdges(toFlowEdges(fresh).map((e) => (selectedEdges.has(e.id) ? { ...e, selected: true } : e)));
  }, [note.board, setNodes, setEdges]);

  // Save shortly after changes settle, and on the way out.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = fromFlow(nodes, edges);
      const json = JSON.stringify(next);
      if (json !== lastSaved.current) {
        lastSaved.current = json;
        updateNote(note.id, { board: next });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [nodes, edges, note.id, updateNote]);
  useEffect(
    () => () => {
      const next = fromFlow(latest.current.nodes, latest.current.edges);
      if (JSON.stringify(next) !== lastSaved.current) updateNote(note.id, { board: next });
    },
    [note.id, updateNote],
  );

  const ctx = useMemo<BoardContextValue>(
    () => ({
      projectId: note.projectId,
      openNote: onOpenNote,
      openTitle: (title) => {
        const target = findByTitle(notes, note.projectId, title);
        if (target) onOpenNote(target.id);
        else if (confirm(`There's no page called “${title}” yet. Create it?`)) onOpenNote(addNote(note.projectId, note.parentId, 'page', title));
      },
    }),
    [note.projectId, note.parentId, notes, onOpenNote, addNote],
  );

  const center = () => {
    const r = wrapRef.current!.getBoundingClientRect();
    return screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };
  const deselectAll = (ns: AnyNode[]) => ns.map((n) => (n.selected ? { ...n, selected: false } : n));
  const addNode = (node: AnyNode) => setNodes((ns) => [...deselectAll(ns), node]);

  const addImageNode = async (file: File, at: { x: number; y: number }) => {
    const [assetId, size] = await Promise.all([saveImage(file, file.name), imageSize(file)]);
    addNode({
      id: uid(),
      type: 'image',
      position: { x: at.x - size.w / 2, y: at.y - size.h / 2 },
      width: size.w,
      height: size.h,
      data: { assetId, caption: '', pixelated: size.pixelated },
      selected: true,
    });
  };

  const cardAt = (p: { x: number; y: number }) =>
    [...latest.current.nodes].reverse().find((n) => {
      if (n.type !== 'card') return false;
      const w = n.width ?? n.measured?.width ?? 0;
      const h = n.height ?? n.measured?.height ?? 0;
      return p.x >= n.position.x && p.x <= n.position.x + w && p.y >= n.position.y && p.y <= n.position.y + h;
    }) as CardNode | undefined;

  const onDrop = async (e: React.DragEvent) => {
    const file = imageFrom(e.dataTransfer);
    if (!file) return;
    e.preventDefault();
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const card = cardAt(p);
    if (card) {
      const [imageId, size] = await Promise.all([saveImage(file, file.name), imageSize(file)]);
      setNodes((ns) => ns.map((n) => (n.id === card.id ? ({ ...n, data: { ...n.data, imageId, pixelated: size.pixelated } } as AnyNode) : n)));
    } else {
      addImageNode(file, p);
    }
  };

  // Paste an image anywhere on the page (outside text fields) to drop it on the board.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable]')) return;
      const file = imageFrom(e.clipboardData);
      if (file) {
        e.preventDefault();
        addImageNode(file, center());
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  // Dragging a frame carries the cards and images sitting inside it.
  const frameDrag = useRef<{ id: ID; from: { x: number; y: number }; members: Map<ID, { x: number; y: number }> } | null>(null);
  const onNodeDragStart = (_: unknown, node: AnyNode) => {
    if (node.type !== 'frame') return;
    const fw = node.width ?? node.measured?.width ?? 0;
    const fh = node.height ?? node.measured?.height ?? 0;
    const members = new Map<ID, { x: number; y: number }>();
    for (const n of latest.current.nodes) {
      if (n.id === node.id || n.type === 'frame' || n.selected) continue;
      const cx = n.position.x + (n.width ?? n.measured?.width ?? 0) / 2;
      const cy = n.position.y + (n.height ?? n.measured?.height ?? 0) / 2;
      if (cx >= node.position.x && cx <= node.position.x + fw && cy >= node.position.y && cy <= node.position.y + fh) members.set(n.id, { ...n.position });
    }
    frameDrag.current = { id: node.id, from: { ...node.position }, members };
  };
  const onNodeDrag = (_: unknown, node: AnyNode) => {
    const fd = frameDrag.current;
    if (!fd || fd.id !== node.id || !fd.members.size) return;
    const dx = node.position.x - fd.from.x;
    const dy = node.position.y - fd.from.y;
    setNodes((ns) => ns.map((n) => (fd.members.has(n.id) ? { ...n, position: { x: fd.members.get(n.id)!.x + dx, y: fd.members.get(n.id)!.y + dy } } : n)));
  };

  const onConnect = useCallback(
    (c: Connection) => {
      sound('connect');
      setEdges((es) =>
        addEdge(
          { ...c, id: uid(), type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 }, data: { dashed: false } },
          es,
        ),
      );
    },
    [setEdges],
  );

  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedEdges = edges.filter((e) => e.selected);
  const selection = selectedNodes.length === 1 && selectedEdges.length === 0 ? selectedNodes[0] : null;
  const selectedEdge = selectedEdges.length === 1 && selectedNodes.length === 0 ? selectedEdges[0] : null;

  const patchData = (id: ID, patch: Partial<CardData> | Partial<ImageData> | Partial<FrameData>) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, ...patch } } as AnyNode) : n)));

  const minimapColor = (n: Node) => {
    const slot = (n.data as { color?: number | null }).color;
    const css = getComputedStyle(document.documentElement);
    return n.type === 'frame' ? 'transparent' : slot ? css.getPropertyValue(`--series-${slot}`).trim() : css.getPropertyValue('--axis').trim();
  };

  return (
    <BoardContext.Provider value={ctx}>
      <div
        ref={wrapRef}
        className="board-wrap"
        style={{ '--inv-zoom': 1 / (zoom || 1) } as CSSProperties}
        onDragOver={(e) => {
          if ([...e.dataTransfer.types].includes('Files')) e.preventDefault();
        }}
        onDrop={onDrop}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return;
          const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
          addNode(newCard(p.x - 100, p.y - 30));
        }}
      >
        <ReactFlow<AnyNode, BoardFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={() => (frameDrag.current = null)}
          connectionMode={ConnectionMode.Loose}
          deleteKeyCode={['Backspace', 'Delete']}
          zoomOnDoubleClick={false}
          // Selected frames would otherwise jump above the cards inside them and swallow their clicks.
          elevateNodesOnSelect={false}
          snapToGrid={snap}
          snapGrid={[20, 20]}
          colorMode={theme}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.1}
          defaultEdgeOptions={{ type: 'smoothstep' }}
        >
          <Background gap={20} size={1.2} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={minimapColor} className="board-minimap" />
          <Panel position="top-left" className="flow-panel">
            <button className="btn primary sm" onClick={() => { const c = center(); addNode(newCard(c.x - 100, c.y - 30)); }}>
              <Icon name="plus" size={14} /> Card
            </button>
            <label className="btn sm">
              <Icon name="upload" size={14} /> Image
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) addImageNode(f, center());
                  e.target.value = '';
                }}
              />
            </label>
            <button
              className="btn sm"
              onClick={() => {
                const c = center();
                addNode({ id: uid(), type: 'frame', position: { x: c.x - 240, y: c.y - 160 }, width: 480, height: 320, zIndex: -1, data: { title: 'New frame', color: null }, selected: true });
              }}
            >
              <Icon name="layout" size={14} /> Frame
            </button>
            <button className={`btn sm${snap ? ' is-on' : ''}`} onClick={() => setSnap(!snap)} title="Snap to a 20px grid">
              Snap
            </button>
            <button className="btn sm" onClick={() => fitView({ padding: 0.2, duration: 300 })}>
              Fit
            </button>
          </Panel>
          {nodes.length === 0 && (
            <Panel position="top-center" className="flow-hint board-empty">
              Double-click to add a card · drag from a card's edge dot to connect · drop or paste images · frames group a tier and move with its cards
            </Panel>
          )}
        </ReactFlow>
        {(selection || selectedEdge) && (
          <Inspector
            key={selection?.id ?? selectedEdge?.id}
            node={selection}
            edge={selectedEdge}
            note={note}
            onPatch={patchData}
            onEdge={(patch) =>
              setEdges((es) =>
                es.map((e) =>
                  e.id === selectedEdge!.id
                    ? { ...e, ...(patch.label !== undefined ? { label: patch.label || undefined } : {}), ...(patch.dashed !== undefined ? { data: { dashed: patch.dashed }, style: edgeStyle(patch.dashed) } : {}) }
                    : e,
                ),
              )
            }
            onDelete={() => {
              if (selection) {
                setNodes((ns) => ns.filter((n) => n.id !== selection.id));
                setEdges((es) => es.filter((e) => e.source !== selection.id && e.target !== selection.id));
              } else if (selectedEdge) setEdges((es) => es.filter((e) => e.id !== selectedEdge.id));
            }}
            onDuplicate={() => {
              if (!selection) return;
              addNode({ ...selection, id: uid(), position: { x: selection.position.x + 30, y: selection.position.y + 30 }, selected: true } as AnyNode);
            }}
          />
        )}
      </div>
    </BoardContext.Provider>
  );
}

/* ───────── Inspector ───────── */

function ColorPicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Color">
      <button type="button" role="radio" aria-checked={value === null} aria-label="No color" className={`swatch-btn is-none${value === null ? ' is-on' : ''}`} onClick={() => onChange(null)} />
      {[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => (
        <button
          key={slot}
          type="button"
          role="radio"
          aria-checked={value === slot}
          aria-label={`Color ${slot}`}
          className={`swatch-btn${value === slot ? ' is-on' : ''}`}
          style={{ background: `var(--series-${slot})` }}
          onClick={() => onChange(slot)}
        />
      ))}
    </div>
  );
}

function Inspector({
  node,
  edge,
  note,
  onPatch,
  onEdge,
  onDelete,
  onDuplicate,
}: {
  node: AnyNode | null;
  edge: BoardFlowEdge | null;
  note: NoteNode;
  onPatch: (id: ID, patch: Partial<CardData> | Partial<ImageData> | Partial<FrameData>) => void;
  onEdge: (patch: { label?: string; dashed?: boolean }) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const notes = useNotes((s) => s.notes);
  const addNote = useNotes((s) => s.addNote);
  const ctx = useContext(BoardContext)!;
  const pages = notes.filter((n) => n.projectId === note.projectId && (n.kind === 'page' || n.kind === 'board') && n.id !== note.id);

  let body: React.ReactNode = null;
  if (edge) {
    body = (
      <>
        <h4>Connection</h4>
        <label className="field">
          <span className="field-label">Label</span>
          <input className="input" autoFocus value={typeof edge.label === 'string' ? edge.label : ''} placeholder="e.g. crafts into, unlocks, requires" onChange={(e) => onEdge({ label: e.target.value })} />
        </label>
        <label className="toggle small">
          <input type="checkbox" checked={!!edge.data?.dashed} onChange={(e) => onEdge({ dashed: e.target.checked })} /> Dashed (optional or alternate path)
        </label>
      </>
    );
  } else if (node?.type === 'card') {
    const d = node.data;
    body = (
      <>
        <h4>Card</h4>
        <input className="input title-input sm-title" autoFocus value={d.title} onChange={(e) => onPatch(node.id, { title: e.target.value })} aria-label="Card title" />
        <label className="field">
          <span className="field-label">Details</span>
          <textarea className="input" rows={4} value={d.body} placeholder="Markdown. [[Page title]] links to a note." onChange={(e) => onPatch(node.id, { body: e.target.value })} />
        </label>
        <div className="field">
          <span className="field-label">Color</span>
          <ColorPicker value={d.color} onChange={(color) => onPatch(node.id, { color })} />
        </div>
        <ImagePicker
          imageId={d.imageId}
          pixelated={d.pixelated}
          onChange={(imageId, pixelated) => onPatch(node.id, { imageId, ...(pixelated !== undefined ? { pixelated } : {}) })}
          onPixelated={(pixelated) => onPatch(node.id, { pixelated })}
        >
          {d.imageId && (
            <Segmented
              value={d.imageStyle}
              onChange={(imageStyle) => onPatch(node.id, { imageStyle })}
              options={[
                { value: 'icon', label: 'Icon' },
                { value: 'cover', label: 'Banner' },
              ]}
            />
          )}
        </ImagePicker>
        <div className="field">
          <span className="field-label">Linked notes</span>
          <div className="chips">
            {d.noteIds.map((nid) => {
              const n = notes.find((x) => x.id === nid);
              if (!n) return null;
              return (
                <span key={nid} className="chip">
                  <button type="button" className="link-plain" onClick={() => ctx.openNote(nid)}>
                    {n.title}
                  </button>
                  <button type="button" aria-label={`Unlink ${n.title}`} onClick={() => onPatch(node.id, { noteIds: d.noteIds.filter((x) => x !== nid) })}>
                    <Icon name="x" size={12} />
                  </button>
                </span>
              );
            })}
          </div>
          <select className="input sm" value="" onChange={(e) => e.target.value && onPatch(node.id, { noteIds: [...d.noteIds, e.target.value] })}>
            <option value="">+ Link a page…</option>
            {pages
              .filter((p) => !d.noteIds.includes(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              const id = addNote(note.projectId, note.parentId, 'page', d.title || 'Untitled page');
              onPatch(node.id, { noteIds: [...d.noteIds, id] });
            }}
          >
            <Icon name="plus" size={14} /> New page for this card
          </button>
        </div>
      </>
    );
  } else if (node?.type === 'image') {
    const d = node.data;
    body = (
      <>
        <h4>Image</h4>
        <ImagePicker imageId={d.assetId} pixelated={d.pixelated} required onChange={(assetId, pixelated) => assetId && onPatch(node.id, { assetId, ...(pixelated !== undefined ? { pixelated } : {}) })} onPixelated={(pixelated) => onPatch(node.id, { pixelated })} />
        <label className="field">
          <span className="field-label">Caption</span>
          <input className="input" value={d.caption} onChange={(e) => onPatch(node.id, { caption: e.target.value })} />
        </label>
      </>
    );
  } else if (node?.type === 'frame') {
    const d = node.data;
    body = (
      <>
        <h4>Frame</h4>
        <input className="input title-input sm-title" autoFocus value={d.title} onChange={(e) => onPatch(node.id, { title: e.target.value })} aria-label="Frame title" />
        <div className="field">
          <span className="field-label">Color</span>
          <ColorPicker value={d.color} onChange={(color) => onPatch(node.id, { color })} />
        </div>
        <p className="small muted">Cards and images inside the frame move with it.</p>
      </>
    );
  }

  return (
    <aside className="board-inspector" onKeyDown={(e) => e.stopPropagation()}>
      {body}
      <div className="row tight">
        {node && (
          <button type="button" className="btn sm" onClick={onDuplicate}>
            Duplicate
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn sm danger ghost" onClick={onDelete}>
          <Icon name="trash" size={14} /> Delete
        </button>
      </div>
    </aside>
  );
}

function ImagePicker({
  imageId,
  pixelated,
  required,
  onChange,
  onPixelated,
  children,
}: {
  imageId: string | null;
  pixelated: boolean;
  required?: boolean;
  onChange: (imageId: string | null, pixelated?: boolean) => void;
  onPixelated: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  const url = useAssetUrl(imageId);
  return (
    <div className="field">
      <span className="field-label">Image</span>
      {url && <img className={`inspector-image${pixelated ? ' pixelated' : ''}`} src={url} alt="" />}
      <div className="row tight wrap">
        <label className="btn sm">
          <Icon name="upload" size={14} /> {imageId ? 'Replace' : 'Add image'}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              const [id, size] = await Promise.all([saveImage(f, f.name), imageSize(f)]);
              onChange(id, size.pixelated);
            }}
          />
        </label>
        {imageId && !required && (
          <button type="button" className="btn sm ghost" onClick={() => onChange(null)}>
            Remove
          </button>
        )}
        {children}
      </div>
      {imageId && (
        <label className="toggle small">
          <input type="checkbox" checked={pixelated} onChange={(e) => onPixelated(e.target.checked)} /> Pixel art (keep edges crisp)
        </label>
      )}
    </div>
  );
}
