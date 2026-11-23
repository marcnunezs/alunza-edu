begin;
grant alunza_app to postgres;
-- Test-only access to private helpers; transaction rollback removes membership.
-- SET ROLE alunza_app below still exercises the real application privileges.
grant alunza_identity to postgres;
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


create function pg_temp.sid(n integer) returns uuid language sql immutable as $$ select ('99300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.context() returns jsonb language sql immutable as $$
 select jsonb_build_object('provider','local-vm','runnerVersion','imp-03-quickjs.13','image','sha256:'||repeat('a',64),
 'hostId',pg_temp.sid(800),'kitManifestSha256',repeat('b',64),'brokerVersion','local-vm-broker-v1','guestSha256',repeat('c',64),'brokerGeneration',pg_temp.sid(801))
$$;
create function pg_temp.admit(n integer,purpose text default 'RUN',ctx jsonb default pg_temp.context()) returns jsonb language plpgsql as $$ begin
 if purpose='RUN' then return app_private.admit_practice_run(pg_temp.sid(n),'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',
 '96100000-0000-4000-8000-000000000001','vm-key-'||n,repeat('a',64),repeat('b',64),repeat('c',64),1,'imp-03-quickjs.13',pg_temp.sid(900),true,10,32,120,ctx); end if;
 return app_private.admit_practice_submit(pg_temp.sid(n),'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',
 '96100000-0000-4000-8000-000000000001','vm-key-'||n,repeat('a',64),'module.exports.solve=(a,b)=>a+b;',null,'imp-03-quickjs.13',pg_temp.sid(900),true,10,32,120,ctx);
end $$;
create function pg_temp.token(n integer) returns uuid language sql security definer as $$
 select lease_token from app.executions where id=pg_temp.sid(n) union all select lease_token from app_private.submission_reservations where id=pg_temp.sid(n)
$$;
create function pg_temp.begin_vm(n integer,token uuid default null) returns jsonb language plpgsql as $$
 declare deadline double precision:=floor(extract(epoch from clock_timestamp())*1000)+25000; begin
 return app_private.begin_local_vm_creation(pg_temp.sid(n),coalesce(token,pg_temp.token(n)),repeat('d',64),deadline,deadline+10000);
end $$;
create function pg_temp.proof(n integer,kind text default 'RETIRED') returns jsonb language plpgsql as $$
 declare r jsonb:=app_private.load_local_vm_resource(pg_temp.sid(n)); begin
 return jsonb_build_object('kind',kind,'executionId',pg_temp.sid(n),'creationId',r->'creationId','resourceId',r->'resourceId',
 'hostId',pg_temp.context()->'hostId','brokerGeneration',pg_temp.context()->'brokerGeneration','qemuAbsent',true,'overlaysAbsent',true,'observedAt',clock_timestamp()); end $$;
create function pg_temp.result(submit boolean default false) returns jsonb language sql immutable as $$
 select '{"runnerVersion":"imp-03-quickjs.13","diagnosisCode":"UNKNOWN","terminationReason":"RUNNER_FAILURE","infrastructureStatus":"FAILED","visibleTestResults":[],"visiblePassed":0,"visibleTotal":1,"outputTruncated":false,"outputBytes":0,"runtimeMs":0,"lifecycleMs":0}'::jsonb
 ||case when submit then '{"hiddenChecksPassed":null,"allRequiredPassed":false}'::jsonb else '{}'::jsonb end
$$;
select ok(app_private.valid_local_vm_context(pg_temp.context()),'Exact pinned local VM context accepted');
select ok(not app_private.valid_local_vm_context(pg_temp.context()-'brokerGeneration'),'Missing generation rejected');
select ok(not app_private.valid_local_vm_context(pg_temp.context()||'{"image":null}'),'Null pin rejected');
select ok(not app_private.valid_local_vm_context(pg_temp.context()||'{"token":"secret"}'),'Unexpected context fields rejected');
select ok(not has_table_privilege('alunza_app','app_private.local_vm_resources','SELECT'),'API cannot select private ledger directly');
select ok(not has_table_privilege('authenticated','app_private.local_vm_resources','SELECT'),'Browser cannot see VM resources');
select ok(not has_function_privilege('anon','app_private.begin_local_vm_creation(uuid,uuid,text,double precision,double precision)','EXECUTE'),'Anonymous dispatch forbidden');
select ok(not has_function_privilege('alunza_app','app_private.local_vm_payload(app_private.local_vm_resources)','EXECUTE'),'Payload helper is private');
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
set local app.organization_id='92000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.admit(90,'RUN',pg_temp.context()-'guestSha256')$$,'23514','INVALID_EXECUTION_CONTEXT','Partial identity rolls admission back');
select is(pg_temp.admit(1)->'executionContext',pg_temp.context(),'RUN records context atomically');
select throws_ok($$select pg_temp.admit(2,'SUBMIT')$$,'P0001','RUNNER_BUSY','Pending RUN blocks SUBMIT before durable admission');
select throws_ok($$select pg_temp.begin_vm(1)$$,'42501','FORBIDDEN','Actor cannot dispatch VM');
select throws_ok($$select app_private.load_local_vm_resource(pg_temp.sid(1))$$,'42501','FORBIDDEN','Actor cannot inspect resources');
set local app.actor_id=''; set local app.session_id='';
select is(app_private.load_local_vm_resource(pg_temp.sid(1))->>'creationState','PREPARED','Ledger precedes broker requests');
select throws_ok($$select pg_temp.begin_vm(1,pg_temp.sid(901))$$,'P0001','REQUEST_IN_PROGRESS','Wrong lease cannot dispatch');
select is(pg_temp.begin_vm(1)->>'creationState','UNKNOWN','Dispatch uncertainty is durable before request');
select throws_ok($$select pg_temp.begin_vm(1)$$,'P0001','REQUEST_IN_PROGRESS','Repeat dispatch cannot create another VM');
select throws_ok($$select app_private.finish_practice_run(pg_temp.sid(1),pg_temp.token(1),pg_temp.result(),true)$$,'P0001','REQUEST_IN_PROGRESS','Boolean cleanup alone cannot commit');
select is(app_private.confirm_local_vm_resource(pg_temp.sid(1),(app_private.load_local_vm_resource(pg_temp.sid(1))->>'creationId')::uuid,pg_temp.sid(501))->>'creationState','CONFIRMED','Broker identity is recorded before input');
select lives_ok($$select app_private.assert_local_vm_active(pg_temp.sid(1),pg_temp.token(1),pg_temp.context())$$,'Live lease allows one input request');
select throws_ok($$select app_private.assert_local_vm_active(pg_temp.sid(1),pg_temp.token(1),pg_temp.context()||jsonb_build_object('brokerGeneration',pg_temp.sid(802)))$$,'P0001','REQUEST_IN_PROGRESS','Generation change cannot redirect admitted input');
select throws_ok($$select app_private.verify_local_vm_cleanup(pg_temp.sid(1),pg_temp.proof(1)||'{"kind":null}')$$,'23514','INVALID_LOCAL_VM_PROOF','Null proof kind cannot verify cleanup');
select throws_ok($$select app_private.verify_local_vm_cleanup(pg_temp.sid(1),pg_temp.proof(1)||'{"qemuAbsent":false}')$$,'23514','INVALID_LOCAL_VM_PROOF','Live QEMU blocks cleanup');
select throws_ok($$select app_private.verify_local_vm_cleanup(pg_temp.sid(1),pg_temp.proof(1)||jsonb_build_object('resourceId',pg_temp.sid(502)))$$,'23514','INVALID_LOCAL_VM_PROOF','Foreign VM cannot prove cleanup');
select lives_ok($$select app_private.verify_local_vm_cleanup(pg_temp.sid(1),pg_temp.proof(1))$$,'Correlated retirement is durable');
select throws_ok($$select app_private.assert_local_vm_active(pg_temp.sid(1),pg_temp.token(1),pg_temp.context())$$,'P0001','REQUEST_IN_PROGRESS','Retired creation cannot receive input');
select is(app_private.finish_practice_run(pg_temp.sid(1),pg_temp.token(1),pg_temp.result(),true)->'technicalResult'->>'diagnosisCode','UNKNOWN','Verified cleanup permits one operational result');
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
select is(pg_temp.admit(2,'SUBMIT')->'executionContext',pg_temp.context(),'SUBMIT records context atomically after RUN retirement');
set local app.actor_id=''; set local app.session_id='';
select is(pg_temp.begin_vm(2)->>'creationState','UNKNOWN','Lost prepare response remains uncertain');
select ok(app_private.stage_practice_submit_result(pg_temp.sid(2),pg_temp.token(2),pg_temp.result(true),'[]'::jsonb),'SUBMIT staging remains durable');
reset role;
update app_private.submission_reservations set lease_until=clock_timestamp()-interval '1 second' where id=pg_temp.sid(2);
set local role alunza_app;
select is(app_private.claim_expired_practice_submit()->>'executionId',pg_temp.sid(2)::text,'Expired lease claimed for cleanup');
select throws_ok($$select app_private.assert_local_vm_active(pg_temp.sid(2),pg_temp.token(2),pg_temp.context())$$,'P0001','REQUEST_IN_PROGRESS','Recovery never authorizes input');
select lives_ok($$select app_private.verify_local_vm_cleanup(pg_temp.sid(2),pg_temp.proof(2,'NOT_STARTED'))$$,'Durable broker tombstone resolves lost preparation');
select is(app_private.finish_practice_submit(pg_temp.sid(2),pg_temp.token(2),true)->'technicalResult'->>'diagnosisCode','UNKNOWN','Recovery preserves staged result without execution');
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
select is(pg_temp.admit(1)->>'kind','replay','Same request replays durable response');
select is(pg_temp.admit(3)->>'kind','reserved','New request gets a distinct reservation');
set local app.actor_id=''; set local app.session_id='';
select lives_ok($$select app_private.verify_local_vm_cleanup(pg_temp.sid(3),pg_temp.proof(3,'NOT_STARTED'))$$,'No dispatch still requires durable broker tombstone');
select throws_ok($$select pg_temp.begin_vm(3)$$,'P0001','REQUEST_IN_PROGRESS','Cleanup before prepare fences late dispatch');
select * from finish();
rollback;
