// Runs supabase/schema.sql on an in-process Postgres (PGlite) with small stand-ins for Supabase's
// auth and storage schemas, then checks the sharing and sync rules as different users.
// Usage: node scripts/test-schema.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    email_confirmed_at timestamptz default now(),
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;

  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated;
  grant select, insert, update on storage.objects to authenticated;
  grant usage on schema public to authenticated, anon;
`);

await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
// Running twice must be harmless.
await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));

const users = {
  ana: '00000000-0000-0000-0000-00000000000a',
  ben: '00000000-0000-0000-0000-00000000000b',
  cat: '00000000-0000-0000-0000-00000000000c',
  eve: '00000000-0000-0000-0000-00000000000e',
};
await db.query(`insert into auth.users (id, email, raw_user_meta_data) values
  ($1, 'ana@example.com', '{"display_name":"Ana"}'),
  ($2, 'Ben@Example.com', '{}'),
  ($3, 'cat@example.com', '{}'),
  ($4, 'eve@example.com', '{}')`, [users.ana, users.ben, users.cat, users.eve]);
// Eve signed up with someone else's address and never confirmed it.
await db.query(`update auth.users set email_confirmed_at = null where id = $1`, [users.eve]);

/** Runs queries as a signed-in user (role authenticated + JWT subject), like PostgREST does. */
async function as(user, fn) {
  await db.exec(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [users[user]]);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

const q = async (sql, params) => (await db.query(sql, params)).rows;
const push = async (rows) => (await q(`select public.push_records($1::jsonb) as r`, [JSON.stringify(rows)]))[0].r;
const row = (user, collection, id, data, extra = {}) => {
  const project = ['project', 'task', 'note', 'asset'].includes(collection);
  return {
    key: project ? `${collection}:${id}` : `${users[user]}:${collection}:${id}`,
    collection,
    item_id: id,
    project_id: collection === 'project' ? id : extra.project_id ?? null,
    data,
    deleted: false,
    modified_at: extra.modified_at ?? 1000,
    ...extra,
  };
};

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('schema.sql');

await test('profiles are created for new users', async () => {
  const profiles = await q(`select display_name, email from public.profiles order by email`);
  assert.equal(profiles.length, 4);
  assert.equal(profiles.find((p) => p.email === 'ana@example.com').display_name, 'Ana');
  assert.equal(profiles.find((p) => p.email === 'cat@example.com').display_name, 'cat');
});

await test('personal records are private', async () => {
  const r = await as('ana', () => push([row('ana', 'habit', 'h1', { title: 'Meditate' })]));
  assert.deepEqual(r.accepted, [`${users.ana}:habit:h1`]);
  assert.equal((await as('ana', () => q(`select * from public.records`))).length, 1);
  assert.equal((await as('ben', () => q(`select * from public.records`))).length, 0);
});

await test("personal keys must belong to the pusher", async () => {
  const forged = { ...row('ana', 'habit', 'h2', {}), key: `${users.ana}:habit:h2` };
  const r = await as('ben', () => push([forged]));
  assert.equal(r.denied.length, 1);
});

await test('nobody can overwrite another user\'s personal record', async () => {
  const r = await as('ben', () => push([{ ...row('ana', 'habit', 'h1', { title: 'hacked' }), modified_at: 9999 }]));
  assert.equal(r.denied.length, 1);
  const [h] = await as('ana', () => q(`select data from public.records where key = $1`, [`${users.ana}:habit:h1`]));
  assert.equal(h.data.title, 'Meditate');
});

await test('creating a project makes you its owner', async () => {
  const r = await as('ana', () =>
    push([row('ana', 'project', 'p1', { name: 'Mod' }), row('ana', 'task', 't1', { title: 'Design' }, { project_id: 'p1' })]),
  );
  assert.equal(r.accepted.length, 2, JSON.stringify(r));
  const members = await as('ana', () => q(`select user_id, role from public.project_members where project_id = 'p1'`));
  assert.deepEqual(members, [{ user_id: users.ana, role: 'owner' }]);
});

await test("an existing project id can't be claimed by someone else", async () => {
  const r = await as('ben', () => push([row('ben', 'project', 'p1', { name: 'Mine now' }, { modified_at: 5000 })]));
  assert.equal(r.denied.length, 1);
});

await test('non-members see nothing of a project and cannot add to it', async () => {
  assert.equal((await as('ben', () => q(`select * from public.records where project_id = 'p1'`))).length, 0);
  const r = await as('ben', () => push([row('ben', 'task', 't2', { title: 'Sneaky' }, { project_id: 'p1' })]));
  assert.equal(r.denied.length, 1);
});

await test('only the owner can invite', async () => {
  await assert.rejects(as('ben', () => q(`select public.invite_member('p1', 'cat@example.com', 'editor')`)));
});

await test('email invites are accepted on sign-in (case-insensitive)', async () => {
  await as('ana', () => q(`select public.invite_member('p1', ' ben@example.COM ', 'editor')`));
  const invites = await as('ana', () => q(`select email, role from public.project_invites where project_id = 'p1'`));
  assert.deepEqual(invites, [{ email: 'ben@example.com', role: 'editor' }]);
  assert.equal((await as('ben', () => q(`select * from public.project_invites`))).length, 0, 'invitees cannot list invites');
  const joined = await as('ben', () => q(`select public.accept_invites() as pid`));
  assert.deepEqual(joined.map((j) => j.pid), ['p1']);
  assert.equal((await as('ben', () => q(`select * from public.records where project_id = 'p1'`))).length, 2);
});

await test('unconfirmed emails cannot accept invites', async () => {
  await as('ana', () => q(`select public.invite_member('p1', 'eve@example.com', 'editor')`));
  const joined = await as('eve', () => q(`select public.accept_invites() as pid`));
  assert.equal(joined.length, 0);
  assert.equal((await as('eve', () => q(`select * from public.records where project_id = 'p1'`))).length, 0);
});

await test('editors can add and edit tasks', async () => {
  const r = await as('ben', () =>
    push([
      row('ben', 'task', 't2', { title: 'Loot tables' }, { project_id: 'p1' }),
      row('ana', 'task', 't1', { title: 'Design v2' }, { project_id: 'p1', modified_at: 2000 }),
    ]),
  );
  assert.equal(r.accepted.length, 2, JSON.stringify(r));
});

await test('last write wins by modified_at; older edits come back stale', async () => {
  const r = await as('ana', () => push([row('ana', 'task', 't1', { title: 'Old offline edit' }, { project_id: 'p1', modified_at: 1500 })]));
  assert.deepEqual(r.stale, ['task:t1']);
  const [t] = await as('ana', () => q(`select data, owner_id, modified_by from public.records where key = 'task:t1'`));
  assert.equal(t.data.title, 'Design v2');
  assert.equal(t.owner_id, users.ana, 'owner is kept');
  assert.equal(t.modified_by, users.ben);
});

await test('editors cannot delete the project, owners can', async () => {
  const r = await as('ben', () => push([row('ben', 'project', 'p1', { name: 'Mod' }, { deleted: true, data: null, modified_at: 3000 })]));
  assert.equal(r.denied.length, 1, JSON.stringify(r));
});

await test('invite links let viewers join; viewers can read but not write', async () => {
  const [{ token }] = await as('ana', () => q(`select public.create_invite_link('p1', 'viewer') as token`));
  assert.equal(token.length, 64);
  const [{ pid }] = await as('cat', () => q(`select public.accept_invite_link($1) as pid`, [token]));
  assert.equal(pid, 'p1');
  assert.equal((await as('cat', () => q(`select * from public.records where project_id = 'p1'`))).length, 3);
  const r = await as('cat', () => push([row('cat', 'task', 't1', { title: 'Viewer edit' }, { project_id: 'p1', modified_at: 9000 })]));
  assert.equal(r.denied.length, 1);
  await assert.rejects(as('cat', () => q(`select public.accept_invite_link('nope')`)));
});

await test('members see each other\'s profiles, strangers do not', async () => {
  const seen = await as('cat', () => q(`select email from public.profiles order by email`));
  assert.deepEqual(seen.map((p) => p.email), ['ana@example.com', 'ben@example.com', 'cat@example.com']);
  const eveSees = await as('eve', () => q(`select email from public.profiles`));
  assert.deepEqual(eveSees.map((p) => p.email), ['eve@example.com']);
});

await test('you can rename yourself but not change your email', async () => {
  await as('cat', () => q(`update public.profiles set display_name = 'Cat' where id = $1`, [users.cat]));
  await assert.rejects(as('cat', () => q(`update public.profiles set email = 'x@y.z' where id = $1`, [users.cat])));
  await as('cat', () => q(`update public.profiles set display_name = 'Nope' where id = $1`, [users.ana]));
  const [ana] = await q(`select display_name from public.profiles where id = $1`, [users.ana]);
  assert.equal(ana.display_name, 'Ana');
});

await test('owners change roles; others cannot', async () => {
  await assert.rejects(as('ben', () => q(`select public.set_member_role('p1', $1, 'editor')`, [users.cat])));
  await as('ana', () => q(`select public.set_member_role('p1', $1, 'editor')`, [users.cat]));
  const r = await as('cat', () => push([row('cat', 'task', 't3', { title: 'Now I can' }, { project_id: 'p1' })]));
  assert.equal(r.accepted.length, 1);
});

await test('moving a personal task into a shared project shares it', async () => {
  await as('ben', () => push([row('ben', 'task', 't9', { title: 'Mine' }, { modified_at: 100 })]));
  assert.equal((await as('ana', () => q(`select * from public.records where key = 'task:t9'`))).length, 0);
  const r = await as('ben', () => push([row('ben', 'task', 't9', { title: 'Mine' }, { project_id: 'p1', modified_at: 200 })]));
  assert.equal(r.accepted.length, 1, JSON.stringify(r));
  assert.equal((await as('ana', () => q(`select * from public.records where key = 'task:t9'`))).length, 1);
});

await test('the seq cursor only moves forward and pulls are scoped by RLS', async () => {
  const before = await as('ben', () => q(`select max(seq)::int as s from public.records`));
  await as('ana', () => push([row('ana', 'task', 't1', { title: 'Design v3' }, { project_id: 'p1', modified_at: 4000 })]));
  const changed = await as('ben', () => q(`select key from public.records where seq > $1 order by seq`, [before[0].s]));
  assert.deepEqual(changed.map((c) => c.key), ['task:t1']);
});

await test('members can leave; the owner cannot; removed members lose access', async () => {
  await assert.rejects(as('ana', () => q(`select public.remove_member('p1', $1)`, [users.ana])));
  await assert.rejects(as('cat', () => q(`select public.remove_member('p1', $1)`, [users.ben])));
  await as('cat', () => q(`select public.remove_member('p1', $1)`, [users.cat]));
  assert.equal((await as('cat', () => q(`select * from public.records where project_id = 'p1'`))).length, 0);
  await as('ana', () => q(`select public.remove_member('p1', $1)`, [users.ben]));
  assert.equal((await as('ben', () => q(`select * from public.records where project_id = 'p1'`))).length, 0);
});

await test('owners can delete (tombstone) their project; there is no hard delete', async () => {
  const r = await as('ana', () => push([row('ana', 'project', 'p1', null, { deleted: true, modified_at: 6000 })]));
  assert.equal(r.accepted.length, 1, JSON.stringify(r));
  await assert.rejects(as('ana', () => q(`delete from public.records where key = 'project:p1'`)));
  assert.equal((await q(`select deleted from public.records where key = 'project:p1'`))[0].deleted, true);
});

await test('image storage follows project membership', async () => {
  await as('ana', () => push([row('ana', 'project', 'p2', { name: 'Art' })]));
  await as('ana', () => q(`insert into storage.objects (bucket_id, name) values ('assets', 'projects/p2/img1')`));
  await assert.rejects(as('ben', () => q(`insert into storage.objects (bucket_id, name) values ('assets', 'projects/p2/img2')`)));
  assert.equal((await as('ben', () => q(`select * from storage.objects`))).length, 0);
  assert.equal((await as('ana', () => q(`select * from storage.objects`))).length, 1);
});

await test('anonymous requests are refused', async () => {
  await db.exec(`set role anon`);
  try {
    await assert.rejects(db.query(`select * from public.records`));
    await assert.rejects(db.query(`select public.push_records('[]'::jsonb)`));
  } finally {
    await db.exec(`reset role`);
  }
});

await test('batches are capped', async () => {
  const many = Array.from({ length: 501 }, (_, i) => row('ana', 'habit', `x${i}`, {}));
  await assert.rejects(as('ana', () => push(many)));
});

console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
