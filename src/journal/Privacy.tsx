import { useState } from 'react';
import { decryptJournal, encryptJournal, JournalKeyMismatch, lockJournal, replaceJournalWithAccount, unlockJournal } from './store';
import { useSession } from '../cloud/session';
import { useJournalLock, verifyPassphrase } from './vault';
import { Icon } from '../components/common';
import { useUI } from '../ui';
import { sound } from '../lib/sound';

const MIN_LENGTH = 8;

/** Shown instead of the journal while it's encrypted and locked. */
export function JournalUnlock() {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleCopy, setStaleCopy] = useState(false);
  return (
    <div className="page">
      <form
        className="card unlock-card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!passphrase) return;
          setBusy(true);
          setError(null);
          try {
            await unlockJournal(passphrase);
          } catch (err) {
            sound('error');
            setError(err instanceof Error ? err.message : 'Unlock failed');
            setStaleCopy(err instanceof JournalKeyMismatch && err.opensAccount);
            setBusy(false);
          }
        }}
      >
        <div className="unlock-icon">
          <Icon name="lock" size={22} />
        </div>
        <h1>Journal locked</h1>
        <p className="small muted">Your journal is encrypted. Enter your passphrase to read and write. It stays unlocked in this tab until you lock it or close the tab.</p>
        <input
          className="input"
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Passphrase"
          aria-label="Passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
        />
        {error && <p className="small tone tone-bad">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy || !passphrase}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
        {staleCopy && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              if (!confirm('Replace this device’s journal with your account’s? Entries that only exist on this device will be lost.')) return;
              setBusy(true);
              try {
                await replaceJournalWithAccount(passphrase);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Couldn’t open your account’s journal');
                setBusy(false);
              }
            }}
          >
            Use my account’s journal on this device
          </button>
        )}
      </form>
    </div>
  );
}

/** Journal encryption settings: turn on, lock, change passphrase, turn off. */
export function JournalPrivacy() {
  const status = useJournalLock((s) => s.status);
  const signedIn = useSession((s) => s.status === 'signedIn');
  const toast = useUI((s) => s.toast);
  const [mode, setMode] = useState<'idle' | 'change' | 'off'>('idle');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmNext, setConfirmNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const encrypted = status === 'unlocked';

  const reset = () => {
    setMode('idle');
    setCurrent('');
    setNext('');
    setConfirmNext('');
    setError(null);
    setBusy(false);
  };

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      const problem = await fn();
      if (problem) {
        sound('error');
        setError(problem);
        setBusy(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  const newPassphraseProblem = () =>
    next.length < MIN_LENGTH ? `Use at least ${MIN_LENGTH} characters. A few random words work well.` : next !== confirmNext ? 'The passphrases don’t match.' : null;

  const newFields = (
    <>
      <input className="input" type="password" autoComplete="new-password" placeholder="New passphrase" aria-label="New passphrase" value={next} onChange={(e) => setNext(e.target.value)} />
      <input
        className="input"
        type="password"
        autoComplete="new-password"
        placeholder="Repeat passphrase"
        aria-label="Repeat passphrase"
        value={confirmNext}
        onChange={(e) => setConfirmNext(e.target.value)}
      />
    </>
  );
  const currentField = (
    <input
      className="input"
      type="password"
      autoComplete="current-password"
      placeholder="Current passphrase"
      aria-label="Current passphrase"
      value={current}
      onChange={(e) => setCurrent(e.target.value)}
    />
  );

  return (
    <details className="card journal-settings">
      <summary className="small">
        <Icon name="lock" size={12} /> Privacy · {encrypted ? 'encrypted' : 'not encrypted'}
      </summary>
      <div className="stack tight">
        {!encrypted ? (
          <form
            className="stack tight"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const problem = newPassphraseProblem();
                if (problem) return problem;
                await encryptJournal(next);
                reset();
                toast('Journal encrypted');
                return null;
              });
            }}
          >
            <p className="small muted">
              Encrypt every journal with a passphrase (AES-256, key derived in your browser). Without it, nobody, including Meridian{signedIn ? ' and its server' : ''}, can
              read your entries.{signedIn ? ' Your other devices will ask for the same passphrase.' : ''}
            </p>
            <p className="small tone tone-warn">If you forget the passphrase, the journal can’t be recovered.</p>
            {newFields}
            {error && <p className="small tone tone-bad">{error}</p>}
            <button className="btn sm primary" type="submit" disabled={busy}>
              {busy ? 'Encrypting…' : 'Encrypt journal'}
            </button>
          </form>
        ) : (
          <>
            <p className="small muted">Encrypted, and unlocked in this tab. Backups keep the journal encrypted with the same passphrase.</p>
            {mode === 'idle' && (
              <div className="row tight wrap">
                <button className="btn sm" onClick={() => lockJournal()}>
                  <Icon name="lock" size={13} /> Lock now
                </button>
                <button className="btn sm ghost" onClick={() => setMode('change')}>
                  Change passphrase
                </button>
                <button className="btn sm ghost" onClick={() => setMode('off')}>
                  Turn off
                </button>
              </div>
            )}
            {mode === 'change' && (
              <form
                className="stack tight"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    if (!(await verifyPassphrase(current))) return 'The current passphrase is wrong.';
                    const problem = newPassphraseProblem();
                    if (problem) return problem;
                    await encryptJournal(next);
                    reset();
                    toast('Passphrase changed');
                    return null;
                  });
                }}
              >
                {currentField}
                {newFields}
                {error && <p className="small tone tone-bad">{error}</p>}
                <div className="row tight">
                  <button className="btn sm primary" type="submit" disabled={busy}>
                    {busy ? 'Saving…' : 'Change passphrase'}
                  </button>
                  <button className="btn sm ghost" type="button" onClick={reset}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
            {mode === 'off' && (
              <form
                className="stack tight"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    if (!(await verifyPassphrase(current))) return 'The passphrase is wrong.';
                    await decryptJournal();
                    reset();
                    toast('Encryption turned off');
                    return null;
                  });
                }}
              >
                <p className="small muted">The journal will be stored unencrypted in this browser again.</p>
                {currentField}
                {error && <p className="small tone tone-bad">{error}</p>}
                <div className="row tight">
                  <button className="btn sm danger" type="submit" disabled={busy}>
                    {busy ? 'Decrypting…' : 'Turn off encryption'}
                  </button>
                  <button className="btn sm ghost" type="button" onClick={reset}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </details>
  );
}
