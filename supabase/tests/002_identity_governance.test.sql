begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(27);

select ok((select not rolcanlogin and not rolinherit and not rolsuper
  and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls
  from pg_roles where rolname = 'alunza_identity'), 'Internal identity helpers have no elevated/login role');
select is((select count(*)::integer from pg_auth_members am
  join pg_roles r on r.oid = am.member where r.rolname = 'alunza_app'), 0,
  'Application cannot SET ROLE to the internal helper');
select is((select count(*)::integer from pg_class c join pg_roles r on r.oid = c.relowner
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('app','auth') and r.rolname = 'alunza_identity'), 0,
  'Internal helper does not own domain or Auth tables');
select ok(not has_schema_privilege('anon','app_private','USAGE'), 'Anonymous clients cannot invoke internal helpers');
select ok(not has_schema_privilege('authenticated','app_private','USAGE'), 'Browser Auth role cannot invoke internal helpers');
select ok(not has_schema_privilege('service_role','app_private','USAGE'), 'Auth Admin does not enter the domain helper schema');
select ok(not has_table_privilege('alunza_app','auth.users','SELECT'), 'Runtime cannot read the Auth user directory');
select ok(not has_table_privilege('alunza_app','auth.sessions','SELECT'), 'Runtime cannot read session records');
select ok(has_schema_privilege('alunza_identity','auth','USAGE'), 'Managed Auth owner bootstrapped helper schema access');
select ok(has_column_privilege('alunza_identity','auth.sessions','id','SELECT')
  and has_column_privilege('alunza_identity','auth.sessions','user_id','SELECT'), 'Helper can read only the session identity columns it requires');
select ok(has_column_privilege('alunza_identity','auth.users','id','SELECT')
  and has_column_privilege('alunza_identity','auth.users','email','SELECT')
  and has_column_privilege('alunza_identity','auth.users','email_confirmed_at','SELECT'), 'Helper can read the confirmed recipient identity');
select ok(not has_column_privilege('alunza_identity','auth.users','encrypted_password','SELECT'), 'Helper cannot read Auth password material');
select is((select count(*)::integer from pg_policies
  where schemaname='auth' and tablename in ('users','sessions') and cmd='SELECT'
    and roles=array['alunza_identity']::name[]),2,'Managed Auth grants are paired with helper-only SELECT policies');
select ok(has_function_privilege('alunza_app','app_private.session_is_active(uuid,uuid)','EXECUTE'), 'Runtime can ask only the scoped session helper');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner where n.nspname = 'app_private' and p.prosecdef
  and (r.rolbypassrls or r.rolsuper or r.rolcanlogin)), 0, 'No definer function runs with privileged/login ownership');
select ok((select bool_and('search_path=pg_catalog' = any(p.proconfig)) from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app_private'), 'Every helper fixes its search path');
select ok(not has_column_privilege('alunza_app','app.organization_memberships','organization_id','UPDATE'), 'Membership scope is not writable');
select ok(not has_column_privilege('alunza_app','app.organization_invitations','email_normalized','UPDATE'), 'Invitation recipient is immutable');
select ok(not has_column_privilege('alunza_app','app.provisioning_grants','user_id','UPDATE'), 'A provisioning grant cannot change recipient');
select ok(not has_table_privilege('alunza_app','app.audit_events','UPDATE,DELETE,TRUNCATE'), 'Runtime audit is append-only');
select ok(not app_private.session_is_active('01111111-1111-4111-8111-111111111111'::uuid,
  '02222222-2222-4222-8222-222222222222'::uuid), 'Absent actor/session context fails closed');
select is((select count(*)::integer from app_private.invitation_context(
  '03333333-3333-4333-8333-333333333333'::uuid, repeat('a',64), 1)), 0, 'Unknown invitation credential reveals no context');
select ok(not coalesce(app_private.worker_lease_valid(),false), 'No worker lease is valid without context');

insert into auth.users(id,email) values ('04444444-4444-4444-8444-444444444444','sql-identity@alunza.test');
insert into app.profiles(id,display_name,email_normalized,account_state)
  values ('04444444-4444-4444-8444-444444444444','SQL identity','sql-identity@alunza.test','ACTIVE');
insert into app.organizations(id,code,name) values ('05555555-5555-4555-8555-555555555555','SQL-IDENTITY','SQL identity');
insert into app.organization_memberships(organization_id,user_id,role,state) values
  ('05555555-5555-4555-8555-555555555555','04444444-4444-4444-8444-444444444444','ADMIN','ACTIVE');
select throws_ok($$insert into app.organization_invitations(organization_id,email_normalized,role,invited_by,token_digest,generation)
  values ('05555555-5555-4555-8555-555555555555','target@alunza.test','STUDENT','04444444-4444-4444-8444-444444444444','usable-plaintext',1)$$,
  '23514', null, 'Invitation tokens require a digest');
insert into app.organization_invitations(id,organization_id,email_normalized,role,invited_by)
  values ('06666666-6666-4666-8666-666666666666','05555555-5555-4555-8555-555555555555','target@alunza.test','STUDENT','04444444-4444-4444-8444-444444444444');
select throws_ok($$insert into app.organization_invitations(organization_id,email_normalized,role,invited_by)
  values ('05555555-5555-4555-8555-555555555555','target@alunza.test','TEACHER','04444444-4444-4444-8444-444444444444')$$,
  '23505', null, 'Only one pending invitation can target an email in an organization');
select throws_ok($$update app.organization_invitations set email_normalized='other@alunza.test'
  where id='06666666-6666-4666-8666-666666666666'$$,'23514','IMMUTABLE_SCOPE','Recipient immutability survives privileged fixture access');
insert into app.audit_events(organization_id,actor_id,action,entity_type,result,correlation_id)
  values ('05555555-5555-4555-8555-555555555555','04444444-4444-4444-8444-444444444444','SQL_TEST','organization','SUCCESS',gen_random_uuid());
select throws_ok($$delete from app.audit_events where organization_id='05555555-5555-4555-8555-555555555555'$$,
  '42501','AUDIT_APPEND_ONLY','Audit history rejects deletion even outside product roles');

select * from finish();
rollback;
