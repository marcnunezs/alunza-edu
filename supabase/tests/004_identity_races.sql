begin;
-- Harness-only permission disappears with the final ROLLBACK.
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
set local search_path = public, extensions;
select plan(15);

-- These are direct runtime-role transaction/scope checks. The actual concurrent
-- last-admin/archive/acceptance races run in the API integration suite.
insert into auth.users(id,email) values
  ('61000000-0000-4000-8000-000000000001','sql-boundary-one@alunza.test'),
  ('61000000-0000-4000-8000-000000000002','sql-boundary-two@alunza.test');
insert into app.profiles(id,display_name,email_normalized,account_state) values
  ('61000000-0000-4000-8000-000000000001','Boundary one','sql-boundary-one@alunza.test','ACTIVE'),
  ('61000000-0000-4000-8000-000000000002','Boundary two','sql-boundary-two@alunza.test','ACTIVE');
insert into app.organizations(id,code,name) values
  ('62000000-0000-4000-8000-000000000001','BOUNDARY-OWN','Before transaction'),
  ('62000000-0000-4000-8000-000000000002','BOUNDARY-OTHER','Foreign institution');
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at) values
  ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','ADMIN','ACTIVE',now()),
  ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002','ADMIN','ACTIVE',now());

set local role alunza_app;
set local app.actor_id = '61000000-0000-4000-8000-000000000001';
set local app.organization_id = '62000000-0000-4000-8000-000000000002';
with changed as (update app.organizations set name='Cross-scope overwrite'
  where id='62000000-0000-4000-8000-000000000002' returning id)
select is((select count(*)::integer from changed),0,'Supplying a foreign context does not authorize organization writes');
select throws_ok($$insert into app.organization_invitations(organization_id,email_normalized,role,invited_by)
  values ('62000000-0000-4000-8000-000000000002','victim@alunza.test','ADMIN','61000000-0000-4000-8000-000000000001')$$,
  '42501',null,'An administrator cannot invite into a foreign context');
select throws_ok($$insert into app.audit_events(organization_id,actor_id,action,entity_type,result,correlation_id)
  values ('62000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001','boundary.test','organization','SUCCEEDED',gen_random_uuid())$$,
  '42501',null,'Merely selecting a foreign context cannot authorize fabricated audit history');

set local app.organization_id = '62000000-0000-4000-8000-000000000001';
select throws_ok($$insert into app.operation_keys(organization_id,actor_id,operation,key,payload_hash)
  values ('62000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001','boundary.test','foreign-operation',repeat('b',64))$$,
  '42501',null,'A caller cannot put an idempotency record in a different scope');
select throws_ok($$insert into app.audit_events(organization_id,actor_id,action,entity_type,result,correlation_id)
  values ('62000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001','boundary.test','organization','SUCCEEDED',gen_random_uuid())$$,
  '42501',null,'An audit event cannot claim a different scope from its transaction');

insert into app.operation_keys(id,organization_id,actor_id,operation,key,payload_hash,state,response_status,response_body)
  values ('63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','boundary.test','same-operation',repeat('b',64),'COMPLETED',200,'{"state":"preserved"}');
select throws_ok($$insert into app.operation_keys(organization_id,actor_id,operation,key,payload_hash)
  values ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','boundary.test','same-operation',repeat('b',64))$$,
  '23505',null,'The same scoped operation key cannot produce a second durable record');
select throws_ok($$update app.operation_keys set organization_id='62000000-0000-4000-8000-000000000002'
  where id='63000000-0000-4000-8000-000000000001'$$,
  '42501',null,'A durable operation cannot be moved to another institution');

set local app.actor_id = '61000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from app.operation_keys where id='63000000-0000-4000-8000-000000000001'),0,
  'A different ADMIN in the same institution cannot read another actor replay cache');
with changed as (update app.operation_keys set response_body='{"state":"overwritten"}'
  where id='63000000-0000-4000-8000-000000000001' returning id)
select is((select count(*)::integer from changed),0,'A different ADMIN cannot replace another actor replay response');

set local app.actor_id = '61000000-0000-4000-8000-000000000001';
savepoint paired_mutation;
update app.organizations set name='Within transaction' where id='62000000-0000-4000-8000-000000000001';
insert into app.audit_events(organization_id,actor_id,action,entity_type,result,correlation_id)
  values ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','boundary.paired_change','organization','SUCCEEDED','64000000-0000-4000-8000-000000000001');
-- A savepoint rollback rolls back pgTAP counters as well, so observe the pair
-- inside a DO block and place counted assertions after rolling back.
do $$ begin
  if not exists (select 1 from app.organizations where id='62000000-0000-4000-8000-000000000001' and name='Within transaction')
    or not exists (select 1 from app.audit_events where correlation_id='64000000-0000-4000-8000-000000000001') then
    raise exception 'Expected the mutation and audit together before rollback';
  end if;
end $$;
rollback to savepoint paired_mutation;
select is((select name from app.organizations where id='62000000-0000-4000-8000-000000000001'),'Before transaction',
  'Rollback restores the institutional mutation');
select is((select count(*)::integer from app.audit_events where correlation_id='64000000-0000-4000-8000-000000000001'),0,
  'Rollback also removes its uncommitted audit event');
select is((select response_body->>'state' from app.operation_keys where id='63000000-0000-4000-8000-000000000001'),'preserved',
  'Alternating actors in one connection leaves the original replay response intact');

insert into app.operation_keys(id,organization_id,actor_id,operation,key,payload_hash,state,response_status,response_body,resource_id,expires_at)
  values ('63000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','boundary.expired','expired-operation',repeat('c',64),'COMPLETED',201,'{"state":"expired"}','62000000-0000-4000-8000-000000000001',now()-interval '1 day');
select ok(app_private.purge_expired_operation_responses() >= 1,'The bounded cleanup removes an expired response');
select ok((select response_body is null and key='expired-operation' and payload_hash=repeat('c',64)
  and resource_id='62000000-0000-4000-8000-000000000001' and response_status=201 and state='COMPLETED'
  from app.operation_keys where id='63000000-0000-4000-8000-000000000002'),
  'Cleanup preserves the operation key, hash, outcome and resource link');
select is((select response_body->>'state' from app.operation_keys where id='63000000-0000-4000-8000-000000000001'),'preserved',
  'Cleanup leaves a response inside its retention window intact');

reset role;
select * from finish();
rollback;
