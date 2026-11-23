-- Operational RUN reservations only. No source code, attempts or hidden tests.
create table app.executions (
 id uuid primary key,
 organization_id uuid not null,
 class_id uuid not null,
 activity_id uuid not null,
 activity_exercise_id uuid not null,
 exercise_version_id uuid not null,
 student_id uuid not null,
 operation_id uuid not null unique references app.operation_keys(id),
 purpose text not null default 'RUN' check(purpose='RUN'),
 code_hash text not null check(code_hash ~ '^[a-f0-9]{64}$'),
 test_suite_hash text not null check(test_suite_hash ~ '^[a-f0-9]{64}$'),
 limits_snapshot jsonb not null check(limits_snapshot='{"memoryBytes":134217728,"runtimeMs":3000,"outputBytes":65536}'::jsonb),
 runner_version text not null check(length(runner_version) between 1 and 100),
 visible_total integer not null check(visible_total between 1 and 8),
 lifecycle_status text not null default 'RUNNING' check(lifecycle_status in ('RUNNING','RECOVERING','COMPLETED')),
 admitted_at timestamptz not null,
 started_at timestamptz not null,
 finished_at timestamptz,
 lease_until timestamptz,
 lease_token uuid not null,
 response_body jsonb,
 response_expires_at timestamptz not null,
 cleanup_verified boolean not null default false,
 request_id uuid not null,
 unique(organization_id,id),
 foreign key(organization_id,class_id) references app.classes(organization_id,id),
 foreign key(organization_id,activity_id) references app.activities(organization_id,id),
 foreign key(organization_id,activity_exercise_id) references app.activity_exercises(organization_id,id),
 foreign key(organization_id,exercise_version_id) references app.exercise_versions(organization_id,id),
 foreign key(organization_id,student_id) references app.organization_memberships(organization_id,user_id),
 check((lifecycle_status='COMPLETED' and finished_at is not null and lease_until is null and cleanup_verified)
    or (lifecycle_status in ('RUNNING','RECOVERING') and finished_at is null and lease_until is not null and response_body is null)),
 check(response_body is null or (response_body->>'executionId'=id::text and response_body->>'exerciseVersionId'=exercise_version_id::text and response_body->>'mode'='RUN'))
);
create index executions_actor_active on app.executions(student_id,organization_id) where lifecycle_status<>'COMPLETED';
create index executions_org_active on app.executions(organization_id) where lifecycle_status<>'COMPLETED';
create index executions_lease on app.executions(lease_until,id) where lifecycle_status<>'COMPLETED';
create index executions_actor_admitted on app.executions(organization_id,student_id,admitted_at desc);
create index executions_response_expiry on app.executions(response_expires_at,id) where response_body is not null;
alter table app.executions enable row level security;
alter table app.executions force row level security;
revoke all on app.executions from public,anon,authenticated,service_role,alunza_app;
grant select(id,organization_id,class_id,activity_id,activity_exercise_id,exercise_version_id,student_id,operation_id,purpose,code_hash,test_suite_hash,limits_snapshot,runner_version,visible_total,lifecycle_status,admitted_at,started_at,finished_at,lease_until,response_body,response_expires_at,cleanup_verified,request_id) on app.executions to alunza_app;
grant select,insert,update on app.executions to alunza_identity;
create policy executions_actor_read on app.executions for select to alunza_app using(
 organization_id=app_private.organization_id() and student_id=app_private.actor_id()
 and app_private.academic_student(class_id) and app_private.academic_activity_read(activity_id)
);
create policy executions_internal on app.executions for all to alunza_identity using(true) with check(true);
grant insert on app.operation_keys to alunza_identity;
grant update(state,resource_type,resource_id,response_status,response_body,updated_at,lease_until) on app.operation_keys to alunza_identity;
create policy practice_operation_internal on app.operation_keys for all to alunza_identity
 using(operation='practice.run') with check(operation='practice.run');
-- The general institutional actor policy must not let an API connection forge
-- a replay response outside the lease-fenced RUN functions.
create policy practice_operation_insert_guard on app.operation_keys as restrictive for insert to alunza_app
 with check(operation<>'practice.run');
create policy practice_operation_update_guard on app.operation_keys as restrictive for update to alunza_app
 using(operation<>'practice.run') with check(operation<>'practice.run');

create function app_private.guard_execution_context() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='UPDATE' then
  if row(new.id,new.organization_id,new.class_id,new.activity_id,new.activity_exercise_id,new.exercise_version_id,new.student_id,new.operation_id,new.purpose,new.code_hash,new.test_suite_hash,new.limits_snapshot,new.runner_version,new.visible_total,new.admitted_at,new.started_at,new.response_expires_at,new.request_id)
   is distinct from row(old.id,old.organization_id,old.class_id,old.activity_id,old.activity_exercise_id,old.exercise_version_id,old.student_id,old.operation_id,old.purpose,old.code_hash,old.test_suite_hash,old.limits_snapshot,old.runner_version,old.visible_total,old.admitted_at,old.started_at,old.response_expires_at,old.request_id) then
   raise exception using errcode='23514',message='IMMUTABLE_EXECUTION';
  end if;
  if old.lifecycle_status='COMPLETED' and row(new.lifecycle_status,new.finished_at,new.lease_until,new.lease_token,new.cleanup_verified) is distinct from row(old.lifecycle_status,old.finished_at,old.lease_until,old.lease_token,old.cleanup_verified) then
   raise exception using errcode='23514',message='IMMUTABLE_EXECUTION';
  end if;
  if old.lifecycle_status='COMPLETED' and new.response_body is distinct from old.response_body and not(new.response_body is null and new.response_expires_at<=clock_timestamp()) then
   raise exception using errcode='23514',message='IMMUTABLE_EXECUTION';
  end if;
 else
  if not exists(select 1 from app.activities a join app.activity_exercises ae on ae.organization_id=a.organization_id and ae.activity_id=a.id
   join app.operation_keys k on k.id=new.operation_id
   where a.id=new.activity_id and a.organization_id=new.organization_id and a.class_id=new.class_id
    and ae.id=new.activity_exercise_id and ae.exercise_version_id=new.exercise_version_id
    and k.organization_id=new.organization_id and k.actor_id=new.student_id and k.operation='practice.run'
    and k.resource_id=new.id and k.resource_type='execution' and k.state='RUNNING') then
   raise exception using errcode='23514',message='EXECUTION_CONTEXT_MISMATCH';
  end if;
 end if;
 return new;
end $$;
create trigger executions_context before insert or update on app.executions for each row execute function app_private.guard_execution_context();

-- Called with identity/session/organization established by NestJS. Both this
-- admission and academic close lock the same organization row.
create function app_private.admit_practice_run(
 execution uuid, activity uuid, assignment uuid, version_id uuid, operation_key text,
 payload_digest text, code_digest text, suite_digest text, visible_count integer,
 runtime_version text, correlation uuid, runner_available boolean,
 actor_concurrency integer, organization_concurrency integer, actor_frequency integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a record; k app.operation_keys%rowtype; e app.executions%rowtype;
 org uuid:=app_private.organization_id(); actor uuid:=app_private.actor_id(); ts timestamptz; op uuid:=gen_random_uuid(); token uuid:=gen_random_uuid();
begin
 if org is null or actor is null or not app_private.academic_role(org,array['STUDENT']) then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 if actor_concurrency is null or organization_concurrency is null or actor_frequency is null or operation_key is null
  or actor_concurrency not between 1 and 10 or organization_concurrency not between 1 and 32 or actor_frequency not between 1 and 120
  or operation_key !~ '^[A-Za-z0-9._:-]{8,128}$' then
  raise exception using errcode='22023',message='INVALID_RUN_CONFIGURATION';
 end if;
 -- Stable lock order for concurrent requests by the same actor.
 perform pg_advisory_xact_lock(hashtextextended('practice.actor:'||actor::text,0));
 perform app_private.lock_academic_organization(org);
 select act.*, c.archived_at as class_archived_at, ae.exercise_version_id into a
  from app.activities act join app.classes c on c.id=act.class_id and c.organization_id=act.organization_id
  join app.activity_exercises ae on ae.activity_id=act.id and ae.organization_id=act.organization_id
  where act.id=activity and ae.id=assignment and act.organization_id=org
   and act.state in ('PUBLISHED','CLOSED') and app_private.academic_student(act.class_id);
 if not found then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 if a.exercise_version_id<>version_id then raise exception using errcode='P0001',message='VERSION_CONFLICT'; end if;
 select * into k from app.operation_keys where organization_id=org and actor_id=actor and operation='practice.run' and key=operation_key for update;
 ts:=clock_timestamp();
 if found then
  if k.payload_hash<>payload_digest then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
  if k.expires_at<=ts then raise exception using errcode='P0001',message='IDEMPOTENCY_EXPIRED'; end if;
  if k.state<>'COMPLETED' then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
  if k.response_body is null then raise exception using errcode='P0001',message='IDEMPOTENCY_EXPIRED'; end if;
  return jsonb_build_object('kind','replay','response',k.response_body);
 end if;
 if a.state<>'PUBLISHED' then raise exception using errcode='P0001',message='ACTIVITY_CLOSED'; end if;
 if a.class_archived_at is not null then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
 if (a.opens_at is not null and ts<a.opens_at) or (a.closes_at is not null and ts>=a.closes_at) then
  raise exception using errcode='P0001',message='ACTIVITY_NOT_AVAILABLE';
 end if;
 if runner_available is distinct from true then raise exception using errcode='P0001',message='DEPENDENCY_UNAVAILABLE'; end if;
 if (select count(*) from app.executions where organization_id=org and student_id=actor and lifecycle_status<>'COMPLETED')>=actor_concurrency
  or (select count(*) from app.executions where organization_id=org and lifecycle_status<>'COMPLETED')>=organization_concurrency
  or (select count(*) from app.executions where organization_id=org and student_id=actor and admitted_at>ts-interval '1 minute')>=actor_frequency then
  raise exception using errcode='P0001',message='RATE_LIMITED';
 end if;
 if visible_count<>(select count(*) from app_private.exercise_tests where exercise_version_id=version_id and visibility='visible') then
  raise exception using errcode='23514',message='VISIBLE_SUITE_MISMATCH';
 end if;
 insert into app.operation_keys(id,organization_id,actor_id,operation,key,payload_hash,state,resource_type,resource_id,expires_at,lease_until)
 values(op,org,actor,'practice.run',operation_key,payload_digest,'RUNNING','execution',execution,ts+interval '24 hours',ts+interval '60 seconds');
 insert into app.executions(id,organization_id,class_id,activity_id,activity_exercise_id,exercise_version_id,student_id,operation_id,
  code_hash,test_suite_hash,limits_snapshot,runner_version,visible_total,admitted_at,started_at,lease_until,lease_token,response_expires_at,request_id)
 values(execution,org,a.class_id,activity,assignment,version_id,actor,op,code_digest,suite_digest,
  '{"memoryBytes":134217728,"runtimeMs":3000,"outputBytes":65536}',runtime_version,visible_count,ts,ts,ts+interval '60 seconds',token,ts+interval '24 hours',correlation)
 returning * into e;
 return jsonb_build_object('kind','reserved','executionId',e.id,'exerciseVersionId',e.exercise_version_id,'organizationId',e.organization_id,
  'studentId',e.student_id,'admittedAt',e.admitted_at,'leaseToken',e.lease_token,'visibleTotal',e.visible_total,'runnerVersion',e.runner_version);
end $$;

-- No actor assumption here: a lease can close after session expiry/revocation.
-- It cannot authorize reading a response; NestJS rechecks the requesting actor.
create function app_private.finish_practice_run(execution uuid, token uuid, technical_result jsonb, cleaned boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare e app.executions%rowtype; response jsonb; ts timestamptz:=clock_timestamp();
begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 select * into e from app.executions where id=execution for update;
 if not found or token is distinct from e.lease_token or e.lifecycle_status='COMPLETED' or e.lease_until<=ts then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS';
 end if;
 if cleaned is distinct from true then
  update app.executions set lifecycle_status='RECOVERING',lease_until=ts+interval '15 seconds',lease_token=gen_random_uuid() where id=e.id;
  return null;
 end if;
 if technical_result is null or jsonb_typeof(technical_result)<>'object' then
  raise exception using errcode='23514',message='INVALID_RUN_RESULT';
 end if;
 if not (technical_result ?& array['runnerVersion','diagnosisCode','terminationReason','infrastructureStatus','visibleTestResults','visiblePassed','visibleTotal','outputTruncated','outputBytes','runtimeMs','lifecycleMs'])
  or (select count(*) from jsonb_object_keys(technical_result))<>11
  or exists(select 1 from jsonb_each(technical_result) x where
   (x.key in ('runnerVersion','diagnosisCode','terminationReason','infrastructureStatus') and jsonb_typeof(x.value)<>'string')
   or (x.key in ('visiblePassed','visibleTotal','outputBytes','runtimeMs','lifecycleMs') and jsonb_typeof(x.value)<>'number')
   or (x.key='visibleTestResults' and jsonb_typeof(x.value)<>'array')
   or (x.key='outputTruncated' and jsonb_typeof(x.value)<>'boolean')) then
  raise exception using errcode='23514',message='INVALID_RUN_RESULT';
 end if;
 if technical_result->>'runnerVersion'<>e.runner_version
  or technical_result->>'diagnosisCode' not in ('SUCCESS','SYNTAX_ERROR','RUNTIME_ERROR','FAILED_TEST','TIMEOUT','UNKNOWN')
  or technical_result->>'terminationReason' not in ('COMPLETED','STUDENT_SYNTAX','STUDENT_EXCEPTION','ASSERTION_FAILED','EXECUTION_DEADLINE','MEMORY_LIMIT','OUTPUT_LIMIT','RETURN_LIMIT','PROTOCOL_INVALID','RUNNER_FAILURE','PROVIDER_FAILURE','CAPABILITY_GAP','CANCELLED')
  or technical_result->>'infrastructureStatus' not in ('OK','FAILED')
  or (technical_result->>'visibleTotal')::numeric<>e.visible_total
  or jsonb_array_length(technical_result->'visibleTestResults')>e.visible_total
  or (technical_result->>'visiblePassed')::numeric not between 0 and e.visible_total
  or (technical_result->>'outputBytes')::numeric not between 0 and 65536
  or mod((technical_result->>'outputBytes')::numeric,1)<>0
  or (technical_result->>'runtimeMs')::numeric<0 or (technical_result->>'lifecycleMs')::numeric<0
  or (technical_result->>'infrastructureStatus'='FAILED' and technical_result->>'diagnosisCode'<>'UNKNOWN') then
  raise exception using errcode='23514',message='INVALID_RUN_RESULT';
 end if;
 if exists(select 1 from jsonb_array_elements(technical_result->'visibleTestResults') t where jsonb_typeof(t)<>'object') then
  raise exception using errcode='23514',message='INVALID_RUN_RESULT';
 end if;
 if exists(select 1 from jsonb_array_elements(technical_result->'visibleTestResults') t where
  not(t ?& array['id','passed','stdout','stderr']) or (select count(*) from jsonb_object_keys(t))<>4
  or jsonb_typeof(t->'id')<>'string' or jsonb_typeof(t->'passed')<>'boolean'
  or jsonb_typeof(t->'stdout')<>'string' or jsonb_typeof(t->'stderr')<>'string'
  or not exists(select 1 from app_private.exercise_tests et where et.exercise_version_id=e.exercise_version_id and et.visibility='visible' and et.test_id=t->>'id'))
  or (select count(distinct t->>'id') from jsonb_array_elements(technical_result->'visibleTestResults') t)<>jsonb_array_length(technical_result->'visibleTestResults')
  or (select count(*) from jsonb_array_elements(technical_result->'visibleTestResults') t where t->'passed'='true'::jsonb)<>(technical_result->>'visiblePassed')::numeric
  or (select coalesce(sum(octet_length(t->>'stdout')+octet_length(t->>'stderr')),0) from jsonb_array_elements(technical_result->'visibleTestResults') t)>(technical_result->>'outputBytes')::numeric
  or (technical_result->>'diagnosisCode'='SUCCESS' and ((technical_result->>'visiblePassed')::numeric<>e.visible_total
   or jsonb_array_length(technical_result->'visibleTestResults')<>e.visible_total or technical_result->>'infrastructureStatus'<>'OK'
   or technical_result->>'terminationReason'<>'COMPLETED' or technical_result->'outputTruncated'<>'false'::jsonb)) then
  raise exception using errcode='23514',message='INVALID_RUN_RESULT';
 end if;
 response:=jsonb_build_object('executionId',e.id,'exerciseVersionId',e.exercise_version_id,'mode','RUN','admittedAt',e.admitted_at,'finishedAt',ts,'technicalResult',technical_result);
 update app.executions set lifecycle_status='COMPLETED',finished_at=ts,lease_until=null,response_body=response,cleanup_verified=true where id=e.id;
 update app.operation_keys set state='COMPLETED',response_status=201,response_body=response,lease_until=null,updated_at=ts where id=e.operation_id;
 return response;
end $$;

create function app_private.claim_expired_practice_run() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare e app.executions%rowtype; ts timestamptz:=clock_timestamp();
begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 select * into e from app.executions where lifecycle_status<>'COMPLETED' and lease_until<=ts order by lease_until,id for update skip locked limit 1;
 if not found then return null; end if;
 update app.executions set lifecycle_status='RECOVERING',lease_token=gen_random_uuid(),lease_until=ts+interval '60 seconds' where id=e.id returning * into e;
 return jsonb_build_object('executionId',e.id,'exerciseVersionId',e.exercise_version_id,'organizationId',e.organization_id,'studentId',e.student_id,
  'admittedAt',e.admitted_at,'leaseToken',e.lease_token,'visibleTotal',e.visible_total,'runnerVersion',e.runner_version);
end $$;

create function app_private.purge_practice_responses() returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare removed integer;
begin
 if app_private.actor_id() is not null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 with due as(select id from app.executions where response_body is not null and response_expires_at<=clock_timestamp() order by response_expires_at,id for update skip locked limit 200)
 update app.executions e set response_body=null from due where e.id=due.id;
 get diagnostics removed=row_count;
 with due as(select id from app.operation_keys where operation='practice.run' and response_body is not null and expires_at<=clock_timestamp() order by expires_at,id for update skip locked limit 200)
 update app.operation_keys k set response_body=null from due where k.id=due.id;
 return removed;
end $$;

grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
do $$ declare fn regprocedure; begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'
  and p.proname in ('guard_execution_context','admit_practice_run','finish_practice_run','claim_expired_practice_run','purge_practice_responses') loop
  execute format('alter function %s owner to alunza_identity',fn);
 end loop;
end $$;
set role alunza_identity;
do $$ declare fn regprocedure; begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'
  and p.proname in ('guard_execution_context','admit_practice_run','finish_practice_run','claim_expired_practice_run','purge_practice_responses') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',fn);
  if fn::text not like 'app_private.guard_execution_context%' then execute format('grant execute on function %s to alunza_app',fn); end if;
 end loop;
end $$;
reset role;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
