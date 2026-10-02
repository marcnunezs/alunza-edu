-- IMP-03.04–03.06; dictionary reviewed before DDL in docs/work/IMP-03-submissions-dictionary.md.
-- No browser grants. SUBMIT source is private until an atomic attempt commit.
create table app_private.submission_reservations (
 id uuid primary key,
 organization_id uuid not null,
 class_id uuid not null,
 activity_id uuid not null,
 activity_exercise_id uuid not null,
 exercise_version_id uuid not null,
 student_id uuid not null,
 operation_id uuid not null unique references app.operation_keys(id),
 code text check(octet_length(code) between 1 and 65536),
 code_hash text not null check(code_hash ~ '^[a-f0-9]{64}$'),
 test_suite_hash text not null check(test_suite_hash ~ '^[a-f0-9]{64}$'),
 limits_snapshot jsonb not null check(limits_snapshot='{"memoryBytes":134217728,"runtimeMs":3000,"outputBytes":65536}'::jsonb),
 runner_version text not null check(length(runner_version) between 1 and 100),
 visible_total integer not null check(visible_total between 1 and 8),
 total_required integer not null check(total_required between 1 and 8 and total_required>=visible_total),
 attempt_number integer not null check(attempt_number>0),
 previous_attempt_id uuid,
 lifecycle_status text not null default 'RUNNING' check(lifecycle_status in ('RUNNING','RECOVERING','COMPLETED')),
 admitted_at timestamptz not null,
 finished_at timestamptz,
 lease_until timestamptz,
 lease_token uuid not null,
 staged_result jsonb,
 staged_private_results jsonb,
 response_body jsonb,
 response_expires_at timestamptz not null,
 cleanup_verified boolean not null default false,
 attempt_id uuid unique,
 request_id uuid not null,
 unique(organization_id,id),
 unique(organization_id,student_id,activity_exercise_id,attempt_number),
 foreign key(organization_id,class_id) references app.classes(organization_id,id),
 foreign key(organization_id,activity_id) references app.activities(organization_id,id),
 foreign key(organization_id,activity_exercise_id) references app.activity_exercises(organization_id,id),
 foreign key(organization_id,exercise_version_id) references app.exercise_versions(organization_id,id),
 foreign key(organization_id,student_id) references app.organization_memberships(organization_id,user_id),
 check((lifecycle_status='COMPLETED' and finished_at is not null and lease_until is null and cleanup_verified and attempt_id is not null)
    or (lifecycle_status in ('RUNNING','RECOVERING') and finished_at is null and lease_until is not null and response_body is null and attempt_id is null and code is not null)),
 check((staged_result is null)=(staged_private_results is null)),
 check(response_body is null or (response_body->>'executionId'=id::text and response_body->>'attemptId'=attempt_id::text))
);
create index submissions_actor_active on app_private.submission_reservations(student_id,organization_id) where lifecycle_status<>'COMPLETED';
create index submissions_org_active on app_private.submission_reservations(organization_id) where lifecycle_status<>'COMPLETED';
create index submissions_lease on app_private.submission_reservations(lease_until,id) where lifecycle_status<>'COMPLETED';
create index submissions_actor_admitted on app_private.submission_reservations(organization_id,student_id,admitted_at desc);
create index submissions_response_expiry on app_private.submission_reservations(response_expires_at,id) where response_body is not null or code is not null;

create table app.attempts (
 id uuid primary key default gen_random_uuid(),
 execution_id uuid not null unique,
 organization_id uuid not null,
 class_id uuid not null,
 activity_id uuid not null,
 activity_exercise_id uuid not null,
 exercise_version_id uuid not null,
 student_id uuid not null,
 code text not null check(octet_length(code) between 1 and 65536),
 code_hash text not null check(code_hash ~ '^[a-f0-9]{64}$'),
 test_suite_hash text not null check(test_suite_hash ~ '^[a-f0-9]{64}$'),
 attempt_number integer not null check(attempt_number>0),
 previous_attempt_id uuid,
 admitted_at timestamptz not null,
 submitted_at timestamptz not null check(submitted_at>=admitted_at),
 technical_result jsonb not null,
 unique(organization_id,id),
 unique(organization_id,student_id,activity_exercise_id,exercise_version_id,id),
 unique(organization_id,student_id,activity_exercise_id,attempt_number),
 foreign key(organization_id,execution_id) references app_private.submission_reservations(organization_id,id),
 foreign key(organization_id,class_id) references app.classes(organization_id,id),
 foreign key(organization_id,activity_id) references app.activities(organization_id,id),
 foreign key(organization_id,activity_exercise_id) references app.activity_exercises(organization_id,id),
 foreign key(organization_id,exercise_version_id) references app.exercise_versions(organization_id,id),
 foreign key(organization_id,student_id) references app.organization_memberships(organization_id,user_id),
 foreign key(organization_id,student_id,activity_exercise_id,exercise_version_id,previous_attempt_id)
  references app.attempts(organization_id,student_id,activity_exercise_id,exercise_version_id,id)
);
alter table app_private.submission_reservations add foreign key(organization_id,student_id,activity_exercise_id,exercise_version_id,previous_attempt_id)
 references app.attempts(organization_id,student_id,activity_exercise_id,exercise_version_id,id);
alter table app_private.submission_reservations add foreign key(organization_id,attempt_id) references app.attempts(organization_id,id);
create index attempts_history on app.attempts(organization_id,student_id,activity_id,activity_exercise_id,attempt_number desc);
create index attempts_completion on app.attempts(organization_id,student_id,activity_id,activity_exercise_id,exercise_version_id)
 where technical_result->'allRequiredPassed'='true'::jsonb;

create table app_private.attempt_results (
 attempt_id uuid primary key,
 organization_id uuid not null,
 result_schema_version text not null default 'submission.v1' check(result_schema_version='submission.v1'),
 runner_version text not null,
 test_suite_hash text not null check(test_suite_hash ~ '^[a-f0-9]{64}$'),
 private_test_results jsonb not null check(jsonb_typeof(private_test_results)='array'),
 foreign key(organization_id,attempt_id) references app.attempts(organization_id,id)
);

create table app_private.attempt_events (
 id uuid primary key default gen_random_uuid(),
 event_sequence bigint generated always as identity unique,
 organization_id uuid not null,
 class_id uuid not null,
 activity_id uuid not null,
 activity_exercise_id uuid not null,
 exercise_version_id uuid not null,
 student_id uuid not null,
 attempt_id uuid not null,
 event_type text not null check(event_type in ('ATTEMPT_SUBMITTED','EXECUTION_COMPLETED')),
 schema_version text not null default 'submission.v1' check(schema_version='submission.v1'),
 occurred_at timestamptz not null,
 unique(attempt_id,event_type),
 foreign key(organization_id,attempt_id) references app.attempts(organization_id,id),
 foreign key(organization_id,class_id) references app.classes(organization_id,id),
 foreign key(organization_id,activity_id) references app.activities(organization_id,id),
 foreign key(organization_id,activity_exercise_id) references app.activity_exercises(organization_id,id),
 foreign key(organization_id,exercise_version_id) references app.exercise_versions(organization_id,id),
 foreign key(organization_id,student_id) references app.organization_memberships(organization_id,user_id)
);
create index attempt_events_scope on app_private.attempt_events(organization_id,class_id,student_id,event_sequence);

alter table app.attempts enable row level security;
alter table app.attempts force row level security;
alter table app_private.submission_reservations enable row level security;
alter table app_private.submission_reservations force row level security;
alter table app_private.attempt_events enable row level security;
alter table app_private.attempt_events force row level security;
alter table app_private.attempt_results enable row level security;
alter table app_private.attempt_results force row level security;
revoke all on app.attempts,app_private.submission_reservations,app_private.attempt_events,app_private.attempt_results from public,anon,authenticated,service_role,alunza_app;
grant select on app.attempts to alunza_app;
grant select,insert on app.attempts,app_private.attempt_events,app_private.attempt_results to alunza_identity;
grant select,insert,update on app_private.submission_reservations to alunza_identity;
grant usage on sequence app_private.attempt_events_event_sequence_seq to alunza_identity;
create policy attempts_actor_read on app.attempts for select to alunza_app using(
 (app_private.organization_id() is null or organization_id=app_private.organization_id()) and student_id=app_private.actor_id()
 and app_private.academic_student(class_id) and app_private.academic_activity_read(activity_id)
);
create policy attempts_internal on app.attempts for all to alunza_identity using(true) with check(true);
create policy submissions_internal on app_private.submission_reservations for all to alunza_identity using(true) with check(true);
create policy attempt_events_internal on app_private.attempt_events for all to alunza_identity using(true) with check(true);
create policy attempt_results_internal on app_private.attempt_results for all to alunza_identity using(true) with check(true);
alter policy practice_operation_internal on app.operation_keys to alunza_identity
 using(operation in ('practice.run','practice.submit')) with check(operation in ('practice.run','practice.submit'));
alter policy practice_operation_insert_guard on app.operation_keys to alunza_app with check(operation not in ('practice.run','practice.submit'));
alter policy practice_operation_update_guard on app.operation_keys to alunza_app
 using(operation not in ('practice.run','practice.submit')) with check(operation not in ('practice.run','practice.submit'));

create function app_private.guard_submission_context() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='UPDATE' then
  if row(new.id,new.organization_id,new.class_id,new.activity_id,new.activity_exercise_id,new.exercise_version_id,new.student_id,new.operation_id,new.code_hash,new.test_suite_hash,new.limits_snapshot,new.runner_version,new.visible_total,new.total_required,new.attempt_number,new.previous_attempt_id,new.admitted_at,new.response_expires_at,new.request_id)
   is distinct from row(old.id,old.organization_id,old.class_id,old.activity_id,old.activity_exercise_id,old.exercise_version_id,old.student_id,old.operation_id,old.code_hash,old.test_suite_hash,old.limits_snapshot,old.runner_version,old.visible_total,old.total_required,old.attempt_number,old.previous_attempt_id,old.admitted_at,old.response_expires_at,old.request_id) then
   raise exception using errcode='23514',message='IMMUTABLE_SUBMISSION';
  end if;
  if old.lifecycle_status='COMPLETED' and row(new.lifecycle_status,new.finished_at,new.lease_until,new.lease_token,new.cleanup_verified,new.attempt_id)
   is distinct from row(old.lifecycle_status,old.finished_at,old.lease_until,old.lease_token,old.cleanup_verified,old.attempt_id) then
   raise exception using errcode='23514',message='IMMUTABLE_SUBMISSION';
  end if;
  if new.code is distinct from old.code and not(new.code is null and old.lifecycle_status='COMPLETED' and old.response_expires_at<=clock_timestamp()) then
   raise exception using errcode='23514',message='IMMUTABLE_SUBMISSION';
  end if;
  if old.staged_result is not null and row(new.staged_result,new.staged_private_results) is distinct from row(old.staged_result,old.staged_private_results)
   and not(new.staged_result is null and new.staged_private_results is null and old.lifecycle_status='COMPLETED' and old.response_expires_at<=clock_timestamp()) then
   raise exception using errcode='23514',message='IMMUTABLE_SUBMISSION_RESULT';
  end if;
  if old.lifecycle_status='COMPLETED' and new.response_body is distinct from old.response_body
   and not(new.response_body is null and old.response_expires_at<=clock_timestamp()) then
   raise exception using errcode='23514',message='IMMUTABLE_SUBMISSION';
  end if;
  if new.lifecycle_status='COMPLETED' and not exists(select 1 from app.attempts a where a.id=new.attempt_id and a.execution_id=new.id and a.organization_id=new.organization_id) then
   raise exception using errcode='23514',message='SUBMISSION_ATTEMPT_MISMATCH';
  end if;
  if new.lifecycle_status='RECOVERING' then new.lease_until:=greatest(new.lease_until,new.admitted_at+interval '60 seconds'); end if;
 else
  if not exists(select 1 from app.activities a join app.activity_exercises ae on ae.organization_id=a.organization_id and ae.activity_id=a.id
   join app.operation_keys k on k.id=new.operation_id
   where a.id=new.activity_id and a.organization_id=new.organization_id and a.class_id=new.class_id
    and ae.id=new.activity_exercise_id and ae.exercise_version_id=new.exercise_version_id
    and k.organization_id=new.organization_id and k.actor_id=new.student_id and k.operation='practice.submit'
    and k.resource_id=new.id and k.resource_type='submission' and k.state='RUNNING')
   or new.code is null or new.code_hash<>encode(sha256(convert_to(new.code,'UTF8')),'hex') then
   raise exception using errcode='23514',message='SUBMISSION_CONTEXT_MISMATCH';
  end if;
 end if;
 return new;
end $$;
create trigger submissions_context before insert or update on app_private.submission_reservations
 for each row execute function app_private.guard_submission_context();

create function app_private.guard_attempt_context() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='IMMUTABLE_ATTEMPT'; end if;
 if not exists(select 1 from app_private.submission_reservations s where s.id=new.execution_id
  and row(s.organization_id,s.class_id,s.activity_id,s.activity_exercise_id,s.exercise_version_id,s.student_id,s.code,s.code_hash,s.test_suite_hash,s.attempt_number,s.previous_attempt_id,s.admitted_at,s.staged_result)
   is not distinct from row(new.organization_id,new.class_id,new.activity_id,new.activity_exercise_id,new.exercise_version_id,new.student_id,new.code,new.code_hash,new.test_suite_hash,new.attempt_number,new.previous_attempt_id,new.admitted_at,new.technical_result)
  and s.lifecycle_status<>'COMPLETED' and s.staged_result is not null) then
  raise exception using errcode='23514',message='ATTEMPT_CONTEXT_MISMATCH';
 end if;
 return new;
end $$;
create trigger attempts_context before insert or update or delete on app.attempts for each row execute function app_private.guard_attempt_context();
create function app_private.guard_attempt_event() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='IMMUTABLE_ATTEMPT_EVENT'; end if;
 if not exists(select 1 from app.attempts a where a.id=new.attempt_id
  and row(a.organization_id,a.class_id,a.activity_id,a.activity_exercise_id,a.exercise_version_id,a.student_id,a.submitted_at)
   is not distinct from row(new.organization_id,new.class_id,new.activity_id,new.activity_exercise_id,new.exercise_version_id,new.student_id,new.occurred_at)) then
  raise exception using errcode='23514',message='ATTEMPT_EVENT_CONTEXT_MISMATCH';
 end if;
 return new;
end $$;
create trigger attempt_events_context before insert or update or delete on app_private.attempt_events for each row execute function app_private.guard_attempt_event();

create function app_private.guard_attempt_result() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='IMMUTABLE_ATTEMPT_RESULT'; end if;
 if not exists(select 1 from app.attempts a join app_private.submission_reservations s on s.id=a.execution_id
  where a.id=new.attempt_id and a.organization_id=new.organization_id
   and s.runner_version=new.runner_version and s.test_suite_hash=new.test_suite_hash
   and s.staged_private_results=new.private_test_results) then
  raise exception using errcode='23514',message='ATTEMPT_RESULT_CONTEXT_MISMATCH';
 end if;
 return new;
end $$;
create trigger attempt_results_context before insert or update or delete on app_private.attempt_results for each row execute function app_private.guard_attempt_result();

create function app_private.submission_reservation_payload(s app_private.submission_reservations) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('executionId',s.id,'exerciseVersionId',s.exercise_version_id,'organizationId',s.organization_id,
  'studentId',s.student_id,'admittedAt',s.admitted_at,'leaseToken',s.lease_token,'visibleTotal',s.visible_total,'runnerVersion',s.runner_version,
  'testsVersion',s.test_suite_hash,'attemptNumber',s.attempt_number,'stagedResult',s.staged_result is not null)
$$;
create function app_private.attempt_payload(a app.attempts) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('attemptId',a.id,'executionId',a.execution_id,'activityId',a.activity_id,'assignmentId',a.activity_exercise_id,
  'exerciseVersionId',a.exercise_version_id,'testsVersion',a.test_suite_hash,'attemptNumber',a.attempt_number,'previousAttemptId',a.previous_attempt_id,
  'admittedAt',a.admitted_at,'submittedAt',a.submitted_at,'code',a.code,'technicalResult',a.technical_result)
$$;

create function app_private.admit_practice_submit(
 execution uuid, activity uuid, assignment uuid, version_id uuid, operation_key text,
 payload_digest text, source_code text, previous_attempt uuid, runtime_version text,
 correlation uuid, runner_available boolean, actor_concurrency integer, organization_concurrency integer, actor_frequency integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a record; k app.operation_keys%rowtype; s app_private.submission_reservations%rowtype;
 org uuid:=app_private.organization_id(); actor uuid:=app_private.actor_id(); ts timestamptz; op uuid:=gen_random_uuid(); token uuid:=gen_random_uuid();
 tests jsonb; visible_count integer; total_count integer; next_number integer;
begin
 if org is null or actor is null or not app_private.academic_role(org,array['STUDENT']) then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 if actor_concurrency is null or organization_concurrency is null or actor_frequency is null or operation_key is null
  or actor_concurrency not between 1 and 10 or organization_concurrency not between 1 and 32 or actor_frequency not between 1 and 120
  or operation_key !~ '^[A-Za-z0-9._:-]{8,128}$' or payload_digest is null or payload_digest !~ '^[a-f0-9]{64}$'
  or source_code is null or octet_length(source_code) not between 1 and 65536 then
  raise exception using errcode='22023',message='INVALID_SUBMIT_CONFIGURATION';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('practice.actor:'||actor::text,0));
 perform app_private.lock_academic_organization(org);
 select act.*,c.archived_at as class_archived_at,ae.exercise_version_id into a
  from app.activities act join app.classes c on c.id=act.class_id and c.organization_id=act.organization_id
  join app.activity_exercises ae on ae.activity_id=act.id and ae.organization_id=act.organization_id
  where act.id=activity and ae.id=assignment and act.organization_id=org
   and act.state in ('PUBLISHED','CLOSED') and app_private.academic_student(act.class_id);
 if not found then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 if a.exercise_version_id<>version_id then raise exception using errcode='P0001',message='VERSION_CONFLICT'; end if;
 select * into k from app.operation_keys where organization_id=org and actor_id=actor and operation='practice.submit' and key=operation_key for update;
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
 if previous_attempt is not null and not exists(select 1 from app.attempts p where p.id=previous_attempt
  and p.organization_id=org and p.student_id=actor and p.activity_exercise_id=assignment and p.exercise_version_id=version_id) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 if runner_available is distinct from true then raise exception using errcode='P0001',message='DEPENDENCY_UNAVAILABLE'; end if;
 if (select count(*) from app_private.submission_reservations where organization_id=org and student_id=actor and lifecycle_status<>'COMPLETED')>=actor_concurrency
  or ((select count(*) from app.executions where organization_id=org and lifecycle_status<>'COMPLETED')
      +(select count(*) from app_private.submission_reservations where organization_id=org and lifecycle_status<>'COMPLETED'))>=organization_concurrency
  or ((select count(*) from app.executions where organization_id=org and student_id=actor and admitted_at>ts-interval '1 minute')
      +(select count(*) from app_private.submission_reservations where organization_id=org and student_id=actor and admitted_at>ts-interval '1 minute'))>=actor_frequency then
  raise exception using errcode='P0001',message='RATE_LIMITED';
 end if;
 select jsonb_agg(jsonb_build_object('id',test_id,'visibility',visibility,'args',args,'expected',expected) order by position),
  count(*) filter(where visibility='visible'),count(*) into tests,visible_count,total_count
  from app_private.exercise_tests where organization_id=org and exercise_version_id=version_id;
 if visible_count<1 or total_count not between 1 and 8 then raise exception using errcode='23514',message='INVALID_SUBMIT_SUITE'; end if;
 select coalesce(max(attempt_number),0)+1 into next_number from app_private.submission_reservations
  where organization_id=org and student_id=actor and activity_exercise_id=assignment;
 insert into app.operation_keys(id,organization_id,actor_id,operation,key,payload_hash,state,resource_type,resource_id,expires_at,lease_until)
 values(op,org,actor,'practice.submit',operation_key,payload_digest,'RUNNING','submission',execution,ts+interval '24 hours',ts+interval '60 seconds');
 insert into app_private.submission_reservations(id,organization_id,class_id,activity_id,activity_exercise_id,exercise_version_id,student_id,operation_id,
  code,code_hash,test_suite_hash,limits_snapshot,runner_version,visible_total,total_required,attempt_number,previous_attempt_id,admitted_at,lease_until,lease_token,response_expires_at,request_id)
 values(execution,org,a.class_id,activity,assignment,version_id,actor,op,source_code,encode(sha256(convert_to(source_code,'UTF8')),'hex'),
  encode(sha256(convert_to(tests::text,'UTF8')),'hex'),'{"memoryBytes":134217728,"runtimeMs":3000,"outputBytes":65536}',runtime_version,
  visible_count,total_count,next_number,previous_attempt,ts,ts+interval '60 seconds',token,ts+interval '24 hours',correlation)
 returning * into s;
 return app_private.submission_reservation_payload(s)||jsonb_build_object('kind','reserved');
end $$;

create function app_private.load_practice_submit_suite(execution uuid,token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s app_private.submission_reservations%rowtype; tests jsonb;
begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 select * into s from app_private.submission_reservations where id=execution;
 if not found or token is distinct from s.lease_token or s.lifecycle_status<>'RUNNING' or s.lease_until<=clock_timestamp() then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS';
 end if;
 select jsonb_agg(jsonb_build_object('id',test_id,'visibility',visibility,'args',args,'expected',expected) order by position) into tests
  from app_private.exercise_tests where organization_id=s.organization_id and exercise_version_id=s.exercise_version_id;
 if encode(sha256(convert_to(tests::text,'UTF8')),'hex') is distinct from s.test_suite_hash then
  raise exception using errcode='23514',message='SUBMIT_SUITE_MISMATCH';
 end if;
 return jsonb_build_object('tests',tests,'testsVersion',s.test_suite_hash);
end $$;

-- Durable staging contains normalized evidence, never hidden args/expected/output.
create function app_private.stage_practice_submit_result(execution uuid,token uuid,technical_result jsonb,private_results jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare s app_private.submission_reservations%rowtype; hidden_count integer; hidden_complete boolean; expected_hidden jsonb; complete_pass boolean;
begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 select * into s from app_private.submission_reservations where id=execution for update;
 if not found or token is distinct from s.lease_token or s.lifecycle_status='COMPLETED' or s.lease_until<=clock_timestamp() then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS';
 end if;
 if technical_result is null or jsonb_typeof(technical_result)<>'object' or private_results is null or jsonb_typeof(private_results)<>'array' then
  raise exception using errcode='23514',message='INVALID_SUBMIT_RESULT';
 end if;
 if not(technical_result ?& array['runnerVersion','diagnosisCode','terminationReason','infrastructureStatus','visibleTestResults','visiblePassed','visibleTotal','outputTruncated','outputBytes','runtimeMs','lifecycleMs','hiddenChecksPassed','allRequiredPassed'])
  or (select count(*) from jsonb_object_keys(technical_result))<>13
  or exists(select 1 from jsonb_each(technical_result) x where
   (x.key in ('runnerVersion','diagnosisCode','terminationReason','infrastructureStatus') and jsonb_typeof(x.value)<>'string')
   or (x.key in ('visiblePassed','visibleTotal','outputBytes','runtimeMs','lifecycleMs') and jsonb_typeof(x.value)<>'number')
   or (x.key='visibleTestResults' and jsonb_typeof(x.value)<>'array')
   or (x.key in ('outputTruncated','allRequiredPassed') and jsonb_typeof(x.value)<>'boolean')
   or (x.key='hiddenChecksPassed' and jsonb_typeof(x.value) not in ('boolean','null'))) then
  raise exception using errcode='23514',message='INVALID_SUBMIT_RESULT';
 end if;
 if technical_result->>'runnerVersion'<>s.runner_version
  or technical_result->>'diagnosisCode' not in ('SUCCESS','SYNTAX_ERROR','RUNTIME_ERROR','FAILED_TEST','TIMEOUT','UNKNOWN')
  or technical_result->>'terminationReason' not in ('COMPLETED','STUDENT_SYNTAX','STUDENT_EXCEPTION','ASSERTION_FAILED','EXECUTION_DEADLINE','MEMORY_LIMIT','OUTPUT_LIMIT','RETURN_LIMIT','PROTOCOL_INVALID','RUNNER_FAILURE','PROVIDER_FAILURE','CAPABILITY_GAP','CANCELLED')
  or technical_result->>'infrastructureStatus' not in ('OK','FAILED')
  or (technical_result->>'visibleTotal')::numeric<>s.visible_total
  or jsonb_array_length(technical_result->'visibleTestResults')>s.visible_total
  or (technical_result->>'visiblePassed')::numeric not between 0 and s.visible_total
  or (technical_result->>'outputBytes')::numeric not between 0 and 65536
  or mod((technical_result->>'outputBytes')::numeric,1)<>0
  or (technical_result->>'runtimeMs')::numeric<0 or (technical_result->>'lifecycleMs')::numeric<0
  or (technical_result->>'infrastructureStatus'='FAILED' and technical_result->>'diagnosisCode'<>'UNKNOWN') then
  raise exception using errcode='23514',message='INVALID_SUBMIT_RESULT';
 end if;
 if exists(select 1 from jsonb_array_elements(technical_result->'visibleTestResults') t where jsonb_typeof(t)<>'object')
  or exists(select 1 from jsonb_array_elements(private_results) t where jsonb_typeof(t)<>'object') then
  raise exception using errcode='23514',message='INVALID_SUBMIT_RESULT';
 end if;
 if exists(select 1 from jsonb_array_elements(technical_result->'visibleTestResults') t where
  not(t ?& array['id','passed','stdout','stderr']) or (select count(*) from jsonb_object_keys(t))<>4
  or jsonb_typeof(t->'id')<>'string' or jsonb_typeof(t->'passed')<>'boolean'
  or jsonb_typeof(t->'stdout')<>'string' or jsonb_typeof(t->'stderr')<>'string'
  or not exists(select 1 from app_private.exercise_tests et where et.organization_id=s.organization_id and et.exercise_version_id=s.exercise_version_id and et.visibility='visible' and et.test_id=t->>'id'))
  or (select count(distinct t->>'id') from jsonb_array_elements(technical_result->'visibleTestResults') t)<>jsonb_array_length(technical_result->'visibleTestResults')
  or (select count(*) from jsonb_array_elements(technical_result->'visibleTestResults') t where t->'passed'='true'::jsonb)<>(technical_result->>'visiblePassed')::numeric
  or (select coalesce(sum(octet_length(t->>'stdout')+octet_length(t->>'stderr')),0) from jsonb_array_elements(technical_result->'visibleTestResults') t)>(technical_result->>'outputBytes')::numeric then
  raise exception using errcode='23514',message='INVALID_SUBMIT_RESULT';
 end if;
 hidden_count:=s.total_required-s.visible_total;
 if jsonb_array_length(private_results)>hidden_count
  or exists(select 1 from jsonb_array_elements(private_results) t where
   not(t ?& array['id','passed']) or (select count(*) from jsonb_object_keys(t))<>2
   or jsonb_typeof(t->'id')<>'string' or jsonb_typeof(t->'passed')<>'boolean'
   or not exists(select 1 from app_private.exercise_tests et where et.organization_id=s.organization_id and et.exercise_version_id=s.exercise_version_id and et.visibility='hidden' and et.test_id=t->>'id'))
  or (select count(distinct t->>'id') from jsonb_array_elements(private_results) t)<>jsonb_array_length(private_results) then
  raise exception using errcode='23514',message='INVALID_SUBMIT_RESULT';
 end if;
 hidden_complete:=hidden_count>0 and jsonb_array_length(private_results)=hidden_count and technical_result->>'diagnosisCode' in ('SUCCESS','FAILED_TEST');
 expected_hidden:=case when hidden_complete then to_jsonb(not exists(select 1 from jsonb_array_elements(private_results) t where t->'passed'='false'::jsonb)) else 'null'::jsonb end;
 complete_pass:=jsonb_array_length(private_results)=hidden_count
  and jsonb_array_length(technical_result->'visibleTestResults')=s.visible_total
  and (technical_result->>'visiblePassed')::numeric=s.visible_total
  and not exists(select 1 from jsonb_array_elements(private_results) t where t->'passed'='false'::jsonb)
  and technical_result->>'infrastructureStatus'='OK' and technical_result->>'terminationReason'='COMPLETED'
  and technical_result->'outputTruncated'='false'::jsonb;
 if technical_result->'hiddenChecksPassed' is distinct from expected_hidden
  or technical_result->'allRequiredPassed' is distinct from to_jsonb(complete_pass)
  or (technical_result->>'diagnosisCode'='SUCCESS') is distinct from complete_pass
  or (technical_result->>'diagnosisCode'='FAILED_TEST' and (
   jsonb_array_length(private_results)<>hidden_count or jsonb_array_length(technical_result->'visibleTestResults')<>s.visible_total
   or technical_result->>'infrastructureStatus'<>'OK' or technical_result->>'terminationReason'<>'ASSERTION_FAILED'
   or technical_result->'outputTruncated'<>'false'::jsonb
   or not exists(select 1 from jsonb_array_elements(private_results||(technical_result->'visibleTestResults')) t where t->'passed'='false'::jsonb))) then
  raise exception using errcode='23514',message='INVALID_SUBMIT_RESULT';
 end if;
 if s.staged_result is not null then
  if row(s.staged_result,s.staged_private_results) is distinct from row(technical_result,private_results) then
   raise exception using errcode='23514',message='IMMUTABLE_SUBMISSION_RESULT';
  end if;
  return true;
 end if;
 update app_private.submission_reservations set staged_result=technical_result,staged_private_results=private_results where id=s.id;
 return true;
end $$;

create function app_private.finish_practice_submit(execution uuid,token uuid,cleaned boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s app_private.submission_reservations%rowtype; a app.attempts%rowtype; response jsonb; ts timestamptz:=clock_timestamp();
begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 select * into s from app_private.submission_reservations where id=execution for update;
 if not found or token is distinct from s.lease_token or s.lifecycle_status='COMPLETED' or s.lease_until<=ts then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS';
 end if;
 if cleaned is distinct from true then
  update app_private.submission_reservations set lifecycle_status='RECOVERING',lease_until=greatest(ts+interval '15 seconds',s.admitted_at+interval '60 seconds'),lease_token=gen_random_uuid() where id=s.id;
  return null;
 end if;
 if s.staged_result is null then raise exception using errcode='23514',message='SUBMIT_RESULT_REQUIRED'; end if;
 insert into app.attempts(execution_id,organization_id,class_id,activity_id,activity_exercise_id,exercise_version_id,student_id,
  code,code_hash,test_suite_hash,attempt_number,previous_attempt_id,admitted_at,submitted_at,technical_result)
 values(s.id,s.organization_id,s.class_id,s.activity_id,s.activity_exercise_id,s.exercise_version_id,s.student_id,
  s.code,s.code_hash,s.test_suite_hash,s.attempt_number,s.previous_attempt_id,s.admitted_at,ts,s.staged_result) returning * into a;
 insert into app_private.attempt_results(attempt_id,organization_id,runner_version,test_suite_hash,private_test_results)
 values(a.id,s.organization_id,s.runner_version,s.test_suite_hash,s.staged_private_results);
 insert into app_private.attempt_events(organization_id,class_id,activity_id,activity_exercise_id,exercise_version_id,student_id,attempt_id,event_type,occurred_at)
 select s.organization_id,s.class_id,s.activity_id,s.activity_exercise_id,s.exercise_version_id,s.student_id,a.id,event_type,ts
  from unnest(array['ATTEMPT_SUBMITTED','EXECUTION_COMPLETED']) event_type;
 response:=app_private.attempt_payload(a);
 update app_private.submission_reservations set lifecycle_status='COMPLETED',finished_at=ts,lease_until=null,response_body=response,cleanup_verified=true,attempt_id=a.id where id=s.id;
 update app.operation_keys set state='COMPLETED',resource_type='attempt',resource_id=a.id,response_status=201,response_body=response,lease_until=null,updated_at=ts where id=s.operation_id;
 return response;
end $$;

create function app_private.claim_expired_practice_submit() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s app_private.submission_reservations%rowtype; ts timestamptz:=clock_timestamp();
begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 select * into s from app_private.submission_reservations where lifecycle_status<>'COMPLETED' and lease_until<=ts order by lease_until,id for update skip locked limit 1;
 if not found then return null; end if;
 update app_private.submission_reservations set lifecycle_status='RECOVERING',lease_token=gen_random_uuid(),lease_until=ts+interval '60 seconds' where id=s.id returning * into s;
 return app_private.submission_reservation_payload(s);
end $$;

create function app_private.purge_submit_responses() returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare removed integer;
begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 with due as(select id from app_private.submission_reservations where lifecycle_status='COMPLETED' and response_expires_at<=clock_timestamp()
  and (response_body is not null or code is not null) order by response_expires_at,id for update skip locked limit 200)
 update app_private.submission_reservations s set response_body=null,code=null,staged_result=null,staged_private_results=null from due where s.id=due.id;
 get diagnostics removed=row_count;
 with due as(select id from app.operation_keys where operation='practice.submit' and response_body is not null and expires_at<=clock_timestamp() order by expires_at,id for update skip locked limit 200)
 update app.operation_keys k set response_body=null from due where k.id=due.id;
 return removed;
end $$;

-- Invoker functions read only public attempt columns under the caller's RLS.
create function app_private.read_practice_attempt(attempt uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 select app_private.attempt_payload(a) from app.attempts a where a.id=attempt
$$;
create function app_private.list_practice_attempts(activity uuid,assignment uuid,before_number bigint,fetch_limit integer) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare entries jsonb; remaining boolean;
begin
 if fetch_limit is null or fetch_limit not between 1 and 20 or (before_number is not null and before_number<1) then
  raise exception using errcode='22023',message='INVALID_PAGINATION';
 end if;
 if not exists(select 1 from app.activities a join app.activity_exercises ae on ae.activity_id=a.id and ae.organization_id=a.organization_id
  where a.id=activity and ae.id=assignment and app_private.academic_student(a.class_id)) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 select coalesce(jsonb_agg(app_private.attempt_payload(q::app.attempts)-'code' order by q.attempt_number desc),'[]'::jsonb) into entries
  from (select a.* from app.attempts a where a.activity_id=activity and a.activity_exercise_id=assignment
   and (before_number is null or a.attempt_number<before_number) order by a.attempt_number desc limit fetch_limit) q;
 remaining:=jsonb_array_length(entries)=fetch_limit and exists(select 1 from app.attempts a where a.activity_id=activity and a.activity_exercise_id=assignment
  and a.attempt_number<(entries->-1->>'attemptNumber')::bigint);
 return jsonb_build_object('items',entries,'nextCursor',case when remaining then entries->-1->>'attemptNumber' else null end);
end $$;

create function app_private.practice_activity_progress(activity uuid) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare required_count integer; completed_count integer; any_attempt boolean;
begin
 if not exists(select 1 from app.activities a where a.id=activity and app_private.academic_student(a.class_id)) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 select count(*),count(*) filter(where exists(select 1 from app.attempts a
  where a.activity_id=activity and a.activity_exercise_id=ae.id and a.exercise_version_id=ae.exercise_version_id and a.technical_result->'allRequiredPassed'='true'::jsonb))
  into required_count,completed_count from app.activity_exercises ae where ae.activity_id=activity and ae.required;
 select exists(select 1 from app.attempts a where a.activity_id=activity) into any_attempt;
 return jsonb_build_object('activityId',activity,'completed',completed_count,'required',required_count,
  'ratio',case when required_count=0 then null else completed_count::numeric/required_count end,
  'evidenceState',case when required_count=0 then 'NO_REQUIRED_EXERCISES' when not any_attempt then 'NO_ATTEMPTS' else 'HAS_EVIDENCE' end,
  'asOf',statement_timestamp());
end $$;

-- Applied RUN functions belong to the helper role, not the migration role.
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
set role alunza_identity;
create or replace function app_private.guard_organization_practice_runs() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if exists(select 1 from app.executions where organization_id=old.id and lifecycle_status in ('RUNNING','RECOVERING'))
  or exists(select 1 from app_private.submission_reservations where organization_id=old.id and lifecycle_status in ('RUNNING','RECOVERING')) then
  raise exception using errcode='P0001',message='DEPENDENCIES_ACTIVE';
 end if;
 return new;
end $$;
reset role;
create function app_private.guard_class_submissions() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if exists(select 1 from app_private.submission_reservations where class_id=old.id and lifecycle_status in ('RUNNING','RECOVERING')) then
  raise exception using errcode='P0001',message='DEPENDENCIES_ACTIVE';
 end if;
 return new;
end $$;
create trigger guard_class_submissions before update of archived_at on app.classes
 for each row when (old.archived_at is null and new.archived_at is not null) execute function app_private.guard_class_submissions();

-- RUN and SUBMIT use the same organization and per-minute admission totals.
set role alunza_identity;
create or replace function app_private.admit_practice_run(
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
  or ((select count(*) from app.executions where organization_id=org and lifecycle_status<>'COMPLETED')+(select count(*) from app_private.submission_reservations where organization_id=org and lifecycle_status<>'COMPLETED'))>=organization_concurrency
  or ((select count(*) from app.executions where organization_id=org and student_id=actor and admitted_at>ts-interval '1 minute')+(select count(*) from app_private.submission_reservations where organization_id=org and student_id=actor and admitted_at>ts-interval '1 minute'))>=actor_frequency then
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
reset role;

grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
do $$ declare fn regprocedure; begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'
  and p.proname in ('guard_submission_context','guard_attempt_context','guard_attempt_event','guard_attempt_result','submission_reservation_payload','attempt_payload',
   'admit_practice_submit','load_practice_submit_suite','stage_practice_submit_result','finish_practice_submit','claim_expired_practice_submit',
   'purge_submit_responses','read_practice_attempt','list_practice_attempts','practice_activity_progress','guard_class_submissions') loop
  execute format('alter function %s owner to alunza_identity',fn);
 end loop;
end $$;
set role alunza_identity;
do $$ declare fn regprocedure; fn_name text; begin
 for fn,fn_name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'
  and p.proname in ('guard_submission_context','guard_attempt_context','guard_attempt_event','guard_attempt_result','submission_reservation_payload','attempt_payload',
   'admit_practice_submit','load_practice_submit_suite','stage_practice_submit_result','finish_practice_submit','claim_expired_practice_submit',
   'purge_submit_responses','read_practice_attempt','list_practice_attempts','practice_activity_progress','guard_class_submissions') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',fn);
  if fn_name not like 'guard_%' and fn_name<>'submission_reservation_payload' then execute format('grant execute on function %s to alunza_app',fn); end if;
 end loop;
end $$;
reset role;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
