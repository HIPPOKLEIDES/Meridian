import { describe, expect, it } from 'vitest';
import { normalizeKey, normalizeUrl } from './config';

describe('normalizeUrl', () => {
  it.each([
    ['https://abcd1234.supabase.co', 'https://abcd1234.supabase.co'],
    ['"https://abcd1234.supabase.co"', 'https://abcd1234.supabase.co'],
    ["  'https://abcd1234.supabase.co/'  ", 'https://abcd1234.supabase.co'],
    ['https://abcd1234.supabase.co/rest/v1/', 'https://abcd1234.supabase.co'],
    ['abcd1234.supabase.co', 'https://abcd1234.supabase.co'],
    ['https://supabase.com/dashboard/project/abcd1234/settings/api', 'https://abcd1234.supabase.co'],
    ['http://localhost:54321', 'http://localhost:54321'],
  ])('accepts %s', (raw, url) => {
    expect(normalizeUrl(raw)).toEqual({ url });
  });

  it('never repeats a pasted connection string (it contains the database password)', () => {
    const result = normalizeUrl('postgresql://postgres:hunter2@db.abcd1234.supabase.co:5432/postgres');
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it.each(['', 'abcd1234', 'http://abcd1234.supabase.co', 'postgresql://postgres:pw@db.abcd1234.supabase.co:5432/postgres'])('rejects %s with a reason', (raw) => {
    expect(normalizeUrl(raw)).toHaveProperty('problem');
  });
});

describe('normalizeKey', () => {
  const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.signature-part-here`;

  it('accepts anon and publishable keys, trimming quotes', () => {
    expect(normalizeKey(' "sb_publishable_abcdefghijklmnopqrstu" ')).toEqual({ key: 'sb_publishable_abcdefghijklmnopqrstu' });
    expect(normalizeKey(jwt('anon'))).toEqual({ key: jwt('anon') });
  });

  it('refuses secret keys', () => {
    expect(normalizeKey('sb_secret_abcdefghijklmnopqrstuvwx')).toHaveProperty('problem');
    expect(normalizeKey(jwt('service_role'))).toHaveProperty('problem');
  });

  it('rejects empty and truncated keys', () => {
    expect(normalizeKey('')).toHaveProperty('problem');
    expect(normalizeKey('sb_publ')).toHaveProperty('problem');
  });
});
