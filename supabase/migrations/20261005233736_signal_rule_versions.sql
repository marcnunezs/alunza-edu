-- IMP-05.03: immutable rule definitions; no evaluators, episodes or UI.
-- Dictionary: docs/work/IMP-05-signal-rules-dictionary.md.
create extension if not exists btree_gist with schema extensions;
create function app_private.signal_rule_parameters_valid(kind text, parameters jsonb)
returns boolean language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare field text; value numeric; names text[];
begin
 if jsonb_typeof(parameters) is distinct from 'object' then return false; end if;
 names:=case kind when 'INACTIVITY' then array['inactivityDays']
  when 'REPEATED_ERROR' then array['repeatedErrorAttempts','repeatedErrorWindowDays']
  when 'STAGNATION' then array['stagnationAttempts'] else null end;
 if names is null or (parameters - names) <> '{}'::jsonb then return false; end if;
 foreach field in array names loop
  if jsonb_typeof(parameters->field) is distinct from 'number' then return false; end if;
  value:=(parameters->>field)::numeric;
  if value <> trunc(value) or value > 2147483647
   or value < (case when field in ('repeatedErrorAttempts','stagnationAttempts') then 2 else 1 end) then return false; end if;
 end loop;
 return true;
end $$;

create table app.signal_rule_versions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references app.organizations(id) on delete restrict,
 type text not null check(type in ('INACTIVITY','REPEATED_ERROR','STAGNATION')),
 version integer not null check(version>0),
 schema_version integer not null check(schema_version=1),
 algorithm_version text not null check(algorithm_version='DEC005_V1'),
 parameters jsonb not null check(app_private.signal_rule_parameters_valid(type,parameters)),
 created_by uuid not null,
 created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
 activated_by uuid,
 valid_from timestamptz,
 valid_to timestamptz,
 unique(organization_id,type,version),
 unique(organization_id,type,id),
 foreign key(organization_id,created_by) references app.organization_memberships(organization_id,user_id) on delete restrict,
 foreign key(organization_id,activated_by) references app.organization_memberships(organization_id,user_id) on delete restrict,
 check((valid_from is null and valid_to is null and activated_by is null)
  or (valid_from is not null and isfinite(valid_from) and activated_by is not null and valid_from>=created_at
   and (valid_to is null or (isfinite(valid_to) and valid_to>valid_from))))
);
create unique index signal_rule_one_open_version on app.signal_rule_versions(organization_id,type)
 where valid_from is not null and valid_to is null;
-- A real exclusion constraint also protects finite historical ranges against
-- concurrent writes outside the runtime's serialized activation boundary.
do $$ declare extension_schema name; begin
 select n.nspname into extension_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='btree_gist';
 execute format('alter table app.signal_rule_versions add constraint signal_rule_validity_exclusive exclude using gist
  (organization_id %I.gist_uuid_ops with =, type %I.gist_text_ops with =, tstzrange(valid_from,valid_to,''[)'') with &&)
  where (valid_from is not null)',extension_schema,extension_schema);
end $$;
create index signal_rule_version_page on app.signal_rule_versions(organization_id,created_at,id);

create table app_private.signal_rule_scopes (
 organization_id uuid not null references app.organizations(id) on delete restrict,
 type text not null check(type in ('INACTIVITY','REPEATED_ERROR','STAGNATION')),
 next_version bigint not null default 1 check(next_version between 1 and 2147483648),
 current_version_id uuid,
 primary key(organization_id,type),
 foreign key(organization_id,type,current_version_id) references app.signal_rule_versions(organization_id,type,id) on delete restrict
);
create table app_private.signal_rule_operations (
 organization_id uuid not null,
 actor_id uuid not null,
 operation text not null check(operation in ('CREATE','ACTIVATE')),
 key text not null check(key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
 request_payload jsonb not null check(jsonb_typeof(request_payload)='object'),
 response_body jsonb,
 created_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,actor_id,operation,key),
 foreign key(organization_id,actor_id) references app.organization_memberships(organization_id,user_id) on delete restrict,
 check(response_body is null or jsonb_typeof(response_body)='object')
);
do $$ declare relation text; begin
 foreach relation in array array['signal_rule_scopes','signal_rule_operations'] loop
  execute format('alter table app_private.%I enable row level security',relation);
  execute format('alter table app_private.%I force row level security',relation);
  execute format('revoke all on app_private.%I from public,anon,authenticated,service_role,alunza_app',relation);
  execute format('grant select,insert,update on app_private.%I to alunza_identity',relation);
  execute format('create policy signal_rule_internal on app_private.%I for all to alunza_identity using(true) with check(true)',relation);
 end loop;
end $$;
alter table app.signal_rule_versions enable row level security;
alter table app.signal_rule_versions force row level security;
revoke all on app.signal_rule_versions from public,anon,authenticated,service_role,alunza_app;
grant select on app.signal_rule_versions to alunza_app;
grant select,insert,update on app.signal_rule_versions to alunza_identity;
create policy signal_rules_read_admin on app.signal_rule_versions for select to alunza_app
 using(app_private.can_admin(organization_id,true)
  and app_private.session_is_active(app_private.actor_id(),nullif(current_setting('app.session_id',true),'')::uuid));
create policy signal_rules_internal on app.signal_rule_versions for all to alunza_identity using(true) with check(true);

-- Only this private write boundary can extend a definition's lifecycle.
create function app_private.guard_signal_rule_version() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then raise exception using errcode='23514',message='RULE_VERSION_IMMUTABLE'; end if;
 if tg_op='UPDATE' then
  if current_user<>'alunza_identity'
   or row(new.id,new.organization_id,new.type,new.version,new.schema_version,new.algorithm_version,new.parameters,new.created_by,new.created_at)
    is distinct from row(old.id,old.organization_id,old.type,old.version,old.schema_version,old.algorithm_version,old.parameters,old.created_by,old.created_at)
   or not ((old.valid_from is null and new.valid_from is not null and new.valid_to is null and new.activated_by=app_private.actor_id())
    or (old.valid_from is not null and old.valid_to is null and new.valid_to is not null
     and new.valid_from=old.valid_from and new.activated_by=old.activated_by)) then
   raise exception using errcode='23514',message='RULE_VERSION_IMMUTABLE';
  end if;
 end if;
 if new.valid_from is not null and exists(select 1 from app.signal_rule_versions v
  where v.organization_id=new.organization_id and v.type=new.type and v.id<>new.id
   and tstzrange(v.valid_from,v.valid_to,'[)') && tstzrange(new.valid_from,new.valid_to,'[)')
   and v.valid_from is not null) then
  raise exception using errcode='23514',message='RULE_VALIDITY_OVERLAP';
 end if;
 return new;
end $$;
create trigger signal_rule_version_guard before insert or update or delete on app.signal_rule_versions
 for each row execute function app_private.guard_signal_rule_version();
create function app_private.guard_signal_rule_operation() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if tg_op<>'UPDATE' or old.response_body is not null or new.response_body is null
  or (to_jsonb(old)-'response_body') is distinct from (to_jsonb(new)-'response_body') then
  raise exception using errcode='23514',message='RULE_OPERATION_IMMUTABLE';
 end if;
 return new;
end $$;
create trigger signal_rule_operation_guard before update or delete on app_private.signal_rule_operations
 for each row execute function app_private.guard_signal_rule_operation();

-- No organization-wide exclusive lock: compatible shared locks preserve live
-- authorization while independent rule types/organizations continue concurrently.
grant update(id) on app.profiles to alunza_identity;
create policy signal_rule_lock_profile on app.profiles for update to alunza_identity using(true) with check(true);
create function app_private.authorize_signal_rule_write(org uuid) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare found_org uuid;
begin
 if app_private.can_admin(org,true) is distinct from true
  or not app_private.session_is_active(app_private.actor_id(),nullif(current_setting('app.session_id',true),'')::uuid) then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 select o.id into found_org from app.organizations o where o.id=org and o.archived_at is null for share;
 if found_org is null then raise exception using errcode='P0001',message='ORGANIZATION_ARCHIVED'; end if;
 perform p.id from app.profiles p where p.id=app_private.actor_id() and p.account_state='ACTIVE' for share;
 if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 -- Membership changes already lock this organization in the existing guard.
 -- Taking a membership row lock here would invert direct UPDATE's lock order.
 if app_private.can_admin(org) is distinct from true then
  raise exception using errcode='42501',message='FORBIDDEN'; end if;
end $$;

create function app_private.signal_rule_write_still_authorized(org uuid) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if app_private.can_admin(org) is distinct from true
  or not app_private.session_is_active(app_private.actor_id(),nullif(current_setting('app.session_id',true),'')::uuid) then
  raise exception using errcode='42501',message='FORBIDDEN'; end if;
end $$;

create function app_private.signal_rule_organization(rule uuid) returns uuid
language plpgsql stable security definer set search_path=pg_catalog as $$
declare org uuid;
begin
 select v.organization_id into org from app.signal_rule_versions v
  join app.organization_memberships m on m.organization_id=v.organization_id and m.user_id=app_private.actor_id()
  join app.profiles p on p.id=m.user_id
  where v.id=rule and m.role='ADMIN' and m.state='ACTIVE' and p.account_state='ACTIVE'
   and app_private.session_is_active(p.id,nullif(current_setting('app.session_id',true),'')::uuid)
   and (app_private.organization_id() is null or app_private.organization_id()=v.organization_id);
 if org is null then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 return org;
end $$;
create function app_private.signal_rule_instant(value timestamptz) returns text
language sql stable strict security invoker set search_path=pg_catalog as $$
 select to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
create function app_private.signal_rule_projection(v app.signal_rule_versions) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('id',v.id,'organizationId',v.organization_id,'type',v.type,'version',v.version,
  'schemaVersion',v.schema_version,'algorithmVersion',v.algorithm_version,'parameters',v.parameters,
  'state',case when v.valid_from is null then 'DRAFT' when v.valid_to is null then 'ACTIVE' else 'RETIRED' end,
  'createdBy',v.created_by,'createdAt',app_private.signal_rule_instant(v.created_at),'activatedBy',v.activated_by,
  'validFrom',app_private.signal_rule_instant(v.valid_from),'validTo',app_private.signal_rule_instant(v.valid_to))
$$;
create function app_private.get_rule_version(org uuid,rule uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare response jsonb;
begin
 if app_private.can_admin(org,true) is distinct from true
  or not app_private.session_is_active(app_private.actor_id(),nullif(current_setting('app.session_id',true),'')::uuid) then
  raise exception using errcode='42501',message='FORBIDDEN'; end if;
 select app_private.signal_rule_projection(v) into response from app.signal_rule_versions v where v.id=rule and v.organization_id=org;
 if response is null then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 return response;
end $$;
create function app_private.list_rule_versions(org uuid,kind text,cursor uuid,page_limit integer) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare cursor_created_at timestamptz; response jsonb;
begin
 if app_private.can_admin(org,true) is distinct from true
  or not app_private.session_is_active(app_private.actor_id(),nullif(current_setting('app.session_id',true),'')::uuid) then
  raise exception using errcode='42501',message='FORBIDDEN'; end if;
 if page_limit is null or page_limit not between 1 and 100 or (kind is not null and kind not in ('INACTIVITY','REPEATED_ERROR','STAGNATION')) then
  raise exception using errcode='P0001',message='RULE_PARAMETERS_INVALID'; end if;
 if cursor is not null then
  select v.created_at into cursor_created_at from app.signal_rule_versions v where v.id=cursor and v.organization_id=org and (kind is null or v.type=kind);
  if cursor_created_at is null then raise exception using errcode='P0001',message='RULE_CURSOR_INVALID'; end if;
 end if;
 with candidates as materialized (
  select v.* from app.signal_rule_versions v where v.organization_id=org and (kind is null or v.type=kind)
   and (cursor is null or row(v.created_at,v.id)>row(cursor_created_at,cursor))
  order by v.created_at,v.id limit page_limit+1
 ), selected as (select * from candidates order by created_at,id limit page_limit)
 select jsonb_build_object('data',coalesce((select jsonb_agg(app_private.signal_rule_projection(s::app.signal_rule_versions) order by s.created_at,s.id) from selected s),'[]'::jsonb),
  'page',jsonb_build_object('hasMore',(select count(*)>page_limit from candidates),'nextCursor',
   case when (select count(*)>page_limit from candidates) then (select id from selected order by created_at desc,id desc limit 1) else null end)) into response;
 return response;
end $$;

-- A private operation reservation and its response commit with the actual write.
-- A failed transaction releases the reservation; same-key contenders wait and
-- replay the immutable snapshot, even after that version's lifecycle changes.
create function app_private.reserve_signal_rule_operation(org uuid,operation_name text,operation_key text,input jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare previous app_private.signal_rule_operations;
begin
 if operation_key is null or operation_key !~ '^[A-Za-z0-9_.:-]{8,128}$' then
  raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 insert into app_private.signal_rule_operations(organization_id,actor_id,operation,key,request_payload)
  values(org,app_private.actor_id(),operation_name,operation_key,input) on conflict do nothing;
 select * into previous from app_private.signal_rule_operations k where k.organization_id=org and k.actor_id=app_private.actor_id()
  and k.operation=operation_name and k.key=operation_key for update;
 if previous.request_payload is distinct from input then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
 return previous.response_body;
end $$;
grant insert on app.audit_events to alunza_identity;
create policy signal_rule_audit_internal on app.audit_events for insert to alunza_identity
 with check(action in ('RULE_VERSION_CREATED','RULE_VERSION_ACTIVATED') and entity_type='SIGNAL_RULE_VERSION'
  and actor_id=app_private.actor_id() and app_private.can_admin(organization_id));
create function app_private.audit_signal_rule(org uuid,rule uuid,action_name text,changes jsonb) returns void
language sql security invoker set search_path=pg_catalog as $$
 insert into app.audit_events(organization_id,actor_id,action,entity_type,entity_id,result,correlation_id,safe_changes,request_id,occurred_at)
 values(org,app_private.actor_id(),action_name,'SIGNAL_RULE_VERSION',rule,'SUCCEEDED',
  coalesce(nullif(current_setting('app.request_id',true),'')::uuid,gen_random_uuid()),changes,
  nullif(current_setting('app.request_id',true),'')::uuid,clock_timestamp())
$$;
create function app_private.create_rule_version(org uuid,input jsonb,operation_key text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare kind text; allocated bigint; response jsonb; created app.signal_rule_versions;
begin
 perform app_private.authorize_signal_rule_write(org);
 if jsonb_typeof(input) is distinct from 'object' or input-array['type','schemaVersion','algorithmVersion','parameters']<>'{}'::jsonb
  or input->'schemaVersion' is distinct from '1'::jsonb or input->>'algorithmVersion' is distinct from 'DEC005_V1'
  or app_private.signal_rule_parameters_valid(input->>'type',input->'parameters') is distinct from true then
  raise exception using errcode='P0001',message='RULE_PARAMETERS_INVALID'; end if;
 kind:=input->>'type';
 response:=app_private.reserve_signal_rule_operation(org,'CREATE',operation_key,input);
 perform app_private.signal_rule_write_still_authorized(org);
 if response is not null then return response; end if;
 insert into app_private.signal_rule_scopes(organization_id,type) values(org,kind) on conflict do nothing;
 select next_version into allocated from app_private.signal_rule_scopes s where s.organization_id=org and s.type=kind for update;
 perform app_private.signal_rule_write_still_authorized(org);
 if allocated>2147483647 then raise exception using errcode='P0001',message='RULE_PARAMETERS_INVALID'; end if;
 insert into app.signal_rule_versions(organization_id,type,version,schema_version,algorithm_version,parameters,created_by)
  values(org,kind,allocated::integer,1,'DEC005_V1',input->'parameters',app_private.actor_id()) returning * into created;
 update app_private.signal_rule_scopes set next_version=next_version+1 where organization_id=org and type=kind;
 response:=app_private.signal_rule_projection(created);
 perform app_private.audit_signal_rule(org,created.id,'RULE_VERSION_CREATED',jsonb_build_object('type',kind,'version',created.version,'schemaVersion',1,'algorithmVersion','DEC005_V1','parameters',created.parameters));
 update app_private.signal_rule_operations set response_body=response where organization_id=org and actor_id=app_private.actor_id() and operation='CREATE' and key=operation_key;
 return response;
end $$;
create function app_private.activate_rule_version(org uuid,rule uuid,expected_current uuid,operation_key text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare target app.signal_rule_versions; current_id uuid; previous_from timestamptz; activation_at timestamptz; response jsonb;
begin
 perform app_private.authorize_signal_rule_write(org);
 select * into target from app.signal_rule_versions v where v.id=rule and v.organization_id=org;
 if not found then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 response:=app_private.reserve_signal_rule_operation(org,'ACTIVATE',operation_key,
  jsonb_build_object('ruleVersionId',rule,'expectedCurrentVersionId',expected_current));
 perform app_private.signal_rule_write_still_authorized(org);
 if response is not null then return response; end if;
 select s.current_version_id into current_id from app_private.signal_rule_scopes s where s.organization_id=org and s.type=target.type for update;
 perform app_private.signal_rule_write_still_authorized(org);
 if current_id is distinct from expected_current then raise exception using errcode='P0001',message='RULE_VERSION_CONFLICT'; end if;
 -- Read after the lock: another activation may have changed this lifecycle.
 select * into target from app.signal_rule_versions v where v.id=rule and v.organization_id=org;
 if current_id=rule then
  response:=app_private.signal_rule_projection(target);
 else
  if target.valid_from is not null then raise exception using errcode='P0001',message='RULE_VERSION_ALREADY_ACTIVATED'; end if;
  select v.valid_from into previous_from from app.signal_rule_versions v where v.id=current_id and v.organization_id=org;
  activation_at:=clock_timestamp();
  if (previous_from is not null and activation_at<=previous_from) or activation_at<target.created_at then
   raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
  if current_id is not null then
   update app.signal_rule_versions set valid_to=activation_at where id=current_id and organization_id=org;
  end if;
  update app.signal_rule_versions set valid_from=activation_at,activated_by=app_private.actor_id() where id=rule and organization_id=org returning * into target;
  update app_private.signal_rule_scopes set current_version_id=rule where organization_id=org and type=target.type;
  response:=app_private.signal_rule_projection(target);
  perform app_private.audit_signal_rule(org,rule,'RULE_VERSION_ACTIVATED',jsonb_build_object('type',target.type,'version',target.version,'previousVersionId',current_id,'validFrom',app_private.signal_rule_instant(activation_at)));
 end if;
 update app_private.signal_rule_operations set response_body=response where organization_id=org and actor_id=app_private.actor_id() and operation='ACTIVATE' and key=operation_key;
 return response;
end $$;

-- Definers own only executable code, never tables; helper role cannot log in,
-- inherit, bypass RLS or be assumed by the ordinary application's role.
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
do $$ declare fn regprocedure; begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'
  and p.proname in ('signal_rule_parameters_valid','guard_signal_rule_version','guard_signal_rule_operation','authorize_signal_rule_write',
   'signal_rule_write_still_authorized','signal_rule_instant','signal_rule_organization','signal_rule_projection','get_rule_version','list_rule_versions',
   'reserve_signal_rule_operation','audit_signal_rule','create_rule_version','activate_rule_version') loop
  execute format('alter function %s owner to alunza_identity',fn);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',fn);
  execute format('grant execute on function %s to alunza_identity',fn);
 end loop;
end $$;
grant execute on function app_private.signal_rule_organization(uuid),app_private.get_rule_version(uuid,uuid),
 app_private.list_rule_versions(uuid,text,uuid,integer),app_private.create_rule_version(uuid,jsonb,text),
 app_private.activate_rule_version(uuid,uuid,uuid,text),app_private.signal_rule_parameters_valid(text,jsonb) to alunza_app;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
