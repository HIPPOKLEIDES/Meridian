import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ID } from '../types';
import type { Board, NoteKind, NoteNode, NotesData } from './types';
import { CHILD_KINDS } from './types';
import { uid } from '../store';
import { idbStateStorage, requestPersistentStorage, useHydrated } from '../lib/idb';

export const emptyBoard = (): Board => ({ nodes: [], edges: [] });

interface NotesActions {
  addNote(projectId: ID, parentId: ID | null, kind: NoteKind, title?: string): ID;
  updateNote(id: ID, patch: Partial<Pick<NoteNode, 'title' | 'content' | 'board' | 'color'>>): void;
  /** Moves a note under `parentId`, before `beforeId` (or last). Returns false if the move isn't allowed. */
  moveNote(id: ID, parentId: ID | null, beforeId: ID | null): boolean;
  deleteNote(id: ID): void;
  deleteProjectNotes(projectId: ID): void;
  replaceAll(data: NotesData): void;
}

export type NotesStore = NotesData & NotesActions;

/** The note and everything under it. */
export function subtreeIds(notes: NoteNode[], id: ID): Set<ID> {
  const out = new Set<ID>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of notes) {
      if (n.parentId && out.has(n.parentId) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
    }
  }
  return out;
}

export const canContain = (parent: NoteNode | null, kind: NoteKind) => CHILD_KINDS[parent ? parent.kind : 'root'].includes(kind);

export const useNotes = create<NotesStore>()(
  persist(
    (set, get) => ({
      notes: [],

      addNote: (projectId, parentId, kind, title) => {
        requestPersistentStorage();
        const siblings = get().notes.filter((n) => n.projectId === projectId && n.parentId === parentId);
        const sections = get().notes.filter((n) => n.projectId === projectId && n.kind === 'section').length;
        const note: NoteNode = {
          id: uid(),
          projectId,
          parentId,
          kind,
          title: title ?? (kind === 'folder' ? 'New folder' : kind === 'section' ? 'New section' : kind === 'board' ? 'New board' : 'Untitled page'),
          order: siblings.reduce((m, n) => Math.max(m, n.order), -1) + 1,
          color: kind === 'section' ? (sections % 8) + 1 : null,
          content: '',
          board: kind === 'board' ? emptyBoard() : null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({ notes: [...s.notes, note] }));
        return note.id;
      },

      updateNote: (id, patch) => set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)) })),

      moveNote: (id, parentId, beforeId) => {
        const { notes } = get();
        const note = notes.find((n) => n.id === id);
        const parent = parentId ? notes.find((n) => n.id === parentId) ?? null : null;
        if (!note || !canContain(parent, note.kind)) return false;
        if (parentId && subtreeIds(notes, id).has(parentId)) return false;
        const siblings = notes
          .filter((n) => n.projectId === note.projectId && n.parentId === parentId && n.id !== id)
          .sort((a, b) => a.order - b.order);
        const at = beforeId ? siblings.findIndex((n) => n.id === beforeId) : -1;
        siblings.splice(at === -1 ? siblings.length : at, 0, { ...note, parentId });
        const order = new Map(siblings.map((n, i) => [n.id, i]));
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, parentId, order: order.get(id)! } : order.has(n.id) ? { ...n, order: order.get(n.id)! } : n)),
        }));
        return true;
      },

      deleteNote: (id) => {
        const gone = subtreeIds(get().notes, id);
        set((s) => ({
          notes: s.notes
            .filter((n) => !gone.has(n.id))
            // Drop links to deleted pages from any board cards.
            .map((n) =>
              n.board && n.board.nodes.some((b) => b.type === 'card' && b.data.noteIds.some((x) => gone.has(x)))
                ? {
                    ...n,
                    board: {
                      ...n.board,
                      nodes: n.board.nodes.map((b) => (b.type === 'card' ? { ...b, data: { ...b.data, noteIds: b.data.noteIds.filter((x) => !gone.has(x)) } } : b)),
                    },
                  }
                : n,
            ),
        }));
      },

      deleteProjectNotes: (projectId) => set((s) => ({ notes: s.notes.filter((n) => n.projectId !== projectId) })),
      replaceAll: (data) => set({ notes: data.notes ?? [] }),
    }),
    {
      name: 'meridian:notes',
      version: 1,
      storage: createJSONStorage(() => idbStateStorage),
      partialize: (s): NotesData => ({ notes: s.notes }),
    },
  ),
);

/** Notes load asynchronously from IndexedDB; render nothing note-related until this is true. */
export const useNotesReady = () => useHydrated(useNotes);


export const exportNotes = (): NotesData => ({ notes: useNotes.getState().notes });

/** Children of a parent in display order. */
export const childrenOf = (notes: NoteNode[], projectId: ID, parentId: ID | null) =>
  notes.filter((n) => n.projectId === projectId && n.parentId === parentId).sort((a, b) => a.order - b.order);

/** Resolve a [[wiki link]] title: this project first, then any project. */
export function findByTitle(notes: NoteNode[], projectId: ID, title: string) {
  const t = title.trim().toLowerCase();
  const leaf = (n: NoteNode) => (n.kind === 'page' || n.kind === 'board') && n.title.trim().toLowerCase() === t;
  return notes.find((n) => n.projectId === projectId && leaf(n)) ?? notes.find(leaf);
}

export const pathOf = (notes: NoteNode[], note: NoteNode): NoteNode[] => {
  const out: NoteNode[] = [];
  let cur = note.parentId ? notes.find((n) => n.id === note.parentId) : undefined;
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? notes.find((n) => n.id === cur!.parentId) : undefined;
  }
  return out;
};
