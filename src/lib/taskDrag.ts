import { useEffect, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { create } from 'zustand';
import type { ID } from '../types';

/**
 * Dragging a task onto a drop target (the day clock). Uses pointer events rather than HTML5 drag and drop,
 * so it works with touch on phones and avoids Chrome's stuck-drag bugs.
 */

export interface TaskDrag {
  taskId: ID;
  title: string;
  x: number;
  y: number;
  /** The drop target under the pointer, if any. */
  target: string | null;
}

export const useTaskDrag = create<{ drag: TaskDrag | null }>(() => ({ drag: null }));

interface DropTarget {
  id: string;
  element: () => Element | null;
  onDrop: (taskId: ID, clientX: number, clientY: number) => void;
}

const targets = new Map<string, DropTarget>();

const hit = (x: number, y: number) => {
  for (const t of targets.values()) {
    const r = t.element()?.getBoundingClientRect();
    if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return t;
  }
  return null;
};

/** Registers an element as a place tasks can be dropped. */
export function useTaskDropTarget(id: string, ref: RefObject<Element | null>, onDrop: DropTarget['onDrop']) {
  useEffect(() => {
    targets.set(id, { id, element: () => ref.current, onDrop });
    return () => void targets.delete(id);
  }, [id, ref, onDrop]);
}

const THRESHOLD_PX = 5;

/** Call from a drag handle's onPointerDown. The drag starts once the pointer has moved a few pixels. */
export function beginTaskDrag(e: ReactPointerEvent, task: { id: ID; title: string }) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startY = e.clientY;
  let active = false;

  const move = (ev: PointerEvent) => {
    if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD_PX) return;
    if (!active) {
      active = true;
      document.body.classList.add('is-dragging-task');
    }
    ev.preventDefault();
    useTaskDrag.setState({ drag: { taskId: task.id, title: task.title, x: ev.clientX, y: ev.clientY, target: hit(ev.clientX, ev.clientY)?.id ?? null } });
  };
  const finish = (drop: PointerEvent | null) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key);
    document.body.classList.remove('is-dragging-task');
    useTaskDrag.setState({ drag: null });
    if (active && drop) hit(drop.clientX, drop.clientY)?.onDrop(task.id, drop.clientX, drop.clientY);
  };
  const up = (ev: PointerEvent) => finish(ev);
  const cancel = () => finish(null);
  const key = (ev: KeyboardEvent) => ev.key === 'Escape' && finish(null);

  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key);
}
