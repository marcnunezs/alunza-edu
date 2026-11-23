-- Configurable local OCI runtimes and durable single-use prepared pairs.
-- Additive: legacy 3-field Docker contexts and all Vercel contracts remain valid.
-- No code, tests, credentials or student payloads are kept in this ledger.
-- Existing security-definer functions belong to alunza_identity. Membership
-- is temporary for the migration and is revoked again at the end.
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;

create function app_private.valid_docker_execution_context(ctx jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare n integer;
begin
 if ctx is null or jsonb_typeof(ctx)<>'object' then return false; end if;
 select count(*) into n from jsonb_object_keys(ctx);
 if not(ctx ?& array['provider','image','runnerVersion']) or n not in (3,8)
  or exists(select 1 from jsonb_each(ctx) e where jsonb_typeof(e.value)<>'string')
  or ctx->>'provider'<>'docker' or ctx->>'image' !~ '^sha256:[a-f0-9]{64}$'
  or length(ctx->>'runnerVersion') not between 1 and 100 then return false; end if;
 if n=3 then return true; end if;
 return ctx ?& array['engineId','runtimeName','runtimeVersion','runtimeSha256','strategy']
  and ctx->>'engineId' ~ '^[a-zA-Z0-9][a-zA-Z0-9:_.-]{0,199}$'
  and ctx->>'runtimeName' ~ '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$'
  and ctx->>'runtimeVersion' ~ '^[0-9]+\.[0-9]+(\.[0-9]+)?$'
  and ctx->>'runtimeSha256' ~ '^[a-f0-9]{64}$'
  and ctx->>'strategy' in ('cold','prepared-pair-v1');
end $$;

create table app_private.docker_prepared_pairs (
 id uuid primary key default gen_random_uuid(),
 engine_id text not null,
 context jsonb not null check(app_private.valid_docker_execution_context(context) and context->>'strategy'='prepared-pair-v1'),
 creator_token uuid not null,
 owner_token uuid not null,
 lease_until timestamptz not null,
 expires_at timestamptz not null,
 state text not null default 'PREPARING' check(state in ('PREPARING','READY','ASSIGNED','RETIRED')),
 recovery_only boolean not null default false,
 execution_id uuid unique,
 execution_lease_token uuid,
 run_id uuid unique,
 submission_id uuid unique,
 organization_id uuid,
 class_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 ready_at timestamptz,
 assigned_at timestamptz,
 released_at timestamptz,
 check(engine_id=context->>'engineId'),
 check((execution_id is null and num_nonnulls(execution_lease_token,run_id,submission_id,organization_id,class_id,assigned_at)=0)
  or (execution_id is not null and execution_lease_token is not null and organization_id is not null and class_id is not null and assigned_at is not null
   and num_nonnulls(run_id,submission_id)=1 and (run_id=execution_id or submission_id=execution_id))),
 check((state in ('PREPARING','READY') and execution_id is null) or (state='ASSIGNED' and execution_id is not null) or state='RETIRED'),
 check((state='RETIRED')=(released_at is not null)),
 foreign key(organization_id,run_id) references app.executions(organization_id,id),
 foreign key(organization_id,submission_id) references app_private.submission_reservations(organization_id,id),
 foreign key(organization_id,class_id) references app.classes(organization_id,id)
);
-- One pair is either the reserve or the active pair, never a second reserve
-- being prepared while the preceding HTTP operation is still closing.
create unique index docker_prepared_one_engine on app_private.docker_prepared_pairs(engine_id) where state<>'RETIRED';
create index docker_prepared_recovery on app_private.docker_prepared_pairs(engine_id,lease_until) where state<>'RETIRED';
create table app_private.docker_prepared_resources (
 id uuid primary key default gen_random_uuid(),
 pair_id uuid not null references app_private.docker_prepared_pairs(id),
 ordinal integer not null check(ordinal in (0,1)),
 container_name text not null unique,
 container_id text unique check(container_id ~ '^[a-f0-9]{64}$'),
 creation_state text not null default 'PREPARED' check(creation_state in ('PREPARED','UNKNOWN','CONFIRMED')),
 cleanup_state text not null default 'PENDING' check(cleanup_state in ('PENDING','VERIFIED')),
 dispatched_at timestamptz,
 confirmed_at timestamptz,
 cleanup_proof jsonb,
 cleaned_at timestamptz,
 unique(pair_id,ordinal),
 check(container_name='alunza-laboratorio-runner-'||id::text),
 check((creation_state='PREPARED' and dispatched_at is null and confirmed_at is null and container_id is null)
  or (creation_state='UNKNOWN' and dispatched_at is not null and confirmed_at is null and container_id is null)
  or (creation_state='CONFIRMED' and dispatched_at is not null and confirmed_at is not null and container_id is not null)),
 check((cleanup_state='PENDING' and cleanup_proof is null and cleaned_at is null)
  or (cleanup_state='VERIFIED' and creation_state<>'UNKNOWN' and cleanup_proof is not null and cleaned_at is not null))
);
alter table app_private.docker_prepared_pairs enable row level security;
alter table app_private.docker_prepared_pairs force row level security;
alter table app_private.docker_prepared_resources enable row level security;
alter table app_private.docker_prepared_resources force row level security;
revoke all on app_private.docker_prepared_pairs,app_private.docker_prepared_resources from public,anon,authenticated,service_role,alunza_app;
grant select,insert,update on app_private.docker_prepared_pairs,app_private.docker_prepared_resources to alunza_identity;
create policy docker_prepared_pairs_internal on app_private.docker_prepared_pairs for all to alunza_identity using(true) with check(true);
create policy docker_prepared_resources_internal on app_private.docker_prepared_resources for all to alunza_identity using(true) with check(true);

create function app_private.docker_pair_payload(p app_private.docker_prepared_pairs) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('pairId',p.id,'context',p.context,'creatorToken',p.creator_token,'ownerToken',p.owner_token,
  'leaseExpiresAt',p.lease_until,'expiresAt',p.expires_at,'state',p.state,'recoveryOnly',p.recovery_only,'executionId',p.execution_id,
  'slots',coalesce((select jsonb_agg(jsonb_build_object('resourceId',r.id,'name',r.container_name,'containerId',r.container_id,
   'creationState',r.creation_state,'cleanupState',r.cleanup_state) order by r.ordinal)
   from app_private.docker_prepared_resources r where r.pair_id=p.id),'[]'::jsonb))
$$;

create function app_private.guard_docker_pair() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$ begin
 if row(new.id,new.engine_id,new.context,new.creator_token,new.created_at,new.expires_at)
  is distinct from row(old.id,old.engine_id,old.context,old.creator_token,old.created_at,old.expires_at)
  or (old.execution_id is not null and row(new.execution_id,new.execution_lease_token,new.run_id,new.submission_id,new.organization_id,new.class_id,new.assigned_at)
   is distinct from row(old.execution_id,old.execution_lease_token,old.run_id,old.submission_id,old.organization_id,old.class_id,old.assigned_at))
  or (old.recovery_only and not new.recovery_only)
  or (old.ready_at is not null and new.ready_at is distinct from old.ready_at)
  or (old.state='RETIRED' and new is distinct from old)
  or (new.state<>old.state and not((old.state='PREPARING' and new.state in ('READY','RETIRED'))
   or (old.state='READY' and new.state in ('ASSIGNED','RETIRED')) or (old.state='ASSIGNED' and new.state='RETIRED'))) then
  raise exception using errcode='23514',message='IMMUTABLE_DOCKER_PAIR';
 end if;
 if new.state='RETIRED' and exists(select 1 from app_private.docker_prepared_resources where pair_id=new.id and cleanup_state<>'VERIFIED') then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS';
 end if;
 return new;
end $$;
create trigger docker_pair_immutable before update on app_private.docker_prepared_pairs for each row execute function app_private.guard_docker_pair();

create function app_private.guard_docker_resource() returns trigger
language plpgsql set search_path=pg_catalog as $$ begin
 if row(new.id,new.pair_id,new.ordinal,new.container_name) is distinct from row(old.id,old.pair_id,old.ordinal,old.container_name)
  or (old.dispatched_at is not null and new.dispatched_at is distinct from old.dispatched_at)
  or (old.confirmed_at is not null and row(new.confirmed_at,new.container_id) is distinct from row(old.confirmed_at,old.container_id))
  or (old.cleanup_state='VERIFIED' and new is distinct from old)
  or (new.creation_state<>old.creation_state and not((old.creation_state='PREPARED' and new.creation_state='UNKNOWN')
   or (old.creation_state='UNKNOWN' and new.creation_state='CONFIRMED'))) then
  raise exception using errcode='23514',message='IMMUTABLE_DOCKER_RESOURCE';
 end if;
 return new;
end $$;
create trigger docker_resource_immutable before update on app_private.docker_prepared_resources for each row execute function app_private.guard_docker_resource();

create function app_private.docker_assert_execution(execution uuid,token uuid,ctx jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare live boolean; saved jsonb;
begin
 perform app_private.sandbox_internal_only();
 select lifecycle_status='RUNNING' and lease_token=token and lease_until>clock_timestamp(),execution_context into live,saved
  from app.executions where id=execution;
 if not found then
  select lifecycle_status='RUNNING' and lease_token=token and lease_until>clock_timestamp(),execution_context into live,saved
   from app_private.submission_reservations where id=execution;
 end if;
 if live is distinct from true or saved is distinct from ctx or not app_private.valid_docker_execution_context(ctx)
  or not(ctx ? 'engineId') then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
end $$;

create function app_private.docker_reserve_pair(ctx jsonb,owner uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p app_private.docker_prepared_pairs%rowtype; slot uuid; stamp timestamptz:=clock_timestamp();
begin
 perform app_private.sandbox_internal_only();
 if owner is null or not app_private.valid_docker_execution_context(ctx) or ctx->>'strategy' is distinct from 'prepared-pair-v1' then
  raise exception using errcode='23514',message='INVALID_EXECUTION_CONTEXT'; end if;
 perform pg_advisory_xact_lock(hashtextextended(ctx->>'engineId',918301));
 if exists(select 1 from app_private.docker_prepared_pairs where engine_id=ctx->>'engineId' and state<>'RETIRED') then return null; end if;
 -- Queued prepared admissions do not block creation: doing so would deadlock
 -- the very request waiting for the initial pair. Configured cold work does.
 if exists(select 1 from app.executions where lifecycle_status='RUNNING' and lease_until>stamp and execution_context->>'engineId'=ctx->>'engineId' and execution_context->>'strategy'='cold')
  or exists(select 1 from app_private.submission_reservations where lifecycle_status='RUNNING' and lease_until>stamp and execution_context->>'engineId'=ctx->>'engineId' and execution_context->>'strategy'='cold') then return null; end if;
 insert into app_private.docker_prepared_pairs(engine_id,context,creator_token,owner_token,lease_until,expires_at)
  values(ctx->>'engineId',ctx,owner,owner,stamp+interval '60 seconds',stamp+interval '60 seconds') returning * into p;
 for position in 0..1 loop
  slot:=gen_random_uuid();
  insert into app_private.docker_prepared_resources(id,pair_id,ordinal,container_name)
   values(slot,p.id,position,'alunza-laboratorio-runner-'||slot::text);
 end loop;
 return app_private.docker_pair_payload(p);
end $$;

create function app_private.docker_authorize_create(pair uuid,resource uuid,owner uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare p app_private.docker_prepared_pairs%rowtype; r app_private.docker_prepared_resources%rowtype;
begin
 perform app_private.sandbox_internal_only();
 select * into p from app_private.docker_prepared_pairs where id=pair for update;
 if p.id is null or p.owner_token is distinct from owner or p.recovery_only or p.state<>'PREPARING'
  or p.lease_until<=clock_timestamp() or p.expires_at<=clock_timestamp()+interval '40 seconds' then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 select * into r from app_private.docker_prepared_resources where id=resource and pair_id=pair for update;
 if r.id is null or r.creation_state<>'PREPARED' or r.cleanup_state<>'PENDING' then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 update app_private.docker_prepared_resources set creation_state='UNKNOWN',dispatched_at=clock_timestamp() where id=resource;
end $$;

create function app_private.docker_confirm_created(pair uuid,resource uuid,cid text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare r app_private.docker_prepared_resources%rowtype;
begin
 perform app_private.sandbox_internal_only();
 if cid is null or cid !~ '^[a-f0-9]{64}$' then raise exception using errcode='23514',message='INVALID_DOCKER_IDENTITY'; end if;
 perform 1 from app_private.docker_prepared_pairs where id=pair for update;
 select * into r from app_private.docker_prepared_resources where id=resource and pair_id=pair for update;
 if r.id is null or r.creation_state='PREPARED' or (r.container_id is not null and r.container_id<>cid) then
  raise exception using errcode='23514',message='IMMUTABLE_DOCKER_RESOURCE'; end if;
 if r.creation_state='CONFIRMED' then return; end if;
 -- May be a late observation. It never changes owner/lease or execution rights.
 update app_private.docker_prepared_resources set creation_state='CONFIRMED',container_id=cid,confirmed_at=clock_timestamp() where id=resource;
end $$;

create function app_private.docker_mark_pair_ready(pair uuid,owner uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare p app_private.docker_prepared_pairs%rowtype;
begin
 perform app_private.sandbox_internal_only();
 select * into p from app_private.docker_prepared_pairs where id=pair for update;
 if p.id is null or p.owner_token is distinct from owner or p.recovery_only or p.state not in ('PREPARING','READY')
  or p.lease_until<=clock_timestamp() or p.expires_at<=clock_timestamp()+interval '40 seconds'
  or (select count(*) from app_private.docker_prepared_resources where pair_id=pair and creation_state='CONFIRMED' and cleanup_state='PENDING')<>2 then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 if p.state='READY' then return; end if;
 update app_private.docker_prepared_pairs set state='READY',ready_at=clock_timestamp() where id=pair;
end $$;

create function app_private.docker_assign_pair(pair uuid,owner uuid,execution uuid,token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p app_private.docker_prepared_pairs%rowtype; org uuid; cls uuid; purpose text; until_at timestamptz; ctx jsonb; live boolean;
begin
 perform app_private.sandbox_internal_only();
 -- Reservation before pair is the shared lock order with finalization triggers.
 select organization_id,class_id,lease_until,execution_context,lifecycle_status='RUNNING' and lease_token=token into org,cls,until_at,ctx,live
  from app.executions where id=execution for update;
 purpose:='RUN';
 if not found then
  select organization_id,class_id,lease_until,execution_context,lifecycle_status='RUNNING' and lease_token=token into org,cls,until_at,ctx,live
   from app_private.submission_reservations where id=execution for update;
  purpose:='SUBMIT';
 end if;
 select * into p from app_private.docker_prepared_pairs where id=pair for update;
 if live is distinct from true or until_at<=clock_timestamp() or p.id is null or p.context is distinct from ctx
  or p.owner_token is distinct from owner or p.recovery_only or p.lease_until<=clock_timestamp()
  or (p.execution_id is not null and (p.execution_id<>execution or p.execution_lease_token<>token)) then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 if p.state='ASSIGNED' then return app_private.docker_pair_payload(p); end if;
 if p.state<>'READY' or p.expires_at<=clock_timestamp()+interval '40 seconds'
  or exists(select 1 from app_private.docker_prepared_resources where pair_id=pair and (creation_state<>'CONFIRMED' or cleanup_state<>'PENDING')) then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 update app_private.docker_prepared_pairs set state='ASSIGNED',execution_id=execution,execution_lease_token=token,
  run_id=case when purpose='RUN' then execution end,submission_id=case when purpose='SUBMIT' then execution end,
  organization_id=org,class_id=cls,assigned_at=clock_timestamp(),lease_until=least(until_at,expires_at)
  where id=pair returning * into p;
 return app_private.docker_pair_payload(p);
end $$;

create function app_private.docker_assert_assignment(pair uuid,resource uuid,owner uuid,execution uuid,token uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare p app_private.docker_prepared_pairs%rowtype;
begin
 perform app_private.sandbox_internal_only();
 select * into p from app_private.docker_prepared_pairs where id=pair;
 if p.id is null or p.owner_token is distinct from owner or p.recovery_only or p.state<>'ASSIGNED'
  or p.execution_id is distinct from execution or p.execution_lease_token is distinct from token
  or p.lease_until<=clock_timestamp() or p.expires_at<=clock_timestamp()
  or not exists(select 1 from app_private.docker_prepared_resources where id=resource and pair_id=pair and creation_state='CONFIRMED' and cleanup_state='PENDING') then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 perform app_private.docker_assert_execution(execution,token,p.context);
end $$;

create function app_private.docker_mark_clean(pair uuid,resource uuid,evidence jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare p app_private.docker_prepared_pairs%rowtype; r app_private.docker_prepared_resources%rowtype; n integer;
begin
 perform app_private.sandbox_internal_only();
 select * into p from app_private.docker_prepared_pairs where id=pair for update;
 select * into r from app_private.docker_prepared_resources where id=resource and pair_id=pair for update;
 if r.id is null or evidence is null or jsonb_typeof(evidence)<>'object' then
  raise exception using errcode='23514',message='INVALID_DOCKER_CLEANUP'; end if;
 select count(*) into n from jsonb_object_keys(evidence);
 if not((r.creation_state='PREPARED' and evidence=jsonb_build_object('kind','NOT_DISPATCHED'))
  or (r.creation_state='CONFIRMED' and n=2 and evidence=jsonb_build_object('kind','ABSENT','containerId',r.container_id))) then
  raise exception using errcode='23514',message='INVALID_DOCKER_CLEANUP'; end if;
 if r.cleanup_state='VERIFIED' then
  if r.cleanup_proof is distinct from evidence then raise exception using errcode='23514',message='IMMUTABLE_DOCKER_RESOURCE'; end if;
  return;
 end if;
 update app_private.docker_prepared_resources set cleanup_state='VERIFIED',cleanup_proof=evidence,cleaned_at=clock_timestamp() where id=resource;
 -- Assigned pairs remain occupied through commit, final authorization and HTTP close.
 if p.execution_id is null and not exists(select 1 from app_private.docker_prepared_resources where pair_id=pair and cleanup_state<>'VERIFIED') then
  update app_private.docker_prepared_pairs set state='RETIRED',released_at=clock_timestamp() where id=pair;
 end if;
end $$;

create function app_private.docker_release_pair(pair uuid,owner uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare p app_private.docker_prepared_pairs%rowtype; done boolean; until_at timestamptz; current_token uuid;
begin
 perform app_private.sandbox_internal_only();
 select * into p from app_private.docker_prepared_pairs where id=pair for update;
 if p.id is null or p.owner_token is distinct from owner then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 if p.state='RETIRED' then return; end if;
 if exists(select 1 from app_private.docker_prepared_resources where pair_id=pair and cleanup_state<>'VERIFIED') then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 if p.execution_id is not null then
  select lifecycle_status='COMPLETED',lease_until,lease_token into done,until_at,current_token from app.executions where id=p.execution_id;
  if not found then select lifecycle_status='COMPLETED',lease_until,lease_token into done,until_at,current_token from app_private.submission_reservations where id=p.execution_id; end if;
  if done is distinct from true and not(p.recovery_only and (until_at<=clock_timestamp() or current_token is distinct from p.execution_lease_token)) then
   raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 end if;
 update app_private.docker_prepared_pairs set state='RETIRED',released_at=clock_timestamp() where id=pair;
end $$;

create function app_private.docker_list_execution_pairs(execution uuid,ctx jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform app_private.sandbox_internal_only();
 if not app_private.valid_docker_execution_context(ctx) then raise exception using errcode='23514',message='INVALID_EXECUTION_CONTEXT'; end if;
 if exists(select 1 from app_private.docker_prepared_pairs where execution_id=execution and context is distinct from ctx) then
  raise exception using errcode='23514',message='INVALID_EXECUTION_CONTEXT'; end if;
 return coalesce((select jsonb_agg(app_private.docker_pair_payload(p) order by created_at) from app_private.docker_prepared_pairs p where execution_id=execution and context=ctx),'[]'::jsonb);
end $$;

create function app_private.docker_claim_recovery(ctx jsonb,owner uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p app_private.docker_prepared_pairs%rowtype; result jsonb:='[]'::jsonb;
begin
 perform app_private.sandbox_internal_only();
 if owner is null or not app_private.valid_docker_execution_context(ctx) or not(ctx ? 'engineId') then
  raise exception using errcode='23514',message='INVALID_EXECUTION_CONTEXT'; end if;
 for p in select * from app_private.docker_prepared_pairs where engine_id=ctx->>'engineId' and state<>'RETIRED'
  and lease_until<=clock_timestamp() order by lease_until limit 16 for update skip locked loop
  update app_private.docker_prepared_pairs set owner_token=owner,recovery_only=true,lease_until=clock_timestamp()+interval '30 seconds' where id=p.id returning * into p;
  result:=result||jsonb_build_array(app_private.docker_pair_payload(p));
 end loop;
 return result;
end $$;

-- A caller-provided boolean cannot complete a reservation while assigned
-- prepared resources lack durable cleanup evidence. No-pair admissions may
-- finish UNKNOWN after recovery without having dispatched any student code.
create or replace function app_private.guard_sandbox_execution_context() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$ begin
 if old.execution_context is not null and new.execution_context is distinct from old.execution_context then
  raise exception using errcode='23514',message='IMMUTABLE_EXECUTION_CONTEXT'; end if;
 if new.lifecycle_status='COMPLETED' and old.lifecycle_status<>'COMPLETED' then
  if new.execution_context->>'provider'='vercel' and not exists(select 1 from app_private.sandbox_resources where execution_id=new.id and cleanup_state='VERIFIED' and context=new.execution_context) then
   raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
  if new.execution_context->>'provider'='docker' and new.execution_context->>'strategy'='prepared-pair-v1'
   and exists(select 1 from app_private.docker_prepared_pairs p join app_private.docker_prepared_resources r on r.pair_id=p.id
    where p.execution_id=new.id and (p.context is distinct from new.execution_context or r.cleanup_state<>'VERIFIED')) then
   raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 end if;
 return new;
end $$;

create or replace function app_private.prepare_sandbox_execution(execution uuid, token uuid, purpose text, ctx jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare org uuid; cls uuid; version text; old_ctx jsonb; c app_private.sandbox_campaigns%rowtype;
begin
 if ctx is null then return; end if;
 if purpose='RUN' then
  select organization_id,class_id,runner_version,execution_context into org,cls,version,old_ctx
   from app.executions where id=execution and lease_token=token and lifecycle_status='RUNNING' for update;
 elsif purpose='SUBMIT' then
  select organization_id,class_id,runner_version,execution_context into org,cls,version,old_ctx
   from app_private.submission_reservations where id=execution and lease_token=token and lifecycle_status='RUNNING' for update;
 end if;
 if org is null or old_ctx is not null or jsonb_typeof(ctx) is distinct from 'object'
  or ctx->>'runnerVersion' is distinct from version or length(ctx->>'image') not between 1 and 500 then
  raise exception using errcode='23514',message='INVALID_EXECUTION_CONTEXT';
 end if;
 if ctx->>'provider'='docker' then
  if not app_private.valid_docker_execution_context(ctx) then
   raise exception using errcode='23514',message='INVALID_EXECUTION_CONTEXT';
  end if;
 elsif ctx->>'provider'='vercel' then
  if not(ctx ?& array['provider','image','runnerVersion','teamId','projectId','region','campaignId','expiresAt','maxCreations','maxRequests'])
   or (select count(*) from jsonb_object_keys(ctx))<>10
   or exists(select 1 from jsonb_each(ctx) e where jsonb_typeof(e.value)<>case when e.key in ('maxCreations','maxRequests') then 'number' else 'string' end)
   or ctx->>'image' !~ '^.+@sha256:[a-f0-9]{64}$' or ctx->>'teamId' !~ '^team_[A-Za-z0-9]+$'
   or ctx->>'projectId' !~ '^prj_[A-Za-z0-9]+$' or ctx->>'region' !~ '^[a-z][a-z0-9-]{1,40}$'
   or (ctx->>'maxCreations')::numeric<>trunc((ctx->>'maxCreations')::numeric)
   or (ctx->>'maxRequests')::numeric<>trunc((ctx->>'maxRequests')::numeric) then
   raise exception using errcode='23514',message='INVALID_EXECUTION_CONTEXT';
  end if;
  if (ctx->>'expiresAt')::timestamptz<=clock_timestamp() then
   raise exception using errcode='P0001',message='DEPENDENCY_UNAVAILABLE';
  end if;
  insert into app_private.sandbox_campaigns(id,context,expires_at,max_creations,max_requests)
   values((ctx->>'campaignId')::uuid,ctx,(ctx->>'expiresAt')::timestamptz,(ctx->>'maxCreations')::integer,(ctx->>'maxRequests')::integer)
   on conflict(id) do nothing;
  select * into c from app_private.sandbox_campaigns where id=(ctx->>'campaignId')::uuid for update;
  if c.context is distinct from ctx then raise exception using errcode='23514',message='IMMUTABLE_SANDBOX_CAMPAIGN'; end if;
  if c.creations>=c.max_creations or c.normal_requests>=c.max_requests-8*c.max_creations or c.total_requests>=c.max_requests then
   raise exception using errcode='P0001',message='DEPENDENCY_UNAVAILABLE';
  end if;
 else raise exception using errcode='23514',message='INVALID_EXECUTION_CONTEXT';
 end if;
 if purpose='RUN' then update app.executions set execution_context=ctx where id=execution;
 else update app_private.submission_reservations set execution_context=ctx where id=execution; end if;
 if ctx->>'provider'='vercel' then
  insert into app_private.sandbox_resources(execution_id,run_id,submission_id,organization_id,class_id,campaign_id,sandbox_name,context)
   values(execution,case when purpose='RUN' then execution end,case when purpose='SUBMIT' then execution end,org,cls,c.id,'alunza-practice-'||execution::text,ctx);
 end if;
end $$;

-- Internal execution role only. Browser and actor-context calls cannot observe
-- or mutate the resource ledger. Helpers are not independently callable by API.
create function app_private.docker_recovery_contexts(engine text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform app_private.sandbox_internal_only();
 if engine is null or engine !~ '^[a-zA-Z0-9][a-zA-Z0-9:_.-]{0,199}$' then
  raise exception using errcode='23514',message='INVALID_EXECUTION_CONTEXT'; end if;
 return coalesce((select jsonb_agg(context order by context) from
  (select distinct context from app_private.docker_prepared_pairs where engine_id=engine and state<>'RETIRED') pending),'[]'::jsonb);
end $$;

do $$ declare fn regprocedure; name text; begin
 for fn,name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='app_private' and p.proname in (
   'valid_docker_execution_context','docker_pair_payload','guard_docker_pair','guard_docker_resource',
   'docker_assert_execution','docker_reserve_pair','docker_authorize_create','docker_confirm_created',
   'docker_mark_pair_ready','docker_assign_pair','docker_assert_assignment','docker_mark_clean',
   'docker_release_pair','docker_list_execution_pairs','docker_claim_recovery','docker_recovery_contexts',
   'prepare_sandbox_execution','guard_sandbox_execution_context') loop
  execute format('alter function %s owner to alunza_identity',fn);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',fn);
  if name not in ('valid_docker_execution_context','docker_pair_payload','guard_docker_pair','guard_docker_resource',
    'prepare_sandbox_execution','guard_sandbox_execution_context') then
   execute format('grant execute on function %s to alunza_app',fn);
  end if;
 end loop;
end $$;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;

