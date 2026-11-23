-- Local/test VM broker: one durable dispatch, no replay of student input.
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;

create function app_private.valid_local_vm_context(ctx jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(ctx)='object'
  and ctx ?& array['provider','image','runnerVersion','hostId','kitManifestSha256','brokerVersion','guestSha256','brokerGeneration']
  and (select count(*) from jsonb_object_keys(ctx))=8
  and not exists(select 1 from jsonb_each(ctx) e where jsonb_typeof(e.value)<>'string')
  and ctx->>'provider'='local-vm' and ctx->>'runnerVersion'='imp-03-quickjs.13'
  and ctx->>'brokerVersion'='local-vm-broker-v1'
  and ctx->>'image' ~ '^sha256:[a-f0-9]{64}$'
  and ctx->>'kitManifestSha256' ~ '^[a-f0-9]{64}$' and ctx->>'guestSha256' ~ '^[a-f0-9]{64}$'
  and ctx->>'hostId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  and ctx->>'brokerGeneration' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false)
$$;
create table app_private.local_vm_resources (
 execution_id uuid primary key,
 run_id uuid unique, submission_id uuid unique,
 organization_id uuid not null, class_id uuid not null,
 creation_id uuid not null unique default gen_random_uuid(),
 provider_resource_id uuid unique,
 context jsonb not null check(app_private.valid_local_vm_context(context)),
 creation_state text not null default 'PREPARED' check(creation_state in ('PREPARED','UNKNOWN','CONFIRMED')),
 cleanup_state text not null default 'PENDING' check(cleanup_state in ('PENDING','VERIFIED')),
 input_sha256 text check(input_sha256 ~ '^[a-f0-9]{64}$'),
 prepared_at timestamptz not null default clock_timestamp(), dispatched_at timestamptz, confirmed_at timestamptz,
 normal_deadline_at timestamptz, cleanup_deadline_at timestamptz,
 cleanup_proof jsonb, cleanup_verified_at timestamptz,
 check(num_nonnulls(run_id,submission_id)=1),
 check((run_id=execution_id and submission_id is null) or (submission_id=execution_id and run_id is null)),
 foreign key(organization_id,run_id) references app.executions(organization_id,id),
 foreign key(organization_id,submission_id) references app_private.submission_reservations(organization_id,id),
 foreign key(organization_id,class_id) references app.classes(organization_id,id),
 check((creation_state='PREPARED' and dispatched_at is null and input_sha256 is null and normal_deadline_at is null and cleanup_deadline_at is null and provider_resource_id is null and confirmed_at is null)
  or (creation_state in ('UNKNOWN','CONFIRMED') and dispatched_at is not null and input_sha256 is not null and normal_deadline_at is not null and cleanup_deadline_at=normal_deadline_at+interval '10 seconds'
   and ((creation_state='UNKNOWN' and provider_resource_id is null and confirmed_at is null) or (creation_state='CONFIRMED' and provider_resource_id is not null and confirmed_at is not null)))),
 check((cleanup_state='PENDING' and cleanup_proof is null and cleanup_verified_at is null)
  or (cleanup_state='VERIFIED' and cleanup_proof is not null and cleanup_verified_at is not null))
);
alter table app_private.local_vm_resources enable row level security;
alter table app_private.local_vm_resources force row level security;
revoke all on app_private.local_vm_resources from public,anon,authenticated,service_role,alunza_app;
grant select,insert,update on app_private.local_vm_resources to alunza_identity;
create policy local_vm_internal on app_private.local_vm_resources for all to alunza_identity using(true) with check(true);

create function app_private.guard_local_vm_resource() returns trigger
language plpgsql set search_path=pg_catalog as $$ begin
 if row(new.execution_id,new.run_id,new.submission_id,new.organization_id,new.class_id,new.creation_id,new.context,new.prepared_at)
  is distinct from row(old.execution_id,old.run_id,old.submission_id,old.organization_id,old.class_id,old.creation_id,old.context,old.prepared_at)
  or (old.dispatched_at is not null and row(new.dispatched_at,new.input_sha256,new.normal_deadline_at,new.cleanup_deadline_at) is distinct from row(old.dispatched_at,old.input_sha256,old.normal_deadline_at,old.cleanup_deadline_at))
  or (old.confirmed_at is not null and row(new.confirmed_at,new.provider_resource_id) is distinct from row(old.confirmed_at,old.provider_resource_id))
  or (new.creation_state<>old.creation_state and not((old.creation_state='PREPARED' and new.creation_state='UNKNOWN') or (old.creation_state='UNKNOWN' and new.creation_state='CONFIRMED')))
  or (old.cleanup_state='VERIFIED' and new is distinct from old) then
  raise exception using errcode='23514',message='IMMUTABLE_LOCAL_VM_RESOURCE'; end if;
 return new;
end $$;
create trigger local_vm_resource_immutable before update on app_private.local_vm_resources for each row execute function app_private.guard_local_vm_resource();
create function app_private.local_vm_payload(r app_private.local_vm_resources) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('executionId',r.execution_id,'creationId',r.creation_id,'resourceId',r.provider_resource_id,'context',r.context,
 'creationState',r.creation_state,'cleanupState',r.cleanup_state,'cleanupProof',r.cleanup_proof,'inputSha256',r.input_sha256)
$$;
create function app_private.load_local_vm_resource(execution uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform app_private.sandbox_internal_only();
 return (select app_private.local_vm_payload(r) from app_private.local_vm_resources r where execution_id=execution);
end $$;
create function app_private.assert_local_vm_active(execution uuid,token uuid,ctx jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare live boolean; saved jsonb; begin
 perform app_private.sandbox_internal_only();
 select lifecycle_status='RUNNING' and lease_token=token and lease_until>clock_timestamp(),execution_context into live,saved from app.executions where id=execution;
 if not found then
  select lifecycle_status='RUNNING' and lease_token=token and lease_until>clock_timestamp(),execution_context into live,saved from app_private.submission_reservations where id=execution;
 end if;
 if live is distinct from true or saved is distinct from ctx or not app_private.valid_local_vm_context(ctx)
  or not exists(select 1 from app_private.local_vm_resources where execution_id=execution and context=ctx and cleanup_state='PENDING' and (normal_deadline_at is null or normal_deadline_at>clock_timestamp())) then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
end $$;
create function app_private.begin_local_vm_creation(execution uuid,token uuid,input_hash text,normal_ms double precision,cleanup_ms double precision) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r app_private.local_vm_resources%rowtype; lease_end timestamptz; stamp timestamptz:=clock_timestamp(); begin
 perform app_private.sandbox_internal_only();
 -- Reservation first, matching admission/recovery lock order.
 select lease_until into lease_end from app.executions where id=execution for update;
 if not found then select lease_until into lease_end from app_private.submission_reservations where id=execution for update; end if;
 select * into r from app_private.local_vm_resources where execution_id=execution for update;
 if not found then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 perform app_private.assert_local_vm_active(execution,token,r.context);
 if r.creation_state<>'PREPARED' or r.cleanup_state<>'PENDING' then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 if input_hash is null or input_hash !~ '^[a-f0-9]{64}$' or normal_ms is null or cleanup_ms is null
  or not(normal_ms>extract(epoch from stamp)*1000 and normal_ms<=extract(epoch from stamp+interval '30 seconds')*1000)
  or cleanup_ms-normal_ms<>10000 or cleanup_ms>extract(epoch from lease_end)*1000 then
  raise exception using errcode='23514',message='INVALID_EXECUTION_CONTEXT'; end if;
 update app_private.local_vm_resources set creation_state='UNKNOWN',dispatched_at=stamp,input_sha256=input_hash,
  normal_deadline_at=to_timestamp(normal_ms/1000),cleanup_deadline_at=to_timestamp(cleanup_ms/1000)
  where execution_id=execution returning * into r;
 return app_private.local_vm_payload(r);
end $$;
create function app_private.confirm_local_vm_resource(execution uuid,creation uuid,resource uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r app_private.local_vm_resources%rowtype; begin
 perform app_private.sandbox_internal_only();
 select * into r from app_private.local_vm_resources where execution_id=execution and creation_id=creation for update;
 if not found or resource is null or r.cleanup_state<>'PENDING' or r.creation_state='PREPARED'
  or (r.provider_resource_id is not null and r.provider_resource_id<>resource) then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 if r.creation_state='UNKNOWN' then update app_private.local_vm_resources set creation_state='CONFIRMED',provider_resource_id=resource,confirmed_at=clock_timestamp() where execution_id=execution returning * into r; end if;
 return app_private.local_vm_payload(r);
end $$;
create function app_private.verify_local_vm_cleanup(execution uuid,proof jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare r app_private.local_vm_resources%rowtype; resource uuid; observed timestamptz; begin
 perform app_private.sandbox_internal_only();
 select * into r from app_private.local_vm_resources where execution_id=execution for update;
 if not found then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 if r.cleanup_state='VERIFIED' then
  if r.cleanup_proof is distinct from proof then raise exception using errcode='23514',message='IMMUTABLE_LOCAL_VM_RESOURCE'; end if;
  return;
 end if;
 if jsonb_typeof(proof) is distinct from 'object' or not(proof ?& array['kind','executionId','creationId','resourceId','hostId','brokerGeneration','qemuAbsent','overlaysAbsent','observedAt'])
  or (select count(*) from jsonb_object_keys(proof))<>9 or jsonb_typeof(proof->'kind') is distinct from 'string' or proof->>'kind' not in ('NOT_STARTED','RETIRED')
  or proof->'qemuAbsent' is distinct from 'true'::jsonb or proof->'overlaysAbsent' is distinct from 'true'::jsonb
  or proof->>'executionId' is distinct from execution::text or proof->>'creationId' is distinct from r.creation_id::text
  or proof->>'hostId' is distinct from r.context->>'hostId' or proof->>'brokerGeneration' is distinct from r.context->>'brokerGeneration'
  or jsonb_typeof(proof->'observedAt') is distinct from 'string' then raise exception using errcode='23514',message='INVALID_LOCAL_VM_PROOF'; end if;
 resource:=(proof->>'resourceId')::uuid; observed:=(proof->>'observedAt')::timestamptz;
 if (r.provider_resource_id is not null and resource is distinct from r.provider_resource_id)
  or (proof->>'kind'='RETIRED' and resource is null) or (r.creation_state='PREPARED' and resource is not null)
  or observed<coalesce(r.dispatched_at,r.prepared_at) or observed>clock_timestamp()+interval '5 seconds' then
  raise exception using errcode='23514',message='INVALID_LOCAL_VM_PROOF'; end if;
 if resource is not null and r.creation_state='UNKNOWN' then
  update app_private.local_vm_resources set creation_state='CONFIRMED',provider_resource_id=resource,confirmed_at=clock_timestamp() where execution_id=execution;
 end if;
 update app_private.local_vm_resources set cleanup_state='VERIFIED',cleanup_proof=proof,cleanup_verified_at=clock_timestamp() where execution_id=execution;
end $$;

-- Preserve Docker/Vercel authorization and accounting; add the local VM ledger.
create or replace function app_private.guard_sandbox_execution_context() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$ begin
 if old.execution_context is not null and new.execution_context is distinct from old.execution_context then
  raise exception using errcode='23514',message='IMMUTABLE_EXECUTION_CONTEXT'; end if;
 if new.lifecycle_status='COMPLETED' and old.lifecycle_status<>'COMPLETED' then
  if new.execution_context->>'provider'='local-vm' and not exists(select 1 from app_private.local_vm_resources where execution_id=new.id and cleanup_state='VERIFIED' and context=new.execution_context) then
   raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
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
 elsif ctx->>'provider'='local-vm' then
  if not app_private.valid_local_vm_context(ctx) then raise exception using errcode='23514',message='INVALID_EXECUTION_CONTEXT'; end if;
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
 if ctx->>'provider'='local-vm' then
  insert into app_private.local_vm_resources(execution_id,run_id,submission_id,organization_id,class_id,context)
   values(execution,case when purpose='RUN' then execution end,case when purpose='SUBMIT' then execution end,org,cls,ctx);
 end if;
 if ctx->>'provider'='vercel' then
  insert into app_private.sandbox_resources(execution_id,run_id,submission_id,organization_id,class_id,campaign_id,sandbox_name,context)
   values(execution,case when purpose='RUN' then execution end,case when purpose='SUBMIT' then execution end,org,cls,c.id,'alunza-practice-'||execution::text,ctx);
 end if;
end $$;


do $$ declare fn regprocedure; name text; begin
 for fn,name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='app_private' and p.proname in (
   'valid_local_vm_context','guard_local_vm_resource','local_vm_payload','load_local_vm_resource',
   'assert_local_vm_active','begin_local_vm_creation','confirm_local_vm_resource','verify_local_vm_cleanup',
   'prepare_sandbox_execution','guard_sandbox_execution_context') loop
  execute format('alter function %s owner to alunza_identity',fn);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',fn);
  if name in ('load_local_vm_resource','assert_local_vm_active','begin_local_vm_creation','confirm_local_vm_resource','verify_local_vm_cleanup') then
   execute format('grant execute on function %s to alunza_app',fn);
  end if;
 end loop;
end $$;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
