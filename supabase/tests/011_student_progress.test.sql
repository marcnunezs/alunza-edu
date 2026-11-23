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
   else jsonb_build_object('runnerVersion','sql-test','diagnosisCode',outcome,'terminationReason',case when outcome='SUCCESS' then 'COMPLETED' else 'ASSERTION_FAILED' end,
   'infrastructureStatus','OK','visibleTestResults','[{"id":"visible","passed":true,"stdout":"","stderr":""}]'::jsonb,'visiblePassed',1,'visibleTotal',1,'outputTruncated',false,
   'outputBytes',0,'runtimeMs',10,'lifecycleMs',20,'hiddenChecksPassed',outcome='SUCCESS','allRequiredPassed',outcome='SUCCESS') end,
  case when outcome='UNKNOWN' then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id','hidden-sentinel','passed',outcome='SUCCESS')) end);
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

select ok(not has_table_privilege('alunza_app','app_private.student_activity_observations','select,insert,update,delete'),'Runtime has no direct observation ledger access');
select ok(not has_table_privilege('authenticated','app_private.student_activity_observations','select,insert,update,delete'),'Browser has no observation ledger access');
select ok(not has_function_privilege('alunza_app','app_private.student_activity_events(uuid,uuid,uuid,timestamptz)','execute'),'Normalized event corpus is internal only');
select ok(not has_function_privilege('authenticated','app_private.student_progress(uuid,uuid,uuid,timestamptz)','execute'),'Browser cannot call SQL progress directly');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('app_private.student_activity_observations'::regclass,'app_private.student_event_coverage'::regclass)),'New tables force RLS');
select is((select count(*)::integer from app_private.student_event_coverage),2,'Capture coverage records its actual start for both new sources');
select is((select count(*)::integer from app_private.student_activity_observations where organization_id='92000000-0000-4000-8000-000000000001'),0,'Fixture starts without invented historical observations');
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
set local app.organization_id='92000000-0000-4000-8000-000000000001';
select is(pg_temp.progress('97000000-0000-4000-8000-000000000001')->'summary'->>'required','3','Denominator counts exactly three required assignments');
select is(pg_temp.progress('97000000-0000-4000-8000-000000000001')->'summary'->>'evidenceState','NO_ATTEMPTS','No attempts is distinct from an observed zero');
select is(pg_temp.progress(null,null,'2026-08-31T23:59:59.999999Z')->'summary'->'ratio','null'::jsonb,'Before first publication progress has no denominator');
select is(pg_temp.progress(null,null,'2026-09-01T00:00:00Z')->'summary'->>'required','5','Publication boundary is inclusive and later publication is excluded');
select is(pg_temp.progress()->'summary'->>'required','6','Future opensAt remains readable and counts the published obligation');
select is(pg_temp.progress(null,'95000000-0000-4000-8000-000000000003')->'summary'->>'evidenceState','NO_REQUIRED_EXERCISES','Known unassigned concept returns an honest empty denominator');
select is(pg_temp.progress('97000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001')->'summary'->>'required','1','Two versions of one concept do not multiply an assignment');
select is(jsonb_array_length(pg_temp.progress('97000000-0000-4000-8000-000000000001')->'byConcept'),2,'Each historical concept has one aggregate');
select throws_ok($$select pg_temp.progress(null,null,clock_timestamp()+interval '1 day')$$,'P0001','INVALID_PROGRESS_CUTOFF','Future cutoff rejected by SQL as well as API');
select throws_ok($$select pg_temp.progress(null,null,'infinity')$$,'P0001','INVALID_PROGRESS_CUTOFF','Nonfinite cutoff rejected');
select throws_ok($$select pg_temp.progress('97000000-0000-4000-8000-000000000002')$$,'P0001','RESOURCE_NOT_FOUND','Draft does not disclose progress');
select throws_ok($$select app_private.student_progress('94000000-0000-4000-8000-000000000002')$$,'P0001','RESOURCE_NOT_FOUND','Other class in own organization rejected');
select throws_ok($$select app_private.student_progress('94000000-0000-4000-8000-000000000003')$$,'P0001','RESOURCE_NOT_FOUND','Foreign organization class rejected');
select throws_ok($$select pg_temp.progress(null,'95000000-0000-4000-8000-000000000004')$$,'P0001','RESOURCE_NOT_FOUND','Foreign concept rejected');
select throws_ok($$select app_private.record_activity_open('97000000-0000-4000-8000-000000000002','progress-open-1')$$,'P0001','RESOURCE_NOT_FOUND','Draft cannot create an opening observation');
select throws_ok($$select app_private.record_activity_open('97000000-0000-4000-8000-000000000001','bad')$$,'P0001','INVALID_REQUEST','Invalid idempotency key rejected');
select set_config('test.progress.open',app_private.record_activity_open('97000000-0000-4000-8000-000000000001','progress-open-1')::text,true);
select is(app_private.record_activity_open('97000000-0000-4000-8000-000000000001','progress-open-1'),current_setting('test.progress.open')::jsonb,'Opening replay keeps original identity and server timestamp');
select ok(app_private.record_activity_open('97000000-0000-4000-8000-000000000001','progress-open-2')->>'eventId'<>current_setting('test.progress.open')::jsonb->>'eventId','A fresh explicit opening creates a new event');
select is(pg_temp.progress('97000000-0000-4000-8000-000000000001')->'summary'->>'evidenceState','NO_ATTEMPTS','Openings do not create attempt evidence');
select is(pg_temp.admit_run(101)->>'kind','reserved','Ordinary RUN is admitted through the canonical function');
select is(pg_temp.finish_run(101)->'technicalResult'->>'diagnosisCode','SUCCESS','Canonical RUN finalization succeeds with observation trigger');
select is(pg_temp.progress('97000000-0000-4000-8000-000000000001')->'summary'->>'completed','0','Passing RUN does not complete a required assignment');
select is(pg_temp.admit_run(102)->>'kind','reserved','An independent second RUN is admitted');
select is(pg_temp.finish_run(102,true)->'technicalResult'->>'infrastructureStatus','FAILED','Failed infrastructure RUN finalization preserves operational state');
select is(pg_temp.admit(1,1)->>'attemptNumber','1','First admission creates stable history number');
select is(pg_temp.admit(2,1)->>'attemptNumber','2','Concurrent second admission has a different history number');
select is(pg_temp.progress('97000000-0000-4000-8000-000000000001')->'summary'->>'evidenceState','NO_ATTEMPTS','Reservations alone do not create progress evidence');
select set_config('test.progress.success',pg_temp.finish(2,'SUCCESS')::text,true);
select set_config('test.progress.cutoff',current_setting('test.progress.success')::jsonb->>'submittedAt',true);
select is(pg_temp.finish(1,'FAILED_TEST')->'technicalResult'->>'hiddenChecksPassed','false','Later failed hidden verification has canonical failure');
select is(pg_temp.progress('97000000-0000-4000-8000-000000000001')->'summary'->>'completed','1','Later failure and two submissions complete one assignment only');
select is(pg_temp.progress('97000000-0000-4000-8000-000000000001',null,current_setting('test.progress.cutoff')::timestamptz)->'summary'->>'completed','1','Exact confirmation instant includes the first success');
select is(pg_temp.progress('97000000-0000-4000-8000-000000000001',null,current_setting('test.progress.cutoff')::timestamptz-interval '1 microsecond')->'summary'->>'completed','0','Admission before the cutoff is insufficient without confirmation');
select is(pg_temp.progress('97000000-0000-4000-8000-000000000003')->'summary'->>'completed','0','Same bank version in another activity has a distinct obligation');
select is(pg_temp.admit(3,2)->>'kind','reserved','Second assignment admits independently');
select set_config('test.progress.second_success',pg_temp.finish(3,'SUCCESS')::text,true);
select is((pg_temp.progress('97000000-0000-4000-8000-000000000001')->'summary'->>'ratio')::numeric,2::numeric/3,'Ratio is exactly two thirds without presentation rounding');
select is(jsonb_array_length(pg_temp.progress('97000000-0000-4000-8000-000000000001')->'evidence'),2,'Evidence contains one first success per required completed assignment');
select is(pg_temp.progress('97000000-0000-4000-8000-000000000001')->'evidence'->0->>'attemptId',current_setting('test.progress.success')::jsonb->>'attemptId','Evidence follows confirmation order rather than reversed admission order');
select is(pg_temp.progress('97000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001')->'summary'->>'completed','1','Concept filter narrows numerator before aggregation');
select is(pg_temp.progress('97000000-0000-4000-8000-000000000001')->'byConcept'->0->>'required','1','Historical duplicate labels do not multiply conceptual denominator');
select is(jsonb_array_length(pg_temp.progress('97000000-0000-4000-8000-000000000001')->'byConcept'->0->'conceptVersionIds'),2,'Concept aggregation preserves both fixed historical versions');
select is(pg_temp.admit(4,3)->>'kind','reserved','Optional assignment supports ordinary submit evidence');
select is(pg_temp.finish(4,'UNKNOWN')->'technicalResult'->>'diagnosisCode','UNKNOWN','Operational fallback is retained canonically');
select is(pg_temp.progress('97000000-0000-4000-8000-000000000001')->'summary'->>'completed','2','Optional operational failure does not complete a required assignment');
select is(app_private.practice_activity_progress('97000000-0000-4000-8000-000000000001')->>'completed','2','Existing activity API delegates to the same calculation');
select is((select count(*)::integer from jsonb_object_keys(app_private.practice_activity_progress('97000000-0000-4000-8000-000000000001'))),6,'Legacy response keeps its exact six-field shape');
select ok(not(pg_temp.progress('97000000-0000-4000-8000-000000000001')::text like '%hidden-sentinel%'),'Progress does not expose hidden test details');
reset role;

-- Rename/archive after publication cannot rewrite concepts used by the evidence.
insert into app.concept_versions(id,organization_id,concept_id,version,name,created_by) values
 ('95100000-0000-4000-8000-000000000006','92000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001',3,'New unassigned name','91000000-0000-4000-8000-000000000001');
update app.concept_tags set current_version_id='95100000-0000-4000-8000-000000000006',archived_at=clock_timestamp() where id='95000000-0000-4000-8000-000000000001';
update app.activities set state='CLOSED' where id='97000000-0000-4000-8000-000000000001';
set local role alunza_app;
select is(pg_temp.progress('97000000-0000-4000-8000-000000000001')->'byConcept'->0->>'name','Addition historical 2','Concept name comes from fixed associations after rename and archive');
select is(pg_temp.progress('97000000-0000-4000-8000-000000000001')->'summary'->>'completed','2','Closing preserves accumulated achievements');
select is(app_private.record_activity_open('97000000-0000-4000-8000-000000000001','progress-open-1'),current_setting('test.progress.open')::jsonb,'Permanent replay also works after closing');
reset role;

-- Minimal existing canonical help records exercise ACK fallback semantics.
set local role alunza_app;
select set_config('test.progress.deterministic_cutoff',clock_timestamp()::text,true);
select set_config('test.progress.before_help',pg_temp.progress(null,null,current_setting('test.progress.deterministic_cutoff')::timestamptz)::text,true);
reset role;
insert into app.feedback_requests(id,organization_id,class_id,activity_id,student_id,attempt_id,kind,lifecycle_status,deadline_at,correlation_id)
 select ('99200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001',
 '97000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003',(current_setting('test.progress.success')::jsonb->>'attemptId')::uuid,
 'FEEDBACK','SUCCEEDED',clock_timestamp()+interval '15 seconds','99000000-0000-4000-8000-000000000001' from generate_series(1,2) n;
insert into app.feedbacks(id,organization_id,attempt_id,request_id,diagnosis_code,explanation,hint,rag_status)
 select ('99300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'92000000-0000-4000-8000-000000000001',(current_setting('test.progress.success')::jsonb->>'attemptId')::uuid,
 ('99200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'SUCCESS','Explanation fallback','',case when n=1 then 'PROVIDER_UNAVAILABLE' else 'NO_EVIDENCE' end from generate_series(1,2) n;
insert into app_private.help_events(organization_id,attempt_id,request_id,event_type)
 select '92000000-0000-4000-8000-000000000001',(current_setting('test.progress.success')::jsonb->>'attemptId')::uuid,('99200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'HELP_REQUESTED' from generate_series(1,2) n;
insert into app_private.help_events(organization_id,attempt_id,request_id,feedback_id,event_type)
 select '92000000-0000-4000-8000-000000000001',(current_setting('test.progress.success')::jsonb->>'attemptId')::uuid,
 ('99200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('99300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'FEEDBACK_VIEWED' from generate_series(1,2) n;
set local role alunza_app;
select is(pg_temp.progress(null,null,current_setting('test.progress.deterministic_cutoff')::timestamptz),current_setting('test.progress.before_help')::jsonb,'Full SQL progress is unchanged by help fallbacks and ACKs for the same persisted evidence and cutoff');
reset role;
set local role alunza_identity;
select is((select count(*)::integer from app_private.student_activity_events('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003',clock_timestamp()) where source='CLASS_MEMBERSHIP'),1,'Normalized catalogue includes original enrollment once');
select is((select count(*)::integer from app_private.student_activity_events('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003',clock_timestamp()) where event_type='FEEDBACK_VIEWED' and eligible),2,'Acknowledged provider/no-evidence fallbacks count as explicit feedback reading');
select is((select count(*)::integer from app_private.student_activity_events('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003',clock_timestamp()) where event_type='HELP_REQUESTED' and eligible),0,'Help request/polling is not eligible activity');
select is((select count(*)::integer from app_private.student_activity_events('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003',clock_timestamp()) where source='ATTEMPT' and not eligible),1,'Infrastructure failed execution is observable but ineligible');
select is((select count(*)::integer from app_private.student_activity_events('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003',clock_timestamp()) where event_type='ATTEMPT_SUBMITTED' and infrastructure_status='FAILED' and eligible),1,'Confirmed submission itself is activity even when infrastructure failed');
select is((select count(*)::integer from app_private.student_activity_events('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003',clock_timestamp()) where source='RUN' and eligible),1,'Canonical successful RUN yields exactly one eligible completion');
select is((select count(*)::integer from app_private.student_activity_events('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003',clock_timestamp()) where source='RUN' and not eligible),1,'Infrastructure failed RUN remains observable but ineligible');
select is((select count(*)::integer from app_private.student_activity_events('92000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003',clock_timestamp())),0,'Normalized source requires exact organization/class/student scope');
reset role;

select throws_ok($$update app_private.student_activity_observations set occurred_at=clock_timestamp() where organization_id='92000000-0000-4000-8000-000000000001'$$,'23514','IMMUTABLE_STUDENT_EVENT','Observation timestamps cannot be rewritten');
select throws_ok($$delete from app_private.student_activity_observations where organization_id='92000000-0000-4000-8000-000000000001'$$,'23514','IMMUTABLE_STUDENT_EVENT','Recorded observations cannot be removed');
alter table app.executions disable trigger user;
update app.executions set response_expires_at=clock_timestamp()-interval '1 second' where id in (pg_temp.sid(101),pg_temp.sid(102));
alter table app.executions enable trigger user;
set local app.actor_id='';
set local app.session_id='';
set local role alunza_app;
select app_private.purge_practice_responses();
reset role;
select is((select count(*)::integer from app.executions where organization_id='92000000-0000-4000-8000-000000000001'
 and id in (pg_temp.sid(101),pg_temp.sid(102)) and response_body is null),2,'Both fixture RUN responses expire independently of activity evidence');
select is((select count(*)::integer from app_private.student_activity_observations where organization_id='92000000-0000-4000-8000-000000000001'
 and execution_id in (pg_temp.sid(101),pg_temp.sid(102)) and event_type='EXECUTION_COMPLETED'),2,'RUN evidence survives response purging without duplication');
set local role alunza_identity;
select is((select count(*)::integer from app_private.student_activity_events('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003',clock_timestamp()) where source='RUN' and eligible),1,'Normalized RUN eligibility remains reproducible after response purging');
reset role;

-- Current authorization always applies, including when requesting an old cutoff.
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000001';
set local app.session_id='91100000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.progress()$$,'P0001','RESOURCE_NOT_FOUND','Administrative structure role does not acquire pedagogical progress');
select is(app_private.attempt_confirmation_sequence((current_setting('test.progress.success')::jsonb->>'attemptId')::uuid),null::bigint,'Private sequence projection reveals nothing to administrative actor');
set local app.actor_id='91000000-0000-4000-8000-000000000002';
set local app.session_id='91100000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.progress()$$,'P0001','RESOURCE_NOT_FOUND','Assigned teacher still has no personal progress permission in this cut');
reset role;
update app.class_memberships set ended_at=clock_timestamp() where user_id='91000000-0000-4000-8000-000000000003'
 and organization_id='92000000-0000-4000-8000-000000000001' and class_id='94000000-0000-4000-8000-000000000001';
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
select throws_ok($$select pg_temp.progress(null,null,'2026-09-01T00:00:00Z')$$,'P0001','RESOURCE_NOT_FOUND','Historical cutoff does not restore an ended membership');
select throws_ok($$select app_private.record_activity_open('97000000-0000-4000-8000-000000000001','progress-open-1')$$,'P0001','RESOURCE_NOT_FOUND','Replay revalidates permissions before exposing old event');
reset role;
select * from finish();
rollback;
