-- Preserve RF-020 as RUN introduces operational work independent of membership
-- and academic resources. UPDATE locks this organization row before the trigger;
-- admission takes the same row lock before inserting its execution reservation.
create function app_private.guard_organization_practice_runs() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if exists(select 1 from app.executions where organization_id=old.id and lifecycle_status in ('RUNNING','RECOVERING')) then
  raise exception using errcode='P0001',message='DEPENDENCIES_ACTIVE';
 end if;
 return new;
end $$;

create trigger guard_organization_practice_runs before update of archived_at on app.organizations
 for each row when (old.archived_at is null and new.archived_at is not null)
 execute function app_private.guard_organization_practice_runs();

grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
alter function app_private.guard_organization_practice_runs() owner to alunza_identity;
set role alunza_identity;
revoke all on function app_private.guard_organization_practice_runs() from public,anon,authenticated,service_role,alunza_app;
reset role;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
