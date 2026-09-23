begin;
grant alunza_app to postgres;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to alunza_app;
do $$ declare r regprocedure; begin
 for r in select p.oid::regprocedure from pg_proc p join pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid join pg_extension e on d.refclassid='pg_extension'::regclass and e.oid=d.refobjid where e.extname='pgtap'
 loop execute format('grant execute on function %s to alunza_app',r); end loop;
end $$;
set local search_path=public,extensions;
select plan(57);
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
insert into app.activity_exercises(organization_id,activity_id,exercise_version_id,position) values('92000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000001',0);
update app.activities set state='PUBLISHED' where id='97000000-0000-4000-8000-000000000001';
set constraints all immediate;

select ok(not has_schema_privilege('authenticated','app','usage'),'No browser domain schema access');
select ok(not has_table_privilege('authenticated','app_private.exercise_tests','select'),'No browser hidden tests access');
select ok((select not rolbypassrls and not rolcanlogin from pg_roles where rolname='alunza_identity'),'Helper has no login or RLS bypass');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relrowsecurity and c.relforcerowsecurity and ((n.nspname='app' and c.relname in ('courses','course_teacher_grants','classes','class_memberships','class_join_codes','concept_tags','concept_versions','exercises','exercise_versions','exercise_version_concepts','activities','activity_exercises')) or (n.nspname='app_private' and c.relname='exercise_tests'))),13,'All academic tables including private tests force RLS');
select ok((select bool_and(not has_table_privilege('alunza_app',format('%I.%I',schemaname,tablename),'TRUNCATE,REFERENCES,TRIGGER') and (tablename='activity_exercises' or not has_table_privilege('alunza_app',format('%I.%I',schemaname,tablename),'DELETE'))) from pg_tables where schemaname in ('app','app_private')),'Only draft-item deletion is granted; no truncation, FK or trigger authority');
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
set local app.organization_id='';
select is((select count(*)::integer from app.classes),1,'Student only sees enrolled class when bootstrapping context');
select is((select count(*)::integer from app.activities),1,'Student cannot see draft');
select is((select count(*)::integer from app.exercise_versions),1,'Assigned public version available');
select is((select count(*)::integer from app_private.exercise_tests),1,'Only visible test returned');
select is((select count(*)::integer from app_private.exercise_tests where visibility='hidden'),0,'Hidden tests inaccessible by direct runtime SQL');
select is((select count(*)::integer from app.exercises),0,'Student does not obtain bank');
select is((select count(*)::integer from app.class_join_codes),0,'Student cannot list digests');
select is((select count(*)::integer from app_private.resolve_join_code(repeat('a',64))),1,'Valid own-organization code can be previewed');
select is((select count(*)::integer from app_private.resolve_join_code(repeat('b',64))),0,'Foreign code cannot reveal class');
set local app.organization_id='92000000-0000-4000-8000-000000000001';
select throws_ok($$insert into app.class_memberships(organization_id,class_id,user_id) values('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003')$$,'42501',null,'Membership needs actual code proof');
select set_config('app.join_code_digest',repeat('a',64),true);
select lives_ok($$insert into app.class_memberships(organization_id,class_id,user_id) values('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003') returning *$$,'Code creates membership and returns the authorized new row');
select throws_ok($$insert into app.class_memberships(organization_id,class_id,user_id) values('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003')$$,'23505',null,'Database prevents duplicate enrollment');
with changed as(update app.organizations set name='Forbidden' where id='92000000-0000-4000-8000-000000000001' returning id) select is((select count(*)::integer from changed),0,'Enrollment never grants organization UPDATE');
select ok(not has_table_privilege(current_user,'app_private.exercise_tests','update'),'Runtime cannot mutate canonical tests');

set local app.actor_id='91000000-0000-4000-8000-000000000002';
set local app.session_id='91100000-0000-4000-8000-000000000002';
select is((select count(*)::integer from app.classes),1,'Teacher cannot read other teacher class');
select is((select count(*)::integer from app_private.exercise_tests),2,'Author reads full definition');
select throws_ok($$insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) values('92000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000001','later',2,'visible','[3,3]','6')$$,'23514','IMMUTABLE_VERSION','Published version cannot acquire additional tests');
insert into app.activity_exercises(organization_id,activity_id,exercise_version_id,position) values('92000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000002','96100000-0000-4000-8000-000000000001',0);
with removed as(delete from app.activity_exercises where activity_id='97000000-0000-4000-8000-000000000002' returning id) select is((select count(*)::integer from removed),1,'Authorized teacher can replace draft exercise list');
with removed as(delete from app.activity_exercises where activity_id='97000000-0000-4000-8000-000000000001' returning id) select is((select count(*)::integer from removed),0,'RLS prevents removal of published exercise list');
select lives_ok($$select app_private.lock_academic_organization('92000000-0000-4000-8000-000000000001')$$,'Teacher can serialize without institutional UPDATE');
select lives_ok($$insert into app.classes(organization_id,course_id,teacher_id,code,name) values('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','A3','Created by authorized teacher') returning *$$,'Granted teacher creates own class and returns the authorized new row');
select lives_ok($sql$do $body$ declare created_id uuid; begin
set constraints all deferred;
insert into app.exercises(id,organization_id,owner_id) values('96000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002') returning id into created_id;
insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) values('96100000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001',created_id,1,'New definition','Return sum','module.exports.solve=(a,b)=>a+b;','BEGINNER','91000000-0000-4000-8000-000000000002') returning id into created_id;
insert into app.exercise_version_concepts values('92000000-0000-4000-8000-000000000001',created_id,'95100000-0000-4000-8000-000000000001');
insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) values('92000000-0000-4000-8000-000000000001',created_id,'visible',0,'visible','[3,3]','6');
update app.exercises set current_version_id=created_id where id='96000000-0000-4000-8000-000000000002';
set constraints all immediate;
end $body$ $sql$,'Author creates exercise and immutable version with INSERT RETURNING');
set constraints all deferred;
insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) values('96100000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002',2,'JSON boundaries','Accept compact JSON','module.exports.solve=()=>null;','BEGINNER','91000000-0000-4000-8000-000000000002');
insert into app.exercise_version_concepts values('92000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000003','95100000-0000-4000-8000-000000000001');
select lives_ok($$insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) values('92000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000003','json-boundary',0,'visible',('['||repeat('0,',32766)||'0]')::json,to_json(repeat('x',65534)))$$,'JSON preserves compact 65535-byte args and 65536-byte expected value');
select throws_ok($$insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) values('92000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000003','args-too-large',1,'hidden',('['||repeat('0,',32767)||'0]')::json,'null')$$,'23514',null,'JSON arguments above 65536 bytes are rejected');
select throws_ok($$insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) values('92000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000003','expected-too-large',1,'hidden','[]',to_json(repeat('x',65535)))$$,'23514',null,'JSON expected value above 65536 bytes is rejected');
select lives_ok($$insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) values('92000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000003','exponent-boundary',1,'hidden',('['||repeat('1e+308,',8999)||'1e+308]')::json,'1e-308')$$,'JSON exponent notation does not consume expanded numeric-text byte limits');
update app.exercises set current_version_id='96100000-0000-4000-8000-000000000003' where id='96000000-0000-4000-8000-000000000002';
set constraints all immediate;
select throws_ok($sql$do $body$ begin
set constraints all deferred;
insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) values('96100000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002',3,'Contradiction','Same input differs','module.exports.solve=()=>1;','BEGINNER','91000000-0000-4000-8000-000000000002');
insert into app.exercise_version_concepts values('92000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000004','95100000-0000-4000-8000-000000000001');
insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) values
('92000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000004','a',0,'visible','[{"a":1e0,"b":2}]','1'),
('92000000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000004','b',1,'hidden','[{"b":2,"a":1.0}]','2');
set constraints all immediate;
end $body$ $sql$,'23514','INCONSISTENT_TESTS','Contradiction comparison ignores object key order and numeric spelling');
select lives_ok($$insert into app.activities(id,organization_id,class_id,created_by,title,type) values('97000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','New draft','FORMATIVE') returning *$$,'Assigned teacher creates draft and returns the authorized new row');
select throws_ok($$update app.classes set teacher_id='91000000-0000-4000-8000-000000000005' where id='94000000-0000-4000-8000-000000000001'$$,'42501',null,'Teacher cannot reassign class');
select throws_ok($$update app.activities set title='Changed published' where id='97000000-0000-4000-8000-000000000001'$$,'P0001','INVALID_TRANSITION','Published content is frozen');
select throws_ok($$update app.activities set state='PUBLISHED' where id='97000000-0000-4000-8000-000000000002'$$,'23514','EMPTY_ACTIVITY','Empty draft cannot publish');
set local app.actor_id='91000000-0000-4000-8000-000000000005';
set local app.session_id='91100000-0000-4000-8000-000000000005';
select throws_ok($$insert into app.classes(organization_id,course_id,teacher_id,code,name) values('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000005','A4','Without course grant')$$,'42501',null,'Teacher without course grant cannot create');
select is((select count(*)::integer from app.exercises),0,'Private bank of another teacher inaccessible');
set local app.actor_id='91000000-0000-4000-8000-000000000001';
set local app.session_id='91100000-0000-4000-8000-000000000001';
select is((select count(*)::integer from app.activities),0,'Governance admin gains no teaching visibility');
select is(app_private.academic_teacher_name('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000004'),null::text,'Governance projection cannot reveal foreign teacher profile');
select is((select uses_count from app.class_join_codes where token_digest=repeat('a',64)),1,'Code count increments only on new membership');
select throws_ok($sql$do $body$ begin
set constraints all deferred;
insert into app.concept_tags(id,organization_id,normalized_name) values('95000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','child');
insert into app.concept_versions(id,organization_id,concept_id,version,name,parent_concept_id,created_by) values('95100000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002',1,'Child','95000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001');
update app.concept_tags set current_version_id='95100000-0000-4000-8000-000000000002' where id='95000000-0000-4000-8000-000000000002';
insert into app.concept_versions(id,organization_id,concept_id,version,name,parent_concept_id,created_by) values('95100000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001',2,'Addition','95000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001');
update app.concept_tags set current_version_id='95100000-0000-4000-8000-000000000003' where id='95000000-0000-4000-8000-000000000001';
end $body$ $sql$,'23514','CONCEPT_CYCLE','Indirect concept cycle is rejected in persistence');
update app.concept_tags set archived_at=now() where id='95000000-0000-4000-8000-000000000001';
set local app.actor_id='91000000-0000-4000-8000-000000000002';
set local app.session_id='91100000-0000-4000-8000-000000000002';
select throws_ok($$insert into app.activity_exercises(organization_id,activity_id,exercise_version_id,position) values('92000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000002','96100000-0000-4000-8000-000000000001',0)$$,'P0001','RESOURCE_ARCHIVED','Archived concept prevents new exercise references even in draft');
select lives_ok($$update app.activities set state='CLOSED' where id='97000000-0000-4000-8000-000000000001'$$,'Teacher can close publication using an archived concept');
select throws_ok($$update app.activities set state='PUBLISHED' where id='97000000-0000-4000-8000-000000000001'$$,'P0001','INVALID_TRANSITION','Closed activity cannot reopen');
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
select is((select count(*)::integer from app.exercise_versions where id='96100000-0000-4000-8000-000000000001'),1,'Student retains historical content after concept archive and publication closure');
set local app.actor_id='91000000-0000-4000-8000-000000000001';
set local app.session_id='91100000-0000-4000-8000-000000000001';
select throws_ok($$update app.courses set archived_at=now() where id='93000000-0000-4000-8000-000000000001'$$,'P0001','DEPENDENCIES_ACTIVE','Active class blocks course archive');
select lives_ok($$update app.classes set archived_at=now() where id='94000000-0000-4000-8000-000000000001'$$,'Closed publications allow class archive');
select lives_ok($$update app.course_teacher_grants set revoked_at=now() where teacher_id='91000000-0000-4000-8000-000000000002'$$,'Course grant can be revoked');
set local app.actor_id='91000000-0000-4000-8000-000000000002';
set local app.session_id='91100000-0000-4000-8000-000000000002';
select throws_ok($$insert into app.classes(organization_id,course_id,teacher_id,code,name) values('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','A5','Revoked course')$$,'42501',null,'Revoked grant blocks new classes');
select is((select count(*)::integer from app.classes where code='A3'),1,'Revocation preserves existing class assignment');
reset role;
insert into app.operation_keys(organization_id,actor_id,operation,key,payload_hash,state,resource_type,resource_id,response_status,response_body,expires_at) values
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003','class.enroll','replay-test-key',repeat('f',64),'COMPLETED','class','94000000-0000-4000-8000-000000000002',200,'{"alreadyEnrolled":false}',now()+interval '1 day');
update app.class_join_codes set revoked_at=now() where token_digest=repeat('a',64);
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
select is((select count(*)::integer from app_private.enrollment_replay(repeat('a',64),'replay-test-key')),1,'Lost enrollment response remains recoverable after code rotation');
select is((select count(*)::integer from app_private.enrollment_replay(repeat('a',64),'unknown-key')),0,'Old code without original key cannot create replay authority');
select is((select count(*)::integer from app_private.resolve_join_code(repeat('a',64))),0,'Revoked code does not admit another enrollment');
set local app.actor_id='91000000-0000-4000-8000-000000000002';
set local app.session_id='91100000-0000-4000-8000-000000000002';
select is((select count(*)::integer from app_private.enrollment_replay(repeat('a',64),'replay-test-key')),0,'Replay cannot expose another actor operation');
reset role;
insert into app.class_join_codes(organization_id,class_id,token_digest,expires_at,created_by) values('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002',repeat('c',64),now()+interval '1 day','91000000-0000-4000-8000-000000000005');
update app.class_memberships set ended_at=now() where class_id='94000000-0000-4000-8000-000000000002' and user_id='91000000-0000-4000-8000-000000000003';
set local role alunza_app;
set local app.actor_id='91000000-0000-4000-8000-000000000003';
set local app.session_id='91100000-0000-4000-8000-000000000003';
select is((select count(*)::integer from app_private.resolve_join_code(repeat('c',64))),0,'Ended membership cannot preview even a newly issued valid code');
select set_config('app.join_code_digest',repeat('c',64),true);
select throws_ok($$insert into app.class_memberships(organization_id,class_id,user_id) values('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003') ON CONFLICT DO NOTHING$$,'42501',null,'Ended membership cannot report successful incorporation through conflict suppression');
reset role;
select * from finish();
rollback;
