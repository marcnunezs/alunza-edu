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

-- Temporary helpers are test-only, and rolled back with this entire fixture.
create function pg_temp.admit_run(execution uuid, operation_key text, payload text default repeat('a',64), frequency integer default 10) returns jsonb language sql as $$
 select app_private.admit_practice_run(execution,'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000001',operation_key,payload,repeat('b',64),repeat('c',64),1,'sql-test','99000000-0000-4000-8000-000000000001',true,1,4,frequency)
$$;
create function pg_temp.run_result() returns jsonb language sql as $$
 select '{"runnerVersion":"sql-test","diagnosisCode":"UNKNOWN","terminationReason":"RUNNER_FAILURE","infrastructureStatus":"FAILED","visibleTestResults":[],"visiblePassed":0,"visibleTotal":1,"outputTruncated":false,"outputBytes":0,"runtimeMs":0,"lifecycleMs":0}'::jsonb
$$;
create function pg_temp.run_token(execution uuid) returns uuid language sql security definer as $$
 select lease_token from app.executions where id=execution
$$;
create function pg_temp.finish_run(execution uuid, token uuid, technical_result jsonb, cleaned boolean) returns jsonb language plpgsql as $$
declare actor text:=current_setting('app.actor_id',true); session text:=current_setting('app.session_id',true); result jsonb;
begin
 perform set_config('app.actor_id','',true),set_config('app.session_id','',true);
 result:=app_private.finish_practice_run(execution,token,technical_result,cleaned);
 perform set_config('app.actor_id',coalesce(actor,''),true),set_config('app.session_id',coalesce(session,''),true);
 return result;
end $$;
select ok(not has_table_privilege('authenticated','app.executions','select'),'Browser cannot read operational RUN table');
select ok(not has_table_privilege('alunza_app','app.executions','insert,update,delete'),'Runtime has no direct RUN mutation grants');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='app.executions'::regclass),'RUN table forces RLS');
select ok(not has_function_privilege('authenticated','app_private.claim_expired_practice_run()','execute'),'Browser cannot claim leases');

set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
set local app.organization_id='92000000-0000-4000-8000-000000000001';
select is(pg_temp.admit_run('98100000-0000-4000-8000-000000000001','run-key-0001')->>'kind','reserved','Student with current membership admits RUN');
set local app.actor_id='91000000-0000-4000-8000-000000000006';
set local app.session_id='91100000-0000-4000-8000-000000000006';
select is(pg_temp.admit_run('98100000-0000-4000-8000-000000000006','run-key-0006')->>'kind','reserved','Second student shares organization capacity');
set local app.actor_id='91000000-0000-4000-8000-000000000007';
set local app.session_id='91100000-0000-4000-8000-000000000007';
select is(pg_temp.admit_run('98100000-0000-4000-8000-000000000007','run-key-0007')->>'kind','reserved','Third student shares organization capacity');
set local app.actor_id='91000000-0000-4000-8000-000000000008';
set local app.session_id='91100000-0000-4000-8000-000000000008';
select is(pg_temp.admit_run('98100000-0000-4000-8000-000000000008','run-key-0008')->>'kind','reserved','Fourth student reaches organization capacity');
set local app.actor_id='91000000-0000-4000-8000-000000000009';
set local app.session_id='91100000-0000-4000-8000-000000000009';
select throws_ok($$select pg_temp.admit_run('98100000-0000-4000-8000-000000000009','run-key-0009')$$,'P0001','RATE_LIMITED','Fifth student is rejected by the shared database quota');
select lives_ok($$select pg_temp.finish_run(id,pg_temp.run_token(id),pg_temp.run_result(),true) from (values('98100000-0000-4000-8000-000000000006'::uuid),('98100000-0000-4000-8000-000000000007'::uuid),('98100000-0000-4000-8000-000000000008'::uuid)) fixture(id)$$,'Verified cleanup frees organization slots');
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
select is((select count(*)::integer from app.executions),1,'Student reads own reservation');
select throws_ok($$select lease_token from app.executions$$,'42501',null,'Actor cannot read fencing tokens from table');
select throws_ok($$insert into app.operation_keys(organization_id,actor_id,operation,key,payload_hash) values('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003','practice.run','forged-key-0001',repeat('a',64))$$,'42501',null,'Runtime cannot forge a RUN operation key');
with changed as(update app.operation_keys set state='COMPLETED',response_body='{}' where operation='practice.run' returning id) select is((select count(*)::integer from changed),0,'Runtime cannot replace RUN replay response');
select throws_ok($$select app_private.finish_practice_run('98100000-0000-4000-8000-000000000001',pg_temp.run_token('98100000-0000-4000-8000-000000000001'),pg_temp.run_result(),true)$$,'42501','FORBIDDEN','Actor request cannot invoke internal finalization');
select is((select count(*)::integer from app_private.exercise_tests where visibility='hidden'),0,'RUN did not broaden hidden-test RLS');
select throws_ok($$select pg_temp.admit_run('98100000-0000-4000-8000-000000000002','run-key-0001')$$,'P0001','REQUEST_IN_PROGRESS','Concurrent transport replay cannot reserve twice');
select throws_ok($$select pg_temp.admit_run('98100000-0000-4000-8000-000000000002','run-key-0001',repeat('d',64))$$,'P0001','IDEMPOTENCY_CONFLICT','Same key with different payload rejected');
select throws_ok($$select pg_temp.admit_run('98100000-0000-4000-8000-000000000002','run-key-0002')$$,'P0001','RATE_LIMITED','One active RUN per student enforced in database');
select throws_ok($$select pg_temp.finish_run('98100000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000000',pg_temp.run_result(),true)$$,'P0001','REQUEST_IN_PROGRESS','Forged fencing token cannot complete RUN');
select throws_ok($$select pg_temp.finish_run('98100000-0000-4000-8000-000000000001',null,pg_temp.run_result(),true)$$,'P0001','REQUEST_IN_PROGRESS','NULL fencing token cannot complete RUN');
select throws_ok($$select pg_temp.finish_run('98100000-0000-4000-8000-000000000001',pg_temp.run_token('98100000-0000-4000-8000-000000000001'),'{}',true)$$,'23514','INVALID_RUN_RESULT','Incomplete result cannot be persisted');
select throws_ok($$select pg_temp.finish_run('98100000-0000-4000-8000-000000000001',pg_temp.run_token('98100000-0000-4000-8000-000000000001'),jsonb_set(pg_temp.run_result(),'{diagnosisCode}','null'),true)$$,'23514','INVALID_RUN_RESULT','JSON null diagnosis cannot be persisted');
select throws_ok($$select pg_temp.finish_run('98100000-0000-4000-8000-000000000001',pg_temp.run_token('98100000-0000-4000-8000-000000000001'),jsonb_set(pg_temp.run_result(),'{runtimeMs}','null'),true)$$,'23514','INVALID_RUN_RESULT','JSON null timing cannot be persisted');
select throws_ok($$select pg_temp.finish_run('98100000-0000-4000-8000-000000000001',pg_temp.run_token('98100000-0000-4000-8000-000000000001'),jsonb_set(pg_temp.run_result(),'{visibleTestResults}','[{"id":"hidden-sentinel","passed":false,"stdout":"","stderr":""}]'),true)$$,'23514','INVALID_RUN_RESULT','Result cannot introduce a hidden-test ID');
select throws_ok($$select pg_temp.finish_run('98100000-0000-4000-8000-000000000001',pg_temp.run_token('98100000-0000-4000-8000-000000000001'),jsonb_set(pg_temp.run_result(),'{visibleTestResults}','[{"id":"visible","passed":false,"stdout":"","stderr":"","extra":"untrusted"}]'),true)$$,'23514','INVALID_RUN_RESULT','Nested result keys are allowlisted');
select throws_ok($$select pg_temp.finish_run('98100000-0000-4000-8000-000000000001',pg_temp.run_token('98100000-0000-4000-8000-000000000001'),jsonb_set(pg_temp.run_result(),'{visibleTestResults}','[{"id":"visible","passed":false,"stdout":"unexpected bytes","stderr":""}]'),true)$$,'23514','INVALID_RUN_RESULT','Visible output cannot exceed declared captured byte count');
select is(pg_temp.finish_run('98100000-0000-4000-8000-000000000001',pg_temp.run_token('98100000-0000-4000-8000-000000000001'),pg_temp.run_result(),null),null::jsonb,'NULL cleanup confirmation cannot complete RUN');
select is((select lifecycle_status from app.executions limit 1),'RECOVERING','Unknown cleanup keeps lease and quota occupied');
select ok((select lease_until>=admitted_at+interval '60 seconds' from app.executions where id='98100000-0000-4000-8000-000000000001'),'Unknown cleanup preserves the original admission grace period');
reset role;
savepoint recovery_backfill;
-- Simulate two pre-upgrade reservations: only one still has admission grace.
update app.executions set lease_until=clock_timestamp()-interval '1 second' where id='98100000-0000-4000-8000-000000000001';
select set_config('test.backfill_token',pg_temp.run_token('98100000-0000-4000-8000-000000000001')::text,true);
insert into app.operation_keys(id,organization_id,actor_id,operation,key,payload_hash,state,resource_type,resource_id,lease_until)
 values('98300000-0000-4000-8000-000000000050','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003','practice.run','backfill-old-0050',repeat('a',64),'RUNNING','execution','98100000-0000-4000-8000-000000000050',clock_timestamp()-interval '1 second');
insert into app.executions select (jsonb_populate_record(null::app.executions,to_jsonb(e)||jsonb_build_object(
 'id','98100000-0000-4000-8000-000000000050','operation_id','98300000-0000-4000-8000-000000000050',
 'admitted_at',clock_timestamp()-interval '120 seconds','started_at',clock_timestamp()-interval '120 seconds',
 'lease_until',clock_timestamp()-interval '1 second','lease_token',gen_random_uuid()))).*
 from app.executions e where id='98100000-0000-4000-8000-000000000001';
with repaired as(update app.executions set lease_until=admitted_at+interval '60 seconds'
 where lifecycle_status='RECOVERING' and lease_until<admitted_at+interval '60 seconds' and admitted_at+interval '60 seconds'>clock_timestamp() returning id)
 select is((select count(*)::integer from repaired),1,'Upgrade backfill repairs only an admission grace period that is still future');
select is(pg_temp.run_token('98100000-0000-4000-8000-000000000001')::text,current_setting('test.backfill_token'),'Upgrade backfill preserves the fencing token');
select ok((select lease_until<clock_timestamp() from app.executions where id='98100000-0000-4000-8000-000000000050'),'Elapsed grace is not extended by upgrade');
with repaired as(update app.executions set lease_until=admitted_at+interval '60 seconds'
 where lifecycle_status='RECOVERING' and lease_until<admitted_at+interval '60 seconds' and admitted_at+interval '60 seconds'>clock_timestamp() returning id)
 select is((select count(*)::integer from repaired),0,'Upgrade backfill is idempotent');
rollback to savepoint recovery_backfill;
set local role alunza_app;
set local app.actor_id='';
set local app.session_id='';
select is(app_private.claim_expired_practice_run(),null::jsonb,'Lost create response cannot be reconciled before admission grace expires');
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
select set_config('test.run_old_token',pg_temp.run_token('98100000-0000-4000-8000-000000000001')::text,true);
select throws_ok($$select app_private.claim_expired_practice_run()$$,'42501','FORBIDDEN','Actor request cannot impersonate reconciler');

set local app.actor_id='91000000-0000-4000-8000-000000000002';
set local app.session_id='91100000-0000-4000-8000-000000000002';
select is((select count(*)::integer from app.executions),0,'Teacher receives no RUN result access');
select throws_ok($$select pg_temp.admit_run('98100000-0000-4000-8000-000000000002','run-key-0002')$$,'42501','FORBIDDEN','Teacher cannot execute as student');
set local app.actor_id='91000000-0000-4000-8000-000000000004';
set local app.session_id='91100000-0000-4000-8000-000000000004';
set local app.organization_id='92000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from app.executions),0,'Other organization cannot read reservation');

reset role;
update app.executions set lease_until=clock_timestamp()-interval '1 second' where id='98100000-0000-4000-8000-000000000001';
set local role alunza_app;
set local app.actor_id='';
set local app.session_id='';
set local app.organization_id='';
select is(app_private.claim_expired_practice_run()->>'executionId','98100000-0000-4000-8000-000000000001','Reconciler only claims expired work');
select is(app_private.claim_expired_practice_run(),null::jsonb,'No second claimant obtains the live recovery lease');
select throws_ok($$select pg_temp.finish_run('98100000-0000-4000-8000-000000000001',current_setting('test.run_old_token')::uuid,pg_temp.run_result(),true)$$,'P0001','REQUEST_IN_PROGRESS','Reclaimed lease fences old request');

reset role;
select set_config('test.run_token',(select lease_token::text from app.executions where id='98100000-0000-4000-8000-000000000001'),true);
update app.organization_memberships set state='DISABLED' where user_id='91000000-0000-4000-8000-000000000003';
set local role alunza_app;
select is(pg_temp.finish_run('98100000-0000-4000-8000-000000000001',current_setting('test.run_token')::uuid,pg_temp.run_result(),true)->>'executionId','98100000-0000-4000-8000-000000000001','Lease can conserve terminal evidence after permission revocation');
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
set local app.organization_id='92000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from app.executions),0,'Revocation withholds the conserved result');
select throws_ok($$select pg_temp.admit_run('98100000-0000-4000-8000-000000000002','run-key-0001')$$,'42501','FORBIDDEN','Replay does not bypass revocation');
reset role;
update app.organization_memberships set state='ACTIVE' where user_id='91000000-0000-4000-8000-000000000003';
set local role alunza_app;
select is(pg_temp.admit_run('98100000-0000-4000-8000-000000000002','run-key-0001')->'response'->>'executionId','98100000-0000-4000-8000-000000000001','Completed replay returns original ID');
select throws_ok($$select pg_temp.admit_run('98100000-0000-4000-8000-000000000002','run-key-0002',repeat('a',64),1)$$,'P0001','RATE_LIMITED','Frequency counts new admissions only');
select is(pg_temp.admit_run('98100000-0000-4000-8000-000000000002','run-key-0002')->>'kind','reserved','Deliberate next RUN receives distinct reservation');
select set_config('test.run_token',pg_temp.run_token('98100000-0000-4000-8000-000000000002')::text,true);
reset role;
savepoint archive_run_guard;
-- Remove all other archive dependencies so only RUN's operational state can
-- reject this request. This scenario is restored before the close/replay tests.
update app.organization_memberships set state='DISABLED' where organization_id='92000000-0000-4000-8000-000000000001' and role<>'ADMIN';
update app.activities set state='CLOSED' where id='97000000-0000-4000-8000-000000000001';
update app.classes set archived_at=clock_timestamp() where organization_id='92000000-0000-4000-8000-000000000001';
update app.courses set archived_at=clock_timestamp() where organization_id='92000000-0000-4000-8000-000000000001';
update app.exercises set archived_at=clock_timestamp() where organization_id='92000000-0000-4000-8000-000000000001';
update app.concept_tags set archived_at=clock_timestamp() where organization_id='92000000-0000-4000-8000-000000000001';
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000001';
set local app.session_id='91100000-0000-4000-8000-000000000001';
select throws_ok($$update app.organizations set archived_at=clock_timestamp(),archived_by='91000000-0000-4000-8000-000000000001',archive_reason='Archive fixture' where id='92000000-0000-4000-8000-000000000001'$$,'P0001','DEPENDENCIES_ACTIVE','Active RUN prevents organization archive after other dependencies are removed');
reset role;
update app.executions set lifecycle_status='RECOVERING' where id='98100000-0000-4000-8000-000000000002';
set local role alunza_app;
select throws_ok($$update app.organizations set archived_at=clock_timestamp(),archived_by='91000000-0000-4000-8000-000000000001',archive_reason='Archive fixture' where id='92000000-0000-4000-8000-000000000001'$$,'P0001','DEPENDENCIES_ACTIVE','Unverified cleanup also prevents organization archive');
select lives_ok($$select pg_temp.finish_run('98100000-0000-4000-8000-000000000002',current_setting('test.run_token')::uuid,pg_temp.run_result(),true)$$,'Recovery can finish after all student permissions are revoked');
select lives_ok($$update app.organizations set archived_at=clock_timestamp(),archived_by='91000000-0000-4000-8000-000000000001',archive_reason='Archive fixture' where id='92000000-0000-4000-8000-000000000001'$$,'Completed RUN evidence permits organization archive');
rollback to savepoint archive_run_guard;
update app.activities set state='CLOSED' where id='97000000-0000-4000-8000-000000000001';
set local role alunza_app;
select is(pg_temp.finish_run('98100000-0000-4000-8000-000000000002',current_setting('test.run_token')::uuid,pg_temp.run_result(),true)->>'executionId','98100000-0000-4000-8000-000000000002','Admission preceding close finishes after close');
select throws_ok($$select pg_temp.admit_run('98100000-0000-4000-8000-000000000003','run-key-0003')$$,'P0001','ACTIVITY_CLOSED','Admission after close is rejected');
select is(pg_temp.admit_run('98100000-0000-4000-8000-000000000003','run-key-0002')->>'kind','replay','Close preserves authorized replay');
reset role;
update app.operation_keys set expires_at=clock_timestamp()-interval '1 second' where operation='practice.run' and key='run-key-0002';
set local role alunza_app;
select throws_ok($$select pg_temp.admit_run('98100000-0000-4000-8000-000000000003','run-key-0002')$$,'P0001','IDEMPOTENCY_EXPIRED','Expired key is a tombstone, not a new execution');
select is((select count(*)::integer from app.executions),2,'No duplicates, attempts or implicit reruns were created');
set local app.actor_id='';
set local app.session_id='';
select lives_ok($$select app_private.purge_practice_responses()$$,'RUN retention is independent of invitation worker');
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
select is((select count(*)::integer from app.operation_keys where operation='practice.run' and key='run-key-0002' and response_body is null),1,'Expired replay response was purged while retaining key');
select * from finish();
rollback;
