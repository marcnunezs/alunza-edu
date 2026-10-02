begin;
grant alunza_app to postgres;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to alunza_app;
do $$ declare r regprocedure; begin
 for r in select p.oid::regprocedure from pg_proc p join pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid join pg_extension e on d.refclassid='pg_extension'::regclass and e.oid=d.refobjid where e.extname='pgtap'
 loop execute format('grant execute on function %s to alunza_app',r); end loop;
end $$;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at)
select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'academic-'||n||'@alunza.test',now() from generate_series(1,5) n;
insert into auth.sessions(id,user_id)
select ('91100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,5) n;
insert into app.profiles(id,display_name,email_normalized,account_state)
select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Academic '||n,'academic-'||n||'@alunza.test','ACTIVE' from generate_series(1,5) n;
insert into app.organizations(id,code,name) values ('92000000-0000-4000-8000-000000000001','ACA-A','Academic A'),('92000000-0000-4000-8000-000000000002','ACA-B','Academic B');
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at) values
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','ADMIN','ACTIVE',now()),
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','TEACHER','ACTIVE',now()),
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003','STUDENT','ACTIVE',now()),
('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000004','TEACHER','ACTIVE',now()),
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000005','TEACHER','ACTIVE',now());
insert into app.courses(id,organization_id,code,name,academic_period) values
('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','P1','Programming','2026-2'),
('93000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','P1','Foreign','2026-2');
insert into app.course_teacher_grants(organization_id,course_id,teacher_id,granted_by) values
('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001');
insert into app.classes(id,organization_id,course_id,teacher_id,code,name) values
('94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','A1','Own class'),
('94000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000005','A2','Other class'),
('94000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000004','B1','Foreign class');
insert into app.class_memberships(organization_id,class_id,user_id) values('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003');
insert into app.class_join_codes(organization_id,class_id,token_digest,expires_at,created_by) values
('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002',repeat('a',64),now()+interval '1 day','91000000-0000-4000-8000-000000000005'),
('92000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000003',repeat('b',64),now()+interval '1 day','91000000-0000-4000-8000-000000000004');
insert into app.concept_tags(id,organization_id,normalized_name) values('95000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','addition');
insert into app.concept_versions(id,organization_id,concept_id,version,name,description,created_by) values
('95100000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001',1,'Addition','Addition','91000000-0000-4000-8000-000000000001');
update app.concept_tags set current_version_id='95100000-0000-4000-8000-000000000001' where id='95000000-0000-4000-8000-000000000001';
insert into app.exercises(id,organization_id,owner_id) values('96000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002');
insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) values
('96100000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001',1,'Sum','Return sum','module.exports.solve=(a,b)=>a+b;','BEGINNER','91000000-0000-4000-8000-000000000002');
insert into app.exercise_version_concepts values('92000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000001','95100000-0000-4000-8000-000000000001');
insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) values
('92000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000001','visible',0,'visible','[1,2]','3'),
('92000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000001','hidden-sentinel',1,'hidden','[2,2]','4');
update app.exercises set current_version_id='96100000-0000-4000-8000-000000000001' where id='96000000-0000-4000-8000-000000000001';
insert into app.activities(id,organization_id,class_id,created_by,title,type) values
('97000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','Published','FORMATIVE'),
('97000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','Draft','FORMATIVE');
insert into app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position) values('98000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000001',0);
update app.activities set state='PUBLISHED' where id='97000000-0000-4000-8000-000000000001';
set constraints all immediate;

-- Four additional students exercise the shared organization quota without
-- relying on an in-memory semaphore or bypassing the personal quota.
insert into auth.users(id,email,email_confirmed_at)
select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'academic-'||n||'@alunza.test',now() from generate_series(6,9) n;
insert into auth.sessions(id,user_id)
select ('91100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(6,9) n;
insert into app.profiles(id,display_name,email_normalized,account_state)
select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Academic '||n,'academic-'||n||'@alunza.test','ACTIVE' from generate_series(6,9) n;
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at)
select '92000000-0000-4000-8000-000000000001',('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'STUDENT','ACTIVE',now() from generate_series(6,9) n;
insert into app.class_memberships(organization_id,class_id,user_id)
select '92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001',('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(6,9) n;

-- Helpers exist only inside this rolled-back fixture, never in application DDL.
create function pg_temp.sid(n integer) returns uuid language sql immutable as $$
 select ('99100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.submit_token(n integer) returns uuid language sql security definer as $$
 select lease_token from app_private.submission_reservations where id=pg_temp.sid(n)
$$;
create function pg_temp.admit_submit(n integer,operation_key text,payload text default repeat('a',64),frequency integer default 10,previous_attempt uuid default null) returns jsonb language sql as $$
 select app_private.admit_practice_submit(pg_temp.sid(n),'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',
 '96100000-0000-4000-8000-000000000001',operation_key,payload,'module.exports.solve=(a,b)=>a+b;',previous_attempt,'sql-test','99000000-0000-4000-8000-000000000001',true,2,4,frequency)
$$;
create function pg_temp.submit_result(outcome text default 'SUCCESS') returns jsonb language sql as $$
 select case when outcome='UNKNOWN' then
 '{"runnerVersion":"sql-test","diagnosisCode":"UNKNOWN","terminationReason":"RUNNER_FAILURE","infrastructureStatus":"FAILED","visibleTestResults":[],"visiblePassed":0,"visibleTotal":1,"outputTruncated":false,"outputBytes":0,"runtimeMs":0,"lifecycleMs":0,"hiddenChecksPassed":null,"allRequiredPassed":false}'::jsonb
 else jsonb_build_object('runnerVersion','sql-test','diagnosisCode',outcome,'terminationReason',case when outcome='SUCCESS' then 'COMPLETED' else 'ASSERTION_FAILED' end,
 'infrastructureStatus','OK','visibleTestResults','[{"id":"visible","passed":true,"stdout":"","stderr":""}]'::jsonb,'visiblePassed',1,'visibleTotal',1,'outputTruncated',false,
 'outputBytes',0,'runtimeMs',10,'lifecycleMs',20,'hiddenChecksPassed',outcome='SUCCESS','allRequiredPassed',outcome='SUCCESS') end
$$;
create function pg_temp.stage_submit(n integer,outcome text default 'SUCCESS') returns boolean language plpgsql as $$
declare actor text:=current_setting('app.actor_id',true); session text:=current_setting('app.session_id',true); result boolean;
begin
 perform set_config('app.actor_id','',true),set_config('app.session_id','',true);
 result:=app_private.stage_practice_submit_result(pg_temp.sid(n),pg_temp.submit_token(n),pg_temp.submit_result(outcome),
  case when outcome='UNKNOWN' then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id','hidden-sentinel','passed',outcome='SUCCESS')) end);
 perform set_config('app.actor_id',coalesce(actor,''),true),set_config('app.session_id',coalesce(session,''),true);
 return result;
end $$;
create function pg_temp.finish_submit(n integer,cleaned boolean default true) returns jsonb language plpgsql as $$
declare actor text:=current_setting('app.actor_id',true); session text:=current_setting('app.session_id',true); result jsonb;
begin
 perform set_config('app.actor_id','',true),set_config('app.session_id','',true);
 result:=app_private.finish_practice_submit(pg_temp.sid(n),pg_temp.submit_token(n),cleaned);
 perform set_config('app.actor_id',coalesce(actor,''),true),set_config('app.session_id',coalesce(session,''),true);
 return result;
end $$;

select ok(not has_table_privilege('authenticated','app.attempts','select'),'Browser cannot read attempts directly');
select ok(not has_table_privilege('alunza_app','app_private.submission_reservations','select,insert,update,delete'),'Runtime has no direct private reservation access');
select ok(not has_table_privilege('alunza_app','app_private.attempt_results','select,insert,update,delete'),'Private canonical results are not public');
select ok(not has_table_privilege('alunza_app','app.attempts','insert,update,delete'),'Runtime cannot forge or mutate attempts');
select ok(not has_function_privilege('authenticated','app_private.load_practice_submit_suite(uuid,uuid)','execute'),'Browser cannot load hidden suite');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('app.attempts'::regclass,'app_private.submission_reservations'::regclass,'app_private.attempt_results'::regclass,'app_private.attempt_events'::regclass)),'All submission tables force RLS');
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
set local app.organization_id='92000000-0000-4000-8000-000000000001';
select is(app_private.practice_activity_progress('97000000-0000-4000-8000-000000000001')->>'evidenceState','NO_ATTEMPTS','Required exercise without attempts remains distinct');
select is(app_private.list_practice_attempts('97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',null,10)->'items','[]'::jsonb,'History starts empty');
select is(pg_temp.admit_submit(1,'submit-key-0001')->>'kind','reserved','First confirmed submission is admitted durably');
select is(pg_temp.admit_submit(2,'submit-key-0002')->>'attemptNumber','2','Second intentional concurrent submission has a stable number');
select throws_ok($$select pg_temp.admit_submit(3,'submit-key-0003')$$,'P0001','RATE_LIMITED','Third concurrent submit exceeds actor quota');
select throws_ok($$select pg_temp.admit_submit(3,'submit-key-0001',repeat('b',64))$$,'P0001','IDEMPOTENCY_CONFLICT','Same key with changed payload conflicts');
select throws_ok($$select pg_temp.admit_submit(3,'submit-key-0001')$$,'P0001','REQUEST_IN_PROGRESS','Transport duplicate cannot create another reservation');
select is((select count(*)::integer from app.attempts),0,'Reservations are not attempts');
select is((select count(*)::integer from app_private.exercise_tests),1,'Student still reads only visible tests');
select throws_ok($$select app_private.load_practice_submit_suite(pg_temp.sid(1),pg_temp.submit_token(1))$$,'42501','FORBIDDEN','Actor context cannot invoke internal suite loader');
select throws_ok($$select app_private.claim_expired_practice_submit()$$,'42501','FORBIDDEN','Actor context cannot claim another job');
select throws_ok($$insert into app.operation_keys(organization_id,actor_id,operation,key,payload_hash,state) values('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003','practice.submit','forged-key-0001',repeat('a',64),'RUNNING')$$,'42501',null,'Direct operation forgery is blocked');
select is(app_private.admit_practice_run(pg_temp.sid(10),'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000001',
 'mixed-run-0010',repeat('a',64),repeat('b',64),repeat('c',64),1,'sql-test','99000000-0000-4000-8000-000000000001',true,1,4,10)->>'kind','reserved','One RUN can coexist with two SUBMIT subject to shared quota');
select throws_ok($$select pg_temp.admit_submit(3,'frequency-key-0003',repeat('a',64),3)$$,'P0001','RATE_LIMITED','Submission frequency includes RUN admissions');
set local app.actor_id='91000000-0000-4000-8000-000000000006';
set local app.session_id='91100000-0000-4000-8000-000000000006';
select is(pg_temp.admit_submit(4,'submit-key-0004')->>'kind','reserved','Fourth combined organization slot can be admitted');
set local app.actor_id='91000000-0000-4000-8000-000000000007';
set local app.session_id='91100000-0000-4000-8000-000000000007';
select throws_ok($$select pg_temp.admit_submit(5,'submit-key-0005')$$,'P0001','RATE_LIMITED','Organization quota combines RUN and SUBMIT');
select throws_ok($$select app_private.admit_practice_run(pg_temp.sid(11),'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000001','mixed-run-0011',repeat('a',64),repeat('b',64),repeat('c',64),1,'sql-test','99000000-0000-4000-8000-000000000001',true,1,4,10)$$,'P0001','RATE_LIMITED','RUN also enforces shared organization quota');
set local app.actor_id='';
set local app.session_id='';
select is(jsonb_array_length(app_private.load_practice_submit_suite(pg_temp.sid(1),pg_temp.submit_token(1))->'tests'),2,'Fenced internal loader returns complete associated suite');
select throws_ok($$select app_private.load_practice_submit_suite(pg_temp.sid(1),null)$$,'P0001','REQUEST_IN_PROGRESS','Null token cannot obtain suite');
select throws_ok($$select app_private.stage_practice_submit_result(pg_temp.sid(1),pg_temp.submit_token(1),pg_temp.submit_result(),'[]')$$,'23514','INVALID_SUBMIT_RESULT','Success without hidden evidence is rejected');
select throws_ok($$select app_private.stage_practice_submit_result(pg_temp.sid(1),pg_temp.submit_token(1),pg_temp.submit_result('FAILED_TEST')||'{"hiddenChecksPassed":null}'::jsonb,'[]')$$,'23514','INVALID_SUBMIT_RESULT','FAILED_TEST cannot claim a complete verdict from an incomplete suite');
select throws_ok($$select app_private.stage_practice_submit_result(pg_temp.sid(1),pg_temp.submit_token(1),pg_temp.submit_result(),'[{"id":"visible","passed":true}]')$$,'23514','INVALID_SUBMIT_RESULT','Private evidence cannot relabel visible test');
select throws_ok($$select app_private.stage_practice_submit_result(pg_temp.sid(1),pg_temp.submit_token(1),pg_temp.submit_result(),'[{"id":"hidden-sentinel","passed":true,"stdout":"secret"}]')$$,'23514','INVALID_SUBMIT_RESULT','Private evidence refuses hidden console');
select throws_ok($$select app_private.finish_practice_submit(pg_temp.sid(1),pg_temp.submit_token(1),true)$$,'23514','SUBMIT_RESULT_REQUIRED','Missing durable result cannot become an attempt');
select ok(pg_temp.stage_submit(1,'FAILED_TEST'),'Full suite hidden failure is staged');
select throws_ok($$select pg_temp.stage_submit(1,'SUCCESS')$$,'23514','IMMUTABLE_SUBMISSION_RESULT','Staged canonical evidence cannot be overwritten');
select is(pg_temp.finish_submit(1)->'technicalResult'->>'diagnosisCode','FAILED_TEST','Hidden failure persists FAILED_TEST');
reset role;
select is((select count(*)::integer from app_private.attempt_events where organization_id='92000000-0000-4000-8000-000000000001'),2,'One commit stores both canonical semantic events');
select is((select count(*)::integer from app_private.attempt_results where organization_id='92000000-0000-4000-8000-000000000001'),1,'One commit stores private canonical evidence');
select set_config('test.first_attempt',(select id::text from app.attempts where execution_id=pg_temp.sid(1)),true);
select throws_ok($$update app.attempts set code='mutated' where execution_id=pg_temp.sid(1)$$,'23514','IMMUTABLE_ATTEMPT','Confirmed source is immutable even with table privileges');
select throws_ok($$delete from app_private.attempt_results where attempt_id=current_setting('test.first_attempt')::uuid$$,'23514','IMMUTABLE_ATTEMPT_RESULT','Private canonical evidence cannot be deleted');
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
select is(app_private.practice_activity_progress('97000000-0000-4000-8000-000000000001')->>'completed','0','Visible success with hidden failure does not complete exercise');
select is(app_private.read_practice_attempt(current_setting('test.first_attempt')::uuid)->>'code','module.exports.solve=(a,b)=>a+b;','Authorized history recovers immutable submitted source');
select ok(app_private.read_practice_attempt(current_setting('test.first_attempt')::uuid)::text not like '%hidden-sentinel%','Public attempt excludes hidden identifiers');
select ok(pg_temp.stage_submit(2),'Success with complete evidence stages');
select is(pg_temp.finish_submit(2)->>'attemptNumber','2','Second result confirms its admission order');
select is(app_private.practice_activity_progress('97000000-0000-4000-8000-000000000001')->>'completed','1','Full required suite completes one assignment');
select is((app_private.practice_activity_progress('97000000-0000-4000-8000-000000000001')->>'ratio')::numeric,1::numeric,'Ratio derives from exact completed and required counts');
select is(jsonb_array_length(app_private.list_practice_attempts('97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',null,1)->'items'),1,'History honors bounded page size');
select is(app_private.list_practice_attempts('97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',null,1)->>'nextCursor','2','History cursor uses stable admission order');
select is(app_private.list_practice_attempts('97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',2,1)->'items'->0->>'attemptNumber','1','Exclusive cursor returns next older attempt');
select ok(not (app_private.list_practice_attempts('97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',null,1)->'items'->0 ? 'code'),'History summaries omit source');
select is(pg_temp.admit_submit(99,'submit-key-0001')->'response'->>'attemptId',current_setting('test.first_attempt'),'Lost response repeats exactly the first persisted attempt');
select throws_ok($$select pg_temp.admit_submit(5,'frequency-key-0005',repeat('a',64),3)$$,'P0001','RATE_LIMITED','Shared frequency still counts completed submissions and RUN');
select is(pg_temp.admit_submit(5,'submit-key-0005',repeat('a',64),10,current_setting('test.first_attempt')::uuid)->>'kind','reserved','Explicit retry links to original own attempt');
select ok(pg_temp.stage_submit(5,'FAILED_TEST'),'Later failing retry stages independently');
select is(pg_temp.finish_submit(5)->>'previousAttemptId',current_setting('test.first_attempt'),'Retry preserves original ID without overwriting');
select is(app_private.practice_activity_progress('97000000-0000-4000-8000-000000000001')->>'completed','1','Later failure does not erase an earlier success');
set local app.actor_id='91000000-0000-4000-8000-000000000006';
set local app.session_id='91100000-0000-4000-8000-000000000006';
select is(app_private.read_practice_attempt(current_setting('test.first_attempt')::uuid),null::jsonb,'Another student cannot read code or result');
select throws_ok($$select pg_temp.admit_submit(6,'foreign-retry-0006',repeat('a',64),10,current_setting('test.first_attempt')::uuid)$$,'P0001','RESOURCE_NOT_FOUND','Retry cannot link another students attempt');
set local app.actor_id='91000000-0000-4000-8000-000000000001';
set local app.session_id='91100000-0000-4000-8000-000000000001';
select is((select count(*)::integer from app.attempts),0,'ADMIN governance does not imply pedagogical read');
set local app.actor_id='91000000-0000-4000-8000-000000000002';
set local app.session_id='91100000-0000-4000-8000-000000000002';
select is((select count(*)::integer from app.attempts),0,'Teacher follow-up is not implicitly implemented by this student endpoint');
set local app.actor_id='91000000-0000-4000-8000-000000000004';
set local app.session_id='91100000-0000-4000-8000-000000000004';
set local app.organization_id='92000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from app.attempts),0,'Foreign organization cannot obtain attempt evidence');
set local app.actor_id='';
set local app.session_id='';
set local app.organization_id='';
select ok(pg_temp.stage_submit(4),'Recovery fixture stages complete evidence before commit');
select set_config('test.old_submit_token',pg_temp.submit_token(4)::text,true);
reset role;
update app_private.submission_reservations set lease_until=clock_timestamp()-interval '1 second' where id=pg_temp.sid(4);
set local role alunza_app;
select is(app_private.claim_expired_practice_submit()->>'stagedResult','true','Reconciler discovers durable evidence rather than rerunning');
select is(app_private.claim_expired_practice_submit(),null::jsonb,'Second claimant cannot take live lease');
select throws_ok($$select app_private.finish_practice_submit(pg_temp.sid(4),current_setting('test.old_submit_token')::uuid,true)$$,'P0001','REQUEST_IN_PROGRESS','Old token is fenced after recovery claims');
select is(pg_temp.finish_submit(4)->'technicalResult'->>'diagnosisCode','SUCCESS','Recovery commits original normalized result');
reset role;
select is((select count(*)::integer from app_private.attempt_events where organization_id='92000000-0000-4000-8000-000000000001'),8,'Four attempts own exactly two events each');

-- Atomic commit failure leaves only reservation/staged result, no orphan facts.
create function pg_temp.fail_submit_commit() returns trigger language plpgsql as $$
begin
 if new.execution_id=pg_temp.sid(6) then raise exception 'INJECTED_COMMIT_FAILURE'; end if;
 return new;
end $$;
create trigger injected_submit_failure before insert on app.attempts for each row execute function pg_temp.fail_submit_commit();
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
set local app.organization_id='92000000-0000-4000-8000-000000000001';
select is(pg_temp.admit_submit(6,'submit-key-0006')->>'kind','reserved','Fault fixture reserves its own operation');
select ok(pg_temp.stage_submit(6,'UNKNOWN'),'Operational unknown is explicit evidence without completion');
select throws_ok($$select pg_temp.finish_submit(6)$$,'P0001','INJECTED_COMMIT_FAILURE','Commit failure is surfaced, never successful response');
reset role;
select is((select count(*)::integer from app.attempts where execution_id=pg_temp.sid(6)),0,'Failed commit creates no partial attempt');
select is((select count(*)::integer from app_private.attempt_events where organization_id='92000000-0000-4000-8000-000000000001'),8,'Failed commit creates no orphan events');
select ok((select staged_result is not null and attempt_id is null from app_private.submission_reservations where id=pg_temp.sid(6)),'Failed final commit retains durable normalized result');
drop trigger injected_submit_failure on app.attempts;
set local role alunza_app;
select is(pg_temp.finish_submit(6,false),null::jsonb,'Unverified cleanup defers finalization');
reset role;
select ok((select lease_until>=admitted_at+interval '60 seconds' from app_private.submission_reservations where id=pg_temp.sid(6)),'Uncertain capsule creation preserves original admission grace');
set local role alunza_app;
set local app.actor_id='';
set local app.session_id='';
select is(app_private.claim_expired_practice_submit(),null::jsonb,'Recovery cannot reclaim before fixed admission grace');
select is(pg_temp.finish_submit(6)->'technicalResult'->>'diagnosisCode','UNKNOWN','Confirmed cleanup allows durable UNKNOWN without false completion');
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
select is(pg_temp.admit_submit(7,'submit-key-0007')->>'kind','reserved','Submission admitted before closure is durable');
select ok(pg_temp.stage_submit(7),'Before-close result stages');
reset role;
update app.activities set state='CLOSED' where id='97000000-0000-4000-8000-000000000001';
select throws_ok($$update app.classes set archived_at=clock_timestamp() where id='94000000-0000-4000-8000-000000000001'$$,'P0001','DEPENDENCIES_ACTIVE','Class archive cannot interrupt active SUBMIT');
set local role alunza_app;
select throws_ok($$select pg_temp.admit_submit(8,'submit-key-0008')$$,'P0001','ACTIVITY_CLOSED','Server closure rejects new admissions');
select is(pg_temp.finish_submit(7)->'technicalResult'->>'diagnosisCode','SUCCESS','Admission preceding closure persists afterward');
select is(pg_temp.admit_submit(99,'submit-key-0007')->>'kind','replay','Closure preserves currently authorized replay');
reset role;
update app.organization_memberships set state='DISABLED' where user_id='91000000-0000-4000-8000-000000000003';
set local role alunza_app;
select is(app_private.read_practice_attempt(current_setting('test.first_attempt')::uuid),null::jsonb,'Revocation with same session hides historic source');
select throws_ok($$select pg_temp.admit_submit(99,'submit-key-0007')$$,'42501','FORBIDDEN','Replay cannot bypass revoked authorization');
reset role;
update app.organization_memberships set state='ACTIVE' where user_id='91000000-0000-4000-8000-000000000003';

-- Boundary-only fixture: publication still rejects zero required exercises.
savepoint no_required_boundary;
alter table app.activity_exercises disable trigger user;
update app.activity_exercises set required=false where id='98000000-0000-4000-8000-000000000001';
alter table app.activity_exercises enable trigger user;
set local role alunza_app;
select is(app_private.practice_activity_progress('97000000-0000-4000-8000-000000000001')->>'evidenceState','NO_REQUIRED_EXERCISES','0/0 has its own non-error state');
select is(app_private.practice_activity_progress('97000000-0000-4000-8000-000000000001')->'ratio','null'::jsonb,'0/0 has no proportion');
rollback to savepoint no_required_boundary;

-- Expired operational snapshots may be purged, canonical evidence survives.
alter table app_private.submission_reservations disable trigger user;
update app_private.submission_reservations set response_expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.sid(1);
alter table app_private.submission_reservations enable trigger user;
update app.operation_keys set expires_at=clock_timestamp()-interval '1 second' where operation='practice.submit' and key='submit-key-0001';
set local role alunza_app;
select throws_ok($$select pg_temp.admit_submit(99,'submit-key-0001')$$,'P0001','IDEMPOTENCY_EXPIRED','Expired key is a tombstone, never a second submission');
set local app.actor_id='';
set local app.session_id='';
select is(app_private.purge_submit_responses(),1,'One expired redundant snapshot is purged');
reset role;
select ok((select code is null and staged_result is null and staged_private_results is null and response_body is null from app_private.submission_reservations where id=pg_temp.sid(1)),'Operational source/evidence/response are removed together');
select is((select private_test_results->0->>'id' from app_private.attempt_results where attempt_id=current_setting('test.first_attempt')::uuid),'hidden-sentinel','Canonical private evidence survives operational retention');
select is((select code from app.attempts where id=current_setting('test.first_attempt')::uuid),'module.exports.solve=(a,b)=>a+b;','Canonical source survives operational retention');
select is((select count(*)::integer from app.attempts where organization_id='92000000-0000-4000-8000-000000000001'),6,'No transport duplicate or automatic rerun created an extra attempt');
select is((select count(*)::integer from app_private.attempt_events where organization_id='92000000-0000-4000-8000-000000000001'),12,'Every surviving attempt owns exactly two immutable facts');

-- Fixed schedule fixtures exercise [opensAt, closesAt) without waiting or
-- mutating any published activity. These window fixtures roll back before the
-- independent progress fixture; the outer transaction removes all test data.
savepoint submission_window_boundaries;
select set_config('test.window_clock',clock_timestamp()::text,true);
insert into app.activities(id,organization_id,class_id,created_by,title,type,opens_at,closes_at) values
('97000000-0000-4000-8000-000000000021','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','Future opening','FORMATIVE',current_setting('test.window_clock')::timestamptz+interval '1 day',current_setting('test.window_clock')::timestamptz+interval '2 days'),
('97000000-0000-4000-8000-000000000022','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','Elapsed closing boundary','FORMATIVE',current_setting('test.window_clock')::timestamptz-interval '1 day',current_setting('test.window_clock')::timestamptz),
('97000000-0000-4000-8000-000000000023','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','Reached opening boundary','FORMATIVE',current_setting('test.window_clock')::timestamptz,current_setting('test.window_clock')::timestamptz+interval '1 day');
insert into app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position)
select ('98000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'92000000-0000-4000-8000-000000000001',
 ('97000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'96100000-0000-4000-8000-000000000001',0 from generate_series(21,23) n;
update app.activities set state='PUBLISHED' where id in ('97000000-0000-4000-8000-000000000021','97000000-0000-4000-8000-000000000022','97000000-0000-4000-8000-000000000023');
create function pg_temp.admit_window(n integer) returns jsonb language sql as $$
 select app_private.admit_practice_submit(pg_temp.sid(n),('97000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('98000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'96100000-0000-4000-8000-000000000001',
 'window-boundary-'||n,repeat('a',64),'module.exports.solve=(a,b)=>a+b;',null,'sql-test','99000000-0000-4000-8000-000000000001',true,2,4,10)
$$;
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
set local app.organization_id='92000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.admit_window(21)$$,'P0001','ACTIVITY_NOT_AVAILABLE','Published activity rejects SUBMIT before opensAt');
select throws_ok($$select pg_temp.admit_window(22)$$,'P0001','ACTIVITY_NOT_AVAILABLE','Published activity rejects a new SUBMIT once closesAt is reached');
select is(pg_temp.admit_window(23)->>'kind','reserved','SUBMIT is admitted once opensAt is reached and before closesAt');
reset role;
select is((select count(*)::integer from app_private.submission_reservations where id in (pg_temp.sid(21),pg_temp.sid(22))),0,'Window rejections create no durable reservation');
rollback to savepoint submission_window_boundaries;

-- Another assignment of the old version and a new fixed version of the same
-- exercise cannot inherit successful evidence from the original publication.
savepoint progress_assignment_versions;
set constraints all deferred;
insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by)
select '96100000-0000-4000-8000-000000000002',organization_id,exercise_id,2,'Sum v2',statement,starter_code,difficulty,created_by
 from app.exercise_versions where id='96100000-0000-4000-8000-000000000001';
insert into app.exercise_version_concepts(organization_id,exercise_version_id,concept_version_id)
select organization_id,'96100000-0000-4000-8000-000000000002',concept_version_id from app.exercise_version_concepts where exercise_version_id='96100000-0000-4000-8000-000000000001';
insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected)
select organization_id,'96100000-0000-4000-8000-000000000002',test_id,position,visibility,args,expected from app_private.exercise_tests where exercise_version_id='96100000-0000-4000-8000-000000000001';
set constraints all immediate;
insert into app.activities(id,organization_id,class_id,created_by,title,type) values
('97000000-0000-4000-8000-000000000024','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','Independent assignments and versions','FORMATIVE');
insert into app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position) values
('98000000-0000-4000-8000-000000000024','92000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000024','96100000-0000-4000-8000-000000000001',0),
('98000000-0000-4000-8000-000000000025','92000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000024','96100000-0000-4000-8000-000000000002',1);
update app.activities set state='PUBLISHED' where id='97000000-0000-4000-8000-000000000024';
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
set local app.organization_id='92000000-0000-4000-8000-000000000001';
select is(app_private.practice_activity_progress('97000000-0000-4000-8000-000000000024')->>'completed','0','Success from another assignment is not inherited even with the same fixed version');
select is(app_private.practice_activity_progress('97000000-0000-4000-8000-000000000024')->>'required','2','Progress denominator counts both required versioned assignments');
select is(app_private.admit_practice_submit(pg_temp.sid(24),'97000000-0000-4000-8000-000000000024','98000000-0000-4000-8000-000000000024',
 '96100000-0000-4000-8000-000000000001','version-progress-0024',repeat('a',64),'module.exports.solve=(a,b)=>a+b;',null,'sql-test','99000000-0000-4000-8000-000000000001',true,2,4,10)->>'kind','reserved','New assignment requires its own submission');
select ok(pg_temp.stage_submit(24),'New assignment obtains its own full-suite evidence');
select is(pg_temp.finish_submit(24)->>'exerciseVersionId','96100000-0000-4000-8000-000000000001','Canonical attempt keeps the version fixed by its assignment');
select is(app_private.practice_activity_progress('97000000-0000-4000-8000-000000000024')->>'completed','1','Success for one version does not complete the other version of the same exercise');
select is((app_private.practice_activity_progress('97000000-0000-4000-8000-000000000024')->>'ratio')::numeric,0.5::numeric,'Partial progress returns the actual one-of-two ratio');
select is((select count(*)::integer from app.attempts where activity_exercise_id='98000000-0000-4000-8000-000000000025'),0,'The unattempted version has no inherited canonical attempt');
-- pgTAP keeps curr_test in a transactional cache but numbers assertions with
-- a sequence. Rolling back this final savepoint would rewind its plan to 92
-- after emitting 104 results. Keep its TAP state until finish(); the outer
-- ROLLBACK below still removes this fixture and every other test-only object.
release savepoint progress_assignment_versions;
select * from finish();
rollback;
