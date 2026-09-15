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

const DEVICE_KEY = 'meridian:cloud-config';

export function getCloudConfig(): CloudConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && anonKey) return { url, anonKey, source: 'build' };
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null') as { url?: string; anonKey?: string } | null;
    if (saved?.url && saved.anonKey) return { url: saved.url, anonKey: saved.anonKey, source: 'device' };
  } catch {
    // Unreadable config: treat as not set up.
  }
  return null;
}

/** Validates and stores a device config. Returns an error message, or null when saved. */
export function saveDeviceConfig(url: string, anonKey: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return 'That isn’t a valid URL. It looks like https://abcd1234.supabase.co';
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !local) return 'The project URL must start with https://';
  if (anonKey.trim().length < 20) return 'Paste the full anon (publishable) key from Project Settings → API.';
  localStorage.setItem(DEVICE_KEY, JSON.stringify({ url: parsed.origin, anonKey: anonKey.trim() }));
  return null;
}

export function clearDeviceConfig() {
  localStorage.removeItem(DEVICE_KEY);
}
