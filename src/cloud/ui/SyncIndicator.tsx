import { useSession } from '../session';
import { useCloud } from '../controller';
import { describeSync } from './AccountCard';
import { Avatar } from './Avatars';
import { navigate } from '../../lib/hooks';

/** Sidebar footer: who's signed in and whether everything is synced. */
export function SyncIndicator() {
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const cloud = useCloud();
  if (status === 'disabled' || status === 'loading') return null;
  if (status === 'error') {
    return (
      <button className="sync-indicator" onClick={() => navigate('settings')} title="Sync can’t connect. Open Settings for details.">
        <span className="sync-dot tone-bad" />
        <span className="sync-indicator-text">
          <span className="sync-indicator-status tone-bad">
            <span className="sync-dot" /> Sync can’t connect
          </span>
        </span>
      </button>
    );
  }
  if (!user) {
    return (
      <button className="sync-indicator" onClick={() => navigate('settings')}>
        <span className="sync-dot tone-muted" />
        <span className="sync-indicator-text">Sign in to sync</span>
      </button>
    );
  }
  const sync = describeSync(cloud);
  return (
    <button className="sync-indicator" onClick={() => navigate('settings')} title={`${user.email} · ${sync.text}`}>
      <Avatar member={{ userId: user.id, displayName: user.displayName, email: user.email }} size={24} />
      <span className="sync-indicator-text">
        <span className="sync-indicator-name">{user.displayName || user.email}</span>
        <span className={`sync-indicator-status tone-${sync.tone}`}>
          <span className="sync-dot" /> {sync.text}
        </span>
      </span>
    </button>
  );
}
