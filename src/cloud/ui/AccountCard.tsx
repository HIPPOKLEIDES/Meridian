import { useState } from 'react';
import { useSession } from '../session';
import { clearDeviceConfig, getCloudConfig, saveDeviceConfig } from '../config';
import { signOutOfCloud, syncNow, useCloud } from '../controller';
import { updateDisplayName, updatePassword } from '../auth';
import { AuthForm } from './AuthForm';
import { Icon } from '../../components/common';
import { useUI } from '../../ui';
import { sound } from '../../lib/sound';

export const describeSync = (s: ReturnType<typeof useCloud.getState>) => {
  const { phase, pending, lastSyncedAt, error } = s.status;
  if (!s.running) return { tone: 'muted', text: 'Not syncing' };
  if (phase === 'syncing') return { tone: 'busy', text: 'Syncing…' };
  if (phase === 'offline') return { tone: 'warn', text: pending ? `Offline · ${pending} change${pending === 1 ? '' : 's'} waiting` : 'Offline' };
  if (phase === 'error') return { tone: 'bad', text: `Sync problem${error ? `: ${error}` : ''}` };
  if (pending) return { tone: 'busy', text: `${pending} change${pending === 1 ? '' : 's'} to upload` };
  return { tone: 'good', text: lastSyncedAt ? `Synced ${timeAgo(lastSyncedAt)}` : 'Synced' };
};

const timeAgo = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export function AccountCard() {
  const status = useSession((s) => s.status);
  const config = getCloudConfig();

  return (
    <section className="card stack" id="account">
      <h3 className="card-title">
        <Icon name="refresh" size={16} /> Account & sync
      </h3>
      {status === 'disabled' ? <SetupForm /> : status === 'loading' ? <p className="small muted">Connecting…</p> : status === 'signedOut' ? <SignedOut /> : <SignedIn />}
      {config?.source === 'device' && (
        <button
          className="link small align-start"
          onClick={() => {
            if (!confirm('Disconnect this device from the Meridian server? Your data stays on this device and in your account.')) return;
            clearDeviceConfig();
            window.location.reload();
          }}
        >
          Disconnect from {new URL(config.url).hostname}
        </button>
      )}
    </section>
  );
}

function SetupForm() {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="stack tight">
      <p className="small muted">
        Sign in to sync Meridian between your devices and share projects with friends. This copy of the app isn’t connected to a server yet. The hosted
        version has this built in; to connect this one, paste your Supabase project’s URL and anon key (Project Settings → API). See DEPLOY.md for setup.
      </p>
      <form
        className="stack tight"
        onSubmit={(e) => {
          e.preventDefault();
          const problem = saveDeviceConfig(url, key);
          if (problem) {
            sound('error');
            setError(problem);
          } else {
            window.location.reload();
          }
        }}
      >
        <input className="input" placeholder="https://your-project.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Supabase URL" />
        <input className="input" placeholder="Anon / publishable key" value={key} onChange={(e) => setKey(e.target.value)} aria-label="Supabase anon key" />
        {error && <p className="small tone tone-bad">{error}</p>}
        <button className="btn sm align-start" type="submit">
          Connect
        </button>
      </form>
    </div>
  );
}

function SignedOut() {
  return (
    <div className="stack tight">
      <p className="small muted">
        Your data stays on this device either way. Signing in keeps a copy in your account, so you can use Meridian on your phone and share projects.
      </p>
      <AuthForm />
    </div>
  );
}

function SignedIn() {
  const user = useSession((s) => s.user)!;
  const cloud = useCloud();
  const toast = useUI((s) => s.toast);
  const [name, setName] = useState(user.displayName);
  const [changingPassword, setChangingPassword] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const sync = describeSync(cloud);

  return (
    <div className="stack">
      <div className="account-row">
        <div className="stack tight">
          <span className="small muted">Signed in as</span>
          <b>{user.email}</b>
        </div>
        <span className={`sync-pill tone-${sync.tone}`}>
          <span className="sync-dot" /> {sync.text}
        </span>
      </div>

      <form
        className="row tight wrap"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await updateDisplayName(name);
            toast('Name updated', 'check');
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Couldn’t update your name', 'error');
          }
        }}
      >
        <label className="field grow">
          <span className="field-label">Name shown to collaborators</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {name.trim() !== user.displayName && (
          <button className="btn sm align-end" type="submit">
            Save
          </button>
        )}
      </form>

      <div className="row tight wrap">
        <button className="btn sm" onClick={() => void syncNow()} disabled={cloud.status.phase === 'syncing'}>
          <Icon name="refresh" size={14} /> Sync now
        </button>
        <button className="btn sm ghost" onClick={() => setChangingPassword(!changingPassword)}>
          Change password
        </button>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => setSigningOut(!signingOut)}>
          Sign out
        </button>
      </div>

      {signingOut && (
        <div className="sign-out-options">
          <p className="small muted">Your account keeps everything either way.</p>
          <div className="row tight wrap">
            <button
              className="btn sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await signOutOfCloud(false);
                toast('Signed out. Your data is still on this device.');
              }}
            >
              Sign out, keep data here
            </button>
            <button
              className="btn sm danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await signOutOfCloud(true);
                toast('Signed out and removed your data from this device.');
              }}
            >
              Sign out and remove data from this device
            </button>
            <button className="btn sm ghost" onClick={() => setSigningOut(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {changingPassword && (
        <form
          className="row tight wrap"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await updatePassword(password);
              setPassword('');
              setChangingPassword(false);
              toast('Password changed', 'check');
            } catch (err) {
              toast(err instanceof Error ? err.message : 'Couldn’t change the password', 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          <input className="input grow" type="password" autoComplete="new-password" minLength={8} required placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn sm primary" type="submit" disabled={busy}>
            Save password
          </button>
        </form>
      )}

      {!cloud.realtime && cloud.running && <p className="small muted">Live updates aren’t connected, so changes from other devices arrive every few seconds instead.</p>}

      {cloud.problems.length > 0 && (
        <details className="sync-problems">
          <summary className="small tone tone-warn">
            {cloud.problems.length} change{cloud.problems.length === 1 ? '' : 's'} couldn’t be saved to your account
          </summary>
          <p className="small muted">
            Usually this means a project someone else already uses the same id (e.g. sample data), or your access to a shared project changed. These items stay on
            this device only.
          </p>
          <ul className="small">
            {cloud.problems.slice(0, 10).map((p) => (
              <li key={`${p.key}${p.at}`}>
                <code>{p.collection}</code> {p.reason}
              </li>
            ))}
          </ul>
          <button className="link small" onClick={() => useCloud.setState({ problems: [] })}>
            Dismiss
          </button>
        </details>
      )}
    </div>
  );
}
