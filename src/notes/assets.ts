import { useEffect, useState } from 'react';
import { idbClear, idbDelete, idbGet, idbKeys, idbSet, requestPersistentStorage, STORES } from '../lib/idb';
import { uid } from '../store';

/** An uploaded image, stored as a Blob in IndexedDB and referenced as `asset:<id>`. */
export interface Asset {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  createdAt: number;
}

const urls = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

/** Downloads an image this device doesn't have (set by cloud sync). */
type RemoteFetcher = (id: string) => Promise<Blob | null>;
let remoteFetcher: RemoteFetcher | null = null;
let version = 0;
const versionListeners = new Set<() => void>();

export function setRemoteAssetFetcher(fetcher: RemoteFetcher | null) {
  remoteFetcher = fetcher;
  retryMissingAssets();
}

/** Makes views try again for images that weren't available (e.g. after sync brought them). */
export function retryMissingAssets() {
  version++;
  versionListeners.forEach((fn) => fn());
}

/** Changes whenever missing images are worth retrying; use it as an effect dependency. */
export function useAssetsVersion() {
  const [v, setV] = useState(version);
  useEffect(() => {
    const fn = () => setV(version);
    versionListeners.add(fn);
    return () => void versionListeners.delete(fn);
  }, []);
  return v;
}

export const getAsset = (id: string) => idbGet<Asset>(STORES.assets, id);

/** Photos over this size are scaled down; small images (pixel art, icons) are kept byte-for-byte. */
const MAX_BYTES = 1_500_000;
const MAX_SIDE = 2000;

async function downscale(file: Blob): Promise<Blob> {
  if (file.size <= MAX_BYTES || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
  return out && out.size < file.size ? out : file;
}

export async function saveImage(file: Blob, name = 'image'): Promise<string> {
  requestPersistentStorage();
  const blob = await downscale(file);
  const id = uid();
  await idbSet(STORES.assets, id, { id, name, type: blob.type, blob, createdAt: Date.now() } satisfies Asset);
  return id;
}

export async function assetUrl(id: string): Promise<string | null> {
  if (urls.has(id)) return urls.get(id)!;
  if (!pending.has(id)) {
    pending.set(
      id,
      idbGet<Asset>(STORES.assets, id).then(async (stored) => {
        let a = stored;
        if (!a && remoteFetcher) {
          const blob = await remoteFetcher(id).catch(() => null);
          if (blob) {
            a = { id, name: 'image', type: blob.type, blob, createdAt: Date.now() };
            await idbSet(STORES.assets, id, a);
          }
        }
        pending.delete(id);
        if (!a) return null;
        const url = URL.createObjectURL(a.blob);
        urls.set(id, url);
        return url;
      }),
    );
  }
  return pending.get(id)!;
}

/** Object URL for an asset id, or null while loading / if missing. */
export function useAssetUrl(id: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (id ? urls.get(id) ?? null : null));
  const retry = useAssetsVersion();
  useEffect(() => {
    let alive = true;
    if (!id) {
      setUrl(null);
      return;
    }
    assetUrl(id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id, retry]);
  return url;
}

export const deleteAsset = (id: string) => {
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  return idbDelete(STORES.assets, id);
};

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export interface ExportedAsset {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
}

export async function exportAssets(): Promise<ExportedAsset[]> {
  const out: ExportedAsset[] = [];
  for (const id of await idbKeys(STORES.assets)) {
    const a = await idbGet<Asset>(STORES.assets, id);
    if (a) out.push({ id: a.id, name: a.name, type: a.type, dataUrl: await toDataUrl(a.blob) });
  }
  return out;
}

export async function importAssets(assets: ExportedAsset[]) {
  for (const a of assets) {
    const blob = await (await fetch(a.dataUrl)).blob();
    await idbSet(STORES.assets, a.id, { id: a.id, name: a.name, type: a.type, blob, createdAt: Date.now() } satisfies Asset);
    const old = urls.get(a.id);
    if (old) URL.revokeObjectURL(old);
    urls.delete(a.id);
  }
}

export async function clearAssets() {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  await idbClear(STORES.assets);
}

/** First image file in a clipboard or drop payload. */
export const imageFrom = (data: DataTransfer | null): File | null =>
  [...(data?.files ?? [])].find((f) => f.type.startsWith('image/')) ?? null;
