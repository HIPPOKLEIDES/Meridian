import type { ID } from '../types';

/**
 * A node in a project's notes tree.
 * Folders hold folders, sections, pages and boards; sections hold pages and boards; pages and boards are leaves.
 */
export type NoteKind = 'folder' | 'section' | 'page' | 'board';

export interface NoteNode {
  id: ID;
  projectId: ID;
  parentId: ID | null;
  kind: NoteKind;
  title: string;
  /** Sort position among siblings. */
  order: number;
  /** Sections only: categorical color slot 1–8. */
  color: number | null;
  /** Pages only: markdown, with HTML and CSS allowed. */
  content: string;
  /** Boards only. */
  board: Board | null;
  createdAt: number;
  updatedAt: number;
}

export type CardData = {
  title: string;
  /** Short markdown; [[Page]] links work here too. */
  body: string;
  /** Color slot 1–8, or null for neutral. */
  color: number | null;
  imageId: string | null;
  /** 'cover' puts the image across the top; 'icon' shows it small beside the title (good for item textures). */
  imageStyle: 'cover' | 'icon';
  /** Crisp nearest-neighbor scaling for pixel art. */
  pixelated: boolean;
  noteIds: ID[];
};

export type ImageData = {
  assetId: string;
  caption: string;
  pixelated: boolean;
};

export type FrameData = {
  title: string;
  color: number | null;
};

export type BoardNode =
  | { id: ID; type: 'card'; x: number; y: number; w: number; h: number | null; data: CardData }
  | { id: ID; type: 'image'; x: number; y: number; w: number; h: number; data: ImageData }
  | { id: ID; type: 'frame'; x: number; y: number; w: number; h: number; data: FrameData };

export interface BoardEdge {
  id: ID;
  source: ID;
  target: ID;
  sourceHandle: string | null;
  targetHandle: string | null;
  label: string;
  dashed: boolean;
}

export interface Board {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

export interface NotesData {
  notes: NoteNode[];
}

export const CHILD_KINDS: Record<'root' | NoteKind, NoteKind[]> = {
  root: ['folder', 'section', 'page', 'board'],
  folder: ['folder', 'section', 'page', 'board'],
  section: ['page', 'board'],
  page: [],
  board: [],
};

export const KIND_LABELS: Record<NoteKind, string> = {
  folder: 'Folder',
  section: 'Section',
  page: 'Page',
  board: 'Flowmap board',
};
