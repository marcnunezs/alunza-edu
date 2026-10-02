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
select ('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'help-'||n||'@alunza.test',now() from generate_series(1,5) n;
insert into auth.sessions(id,user_id)
select ('71100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,5) n;
insert into app.profiles(id,display_name,email_normalized,account_state)
select ('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Academic '||n,'help-'||n||'@alunza.test','ACTIVE' from generate_series(1,5) n;
insert into app.organizations(id,code,name) values ('72000000-0000-4000-8000-000000000001','HELP-A','Academic A'),('72000000-0000-4000-8000-000000000002','HELP-B','Academic B');
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at) values
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','ADMIN','ACTIVE',now()),
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','TEACHER','ACTIVE',now()),
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003','STUDENT','ACTIVE',now()),
('72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000004','TEACHER','ACTIVE',now()),
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000005','TEACHER','ACTIVE',now());
insert into app.courses(id,organization_id,code,name,academic_period) values
('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','P1','Programming','2026-2'),
('73000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000002','P1','Foreign','2026-2');
insert into app.course_teacher_grants(organization_id,course_id,teacher_id,granted_by) values
('72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001');
insert into app.classes(id,organization_id,course_id,teacher_id,code,name) values
('74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','A1','Own class'),
('74000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000005','A2','Other class'),
('74000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000004','B1','Foreign class');
insert into app.class_memberships(organization_id,class_id,user_id) values('72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003');
insert into app.class_join_codes(organization_id,class_id,token_digest,expires_at,created_by) values
('72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000002',repeat('a',64),now()+interval '1 day','71000000-0000-4000-8000-000000000005'),
('72000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000003',repeat('b',64),now()+interval '1 day','71000000-0000-4000-8000-000000000004');
insert into app.concept_tags(id,organization_id,normalized_name) values('75000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','addition');
insert into app.concept_versions(id,organization_id,concept_id,version,name,description,created_by) values
('75100000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001',1,'Addition','Addition','71000000-0000-4000-8000-000000000001');
update app.concept_tags set current_version_id='75100000-0000-4000-8000-000000000001' where id='75000000-0000-4000-8000-000000000001';
insert into app.exercises(id,organization_id,owner_id) values('76000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002');
insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) values
('76100000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001',1,'Sum','Return sum','module.exports.solve=(a,b)=>a+b;','BEGINNER','71000000-0000-4000-8000-000000000002');
insert into app.exercise_version_concepts values('72000000-0000-4000-8000-000000000001','76100000-0000-4000-8000-000000000001','75100000-0000-4000-8000-000000000001');
insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) values
('72000000-0000-4000-8000-000000000001','76100000-0000-4000-8000-000000000001','visible',0,'visible','[1,2]','3'),
('72000000-0000-4000-8000-000000000001','76100000-0000-4000-8000-000000000001','hidden-sentinel',1,'hidden','[2,2]','4');
update app.exercises set current_version_id='76100000-0000-4000-8000-000000000001' where id='76000000-0000-4000-8000-000000000001';
insert into app.activities(id,organization_id,class_id,created_by,title,type) values
('77000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','Published','FORMATIVE'),
('77000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','Draft','FORMATIVE');
insert into app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position) values('78000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','77000000-0000-4000-8000-000000000001','76100000-0000-4000-8000-000000000001',0);
update app.activities set state='PUBLISHED' where id='77000000-0000-4000-8000-000000000001';
set constraints all immediate;

-- Four additional students exercise the shared organization quota without
-- relying on an in-memory semaphore or bypassing the personal quota.
insert into auth.users(id,email,email_confirmed_at)
select ('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'help-'||n||'@alunza.test',now() from generate_series(6,9) n;
insert into auth.sessions(id,user_id)
select ('71100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(6,9) n;
insert into app.profiles(id,display_name,email_normalized,account_state)
select ('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Academic '||n,'help-'||n||'@alunza.test','ACTIVE' from generate_series(6,9) n;
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at)
select '72000000-0000-4000-8000-000000000001',('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'STUDENT','ACTIVE',now() from generate_series(6,9) n;
insert into app.class_memberships(organization_id,class_id,user_id)
select '72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001',('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(6,9) n;

-- Helpers exist only inside this rolled-back fixture, never in application DDL.
create function pg_temp.sid(n integer) returns uuid language sql immutable as $$
 select ('79100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.submit_token(n integer) returns uuid language sql security definer as $$
 select lease_token from app_private.submission_reservations where id=pg_temp.sid(n)
$$;
create function pg_temp.admit_submit(n integer,operation_key text,payload text default repeat('a',64),frequency integer default 10,previous_attempt uuid default null) returns jsonb language sql as $$
 select app_private.admit_practice_submit(pg_temp.sid(n),'77000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000001',
 '76100000-0000-4000-8000-000000000001',operation_key,payload,'module.exports.solve=(a,b)=>a+b;',previous_attempt,'sql-test','79000000-0000-4000-8000-000000000001',true,2,4,frequency)
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

-- Corpus and queue isolation exist only inside this rolled-back SQL fixture.
update app.feedback_requests set lifecycle_status='CANCELLED',level_reserved=false,lease_token=null,lease_until=null where lifecycle_status in('QUEUED','RUNNING');
delete from app_private.material_embedding_profile;
insert into app_private.material_embedding_profile(configuration_id,model,dimensions) values('help-fixture','synthetic',3);
insert into app.sources(id,organization_id,class_id,owner_id,title)
select ('78000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','Help material '||n from generate_series(1,2)n;
insert into app.source_versions(id,organization_id,source_id,version,storage_object_key,original_name,format,mime_type,size_bytes,content_hash,created_by)
select ('78100000-0000-4000-8000-'||right(id::text,12))::uuid,organization_id,id,1,'help-fixture/'||id,'material.txt','TXT','text/plain',10,repeat('c',64),owner_id from app.sources where id::text like '78000000-%';
insert into app.source_index_generations(id,organization_id,source_id,source_version_id,generation_number,index_status,configuration_id,embedding_model,embedding_dimension,chunk_count,indexed_at)
select ('78200000-0000-4000-8000-'||right(id::text,12))::uuid,organization_id,source_id,id,1,'READY','help-fixture','synthetic',3,1,now() from app.source_versions where id::text like '78100000-%';
insert into app.source_chunks(id,organization_id,source_id,source_version_id,generation_id,chunk_index,text,token_count,locator,content_hash,embedding)
select ('78300000-0000-4000-8000-'||right(id::text,12))::uuid,organization_id,source_id,source_version_id,id,0,'Una suma combina los dos operandos.',8,'Línea 1',repeat('d',64),'[1,0,0]'::extensions.vector from app.source_index_generations where id::text like '78200000-%';
update app.source_versions set current_generation_id=('78200000-0000-4000-8000-'||right(id::text,12))::uuid where id::text like '78100000-%';
update app.sources set current_version_id=('78100000-0000-4000-8000-'||right(id::text,12))::uuid where id::text like '78000000-%';
create temporary table help_test_state(kind text primary key,value jsonb);
grant all on help_test_state to alunza_app;
create function pg_temp.hu(n integer) returns void language plpgsql as $$ begin
 perform set_config('app.actor_id',case when n=0 then '' else '71000000-0000-4000-8000-'||lpad(n::text,12,'0') end,true),set_config('app.session_id',case when n=0 then '' else '71100000-0000-4000-8000-'||lpad(n::text,12,'0') end,true),set_config('app.organization_id','',true);
end $$;
create function pg_temp.hid(kind_value text,field text default 'id') returns uuid language sql as $$ select (value->>field)::uuid from help_test_state where kind=kind_value $$;
create function pg_temp.hr(kind_value text default 'HINT',key_value text default 'help-key-1',level_value integer default null) returns jsonb language sql as $$
 select app_private.help_reserve(pg_temp.hid('attempt','attemptId'),kind_value,level_value,key_value,'79000000-0000-4000-8000-000000000001')
$$;
create function pg_temp.hrag() returns jsonb language sql as $$ select jsonb_build_object('diagnosis_code','FAILED_TEST','explanation','La verificación indicó un fallo.','hint','Compara los dos operandos.','status','SUPPORTED','source_refs',jsonb_build_array(jsonb_build_object('source_id','78000000-0000-4000-8000-000000000001','source_version_id','78100000-0000-4000-8000-000000000001','chunk_id','78300000-0000-4000-8000-000000000001','locator','Línea 1'))) $$;
select ok(not has_table_privilege('alunza_app','app.feedbacks','select,insert,update,delete'),'HELP-01 runtime cannot bypass help authorization or read presentation tokens');
select ok(not has_function_privilege('alunza_app','app_private.help_store_result(uuid,jsonb,jsonb,text)','execute'),'HELP-02 internal publication helper is not callable');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in('app.feedback_requests'::regclass,'app.feedbacks'::regclass,'app.feedback_source_refs'::regclass,'app_private.help_calls'::regclass,'app_private.help_inputs'::regclass,'app_private.help_context_refs'::regclass,'app_private.help_events'::regclass)),'HELP-03 all help relations force RLS');
set local role alunza_app;
select pg_temp.hu(3);
select set_config('app.organization_id','72000000-0000-4000-8000-000000000001',true);
select is(pg_temp.admit_submit(1,'help-submit-0001')->>'kind','reserved','HELP-04 confirmed attempt is prepared through real submission admission');
select ok(pg_temp.stage_submit(1,'FAILED_TEST'),'HELP-05 canonical public/private evidence is staged');
insert into help_test_state values('attempt',pg_temp.finish_submit(1));
insert into help_test_state values('request',pg_temp.hr());
select is((select value->>'state' from help_test_state where kind='request'),'QUEUED','HELP-06 help is durable before acknowledgement');
select is(pg_temp.hr()->>'id',pg_temp.hid('request')::text,'HELP-07 same idempotency key returns the same durable request');
select throws_ok($$select pg_temp.hr('FEEDBACK')$$,'P0001','IDEMPOTENCY_CONFLICT','HELP-08 changing kind under the same key conflicts');
select throws_ok($$select pg_temp.hr('HINT','other-key')$$,'P0001','REQUEST_IN_PROGRESS','HELP-09 concurrent keys cannot reserve a second level');
select throws_ok($$select app_private.help_claim()$$,'42501','FORBIDDEN','HELP-10 request actors cannot act as workers');
select pg_temp.hu(1);
select throws_ok($$select app_private.help_request_status(pg_temp.hid('request'))$$,'P0001','RESOURCE_NOT_FOUND','HELP-11 ADMIN has no pedagogical help access');
select pg_temp.hu(2);
select throws_ok($$select app_private.help_request_status(pg_temp.hid('request'))$$,'P0001','RESOURCE_NOT_FOUND','HELP-12 teacher access is not silently added');
select pg_temp.hu(0);
insert into help_test_state values('job',app_private.help_claim());
select ok(not app_private.help_renew(pg_temp.hid('job'),null),'HELP-13 null lease token cannot renew');
select ok(app_private.help_context(pg_temp.hid('job'),null) is null,'HELP-14 null token cannot obtain attempt context');
insert into help_test_state values('context',app_private.help_context(pg_temp.hid('job'),pg_temp.hid('job','token')));
select ok((select value::text not like '%hidden-sentinel%' and value::text not like '%stdout%' and value::text not like '%hiddenChecksPassed%' from help_test_state where kind='context'),'HELP-15 model context excludes hidden checks and console output');
select is(app_private.help_begin_call(pg_temp.hid('job'),pg_temp.hid('job','token'),'EMBEDDING')->>'state','DISPATCH','HELP-16 call is marked dispatched before provider');
select is(app_private.help_begin_call(pg_temp.hid('job'),pg_temp.hid('job','token'),'EMBEDDING')->>'state','STOP','HELP-17 uncertain dispatched call cannot be invoked twice');
select ok(app_private.help_complete_call(pg_temp.hid('job'),pg_temp.hid('job','token'),'EMBEDDING','{"vectors":[[1,0,0]],"configuration":{"id":"help-fixture","model":"synthetic","dimensions":3}}'),'HELP-18 provider receipt is checkpointed');
select is(app_private.help_begin_call(pg_temp.hid('job'),pg_temp.hid('job','token'),'EMBEDDING')->>'state','COMPLETED','HELP-19 receipt is reused without dispatch');
insert into help_test_state values('chunks',app_private.help_retrieve(pg_temp.hid('job'),pg_temp.hid('job','token'),'help-fixture','synthetic',3,'[1,0,0]'::extensions.vector));
select is((select jsonb_array_length(value) from help_test_state where kind='chunks'),2,'HELP-20 retrieval returns only the authorized corpus');
insert into help_test_state values('input',jsonb_build_object('context',(select value->'context' from help_test_state where kind='context'),'kind','HINT','hintLevel',1,'chunks',(select value from help_test_state where kind='chunks')));
select ok(app_private.help_prepare_input(pg_temp.hid('job'),pg_temp.hid('job','token'),(select value from help_test_state where kind='input'),'{"policy":"fixture"}') is not null,'HELP-21 input and all context references are stored atomically');
select ok(not app_private.help_configuration_matches(pg_temp.hid('job'),pg_temp.hid('job','token'),'{"policy":"changed"}'),'HELP-22 hot configuration switch cannot resume saved context');
select is(app_private.help_begin_call(pg_temp.hid('job'),pg_temp.hid('job','token'),'GENERATION')->>'state','DISPATCH','HELP-23 prepared generation is dispatched');
select ok(app_private.help_complete_call(pg_temp.hid('job'),pg_temp.hid('job','token'),'GENERATION',jsonb_build_object('candidate',pg_temp.hrag())),'HELP-24 generation receipt is durable');
select throws_ok($$select app_private.help_finish(pg_temp.hid('job'),pg_temp.hid('job','token'),pg_temp.hrag(),'{}')$$,'23514','UNREVIEWED_HELP','HELP-25 unreviewed candidate is never published');
select is(app_private.help_begin_call(pg_temp.hid('job'),pg_temp.hid('job','token'),'REVIEW')->>'state','DISPATCH','HELP-26 verification is a separate checkpointed call');
select ok(app_private.help_complete_call(pg_temp.hid('job'),pg_temp.hid('job','token'),'REVIEW',jsonb_build_object('verification',jsonb_build_object('verdict','ACCEPT','reason','SUPPORTED','source_refs',pg_temp.hrag()->'source_refs'))),'HELP-27 verifier receipt is durable');
select ok(not app_private.help_finish(pg_temp.hid('job'),null,pg_temp.hrag(),'{}'),'HELP-28 missing token cannot activate reviewed response');
select ok(app_private.help_finish(pg_temp.hid('job'),pg_temp.hid('job','token'),pg_temp.hrag(),'{}'),'HELP-29 validated response and references publish together');
select ok(not app_private.help_finish(pg_temp.hid('job'),pg_temp.hid('job','token'),pg_temp.hrag(),'{}'),'HELP-30 duplicate worker cannot publish twice');
select pg_temp.hu(3);
insert into help_test_state values('ready',app_private.help_request_status(pg_temp.hid('request')));
select throws_ok($$select pg_temp.hr('HINT','help-level2-too-early')$$,'P0001','REQUEST_IN_PROGRESS','HELP-31 prepared hint holds its level until viewed');
select is(app_private.help_capabilities(pg_temp.hid('attempt','attemptId'))->>'reason','VIEW_PENDING_HINT','HELP-32 capability exposes prepared hint instead of advancing');
insert into help_test_state values('feedback',app_private.help_feedback(pg_temp.hid('ready','feedbackId')));
select is(app_private.help_feedback(pg_temp.hid('ready','feedbackId'))->>'presentationToken',(select value->>'presentationToken' from help_test_state where kind='feedback'),'HELP-33 two tabs receive a stable token');
select throws_ok($$select app_private.help_viewed(pg_temp.hid('ready','feedbackId'),'79999999-0000-4000-8000-000000000001')$$,'23514','INVALID_HELP_PRESENTATION','HELP-34 forged presentation cannot consume a level');
select ok(app_private.help_viewed(pg_temp.hid('ready','feedbackId'),pg_temp.hid('feedback','presentationToken'))->>'viewedAt' is not null,'HELP-35 ACK grants the displayed hint');
select ok(app_private.help_viewed(pg_temp.hid('ready','feedbackId'),pg_temp.hid('feedback','presentationToken'))->>'viewedAt' is not null,'HELP-36 duplicate ACK replays');
select is(app_private.help_capabilities(pg_temp.hid('attempt','attemptId'))->>'nextHintLevel','2','HELP-37 next level depends on delivery');
select is(app_private.help_reference(pg_temp.hid('ready','feedbackId'),'78300000-0000-4000-8000-000000000001')->>'version','1','HELP-38 citation opens its immutable version');
reset role;
select is((select count(*)::integer from app_private.help_events where request_id=pg_temp.hid('request') and event_type='HINT_DELIVERED'),1,'HELP-39 duplicate ACK creates one semantic event');
update app.sources set visibility='HIDDEN' where id='78000000-0000-4000-8000-000000000002';
set local role alunza_app;
select pg_temp.hu(3);
select is(app_private.help_feedback(pg_temp.hid('ready','feedbackId'))->'help'->>'status','NO_EVIDENCE','HELP-40 revocation of an uncited used source suppresses the complete response');
select is(app_private.help_feedback(pg_temp.hid('ready','feedbackId'))->>'available','false','HELP-41 suppressed content is not available');
select throws_ok($$select app_private.help_reference(pg_temp.hid('ready','feedbackId'),'78300000-0000-4000-8000-000000000001')$$,'P0001','RESOURCE_NOT_FOUND','HELP-42 citation cannot bypass revoked context');
reset role;
update app.sources set visibility='VISIBLE' where id='78000000-0000-4000-8000-000000000002';
-- Confirm every attempt needed by the quota checks while submission is still
-- permitted. Later checks request help for this existing evidence after CLOSED.
set local role alunza_app;
do $$ declare n integer; confirmed jsonb; begin
 for n in 6..9 loop
  perform pg_temp.hu(n); perform set_config('app.organization_id','72000000-0000-4000-8000-000000000001',true);
  perform pg_temp.admit_submit(n,'help-quota-submit-'||n); perform pg_temp.stage_submit(n,'FAILED_TEST'); confirmed:=pg_temp.finish_submit(n);
  insert into help_test_state values('attempt-'||n,confirmed);
 end loop;
 perform pg_temp.hu(6); perform set_config('app.organization_id','72000000-0000-4000-8000-000000000001',true);
 insert into help_test_state values('admission-16',pg_temp.admit_submit(16,'help-second-attempt-6'));
 insert into help_test_state values('stage-16',to_jsonb(pg_temp.stage_submit(16,'FAILED_TEST')));
 insert into help_test_state values('attempt-16',pg_temp.finish_submit(16));
 perform pg_temp.admit_submit(17,'help-unknown-attempt-6'); perform pg_temp.stage_submit(17,'UNKNOWN');
 insert into help_test_state values('attempt-17',pg_temp.finish_submit(17));
end $$;
reset role;
update app.activities set state='CLOSED' where id='77000000-0000-4000-8000-000000000001';
set local role alunza_app;
select pg_temp.hu(3);
update help_test_state set value=pg_temp.hr('HINT','help-key-2',2) where kind='request';
select is((select value->>'hintLevel' from help_test_state where kind='request'),'2','HELP-43 CLOSED activity accepts help on its persisted attempt');
select pg_temp.hu(0);
update help_test_state set value=app_private.help_claim() where kind='job';
select ok(app_private.help_fail(pg_temp.hid('job'),pg_temp.hid('job','token'),'NO_EVIDENCE'),'HELP-44 insufficient corpus becomes a durable fallback');
select pg_temp.hu(3);
select is(app_private.help_capabilities(pg_temp.hid('attempt','attemptId'))->>'nextHintLevel','2','HELP-45 fallback does not consume a level');
update help_test_state set value=pg_temp.hr('HINT','help-key-3',2) where kind='request';
select pg_temp.hu(0);
update help_test_state set value=app_private.help_claim() where kind='job';
select is(app_private.help_begin_call(pg_temp.hid('job'),pg_temp.hid('job','token'),'EMBEDDING')->>'state','DISPATCH','HELP-46 prepare an uncertain call for recovery');
reset role;
update app.feedback_requests set requested_at=clock_timestamp()-interval '20 seconds',deadline_at=clock_timestamp()-interval '1 second',lease_until=clock_timestamp()+interval '5 seconds' where id=pg_temp.hid('request');
set local role alunza_app;
select pg_temp.hu(0);
select ok(app_private.help_claim() is null,'HELP-47 absolute deadline finalizes even a still-live lease');
select ok(not app_private.help_complete_call(pg_temp.hid('job'),pg_temp.hid('job','token'),'EMBEDDING','{"vectors":[[1,0,0]]}'),'HELP-48 late provider result cannot reactivate a request');
select pg_temp.hu(3);
select is(app_private.help_capabilities(pg_temp.hid('attempt','attemptId'))->>'nextHintLevel','2','HELP-49 uncertain dispatch does not spend the level');
select is(app_private.help_feedback((app_private.help_request_status(pg_temp.hid('request'))->>'feedbackId')::uuid)->>'status','PROVIDER_UNAVAILABLE','HELP-50 unavailable provider remains distinct from no evidence');
update help_test_state set value=pg_temp.hr('HINT','help-key-context-limit',2) where kind='request';
select pg_temp.hu(0);
update help_test_state set value=app_private.help_claim() where kind='job';
select ok(app_private.help_fail(pg_temp.hid('job'),pg_temp.hid('job','token'),'CONTEXT_TOO_LARGE'),'HELP-51 oversized complete context terminates safely');
select pg_temp.hu(3);
insert into help_test_state values('context-limit-feedback',app_private.help_feedback((app_private.help_request_status(pg_temp.hid('request'))->>'feedbackId')::uuid));
select is((select value->'help'->>'status' from help_test_state where kind='context-limit-feedback'),'NO_EVIDENCE','HELP-52 context budget failure is not provider failure');
select is((select value->'help'->>'hint' from help_test_state where kind='context-limit-feedback'),'','HELP-53 oversized context provides no hint');
select is((select jsonb_array_length(value->'help'->'source_refs') from help_test_state where kind='context-limit-feedback'),0,'HELP-54 oversized context provides no references');
select is(app_private.help_capabilities(pg_temp.hid('attempt','attemptId'))->>'nextHintLevel','2','HELP-55 budget failure does not consume a level');
-- Opening any available explanation is recorded, including operational UNKNOWN
-- and provider/evidence fallback; these are never HINT_DELIVERED events.
do $$ declare status_value text; request_value jsonb; job jsonb; feedback_value jsonb; begin
 foreach status_value in array array['NO_EVIDENCE','PROVIDER_UNAVAILABLE','UNKNOWN'] loop
  perform pg_temp.hu(6);
  request_value:=app_private.help_reserve(pg_temp.hid(case when status_value='UNKNOWN' then 'attempt-17' else 'attempt-6' end,'attemptId'),'FEEDBACK',null,'feedback-fallback-'||status_value,'79000000-0000-4000-8000-000000000001');
  perform pg_temp.hu(0); job:=app_private.help_claim();
  perform app_private.help_fail((job->>'id')::uuid,(job->>'token')::uuid,case when status_value='UNKNOWN' then 'NO_EVIDENCE' else status_value end);
  perform pg_temp.hu(6);
  feedback_value:=app_private.help_feedback((app_private.help_request_status((request_value->>'id')::uuid)->>'feedbackId')::uuid);
  insert into help_test_state values('feedback-'||status_value,feedback_value);
  perform app_private.help_viewed((feedback_value->>'id')::uuid,(feedback_value->>'presentationToken')::uuid);
  perform app_private.help_viewed((feedback_value->>'id')::uuid,(feedback_value->>'presentationToken')::uuid);
 end loop;
end $$;
select ok((select bool_and(value->>'presentationToken' is not null) from help_test_state where kind in('feedback-NO_EVIDENCE','feedback-PROVIDER_UNAVAILABLE','feedback-UNKNOWN')),'HELP-62 every available fallback explanation has a presentation token');
select is((select value->'help'->>'diagnosis_code' from help_test_state where kind='feedback-UNKNOWN'),'UNKNOWN','HELP-63 deterministic UNKNOWN explanation retains the saved diagnosis');
select is(app_private.help_capabilities(pg_temp.hid('attempt-6','attemptId'))->>'nextHintLevel','1','HELP-64 viewing fallback explanations consumes no hint level');
select is(app_private.help_capabilities(pg_temp.hid('attempt-17','attemptId'))->>'reason','EXPLANATION_ONLY','HELP-65 operational UNKNOWN remains explanation-only after ACK');
select ok((select value->>'presentationToken' is null from help_test_state where kind='context-limit-feedback'),'HELP-66 HINT fallback still has no presentation token');
reset role;
select is((select count(*)::integer from app_private.help_events where feedback_id in(select (value->>'id')::uuid from help_test_state where kind in('feedback-NO_EVIDENCE','feedback-PROVIDER_UNAVAILABLE','feedback-UNKNOWN')) and event_type='FEEDBACK_VIEWED'),3,'HELP-67 duplicate fallback ACK creates exactly one explanation event each');
select is((select count(*)::integer from app_private.help_events where feedback_id in(select (value->>'id')::uuid from help_test_state where kind in('feedback-NO_EVIDENCE','feedback-PROVIDER_UNAVAILABLE','feedback-UNKNOWN')) and event_type='HINT_DELIVERED'),0,'HELP-68 fallback explanation ACK never delivers a hint');
set local role alunza_app;
-- Only help is admitted after closure; all attempts above were already confirmed
-- through the limited submission functions while the activity was PUBLISHED.
do $$ declare n integer; begin
 for n in 6..9 loop
  perform pg_temp.hu(n); perform set_config('app.organization_id','72000000-0000-4000-8000-000000000001',true);
  insert into help_test_state values('quota-'||n,app_private.help_reserve(pg_temp.hid('attempt-'||n,'attemptId'),'HINT',1,'quota-key-'||n,'79000000-0000-4000-8000-000000000001'));
 end loop;
end $$;
select pg_temp.hu(3);
select throws_ok($$select pg_temp.hr('HINT','help-org-concurrent',2)$$,'P0001','RATE_LIMITED','HELP-56 organization has at most four concurrent help requests');
select pg_temp.hu(6);
select set_config('app.organization_id','72000000-0000-4000-8000-000000000001',true);
select is((select value->>'kind' from help_test_state where kind='admission-16'),'reserved','HELP-57 second attempt was admitted before closure');
select ok((select value::boolean from help_test_state where kind='stage-16'),'HELP-58 second public attempt was staged before closure');
select throws_ok($$select app_private.help_reserve(pg_temp.hid('attempt-16','attemptId'),'HINT',1,'help-student-concurrent','79000000-0000-4000-8000-000000000001')$$,'P0001','RATE_LIMITED','HELP-59 one student cannot run help for two attempts concurrently');
select pg_temp.hu(0);
do $$ declare n integer; job jsonb; begin for n in 1..4 loop job:=app_private.help_claim(); perform app_private.help_fail((job->>'id')::uuid,(job->>'token')::uuid,'NO_EVIDENCE'); end loop; end $$;
do $$ declare n integer; job jsonb; begin for n in 5..6 loop
 perform pg_temp.hu(3); perform pg_temp.hr('HINT','help-rate-'||n,2); perform pg_temp.hu(0); job:=app_private.help_claim(); perform app_private.help_fail((job->>'id')::uuid,(job->>'token')::uuid,'NO_EVIDENCE');
end loop; end $$;
select pg_temp.hu(3);
select throws_ok($$select pg_temp.hr('HINT','help-rate-seventh',2)$$,'P0001','RATE_LIMITED','HELP-60 the seventh actor request in one minute is rejected');
reset role;
-- Controlled historical quota fixture: it copies an existing confirmed scope,
-- contains no response, and creates no level/delivery event.
update app.feedback_requests set requested_at=clock_timestamp()-interval '61 seconds' where organization_id='72000000-0000-4000-8000-000000000001';
insert into app.feedback_requests(organization_id,class_id,activity_id,student_id,attempt_id,kind,lifecycle_status,requested_at,deadline_at,completed_at,correlation_id)
select a.organization_id,a.class_id,a.activity_id,a.student_id,a.id,'FEEDBACK','SUCCEEDED',clock_timestamp(),clock_timestamp()+interval '15 seconds',clock_timestamp(),'79000000-0000-4000-8000-000000000001'
from app.attempts a cross join generate_series(1,60) n where a.id=pg_temp.hid('attempt-6','attemptId');
set local role alunza_app;
select pg_temp.hu(3);
select throws_ok($$select pg_temp.hr('HINT','help-org-rate',2)$$,'P0001','RATE_LIMITED','HELP-61 organization rejects request sixty-one even when this actor has no recent requests');
select * from finish();
rollback;
