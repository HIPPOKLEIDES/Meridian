import type { SupabaseClient } from '@supabase/supabase-js';
import { toError } from './client';
import type { CloudRecord, PushResult, Remote } from './types';

const COLUMNS = 'key,collection,item_id,project_id,data,deleted,modified_at,seq';
const PAGE = 1000;
const KEYS_PER_REQUEST = 100;

/** The sync engine's server, backed by public.records and push_records() in Supabase. */
export class SupabaseRemote implements Remote {
  constructor(private readonly sb: SupabaseClient) {}

  async push(rows: CloudRecord[]): Promise<PushResult> {
    const payload = rows.map(({ key, collection, item_id, project_id, data, deleted, modified_at }) => ({
      key,
      collection,
      item_id,
      project_id,
      data,
      deleted,
      modified_at,
    }));
    const { data, error } = await this.sb.rpc('push_records', { rows: payload });
    if (error) throw toError(error, 'Couldn’t upload changes');
    return data as PushResult;
  }

  async pull(afterSeq: number, limit: number): Promise<CloudRecord[]> {
    const { data, error } = await this.sb.from('records').select(COLUMNS).gt('seq', afterSeq).order('seq', { ascending: true }).limit(limit);
    if (error) throw toError(error, 'Couldn’t download changes');
    return (data ?? []) as CloudRecord[];
  }

  async pullProject(projectId: string): Promise<CloudRecord[]> {
    const all: CloudRecord[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.sb
        .from('records')
        .select(COLUMNS)
        .eq('project_id', projectId)
        .order('seq', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw toError(error, 'Couldn’t download the project');
      all.push(...((data ?? []) as CloudRecord[]));
      if (!data || data.length < PAGE) return all;
    }
  }

  async fetch(keys: string[]): Promise<CloudRecord[]> {
    const all: CloudRecord[] = [];
    for (let i = 0; i < keys.length; i += KEYS_PER_REQUEST) {
      const { data, error } = await this.sb.from('records').select(COLUMNS).in('key', keys.slice(i, i + KEYS_PER_REQUEST));
      if (error) throw toError(error);
      all.push(...((data ?? []) as CloudRecord[]));
    }
    return all;
  }

  /** Whether this account has stored anything yet. */
  async hasAnyRecords(): Promise<boolean> {
    const { data, error } = await this.sb.from('records').select('key').limit(1);
    if (error) throw toError(error);
    return (data ?? []).length > 0;
  }
}
