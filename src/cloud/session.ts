import { create } from 'zustand';

/** Who is signed in. Kept free of other imports so any store can read the current user. */

export type AuthStatus = 'disabled' | 'loading' | 'signedOut' | 'signedIn';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

export const useSession = create<{ status: AuthStatus; user: SessionUser | null; recovery: boolean }>(() => ({
  status: 'loading',
  user: null,
  recovery: false,
}));

export const currentUserId = () => useSession.getState().user?.id ?? null;
