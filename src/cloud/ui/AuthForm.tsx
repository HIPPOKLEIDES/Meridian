import { useState } from 'react';
import { resendConfirmation, sendPasswordReset, signIn, signUp } from '../auth';
import { Segmented } from '../../components/common';
import { sound } from '../../lib/sound';

type Mode = 'signIn' | 'signUp' | 'reset';

const MIN_PASSWORD = 8;

export function AuthForm({ initialMode = 'signIn' }: { initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      sound('error');
      const message = e instanceof Error ? e.message : 'Something went wrong';
      setError(message);
      setUnconfirmed(/confirm your email/i.test(message));
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      if (mode === 'signIn') {
        await signIn(email, password);
      } else if (mode === 'signUp') {
        if (password.length < MIN_PASSWORD) throw new Error(`Choose a password with at least ${MIN_PASSWORD} characters.`);
        const { needsConfirmation } = await signUp(email, password, name);
        if (needsConfirmation) {
          setNotice(`Almost there: we sent a confirmation link to ${email.trim()}. Open it, then sign in here.`);
          setMode('signIn');
          setPassword('');
        }
      } else {
        await sendPasswordReset(email);
        setNotice('If there’s an account for that address, a reset link is on its way. Open it on this device.');
      }
    });

  return (
    <form
      className="auth-form stack tight"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Segmented
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError(null);
          setNotice(null);
        }}
        options={[
          { value: 'signIn', label: 'Sign in' },
          { value: 'signUp', label: 'Create account' },
          { value: 'reset', label: 'Forgot password' },
        ]}
      />
      {mode === 'signUp' && (
        <label className="field">
          <span className="field-label">Your name</span>
          <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown to people you share projects with" />
        </label>
      )}
      <label className="field">
        <span className="field-label">Email</span>
        <input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {mode !== 'reset' && (
        <label className="field">
          <span className="field-label">Password</span>
          <input
            className="input"
            type="password"
            required
            minLength={mode === 'signUp' ? MIN_PASSWORD : undefined}
            autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      )}
      {error && <p className="small tone tone-bad">{error}</p>}
      {notice && <p className="small tone tone-good">{notice}</p>}
      <div className="row tight wrap">
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'One moment…' : mode === 'signIn' ? 'Sign in' : mode === 'signUp' ? 'Create account' : 'Send reset link'}
        </button>
        {unconfirmed && (
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => run(async () => {
              await resendConfirmation(email);
              setNotice('Sent another confirmation link.');
              setUnconfirmed(false);
            })}
          >
            Resend confirmation email
          </button>
        )}
      </div>
    </form>
  );
}
