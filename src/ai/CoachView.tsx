import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useGoals } from '../goals/store';
import { useJournal } from '../journal/store';
import { useJournalLock } from '../journal/vault';
import { useHealth } from '../health/store';
import { useUI } from '../ui';
import { todayKey } from '../lib/dates';
import { renderMarkdown } from '../notes/markdown';
import { sound } from '../lib/sound';
import { Icon, Segmented } from '../components/common';
import { AiError, streamMessage, type ChatMessage } from './client';
import { MODELS, keyProblem, useAiPrefs } from './config';
import { buildContext, contextText } from './context';
import { PROPOSE_TOOL, parseProposals, type Proposal } from './proposals';
import { applyProposal, describeProposal } from './apply';
import { QUICK_PROMPTS, systemPrompt } from './prompt';

/**
 * The coach: Claude, reading the same week you see, over your own Anthropic API key.
 *
 * Every request carries a fresh snapshot of your data (Coach → what gets sent shows it exactly).
 * Claude can propose changes to habits, goals and tasks, but nothing is applied until you press Apply.
 */

interface Offer {
  proposal: Proposal;
  applied?: string;
  dismissed?: boolean;
}

interface Turn {
  id: number;
  role: 'user' | 'assistant' | 'note';
  text: string;
  offers?: Offer[];
  error?: string;
  streaming?: boolean;
}

let turnSeq = 0;
const MAX_HISTORY = 20;

export function CoachView() {
  const apiKey = useAiPrefs((s) => s.apiKey);
  const [showSettings, setShowSettings] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const toast = useUI((s) => s.toast);

  const areas = useStore((s) => s.areas);
  const projects = useStore((s) => s.projects);
  const tasks = useStore((s) => s.tasks);
  const habits = useStore((s) => s.habits);
  const entries = useStore((s) => s.entries);
  const goalList = useGoals((s) => s.goals);
  const reviews = useGoals((s) => s.reviews);
  const reviewDay = useGoals((s) => s.reviewDay);
  const journals = useJournal((s) => s.journals);
  const journalEntries = useJournal((s) => s.entries);
  const metrics = useHealth((s) => s.metrics);
  const measurements = useHealth((s) => s.measurements);
  const injuries = useHealth((s) => s.injuries);
  const journalLocked = useJournalLock((s) => s.status === 'locked');
  const { model, includeJournalText, includeHealth } = useAiPrefs();

  const context = useMemo(
    () =>
      buildContext(
        {
          core: { areas, projects, tasks, habits, entries },
          goals: { goals: goalList, reviews, reviewDay },
          journal: { journals, entries: journalEntries },
          health: includeHealth ? ({ metrics, measurements, injuries } as never) : undefined,
        },
        { today: todayKey(), includeJournalText, includeHealth, journalLocked },
      ),
    [areas, projects, tasks, habits, entries, goalList, reviews, reviewDay, journals, journalEntries, metrics, measurements, injuries, includeJournalText, includeHealth, journalLocked],
  );

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  useEffect(() => () => abort.current?.abort(), []);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setInput('');
    const history = toHistory(turns, question);

    const replyId = ++turnSeq;
    setTurns((prev) => [...prev, { id: ++turnSeq, role: 'user', text: question }, { id: replyId, role: 'assistant', text: '', streaming: true }]);
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;

    const patchReply = (patch: Partial<Turn>) => setTurns((prev) => prev.map((t) => (t.id === replyId ? { ...t, ...patch } : t)));

    try {
      const result = await streamMessage({
        apiKey,
        model,
        system: systemPrompt(contextText(context), todayKey()),
        messages: history,
        tools: [PROPOSE_TOOL],
        signal: controller.signal,
        onText: (chunk) => setTurns((prev) => prev.map((t) => (t.id === replyId ? { ...t, text: t.text + chunk } : t))),
      });
      const known = {
        habits: new Set(useStore.getState().habits.map((h) => h.id)),
        goals: new Set(useGoals.getState().goals.map((g) => g.id)),
        tasks: new Set(useStore.getState().tasks.map((t) => t.id)),
      };
      const proposals = result.toolCalls.filter((c) => c.name === PROPOSE_TOOL.name).flatMap((c) => parseProposals(c.input, known));
      patchReply({ streaming: false, offers: proposals.map((proposal) => ({ proposal })) });
      if (result.text.trim() || proposals.length) sound('notify');
    } catch (e) {
      // Stopping on purpose keeps whatever had arrived; a real failure says why.
      const message = e instanceof AiError || e instanceof Error ? e.message : 'Something went wrong.';
      patchReply({ streaming: false, error: controller.signal.aborted ? undefined : message });
    } finally {
      abort.current = null;
      setBusy(false);
    }
  };

  const decide = (turnId: number, index: number, accept: boolean) => {
    const turn = turns.find((t) => t.id === turnId);
    const offer = turn?.offers?.[index];
    if (!offer || offer.applied || offer.dismissed) return;
    let outcome: Partial<Offer>;
    if (accept) {
      try {
        const done = applyProposal(offer.proposal);
        toast(done, 'complete');
        outcome = { applied: done };
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not apply that', null);
        outcome = { dismissed: true };
      }
    } else {
      outcome = { dismissed: true };
    }
    setTurns((prev) => {
      const next = prev.map((t) => (t.id === turnId && t.offers ? { ...t, offers: t.offers.map((o, i) => (i === index ? { ...o, ...outcome } : o)) } : t));
      // An applied change is added to the conversation, so the rest of it knows.
      return outcome.applied ? [...next, { id: ++turnSeq, role: 'note' as const, text: `Applied: ${outcome.applied}` }] : next;
    });
  };

  if (!apiKey) return <CoachSetup />;

  return (
    <div className="page page-narrow coach">
      <header className="page-head">
        <div>
          <h1>Coach</h1>
          <p className="page-sub">Claude reads the week you can see, and suggests changes you can apply.</p>
        </div>
        <div className="row tight">
          {turns.length > 0 && (
            <button className="btn sm" onClick={() => setTurns([])} disabled={busy}>
              New conversation
            </button>
          )}
          <button className={`btn sm${showSettings ? ' is-on' : ''}`} onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
            <Icon name="settings" size={14} /> Settings
          </button>
        </div>
      </header>

      {showSettings && <CoachSettings onClose={() => setShowSettings(false)} />}

      <div className="coach-thread" ref={threadRef}>
        {turns.length === 0 ? (
          <div className="coach-intro">
            <p className="muted">
              Ask anything about your habits, tasks, projects, goals and time. Claude sees a summary — never your whole history — and can offer changes you apply with one press.
            </p>
            <div className="coach-quick">
              {QUICK_PROMPTS.map((p) => (
                <button key={p.label} className="btn sm" onClick={() => send(p.text)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn) => <TurnView key={turn.id} turn={turn} onDecide={decide} />)
        )}
      </div>

      <form
        className="coach-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          className="input"
          rows={2}
          placeholder="Ask about your week, a habit, a goal…"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn" onClick={() => abort.current?.abort()}>
            <Icon name="stop" size={14} /> Stop
          </button>
        ) : (
          <button type="submit" className="btn primary" disabled={!input.trim()}>
            Ask
          </button>
        )}
      </form>

      <ContextDetails json={contextText(context)} />
    </div>
  );
}

/**
 * The conversation as the API wants it: starting with a user message, with consecutive
 * messages of the same role merged, and only the recent part of a long thread.
 */
export function toHistory(turns: Turn[], question: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  const usable = turns.filter((t) => !t.error && t.text.trim()).slice(-MAX_HISTORY);
  for (const turn of usable) {
    const role = turn.role === 'assistant' ? ('assistant' as const) : ('user' as const);
    if (role === 'assistant' && !out.length) continue; // never open with the coach
    const last = out[out.length - 1];
    if (last?.role === role) last.content += `\n\n${turn.text}`;
    else out.push({ role, content: turn.text });
  }
  const last = out[out.length - 1];
  if (last?.role === 'user') last.content += `\n\n${question}`;
  else out.push({ role: 'user', content: question });
  return out;
}

function TurnView({ turn, onDecide }: { turn: Turn; onDecide: (turnId: number, index: number, accept: boolean) => void }) {
  if (turn.role === 'note') {
    return (
      <p className="coach-note small muted">
        <Icon name="check" size={12} /> {turn.text}
      </p>
    );
  }
  if (turn.role === 'user') return <div className="coach-turn is-user">{turn.text}</div>;
  return (
    <div className="coach-turn is-coach">
      {turn.text ? (
        <div className="note-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.text, { allowStyles: false }) }} />
      ) : turn.streaming ? (
        <p className="muted small">Thinking…</p>
      ) : null}
      {turn.streaming && turn.text && <span className="coach-caret" aria-hidden="true" />}
      {turn.error && (
        <p className="notice tone-bad">
          <Icon name="x" size={13} /> {turn.error}
        </p>
      )}
      {turn.offers?.map((offer, i) => (
        <ProposalCardView key={i} offer={offer} onApply={() => onDecide(turn.id, i, true)} onDismiss={() => onDecide(turn.id, i, false)} />
      ))}
    </div>
  );
}

function ProposalCardView({ offer, onApply, onDismiss }: { offer: Offer; onApply: () => void; onDismiss: () => void }) {
  const card = describeProposal(offer.proposal);
  return (
    <div className={`coach-card${offer.applied ? ' is-applied' : ''}${offer.dismissed ? ' is-dismissed' : ''}`}>
      <div className="coach-card-head">
        <span className="coach-card-kind">{card.heading}</span>
        <strong>{card.subject}</strong>
      </div>
      {offer.proposal.rationale && <p className="small">{offer.proposal.rationale}</p>}
      {card.lines.length > 0 && (
        <ul className="coach-card-lines small">
          {card.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {card.problem ? (
        <p className="small muted">{card.problem}</p>
      ) : offer.applied ? (
        <p className="small tone tone-good">
          <Icon name="check" size={12} /> {offer.applied}
        </p>
      ) : offer.dismissed ? (
        <p className="small muted">Skipped.</p>
      ) : (
        <div className="row tight">
          <button className="btn sm primary" onClick={onApply}>
            Apply
          </button>
          <button className="btn sm ghost" onClick={onDismiss}>
            No thanks
          </button>
        </div>
      )}
    </div>
  );
}

function ContextDetails({ json }: { json: string }) {
  return (
    <details className="coach-context">
      <summary className="small">What gets sent ({Math.round(json.length / 1024)} KB, roughly {Math.round(json.length / 4 / 100) / 10}k tokens)</summary>
      <p className="small muted">
        This exact summary goes to api.anthropic.com with each message, along with the conversation. It never passes through any other server, and Meridian stores nothing about it.
      </p>
      <pre className="coach-json small">{json}</pre>
    </details>
  );
}

function CoachSetup() {
  const setKey = useAiPrefs((s) => s.setKey);
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div>
          <h1>Coach</h1>
          <p className="page-sub">Claude, reading your habits, tasks and goals — with your own Anthropic API key.</p>
        </div>
      </header>

      <section className="card stack">
        <h3 className="card-title">Connect Claude</h3>
        <p className="small muted">
          Meridian talks to Anthropic straight from this device. You bring your own key, so you see exactly what it costs and nobody else's server sits in between.
        </p>
        <ol className="install-steps small">
          <li>
            Open the <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">Anthropic Console</a> and create an API key.
          </li>
          <li>Add a little credit to the account. API use is billed separately from a Claude.ai subscription; a message here costs a penny or two, depending on the model.</li>
          <li>Paste the key below. It stays in this browser: never synced to your account, never in a backup.</li>
        </ol>
        <form
          className="row tight wrap"
          onSubmit={(e) => {
            e.preventDefault();
            const trouble = keyProblem(value);
            setProblem(trouble);
            if (!trouble) setKey(value);
          }}
        >
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setProblem(null);
            }}
            aria-label="Anthropic API key"
          />
          <button className="btn primary" type="submit">
            Save key
          </button>
        </form>
        {problem && <p className="small tone tone-bad">{problem}</p>}
        <p className="small muted">
          Keys are secrets: anyone with this device's browser data could read it. Use a key made for this, and revoke it in the Console if you stop using it.
        </p>
      </section>
    </div>
  );
}

function CoachSettings({ onClose }: { onClose: () => void }) {
  const { apiKey, model, includeJournalText, includeHealth, setKey, setModel, setInclude } = useAiPrefs();
  const journalLocked = useJournalLock((s) => s.status === 'locked');
  const [newKey, setNewKey] = useState('');
  const toast = useUI((s) => s.toast);

  return (
    <section className="card stack">
      <h3 className="card-title">Coach settings</h3>
      <div className="setting-row">
        <span>Model</span>
        <Segmented value={model} onChange={setModel} options={MODELS.map((m) => ({ value: m.id, label: m.label, title: m.hint }))} />
      </div>
      <div className="setting-row">
        <span>
          Include journal text
          <span className="muted small"> · moods and word counts are always included</span>
        </span>
        <Segmented
          value={includeJournalText ? 'on' : 'off'}
          onChange={(v) => setInclude({ includeJournalText: v === 'on' })}
          options={[
            { value: 'on', label: 'On', disabled: journalLocked },
            { value: 'off', label: 'Off' },
          ]}
        />
      </div>
      <div className="setting-row">
        <span>Include health measurements</span>
        <Segmented
          value={includeHealth ? 'on' : 'off'}
          onChange={(v) => setInclude({ includeHealth: v === 'on' })}
          options={[
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
        />
      </div>
      {journalLocked && <p className="small muted">Your journal is locked, so it is left out entirely.</p>}
      <div className="setting-row">
        <span>
          API key
          <span className="muted small"> · ends in {apiKey.slice(-4)}</span>
        </span>
        <div className="row tight">
          <input className="input sm" type="password" placeholder="Replace key…" value={newKey} onChange={(e) => setNewKey(e.target.value)} aria-label="Replace API key" />
          <button
            className="btn sm"
            disabled={!newKey.trim()}
            onClick={() => {
              const trouble = keyProblem(newKey);
              if (trouble) return toast(trouble, null);
              setKey(newKey);
              setNewKey('');
              toast('API key replaced', 'complete');
            }}
          >
            Save
          </button>
          <button
            className="btn sm danger ghost"
            onClick={() => {
              if (confirm('Forget the API key on this device?')) {
                setKey('');
                onClose();
              }
            }}
          >
            Forget
          </button>
        </div>
      </div>
      <p className="small muted">The key is used only for requests you start here, and is not included in backups or sync.</p>
    </section>
  );
}
