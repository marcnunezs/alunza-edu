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
 select ('b1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'bank-'||n||'@alunza.test',now() from generate_series(1,6) n;
insert into auth.sessions(id,user_id)
 select ('b1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('b1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,6) n;
insert into app.profiles(id,display_name,email_normalized,account_state)
 select ('b1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Bank actor '||n,'bank-'||n||'@alunza.test','ACTIVE' from generate_series(1,6) n;
insert into app.organizations(id,code,name) values
 ('b2000000-0000-4000-8000-000000000001','BANK-A','Bank A'),('b2000000-0000-4000-8000-000000000002','BANK-B','Bank B');
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at) values
 ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','ADMIN','ACTIVE',now()),
 ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','TEACHER','ACTIVE',now()),
 ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003','STUDENT','ACTIVE',now()),
 ('b2000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000004','ADMIN','ACTIVE',now()),
 ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000005','ADMIN','ACTIVE',now()),
 ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000006','TEACHER','ACTIVE',now());
insert into app.courses(id,organization_id,code,name,academic_period) values
 ('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','P1','Programming','2026-2');
insert into app.classes(id,organization_id,course_id,teacher_id,code,name) values
 ('b4000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','A1','Operational class');
insert into app.concept_tags(id,organization_id,normalized_name) values
 ('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','addition'),
 ('b5000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','foreign');
insert into app.concept_versions(id,organization_id,concept_id,version,name,created_by) values
 ('b5100000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001',1,'Historical addition','b1000000-0000-4000-8000-000000000001'),
 ('b5100000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001',2,'Current taxonomy name','b1000000-0000-4000-8000-000000000001'),
 ('b5100000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000002','b5000000-0000-4000-8000-000000000002',1,'Foreign concept','b1000000-0000-4000-8000-000000000004');
update app.concept_tags set current_version_id=case id when 'b5000000-0000-4000-8000-000000000001' then 'b5100000-0000-4000-8000-000000000002'::uuid else 'b5100000-0000-4000-8000-000000000003'::uuid end
 where id in ('b5000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000002');
insert into app.exercises(id,organization_id,owner_id,visibility) values
 ('b6000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','PRIVATE'),
 ('b6000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','ORGANIZATION'),
 ('b6000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000004','PRIVATE');
insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by)
 select ('b6100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b2000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001',n,
 'Sum '||n,'BANK_STATEMENT_SENTINEL','BANK_CODE_SENTINEL','BEGINNER','b1000000-0000-4000-8000-000000000002' from generate_series(1,25) n;
insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) values
 ('b6100000-0000-4000-8000-000000000101','b2000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000002',1,'Second exercise','Statement','Code','INTERMEDIATE','b1000000-0000-4000-8000-000000000002'),
 ('b6100000-0000-4000-8000-000000000201','b2000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000003',1,'Foreign exercise','Statement','Code','ADVANCED','b1000000-0000-4000-8000-000000000004');
insert into app.exercise_version_concepts(organization_id,exercise_version_id,concept_version_id)
 select organization_id,id,case when organization_id='b2000000-0000-4000-8000-000000000001' then 'b5100000-0000-4000-8000-000000000001'::uuid else 'b5100000-0000-4000-8000-000000000003'::uuid end
 from app.exercise_versions where exercise_id in ('b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000003');
insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected)
 select organization_id,id,'BANK_TEST_SENTINEL',0,'visible','[1]'::json,'1'::json from app.exercise_versions
 where exercise_id in ('b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000003');
-- This valid fixture deliberately keeps version 1 current, outside history page 1.
update app.exercises set current_version_id=case id
 when 'b6000000-0000-4000-8000-000000000001' then 'b6100000-0000-4000-8000-000000000001'::uuid
 when 'b6000000-0000-4000-8000-000000000002' then 'b6100000-0000-4000-8000-000000000101'::uuid else 'b6100000-0000-4000-8000-000000000201'::uuid end
 where id in ('b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000003');
insert into app.activities(id,organization_id,class_id,created_by,title,type)
 select ('b7000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','Activity '||n,'FORMATIVE' from generate_series(1,3) n;
insert into app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position) values
 ('b8000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000002','b6100000-0000-4000-8000-000000000001',0),
 ('b8000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000002','b6100000-0000-4000-8000-000000000002',1),
 ('b8000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001','b6100000-0000-4000-8000-000000000003',0),
 ('b8000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000003','b6100000-0000-4000-8000-000000000004',0);
update app.activities set state='PUBLISHED' where id in ('b7000000-0000-4000-8000-000000000002','b7000000-0000-4000-8000-000000000003');
update app.activities set state='CLOSED' where id='b7000000-0000-4000-8000-000000000003';
set constraints app.provisioning_complete,app.exercise_definition_complete,app.concept_current_version,app.exercise_current_version immediate;
create temp table bank_read_results(label text primary key,payload jsonb);
grant select,insert on bank_read_results to alunza_app;

select ok((select not rolsuper and not rolbypassrls from pg_roles where rolname='alunza_identity'),'projection owner is constrained');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname like 'exercise_bank_%'
 and (pg_get_userbyid(p.proowner)<>'alunza_identity' or not p.proconfig @> array['search_path=pg_catalog'] or p.provolatile not in ('s','i'))),'all bank functions retain constrained owner, search path and read-only volatility');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated','service_role']) r
 where n.nspname='app_private' and p.proname like 'exercise_bank_%' and has_function_privilege(r,p.oid,'EXECUTE')),'Data API roles cannot call bank functions');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname like 'exercise_bank_%'
 and has_function_privilege('alunza_app',p.oid,'EXECUTE')<>(p.proname in ('exercise_bank_list','exercise_bank_detail','exercise_bank_versions','exercise_bank_uses'))),'application may execute only four authorized entrypoints');
select ok(not pg_has_role('alunza_app','alunza_identity','SET') and not pg_has_role('alunza_app','alunza_identity','USAGE'),'application cannot assume kernel owner');

set local role alunza_app;
select set_config('app.actor_id','b1000000-0000-4000-8000-000000000001',true),set_config('app.session_id','b1100000-0000-4000-8000-000000000001',true),set_config('app.organization_id','',true);
insert into bank_read_results values
 ('list',app_private.exercise_bank_list('b2000000-0000-4000-8000-000000000001','{"limit":1}')),
 ('detail',app_private.exercise_bank_detail('b6000000-0000-4000-8000-000000000001')),
 ('versions',app_private.exercise_bank_versions('b6000000-0000-4000-8000-000000000001','{}')),
 ('uses',app_private.exercise_bank_uses('b6000000-0000-4000-8000-000000000001','{"limit":1}'));
select is((select payload#>>'{page,totalFiltered}' from bank_read_results where label='list'),'2','bank count excludes foreign organization and precedes pagination');
select is((select jsonb_array_length(payload->'items') from bank_read_results where label='list'),1,'list respects requested page size');
select is((select payload#>>'{items,0,id}' from bank_read_results where label='list'),'b6000000-0000-4000-8000-000000000001','list UUID order is stable');
select is((app_private.exercise_bank_list('b2000000-0000-4000-8000-000000000001',jsonb_build_object('limit',1,'cursor',(select payload#>>'{page,nextCursor}' from bank_read_results where label='list'))))#>>'{items,0,id}',
 'b6000000-0000-4000-8000-000000000002','list next cursor returns next authorized exercise');
select is((select payload#>>'{currentVersion,version}' from bank_read_results where label='detail'),'1','current version comes from identity, not history page');
select is((select payload#>>'{currentVersion,concepts,0,name}' from bank_read_results where label='detail'),'Historical addition','concept metadata preserves fixed version name');
select is((select payload#>>'{owner,displayName}' from bank_read_results where label='detail'),'Bank actor 2','owner projection contains display name');
select is((select payload->'useCounts' from bank_read_results where label='detail'),'{"total":4,"draft":1,"published":2,"closed":1}'::jsonb,'counts are assignments including two versions in one activity');
select is((select payload#>>'{versionCount}' from bank_read_results where label='detail'),'25','version count is complete');
select is((select jsonb_array_length(payload->'items') from bank_read_results where label='versions'),20,'history default page size is 20');
select is((select payload#>>'{items,0,version}' from bank_read_results where label='versions'),'25','history orders version numbers descending');
select is((select payload#>>'{items,19,version}' from bank_read_results where label='versions'),'6','history first page excludes current fixture version');
select is(jsonb_array_length(app_private.exercise_bank_versions('b6000000-0000-4000-8000-000000000001',jsonb_build_object('cursor',(select payload#>>'{page,nextCursor}' from bank_read_results where label='versions')))->'items'),5,'history second page contains remaining versions');
select is((select payload#>>'{page,totalFiltered}' from bank_read_results where label='uses'),'4','use count precedes use pagination');
select is((app_private.exercise_bank_uses('b6000000-0000-4000-8000-000000000001','{"activityState":"PUBLISHED"}'))#>>'{page,totalFiltered}','2','published uses count includes both assignments');
select is((app_private.exercise_bank_uses('b6000000-0000-4000-8000-000000000001','{"versionId":"b6100000-0000-4000-8000-000000000001"}'))#>>'{page,totalFiltered}','1','use version filter is exact');
select is((app_private.exercise_bank_list('b2000000-0000-4000-8000-000000000001','{"search":"Second","visibility":"ORGANIZATION","difficulty":"INTERMEDIATE"}'))#>>'{page,totalFiltered}','1','composed metadata filters are applied before counting');
select is((app_private.exercise_bank_list('b2000000-0000-4000-8000-000000000001','{"search":"%"}'))#>>'{page,totalFiltered}','0','search is a literal substring, not a SQL wildcard');
select is((app_private.exercise_bank_list('b2000000-0000-4000-8000-000000000001','{"conceptId":"b5000000-0000-4000-8000-000000000001"}'))#>>'{page,totalFiltered}','2','concept filter matches current fixed version references');
select ok(not exists(select 1 from bank_read_results where payload::text ~ 'BANK_(CODE|STATEMENT|TEST)_SENTINEL|@alunza.test|"(tests|statement|starterCode|email|technicalResult|studentId)"'),'all projections exclude content, tests, email and pedagogical facts');
select is((select count(*) from app.activities where organization_id='b2000000-0000-4000-8000-000000000001'),0::bigint,'ADMIN metadata access does not widen direct activity RLS');
select ok(not app_private.academic_activity_read('b7000000-0000-4000-8000-000000000002'),'bank read does not confer pedagogical activity access');

select throws_ok($$select app_private.exercise_bank_list('b2000000-0000-4000-8000-000000000002','{}')$$,'P0001','RESOURCE_NOT_FOUND','foreign organization cannot be enumerated');
select throws_ok($$select app_private.exercise_bank_detail('b6000000-0000-4000-8000-000000000003')$$,'P0001','RESOURCE_NOT_FOUND','foreign detail cannot be read');
select throws_ok($$select app_private.exercise_bank_list('b2000000-0000-4000-8000-000000000001','{"conceptId":"b5000000-0000-4000-8000-000000000002"}')$$,'P0001','RESOURCE_NOT_FOUND','foreign concept filter reveals no metadata');
select throws_ok($$select app_private.exercise_bank_uses('b6000000-0000-4000-8000-000000000001','{"versionId":"b6100000-0000-4000-8000-000000000101"}')$$,'P0001','RESOURCE_NOT_FOUND','version filter must belong to requested exercise');
select throws_ok($$select app_private.exercise_bank_list('b2000000-0000-4000-8000-000000000001','{"limit":101}')$$,'P0001','EXERCISE_BANK_FILTER_INVALID','SQL enforces maximum page size');
select throws_ok($$select app_private.exercise_bank_list('b2000000-0000-4000-8000-000000000001','{"ownerId":"b1000000-0000-4000-8000-000000000001"}')$$,'P0001','EXERCISE_BANK_FILTER_INVALID','SQL rejects unsupported filters');
select throws_ok($$select app_private.exercise_bank_list('b2000000-0000-4000-8000-000000000001','{"state":"PUBLISHED"}')$$,'P0001','EXERCISE_BANK_FILTER_INVALID','SQL validates enum values');
select throws_ok($$select app_private.exercise_bank_list('b2000000-0000-4000-8000-000000000001','{"cursor":"bogus"}')$$,'P0001','EXERCISE_BANK_CURSOR_INVALID','malformed cursor is a controlled failure');
select throws_ok($$select app_private.exercise_bank_list('b2000000-0000-4000-8000-000000000001',jsonb_build_object('search','Sum','cursor',(select payload#>>'{page,nextCursor}' from bank_read_results where label='list')))$$,'P0001','EXERCISE_BANK_CURSOR_INVALID','cursor is bound to filters');
select throws_ok($$select app_private.exercise_bank_uses('b6000000-0000-4000-8000-000000000001',jsonb_build_object('cursor',(select payload#>>'{page,nextCursor}' from bank_read_results where label='versions')))$$,'P0001','EXERCISE_BANK_CURSOR_INVALID','cursor is bound to resource and reader');

select set_config('app.actor_id','b1000000-0000-4000-8000-000000000005',true),set_config('app.session_id','b1100000-0000-4000-8000-000000000005',true);
select throws_ok($$select app_private.exercise_bank_list('b2000000-0000-4000-8000-000000000001',jsonb_build_object('cursor',(select payload#>>'{page,nextCursor}' from bank_read_results where label='list')))$$,'P0001','EXERCISE_BANK_CURSOR_INVALID','cursor is bound to actor even for another authorized ADMIN');
select set_config('app.actor_id','b1000000-0000-4000-8000-000000000002',true),set_config('app.session_id','b1100000-0000-4000-8000-000000000002',true);
select throws_ok($$select app_private.exercise_bank_detail('b6000000-0000-4000-8000-000000000001')$$,'P0001','RESOURCE_NOT_FOUND','owning TEACHER gains no administrative projection');
select ok(app_private.academic_exercise_read('b6000000-0000-4000-8000-000000000002'),'existing shared teacher read is preserved');
select set_config('app.actor_id','b1000000-0000-4000-8000-000000000006',true),set_config('app.session_id','b1100000-0000-4000-8000-000000000006',true);
select ok(app_private.academic_exercise_read('b6000000-0000-4000-8000-000000000002'),'non-owning teacher retains shared bank read');
select ok(not app_private.academic_exercise_read('b6000000-0000-4000-8000-000000000001'),'non-owning teacher cannot read private bank');
select ok(not app_private.academic_exercise_author('b6000000-0000-4000-8000-000000000002'),'shared visibility does not confer authorship');
select throws_ok($$select app_private.exercise_bank_detail('b6000000-0000-4000-8000-000000000002')$$,'P0001','RESOURCE_NOT_FOUND','shared teacher gains no administrative usage projection');
select set_config('app.actor_id','b1000000-0000-4000-8000-000000000003',true),set_config('app.session_id','b1100000-0000-4000-8000-000000000003',true);
select throws_ok($$select app_private.exercise_bank_detail('b6000000-0000-4000-8000-000000000001')$$,'P0001','RESOURCE_NOT_FOUND','student gains no administrative projection');
select set_config('app.actor_id','b1000000-0000-4000-8000-000000000001',true),set_config('app.session_id','b1100000-0000-4000-8000-000000000002',true);
select throws_ok($$select app_private.exercise_bank_detail('b6000000-0000-4000-8000-000000000001')$$,'P0001','RESOURCE_NOT_FOUND','session of another actor cannot authorize');
select set_config('app.session_id','b1100000-0000-4000-8000-000000000001',true),set_config('app.organization_id','b2000000-0000-4000-8000-000000000002',true);
select throws_ok($$select app_private.exercise_bank_detail('b6000000-0000-4000-8000-000000000001')$$,'P0001','RESOURCE_NOT_FOUND','fixed organization context cannot be crossed');
select set_config('app.organization_id','',true);
reset role;

update app.exercises set archived_at=now() where id='b6000000-0000-4000-8000-000000000001';
update app.organization_memberships set state='DISABLED' where organization_id='b2000000-0000-4000-8000-000000000001' and user_id='b1000000-0000-4000-8000-000000000002';
set local role alunza_app;
select is((app_private.exercise_bank_detail('b6000000-0000-4000-8000-000000000001'))->>'state','ARCHIVED','archived exercise remains readable');
select is((app_private.exercise_bank_detail('b6000000-0000-4000-8000-000000000001'))#>>'{owner,displayName}','Bank actor 2','disabled owner remains identifiable in authorized history');
select is((app_private.exercise_bank_list('b2000000-0000-4000-8000-000000000001','{"state":"ARCHIVED"}'))#>>'{page,totalFiltered}','1','archived filter counts historical bank');
reset role;
update app.organization_memberships set state='DISABLED' where organization_id='b2000000-0000-4000-8000-000000000001' and user_id='b1000000-0000-4000-8000-000000000001';
set local role alunza_app;
select throws_ok($$select app_private.exercise_bank_detail('b6000000-0000-4000-8000-000000000001')$$,'P0001','RESOURCE_NOT_FOUND','revoked membership is effective with the old session');
reset role;

-- Archived organization is a fixture state; no runtime archival policy changes.
update app.organizations set archived_at=now(),archived_by='b1000000-0000-4000-8000-000000000005' where id='b2000000-0000-4000-8000-000000000001';
set local role alunza_app;
select set_config('app.actor_id','b1000000-0000-4000-8000-000000000005',true),set_config('app.session_id','b1100000-0000-4000-8000-000000000005',true);
select is((app_private.exercise_bank_list('b2000000-0000-4000-8000-000000000001','{}'))#>>'{page,totalFiltered}','2','remaining ADMIN can read archived organization');
reset role;

select * from finish();
rollback;
