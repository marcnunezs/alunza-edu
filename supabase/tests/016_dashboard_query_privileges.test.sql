begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- The performance migration must retain the same authorization boundary.
select is((select pg_get_userbyid(proowner)::text from pg_proc where oid='app_private.dashboard_processing(uuid,uuid,uuid,timestamptz)'::regprocedure),
 'alunza_identity','freshness kernel keeps its constrained owner');
select is((select pg_get_userbyid(proowner)::text from pg_proc where oid='app_private.dashboard_read(uuid,jsonb)'::regprocedure),
 'alunza_identity','dashboard RPC keeps its constrained owner');
select ok((select not prosecdef and provolatile='s' and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid='app_private.dashboard_processing(uuid,uuid,uuid,timestamptz)'::regprocedure),
 'freshness remains stable, invoker and scoped to pg_catalog');
select ok((select prosecdef and provolatile='s' and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid='app_private.dashboard_read(uuid,jsonb)'::regprocedure),
 'authorized RPC remains stable, definer and scoped to pg_catalog');
select ok(not has_function_privilege('alunza_app','app_private.dashboard_processing(uuid,uuid,uuid,timestamptz)','EXECUTE'),
 'runtime cannot call the private freshness kernel directly');
select ok(has_function_privilege('alunza_app','app_private.dashboard_read(uuid,jsonb)','EXECUTE'),
 'runtime can call the authorizing dashboard RPC');
select ok(not pg_has_role('alunza_app','alunza_identity','SET') and not pg_has_role('alunza_app','alunza_identity','USAGE'),
 'runtime cannot assume or inherit the owner role to bypass entrypoint authorization');
select ok(not has_schema_privilege('alunza_app','app_private','CREATE'),
 'runtime cannot replace private functions or create objects in their schema');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) r where
 has_function_privilege(r,'app_private.dashboard_processing(uuid,uuid,uuid,timestamptz)','EXECUTE') or
 has_function_privilege(r,'app_private.dashboard_read(uuid,jsonb)','EXECUTE')),
 'Data API roles gain no execution access');
select ok(not has_schema_privilege('alunza_identity','app_private','CREATE'),
 'migration does not leave schema creation privilege with the constrained owner');
-- PostgreSQL 17 retains the creator's ADMIN membership without SET/INHERIT.
-- The migration's temporary ability to assume/use the owner must be revoked.
select ok(not pg_has_role('postgres','alunza_identity','SET') and not pg_has_role('postgres','alunza_identity','USAGE'),
 'migration does not retain temporary access to the constrained owner role');
select ok((select not rolbypassrls and not rolsuper from pg_roles where rolname='alunza_identity'),
 'owner does not bypass row security');

select * from finish();
rollback;
