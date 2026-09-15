/**
 * Passphrase encryption for the journal, using only the browser's Web Crypto API.
 * PBKDF2-SHA256 derives an AES-256-GCM key from the passphrase and a random salt. Each save uses a fresh IV.
 * The envelope is self-describing, so a future server can store it as an opaque blob it can't read.
 */

export interface Envelope {
  format: 'meridian-encrypted';
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

/** OWASP's 2023+ recommendation for PBKDF2-HMAC-SHA256. */
export const PBKDF2_ITERATIONS = 600_000;

export const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export const randomSalt = () => crypto.getRandomValues(new Uint8Array(16));

export async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptString(key: CryptoKey, salt: Uint8Array, iterations: number, plaintext: string): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)));
  return { format: 'meridian-encrypted', v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}

/** Throws if the key is wrong or the data was tampered with (GCM authenticates it). */
export async function decryptString(key: CryptoKey, env: Envelope): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) as BufferSource }, key, fromB64(env.data) as BufferSource);
  return new TextDecoder().decode(plain);
}

export const envelopeSalt = (env: Envelope) => fromB64(env.salt);

export function parseEnvelope(raw: string | null | undefined): Envelope | null {
  if (!raw || !raw.startsWith('{"format":"meridian-encrypted"')) return null;
  try {
    const env = JSON.parse(raw) as Envelope;
    return env.format === 'meridian-encrypted' && env.v === 1 ? env : null;
  } catch {
    return null;
  }
}
