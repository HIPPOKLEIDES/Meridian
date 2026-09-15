import { useMemo, useState, type ReactNode } from 'react';
import type { DateKey } from '../types';
import type { LifeGoal } from './types';
import { cleanTag, isOpenGoal } from './types';
import { reviewStatus, useGoals } from './store';
import { DEFAULT_JOURNAL_ID, tagsIn, useJournal, useJournalReady, wordCount } from '../journal/store';
import { useJournalLock } from '../journal/vault';
import { MOODS, moodColor, type JournalEntry } from '../journal/types';
import { Empty, Icon } from '../components/common';
import { DateInput } from '../components/inputs';
import { fmtDateShort, todayKey, WEEKDAY_SHORT } from '../lib/dates';
import { navigate } from '../lib/hooks';
import { sound } from '../lib/sound';

/** Journal entries (any journal) tagged with the goal's #tag, newest first. */
export function useTaggedEntries(tag: string, since?: DateKey) {
  const ready = useJournalReady();
  const locked = useJournalLock((s) => s.status === 'locked');
  const entries = useJournal((s) => s.entries);
  const tagged = useMemo(
    () =>
      tag && ready
        ? entries.filter((e) => (!since || e.date >= since) && tagsIn(e.text).includes(tag)).sort((a, b) => (a.date < b.date ? 1 : -1))
        : [],
    [entries, tag, since, ready],
  );
  return { ready, locked, entries: tagged };
}

/** The paragraphs that mention the tag, or the start of the entry. */
export function tagExcerpt(text: string, tag: string, max = 280) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const hits = paragraphs.filter((p) => tagsIn(p).includes(tag) && p.replace(/#[\p{L}\p{N}_-]+/gu, '').trim());
  // A paragraph that is only tags points at the rest of the entry.
  const chosen = (hits.length ? hits : paragraphs.filter((p) => p.replace(/#[\p{L}\p{N}_-]+/gu, '').trim())).join('\n\n');
  return chosen.length > max ? `${chosen.slice(0, max).trimEnd()}…` : chosen;
}

/** Adds the goal's tag to today's daily entry (if it isn't there yet) and opens the journal. */
export function writeAboutGoal(goal: LifeGoal) {
  const { status, loaded } = useJournalLock.getState();
  if (!goal.tag || !loaded || (status !== 'plain' && status !== 'unlocked')) {
    navigate('journal');
    return;
  }
  const today = todayKey();
  const { entries, saveEntry } = useJournal.getState();
  const entry = entries.find((e) => e.journalId === DEFAULT_JOURNAL_ID && e.date === today);
  const text = entry?.text ?? '';
  if (!tagsIn(text).includes(goal.tag)) saveEntry(DEFAULT_JOURNAL_ID, today, { text: `${text.trimEnd()}${text.trim() ? '\n\n' : ''}#${goal.tag}\n` });
  navigate(`journal/${DEFAULT_JOURNAL_ID}`);
}

export function MentionList({ entries, tag, limit = 4 }: { entries: JournalEntry[]; tag: string; limit?: number }) {
  const [shown, setShown] = useState(limit);
  const journals = useJournal((s) => s.journals);
  return (
    <>
      <ul className="mentions">
        {entries.slice(0, shown).map((e) => {
          const journal = journals.find((j) => j.id === e.journalId);
          return (
            <li key={e.id}>
              <button className="mention" onClick={() => navigate(`journal/${e.journalId}/${e.date}`)}>
                <span className="entry-preview-head small">
                  <b>{fmtDateShort(e.date)}</b>
                  {e.mood && (
                    <span className="muted">
                      <span className="dot" style={{ background: moodColor(e.mood) }} /> {MOODS[e.mood - 1].label}
                    </span>
                  )}
                  {journals.length > 1 && journal && <span className="muted">{journal.name}</span>}
                  <span className="muted">{wordCount(e.text)} words</span>
                </span>
                <span className="mention-text">{tagExcerpt(e.text, tag)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {entries.length > shown && (
        <button className="link small" onClick={() => setShown(shown + 10)}>
          Show more ({entries.length - shown})
        </button>
      )}
    </>
  );
}

export function JournalCard({ goal }: { goal: LifeGoal }) {
  const updateGoal = useGoals((s) => s.updateGoal);
  const { ready, locked, entries } = useTaggedEntries(goal.tag);
  const [draft, setDraft] = useState(goal.tag);
  return (
    <section className="card stack">
      <header className="card-head">
        <div>
          <h3 className="card-title">From your journal</h3>
          <p className="small muted">Entries tagged with this goal's tag collect here. Writing about it counts as reflection too.</p>
        </div>
        <button className="btn sm" onClick={() => writeAboutGoal(goal)} disabled={!goal.tag}>
          <Icon name="journal" size={14} /> Write about it
        </button>
      </header>
      <label className="tag-field">
        <span className="small muted">Tag</span>
        <span className="tag-input">
          #
          <input
            className="input bare"
            value={draft}
            placeholder="pick-a-tag"
            aria-label="Journal tag"
            onChange={(e) => setDraft(cleanTag(e.target.value))}
            onBlur={() => draft !== goal.tag && updateGoal(goal.id, { tag: draft })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </span>
      </label>
      {locked ? (
        <div className="locked-note">
          <Icon name="lock" size={14} /> The journal is locked.{' '}
          <button className="link" onClick={() => navigate('journal')}>
            Unlock it
          </button>{' '}
          to see entries.
        </div>
      ) : !goal.tag ? (
        <Empty>Pick a tag, then add #tag anywhere in a journal entry.</Empty>
      ) : !ready ? null : entries.length === 0 ? (
        <Empty>No entries tagged #{goal.tag} yet.</Empty>
      ) : (
        <MentionList entries={entries} tag={goal.tag} />
      )}
    </section>
  );
}

/** Rating, the goal's reflection prompts and a next step. Prefills from an existing check-in on the same day. */
export function CheckInForm({
  goal,
  fixedDate,
  submitLabel = 'Save check-in',
  onSaved,
  extraActions,
}: {
  goal: LifeGoal;
  fixedDate?: DateKey;
  submitLabel?: string;
  onSaved?: () => void;
  extraActions?: ReactNode;
}) {
  const saveCheckIn = useGoals((s) => s.saveCheckIn);
  const updateGoal = useGoals((s) => s.updateGoal);
  const today = todayKey();
  const [date, setDate] = useState(fixedDate ?? today);
  // In the review, reopening a goal shows what was already entered today.
  const existing = fixedDate ? goal.checkIns.find((c) => c.date === fixedDate) : undefined;
  const last = [...goal.checkIns].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const [rating, setRating] = useState(existing?.rating ?? last?.rating ?? 5);
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries((existing?.answers ?? []).map((a) => [a.prompt, a.text])));
  const [note, setNote] = useState(existing?.note ?? '');
  const [next, setNext] = useState(existing?.next ?? '');
  const [editingPrompts, setEditingPrompts] = useState(false);
  const [promptDraft, setPromptDraft] = useState(goal.prompts.join('\n'));

  return (
    <form
      className="checkin-form goal-checkin"
      onSubmit={(e) => {
        e.preventDefault();
        saveCheckIn(goal.id, {
          date,
          rating,
          answers: goal.prompts.map((prompt) => ({ prompt, text: (answers[prompt] ?? '').trim() })).filter((a) => a.text),
          note: note.trim(),
          next: next.trim(),
        });
        sound('check');
        if (!fixedDate) {
          setAnswers({});
          setNote('');
          setNext('');
        }
        onSaved?.();
      }}
    >
      <label className="pain-slider">
        <span>
          How's it going? <b>{rating}</b>/10
        </span>
        <input type="range" min={1} max={10} value={rating} onChange={(e) => setRating(Number(e.target.value))} />
      </label>
      {goal.prompts.map((prompt) => (
        <label key={prompt} className="field">
          <span className="field-label">{prompt}</span>
          <textarea className="input" rows={2} value={answers[prompt] ?? ''} onChange={(e) => setAnswers({ ...answers, [prompt]: e.target.value })} />
        </label>
      ))}
      {goal.prompts.length === 0 && (
        <textarea className="input" rows={2} placeholder="What's working? What isn't?" value={note} onChange={(e) => setNote(e.target.value)} />
      )}
      <label className="field">
        <span className="field-label">Next small step</span>
        <input className="input" placeholder="One thing to try before the next check-in" value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      {editingPrompts ? (
        <div className="field">
          <span className="field-label">Reflection prompts for this goal (one per line)</span>
          <textarea className="input" rows={3} value={promptDraft} onChange={(e) => setPromptDraft(e.target.value)} />
          <div className="row tight">
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                updateGoal(goal.id, { prompts: promptDraft.split('\n').map((p) => p.trim()).filter(Boolean) });
                setEditingPrompts(false);
              }}
            >
              Save prompts
            </button>
            <button type="button" className="btn sm ghost" onClick={() => setEditingPrompts(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <div className="row tight wrap">
        {!fixedDate && <DateInput value={date} onChange={(d) => setDate(d ?? today)} />}
        <button className="btn primary" type="submit">
          {submitLabel}
        </button>
        {extraActions}
        <span className="spacer" />
        {!editingPrompts && (
          <button
            type="button"
            className="link small"
            onClick={() => {
              setPromptDraft(goal.prompts.join('\n'));
              setEditingPrompts(true);
            }}
          >
            Edit prompts
          </button>
        )}
      </div>
    </form>
  );
}

/** Nudge for the weekly review. Hidden when there's nothing to review or it's done and not yet close. */
export function ReviewBanner() {
  const goals = useGoals((s) => s.goals);
  const reviews = useGoals((s) => s.reviews);
  const reviewDay = useGoals((s) => s.reviewDay);
  const today = todayKey();
  const open = goals.filter(isOpenGoal).length;
  if (!open) return null;
  const st = reviewStatus({ reviews, reviewDay }, today);
  const dayName = WEEKDAY_SHORT[reviewDay];
  return (
    <div className={`review-banner${st.due ? ' is-due' : ''}`}>
      <Icon name="refresh" size={16} />
      <div>
        <b>{st.due ? 'Weekly review is due' : st.early ? 'Weekly review coming up' : 'Weekly review done'}</b>
        <span className="small muted">
          {st.due
            ? `${open} open goal${open === 1 ? '' : 's'} · about 2 minutes each`
            : `Last done ${fmtDateShort(st.last!.date)} · next on ${dayName} ${fmtDateShort(st.nextDate)}`}
        </span>
      </div>
      <span className="spacer" />
      <button className={`btn sm${st.due || st.early ? ' primary' : ''}`} onClick={() => navigate('goals/review')}>
        {st.due || st.early ? 'Start review' : 'Review again'}
      </button>
    </div>
  );
}
