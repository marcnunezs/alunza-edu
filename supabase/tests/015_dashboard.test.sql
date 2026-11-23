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

-- Independent oracle: activity 1 has three required assignments and one optional.
-- Two historical versions of Addition label one assignment, without multiplying it.
grant alunza_identity to postgres;
grant usage on schema extensions to alunza_identity;
insert into app.concept_tags(id,organization_id,normalized_name) values
 ('95000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','numbers'),
 ('95000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000001','unused'),
 ('95000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','foreign');
insert into app.concept_versions(id,organization_id,concept_id,version,name,created_by) values
 ('95100000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001',2,'Addition historical 2','91000000-0000-4000-8000-000000000001'),
 ('95100000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002',1,'Numbers','91000000-0000-4000-8000-000000000001'),
 ('95100000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000003',1,'Unused','91000000-0000-4000-8000-000000000001'),
 ('95100000-0000-4000-8000-000000000005','92000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000004',1,'Foreign','91000000-0000-4000-8000-000000000004');
update app.concept_tags set current_version_id=case id
 when '95000000-0000-4000-8000-000000000001' then '95100000-0000-4000-8000-000000000002'::uuid
 when '95000000-0000-4000-8000-000000000002' then '95100000-0000-4000-8000-000000000003'::uuid
 when '95000000-0000-4000-8000-000000000003' then '95100000-0000-4000-8000-000000000004'::uuid
 when '95000000-0000-4000-8000-000000000004' then '95100000-0000-4000-8000-000000000005'::uuid end
 where id in ('95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000003','95000000-0000-4000-8000-000000000004')
 and organization_id in ('92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002');
insert into app.exercises(id,organization_id,owner_id)
 select ('96000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002' from generate_series(1,3) n;
insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by)
 select ('96100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'92000000-0000-4000-8000-000000000001',
 ('96000000-0000-4000-8000-'||lpad(least(n,3)::text,12,'0'))::uuid,case when n=4 then 2 else 1 end,'Sum '||n,'Return sum','module.exports.solve=(a,b)=>a+b;','BEGINNER','91000000-0000-4000-8000-000000000002'
 from generate_series(1,4) n;
insert into app.exercise_version_concepts values
 ('92000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000001','95100000-0000-4000-8000-000000000001'),
 ('92000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000001','95100000-0000-4000-8000-000000000002');
insert into app.exercise_version_concepts(organization_id,exercise_version_id,concept_version_id)
 select '92000000-0000-4000-8000-000000000001',('96100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'95100000-0000-4000-8000-000000000003' from generate_series(1,4) n;
insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected)
 select '92000000-0000-4000-8000-000000000001',('96100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'visible',0,'visible','[1,2]'::json,'3'::json from generate_series(1,4) n;
insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected)
 select '92000000-0000-4000-8000-000000000001',('96100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'hidden-sentinel',1,'hidden','[2,2]'::json,'4'::json from generate_series(1,4) n;
update app.exercises set current_version_id=('96100000-0000-4000-8000-'||right(id::text,12))::uuid
 where organization_id='92000000-0000-4000-8000-000000000001'
 and id in ('96000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000003');
insert into app.activities(id,organization_id,class_id,created_by,title,type,opens_at)
 select ('97000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','Activity '||n,'FORMATIVE',
 case when n=5 then clock_timestamp()+interval '1 day' else null end from generate_series(1,5) n;
insert into app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position,required)
 select ('98000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'92000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001',
 ('96100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,n-1,n<>3 from generate_series(1,4) n;
insert into app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position)
 select ('98000000-0000-4000-8000-'||lpad((n+10)::text,12,'0'))::uuid,'92000000-0000-4000-8000-000000000001',
 ('97000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'96100000-0000-4000-8000-000000000001',0 from generate_series(3,5) n;
update app.activities set state='PUBLISHED' where organization_id='92000000-0000-4000-8000-000000000001'
 and id in ('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000003',
  '97000000-0000-4000-8000-000000000004','97000000-0000-4000-8000-000000000005');
-- Validate the original domain constraints without flushing signal capture mid-transaction.
-- SET CONSTRAINTS ALL IMMEDIATE and subsequent DML rejection have their own signals integration test.
set constraints app.provisioning_complete, app.exercise_definition_complete,
 app.concept_current_version, app.exercise_current_version immediate;
-- Historical publication dates belong to the fixture, not a runtime time override.
alter table app.activities disable trigger user;
update app.activities set published_at='2026-09-01T00:00:00Z' where state='PUBLISHED'
 and organization_id='92000000-0000-4000-8000-000000000001'
 and id in ('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000003',
  '97000000-0000-4000-8000-000000000004','97000000-0000-4000-8000-000000000005');
update app.activities set published_at=clock_timestamp()-interval '1 second' where id='97000000-0000-4000-8000-000000000004';
alter table app.activities enable trigger user;

create function pg_temp.progress(activity uuid default null,concept uuid default null,cutoff timestamptz default null) returns jsonb language sql as $$
 select app_private.student_progress('94000000-0000-4000-8000-000000000001',activity,concept,cutoff)
$$;
create function pg_temp.sid(n integer) returns uuid language sql immutable as $$
 select ('99100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.admit(n integer,assignment integer) returns jsonb language sql as $$
 select app_private.admit_practice_submit(pg_temp.sid(n),'97000000-0000-4000-8000-000000000001',
 ('98000000-0000-4000-8000-'||lpad(assignment::text,12,'0'))::uuid,('96100000-0000-4000-8000-'||lpad(assignment::text,12,'0'))::uuid,
 'progress-submit-'||n,repeat('a',64),'module.exports.solve=(a,b)=>a+b;',null,'sql-test','99000000-0000-4000-8000-000000000001',true,2,4,100)
$$;
create function pg_temp.finish(n integer,outcome text) returns jsonb language plpgsql security definer as $$
declare actor text:=current_setting('app.actor_id',true); session text:=current_setting('app.session_id',true); token uuid; result jsonb;
begin
 select lease_token into token from app_private.submission_reservations where id=pg_temp.sid(n);
 perform set_config('app.actor_id','',true),set_config('app.session_id','',true);
 perform app_private.stage_practice_submit_result(pg_temp.sid(n),token,
  case when outcome='UNKNOWN' then '{"runnerVersion":"sql-test","diagnosisCode":"UNKNOWN","terminationReason":"RUNNER_FAILURE","infrastructureStatus":"FAILED","visibleTestResults":[],"visiblePassed":0,"visibleTotal":1,"outputTruncated":false,"outputBytes":0,"runtimeMs":0,"lifecycleMs":0,"hiddenChecksPassed":null,"allRequiredPassed":false}'::jsonb
   when outcome='SYNTAX_ERROR' then '{"runnerVersion":"sql-test","diagnosisCode":"SYNTAX_ERROR","terminationReason":"STUDENT_SYNTAX","infrastructureStatus":"OK","visibleTestResults":[],"visiblePassed":0,"visibleTotal":1,"outputTruncated":false,"outputBytes":0,"runtimeMs":1,"lifecycleMs":2,"hiddenChecksPassed":null,"allRequiredPassed":false}'::jsonb
   else jsonb_build_object('runnerVersion','sql-test','diagnosisCode',outcome,'terminationReason',case when outcome='SUCCESS' then 'COMPLETED' else 'ASSERTION_FAILED' end,
   'infrastructureStatus','OK','visibleTestResults','[{"id":"visible","passed":true,"stdout":"","stderr":""}]'::jsonb,'visiblePassed',1,'visibleTotal',1,'outputTruncated',false,
   'outputBytes',0,'runtimeMs',10,'lifecycleMs',20,'hiddenChecksPassed',outcome='SUCCESS','allRequiredPassed',outcome='SUCCESS') end,
  case when outcome in ('UNKNOWN','SYNTAX_ERROR') then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id','hidden-sentinel','passed',outcome='SUCCESS')) end);
 result:=app_private.finish_practice_submit(pg_temp.sid(n),token,true);
 perform set_config('app.actor_id',coalesce(actor,''),true),set_config('app.session_id',coalesce(session,''),true);
 return result;
end $$;

create function pg_temp.admit_run(n integer) returns jsonb language sql as $$
 select app_private.admit_practice_run(pg_temp.sid(n),'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',
 '96100000-0000-4000-8000-000000000001','progress-run-'||n,repeat('a',64),repeat('b',64),repeat('c',64),1,
 'sql-test','99000000-0000-4000-8000-000000000001',true,1,4,100)
$$;
create function pg_temp.finish_run(n integer,failed boolean default false) returns jsonb language plpgsql security definer as $$
declare actor text:=current_setting('app.actor_id',true); session text:=current_setting('app.session_id',true); token uuid; result jsonb;
begin
 select lease_token into token from app.executions where id=pg_temp.sid(n);
 perform set_config('app.actor_id','',true),set_config('app.session_id','',true);
 result:=app_private.finish_practice_run(pg_temp.sid(n),token,
  case when failed then '{"runnerVersion":"sql-test","diagnosisCode":"UNKNOWN","terminationReason":"RUNNER_FAILURE","infrastructureStatus":"FAILED","visibleTestResults":[],"visiblePassed":0,"visibleTotal":1,"outputTruncated":false,"outputBytes":0,"runtimeMs":0,"lifecycleMs":0}'::jsonb
  else '{"runnerVersion":"sql-test","diagnosisCode":"SUCCESS","terminationReason":"COMPLETED","infrastructureStatus":"OK","visibleTestResults":[{"id":"visible","passed":true,"stdout":"","stderr":""}],"visiblePassed":1,"visibleTotal":1,"outputTruncated":false,"outputBytes":0,"runtimeMs":10,"lifecycleMs":20}'::jsonb end,true);
 perform set_config('app.actor_id',coalesce(actor,''),true),set_config('app.session_id',coalesce(session,''),true);
 return result;
end $$;

-- Independent oracle: one active pupil, six required assignments in the class,
-- three in Activity 1; the first assignment has two historical concept labels.
create function pg_temp.dashboard_fixed_cut(cutoff timestamptz) returns jsonb language plpgsql as $$
begin
 return app_private.dashboard_read('94000000-0000-4000-8000-000000000001',jsonb_build_object('asOf',cutoff));
exception when others then
 -- Keep the fixed-cut assertion failing while retaining temporal diagnostics.
 return jsonb_build_object('asOf',cutoff,'errorCode',sqlstate,'error',sqlerrm);
end $$;
select ok(not has_function_privilege('alunza_app','app_private.progress_observations(uuid,uuid,uuid,uuid,timestamptz)','execute'),'runtime cannot invoke the unscoped shared kernel');
select ok(not has_function_privilege('alunza_app','app_private.dashboard_evidence_body(uuid,jsonb,boolean)','execute'),'runtime cannot select the internal own/teacher wrapper');
select ok(not has_function_privilege('authenticated','app_private.dashboard_read(uuid,jsonb)','execute'),'browser cannot call dashboard SQL');
select ok(not has_function_privilege('service_role','app_private.dashboard_signal(uuid,uuid,jsonb)','execute'),'service role has no dashboard RPC grant');
select is((select pg_get_userbyid(proowner) from pg_proc where oid='app_private.dashboard_read(uuid,jsonb)'::regprocedure),'alunza_identity','dashboard keeps a constrained owner');
select is((select provolatile::text from pg_proc where oid='app_private.dashboard_read(uuid,jsonb)'::regprocedure),'s','dashboard statement is one stable snapshot');
select ok((select proconfig @> array['search_path=pg_catalog'] from pg_proc where oid='app_private.dashboard_read(uuid,jsonb)'::regprocedure),'dashboard pins search_path');

set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000002';
set local app.session_id='91100000-0000-4000-8000-000000000002';
set local app.organization_id='92000000-0000-4000-8000-000000000001';
select set_config('test.dashboard.initial',app_private.dashboard_read('94000000-0000-4000-8000-000000000001','{}')::text,true);
select is(current_setting('test.dashboard.initial')::jsonb->'summary'->>'students','1','current active roster contains one pupil');
select is(current_setting('test.dashboard.initial')::jsonb->'summary'->>'required','6','class denominator is student assignments, not number of attempts');
select is(current_setting('test.dashboard.initial')::jsonb->'summary'->>'evidenceState','NO_ATTEMPTS','absence of attempts is explicit');
select is(current_setting('test.dashboard.initial')::jsonb->'signals'->'processing'->>'status','NOT_EVALUATED','no worker result is not interpreted as verified absence');
select is(jsonb_array_length(current_setting('test.dashboard.initial')::jsonb->'signals'->'processing'->'unconfiguredTypes'),3,'three unconfigured rule types are explicit');
select is(current_setting('app.actor_id'),'91000000-0000-4000-8000-000000000002','reading pupil facts never impersonates the pupil');
select throws_ok($$select app_private.dashboard_read('94000000-0000-4000-8000-000000000002','{}')$$,'P0001','RESOURCE_NOT_FOUND','another teacher class in same organization is denied');
select throws_ok($$select app_private.dashboard_read('94000000-0000-4000-8000-000000000003','{}')$$,'P0001','RESOURCE_NOT_FOUND','foreign class is denied');
select throws_ok($$select app_private.dashboard_read('94000000-0000-4000-8000-000000000001','{"bogus":true}')$$,'P0001','INVALID_REQUEST','unknown SQL options rejected');
select throws_ok($$select app_private.dashboard_read('94000000-0000-4000-8000-000000000001','{"from":"2026-09-03T00:00:00Z","asOf":"2026-09-02T00:00:00Z"}')$$,'P0001','DASHBOARD_PERIOD_INVALID','inverted period is rejected');
select throws_ok($$select app_private.dashboard_read('94000000-0000-4000-8000-000000000001',jsonb_build_object('asOf',clock_timestamp()+interval '1 day'))$$,'P0001','INVALID_PROGRESS_CUTOFF','future cut preserves existing error');
select throws_ok($$select app_private.dashboard_signals('94000000-0000-4000-8000-000000000001','{"state":"RESOLVED"}')$$,'P0001','DASHBOARD_FILTER_INVALID','no additional signal state accepted');
select is((select count(*)::integer from app.attempts),0,'teacher has no direct attempt rows');

set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
select throws_ok($$select app_private.dashboard_read('94000000-0000-4000-8000-000000000001','{}')$$,'P0001','RESOURCE_NOT_FOUND','student cannot read class dashboard');
select is(pg_temp.admit(1,1)->>'kind','reserved','canonical success fixture reserves submit');
select set_config('test.dashboard.success',pg_temp.finish(1,'SUCCESS')::text,true);
select set_config('test.dashboard.success_at',current_setting('test.dashboard.success')::jsonb->>'submittedAt',true);
select is(pg_temp.admit(2,1)->>'kind','reserved','canonical later failure reserves independently');
select is(pg_temp.finish(2,'FAILED_TEST')->'technicalResult'->>'diagnosisCode','FAILED_TEST','hidden required failure remains canonical');
select is(pg_temp.admit(3,3)->>'kind','reserved','optional unavailable result reserves');
select is(pg_temp.finish(3,'UNKNOWN')->'technicalResult'->>'diagnosisCode','UNKNOWN','infrastructure failure is not a conceptual failure');
select set_config('test.dashboard.period_start',app_private.record_activity_open('97000000-0000-4000-8000-000000000001','dashboard-explicit-open')->>'occurredAt',true);
select set_config('test.dashboard.personal',app_private.student_progress_observed('94000000-0000-4000-8000-000000000001',jsonb_build_object('activityId','97000000-0000-4000-8000-000000000001','from',current_setting('test.dashboard.period_start')))::text,true);
select is(current_setting('test.dashboard.personal')::jsonb->'summary'->>'completed','1','period start cannot erase prior completion');
select is(current_setting('test.dashboard.personal')::jsonb->'observation'->'summary'->>'attempts','0','observed attempts obey period start');
select is(current_setting('test.dashboard.personal')::jsonb->'observation'->'summary'->>'activityEvents','1','explicit opening is one observed event');
select is((app_private.student_progress_observed('94000000-0000-4000-8000-000000000001',jsonb_build_object('from',statement_timestamp()))->'observation'->>'lastActivityAt')::timestamptz,
 current_setting('test.dashboard.period_start')::timestamptz,'personal last activity remains observable before period start');
select is((app_private.student_progress_observed('94000000-0000-4000-8000-000000000001','{}')-'observation'),app_private.student_progress('94000000-0000-4000-8000-000000000001'),'new personal projection keeps legacy payload exactly');

set local app.actor_id='91000000-0000-4000-8000-000000000002';
set local app.session_id='91100000-0000-4000-8000-000000000002';
select set_config('test.dashboard.complete',app_private.dashboard_read('94000000-0000-4000-8000-000000000001','{"activityId":"97000000-0000-4000-8000-000000000001"}')::text,true);
select is(current_setting('test.dashboard.complete')::jsonb->'summary'->>'completed','1','one successful assignment remains complete after failure');
select is(current_setting('test.dashboard.complete')::jsonb->'summary'->>'required','3','activity filter precedes denominator');
select is(current_setting('test.dashboard.complete')::jsonb->'summary'->'period'->>'attempts','3','optional attempts remain observable');
select is(current_setting('test.dashboard.complete')::jsonb->'summary'->'period'->>'technicalFailures','1','only reliable technical failure counted');
select is(current_setting('test.dashboard.complete')::jsonb->'summary'->'period'->>'unverifiableAttempts','1','UNKNOWN preserved separately');
select is((app_private.dashboard_read('94000000-0000-4000-8000-000000000001',jsonb_build_object('from',statement_timestamp()))->'summary'->>'lastActivityAt')::timestamptz,
 current_setting('test.dashboard.period_start')::timestamptz,'class last activity is independent of the period start');
select is(app_private.dashboard_read('94000000-0000-4000-8000-000000000001','{"activityId":"97000000-0000-4000-8000-000000000001","conceptId":"95000000-0000-4000-8000-000000000001"}')->'summary'->'period'->>'attempts','2','two historical versions of a concept do not duplicate attempts');
select is(app_private.dashboard_read('94000000-0000-4000-8000-000000000001','{"activityId":"97000000-0000-4000-8000-000000000001","conceptId":"95000000-0000-4000-8000-000000000001"}')->'summary'->>'required','1','concept filter deduplicates assignments');
select is(app_private.dashboard_read('94000000-0000-4000-8000-000000000001','{"conceptId":"95000000-0000-4000-8000-000000000003"}')->'summary'->'ratio','null'::jsonb,'valid unmatched concept yields no calculable denominator');
select ok(not(current_setting('test.dashboard.complete') like '%hidden-sentinel%'),'class output excludes hidden identifiers');
select ok(not(current_setting('test.dashboard.complete') like '%module.exports%'),'class output excludes code');
select set_config('test.dashboard.page',app_private.dashboard_evidence('94000000-0000-4000-8000-000000000001','{"limit":1}')::text,true);
select is(jsonb_array_length(current_setting('test.dashboard.page')::jsonb->'data'),1,'evidence respects page size');
select is(current_setting('test.dashboard.page')::jsonb->'page'->>'hasMore','true','evidence has a following page');
select set_config('test.dashboard.next',app_private.dashboard_evidence('94000000-0000-4000-8000-000000000001',jsonb_build_object('limit',1,'asOf',current_setting('test.dashboard.page')::jsonb->>'asOf','cursor',current_setting('test.dashboard.page')::jsonb->'page'->>'nextCursor'))::text,true);
select isnt(current_setting('test.dashboard.next')::jsonb->'data'->0->'attempt'->>'id',current_setting('test.dashboard.page')::jsonb->'data'->0->'attempt'->>'id','next page does not duplicate first attempt');
select throws_ok($$select app_private.dashboard_evidence('94000000-0000-4000-8000-000000000001',jsonb_build_object('limit',1,'asOf',current_setting('test.dashboard.page')::jsonb->>'asOf','cursor',current_setting('test.dashboard.page')::jsonb->'page'->>'nextCursor','conceptId','95000000-0000-4000-8000-000000000001'))$$,'P0001','DASHBOARD_CURSOR_INVALID','cursor cannot cross filter context');
select is(jsonb_array_length(app_private.dashboard_evidence('94000000-0000-4000-8000-000000000001',jsonb_build_object('kind','COMPLETION','from',current_setting('test.dashboard.period_start')))->'data'),1,'completion evidence is accumulated despite observation period');
select is(jsonb_array_length(app_private.dashboard_evidence('94000000-0000-4000-8000-000000000001','{"kind":"HINT"}')->'data'),0,'no delivery events means no fabricated hints');
select is((select count(*)::integer from app.attempts),0,'dashboard projection did not broaden direct RLS');
select is(jsonb_array_length(app_private.dashboard_signals('94000000-0000-4000-8000-000000000001','{}')->'data'),0,'no persisted signal is an empty list with processing metadata');
select throws_ok($$select app_private.dashboard_signal('94000000-0000-4000-8000-000000000001','99900000-0000-4000-8000-000000000001','{}')$$,'P0001','RESOURCE_NOT_FOUND','unknown signal remains safe not found');

set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
select is(pg_temp.admit(4,2)->>'kind','reserved','syntax result admits a real canonical submission');
select is(pg_temp.finish(4,'SYNTAX_ERROR')->'technicalResult'->>'diagnosisCode','SYNTAX_ERROR','reliable syntax diagnosis persists with incomplete visible suite');
set local app.actor_id='91000000-0000-4000-8000-000000000002';
set local app.session_id='91100000-0000-4000-8000-000000000002';
select set_config('test.dashboard.syntax',app_private.dashboard_evidence('94000000-0000-4000-8000-000000000001','{"diagnosisCode":"SYNTAX_ERROR"}')::text,true);
select is(current_setting('test.dashboard.syntax')::jsonb->'data'->0->'attempt'->>'verification','VERIFIED','canonical syntax diagnosis remains reliable');
select is(current_setting('test.dashboard.syntax')::jsonb->'data'->0->'attempt'->'visiblePassed','null'::jsonb,'incomplete visible evidence is not represented as zero passed');
select is(current_setting('test.dashboard.syntax')::jsonb->'data'->0->'attempt'->'visibleTotal','null'::jsonb,'incomplete visible evidence has no comparable total');
select is(set_config('test.dashboard.failure_summary',app_private.dashboard_read('94000000-0000-4000-8000-000000000001','{}')::text,true)::jsonb->'summary'->'period'->>'technicalFailures','2','syntax and failed-test canonical failures count without inventing visible results');
-- Preserve the exact response and cutoff on failure, rather than observing a
-- later query that could conceal a timing or snapshot regression.
select diag(current_setting('test.dashboard.failure_summary'))
 where current_setting('test.dashboard.failure_summary')::jsonb->'summary'->'period'->>'technicalFailures' is distinct from '2';
-- Independent fixed-cut regression: the preceding evidence response already
-- observed the syntax attempt. Reuse its exact microsecond cut for the count.
select set_config('test.dashboard.fixed_summary',pg_temp.dashboard_fixed_cut((current_setting('test.dashboard.syntax')::jsonb->>'asOf')::timestamptz)::text,true);
select is(current_setting('test.dashboard.fixed_summary')::jsonb->'summary'->'period'->>'technicalFailures','2','fixed evidence cut includes both reliable failures without fabricating visible counts');
-- The diagnostic runner enables this after preparing an isolated copy. Logging
-- happens after both assertions; it cannot delay the original observed query.
reset role;
select diag('IMP05_SQL57 '||jsonb_build_object(
 'defaultResponse',current_setting('test.dashboard.failure_summary')::jsonb,
 'fixedResponse',current_setting('test.dashboard.fixed_summary')::jsonb,
 'syntaxEvidence',current_setting('test.dashboard.syntax')::jsonb,
 'transactionId',txid_current()::text,'statementAt',app_private.signal_instant(statement_timestamp()),
 'clockAt',app_private.signal_instant(clock_timestamp()),'serverVersion',current_setting('server_version'),
 'canonicalAttempts',(select jsonb_agg(jsonb_build_object('id',a.id,'submittedAt',app_private.signal_instant(a.submitted_at),
   'diagnosis',a.technical_result->>'diagnosisCode','infrastructure',a.technical_result->>'infrastructureStatus',
   'includedAtDefault',a.submitted_at<=(current_setting('test.dashboard.failure_summary')::jsonb->>'asOf')::timestamptz,
   'includedAtFixed',a.submitted_at<=(current_setting('test.dashboard.fixed_summary')::jsonb->>'asOf')::timestamptz,
   'confirmedEvents',(select jsonb_agg(jsonb_build_object('id',e.id,'sequence',e.event_sequence::text,'type',e.event_type) order by e.event_sequence)
    from app_private.attempt_events e where e.attempt_id=a.id and e.event_type='ATTEMPT_SUBMITTED')) order by a.submitted_at,a.id)
   from app.attempts a where a.class_id='94000000-0000-4000-8000-000000000001'))::text)
 where current_setting('test.dashboard.diagnostics',true)='on'
  or current_setting('test.dashboard.failure_summary')::jsonb->'summary'->'period'->>'technicalFailures' is distinct from '2'
  or current_setting('test.dashboard.fixed_summary')::jsonb->'summary'->'period'->>'technicalFailures' is distinct from '2';
set local role alunza_app;

set local app.actor_id='91000000-0000-4000-8000-000000000001';
set local app.session_id='91100000-0000-4000-8000-000000000001';
select throws_ok($$select app_private.dashboard_read('94000000-0000-4000-8000-000000000001','{}')$$,'P0001','RESOURCE_NOT_FOUND','ADMIN governance does not grant pedagogical access');
select throws_ok($$select app_private.dashboard_evidence('94000000-0000-4000-8000-000000000001','{}')$$,'P0001','RESOURCE_NOT_FOUND','ADMIN cannot drill into evidence');
select throws_ok($$select app_private.dashboard_signals('94000000-0000-4000-8000-000000000001','{}')$$,'P0001','RESOURCE_NOT_FOUND','ADMIN cannot list signals');
reset role;
update app.organization_memberships set state='DISABLED' where organization_id='92000000-0000-4000-8000-000000000001' and user_id='91000000-0000-4000-8000-000000000003';
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000002';
set local app.session_id='91100000-0000-4000-8000-000000000002';
select is(app_private.dashboard_read('94000000-0000-4000-8000-000000000001','{}')->'summary'->>'students','0','disabled pupil leaves current active aggregate roster');
select is(app_private.dashboard_read('94000000-0000-4000-8000-000000000001','{}')->'summary'->'ratio','null'::jsonb,'empty roster is no denominator, not 100 percent');
reset role;
select * from finish();
rollback;
