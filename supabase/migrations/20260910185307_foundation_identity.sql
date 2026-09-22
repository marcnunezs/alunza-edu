-- IMP-00.03: local, provisional DEC-006 foundation.
-- Technical dictionary reviewed before this DDL: docs/work/IMP-00-dictionary.md.
-- The application password is assigned by the local bootstrap, never in SQL history.

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'alunza_app') then
    create role alunza_app login noinherit nosuperuser nocreatedb nocreaterole
      noreplication nobypassrls;
  end if;
end
$$;

-- Supabase's migration role is not SUPERUSER: it cannot ALTER SUPERUSER
-- attributes, even to set NOSUPERUSER. Validate an existing role instead.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_roles where rolname = 'alunza_app'
      and (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole
        or rolreplication or rolinherit or not rolcanlogin)
  ) then
    raise exception 'Existing alunza_app role has unexpected privileges';
  end if;
end
$$;

create schema app;

revoke all on schema app from public, anon, authenticated, service_role;
grant usage on schema app to alunza_app;

alter default privileges in schema app
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema app
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema app
  revoke all on functions from public, anon, authenticated, service_role;

create table app.organizations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique
    check (char_length(code) between 1 and 40 and code = upper(btrim(code))),
  name text not null check (char_length(name) between 1 and 160 and btrim(name) <> ''),
  timezone text not null default 'America/Santiago'
    check (char_length(timezone) between 1 and 64 and btrim(timezone) <> ''),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table app.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 120 and btrim(display_name) <> ''),
  email_normalized text not null unique
    check (char_length(email_normalized) between 1 and 254
      and email_normalized = lower(btrim(email_normalized))),
  account_state text not null default 'INVITED'
    check (account_state in ('INVITED', 'ACTIVE', 'DISABLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app.organization_memberships (
  organization_id uuid not null references app.organizations(id) on delete restrict,
  user_id uuid not null references app.profiles(id) on delete restrict,
  role text not null check (role in ('ADMIN', 'TEACHER', 'STUDENT')),
  state text not null default 'INVITED'
    check (state in ('INVITED', 'ACTIVE', 'DISABLED')),
  joined_at timestamptz,
  disabled_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_memberships_user_id_idx
  on app.organization_memberships(user_id);

revoke all on all tables in schema app from public, anon, authenticated, service_role;
grant select on app.organizations, app.profiles, app.organization_memberships to alunza_app;

alter table app.organizations enable row level security;
alter table app.organizations force row level security;
alter table app.profiles enable row level security;
alter table app.profiles force row level security;
alter table app.organization_memberships enable row level security;
alter table app.organization_memberships force row level security;

-- Bootstrap authorization reads only the actor's own identity and memberships.
-- State is deliberately readable for a denied actor, so the API can check it live.
create policy profiles_read_self on app.profiles
  for select to alunza_app
  using (id = nullif(current_setting('app.actor_id', true), '')::uuid);

create policy memberships_read_self on app.organization_memberships
  for select to alunza_app
  using (user_id = nullif(current_setting('app.actor_id', true), '')::uuid);

-- This dependency graph is acyclic: organizations -> memberships and profiles;
-- both supporting policies depend only on the verified transaction actor.
create policy organizations_read_active_scope on app.organizations
  for select to alunza_app
  using (
    id = nullif(current_setting('app.organization_id', true), '')::uuid
    and archived_at is null
    and exists (
      select 1
      from app.organization_memberships as membership
      join app.profiles as profile on profile.id = membership.user_id
      where membership.organization_id = organizations.id
        and membership.user_id = nullif(current_setting('app.actor_id', true), '')::uuid
        and membership.state = 'ACTIVE'
        and profile.account_state = 'ACTIVE'
    )
  );
