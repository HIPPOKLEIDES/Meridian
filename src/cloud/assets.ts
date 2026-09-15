import type { SupabaseClient } from '@supabase/supabase-js';
import type { NoteNode } from '../notes/types';
import { useNotes } from '../notes/store';
import { getAsset, retryMissingAssets, setRemoteAssetFetcher } from '../notes/assets';
import type { Role } from './types';

/**
 * Note images live in the private "assets" Storage bucket at projects/<projectId>/<assetId>, so project
 * members can read them and editors can add them. Uploads happen in the background once a note that uses
 * an image has synced; other devices download an image the first time they need it.
 */

const BUCKET = 'assets';
const ASSET_REF = /asset:([A-Za-z0-9_-]+)/g;

/** Every image a project's notes use: asset id → project id. */
export function assetRefs(notes: NoteNode[]): Map<string, string> {
  const refs = new Map<string, string>();
  for (const note of notes) {
    for (const m of note.content.matchAll(ASSET_REF)) refs.set(m[1], note.projectId);
    for (const node of note.board?.nodes ?? []) {
      const data = node.data as { imageId?: string | null; assetId?: string };
      if (data.imageId) refs.set(data.imageId, note.projectId);
      if (data.assetId) refs.set(data.assetId, note.projectId);
    }
  }
  return refs;
}

const path = (projectId: string, assetId: string) => `projects/${projectId}/${assetId}`;

export function startAssetSync(sb: SupabaseClient, userId: string, roleOf: (projectId: string) => Role | null): () => void {
  const storageKey = `meridian:uploaded-assets:${userId}`;
  const uploaded = new Set<string>(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[]);
  const save = () => localStorage.setItem(storageKey, JSON.stringify([...uploaded]));
  let running = false;
  let again = false;
  let stopped = false;

  const upload = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        for (const [assetId, projectId] of assetRefs(useNotes.getState().notes)) {
          if (stopped || uploaded.has(assetId)) continue;
          const role = roleOf(projectId);
          // Until the project exists on the server there's nowhere to put the image; try again later.
          if (role !== 'owner' && role !== 'editor') continue;
          const asset = await getAsset(assetId);
          if (!asset) continue;
          const { error } = await sb.storage.from(BUCKET).upload(path(projectId, assetId), asset.blob, {
            upsert: true,
            contentType: asset.type || 'application/octet-stream',
          });
          if (!error || /already exists/i.test(error.message)) {
            uploaded.add(assetId);
            save();
          }
        }
      } while (again && !stopped);
    } finally {
      running = false;
    }
  };

  setRemoteAssetFetcher(async (assetId) => {
    const projectId = assetRefs(useNotes.getState().notes).get(assetId);
    if (!projectId) return null;
    const { data, error } = await sb.storage.from(BUCKET).download(path(projectId, assetId));
    if (error || !data) return null;
    uploaded.add(assetId);
    save();
    return data;
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void upload(), 2000);
  };
  const unsubscribe = useNotes.subscribe((s, prev) => {
    if (s.notes !== prev.notes) schedule();
  });
  const interval = setInterval(() => void upload(), 60_000);
  schedule();

  return () => {
    stopped = true;
    unsubscribe();
    clearInterval(interval);
    if (timer) clearTimeout(timer);
    setRemoteAssetFetcher(null);
  };
}

/** Called after sync applied notes that may reference images this device hasn't downloaded. */
export const refreshImages = retryMissingAssets;
