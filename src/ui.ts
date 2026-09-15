import { create } from 'zustand';
import { sound, type SoundName } from './lib/sound';
import type { DateKey, Habit, ID, Project, Task, TimeBlock, TimeEntry } from './types';

/** The single editor dialog that can be open at a time. `id: null` means "create". */
export type Dialog =
  | { kind: 'task'; id: ID | null; draft?: Partial<Task> }
  | { kind: 'habit'; id: ID | null; draft?: Partial<Habit> }
  /** `on` is the occurrence date a repeating block was opened from. */
  | { kind: 'block'; id: ID | null; draft?: Partial<TimeBlock>; on?: DateKey }
  | { kind: 'entry'; id: ID | null; draft?: Partial<TimeEntry> }
  | { kind: 'project'; id: ID | null; draft?: Partial<Project> };

interface Toast {
  id: number;
  text: string;
}

interface UIState {
  dialog: Dialog | null;
  toasts: Toast[];
  open(d: Dialog): void;
  close(): void;
  /** Shows a message with a soft chime (pass null for silence). */
  toast(text: string, cue?: SoundName | null): void;
}

let toastSeq = 0;

export const useUI = create<UIState>()((set) => ({
  dialog: null,
  toasts: [],
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
  toast: (text, cue = 'notify') => {
    const id = ++toastSeq;
    if (cue) sound(cue);
    set((s) => ({ toasts: [...s.toasts, { id, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
  },
}));
