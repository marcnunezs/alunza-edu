begin;
grant alunza_app to postgres;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to alunza_app;
do $$ declare routine regprocedure; begin
  for routine in select p.oid::regprocedure from pg_proc p
    join pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid
    join pg_extension e on d.refclassid='pg_extension'::regclass and e.oid=d.refobjid
    where e.extname='pgtap'
  loop execute format('grant execute on function %s to alunza_app',routine); end loop;
end $$;
set local search_path=public,extensions;
select no_plan();
set local app.actor_id=''; set local app.session_id=''; set local app.organization_id='';

-- All data is fictional and scoped to this rolled-back transaction.
insert into auth.users(id,email,email_confirmed_at)
select ('61000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'academic-'||n||'@alunza.test',now()
from generate_series(1,6) n;
insert into auth.sessions(id,user_id)
select ('62000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('61000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
from generate_series(1,6) n;
insert into app.profiles(id,display_name,email_normalized,account_state)
select ('61000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Academic '||n,'academic-'||n||'@alunza.test','ACTIVE'
from generate_series(1,6) n;
insert into app.organizations(id,code,name) values
('63000000-0000-4000-8000-000000000001','ACADEMIC-ONE','Academic one'),
('63000000-0000-4000-8000-000000000002','ACADEMIC-TWO','Academic two');
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at)
select '63000000-0000-4000-8000-000000000001',('61000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  case when n=1 then 'ADMIN' when n in (2,3) then 'TEACHER' else 'STUDENT' end,'ACTIVE',now()
from generate_series(1,5) n;
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at) values
('63000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000006','STUDENT','ACTIVE',now());
insert into app.courses(id,organization_id,code,name,academic_period) values
('64000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','JS','JavaScript','2026-2'),
('64000000-0000-4000-8000-000000000002','63000000-0000-4000-8000-000000000002','JS','JavaScript other','2026-2');
insert into app.classes(id,organization_id,course_id,teacher_id,code,name) values
('65000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002','A','Class A'),
('65000000-0000-4000-8000-000000000002','63000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003','B','Class B');
insert into app.class_memberships(organization_id,class_id,user_id) values
('63000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000004');
insert into app.class_join_codes(id,organization_id,class_id,token_digest,expires_at,created_by) values
('66000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '7 days','61000000-0000-4000-8000-000000000002');
insert into app.class_join_codes(id,organization_id,class_id,token_digest,created_at,expires_at,created_by) values
('66000000-0000-4000-8000-000000000002','63000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001',repeat('b',64),now()-interval '8 days',now()-interval '1 day','61000000-0000-4000-8000-000000000002');
insert into app.concepts(id,organization_id,normalized_name) values
('67000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','variables'),
('67000000-0000-4000-8000-000000000002','63000000-0000-4000-8000-000000000001','functions');
insert into app.concept_versions(id,organization_id,concept_id,version,name,created_by,parent_concept_id) values
('68000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000001',1,'Variables','61000000-0000-4000-8000-000000000001',null),
('68000000-0000-4000-8000-000000000002','63000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000002',1,'Functions','61000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000001');
update app.concepts set current_version_id='68000000-0000-4000-8000-000000000001' where id='67000000-0000-4000-8000-000000000001';
update app.concepts set current_version_id='68000000-0000-4000-8000-000000000002' where id='67000000-0000-4000-8000-000000000002';
insert into app.exercises(id,organization_id,owner_id,visibility) values
('69000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002','ORGANIZATION');
insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) values
('70000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000001',1,'Sum','Return a sum','function solve(a,b) { return a+b; }','BASIC','61000000-0000-4000-8000-000000000002');
insert into app.exercise_version_concepts(organization_id,exercise_version_id,concept_id,concept_version_id) values
('63000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000001');
insert into app_private.exercise_tests(organization_id,exercise_version_id,position,visibility,args,expected) values
('63000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',0,'VISIBLE','[1,2]','3'),
('63000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',1,'HIDDEN','[123,456]','579');
update app.exercises set current_version_id='70000000-0000-4000-8000-000000000001' where id='69000000-0000-4000-8000-000000000001';
insert into app.activities(id,organization_id,class_id,title,type,created_by) values
('71000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','Published activity','FORMATIVE','61000000-0000-4000-8000-000000000002'),
('71000000-0000-4000-8000-000000000002','63000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','Empty draft','FORMATIVE','61000000-0000-4000-8000-000000000002');
insert into app.activity_exercises(organization_id,activity_id,exercise_version_id,position,required) values
('63000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',0,true);
update app.activities set state='PUBLISHED' where id='71000000-0000-4000-8000-000000000001';
set constraints all immediate;
set constraints all deferred;

select ok(not has_schema_privilege('anon','app_private','USAGE'),'Anonymous role cannot enter private schema');
select ok(not has_table_privilege('authenticated','app_private.exercise_tests','SELECT'),'Browser authenticated role cannot directly read tests');
select ok(not has_function_privilege('authenticated','app_private.preview_class_join_code(text)','EXECUTE'),'Join preview is not a public RPC');
select ok(not has_table_privilege('alunza_app','app.exercise_versions','UPDATE'),'Runtime cannot update version rows');
select ok(not has_table_privilege('alunza_app','app_private.exercise_tests','UPDATE'),'Runtime cannot modify tests');
select ok(not has_table_privilege('alunza_app','app.classes','DELETE'),'Runtime cannot delete class history');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('app.courses'::regclass,'app.classes'::regclass,'app.class_memberships'::regclass,'app.concepts'::regclass,'app.exercise_versions'::regclass,'app_private.exercise_tests'::regclass,'app.activities'::regclass)),'Academic tables enforce RLS including the owner');

set local role alunza_app;
set local app.actor_id='61000000-0000-4000-8000-000000000004';
set local app.session_id='62000000-0000-4000-8000-000000000004';
set local app.organization_id='63000000-0000-4000-8000-000000000001';
select is(app_private.academic_role('63000000-0000-4000-8000-000000000001'),'STUDENT','Student role uses current institutional membership and session');
select is((select count(*)::integer from app.classes),1,'Student sees only enrolled class');
select is((select count(*)::integer from app.activities),1,'Student sees publication but not draft');
select is((select count(*)::integer from app_private.exercise_tests where visibility='VISIBLE'),1,'Student SQL sees the visible test of assigned version');
select is((select count(*)::integer from app_private.exercise_tests where visibility='HIDDEN'),0,'Student SQL cannot read hidden tests even bypassing API projection');
select is((select count(*)::integer from app.class_join_codes),0,'Student cannot list code digests');
select is((select count(*)::integer from app_private.preview_class_join_code(repeat('a',64))),1,'Digest proof allows scoped join preview');
select ok((select already_enrolled from app_private.preview_class_join_code(repeat('a',64))),'Join preview identifies existing membership');
select is((select count(*)::integer from app_private.preview_class_join_code(repeat('b',64))),0,'Expired digest does not reveal a class');
select throws_ok($$insert into app.courses(organization_id,code,name,academic_period) values ('63000000-0000-4000-8000-000000000001','ILLEGAL','Illegal','2026')$$,'42501',null,'Student cannot create academic structure');
set local app.session_id='62000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from app.classes),0,'Another real session cannot be substituted for actor session');
set local app.session_id='62000000-0000-4000-8000-000000000004';
set local app.organization_id='63000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from app.exercise_versions),0,'Changing context cannot read another organization');

set local app.actor_id='61000000-0000-4000-8000-000000000006';
set local app.session_id='62000000-0000-4000-8000-000000000006';
select is((select count(*)::integer from app_private.preview_class_join_code(repeat('a',64))),0,'Code from another institution reveals nothing');
select is(app_private.academic_resource_org('exercise','69000000-0000-4000-8000-000000000001'),null::uuid,'Resource resolver does not disclose foreign organization');

set local app.organization_id='63000000-0000-4000-8000-000000000001';
set local app.actor_id='61000000-0000-4000-8000-000000000005';
set local app.session_id='62000000-0000-4000-8000-000000000005';
select is((select count(*)::integer from app.activities),0,'Unenrolled peer cannot read class publications');
select throws_ok($$insert into app.class_memberships(organization_id,class_id,user_id) values ('63000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005')$$,'P0001','JOIN_CODE_INVALID','Enrollment without digest proof fails');
select set_config('app.class_join_digest',repeat('a',64),true);
select lives_ok($$insert into app.class_memberships(organization_id,class_id,user_id) values ('63000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005') returning id$$,'Valid collective code creates and returns a membership under runtime RLS');
select lives_ok($$insert into app.class_memberships(organization_id,class_id,user_id) values ('63000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005') on conflict (organization_id,class_id,user_id) do nothing$$,'Duplicate enrollment is harmless');
select is((select count(*)::integer from app.class_memberships where user_id=app_private.actor_id()),1,'Enrollment remains unique');
select is((select count(*)::integer from app_private.exercise_tests),1,'Newly enrolled student receives visible tests only');

set local app.actor_id='61000000-0000-4000-8000-000000000002';
set local app.session_id='62000000-0000-4000-8000-000000000002';
select is((select uses_count from app.class_join_codes where id='66000000-0000-4000-8000-000000000001'),1,'Only an effective enrollment increments the collective code counter');
select is((select count(*)::integer from app.classes),1,'Teacher sees own class, not peer class');
select lives_ok($$insert into app.classes(organization_id,course_id,teacher_id,code,name) values ('63000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002','C','Class created through runtime') returning id$$,'Teacher creates own class with INSERT RETURNING and immediate SELECT authorization');
select is((select count(*)::integer from app_private.exercise_tests),2,'Owner teacher reads full test definition');
select lives_ok($$select app_private.lock_academic_organization('63000000-0000-4000-8000-000000000001')$$,'Teacher can serialize academic write without UPDATE privilege on organization');
select throws_ok($$update app.classes set teacher_id='61000000-0000-4000-8000-000000000003' where id='65000000-0000-4000-8000-000000000001'$$,'42501','FORBIDDEN','Teacher cannot reassign class');
select throws_ok($$update app.classes set archived_at=now() where id='65000000-0000-4000-8000-000000000001'$$,'42501','FORBIDDEN','Teacher cannot perform administrator class archival');
select throws_ok($$update app.activities set state='PUBLISHED' where id='71000000-0000-4000-8000-000000000002'$$,'23514','ACTIVITY_EMPTY','Empty activity cannot publish');
select lives_ok($$insert into app.activities(organization_id,class_id,title,type,created_by) values ('63000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','Draft with immediate projection','FORMATIVE','61000000-0000-4000-8000-000000000002') returning id$$,'Teacher receives new DRAFT activity through INSERT RETURNING');
select throws_ok($$update app.activities set instructions='Changed after publication' where id='71000000-0000-4000-8000-000000000001'$$,'23514','IMMUTABLE_PUBLICATION','Published definition cannot be overwritten');
with removed as (delete from app.activity_exercises where activity_id='71000000-0000-4000-8000-000000000001' returning id)
select is((select count(*)::integer from removed),0,'DELETE permission cannot remove assignments from a published activity');
select throws_ok($$insert into app_private.exercise_tests(organization_id,exercise_version_id,position,visibility,args,expected) values ('63000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',2,'VISIBLE','[9,9]','18')$$,'23514','IMMUTABLE_VERSION','Finalized version cannot acquire new tests');
select throws_ok($$update app.exercise_versions set title='Overwritten' where id='70000000-0000-4000-8000-000000000001'$$,'42501',null,'Runtime cannot overwrite even its own version');

set local app.actor_id='61000000-0000-4000-8000-000000000003';
set local app.session_id='62000000-0000-4000-8000-000000000003';
select is((select count(*)::integer from app.activities),0,'Another teacher cannot read class activities');
select is((select count(*)::integer from app_private.exercise_tests),0,'Shared bank metadata does not expose private authoring tests to another teacher');
with changed as (update app.exercises set visibility='PRIVATE' where id='69000000-0000-4000-8000-000000000001' returning id)
select is((select count(*)::integer from changed),0,'Another teacher cannot edit ownership/visibility');

set local app.actor_id='61000000-0000-4000-8000-000000000001';
set local app.session_id='62000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from app_private.exercise_tests),0,'Administrator cannot read pedagogical tests by governance role');
select is((select count(*)::integer from app.classes),3,'Administrator can govern own institutional class metadata including teacher-created class');
select lives_ok($$update app.courses set description=repeat('x',10000) where id='64000000-0000-4000-8000-000000000001'$$,'Description limit matches the 10000-character API contract');
select lives_ok($$insert into app.class_join_codes(id,organization_id,class_id,token_digest,expires_at,created_by) values ('66000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000002',repeat('c',64),now()+interval '7 days','61000000-0000-4000-8000-000000000001')$$,'Administrator may issue a code without obtaining teacher publication permissions');
select lives_ok($$update app.class_join_codes set revoked_at=now() where id='66000000-0000-4000-8000-000000000003'$$,'Administrator can revoke incorporation code');
with changed as (update app.activities set state='CLOSED' where id='71000000-0000-4000-8000-000000000001' returning id)
select is((select count(*)::integer from changed),0,'Administrator role does not grant teacher publication mutations');
select throws_ok($$update app.classes set archived_at=now() where id='65000000-0000-4000-8000-000000000001'$$,'P0001','DEPENDENCIES_ACTIVE','PUBLISHED activity blocks class archival');
select throws_ok($$update app.courses set archived_at=now() where id='64000000-0000-4000-8000-000000000001'$$,'P0001','DEPENDENCIES_ACTIVE','Active class blocks course archival');
select throws_ok($$update app.organizations set archived_at=now(),archived_by='61000000-0000-4000-8000-000000000001',archive_reason='Test' where id='63000000-0000-4000-8000-000000000001'$$,'P0001','DEPENDENCIES_ACTIVE','Academic dependencies block organization archival');
select throws_ok($$insert into app.concepts(organization_id,normalized_name) values ('63000000-0000-4000-8000-000000000001','variables')$$,'23505',null,'Concept name is unique after normalization');
insert into app.concept_versions(id,organization_id,concept_id,version,name,parent_concept_id,created_by) values
('68000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000001',2,'Variables','67000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001');
select throws_ok($$update app.concepts set current_version_id='68000000-0000-4000-8000-000000000003' where id='67000000-0000-4000-8000-000000000001'$$,'23514','CONCEPT_CYCLE','Indirect concept cycle is rejected at activation');
select lives_ok($$update app.concepts set archived_at=now() where id='67000000-0000-4000-8000-000000000001'$$,'Concept with historical use is archived without deleting its version');
select is((select count(*)::integer from app.concept_versions where concept_id='67000000-0000-4000-8000-000000000001'),2,'Archival preserves historical concept versions');

set local app.actor_id='61000000-0000-4000-8000-000000000004';
set local app.session_id='62000000-0000-4000-8000-000000000004';
select is((select count(*)::integer from app.exercise_versions),1,'Archiving concept preserves already published student content');
select is((select name from app.concept_versions where id='68000000-0000-4000-8000-000000000001'),'Variables','Student still reads pinned historical concept label');

set local app.actor_id='61000000-0000-4000-8000-000000000002';
set local app.session_id='62000000-0000-4000-8000-000000000002';
insert into app.activity_exercises(organization_id,activity_id,exercise_version_id,position) values
('63000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000001',0);
select throws_ok($$update app.activities set state='PUBLISHED' where id='71000000-0000-4000-8000-000000000002'$$,'23514','PUBLICATION_CONTENT_UNAVAILABLE','Archived concept blocks publishing even an existing draft');
with removed as (delete from app.activity_exercises where activity_id='71000000-0000-4000-8000-000000000002' returning id)
select is((select count(*)::integer from removed),1,'The owning teacher may replace assignments while an activity is still DRAFT');
select lives_ok($$update app.activities set state='CLOSED' where id='71000000-0000-4000-8000-000000000001'$$,'Current teacher closes activity');
select throws_ok($$update app.activities set state='PUBLISHED' where id='71000000-0000-4000-8000-000000000001'$$,'23514','IMMUTABLE_PUBLICATION','Closed activity cannot reopen');
update app.exercises set visibility='PRIVATE' where id='69000000-0000-4000-8000-000000000001';

set local app.actor_id='61000000-0000-4000-8000-000000000001';
set local app.session_id='62000000-0000-4000-8000-000000000001';
select lives_ok($$update app.classes set teacher_id='61000000-0000-4000-8000-000000000003' where id='65000000-0000-4000-8000-000000000001'$$,'Administrator can reassign an active teacher');
set local app.actor_id='61000000-0000-4000-8000-000000000003';
set local app.session_id='62000000-0000-4000-8000-000000000003';
select is((select count(*)::integer from app.exercise_versions where id='70000000-0000-4000-8000-000000000001'),1,'Newly assigned teacher retains reading of pinned PRIVATE version in class history');
select is((select count(*)::integer from app_private.exercise_tests where visibility='HIDDEN'),0,'Class reassignment does not grant authorship of private hidden tests');
set local app.actor_id='61000000-0000-4000-8000-000000000001';
set local app.session_id='62000000-0000-4000-8000-000000000001';
update app.organization_memberships set state='DISABLED' where organization_id='63000000-0000-4000-8000-000000000001' and user_id='61000000-0000-4000-8000-000000000003';
select lives_ok($$update app.classes set archived_at=now() where id='65000000-0000-4000-8000-000000000001'$$,'Administrator archives class without PUBLISHED activities even when its assigned teacher is disabled');
select ok((select revoked_at is not null from app.class_join_codes where id='66000000-0000-4000-8000-000000000001'),'Class archival revokes collective code atomically');
select throws_ok($$update app.classes set name='Changed archived class' where id='65000000-0000-4000-8000-000000000001'$$,'P0001','RESOURCE_ARCHIVED','Archived class is immutable');
set local app.actor_id='61000000-0000-4000-8000-000000000004';
set local app.session_id='62000000-0000-4000-8000-000000000004';
select is((select count(*)::integer from app.activities),0,'CLOSED is excluded from student catalog; future own attempt history is a separate authorization');
select is((select count(*)::integer from app_private.exercise_tests),0,'CLOSED content cannot be obtained through SQL to start a new resolution');
select is((select count(*)::integer from app_private.preview_class_join_code(repeat('a',64))),0,'Archived class cannot be previewed for incorporation');
reset role;
select throws_ok($$update app.concept_versions set description='Rewritten' where id='68000000-0000-4000-8000-000000000001'$$,'23514','IMMUTABLE_VERSION','Version immutability also survives privileged SQL');
select * from finish();
rollback;
