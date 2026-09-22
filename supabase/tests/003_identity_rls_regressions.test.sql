begin;
-- Test connection may assume the runtime role only inside this rolled-back
-- transaction. This does not grant memberships to the application role.
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
select plan(9);

-- Legitimate identities, sessions and grants are fixture data; assertions run
-- through the actual runtime RLS role and real helper ownership.
insert into auth.users(id,email,email_confirmed_at) values
  ('10000000-0000-4000-8000-000000000001','rls-creator@alunza.test',now()),
  ('10000000-0000-4000-8000-000000000002','rls-disabled@alunza.test',now());
insert into auth.sessions(id,user_id) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
insert into app.profiles(id,display_name,email_normalized,account_state) values
  ('10000000-0000-4000-8000-000000000001','RLS creator','rls-creator@alunza.test','ACTIVE'),
  ('10000000-0000-4000-8000-000000000002','RLS disabled','rls-disabled@alunza.test','DISABLED');
insert into app.organizations(id,code,name) values
  ('30000000-0000-4000-8000-000000000001','RLS-OWN','Own RLS institution'),
  ('30000000-0000-4000-8000-000000000002','RLS-OTHER','Other RLS institution');
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at) values
  ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','ADMIN','ACTIVE',now());
insert into app.provisioning_grants(id,user_id,granted_by,reason,expires_at) values
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','SQL test','RLS boundary',now()+interval '1 day');
insert into app.organization_invitations(id,organization_id,email_normalized,role,invited_by,token_digest,generation) values
  ('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','rls-disabled@alunza.test','STUDENT','10000000-0000-4000-8000-000000000001',repeat('a',64),1);
insert into app.invitation_deliveries(invitation_id,organization_id,requested_by,kind) values
  ('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','INITIAL');

set local role alunza_app;
set local app.actor_id = '10000000-0000-4000-8000-000000000001';
set local app.session_id = '20000000-0000-4000-8000-000000000001';
set local app.organization_id = '30000000-0000-4000-8000-000000000002';
set local app.provisioning_grant_id = '40000000-0000-4000-8000-000000000001';
select ok(app_private.session_is_active('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001'), 'Scoped helper sees a genuine current Auth session');
set local app.session_id = '20000000-0000-4000-8000-000000000002';
select ok(not app_private.session_is_active('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'), 'A real session belonging to another actor fails closed');
set local app.session_id = '20000000-0000-4000-8000-000000000001';
select ok(app_private.provisioning_allowed(), 'Creator holds a legitimate unused provisioning permit');
select is((select count(*)::integer from app.organizations where id='30000000-0000-4000-8000-000000000002'),0,'A valid provisioning permit cannot read another institution');

reset role;
update app.provisioning_grants set consumed_at=now(),consumed_organization_id='30000000-0000-4000-8000-000000000001'
  where id='40000000-0000-4000-8000-000000000001';
set local role alunza_app;
set local app.organization_id = '30000000-0000-4000-8000-000000000001';
select ok(not app_private.provisioning_allowed(), 'Consumed provisioning permit carries no residual bootstrap authority');

set local app.actor_id = '10000000-0000-4000-8000-000000000002';
set local app.session_id = '20000000-0000-4000-8000-000000000002';
set local app.provisioning_grant_id = '';
set local app.invitation_id = '50000000-0000-4000-8000-000000000001';
set local app.invitation_generation = '1';
select set_config('app.invitation_token_digest',repeat('a',64),true);
select ok(app_private.invitation_matches(false), 'The credential and current delivery authorizer are otherwise valid');
select ok(not app_private.invitation_matches(), 'Invitation proof never reactivates a globally disabled recipient');
with changed as (update app.profiles set account_state='ACTIVE'
  where id='10000000-0000-4000-8000-000000000002' returning id)
select is((select count(*)::integer from changed),0,'RLS rejects global DISABLED to ACTIVE promotion');
select throws_ok($$insert into app.organization_memberships(organization_id,user_id,role,state,joined_at)
  values ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','STUDENT','ACTIVE',now())$$,
  '42501',null,'A disabled recipient cannot create an ACTIVE institutional membership');

reset role;
select * from finish();
rollback;
