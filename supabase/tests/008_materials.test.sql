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
select ('81000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'material-'||n||'@alunza.test',now() from generate_series(1,5) n;
insert into auth.sessions(id,user_id)
select ('81100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('81000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,5) n;
insert into app.profiles(id,display_name,email_normalized,account_state)
select ('81000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Material '||n,'material-'||n||'@alunza.test','ACTIVE' from generate_series(1,5) n;
insert into app.organizations(id,code,name) values ('82000000-0000-4000-8000-000000000001','MAT-A','Materials A'),('82000000-0000-4000-8000-000000000002','MAT-B','Materials B');
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at) values
('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','ADMIN','ACTIVE',now()),
('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','TEACHER','ACTIVE',now()),
('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003','STUDENT','ACTIVE',now()),
('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000004','TEACHER','ACTIVE',now()),
('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000005','TEACHER','ACTIVE',now());
insert into app.courses(id,organization_id,code,name,academic_period) values
('83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','P1','Programming','2026-2');
insert into app.classes(id,organization_id,course_id,teacher_id,code,name) values
('84000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','A1','Own class'),
('84000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000005','A2','Other class');
insert into app.class_memberships(organization_id,class_id,user_id) values('82000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003');
insert into app.activities(id,organization_id,class_id,created_by,title,type) values
('87000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','Draft','FORMATIVE');
create temporary table material_test_state(kind text primary key,value jsonb);
grant all on material_test_state to alunza_app;
create function pg_temp.as_material_user(n integer) returns void language plpgsql as $$
begin
 perform set_config('app.actor_id',case when n=0 then '' else '81000000-0000-4000-8000-'||lpad(n::text,12,'0') end,true),
 set_config('app.session_id',case when n=0 then '' else '81100000-0000-4000-8000-'||lpad(n::text,12,'0') end,true),set_config('app.organization_id','',true);
end $$;
create function pg_temp.mid(field text) returns uuid language sql as $$ select (value->>field)::uuid from material_test_state where kind='reserve' $$;
create function pg_temp.mjob(field text) returns uuid language sql as $$ select (value->>field)::uuid from material_test_state where kind='job' $$;
create function pg_temp.mchunk(idx integer) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('index',idx,'text','material '||idx,'tokenCount',3,'locator','Línea '||idx,'contentHash',encode(sha256(convert_to('material '||idx,'UTF8')),'hex'),'embedding','[0.8,0.6,0]'::jsonb))
$$;
set local role alunza_app;
select pg_temp.as_material_user(2);
insert into material_test_state values('reserve',app_private.material_reserve_upload('84000000-0000-4000-8000-000000000001',null,null,null,'Variables','variables.txt','TXT','text/plain',12,repeat('a',64),'material-upload-1','89000000-0000-4000-8000-000000000001'));
select is((select value->>'kind' from material_test_state where kind='reserve'),'reserved','MAT-01 assigned teacher reserves a durable private upload');
select throws_ok($$select app_private.material_reserve_upload('84000000-0000-4000-8000-000000000001',null,null,null,'Variables','variables.txt','TXT','text/plain',12,repeat('a',64),'material-upload-1','89000000-0000-4000-8000-000000000001')$$,'P0001','REQUEST_IN_PROGRESS','MAT-02 an in-flight replay does not duplicate upload');
select throws_ok($$select app_private.material_confirm_upload(pg_temp.mid('jobId'),pg_temp.mid('uploadToken'))$$,'42501','FORBIDDEN','MAT-03 request actor cannot impersonate internal worker');
select pg_temp.as_material_user(3);
select is((select count(*)::integer from app.sources),0,'MAT-04 student cannot read an unready source');
select throws_ok($$select lease_token from app.material_jobs$$,'42501',null,'MAT-05 lease tokens have no ordinary grant');
select pg_temp.as_material_user(0);
select ok(not app_private.material_confirm_upload(pg_temp.mid('jobId'),null),'MAT-05a missing upload token cannot confirm Storage');
select ok(app_private.material_confirm_upload(pg_temp.mid('jobId'),pg_temp.mid('uploadToken')),'MAT-06 verified Storage receipt becomes a queued durable job');
insert into material_test_state values('job',app_private.material_claim_job());
select is(app_private.material_prepare_generation(pg_temp.mjob('id'),null,'test-profile','synthetic',3,'extract-test','token-test',2,repeat('c',64)),-1,'MAT-06a missing processing token cannot initialize a generation');
select ok(not app_private.material_stage_chunks(pg_temp.mjob('id'),null,pg_temp.mchunk(0)),'MAT-06b missing token cannot stage chunks');
select ok(not app_private.material_publish_job(pg_temp.mjob('id'),null),'MAT-06c missing token cannot publish');
select ok(not app_private.material_fail_job(pg_temp.mjob('id'),null,'FORGED',false),'MAT-06d missing token cannot finish a job');
select is(app_private.material_prepare_generation(pg_temp.mjob('id'),pg_temp.mjob('token'),'test-profile','synthetic',3,'extract-test','token-test',2,repeat('c',64)),0,'MAT-07 empty generation begins at checkpoint zero');
select ok(app_private.material_stage_chunks(pg_temp.mjob('id'),pg_temp.mjob('token'),pg_temp.mchunk(0),'{"inputTokens":10,"model":"synthetic","requestId":"test-request"}'::jsonb),'MAT-08 complete batch and observed usage are durable');
select throws_ok($$select app_private.material_publish_job(pg_temp.mjob('id'),pg_temp.mjob('token'))$$,'23514','INCOMPLETE_GENERATION','MAT-09 incomplete generation cannot be published');
select is(app_private.material_prepare_generation(pg_temp.mjob('id'),pg_temp.mjob('token'),'test-profile','synthetic',3,'extract-test','token-test',2,repeat('c',64)),1,'MAT-10 retry resumes after the stored batch');
select is(app_private.material_prepare_generation(pg_temp.mjob('id'),pg_temp.mjob('token'),'test-profile','other-model',3,'extract-test','token-test',2,repeat('c',64)),-2,'MAT-11 same identifier cannot conceal a different embedding model');
select ok(not app_private.material_stage_chunks(pg_temp.mjob('id'),'89999999-0000-4000-8000-000000000001',pg_temp.mchunk(1)),'MAT-12 stale lease cannot stage');
select pg_temp.as_material_user(3);
select is((select count(*)::integer from app.sources),0,'MAT-13 partial chunks are not an active source');
select is((select count(*)::integer from app.source_chunks),0,'MAT-14 no direct student chunk projection');
select pg_temp.as_material_user(0);
select ok(app_private.material_stage_chunks(pg_temp.mjob('id'),pg_temp.mjob('token'),pg_temp.mchunk(1)),'MAT-15 remaining batch is accepted');
select ok(not app_private.material_publish_job(pg_temp.mjob('id'),null),'MAT-15a missing token cannot activate a complete generation');
select ok(app_private.material_publish_job(pg_temp.mjob('id'),pg_temp.mjob('token')),'MAT-16 complete generation activates atomically');
select ok(not app_private.material_publish_job(pg_temp.mjob('id'),pg_temp.mjob('token')),'MAT-17 duplicate completion is fenced');
select pg_temp.as_material_user(3);
select is((select count(*)::integer from app.sources),1,'MAT-18 enrolled student sees active class source');
select is((app_private.material_content(pg_temp.mid('sourceId'),pg_temp.mid('versionId'))->>'mimeType'),'text/plain','MAT-19 active source download is authorized');
select is((select usage_input_tokens::integer from app.source_index_generations where id=pg_temp.mid('generationId')),10,'MAT-19g checkpoint recovery does not duplicate observed token usage');
select is((select usage_batch_count from app.source_index_generations where id=pg_temp.mid('generationId')),1,'MAT-19h batches without provider usage remain distinguishable');
select throws_ok($$select app_private.material_chunks(pg_temp.mid('sourceId'),pg_temp.mid('versionId'),-1,20)$$,'P0001','RESOURCE_NOT_FOUND','MAT-19a student cannot list pedagogical chunk management');

-- Nine closer decoys would occupy a global top-five result. They must be
-- excluded inside the query before ranking, including a second activity.
reset role;
insert into app.courses(id,organization_id,code,name,academic_period) values('83000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000002','P1','Foreign','2026-2');
insert into app.classes(id,organization_id,course_id,teacher_id,code,name) values('84000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000004','B1','Foreign');
insert into app.exercises(id,organization_id,owner_id) values('86000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002');
insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) values('86100000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000001',1,'Sum','Return sum','module.exports.solve=(a,b)=>a+b;','BEGINNER','81000000-0000-4000-8000-000000000002');
insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) values('82000000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','visible',0,'visible','[1,2]','3');
update app.exercises set current_version_id='86100000-0000-4000-8000-000000000001' where id='86000000-0000-4000-8000-000000000001';
insert into app.activities(id,organization_id,class_id,created_by,title,type) values('87000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','Other activity','FORMATIVE');
insert into app.activity_exercises(organization_id,activity_id,exercise_version_id,position)
select '82000000-0000-4000-8000-000000000001',('87000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'86100000-0000-4000-8000-000000000001',0 from generate_series(1,2)n;
update app.activities set state='PUBLISHED' where id in('87000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000002');
insert into app.sources(id,organization_id,class_id,activity_id,owner_id,title) values
('88000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000003',null,'81000000-0000-4000-8000-000000000004','Foreign organization'),
('88000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000002',null,'81000000-0000-4000-8000-000000000005','Foreign class'),
('88000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002','Foreign activity');
insert into app.source_versions(id,organization_id,source_id,version,storage_object_key,original_name,format,mime_type,size_bytes,content_hash,created_by)
select ('88100000-0000-4000-8000-'||right(id::text,12))::uuid,organization_id,id,1,'fixture/'||id,'decoy.txt','TXT','text/plain',10,repeat('d',64),owner_id from app.sources where id::text like '88000000-%';
insert into app.source_index_generations(id,organization_id,source_id,source_version_id,generation_number,index_status,configuration_id,embedding_model,embedding_dimension,chunk_count,indexed_at)
select ('88200000-0000-4000-8000-'||right(id::text,12))::uuid,organization_id,source_id,id,1,'READY','test-profile','synthetic',3,3,now() from app.source_versions where id::text like '88100000-%';
insert into app.source_chunks(organization_id,source_id,source_version_id,generation_id,chunk_index,text,token_count,locator,content_hash,embedding)
select organization_id,source_id,source_version_id,id,n,'Closer decoy',4,'Fixture',repeat('e',64),'[1,0,0]'::extensions.vector from app.source_index_generations cross join generate_series(0,2)n where id::text like '88200000-%';
update app.source_versions set current_generation_id=('88200000-0000-4000-8000-'||right(id::text,12))::uuid where id::text like '88100000-%';
update app.sources set current_version_id=('88100000-0000-4000-8000-'||right(id::text,12))::uuid where id::text like '88000000-%';
set local role alunza_app;
select pg_temp.as_material_user(3);
select is((select count(*)::integer from app_private.material_retrieve('84000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','test-profile',3,'[1,0,0]'::extensions.vector)),2,'MAT-19b nine closer out-of-scope chunks cannot displace authorized results');
select ok((select bool_and(source_id=pg_temp.mid('sourceId')) from app_private.material_retrieve('84000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','test-profile',3,'[1,0,0]'::extensions.vector)),'MAT-19c source scope is filtered before distance ranking');
select is((select count(*)::integer from app_private.material_retrieve('84000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','other-config',3,'[1,0,0]'::extensions.vector)),0,'MAT-19d incompatible configuration is never ranked');
select pg_temp.as_material_user(2);
select is((app_private.material_chunks(pg_temp.mid('sourceId'),pg_temp.mid('versionId'),-1,1)->'page'->>'nextCursor'),'0','MAT-19e authorized chunk page uses stable index cursor');
select is((app_private.material_chunks(pg_temp.mid('sourceId'),pg_temp.mid('versionId'),0,1)->'data'->0->>'index'),'1','MAT-19f next page preserves chunk ordering');
reset role;
-- Remove only these explicitly identified adversarial fixture rows; the outer
-- transaction restores the database after the entire SQL file.
update app.sources set current_version_id=null where id::text like '88000000-%';
update app.source_versions set current_generation_id=null where id::text like '88100000-%';
delete from app.source_chunks where generation_id::text like '88200000-%';
delete from app.source_index_generations where id::text like '88200000-%';
delete from app.source_versions where id::text like '88100000-%';
delete from app.sources where id::text like '88000000-%';
update app.activities set state='CLOSED' where id in('87000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000002');
set local role alunza_app;
select pg_temp.as_material_user(4);
select is((select count(*)::integer from app.sources),0,'MAT-20 foreign organization sees no source');
select pg_temp.as_material_user(5);
select is((select count(*)::integer from app.sources),0,'MAT-21 unassigned teacher sees no source');
select pg_temp.as_material_user(2);
select throws_ok($$select app_private.material_reindex(pg_temp.mid('sourceId'),null,2,'material-index-1','89000000-0000-4000-8000-000000000001')$$,'42501','FORBIDDEN','MAT-22 teacher cannot reindex a READY source');
select pg_temp.as_material_user(1);
insert into material_test_state values('reindex',app_private.material_reindex(pg_temp.mid('sourceId'),null,2,'material-index-2','89000000-0000-4000-8000-000000000001'));
reset role;
update app.operation_keys set response_body=null where operation='material.reindex' and resource_id=pg_temp.mid('sourceId');
set local role alunza_app;
select pg_temp.as_material_user(1);
select is(app_private.material_reindex(pg_temp.mid('sourceId'),null,2,'material-index-2','89000000-0000-4000-8000-000000000001')->>'jobId',(select value->>'jobId' from material_test_state where kind='reindex'),'MAT-22a expired cached response reconstructs the same durable job without repeating work');
select throws_ok($$select app_private.material_reindex(pg_temp.mid('sourceId'),pg_temp.mid('versionId'),2,'material-index-2','89000000-0000-4000-8000-000000000001')$$,'P0001','IDEMPOTENCY_CONFLICT','MAT-23 reindex payload includes requested version');
select pg_temp.as_material_user(0);
update material_test_state set value=app_private.material_claim_job() where kind='job';
select ok(app_private.material_fail_job(pg_temp.mjob('id'),pg_temp.mjob('token'),'PROVIDER_UNAVAILABLE',false),'MAT-24 failed reindex terminates durably');
select pg_temp.as_material_user(3);
select is((select count(*)::integer from app.sources),1,'MAT-25 failed reindex preserves the valid generation');
select pg_temp.as_material_user(1);
select ok(app_private.material_govern(pg_temp.mid('sourceId'),2,'HIDDEN',false,'89000000-0000-4000-8000-000000000001'),'MAT-26 ADMIN hides source');
select pg_temp.as_material_user(3);
select is((select count(*)::integer from app.sources),0,'MAT-27 hiding removes student access immediately');
select throws_ok($$select app_private.material_content(pg_temp.mid('sourceId'),pg_temp.mid('versionId'))$$,'P0001','RESOURCE_NOT_FOUND','MAT-28 old download reference cannot bypass visibility');
select pg_temp.as_material_user(1);
-- Academic writes require the resolved organization context; an empty context
-- deliberately updates no rows under RLS and cannot exercise the archive guard.
select set_config('app.organization_id','82000000-0000-4000-8000-000000000001',true);
select ok(app_private.can_admin('82000000-0000-4000-8000-000000000001'),'MAT-28a archive fixture uses an authorized ADMIN write context');
select throws_ok($$update app.classes set archived_at=now() where id='84000000-0000-4000-8000-000000000001'$$,'P0001','DEPENDENCIES_ACTIVE','MAT-29 live source blocks class archive');
select ok(app_private.material_govern(pg_temp.mid('sourceId'),3,null,true,'89000000-0000-4000-8000-000000000001','Retirar material','material-archive-1'),'MAT-30 archive is durable');
select ok(app_private.material_govern(pg_temp.mid('sourceId'),3,null,true,'89000000-0000-4000-8000-000000000001','Retirar material','material-archive-1'),'MAT-31 same archive key does not require a fresh revision');
select is((select count(*)::integer from app.audit_events where action='material.archived'),1,'MAT-32 archive replay creates no extra audit effect');
select throws_ok($$select app_private.material_content(pg_temp.mid('sourceId'),pg_temp.mid('versionId'))$$,'P0001','RESOURCE_NOT_FOUND','MAT-33 archival revokes content even for governor');
select is((select count(*)::integer from app.source_versions),1,'MAT-34 archival preserves binary version metadata');
select * from finish();
rollback;
