import type { Task } from '../types';

/** Task tags: short free-form labels ("art", "needs review"), matched case-insensitively. */

export const MAX_TAG_LENGTH = 32;

/** Trims, collapses spaces and drops a leading '#'. Returns '' for nothing usable. */
export const normalizeTag = (raw: string) => raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

export const hasTag = (tags: readonly string[] | undefined, tag: string) => !!tags?.some((t) => same(t, tag));

/** Adds a tag unless it's empty or already there (in any capitalization). */
export function addTag(tags: readonly string[] | undefined, raw: string): string[] {
  const tag = normalizeTag(raw);
  const list = [...(tags ?? [])];
  if (!tag || hasTag(list, tag)) return list;
  return [...list, tag];
}

export const removeTag = (tags: readonly string[] | undefined, tag: string) => (tags ?? []).filter((t) => !same(t, tag));

/** Tags used across tasks, most used first; the first spelling seen wins. */
export function tagsInUse(tasks: readonly Task[]): string[] {
  const counts = new Map<string, { tag: string; n: number }>();
  for (const t of tasks) {
    for (const tag of t.tags ?? []) {
      const key = tag.toLocaleLowerCase();
      const entry = counts.get(key);
      if (entry) entry.n++;
      else counts.set(key, { tag, n: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)).map((e) => e.tag);
}

/** Whether a task carries every one of the selected tags. */
export const matchesTags = (task: Task, selected: readonly string[]) => selected.every((s) => hasTag(task.tags, s));

/**
 * Pulls #tags out of a quick-add title: "Sketch the forge #art #blocked" → title "Sketch the forge", tags [art, blocked].
 * A tag must start with a letter, so "Fix bug #42" keeps its number.
 */
export function parseTitleTags(input: string): { title: string; tags: string[] } {
  let tags: string[] = [];
  const title = input
    .replace(/(^|\s)#(\p{L}[\p{L}\p{N}_-]*)/gu, (_, space: string, tag: string) => {
      tags = addTag(tags, tag);
      return space;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { title, tags };
}

/** A stable color slot (1–8) for a tag, so it looks the same everywhere. */
export function tagSlot(tag: string) {
  let h = 0;
  for (const c of tag.toLocaleLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 8) + 1;
}
