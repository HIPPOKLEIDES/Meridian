import { create } from 'zustand';
import type { Task } from '../types';
import { getSupabase, toError } from './client';
import { currentUserId, useSession } from './session';
import type { Role } from './types';

/** Project membership, invites and task assignment, from the project_members / project_invites tables. */

export interface Member {
  userId: string;
  role: Role;
  email: string;
  displayName: string;
}

export interface Invite {
  id: string;
  email: string | null;
  token: string | null;
  role: Exclude<Role, 'owner'>;
  expiresAt: string | null;
}

interface SharingState {
  loaded: boolean;
  /** Members per project, owner first. */
  members: Record<string, Member[]>;
  /** Pending invites per project (only for projects you own). */
  invites: Record<string, Invite[]>;
}

export const useSharing = create<SharingState>(() => ({ loaded: false, members: {}, invites: {} }));

const ROLE_ORDER: Record<Role, number> = { owner: 0, editor: 1, viewer: 2 };

function client() {
  const sb = getSupabase();
  if (!sb) throw new Error('Cloud sync isn’t set up.');
  return sb;
}

export function roleOf(projectId: string): Role | null {
  const me = currentUserId();
  return useSharing.getState().members[projectId]?.find((m) => m.userId === me)?.role ?? null;
}

/** A project with at least one other member. */
export const isSharedProject = (projectId: string | null | undefined) => !!projectId && (useSharing.getState().members[projectId]?.length ?? 0) > 1;

export function useProjectMembers(projectId: string | null | undefined): Member[] {
  return useSharing((s) => (projectId ? s.members[projectId] : undefined)) ?? EMPTY;
}
const EMPTY: Member[] = [];

export function useProjectRole(projectId: string | null | undefined): Role | null {
  const me = useSession((s) => s.user?.id);
  return useSharing((s) => (projectId ? s.members[projectId]?.find((m) => m.userId === me)?.role ?? null : null));
}

/**
 * Whether a task belongs on your own Today, Calendar and task lists. In a shared project that means it's
 * assigned to you, or it's unassigned and you created it (tasks from before sharing count as the owner's).
 */
export function isTaskForMe(task: Task, members = useSharing.getState().members, me = currentUserId()): boolean {
  if (!me || !task.projectId) return true;
  const list = members[task.projectId];
  if (!list || list.length < 2) return true;
  const assignees = task.assigneeIds ?? [];
  if (assignees.length) return assignees.includes(me);
  if (task.createdBy) return task.createdBy === me;
  return list.find((m) => m.userId === me)?.role === 'owner';
}

/** Reloads memberships and returns the ids of projects you're a member of. */
export async function refreshMemberships(): Promise<Set<string>> {
  const sb = client();
  const [{ data: rows, error }, { data: profiles, error: profileError }] = await Promise.all([
    sb.from('project_members').select('project_id,user_id,role'),
    sb.from('profiles').select('id,email,display_name'),
  ]);
  if (error) throw toError(error);
  if (profileError) throw toError(profileError);
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));
  const members: Record<string, Member[]> = {};
  for (const r of rows ?? []) {
    const profile = byId.get(r.user_id as string);
    (members[r.project_id as string] ??= []).push({
      userId: r.user_id as string,
      role: r.role as Role,
      email: (profile?.email as string) ?? '',
      displayName: (profile?.display_name as string) ?? '',
    });
  }
  for (const list of Object.values(members)) list.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.displayName.localeCompare(b.displayName));
  useSharing.setState({ loaded: true, members });
  return new Set(Object.keys(members));
}

export async function refreshInvites(projectId: string) {
  const { data, error } = await client()
    .from('project_invites')
    .select('id,email,token,role,expires_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw toError(error);
  const invites = (data ?? []).map((r) => ({ id: r.id, email: r.email, token: r.token, role: r.role, expiresAt: r.expires_at }) as Invite);
  useSharing.setState((s) => ({ invites: { ...s.invites, [projectId]: invites } }));
}

export async function inviteByEmail(projectId: string, email: string, role: Invite['role']) {
  const { error } = await client().rpc('invite_member', { pid: projectId, invite_email: email, member_role: role });
  if (error) throw toError(error);
  await refreshInvites(projectId);
}

export const inviteLink = (token: string) => `${window.location.origin}${window.location.pathname}#/join/${token}`;

export async function createInviteLink(projectId: string, role: Invite['role']) {
  const { data, error } = await client().rpc('create_invite_link', { pid: projectId, member_role: role });
  if (error) throw toError(error);
  await refreshInvites(projectId);
  return inviteLink(data as string);
}

export async function revokeInvite(projectId: string, inviteId: string) {
  const { error } = await client().from('project_invites').delete().eq('id', inviteId);
  if (error) throw toError(error);
  await refreshInvites(projectId);
}

export async function setMemberRole(projectId: string, userId: string, role: Invite['role']) {
  const { error } = await client().rpc('set_member_role', { pid: projectId, member: userId, member_role: role });
  if (error) throw toError(error);
  await refreshMemberships();
}

/** Removes someone (owner only), or yourself to leave. */
export async function removeMember(projectId: string, userId: string) {
  const { error } = await client().rpc('remove_member', { pid: projectId, member: userId });
  if (error) throw toError(error);
  await refreshMemberships();
}

export async function acceptInviteLink(token: string): Promise<string> {
  const { data, error } = await client().rpc('accept_invite_link', { invite_token: token });
  if (error) throw toError(error);
  return data as string;
}

export async function acceptEmailInvites(): Promise<string[]> {
  const { data, error } = await client().rpc('accept_invites');
  if (error) throw toError(error);
  return ((data ?? []) as unknown[]).map((d) => (typeof d === 'string' ? d : (d as { accept_invites: string }).accept_invites));
}

export const memberName = (m: Pick<Member, 'displayName' | 'email'>) => m.displayName || m.email.split('@')[0] || 'Someone';

export const initials = (m: Pick<Member, 'displayName' | 'email'>) =>
  memberName(m)
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
