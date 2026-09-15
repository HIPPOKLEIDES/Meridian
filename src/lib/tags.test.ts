import { describe, expect, it } from 'vitest';
import { newTask } from '../store';
import { addTag, matchesTags, normalizeTag, parseTitleTags, removeTag, tagSlot, tagsInUse } from './tags';

describe('task tags', () => {
  it('normalizes and de-duplicates regardless of capitalization', () => {
    expect(normalizeTag('  #Needs   review ')).toBe('Needs review');
    expect(addTag(['Art'], 'art')).toEqual(['Art']);
    expect(addTag(['Art'], '  ')).toEqual(['Art']);
    expect(addTag(undefined, 'blocked')).toEqual(['blocked']);
    expect(removeTag(['Art', 'blocked'], 'ART')).toEqual(['blocked']);
  });

  it('pulls #tags out of quick-add titles but leaves issue numbers alone', () => {
    expect(parseTitleTags('Sketch the forge #art #Blocked')).toEqual({ title: 'Sketch the forge', tags: ['art', 'Blocked'] });
    expect(parseTitleTags('#urgent Renew passport')).toEqual({ title: 'Renew passport', tags: ['urgent'] });
    expect(parseTitleTags('Fix bug #42 in loot tables')).toEqual({ title: 'Fix bug #42 in loot tables', tags: [] });
    expect(parseTitleTags('Email C#developers')).toEqual({ title: 'Email C#developers', tags: [] });
  });

  it('lists tags by how often they are used', () => {
    const tasks = [newTask({ tags: ['art', 'blocked'] }), newTask({ tags: ['Art'] }), newTask({})];
    expect(tagsInUse(tasks)).toEqual(['art', 'blocked']);
  });

  it('filters tasks that have all selected tags', () => {
    const task = newTask({ tags: ['Art', 'mod'] });
    expect(matchesTags(task, ['art'])).toBe(true);
    expect(matchesTags(task, ['art', 'blocked'])).toBe(false);
    expect(matchesTags(newTask({}), [])).toBe(true);
  });

  it('gives each tag a stable color', () => {
    expect(tagSlot('Art')).toBe(tagSlot('art'));
    expect(tagSlot('art')).toBeGreaterThanOrEqual(1);
    expect(tagSlot('art')).toBeLessThanOrEqual(8);
  });
});
