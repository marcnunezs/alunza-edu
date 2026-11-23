-- IMP-06.05: operational audit projection only. The existing append-only rows,
-- policies, writers and organization/time index remain unchanged. A cutoff and
-- keyset define stable ordering, not a frozen MVCC snapshot across requests.

create function app_private.audit_read_instant(value timestamptz) returns text
language sql immutable set search_path=pg_catalog as $$
 select to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;

create function app_private.audit_read_context(org uuid) returns void
language plpgsql stable set search_path=pg_catalog as $$
begin
 if org is null or app_private.academic_role(org,array['ADMIN'],true) is distinct from true then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
end $$;

-- This digest binds the request context; it is not an authorization credential.
-- The entrypoint always reauthorizes before inspecting a cursor or any rows.
create function app_private.audit_read_cursor(options jsonb,signature text) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare encoded text:=options->>'cursor'; decoded jsonb; anchor_id uuid; anchor_at timestamptz;
begin
 if encoded is null then return null; end if;
 if not (options ? 'asOf') or length(encoded) not between 1 and 4096
  or encoded!~'^[A-Za-z0-9_-]+$' then raise exception 'invalid cursor'; end if;
 decoded:=convert_from(decode(translate(encoded,'-_','+/')||repeat('=',(4-length(encoded)%4)%4),'base64'),'UTF8')::jsonb;
 if jsonb_typeof(decoded) is distinct from 'object' or (decoded-array['v','signature','key'])<>'{}'::jsonb
  or decoded->'v' is distinct from '1'::jsonb or decoded->>'signature' is distinct from signature
  or jsonb_typeof(decoded->'key') is distinct from 'object' or ((decoded->'key')-array['id','at'])<>'{}'::jsonb
  or jsonb_typeof(decoded->'key'->'id') is distinct from 'string'
  or jsonb_typeof(decoded->'key'->'at') is distinct from 'string' then raise exception 'invalid cursor'; end if;
 anchor_id:=(decoded->'key'->>'id')::uuid;
 anchor_at:=(decoded->'key'->>'at')::timestamptz;
 if not isfinite(anchor_at) or app_private.audit_read_instant(anchor_at) is distinct from decoded->'key'->>'at'
  or anchor_id::text is distinct from decoded->'key'->>'id' then raise exception 'invalid cursor'; end if;
 return decoded->'key';
exception when others then raise exception using errcode='P0001',message='AUDIT_CURSOR_INVALID';
end $$;

create function app_private.audit_read_next_cursor(signature text,id uuid,at timestamptz) returns text
language sql immutable set search_path=pg_catalog as $$
 select rtrim(translate(replace(encode(convert_to(jsonb_build_object('v',1,'signature',signature,
  'key',jsonb_build_object('id',id,'at',app_private.audit_read_instant(at)))::text,'UTF8'),'base64'),E'\n',''),'+/','-_'),'=')
$$;

create function app_private.audit_events_list(org uuid,options jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare n integer:=20; start_at timestamptz; cut timestamptz;
 actor_filter uuid; entity_filter uuid; action_filter text; type_filter text;
 signature text; cursor_key jsonb; after_id uuid; after_at timestamptz; response_value jsonb; valid_cursor boolean;
begin
 perform app_private.audit_read_context(org);
 if options is null or jsonb_typeof(options)<>'object' then
  raise exception using errcode='P0001',message='AUDIT_FILTER_INVALID';
 end if;
 if (options-array['from','asOf','actorId','action','entityType','entityId','cursor','limit'])<>'{}'::jsonb
  or exists(select 1 from jsonb_each(options) where value='null'::jsonb
   or (key<>'limit' and jsonb_typeof(value)<>'string')) then
  raise exception using errcode='P0001',message='AUDIT_FILTER_INVALID';
 end if;
 if options ? 'limit' then
  if jsonb_typeof(options->'limit')<>'number' or options->>'limit'!~'^[0-9]+$' then
   raise exception using errcode='P0001',message='AUDIT_FILTER_INVALID';
  end if;
  n:=(options->>'limit')::integer;
 end if;
 if n not between 1 and 100 then raise exception using errcode='P0001',message='AUDIT_FILTER_INVALID'; end if;
 if exists(select 1 from jsonb_each_text(options) where
  (key in ('action','entityType') and char_length(value) not between 1 and 100)
  or (key in ('actorId','entityId') and value!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
  or (key in ('from','asOf') and value!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$')) then
  raise exception using errcode='P0001',message='AUDIT_FILTER_INVALID';
 end if;
 start_at:=(options->>'from')::timestamptz;
 cut:=coalesce((options->>'asOf')::timestamptz,statement_timestamp());
 if not isfinite(cut) or cut>statement_timestamp() then
  raise exception using errcode='P0001',message='INVALID_PROGRESS_CUTOFF';
 end if;
 if start_at is not null and (not isfinite(start_at) or start_at>cut) then
  raise exception using errcode='P0001',message='AUDIT_PERIOD_INVALID';
 end if;
 actor_filter:=(options->>'actorId')::uuid; entity_filter:=(options->>'entityId')::uuid;
 action_filter:=options->>'action'; type_filter:=options->>'entityType';
 signature:=md5(jsonb_build_object('reader','audit-events-v1','actor',app_private.actor_id(),'org',org,
  'order','occurred_at:desc,id:asc','from',app_private.audit_read_instant(start_at),'asOf',app_private.audit_read_instant(cut),
  'actorId',actor_filter,'action',action_filter,'entityType',type_filter,'entityId',entity_filter)::text);
 cursor_key:=app_private.audit_read_cursor(options,signature);
 after_id:=(cursor_key->>'id')::uuid; after_at:=(cursor_key->>'at')::timestamptz;
 -- No global actor/resource lookup: a valid foreign or unknown filter matches
 -- no rows in this organization. All count and page work shares one snapshot.
 with filtered as materialized(
  select e.id,e.organization_id,e.actor_id,e.occurred_at,e.action,e.entity_type,e.entity_id,e.result
  from app.audit_events e where e.organization_id=org and e.occurred_at<=cut
   and (start_at is null or e.occurred_at>=start_at)
   and (actor_filter is null or e.actor_id=actor_filter)
   and (action_filter is null or e.action=action_filter)
   and (type_filter is null or e.entity_type=type_filter)
   and (entity_filter is null or e.entity_id=entity_filter)
 ), sliced as materialized(
  select * from filtered where after_id is null or occurred_at<after_at or (occurred_at=after_at and id>after_id)
  order by occurred_at desc,id asc limit n+1
 ), page_items as materialized(select * from sliced order by occurred_at desc,id asc limit n)
 select jsonb_build_object('organizationId',org,'asOf',app_private.audit_read_instant(cut),
  'items',coalesce((select jsonb_agg(jsonb_build_object('eventId',id,'occurredAt',app_private.audit_read_instant(occurred_at),
   'actorId',actor_id,'action',action,'entityType',entity_type,'entityId',entity_id,'organizationId',organization_id,'outcome',result)
   order by occurred_at desc,id asc) from page_items),'[]'::jsonb),
  'page',jsonb_build_object('totalFiltered',(select count(*) from filtered),'hasMore',(select count(*)>n from sliced),
   'nextCursor',case when (select count(*)>n from sliced) then
    (select app_private.audit_read_next_cursor(signature,id,occurred_at) from page_items order by occurred_at asc,id desc limit 1)
    else null end)),
  after_id is null or exists(select 1 from filtered where id=after_id and occurred_at=after_at)
 into response_value,valid_cursor;
 if not valid_cursor then raise exception using errcode='P0001',message='AUDIT_CURSOR_INVALID'; end if;
 return response_value;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
 raise exception using errcode='P0001',message='AUDIT_FILTER_INVALID';
end $$;

grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
do $$ declare fn regprocedure; name text; begin
 for fn,name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app_private' and (p.proname like 'audit_read_%' or p.proname='audit_events_list') loop
  execute format('alter function %s owner to alunza_identity',fn);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',fn);
  execute format('grant execute on function %s to alunza_identity',fn);
  if name='audit_events_list' then execute format('grant execute on function %s to alunza_app',fn); end if;
 end loop;
end $$;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
