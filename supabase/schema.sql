-- Meridian cloud schema for Supabase (Postgres 15+).
-- Run it in the Supabase SQL editor. It's idempotent, so running it again after an update is safe.
--
-- Data model
--   records          every synced item (a task, a habit, a transaction, a journal entry…) as JSON.
--                    Project-scoped items (project, task, note, asset) are keyed "<collection>:<id>" and
--                    visible to the project's members. Personal items are keyed "<owner>:<collection>:<id>"
--                    and visible only to their owner.
--   project_members  who can see a project and with which role (owner / editor / viewer).
--   project_invites  pending invitations, by email or by link.
--   profiles         display names and emails, visible to yourself and people you share a project with.
--
-- Sync
--   Clients push with push_records() (last write wins by the client's modified_at) and pull with a plain
--   select ordered by seq, a server-assigned sequence bumped on every write.

-- ───────────────────────── Tables ─────────────────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members (user_id);

create table if not exists public.project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  -- Exactly one of email (invite a person) or token (shareable link) is set.
  email text,
  token text unique,
  role text not null check (role in ('editor', 'viewer')),
  created_by uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  check ((email is null) <> (token is null))
);
create index if not exists project_invites_project_idx on public.project_invites (project_id);
create index if not exists project_invites_email_idx on public.project_invites (lower(email));

create sequence if not exists public.records_seq;

create table if not exists public.records (
  key text primary key,
  collection text not null,
  item_id text not null,
  project_id text,
  -- Null once the creator's account is deleted; project items stay with the project.
  owner_id uuid references auth.users (id) on delete set null,
  data jsonb,
  deleted boolean not null default false,
  -- Client clock (ms since epoch) of the edit; the newest edit wins.
  modified_at bigint not null,
  modified_by uuid,
  -- Assigned by the records_before_write trigger.
  seq bigint not null default 0,
  server_at timestamptz not null default now()
);
alter table public.records alter column seq set default 0;
create index if not exists records_seq_idx on public.records (seq);
create index if not exists records_owner_idx on public.records (owner_id);
create index if not exists records_project_idx on public.records (project_id) where project_id is not null;

-- ───────────────────────── Helpers ─────────────────────────
-- security definer so policies can consult memberships without recursing through their own RLS.
-- Deliberately not STABLE: a stable function reads the snapshot from the start of the statement and would miss
-- the owner membership that records_before_write adds while creating a project.

create or replace function public.project_role(pid text)
returns text language sql security definer set search_path = '' as $$
  select m.role from public.project_members m where m.project_id = pid and m.user_id = (select auth.uid())
$$;

create or replace function public.is_member(pid text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from public.project_members m where m.project_id = pid and m.user_id = (select auth.uid()))
$$;

create or replace function public.can_edit(pid text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = pid and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor')
  )
$$;

create or replace function public.is_owner(pid text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members m where m.project_id = pid and m.user_id = (select auth.uid()) and m.role = 'owner'
  )
$$;

-- Whether anyone owns this project id yet (a new project can only be created under an unclaimed id).
create or replace function public.project_claimed(pid text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from public.project_members m where m.project_id = pid)
$$;

create or replace function public.shares_project_with(other uuid)
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members a
    join public.project_members b on a.project_id = b.project_id
    where a.user_id = (select auth.uid()) and b.user_id = other
  )
$$;

create or replace function public.is_project_collection(c text)
returns boolean language sql immutable set search_path = '' as $$
  select c in ('project', 'task', 'note', 'asset')
$$;

-- ───────────────────────── Triggers ─────────────────────────

create or replace function public.records_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    -- Identity and ownership never change after creation.
    new.key := old.key;
    new.collection := old.collection;
    new.item_id := old.item_id;
    new.owner_id := old.owner_id;
  else
    new.owner_id := (select auth.uid());
    if new.owner_id is null then
      raise exception 'Not signed in' using errcode = '42501';
    end if;
  end if;

  if public.is_project_collection(new.collection) then
    if new.collection = 'project' then
      new.project_id := new.item_id;
      -- Creating a brand-new project makes you its owner. This happens here, before the row-level checks,
      -- because Postgres requires the inserted row to be readable by you, which needs the membership.
      if tg_op = 'INSERT' and not public.project_claimed(new.project_id)
         and not exists (select 1 from public.records r where r.key = new.key) then
        insert into public.project_members (project_id, user_id, role)
        values (new.project_id, new.owner_id, 'owner')
        on conflict do nothing;
      end if;
    end if;
    if tg_op = 'INSERT' and new.key <> new.collection || ':' || new.item_id then
      raise exception 'Malformed key %', new.key using errcode = '22023';
    end if;
  else
    new.project_id := null;
    if tg_op = 'INSERT' and new.key <> new.owner_id::text || ':' || new.collection || ':' || new.item_id then
      raise exception 'Malformed key %', new.key using errcode = '22023';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.collection = 'project' and new.deleted and not old.deleted
     and not public.is_owner(new.project_id) then
    raise exception 'Only the project owner can delete a project' using errcode = '42501';
  end if;

  new.modified_by := (select auth.uid());
  new.seq := nextval('public.records_seq');
  new.server_at := now();
  return new;
end $$;

drop trigger if exists records_before_write on public.records;
create trigger records_before_write before insert or update on public.records
  for each row execute function public.records_before_write();

-- (Older versions added the owner in an after-insert trigger.)
drop trigger if exists records_after_insert on public.records;
drop function if exists public.records_after_insert();

-- A profile for every account.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── Row-level security ─────────────────────────
-- Note: for INSERT … ON CONFLICT DO UPDATE, Postgres checks the insert policy against the proposed row too,
-- so the insert policy must also admit edits to existing project rows.

alter table public.records enable row level security;
alter table public.project_members enable row level security;
alter table public.project_invites enable row level security;
alter table public.profiles enable row level security;

drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated
  using (
    (project_id is null and owner_id = (select auth.uid()))
    or (project_id is not null and public.is_member(project_id))
  );

drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (
      (project_id is null and not public.is_project_collection(collection))
      or (collection = 'project' and (not public.project_claimed(project_id) or public.can_edit(project_id)))
      or (collection <> 'project' and public.is_project_collection(collection) and project_id is null)
      or (collection <> 'project' and project_id is not null and public.can_edit(project_id))
    )
  );

drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using (
    (project_id is null and owner_id = (select auth.uid()))
    or (project_id is not null and public.can_edit(project_id))
  )
  with check (
    (project_id is null and owner_id = (select auth.uid()))
    or (project_id is not null and public.can_edit(project_id))
  );
-- No delete policy: deletions are tombstones (deleted = true) so other devices hear about them.

drop policy if exists members_select on public.project_members;
create policy members_select on public.project_members for select to authenticated
  using (public.is_member(project_id));

drop policy if exists invites_select on public.project_invites;
create policy invites_select on public.project_invites for select to authenticated
  using (public.is_owner(project_id));

drop policy if exists invites_delete on public.project_invites;
create policy invites_delete on public.project_invites for delete to authenticated
  using (public.is_owner(project_id));

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_project_with(id));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

revoke all on public.records, public.project_members, public.project_invites, public.profiles from anon;
grant select, insert, update on public.records to authenticated;
grant select on public.project_members to authenticated;
grant select, delete on public.project_invites to authenticated;
grant select on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ───────────────────────── Sync RPC ─────────────────────────

-- Upserts a batch. Each row is { key, collection, item_id, project_id, data, deleted, modified_at }.
-- Returns { accepted: [key], stale: [key], denied: [{ key, reason }] }. Stale means the server already has
-- a newer edit; denied means you lack permission (or the row is malformed). One bad row doesn't fail the batch.
create or replace function public.push_records(rows jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r jsonb;
  n integer;
  accepted jsonb := '[]'::jsonb;
  stale jsonb := '[]'::jsonb;
  denied jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 500 then
    raise exception 'Expected an array of at most 500 rows' using errcode = '22023';
  end if;
  for r in select value from jsonb_array_elements(rows) loop
    begin
      insert into public.records as t (key, collection, item_id, project_id, data, deleted, modified_at)
      values (
        r ->> 'key',
        r ->> 'collection',
        r ->> 'item_id',
        r ->> 'project_id',
        case when jsonb_typeof(r -> 'data') = 'null' then null else r -> 'data' end,
        coalesce((r ->> 'deleted')::boolean, false),
        (r ->> 'modified_at')::bigint
      )
      on conflict (key) do update
        set project_id = excluded.project_id,
            data = excluded.data,
            deleted = excluded.deleted,
            modified_at = excluded.modified_at
        where t.modified_at <= excluded.modified_at;
      get diagnostics n = row_count;
      if n = 0 then
        stale := stale || to_jsonb(r ->> 'key');
      else
        accepted := accepted || to_jsonb(r ->> 'key');
      end if;
    exception when insufficient_privilege or invalid_parameter_value or not_null_violation or check_violation or raise_exception then
      denied := denied || jsonb_build_object('key', r ->> 'key', 'reason', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('accepted', accepted, 'stale', stale, 'denied', denied);
end $$;

revoke execute on function public.push_records(jsonb) from public, anon;
grant execute on function public.push_records(jsonb) to authenticated;

-- ───────────────────────── Sharing RPCs ─────────────────────────

create or replace function public.invite_member(pid text, invite_email text, member_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  normalized text := lower(trim(invite_email));
begin
  if not public.is_owner(pid) then
    raise exception 'Only the project owner can invite people' using errcode = '42501';
  end if;
  if member_role not in ('editor', 'viewer') then
    raise exception 'Unknown role %', member_role using errcode = '22023';
  end if;
  if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That doesn''t look like an email address' using errcode = '22023';
  end if;
  delete from public.project_invites where project_id = pid and lower(email) = normalized;
  insert into public.project_invites (project_id, email, role, created_by, expires_at)
  values (pid, normalized, member_role, (select auth.uid()), now() + interval '30 days');
end $$;

create or replace function public.create_invite_link(pid text, member_role text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  new_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not public.is_owner(pid) then
    raise exception 'Only the project owner can create invite links' using errcode = '42501';
  end if;
  if member_role not in ('editor', 'viewer') then
    raise exception 'Unknown role %', member_role using errcode = '22023';
  end if;
  insert into public.project_invites (project_id, token, role, created_by, expires_at)
  values (pid, new_token, member_role, (select auth.uid()), now() + interval '14 days');
  return new_token;
end $$;

-- Joins every project you were invited to by email (only once your email address is confirmed).
create or replace function public.accept_invites()
returns setof text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  my_email text;
  inv record;
begin
  select lower(u.email) into my_email from auth.users u where u.id = me and u.email_confirmed_at is not null;
  if my_email is null then
    return;
  end if;
  for inv in
    select * from public.project_invites
    where lower(email) = my_email and (expires_at is null or expires_at > now())
  loop
    insert into public.project_members (project_id, user_id, role)
    values (inv.project_id, me, inv.role)
    on conflict do nothing;
    delete from public.project_invites where id = inv.id;
    return next inv.project_id;
  end loop;
end $$;

create or replace function public.accept_invite_link(invite_token text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  inv record;
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into inv from public.project_invites
  where token = invite_token and (expires_at is null or expires_at > now());
  if inv is null then
    raise exception 'This invite link is invalid or has expired' using errcode = '22023';
  end if;
  insert into public.project_members (project_id, user_id, role)
  values (inv.project_id, (select auth.uid()), inv.role)
  on conflict do nothing;
  return inv.project_id;
end $$;

create or replace function public.set_member_role(pid text, member uuid, member_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner(pid) then
    raise exception 'Only the project owner can change roles' using errcode = '42501';
  end if;
  if member_role not in ('editor', 'viewer') then
    raise exception 'Unknown role %', member_role using errcode = '22023';
  end if;
  update public.project_members set role = member_role
  where project_id = pid and user_id = member and role <> 'owner';
end $$;

-- Owners remove others; anyone but the owner can remove themselves (leave).
create or replace function public.remove_member(pid text, member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target_role text;
begin
  select role into target_role from public.project_members where project_id = pid and user_id = member;
  if target_role is null then
    return;
  end if;
  if target_role = 'owner' then
    raise exception 'The owner can''t leave their own project' using errcode = '42501';
  end if;
  if member <> (select auth.uid()) and not public.is_owner(pid) then
    raise exception 'Only the project owner can remove people' using errcode = '42501';
  end if;
  delete from public.project_members where project_id = pid and user_id = member;
end $$;

revoke execute on function public.invite_member(text, text, text), public.create_invite_link(text, text),
  public.accept_invites(), public.accept_invite_link(text), public.set_member_role(text, uuid, text),
  public.remove_member(text, uuid) from public, anon;
grant execute on function public.invite_member(text, text, text), public.create_invite_link(text, text),
  public.accept_invites(), public.accept_invite_link(text), public.set_member_role(text, uuid, text),
  public.remove_member(text, uuid) to authenticated;

-- ───────────────────────── Images (Storage) ─────────────────────────
-- Note images live at assets/projects/<projectId>/<assetId>, readable by members and writable by editors.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('assets', 'assets', false) on conflict (id) do nothing;

    drop policy if exists "meridian assets read" on storage.objects;
    create policy "meridian assets read" on storage.objects for select to authenticated
      using (bucket_id = 'assets' and (storage.foldername(name))[1] = 'projects' and public.is_member((storage.foldername(name))[2]));

    drop policy if exists "meridian assets insert" on storage.objects;
    create policy "meridian assets insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'assets' and (storage.foldername(name))[1] = 'projects' and public.can_edit((storage.foldername(name))[2]));

    drop policy if exists "meridian assets update" on storage.objects;
    create policy "meridian assets update" on storage.objects for update to authenticated
      using (bucket_id = 'assets' and (storage.foldername(name))[1] = 'projects' and public.can_edit((storage.foldername(name))[2]));
  end if;
end $$;

-- ───────────────────────── Realtime ─────────────────────────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'records') then
      alter publication supabase_realtime add table public.records;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'project_members') then
      alter publication supabase_realtime add table public.project_members;
    end if;
  end if;
end $$;
