-- IMP-06.06: bounded durable CSV artifacts. The runtime owns no tables and
-- receives only checked entrypoints. Capturing rows and storing bytes are
-- separate short transactions fenced by a single-use, expiring claim.
create table app_private.audit_exports (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references app.organizations(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 idempotency_key text not null check(idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
 options jsonb not null check(jsonb_typeof(options)='object'),
 state text not null default 'RUNNING' check(state in ('RUNNING','READY','FAILED','EXPIRED')),
 requested_at timestamptz not null default clock_timestamp(),
 lease_token uuid,
 lease_until timestamptz,
 snapshot_at timestamptz,
 expected_row_count integer check(expected_row_count between 0 and 10001),
 generated_at timestamptz,
 expires_at timestamptz,
 failed_at timestamptz,
 row_count integer check(row_count between 0 and 10000),
 byte_length integer check(byte_length between 1 and 10485760),
 sha256 text check(sha256 ~ '^[0-9a-f]{64}$'),
 content bytea,
 error_code text check(error_code in ('AUDIT_EXPORT_FAILED','AUDIT_EXPORT_INTERRUPTED','AUDIT_EXPORT_LIMIT_EXCEEDED')),
 error_status integer check(error_status in (422,503)),
 unique(organization_id,actor_id,idempotency_key),
 unique(id,organization_id,actor_id),
 check((snapshot_at is null)=(expected_row_count is null)),
 check((state='RUNNING')=(lease_token is not null and lease_until is not null)),
 check(state<>'RUNNING' or (generated_at is null and content is null and error_code is null)),
 check(state not in ('READY','EXPIRED') or (snapshot_at is not null and generated_at is not null
  and expires_at=generated_at+interval '24 hours' and row_count=expected_row_count and row_count is not null
  and byte_length is not null and sha256 is not null and error_code is null)),
 check(state<>'READY' or (content is not null and octet_length(content)=byte_length)),
 check(state not in ('FAILED','EXPIRED') or content is null),
 check(state<>'FAILED' or (error_code is not null and error_status is not null and failed_at is not null))
);
create unique index audit_exports_one_running on app_private.audit_exports(organization_id,actor_id) where state='RUNNING';
create index audit_exports_leases on app_private.audit_exports(lease_until,id) where state='RUNNING';
create index audit_exports_expiry on app_private.audit_exports(expires_at,id) where state='READY';

create table app_private.audit_export_deliveries (
 id uuid primary key default gen_random_uuid(),
 export_id uuid not null,
 organization_id uuid not null,
 actor_id uuid not null,
 token uuid not null default gen_random_uuid(),
 state text not null default 'PENDING' check(state in ('PENDING','FINISHED','ABORTED','UNKNOWN')),
 started_at timestamptz not null default clock_timestamp(),
 deadline_at timestamptz not null default clock_timestamp()+interval '5 minutes',
 finished_at timestamptz,
 foreign key(export_id,organization_id,actor_id) references app_private.audit_exports(id,organization_id,actor_id) on delete restrict,
 check((state='PENDING')=(finished_at is null))
);
create index audit_export_delivery_pending on app_private.audit_export_deliveries(deadline_at,id) where state='PENDING';
create index audit_export_delivery_export on app_private.audit_export_deliveries(export_id,id);
alter table app_private.audit_exports enable row level security;
alter table app_private.audit_exports force row level security;
alter table app_private.audit_export_deliveries enable row level security;
alter table app_private.audit_export_deliveries force row level security;
revoke all on app_private.audit_exports,app_private.audit_export_deliveries from public,anon,authenticated,service_role,alunza_app;
grant select,insert,update on app_private.audit_exports,app_private.audit_export_deliveries to alunza_identity;
create policy audit_exports_internal on app_private.audit_exports to alunza_identity using(true) with check(true);
create policy audit_export_deliveries_internal on app_private.audit_export_deliveries to alunza_identity using(true) with check(true);

create policy audit_export_audit_runtime on app.audit_events as restrictive for insert to alunza_app
 with check(action not in ('AUDIT_EXPORT_GENERATED','AUDIT_EXPORT_DOWNLOADED','AUDIT_EXPORT_FAILED','AUDIT_EXPORT_EXPIRED'));
create policy audit_export_audit_internal on app.audit_events for insert to alunza_identity
 with check(entity_type='AUDIT_EXPORT'
  and action in ('AUDIT_EXPORT_GENERATED','AUDIT_EXPORT_DOWNLOADED','AUDIT_EXPORT_FAILED','AUDIT_EXPORT_EXPIRED')
  and exists(select 1 from app_private.audit_exports x where x.id=entity_id
   and x.organization_id=audit_events.organization_id and x.actor_id=audit_events.actor_id));
create unique index audit_export_terminal_once on app.audit_events(entity_id,action)
 where entity_type='AUDIT_EXPORT' and action in ('AUDIT_EXPORT_GENERATED','AUDIT_EXPORT_FAILED','AUDIT_EXPORT_EXPIRED');

create function app_private.audit_export_authorize(org uuid) returns void
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.audit_read_context(org)
$$;

-- Reject before reservation; normalize only representation, not exact text filters.
create function app_private.audit_export_options(options jsonb) returns jsonb
language plpgsql stable set search_path=pg_catalog as $$
declare cut timestamptz; start_at timestamptz; normalized jsonb;
begin
 if options is null or jsonb_typeof(options)<>'object' or not(options ? 'asOf')
  or (options-array['from','asOf','actorId','action','entityType','entityId'])<>'{}'::jsonb
  or exists(select 1 from jsonb_each(options) where jsonb_typeof(value)<>'string') then
  raise exception using errcode='P0001',message='AUDIT_FILTER_INVALID';
 end if;
 if exists(select 1 from jsonb_each_text(options) where
  (key in ('action','entityType') and char_length(value) not between 1 and 100)
  or (key in ('actorId','entityId') and value!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
  or (key in ('from','asOf') and value!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$')) then
  raise exception using errcode='P0001',message='AUDIT_FILTER_INVALID';
 end if;
 cut:=(options->>'asOf')::timestamptz;
 start_at:=(options->>'from')::timestamptz;
 if not isfinite(cut) or cut>statement_timestamp() then
  raise exception using errcode='P0001',message='INVALID_PROGRESS_CUTOFF';
 end if;
 if start_at is not null and (not isfinite(start_at) or start_at>cut) then
  raise exception using errcode='P0001',message='AUDIT_PERIOD_INVALID';
 end if;
 normalized:=options||jsonb_build_object('asOf',app_private.audit_read_instant(cut));
 if options ? 'from' then normalized:=normalized||jsonb_build_object('from',app_private.audit_read_instant(start_at)); end if;
 if options ? 'actorId' then normalized:=normalized||jsonb_build_object('actorId',(options->>'actorId')::uuid); end if;
 if options ? 'entityId' then normalized:=normalized||jsonb_build_object('entityId',(options->>'entityId')::uuid); end if;
 return normalized;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 raise exception using errcode='P0001',message='AUDIT_FILTER_INVALID';
end $$;

create function app_private.audit_export_error(code text) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('code',code,'status',case code when 'AUDIT_EXPORT_LIMIT_EXCEEDED' then 422 when 'AUDIT_EXPORT_EXPIRED' then 410 else 503 end,
  'message',case code when 'AUDIT_EXPORT_LIMIT_EXCEEDED' then 'La exportación supera el límite permitido.'
   when 'AUDIT_EXPORT_EXPIRED' then 'La exportación ha caducado.'
   when 'AUDIT_EXPORT_INTERRUPTED' then 'La generación de la exportación se interrumpió.'
   else 'No se pudo generar la exportación.' end,'retryable',false)
$$;

create function app_private.audit_export_metadata_value(x app_private.audit_exports) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('state','READY','exportId',x.id,'organizationId',x.organization_id,'filters',x.options,
  'snapshotAt',app_private.audit_read_instant(x.snapshot_at),'generatedAt',app_private.audit_read_instant(x.generated_at),
  'expiresAt',app_private.audit_read_instant(x.expires_at),'rowCount',x.row_count,'byteLength',x.byte_length,'sha256',x.sha256,
  'fileName','auditoria-'||x.organization_id||'-'||x.id||'.csv',
  'downloadPath','/api/v1/organizations/'||x.organization_id||'/audit-exports/'||x.id||'/content','formatVersion','audit-csv-v1')
$$;

create function app_private.audit_export_event(x app_private.audit_exports,action_name text,outcome text,changes jsonb) returns void
language plpgsql set search_path=pg_catalog as $$
begin
 insert into app.audit_events(organization_id,actor_id,actor_kind,occurred_at,action,entity_type,entity_id,result,correlation_id,safe_changes)
 values(x.organization_id,x.actor_id,'USER',clock_timestamp(),action_name,'AUDIT_EXPORT',x.id,outcome,x.id,changes);
end $$;

-- Internal completion needs the unpredictable fence and a RUNNING row, not a
-- still-active browser session. Revocation must not erase failure evidence.
create function app_private.audit_export_fail(p_id uuid,p_token uuid,p_code text,p_status integer) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare x app_private.audit_exports; code_value text; status_value integer;
begin
 select * into x from app_private.audit_exports where id=p_id and lease_token=p_token and state='RUNNING' for update;
 if not found then return; end if;
 if x.lease_until<=clock_timestamp() then code_value:='AUDIT_EXPORT_INTERRUPTED'; status_value:=503;
 else
  if p_code not in ('AUDIT_EXPORT_FAILED','AUDIT_EXPORT_INTERRUPTED','AUDIT_EXPORT_LIMIT_EXCEEDED') or p_code is null
   or p_status is distinct from (case when p_code='AUDIT_EXPORT_LIMIT_EXCEEDED' then 422 else 503 end) then
   raise exception using errcode='P0001',message='INVALID_REQUEST';
  end if;
  code_value:=p_code; status_value:=p_status;
 end if;
 update app_private.audit_exports set state='FAILED',failed_at=clock_timestamp(),error_code=code_value,error_status=status_value,
  lease_token=null,lease_until=null,content=null where id=x.id returning * into x;
 perform app_private.audit_export_event(x,'AUDIT_EXPORT_FAILED','FAILED',jsonb_build_object('code',code_value));
end $$;

create function app_private.audit_export_expire(p_id uuid) returns void
language plpgsql set search_path=pg_catalog as $$
declare x app_private.audit_exports;
begin
 update app_private.audit_exports set state='EXPIRED',content=null
 where id=p_id and state='READY' and expires_at<=clock_timestamp() returning * into x;
 if found then perform app_private.audit_export_event(x,'AUDIT_EXPORT_EXPIRED','EXPIRED','{}'::jsonb); end if;
end $$;

create function app_private.audit_export_reserve(p_org uuid,p_key text,p_options jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; normalized jsonb; x app_private.audit_exports; running app_private.audit_exports;
begin
 perform app_private.audit_read_context(p_org);
 actor:=app_private.actor_id(); normalized:=app_private.audit_export_options(p_options);
 if p_key is null or p_key!~'^[A-Za-z0-9_.:-]{8,128}$' then
  raise exception using errcode='P0001',message='INVALID_REQUEST';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('audit-export:'||p_org||':'||actor,0));
 perform app_private.audit_read_context(p_org);
 select * into x from app_private.audit_exports where organization_id=p_org and actor_id=actor and idempotency_key=p_key for update;
 perform app_private.audit_read_context(p_org);
 if x.id is not null then
  if x.options is distinct from normalized then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
  if x.state='RUNNING' then
   if x.lease_until>clock_timestamp() then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
   perform app_private.audit_export_fail(x.id,x.lease_token,'AUDIT_EXPORT_INTERRUPTED',503);
   return jsonb_build_object('kind','FAILED','error',app_private.audit_export_error('AUDIT_EXPORT_INTERRUPTED'));
  elsif x.state='FAILED' then return jsonb_build_object('kind','FAILED','error',app_private.audit_export_error(x.error_code));
  elsif x.state='EXPIRED' or x.expires_at<=clock_timestamp() then
   perform app_private.audit_export_expire(x.id);
   return jsonb_build_object('kind','FAILED','error',app_private.audit_export_error('AUDIT_EXPORT_EXPIRED'));
  else return jsonb_build_object('kind','READY','metadata',app_private.audit_export_metadata_value(x)); end if;
 end if;
 select * into running from app_private.audit_exports where organization_id=p_org and actor_id=actor and state='RUNNING' for update;
 perform app_private.audit_read_context(p_org);
 if running.id is not null then
  if running.lease_until>clock_timestamp() then raise exception using errcode='P0001',message='RATE_LIMITED'; end if;
  perform app_private.audit_export_fail(running.id,running.lease_token,'AUDIT_EXPORT_INTERRUPTED',503);
 end if;
 insert into app_private.audit_exports(organization_id,actor_id,idempotency_key,options,lease_token,lease_until)
 values(p_org,actor,p_key,normalized,gen_random_uuid(),clock_timestamp()+interval '30 seconds') returning * into x;
 return jsonb_build_object('kind','CLAIMED','exportId',x.id,'leaseToken',x.lease_token);
end $$;

create function app_private.audit_export_capture(p_org uuid,p_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare x app_private.audit_exports; rows_value jsonb; snapshot_value timestamptz;
begin
 perform app_private.audit_read_context(p_org);
 select * into x from app_private.audit_exports where id=p_id and organization_id=p_org and actor_id=app_private.actor_id() for update;
 perform app_private.audit_read_context(p_org);
 if x.id is null then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 if x.state<>'RUNNING' or x.lease_token is distinct from p_token or x.lease_until<=clock_timestamp() then
  raise exception using errcode='P0001',message='AUDIT_EXPORT_INTERRUPTED';
 end if;
 if x.snapshot_at is not null then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 -- Exactly one bounded SELECT establishes the export set, including the 10001st
 -- sentinel row. Own journal events are excluded even if backdated in a test.
 with moment as materialized(select clock_timestamp() as at), selected as materialized(
  select e.id,e.occurred_at,e.actor_id,e.action,e.entity_type,e.entity_id,e.organization_id,e.result
  from app.audit_events e where e.organization_id=p_org and e.occurred_at<=(x.options->>'asOf')::timestamptz
   and (not(x.options ? 'from') or e.occurred_at>=(x.options->>'from')::timestamptz)
   and (not(x.options ? 'actorId') or e.actor_id=(x.options->>'actorId')::uuid)
   and (not(x.options ? 'action') or e.action=x.options->>'action')
   and (not(x.options ? 'entityType') or e.entity_type=x.options->>'entityType')
   and (not(x.options ? 'entityId') or e.entity_id=(x.options->>'entityId')::uuid)
   and not(e.entity_type='AUDIT_EXPORT' and e.entity_id is not distinct from x.id)
  order by e.occurred_at desc,e.id asc limit 10001
 ) select moment.at,coalesce((select jsonb_agg(jsonb_build_object('eventId',id,'occurredAt',app_private.audit_read_instant(occurred_at),
  'actorId',actor_id,'action',action,'entityType',entity_type,'entityId',entity_id,'organizationId',organization_id,'outcome',result)
  order by occurred_at desc,id asc) from selected),'[]'::jsonb) into snapshot_value,rows_value from moment;
 update app_private.audit_exports set snapshot_at=snapshot_value,expected_row_count=jsonb_array_length(rows_value) where id=x.id;
 return jsonb_build_object('snapshotAt',app_private.audit_read_instant(snapshot_value),'items',rows_value);
end $$;

create function app_private.audit_export_finish(p_org uuid,p_id uuid,p_token uuid,p_snapshot timestamptz,p_bytes bytea,p_count integer,p_sha text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare x app_private.audit_exports; generated timestamptz;
begin
 perform app_private.audit_read_context(p_org);
 select * into x from app_private.audit_exports where id=p_id and organization_id=p_org and actor_id=app_private.actor_id() for update;
 perform app_private.audit_read_context(p_org);
 if x.id is null then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 if x.state<>'RUNNING' or x.lease_token is distinct from p_token or x.lease_until<=clock_timestamp() then
  raise exception using errcode='P0001',message='AUDIT_EXPORT_INTERRUPTED';
 end if;
 if p_count>10000 or octet_length(p_bytes)>10485760 then raise exception using errcode='P0001',message='AUDIT_EXPORT_LIMIT_EXCEEDED'; end if;
 if x.snapshot_at is null or p_snapshot is distinct from x.snapshot_at or p_count is distinct from x.expected_row_count
  or p_count<0 or p_bytes is null or octet_length(p_bytes)<1 or p_sha is null or p_sha!~'^[0-9a-f]{64}$'
  or p_sha is distinct from encode(extensions.digest(p_bytes,'sha256'),'hex') then
  raise exception using errcode='P0001',message='AUDIT_EXPORT_FAILED';
 end if;
 -- Recheck after bounded hashing; the claim cannot finish after its deadline.
 if x.lease_until<=clock_timestamp() then raise exception using errcode='P0001',message='AUDIT_EXPORT_INTERRUPTED'; end if;
 perform app_private.audit_read_context(p_org);
 generated:=clock_timestamp();
 update app_private.audit_exports set state='READY',lease_token=null,lease_until=null,generated_at=generated,
  expires_at=generated+interval '24 hours',row_count=p_count,byte_length=octet_length(p_bytes),sha256=p_sha,content=p_bytes
 where id=x.id returning * into x;
 perform app_private.audit_export_event(x,'AUDIT_EXPORT_GENERATED','SUCCEEDED',jsonb_build_object('rowCount',x.row_count,'byteLength',x.byte_length));
 return app_private.audit_export_metadata_value(x);
end $$;

create function app_private.audit_export_ready(p_org uuid,p_id uuid) returns app_private.audit_exports
language plpgsql stable set search_path=pg_catalog as $$
declare x app_private.audit_exports;
begin
 perform app_private.audit_read_context(p_org);
 -- Metadata and HEAD never read the stored bytea. Only content() below selects it.
 select e.id,e.organization_id,e.actor_id,e.idempotency_key,e.options,e.state,e.requested_at,
  e.lease_token,e.lease_until,e.snapshot_at,e.expected_row_count,e.generated_at,e.expires_at,e.failed_at,
  e.row_count,e.byte_length,e.sha256,null::bytea,e.error_code,e.error_status into x
 from app_private.audit_exports e where e.id=p_id and e.organization_id=p_org and e.actor_id=app_private.actor_id();
 if not found then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 if x.state='FAILED' then raise exception using errcode='P0001',message=x.error_code; end if;
 if x.state='RUNNING' then
  -- Read-only status reflects the durable state. Reservation replay, fenced
  -- failure or maintenance performs the expired lease's terminal transition.
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS';
 end if;
 if x.state='EXPIRED' or x.expires_at<=clock_timestamp() then raise exception using errcode='P0001',message='AUDIT_EXPORT_EXPIRED'; end if;
 return x;
end $$;

create function app_private.audit_export_metadata(p_org uuid,p_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.audit_export_metadata_value(app_private.audit_export_ready(p_org,p_id))
$$;
create function app_private.audit_export_content(p_org uuid,p_id uuid) returns table(metadata jsonb,content bytea)
language plpgsql stable security definer set search_path=pg_catalog as $$
declare x app_private.audit_exports;
begin
 x:=app_private.audit_export_ready(p_org,p_id);
 return query select app_private.audit_export_metadata_value(x),e.content from app_private.audit_exports e where e.id=x.id;
end $$;

create function app_private.audit_export_delivery_begin(p_org uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare x app_private.audit_exports; ticket app_private.audit_export_deliveries;
begin
 perform app_private.audit_read_context(p_org);
 -- Serialize against expiry, then recheck scope and time after waiting.
 perform 1 from app_private.audit_exports where id=p_id and organization_id=p_org and actor_id=app_private.actor_id() for update;
 if not found then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 x:=app_private.audit_export_ready(p_org,p_id);
 insert into app_private.audit_export_deliveries(export_id,organization_id,actor_id)
 values(x.id,x.organization_id,x.actor_id) returning * into ticket;
 return jsonb_build_object('ticketId',ticket.id,'ticketToken',ticket.token);
end $$;

create function app_private.audit_export_delivery_finish(p_ticket uuid,p_token uuid,p_outcome text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare ticket app_private.audit_export_deliveries; x app_private.audit_exports; outcome_value text;
begin
 select * into ticket from app_private.audit_export_deliveries where id=p_ticket and token=p_token and state='PENDING' for update;
 if not found then return; end if;
 if ticket.deadline_at<=clock_timestamp() then outcome_value:='UNKNOWN';
 elsif p_outcome in ('FINISHED','ABORTED') then outcome_value:=p_outcome;
 else raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 update app_private.audit_export_deliveries set state=outcome_value,finished_at=clock_timestamp() where id=ticket.id;
 select * into strict x from app_private.audit_exports where id=ticket.export_id;
 perform app_private.audit_export_event(x,'AUDIT_EXPORT_DOWNLOADED',outcome_value,jsonb_build_object('deliveryId',ticket.id,'outcome',outcome_value));
end $$;

create function app_private.audit_export_maintain() returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare x app_private.audit_exports; ticket app_private.audit_export_deliveries;
begin
 for x in select * from app_private.audit_exports where state='RUNNING' and lease_until<=clock_timestamp()
  order by lease_until,id limit 100 for update skip locked loop
  perform app_private.audit_export_fail(x.id,x.lease_token,'AUDIT_EXPORT_INTERRUPTED',503);
 end loop;
 for x in select * from app_private.audit_exports where state='READY' and expires_at<=clock_timestamp()
  order by expires_at,id limit 100 for update skip locked loop
  perform app_private.audit_export_expire(x.id);
 end loop;
 for ticket in select * from app_private.audit_export_deliveries where state='PENDING' and deadline_at<=clock_timestamp()
  order by deadline_at,id limit 100 for update skip locked loop
  perform app_private.audit_export_delivery_finish(ticket.id,ticket.token,'UNKNOWN');
 end loop;
end $$;

grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
do $$ declare fn regprocedure; name text; begin
 for fn,name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app_private' and p.proname like 'audit_export_%' loop
  execute format('alter function %s owner to alunza_identity',fn);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',fn);
  execute format('grant execute on function %s to alunza_identity',fn);
  if name in ('audit_export_authorize','audit_export_reserve','audit_export_capture','audit_export_finish','audit_export_fail',
   'audit_export_metadata','audit_export_content','audit_export_delivery_begin','audit_export_delivery_finish','audit_export_maintain') then
   execute format('grant execute on function %s to alunza_app',fn);
  end if;
 end loop;
end $$;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
