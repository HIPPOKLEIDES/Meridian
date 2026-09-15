import { useEffect, useRef, useState } from 'react';
import { useSession } from '../session';
import { joinProject, useCloud } from '../controller';
import { AuthForm } from './AuthForm';
import { Empty, Icon } from '../../components/common';
import { navigate } from '../../lib/hooks';
import { sound } from '../../lib/sound';

/** #/join/<token>: accept a project invite link. */
export function JoinView({ token }: { token?: string }) {
  const status = useSession((s) => s.status);
  const running = useCloud((s) => s.running);
  const decision = useCloud((s) => s.decision);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!token || status !== 'signedIn' || !running || decision || started.current) return;
    started.current = true;
    joinProject(token)
      .then((projectId) => {
        sound('unlock');
        navigate(`projects/${projectId}`);
      })
      .catch((e) => {
        sound('error');
        setError(e instanceof Error ? e.message : 'Couldn’t join the project');
      });
  }, [token, status, running, decision]);

  return (
    <div className="page page-narrow">
      <section className="card stack join-card">
        <div className="unlock-icon">
          <Icon name="projects" size={22} />
        </div>
        <h1>Join a shared project</h1>
        {status === 'disabled' ? (
          <Empty>This copy of Meridian isn’t connected to a server, so it can’t open invite links. Open the link in the hosted app instead.</Empty>
        ) : status === 'signedOut' ? (
          <>
            <p className="small muted">Sign in or create an account to join. The project will open as soon as you’re in.</p>
            <AuthForm initialMode="signUp" />
          </>
        ) : error ? (
          <>
            <p className="small tone tone-bad">{error}</p>
            <button className="btn align-start" onClick={() => navigate('projects')}>
              Go to projects
            </button>
          </>
        ) : (
          <p className="small muted">Joining…</p>
        )}
      </section>
    </div>
  );
}
