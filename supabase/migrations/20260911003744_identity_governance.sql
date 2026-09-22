-- IMP-01. Reviewed dictionary: docs/work/IMP-01-dictionary.md.
-- Forward-only migration. Auth owns credentials; ordinary application SQL never does.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'alunza_identity') then
    create role alunza_identity nologin noinherit nosuperuser nocreatedb
      nocreaterole noreplication nobypassrls;
  end if;
  if exists (select 1 from pg_roles where rolname = 'alunza_identity'
    and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole
      or rolreplication or rolbypassrls)) then
    raise exception 'Unexpected identity helper role attributes';
  end if;
end $$;

create schema app_private;
revoke all on schema app_private from public, anon, authenticated, service_role;
grant usage on schema app_private to alunza_app, alunza_identity;
grant usage on schema app to alunza_identity;
alter default privileges in schema app_private revoke execute on functions from public;

alter table app.organizations
  add column revision integer not null default 1 check (revision > 0),
  add column updated_at timestamptz not null default now(),
  add column archived_by uuid references app.profiles(id) on delete restrict,
  add column archive_reason text check (archive_reason is null or char_length(btrim(archive_reason)) between 1 and 500);

create table app.provisioning_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  granted_by text not null check (char_length(btrim(granted_by)) between 1 and 120),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text check (revoked_by is null or char_length(btrim(revoked_by)) between 1 and 120),
  revocation_reason text check (revocation_reason is null or char_length(btrim(revocation_reason)) between 1 and 500),
  consumed_at timestamptz,
  consumed_organization_id uuid unique references app.organizations(id) on delete restrict,
  check (expires_at > granted_at),
  check ((consumed_at is null) = (consumed_organization_id is null))
);
create index provisioning_grants_user_idx on app.provisioning_grants(user_id);

create table app.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete restrict,
  email_normalized text not null check (email_normalized = lower(btrim(email_normalized))
    and char_length(email_normalized) between 3 and 254),
  role text not null check (role in ('ADMIN', 'TEACHER', 'STUDENT')),
  invited_by uuid not null references app.profiles(id) on delete restrict,
  token_digest text check (token_digest is null or token_digest ~ '^[a-f0-9]{64}$'),
  generation integer not null default 0 check (generation >= 0),
  expires_at timestamptz not null default (now() + interval '72 hours'),
  accepted_at timestamptz,
  accepted_by uuid references app.profiles(id) on delete restrict,
  revoked_at timestamptz,
  revoked_by uuid references app.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  unique (organization_id, id),
  check ((accepted_at is null) = (accepted_by is null)),
  check (not (accepted_at is not null and revoked_at is not null)),
  check ((generation = 0 and token_digest is null) or (generation > 0 and token_digest is not null))
);
create unique index organization_invitations_pending_email_idx
  on app.organization_invitations(organization_id, email_normalized)
  where accepted_at is null and revoked_at is null;

create table app.invitation_deliveries (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null,
  organization_id uuid not null,
  requested_by uuid not null references app.profiles(id) on delete restrict,
  kind text not null check (kind in ('INITIAL', 'RESEND', 'RENEW')),
  state text not null default 'QUEUED'
    check (state in ('QUEUED', 'RUNNING', 'SENT', 'UNCERTAIN', 'FAILED', 'CANCELLED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{1,80}$'),
  auth_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  correlation_id uuid not null default gen_random_uuid(),
  foreign key (organization_id, invitation_id)
    references app.organization_invitations(organization_id, id) on delete restrict
);
create index invitation_deliveries_ready_idx
  on app.invitation_deliveries(available_at, id) where state in ('QUEUED', 'UNCERTAIN', 'RUNNING');
create index invitation_deliveries_invitation_idx on app.invitation_deliveries(organization_id, invitation_id);
create index invitation_deliveries_latest_idx on app.invitation_deliveries(organization_id, invitation_id, created_at desc, id desc);

create table app.operation_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references app.organizations(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  operation text not null check (char_length(operation) between 1 and 100),
  key text not null check (char_length(key) between 1 and 200),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  state text not null default 'RUNNING' check (state in ('RUNNING', 'COMPLETED')),
  resource_type text,
  resource_id uuid,
  response_status integer check (response_status between 200 and 599),
  response_body jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  lease_until timestamptz,
  unique nulls not distinct (organization_id, actor_id, operation, key)
);
create index operation_keys_response_expiry_idx on app.operation_keys(expires_at, id)
  where response_body is not null;

create table app.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete restrict,
  actor_kind text not null default 'USER' check (actor_kind in ('USER', 'SYSTEM', 'TECHNICAL')),
  occurred_at timestamptz not null default now(),
  action text not null check (char_length(action) between 1 and 100),
  entity_type text not null check (char_length(entity_type) between 1 and 100),
  entity_id uuid,
  result text not null check (char_length(result) between 1 and 80),
  correlation_id uuid not null,
  safe_changes jsonb,
  request_id uuid
);
create index audit_events_org_time_idx on app.audit_events(organization_id, occurred_at desc, id);

-- Helper role is never a login, never a table owner and never granted to the runtime.
-- Its explicit RLS policies form the non-recursive lookup boundary of definer helpers.
do $$
declare relation text;
begin
  foreach relation in array array['organizations','profiles','organization_memberships',
    'provisioning_grants','organization_invitations','invitation_deliveries','operation_keys','audit_events'] loop
    execute format('alter table app.%I enable row level security', relation);
    execute format('alter table app.%I force row level security', relation);
    execute format('create policy identity_internal_lookup on app.%I for select to alunza_identity using (true)', relation);
  end loop;
end $$;
grant select on all tables in schema app to alunza_identity;
-- Managed Auth is owned by supabase_admin, not the migration role. Its owner
-- must grant USAGE(auth), SELECT(id,email,email_confirmed_at) auth.users and
-- SELECT(id,user_id) auth.sessions to alunza_identity after this migration.
-- Auth also enables RLS: owner-created SELECT policies must restrict the helper
-- to users.id = app.actor_id and sessions.(id,user_id) = (app.session_id,app.actor_id).
-- Local bootstrap performs these exact grants/policies; pgTAP verifies the boundary.
grant update on app.invitation_deliveries to alunza_identity;
grant update (id) on app.organizations to alunza_identity;
grant update (response_body) on app.operation_keys to alunza_identity;
create policy identity_claim_delivery on app.invitation_deliveries for update
  to alunza_identity using (true) with check (true);
create policy identity_lock_organization on app.organizations for update
  to alunza_identity using (true) with check (true);
create policy identity_purge_operation_response on app.operation_keys for update
  to alunza_identity using (expires_at <= statement_timestamp() and response_body is not null)
  with check (expires_at <= statement_timestamp() and response_body is null);

create function app_private.actor_id() returns uuid
language sql stable set search_path = pg_catalog
as $$ select nullif(current_setting('app.actor_id', true), '')::uuid $$;
create function app_private.organization_id() returns uuid
language sql stable set search_path = pg_catalog
as $$ select nullif(current_setting('app.organization_id', true), '')::uuid $$;

create function app_private.session_is_active(actor uuid, session uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select actor is not null and session is not null
    and actor = app_private.actor_id()
    and session = nullif(current_setting('app.session_id', true), '')::uuid
    and exists (select 1 from auth.sessions s where s.id = session and s.user_id = actor)
$$;

create function app_private.current_auth_email() returns text
language sql stable security definer set search_path = pg_catalog
as $$
  select lower(btrim(u.email)) from auth.users u
  where u.id = app_private.actor_id() and u.email_confirmed_at is not null
    and app_private.session_is_active(u.id, nullif(current_setting('app.session_id', true), '')::uuid)
$$;

create function app_private.can_admin(org uuid, include_archived boolean default false) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select org = app_private.organization_id() and exists (
    select 1 from app.organization_memberships m join app.profiles p on p.id = m.user_id
      join app.organizations o on o.id = m.organization_id
    where m.organization_id = org and m.user_id = app_private.actor_id()
      and m.role = 'ADMIN' and m.state = 'ACTIVE' and p.account_state = 'ACTIVE'
      and (include_archived or o.archived_at is null))
    and (coalesce(current_setting('app.worker', true), '') <> 'true' or exists (
      select 1 from app.invitation_deliveries d
      where d.id = nullif(current_setting('app.delivery_id', true), '')::uuid
        and d.lease_token = nullif(current_setting('app.delivery_lease_token', true), '')::uuid
        and d.organization_id = org and d.requested_by = app_private.actor_id()
        and d.state = 'RUNNING' and d.lease_until > statement_timestamp()))
$$;

create function app_private.can_read_organization(org uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select (app_private.organization_id() is null or app_private.organization_id() = org)
    and exists (select 1 from app.organization_memberships m
      join app.profiles p on p.id = m.user_id join app.organizations o on o.id = m.organization_id
      where m.organization_id = org and m.user_id = app_private.actor_id()
      and m.state = 'ACTIVE' and p.account_state = 'ACTIVE'
      and (o.archived_at is null or m.role = 'ADMIN'))
$$;

create function app_private.provisioning_allowed() returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select app_private.current_auth_email() is not null
    and exists (select 1 from app.profiles p where p.id = app_private.actor_id() and p.account_state = 'ACTIVE')
    and exists (
    select 1 from app.provisioning_grants g
    where g.id = nullif(current_setting('app.provisioning_grant_id', true), '')::uuid
      and g.user_id = app_private.actor_id() and g.revoked_at is null
      and g.expires_at > statement_timestamp()
      and g.consumed_at is null)
$$;

create function app_private.invitation_context(invitation uuid, digest text, token_generation integer)
returns table (organization_id uuid, email_normalized text, role text, expires_at timestamptz,
  accepted_at timestamptz, accepted_by uuid, revoked_at timestamptz, generation integer, invited_by uuid, authorized_by uuid)
language sql stable security definer set search_path = pg_catalog
as $$
  select i.organization_id, i.email_normalized, i.role, i.expires_at,
    i.accepted_at, i.accepted_by, i.revoked_at, i.generation, i.invited_by, delivery.requested_by
  from app.organization_invitations i
  left join lateral (select d.requested_by from app.invitation_deliveries d
    where d.organization_id = i.organization_id and d.invitation_id = i.id
    order by d.created_at desc, d.id desc limit 1) delivery on true
  where i.id = invitation and i.token_digest = digest and i.generation = $3
    and digest ~ '^[a-f0-9]{64}$'
$$;

create function app_private.lock_invitation_organization(invitation uuid, digest text, token_generation integer)
returns table (id uuid, archived_at timestamptz)
language sql volatile security definer set search_path = pg_catalog
as $$
  select o.id, o.archived_at from app.organizations o
    join app.organization_invitations i on i.organization_id = o.id
    where i.id = invitation and i.token_digest = digest and i.generation = token_generation
      and digest ~ '^[a-f0-9]{64}$'
    for update of o
$$;

create function app_private.invitation_proof_matches() returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select exists (select 1 from app.organization_invitations i
    where i.id = nullif(current_setting('app.invitation_id', true), '')::uuid
      and i.organization_id = app_private.organization_id()
      and i.token_digest = nullif(current_setting('app.invitation_token_digest', true), '')
      and i.generation = nullif(current_setting('app.invitation_generation', true), '')::integer)
$$;

create function app_private.invitation_matches(require_recipient boolean default true) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select exists (select 1 from app.organization_invitations i
    join app.organizations o on o.id = i.organization_id
    join lateral (select d.requested_by from app.invitation_deliveries d
      where d.organization_id = i.organization_id and d.invitation_id = i.id
      order by d.created_at desc, d.id desc limit 1) delivery on true
    join app.organization_memberships m on m.organization_id = i.organization_id and m.user_id = delivery.requested_by
    join app.profiles p on p.id = m.user_id
    where i.id = nullif(current_setting('app.invitation_id', true), '')::uuid
      and i.organization_id = app_private.organization_id()
      and i.token_digest = nullif(current_setting('app.invitation_token_digest', true), '')
      and i.generation = nullif(current_setting('app.invitation_generation', true), '')::integer
      and i.revoked_at is null and o.archived_at is null
      and m.role = 'ADMIN' and m.state = 'ACTIVE' and p.account_state = 'ACTIVE'
      and (i.accepted_at is not null or i.expires_at > statement_timestamp())
      and (not require_recipient or (i.email_normalized = app_private.current_auth_email()
        and (i.accepted_by is null or i.accepted_by = app_private.actor_id())
        and not exists (select 1 from app.profiles recipient
          where recipient.id = app_private.actor_id() and recipient.account_state = 'DISABLED'))))
$$;

create function app_private.worker_delivery_valid() returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select current_setting('app.worker', true) = 'true'
    and exists (select 1 from app.invitation_deliveries d
      where d.id = nullif(current_setting('app.delivery_id', true), '')::uuid
        and d.lease_token = nullif(current_setting('app.delivery_lease_token', true), '')::uuid
        and d.organization_id = app_private.organization_id()
        and d.requested_by = app_private.actor_id()
        and d.state = 'RUNNING' and d.lease_until > statement_timestamp())
    and app_private.can_admin(app_private.organization_id())
$$;

create function app_private.worker_lease_valid() returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select current_setting('app.worker', true) = 'true'
    and exists (select 1 from app.invitation_deliveries d
      where d.id = nullif(current_setting('app.delivery_id', true), '')::uuid
        and d.lease_token = nullif(current_setting('app.delivery_lease_token', true), '')::uuid
        and d.organization_id = app_private.organization_id()
        and d.requested_by = app_private.actor_id()
        and d.state = 'RUNNING' and d.lease_until > statement_timestamp())
$$;

create function app_private.claim_invitation_delivery() returns setof app.invitation_deliveries
language plpgsql security definer set search_path = pg_catalog
as $$
declare claimed_org uuid;
begin
  -- Organization first is the same lock order as archive, resend and acceptance.
  select o.id into claimed_org from app.organizations o
    join app.invitation_deliveries d on d.organization_id = o.id
    where (d.state in ('QUEUED','UNCERTAIN') and d.available_at <= statement_timestamp())
      or (d.state = 'RUNNING' and d.lease_until <= statement_timestamp())
    order by d.available_at, d.id for update of o skip locked limit 1;
  if claimed_org is null then return; end if;
  return query
  with next_job as (
    select d.id from app.invitation_deliveries d
    where d.organization_id = claimed_org and
      ((d.state in ('QUEUED','UNCERTAIN') and d.available_at <= statement_timestamp())
      or (d.state = 'RUNNING' and d.lease_until <= statement_timestamp()))
    order by d.available_at, d.id for update skip locked limit 1
  )
  update app.invitation_deliveries d set state = 'RUNNING',
    attempt_count = d.attempt_count + 1,
    lease_until = statement_timestamp() + interval '90 seconds',
    lease_token = gen_random_uuid(), updated_at = statement_timestamp()
  from next_job n where d.id = n.id returning d.*;
end $$;

create function app_private.purge_expired_operation_responses() returns integer
language plpgsql security definer set search_path = pg_catalog
as $$
declare changed_count integer;
begin
  with expired as (
    select k.id from app.operation_keys k
    where k.expires_at <= statement_timestamp() and k.response_body is not null
    order by k.expires_at, k.id for update skip locked limit 100
  ), changed as (
    update app.operation_keys k set response_body = null
    from expired e where k.id = e.id returning k.id
  ) select count(*)::integer into changed_count from changed;
  return changed_count;
end $$;

-- Internal helpers are accessible only to the API role. Ownership is deliberately
-- a non-login role with explicit table/RLS privileges, never postgres/BYPASSRLS.
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
do $$
declare routine record;
begin
  for routine in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app_private' loop
    execute format('alter function %s owner to alunza_identity', routine.signature);
  end loop;
end $$;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
revoke all on all functions in schema app_private from public, anon, authenticated, service_role;
grant execute on all functions in schema app_private to alunza_app, alunza_identity;

drop policy profiles_read_self on app.profiles;
drop policy memberships_read_self on app.organization_memberships;
drop policy organizations_read_active_scope on app.organizations;

create policy profiles_read_authorized on app.profiles for select to alunza_app using (
  id = app_private.actor_id() or (app_private.can_admin(app_private.organization_id(), true)
    and exists (select 1 from app.organization_memberships m
      where m.organization_id = app_private.organization_id() and m.user_id = profiles.id)));
create policy profiles_create_self on app.profiles for insert to alunza_app with check (
  id = app_private.actor_id() and email_normalized = app_private.current_auth_email()
    and account_state = 'ACTIVE' and app_private.invitation_matches());
create policy profiles_update_self on app.profiles for update to alunza_app
  using (id = app_private.actor_id() and account_state = 'INVITED' and app_private.invitation_matches())
  with check (id = app_private.actor_id() and email_normalized = app_private.current_auth_email() and account_state = 'ACTIVE');

create policy memberships_read_authorized on app.organization_memberships for select to alunza_app using (
  user_id = app_private.actor_id() or (organization_id = app_private.organization_id()
    and app_private.can_admin(organization_id, true)));
create policy memberships_insert_authorized on app.organization_memberships for insert to alunza_app with check (
  organization_id = app_private.organization_id() and (
    (app_private.can_admin(organization_id) and state = 'INVITED')
    or (user_id = app_private.actor_id() and state = 'ACTIVE' and
      ((role = 'ADMIN' and app_private.provisioning_allowed()) or app_private.invitation_matches()))));
create policy memberships_update_authorized on app.organization_memberships for update to alunza_app
  using (organization_id = app_private.organization_id() and
    (app_private.can_admin(organization_id) or (user_id = app_private.actor_id() and app_private.invitation_matches())))
  with check (organization_id = app_private.organization_id() and
    (app_private.can_admin(organization_id) or (user_id = app_private.actor_id() and app_private.invitation_matches())));

create policy organizations_read_authorized on app.organizations for select to alunza_app using (
  app_private.can_read_organization(id)
  or (id = app_private.organization_id() and app_private.invitation_matches()));
create policy organizations_create_granted on app.organizations for insert to alunza_app with check (
  id = app_private.organization_id() and archived_at is null and app_private.provisioning_allowed());
create policy organizations_update_admin on app.organizations for update to alunza_app
  using (app_private.can_admin(id)) with check (id = app_private.organization_id());

create policy provisioning_read_self on app.provisioning_grants for select to alunza_app using (user_id = app_private.actor_id());
create policy provisioning_consume_self on app.provisioning_grants for update to alunza_app
  using (user_id = app_private.actor_id() and id = nullif(current_setting('app.provisioning_grant_id', true), '')::uuid
    and revoked_at is null and consumed_at is null and expires_at > statement_timestamp())
  with check (user_id = app_private.actor_id() and consumed_at is not null
    and consumed_organization_id = app_private.organization_id());

create policy invitations_read_authorized on app.organization_invitations for select to alunza_app using (
  organization_id = app_private.organization_id() and (app_private.can_admin(organization_id, true)
    or (id = nullif(current_setting('app.invitation_id', true), '')::uuid and app_private.invitation_proof_matches())));
create policy invitations_insert_admin on app.organization_invitations for insert to alunza_app with check (
  organization_id = app_private.organization_id() and invited_by = app_private.actor_id()
    and app_private.can_admin(organization_id) and accepted_at is null and revoked_at is null);
create policy invitations_update_authorized on app.organization_invitations for update to alunza_app
  using (organization_id = app_private.organization_id() and (app_private.can_admin(organization_id)
    or (id = nullif(current_setting('app.invitation_id', true), '')::uuid and app_private.invitation_matches())))
  with check (organization_id = app_private.organization_id() and (app_private.can_admin(organization_id)
    or (accepted_by = app_private.actor_id() and app_private.invitation_matches())));

create policy deliveries_read_admin on app.invitation_deliveries for select to alunza_app using (
  organization_id = app_private.organization_id() and
    (app_private.can_admin(organization_id, true) or app_private.worker_lease_valid()));
create policy deliveries_insert_authorized on app.invitation_deliveries for insert to alunza_app with check (
  organization_id = app_private.organization_id() and state = 'QUEUED'
    and requested_by = app_private.actor_id() and app_private.can_admin(organization_id));
create policy deliveries_update_admin on app.invitation_deliveries for update to alunza_app
  using (organization_id = app_private.organization_id() and
    (app_private.can_admin(organization_id) or app_private.worker_lease_valid()))
  with check (organization_id = app_private.organization_id());

create policy operation_keys_actor on app.operation_keys for all to alunza_app
  using (actor_id = app_private.actor_id() and (organization_id is null or organization_id = app_private.organization_id()))
  with check (actor_id = app_private.actor_id() and (organization_id is null or organization_id = app_private.organization_id()));
create policy audit_read_admin on app.audit_events for select to alunza_app using (
  organization_id = app_private.organization_id() and app_private.can_admin(organization_id, true));
create policy audit_insert_authorized on app.audit_events for insert to alunza_app with check (
  organization_id = app_private.organization_id() and actor_id = app_private.actor_id()
  and exists (select 1 from app.organization_memberships m
    where m.organization_id = audit_events.organization_id and m.user_id = app_private.actor_id()));

grant select on app.provisioning_grants, app.organization_invitations, app.invitation_deliveries,
  app.operation_keys, app.audit_events to alunza_app;
grant insert on app.organizations, app.profiles, app.organization_memberships,
  app.organization_invitations, app.invitation_deliveries, app.operation_keys, app.audit_events to alunza_app;
grant update (name, code, revision, updated_at, archived_at, archived_by, archive_reason) on app.organizations to alunza_app;
grant update (display_name, email_normalized, account_state, updated_at) on app.profiles to alunza_app;
grant update (role, state, joined_at, disabled_at, revision) on app.organization_memberships to alunza_app;
grant update (consumed_at, consumed_organization_id) on app.provisioning_grants to alunza_app;
grant update (token_digest, generation, expires_at, accepted_at, accepted_by, revoked_at, revoked_by, updated_at, revision)
  on app.organization_invitations to alunza_app;
grant update (state, attempt_count, available_at, lease_until, lease_token, last_error_code, auth_user_id, updated_at)
  on app.invitation_deliveries to alunza_app;
grant update (state, resource_type, resource_id, response_status, response_body, updated_at, lease_until)
  on app.operation_keys to alunza_app;

-- Database invariants survive missing application checks. Privileged fixture/migration
-- maintenance remains possible; all actual product connections use alunza_app.
create function app_private.guard_membership_change() returns trigger
language plpgsql security definer set search_path = pg_catalog
as $$
declare active_count integer; org_archived timestamptz; invitation_role text;
begin
  if TG_OP = 'UPDATE' and (new.organization_id <> old.organization_id or new.user_id <> old.user_id) then
    raise exception using errcode = '23514', message = 'IMMUTABLE_SCOPE';
  end if;
  select archived_at into org_archived from app.organizations where id = new.organization_id for update;
  if session_user = 'alunza_app' then
    if org_archived is not null then raise exception using errcode = 'P0001', message = 'ORGANIZATION_ARCHIVED'; end if;
    if new.state = 'ACTIVE' and (TG_OP = 'INSERT' or old.state = 'INVITED') then
      if not (new.user_id = app_private.actor_id() and new.role = 'ADMIN' and app_private.provisioning_allowed()) then
        if not (new.user_id = app_private.actor_id() and app_private.invitation_matches()) then
          raise exception using errcode = 'P0001', message = 'INVITATION_REQUIRED';
        end if;
        select i.role into invitation_role from app.organization_invitations i
          where i.id = nullif(current_setting('app.invitation_id', true), '')::uuid;
        if new.role <> invitation_role then raise exception using errcode = 'P0001', message = 'INVITATION_ROLE_MISMATCH'; end if;
      end if;
    end if;
    if TG_OP = 'UPDATE' and old.role = 'ADMIN' and old.state = 'ACTIVE'
      and (new.role <> 'ADMIN' or new.state <> 'ACTIVE') then
      select count(*) into active_count from app.organization_memberships m
        join app.profiles p on p.id = m.user_id where m.organization_id = old.organization_id
        and m.role = 'ADMIN' and m.state = 'ACTIVE' and p.account_state = 'ACTIVE';
      if active_count <= 1 then raise exception using errcode = 'P0001', message = 'LAST_ADMIN'; end if;
    end if;
    if TG_OP = 'UPDATE' then new.revision := old.revision + 1; end if;
  end if;
  return new;
end $$;
create trigger guard_membership_change before insert or update on app.organization_memberships
  for each row execute function app_private.guard_membership_change();

create function app_private.guard_organization_change() returns trigger
language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if new.id <> old.id then raise exception using errcode = '23514', message = 'IMMUTABLE_SCOPE'; end if;
  if session_user = 'alunza_app' then
    if old.archived_at is not null and new is distinct from old then
      raise exception using errcode = 'P0001', message = 'ORGANIZATION_ARCHIVED';
    end if;
    if old.archived_at is null and new.archived_at is not null then
      if new.archived_by is distinct from app_private.actor_id() or not app_private.can_admin(old.id)
        or new.archive_reason is null then
        raise exception using errcode = 'P0001', message = 'FORBIDDEN';
      end if;
      if exists (select 1 from app.organization_memberships m
          where m.organization_id = old.id and m.state = 'ACTIVE' and m.user_id <> app_private.actor_id())
        or exists (select 1 from app.organization_invitations i where i.organization_id = old.id
          and i.accepted_at is null and i.revoked_at is null and i.expires_at > statement_timestamp())
        or exists (select 1 from app.invitation_deliveries d where d.organization_id = old.id
          and d.state in ('QUEUED','RUNNING','UNCERTAIN')) then
        raise exception using errcode = 'P0001', message = 'DEPENDENCIES_ACTIVE';
      end if;
      new.archived_at := statement_timestamp();
    end if;
    new.revision := old.revision + 1;
    new.updated_at := statement_timestamp();
  end if;
  return new;
end $$;
create trigger guard_organization_change before update on app.organizations
  for each row execute function app_private.guard_organization_change();

create function app_private.guard_invitation_change() returns trigger
language plpgsql security definer set search_path = pg_catalog
as $$
declare archived timestamptz;
begin
  if TG_OP = 'UPDATE' and (new.id <> old.id or new.organization_id <> old.organization_id
    or new.email_normalized <> old.email_normalized or new.invited_by <> old.invited_by or new.role <> old.role) then
    raise exception using errcode = '23514', message = 'IMMUTABLE_SCOPE';
  end if;
  select archived_at into archived from app.organizations where id = new.organization_id for update;
  if session_user = 'alunza_app' then
    if archived is not null then raise exception using errcode = 'P0001', message = 'ORGANIZATION_ARCHIVED'; end if;
    if TG_OP = 'UPDATE' then
      if old.accepted_at is not null and (new.accepted_at is distinct from old.accepted_at
        or new.accepted_by is distinct from old.accepted_by or new.token_digest is distinct from old.token_digest
        or new.generation <> old.generation or new.expires_at <> old.expires_at or new.revoked_at is not null) then
        raise exception using errcode = 'P0001', message = 'INVITATION_ALREADY_ACCEPTED';
      end if;
      if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
        raise exception using errcode = 'P0001', message = 'INVITATION_REVOKED';
      end if;
      if old.accepted_at is null and new.accepted_at is not null then
        if new.accepted_by is distinct from app_private.actor_id() or not app_private.invitation_matches() then
          raise exception using errcode = 'P0001', message = 'INVITATION_INVALID';
        end if;
        new.accepted_at := statement_timestamp();
      end if;
      if new.token_digest is distinct from old.token_digest and new.generation <> old.generation + 1 then
        raise exception using errcode = '23514', message = 'INVALID_GENERATION';
      end if;
      new.revision := old.revision + 1;
    end if;
    new.updated_at := statement_timestamp();
  end if;
  return new;
end $$;
create trigger guard_invitation_change before insert or update on app.organization_invitations
  for each row execute function app_private.guard_invitation_change();

create function app_private.guard_delivery_change() returns trigger
language plpgsql security definer set search_path = pg_catalog
as $$
declare archived timestamptz;
begin
  if TG_OP = 'UPDATE' and (new.id <> old.id or new.organization_id <> old.organization_id
    or new.invitation_id <> old.invitation_id or new.requested_by <> old.requested_by) then
    raise exception using errcode = '23514', message = 'IMMUTABLE_SCOPE';
  end if;
  if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and new.state in ('QUEUED','RUNNING','UNCERTAIN')) then
    select archived_at into archived from app.organizations where id = new.organization_id for update;
    if session_user = 'alunza_app' and archived is not null then
      raise exception using errcode = 'P0001', message = 'ORGANIZATION_ARCHIVED';
    end if;
  end if;
  if TG_OP = 'INSERT' then
    -- Transaction start timestamps can run in the opposite order of the lock.
    -- Assign a strict server order after the organization lock for authorizations.
    select greatest(clock_timestamp(), coalesce(max(d.created_at) + interval '1 microsecond', clock_timestamp()))
      into new.created_at from app.invitation_deliveries d
      where d.organization_id = new.organization_id and d.invitation_id = new.invitation_id;
  end if;
  return new;
end $$;
create trigger guard_delivery_change before insert or update on app.invitation_deliveries
  for each row execute function app_private.guard_delivery_change();

create function app_private.assert_provisioning_complete() returns trigger
language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if session_user = 'alunza_app' and not exists (
    select 1 from app.provisioning_grants g
      join app.organization_memberships m on m.organization_id = g.consumed_organization_id
        and m.user_id = g.user_id
      where g.consumed_organization_id = new.id and g.consumed_at is not null
        and g.user_id = app_private.actor_id() and m.role = 'ADMIN' and m.state = 'ACTIVE') then
    raise exception using errcode = 'P0001', message = 'PROVISIONING_INCOMPLETE';
  end if;
  return null;
end $$;
create constraint trigger provisioning_complete after insert on app.organizations
  deferrable initially deferred for each row execute function app_private.assert_provisioning_complete();

create function app_private.audit_append_only() returns trigger
language plpgsql set search_path = pg_catalog
as $$ begin raise exception using errcode = '42501', message = 'AUDIT_APPEND_ONLY'; end $$;
create trigger audit_append_only before update or delete on app.audit_events
  for each row execute function app_private.audit_append_only();

grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
alter function app_private.guard_membership_change() owner to alunza_identity;
alter function app_private.guard_organization_change() owner to alunza_identity;
alter function app_private.guard_invitation_change() owner to alunza_identity;
alter function app_private.guard_delivery_change() owner to alunza_identity;
alter function app_private.assert_provisioning_complete() owner to alunza_identity;
alter function app_private.audit_append_only() owner to alunza_identity;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
revoke all on all functions in schema app_private from public, anon, authenticated, service_role;
grant execute on all functions in schema app_private to alunza_identity;
