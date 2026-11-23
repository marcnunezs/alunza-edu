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

-- DOCKER FIXTURE READY
create function pg_temp.sid(n integer) returns uuid language sql immutable as $$
 select ('99200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.context(engine text default 'engine-test') returns jsonb language sql immutable as $$
 select jsonb_build_object('provider','docker','runnerVersion','sql-test','image','sha256:'||repeat('a',64),
  'engineId',engine,'runtimeName','alunza-crun','runtimeVersion','1.31','runtimeSha256',repeat('b',64),'strategy','prepared-pair-v1')
$$;
create function pg_temp.admit(n integer,purpose text default 'SUBMIT',ctx jsonb default pg_temp.context()) returns jsonb language plpgsql as $$
begin
 if purpose='RUN' then return app_private.admit_practice_run(pg_temp.sid(n),'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',
 '96100000-0000-4000-8000-000000000001','docker-key-'||n,repeat('a',64),repeat('b',64),repeat('c',64),1,'sql-test','99000000-0000-4000-8000-000000000001',true,10,32,120,ctx); end if;
 return app_private.admit_practice_submit(pg_temp.sid(n),'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',
 '96100000-0000-4000-8000-000000000001','docker-key-'||n,repeat('a',64),'module.exports.solve=(a,b)=>a+b;',null,'sql-test','99000000-0000-4000-8000-000000000001',true,10,32,120,ctx);
end $$;
create function pg_temp.token(n integer) returns uuid language sql security definer as $$
 select lease_token from app.executions where id=pg_temp.sid(n) union all select lease_token from app_private.submission_reservations where id=pg_temp.sid(n)
$$;
create function pg_temp.result(submit boolean default true) returns jsonb language sql immutable as $$
 select '{"runnerVersion":"sql-test","diagnosisCode":"UNKNOWN","terminationReason":"RUNNER_FAILURE","infrastructureStatus":"FAILED","visibleTestResults":[],"visiblePassed":0,"visibleTotal":1,"outputTruncated":false,"outputBytes":0,"runtimeMs":0,"lifecycleMs":0}'::jsonb
  ||case when submit then '{"hiddenChecksPassed":null,"allRequiredPassed":false}'::jsonb else '{}'::jsonb end
$$;

create function pg_temp.pair(n integer) returns uuid language sql as $$
 select current_setting('test.pair_'||n)::uuid
$$;
create function pg_temp.reserve(n integer,ctx jsonb default pg_temp.context()) returns jsonb language plpgsql as $$
declare p jsonb; begin
 p:=app_private.docker_reserve_pair(ctx,pg_temp.sid(900));
 perform set_config('test.pair_'||n,p->>'pairId',true); return p;
end $$;
create function pg_temp.slot(n integer,pos integer) returns uuid language sql security definer as $$
 select id from app_private.docker_prepared_resources where pair_id=pg_temp.pair(n) and ordinal=pos
$$;
create function pg_temp.payload(n integer) returns jsonb language sql security definer as $$
 select app_private.docker_pair_payload(p) from app_private.docker_prepared_pairs p where id=pg_temp.pair(n)
$$;
create function pg_temp.confirm_pair(n integer) returns void language plpgsql as $$ begin
 perform app_private.docker_authorize_create(pg_temp.pair(n),pg_temp.slot(n,0),pg_temp.sid(900));
 perform app_private.docker_authorize_create(pg_temp.pair(n),pg_temp.slot(n,1),pg_temp.sid(900));
 perform app_private.docker_confirm_created(pg_temp.pair(n),pg_temp.slot(n,0),repeat('a',60)||lpad((n*2)::text,4,'0'));
 perform app_private.docker_confirm_created(pg_temp.pair(n),pg_temp.slot(n,1),repeat('a',60)||lpad((n*2+1)::text,4,'0'));
 perform app_private.docker_mark_pair_ready(pg_temp.pair(n),pg_temp.sid(900));
end $$;
create function pg_temp.clean(n integer,pos integer) returns void language sql as $$
 select app_private.docker_mark_clean(pg_temp.pair(n),pg_temp.slot(n,pos),
  jsonb_build_object('kind','ABSENT','containerId',pg_temp.payload(n)->'slots'->pos->>'containerId'))
$$;

select ok(app_private.valid_docker_execution_context(pg_temp.context()),'Extended Docker context is valid');
select ok(app_private.valid_docker_execution_context(pg_temp.context()-array['engineId','runtimeName','runtimeVersion','runtimeSha256','strategy']),'Legacy context remains valid');
select ok(not app_private.valid_docker_execution_context(pg_temp.context()-'runtimeSha256'),'Partial runtime identity is invalid');
select ok(not app_private.valid_docker_execution_context(pg_temp.context()||'{"runtimeSha256":null}'),'Null identity is invalid');
select ok(not has_table_privilege('alunza_app','app_private.docker_prepared_pairs','SELECT'),'Application cannot read ledger directly');
select ok(not has_table_privilege('authenticated','app_private.docker_prepared_resources','SELECT'),'Browser cannot observe resources');
select ok(not has_function_privilege('anon','app_private.docker_reserve_pair(jsonb,uuid)','EXECUTE'),'Anonymous callers cannot reserve');
select ok(not has_function_privilege('alunza_app','app_private.docker_pair_payload(app_private.docker_prepared_pairs)','EXECUTE'),'Internal payload helper is private');
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
set local app.organization_id='92000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.admit(90,'RUN',pg_temp.context()-'runtimeSha256')$$,'23514','INVALID_EXECUTION_CONTEXT','Partial identity rolls admission back');
select is(pg_temp.admit(1,'RUN')->'executionContext',pg_temp.context(),'RUN stores runtime identity atomically');
select is(pg_temp.admit(2)->'executionContext',pg_temp.context(),'SUBMIT stores the same immutable identity');
select throws_ok($$select pg_temp.reserve(100)$$,'42501','FORBIDDEN','Actor context cannot reserve resources');
set local app.actor_id='91000000-0000-4000-8000-000000000004';
set local app.session_id='91100000-0000-4000-8000-000000000004';
select throws_ok($$select pg_temp.admit(91,'RUN')$$,'42501','FORBIDDEN','Foreign teacher cannot admit RUN');
set local app.actor_id='91000000-0000-4000-8000-000000000005';
set local app.session_id='91100000-0000-4000-8000-000000000005';
select throws_ok($$select pg_temp.admit(92)$$,'42501','FORBIDDEN','Teacher of another class cannot admit SUBMIT');
set local app.actor_id=''; set local app.session_id='';
select is(pg_temp.reserve(100)->>'state','PREPARING','Durable pair exists before dispatch');
select is(jsonb_array_length(pg_temp.payload(100)->'slots'),2,'Exactly two single-use resources are reserved');
select is(app_private.docker_reserve_pair(pg_temp.context(),pg_temp.sid(901)),null::jsonb,'Second replica cannot reserve a second pair');
select throws_ok($$select app_private.docker_authorize_create(pg_temp.pair(100),pg_temp.slot(100,0),pg_temp.sid(901))$$,'P0001','REQUEST_IN_PROGRESS','Wrong owner cannot authorize creation');
select lives_ok($$select app_private.docker_authorize_create(pg_temp.pair(100),pg_temp.slot(100,0),pg_temp.sid(900))$$,'Creation authorization commits UNKNOWN');
select is(pg_temp.payload(100)->'slots'->0->>'creationState','UNKNOWN','Unknown dispatch is durable');
select throws_ok($$select app_private.docker_authorize_create(pg_temp.pair(100),pg_temp.slot(100,0),pg_temp.sid(900))$$,'P0001','REQUEST_IN_PROGRESS','Create authorization cannot be repeated');
select throws_ok($$select app_private.docker_mark_clean(pg_temp.pair(100),pg_temp.slot(100,0),'{"kind":"NOT_DISPATCHED"}')$$,'23514','INVALID_DOCKER_CLEANUP','Dispatched creation cannot claim absence of dispatch');
select throws_ok($$select app_private.docker_mark_clean(pg_temp.pair(100),pg_temp.slot(100,0),jsonb_build_object('kind','ABSENT','containerId',repeat('a',64)))$$,'23514','INVALID_DOCKER_CLEANUP','404 does not prove cleanup while identity is unknown');
select lives_ok($$select app_private.docker_confirm_created(pg_temp.pair(100),pg_temp.slot(100,0),repeat('a',64))$$,'Provider receipt records identity');
select lives_ok($$select app_private.docker_confirm_created(pg_temp.pair(100),pg_temp.slot(100,0),repeat('a',64))$$,'Repeated identical receipt is idempotent');
select throws_ok($$select app_private.docker_confirm_created(pg_temp.pair(100),pg_temp.slot(100,0),repeat('b',64))$$,'23514','IMMUTABLE_DOCKER_RESOURCE','Identity cannot be replaced');
select throws_ok($$select app_private.docker_mark_pair_ready(pg_temp.pair(100),pg_temp.sid(900))$$,'P0001','REQUEST_IN_PROGRESS','Both capsules must have confirmed identities');
select lives_ok($$select app_private.docker_authorize_create(pg_temp.pair(100),pg_temp.slot(100,1),pg_temp.sid(900)); select app_private.docker_confirm_created(pg_temp.pair(100),pg_temp.slot(100,1),repeat('b',64)); select app_private.docker_mark_pair_ready(pg_temp.pair(100),pg_temp.sid(900))$$,'Two confirmed resources can become ready');
select throws_ok($$select app_private.docker_assign_pair(pg_temp.pair(100),pg_temp.sid(900),pg_temp.sid(1),pg_temp.sid(901))$$,'P0001','REQUEST_IN_PROGRESS','Invalid execution lease cannot acquire capsules');
select is(app_private.docker_assign_pair(pg_temp.pair(100),pg_temp.sid(900),pg_temp.sid(1),pg_temp.token(1))->>'executionId',pg_temp.sid(1)::text,'Pair binds to one admitted RUN');
select lives_ok($$select app_private.docker_assert_assignment(pg_temp.pair(100),pg_temp.slot(100,0),pg_temp.sid(900),pg_temp.sid(1),pg_temp.token(1))$$,'Live admitted lease authorizes input delivery');
select throws_ok($$select app_private.docker_assign_pair(pg_temp.pair(100),pg_temp.sid(900),pg_temp.sid(2),pg_temp.token(2))$$,'P0001','REQUEST_IN_PROGRESS','Pair cannot be shared by another execution');
select throws_ok($$select app_private.finish_practice_run(pg_temp.sid(1),pg_temp.token(1),pg_temp.result(false),true)$$,'P0001','REQUEST_IN_PROGRESS','In-memory cleanup boolean cannot complete RUN');
select lives_ok($$select pg_temp.clean(100,0); select pg_temp.clean(100,1)$$,'Both resource absences are recorded');
select is(pg_temp.payload(100)->>'state','ASSIGNED','Cleanup alone does not replenish before HTTP close');
select throws_ok($$select app_private.docker_release_pair(pg_temp.pair(100),pg_temp.sid(900))$$,'P0001','REQUEST_IN_PROGRESS','Release requires committed result or fenced recovery');
select is(app_private.finish_practice_run(pg_temp.sid(1),pg_temp.token(1),pg_temp.result(false),true)->'technicalResult'->>'diagnosisCode','UNKNOWN','Durable absence permits RUN commit');
select is(app_private.docker_reserve_pair(pg_temp.context(),pg_temp.sid(901)),null::jsonb,'Commit alone still holds reserve until HTTP-close notification');
select lives_ok($$select app_private.docker_release_pair(pg_temp.pair(100),pg_temp.sid(900))$$,'Post-response release retires pair');
select is(pg_temp.payload(100)->>'state','RETIRED','Pair has terminal durable state');
select is(pg_temp.reserve(101)->>'state','PREPARING','Next pair may be created after release');
select lives_ok($$select pg_temp.confirm_pair(101)$$,'Next pair confirms independent identities');
select is(app_private.docker_assign_pair(pg_temp.pair(101),pg_temp.sid(900),pg_temp.sid(2),pg_temp.token(2))->>'executionId',pg_temp.sid(2)::text,'SUBMIT has distinct assigned pair');
select ok(app_private.stage_practice_submit_result(pg_temp.sid(2),pg_temp.token(2),pg_temp.result(),'[]'),'Canonical SUBMIT result is staged before final commit');
select throws_ok($$select app_private.finish_practice_submit(pg_temp.sid(2),pg_temp.token(2),true)$$,'P0001','REQUEST_IN_PROGRESS','Staged result does not bypass cleanup');
select set_config('test.old_execution_token',pg_temp.token(2)::text,true);
reset role;
select is((select class_id::text from app_private.docker_prepared_pairs where id=pg_temp.pair(101)),'94000000-0000-4000-8000-000000000001','Class binding is derived from authorized reservation');
update app_private.submission_reservations set lease_until=clock_timestamp()-interval '1 second' where id=pg_temp.sid(2);
update app_private.docker_prepared_pairs set lease_until=clock_timestamp()-interval '1 second' where id=pg_temp.pair(101);
set local role alunza_app;
select is(app_private.claim_expired_practice_submit()->>'executionId',pg_temp.sid(2)::text,'Other replica reclaims expired submission');
select is(app_private.docker_claim_recovery(pg_temp.context()||'{"runtimeVersion":"1.32"}',pg_temp.sid(901))->0->'context',pg_temp.context(),'Recovery uses persisted context despite new runtime configuration');
select is(pg_temp.payload(101)->>'ownerToken',pg_temp.sid(901)::text,'Recovery rotates pair ownership');
select is(pg_temp.payload(101)->>'creatorToken',pg_temp.sid(900)::text,'Resource label identity remains unchanged');
select is(pg_temp.payload(101)->>'recoveryOnly','true','Recovered pair is permanently observation-only');
select throws_ok($$select app_private.docker_assert_execution(pg_temp.sid(2),pg_temp.token(2),pg_temp.context())$$,'P0001','REQUEST_IN_PROGRESS','Recovery execution token cannot run code');
select throws_ok($$select app_private.docker_assert_assignment(pg_temp.pair(101),pg_temp.slot(101,0),pg_temp.sid(901),pg_temp.sid(2),pg_temp.token(2))$$,'P0001','REQUEST_IN_PROGRESS','Recovery owner cannot deliver input');
select lives_ok($$select pg_temp.clean(101,0); select pg_temp.clean(101,1)$$,'Recovery records cleanup without rerunning');
select is(app_private.finish_practice_submit(pg_temp.sid(2),pg_temp.token(2),true)->'technicalResult'->>'diagnosisCode','UNKNOWN','Recovery commits staged evidence once');
select lives_ok($$select app_private.docker_release_pair(pg_temp.pair(101),pg_temp.sid(901))$$,'Recovery releases only its cleaned resources');

select is(pg_temp.reserve(102)->>'state','PREPARING','Unassigned reserve is also durable');
select lives_ok($$select app_private.docker_authorize_create(pg_temp.pair(102),pg_temp.slot(102,0),pg_temp.sid(900))$$,'Lost create response leaves UNKNOWN');
reset role;
update app_private.docker_prepared_pairs set lease_until=clock_timestamp()-interval '1 second' where id=pg_temp.pair(102);
set local role alunza_app;
select is(jsonb_array_length(app_private.docker_claim_recovery(pg_temp.context(),pg_temp.sid(901))),1,'Unassigned orphan can be reclaimed');
select is(jsonb_array_length(app_private.docker_claim_recovery(pg_temp.context(),pg_temp.sid(902))),0,'Concurrent recovery lease fences later claimant');
select throws_ok($$select app_private.docker_authorize_create(pg_temp.pair(102),pg_temp.slot(102,1),pg_temp.sid(901))$$,'P0001','REQUEST_IN_PROGRESS','Recovery may not dispatch the other prepared capsule');
select lives_ok($$select app_private.docker_confirm_created(pg_temp.pair(102),pg_temp.slot(102,0),repeat('c',64))$$,'Late worker identity is accepted only for cleanup');
select lives_ok($$select pg_temp.clean(102,0); select app_private.docker_mark_clean(pg_temp.pair(102),pg_temp.slot(102,1),'{"kind":"NOT_DISPATCHED"}')$$,'Late receipt and undispatched sibling can be cleaned');
select is(pg_temp.payload(102)->>'state','RETIRED','Unassigned clean orphan releases capacity');
select is(pg_temp.reserve(103)->>'state','PREPARING','Prepared-only crash can be recovered without creating');
select lives_ok($$select app_private.docker_mark_clean(pg_temp.pair(103),pg_temp.slot(103,0),'{"kind":"NOT_DISPATCHED"}'); select app_private.docker_mark_clean(pg_temp.pair(103),pg_temp.slot(103,1),'{"kind":"NOT_DISPATCHED"}')$$,'Durable pre-dispatch state proves no creation');
select is(pg_temp.payload(103)->>'state','RETIRED','Prepared-only pair is terminal');
select throws_ok($$select app_private.docker_authorize_create(pg_temp.pair(103),pg_temp.slot(103,0),pg_temp.sid(900))$$,'P0001','REQUEST_IN_PROGRESS','Cleaned pre-dispatch resource cannot be resurrected');
select is(pg_temp.reserve(104)->>'state','PREPARING','Pending reserve exists before response purge');
select lives_ok($$select app_private.purge_practice_responses(); select app_private.purge_submit_responses()$$,'Response purge remains compatible');
select is(pg_temp.payload(104)->>'state','PREPARING','Pending resources survive response purge');
select is(app_private.docker_recovery_contexts('engine-test'),jsonb_build_array(pg_temp.context()),'Pending context can be discovered after removing runtime configuration');
select is(app_private.docker_recovery_contexts('another-engine'),'[]'::jsonb,'Recovery context discovery is scoped to the inspected engine');

set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
select is(pg_temp.admit(1,'RUN')->>'kind','replay','RUN replay returns committed result without acquisition');
select is(pg_temp.admit(2)->>'kind','replay','SUBMIT replay returns the original attempt');
select is(pg_temp.admit(3,'RUN',pg_temp.context()-array['engineId','runtimeName','runtimeVersion','runtimeSha256','strategy'])->>'kind','reserved','Legacy Docker admission remains compatible');
select throws_ok($$select app_private.docker_list_execution_pairs(pg_temp.sid(2),pg_temp.context())$$,'42501','FORBIDDEN','Actor cannot read provider identities');
select throws_ok($$select app_private.docker_recovery_contexts('engine-test')$$,'42501','FORBIDDEN','Actor cannot discover operational contexts');
reset role;
select is((select count(*)::integer from app.attempts where execution_id=pg_temp.sid(2)),1,'Recovery and replay create one intended attempt');
select is((select count(*)::integer from app.executions where id=pg_temp.sid(90)),0,'Rejected configuration leaves no reservation');
select throws_ok($$update app_private.docker_prepared_pairs set context=context||'{"runtimeVersion":"1.32"}' where id=pg_temp.pair(104)$$,'23514','IMMUTABLE_DOCKER_PAIR','Runtime identity cannot change after reserve');
select throws_ok($$update app_private.docker_prepared_resources set container_id=repeat('d',64) where id=pg_temp.slot(100,0)$$,'23514','IMMUTABLE_DOCKER_RESOURCE','Cleanup evidence is immutable');
select * from finish();
rollback;
