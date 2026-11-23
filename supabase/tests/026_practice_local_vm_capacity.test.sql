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

-- Capacity is operational evidence, never an extra execution-context field.
create function pg_temp.cid(n integer) returns uuid language sql immutable as $$ select ('99400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.ctx(gen integer default 801,host integer default 800) returns jsonb language sql immutable as $$
 select jsonb_build_object('provider','local-vm','runnerVersion','imp-03-quickjs.13','image','sha256:'||repeat('a',64),
 'hostId',pg_temp.cid(host),'kitManifestSha256',repeat('b',64),'brokerVersion','local-vm-broker-v1','guestSha256',repeat('c',64),'brokerGeneration',pg_temp.cid(gen))
$$;
create function pg_temp.admit(n integer,purpose text default 'RUN',capacity text default 'READY',ctx jsonb default pg_temp.ctx(),operation_key text default null,payload_digest text default repeat('a',64),available boolean default true) returns jsonb language plpgsql as $$ begin
 if purpose='RUN' then return app_private.admit_practice_run(pg_temp.cid(n),'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',
 '96100000-0000-4000-8000-000000000001',coalesce(operation_key,'vm-cap-key-'||n),payload_digest,repeat('b',64),repeat('c',64),1,'imp-03-quickjs.13',pg_temp.cid(900),available,10,32,120,ctx,capacity); end if;
 return app_private.admit_practice_submit(pg_temp.cid(n),'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',
 '96100000-0000-4000-8000-000000000001',coalesce(operation_key,'vm-cap-key-'||n),payload_digest,'module.exports.solve=(a,b)=>a+b;',null,'imp-03-quickjs.13',pg_temp.cid(900),available,10,32,120,ctx,capacity);
end $$;
create function pg_temp.token(n integer) returns uuid language sql security definer as $$
 select lease_token from app.executions where id=pg_temp.cid(n) union all select lease_token from app_private.submission_reservations where id=pg_temp.cid(n)
$$;
create function pg_temp.retire(n integer) returns void language plpgsql as $$
 declare r jsonb:=app_private.load_local_vm_resource(pg_temp.cid(n)); begin
 perform app_private.verify_local_vm_cleanup(pg_temp.cid(n),jsonb_build_object('kind','NOT_STARTED','executionId',pg_temp.cid(n),'creationId',r->'creationId','resourceId',null,
 'hostId',r->'context'->'hostId','brokerGeneration',r->'context'->'brokerGeneration','qemuAbsent',true,'overlaysAbsent',true,'observedAt',clock_timestamp()));
end $$;
create function pg_temp.result(submit boolean default false) returns jsonb language sql immutable as $$
 select '{"runnerVersion":"imp-03-quickjs.13","diagnosisCode":"UNKNOWN","terminationReason":"RUNNER_FAILURE","infrastructureStatus":"FAILED","visibleTestResults":[],"visiblePassed":0,"visibleTotal":1,"outputTruncated":false,"outputBytes":0,"runtimeMs":0,"lifecycleMs":0}'::jsonb
 ||case when submit then '{"hiddenChecksPassed":null,"allRequiredPassed":false}'::jsonb else '{}'::jsonb end
$$;
select ok(exists(select 1 from pg_indexes where schemaname='app_private' and indexname='local_vm_one_pending_host' and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%PENDING%'),'Unique pending-host fence exists');
select ok(not has_function_privilege('alunza_app','app_private.local_vm_admission_preflight(uuid,uuid,uuid,text,text,jsonb,text)','EXECUTE'),'API cannot call private preflight independently');
select ok(not has_function_privilege('authenticated','app_private.guard_local_vm_capacity()','EXECUTE'),'Browser cannot acquire capacity');
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
-- Scope derives from the canonical organization, never the capacity host.
set local app.organization_id='92000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.admit(90,'RUN','BUSY')$$,'P0001','RUNNER_BUSY','Busy physical snapshot rejects RUN before reservation');
select throws_ok($$select pg_temp.admit(91,'SUBMIT','BUSY')$$,'P0001','RUNNER_BUSY','Busy snapshot rejects SUBMIT');
select throws_ok($$select pg_temp.admit(92,'RUN','UNCERTAIN')$$,'P0001','DEPENDENCY_UNAVAILABLE','Uncertain retirement is unavailable, not ordinary busy');
select throws_ok($$select pg_temp.admit(93,'SUBMIT',null)$$,'P0001','DEPENDENCY_UNAVAILABLE','Missing capacity fails closed');
select is(pg_temp.admit(1)->>'kind','reserved','Ready host accepts first RUN');
select throws_ok($$select pg_temp.admit(2,'RUN')$$,'P0001','RUNNER_BUSY','SQL rejects stale READY snapshot for second RUN');
select throws_ok($$select pg_temp.admit(3,'SUBMIT')$$,'P0001','RUNNER_BUSY','RUN and SUBMIT share capacity');
select throws_ok($$select pg_temp.admit(4,'RUN','READY',pg_temp.ctx(802))$$,'P0001','RUNNER_BUSY','Changing broker generation cannot free capacity');
select throws_ok($$select pg_temp.admit(99,'RUN','BUSY',pg_temp.ctx(),'vm-cap-key-1')$$,'P0001','REQUEST_IN_PROGRESS','Existing pending key precedes occupied snapshot');
select throws_ok($$select pg_temp.admit(99,'RUN','BUSY',pg_temp.ctx(),'vm-cap-key-1',repeat('f',64))$$,'P0001','IDEMPOTENCY_CONFLICT','Payload conflict precedes capacity');
reset role;
select is((select count(*) from app.operation_keys where key like 'vm-cap-key-%'),1::bigint,'Rejected requests leave no operation keys or frequency use');
select is((select count(*) from app.executions where id::text like '99400000-%'),1::bigint,'Rejected RUN leaves no execution');
select is((select count(*) from app_private.submission_reservations where id::text like '99400000-%'),0::bigint,'Rejected SUBMIT leaves no reservation or attempt number');
select is((select count(*) from app_private.local_vm_resources where execution_id::text like '99400000-%'),1::bigint,'No rejected ledger resources survive');
select is((select count(*) from app.attempts where organization_id='92000000-0000-4000-8000-000000000001'),0::bigint,'Capacity rejection never creates an UNKNOWN attempt');
update app.executions set lease_until=clock_timestamp()-interval '1 second' where id=pg_temp.cid(1);
set local role alunza_app;
select throws_ok($$select pg_temp.admit(4,'RUN','READY',pg_temp.ctx(802))$$,'P0001','RUNNER_BUSY','Expired lease alone never frees capacity');
set local app.actor_id=''; set local app.session_id='';
select is(app_private.claim_expired_practice_run()->>'executionId',pg_temp.cid(1)::text,'Recovery claims expired reservation');
select lives_ok($$select pg_temp.retire(1)$$,'Only correlated tombstone frees a never-started slot');
select lives_ok($$select app_private.finish_practice_run(pg_temp.cid(1),pg_temp.token(1),pg_temp.result(),true)$$,'Recovery completes the original reservation');
set local app.actor_id='91000000-0000-4000-8000-000000000003'; set local app.session_id='91100000-0000-4000-8000-000000000003';
select is(pg_temp.admit(3,'SUBMIT')->>'kind','reserved','Previously busy key is usable after verified retirement');
select is(pg_temp.admit(99,'RUN','BUSY',pg_temp.ctx(),'vm-cap-key-1')->>'kind','replay','Completed replay succeeds while another execution occupies host');
select is(pg_temp.admit(99,'RUN','UNCERTAIN',pg_temp.ctx(),'vm-cap-key-1')->>'kind','replay','Replay precedes uncertain physical snapshot');
select is(pg_temp.admit(99,'RUN',null,null,'vm-cap-key-1',repeat('a',64),false)->>'kind','replay','Replay works with unavailable broker and no current context');
select throws_ok($$select pg_temp.admit(5,'SUBMIT')$$,'P0001','RUNNER_BUSY','Pending SUBMIT blocks another SUBMIT');
select throws_ok($$select pg_temp.admit(5,'RUN')$$,'P0001','RUNNER_BUSY','Pending SUBMIT blocks RUN');
set local app.actor_id=''; set local app.session_id='';
select lives_ok($$select pg_temp.retire(3)$$,'SUBMIT retirement releases the shared slot');
select ok(app_private.stage_practice_submit_result(pg_temp.cid(3),pg_temp.token(3),pg_temp.result(true),'[]'::jsonb),'Existing staged-result contract remains unchanged');
select lives_ok($$select app_private.finish_practice_submit(pg_temp.cid(3),pg_temp.token(3),true)$$,'Confirmed cleanup permits SUBMIT completion');
set local app.actor_id='91000000-0000-4000-8000-000000000003'; set local app.session_id='91100000-0000-4000-8000-000000000003';
select is(pg_temp.admit(5,'RUN','READY',pg_temp.ctx(802))->>'kind','reserved','New generation can admit after retirement proof');
select is(pg_temp.admit(99,'SUBMIT','BUSY',pg_temp.ctx(),'vm-cap-key-3')->>'kind','replay','SUBMIT replay also bypasses capacity safely');
set local app.actor_id=''; set local app.session_id='';
select lives_ok($$select pg_temp.retire(5)$$,'Final test resource retired without VM');
select * from finish();
rollback;

