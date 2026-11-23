-- A missing create response is not proof that Docker cannot publish its capsule
-- later. Do not shorten the original admission lease during failed cleanup.
-- Runtime mutation functions explicitly update lifecycle_status; direct runtime
-- UPDATE remains forbidden. The floor is fixed, never extended indefinitely.
create function app_private.guard_practice_recovery_grace() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 new.lease_until:=greatest(new.lease_until,new.admitted_at+interval '60 seconds');
 return new;
end $$;

create trigger executions_recovery_grace before update of lifecycle_status on app.executions
 for each row when (new.lifecycle_status='RECOVERING')
 execute function app_private.guard_practice_recovery_grace();

grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
alter function app_private.guard_practice_recovery_grace() owner to alunza_identity;
set role alunza_identity;
revoke all on function app_private.guard_practice_recovery_grace() from public,anon,authenticated,service_role,alunza_app;
reset role;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;

-- Repair only still-live admission grace periods from the preceding release.
-- Keep fencing tokens and already elapsed grace periods unchanged.
update app.executions
 set lease_until=admitted_at+interval '60 seconds'
 where lifecycle_status='RECOVERING'
  and lease_until<admitted_at+interval '60 seconds'
  and admitted_at+interval '60 seconds'>clock_timestamp();
