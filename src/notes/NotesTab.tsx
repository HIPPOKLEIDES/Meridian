import { useEffect, useRef, useState } from 'react';
import type { ID } from '../types';
import type { NoteKind, NoteNode } from './types';
import { CHILD_KINDS, KIND_LABELS } from './types';
import { canContain, childrenOf, pathOf, subtreeIds, useNotes, useNotesReady } from './store';
import { NotePage } from './NotePage';
import { BoardView } from './Board';
import { Empty, Icon } from '../components/common';
import { navigate } from '../lib/hooks';

const KIND_ICON: Record<NoteKind, string> = { folder: 'projects', section: 'tag', page: 'list', board: 'flow' };

export function NotesTab({ projectId, noteId }: { projectId: ID; noteId?: string }) {
  const ready = useNotesReady();
  const notes = useNotes((s) => s.notes);
  const note = notes.find((n) => n.id === noteId && n.projectId === projectId);
  const open = (id: ID) => navigate(`projects/${projectId}/notes/${id}`);

  if (!ready) return <Empty>Loading notes…</Empty>;

  return (
    <div className="notes-layout">
      <NotesTree projectId={projectId} activeId={note?.id ?? null} onOpen={open} />
      <div className="notes-content">
        {note ? <NoteView key={note.id} note={note} onOpen={open} /> : <NotesHome projectId={projectId} onOpen={open} />}
      </div>
    </div>
  );
}

function NoteView({ note, onOpen }: { note: NoteNode; onOpen: (id: ID) => void }) {
  const notes = useNotes((s) => s.notes);
  const updateNote = useNotes((s) => s.updateNote);
  const deleteNote = useNotes((s) => s.deleteNote);
  const addNote = useNotes((s) => s.addNote);
  const [title, setTitle] = useState(note.title);
  const shownTitle = useRef(note.title);
  const titleNow = useRef(title);
  titleNow.current = title;
  // Follow renames from elsewhere unless the title is being edited here.
  useEffect(() => {
    if (titleNow.current === shownTitle.current) setTitle(note.title);
    shownTitle.current = note.title;
  }, [note.title]);
  const path = pathOf(notes, note);
  const commitTitle = () => title.trim() && title !== note.title && updateNote(note.id, { title: title.trim() });

  const remove = () => {
    const count = subtreeIds(notes, note.id).size - 1;
    if (!confirm(`Delete “${note.title}”${count ? ` and the ${count} item${count === 1 ? '' : 's'} inside it` : ''}?`)) return;
    deleteNote(note.id);
    navigate(`projects/${note.projectId}/notes`);
  };

  return (
    <div className={`note-view is-${note.kind}`}>
      <header className="note-head">
        <div className="note-crumbs small muted">
          {path.map((p) => (
            <span key={p.id}>
              <button className="link-plain" onClick={() => onOpen(p.id)}>
                {p.title}
              </button>{' '}
              /{' '}
            </span>
          ))}
          <span>{KIND_LABELS[note.kind]}</span>
        </div>
        <div className="note-title-row">
          <input
            className="note-title"
            value={title}
            aria-label="Title"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <button className="btn icon ghost" title="Delete" aria-label="Delete" onClick={remove}>
            <Icon name="trash" />
          </button>
        </div>
      </header>
      {note.kind === 'page' && <NotePage note={note} onOpenNote={onOpen} />}
      {note.kind === 'board' && <BoardView note={note} onOpenNote={onOpen} />}
      {(note.kind === 'folder' || note.kind === 'section') && (
        <div className="stack">
          <div className="row tight wrap">
            {CHILD_KINDS[note.kind].map((k) => (
              <button key={k} className="btn sm" onClick={() => onOpen(addNote(note.projectId, note.id, k))}>
                <Icon name="plus" size={14} /> {KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <ChildList notes={childrenOf(notes, note.projectId, note.id)} onOpen={onOpen} />
        </div>
      )}
    </div>
  );
}

function ChildList({ notes, onOpen }: { notes: NoteNode[]; onOpen: (id: ID) => void }) {
  if (!notes.length) return <Empty>Empty. Add a page or board above, or drag items here in the sidebar.</Empty>;
  return (
    <ul className="note-children">
      {notes.map((n) => (
        <li key={n.id}>
          <button className="note-child" onClick={() => onOpen(n.id)}>
            <Icon name={KIND_ICON[n.kind]} size={16} />
            <span className="note-child-title">{n.title}</span>
            <span className="small muted">{KIND_LABELS[n.kind]}</span>
            <span className="small muted">edited {new Date(n.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function NotesHome({ projectId, onOpen }: { projectId: ID; onOpen: (id: ID) => void }) {
  const notes = useNotes((s) => s.notes);
  const addNote = useNotes((s) => s.addNote);
  const recent = notes
    .filter((n) => n.projectId === projectId && (n.kind === 'page' || n.kind === 'board'))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);
  return (
    <div className="stack notes-home">
      <h2 className="detail-title">Notes</h2>
      <p className="muted">
        Organize pages into folders and sections. Pages are markdown (HTML and CSS work too) and link to each other with <code>[[Page title]]</code>.
        Flowmap boards lay out cards, images and connections, which works well for progression trees and system diagrams.
      </p>
      <div className="row tight wrap">
        {(['page', 'board', 'section', 'folder'] as NoteKind[]).map((k) => (
          <button key={k} className={`btn${k === 'page' ? ' primary' : ''}`} onClick={() => onOpen(addNote(projectId, null, k))}>
            <Icon name={KIND_ICON[k]} size={15} /> New {KIND_LABELS[k].toLowerCase()}
          </button>
        ))}
      </div>
      {recent.length > 0 && (
        <>
          <div className="group-label">Recently edited</div>
          <ChildList notes={recent} onOpen={onOpen} />
        </>
      )}
    </div>
  );
}

/* ───────── Sidebar tree ───────── */

type Drop = { id: ID | null; where: 'inside' | 'before' };

function useCollapsed(projectId: ID) {
  const key = `meridian:notes-collapsed:${projectId}`;
  const [collapsed, setCollapsed] = useState<Set<ID>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? '[]'));
    } catch {
      return new Set();
    }
  });
  const toggle = (id: ID, open?: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (open ?? next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        /* per-viewer convenience only */
      }
      return next;
    });
  return [collapsed, toggle] as const;
}

function NotesTree({ projectId, activeId, onOpen }: { projectId: ID; activeId: ID | null; onOpen: (id: ID) => void }) {
  const notes = useNotes((s) => s.notes);
  const addNote = useNotes((s) => s.addNote);
  const moveNote = useNotes((s) => s.moveNote);
  const updateNote = useNotes((s) => s.updateNote);
  const [collapsed, toggle] = useCollapsed(projectId);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<ID | 'root' | null>(null);
  const [renaming, setRenaming] = useState<ID | null>(null);
  const [dragId, setDragId] = useState<ID | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const projectNotes = notes.filter((n) => n.projectId === projectId);

  // Latest values for the window-level pointer listeners below.
  const live = useRef({ notes, drop });
  live.current = { notes, drop };
  const pending = useRef<{ id: ID; x: number; y: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);

  // Reveal the open note: expand its ancestors.
  useEffect(() => {
    const note = activeId ? notes.find((n) => n.id === activeId) : undefined;
    if (note) for (const p of pathOf(notes, note)) if (collapsed.has(p.id)) toggle(p.id, true);
  }, [activeId]); // only when a different note opens, not on every edit

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !(e.target as HTMLElement).closest('.tree-menu, .tree-menu-btn') && setMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const dragged = dragId ? notes.find((n) => n.id === dragId) : undefined;

  /**
   * Dragging uses pointer events rather than native HTML5 drag-and-drop: moving a row into a section
   * re-mounts its DOM element mid-drop, which can leave Chrome's native drag stuck and the page unresponsive.
   */
  useEffect(() => {
    const dropFor = (draggedId: ID, target: NoteNode): Drop | null => {
      const all = live.current.notes;
      const d = all.find((n) => n.id === draggedId);
      if (!d || d.id === target.id || subtreeIds(all, d.id).has(target.id)) return null;
      if ((target.kind === 'folder' || target.kind === 'section') && canContain(target, d.kind)) return { id: target.id, where: 'inside' };
      const parent = target.parentId ? all.find((n) => n.id === target.parentId) ?? null : null;
      return canContain(parent, d.kind) ? { id: target.id, where: 'before' } : null;
    };
    const setDropIfChanged = (d: Drop | null) => {
      const cur = live.current.drop;
      if (cur?.id !== d?.id || cur?.where !== d?.where) setDrop(d);
    };
    const end = () => {
      pending.current = null;
      document.body.classList.remove('is-dragging-note');
      setDragId(null);
      setDrop(null);
      setGhost(null);
    };
    const onMove = (e: PointerEvent) => {
      const p = pending.current;
      if (!p) return;
      if (!p.active) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return;
        p.active = true;
        document.body.classList.add('is-dragging-note');
        setDragId(p.id);
      }
      setGhost({ x: e.clientX, y: e.clientY });
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (el?.closest('.tree-root-drop')) {
        const d = live.current.notes.find((n) => n.id === p.id);
        setDropIfChanged(d && canContain(null, d.kind) ? { id: null, where: 'inside' } : null);
        return;
      }
      const rowId = el?.closest<HTMLElement>('[data-note-id]')?.dataset.noteId;
      const target = rowId ? live.current.notes.find((n) => n.id === rowId) : undefined;
      setDropIfChanged(target ? dropFor(p.id, target) : null);
    };
    const onUp = () => {
      const p = pending.current;
      const d = live.current.drop;
      if (p?.active) {
        // The click that follows pointerup shouldn't also open the row.
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        if (d) {
          if (d.id === null) moveNote(p.id, null, null);
          else {
            const target = live.current.notes.find((n) => n.id === d.id);
            if (target && d.where === 'inside') {
              moveNote(p.id, target.id, null);
              toggle(target.id, true);
            } else if (target) moveNote(p.id, target.parentId, target.id);
          }
        }
      }
      end();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && pending.current?.active && end();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', end);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('is-dragging-note');
    };
    // Registered once; everything that changes is read through `live`, and moveNote/toggle don't depend on render state.
  }, []);

  const addMenu = (parent: NoteNode | null) => (
    <div className="tree-menu" role="menu">
      {CHILD_KINDS[parent ? parent.kind : 'root'].map((k) => (
        <button
          key={k}
          role="menuitem"
          onClick={() => {
            setMenu(null);
            if (parent) toggle(parent.id, true);
            const id = addNote(projectId, parent?.id ?? null, k);
            if (k === 'folder' || k === 'section') setRenaming(id);
            onOpen(id);
          }}
        >
          <Icon name={KIND_ICON[k]} size={14} /> {KIND_LABELS[k]}
        </button>
      ))}
    </div>
  );

  const renderLevel = (parentId: ID | null, depth: number): React.ReactNode =>
    childrenOf(notes, projectId, parentId).map((n) => {
      const container = n.kind === 'folder' || n.kind === 'section';
      const isOpen = !collapsed.has(n.id);
      const dropHere = drop?.id === n.id ? drop.where : null;
      return (
        <div key={n.id} className="tree-item">
          <div
            className={`tree-row kind-${n.kind}${activeId === n.id ? ' is-active' : ''}${dropHere ? ` drop-${dropHere}` : ''}${dragId === n.id ? ' is-dragging' : ''}`}
            style={{ paddingLeft: 6 + depth * 14, ...(n.kind === 'section' && n.color ? { ['--section' as string]: `var(--series-${n.color})` } : {}) }}
            data-note-id={n.id}
            onPointerDown={(e) => {
              if (e.button !== 0 || renaming === n.id || (e.target as HTMLElement).closest('button, input')) return;
              pending.current = { id: n.id, x: e.clientX, y: e.clientY, active: false };
            }}
            onClick={() => !suppressClick.current && onOpen(n.id)}
          >
            {container ? (
              <button
                className={`tree-chevron${isOpen ? ' is-open' : ''}`}
                aria-label={isOpen ? 'Collapse' : 'Expand'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(n.id);
                }}
              >
                <Icon name="right" size={12} />
              </button>
            ) : (
              <span className="tree-chevron" />
            )}
            {n.kind === 'section' ? <span className="tree-section-dot" /> : <Icon name={KIND_ICON[n.kind]} size={14} className="tree-icon" />}
            {renaming === n.id ? (
              <input
                className="input sm tree-rename"
                autoFocus
                defaultValue={n.title}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  if (e.target.value.trim()) updateNote(n.id, { title: e.target.value.trim() });
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <span className="tree-title" onDoubleClick={() => setRenaming(n.id)}>
                {n.title}
              </span>
            )}
            {container && (
              <span className="tree-actions">
                <button
                  className="tree-menu-btn"
                  aria-label={`Add to ${n.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu(menu === n.id ? null : n.id);
                  }}
                >
                  <Icon name="plus" size={13} />
                </button>
              </span>
            )}
          </div>
          {menu === n.id && addMenu(n)}
          {container && isOpen && <div className="tree-children">{renderLevel(n.id, depth + 1)}</div>}
        </div>
      );
    });

  const q = query.trim().toLowerCase();
  const matches = q
    ? projectNotes.filter((n) => n.title.toLowerCase().includes(q) || (n.kind === 'page' && n.content.toLowerCase().includes(q)) || (n.board && JSON.stringify(n.board.nodes).toLowerCase().includes(q)))
    : [];

  return (
    <nav className="notes-tree" aria-label="Notes">
      <div className="notes-tree-head">
        <input className="input sm" placeholder="Search notes…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn icon sm tree-menu-btn" aria-label="New note" onClick={() => setMenu(menu === 'root' ? null : 'root')}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      {menu === 'root' && addMenu(null)}
      {q ? (
        <div className="tree-results">
          {matches.length === 0 && <p className="small muted">No matches.</p>}
          {matches.map((n) => (
            <button key={n.id} className={`tree-row kind-${n.kind}${activeId === n.id ? ' is-active' : ''}`} onClick={() => onOpen(n.id)}>
              <Icon name={KIND_ICON[n.kind]} size={14} className="tree-icon" />
              <span className="tree-title">
                {n.title}
                <span className="tree-path">{pathOf(notes, n).map((p) => p.title).join(' / ')}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="tree-body">
          {projectNotes.length === 0 && <p className="small muted tree-empty">No notes yet. Use + to add a page, board, section or folder.</p>}
          {renderLevel(null, 0)}
          {dragged && <div className={`tree-root-drop${drop?.id === null ? ' is-over' : ''}`}>Move to top level</div>}
        </div>
      )}
      {dragged && ghost && (
        <div className="tree-drag-ghost" style={{ left: ghost.x + 12, top: ghost.y + 10 }}>
          <Icon name={KIND_ICON[dragged.kind]} size={13} /> {dragged.title}
          {!drop && <span className="muted"> · can't drop here</span>}
        </div>
      )}
      <p className="small muted tree-tip">Drag to reorder or move into folders and sections. Double-click a name to rename.</p>
    </nav>
  );
}
