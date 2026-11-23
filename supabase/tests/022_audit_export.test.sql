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

create function pg_temp.ex_actor(n integer) returns uuid language sql immutable as $$
 select ('a1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.ex_session(n integer) returns uuid language sql immutable as $$
 select ('a1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.ex_context(n integer) returns void language plpgsql as $$
begin
 perform set_config('app.actor_id',coalesce(pg_temp.ex_actor(n)::text,''),true),
  set_config('app.session_id',coalesce(pg_temp.ex_session(n)::text,''),true),set_config('app.organization_id','',true);
end $$;
create temp table export_results(label text primary key,payload jsonb);
grant select,insert,update on export_results to alunza_app;
create function pg_temp.ex_id(label_value text) returns uuid language sql stable as $$
 select (payload->>'exportId')::uuid from export_results where label=label_value
$$;
create function pg_temp.ex_token(label_value text) returns uuid language sql stable as $$
 select (payload->>'leaseToken')::uuid from export_results where label=label_value
$$;
create function pg_temp.ex_reserve(key_value text,options_value jsonb default '{"asOf":"2026-10-01T10:00:00.123456Z"}') returns jsonb
language sql as $$ select app_private.audit_export_reserve('a2000000-0000-4000-8000-000000000001',key_value,options_value) $$;
create function pg_temp.ex_capture(label_value text) returns jsonb language sql as $$
 select app_private.audit_export_capture('a2000000-0000-4000-8000-000000000001',pg_temp.ex_id(label_value),pg_temp.ex_token(label_value))
$$;
-- SQL validates storage/fencing; the independent serializer suite verifies CSV.
create function pg_temp.ex_finish(label_value text,bytes_value bytea default convert_to(E'byte fixture,á\r\n','UTF8')) returns jsonb
language sql as $$
 select app_private.audit_export_finish('a2000000-0000-4000-8000-000000000001',pg_temp.ex_id(label_value),pg_temp.ex_token(label_value),
  (payload->>'snapshotAt')::timestamptz,bytes_value,jsonb_array_length(payload->'items'),encode(extensions.digest(bytes_value,'sha256'),'hex'))
 from export_results where label=label_value||'.snapshot'
$$;
create function pg_temp.ex_meta(label_value text) returns jsonb language sql stable as $$
 select app_private.audit_export_metadata('a2000000-0000-4000-8000-000000000001',pg_temp.ex_id(label_value))
$$;

insert into auth.users(id,email,email_confirmed_at)
 select pg_temp.ex_actor(n),'export-'||n||'@alunza.test',now() from generate_series(1,7) n;
insert into auth.sessions(id,user_id) select pg_temp.ex_session(n),pg_temp.ex_actor(n) from generate_series(1,7) n;
insert into app.profiles(id,display_name,email_normalized,account_state)
 select pg_temp.ex_actor(n),'Export actor '||n,'export-'||n||'@alunza.test','ACTIVE' from generate_series(1,7) n;
insert into app.organizations(id,code,name) values
 ('a2000000-0000-4000-8000-000000000001','EXPORT-A','Export A'),
 ('a2000000-0000-4000-8000-000000000002','EXPORT-B','Export B');
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at) values
 ('a2000000-0000-4000-8000-000000000001',pg_temp.ex_actor(1),'ADMIN','ACTIVE',now()),
 ('a2000000-0000-4000-8000-000000000001',pg_temp.ex_actor(2),'TEACHER','ACTIVE',now()),
 ('a2000000-0000-4000-8000-000000000001',pg_temp.ex_actor(3),'STUDENT','ACTIVE',now()),
 ('a2000000-0000-4000-8000-000000000002',pg_temp.ex_actor(4),'ADMIN','ACTIVE',now()),
 ('a2000000-0000-4000-8000-000000000001',pg_temp.ex_actor(5),'ADMIN','ACTIVE',now()),
 ('a2000000-0000-4000-8000-000000000001',pg_temp.ex_actor(6),'ADMIN','DISABLED',now());
insert into app.audit_events(id,organization_id,actor_id,occurred_at,action,entity_type,entity_id,result,correlation_id,safe_changes)
 select ('a3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'a2000000-0000-4000-8000-000000000001',
  case when n=5 then null else pg_temp.ex_actor(2) end,'2026-10-01T10:00:00.123456Z',
  case when n in (2,4) then 'UPDATE' else 'READ' end,case when n=5 then 'AUDIT_EXPORT' else 'exercise' end,
  case when n=5 then null else ('a4000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid end,
  'SUCCEEDED',gen_random_uuid(),'{"secret":"EXPORT_SECRET_SENTINEL","code":"EXPORT_CODE_SENTINEL"}'
 from generate_series(1,5) n;
insert into app.audit_events(organization_id,actor_id,occurred_at,action,entity_type,result,correlation_id) values
 ('a2000000-0000-4000-8000-000000000002',pg_temp.ex_actor(4),'2026-10-01T10:00:00Z','FOREIGN_ACTION','exercise','SUCCEEDED',gen_random_uuid());
set constraints app.provisioning_complete immediate;

select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app_private' and p.proname like 'audit_export_%'
 and (pg_get_userbyid(p.proowner)<>'alunza_identity' or not p.proconfig @> array['search_path=pg_catalog'])),
 'all export functions have constrained owner and fixed search path');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated','service_role']) r
 where n.nspname='app_private' and p.proname like 'audit_export_%' and has_function_privilege(r,p.oid,'EXECUTE')),
 'Data API roles cannot execute export functions');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app_private' and p.proname like 'audit_export_%' and has_function_privilege('alunza_app',p.oid,'EXECUTE') <>
 (p.proname in ('audit_export_authorize','audit_export_reserve','audit_export_capture','audit_export_finish','audit_export_fail',
  'audit_export_metadata','audit_export_content','audit_export_delivery_begin','audit_export_delivery_finish','audit_export_maintain'))),
 'runtime receives entrypoints but no helper execution');
select ok(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='app_private' and c.relname in ('audit_exports','audit_export_deliveries')
 and (not c.relrowsecurity or not c.relforcerowsecurity or pg_get_userbyid(c.relowner)='alunza_identity')),
 'private tables force RLS and do not make the helper role a table owner');
select ok(not has_table_privilege('alunza_app','app_private.audit_exports','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
 and not has_table_privilege('alunza_app','app_private.audit_export_deliveries','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
 'runtime cannot read content or forge export/delivery rows directly');
select ok(not has_table_privilege('alunza_identity','app_private.audit_exports','DELETE,TRUNCATE'),'helper can expire bytes but cannot delete evidence');
select ok(not pg_has_role('alunza_app','alunza_identity','SET'),'runtime cannot assume definer owner');

set local role alunza_app;
select pg_temp.ex_context(2);
select throws_ok($$select pg_temp.ex_reserve('teacher-key')$$,'P0001','RESOURCE_NOT_FOUND','teacher has no export governance access');
select pg_temp.ex_context(3);
select throws_ok($$select pg_temp.ex_reserve('student-key')$$,'P0001','RESOURCE_NOT_FOUND','student has no export access');
select pg_temp.ex_context(4);
select throws_ok($$select pg_temp.ex_reserve('foreign-key','{"unknown":true}')$$,'P0001','RESOURCE_NOT_FOUND','organization authorization precedes malformed filters');
select pg_temp.ex_context(6);
select throws_ok($$select pg_temp.ex_reserve('disabled-key')$$,'P0001','RESOURCE_NOT_FOUND','inactive membership rejected');
select pg_temp.ex_context(7);
select throws_ok($$select pg_temp.ex_reserve('nonmember-key')$$,'P0001','RESOURCE_NOT_FOUND','nonmember rejected');
select pg_temp.ex_context(null);
select throws_ok($$select pg_temp.ex_reserve('empty-context')$$,'P0001','RESOURCE_NOT_FOUND','internal empty actor cannot reserve');
select pg_temp.ex_context(1);
select lives_ok($$select app_private.audit_export_authorize('a2000000-0000-4000-8000-000000000001')$$,'ACTIVE administrator authorizes');
select throws_ok($$select pg_temp.ex_reserve('short')$$,'P0001','INVALID_REQUEST','key requires existing minimum length');
select throws_ok($$select pg_temp.ex_reserve('invalid key')$$,'P0001','INVALID_REQUEST','key rejects whitespace');
select throws_ok($$select pg_temp.ex_reserve('invalid-01','{}')$$,'P0001','AUDIT_FILTER_INVALID','explicit cutoff required');
select throws_ok($$select pg_temp.ex_reserve('invalid-02','{"asOf":"2026-10-01T00:00:00Z","cursor":"x"}')$$,'P0001','AUDIT_FILTER_INVALID','cursor not permitted in export');
select throws_ok($$select pg_temp.ex_reserve('invalid-03','{"asOf":"2026-10-01T00:00:00Z","limit":1}')$$,'P0001','AUDIT_FILTER_INVALID','pagination limit not permitted in export');
select throws_ok($$select pg_temp.ex_reserve('invalid-04','{"asOf":"2026-10-01T00:00:00Z","from":null}')$$,'P0001','AUDIT_FILTER_INVALID','explicit null filter rejected');
select throws_ok($$select pg_temp.ex_reserve('invalid-05','{"asOf":"2026-10-01T24:00:00Z"}')$$,'P0001','AUDIT_FILTER_INVALID','hour24 is not silently normalized');
select throws_ok($$select pg_temp.ex_reserve('invalid-06','{"asOf":"2026-10-01T00:00:60Z"}')$$,'P0001','AUDIT_FILTER_INVALID','second60 rejected');
select throws_ok($$select pg_temp.ex_reserve('invalid-07','{"asOf":"9999-10-01T00:00:00Z"}')$$,'P0001','INVALID_PROGRESS_CUTOFF','future cutoff rejected');
select throws_ok($$select pg_temp.ex_reserve('invalid-08','{"asOf":"2026-10-01T00:00:00Z","from":"2026-10-02T00:00:00Z"}')$$,'P0001','AUDIT_PERIOD_INVALID','inverted period rejected');
reset role;
select is((select count(*) from app_private.audit_exports where organization_id='a2000000-0000-4000-8000-000000000001'),0::bigint,
 'permission and input rejects create no reservations or terminal journals');
set local role alunza_app;
insert into export_results values('first',pg_temp.ex_reserve('first-key'));
select is((select payload->>'kind' from export_results where label='first'),'CLAIMED','valid request reserves one generation');
select throws_ok($$select pg_temp.ex_reserve('first-key')$$,'P0001','REQUEST_IN_PROGRESS','same running key is in progress');
select throws_ok($$select pg_temp.ex_reserve('other-key')$$,'P0001','RATE_LIMITED','another key cannot run for same actor and organization');
select throws_ok($$select pg_temp.ex_reserve('first-key','{"asOf":"2026-10-01T10:00:00.123456Z","action":"READ"}')$$,
 'P0001','IDEMPOTENCY_CONFLICT','same key changed filters conflict');
select throws_ok($$select app_private.audit_export_capture('a2000000-0000-4000-8000-000000000001',pg_temp.ex_id('first'),gen_random_uuid())$$,
 'P0001','AUDIT_EXPORT_INTERRUPTED','capture rejects wrong fence');
reset role;
insert into app.audit_events(organization_id,actor_id,occurred_at,action,entity_type,entity_id,result,correlation_id)
 values('a2000000-0000-4000-8000-000000000001',pg_temp.ex_actor(1),'2026-10-01T10:00:00Z','OWN_EXPORT_PROBE','AUDIT_EXPORT',pg_temp.ex_id('first'),'SUCCEEDED',gen_random_uuid());
set local role alunza_app;
insert into export_results values('first.snapshot',pg_temp.ex_capture('first'));
select is((select jsonb_array_length(payload->'items') from export_results where label='first.snapshot'),5,'full bounded set includes nullable AUDIT_EXPORT entity row');
select is((select payload#>>'{items,0,eventId}' from export_results where label='first.snapshot'),'a3000000-0000-4000-8000-000000000001','capture ties order by ascending UUID');
select is((select payload#>>'{items,0,occurredAt}' from export_results where label='first.snapshot'),'2026-10-01T10:00:00.123456Z','capture retains microseconds');
select is((select count(*)::integer from export_results r cross join jsonb_array_elements(r.payload->'items') i cross join jsonb_object_keys(i) k where r.label='first.snapshot'),40,
 'five captured rows expose exactly eight fields each');
select ok((select payload#>'{items,4,actorId}'='null'::jsonb and payload#>'{items,4,entityId}'='null'::jsonb from export_results where label='first.snapshot'),'nullable actor and entity preserved');
select ok((select payload::text !~ 'EXPORT_SECRET_SENTINEL|EXPORT_CODE_SENTINEL|safe_changes|FOREIGN_ACTION' from export_results where label='first.snapshot'),
 'capture excludes sensitive columns and foreign organization');
select throws_ok($$select pg_temp.ex_capture('first')$$,'P0001','REQUEST_IN_PROGRESS','claim cannot replace an established snapshot');
select throws_ok($$select pg_temp.ex_meta('first')$$,'P0001','REQUEST_IN_PROGRESS','RUNNING metadata does not expose bytes or partial output');
select throws_ok($$select app_private.audit_export_finish('a2000000-0000-4000-8000-000000000001',pg_temp.ex_id('first'),pg_temp.ex_token('first'),now(),decode('01','hex'),5,repeat('0',64))$$,
 'P0001','AUDIT_EXPORT_FAILED','finish rejects mismatched snapshot/hash');
insert into export_results values('first.ready',pg_temp.ex_finish('first'));
select is((select payload->>'rowCount' from export_results where label='first.ready'),'5','READY records captured count');
select is((select (payload->>'expiresAt')::timestamptz-(payload->>'generatedAt')::timestamptz from export_results where label='first.ready'),interval '24 hours','artifact TTL exactly24hours');
select is((select payload->>'formatVersion' from export_results where label='first.ready'),'audit-csv-v1','fixed format version');
select is(pg_temp.ex_reserve('first-key')->'metadata',(select payload from export_results where label='first.ready'),'same key returns exact original metadata');
select is(pg_temp.ex_meta('first'),(select payload from export_results where label='first.ready'),'metadata retains original snapshot');
select is((select content from app_private.audit_export_content('a2000000-0000-4000-8000-000000000001',pg_temp.ex_id('first'))),convert_to(E'byte fixture,á\r\n','UTF8'),'download returns exactly persisted bytes');
select lives_ok($$select app_private.audit_export_fail(pg_temp.ex_id('first'),pg_temp.ex_token('first'),'AUDIT_EXPORT_FAILED',503)$$,'late failure cannot undo READY');
select is(pg_temp.ex_meta('first')->>'state','READY','READY persists after late failure');
select pg_temp.ex_context(5);
select throws_ok($$select pg_temp.ex_meta('first')$$,'P0001','RESOURCE_NOT_FOUND','another ADMIN cannot read creator export');
select throws_ok($$select app_private.audit_export_content('a2000000-0000-4000-8000-000000000001',pg_temp.ex_id('first'))$$,'P0001','RESOURCE_NOT_FOUND','another ADMIN cannot download creator bytes');
select throws_ok($$select app_private.audit_export_delivery_begin('a2000000-0000-4000-8000-000000000001',pg_temp.ex_id('first'))$$,'P0001','RESOURCE_NOT_FOUND','another ADMIN cannot create creator delivery');
select pg_temp.ex_context(1);
reset role;
select is((select count(*) from app.audit_events where entity_id=pg_temp.ex_id('first') and action='AUDIT_EXPORT_GENERATED'),1::bigint,'generation audit emitted exactly once');
select is((select count(*) from app.audit_events where entity_id=pg_temp.ex_id('first') and action='AUDIT_EXPORT_FAILED'),0::bigint,'late failure emits no contradictory journal');

-- Each HTTP response attempt gets an independent fence; metadata/HEAD creates none.
set local role alunza_app;
insert into export_results values('ticket',app_private.audit_export_delivery_begin('a2000000-0000-4000-8000-000000000001',pg_temp.ex_id('first')));
select lives_ok($$select app_private.audit_export_delivery_finish((select (payload->>'ticketId')::uuid from export_results where label='ticket'),gen_random_uuid(),'FINISHED')$$,'unknown delivery fence is a no-op');
select app_private.audit_export_delivery_finish((select (payload->>'ticketId')::uuid from export_results where label='ticket'),(select (payload->>'ticketToken')::uuid from export_results where label='ticket'),'FINISHED');
select app_private.audit_export_delivery_finish((select (payload->>'ticketId')::uuid from export_results where label='ticket'),(select (payload->>'ticketToken')::uuid from export_results where label='ticket'),'ABORTED');
insert into export_results values('aborted',app_private.audit_export_delivery_begin('a2000000-0000-4000-8000-000000000001',pg_temp.ex_id('first')));
select app_private.audit_export_delivery_finish((select (payload->>'ticketId')::uuid from export_results where label='aborted'),(select (payload->>'ticketToken')::uuid from export_results where label='aborted'),'ABORTED');
insert into export_results values('unknown',app_private.audit_export_delivery_begin('a2000000-0000-4000-8000-000000000001',pg_temp.ex_id('first')));
reset role;
select is((select count(*) from app.audit_events where entity_id=pg_temp.ex_id('first') and action='AUDIT_EXPORT_DOWNLOADED' and result='FINISHED'),1::bigint,'finish callback journals once');
select is((select count(*) from app.audit_events where entity_id=pg_temp.ex_id('first') and action='AUDIT_EXPORT_DOWNLOADED' and result='ABORTED'),1::bigint,'disconnect is distinct from finished delivery');
update app_private.audit_export_deliveries set deadline_at=clock_timestamp()-interval '1 second'
 where id=(select (payload->>'ticketId')::uuid from export_results where label='unknown');
set local role alunza_app;
select pg_temp.ex_context(null);
select app_private.audit_export_maintain();
select app_private.audit_export_delivery_finish((select (payload->>'ticketId')::uuid from export_results where label='unknown'),(select (payload->>'ticketToken')::uuid from export_results where label='unknown'),'FINISHED');
reset role;
select is((select state from app_private.audit_export_deliveries where id=(select (payload->>'ticketId')::uuid from export_results where label='unknown')),'UNKNOWN','reconciliation fences late callback after uncertain delivery');
select is((select count(*) from app.audit_events where entity_id=pg_temp.ex_id('first') and action='AUDIT_EXPORT_DOWNLOADED'),3::bigint,'three attempts produce exactly three terminal delivery events');

-- Normalized representations share idempotency; exact text filters do not trim.
set local role alunza_app;
select pg_temp.ex_context(1);
insert into export_results values('normalized',pg_temp.ex_reserve('normalized-key','{"asOf":"2026-10-01T07:00:00.123456-03:00","actorId":"A1000000-0000-4000-8000-000000000002","action":"UPDATE"}'));
insert into export_results values('normalized.snapshot',pg_temp.ex_capture('normalized'));
select is((select jsonb_array_length(payload->'items') from export_results where label='normalized.snapshot'),2,'exact actor and action filters applied before count');
insert into export_results values('normalized.ready',pg_temp.ex_finish('normalized'));
select is(pg_temp.ex_reserve('normalized-key','{"action":"UPDATE","actorId":"a1000000-0000-4000-8000-000000000002","asOf":"2026-10-01T10:00:00.123456Z"}')->>'kind','READY','UUID case and UTC representation normalize idempotently');
insert into export_results values('empty',pg_temp.ex_reserve('empty-key','{"asOf":"2026-10-01T10:00:00.123456Z","actorId":"a1000000-0000-4000-8000-000000000004"}'));
insert into export_results values('empty.snapshot',pg_temp.ex_capture('empty'));
select is((select jsonb_array_length(payload->'items') from export_results where label='empty.snapshot'),0,'valid foreign actor filter is empty without global lookup');
insert into export_results values('empty.ready',pg_temp.ex_finish('empty'));
select is(pg_temp.ex_meta('empty')->>'rowCount','0','empty export persists as complete');

-- Reauthorization covers inactive profile/session and archive remains allowed.
reset role;
update app.profiles set account_state='DISABLED' where id=pg_temp.ex_actor(1);
set local role alunza_app;
select throws_ok($$select pg_temp.ex_meta('first')$$,'P0001','RESOURCE_NOT_FOUND','disabled profile cannot read an existing artifact');
select throws_ok($$select app_private.audit_export_delivery_begin('a2000000-0000-4000-8000-000000000001',pg_temp.ex_id('first'))$$,'P0001','RESOURCE_NOT_FOUND','delivery reauthorizes profile');
reset role;
update app.profiles set account_state='ACTIVE' where id=pg_temp.ex_actor(1);
delete from auth.sessions where id=pg_temp.ex_session(1);
set local role alunza_app;
select throws_ok($$select pg_temp.ex_meta('first')$$,'P0001','RESOURCE_NOT_FOUND','revoked session cannot read an existing artifact');
reset role;
insert into auth.sessions(id,user_id) values(pg_temp.ex_session(1),pg_temp.ex_actor(1));
update app.organizations set archived_at=now() where id='a2000000-0000-4000-8000-000000000001';
set local role alunza_app;
select lives_ok($$select pg_temp.ex_meta('first')$$,'archived organization permits authorized operational history');
reset role;
update app.organizations set archived_at=null where id='a2000000-0000-4000-8000-000000000001';

-- Expiry denies reads immediately and reconciliation removes bytes only once.
update app_private.audit_exports set generated_at=statement_timestamp()-interval '25 hours',expires_at=statement_timestamp()-interval '1 hour'
 where id=pg_temp.ex_id('first');
set local role alunza_app;
select throws_ok($$select pg_temp.ex_meta('first')$$,'P0001','AUDIT_EXPORT_EXPIRED','read denies expiry even before cleanup');
select throws_ok($$select app_private.audit_export_content('a2000000-0000-4000-8000-000000000001',pg_temp.ex_id('first'))$$,'P0001','AUDIT_EXPORT_EXPIRED','expired content not returned');
select throws_ok($$select app_private.audit_export_delivery_begin('a2000000-0000-4000-8000-000000000001',pg_temp.ex_id('first'))$$,'P0001','AUDIT_EXPORT_EXPIRED','expired artifact cannot create ticket');
select is(pg_temp.ex_reserve('first-key')#>>'{error,code}','AUDIT_EXPORT_EXPIRED','expired same key does not regenerate');
select pg_temp.ex_context(null);
select app_private.audit_export_maintain();
select app_private.audit_export_maintain();
reset role;
select is((select state from app_private.audit_exports where id=pg_temp.ex_id('first')),'EXPIRED','cleanup expires artifact');
select ok((select content is null and sha256 is not null and row_count=5 from app_private.audit_exports where id=pg_temp.ex_id('first')),'cleanup removes bytes and preserves artifact facts');
select is((select count(*) from app.audit_events where entity_id=pg_temp.ex_id('first') and action='AUDIT_EXPORT_EXPIRED'),1::bigint,'repeated cleanup has one expiration journal');

-- Failure is durable even after role revocation; a new key is required.
set local role alunza_app;
select pg_temp.ex_context(1);
insert into export_results values('failure',pg_temp.ex_reserve('failure-key'));
insert into export_results values('failure.snapshot',pg_temp.ex_capture('failure'));
reset role;
update app.organization_memberships set state='DISABLED' where organization_id='a2000000-0000-4000-8000-000000000001' and user_id=pg_temp.ex_actor(1);
set local role alunza_app;
select throws_ok($$select pg_temp.ex_finish('failure')$$,'P0001','RESOURCE_NOT_FOUND','finish reauthorizes after capture');
select pg_temp.ex_context(null);
select app_private.audit_export_fail(pg_temp.ex_id('failure'),pg_temp.ex_token('failure'),'AUDIT_EXPORT_FAILED',503);
select app_private.audit_export_fail(pg_temp.ex_id('failure'),pg_temp.ex_token('failure'),'AUDIT_EXPORT_FAILED',503);
reset role;
select is((select state from app_private.audit_exports where id=pg_temp.ex_id('failure')),'FAILED','internal fenced failure survives role revocation');
select is((select count(*) from app.audit_events where entity_id=pg_temp.ex_id('failure') and action='AUDIT_EXPORT_FAILED'),1::bigint,'duplicate failure callbacks are idempotent');
update app.organization_memberships set state='ACTIVE' where organization_id='a2000000-0000-4000-8000-000000000001' and user_id=pg_temp.ex_actor(1);
set local role alunza_app;
select pg_temp.ex_context(1);
select is(pg_temp.ex_reserve('failure-key')#>>'{error,code}','AUDIT_EXPORT_FAILED','same failed key reproduces durable code');
select throws_ok($$select pg_temp.ex_meta('failure')$$,'P0001','AUDIT_EXPORT_FAILED','metadata reproduces durable failure');
select throws_ok($$select app_private.audit_export_content('a2000000-0000-4000-8000-000000000001',pg_temp.ex_id('failure'))$$,'P0001','AUDIT_EXPORT_FAILED','failed content does not expose partial bytes');
insert into export_results values('lease',pg_temp.ex_reserve('lease-key'));
insert into export_results values('lease.snapshot',pg_temp.ex_capture('lease'));
reset role;
update app_private.audit_exports set lease_until=clock_timestamp()-interval '1 second' where id=pg_temp.ex_id('lease');
set local role alunza_app;
select throws_ok($$select pg_temp.ex_meta('lease')$$,'P0001','REQUEST_IN_PROGRESS','read-only metadata reports durable RUNNING until terminal reconciliation');
select throws_ok($$select pg_temp.ex_finish('lease')$$,'P0001','AUDIT_EXPORT_INTERRUPTED','expired fence cannot finish');
select app_private.audit_export_fail(pg_temp.ex_id('lease'),pg_temp.ex_token('lease'),'AUDIT_EXPORT_FAILED',503);
select is(pg_temp.ex_reserve('lease-key')#>>'{error,code}','AUDIT_EXPORT_INTERRUPTED','expired lease records interruption rather than generic failure');
insert into export_results values('maintenance',pg_temp.ex_reserve('maintenance-key'));
reset role;
update app_private.audit_exports set lease_until=clock_timestamp()-interval '1 second' where id=pg_temp.ex_id('maintenance');
set local role alunza_app;
select pg_temp.ex_context(null);
select app_private.audit_export_maintain();
select app_private.audit_export_maintain();
reset role;
select is((select error_code from app_private.audit_exports where id=pg_temp.ex_id('maintenance')),'AUDIT_EXPORT_INTERRUPTED','maintenance reconciles orphan generation');
select is((select count(*) from app.audit_events where entity_id=pg_temp.ex_id('maintenance') and action='AUDIT_EXPORT_FAILED'),1::bigint,'repeated maintenance preserves exactly one orphan terminal event');

-- The sentinel is returned to the serializer, never hidden as a partial CSV.
insert into app.audit_events(organization_id,actor_id,occurred_at,action,entity_type,entity_id,result,correlation_id)
 select 'a2000000-0000-4000-8000-000000000001',pg_temp.ex_actor(2),'2026-10-01T09:00:00Z',
  'MANY','exercise',gen_random_uuid(),'SUCCEEDED',gen_random_uuid() from generate_series(1,10001);
set local role alunza_app;
select pg_temp.ex_context(1);
insert into export_results values('limit',pg_temp.ex_reserve('limit-key','{"asOf":"2026-10-01T10:00:00Z","action":"MANY"}'));
insert into export_results values('limit.snapshot',pg_temp.ex_capture('limit'));
select is((select jsonb_array_length(payload->'items') from export_results where label='limit.snapshot'),10001,'capture returns10001 sentinel rows for over-limit detection');
select throws_ok($$select pg_temp.ex_finish('limit')$$,'P0001','AUDIT_EXPORT_LIMIT_EXCEEDED','SQL rejects storing over-limit rowcount');
select app_private.audit_export_fail(pg_temp.ex_id('limit'),pg_temp.ex_token('limit'),'AUDIT_EXPORT_LIMIT_EXCEEDED',422);
select is(pg_temp.ex_reserve('limit-key','{"asOf":"2026-10-01T10:00:00Z","action":"MANY"}')#>>'{error,code}','AUDIT_EXPORT_LIMIT_EXCEEDED','over-limit error is stable on same key');
insert into export_results values('bytes',pg_temp.ex_reserve('bytes-key','{"asOf":"2026-10-01T10:00:00Z","action":"NO_MATCH"}'));
insert into export_results values('bytes.snapshot',pg_temp.ex_capture('bytes'));
select throws_ok($$select pg_temp.ex_finish('bytes',convert_to(repeat('x',10485761),'UTF8'))$$,'P0001','AUDIT_EXPORT_LIMIT_EXCEEDED','byte cap includes complete serialized artifact');
select throws_ok($$select pg_temp.ex_finish('bytes',decode('','hex'))$$,'P0001','AUDIT_EXPORT_FAILED','empty byte payload cannot masquerade as header-only CSV');
insert into export_results values('bytes.ready',pg_temp.ex_finish('bytes',convert_to(repeat('x',10485760),'UTF8')));
select is(pg_temp.ex_meta('bytes')->>'byteLength','10485760','exact byte cap accepted');
reset role;
select ok((select content is null from app_private.audit_exports where id=pg_temp.ex_id('limit')),'over-limit failure retains no partial bytes');
select is((select count(*) from app.audit_events where entity_id=pg_temp.ex_id('limit') and action='AUDIT_EXPORT_GENERATED'),0::bigint,'over-limit request has no false generation journal');

-- Runtime cannot forge the new journals through its older direct INSERT grant.
set local role alunza_app;
select set_config('app.organization_id','a2000000-0000-4000-8000-000000000001',true);
select throws_ok($$insert into app.audit_events(organization_id,actor_id,action,entity_type,entity_id,result,correlation_id)
 values('a2000000-0000-4000-8000-000000000001',pg_temp.ex_actor(1),'AUDIT_EXPORT_GENERATED','AUDIT_EXPORT',pg_temp.ex_id('bytes'),'SUCCEEDED',gen_random_uuid())$$,
 '42501',null,'runtime cannot forge export audit event');
reset role;
select ok(not exists(select 1 from app.audit_events where entity_type='AUDIT_EXPORT' and action like 'AUDIT_EXPORT_%'
 and safe_changes::text ~ 'EXPORT_SECRET_SENTINEL|EXPORT_CODE_SENTINEL|leaseToken|ticketToken|idempotency|content'),
 'new journals contain no raw bytes, tokens, keys or source contents');
select is((select count(*) from app.audit_events where id::text like 'a3000000-%'),5::bigint,'existing source audit rows remain intact');
select * from finish();
rollback;
