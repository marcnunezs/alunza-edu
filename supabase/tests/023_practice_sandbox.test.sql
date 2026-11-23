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
-- Validate the original domain constraints without flushing signal capture mid-transaction.
-- SET CONSTRAINTS ALL IMMEDIATE and subsequent DML rejection have their own signals integration test.
set constraints app.provisioning_complete, app.exercise_definition_complete,
 app.concept_current_version, app.exercise_current_version immediate;

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

-- SANDBOX FIXTURE READY: also used by the concurrent SQL integration harness.
create function pg_temp.sid(n integer) returns uuid language sql immutable as $$
 select ('99200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.context(campaign integer default 999,creations integer default 3,requests integer default 40) returns jsonb language sql stable as $$
 select jsonb_build_object('provider','vercel','runnerVersion','sql-test','image','alunza/runner@sha256:'||repeat('a',64),
  'teamId','team_test','projectId','prj_test','region','iad1','campaignId',pg_temp.sid(campaign),'expiresAt',to_char(now()+interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'maxCreations',creations,'maxRequests',requests)
$$;
create function pg_temp.admit(n integer,purpose text default 'SUBMIT',ctx jsonb default pg_temp.context()) returns jsonb language plpgsql as $$
begin
 if purpose='RUN' then return app_private.admit_practice_run(pg_temp.sid(n),'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',
 '96100000-0000-4000-8000-000000000001','sandbox-key-'||n,repeat('a',64),repeat('b',64),repeat('c',64),1,'sql-test','99000000-0000-4000-8000-000000000001',true,10,32,120,ctx); end if;
 return app_private.admit_practice_submit(pg_temp.sid(n),'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',
 '96100000-0000-4000-8000-000000000001','sandbox-key-'||n,repeat('a',64),'module.exports.solve=(a,b)=>a+b;',null,'sql-test','99000000-0000-4000-8000-000000000001',true,10,32,120,ctx);
end $$;
create function pg_temp.token(n integer) returns uuid language sql security definer as $$
 select lease_token from app.executions where id=pg_temp.sid(n) union all select lease_token from app_private.submission_reservations where id=pg_temp.sid(n)
$$;
create function pg_temp.creation(n integer) returns uuid language sql security definer as $$
 select creation_id from app_private.sandbox_resources where execution_id=pg_temp.sid(n)
$$;
create function pg_temp.result(submit boolean default true) returns jsonb language sql immutable as $$
 select '{"runnerVersion":"sql-test","diagnosisCode":"UNKNOWN","terminationReason":"RUNNER_FAILURE","infrastructureStatus":"FAILED","visibleTestResults":[],"visiblePassed":0,"visibleTotal":1,"outputTruncated":false,"outputBytes":0,"runtimeMs":0,"lifecycleMs":0}'::jsonb
  ||case when submit then '{"hiddenChecksPassed":null,"allRequiredPassed":false}'::jsonb else '{}'::jsonb end
$$;
create function pg_temp.proof(n integer,kind text default 'ABSENT_AND_ZERO_SNAPSHOTS') returns jsonb language sql volatile as $$
 select jsonb_build_object('creationId',pg_temp.creation(n),'kind',kind)||case when kind='NOT_DISPATCHED' then '{}'::jsonb else
  jsonb_build_object('sandboxId','sbx-'||n,'lookupAbsent',true,'snapshotsRemaining',0,'observedAt',clock_timestamp()) end
$$;

select ok(not has_table_privilege('alunza_app','app_private.sandbox_resources','SELECT'),'No direct app access to resource correlation');
select ok(not has_table_privilege('authenticated','app_private.sandbox_campaigns','SELECT'),'No browser access to campaign ledger');
select ok(not has_function_privilege('alunza_app','app_private.prepare_sandbox_execution(uuid,uuid,text,jsonb)','EXECUTE'),'Preparation is reachable only inside authorized admission');
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
set local app.organization_id='92000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.admit(90,'RUN',pg_temp.context()||jsonb_build_object('expiresAt','2000-01-01T00:00:00Z'))$$,'P0001','DEPENDENCY_UNAVAILABLE','Expired context cannot admit');
select is(pg_temp.admit(1,'RUN')->'executionContext',pg_temp.context(),'RUN atomically returns the admitted provider context');
select is(pg_temp.admit(2)->'executionContext',pg_temp.context(),'SUBMIT atomically returns the admitted provider context');
select is(pg_temp.admit(3)->>'kind','reserved','Unstarted reservation has durable correlation');
select throws_ok($$select pg_temp.admit(4,'SUBMIT',pg_temp.context()||'{"region":"sfo1"}'::jsonb)$$,'23514','IMMUTABLE_SANDBOX_CAMPAIGN','Campaign metadata cannot change between admissions');
select throws_ok($$select app_private.load_sandbox_resource(pg_temp.sid(1))$$,'42501','FORBIDDEN','Actor cannot invoke internal resource reader');
set local app.actor_id='91000000-0000-4000-8000-000000000004';
set local app.session_id='91100000-0000-4000-8000-000000000004';
select throws_ok($$select pg_temp.admit(5)$$,'42501','FORBIDDEN','Foreign teacher cannot create provider resources');
reset role;
select is((select count(*)::integer from app.executions where id=pg_temp.sid(90)),0,'Invalid context rolls back the original admission');
select is((select count(*)::integer from app_private.submission_reservations where id=pg_temp.sid(4)),0,'Metadata rejection rolls back SUBMIT admission');
select is((select count(*)::integer from app_private.sandbox_resources),3,'Exactly one resource per authorized admission');
select is((select class_id::text from app_private.sandbox_resources where execution_id=pg_temp.sid(1)),'94000000-0000-4000-8000-000000000001','Resource class is server-derived');
set local role alunza_app;
set local app.actor_id=''; set local app.session_id='';
select is(app_private.load_sandbox_resource(pg_temp.sid(1))->>'creationState','PREPARED','Correlation is available before POST');
select throws_ok($$select app_private.begin_sandbox_creation(pg_temp.sid(1),gen_random_uuid())$$,'P0001','REQUEST_IN_PROGRESS','Wrong lease cannot dispatch');
select is(app_private.begin_sandbox_creation(pg_temp.sid(1),pg_temp.token(1))->>'creationState','UNKNOWN','One dispatch commits uncertainty before POST');
select throws_ok($$select app_private.begin_sandbox_creation(pg_temp.sid(1),pg_temp.token(1))$$,'P0001','REQUEST_IN_PROGRESS','Repeated begin cannot recreate');
select throws_ok($$select app_private.verify_sandbox_cleanup(pg_temp.sid(1),pg_temp.proof(1,'NOT_DISPATCHED'))$$,'23514','INVALID_SANDBOX_CLEANUP','Dispatched request cannot claim it was not sent');
select throws_ok($$select app_private.verify_sandbox_cleanup(pg_temp.sid(1),pg_temp.proof(1))$$,'23514','INVALID_SANDBOX_CLEANUP','404 and empty snapshots cannot clear unknown creation');
select throws_ok($$select app_private.verify_sandbox_cleanup(pg_temp.sid(1),jsonb_build_object('creationId',pg_temp.creation(1),'kind','TTL_EXPIRED'))$$,'23514','INVALID_SANDBOX_CLEANUP','TTL cannot prove cleanup');
select throws_ok($$select app_private.finish_practice_run(pg_temp.sid(1),pg_temp.token(1),pg_temp.result(false),true)$$,'P0001','REQUEST_IN_PROGRESS','RUN cannot finish from an in-memory cleanup boolean');
select is(app_private.confirm_sandbox_resource(pg_temp.sid(1),pg_temp.creation(1),'sbx-1')->>'creationState','CONFIRMED','Provider receipt binds ID durably');
select is(app_private.confirm_sandbox_resource(pg_temp.sid(1),pg_temp.creation(1),'sbx-1')->>'providerResourceId','sbx-1','Duplicate receipt is idempotent');
select throws_ok($$select app_private.confirm_sandbox_resource(pg_temp.sid(1),pg_temp.creation(1),'sbx-other')$$,'23514','INVALID_SANDBOX_RECEIPT','Provider ID is immutable');
select throws_ok($$select app_private.verify_sandbox_cleanup(pg_temp.sid(1),pg_temp.proof(1)||'{"snapshotsRemaining":1}'::jsonb)$$,'23514','INVALID_SANDBOX_CLEANUP','Remaining snapshot blocks cleanup');
select throws_ok($$select app_private.verify_sandbox_cleanup(pg_temp.sid(1),pg_temp.proof(1)||'{"observedAt":null}'::jsonb)$$,'23514','INVALID_SANDBOX_CLEANUP','Null observation time is not evidence');
select lives_ok($$select app_private.verify_sandbox_cleanup(pg_temp.sid(1),pg_temp.proof(1))$$,'Confirmed identity and absence record cleanup proof');
select lives_ok($$select app_private.verify_sandbox_cleanup(pg_temp.sid(1),pg_temp.proof(1))$$,'Cleanup recording is idempotent after a lost commit response');
select is(app_private.finish_practice_run(pg_temp.sid(1),pg_temp.token(1),pg_temp.result(false),true)->'technicalResult'->>'diagnosisCode','UNKNOWN','Verified cleanup allows one operational RUN result');
select is(app_private.begin_sandbox_creation(pg_temp.sid(2),pg_temp.token(2))->>'creationState','UNKNOWN','SUBMIT has its own creation');
select ok(app_private.stage_practice_submit_result(pg_temp.sid(2),pg_temp.token(2),pg_temp.result(),'[]'),'SUBMIT stages canonical evidence before commit');
select throws_ok($$select app_private.finish_practice_submit(pg_temp.sid(2),pg_temp.token(2),true)$$,'P0001','REQUEST_IN_PROGRESS','SUBMIT cannot finish without durable cleanup proof');
select set_config('test.old_token',pg_temp.token(2)::text,true);
reset role;
update app_private.submission_reservations set lease_until=clock_timestamp()-interval '1 second' where id=pg_temp.sid(2);
set local role alunza_app;
select is(app_private.claim_expired_practice_submit()->>'executionId',pg_temp.sid(2)::text,'Expired reservation is reclaimed, never rerun');
select is(app_private.read_practice_execution_context(pg_temp.sid(2)),pg_temp.context(),'Recovery reads immutable admitted context');
select throws_ok($$select app_private.assert_sandbox_active(pg_temp.sid(2),current_setting('test.old_token')::uuid)$$,'P0001','REQUEST_IN_PROGRESS','Expired worker is fenced');
select is(app_private.confirm_sandbox_resource(pg_temp.sid(2),pg_temp.creation(2),'sbx-2')->>'providerResourceId','sbx-2','Late ID receipt survives rotated lease');
select throws_ok($$select app_private.assert_sandbox_active(pg_temp.sid(2),pg_temp.token(2))$$,'P0001','REQUEST_IN_PROGRESS','Recovery lease never grants execution');
select throws_ok($$select app_private.consume_sandbox_request(pg_temp.sid(2),pg_temp.creation(2),false)$$,'P0001','REQUEST_IN_PROGRESS','Recovery cannot consume normal execution requests');
select lives_ok($$select app_private.consume_sandbox_request(pg_temp.sid(2),pg_temp.creation(2),true)$$,'Recovery can consume bounded cleanup requests');
select lives_ok($$select app_private.verify_sandbox_cleanup(pg_temp.sid(2),pg_temp.proof(2))$$,'Late identified resource can be cleaned');
select is(app_private.finish_practice_submit(pg_temp.sid(2),pg_temp.token(2),true)->'technicalResult'->>'diagnosisCode','UNKNOWN','Recovery consumes staged result exactly once');
select lives_ok($$select app_private.verify_sandbox_cleanup(pg_temp.sid(3),pg_temp.proof(3,'NOT_DISPATCHED'))$$,'Prepared-only reservation proves no creation');
select throws_ok($$select app_private.begin_sandbox_creation(pg_temp.sid(3),pg_temp.token(3))$$,'P0001','REQUEST_IN_PROGRESS','No dispatch after not-dispatched cleanup');
select ok(app_private.stage_practice_submit_result(pg_temp.sid(3),pg_temp.token(3),pg_temp.result(),'[]'),'Unstarted SUBMIT can stage operational UNKNOWN');
select is(app_private.finish_practice_submit(pg_temp.sid(3),pg_temp.token(3),true)->'technicalResult'->>'diagnosisCode','UNKNOWN','Unstarted SUBMIT terminalizes without execution');
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
select is(pg_temp.admit(1,'RUN',pg_temp.context()||jsonb_build_object('expiresAt','2000-01-01T00:00:00Z'))->>'kind','replay','Completed replay bypasses new provider admission and expiry');
select is(pg_temp.admit(2)->>'kind','replay','SUBMIT commit response loss returns the same attempt');
select is(pg_temp.admit(6,'RUN',pg_temp.context(998,1,10))->>'kind','reserved','Separate bounded campaign admits RUN');
select is(pg_temp.admit(7,'SUBMIT',pg_temp.context(998,1,10))->>'kind','reserved','Admission race does not itself dispatch a second resource');
set local app.actor_id=''; set local app.session_id='';
select is(app_private.begin_sandbox_creation(pg_temp.sid(6),pg_temp.token(6))->>'creationState','UNKNOWN','First campaign creation consumes the sole allowance');
select throws_ok($$select app_private.begin_sandbox_creation(pg_temp.sid(7),pg_temp.token(7))$$,'P0001','DEPENDENCY_UNAVAILABLE','Second resource cannot exceed durable creation quota');
select lives_ok($$select app_private.consume_sandbox_request(pg_temp.sid(6),pg_temp.creation(6),false) from generate_series(1,2)$$,'Normal requests use only unreserved campaign allowance');
select throws_ok($$select app_private.consume_sandbox_request(pg_temp.sid(6),pg_temp.creation(6),false)$$,'P0001','DEPENDENCY_UNAVAILABLE','Eight requests remain reserved for cleanup');
select lives_ok($$select app_private.consume_sandbox_request(pg_temp.sid(6),pg_temp.creation(6),true) from generate_series(1,8)$$,'Cleanup can consume its reserved allowance');
select throws_ok($$select app_private.consume_sandbox_request(pg_temp.sid(6),pg_temp.creation(6),true)$$,'P0001','DEPENDENCY_UNAVAILABLE','Exhausted budget never permits implicit additional requests');
select lives_ok($$select app_private.purge_practice_responses(); select app_private.purge_submit_responses()$$,'Normal response purge remains available');
select is(app_private.load_sandbox_resource(pg_temp.sid(6))->>'cleanupState','PENDING','Unresolved resource survives purge and exhausted budget');
reset role;
select is((select count(*)::integer from app.attempts where execution_id in (pg_temp.sid(2),pg_temp.sid(3))),2,'Failed commit and replay produce exactly two intended attempts');
select is((select creations from app_private.sandbox_campaigns where id=pg_temp.sid(999)),2,'Unstarted cleanup consumes no creation allowance');
select is((select total_requests from app_private.sandbox_campaigns where id=pg_temp.sid(998)),10,'Campaign stores exact total request count');
select throws_ok($$update app_private.sandbox_campaigns set max_requests=100 where id=pg_temp.sid(998)$$,'23514','IMMUTABLE_SANDBOX_CAMPAIGN','Campaign budget cannot be increased in place');
select throws_ok($$update app_private.sandbox_campaigns set total_requests=2 where id=pg_temp.sid(998)$$,'23514','IMMUTABLE_SANDBOX_CONSUMPTION','Consumed budget cannot be reset');
select throws_ok($$update app_private.sandbox_resources set sandbox_name='other-name' where execution_id=pg_temp.sid(6)$$,'23514','IMMUTABLE_SANDBOX_RESOURCE','Correlation cannot move to another remote resource');
select throws_ok($$update app_private.sandbox_resources set creation_state='PREPARED',dispatched_at=null where execution_id=pg_temp.sid(6)$$,'23514','IMMUTABLE_SANDBOX_RESOURCE','Unknown dispatch cannot be reset to allow a second creation');
set local role alunza_app;
select is(jsonb_array_length(app_private.observe_sandbox_campaign(pg_temp.sid(999))->'resources'),3,'Operational observation filters exactly one campaign');
select is(app_private.observe_sandbox_campaign(pg_temp.sid(998))->>'totalRequests','10','Operational observation reports durable request count');
select ok(not exists(select 1 from jsonb_array_elements(app_private.observe_sandbox_campaign(pg_temp.sid(999))->'resources') r where r ?| array['code','tests','actorId','studentId']),'Operational observation excludes pedagogical payload and actor identities');
set local app.actor_id='91000000-0000-4000-8000-000000000003';
select throws_ok($$select app_private.observe_sandbox_campaign(pg_temp.sid(999))$$,'42501','FORBIDDEN','Campaign observer rejects actor context');
reset role;
select * from finish();
rollback;


