-- IMP-03.07: durable provider identity, one creation dispatch and bounded campaign.
-- Legacy reservations remain Docker. No resource is inferred absent from a TTL/404.
alter table app.executions add column execution_context jsonb;
alter table app_private.submission_reservations add column execution_context jsonb;

create table app_private.sandbox_campaigns (
 id uuid primary key,
 context jsonb not null check(jsonb_typeof(context)='object'),
 expires_at timestamptz not null,
 max_creations integer not null check(max_creations between 1 and 10000),
 max_requests integer not null check(max_requests>8*max_creations and max_requests<=1000000),
 creations integer not null default 0 check(creations>=0 and creations<=max_creations),
 normal_requests integer not null default 0 check(normal_requests>=0 and normal_requests<=max_requests-8*max_creations),
 total_requests integer not null default 0 check(total_requests>=normal_requests and total_requests<=max_requests)
);
create table app_private.sandbox_resources (
 execution_id uuid primary key,
 run_id uuid unique,
 submission_id uuid unique,
 organization_id uuid not null,
 class_id uuid not null,
 campaign_id uuid not null references app_private.sandbox_campaigns(id),
 creation_id uuid not null unique default gen_random_uuid(),
 sandbox_name text not null unique,
 context jsonb not null,
 provider_resource_id text unique check(length(provider_resource_id) between 1 and 200),
 creation_state text not null default 'PREPARED' check(creation_state in ('PREPARED','UNKNOWN','CONFIRMED')),
 cleanup_state text not null default 'PENDING' check(cleanup_state in ('PENDING','VERIFIED')),
 prepared_at timestamptz not null default clock_timestamp(),
 dispatched_at timestamptz,
 confirmed_at timestamptz,
 cleanup_proof jsonb,
 cleanup_verified_at timestamptz,
 check((run_id=execution_id and submission_id is null) or (submission_id=execution_id and run_id is null)),
 check(num_nonnulls(run_id,submission_id)=1),
 foreign key(organization_id,run_id) references app.executions(organization_id,id),
 foreign key(organization_id,submission_id) references app_private.submission_reservations(organization_id,id),
 foreign key(organization_id,class_id) references app.classes(organization_id,id),
 check((creation_state='PREPARED' and dispatched_at is null and confirmed_at is null and provider_resource_id is null)
   or (creation_state='UNKNOWN' and dispatched_at is not null and confirmed_at is null and provider_resource_id is null)
   or (creation_state='CONFIRMED' and dispatched_at is not null and confirmed_at is not null and provider_resource_id is not null)),
 check((cleanup_state='PENDING' and cleanup_proof is null and cleanup_verified_at is null)
   or (cleanup_state='VERIFIED' and cleanup_proof is not null and cleanup_verified_at is not null and creation_state<>'UNKNOWN'))
);
create index sandbox_resources_pending on app_private.sandbox_resources(campaign_id,execution_id) where cleanup_state='PENDING';
alter table app_private.sandbox_campaigns enable row level security;
alter table app_private.sandbox_campaigns force row level security;
alter table app_private.sandbox_resources enable row level security;
alter table app_private.sandbox_resources force row level security;
revoke all on app_private.sandbox_campaigns,app_private.sandbox_resources from public,anon,authenticated,service_role,alunza_app;
grant select,insert,update on app_private.sandbox_campaigns,app_private.sandbox_resources to alunza_identity;
create policy sandbox_campaigns_internal on app_private.sandbox_campaigns for all to alunza_identity using(true) with check(true);
create policy sandbox_resources_internal on app_private.sandbox_resources for all to alunza_identity using(true) with check(true);

create function app_private.guard_sandbox_campaign() returns trigger
language plpgsql set search_path=pg_catalog as $$ begin
 if row(new.id,new.context,new.expires_at,new.max_creations,new.max_requests)
  is distinct from row(old.id,old.context,old.expires_at,old.max_creations,old.max_requests) then
  raise exception using errcode='23514',message='IMMUTABLE_SANDBOX_CAMPAIGN';
 end if;
 if new.creations<old.creations or new.normal_requests<old.normal_requests or new.total_requests<old.total_requests then
  raise exception using errcode='23514',message='IMMUTABLE_SANDBOX_CONSUMPTION';
 end if;
 return new;
end $$;
create trigger sandbox_campaign_immutable before update on app_private.sandbox_campaigns for each row execute function app_private.guard_sandbox_campaign();

create function app_private.guard_sandbox_resource() returns trigger
language plpgsql set search_path=pg_catalog as $$ begin
 if row(new.execution_id,new.run_id,new.submission_id,new.organization_id,new.class_id,new.campaign_id,new.creation_id,new.sandbox_name,new.context,new.prepared_at)
  is distinct from row(old.execution_id,old.run_id,old.submission_id,old.organization_id,old.class_id,old.campaign_id,old.creation_id,old.sandbox_name,old.context,old.prepared_at)
  or (old.dispatched_at is not null and new.dispatched_at is distinct from old.dispatched_at)
  or (old.confirmed_at is not null and row(new.confirmed_at,new.provider_resource_id) is distinct from row(old.confirmed_at,old.provider_resource_id))
  or (new.creation_state<>old.creation_state and not((old.creation_state='PREPARED' and new.creation_state='UNKNOWN') or (old.creation_state='UNKNOWN' and new.creation_state='CONFIRMED')))
  or (old.cleanup_state='VERIFIED' and row(new.cleanup_state,new.cleanup_proof,new.cleanup_verified_at,new.creation_state) is distinct from row(old.cleanup_state,old.cleanup_proof,old.cleanup_verified_at,old.creation_state)) then
  raise exception using errcode='23514',message='IMMUTABLE_SANDBOX_RESOURCE';
 end if;
 return new;
end $$;
create trigger sandbox_resource_immutable before update on app_private.sandbox_resources for each row execute function app_private.guard_sandbox_resource();

create function app_private.sandbox_internal_only() returns void
language plpgsql security definer set search_path=pg_catalog as $$ begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
end $$;

create function app_private.sandbox_resource_payload(r app_private.sandbox_resources) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('executionId',r.execution_id,'creationId',r.creation_id,'sandboxName',r.sandbox_name,
  'providerResourceId',r.provider_resource_id,'creationState',r.creation_state,'cleanupState',r.cleanup_state,
  'context',r.context,'cleanupProof',r.cleanup_proof)
$$;

-- Called only from the admission overload, while the authorized reservation is locked.
create function app_private.prepare_sandbox_execution(execution uuid, token uuid, purpose text, ctx jsonb) returns void
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
  if not(ctx ?& array['provider','image','runnerVersion']) or (select count(*) from jsonb_object_keys(ctx))<>3
   or exists(select 1 from jsonb_each(ctx) e where jsonb_typeof(e.value)<>'string') then
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

-- Original functions retain all RBAC, close/admit serialization, quotas and replay.
create function app_private.admit_practice_run(
 execution uuid,activity uuid,assignment uuid,version_id uuid,operation_key text,payload_digest text,source_digest text,suite_digest text,visible_count integer,runtime_version text,correlation uuid,runner_available boolean,actor_concurrency integer,organization_concurrency integer,actor_frequency integer,execution_context jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 result:=app_private.admit_practice_run(execution,activity,assignment,version_id,operation_key,payload_digest,source_digest,suite_digest,visible_count,runtime_version,correlation,runner_available,actor_concurrency,organization_concurrency,actor_frequency);
 if result->>'kind'='reserved' and execution_context is not null then
  perform app_private.prepare_sandbox_execution(execution,(result->>'leaseToken')::uuid,'RUN',execution_context);
  result:=result||jsonb_build_object('executionContext',execution_context);
 end if;
 return result;
end $$;
create function app_private.admit_practice_submit(
 execution uuid,activity uuid,assignment uuid,version_id uuid,operation_key text,payload_digest text,source_code text,previous_attempt uuid,runtime_version text,correlation uuid,runner_available boolean,actor_concurrency integer,organization_concurrency integer,actor_frequency integer,execution_context jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 result:=app_private.admit_practice_submit(execution,activity,assignment,version_id,operation_key,payload_digest,source_code,previous_attempt,runtime_version,correlation,runner_available,actor_concurrency,organization_concurrency,actor_frequency);
 if result->>'kind'='reserved' and execution_context is not null then
  perform app_private.prepare_sandbox_execution(execution,(result->>'leaseToken')::uuid,'SUBMIT',execution_context);
  result:=result||jsonb_build_object('executionContext',execution_context);
 end if;
 return result;
end $$;

create function app_private.read_practice_execution_context(execution uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare ctx jsonb;
begin
 perform app_private.sandbox_internal_only();
 select execution_context into ctx from app.executions where id=execution;
 if not found then select execution_context into ctx from app_private.submission_reservations where id=execution; end if;
 return ctx;
end $$;
create function app_private.load_sandbox_resource(execution uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform app_private.sandbox_internal_only();
 return (select app_private.sandbox_resource_payload(r) from app_private.sandbox_resources r where execution_id=execution);
end $$;

create function app_private.observe_sandbox_campaign(campaign uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform app_private.sandbox_internal_only();
 return (select jsonb_build_object('campaignId',c.id,'creations',c.creations,'normalRequests',c.normal_requests,'totalRequests',c.total_requests,
  'resources',coalesce((select jsonb_agg(jsonb_build_object('executionId',r.execution_id,'creationId',r.creation_id,'sandboxName',r.sandbox_name,
   'providerResourceId',r.provider_resource_id,'creationState',r.creation_state,'cleanupState',r.cleanup_state,
   'requestId',coalesce(e.request_id,s.request_id),'lifecycleStatus',coalesce(e.lifecycle_status,s.lifecycle_status),
   'stagedResult',s.staged_result is not null,'mode',case when r.run_id is not null then 'RUN' else 'SUBMIT' end) order by r.execution_id)
   from app_private.sandbox_resources r left join app.executions e on e.id=r.run_id
   left join app_private.submission_reservations s on s.id=r.submission_id where r.campaign_id=c.id),'[]'::jsonb))
  from app_private.sandbox_campaigns c where c.id=campaign);
end $$;

create function app_private.assert_sandbox_active(execution uuid,token uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare valid boolean; ctx jsonb;
begin
 perform app_private.sandbox_internal_only();
 select lifecycle_status='RUNNING' and lease_token=token and lease_until>clock_timestamp(),execution_context into valid,ctx
  from app.executions where id=execution for update;
 if not found then
  select lifecycle_status='RUNNING' and lease_token=token and lease_until>clock_timestamp(),execution_context into valid,ctx
   from app_private.submission_reservations where id=execution for update;
 end if;
 if valid is distinct from true or ctx->>'provider' is distinct from 'vercel' or (ctx->>'expiresAt')::timestamptz<=clock_timestamp()
  or not exists(select 1 from app_private.sandbox_resources where execution_id=execution and cleanup_state='PENDING') then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS';
 end if;
end $$;

create function app_private.begin_sandbox_creation(execution uuid,token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r app_private.sandbox_resources%rowtype; c app_private.sandbox_campaigns%rowtype;
begin
 perform app_private.assert_sandbox_active(execution,token);
 select * into r from app_private.sandbox_resources where execution_id=execution for update;
 if r.creation_state<>'PREPARED' or r.cleanup_state<>'PENDING' then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS';
 end if;
 select * into c from app_private.sandbox_campaigns where id=r.campaign_id for update;
 if c.expires_at<=clock_timestamp() or c.creations>=c.max_creations or c.normal_requests>=c.max_requests-8*c.max_creations or c.total_requests>=c.max_requests then
  raise exception using errcode='P0001',message='DEPENDENCY_UNAVAILABLE';
 end if;
 update app_private.sandbox_campaigns set creations=creations+1 where id=c.id;
 update app_private.sandbox_resources set creation_state='UNKNOWN',dispatched_at=clock_timestamp() where execution_id=execution returning * into r;
 return app_private.sandbox_resource_payload(r);
end $$;

-- Receipt is tied to the immutable dispatch, not the rotating worker lease.
-- A late receipt can identify an orphan; it never grants permission to run code.
create function app_private.confirm_sandbox_resource(execution uuid,creation uuid,resource_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r app_private.sandbox_resources%rowtype;
begin
 perform app_private.sandbox_internal_only();
 select * into r from app_private.sandbox_resources where execution_id=execution for update;
 if not found or r.creation_id is distinct from creation or r.creation_state='PREPARED'
  or resource_id is null or length(resource_id) not between 1 and 200
  or (r.provider_resource_id is not null and r.provider_resource_id<>resource_id) then
  raise exception using errcode='23514',message='INVALID_SANDBOX_RECEIPT';
 end if;
 if r.creation_state='UNKNOWN' then
  update app_private.sandbox_resources set provider_resource_id=resource_id,creation_state='CONFIRMED',confirmed_at=clock_timestamp()
   where execution_id=execution returning * into r;
 end if;
 return app_private.sandbox_resource_payload(r);
end $$;

create function app_private.consume_sandbox_request(execution uuid,creation uuid,cleanup boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare r app_private.sandbox_resources%rowtype; c app_private.sandbox_campaigns%rowtype;
begin
 perform app_private.sandbox_internal_only();
 select * into r from app_private.sandbox_resources where execution_id=execution for update;
 if not found or r.creation_id is distinct from creation or cleanup is null or r.cleanup_state<>'PENDING'
  or (not cleanup and r.creation_state='PREPARED') then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 if not cleanup and not exists(
  select 1 from app.executions where id=r.run_id and lifecycle_status='RUNNING' and lease_until>clock_timestamp()
  union all select 1 from app_private.submission_reservations where id=r.submission_id and lifecycle_status='RUNNING' and lease_until>clock_timestamp()
 ) then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 select * into c from app_private.sandbox_campaigns where id=r.campaign_id for update;
 if c.total_requests>=c.max_requests or (not cleanup and (c.expires_at<=clock_timestamp() or c.normal_requests>=c.max_requests-8*c.max_creations)) then
  raise exception using errcode='P0001',message='DEPENDENCY_UNAVAILABLE';
 end if;
 update app_private.sandbox_campaigns set total_requests=total_requests+1,normal_requests=normal_requests+case when cleanup then 0 else 1 end where id=c.id;
end $$;

create function app_private.verify_sandbox_cleanup(execution uuid,proof jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare r app_private.sandbox_resources%rowtype;
begin
 perform app_private.sandbox_internal_only();
 select * into r from app_private.sandbox_resources where execution_id=execution for update;
 if not found or jsonb_typeof(proof) is distinct from 'object' or proof->>'creationId' is distinct from r.creation_id::text then
  raise exception using errcode='23514',message='INVALID_SANDBOX_CLEANUP';
 end if;
 if proof->>'kind'='NOT_DISPATCHED' then
  if r.creation_state<>'PREPARED' or (select count(*) from jsonb_object_keys(proof))<>2 then
   raise exception using errcode='23514',message='INVALID_SANDBOX_CLEANUP';
  end if;
 elsif proof->>'kind'='ABSENT_AND_ZERO_SNAPSHOTS' then
  if r.creation_state<>'CONFIRMED' or proof->>'sandboxId' is distinct from r.provider_resource_id
   or proof->'lookupAbsent' is distinct from 'true'::jsonb or proof->'snapshotsRemaining' is distinct from '0'::jsonb
   or jsonb_typeof(proof->'observedAt') is distinct from 'string' or (select count(*) from jsonb_object_keys(proof))<>6
   or (proof->>'observedAt')::timestamptz<r.dispatched_at or (proof->>'observedAt')::timestamptz>clock_timestamp()+interval '5 seconds' then
   raise exception using errcode='23514',message='INVALID_SANDBOX_CLEANUP';
  end if;
 else raise exception using errcode='23514',message='INVALID_SANDBOX_CLEANUP'; end if;
 if r.cleanup_state='VERIFIED' then return; end if;
 update app_private.sandbox_resources set cleanup_state='VERIFIED',cleanup_proof=proof,cleanup_verified_at=clock_timestamp() where execution_id=execution;
end $$;

create function app_private.guard_sandbox_execution_context() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if old.execution_context is not null and new.execution_context is distinct from old.execution_context then
  raise exception using errcode='23514',message='IMMUTABLE_EXECUTION_CONTEXT';
 end if;
 if new.execution_context->>'provider'='vercel' and new.lifecycle_status='COMPLETED' and old.lifecycle_status<>'COMPLETED'
  and not exists(select 1 from app_private.sandbox_resources where execution_id=new.id and cleanup_state='VERIFIED' and context=new.execution_context) then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS';
 end if;
 return new;
end $$;
create trigger execution_sandbox_context before update on app.executions for each row execute function app_private.guard_sandbox_execution_context();
create trigger submission_sandbox_context before update on app_private.submission_reservations for each row execute function app_private.guard_sandbox_execution_context();

-- No purge touches pending resources or their immutable correlation and proof.
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
do $$ declare fn regprocedure; name text; begin
 for fn,name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='app_private' and (p.proname in ('sandbox_internal_only','sandbox_resource_payload','prepare_sandbox_execution','read_practice_execution_context','load_sandbox_resource','observe_sandbox_campaign','assert_sandbox_active','begin_sandbox_creation','confirm_sandbox_resource','consume_sandbox_request','verify_sandbox_cleanup','guard_sandbox_execution_context','guard_sandbox_campaign','guard_sandbox_resource')
   or (p.proname='admit_practice_run' and p.pronargs=16) or (p.proname='admit_practice_submit' and p.pronargs=15)) loop
  execute format('alter function %s owner to alunza_identity',fn);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',fn);
  if name not in ('sandbox_internal_only','sandbox_resource_payload','prepare_sandbox_execution','guard_sandbox_execution_context','guard_sandbox_campaign','guard_sandbox_resource') then
   execute format('grant execute on function %s to alunza_app',fn);
  end if;
 end loop;
end $$;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
