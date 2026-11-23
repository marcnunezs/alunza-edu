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

create function pg_temp.audit_actor(n integer) returns uuid language sql immutable as $$
 select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.audit_session(n integer) returns uuid language sql immutable as $$
 select ('91100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.audit_context(n integer) returns void language plpgsql as $$
begin
 perform set_config('app.actor_id',pg_temp.audit_actor(n)::text,true),set_config('app.session_id',pg_temp.audit_session(n)::text,true),
  set_config('app.organization_id','',true);
end $$;
create function pg_temp.audit_query(options jsonb default '{}',org uuid default '92000000-0000-4000-8000-000000000001') returns jsonb
language sql stable as $$ select app_private.audit_events_list(org,options) $$;
create function pg_temp.audit_cursor_change(encoded text,path text[],value jsonb) returns text
language sql immutable as $$
 select rtrim(translate(replace(encode(convert_to(jsonb_set(
  convert_from(decode(translate(encoded,'-_','+/')||repeat('=',(4-length(encoded)%4)%4),'base64'),'UTF8')::jsonb,
  path,value)::text,'UTF8'),'base64'),E'\n',''),'+/','-_'),'=')
$$;

insert into auth.users(id,email,email_confirmed_at)
 select pg_temp.audit_actor(n),'audit-'||n||'@alunza.test',now() from generate_series(1,7) n;
insert into auth.sessions(id,user_id)
 select pg_temp.audit_session(n),pg_temp.audit_actor(n) from generate_series(1,7) n;
insert into app.profiles(id,display_name,email_normalized,account_state)
 select pg_temp.audit_actor(n),'Audit actor '||n,'audit-'||n||'@alunza.test','ACTIVE' from generate_series(1,7) n;
insert into app.organizations(id,code,name) values
 ('92000000-0000-4000-8000-000000000001','AUDIT-A','Audit A'),
 ('92000000-0000-4000-8000-000000000002','AUDIT-B','Audit B');
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at) values
 ('92000000-0000-4000-8000-000000000001',pg_temp.audit_actor(1),'ADMIN','ACTIVE',now()),
 ('92000000-0000-4000-8000-000000000001',pg_temp.audit_actor(2),'TEACHER','ACTIVE',now()),
 ('92000000-0000-4000-8000-000000000001',pg_temp.audit_actor(3),'STUDENT','ACTIVE',now()),
 ('92000000-0000-4000-8000-000000000002',pg_temp.audit_actor(4),'ADMIN','ACTIVE',now()),
 ('92000000-0000-4000-8000-000000000001',pg_temp.audit_actor(5),'ADMIN','ACTIVE',now()),
 ('92000000-0000-4000-8000-000000000001',pg_temp.audit_actor(6),'ADMIN','DISABLED',now());
insert into app.audit_events(id,organization_id,actor_id,actor_kind,occurred_at,action,entity_type,entity_id,result,correlation_id,request_id,safe_changes)
 select ('93000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'92000000-0000-4000-8000-000000000001',
  case when n=25 then null when n=24 then pg_temp.audit_actor(7) else pg_temp.audit_actor(2) end,
  case when n=25 then 'SYSTEM' when n=24 then 'TECHNICAL' else 'USER' end,
  case when n<=3 then '2026-10-01T10:00:00.123456Z'::timestamptz when n=4 then '2026-10-01T10:00:00.123455Z'::timestamptz
   else '2026-10-01T10:00:00Z'::timestamptz-n*interval '1 second' end,
  case when n%2=0 then 'exercise.updated' else 'RULE_VERSION_CREATED' end,
  case when n%2=0 then 'exercise' else 'SIGNAL_RULE_VERSION' end,
  case when n=25 then null else ('94000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid end,
  case when n=25 then 'HISTORICAL_CUSTOM_RESULT' else 'SUCCEEDED' end,gen_random_uuid(),gen_random_uuid(),
  jsonb_build_object('code','AUDIT_CODE_SENTINEL','token','AUDIT_SECRET_SENTINEL','prompt','AUDIT_PROMPT_SENTINEL',
   'tests','AUDIT_HIDDEN_SENTINEL','email','AUDIT_EMAIL_SENTINEL') from generate_series(1,25) n;
insert into app.audit_events(id,organization_id,actor_id,occurred_at,action,entity_type,entity_id,result,correlation_id) values
 ('93000000-0000-4000-8000-000000000101','92000000-0000-4000-8000-000000000002',pg_temp.audit_actor(4),
  '2026-10-01T10:00:00.123456Z','FOREIGN_ACTION','foreign_entity','94000000-0000-4000-8000-000000000101','SUCCEEDED',gen_random_uuid());
set constraints app.provisioning_complete immediate;

create temp table audit_read_results(label text primary key,payload jsonb);
grant select,insert on audit_read_results to alunza_app;
insert into audit_read_results values('original',(
 select jsonb_build_object('count',count(*),'digest',md5(jsonb_agg(to_jsonb(e) order by id)::text))
 from app.audit_events e where organization_id in ('92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002')));

select ok((select not rolsuper and not rolbypassrls and not rolcanlogin from pg_roles where rolname='alunza_identity'),'audit reader owner is constrained');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app_private' and (p.proname like 'audit_read_%' or p.proname='audit_events_list')
 and (pg_get_userbyid(p.proowner)<>'alunza_identity' or not p.proconfig @> array['search_path=pg_catalog'] or p.provolatile not in ('s','i'))),
 'audit functions have constrained owner, fixed search path and read-only volatility');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated','service_role']) r
 where n.nspname='app_private' and (p.proname like 'audit_read_%' or p.proname='audit_events_list') and has_function_privilege(r,p.oid,'EXECUTE')),
 'Data API roles cannot execute audit entrypoint or helpers');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app_private' and (p.proname like 'audit_read_%' or p.proname='audit_events_list')
 and has_function_privilege('alunza_app',p.oid,'EXECUTE')<>(p.proname='audit_events_list')),
 'runtime can execute only the audit list entrypoint');
select ok(not has_table_privilege('alunza_app','app.audit_events','UPDATE,DELETE,TRUNCATE'),'audit stays append-only for runtime');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='app.audit_events'::regclass),'audit keeps forced RLS');
select ok(exists(select 1 from pg_indexes where schemaname='app' and tablename='audit_events'
 and indexname='audit_events_org_time_idx' and indexdef like '%(organization_id, occurred_at DESC, id)%'),'existing organization/time/ID index is retained');
select ok(not pg_has_role('alunza_app','alunza_identity','SET') and not pg_has_role('alunza_app','alunza_identity','USAGE'),'runtime cannot assume reader owner');

set local role alunza_app;
select pg_temp.audit_context(1);
insert into audit_read_results values
 ('default',pg_temp.audit_query()),
 ('first',pg_temp.audit_query('{"limit":3,"asOf":"2026-10-01T10:00:00.123456Z"}')),
 ('all',pg_temp.audit_query('{"limit":100,"asOf":"2026-10-01T10:00:00.123456Z"}'));
select is((select payload->>'organizationId' from audit_read_results where label='first'),'92000000-0000-4000-8000-000000000001','response scope is authorized organization');
select is((select payload->>'asOf' from audit_read_results where label='first'),'2026-10-01T10:00:00.123456Z','cutoff retains all microseconds');
select is((select jsonb_array_length(payload->'items') from audit_read_results where label='default'),20,'default page contains 20 rows');
select ok((select (payload->>'asOf')::timestamptz<=statement_timestamp() and (payload->>'asOf')::timestamptz>=transaction_timestamp() from audit_read_results where label='default'),'default cutoff comes from database clock');
select is((select payload#>>'{page,totalFiltered}' from audit_read_results where label='first'),'25','total is filtered before pagination and excludes B');
select is((select payload#>>'{page,hasMore}' from audit_read_results where label='first'),'true','first page reports continuation');
select is((select payload#>>'{items,0,eventId}' from audit_read_results where label='first'),'93000000-0000-4000-8000-000000000001','timestamp ties order by ascending UUID');
select is((select payload#>>'{items,2,eventId}' from audit_read_results where label='first'),'93000000-0000-4000-8000-000000000003','first page includes all three exact timestamp ties');
select is(pg_temp.audit_query(jsonb_build_object('limit',1,'asOf','2026-10-01T10:00:00.123456Z','cursor',
 pg_temp.audit_query('{"limit":1,"asOf":"2026-10-01T10:00:00.123456Z"}')#>>'{page,nextCursor}'))#>>'{items,0,eventId}',
 '93000000-0000-4000-8000-000000000002','keyset advances within an exact timestamp tie');
select is((with recursive pages(position,payload) as (
 select 1,pg_temp.audit_query('{"limit":4,"asOf":"2026-10-01T10:00:00.123456Z"}')
 union all
 select position+1,pg_temp.audit_query(jsonb_build_object('limit',4,'asOf','2026-10-01T10:00:00.123456Z','cursor',payload#>>'{page,nextCursor}'))
 from pages where payload#>>'{page,hasMore}'='true' and position<10
 ) select jsonb_agg(item->>'eventId' order by position,ordinality) from pages cross join lateral jsonb_array_elements(payload->'items') with ordinality e(item,ordinality)),
 (select jsonb_agg('93000000-0000-4000-8000-'||lpad(n::text,12,'0') order by n) from generate_series(1,25) n),
 'all pages visit the expected ordered set exactly once');
insert into audit_read_results values('second',pg_temp.audit_query(jsonb_build_object('limit',3,'asOf','2026-10-01T10:00:00.123456Z',
 'cursor',(select payload#>>'{page,nextCursor}' from audit_read_results where label='first'))));
select is((select payload#>>'{items,0,eventId}' from audit_read_results where label='second'),'93000000-0000-4000-8000-000000000004','next page keeps one-microsecond-older record');
select is((select payload#>>'{items,0,occurredAt}' from audit_read_results where label='second'),'2026-10-01T10:00:00.123455Z','event timestamp preserves microsecond precision');
select is((select payload#>>'{page,totalFiltered}' from audit_read_results where label='second'),'25','continuation reports the full filtered total');
select ok(not exists(select 1 from audit_read_results a cross join lateral jsonb_array_elements(a.payload->'items') x
 join audit_read_results b on b.label='second' cross join lateral jsonb_array_elements(b.payload->'items') y
 where a.label='first' and x->>'eventId'=y->>'eventId'),'adjacent pages do not repeat events');
select is((select payload#>>'{page,hasMore}' from audit_read_results where label='all'),'false','complete set has no continuation');
select is((select payload#>'{page,nextCursor}' from audit_read_results where label='all'),'null'::jsonb,'last page cursor is null');
select is((select jsonb_array_length(payload->'items') from audit_read_results where label='all'),25,'maximum page returns entire small set');
select ok(not exists(select 1 from audit_read_results r cross join lateral jsonb_array_elements(r.payload->'items') e
 where e-array['eventId','occurredAt','actorId','action','entityType','entityId','organizationId','outcome']<>'{}'::jsonb
 or not e ?& array['eventId','occurredAt','actorId','action','entityType','entityId','organizationId','outcome']),
 'every row contains exactly the eight permitted fields');
select ok(not exists(select 1 from audit_read_results where label<>'original' and payload::text~'AUDIT_(CODE|SECRET|PROMPT|HIDDEN|EMAIL)_SENTINEL|safe_changes|actorKind|correlationId|requestId'),
 'projection excludes arbitrary metadata, actor kind and private correlation identifiers');
select is((select payload#>'{items,24,actorId}' from audit_read_results where label='all'),'null'::jsonb,'null actor remains null');
select is((select payload#>'{items,24,entityId}' from audit_read_results where label='all'),'null'::jsonb,'null entity identifier remains null');
select is((select payload#>>'{items,24,outcome}' from audit_read_results where label='all'),'HISTORICAL_CUSTOM_RESULT','historical result is preserved without invented enum');
select is((select payload#>>'{items,23,actorId}' from audit_read_results where label='all'),pg_temp.audit_actor(7)::text,'actor outside current roster does not erase historical event');

select is(pg_temp.audit_query('{"from":"2026-10-01T10:00:00.123456Z","asOf":"2026-10-01T10:00:00.123456Z"}')#>>'{page,totalFiltered}','3','from and asOf boundaries are inclusive');
select is(pg_temp.audit_query('{"from":"2026-10-01T10:00:00.123455Z","asOf":"2026-10-01T10:00:00.123456Z"}')#>>'{page,totalFiltered}','4','microsecond lower boundary is exact');
select is(pg_temp.audit_query('{"from":"2026-10-01T07:00:00.123456-03:00","asOf":"2026-10-01T10:00:00.123456Z"}')#>>'{page,totalFiltered}','3','explicit timezone offsets normalize to the same instant');
select is(pg_temp.audit_query(jsonb_build_object('actorId',pg_temp.audit_actor(2)))#>>'{page,totalFiltered}','23','actor filter matches persisted actor IDs');
select is(pg_temp.audit_query('{"action":"exercise.updated"}')#>>'{page,totalFiltered}','12','action filter is exact');
select is(pg_temp.audit_query('{"entityType":"SIGNAL_RULE_VERSION"}')#>>'{page,totalFiltered}','13','entity type filter is exact');
select is(pg_temp.audit_query('{"entityId":"94000000-0000-4000-8000-000000000004"}')#>>'{page,totalFiltered}','1','entity identifier filter is exact');
select is(pg_temp.audit_query(jsonb_build_object('from','2026-10-01T10:00:00.123455Z','asOf','2026-10-01T10:00:00.123456Z',
 'actorId',pg_temp.audit_actor(2),'action','exercise.updated','entityType','exercise','entityId','94000000-0000-4000-8000-000000000004'))#>>'{page,totalFiltered}','1',
 'all filters compose before count and page');
select is(pg_temp.audit_query('{"action":"exercise.%"}')#>>'{page,totalFiltered}','0','action is not a SQL wildcard');
select is(pg_temp.audit_query('{"action":"EXERCISE.UPDATED"}')#>>'{page,totalFiltered}','0','action comparison preserves case');
select is(pg_temp.audit_query('{"action":" exercise.updated "}')#>>'{page,totalFiltered}','0','action is not silently trimmed');
select is(pg_temp.audit_query(jsonb_build_object('actorId',pg_temp.audit_actor(4)))#>>'{page,totalFiltered}','0','foreign actor filter is indistinguishable from unknown actor');
select is(pg_temp.audit_query('{"actorId":"91000000-0000-4000-8000-999999999999"}')#>>'{page,totalFiltered}','0','unknown valid actor yields empty set');
select is(pg_temp.audit_query('{"entityId":"94000000-0000-4000-8000-000000000101"}')#>>'{page,totalFiltered}','0','foreign entity filter yields empty set without lookup');
select is(pg_temp.audit_query('{"entityType":"unknown"}')#>>'{items}','[]','unknown entity type yields explicit empty items');
select is(pg_temp.audit_query('{"action":"unknown"}')#>'{page}','{"hasMore":false,"nextCursor":null,"totalFiltered":0}'::jsonb,'empty response is a successful complete page');

select throws_ok($$select pg_temp.audit_query(null)$$,'P0001','AUDIT_FILTER_INVALID','SQL rejects null options');
select throws_ok($$select pg_temp.audit_query('[]')$$,'P0001','AUDIT_FILTER_INVALID','SQL rejects array options');
select throws_ok($$select pg_temp.audit_query('{"limit":"20"}')$$,'P0001','AUDIT_FILTER_INVALID','SQL requires normalized numeric limit');
select throws_ok($$select pg_temp.audit_query('{"limit":0}')$$,'P0001','AUDIT_FILTER_INVALID','SQL enforces minimum limit');
select throws_ok($$select pg_temp.audit_query('{"limit":101}')$$,'P0001','AUDIT_FILTER_INVALID','SQL enforces maximum limit');
select throws_ok($$select pg_temp.audit_query('{"limit":1.5}')$$,'P0001','AUDIT_FILTER_INVALID','SQL rejects fractional limit');
select throws_ok($$select pg_temp.audit_query('{"limit":99999999999999999999}')$$,'P0001','AUDIT_FILTER_INVALID','oversized limit produces controlled failure');
select throws_ok($$select pg_temp.audit_query('{"action":null}')$$,'P0001','AUDIT_FILTER_INVALID','SQL rejects explicit null filters');
select throws_ok($$select pg_temp.audit_query('{"action":true}')$$,'P0001','AUDIT_FILTER_INVALID','SQL rejects non-string filters');
select throws_ok($$select pg_temp.audit_query('{"action":""}')$$,'P0001','AUDIT_FILTER_INVALID','SQL rejects empty action');
select throws_ok($$select pg_temp.audit_query(jsonb_build_object('entityType',repeat('x',101)))$$,'P0001','AUDIT_FILTER_INVALID','SQL caps entity type at persisted maximum');
select lives_ok($$select pg_temp.audit_query(jsonb_build_object('action',repeat('x',100)))$$,'SQL allows 100-character action filter');
select throws_ok($$select pg_temp.audit_query('{"safe_changes":"code"}')$$,'P0001','AUDIT_FILTER_INVALID','SQL rejects private metadata selectors');
select throws_ok($$select pg_temp.audit_query('{"organizationId":"92000000-0000-4000-8000-000000000002"}')$$,'P0001','AUDIT_FILTER_INVALID','query cannot override organization scope');
select throws_ok($$select pg_temp.audit_query('{"actorId":"not-a-uuid"}')$$,'P0001','AUDIT_FILTER_INVALID','invalid actor UUID is controlled');
select throws_ok($$select pg_temp.audit_query('{"entityId":"94000000000040008000000000000004"}')$$,'P0001','AUDIT_FILTER_INVALID','UUID input uses canonical hyphenated shape');
select throws_ok($$select pg_temp.audit_query('{"from":"2026-10-02T00:00:00Z","asOf":"2026-10-01T00:00:00Z"}')$$,'P0001','AUDIT_PERIOD_INVALID','reversed period is rejected');
select throws_ok($$select pg_temp.audit_query('{"from":"2026-02-30T00:00:00Z"}')$$,'P0001','AUDIT_FILTER_INVALID','impossible date is rejected');
select throws_ok($$select pg_temp.audit_query('{"asOf":"2026-10-01"}')$$,'P0001','AUDIT_FILTER_INVALID','cutoff requires explicit instant');
select throws_ok($$select pg_temp.audit_query('{"asOf":"2026-10-01T10:00:00"}')$$,'P0001','AUDIT_FILTER_INVALID','cutoff requires explicit timezone');
select throws_ok($$select pg_temp.audit_query('{"asOf":"2026-10-01T24:00:00Z"}')$$,'P0001','AUDIT_FILTER_INVALID','SQL rejects hour 24 instead of normalizing to tomorrow');
select throws_ok($$select pg_temp.audit_query('{"asOf":"2026-10-01T10:00:60Z"}')$$,'P0001','AUDIT_FILTER_INVALID','SQL rejects second 60 instead of normalizing to next minute');
select throws_ok($$select pg_temp.audit_query('{"asOf":"infinity"}')$$,'P0001','AUDIT_FILTER_INVALID','infinite date is not a valid public instant');
select throws_ok($$select pg_temp.audit_query('{"asOf":"2026-10-01T10:00:00.1234567Z"}')$$,'P0001','AUDIT_FILTER_INVALID','unsupported fractional precision is not silently rounded');
select throws_ok($$select pg_temp.audit_query(jsonb_build_object('asOf',to_char((statement_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))$$,
 'P0001','INVALID_PROGRESS_CUTOFF','future cutoff is rejected');
select throws_ok($$select pg_temp.audit_query('{"asOf":"2026-10-01T10:00:00.123456Z","cursor":"bogus"}')$$,'P0001','AUDIT_CURSOR_INVALID','malformed cursor is controlled');
select throws_ok($$select pg_temp.audit_query(jsonb_build_object('cursor',(select payload#>>'{page,nextCursor}' from audit_read_results where label='first')))$$,
 'P0001','AUDIT_CURSOR_INVALID','continuation requires explicit original cutoff');
select throws_ok($$select pg_temp.audit_query(jsonb_build_object('asOf','2026-10-01T10:00:00.123455Z','cursor',(select payload#>>'{page,nextCursor}' from audit_read_results where label='first')))$$,
 'P0001','AUDIT_CURSOR_INVALID','cursor is bound to cutoff');
select throws_ok($$select pg_temp.audit_query(jsonb_build_object('asOf','2026-10-01T10:00:00.123456Z','action','exercise.updated','cursor',(select payload#>>'{page,nextCursor}' from audit_read_results where label='first')))$$,
 'P0001','AUDIT_CURSOR_INVALID','cursor is bound to filters');
select throws_ok($$select pg_temp.audit_query(jsonb_build_object('asOf','2026-10-01T10:00:00.123456Z','cursor',pg_temp.audit_cursor_change(
 (select payload#>>'{page,nextCursor}' from audit_read_results where label='first'),array['key','id'],'"93000000-0000-4000-8000-000000000101"'::jsonb)))$$,
 'P0001','AUDIT_CURSOR_INVALID','foreign anchor cannot be injected into an authorized cursor');
select throws_ok($$select pg_temp.audit_query(jsonb_build_object('asOf','2026-10-01T10:00:00.123456Z','cursor',pg_temp.audit_cursor_change(
 (select payload#>>'{page,nextCursor}' from audit_read_results where label='first'),array['key','at'],'"2026-10-01T10:00:00.123455Z"'::jsonb)))$$,
 'P0001','AUDIT_CURSOR_INVALID','anchor timestamp must match persisted event exactly');
select throws_ok($$select pg_temp.audit_query(jsonb_build_object('asOf','2026-10-01T10:00:00.123456Z','cursor',pg_temp.audit_cursor_change(
 (select payload#>>'{page,nextCursor}' from audit_read_results where label='first'),array['v'],'2'::jsonb)))$$,
 'P0001','AUDIT_CURSOR_INVALID','unsupported cursor version is rejected');
select is(pg_temp.audit_query(jsonb_build_object('limit',1,'asOf','2026-10-01T07:00:00.123456-03:00',
 'cursor',(select payload#>>'{page,nextCursor}' from audit_read_results where label='first')))#>>'{items,0,eventId}',
 '93000000-0000-4000-8000-000000000004','equivalent timezone cutoff keeps cursor context and limit can change');

select throws_ok($$select pg_temp.audit_query('{}','92000000-0000-4000-8000-000000000002')$$,'P0001','RESOURCE_NOT_FOUND','foreign organization is not enumerable');
select throws_ok($$select pg_temp.audit_query('{"limit":0}','92000000-0000-4000-8000-000000000002')$$,'P0001','RESOURCE_NOT_FOUND','authorization precedes filter evaluation in SQL');
select throws_ok($$select pg_temp.audit_query('{}','92000000-0000-4000-8000-999999999999')$$,'P0001','RESOURCE_NOT_FOUND','unknown organization has same safe rejection');
select throws_ok($$select pg_temp.audit_query('{}',null)$$,'P0001','RESOURCE_NOT_FOUND','null organization fails closed');
select pg_temp.audit_context(5);
select throws_ok($$select pg_temp.audit_query(jsonb_build_object('asOf','2026-10-01T10:00:00.123456Z','cursor',(select payload#>>'{page,nextCursor}' from audit_read_results where label='first')))$$,
 'P0001','AUDIT_CURSOR_INVALID','cursor cannot transfer between authorized administrators');
select pg_temp.audit_context(2);
select throws_ok($$select pg_temp.audit_query()$$,'P0001','RESOURCE_NOT_FOUND','teacher cannot list operational audit');
select pg_temp.audit_context(3);
select throws_ok($$select pg_temp.audit_query()$$,'P0001','RESOURCE_NOT_FOUND','student cannot list operational audit');
select pg_temp.audit_context(6);
select throws_ok($$select pg_temp.audit_query()$$,'P0001','RESOURCE_NOT_FOUND','disabled administrator membership cannot list audit');
select pg_temp.audit_context(7);
select throws_ok($$select pg_temp.audit_query()$$,'P0001','RESOURCE_NOT_FOUND','historical actor without membership has no read permission');
select pg_temp.audit_context(1);
select set_config('app.session_id',pg_temp.audit_session(2)::text,true);
select throws_ok($$select pg_temp.audit_query()$$,'P0001','RESOURCE_NOT_FOUND','session belonging to another actor fails closed');
select set_config('app.session_id','',true);
select throws_ok($$select pg_temp.audit_query()$$,'P0001','RESOURCE_NOT_FOUND','missing session fails closed');
select pg_temp.audit_context(1);
select set_config('app.organization_id','92000000-0000-4000-8000-000000000002',true);
select throws_ok($$select pg_temp.audit_query()$$,'P0001','RESOURCE_NOT_FOUND','fixed transaction organization cannot be crossed');
select pg_temp.audit_context(4);
select is(pg_temp.audit_query('{}','92000000-0000-4000-8000-000000000002')#>>'{page,totalFiltered}','1','B administrator reads only B audit');
select throws_ok($$select pg_temp.audit_query()$$,'P0001','RESOURCE_NOT_FOUND','B administrator cannot read A audit');
reset role;

select is((select jsonb_build_object('count',count(*),'digest',md5(jsonb_agg(to_jsonb(e) order by id)::text))
 from app.audit_events e where organization_id in ('92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002')),
 (select payload from audit_read_results where label='original'),'all successful and rejected reads preserve audit rows byte-for-byte');

-- Newer rows are outside the original cutoff. Late visible rows inside the
-- cutoff can change a later read: this contract deliberately is not a snapshot.
insert into app.audit_events(id,organization_id,actor_id,occurred_at,action,entity_type,result,correlation_id) values
 ('93000000-0000-4000-8000-000000000201','92000000-0000-4000-8000-000000000001',pg_temp.audit_actor(1),
  '2026-10-01T10:00:00.123457Z','AFTER_CUT','organization','SUCCEEDED',gen_random_uuid()),
 ('93000000-0000-4000-8000-000000000202','92000000-0000-4000-8000-000000000001',pg_temp.audit_actor(1),
  '2026-10-01T10:00:00.123455Z','LATE_VISIBLE','organization','SUCCEEDED',gen_random_uuid());
set local role alunza_app;
select pg_temp.audit_context(1);
select is(pg_temp.audit_query('{"asOf":"2026-10-01T10:00:00.123456Z"}')#>>'{page,totalFiltered}','26','cut excludes newer event but includes late visible event');
select is(pg_temp.audit_query(jsonb_build_object('limit',2,'asOf','2026-10-01T10:00:00.123456Z','cursor',
 (select payload#>>'{page,nextCursor}' from audit_read_results where label='first')))#>>'{items,1,eventId}',
 '93000000-0000-4000-8000-000000000202','late visible event follows stable keyset position');
select is(pg_temp.audit_query('{"action":"AFTER_CUT","asOf":"2026-10-01T10:00:00.123456Z"}')#>>'{page,totalFiltered}','0','subsequent events cannot move into the original cutoff');
reset role;

update app.organization_memberships set state='DISABLED' where organization_id='92000000-0000-4000-8000-000000000001' and user_id=pg_temp.audit_actor(2);
set local role alunza_app;
select is(pg_temp.audit_query(jsonb_build_object('actorId',pg_temp.audit_actor(2)))#>>'{page,totalFiltered}','23','disabling historical actor preserves their events');
reset role;
update app.organization_memberships set state='DISABLED' where organization_id='92000000-0000-4000-8000-000000000001' and user_id=pg_temp.audit_actor(1);
set local role alunza_app;
select throws_ok($$select pg_temp.audit_query(jsonb_build_object('asOf','2026-10-01T10:00:00.123456Z','cursor',
 (select payload#>>'{page,nextCursor}' from audit_read_results where label='first')))$$,'P0001','RESOURCE_NOT_FOUND','revoked membership rejects old cursor and session');
reset role;
update app.organization_memberships set state='ACTIVE',role='TEACHER' where organization_id='92000000-0000-4000-8000-000000000001' and user_id=pg_temp.audit_actor(1);
set local role alunza_app;
select throws_ok($$select pg_temp.audit_query()$$,'P0001','RESOURCE_NOT_FOUND','role removal rejects still-active old administrator token');
reset role;
update app.organization_memberships set role='ADMIN' where organization_id='92000000-0000-4000-8000-000000000001' and user_id=pg_temp.audit_actor(1);
update app.profiles set account_state='DISABLED' where id=pg_temp.audit_actor(1);
set local role alunza_app;
select throws_ok($$select pg_temp.audit_query()$$,'P0001','RESOURCE_NOT_FOUND','disabled global profile rejects otherwise active administrator');
reset role;
update app.profiles set account_state='ACTIVE' where id=pg_temp.audit_actor(1);
delete from auth.sessions where id=pg_temp.audit_session(1);
set local role alunza_app;
select throws_ok($$select pg_temp.audit_query()$$,'P0001','RESOURCE_NOT_FOUND','revoked session rejects old identity');
reset role;

-- Archived fixture changes no production archival policy or historical row.
update app.organizations set archived_at=now(),archived_by=pg_temp.audit_actor(5) where id='92000000-0000-4000-8000-000000000001';
set local role alunza_app;
select pg_temp.audit_context(5);
select is(pg_temp.audit_query('{"asOf":"2026-10-01T10:00:00.123456Z"}')#>>'{page,totalFiltered}','26','current ADMIN retains archived organization audit read');
select throws_ok($$select app_private.audit_read_context('92000000-0000-4000-8000-000000000001')$$,'42501',null,'runtime cannot call private authorization helper');
select throws_ok($$update app.audit_events set result='ALTERED' where id='93000000-0000-4000-8000-000000000001'$$,'42501',null,'runtime cannot rewrite audit history');
select throws_ok($$delete from app.audit_events where id='93000000-0000-4000-8000-000000000001'$$,'42501',null,'runtime cannot delete audit history');
reset role;
select throws_ok($$update app.audit_events set result='ALTERED' where id='93000000-0000-4000-8000-000000000001'$$,'42501','AUDIT_APPEND_ONLY','append-only trigger still protects privileged writes');

select * from finish();
rollback;
