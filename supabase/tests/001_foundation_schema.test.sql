begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

select ok(
  (select rolcanlogin and not rolsuper and not rolbypassrls and not rolcreaterole
      and not rolcreatedb and not rolreplication and not rolinherit
    from pg_catalog.pg_roles where rolname = 'alunza_app'),
  'Application login has no elevated role attributes'
);

select is(
  (select count(*)::integer
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity),
  8,
  'Every identity domain table enables and forces RLS'
);

select is(
  (select count(*)::integer
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_roles r on r.oid = c.relowner
    where n.nspname = 'app' and r.rolname = 'alunza_app'),
  0,
  'Application is not the owner of a domain relation'
);

select ok(has_schema_privilege('alunza_app', 'app', 'USAGE'), 'Application can use its private schema');
select ok(not has_schema_privilege('alunza_app', 'app', 'CREATE'), 'Application cannot create domain objects');
select ok(not has_schema_privilege('anon', 'app', 'USAGE'), 'Anonymous Data API role cannot use domain schema');
select ok(not has_schema_privilege('authenticated', 'app', 'USAGE'), 'Authenticated Data API role cannot use domain schema');
select ok(not has_schema_privilege('service_role', 'app', 'USAGE'), 'Auth administrative adapter is not granted domain schema access');

select ok(
  (select bool_and(has_table_privilege('alunza_app', format('app.%I', tablename), 'SELECT'))
    from pg_catalog.pg_tables where schemaname = 'app'),
  'Application has explicit read grants for the identity tables'
);

select ok(
  (select bool_and(not has_table_privilege('alunza_app', format('app.%I', tablename),
      'DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    from pg_catalog.pg_tables where schemaname = 'app'),
  'Application cannot delete history, truncate data or attach triggers'
);

select ok(
  (select bool_and(not has_table_privilege('anon', format('app.%I', tablename),
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    from pg_catalog.pg_tables where schemaname = 'app'),
  'Anonymous role has no domain table grants'
);

select ok(
  (select bool_and(not has_table_privilege('authenticated', format('app.%I', tablename),
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    from pg_catalog.pg_tables where schemaname = 'app'),
  'Authenticated role has no direct domain table grants'
);

select ok(
  not has_column_privilege('alunza_app', 'app.provisioning_grants', 'revoked_at', 'UPDATE')
    and not has_table_privilege('alunza_app', 'app.provisioning_grants', 'INSERT')
    and not has_table_privilege('alunza_app', 'app.audit_events', 'UPDATE'),
  'Technical grants and audit history cannot be administered by the application'
);

select is(
  (select count(*)::integer from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prosecdef),
  0,
  'No SECURITY DEFINER function bypasses domain RLS'
);

select * from finish();
rollback;
