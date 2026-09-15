import { create } from 'zustand';

/** Who is signed in. Kept free of other imports so any store can read the current user. */

/** error: sync is configured but can't start (bad config, unreachable server); see `error`. */
export type AuthStatus = 'disabled' | 'loading' | 'error' | 'signedOut' | 'signedIn';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

export const useSession = create<{ status: AuthStatus; user: SessionUser | null; recovery: boolean; error: string | null }>(() => ({
  status: 'loading',
  user: null,
  recovery: false,
  error: null,
}));

export const currentUserId = () => useSession.getState().user?.id ?? null;
