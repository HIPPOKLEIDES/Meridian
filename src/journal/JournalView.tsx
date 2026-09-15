import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { DateKey, ID } from '../types';
import type { Journal, JournalEntry } from './types';
import { moodColor, MOODS } from './types';
import { DEFAULT_JOURNAL_ID, journalStreak, lockJournal, onBeforeLock, PROMPTS, tagsIn, useJournal, useJournalReady, wordCount } from './store';
import { useJournalLock } from './vault';
import { JournalPrivacy, JournalUnlock } from './Privacy';
import { useGoals } from '../goals/store';
import { isOpenGoal } from '../goals/types';
import { useStore } from '../store';
import { Empty, Icon, Segmented } from '../components/common';
import { TrendChart } from '../components/TrendChart';
import { addDays, diffDays, fmtDateLong, fmtDateShort, fmtDuration, fmtMonth, fromKey, monthGrid, toKey, todayKey, WEEKDAY_LETTER } from '../lib/dates';
import { navigate } from '../lib/hooks';
import { scaleSound } from '../lib/sound';

const isDateKey = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function JournalView({ journalId, date }: { journalId?: string; date?: string }) {
  const ready = useJournalReady();
  const journals = useJournal((s) => s.journals);
  const entries = useJournal((s) => s.entries);
  const addJournal = useJournal((s) => s.addJournal);
  const lock = useJournalLock((s) => s.status);
  const [newJournalId, setNewJournalId] = useState<ID | null>(null);
  const today = todayKey();
  const journal = journals.find((j) => j.id === journalId) ?? journals.find((j) => j.id === DEFAULT_JOURNAL_ID) ?? journals[0];
  const day = isDateKey(date) && date! <= today ? date! : today;
  const go = (j: ID, d: DateKey) => navigate(`journal/${j}${d === today ? '' : `/${d}`}`);

  if (lock === 'locked') return <JournalUnlock />;
  if (!ready || !journal) return <div className="page"><Empty>Loading journal…</Empty></div>;

  const mine = entries.filter((e) => e.journalId === journal.id);
  const written = mine.filter((e) => e.text.trim());
  const streak = journalStreak(mine, today);

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <h1>Journal</h1>
          <p className="page-sub">
            {streak > 0 ? `${streak}-day streak · ` : ''}
            {written.length} entr{written.length === 1 ? 'y' : 'ies'} · {mine.reduce((s, e) => s + wordCount(e.text), 0).toLocaleString()} words
          </p>
        </div>
        <div className="row tight wrap">
          <Segmented
            value={journal.id}
            onChange={(id) => go(id, day)}
            options={journals.map((j) => ({ value: j.id, label: <><span className="dot" style={{ background: `var(--series-${j.color})` }} /> {j.name}</> }))}
          />
          <button
            className="btn"
            onClick={() => {
              const id = addJournal('New journal');
              setNewJournalId(id);
              go(id, day);
            }}
          >
            <Icon name="plus" /> Journal
          </button>
          {lock === 'unlocked' && (
            <button className="btn" onClick={() => lockJournal()} title="Clear the journal from memory until the passphrase is entered again">
              <Icon name="lock" size={14} /> Lock
            </button>
          )}
        </div>
      </header>

      <div className="journal-layout">
        <EntryEditor key={`${journal.id}:${day}`} journal={journal} date={day} onDate={(d) => go(journal.id, d)} autoFocus={journal.id !== newJournalId} />
        <aside className="journal-side">
          <MonthCard journal={journal} entries={mine} selected={day} onPick={(d) => go(journal.id, d)} />
          <YourDay date={day} />
          <MoodCard entries={mine} today={today} />
          <PastEntries entries={written} selected={day} onPick={(d) => go(journal.id, d)} />
          <JournalSettings key={journal.id} journal={journal} canDelete={journals.length > 1} isNew={journal.id === newJournalId} />
          <JournalPrivacy />
        </aside>
      </div>
    </div>
  );
}

function EntryEditor({ journal, date, onDate, autoFocus }: { journal: Journal; date: DateKey; onDate: (d: DateKey) => void; autoFocus: boolean }) {
  const entry = useJournal((s) => s.entries.find((e) => e.journalId === journal.id && e.date === date));
  const saveEntry = useJournal((s) => s.saveEntry);
  const [text, setText] = useState(entry?.text ?? '');
  const saved = useRef(entry?.text ?? '');
  // Show edits that arrive from another device, unless there's unsaved typing here (which wins when it saves).
  const incoming = entry?.text ?? '';
  const textNow = useRef(text);
  textNow.current = text;
  useEffect(() => {
    if (incoming === saved.current || textNow.current !== saved.current) return;
    saved.current = incoming;
    setText(incoming);
  }, [incoming]);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const today = todayKey();
  const prompts = journal.prompts.length ? journal.prompts : PROMPTS;
  const [promptIndex, setPromptIndex] = useState(() => Math.abs(diffDays('2020-01-01', date)) % prompts.length);

  // Autosave shortly after typing stops, and when leaving the day.
  useEffect(() => {
    if (text === saved.current) return;
    const t = setTimeout(() => {
      saved.current = text;
      saveEntry(journal.id, date, { text });
    }, 600);
    return () => clearTimeout(t);
  }, [text, journal.id, date, saveEntry]);
  useEffect(() => {
    const flush = () => {
      const el = areaRef.current;
      if (el && el.value !== saved.current) {
        saved.current = el.value;
        saveEntry(journal.id, date, { text: el.value });
      }
    };
    const unregister = onBeforeLock(flush);
    return () => {
      unregister();
      flush();
    };
  }, [journal.id, date, saveEntry]);

  // Grow with the text so long entries read like a page, not a scroll box.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 320)}px`;
  }, [text]);

  useEffect(() => {
    if (autoFocus && date === today) areaRef.current?.focus();
  }, [autoFocus, date, today]);

  const insertAtCursor = (snippet: string) => {
    const el = areaRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const next = text.slice(0, s) + snippet + text.slice(e);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + snippet.length, s + snippet.length);
    });
  };

  const words = wordCount(text);
  const tags = tagsIn(text);
  const goals = useGoals((s) => s.goals);
  const taggable = goals.filter((g) => g.tag && isOpenGoal(g) && !tags.includes(g.tag));

  return (
    <section className="card journal-main">
      <div className="journal-date">
        <button className="btn icon ghost" aria-label="Previous day" onClick={() => onDate(addDays(date, -1))}>
          <Icon name="left" />
        </button>
        <div className="journal-date-text">
          <b>{fmtDateLong(date)}</b>
          <span className="small muted">{date === today ? 'Today' : `${diffDays(date, today)} day${diffDays(date, today) === 1 ? '' : 's'} ago`}</span>
        </div>
        <button className="btn icon ghost" aria-label="Next day" disabled={date >= today} onClick={() => onDate(addDays(date, 1))}>
          <Icon name="right" />
        </button>
        {date !== today && (
          <button className="btn sm" onClick={() => onDate(today)}>
            Today
          </button>
        )}
      </div>

      <div className="mood-picker" role="radiogroup" aria-label="Mood">
        <span className="small muted">Mood</span>
        {MOODS.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={entry?.mood === m.value}
            className={`mood-btn${entry?.mood === m.value ? ' is-on' : ''}`}
            style={{ '--mood': moodColor(m.value) } as CSSProperties}
            onClick={() => {
              if (entry?.mood !== m.value) scaleSound(m.value - 1);
              saved.current = text;
              saveEntry(journal.id, date, { text, mood: entry?.mood === m.value ? null : m.value });
            }}
          >
            <span className="mood-swatch" />
            {m.label}
          </button>
        ))}
      </div>

      {!text.trim() && (
        <div className="journal-prompt">
          <span>{prompts[promptIndex % prompts.length]}</span>
          <button className="link small" onClick={() => setPromptIndex((i) => i + 1)}>
            Another
          </button>
        </div>
      )}

      <textarea
        ref={areaRef}
        className="journal-text"
        value={text}
        spellCheck
        placeholder="Start writing. Nothing here has to be tidy."
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== saved.current) {
            saved.current = text;
            saveEntry(journal.id, date, { text });
          }
        }}
      />

      <footer className="journal-foot">
        <span className="small muted">
          {words.toLocaleString()} word{words === 1 ? '' : 's'} · {text !== saved.current ? 'Saving…' : entry ? 'Saved' : 'Not started'}
        </span>
        {tags.map((t) => {
          const goal = goals.find((g) => g.tag === t);
          return goal ? (
            <button key={t} className="badge badge-link" title={`Goal: ${goal.title}`} onClick={() => navigate(`goals/${goal.id}`)}>
              <Icon name="target" size={11} /> #{t}
            </button>
          ) : (
            <span key={t} className="badge">
              #{t}
            </span>
          );
        })}
        <span className="spacer" />
        {taggable.length > 0 && (
          <select
            className="input sm goal-tag-select"
            value=""
            aria-label="Tag a goal"
            onChange={(e) => e.target.value && insertAtCursor(`${text && !/\s$/.test(text) ? ' ' : ''}#${e.target.value} `)}
          >
            <option value="">Tag a goal…</option>
            {taggable.map((g) => (
              <option key={g.id} value={g.tag}>
                #{g.tag} · {g.title}
              </option>
            ))}
          </select>
        )}
        <button
          className="btn sm ghost"
          title="Insert the current time as a divider"
          onClick={() => insertAtCursor(`${text && !text.endsWith('\n') ? '\n\n' : ''}— ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} —\n`)}
        >
          <Icon name="clock" size={14} /> Time
        </button>
      </footer>
    </section>
  );
}

function MonthCard({ journal, entries, selected, onPick }: { journal: Journal; entries: JournalEntry[]; selected: DateKey; onPick: (d: DateKey) => void }) {
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);
  const today = todayKey();
  const [month, setMonth] = useState(() => ({ y: fromKey(selected).getFullYear(), m: fromKey(selected).getMonth() }));
  const byDate = useMemo(() => new Map(entries.map((e) => [e.date, e])), [entries]);
  const cells = monthGrid(month.y, month.m, weekStartsOn);
  const shift = (n: number) => {
    const d = new Date(month.y, month.m + n, 1);
    setMonth({ y: d.getFullYear(), m: d.getMonth() });
  };
  const count = entries.filter((e) => e.text.trim() && fromKey(e.date).getMonth() === month.m && fromKey(e.date).getFullYear() === month.y).length;

  return (
    <section className="card">
      <header className="card-head">
        <h3 className="card-title">
          {fmtMonth(month.y, month.m)} <span className="muted small">· {count} entr{count === 1 ? 'y' : 'ies'}</span>
        </h3>
        <div className="row tight">
          <button className="btn icon ghost sm" aria-label="Previous month" onClick={() => shift(-1)}>
            <Icon name="left" size={14} />
          </button>
          <button className="btn icon ghost sm" aria-label="Next month" onClick={() => shift(1)}>
            <Icon name="right" size={14} />
          </button>
        </div>
      </header>
      <div className="mini-cal">
        {cells.slice(0, 7).map((d) => (
          <span key={`h${d}`} className="mini-cal-head">
            {WEEKDAY_LETTER[fromKey(d).getDay()]}
          </span>
        ))}
        {cells.map((d) => {
          const e = byDate.get(d);
          const inMonth = fromKey(d).getMonth() === month.m;
          return (
            <button
              key={d}
              className={`mini-cal-day${inMonth ? '' : ' is-outside'}${d === selected ? ' is-selected' : ''}${e?.text.trim() ? ' has-entry' : ''}${d === today ? ' is-today' : ''}`}
              style={e?.mood ? ({ '--mood': moodColor(e.mood) } as CSSProperties) : undefined}
              disabled={d > today}
              title={e ? `${fmtDateShort(d)}: ${wordCount(e.text)} words${e.mood ? `, ${MOODS[e.mood - 1].label.toLowerCase()}` : ''}` : fmtDateShort(d)}
              onClick={() => onPick(d)}
            >
              {fromKey(d).getDate()}
            </button>
          );
        })}
      </div>
      <p className="small muted mini-cal-key">
        <span className="entry-dot" /> written · color shows mood · {journal.name}
      </p>
    </section>
  );
}

function YourDay({ date }: { date: DateKey }) {
  const habits = useStore((s) => s.habits);
  const tasks = useStore((s) => s.tasks);
  const timeEntries = useStore((s) => s.entries);
  const areas = useStore((s) => s.areas);
  const doneHabits = habits.filter((h) => h.log[date]?.done);
  const doneTasks = tasks.filter((t) => t.completedAt && toKey(new Date(t.completedAt)) === date);
  const logged = timeEntries.filter((e) => e.date === date);
  const byArea = areas
    .map((a) => ({ a, min: logged.filter((e) => e.areaId === a.id).reduce((s, e) => s + e.end - e.start, 0) }))
    .filter((x) => x.min > 0)
    .sort((x, y) => y.min - x.min);
  const empty = !doneHabits.length && !doneTasks.length && !logged.length;

  return (
    <section className="card">
      <h3 className="card-title">Your day</h3>
      {empty ? (
        <Empty>Nothing tracked for this day.</Empty>
      ) : (
        <div className="stack tight small">
          {byArea.length > 0 && (
            <div className="legend-list">
              {byArea.map(({ a, min }) => (
                <span key={a.id} className="legend-item">
                  <span className="dot" style={{ background: `var(--series-${a.slot})` }} /> {a.name} <b>{fmtDuration(min)}</b>
                </span>
              ))}
            </div>
          )}
          {doneHabits.length > 0 && (
            <div>
              <span className="muted">Habits: </span>
              {doneHabits.map((h) => h.title).join(', ')}
            </div>
          )}
          {doneTasks.length > 0 && (
            <div>
              <span className="muted">Finished: </span>
              {doneTasks.map((t) => t.title).join(', ')}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function MoodCard({ entries, today }: { entries: JournalEntry[]; today: DateKey }) {
  const points = entries
    .filter((e) => e.mood !== null && e.date >= addDays(today, -89))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((e) => ({ date: e.date, value: e.mood as number }));
  if (points.length < 3) return null;
  const avg = points.slice(-7).reduce((s, p) => s + p.value, 0) / Math.min(7, points.length);
  return (
    <section className="card">
      <header className="card-head">
        <h3 className="card-title">Mood, last 90 days</h3>
        <span className="small muted">recent avg {MOODS[Math.round(avg) - 1].label.toLowerCase()}</span>
      </header>
      <TrendChart points={points} color="var(--series-1)" height={150} yMin={1} yMax={5} format={(v) => MOODS[Math.min(4, Math.max(0, Math.round(v) - 1))].label} />
    </section>
  );
}

function PastEntries({ entries, selected, onPick }: { entries: JournalEntry[]; selected: DateKey; onPick: (d: DateKey) => void }) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(12);
  const q = query.trim().toLowerCase();
  const shown = entries.filter((e) => !q || e.text.toLowerCase().includes(q)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const snippet = (e: JournalEntry) => {
    if (!q) return e.text.trim().split('\n').find((l) => l.trim()) ?? '';
    const i = e.text.toLowerCase().indexOf(q);
    return `${i > 30 ? '…' : ''}${e.text.slice(Math.max(0, i - 30), i + q.length + 60).replace(/\s+/g, ' ')}`;
  };
  return (
    <section className="card">
      <h3 className="card-title">Entries</h3>
      <input className="input sm journal-search" placeholder="Search entries or #tags…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {shown.length === 0 ? (
        <Empty>{entries.length ? 'No entries match.' : 'Past entries show up here.'}</Empty>
      ) : (
        <ul className="entry-previews">
          {shown.slice(0, limit).map((e) => (
            <li key={e.id}>
              <button className={`entry-preview${e.date === selected ? ' is-selected' : ''}`} onClick={() => onPick(e.date)}>
                <span className="entry-preview-head">
                  <b>{fmtDateShort(e.date)}</b>
                  {e.mood && (
                    <span className="small muted">
                      <span className="dot" style={{ background: moodColor(e.mood) }} /> {MOODS[e.mood - 1].label}
                    </span>
                  )}
                  <span className="small muted">{wordCount(e.text)} words</span>
                </span>
                <span className="entry-preview-text">{snippet(e)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown.length > limit && (
        <button className="link small" onClick={() => setLimit(limit + 20)}>
          Show more
        </button>
      )}
    </section>
  );
}

function JournalSettings({ journal, canDelete, isNew }: { journal: Journal; canDelete: boolean; isNew: boolean }) {
  const updateJournal = useJournal((s) => s.updateJournal);
  const deleteJournal = useJournal((s) => s.deleteJournal);
  const [prompts, setPrompts] = useState(journal.prompts.join('\n'));
  return (
    <details className="card journal-settings" open={isNew || undefined}>
      <summary className="small">Journal settings · {journal.name}</summary>
      <div className="stack tight">
        <label className="field">
          <span className="field-label">Name</span>
          <input
            className="input"
            value={journal.name}
            autoFocus={isNew}
            onFocus={(e) => isNew && e.target.select()}
            onChange={(e) => updateJournal(journal.id, { name: e.target.value })}
          />
        </label>
        <div className="field">
          <span className="field-label">Color</span>
          <div className="swatches">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => (
              <button
                key={slot}
                type="button"
                aria-label={`Color ${slot}`}
                className={`swatch-btn${journal.color === slot ? ' is-on' : ''}`}
                style={{ background: `var(--series-${slot})` }}
                onClick={() => updateJournal(journal.id, { color: slot })}
              />
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field-label">Prompts (one per line)</span>
          <textarea
            className="input"
            rows={4}
            value={prompts}
            placeholder="Leave empty for the built-in prompts"
            onChange={(e) => setPrompts(e.target.value)}
            onBlur={() => updateJournal(journal.id, { prompts: prompts.split('\n').map((p) => p.trim()).filter(Boolean) })}
          />
        </label>
        {canDelete && (
          <button
            className="btn sm danger ghost"
            onClick={() => {
              if (confirm(`Delete the “${journal.name}” journal and all its entries? This can't be undone.`)) {
                deleteJournal(journal.id);
                navigate('journal');
              }
            }}
          >
            <Icon name="trash" size={14} /> Delete journal
          </button>
        )}
      </div>
    </details>
  );
}
