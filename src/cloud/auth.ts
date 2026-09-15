import type { Session } from '@supabase/supabase-js';
import { getSupabase, toError } from './client';
import { readCloudConfig } from './config';
import { useSession, type SessionUser } from './session';

/** Email + password accounts through Supabase Auth. */

const redirectTo = () => `${window.location.origin}${window.location.pathname}`;

function applySession(session: Session | null) {
  const u = session?.user;
  const next: SessionUser | null = u
    ? { id: u.id, email: u.email ?? '', displayName: (u.user_metadata?.display_name as string | undefined) ?? '' }
    : null;
  const current = useSession.getState();
  const same =
    current.user?.id === next?.id && current.user?.email === next?.email && current.user?.displayName === next?.displayName;
  if (same && (current.status === 'signedIn' || current.status === 'signedOut')) return;
  useSession.setState({ status: next ? 'signedIn' : 'signedOut', user: next, error: null });
}

const SESSION_TIMEOUT_MS = 12_000;

export async function initAuth() {
  const { config, problem } = readCloudConfig();
  if (!config) {
    useSession.setState(problem ? { status: 'error', user: null, error: problem } : { status: 'disabled', user: null, error: null });
    return;
  }
  const sb = getSupabase();
  if (!sb) {
    useSession.setState({ status: 'error', user: null, error: 'The Supabase settings couldn’t be used. Check the Project URL and anon key.' });
    return;
  }
  sb.auth.onAuthStateChange((event, session) => {
    // Don't await Supabase calls in here; the client holds a lock while it runs callbacks.
    if (event === 'PASSWORD_RECOVERY') useSession.setState({ recovery: true });
    applySession(session);
  });
  try {
    const result = await Promise.race([
      sb.auth.getSession(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), SESSION_TIMEOUT_MS)),
    ]);
    if (result.error) throw result.error;
    applySession(result.data.session);
  } catch (e) {
    // If the session shows up later, onAuthStateChange replaces this error.
    if (useSession.getState().status !== 'loading') return;
    const message = e instanceof Error && e.message !== 'timeout' ? e.message : `Couldn’t reach ${new URL(config.url).host}.`;
    useSession.setState({ status: 'error', error: `${message} Use “Test connection” below to find out why.` });
  }
}

const friendly = (message: string) => {
  if (/invalid login credentials/i.test(message)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email address first. Check your inbox for the link.';
  if (/user already registered/i.test(message)) return 'There’s already an account with that email. Try signing in.';
  if (/password should be at least/i.test(message)) return 'Choose a longer password (at least 8 characters).';
  if (/rate limit/i.test(message)) return 'Too many attempts. Wait a minute and try again.';
  return message;
};

function client() {
  const sb = getSupabase();
  if (!sb) throw new Error('Cloud sync isn’t set up on this device.');
  return sb;
}

/** Returns whether the account still needs its email confirmed before signing in. */
export async function signUp(email: string, password: string, displayName: string): Promise<{ needsConfirmation: boolean }> {
  const { data, error } = await client().auth.signUp({
    email: email.trim(),
    password,
    options: { data: { display_name: displayName.trim() }, emailRedirectTo: redirectTo() },
  });
  if (error) throw new Error(friendly(error.message));
  return { needsConfirmation: !data.session };
}

export async function signIn(email: string, password: string) {
  const { error } = await client().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(friendly(error.message));
}

export async function signOut() {
  const { error } = await client().auth.signOut();
  if (error) throw toError(error);
  useSession.setState({ status: 'signedOut', user: null, recovery: false });
}

export async function sendPasswordReset(email: string) {
  const { error } = await client().auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectTo() });
  if (error) throw new Error(friendly(error.message));
}

export async function resendConfirmation(email: string) {
  const { error } = await client().auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: redirectTo() } });
  if (error) throw new Error(friendly(error.message));
}

export async function updatePassword(password: string) {
  const { error } = await client().auth.updateUser({ password });
  if (error) throw new Error(friendly(error.message));
  useSession.setState({ recovery: false });
}

export async function updateDisplayName(displayName: string) {
  const sb = client();
  const user = useSession.getState().user;
  if (!user) return;
  const name = displayName.trim();
  const { error } = await sb.from('profiles').update({ display_name: name }).eq('id', user.id);
  if (error) throw toError(error);
  const { error: metaError } = await sb.auth.updateUser({ data: { display_name: name } });
  if (metaError) throw toError(metaError);
  useSession.setState({ user: { ...user, displayName: name } });
}
