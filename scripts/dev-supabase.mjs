// A small local stand-in for Supabase, for trying cloud sync without an account and for end-to-end tests.
// It runs the real supabase/schema.sql on PGlite and speaks just enough of Supabase's Auth, REST (PostgREST)
// and Storage HTTP APIs for @supabase/supabase-js. Realtime isn't implemented, so the app falls back to polling.
//
//   node scripts/dev-supabase.mjs            → http://localhost:54321  (anon key: anything, e.g. "dev-anon-key-000000000000")
//   DATA_DIR=.dev-supabase node scripts/dev-supabase.mjs   → same, but accounts and records survive restarts
//
// Development only: passwords are hashed with plain SHA-256, tokens are signed with a fixed secret,
// email addresses are confirmed instantly and nothing is persisted.
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'node:http';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.PORT ?? 54321);
const SECRET = 'meridian-dev-secret';
// DATA_DIR=.dev-supabase keeps accounts and data between restarts (files stay in memory either way).
const DATA_DIR = process.env.DATA_DIR;
const db = new PGlite(DATA_DIR);
const initialized = DATA_DIR && (await db.query(`select 1 from pg_namespace where nspname = 'auth'`)).rows.length > 0;

if (!initialized) await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text unique,
    encrypted_password text,
    email_confirmed_at timestamptz default now(),
    raw_user_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, unique (bucket_id, name));
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated;
  grant select, insert, update on storage.objects to authenticated;
  grant usage on schema public to authenticated, anon;
`);
await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));

const files = new Map(); // "bucket/path" → { type, bytes }
const refreshTokens = new Map(); // token → user id
let queue = Promise.resolve();
/** PGlite is single-connection: run one request's queries at a time. */
const serialize = (fn) => (queue = queue.then(fn, fn));

// ───────── helpers ─────────

const b64url = (buf) => Buffer.from(buf).toString('base64url');
function signJwt(payload) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const [head, body, sig] = (token ?? '').split('.');
  if (!sig || createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url') !== sig) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  return payload.exp * 1000 > Date.now() ? payload : null;
}
const hash = (pw) => createHash('sha256').update(`meridian:${pw}`).digest('hex');
const json = (value) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v));

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : typeof body === 'string' ? body : json(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function userJson(u) {
  return {
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: u.email_confirmed_at,
    confirmed_at: u.email_confirmed_at,
    user_metadata: u.raw_user_meta_data ?? {},
    app_metadata: { provider: 'email', providers: ['email'] },
    identities: [],
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

function session(u) {
  const now = Math.floor(Date.now() / 1000);
  const refresh = randomUUID();
  refreshTokens.set(refresh, u.id);
  return {
    access_token: signJwt({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600, session_id: randomUUID() }),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: refresh,
    user: userJson(u),
  };
}

const authError = (res, status, message, code) => send(res, status, { code: status, error_code: code, msg: message, message, error_description: message });

async function asUser(userId, fn) {
  await db.exec(userId ? `set role authenticated` : `set role anon`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

const pgError = (res, e) => {
  const status = e.code === '42501' ? 403 : 400;
  send(res, status, { code: e.code ?? 'PGRST', message: e.message, details: null, hint: null });
};

// ───────── auth ─────────

async function handleAuth(req, res, url, body) {
  const route = url.pathname.replace('/auth/v1', '');
  const input = body.length ? JSON.parse(body.toString()) : {};
  if (route === '/signup' && req.method === 'POST') {
    const email = String(input.email ?? '').trim().toLowerCase();
    if (!email || !input.password) return authError(res, 400, 'Signup requires a valid password', 'validation_failed');
    if (String(input.password).length < 6) return authError(res, 422, 'Password should be at least 6 characters.', 'weak_password');
    const existing = await db.query(`select 1 from auth.users where email = $1`, [email]);
    if (existing.rows.length) return authError(res, 422, 'User already registered', 'user_already_exists');
    const { rows } = await db.query(
      `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, $2, $3, $4) returning *`,
      [randomUUID(), email, hash(input.password), JSON.stringify(input.data ?? {})],
    );
    return send(res, 200, session(rows[0]));
  }
  if (route === '/token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const { rows } = await db.query(`select * from auth.users where email = $1`, [String(input.email ?? '').trim().toLowerCase()]);
      if (!rows[0] || rows[0].encrypted_password !== hash(input.password)) return authError(res, 400, 'Invalid login credentials', 'invalid_credentials');
      return send(res, 200, session(rows[0]));
    }
    if (grant === 'refresh_token') {
      const id = refreshTokens.get(input.refresh_token);
      if (!id) return authError(res, 400, 'Invalid Refresh Token: Refresh Token Not Found', 'refresh_token_not_found');
      refreshTokens.delete(input.refresh_token);
      const { rows } = await db.query(`select * from auth.users where id = $1`, [id]);
      return send(res, 200, session(rows[0]));
    }
    return authError(res, 400, 'Unsupported grant type', 'validation_failed');
  }
  const claims = verifyJwt((req.headers.authorization ?? '').replace(/^Bearer /i, ''));
  if (route === '/user') {
    if (!claims) return authError(res, 401, 'Invalid JWT', 'bad_jwt');
    if (req.method === 'PUT') {
      if (input.password) await db.query(`update auth.users set encrypted_password = $1, updated_at = now() where id = $2`, [hash(input.password), claims.sub]);
      if (input.data) await db.query(`update auth.users set raw_user_meta_data = raw_user_meta_data || $1::jsonb, updated_at = now() where id = $2`, [JSON.stringify(input.data), claims.sub]);
    }
    const { rows } = await db.query(`select * from auth.users where id = $1`, [claims.sub]);
    return rows[0] ? send(res, 200, userJson(rows[0])) : authError(res, 404, 'User not found', 'user_not_found');
  }
  if (route === '/logout') return send(res, 204);
  if (route === '/recover' || route === '/resend' || route === '/otp') return send(res, 200, {});
  if (route === '/settings') return send(res, 200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: true });
  return authError(res, 404, `Not implemented: ${req.method} ${route}`, 'not_found');
}

// ───────── REST (PostgREST subset) ─────────

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error(`Bad identifier ${s}`), { code: '42601' });
  return s;
};

function parseIn(value) {
  const inner = value.replace(/^\(/, '').replace(/\)$/, '');
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (inner.length) out.push(cur);
  return out;
}

function whereClause(params, values) {
  const conditions = [];
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(key)) continue;
    const col = ident(key);
    const dot = raw.indexOf('.');
    const op = raw.slice(0, dot);
    const val = raw.slice(dot + 1);
    const ops = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
    if (ops[op]) {
      values.push(val);
      // Equality compares as text (ids, uuids); ordering lets Postgres take the column's own type (seq numbers).
      conditions.push(op === 'eq' || op === 'neq' ? `${col}::text ${ops[op]} $${values.length}` : `${col} ${ops[op]} $${values.length}`);
    } else if (op === 'in') {
      const list = parseIn(val);
      const holders = list.map((v) => {
        values.push(v);
        return `$${values.length}`;
      });
      conditions.push(holders.length ? `${col}::text in (${holders.join(',')})` : 'false');
    } else if (op === 'is') {
      conditions.push(`${col} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`);
    } else {
      throw Object.assign(new Error(`Unsupported filter ${op}`), { code: 'PGRST100' });
    }
  }
  return conditions.length ? ` where ${conditions.join(' and ')}` : '';
}

async function handleRest(req, res, url, body, userId) {
  const route = url.pathname.replace('/rest/v1/', '');
  if (route.startsWith('rpc/')) {
    const fn = ident(route.slice(4));
    const args = body.length ? JSON.parse(body.toString()) : {};
    const names = Object.keys(args).map(ident);
    const values = names.map((n) => (typeof args[n] === 'object' && args[n] !== null ? JSON.stringify(args[n]) : args[n]));
    const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
    const { rows: meta } = await db.query(`select proretset, prorettype::regtype::text as rettype from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [fn]);
    if (!meta.length) return send(res, 404, { code: 'PGRST202', message: `Could not find the function public.${fn}` });
    const result = await asUser(userId, () => db.query(meta[0].proretset ? `select * from ${call} as r` : `select ${call} as r`, values));
    if (meta[0].rettype === 'void') return send(res, 200, 'null');
    if (meta[0].proretset) return send(res, 200, result.rows.map((r) => Object.values(r)[0]));
    // Always JSON-encode, so a text result arrives as "value" like PostgREST sends it.
    return send(res, 200, json(result.rows[0]?.r ?? null));
  }

  const table = ident(route);
  const params = [...url.searchParams.entries()];
  const values = [];
  if (req.method === 'GET' || req.method === 'HEAD') {
    const select = url.searchParams.get('select') ?? '*';
    const cols = select === '*' ? '*' : select.split(',').map((c) => ident(c.trim())).join(', ');
    let sql = `select ${cols} from public.${table}${whereClause(params, values)}`;
    const order = url.searchParams.get('order');
    if (order) {
      sql += ` order by ${order
        .split(',')
        .map((o) => {
          const [col, dir] = o.split('.');
          return `${ident(col)} ${dir === 'desc' ? 'desc' : 'asc'}`;
        })
        .join(', ')}`;
    }
    const limit = Number(url.searchParams.get('limit'));
    if (limit) sql += ` limit ${Math.min(limit, 10000)}`;
    const offset = Number(url.searchParams.get('offset'));
    if (offset) sql += ` offset ${offset}`;
    const { rows } = await asUser(userId, () => db.query(sql, values));
    return send(res, 200, rows);
  }
  if (req.method === 'PATCH') {
    const patch = JSON.parse(body.toString());
    const sets = Object.keys(patch).map((k) => {
      values.push(patch[k]);
      return `${ident(k)} = $${values.length}`;
    });
    const where = whereClause(params, values);
    await asUser(userId, () => db.query(`update public.${table} set ${sets.join(', ')}${where}`, values));
    return send(res, 204);
  }
  if (req.method === 'DELETE') {
    const where = whereClause(params, values);
    await asUser(userId, () => db.query(`delete from public.${table}${where}`, values));
    return send(res, 204);
  }
  return send(res, 405, { message: 'Method not supported here' });
}

// ───────── storage ─────────

function fileFromMultipart(req, body) {
  const type = req.headers['content-type'] ?? '';
  const boundary = /boundary=(.+)$/.exec(type)?.[1];
  if (!boundary) return { type, bytes: body };
  const delimiter = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delimiter);
  let file = null;
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = body.subarray(start + delimiter.length + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, split).toString();
    if (/filename=/.test(head)) file = { type: /content-type:\s*(.+)/i.exec(head)?.[1]?.trim() ?? 'application/octet-stream', bytes: Buffer.from(part.subarray(split + 4)) };
    start = next;
  }
  return file ?? { type: 'application/octet-stream', bytes: Buffer.alloc(0) };
}

async function handleStorage(req, res, url, body, userId) {
  const match = /^\/storage\/v1\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/.exec(url.pathname);
  if (!match) return send(res, 404, { message: 'Not found' });
  const [, bucket, path] = match.map(decodeURIComponent);
  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      await asUser(userId, () =>
        db.query(
          `insert into storage.objects (bucket_id, name) values ($1, $2) on conflict (bucket_id, name) do update set name = excluded.name`,
          [bucket, path],
        ),
      );
    } catch (e) {
      return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: e.message });
    }
    files.set(`${bucket}/${path}`, fileFromMultipart(req, body));
    return send(res, 200, { Key: `${bucket}/${path}`, Id: randomUUID() });
  }
  if (req.method === 'GET') {
    const { rows } = await asUser(userId, () => db.query(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, path]));
    const file = files.get(`${bucket}/${path}`);
    if (!rows.length || !file) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    res.writeHead(200, { 'content-type': file.type });
    return res.end(file.bytes);
  }
  return send(res, 405, { message: 'Method not supported here' });
}

// ───────── server ─────────

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': '*',
};

createServer(async (req, res) => {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const body = await readBody(req);
  await serialize(async () => {
    try {
      if (url.pathname.startsWith('/auth/v1/')) return await handleAuth(req, res, url, body);
      const claims = verifyJwt((req.headers.authorization ?? '').replace(/^Bearer /i, ''));
      if (url.pathname.startsWith('/rest/v1/')) return await handleRest(req, res, url, body, claims?.sub ?? null);
      if (url.pathname.startsWith('/storage/v1/')) return await handleStorage(req, res, url, body, claims?.sub ?? null);
      return send(res, 404, { message: `Not implemented: ${url.pathname}` });
    } catch (e) {
      if (!res.headersSent) pgError(res, e);
    }
  });
  if (process.env.LOG) console.log(req.method, url.pathname + url.search, res.statusCode);
}).listen(PORT, () => console.log(`Dev Supabase on http://localhost:${PORT}`));
