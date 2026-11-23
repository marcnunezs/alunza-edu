-- One durable slot per broker host, shared by RUN/SUBMIT and all generations.
-- No expiry frees this slot: only a correlated, verified retirement does.
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;

create unique index local_vm_one_pending_host
 on app_private.local_vm_resources ((context->>'hostId'))
 where cleanup_state='PENDING';

create function app_private.guard_local_vm_capacity() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$ begin
 if not app_private.valid_local_vm_context(new.context) then
  raise exception using errcode='23514',message='INVALID_EXECUTION_CONTEXT';
 end if;
 -- Admission already owns actor/organization locks. Never wait on another
 -- host admission while holding them; the unique index is a second fence.
 if pg_try_advisory_xact_lock(hashtextextended('local-vm.capacity:'||(new.context->>'hostId'),0)) is distinct from true
  or exists(select 1 from app_private.local_vm_resources
   where context->>'hostId'=new.context->>'hostId' and cleanup_state='PENDING') then
  raise exception using errcode='P0001',message='RUNNER_BUSY';
 end if;
 return new;
end $$;
create trigger local_vm_capacity_before_insert before insert on app_private.local_vm_resources
 for each row execute function app_private.guard_local_vm_capacity();

-- Read-only preflight avoids waiting for the actor/organization locks held by
-- another admission. Existing keys go to the original authoritative replay
-- path with runner_available=false, so a concurrently removed key cannot turn
-- that path into a new admission. The original function revalidates all access
-- and quotas after this hint; this helper never authorizes execution itself.
create function app_private.local_vm_admission_preflight(
 activity uuid,assignment uuid,version_id uuid,operation_name text,operation_key text,ctx jsonb,capacity text
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare org uuid:=app_private.organization_id(); actor uuid:=app_private.actor_id(); a record;
begin
 if org is null or actor is null or not app_private.academic_role(org,array['STUDENT']) then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 if operation_name not in ('practice.run','practice.submit') or operation_key is null
  or operation_key !~ '^[A-Za-z0-9._:-]{8,128}$' then
  raise exception using errcode='22023',message='INVALID_RUN_CONFIGURATION';
 end if;
 select act.*,c.archived_at as class_archived_at,ae.exercise_version_id into a
  from app.activities act join app.classes c on c.id=act.class_id and c.organization_id=act.organization_id
  join app.activity_exercises ae on ae.activity_id=act.id and ae.organization_id=act.organization_id
  where act.id=activity and ae.id=assignment and act.organization_id=org
   and act.state in ('PUBLISHED','CLOSED') and app_private.academic_student(act.class_id);
 if not found then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 if a.exercise_version_id<>version_id then raise exception using errcode='P0001',message='VERSION_CONFLICT'; end if;
 -- An uncommitted duplicate has no visible operation_keys row yet. Fence the
 -- transport key before host capacity so it can never be reported unadmitted
 -- while another replica may commit that exact request. Payload is deliberately
 -- absent from this lock: a changed payload resolves to conflict after commit.
 if pg_try_advisory_xact_lock(hashtextextended('local-vm.idempotency:'||org::text||':'||actor::text||':'||operation_name||':'||operation_key,0)) is distinct from true then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 if exists(select 1 from app.operation_keys where organization_id=org and actor_id=actor
  and operation=operation_name and key=operation_key) then return true; end if;
 if a.state<>'PUBLISHED' then raise exception using errcode='P0001',message='ACTIVITY_CLOSED'; end if;
 if a.class_archived_at is not null then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
 if (a.opens_at is not null and clock_timestamp()<a.opens_at) or (a.closes_at is not null and clock_timestamp()>=a.closes_at) then
  raise exception using errcode='P0001',message='ACTIVITY_NOT_AVAILABLE'; end if;
 if not app_private.valid_local_vm_context(ctx) then raise exception using errcode='23514',message='INVALID_EXECUTION_CONTEXT'; end if;
 if capacity='BUSY' then raise exception using errcode='P0001',message='RUNNER_BUSY'; end if;
 if capacity is distinct from 'READY' then raise exception using errcode='P0001',message='DEPENDENCY_UNAVAILABLE'; end if;
 if pg_try_advisory_xact_lock(hashtextextended('local-vm.capacity:'||(ctx->>'hostId'),0)) is distinct from true
  or exists(select 1 from app_private.local_vm_resources where context->>'hostId'=ctx->>'hostId' and cleanup_state='PENDING') then
  raise exception using errcode='P0001',message='RUNNER_BUSY'; end if;
 return false;
end $$;

-- A losing admission rolls back the complete transaction. No durable key,
-- reservation, resource or attempt survives a capacity rejection.
create function app_private.admit_practice_run(
 execution uuid,activity uuid,assignment uuid,version_id uuid,operation_key text,payload_digest text,source_digest text,suite_digest text,visible_count integer,runtime_version text,correlation uuid,runner_available boolean,actor_concurrency integer,organization_concurrency integer,actor_frequency integer,execution_context jsonb,runner_capacity text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb; failed_constraint text; begin
 if execution_context->>'provider'='local-vm' then
  if app_private.local_vm_admission_preflight(activity,assignment,version_id,'practice.run',operation_key,execution_context,runner_capacity) then
   return app_private.admit_practice_run(execution,activity,assignment,version_id,operation_key,payload_digest,source_digest,suite_digest,visible_count,runtime_version,correlation,false,actor_concurrency,organization_concurrency,actor_frequency);
  end if;
 end if;
 result:=app_private.admit_practice_run(execution,activity,assignment,version_id,operation_key,payload_digest,source_digest,suite_digest,visible_count,runtime_version,correlation,runner_available,actor_concurrency,organization_concurrency,actor_frequency);
 if result->>'kind'='reserved' and execution_context is not null then
  if execution_context->>'provider'='local-vm' then
   if not app_private.valid_local_vm_context(execution_context) then raise exception using errcode='23514',message='INVALID_EXECUTION_CONTEXT'; end if;
   if runner_capacity='BUSY' then raise exception using errcode='P0001',message='RUNNER_BUSY'; end if;
   if runner_capacity is distinct from 'READY' then raise exception using errcode='P0001',message='DEPENDENCY_UNAVAILABLE'; end if;
  end if;
  perform app_private.prepare_sandbox_execution(execution,(result->>'leaseToken')::uuid,'RUN',execution_context);
  result:=result||jsonb_build_object('executionContext',execution_context);
 end if;
 return result;
exception when unique_violation then
 get stacked diagnostics failed_constraint=constraint_name;
 if failed_constraint='local_vm_one_pending_host' then raise exception using errcode='P0001',message='RUNNER_BUSY'; end if;
 raise;
end $$;

create function app_private.admit_practice_submit(
 execution uuid,activity uuid,assignment uuid,version_id uuid,operation_key text,payload_digest text,source_code text,previous_attempt uuid,runtime_version text,correlation uuid,runner_available boolean,actor_concurrency integer,organization_concurrency integer,actor_frequency integer,execution_context jsonb,runner_capacity text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb; failed_constraint text; begin
 if execution_context->>'provider'='local-vm' then
  if app_private.local_vm_admission_preflight(activity,assignment,version_id,'practice.submit',operation_key,execution_context,runner_capacity) then
   return app_private.admit_practice_submit(execution,activity,assignment,version_id,operation_key,payload_digest,source_code,previous_attempt,runtime_version,correlation,false,actor_concurrency,organization_concurrency,actor_frequency);
  end if;
 end if;
 result:=app_private.admit_practice_submit(execution,activity,assignment,version_id,operation_key,payload_digest,source_code,previous_attempt,runtime_version,correlation,runner_available,actor_concurrency,organization_concurrency,actor_frequency);
 if result->>'kind'='reserved' and execution_context is not null then
  if execution_context->>'provider'='local-vm' then
   if not app_private.valid_local_vm_context(execution_context) then raise exception using errcode='23514',message='INVALID_EXECUTION_CONTEXT'; end if;
   if runner_capacity='BUSY' then raise exception using errcode='P0001',message='RUNNER_BUSY'; end if;
   if runner_capacity is distinct from 'READY' then raise exception using errcode='P0001',message='DEPENDENCY_UNAVAILABLE'; end if;
  end if;
  perform app_private.prepare_sandbox_execution(execution,(result->>'leaseToken')::uuid,'SUBMIT',execution_context);
  result:=result||jsonb_build_object('executionContext',execution_context);
 end if;
 return result;
exception when unique_violation then
 get stacked diagnostics failed_constraint=constraint_name;
 if failed_constraint='local_vm_one_pending_host' then raise exception using errcode='P0001',message='RUNNER_BUSY'; end if;
 raise;
end $$;

alter function app_private.guard_local_vm_capacity() owner to alunza_identity;
revoke all on function app_private.guard_local_vm_capacity() from public,anon,authenticated,service_role,alunza_app;
alter function app_private.local_vm_admission_preflight(uuid,uuid,uuid,text,text,jsonb,text) owner to alunza_identity;
revoke all on function app_private.local_vm_admission_preflight(uuid,uuid,uuid,text,text,jsonb,text) from public,anon,authenticated,service_role,alunza_app;
do $$ declare fn regprocedure; begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='app_private' and p.proname in ('admit_practice_run','admit_practice_submit')
   and p.proargnames[array_length(p.proargnames,1)]='runner_capacity' loop
  execute format('alter function %s owner to alunza_identity',fn);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',fn);
  execute format('grant execute on function %s to alunza_app',fn);
 end loop;
end $$;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
