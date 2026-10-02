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
-- Isolate this rolled-back fixture from the HTTP integration corpus and jobs.
delete from app_private.material_embedding_profile;
update app.material_jobs set lifecycle_status='FAILED',lease_until=null where lifecycle_status in ('UPLOADING','QUEUED','RUNNING');
insert into auth.users(id,email,email_confirmed_at)
select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'evaluation-'||n||'@alunza.test',now() from generate_series(1,5) n;
insert into auth.sessions(id,user_id)
select ('91100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,5) n;
insert into app.profiles(id,display_name,email_normalized,account_state)
select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Material '||n,'evaluation-'||n||'@alunza.test','ACTIVE' from generate_series(1,5) n;
insert into app.organizations(id,code,name) values ('92000000-0000-4000-8000-000000000001','EVAL-A','Materials A'),('92000000-0000-4000-8000-000000000002','EVAL-B','Materials B');
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at) values
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','ADMIN','ACTIVE',now()),
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','TEACHER','ACTIVE',now()),
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003','STUDENT','ACTIVE',now()),
('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000004','TEACHER','ACTIVE',now()),
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000005','TEACHER','ACTIVE',now());
insert into app.courses(id,organization_id,code,name,academic_period) values
('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','P1','Programming','2026-2');
insert into app.classes(id,organization_id,course_id,teacher_id,code,name) values
('94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','A1','Own class'),
('94000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000005','A2','Other class');
insert into app.class_memberships(organization_id,class_id,user_id) values('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003');
insert into app.activities(id,organization_id,class_id,created_by,title,type) values
('97000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','Draft','FORMATIVE');
create temporary table material_test_state(kind text primary key,value jsonb);
grant all on material_test_state to alunza_app;
create function pg_temp.as_material_user(n integer) returns void language plpgsql as $$
begin
 perform set_config('app.actor_id',case when n=0 then '' else '91000000-0000-4000-8000-'||lpad(n::text,12,'0') end,true),
 set_config('app.session_id',case when n=0 then '' else '91100000-0000-4000-8000-'||lpad(n::text,12,'0') end,true),set_config('app.organization_id','',true);
end $$;
create function pg_temp.mid(field text) returns uuid language sql as $$ select (value->>field)::uuid from material_test_state where kind='reserve' $$;
create function pg_temp.mjob(field text) returns uuid language sql as $$ select (value->>field)::uuid from material_test_state where kind='job' $$;
create function pg_temp.mchunk(idx integer) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('index',idx,'text','material '||idx,'tokenCount',3,'locator','Línea '||idx,'contentHash',encode(sha256(convert_to('material '||idx,'UTF8')),'hex'),'embedding','[0.8,0.6,0]'::jsonb))
$$;
set local role alunza_app;
select pg_temp.as_material_user(2);
insert into material_test_state values('reserve',app_private.material_reserve_upload('94000000-0000-4000-8000-000000000001',null,null,null,'Evaluation','fixture.txt','TXT','text/plain',12,repeat('a',64),'evaluation-upload-1','99000000-0000-4000-8000-000000000001'));
select pg_temp.as_material_user(0);
select ok(app_private.material_confirm_upload(pg_temp.mid('jobId'),pg_temp.mid('uploadToken')),'EVAL-01 material fixture has confirmed private Storage');
insert into material_test_state values('job',app_private.material_claim_job());
reset role;
update app_private.evaluation_runs set state='STOPPED',stopped_at=clock_timestamp() where state in('AUTHORIZED','RUNNING');
create function pg_temp.ebudget(cost_value text default '3') returns jsonb language sql as $$ select jsonb_build_object('maxCalls',3,'maxInputTokens',100,'maxOutputTokens',100,'maxCostMicroUsd',cost_value) $$;
create function pg_temp.eprofile() returns jsonb language sql as $$ select jsonb_build_object('id','evaluation-synthetic','model','synthetic','fingerprint',repeat('f',64),'dimensions',3,'inputMicroUsdPerMillion','500001','outputMicroUsdPerMillion','0') $$;
insert into material_test_state values('manifest',jsonb_build_object('version',1,'runId','99000000-0000-4000-8000-000000000010','environment','TEST','provider','TEST',
 'releaseSha',repeat('c',40),'environmentHash',repeat('d',64),'corpusHash',repeat('e',64),'priceVersion','fixture-price-1','approvedBy','fixture','approvalReference','TEST-only',
 'expiresAt',clock_timestamp()+interval '1 hour','globalBudget',pg_temp.ebudget('4'),
 'stages',jsonb_build_object('INGESTION',pg_temp.ebudget(),'CALIBRATION',pg_temp.ebudget(),'FUNCTIONAL',pg_temp.ebudget(),'EVALUATION',pg_temp.ebudget()),
 'profiles',jsonb_build_object('EMBEDDING',pg_temp.eprofile(),'GENERATION',pg_temp.eprofile()-'dimensions','REVIEW',pg_temp.eprofile()-'dimensions'),
 'materials',jsonb_build_array(jsonb_build_object('id','99000000-0000-4000-8000-000000000011','actorId','91000000-0000-4000-8000-000000000002',
 'organizationId','92000000-0000-4000-8000-000000000001','classId','94000000-0000-4000-8000-000000000001','activityId',null,'sha256',repeat('a',64),'format','TXT','operation','UPLOAD','maxOperations',1)), 'cases','[]'::jsonb));
create function pg_temp.emanifest() returns jsonb language sql as $$ select value from material_test_state where kind='manifest' $$;
create function pg_temp.espec(key_value text default 'batch:0',attempt_value integer default 1) returns jsonb language sql as $$
 select jsonb_build_object('owner',jsonb_build_object('kind','MATERIAL','id',pg_temp.mjob('id'),'token',pg_temp.mjob('token')),
 'phase','EMBEDDING','logicalKey',key_value,'inputHash',repeat('b',64),'configuration',pg_temp.eprofile()-'inputMicroUsdPerMillion'-'outputMicroUsdPerMillion',
 'reservedInputTokens',3,'maxOutputTokens',0,'attempt',attempt_value)
$$;
create function pg_temp.erid() returns uuid language sql as $$ select '99000000-0000-4000-8000-000000000010'::uuid $$;
create function pg_temp.ecall(field text,kind_value text default 'call') returns uuid language sql as $$ select (value->>field)::uuid from material_test_state where kind=kind_value $$;
select is(app_private.evaluation_authorize(pg_temp.emanifest(),repeat('1',64)),pg_temp.erid(),'EVAL-02 maintenance authorizes immutable manifest');
select is(app_private.evaluation_authorize(pg_temp.emanifest(),repeat('1',64)),pg_temp.erid(),'EVAL-03 same authorization replays exactly');
select throws_ok($$select app_private.evaluation_authorize(jsonb_set(pg_temp.emanifest(),'{globalBudget,maxCostMicroUsd}','"5"'),repeat('1',64))$$,'P0001','IDEMPOTENCY_CONFLICT','EVAL-04 same run cannot raise its budget');
select throws_ok($$update app_private.evaluation_runs set manifest=manifest||'{"provider":"AZURE"}' where id=pg_temp.erid()$$,'23514','IMMUTABLE_EVALUATION_GRANT','EVAL-05 manifest cannot be edited after grant');
select throws_ok($$update app_private.evaluation_stages set budget=pg_temp.ebudget('9') where run_id=pg_temp.erid()$$,'23514','IMMUTABLE_EVALUATION_BUDGET','EVAL-06 stage budgets are immutable');
select throws_ok($$update app_private.evaluation_bindings set actor_id='91000000-0000-4000-8000-000000000003' where run_id=pg_temp.erid()$$,'23514','IMMUTABLE_EVALUATION_BINDING','EVAL-07 actor scope cannot be reassigned');
select ok(not (select rolbypassrls or rolsuper from pg_roles where rolname='alunza_identity'),'EVAL-08 function owner cannot bypass RLS');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private' and c.relname in('evaluation_runs','evaluation_stages','evaluation_bindings','evaluation_calibrations','evaluation_owners','ai_call_receipts') and c.relrowsecurity and c.relforcerowsecurity),6,'EVAL-09 every private ledger table forces RLS');
select ok(not has_function_privilege('alunza_app','app_private.evaluation_authorize(jsonb,text)','execute'),'EVAL-10 ordinary API cannot mint a grant');
select ok(has_function_privilege('postgres','app_private.evaluation_authorize(jsonb,text)','execute'),'EVAL-10a maintenance can authorize without assuming a domain role');
select ok(not has_function_privilege('anon','app_private.evaluation_reserve(jsonb,boolean)','execute'),'EVAL-11 anonymous caller has no dispatch helper');
select ok(not has_function_privilege('authenticated','app_private.evaluation_status(uuid,text)','execute'),'EVAL-12 Auth role gains no operational reader');
select is(ceil((3::numeric*500001)/1000000)::text,'2','EVAL-13 price multiplication rounds upward exactly');
select is(ceil((1000000::numeric*9007199254740993)/1000000)::text,'9007199254740993','EVAL-14 accounting retains integers larger than JS safe range');
-- Exercise this private, pure helper as its owner only for this assertion.
-- Runtime privileges remain unchanged; the outer transaction also rolls back
-- every test-only grant.
grant alunza_identity to postgres;
select ok(not app_private.evaluation_fits(pg_temp.ebudget('1'),'{"calls":0,"inputTokens":0,"outputTokens":0,"costMicroUsd":"0"}',3,0,2),'EVAL-15 exact monetary ceiling denies one-microdollar excess');
revoke alunza_identity from postgres;
set local role alunza_app;
select pg_temp.as_material_user(0);
select throws_ok($$select * from app_private.ai_call_receipts$$,'42501',null,'EVAL-16 ordinary runtime has no raw receipt or result read');
select throws_ok($$select app_private.evaluation_status(pg_temp.erid(),repeat('0',64))$$,'42501','FORBIDDEN','EVAL-17 wrong capability cannot enumerate run');
select throws_ok($$select app_private.evaluation_reserve(pg_temp.espec(),true)$$,'42501','FORBIDDEN','EVAL-18 authorization alone does not activate a paid stage');
select is(app_private.evaluation_start_stage(pg_temp.erid(),repeat('1',64),'INGESTION')->>'state','RUNNING','EVAL-19 capability opens ingestion only');
select throws_ok($$select app_private.evaluation_start_stage(pg_temp.erid(),repeat('1',64),'FUNCTIONAL')$$,'P0001','INVALID_TRANSITION','EVAL-20 generation cannot skip measured calibration');
select throws_ok($$select app_private.evaluation_reserve(jsonb_set(pg_temp.espec(),'{configuration,fingerprint}',to_jsonb(repeat('0',64))),true)$$,'23514','INVALID_EVALUATION_PROFILE','EVAL-21 configuration fingerprint prevents a deployment switch');
select throws_ok($$select app_private.evaluation_reserve(jsonb_set(pg_temp.espec(),'{owner,token}','null'),true)$$,'42501','FORBIDDEN','EVAL-22 null lease is never a worker capability');
insert into material_test_state values('call',app_private.evaluation_reserve(pg_temp.espec(),true));
select is((select value->>'state' from material_test_state where kind='call'),'DISPATCH','EVAL-23 first reservation commits dispatch authority');
select ok(app_private.evaluation_can_continue(pg_temp.espec()->'owner'),'EVAL-23a heartbeat reuses the dispatch owner binding');
select ok(app_private.evaluation_can_continue(pg_temp.espec()->'owner'),'EVAL-23b repeated continuation checks do not consume another operation');
select is(app_private.evaluation_reserve(pg_temp.espec(),true)->>'state','STOP','EVAL-24 response-lost dispatch is not sent twice');
select throws_ok($$select app_private.evaluation_reserve(jsonb_set(pg_temp.espec(),'{inputHash}',to_jsonb(repeat('9',64))),true)$$,'P0001','IDEMPOTENCY_CONFLICT','EVAL-25 same logical call rejects a different input');
select ok(not app_private.evaluation_observe(pg_temp.ecall('callId'),null,'{}'),'EVAL-26 missing dispatch token cannot attach billing');
select ok(app_private.evaluation_observe(pg_temp.ecall('callId'),pg_temp.ecall('dispatchToken'),jsonb_build_object('phase','EMBEDDING','outcome','RESPONSE','settledAt',clock_timestamp(),'aborted',false,'model','synthetic','requestId','fixture-one','usage',jsonb_build_object('inputTokens',1))),'EVAL-27 observed tokens are durable');
select ok(app_private.evaluation_complete(pg_temp.ecall('callId'),pg_temp.ecall('dispatchToken'),'[[1,0,0]]'),'EVAL-28 valid response checkpoint persists separately from product');
select is(app_private.evaluation_reserve(pg_temp.espec('batch:0',2),true)->>'state','COMPLETED','EVAL-29 a later job attempt reuses the completed batch');
select is(app_private.evaluation_status(pg_temp.erid(),repeat('1',64))->'totals'->>'costMicroUsd','1','EVAL-30 known consumption replaces conservative exposure');
insert into material_test_state values('unknown',app_private.evaluation_reserve(pg_temp.espec('batch:1'),true));
select ok(app_private.evaluation_complete(pg_temp.ecall('callId','unknown'),pg_temp.ecall('dispatchToken','unknown'),null),'EVAL-31 transport uncertainty is recorded without fabricated zero usage');
select is(app_private.evaluation_status(pg_temp.erid(),repeat('1',64))->'totals'->>'costMicroUsd','3','EVAL-32 unknown dispatch keeps its entire conservative reserve');
select throws_ok($$select app_private.evaluation_reserve(pg_temp.espec('batch:2'),true)$$,'P0001','RATE_LIMITED','EVAL-33 stage budget rejects another paid call');
select is(app_private.evaluation_reserve(pg_temp.espec('batch:1',2),true)->>'state','STOP','EVAL-34 unknown response forbids an automatic retry even with a higher attempt');
select throws_ok($$select app_private.evaluation_start_stage(pg_temp.erid(),repeat('1',64),'CALIBRATION')$$,'P0001','INVALID_TRANSITION','EVAL-35 unknown consumption blocks stage promotion');
select is(app_private.material_prepare_generation(pg_temp.mjob('id'),pg_temp.mjob('token'),'evaluation-synthetic','synthetic',3,'extract-test','token-test',1,repeat('c',64)),0,'EVAL-35a material generation retains its ordinary checkpoint');
select ok(app_private.material_stage_chunks(pg_temp.mjob('id'),pg_temp.mjob('token'),pg_temp.mchunk(0)),'EVAL-35b complete fixture is ready before stop');
select is(app_private.evaluation_stop(pg_temp.erid(),repeat('1',64))->>'state','STOPPED','EVAL-36 stop is durable');
select throws_ok($$select app_private.material_publish_job(pg_temp.mjob('id'),pg_temp.mjob('token'))$$,'42501','FORBIDDEN','EVAL-36b stopped run cannot activate a complete generation');
select is(app_private.evaluation_stop(pg_temp.erid(),repeat('1',64))->>'state','STOPPED','EVAL-37 stop replays');
select ok(not app_private.evaluation_can_continue(pg_temp.espec()->'owner'),'EVAL-38 stop fences worker continuation');
select throws_ok($$select app_private.evaluation_reserve(pg_temp.espec('batch:3'),false)$$,'42501','FORBIDDEN','EVAL-39 isolated evaluation database cannot opt out after stop');
select ok(app_private.evaluation_observe(pg_temp.ecall('callId','unknown'),pg_temp.ecall('dispatchToken','unknown'),jsonb_build_object('phase','EMBEDDING','outcome','RESPONSE','settledAt',clock_timestamp(),'aborted',true,'model','synthetic','requestId','late-receipt','usage',jsonb_build_object('inputTokens',1))),'EVAL-40 late usage remains recordable after run stop');
select is(app_private.evaluation_status(pg_temp.erid(),repeat('1',64))->>'state','STOPPED','EVAL-41 late accounting cannot restart a run');
select is(app_private.evaluation_status(pg_temp.erid(),repeat('1',64))->'totals'->>'costMicroUsd','3','EVAL-41b late usage does not release an uncertain reservation');
select is((app_private.evaluation_receipts(pg_temp.erid(),repeat('1',64))->'items'->0 ? 'result'),false,'EVAL-42 operational receipts omit private model content');
select is((app_private.evaluation_receipts(pg_temp.erid(),repeat('1',64))->'items'->0 ? 'dispatchToken'),false,'EVAL-43 receipt projections omit worker tokens');
reset role;
select is((select count(*)::integer from app_private.ai_call_receipts where run_id=pg_temp.erid()),2,'EVAL-44 replays and denied calls do not consume extra call slots');
select is((select count(*)::integer from app_private.evaluation_stages where run_id=pg_temp.erid()),4,'EVAL-45 all four budgets are durable');
select is((select count(*)::integer from app_private.evaluation_owners where run_id=pg_temp.erid()),1,'EVAL-45a dispatch, retries and heartbeat retain exactly one owner binding');
-- Maintenance seeds only the attestation fixture. Application callers still
-- cannot write artifacts; these checks exercise the real promotion gate.
update app_private.evaluation_runs set calibration_artifact='{"version":"help-evidence-2","fixture":"fingerprint-gate"}',calibration_artifact_hash=repeat('8',64) where id=pg_temp.erid();
set local role alunza_app;
select pg_temp.as_material_user(0);
select is(app_private.evaluation_calibration_assert('{"version":"help-evidence-2","fixture":"fingerprint-gate"}',true,null),null::text,'EVAL-46 attestation rejects a missing effective deployment fingerprint');
select is(app_private.evaluation_calibration_assert('{"version":"help-evidence-2","fixture":"fingerprint-gate"}',true,repeat('0',64)),null::text,'EVAL-47 attestation rejects another deployment despite an identical artifact');
select is(app_private.evaluation_calibration_assert('{"version":"help-evidence-2","fixture":"fingerprint-gate"}',false,repeat('f',64)),null::text,'EVAL-48 TEST evidence cannot pass the ordinary Azure promotion gate');
select is(app_private.evaluation_calibration_assert('{"version":"help-evidence-2","fixture":"fingerprint-gate"}',true,repeat('f',64)),repeat('8',64),'EVAL-49 explicitly enabled TEST attestation requires the current matching fingerprint');
select is(app_private.evaluation_status(pg_temp.erid(),repeat('1',64))->>'state','STOPPED','EVAL-50 attestation and status preserve a previously stopped run');
reset role;
-- An already expired maintenance fixture avoids sleeps while exercising the
-- same limited-role capability gate used by every operational route.
insert into app_private.evaluation_runs(id,manifest,manifest_hash,capability_hash,environment,provider,state,expires_at)
select '99000000-0000-4000-8000-000000000020',
 jsonb_set(jsonb_set(manifest,'{runId}','"99000000-0000-4000-8000-000000000020"'),'{expiresAt}',to_jsonb(clock_timestamp()-interval '1 second')),
 repeat('9',64),capability_hash,environment,provider,'STOPPED',clock_timestamp()-interval '1 second'
from app_private.evaluation_runs where id=pg_temp.erid();
set local role alunza_app;
select throws_ok($$select app_private.evaluation_status('99000000-0000-4000-8000-000000000020',repeat('1',64))$$,'42501','FORBIDDEN','EVAL-51 expired capability cannot read run metadata');
select throws_ok($$select app_private.evaluation_receipts('99000000-0000-4000-8000-000000000020',repeat('1',64))$$,'42501','FORBIDDEN','EVAL-52 expired capability cannot enumerate receipts');
select throws_ok($$select app_private.evaluation_stop('99000000-0000-4000-8000-000000000020',repeat('1',64))$$,'42501','FORBIDDEN','EVAL-53 expired capability cannot stop a run');
reset role;
-- Persist a real attempt through submission helpers, then retrieve against a
-- completed embedding receipt. This exercises the production function with its
-- own pg_catalog-only search_path, including vector equality and scoped ranking.
insert into app.concept_tags(id,organization_id,normalized_name) values('95000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','evaluation-vector');
insert into app.concept_versions(id,organization_id,concept_id,version,name,description,created_by) values('95100000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001',1,'Vector fixture','Vector fixture','91000000-0000-4000-8000-000000000001');
update app.concept_tags set current_version_id='95100000-0000-4000-8000-000000000001' where id='95000000-0000-4000-8000-000000000001';
insert into app.exercises(id,organization_id,owner_id) values('96000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002');
insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) values('96100000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001',1,'Vector fixture','Return sum','module.exports.solve=(a,b)=>a+b;','BEGINNER','91000000-0000-4000-8000-000000000002');
insert into app.exercise_version_concepts values('92000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000001','95100000-0000-4000-8000-000000000001');
insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) values('92000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000001','visible',0,'visible','[1,2]','3');
update app.exercises set current_version_id='96100000-0000-4000-8000-000000000001' where id='96000000-0000-4000-8000-000000000001';
insert into app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position) values('98000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000001',0);
update app.activities set state='PUBLISHED' where id='97000000-0000-4000-8000-000000000001';
set constraints all immediate;
set local role alunza_app;
select pg_temp.as_material_user(3);
select set_config('app.organization_id','92000000-0000-4000-8000-000000000001',true);
insert into material_test_state values('submission',app_private.admit_practice_submit('99000000-0000-4000-8000-000000000040','97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000001','evaluation-vector-attempt',repeat('a',64),'module.exports.solve=(a,b)=>a+b;',null,'sql-test','99000000-0000-4000-8000-000000000041',true,2,4,10));
reset role;
insert into material_test_state select 'submit-token',to_jsonb(lease_token) from app_private.submission_reservations where id='99000000-0000-4000-8000-000000000040';
create function pg_temp.evsubmit_token() returns uuid language sql as $$ select (value#>>'{}')::uuid from material_test_state where kind='submit-token' $$;
set local role alunza_app;
select pg_temp.as_material_user(0);
select ok(app_private.stage_practice_submit_result('99000000-0000-4000-8000-000000000040',pg_temp.evsubmit_token(),'{"runnerVersion":"sql-test","diagnosisCode":"UNKNOWN","terminationReason":"RUNNER_FAILURE","infrastructureStatus":"FAILED","visibleTestResults":[],"visiblePassed":0,"visibleTotal":1,"outputTruncated":false,"outputBytes":0,"runtimeMs":0,"lifecycleMs":0,"hiddenChecksPassed":null,"allRequiredPassed":false}','[]'),'EVAL-54 fixture persists deterministic evidence before calibration');
insert into material_test_state values('attempt',app_private.finish_practice_submit('99000000-0000-4000-8000-000000000040',pg_temp.evsubmit_token(),true));
reset role;
insert into material_test_state select 'calibration-manifest',pg_temp.emanifest()||jsonb_build_object('runId','99000000-0000-4000-8000-000000000030','materials','[]'::jsonb,'cases',jsonb_build_array(jsonb_build_object('id','99000000-0000-4000-8000-000000000031','actorId',a.student_id,'organizationId',a.organization_id,'classId',a.class_id,'activityId',a.activity_id,'attemptId',a.id,'codeHash',a.code_hash,'stage','CALIBRATION','maxOperations',1,'calibration',jsonb_build_object('caseId','vector-regression','groupId','vector-regression','split','calibration','expected','NO_EVIDENCE','relevantBindingIds','[]'::jsonb)))) from app.attempts a where execution_id='99000000-0000-4000-8000-000000000040';
select app_private.evaluation_authorize((select value from material_test_state where kind='calibration-manifest'),repeat('2',64));
create function pg_temp.ecjob(field text) returns uuid language sql as $$ select (value->>field)::uuid from material_test_state where kind='calibration-job' $$;
create function pg_temp.ecquery() returns text language sql as $$ select value#>>'{}' from material_test_state where kind='calibration-query' $$;
set local role alunza_app;
select app_private.evaluation_start_stage('99000000-0000-4000-8000-000000000030',repeat('2',64),'INGESTION');
select app_private.evaluation_start_stage('99000000-0000-4000-8000-000000000030',repeat('2',64),'CALIBRATION');
insert into material_test_state values('calibration-job',app_private.evaluation_calibration_claim());
insert into material_test_state values('calibration-query',to_jsonb(app_private.evaluation_calibration_query(pg_temp.ecjob('id'),pg_temp.ecjob('token'),'vector fixture query')));
insert into material_test_state values('calibration-call',app_private.evaluation_reserve(pg_temp.espec()||jsonb_build_object('owner',jsonb_build_object('kind','CALIBRATION','id',pg_temp.ecjob('id'),'token',pg_temp.ecjob('token')),'inputHash',pg_temp.ecquery(),'logicalKey','help-query-1'),true));
select ok(app_private.evaluation_complete(pg_temp.ecall('callId','calibration-call'),pg_temp.ecall('dispatchToken','calibration-call'),'{"vectors":[[0.8,0.6,0]]}'),'EVAL-55 calibration uses a durable embedding result');
select throws_ok($$select app_private.evaluation_calibration_retrieve(pg_temp.ecjob('id'),pg_temp.ecjob('token'),'[0.6,0.8,0]',pg_temp.ecquery(),pg_temp.ecall('callId','calibration-call'))$$,'23514','INVALID_CALIBRATION_VECTOR','EVAL-56 another vector cannot substitute for the recorded provider result');
select throws_ok($$select app_private.evaluation_calibration_retrieve(pg_temp.ecjob('id'),pg_temp.ecjob('token'),null,pg_temp.ecquery(),pg_temp.ecall('callId','calibration-call'))$$,'23514','INVALID_CALIBRATION_VECTOR','EVAL-57 a null vector never passes receipt equality');
select is(jsonb_array_length(app_private.evaluation_calibration_retrieve(pg_temp.ecjob('id'),pg_temp.ecjob('token'),'[0.8,0.6,0]',pg_temp.ecquery(),pg_temp.ecall('callId','calibration-call'))),0,'EVAL-58 matching vector succeeds with pg_catalog-only search_path and excludes unpublished material');
reset role;
select is((select state from app_private.evaluation_calibrations where id=pg_temp.ecjob('id')),'SUCCEEDED','EVAL-59 retrieval atomically checkpoints the calibration case');
select is((select call_id from app_private.evaluation_calibrations where id=pg_temp.ecjob('id')),pg_temp.ecall('callId','calibration-call'),'EVAL-60 successful retrieval retains its exact receipt');
select * from finish();
rollback;
