begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Runtime code operates through bounded helpers, never direct pedagogical ledgers.
select ok(to_regclass('app_private.'||name) is not null,'IMP05.05 ledger exists: '||name)
from unnest(array[
 'signal_lanes','signal_jobs','signal_evidence_clocks','signal_input_changes',
 'signal_coverage_epochs','signal_snapshots','signal_evaluations','signal_witnesses',
 'signal_episodes','signal_reviews','signal_change_acks','signal_runtime',
 'signal_capture_registry','signal_episode_evaluations','signal_rebuild_receipts','signal_finalize_receipts','signal_projections'
]) name;

select ok(c.relrowsecurity and c.relforcerowsecurity,
 'IMP05.05 private ledger forces RLS: '||c.relname)
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='app_private' and c.relname=any(array[
 'signal_lanes','signal_jobs','signal_evidence_clocks','signal_input_changes',
 'signal_coverage_epochs','signal_snapshots','signal_evaluations','signal_witnesses',
 'signal_episodes','signal_reviews','signal_change_acks','signal_runtime',
 'signal_capture_registry','signal_episode_evaluations','signal_rebuild_receipts','signal_finalize_receipts','signal_projections'
]);

select ok(not has_table_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
 'IMP05.05 '||role_name||' has no direct ledger privilege: '||c.relname)
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join unnest(array['anon','authenticated','service_role','alunza_app']) role_name
where n.nspname='app_private' and c.relkind='r' and c.relname=any(array[
 'signal_lanes','signal_jobs','signal_evidence_clocks','signal_input_changes',
 'signal_coverage_epochs','signal_snapshots','signal_evaluations','signal_witnesses',
 'signal_episodes','signal_reviews','signal_change_acks','signal_runtime',
 'signal_capture_registry','signal_episode_evaluations','signal_rebuild_receipts','signal_finalize_receipts','signal_projections'
]);

select ok(r.rolname not in ('alunza_app','alunza_identity'),
 'IMP05.05 runtime and helper cannot own the private ledger: '||c.relname)
from pg_class c join pg_namespace n on n.oid=c.relnamespace
join pg_roles r on r.oid=c.relowner
where n.nspname='app_private' and c.relkind='r' and c.relname=any(array[
 'signal_lanes','signal_jobs','signal_evidence_clocks','signal_input_changes',
 'signal_coverage_epochs','signal_snapshots','signal_evaluations','signal_witnesses',
 'signal_episodes','signal_reviews','signal_change_acks','signal_runtime',
 'signal_capture_registry','signal_episode_evaluations','signal_rebuild_receipts','signal_finalize_receipts','signal_projections'
]);

select ok(to_regprocedure(signature) is not null,'IMP05.05 helper exists: '||signature)
from unnest(array[
 'app_private.signal_claim_job(uuid)',
 'app_private.signal_renew_job(uuid,uuid)',
 'app_private.signal_capture_snapshot(uuid,uuid)',
 'app_private.signal_finalize_batch(uuid,uuid,uuid,jsonb,jsonb)',
 'app_private.signal_fail_job(uuid,uuid,text)',
 'app_private.signal_resume_job(uuid)',
 'app_private.signal_replay_inputs(jsonb)',
 'app_private.signal_read_evidence(uuid)',
 'app_private.signal_rebuild(text,jsonb)'
]) signature;

select ok(not has_function_privilege(role_name,p.oid,'EXECUTE'),
 'IMP05.05 browser role cannot execute private helper: '||role_name||'/'||p.proname)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join unnest(array['anon','authenticated','service_role']) role_name
where n.nspname='app_private' and p.proname like 'signal\_%' escape '\';

select ok(not r.rolsuper and not r.rolbypassrls,
 'IMP05.05 definer owner has no bypass: '||p.proname)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
join pg_roles r on r.oid=p.proowner
where n.nspname='app_private' and p.proname like 'signal\_%' escape '\' and p.prosecdef;

select ok('search_path=pg_catalog'=any(p.proconfig),
 'IMP05.05 definer fixes a trusted search path: '||p.proname)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='app_private' and p.proname like 'signal\_%' escape '\' and p.prosecdef;

select ok(not pg_has_role('alunza_app','alunza_identity','MEMBER'),
 'IMP05.05 runtime cannot assume the internal owner');
select ok(not has_schema_privilege('alunza_identity','app_private','CREATE'),
 'IMP05.05 migration restores helper CREATE privilege');
-- PG16+ retains Supabase's administrative auto-grant without INHERIT or SET.
-- Only postgres's temporary self-grant must disappear after changing owners.
-- https://supabase.com/kb/troubleshooting/cant-revoke-a-role-membership-granted-by-supabase_admin
select ok(not pg_has_role('postgres','alunza_identity','SET')
 and not pg_has_role('postgres','alunza_identity','USAGE')
 and not exists(select 1 from pg_auth_members membership
 join pg_roles granted on granted.oid=membership.roleid
 join pg_roles member_role on member_role.oid=membership.member
 join pg_roles grantor_role on grantor_role.oid=membership.grantor
 where granted.rolname='alunza_identity' and member_role.rolname='postgres' and grantor_role.rolname='postgres'),
 'IMP05.05 migration removes its temporary SET/USAGE and self-grant');
select ok(not has_function_privilege('alunza_app','app_private.signal_review_fixture(uuid,uuid)','EXECUTE'),
 'IMP05.05 fixture review is not an application permission');
select ok(not has_function_privilege('alunza_app','app_private.signal_restart_coverage(text,text)','EXECUTE'),
 'IMP05.05 worker cannot invent a new coverage epoch');

select * from finish();
rollback;
