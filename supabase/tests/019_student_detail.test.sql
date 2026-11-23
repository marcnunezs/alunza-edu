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
-- Validate the original domain constraints without flushing signal capture mid-transaction.
-- SET CONSTRAINTS ALL IMMEDIATE and subsequent DML rejection have their own signals integration test.
set constraints app.provisioning_complete, app.exercise_definition_complete,
 app.concept_current_version, app.exercise_current_version immediate;


-- Reuse only the real submission admission/finalization fixture helpers.
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

insert into auth.users(id,email,email_confirmed_at) values('71000000-0000-4000-8000-000000000006','detail-empty@alunza.test',now());
insert into auth.sessions(id,user_id) values('71100000-0000-4000-8000-000000000006','71000000-0000-4000-8000-000000000006');
insert into app.profiles(id,display_name,email_normalized,account_state) values('71000000-0000-4000-8000-000000000006','Empty student','detail-empty@alunza.test','ACTIVE');
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at) values('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000006','STUDENT','ACTIVE',now());
insert into app.class_memberships(organization_id,class_id,user_id) values
 ('72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000006'),
 ('72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003');
create temporary table detail_state(kind text primary key,value jsonb);
grant all on detail_state to alunza_app;
create function pg_temp.dv(key text) returns jsonb language sql as $$ select value from detail_state where kind=key $$;
create function pg_temp.did(key text,field text default 'id') returns uuid language sql as $$ select (pg_temp.dv(key)->>field)::uuid $$;
create function pg_temp.hu(n integer) returns void language plpgsql as $$ begin
 perform set_config('app.actor_id','71000000-0000-4000-8000-'||lpad(n::text,12,'0'),true),
 set_config('app.session_id','71100000-0000-4000-8000-'||lpad(n::text,12,'0'),true),
 set_config('app.organization_id','72000000-0000-4000-8000-000000000001',true),
 set_config('app.request_id','79000000-0000-4000-8000-000000000001',true);
end $$;
create function pg_temp.detail(options jsonb default '{}',student uuid default '71000000-0000-4000-8000-000000000003') returns jsonb language sql as $$
 select app_private.student_detail_progress('74000000-0000-4000-8000-000000000001',student,options)
$$;
create function pg_temp.feedback(feedback uuid,options jsonb default '{}') returns jsonb language sql as $$
 select app_private.student_detail_feedback('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003',feedback,options)
$$;
create function pg_temp.history(options jsonb default '{}') returns jsonb language sql as $$
 select app_private.student_detail_feedback_history('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003',pg_temp.did('attempt','attemptId'),options)
$$;
-- Synthetic provider receipts, but real reserve/claim/finish/presentation/ACK functions.
-- The definer is a rolled-back fixture convenience, never part of domain DDL.
create function pg_temp.help_fixture(n integer,kind text,present boolean,viewed boolean) returns jsonb language plpgsql security definer as $$
declare request jsonb; result_value jsonb; f uuid; rag jsonb; job jsonb;
 actor text:=current_setting('app.actor_id',true); session text:=current_setting('app.session_id',true);
begin
 request:=app_private.help_reserve(pg_temp.did('attempt','attemptId'),kind,case when kind='HINT' then 1 else null end,'detail-help-'||n,'79000000-0000-4000-8000-000000000001');
 if kind='HINT' then
  rag:=jsonb_build_object('diagnosis_code','FAILED_TEST','explanation','Explicación de prueba','hint','Pista entregada','status','SUPPORTED','source_refs',
   jsonb_build_array(jsonb_build_object('source_id','78000000-0000-4000-8000-000000000001','source_version_id','78100000-0000-4000-8000-000000000001','chunk_id','78300000-0000-4000-8000-000000000001','locator','Línea 1')));
  insert into app_private.help_context_refs(organization_id,request_id,source_id,source_version_id,chunk_id,locator,distance,used)
  values('72000000-0000-4000-8000-000000000001',(request->>'id')::uuid,'78000000-0000-4000-8000-000000000001','78100000-0000-4000-8000-000000000001','78300000-0000-4000-8000-000000000001','Línea 1',0,true);
  insert into app_private.help_calls(organization_id,request_id,phase,state,completed_at,result) values
  ('72000000-0000-4000-8000-000000000001',(request->>'id')::uuid,'GENERATION','COMPLETED',clock_timestamp(),jsonb_build_object('candidate',rag)),
  ('72000000-0000-4000-8000-000000000001',(request->>'id')::uuid,'REVIEW','COMPLETED',clock_timestamp(),jsonb_build_object('verification',jsonb_build_object('verdict','ACCEPT','source_refs',rag->'source_refs')));
 else rag:=jsonb_build_object('diagnosis_code','FAILED_TEST','explanation','No hay material autorizado suficiente para sustentar esta ayuda.',
  'hint','','source_refs','[]'::jsonb,'status','NO_EVIDENCE'); end if;
 perform set_config('app.actor_id','',true),set_config('app.session_id','',true);
 job:=app_private.help_claim();
 if (job->>'id') is distinct from (request->>'id') then raise exception 'HELP_FIXTURE_CLAIM_MISMATCH'; end if;
 if app_private.help_finish((job->>'id')::uuid,(job->>'token')::uuid,rag,'{"fixture":"IMP06.03"}') is not true then
  raise exception 'HELP_FIXTURE_FINISH_FAILED';
 end if;
 perform set_config('app.actor_id',coalesce(actor,''),true),set_config('app.session_id',coalesce(session,''),true);
 select id into f from app.feedbacks where request_id=(request->>'id')::uuid;
 result_value:=jsonb_build_object('id',f);
 if present then result_value:=app_private.help_feedback(f); end if;
 if viewed then result_value:=app_private.help_viewed(f,(result_value->>'presentationToken')::uuid); end if;
 return result_value;
end $$;
create function pg_temp.facts_digest() returns text language plpgsql security definer as $$
declare rel text; value text; total text:='';
begin
 foreach rel in array array['app.attempts','app.executions','app.feedback_requests','app.feedbacks','app.feedback_source_refs','app_private.help_events',
  'app_private.attempt_events','app_private.attempt_results','app_private.student_activity_observations','app.audit_events','app.operation_keys',
  'app_private.signal_lanes','app_private.signal_input_changes','app_private.exercise_tests','app.exercise_versions','app.activity_exercises'] loop
  execute format('select coalesce(string_agg(to_jsonb(t)::text,'''' order by to_jsonb(t)::text),'''') from %s t where organization_id=$1',rel)
  into value using '72000000-0000-4000-8000-000000000001'::uuid;
  total:=total||rel||value;
 end loop;
 return md5(total);
end $$;

-- Actual roles and grants, not owner-only authorization assertions.
set local role alunza_app;
select pg_temp.hu(1);
insert into detail_state values('rule',app_private.create_rule_version('72000000-0000-4000-8000-000000000001',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"inactivityDays":7}}','detail-rule-create'));
select app_private.activate_rule_version('72000000-0000-4000-8000-000000000001',pg_temp.did('rule'),null,'detail-rule-activate');
reset role;
-- A failed lane belonging to the other pupil must not contaminate this pupil.
insert into app_private.signal_lanes(id,organization_id,class_id,student_id,activity_id,type)
 values('79900000-0000-4000-8000-000000000006','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001',
 '71000000-0000-4000-8000-000000000006','77000000-0000-4000-8000-000000000001','INACTIVITY');
insert into app_private.signal_jobs(lane_id,failed_at,last_error_code)
 values('79900000-0000-4000-8000-000000000006',clock_timestamp(),'SQL_FIXTURE_FAILURE');
select ok(not has_function_privilege(role_name,p.oid,'EXECUTE'),'Data API cannot execute '||p.proname||' as '||role_name)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated','service_role']) role_name
where n.nspname='app_private' and p.proname like 'student_detail_%';
select ok(not has_function_privilege('alunza_app',signature,'EXECUTE'),'internal kernel is private: '||signature)
from unnest(array['app_private.student_detail_context(uuid,uuid,jsonb)','app_private.student_detail_attempt_row(uuid,uuid,uuid,timestamptz)',
 'app_private.student_detail_feedback_value(uuid,timestamptz,boolean)','app_private.dashboard_processing_scoped(uuid,uuid,uuid,uuid,timestamptz)',
 'app_private.dashboard_signals_scoped(uuid,uuid,jsonb)']) signature;
select ok(bool_and(pg_get_userbyid(p.proowner)='alunza_identity' and p.provolatile='s' and p.proconfig @> array['search_path=pg_catalog']),
 'entrypoints keep constrained owner, stable snapshot and fixed search path') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='app_private' and p.proname in('student_detail_progress','student_detail_evidence','student_detail_attempt','student_detail_feedback_history',
 'student_detail_feedback','student_detail_reference','student_detail_signals','student_detail_signal');

set local role alunza_app;
select pg_temp.hu(3);
select is(pg_temp.admit_submit(1,'detail-submit-1')->>'kind','reserved','real failed attempt admission');
select ok(pg_temp.stage_submit(1,'FAILED_TEST'),'public and private canonical result are staged');
insert into detail_state values('attempt',pg_temp.finish_submit(1));
select is(pg_temp.admit_submit(2,'detail-submit-2')->>'kind','reserved','second confirmed attempt admits');
select ok(pg_temp.stage_submit(2,'SUCCESS'),'success result stages');
insert into detail_state values('success',pg_temp.finish_submit(2));
insert into detail_state values('fallback',pg_temp.help_fixture(1,'FEEDBACK',true,true));
insert into detail_state values('hint',pg_temp.help_fixture(2,'HINT',true,true));
insert into detail_state values('presented',pg_temp.help_fixture(3,'FEEDBACK',true,false));
insert into detail_state values('prepared',pg_temp.help_fixture(4,'FEEDBACK',false,false));
select throws_ok($$select pg_temp.detail()$$,'P0001','RESOURCE_NOT_FOUND','student cannot invoke teacher detail');
select pg_temp.hu(1);
select throws_ok($$select pg_temp.detail()$$,'P0001','RESOURCE_NOT_FOUND','ADMIN governance grants no pedagogical detail');
select pg_temp.hu(5);
select throws_ok($$select pg_temp.detail()$$,'P0001','RESOURCE_NOT_FOUND','unassigned teacher denied');
select pg_temp.hu(2);
insert into detail_state values('before',to_jsonb(pg_temp.facts_digest()));
insert into detail_state values('detail',pg_temp.detail());
select is(pg_temp.dv('detail')->>'roster','CURRENT_ACTIVE','current active roster is explicit');
select is(pg_temp.dv('detail')#>>'{progress,summary,completed}','1','canonical prior completion is reused');
select is(pg_temp.dv('detail')#>>'{progress,observation,summary,attempts}','2','both attempts count without private detail');
select is(pg_temp.dv('detail')#>>'{progress,observation,summary,hintsDelivered}','1','only confirmed hint delivery counts');
select is(pg_temp.detail('{}','71000000-0000-4000-8000-000000000006')#>>'{progress,summary,evidenceState}','NO_ATTEMPTS','valid enrolled pupil without evidence is empty');
select is(current_setting('app.actor_id'),'71000000-0000-4000-8000-000000000002','student reads preserve real teacher actor');
select is((select count(*)::integer from app.attempts),0,'direct attempt RLS is still student-only');
select throws_ok($$select pg_temp.detail('{"studentId":"71000000-0000-4000-8000-000000000006"}')$$,'P0001','INVALID_REQUEST','query cannot override path student');
select throws_ok($$select pg_temp.detail('{"from":"2026-09-02T00:00:00Z","asOf":"2026-09-01T00:00:00Z"}')$$,'P0001','DASHBOARD_PERIOD_INVALID','invalid period rejects');
select throws_ok($$select app_private.student_detail_progress('74000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003','{}')$$,'P0001','RESOURCE_NOT_FOUND','same pupil in another class does not widen teacher permission');
select throws_ok($$select app_private.student_detail_progress('74000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000003','{}')$$,'P0001','RESOURCE_NOT_FOUND','cross-organization target is not found');
insert into detail_state values('page',app_private.student_detail_evidence('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003','{"limit":1}'));
insert into detail_state values('next',app_private.student_detail_evidence('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003',
 jsonb_build_object('limit',1,'asOf',pg_temp.dv('page')->>'asOf','cursor',pg_temp.dv('page')#>>'{page,nextCursor}')));
select is(pg_temp.dv('page')#>>'{page,hasMore}','true','attempt history paginates');
select isnt(pg_temp.dv('page')#>>'{data,0,attempt,id}',pg_temp.dv('next')#>>'{data,0,attempt,id}','page boundary preserves attempts exactly once');
select throws_ok($$select app_private.student_detail_evidence('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000006',
 jsonb_build_object('asOf',pg_temp.dv('page')->>'asOf','cursor',pg_temp.dv('page')#>>'{page,nextCursor}'))$$,'P0001','DASHBOARD_CURSOR_INVALID','cursor cannot cross student');
insert into detail_state values('attemptDetail',app_private.student_detail_attempt('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003',pg_temp.did('attempt','attemptId'),'{}'));
select is(pg_temp.dv('attemptDetail')->'attempt',pg_temp.dv('attempt'),'teacher sees exact canonical persisted attempt');
select is(jsonb_array_length(pg_temp.dv('attemptDetail')#>'{exercise,tests}'),1,'only visible test definition is projected');
select ok(pg_temp.dv('attemptDetail')::text not like '%hidden-sentinel%','hidden identifiers never escape attempt projection');
select is(pg_temp.dv('attemptDetail')#>'{attempt,technicalResult,hiddenChecksPassed}','false'::jsonb,'public hidden-check summary remains available');
select throws_ok($$select app_private.student_detail_attempt('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000006',pg_temp.did('attempt','attemptId'),'{}')$$,'P0001','RESOURCE_NOT_FOUND','attempt ID cannot cross student');
insert into detail_state values('history',pg_temp.history('{"limit":1}'));
insert into detail_state values('historyNext',pg_temp.history(jsonb_build_object('limit',1,'asOf',pg_temp.dv('history')->>'asOf','cursor',pg_temp.dv('history')#>>'{page,nextCursor}')));
select is(pg_temp.dv('history')#>>'{page,hasMore}','true','delivered help has second page');
select isnt(pg_temp.dv('history')#>>'{items,0,id}',pg_temp.dv('historyNext')#>>'{items,0,id}','help page preserves stable delivery order');
select is(jsonb_array_length(pg_temp.history()->'items'),2,'only FEEDBACK_VIEWED and HINT_DELIVERED are listed');
select throws_ok($$select pg_temp.feedback(pg_temp.did('presented'))$$,'P0001','RESOURCE_NOT_FOUND','GET presentation without ACK is inaccessible by ID');
select throws_ok($$select pg_temp.feedback(pg_temp.did('prepared'))$$,'P0001','RESOURCE_NOT_FOUND','prepared help is inaccessible by ID');
select throws_ok($$select pg_temp.feedback(pg_temp.did('hint'),jsonb_build_object('asOf',pg_temp.dv('hint')->>'createdAt'))$$,'P0001','RESOURCE_NOT_FOUND','later delivery cannot leak through an earlier cutoff');
select is(pg_temp.feedback(pg_temp.did('hint'))#>>'{feedback,help,hint}','Pista entregada','delivered help is read without generating again');
select ok(not((pg_temp.feedback(pg_temp.did('hint'))->'feedback') ?| array['presentationToken','capabilities','requestId','viewedAt']),'teacher DTO has no consumption capabilities');
insert into detail_state values('reference',app_private.student_detail_reference('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003',pg_temp.did('hint'),'78300000-0000-4000-8000-000000000001','{}'));
select is(pg_temp.dv('reference')#>>'{reference,version}','1','reference uses cited version');
select throws_ok($$select app_private.student_detail_reference('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003',pg_temp.did('hint'),'78300000-0000-4000-8000-000000000002','{}')$$,'P0001','RESOURCE_NOT_FOUND','arbitrary uncited chunk denied');
select is(jsonb_array_length(app_private.student_detail_signals('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003','{}')->'data'),0,'signals are not created by the detail query');
select is(app_private.student_detail_signals('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003','{}')#>>'{processing,failedLanes}','0','other pupil failure cannot enter individual processing');
select is(app_private.student_detail_signals('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000006','{}')#>>'{processing,failedLanes}','1','individual processing includes its own failed lane');
select is(app_private.dashboard_signals('74000000-0000-4000-8000-000000000001','{}')#>>'{processing,failedLanes}','1','legacy class wrapper retains class-wide processing');
select throws_ok($$select app_private.student_detail_signal('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003','79900000-0000-4000-8000-000000000006','{}')$$,'P0001','RESOURCE_NOT_FOUND','unknown or out-of-scope episode is not found');
select is(to_jsonb(pg_temp.facts_digest()),pg_temp.dv('before'),'all successful and rejected reads preserve canonical facts and audit');

-- Availability is live, including for a historically delivered response.
reset role;
update app.sources set visibility='HIDDEN' where id='78000000-0000-4000-8000-000000000001';
set local role alunza_app;
select is(pg_temp.feedback(pg_temp.did('hint'))#>'{feedback,help}','null'::jsonb,'revoked help has no generated text or citations');
select is(pg_temp.feedback(pg_temp.did('hint'))#>>'{feedback,available}','false','revoked help is explicit unavailable');
select throws_ok($$select app_private.student_detail_reference('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003',pg_temp.did('hint'),'78300000-0000-4000-8000-000000000001','{}')$$,'P0001','RESOURCE_NOT_FOUND','historical reference cannot bypass revocation');
reset role;
update app.organization_memberships set state='DISABLED' where organization_id='72000000-0000-4000-8000-000000000001' and user_id='71000000-0000-4000-8000-000000000003';
set local role alunza_app;
select throws_ok($$select pg_temp.detail(jsonb_build_object('asOf',pg_temp.dv('detail')->>'asOf'))$$,'P0001','RESOURCE_NOT_FOUND','old cutoff cannot resurrect disabled student');
reset role;
update app.organization_memberships set state='ACTIVE' where organization_id='72000000-0000-4000-8000-000000000001' and user_id='71000000-0000-4000-8000-000000000003';
update app.class_memberships set ended_at=clock_timestamp() where class_id='74000000-0000-4000-8000-000000000001' and user_id='71000000-0000-4000-8000-000000000003';
set local role alunza_app;
select throws_ok($$select pg_temp.detail()$$,'P0001','RESOURCE_NOT_FOUND','withdrawn student is not a current detail target');
reset role;
update app.profiles set account_state='DISABLED' where id='71000000-0000-4000-8000-000000000002';
set local role alunza_app;
select throws_ok($$select pg_temp.detail('{}','71000000-0000-4000-8000-000000000006')$$,'P0001','RESOURCE_NOT_FOUND','current teacher profile state revokes all detail reads');
reset role;
select * from finish();
rollback;
