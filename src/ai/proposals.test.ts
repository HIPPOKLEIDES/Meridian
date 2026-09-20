import { describe, expect, it } from 'vitest';
import { parseProposals } from './proposals';

const known = { habits: new Set(['h1']), goals: new Set(['g1']), tasks: new Set(['t1']) };

describe('reading proposals from the model', () => {
  it('accepts a well-formed habit and normalizes its fields', () => {
    const [p] = parseProposals(
      { changes: [{ kind: 'new_habit', title: '  Evening walk  ', days: [1, 1, 3, 9, 5], start: '18:30', minutes: 20, steps: ['Shoes on', ''], rationale: 'You walk most when it is light.' }] },
      known,
    );
    expect(p).toMatchObject({ kind: 'new_habit', title: 'Evening walk', days: [1, 3, 5], start: 18 * 60 + 30, minutes: 20, steps: ['Shoes on'] });
  });

  it('reads "any" as no set time, and keeps zero minutes', () => {
    const [p] = parseProposals({ changes: [{ kind: 'new_habit', title: 'Drink water', start: 'any', minutes: 0, rationale: '' }] }, known);
    expect(p.start).toBeNull();
    expect(p.minutes).toBe(0);
  });

  it('drops changes aimed at something that does not exist', () => {
    const changes = [
      { kind: 'adjust_habit', id: 'gone', minutes: 10, rationale: 'x' },
      { kind: 'adjust_goal', id: 'g1', status: 'paused', rationale: 'It can wait.' },
    ];
    const out = parseProposals({ changes }, known);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'adjust_goal', targetId: 'g1', status: 'paused' });
  });

  it('refuses nonsense: unknown kinds, empty names, tweaks that change nothing', () => {
    const changes = [
      { kind: 'delete_everything', id: 'h1', rationale: 'no' },
      { kind: 'new_goal', rationale: 'no name' },
      { kind: 'adjust_task', id: 't1', rationale: 'nothing to change' },
      { kind: 'new_task', title: 'Book the dentist', priority: 'sideways', end_date: 'next week' },
    ];
    const out = parseProposals({ changes }, known);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'new_task', title: 'Book the dentist' });
    expect(out[0].priority).toBeUndefined();
    expect(out[0].endDate).toBeUndefined();
  });

  it('survives junk input', () => {
    expect(parseProposals(null, known)).toEqual([]);
    expect(parseProposals({ changes: 'lots' }, known)).toEqual([]);
    expect(parseProposals({ changes: [null, 7, 'x'] }, known)).toEqual([]);
  });
});
