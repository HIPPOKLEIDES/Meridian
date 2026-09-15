import { useEffect, useState } from 'react';
import type { Project } from '../../types';
import { useSession } from '../session';
import { syncMemberships, syncNow, useCloud } from '../controller';
import {
  createInviteLink,
  inviteByEmail,
  inviteLink,
  memberName,
  refreshInvites,
  removeMember,
  revokeInvite,
  setMemberRole,
  useProjectMembers,
  useProjectRole,
  useSharing,
  type Invite,
} from '../sharing';
import { Avatar, AvatarStack } from './Avatars';
import { Icon, Modal } from '../../components/common';
import { useUI } from '../../ui';
import { navigate } from '../../lib/hooks';
import { sound } from '../../lib/sound';

const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' } as const;
const NO_INVITES: Invite[] = [];

/** Header control for a project: members' avatars plus Share. */
export function ShareButton({ project }: { project: Project }) {
  const status = useSession((s) => s.status);
  const members = useProjectMembers(project.id);
  const role = useProjectRole(project.id);
  const [open, setOpen] = useState(false);
  if (status === 'disabled') return null;
  return (
    <>
      {role === 'viewer' && (
        <span className="badge view-only" title="You can look but not change anything in this project">
          <Icon name="lock" size={11} /> View only
        </span>
      )}
      {members.length > 1 && (
        <button className="avatar-button" onClick={() => setOpen(true)} aria-label="Project members">
          <AvatarStack members={members} />
        </button>
      )}
      <button className="btn" onClick={() => setOpen(true)}>
        <Icon name="users" size={14} /> Share
      </button>
      {open && <ShareDialog project={project} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const status = useSession((s) => s.status);
  const me = useSession((s) => s.user?.id);
  const running = useCloud((s) => s.running);
  const members = useProjectMembers(project.id);
  const role = useProjectRole(project.id);
  const invites = useSharing((s) => s.invites[project.id]) ?? NO_INVITES;
  const toast = useUI((s) => s.toast);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Invite['role']>('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const isOwner = role === 'owner';
  const onServer = members.length > 0;

  useEffect(() => {
    if (isOwner) void refreshInvites(project.id).catch(() => undefined);
  }, [isOwner, project.id]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      sound('error');
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (status !== 'signedIn') {
    return (
      <Modal title={`Share “${project.name}”`} onClose={onClose}>
        <div className="stack tight">
          <p>Sign in to share projects. People you invite can see and work on its tasks, task map and notes; your other data stays private.</p>
          <button
            className="btn primary align-start"
            onClick={() => {
              onClose();
              navigate('settings');
            }}
          >
            Sign in or create an account
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Share “${project.name}”`} onClose={onClose}>
      <div className="stack">
        <p className="small muted">
          Members see this project’s tasks, task map and notes, and can be assigned tasks. Your habits, health, finances, journal, goals and other projects stay
          private.
        </p>

        {!onServer ? (
          <div className="notice">
            <Icon name="refresh" size={14} /> {running ? 'Uploading this project to your account…' : 'This project will be shareable once it has synced.'}{' '}
            <button className="link" onClick={() => void syncNow()}>
              Sync now
            </button>
          </div>
        ) : (
          <>
            <ul className="member-list">
              {members.map((m) => (
                <li key={m.userId}>
                  <Avatar member={m} size={30} />
                  <div className="member-text">
                    <b>
                      {memberName(m)}
                      {m.userId === me && <span className="muted"> (you)</span>}
                    </b>
                    <span className="small muted">{m.email}</span>
                  </div>
                  {isOwner && m.role !== 'owner' ? (
                    <>
                      <select
                        className="input sm"
                        value={m.role}
                        aria-label={`Role for ${memberName(m)}`}
                        disabled={busy}
                        onChange={(e) => void run(() => setMemberRole(project.id, m.userId, e.target.value as Invite['role']))}
                      >
                        <option value="editor">Can edit</option>
                        <option value="viewer">Can view</option>
                      </select>
                      <button
                        className="btn icon ghost sm"
                        aria-label={`Remove ${memberName(m)}`}
                        disabled={busy}
                        onClick={() => confirm(`Remove ${memberName(m)} from “${project.name}”?`) && void run(() => removeMember(project.id, m.userId).then(syncMemberships))}
                      >
                        <Icon name="x" size={14} />
                      </button>
                    </>
                  ) : (
                    <span className="small muted">{ROLE_LABEL[m.role]}</span>
                  )}
                </li>
              ))}
            </ul>

            {isOwner ? (
              <>
                <form
                  className="invite-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      await inviteByEmail(project.id, email, inviteRole);
                      sound('notify');
                      setEmail('');
                    });
                  }}
                >
                  <input className="input" type="email" required placeholder="Friend’s email address" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Invite['role'])} aria-label="Role">
                    <option value="editor">Can edit</option>
                    <option value="viewer">Can view</option>
                  </select>
                  <button className="btn primary" type="submit" disabled={busy}>
                    Invite
                  </button>
                </form>
                <p className="small muted">
                  They join automatically the next time they sign in with that address (after confirming it). Meridian doesn’t email them, so let them know, or send a
                  link:
                </p>
                <div className="row tight wrap">
                  <button
                    className="btn sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const url = await createInviteLink(project.id, inviteRole);
                        setLink(url);
                        try {
                          await navigator.clipboard.writeText(url);
                          toast('Invite link copied', 'check');
                        } catch {
                          // Clipboard blocked: the link is shown to copy by hand.
                        }
                      })
                    }
                  >
                    <Icon name="copy" size={14} /> Create {inviteRole === 'editor' ? 'edit' : 'view'} link
                  </button>
                  <span className="small muted">Anyone with the link can join for 14 days.</span>
                </div>
                {link && <input className="input small" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" />}

                {invites.length > 0 && (
                  <div className="stack tight">
                    <span className="field-label">Pending invites</span>
                    <ul className="invite-list">
                      {invites.map((inv) => (
                        <li key={inv.id}>
                          <Icon name={inv.email ? 'mail' : 'link'} size={13} />
                          <span className="grow">{inv.email ?? 'Invite link'}</span>
                          <span className="small muted">{ROLE_LABEL[inv.role]}</span>
                          {inv.token && (
                            <button
                              className="btn icon ghost sm"
                              aria-label="Copy link"
                              onClick={() => void navigator.clipboard.writeText(inviteLink(inv.token!)).then(() => toast('Invite link copied', 'check'))}
                            >
                              <Icon name="copy" size={13} />
                            </button>
                          )}
                          <button className="btn icon ghost sm" aria-label="Revoke invite" onClick={() => void run(() => revokeInvite(project.id, inv.id))}>
                            <Icon name="x" size={13} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="row tight">
                <span className="small muted">Only the owner can invite people.</span>
                <span className="spacer" />
                <button
                  className="btn sm danger ghost"
                  disabled={busy}
                  onClick={() =>
                    confirm(`Leave “${project.name}”? It will be removed from your devices.`) &&
                    void run(async () => {
                      await removeMember(project.id, me!);
                      await syncMemberships();
                      onClose();
                      navigate('projects');
                    })
                  }
                >
                  Leave project
                </button>
              </div>
            )}
          </>
        )}
        {error && <p className="small tone tone-bad">{error}</p>}
      </div>
    </Modal>
  );
}
