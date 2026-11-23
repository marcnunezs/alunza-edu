begin;
grant alunza_app to postgres;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to alunza_app;
do $$ declare fn regprocedure; begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid
 join pg_extension e on d.refclassid='pg_extension'::regclass and e.oid=d.refobjid where e.extname='pgtap'
 loop execute format('grant execute on function %s to alunza_app',fn); end loop;
end $$;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at)
 select ('c1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'bank-governance-'||n||'@alunza.test',now() from generate_series(1,8) n;
insert into auth.sessions(id,user_id)
 select ('c1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('c1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,8) n;
insert into app.profiles(id,display_name,email_normalized,account_state)
 select ('c1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Bank governance actor '||n,'bank-governance-'||n||'@alunza.test',case when n=7 then 'DISABLED' else 'ACTIVE' end from generate_series(1,8) n;
insert into app.organizations(id,code,name) values
 ('c2000000-0000-4000-8000-000000000001','BANK-GOV-A','Bank governance A'),
 ('c2000000-0000-4000-8000-000000000002','BANK-GOV-B','Bank governance B');
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at) values
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','ADMIN','ACTIVE',now()),
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','TEACHER','ACTIVE',now()),
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003','STUDENT','ACTIVE',now()),
 ('c2000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000004','ADMIN','ACTIVE',now()),
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000005','TEACHER','ACTIVE',now()),
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000006','TEACHER','DISABLED',now()),
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000007','TEACHER','ACTIVE',now()),
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000008','TEACHER','INVITED',null);
insert into app.courses(id,organization_id,code,name,academic_period) values
 ('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','P1','Programming','2026-2');
insert into app.classes(id,organization_id,course_id,teacher_id,code,name) values
 ('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','G1','Existing publication');
insert into app.class_memberships(organization_id,class_id,user_id) values
 ('c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003');
insert into app.concept_tags(id,organization_id,normalized_name) values
 ('c5000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','addition');
insert into app.concept_versions(id,organization_id,concept_id,version,name,created_by) values
 ('c5100000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001',1,'Addition','c1000000-0000-4000-8000-000000000001');
update app.concept_tags set current_version_id='c5100000-0000-4000-8000-000000000001' where id='c5000000-0000-4000-8000-000000000001';
insert into app.exercises(id,organization_id,owner_id) values
 ('c6000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002');
insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) values
 ('c6100000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000001',1,'Original sum','Return sum','module.exports.solve=(a,b)=>a+b;','BEGINNER','c1000000-0000-4000-8000-000000000002');
insert into app.exercise_version_concepts values
 ('c2000000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000001','c5100000-0000-4000-8000-000000000001');
insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) values
 ('c2000000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000001','visible',0,'visible','[1,2]','3'),
 ('c2000000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000001','hidden',1,'hidden','[2,3]','5');
update app.exercises set current_version_id='c6100000-0000-4000-8000-000000000001' where id='c6000000-0000-4000-8000-000000000001';
insert into app.activities(id,organization_id,class_id,created_by,title,type) values
 ('c7000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','Published before governance','FORMATIVE'),
 ('c7000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','Draft before governance','FORMATIVE');
insert into app.activity_exercises(organization_id,activity_id,exercise_version_id,position) values
 ('c2000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000001',0),
 ('c2000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000002','c6100000-0000-4000-8000-000000000001',0);
update app.activities set state='PUBLISHED' where id='c7000000-0000-4000-8000-000000000001';
set constraints app.provisioning_complete,app.exercise_definition_complete,app.concept_current_version,app.exercise_current_version immediate;

create temp table governance_history(label text primary key,payload jsonb);
insert into governance_history values
 ('version',(select to_jsonb(v) from app.exercise_versions v where id='c6100000-0000-4000-8000-000000000001')),
 ('tests',(select jsonb_agg(to_jsonb(t) order by position) from app_private.exercise_tests t where exercise_version_id='c6100000-0000-4000-8000-000000000001')),
 ('concepts',(select jsonb_agg(to_jsonb(c) order by concept_version_id) from app.exercise_version_concepts c where exercise_version_id='c6100000-0000-4000-8000-000000000001')),
 ('uses',(select jsonb_agg(to_jsonb(a) order by id) from app.activity_exercises a where exercise_version_id='c6100000-0000-4000-8000-000000000001'));

select ok((select pg_get_userbyid(proowner)='alunza_identity' and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid='app_private.guard_exercise_governance_owner()'::regprocedure),'new owner guard uses constrained identity and fixed search path');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role','alunza_app']) r where has_function_privilege(r,'app_private.guard_exercise_governance_owner()','EXECUTE')),'no client role can call the trigger helper');
select ok(not exists(select 1 from unnest(array['app.exercise_versions','app.exercise_version_concepts','app_private.exercise_tests']) t where has_table_privilege('alunza_app',t,'UPDATE,DELETE')),'governance grants no mutation of immutable definitions');

set local role alunza_app;
select set_config('app.actor_id','c1000000-0000-4000-8000-000000000001',true),set_config('app.session_id','c1100000-0000-4000-8000-000000000001',true),set_config('app.organization_id','c2000000-0000-4000-8000-000000000001',true);
select throws_ok($$update app.exercises set owner_id='c1000000-0000-4000-8000-000000000003' where id='c6000000-0000-4000-8000-000000000001'$$,'23514','EXERCISE_OWNER_INVALID','student cannot receive ownership');
select throws_ok($$update app.exercises set owner_id='c1000000-0000-4000-8000-000000000004' where id='c6000000-0000-4000-8000-000000000001'$$,'23514','EXERCISE_OWNER_INVALID','foreign administrator cannot receive ownership');
select throws_ok($$update app.exercises set owner_id='c1000000-0000-4000-8000-000000000006' where id='c6000000-0000-4000-8000-000000000001'$$,'23514','EXERCISE_OWNER_INVALID','disabled membership cannot receive ownership');
select throws_ok($$update app.exercises set owner_id='c1000000-0000-4000-8000-000000000007' where id='c6000000-0000-4000-8000-000000000001'$$,'23514','EXERCISE_OWNER_INVALID','disabled account cannot receive ownership');
select throws_ok($$update app.exercises set owner_id='c1000000-0000-4000-8000-000000000008' where id='c6000000-0000-4000-8000-000000000001'$$,'23514','EXERCISE_OWNER_INVALID','invited membership cannot receive ownership');
select throws_ok($$update app.exercises set visibility='PUBLIC' where id='c6000000-0000-4000-8000-000000000001'$$,'23514',null,'visibility cannot be widened beyond the organization');
select is((select owner_id::text from app.exercises where id='c6000000-0000-4000-8000-000000000001'),'c1000000-0000-4000-8000-000000000002','invalid policies preserve prior owner');
select is((select revision from app.exercises where id='c6000000-0000-4000-8000-000000000001'),2,'invalid policies preserve revision');
select lives_ok($$update app.exercises set owner_id='c1000000-0000-4000-8000-000000000001' where id='c6000000-0000-4000-8000-000000000001'$$,'active same-organization administrator may own an exercise');
select lives_ok($$update app.exercises set owner_id='c1000000-0000-4000-8000-000000000005',visibility='ORGANIZATION' where id='c6000000-0000-4000-8000-000000000001'$$,'ownership and allowed visibility update atomically');
select is((select revision from app.exercises where id='c6000000-0000-4000-8000-000000000001'),4,'one operation advances identity revision once');
select ok(not app_private.academic_exercise_author('c6000000-0000-4000-8000-000000000001'),'administrative version permission does not change teacher authorship');
select is((select count(*) from app.activities where organization_id='c2000000-0000-4000-8000-000000000001'),0::bigint,'administrative governance grants no pedagogical activity access');

select lives_ok($sql$do $body$ begin
 set constraints app.exercise_definition_complete deferred;
 insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) values
 ('c6100000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000001',2,'Administrative revision','Add the two values','module.exports.solve=(a,b)=>a+b;','INTERMEDIATE','c1000000-0000-4000-8000-000000000001');
 insert into app.exercise_version_concepts values ('c2000000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000002','c5100000-0000-4000-8000-000000000001');
 insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) values
 ('c2000000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000002','new-visible',0,'visible','[3,3]','6');
 update app.exercises set current_version_id='c6100000-0000-4000-8000-000000000002' where id='c6000000-0000-4000-8000-000000000001';
 set constraints app.exercise_definition_complete immediate;
end $body$ $sql$,'ADMIN appends a complete definition with new tests and concepts');
select is((select count(*) from app.exercise_versions where exercise_id='c6000000-0000-4000-8000-000000000001'),2::bigint,'new version coexists with the fixed historical version');
select throws_ok($$insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) values
 ('c2000000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000001','forbidden',2,'visible','[0,0]','0')$$,'23514','IMMUTABLE_VERSION','ADMIN cannot append a test to a referenced version');
select throws_ok($sql$do $body$ begin
 set constraints app.exercise_definition_complete deferred;
 insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) values
 ('c6100000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000001',3,'Invalid tests','Conflicting expectations','module.exports.solve=()=>1;','BEGINNER','c1000000-0000-4000-8000-000000000001');
 insert into app.exercise_version_concepts values ('c2000000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000003','c5100000-0000-4000-8000-000000000001');
 insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) values
 ('c2000000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000003','a',0,'visible','[1]','1'),
 ('c2000000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000003','b',1,'hidden','[1]','2');
 update app.exercises set current_version_id='c6100000-0000-4000-8000-000000000003' where id='c6000000-0000-4000-8000-000000000001';
 set constraints app.exercise_definition_complete immediate;
end $body$ $sql$,'23514','INCONSISTENT_TESTS','invalid ADMIN definition rolls back pointer, version, concepts and tests');
select is((select current_version_id::text from app.exercises where id='c6000000-0000-4000-8000-000000000001'),'c6100000-0000-4000-8000-000000000002','rejected definition leaves latest valid pointer intact');
select is((select count(*) from app.exercise_versions where exercise_id='c6000000-0000-4000-8000-000000000001'),2::bigint,'rejected version leaves no row');

select set_config('app.actor_id','c1000000-0000-4000-8000-000000000002',true),set_config('app.session_id','c1100000-0000-4000-8000-000000000002',true);
select ok(app_private.academic_exercise_read('c6000000-0000-4000-8000-000000000001') and not app_private.academic_exercise_author('c6000000-0000-4000-8000-000000000001'),'former owner retains only shared read after transfer');
select throws_ok($$insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) values
 ('c6100000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000001',3,'Forbidden former owner','Definition','module.exports.solve=()=>1;','BEGINNER','c1000000-0000-4000-8000-000000000002')$$,'42501',null,'shared read gives former owner no versioning permission');
select set_config('app.actor_id','c1000000-0000-4000-8000-000000000005',true),set_config('app.session_id','c1100000-0000-4000-8000-000000000005',true);
select ok(app_private.academic_exercise_author('c6000000-0000-4000-8000-000000000001'),'current teacher owner acquires original authorship permission');
select throws_ok($$update app.exercises set visibility='PRIVATE' where id='c6000000-0000-4000-8000-000000000001'$$,'42501','FORBIDDEN','teacher owner cannot change governance visibility');
select throws_ok($$update app.exercises set owner_id='c1000000-0000-4000-8000-000000000002' where id='c6000000-0000-4000-8000-000000000001'$$,'42501','FORBIDDEN','teacher owner cannot transfer ownership');
select set_config('app.actor_id','c1000000-0000-4000-8000-000000000003',true),set_config('app.session_id','c1100000-0000-4000-8000-000000000003',true);
select is((select count(*) from app.exercise_versions where exercise_id='c6000000-0000-4000-8000-000000000001'),1::bigint,'student sees only assigned historical version after administrative versioning');
select is((select count(*) from app_private.exercise_tests where exercise_version_id='c6100000-0000-4000-8000-000000000001' and visibility='hidden'),0::bigint,'student cannot obtain historical hidden tests');
select set_config('app.actor_id','c1000000-0000-4000-8000-000000000004',true),set_config('app.session_id','c1100000-0000-4000-8000-000000000004',true),set_config('app.organization_id','c2000000-0000-4000-8000-000000000002',true);
with changed as(update app.exercises set visibility='PRIVATE' where id='c6000000-0000-4000-8000-000000000001' returning id)
 select is((select count(*) from changed),0::bigint,'foreign ADMIN cannot update exercise identity');
select throws_ok($$insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) values
 ('c6100000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000001',3,'Forbidden foreign admin','Definition','module.exports.solve=()=>1;','BEGINNER','c1000000-0000-4000-8000-000000000004')$$,'42501',null,'foreign ADMIN cannot append a version');

reset role;
update app.organization_memberships set state='DISABLED' where organization_id='c2000000-0000-4000-8000-000000000001' and user_id='c1000000-0000-4000-8000-000000000005';
set local role alunza_app;
select set_config('app.actor_id','c1000000-0000-4000-8000-000000000001',true),set_config('app.session_id','c1100000-0000-4000-8000-000000000001',true),set_config('app.organization_id','c2000000-0000-4000-8000-000000000001',true);
select lives_ok($$update app.exercises set visibility='PRIVATE',owner_id=owner_id where id='c6000000-0000-4000-8000-000000000001'$$,'unchanged inactive historical owner does not block allowed visibility update');
select lives_ok($$update app.exercises set archived_at=now() where id='c6000000-0000-4000-8000-000000000001'$$,'archive preserves active publication and inactive historical ownership');
select throws_ok($$update app.exercises set visibility='ORGANIZATION' where id='c6000000-0000-4000-8000-000000000001'$$,'P0001','RESOURCE_ARCHIVED','archived exercise rejects further governance');
select throws_ok($$insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) values
 ('c6100000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000001',3,'Forbidden after archive','Definition','module.exports.solve=()=>1;','BEGINNER','c1000000-0000-4000-8000-000000000001')$$,'P0001','RESOURCE_ARCHIVED','ADMIN cannot append a version after archive');
select set_config('app.actor_id','c1000000-0000-4000-8000-000000000002',true),set_config('app.session_id','c1100000-0000-4000-8000-000000000002',true);
select throws_ok($$update app.activities set state='PUBLISHED' where id='c7000000-0000-4000-8000-000000000002'$$,'P0001','RESOURCE_ARCHIVED','archive blocks publication of an existing draft reference');
select is((select state from app.activities where id='c7000000-0000-4000-8000-000000000001'),'PUBLISHED','archive leaves prior publication available');
select set_config('app.actor_id','c1000000-0000-4000-8000-000000000003',true),set_config('app.session_id','c1100000-0000-4000-8000-000000000003',true);
select is((select title from app.exercise_versions where id='c6100000-0000-4000-8000-000000000001'),'Original sum','authorized student retains exact prior content after archive and access change');

reset role;
select is((select to_jsonb(v) from app.exercise_versions v where id='c6100000-0000-4000-8000-000000000001'),(select payload from governance_history where label='version'),'historical version is byte-equivalent as JSON before and after governance');
select is((select jsonb_agg(to_jsonb(t) order by position) from app_private.exercise_tests t where exercise_version_id='c6100000-0000-4000-8000-000000000001'),(select payload from governance_history where label='tests'),'historical visible and hidden tests are unchanged');
select is((select jsonb_agg(to_jsonb(c) order by concept_version_id) from app.exercise_version_concepts c where exercise_version_id='c6100000-0000-4000-8000-000000000001'),(select payload from governance_history where label='concepts'),'historical concept versions are unchanged');
select is((select jsonb_agg(to_jsonb(a) order by id) from app.activity_exercises a where exercise_version_id='c6100000-0000-4000-8000-000000000001'),(select payload from governance_history where label='uses'),'all prior assignment identities and version references are unchanged');
select * from finish();
rollback;
