/**
 * Where the Supabase project lives. Set at build time (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) for the
 * hosted app, or pasted into Settings on a device (handy for trying it out from `npm run dev`).
 * The anon key is designed to be public; row-level security in supabase/schema.sql protects the data.
 */

export interface CloudConfig {
  url: string;
  anonKey: string;
  source: 'build' | 'device';
}

export interface ConfigState {
  config: CloudConfig | null;
  /** Set when a config exists but can't be used, in plain words. */
  problem: string | null;
  /** Where the unusable config came from. */
  problemSource: 'build' | 'device' | null;
}

const DEVICE_KEY = 'meridian:cloud-config';

const stripQuotes = (s: string) => s.trim().replace(/^['"`\s]+|['"`\s]+$/g, '');

/** Accepts the Project URL in the forms people tend to paste, and returns just its origin. */
export function normalizeUrl(raw: string): { url: string } | { problem: string } {
  let value = stripQuotes(raw);
  if (!value) return { problem: 'The Supabase Project URL is empty.' };
  // Never repeat what was pasted: it may contain a database password.
  if (/^postgres(ql)?:\/\//i.test(value)) {
    return { problem: 'That’s the database connection string. Use the Project URL instead (Project Settings → API), which looks like https://abcd1234.supabase.co' };
  }
  const dashboard = /supabase\.com\/dashboard\/project\/([a-z0-9]+)/i.exec(value);
  if (dashboard) value = `https://${dashboard[1]}.supabase.co`;
  if (!/^https?:\/\//i.test(value) && /^[a-z0-9-]+\.supabase\.(co|in)\b/i.test(value)) value = `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { problem: 'The Supabase Project URL isn’t a web address. It looks like https://abcd1234.supabase.co (Project Settings → API).' };
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !local) return { problem: `The Project URL must start with https:// (it starts with ${parsed.protocol}//).` };
  // Drop paths like /rest/v1 that are sometimes copied along with it.
  return { url: parsed.origin };
}

function jwtRole(key: string): string | null {
  const part = key.split('.')[1];
  if (!part) return null;
  try {
    return (JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

export function normalizeKey(raw: string): { key: string } | { problem: string } {
  const key = stripQuotes(raw).replace(/^Bearer\s+/i, '');
  if (!key) return { problem: 'The Supabase anon key is empty.' };
  if (key.startsWith('sb_secret_') || jwtRole(key) === 'service_role') {
    return {
      problem:
        'That’s the secret (service_role) key, which must never be put in the app: anyone could read everything with it. In Supabase, rotate that key, then use the anon / publishable key instead.',
    };
  }
  if (key.length < 20) return { problem: 'The anon key looks too short. Copy the whole anon / publishable key from Project Settings → API.' };
  return { key };
}

function validate(url: string, anonKey: string, source: CloudConfig['source']): ConfigState {
  const u = normalizeUrl(url);
  if ('problem' in u) return { config: null, problem: u.problem, problemSource: source };
  const k = normalizeKey(anonKey);
  if ('problem' in k) return { config: null, problem: k.problem, problemSource: source };
  return { config: { url: u.url, anonKey: k.key, source }, problem: null, problemSource: null };
}

export function readCloudConfig(): ConfigState {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  let buildState: ConfigState | null = null;
  if (url || anonKey) {
    buildState = validate(url ?? '', anonKey ?? '', 'build');
    if (buildState.config) return buildState;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null') as { url?: string; anonKey?: string } | null;
    if (saved?.url || saved?.anonKey) {
      const deviceState = validate(saved.url ?? '', saved.anonKey ?? '', 'device');
      if (deviceState.config) return deviceState;
      buildState ??= deviceState;
    }
  } catch {
    // Unreadable device config: ignore it.
  }
  return buildState ?? { config: null, problem: null, problemSource: null };
}

export const getCloudConfig = () => readCloudConfig().config;

/** Validates and stores a device config. Returns an error message, or null when saved. */
export function saveDeviceConfig(url: string, anonKey: string): string | null {
  const state = validate(url, anonKey, 'device');
  if (!state.config) return state.problem;
  localStorage.setItem(DEVICE_KEY, JSON.stringify({ url: state.config.url, anonKey: state.config.anonKey }));
  return null;
}

export function clearDeviceConfig() {
  localStorage.removeItem(DEVICE_KEY);
}

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

/** Checks the address, the key and the database setup, step by step, in words a person can act on. */
export async function testConnection(config: CloudConfig): Promise<Check[]> {
  const host = new URL(config.url).host;
  // The apikey header alone works for both legacy anon JWTs and the newer sb_publishable_ keys.
  const headers = { apikey: config.anonKey };
  const checks: Check[] = [];

  let auth: Response;
  try {
    auth = await fetch(`${config.url}/auth/v1/settings`, { headers });
  } catch {
    checks.push({
      label: 'Reach the server',
      ok: false,
      detail: `Couldn’t reach ${host}. Check the Project URL (Supabase → Project Settings → API), that the project isn’t paused, and your connection.`,
    });
    return checks;
  }
  checks.push({ label: 'Reach the server', ok: true, detail: host });

  if (auth.status === 401 || auth.status === 403) {
    checks.push({ label: 'Key accepted', ok: false, detail: 'The server rejected the key. Use this project’s anon / publishable key.' });
    return checks;
  }
  if (!auth.ok) {
    checks.push({ label: 'Key accepted', ok: false, detail: `Unexpected response (${auth.status}). Is the URL the Project URL, not the dashboard or database URL?` });
    return checks;
  }
  checks.push({ label: 'Key accepted', ok: true, detail: 'Anon key works' });
  const settings = (await auth.json().catch(() => ({}))) as { external?: { email?: boolean }; disable_signup?: boolean };
  if (settings.external && settings.external.email === false) {
    checks.push({ label: 'Email sign-in', ok: false, detail: 'Email sign-in is turned off. Enable it in Authentication → Sign In / Providers → Email.' });
  } else if (settings.disable_signup) {
    checks.push({ label: 'Email sign-in', ok: false, detail: 'New sign-ups are disabled in Authentication settings, so nobody can create an account.' });
  } else {
    checks.push({ label: 'Email sign-in', ok: true, detail: 'Enabled' });
  }

  try {
    const rest = await fetch(`${config.url}/rest/v1/records?select=key&limit=1`, { headers });
    const body = (await rest.json().catch(() => ({}))) as { code?: string; message?: string };
    if (rest.status === 404 || body.code === 'PGRST205' || body.code === '42P01') {
      checks.push({ label: 'Database set up', ok: false, detail: 'Meridian’s tables are missing. Run supabase/schema.sql in the Supabase SQL Editor.' });
    } else if (rest.ok) {
      checks.push({ label: 'Database set up', ok: false, detail: 'Signed-out visitors can read data, so the security rules aren’t in place. Run supabase/schema.sql again.' });
    } else {
      // Signed-out requests are refused, as they should be: the table exists and is protected.
      checks.push({ label: 'Database set up', ok: true, detail: 'Tables and security rules found' });
    }
  } catch {
    checks.push({ label: 'Database set up', ok: false, detail: 'Couldn’t check the database.' });
  }
  return checks;
}
