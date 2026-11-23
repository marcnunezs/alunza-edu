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
 select ('a6100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'effective-'||n||'@alunza.test',now() from generate_series(1,5) n;
insert into auth.sessions(id,user_id)
 select ('a6110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('a6100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,5) n;
insert into app.profiles(id,display_name,email_normalized,account_state)
 select ('a6100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Effective '||n,'effective-'||n||'@alunza.test','ACTIVE' from generate_series(1,5) n;
insert into app.organizations(id,code,name) values
 ('a6200000-0000-4000-8000-000000000001','EFFECTIVE-A','Effective A'),('a6200000-0000-4000-8000-000000000002','EFFECTIVE-B','Effective B');
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at) values
 ('a6200000-0000-4000-8000-000000000001','a6100000-0000-4000-8000-000000000001','ADMIN','ACTIVE',now()),
 ('a6200000-0000-4000-8000-000000000001','a6100000-0000-4000-8000-000000000002','TEACHER','ACTIVE',now()),
 ('a6200000-0000-4000-8000-000000000001','a6100000-0000-4000-8000-000000000003','STUDENT','ACTIVE',now()),
 ('a6200000-0000-4000-8000-000000000002','a6100000-0000-4000-8000-000000000004','ADMIN','ACTIVE',now()),
 ('a6200000-0000-4000-8000-000000000001','a6100000-0000-4000-8000-000000000005','ADMIN','ACTIVE',now());
create temporary table effective_test_results(name text primary key,body jsonb);
grant select,insert,update on effective_test_results to alunza_app;

select is((select provolatile::text from pg_proc where oid='app_private.effective_signal_rules(uuid)'::regprocedure),'s','effective RPC fixes all queries to the statement snapshot');
select is((select pg_get_userbyid(proowner) from pg_proc where oid='app_private.effective_signal_rules(uuid)'::regprocedure),'alunza_identity','effective RPC uses the constrained owner');
select ok((select proconfig @> array['search_path=pg_catalog'] from pg_proc where oid='app_private.effective_signal_rules(uuid)'::regprocedure),'effective RPC pins the search path');
select ok(has_function_privilege('alunza_app','app_private.effective_signal_rules(uuid)','EXECUTE'),'limited runtime may call effective reader');
select ok(not has_function_privilege('anon','app_private.effective_signal_rules(uuid)','EXECUTE'),'anon cannot execute effective RPC');
select ok(not has_function_privilege('authenticated','app_private.effective_signal_rules(uuid)','EXECUTE'),'browser cannot execute effective RPC');
select ok(not has_function_privilege('service_role','app_private.effective_signal_rules(uuid)','EXECUTE'),'service role has no effective RPC grant');
select ok(not has_schema_privilege('alunza_identity','app_private','CREATE'),'temporary owner CREATE is revoked');
select ok(not pg_has_role('alunza_app','alunza_identity','MEMBER'),'runtime cannot assume helper owner');

set local role alunza_app;
select set_config('app.actor_id','a6100000-0000-4000-8000-000000000001',true);
select set_config('app.session_id','a6110000-0000-4000-8000-000000000001',true);
select set_config('app.organization_id','a6200000-0000-4000-8000-000000000001',true);
select is(app_private.effective_signal_rules('a6200000-0000-4000-8000-000000000001')->'rules',
 '[{"type":"INACTIVITY","ruleVersion":null},{"type":"REPEATED_ERROR","ruleVersion":null},{"type":"STAGNATION","ruleVersion":null}]'::jsonb,
 'empty configuration explicitly contains exactly three unconfigured types');
select is(app_private.effective_signal_rules('a6200000-0000-4000-8000-000000000001')->>'organizationId',
 'a6200000-0000-4000-8000-000000000001','effective response retains authorized organization');
select is(app_private.effective_signal_rules('a6200000-0000-4000-8000-000000000001')->>'observedAt',
 to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'observedAt is UTC statement time with microseconds');
select is((select array_agg(key order by key) from jsonb_object_keys(app_private.effective_signal_rules('a6200000-0000-4000-8000-000000000001')) key),
 array['observedAt','organizationId','rules'],'effective projection has no learning evidence or operational fields');

insert into effective_test_results values('draft',app_private.create_rule_version('a6200000-0000-4000-8000-000000000001',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"inactivityDays":7}}','effective-create-1'));
select is(app_private.effective_signal_rules('a6200000-0000-4000-8000-000000000001')->'rules'->0->'ruleVersion','null'::jsonb,'DRAFT does not appear as effective');
insert into effective_test_results values('active',app_private.activate_rule_version('a6200000-0000-4000-8000-000000000001',
 (select (body->>'id')::uuid from effective_test_results where name='draft'),null,'effective-activate-1'));
select is(app_private.effective_signal_rules('a6200000-0000-4000-8000-000000000001')->'rules'->0->'ruleVersion',
 (select body from effective_test_results where name='active'),'effective version is the confirmed ACTIVE projection');
select is(app_private.effective_signal_rules('a6200000-0000-4000-8000-000000000001')->'rules'->1->'ruleVersion','null'::jsonb,'unconfigured repeated error remains explicit');

insert into effective_test_results values('next',app_private.create_rule_version('a6200000-0000-4000-8000-000000000001',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"inactivityDays":8}}','effective-create-2'));
insert into effective_test_results values('next-active',app_private.activate_rule_version('a6200000-0000-4000-8000-000000000001',
 (select (body->>'id')::uuid from effective_test_results where name='next'),(select (body->>'id')::uuid from effective_test_results where name='draft'),'effective-activate-2'));
select is(app_private.activate_rule_version('a6200000-0000-4000-8000-000000000001',
 (select (body->>'id')::uuid from effective_test_results where name='draft'),null,'effective-activate-1'),
 (select body from effective_test_results where name='active'),'old activation replay retains its original receipt');
select is(app_private.effective_signal_rules('a6200000-0000-4000-8000-000000000001')->'rules'->0->'ruleVersion',
 (select body from effective_test_results where name='next-active'),'fresh effective query does not confuse historical replay with current configuration');
select is(app_private.get_rule_version('a6200000-0000-4000-8000-000000000001',(select (body->>'id')::uuid from effective_test_results where name='draft'))->>'state','RETIRED','previous version remains in history');

select set_config('app.actor_id','a6100000-0000-4000-8000-000000000002',true);
select set_config('app.session_id','a6110000-0000-4000-8000-000000000002',true);
select throws_ok($$select app_private.effective_signal_rules('a6200000-0000-4000-8000-000000000001')$$,'42501','FORBIDDEN','teacher cannot read effective governance');
select set_config('app.actor_id','a6100000-0000-4000-8000-000000000003',true);
select set_config('app.session_id','a6110000-0000-4000-8000-000000000003',true);
select throws_ok($$select app_private.effective_signal_rules('a6200000-0000-4000-8000-000000000001')$$,'42501','FORBIDDEN','student cannot read effective governance');
select set_config('app.actor_id','a6100000-0000-4000-8000-000000000004',true);
select set_config('app.session_id','a6110000-0000-4000-8000-000000000004',true);
select set_config('app.organization_id','a6200000-0000-4000-8000-000000000002',true);
select throws_ok($$select app_private.effective_signal_rules('a6200000-0000-4000-8000-000000000001')$$,'42501','FORBIDDEN','foreign organization has no effective rule access');
select throws_ok($$select app_private.effective_signal_rules('a6200000-0000-4000-8000-000000000099')$$,'42501','FORBIDDEN','unknown scope has the same safe RPC error');
reset role;
update app.organizations set archived_at=clock_timestamp() where id='a6200000-0000-4000-8000-000000000002';
set local role alunza_app;
select is(jsonb_array_length(app_private.effective_signal_rules('a6200000-0000-4000-8000-000000000002')->'rules'),3,'archived organization preserves authorized administrative reading');

reset role;
update app.organization_memberships set state='DISABLED' where organization_id='a6200000-0000-4000-8000-000000000001' and user_id='a6100000-0000-4000-8000-000000000001';
set local role alunza_app;
select set_config('app.actor_id','a6100000-0000-4000-8000-000000000001',true);
select set_config('app.session_id','a6110000-0000-4000-8000-000000000001',true);
select set_config('app.organization_id','a6200000-0000-4000-8000-000000000001',true);
select throws_ok($$select app_private.effective_signal_rules('a6200000-0000-4000-8000-000000000001')$$,'42501','FORBIDDEN','membership revocation is checked on every read');
reset role;
update app.organization_memberships set state='ACTIVE' where organization_id='a6200000-0000-4000-8000-000000000001' and user_id='a6100000-0000-4000-8000-000000000001';
update app.profiles set account_state='DISABLED' where id='a6100000-0000-4000-8000-000000000001';
set local role alunza_app;
select throws_ok($$select app_private.effective_signal_rules('a6200000-0000-4000-8000-000000000001')$$,'42501','FORBIDDEN','disabled profile cannot read configuration');
reset role;
update app.profiles set account_state='ACTIVE' where id='a6100000-0000-4000-8000-000000000001';
delete from auth.sessions where id='a6110000-0000-4000-8000-000000000001';
set local role alunza_app;
select throws_ok($$select app_private.effective_signal_rules('a6200000-0000-4000-8000-000000000001')$$,'42501','FORBIDDEN','revoked session cannot read configuration');
reset role;
select is((select count(*)::integer from app.audit_events where organization_id='a6200000-0000-4000-8000-000000000001' and action='RULE_VERSION_CREATED'),2,'effective reading never creates versions or duplicate audit');
select is((select count(*)::integer from app.audit_events where organization_id='a6200000-0000-4000-8000-000000000001' and action='RULE_VERSION_ACTIVATED'),2,'effective reading never activates or duplicates audit');
select * from finish();
rollback;
