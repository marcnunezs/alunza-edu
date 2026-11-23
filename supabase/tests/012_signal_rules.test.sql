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
 select ('a5100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'rule-'||n||'@alunza.test',now() from generate_series(1,5) n;
insert into auth.sessions(id,user_id)
 select ('a5110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('a5100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,5) n;
insert into app.profiles(id,display_name,email_normalized,account_state)
 select ('a5100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Rule '||n,'rule-'||n||'@alunza.test','ACTIVE' from generate_series(1,5) n;
insert into app.organizations(id,code,name) values
 ('a5200000-0000-4000-8000-000000000001','RULE-A','Rule A'),('a5200000-0000-4000-8000-000000000002','RULE-B','Rule B');
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at) values
 ('a5200000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000001','ADMIN','ACTIVE',now()),
 ('a5200000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000002','TEACHER','ACTIVE',now()),
 ('a5200000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000003','STUDENT','ACTIVE',now()),
 ('a5200000-0000-4000-8000-000000000002','a5100000-0000-4000-8000-000000000004','ADMIN','ACTIVE',now()),
 ('a5200000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000005','ADMIN','ACTIVE',now());
create temporary table rule_test_results(name text primary key,body jsonb);
grant select,insert,update on rule_test_results to alunza_app;
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='app.signal_rule_versions'::regclass),'RF026: rules force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='app_private.signal_rule_operations'::regclass),'RF026: idempotency forces RLS');
select ok(not has_table_privilege('alunza_app','app.signal_rule_versions','INSERT'),'runtime cannot insert definitions directly');
select ok(not has_table_privilege('alunza_app','app.signal_rule_versions','UPDATE'),'runtime cannot rewrite validity');
select ok(not has_table_privilege('alunza_app','app_private.signal_rule_operations','SELECT'),'runtime cannot read operation keys directly');
select ok(not has_function_privilege('anon','app_private.create_rule_version(uuid,jsonb,text)','EXECUTE'),'anon cannot call private writer');
select ok(not has_function_privilege('authenticated','app_private.activate_rule_version(uuid,uuid,uuid,text)','EXECUTE'),'browser cannot call private activator');
select ok(not has_function_privilege('alunza_app','app_private.reserve_signal_rule_operation(uuid,text,text,jsonb)','EXECUTE'),'runtime cannot reserve unfinished operation');
select ok(not has_schema_privilege('alunza_identity','app_private','CREATE'),'helper CREATE is restored after migration');
select ok(not pg_has_role('alunza_app','alunza_identity','MEMBER'),'runtime cannot assume helper');
select is((select count(*)::integer from pg_constraint where conrelid='app.signal_rule_versions'::regclass and conname='signal_rule_validity_exclusive' and contype='x'),1,'hard exclusion protects historical validity');

set local role alunza_app;
select set_config('app.actor_id','a5100000-0000-4000-8000-000000000001',true);
select set_config('app.session_id','a5110000-0000-4000-8000-000000000001',true);
select set_config('app.organization_id','a5200000-0000-4000-8000-000000000001',true);
select set_config('app.request_id','a5120000-0000-4000-8000-000000000001',true);
select is(app_private.list_rule_versions('a5200000-0000-4000-8000-000000000001',null,null,50)->'data','[]'::jsonb,'no configured rule is an empty configuration');
insert into rule_test_results values('draft1',app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"inactivityDays":7}}','rules-create-01'));
select is((select body->>'state' from rule_test_results where name='draft1'),'DRAFT','create does not activate');
select is((select body->>'version' from rule_test_results where name='draft1'),'1','first version is one');
select is(app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"parameters":{"inactivityDays":7},"algorithmVersion":"DEC005_V1","schemaVersion":1,"type":"INACTIVITY"}','rules-create-01'),
 (select body from rule_test_results where name='draft1'),'same normalized payload replays same draft snapshot');
select throws_ok($$select app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"inactivityDays":8}}','rules-create-01')$$,
 'P0001','IDEMPOTENCY_CONFLICT','same create key different parameters conflicts');
select throws_ok($$select app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"type":"STAGNATION","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"stagnationAttempts":3}}','rules-create-01')$$,
 'P0001','IDEMPOTENCY_CONFLICT','create operation key is scoped independently of type');
select throws_ok($$select app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"inactivityDays":0}}','rules-invalid-00')$$,
 'P0001','RULE_PARAMETERS_INVALID','zero days cannot be persisted');
select throws_ok($$select app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"inactivityDays":1.5}}','rules-invalid-01')$$,
 'P0001','RULE_PARAMETERS_INVALID','fractional days cannot be persisted');
select throws_ok($$select app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"inactivityDays":2147483648}}','rules-invalid-02')$$,
 'P0001','RULE_PARAMETERS_INVALID','unrepresentable int4 cannot be persisted');
select throws_ok($$select app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"type":"STAGNATION","schemaVersion":1,"algorithmVersion":"CUSTOM","parameters":{"stagnationAttempts":3}}','rules-invalid-03')$$,
 'P0001','RULE_PARAMETERS_INVALID','unknown algorithm cannot be persisted');
select throws_ok($$select app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"type":"STAGNATION","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"stagnationAttempts":1}}','rules-invalid-04')$$,
 'P0001','RULE_PARAMETERS_INVALID','attempt count must be at least two');
select throws_ok($$select app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"inactivityDays":7,"formula":"true"}}','rules-invalid-05')$$,
 'P0001','RULE_PARAMETERS_INVALID','extra parameters cannot introduce formulas');
select throws_ok($$select app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{}}','rules-invalid-06')$$,
 'P0001','RULE_PARAMETERS_INVALID','missing threshold cannot be persisted');
insert into rule_test_results values('draft2',app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"inactivityDays":8}}','rules-create-02'));
select is((select body->>'version' from rule_test_results where name='draft2'),'2','new parameters allocate a new immutable version');
insert into rule_test_results values('stagnation',app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"type":"STAGNATION","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"stagnationAttempts":2}}','rules-create-03'));
select is((select body->>'version' from rule_test_results where name='stagnation'),'1','different type owns its version sequence');
select is(jsonb_array_length(app_private.list_rule_versions('a5200000-0000-4000-8000-000000000001','INACTIVITY',null,1)->'data'),1,'page limit is applied in scope');
select is(app_private.list_rule_versions('a5200000-0000-4000-8000-000000000001','INACTIVITY',null,1)->'page'->'hasMore','true'::jsonb,'page continuation is explicit');
select throws_ok($$select app_private.list_rule_versions('a5200000-0000-4000-8000-000000000001','INACTIVITY',
 (select (body->>'id')::uuid from rule_test_results where name='stagnation'),1)$$,'P0001','RULE_CURSOR_INVALID','cursor must match filter');
insert into rule_test_results values('active1',app_private.activate_rule_version('a5200000-0000-4000-8000-000000000001',
 (select (body->>'id')::uuid from rule_test_results where name='draft1'),null,'rules-activate-01'));
select is((select body->>'state' from rule_test_results where name='active1'),'ACTIVE','first activation is immediate');
select is(app_private.activate_rule_version('a5200000-0000-4000-8000-000000000001',
 (select (body->>'id')::uuid from rule_test_results where name='draft1'),null,'rules-activate-01'),
 (select body from rule_test_results where name='active1'),'activation replay retains the original A');
select throws_ok($$select app_private.activate_rule_version('a5200000-0000-4000-8000-000000000001',
 (select (body->>'id')::uuid from rule_test_results where name='draft2'),null,'rules-activate-stale')$$,
 'P0001','RULE_VERSION_CONFLICT','stale expected version loses without mutation');
insert into rule_test_results values('active2',app_private.activate_rule_version('a5200000-0000-4000-8000-000000000001',
 (select (body->>'id')::uuid from rule_test_results where name='draft2'),
 (select (body->>'id')::uuid from rule_test_results where name='draft1'),'rules-activate-02'));
select is((select valid_to from app.signal_rule_versions where id=(select (body->>'id')::uuid from rule_test_results where name='draft1')),
 (select valid_from from app.signal_rule_versions where id=(select (body->>'id')::uuid from rule_test_results where name='draft2')),
 'old exclusive end exactly equals new inclusive start');
select is((select count(*)::integer from app.signal_rule_versions where type='INACTIVITY' and valid_from is not null and valid_to is null),1,'one open validity per type');
select is((select count(*)::integer from app.signal_rule_versions where type='INACTIVITY'
 and valid_from<=(select (body->>'validFrom')::timestamptz from rule_test_results where name='active2')
 and (valid_to is null or valid_to>(select (body->>'validFrom')::timestamptz from rule_test_results where name='active2'))),1,
 'equality boundary belongs only to new version');
select is(app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"inactivityDays":7}}','rules-create-01'),
 (select body from rule_test_results where name='draft1'),'create replay remains original snapshot after activation and retirement');
select is(app_private.activate_rule_version('a5200000-0000-4000-8000-000000000001',
 (select (body->>'id')::uuid from rule_test_results where name='draft1'),null,'rules-activate-01'),
 (select body from rule_test_results where name='active1'),'activation replay remains original snapshot after retirement');
select throws_ok($$select app_private.activate_rule_version('a5200000-0000-4000-8000-000000000001',
 (select (body->>'id')::uuid from rule_test_results where name='draft1'),
 (select (body->>'id')::uuid from rule_test_results where name='draft2'),'rules-reactivate-01')$$,
 'P0001','RULE_VERSION_ALREADY_ACTIVATED','retired version cannot be reactivated');
select is(app_private.activate_rule_version('a5200000-0000-4000-8000-000000000001',
 (select (body->>'id')::uuid from rule_test_results where name='draft2'),
 (select (body->>'id')::uuid from rule_test_results where name='draft2'),'rules-current-noop'),
 (select body from rule_test_results where name='active2'),'current version with expected current is an effective no-op');
select is((select count(*)::integer from app.audit_events where action='RULE_VERSION_ACTIVATED'),2,'replays and no-op leave two effective activation audits');
select is((select count(*)::integer from app.audit_events where action='RULE_VERSION_CREATED'),3,'create replays leave three effective create audits');
select ok((select bool_and(request_id='a5120000-0000-4000-8000-000000000001'::uuid) from app.audit_events where action like 'RULE_VERSION_%'),'audit retains verified request correlation');
set local time zone 'America/Santiago';
select ok(app_private.get_rule_version('a5200000-0000-4000-8000-000000000001',
 (select (body->>'id')::uuid from rule_test_results where name='draft2'))->>'validFrom' ~ 'Z$','projection remains UTC under local session timezone');
select is(app_private.get_rule_version('a5200000-0000-4000-8000-000000000001',
 (select (body->>'id')::uuid from rule_test_results where name='draft2'))->>'validFrom',
 (select body->>'validFrom' from rule_test_results where name='active2'),'projection retains exact six-decimal activation timestamp');
select is(app_private.signal_rule_organization((select (body->>'id')::uuid from rule_test_results where name='draft2')),
 'a5200000-0000-4000-8000-000000000001'::uuid,'private resource lookup returns only authorized organization');

reset role;
select throws_ok($$update app.signal_rule_versions set parameters='{"inactivityDays":9}' where id=(select (body->>'id')::uuid from rule_test_results where name='draft2')$$,
 '23514','RULE_VERSION_IMMUTABLE','even fixture owner cannot rewrite active parameters');
select throws_ok($$update app.signal_rule_versions set algorithm_version='CUSTOM' where id=(select (body->>'id')::uuid from rule_test_results where name='draft1')$$,
 '23514','RULE_VERSION_IMMUTABLE','retired algorithm is immutable');
select throws_ok($$update app.signal_rule_versions set parameters='{"stagnationAttempts":3}' where id=(select (body->>'id')::uuid from rule_test_results where name='stagnation')$$,
 '23514','RULE_VERSION_IMMUTABLE','draft parameters are immutable');
select throws_ok($$delete from app.signal_rule_versions where id=(select (body->>'id')::uuid from rule_test_results where name='draft1')$$,
 '23514','RULE_VERSION_IMMUTABLE','rule history cannot be deleted');
select throws_ok($$update app_private.signal_rule_operations set response_body='{}' where key='rules-create-01'$$,
 '23514','RULE_OPERATION_IMMUTABLE','idempotency snapshot cannot be rewritten');
select throws_ok($$insert into app.signal_rule_versions(organization_id,type,version,schema_version,algorithm_version,parameters,created_by)
 values('a5200000-0000-4000-8000-000000000001','INACTIVITY',99,1,'DEC005_V1','{"inactivityDays":7}','a5100000-0000-4000-8000-000000000004')$$,
 '23503',null,'cross-organization creator fails composite FK');
select is((select count(*)::integer from app_private.signal_rule_operations where response_body is null),0,'every committed operation in successful transaction owns a response');

set local role alunza_app;
select set_config('app.actor_id','a5100000-0000-4000-8000-000000000002',true);
select set_config('app.session_id','a5110000-0000-4000-8000-000000000002',true);
select is((select count(*)::integer from app.signal_rule_versions),0,'teacher cannot read governance rules via raw RLS');
select throws_ok($$select app_private.list_rule_versions('a5200000-0000-4000-8000-000000000001',null,null,50)$$,
 '42501','FORBIDDEN','teacher cannot list administrative configuration');
select throws_ok($$select app_private.signal_rule_organization((select (body->>'id')::uuid from rule_test_results where name='draft1'))$$,
 'P0001','RESOURCE_NOT_FOUND','teacher cannot enumerate private rule IDs');
select set_config('app.actor_id','a5100000-0000-4000-8000-000000000003',true);
select set_config('app.session_id','a5110000-0000-4000-8000-000000000003',true);
select throws_ok($$select app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"inactivityDays":7}}','student-create-01')$$,
 '42501','FORBIDDEN','student cannot create rules');
select set_config('app.actor_id','a5100000-0000-4000-8000-000000000004',true);
select set_config('app.session_id','a5110000-0000-4000-8000-000000000004',true);
select set_config('app.organization_id','a5200000-0000-4000-8000-000000000002',true);
select is((select count(*)::integer from app.signal_rule_versions),0,'foreign admin cannot read organization A definitions');
select throws_ok($$select app_private.signal_rule_organization((select (body->>'id')::uuid from rule_test_results where name='draft1'))$$,
 'P0001','RESOURCE_NOT_FOUND','foreign and absent rule lookup have equal safe error');
select throws_ok($$select app_private.get_rule_version('a5200000-0000-4000-8000-000000000002',
 (select (body->>'id')::uuid from rule_test_results where name='draft1'))$$,'P0001','RESOURCE_NOT_FOUND','detail is searched in authorized organization');
select lives_ok($$select app_private.create_rule_version('a5200000-0000-4000-8000-000000000002',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"inactivityDays":7}}','rules-create-01')$$,
 'same opaque key in another organization does not conflict');
reset role;
update app.profiles set account_state='DISABLED' where id='a5100000-0000-4000-8000-000000000001';
set local role alunza_app;
select set_config('app.actor_id','a5100000-0000-4000-8000-000000000001',true);
select set_config('app.session_id','a5110000-0000-4000-8000-000000000001',true);
select set_config('app.organization_id','a5200000-0000-4000-8000-000000000001',true);
select throws_ok($$select app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"inactivityDays":7}}','rules-create-01')$$,
 '42501','FORBIDDEN','disabled actor cannot replay a prior successful operation');
reset role;
update app.profiles set account_state='ACTIVE' where id='a5100000-0000-4000-8000-000000000001';
delete from auth.sessions where id='a5110000-0000-4000-8000-000000000001';
set local role alunza_app;
select throws_ok($$select app_private.create_rule_version('a5200000-0000-4000-8000-000000000001',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"inactivityDays":7}}','rules-create-01')$$,
 '42501','FORBIDDEN','revoked session cannot replay a successful operation');
reset role;
select * from finish();
rollback;
