import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Settings for the coach: which Claude model to use, what may be sent, and your API key.
 *
 * The key lives in this browser only. It is never synced to your account, never written to a
 * backup, and is sent to nothing but api.anthropic.com.
 */

export interface Model {
  id: string;
  label: string;
  hint: string;
}

export const MODELS: Model[] = [
  { id: 'claude-sonnet-5', label: 'Sonnet 5', hint: 'Balanced — a good default' },
  { id: 'claude-opus-5', label: 'Opus 5', hint: 'Thinks hardest; slower and dearer' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', hint: 'Quick and cheap' },
];

export const DEFAULT_MODEL = MODELS[0].id;

interface AiPrefs {
  /** Anthropic API key (`sk-ant-…`), kept on this device. */
  apiKey: string;
  model: string;
  /** Send what you wrote in your journal, not just the moods. Off by default. */
  includeJournalText: boolean;
  /** Send a summary of health measurements. Off by default. */
  includeHealth: boolean;
  setKey(key: string): void;
  setModel(model: string): void;
  setInclude(patch: Partial<Pick<AiPrefs, 'includeJournalText' | 'includeHealth'>>): void;
}

export const useAiPrefs = create<AiPrefs>()(
  persist(
    (set) => ({
      apiKey: '',
      model: DEFAULT_MODEL,
      includeJournalText: false,
      includeHealth: false,
      setKey: (apiKey) => set({ apiKey: apiKey.trim() }),
      setModel: (model) => set({ model }),
      setInclude: (patch) => set(patch),
    }),
    { name: 'meridian:ai' },
  ),
);

export const hasApiKey = () => useAiPrefs.getState().apiKey.length > 0;

/** A rough check so an obvious mistake (a pasted URL, the wrong key) is caught before a request. */
export function keyProblem(key: string): string | null {
  const value = key.trim();
  if (!value) return 'Paste your API key first.';
  if (/^https?:\/\//i.test(value)) return 'That looks like a URL, not an API key.';
  if (!value.startsWith('sk-ant-')) return 'An Anthropic API key starts with “sk-ant-”.';
  if (value.length < 40) return 'That key looks too short — copy the whole thing.';
  return null;
}
