import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getCloudConfig } from './config';

let client: SupabaseClient | null | undefined;

/** The Supabase client, or null when cloud sync isn't configured. */
export function getSupabase(): SupabaseClient | null {
  if (client === undefined) {
    const config = getCloudConfig();
    client = config
      ? createClient(config.url, config.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'meridian:auth' },
        })
      : null;
  }
  return client;
}

/** Turns a Supabase/PostgREST error into an Error with a readable message. */
export function toError(error: { message?: string; code?: string } | null | undefined, fallback = 'Something went wrong'): Error {
  if (!error) return new Error(fallback);
  const message = error.message || fallback;
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) return new Error('Can’t reach the server');
  return new Error(message);
}
