begin;
-- Fixtures, reference helper and temporary grants are rolled back together.
grant alunza_app,alunza_identity to postgres;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to alunza_app;
do $$ declare fn regprocedure; begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid
  join pg_extension e on d.refclassid='pg_extension'::regclass and e.oid=d.refobjid where e.extname='pgtap'
 loop execute format('grant execute on function %s to alunza_app',fn); end loop;
end $$;
set local search_path=public,extensions;
select no_plan();

create function pg_temp.vid(kind integer,n integer) returns uuid language sql immutable as $$
 select ('d2700000-0000-4000-8000-'||lpad(kind::text,2,'0')||lpad(n::text,10,'0'))::uuid
$$;

-- Same valid domain fixture pattern as SQL005/017, scoped to these identities.
insert into auth.users(id,email,email_confirmed_at)
 select pg_temp.vid(1,n),'version-read-027-'||n||'@alunza.test',now() from generate_series(1,8) n;
insert into auth.sessions(id,user_id)
 select pg_temp.vid(2,n),pg_temp.vid(1,n) from generate_series(1,8) n;
insert into app.profiles(id,display_name,email_normalized,account_state)
 select pg_temp.vid(1,n),'Version read actor '||n,'version-read-027-'||n||'@alunza.test','ACTIVE' from generate_series(1,8) n;
insert into app.organizations(id,code,name) values
 (pg_temp.vid(3,1),'VERSION-027-A','Version read A'),(pg_temp.vid(3,2),'VERSION-027-B','Version read B');
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at)
 select pg_temp.vid(3,case when n<=5 then 1 else 2 end),pg_temp.vid(1,n),
  case when n in (1,6) then 'ADMIN' when n in (2,4,7) then 'TEACHER' else 'STUDENT' end,'ACTIVE',now()
 from generate_series(1,8) n;
insert into app.courses(id,organization_id,code,name,academic_period)
 select pg_temp.vid(4,n),pg_temp.vid(3,n),'P1','Version read course','2026-2' from generate_series(1,2) n;
insert into app.classes(id,organization_id,course_id,teacher_id,code,name)
 select pg_temp.vid(5,n),pg_temp.vid(3,case when n=3 then 2 else 1 end),pg_temp.vid(4,case when n=3 then 2 else 1 end),
  pg_temp.vid(1,case n when 1 then 2 when 2 then 4 else 7 end),'C'||n,'Version read class '||n from generate_series(1,3) n;
insert into app.class_memberships(organization_id,class_id,user_id) values
 (pg_temp.vid(3,1),pg_temp.vid(5,1),pg_temp.vid(1,3)),
 (pg_temp.vid(3,1),pg_temp.vid(5,2),pg_temp.vid(1,5)),
 (pg_temp.vid(3,2),pg_temp.vid(5,3),pg_temp.vid(1,8));
insert into app.concept_tags(id,organization_id,normalized_name)
 select pg_temp.vid(6,n),pg_temp.vid(3,n),'version-read-027' from generate_series(1,2) n;
insert into app.concept_versions(id,organization_id,concept_id,version,name,created_by)
 select pg_temp.vid(7,n),pg_temp.vid(3,n),pg_temp.vid(6,n),1,'Version read concept',pg_temp.vid(1,case n when 1 then 1 else 6 end)
 from generate_series(1,2) n;
update app.concept_tags set current_version_id=pg_temp.vid(7,case when id=pg_temp.vid(6,1) then 1 else 2 end)
 where id in (pg_temp.vid(6,1),pg_temp.vid(6,2));
-- 1 unassigned/private; 2 published; 3 draft; 4 closed; 5 other class;
-- 6 shared by accessible and inaccessible activities; 7 organization; 8 foreign.
insert into app.exercises(id,organization_id,owner_id,visibility)
 select pg_temp.vid(8,n),pg_temp.vid(3,case n when 8 then 2 else 1 end),pg_temp.vid(1,case n when 8 then 7 else 2 end),
  case n when 7 then 'ORGANIZATION' else 'PRIVATE' end from generate_series(1,8) n;
insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by)
 select pg_temp.vid(9,n),pg_temp.vid(3,case n when 8 then 2 else 1 end),pg_temp.vid(8,n),1,'Version read '||n,'Return zero',
  'module.exports.solve=()=>0;','BEGINNER',pg_temp.vid(1,case n when 8 then 7 else 2 end) from generate_series(1,8) n;
insert into app.exercise_version_concepts(organization_id,exercise_version_id,concept_version_id)
 select pg_temp.vid(3,case n when 8 then 2 else 1 end),pg_temp.vid(9,n),pg_temp.vid(7,case n when 8 then 2 else 1 end)
 from generate_series(1,8) n;
insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected)
 select pg_temp.vid(3,case n when 8 then 2 else 1 end),pg_temp.vid(9,n),t.visibility,t.position,t.visibility,'[]'::json,'0'::json
 from generate_series(1,8) n cross join (values(0,'visible'),(1,'hidden')) t(position,visibility);
update app.exercises set current_version_id=pg_temp.vid(9,n)
 from generate_series(1,8) n where id=pg_temp.vid(8,n);
insert into app.activities(id,organization_id,class_id,created_by,title,type)
 select pg_temp.vid(10,n),pg_temp.vid(3,case n when 7 then 2 else 1 end),
  pg_temp.vid(5,case when n in (4,5) then 2 when n=7 then 3 else 1 end),
  pg_temp.vid(1,case when n in (4,5) then 4 when n=7 then 7 else 2 end),'Version read activity '||n,'FORMATIVE'
 from generate_series(1,7) n;
insert into app.activity_exercises(organization_id,activity_id,exercise_version_id,position)
 select pg_temp.vid(3,case n when 7 then 2 else 1 end),pg_temp.vid(10,n),
  pg_temp.vid(9,case n when 1 then 2 when 2 then 3 when 3 then 4 when 4 then 5 when 7 then 8 else 6 end),0
 from generate_series(1,7) n;
update app.activities set state='PUBLISHED' where id in
 (pg_temp.vid(10,1),pg_temp.vid(10,3),pg_temp.vid(10,4),pg_temp.vid(10,5),pg_temp.vid(10,6),pg_temp.vid(10,7));
update app.activities set state='CLOSED' where id=pg_temp.vid(10,3);
set constraints app.provisioning_complete,app.exercise_definition_complete,
 app.concept_current_version,app.exercise_current_version immediate;

-- Golden reference is the original SQL body, executed with the SAME constrained
-- definer and lookup RLS as production; never with postgres privileges.
grant create on schema app_private to alunza_identity;
create function app_private.test_027_legacy_version_read(ver uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.exercise_versions v where v.id=ver and (app_private.academic_exercise_read(v.exercise_id)
  or exists(select 1 from app.activity_exercises ae where ae.organization_id=v.organization_id and ae.exercise_version_id=v.id and app_private.academic_activity_read(ae.activity_id))))
$$;
alter function app_private.test_027_legacy_version_read(uuid) owner to alunza_identity;
revoke all on function app_private.test_027_legacy_version_read(uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.test_027_legacy_version_read(uuid) to alunza_app,alunza_identity;
revoke create on schema app_private from alunza_identity;
create function pg_temp.check_version(ver uuid,expected boolean,label text) returns setof text
language plpgsql as $$ declare actual boolean; begin
 actual:=app_private.academic_version_read(ver);
 return next extensions.is(actual,expected,label);
 return next extensions.is(actual,app_private.test_027_legacy_version_read(ver),label||' agrees with original SQL');
end $$;
create function pg_temp.actor(n integer,org integer) returns void language plpgsql as $$ begin
 perform set_config('app.actor_id',pg_temp.vid(1,n)::text,true);
 perform set_config('app.session_id',pg_temp.vid(2,n)::text,true);
 perform set_config('app.organization_id',case when org is null then '' else pg_temp.vid(3,org)::text end,true);
end $$;

select ok((select p.provolatile='s' and p.prosecdef and not p.proisstrict and not p.proleakproof
 and p.proparallel='u' and l.lanname='plpgsql' and pg_get_userbyid(p.proowner)='alunza_identity'
 and p.proconfig=array['search_path=pg_catalog'] from pg_proc p join pg_language l on l.oid=p.prolang
 where p.oid='app_private.academic_version_read(uuid)'::regprocedure),'bounded lookup preserves stable definer, owner, search path and NULL semantics');
select ok(has_function_privilege('alunza_app','app_private.academic_version_read(uuid)','EXECUTE')
 and has_function_privilege('alunza_identity','app_private.academic_version_read(uuid)','EXECUTE')
 and not exists(select 1 from unnest(array['anon','authenticated','service_role']) r
  where has_function_privilege(r,'app_private.academic_version_read(uuid)','EXECUTE'))
 and not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid='app_private.academic_version_read(uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),
 'helper EXECUTE remains restricted to existing internal/application roles');
select ok(not pg_has_role('alunza_app','alunza_identity','USAGE') and not pg_has_role('alunza_app','alunza_identity','SET'),
 'runtime cannot assume the definer role');

set local role alunza_app;
select pg_temp.actor(2,1);
select * from pg_temp.check_version(null,false,'NULL version denies');
select * from pg_temp.check_version(pg_temp.vid(9,999),false,'Missing version denies');
select * from pg_temp.check_version(pg_temp.vid(9,1),true,'Owner reads private unassigned version');
select is((select count(*) from app_private.exercise_tests where exercise_version_id=pg_temp.vid(9,1)),2::bigint,'Owner retains visible and hidden definition');
select pg_temp.actor(4,1);
select * from pg_temp.check_version(pg_temp.vid(9,1),false,'Other teacher cannot read unassigned private version');
select * from pg_temp.check_version(pg_temp.vid(9,7),true,'Other teacher can read organization version');
select * from pg_temp.check_version(pg_temp.vid(9,5),true,'Class teacher reads assigned version through activity');
select is((select count(*) from app_private.exercise_tests where exercise_version_id=pg_temp.vid(9,5) and visibility='hidden'),0::bigint,'Activity access does not grant another teacher hidden private tests');

select pg_temp.actor(3,1);
select checked.* from (values(1,false,'Student unassigned denies'),(2,true,'Student published allows'),(3,false,'Student draft denies'),
  (4,true,'Student closed remains readable'),(5,false,'Student other class denies'),
  (6,true,'Shared version finds accessible activity among other classes'),(7,false,'Organization bank does not grant student access'),
  (8,false,'Student foreign organization denies')) cases(n,allowed,label)
 cross join lateral pg_temp.check_version(pg_temp.vid(9,n),allowed,label) checked;
select is((select count(*) from app_private.exercise_tests where exercise_version_id=pg_temp.vid(9,2) and visibility='visible'),1::bigint,'Student RLS returns visible case');
select is((select count(*) from app_private.exercise_tests where exercise_version_id=pg_temp.vid(9,2) and visibility='hidden'),0::bigint,'Student RLS still excludes hidden case');
select ok((select bool_and(app_private.academic_version_read(pg_temp.vid(9,case when n%2=0 then 2 else 5 end))=(n%2=0))
 from generate_series(1,12) n),'Repeated alternating versions on one connection do not reuse authorization results');
select pg_temp.actor(3,null);
select * from pg_temp.check_version(pg_temp.vid(9,2),true,'Bootstrap null organization preserves membership-based access');
select pg_temp.actor(8,2);
select * from pg_temp.check_version(pg_temp.vid(9,2),false,'Foreign student cannot read first organization');
select * from pg_temp.check_version(pg_temp.vid(9,8),true,'Foreign student retains own class access');
select pg_temp.actor(3,2);
select * from pg_temp.check_version(pg_temp.vid(9,2),false,'Explicit conflicting organization denies');
select pg_temp.actor(1,1);
select * from pg_temp.check_version(pg_temp.vid(9,1),true,'Existing administrator definition permission unchanged');

-- Revoke and restore the same actor/session in later statements on this connection.
reset role;
delete from auth.sessions where id=pg_temp.vid(2,3);
set local role alunza_app;
select pg_temp.actor(3,1);
select * from pg_temp.check_version(pg_temp.vid(9,2),false,'Revoked session invalidates previously allowed version');
select is((select count(*) from app_private.exercise_tests where exercise_version_id=pg_temp.vid(9,2)),0::bigint,'Revoked session loses direct test reads');
reset role;
insert into auth.sessions(id,user_id) values(pg_temp.vid(2,3),pg_temp.vid(1,3));
update app.class_memberships set ended_at=clock_timestamp() where class_id=pg_temp.vid(5,1) and user_id=pg_temp.vid(1,3);
set local role alunza_app;
select * from pg_temp.check_version(pg_temp.vid(9,2),false,'Ended class membership denies on the same connection');
reset role;
update app.class_memberships set ended_at=null where class_id=pg_temp.vid(5,1) and user_id=pg_temp.vid(1,3);
update app.profiles set account_state='DISABLED' where id=pg_temp.vid(1,3);
set local role alunza_app;
select * from pg_temp.check_version(pg_temp.vid(9,2),false,'Disabled profile denies despite live session and membership');
reset role;
update app.profiles set account_state='ACTIVE' where id=pg_temp.vid(1,3);
set local role alunza_app;
select * from pg_temp.check_version(pg_temp.vid(9,2),true,'Restored active identity is evaluated anew');

reset role;
select * from finish();
rollback;
