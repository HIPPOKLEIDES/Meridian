import { useState } from 'react';
import { useSession } from '../session';
import { resolveDecision, useCloud } from '../controller';
import { signOut, updatePassword } from '../auth';
import { Modal } from '../../components/common';
import { useUI } from '../../ui';

/** Dialogs the cloud layer may need at any time: where this device's data goes on sign-in, and password recovery. */
export function CloudDialogs() {
  const decision = useCloud((s) => s.decision);
  const recovery = useSession((s) => s.recovery);
  return (
    <>
      {decision && <DecisionDialog />}
      {recovery && <RecoveryDialog />}
    </>
  );
}

function DecisionDialog() {
  const decision = useCloud((s) => s.decision)!;
  const email = useSession((s) => s.user?.email);
  const [busy, setBusy] = useState(false);
  const choose = async (choice: 'merge' | 'useAccount' | 'cancel') => {
    setBusy(true);
    try {
      await resolveDecision(choice);
    } finally {
      setBusy(false);
    }
  };
  const other = decision.kind === 'otherAccount';

  return (
    <Modal title={other ? 'This device has someone else’s data' : 'Welcome! What about this device’s data?'} onClose={() => void choose('cancel')}>
      <div className="stack">
        <p>
          {other
            ? `The data on this device belongs to a different Meridian account. You’re signing in as ${email}.`
            : decision.accountHasData
              ? `Your account (${email}) already has data, and so does this device.`
              : `You’re signed in as ${email}. This device already has data that isn’t in your account yet.`}
        </p>
        <div className="decision-options">
          {!other && (
            <button className="decision-option" disabled={busy} onClick={() => void choose('merge')}>
              <b>{decision.accountHasData ? 'Combine them' : 'Upload this device’s data'}</b>
              <span className="small muted">
                {decision.accountHasData
                  ? 'Everything from this device is added to your account. Where both have the same item, the most recent edit wins.'
                  : 'Everything on this device is saved to your account and synced from now on. Recommended.'}
              </span>
            </button>
          )}
          <button className="decision-option" disabled={busy} onClick={() => void choose('useAccount')}>
            <b>Use only my account’s data</b>
            <span className="small muted">
              Removes what’s on this device{other ? ' (the other account keeps its copy if it was synced)' : ''} and downloads your account. Export a backup first if
              you’re unsure.
            </span>
          </button>
          <button className="decision-option" disabled={busy} onClick={() => void choose('cancel')}>
            <b>Cancel and sign out</b>
            <span className="small muted">Nothing changes.</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RecoveryDialog() {
  const toast = useUI((s) => s.toast);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    useSession.setState({ recovery: false });
    void signOut();
  };
  return (
    <Modal title="Choose a new password" onClose={close}>
      <form
        className="stack tight"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await updatePassword(password);
            toast('Password updated. You’re signed in.', 'check');
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Couldn’t update the password');
          } finally {
            setBusy(false);
          }
        }}
      >
        <input className="input" type="password" autoFocus autoComplete="new-password" minLength={8} required placeholder="New password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="small tone tone-bad">{error}</p>}
        <button className="btn primary align-start" type="submit" disabled={busy}>
          Save password
        </button>
      </form>
    </Modal>
  );
}
