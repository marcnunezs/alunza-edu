-- IMP-06.01: administrative metadata only. No mutations and no widening of
-- academic_activity_read or of the authoring/teaching authorization policies.

create function app_private.exercise_bank_instant(value timestamptz) returns text
language sql immutable set search_path=pg_catalog as $$
 select to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;

create function app_private.exercise_bank_context(org uuid) returns void
language plpgsql stable set search_path=pg_catalog as $$
begin
 if org is null or app_private.academic_role(org,array['ADMIN'],true) is distinct from true then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
end $$;

create function app_private.exercise_bank_organization(exercise uuid) returns uuid
language plpgsql stable set search_path=pg_catalog as $$
declare org uuid;
begin
 select organization_id into org from app.exercises where id=exercise;
 perform app_private.exercise_bank_context(org);
 return org;
end $$;

create function app_private.exercise_bank_options(options jsonb,allowed text[]) returns integer
language plpgsql immutable set search_path=pg_catalog as $$
declare n integer:=20;
begin
 if options is null or jsonb_typeof(options)<>'object' then
  raise exception using errcode='P0001',message='EXERCISE_BANK_FILTER_INVALID';
 end if;
 if (options-allowed)<>'{}'::jsonb or exists(select 1 from jsonb_each(options) where value='null'::jsonb) then
  raise exception using errcode='P0001',message='EXERCISE_BANK_FILTER_INVALID';
 end if;
 if options ? 'limit' then
  if jsonb_typeof(options->'limit')<>'number' or options->>'limit'!~'^[0-9]+$' then
   raise exception using errcode='P0001',message='EXERCISE_BANK_FILTER_INVALID';
  end if;
  n:=(options->>'limit')::integer;
 end if;
 if n not between 1 and 100 or exists(select 1 from jsonb_each(options) where key<>'limit' and jsonb_typeof(value)<>'string') then
  raise exception using errcode='P0001',message='EXERCISE_BANK_FILTER_INVALID';
 end if;
 return n;
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception using errcode='P0001',message='EXERCISE_BANK_FILTER_INVALID';
end $$;

-- The digest binds pagination context; it is not an authorization credential.
-- Every entrypoint rechecks the live actor/session/membership before decoding.
create function app_private.exercise_bank_cursor(options jsonb,signature text) returns uuid
language plpgsql immutable set search_path=pg_catalog as $$
declare encoded text:=options->>'cursor'; decoded jsonb;
begin
 if encoded is null then return null; end if;
 if length(encoded) not between 1 and 4096 or encoded!~'^[A-Za-z0-9_-]+$' then raise exception 'invalid cursor'; end if;
 decoded:=convert_from(decode(translate(encoded,'-_','+/')||repeat('=',(4-length(encoded)%4)%4),'base64'),'UTF8')::jsonb;
 if jsonb_typeof(decoded)<>'object' or (decoded-array['v','signature','key'])<>'{}'::jsonb
  or decoded->'v' is distinct from '1'::jsonb or decoded->>'signature' is distinct from signature
  or jsonb_typeof(decoded->'key')<>'object' or ((decoded->'key')-array['id'])<>'{}'::jsonb
  or jsonb_typeof(decoded->'key'->'id') is distinct from 'string' then raise exception 'invalid cursor'; end if;
 return (decoded->'key'->>'id')::uuid;
exception when others then raise exception using errcode='P0001',message='EXERCISE_BANK_CURSOR_INVALID';
end $$;

create function app_private.exercise_bank_next_cursor(signature text,id uuid) returns text
language sql immutable set search_path=pg_catalog as $$
 select rtrim(translate(replace(encode(convert_to(jsonb_build_object('v',1,'signature',signature,'key',jsonb_build_object('id',id))::text,'UTF8'),'base64'),E'\n',''),'+/','-_'),'=')
$$;

-- The kernels are invoker functions accessible only by the constrained owner.
-- All joins stay inside the organization pinned by composite foreign keys.
create function app_private.exercise_bank_version_metadata(version_ids uuid[]) returns table(id uuid,payload jsonb)
language sql stable set search_path=pg_catalog as $$
 with chosen as materialized(select v.id,v.organization_id,v.version,v.title,v.difficulty,v.created_at from app.exercise_versions v where v.id=any(version_ids)),
 concepts as(
  select link.exercise_version_id,jsonb_agg(jsonb_build_object('id',cv.concept_id,'versionId',cv.id,'name',cv.name,'version',cv.version) order by cv.concept_id,cv.version,cv.id) as payload
  from chosen v join app.exercise_version_concepts link on link.organization_id=v.organization_id and link.exercise_version_id=v.id
  join app.concept_versions cv on cv.organization_id=link.organization_id and cv.id=link.concept_version_id group by link.exercise_version_id
 ), uses as(
  select ae.exercise_version_id,count(*) as total,count(*) filter(where a.state='DRAFT') as draft,
   count(*) filter(where a.state='PUBLISHED') as published,count(*) filter(where a.state='CLOSED') as closed
  from chosen v join app.activity_exercises ae on ae.organization_id=v.organization_id and ae.exercise_version_id=v.id
  join app.activities a on a.organization_id=ae.organization_id and a.id=ae.activity_id group by ae.exercise_version_id
 )
 select v.id,jsonb_build_object('id',v.id,'version',v.version,'title',v.title,'difficulty',v.difficulty,
  'createdAt',app_private.exercise_bank_instant(v.created_at),'concepts',coalesce(c.payload,'[]'::jsonb),
  'useCounts',jsonb_build_object('total',coalesce(u.total,0),'draft',coalesce(u.draft,0),'published',coalesce(u.published,0),'closed',coalesce(u.closed,0)))
 from chosen v left join concepts c on c.exercise_version_id=v.id left join uses u on u.exercise_version_id=v.id
$$;

create function app_private.exercise_bank_entries(exercise_ids uuid[]) returns table(id uuid,payload jsonb)
language sql stable set search_path=pg_catalog as $$
 with chosen as materialized(select e.id,e.organization_id,e.revision,e.archived_at,e.visibility,e.owner_id,e.current_version_id from app.exercises e where e.id=any(exercise_ids)),
 versions as materialized(select v.id,v.exercise_id,v.organization_id from app.exercise_versions v join chosen e on e.organization_id=v.organization_id and e.id=v.exercise_id),
 counts as(select exercise_id,count(*) as total from versions group by exercise_id),
 uses as(
  select v.exercise_id,count(*) as total,count(*) filter(where a.state='DRAFT') as draft,
   count(*) filter(where a.state='PUBLISHED') as published,count(*) filter(where a.state='CLOSED') as closed
  from versions v join app.activity_exercises ae on ae.organization_id=v.organization_id and ae.exercise_version_id=v.id
  join app.activities a on a.organization_id=ae.organization_id and a.id=ae.activity_id group by v.exercise_id
 ), metadata as(select * from app_private.exercise_bank_version_metadata(array(select current_version_id from chosen)))
 select e.id,jsonb_build_object('id',e.id,'organizationId',e.organization_id,'revision',e.revision,
  'state',case when e.archived_at is null then 'ACTIVE' else 'ARCHIVED' end,'visibility',e.visibility,
  'owner',jsonb_build_object('id',e.owner_id,'displayName',p.display_name),'currentVersion',m.payload-'useCounts','versionCount',vc.total,
  'useCounts',jsonb_build_object('total',coalesce(u.total,0),'draft',coalesce(u.draft,0),'published',coalesce(u.published,0),'closed',coalesce(u.closed,0)))
 from chosen e join app.organization_memberships om on om.organization_id=e.organization_id and om.user_id=e.owner_id
 join app.profiles p on p.id=om.user_id join metadata m on m.id=e.current_version_id join counts vc on vc.exercise_id=e.id
 left join uses u on u.exercise_id=e.id
$$;

create function app_private.exercise_bank_list(org uuid,options jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare n integer; search text; state_filter text; difficulty_filter text; concept uuid; visibility_filter text;
 signature text; after_id uuid; result jsonb; valid_cursor boolean;
begin
 perform app_private.exercise_bank_context(org);
 n:=app_private.exercise_bank_options(options,array['search','state','difficulty','conceptId','visibility','cursor','limit']);
 search:=nullif(btrim(options->>'search'),''); state_filter:=options->>'state'; difficulty_filter:=options->>'difficulty';
 concept:=(options->>'conceptId')::uuid; visibility_filter:=options->>'visibility';
 if length(coalesce(search,''))>160 or state_filter not in ('ACTIVE','ARCHIVED')
  or difficulty_filter not in ('BEGINNER','INTERMEDIATE','ADVANCED') or visibility_filter not in ('PRIVATE','ORGANIZATION') then
  raise exception using errcode='P0001',message='EXERCISE_BANK_FILTER_INVALID';
 end if;
 if concept is not null and not exists(select 1 from app.concept_tags where id=concept and organization_id=org) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 signature:=md5(jsonb_build_object('actor',app_private.actor_id(),'org',org,'reader','exercise-bank','order','id:asc',
  'search',search,'state',state_filter,'difficulty',difficulty_filter,'conceptId',concept,'visibility',visibility_filter)::text);
 after_id:=app_private.exercise_bank_cursor(options,signature);
 with filtered as materialized(
  select e.id from app.exercises e join app.exercise_versions v on v.organization_id=e.organization_id and v.id=e.current_version_id
  where e.organization_id=org and (search is null or strpos(lower(v.title),lower(search))>0)
   and (state_filter is null or (case when e.archived_at is null then 'ACTIVE' else 'ARCHIVED' end)=state_filter)
   and (difficulty_filter is null or v.difficulty=difficulty_filter) and (visibility_filter is null or e.visibility=visibility_filter)
   and (concept is null or exists(select 1 from app.exercise_version_concepts link join app.concept_versions cv
    on cv.organization_id=link.organization_id and cv.id=link.concept_version_id
    where link.organization_id=org and link.exercise_version_id=v.id and cv.concept_id=concept))
 ), sliced as materialized(select id from filtered where after_id is null or id>after_id order by id limit n+1),
 page_items as materialized(select id from sliced order by id limit n),
 entries as(select * from app_private.exercise_bank_entries(array(select id from page_items)))
 select jsonb_build_object('organizationId',org,'observedAt',app_private.exercise_bank_instant(statement_timestamp()),
  'items',coalesce((select jsonb_agg(payload order by id) from entries),'[]'::jsonb),
  'page',jsonb_build_object('totalFiltered',(select count(*) from filtered),'hasMore',(select count(*)>n from sliced),
   'nextCursor',case when (select count(*)>n from sliced) then app_private.exercise_bank_next_cursor(signature,(select id from page_items order by id desc limit 1)) else null end)),
  after_id is null or exists(select 1 from filtered where id=after_id) into result,valid_cursor;
 if not valid_cursor then raise exception using errcode='P0001',message='EXERCISE_BANK_CURSOR_INVALID'; end if;
 return result;
exception when invalid_text_representation then raise exception using errcode='P0001',message='EXERCISE_BANK_FILTER_INVALID';
end $$;

create function app_private.exercise_bank_detail(exercise uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare org uuid; result jsonb;
begin
 org:=app_private.exercise_bank_organization(exercise);
 select payload||jsonb_build_object('observedAt',app_private.exercise_bank_instant(statement_timestamp())) into result
 from app_private.exercise_bank_entries(array[exercise]);
 return result;
end $$;

create function app_private.exercise_bank_versions(exercise uuid,options jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare org uuid; n integer; signature text; after_id uuid; result jsonb; valid_cursor boolean;
begin
 org:=app_private.exercise_bank_organization(exercise);
 n:=app_private.exercise_bank_options(options,array['cursor','limit']);
 signature:=md5(jsonb_build_object('actor',app_private.actor_id(),'org',org,'exercise',exercise,'reader','exercise-bank-versions','order','version:desc')::text);
 after_id:=app_private.exercise_bank_cursor(options,signature);
 with filtered as materialized(select id,version from app.exercise_versions where organization_id=org and exercise_id=exercise),
 sliced as materialized(select id,version from filtered where after_id is null or version<(select version from filtered where id=after_id) order by version desc limit n+1),
 page_items as materialized(select id,version from sliced order by version desc limit n),
 metadata as(select * from app_private.exercise_bank_version_metadata(array(select id from page_items)))
 select jsonb_build_object('organizationId',org,'exerciseId',exercise,'observedAt',app_private.exercise_bank_instant(statement_timestamp()),
  'items',coalesce((select jsonb_agg(m.payload order by p.version desc) from page_items p join metadata m on m.id=p.id),'[]'::jsonb),
  'page',jsonb_build_object('totalFiltered',(select count(*) from filtered),'hasMore',(select count(*)>n from sliced),
   'nextCursor',case when (select count(*)>n from sliced) then app_private.exercise_bank_next_cursor(signature,(select id from page_items order by version limit 1)) else null end)),
  after_id is null or exists(select 1 from filtered where id=after_id) into result,valid_cursor;
 if not valid_cursor then raise exception using errcode='P0001',message='EXERCISE_BANK_CURSOR_INVALID'; end if;
 return result;
end $$;

create function app_private.exercise_bank_uses(exercise uuid,options jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare org uuid; n integer; signature text; after_id uuid; version_id uuid; state_filter text; result jsonb; valid_cursor boolean;
begin
 org:=app_private.exercise_bank_organization(exercise);
 n:=app_private.exercise_bank_options(options,array['cursor','limit','versionId','activityState']);
 version_id:=(options->>'versionId')::uuid; state_filter:=options->>'activityState';
 if state_filter not in ('DRAFT','PUBLISHED','CLOSED') then raise exception using errcode='P0001',message='EXERCISE_BANK_FILTER_INVALID'; end if;
 if version_id is not null and not exists(select 1 from app.exercise_versions where id=version_id and organization_id=org and exercise_id=exercise) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 signature:=md5(jsonb_build_object('actor',app_private.actor_id(),'org',org,'exercise',exercise,'reader','exercise-bank-uses','order','id:asc','versionId',version_id,'activityState',state_filter)::text);
 after_id:=app_private.exercise_bank_cursor(options,signature);
 with filtered as materialized(
  select ae.id,ae.exercise_version_id,v.version,a.id as activity_id,a.title,a.state,c.id as class_id,c.name,c.archived_at is not null as archived
  from app.exercise_versions v join app.activity_exercises ae on ae.organization_id=v.organization_id and ae.exercise_version_id=v.id
  join app.activities a on a.organization_id=ae.organization_id and a.id=ae.activity_id
  join app.classes c on c.organization_id=a.organization_id and c.id=a.class_id
  where v.organization_id=org and v.exercise_id=exercise and (version_id is null or v.id=version_id) and (state_filter is null or a.state=state_filter)
 ), sliced as materialized(select * from filtered where after_id is null or id>after_id order by id limit n+1),
 page_items as materialized(select * from sliced order by id limit n)
 select jsonb_build_object('organizationId',org,'exerciseId',exercise,'observedAt',app_private.exercise_bank_instant(statement_timestamp()),
  'items',coalesce((select jsonb_agg(jsonb_build_object('assignmentId',id,'exerciseVersionId',exercise_version_id,'version',version,
   'activity',jsonb_build_object('id',activity_id,'title',title,'state',state),'class',jsonb_build_object('id',class_id,'name',name,'archived',archived)) order by id) from page_items),'[]'::jsonb),
  'page',jsonb_build_object('totalFiltered',(select count(*) from filtered),'hasMore',(select count(*)>n from sliced),
   'nextCursor',case when (select count(*)>n from sliced) then app_private.exercise_bank_next_cursor(signature,(select id from page_items order by id desc limit 1)) else null end)),
  after_id is null or exists(select 1 from filtered where id=after_id) into result,valid_cursor;
 if not valid_cursor then raise exception using errcode='P0001',message='EXERCISE_BANK_CURSOR_INVALID'; end if;
 return result;
exception when invalid_text_representation then raise exception using errcode='P0001',message='EXERCISE_BANK_FILTER_INVALID';
end $$;

grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
do $$ declare fn regprocedure; name text; begin
 for fn,name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app_private' and p.proname like 'exercise_bank_%' loop
  execute format('alter function %s owner to alunza_identity',fn);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',fn);
  execute format('grant execute on function %s to alunza_identity',fn);
  if name in ('exercise_bank_list','exercise_bank_detail','exercise_bank_versions','exercise_bank_uses') then
   execute format('grant execute on function %s to alunza_app',fn);
  end if;
 end loop;
end $$;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
