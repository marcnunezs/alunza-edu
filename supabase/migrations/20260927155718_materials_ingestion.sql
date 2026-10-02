-- IMP-04.01–04.03. Domain writes are narrow, audited functions; Storage is private.
create extension if not exists vector with schema extensions;
grant usage on schema extensions to alunza_app,alunza_identity;
alter table app.activities add constraint activity_material_scope unique(organization_id,class_id,id);
create table app.sources (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, class_id uuid not null, activity_id uuid,
 owner_id uuid not null, title text not null check(length(btrim(title)) between 1 and 160),
 visibility text not null default 'VISIBLE' check(visibility in ('VISIBLE','HIDDEN')),
 current_version_id uuid, archived_at timestamptz, archived_by uuid references app.profiles(id),
 revision integer not null default 1 check(revision>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,id), unique(organization_id,class_id,id),
 foreign key(organization_id,class_id) references app.classes(organization_id,id),
 foreign key(organization_id,class_id,activity_id) references app.activities(organization_id,class_id,id),
 foreign key(organization_id,owner_id) references app.organization_memberships(organization_id,user_id)
);
create table app.source_versions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, source_id uuid not null,
 version integer not null check(version>0), storage_object_key text not null unique,
 original_name text not null check(length(original_name) between 1 and 255),
 format text not null check(format in ('PDF','TXT','MARKDOWN')), mime_type text not null,
 size_bytes integer not null check(size_bytes between 1 and 10000000), content_hash text not null check(content_hash~'^[a-f0-9]{64}$'),
 current_generation_id uuid, created_by uuid not null references app.profiles(id), created_at timestamptz not null default now(),
 unique(organization_id,id), unique(organization_id,source_id,id), unique(source_id,version),
 foreign key(organization_id,source_id) references app.sources(organization_id,id)
);
create table app.source_index_generations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, source_id uuid not null, source_version_id uuid not null,
 generation_number integer not null check(generation_number>0),
 index_status text not null default 'UPLOADED' check(index_status in ('UPLOADED','PROCESSING','READY','FAILED','ARCHIVED')),
 index_error_code text, extraction_version text, tokenizer_version text, configuration_id text,
 embedding_model text, embedding_dimension integer check(embedding_dimension between 1 and 16000),
 chunk_count integer not null default 0 check(chunk_count>=0), expected_chunk_count integer, manifest_hash text,
 usage_input_tokens bigint check(usage_input_tokens>=0), usage_batch_count integer not null default 0 check(usage_batch_count>=0),
 last_provider_request_id text check(length(last_provider_request_id)<=200), indexed_at timestamptz, created_at timestamptz not null default now(),
 unique(organization_id,id), unique(organization_id,source_id,source_version_id,id), unique(source_version_id,generation_number),
 foreign key(organization_id,source_id,source_version_id) references app.source_versions(organization_id,source_id,id),
 check(index_status<>'READY' or (chunk_count>0 and indexed_at is not null and configuration_id is not null and embedding_dimension is not null and embedding_model is not null))
);
alter table app.sources add foreign key(organization_id,id,current_version_id) references app.source_versions(organization_id,source_id,id);
alter table app.source_versions add foreign key(organization_id,source_id,id,current_generation_id) references app.source_index_generations(organization_id,source_id,source_version_id,id);
create table app.source_chunks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, source_id uuid not null, source_version_id uuid not null, generation_id uuid not null,
 chunk_index integer not null check(chunk_index>=0), text text not null check(length(text)>0), token_count integer not null check(token_count between 1 and 500),
 locator text not null check(length(locator) between 1 and 1000), content_hash text not null check(content_hash~'^[a-f0-9]{64}$'),
 embedding extensions.vector not null, unique(generation_id,chunk_index),
 foreign key(organization_id,source_id,source_version_id,generation_id) references app.source_index_generations(organization_id,source_id,source_version_id,id)
);
create table app.material_jobs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, class_id uuid not null, source_id uuid not null,
 source_version_id uuid not null, generation_id uuid not null, requested_by uuid not null references app.profiles(id),
 kind text not null check(kind in ('UPLOAD','REPLACE','REINDEX')),
 lifecycle_status text not null default 'UPLOADING' check(lifecycle_status in ('UPLOADING','QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
 operation_id uuid not null unique references app.operation_keys(id), upload_token uuid not null default gen_random_uuid(),
 attempt_count integer not null default 0 check(attempt_count between 0 and 3), upload_recovery_count integer not null default 0 check(upload_recovery_count between 0 and 3), available_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz, last_error_code text, correlation_id uuid not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
 unique(organization_id,id), foreign key(organization_id,class_id,source_id) references app.sources(organization_id,class_id,id),
 foreign key(organization_id,source_id,source_version_id,generation_id) references app.source_index_generations(organization_id,source_id,source_version_id,id),
 check(lifecycle_status<>'RUNNING' or (lease_token is not null and lease_until is not null)),
 check(lifecycle_status<>'UPLOADING' or lease_until is not null)
);
create unique index material_one_live_job on app.material_jobs(source_id) where lifecycle_status in ('UPLOADING','QUEUED','RUNNING');
create index material_jobs_ready on app.material_jobs(available_at,created_at) where lifecycle_status in ('UPLOADING','QUEUED','RUNNING');
create index material_sources_scope on app.sources(organization_id,class_id,activity_id,id);
create index material_generations_source on app.source_index_generations(source_id,created_at desc);
create table app_private.material_upload_objects (
 job_id uuid primary key references app.material_jobs(id), storage_object_key text not null unique,
 lifecycle_status text not null default 'RESERVED' check(lifecycle_status in ('RESERVED','CONFIRMED','ORPHAN','DELETED')),
 cleanup_token uuid, cleanup_until timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- This cut admits one explicit embedding profile. A future model migration must
-- coordinate the whole corpus; changing environment variables cannot mix models.
create table app_private.material_embedding_profile (
 singleton boolean primary key default true check(singleton), configuration_id text not null,
 model text not null, dimensions integer not null check(dimensions between 1 and 16000), created_at timestamptz not null default now()
);
alter table app_private.material_embedding_profile enable row level security;
alter table app_private.material_embedding_profile force row level security;
revoke all on app_private.material_embedding_profile from public,anon,authenticated,service_role,alunza_app;
grant select,insert on app_private.material_embedding_profile to alunza_identity;
create policy material_profile_read on app_private.material_embedding_profile for select to alunza_identity using(true);
create policy material_profile_insert on app_private.material_embedding_profile for insert to alunza_identity with check(true);
do $$ declare t text; begin
 foreach t in array array['sources','source_versions','source_index_generations','source_chunks','material_jobs'] loop
  execute format('alter table app.%I enable row level security',t);
  execute format('alter table app.%I force row level security',t);
  execute format('revoke all on app.%I from public,anon,authenticated,service_role,alunza_app',t);
  execute format('grant select on app.%I to alunza_app',t);
  execute format('grant select,insert,update on app.%I to alunza_identity',t);
  execute format('create policy material_internal on app.%I for all to alunza_identity using(true) with check(true)',t);
 end loop;
end $$;
revoke select on app.material_jobs from alunza_app;
grant select(id,organization_id,class_id,source_id,source_version_id,generation_id,requested_by,kind,lifecycle_status,attempt_count,available_at,last_error_code,correlation_id,created_at,updated_at,completed_at) on app.material_jobs to alunza_app;
create policy material_operation_internal on app.operation_keys for all to alunza_identity using(operation like 'material.%') with check(operation like 'material.%');
create policy material_operation_insert_guard on app.operation_keys as restrictive for insert to alunza_app with check(operation not like 'material.%');
create policy material_operation_update_guard on app.operation_keys as restrictive for update to alunza_app using(operation not like 'material.%') with check(operation not like 'material.%');
grant insert on app.audit_events to alunza_identity;
create policy material_audit_internal on app.audit_events for insert to alunza_identity with check(action like 'material.%');
alter table app_private.material_upload_objects enable row level security;
alter table app_private.material_upload_objects force row level security;
revoke all on app_private.material_upload_objects from public,anon,authenticated,service_role,alunza_app;
grant select,insert,update on app_private.material_upload_objects to alunza_identity;
create policy material_internal on app_private.material_upload_objects for all to alunza_identity using(true) with check(true);
-- Private bucket provisioning is reproducible in the Storage bootstrap script.

create function app_private.material_actor_role(actor uuid, org uuid) returns text
language sql stable security definer set search_path=pg_catalog as $$
 select m.role from app.organization_memberships m join app.profiles p on p.id=m.user_id join app.organizations o on o.id=m.organization_id
 where m.user_id=actor and m.organization_id=org and m.state='ACTIVE' and p.account_state='ACTIVE' and o.archived_at is null
$$;
create function app_private.material_can_manage(actor uuid, source uuid, own_only boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.sources s join app.classes c on c.id=s.class_id
 where s.id=source and s.archived_at is null and c.archived_at is null and
 (app_private.material_actor_role(actor,s.organization_id)='ADMIN' or
 (app_private.material_actor_role(actor,s.organization_id)='TEACHER' and c.teacher_id=actor and (not own_only or s.owner_id=actor))))
$$;
create function app_private.material_can_read(source uuid, governance boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.session_is_active(app_private.actor_id(),nullif(current_setting('app.session_id',true),'')::uuid)
 and exists(select 1 from app.sources s join app.classes c on c.id=s.class_id where s.id=source
 and (app_private.organization_id() is null or app_private.organization_id()=s.organization_id)
 and (
  (app_private.academic_role(s.organization_id,array['ADMIN'],true) and governance)
  or (app_private.academic_teacher(s.class_id,true) and governance)
  or (s.archived_at is null and c.archived_at is null and s.visibility='VISIBLE' and s.current_version_id is not null
   and (app_private.academic_student(s.class_id) or app_private.academic_teacher(s.class_id))
   and (s.activity_id is null or app_private.academic_activity_read(s.activity_id)))
 ))
$$;
create policy material_sources_read on app.sources for select to alunza_app using(app_private.material_can_read(id,true));
create policy material_versions_read on app.source_versions for select to alunza_app using(app_private.material_can_read(source_id,true)
 and exists(select 1 from app.sources s where s.id=source_id and (s.current_version_id=source_versions.id or app_private.academic_role(s.organization_id,array['ADMIN'],true) or app_private.academic_teacher(s.class_id,true))));
create policy material_generations_read on app.source_index_generations for select to alunza_app using(app_private.material_can_read(source_id,true)
 and exists(select 1 from app.sources s join app.source_versions v on v.id=s.current_version_id where s.id=source_id
 and (v.current_generation_id=source_index_generations.id or app_private.academic_role(s.organization_id,array['ADMIN'],true) or app_private.academic_teacher(s.class_id,true))));
-- Chunk text never belongs in a student's list/history response. Retrieval has its own authorized function.
create policy material_chunks_read on app.source_chunks for select to alunza_app using(false);
create policy material_jobs_read on app.material_jobs for select to alunza_app using(app_private.material_can_read(source_id,true)
 and (app_private.academic_role(organization_id,array['ADMIN']) or app_private.academic_teacher(class_id,true)));

create function app_private.material_audit(org uuid, actor uuid, action text, source uuid, correlation uuid, changes jsonb default '{}'::jsonb, outcome text default 'SUCCEEDED') returns void
language sql volatile security definer set search_path=pg_catalog as $$
 insert into app.audit_events(organization_id,actor_id,actor_kind,action,entity_type,entity_id,result,correlation_id,safe_changes)
 values(org,actor,case when app_private.actor_id() is null then 'SYSTEM' else 'USER' end,action,'source',source,outcome,correlation,changes)
$$;
create function app_private.material_assert_class(cls uuid, act uuid default null) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare c app.classes; role_name text;
begin
 if not app_private.session_is_active(app_private.actor_id(),nullif(current_setting('app.session_id',true),'')::uuid) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 select * into c from app.classes where id=cls;
 role_name:=app_private.material_actor_role(app_private.actor_id(),c.organization_id);
 if c.id is null or role_name is null or not(role_name='ADMIN' or (role_name='TEACHER' and c.teacher_id=app_private.actor_id())) then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 perform set_config('app.organization_id',c.organization_id::text,true);
 perform 1 from app.organizations where id=c.organization_id for update;
 select * into c from app.classes where id=cls;
 role_name:=app_private.material_actor_role(app_private.actor_id(),c.organization_id);
 if role_name is null or not(role_name='ADMIN' or (role_name='TEACHER' and c.teacher_id=app_private.actor_id())) then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 if c.archived_at is not null then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
 if act is not null and not exists(select 1 from app.activities where id=act and class_id=c.id and organization_id=c.organization_id) then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 return c.organization_id;
end $$;

create function app_private.material_reserve_upload(cls uuid, act uuid, source uuid, expected_revision integer, title_value text,
 original_name_value text, format_value text, mime_value text, size_value integer, hash_value text, operation_key text, correlation uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare org uuid; s app.sources; k app.operation_keys; j app.material_jobs; v uuid:=gen_random_uuid(); g uuid:=gen_random_uuid();
 sid uuid:=coalesce(source,gen_random_uuid()); op uuid:=gen_random_uuid(); job uuid:=gen_random_uuid(); key_value text; hash_payload text; operation_name text; number_value integer;
begin
 if source is not null then select * into s from app.sources where id=source; cls:=s.class_id; act:=s.activity_id; end if;
 org:=app_private.material_assert_class(cls,act);
 if source is not null and not app_private.material_can_manage(app_private.actor_id(),source,true) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 operation_name:=case when source is null then 'material.upload' else 'material.replace' end;
 hash_payload:=encode(sha256(convert_to(jsonb_build_array(cls,act,source,title_value,original_name_value,format_value,mime_value,size_value,hash_value)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(concat(org,app_private.actor_id(),operation_name,operation_key),0));
 select * into k from app.operation_keys where organization_id=org and actor_id=app_private.actor_id() and operation=operation_name and key=operation_key for update;
 if k.id is not null then
  if k.payload_hash<>hash_payload then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
  select * into j from app.material_jobs where operation_id=k.id;
  if k.state='COMPLETED' then return jsonb_build_object('kind','replay','responseStatus',k.response_status,'sourceId',j.source_id,'versionId',j.source_version_id,'generationId',j.generation_id,'jobId',j.id); end if;
  if j.lifecycle_status='UPLOADING' and j.lease_until<statement_timestamp() then
   update app.material_jobs set upload_token=gen_random_uuid(),lease_until=statement_timestamp()+interval '2 minutes',updated_at=now() where id=j.id returning * into j;
   return jsonb_build_object('kind','reserved','sourceId',j.source_id,'versionId',j.source_version_id,'generationId',j.generation_id,'jobId',j.id,'uploadToken',j.upload_token,'storageKey',(select storage_object_key from app.source_versions where id=j.source_version_id));
  end if;
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS';
 end if;
 if source is not null then
  select * into s from app.sources where id=source for update;
  if expected_revision is null or s.revision<>expected_revision then return jsonb_build_object('kind','precondition'); end if;
  if exists(select 1 from app.material_jobs where source_id=source and lifecycle_status in ('UPLOADING','QUEUED','RUNNING')) then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 else
  insert into app.sources(id,organization_id,class_id,activity_id,owner_id,title) values(sid,org,cls,act,app_private.actor_id(),title_value);
 end if;
 select coalesce(max(version),0)+1 into number_value from app.source_versions where source_id=sid;
 key_value:=concat(org,'/',cls,'/',sid,'/',v);
 insert into app.operation_keys(id,organization_id,actor_id,operation,key,payload_hash,resource_type,resource_id,lease_until)
 values(op,org,app_private.actor_id(),operation_name,operation_key,hash_payload,'source',sid,now()+interval '2 minutes');
 insert into app.source_versions(id,organization_id,source_id,version,storage_object_key,original_name,format,mime_type,size_bytes,content_hash,created_by)
 values(v,org,sid,number_value,key_value,original_name_value,format_value,mime_value,size_value,hash_value,app_private.actor_id());
 insert into app.source_index_generations(id,organization_id,source_id,source_version_id,generation_number) values(g,org,sid,v,1);
 insert into app.material_jobs(id,organization_id,class_id,source_id,source_version_id,generation_id,requested_by,kind,operation_id,lease_until,correlation_id)
 values(job,org,cls,sid,v,g,app_private.actor_id(),case when source is null then 'UPLOAD' else 'REPLACE' end,op,now()+interval '2 minutes',correlation) returning * into j;
 insert into app_private.material_upload_objects(job_id,storage_object_key) values(job,key_value);
 perform app_private.material_audit(org,app_private.actor_id(),operation_name||'_reserved',sid,correlation,jsonb_build_object('versionId',v));
 return jsonb_build_object('kind','reserved','sourceId',sid,'versionId',v,'generationId',g,'jobId',job,'uploadToken',j.upload_token,'storageKey',key_value);
end $$;

create function app_private.material_confirm_upload(job uuid, token uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare j app.material_jobs;
begin
 if app_private.actor_id() is not null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 select * into j from app.material_jobs where id=job;
 if j.id is null then return false; end if;
 perform 1 from app.organizations where id=j.organization_id for update;
 select * into j from app.material_jobs where id=job for update;
 if j.upload_token is distinct from token or j.lifecycle_status<>'UPLOADING' or j.lease_until<statement_timestamp() then return false; end if;
 if not app_private.material_can_manage(j.requested_by,j.source_id,true) then
  update app.material_jobs set lifecycle_status='CANCELLED',last_error_code='PERMISSION_REVOKED',completed_at=now(),lease_until=null where id=job;
  update app_private.material_upload_objects set lifecycle_status='ORPHAN',updated_at=now() where job_id=job;
  update app.operation_keys set state='COMPLETED',response_status=503,response_body=jsonb_build_object('sourceId',j.source_id,'jobId',j.id),lease_until=null where id=j.operation_id;
  return false;
 end if;
 update app_private.material_upload_objects set lifecycle_status='CONFIRMED',updated_at=now() where job_id=job;
 update app.material_jobs set lifecycle_status='QUEUED',lease_until=null,updated_at=now() where id=job;
 update app.operation_keys set state='COMPLETED',response_status=202,response_body=jsonb_build_object('sourceId',j.source_id,'versionId',j.source_version_id,'generationId',j.generation_id,'jobId',j.id),lease_until=null,updated_at=now() where id=j.operation_id;
 perform app_private.material_audit(j.organization_id,j.requested_by,'material.uploaded',j.source_id,j.correlation_id,jsonb_build_object('versionId',j.source_version_id));
 return true;
end $$;

create function app_private.material_reindex(source uuid, version_value uuid, expected_revision integer, operation_key text, correlation uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s app.sources; org uuid; k app.operation_keys; v uuid; g uuid:=gen_random_uuid(); job uuid:=gen_random_uuid(); op uuid:=gen_random_uuid(); latest app.source_index_generations; hash_payload text;
begin
 select * into s from app.sources where id=source;
 org:=app_private.material_assert_class(s.class_id,s.activity_id);
 if not app_private.material_can_manage(app_private.actor_id(),source,true) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 select * into s from app.sources where id=source for update;
 hash_payload:=encode(sha256(convert_to(jsonb_build_array(source,version_value)::text,'UTF8')),'hex');
 select * into k from app.operation_keys where organization_id=org and actor_id=app_private.actor_id() and operation='material.reindex' and key=operation_key;
 if k.id is not null then
  if k.payload_hash<>hash_payload then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
  return (select jsonb_build_object('kind','replay','sourceId',j.source_id,'versionId',j.source_version_id,'generationId',j.generation_id,'jobId',j.id) from app.material_jobs j where j.operation_id=k.id);
 end if;
 if expected_revision is null or s.revision<>expected_revision then return jsonb_build_object('kind','precondition'); end if;
 if exists(select 1 from app.material_jobs where source_id=source and lifecycle_status in ('UPLOADING','QUEUED','RUNNING')) then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 select * into latest from app.source_index_generations where source_id=source order by created_at desc,id desc limit 1;
 if app_private.material_actor_role(app_private.actor_id(),org)<>'ADMIN' and latest.index_status<>'FAILED' then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 v:=coalesce(version_value,case when app_private.material_actor_role(app_private.actor_id(),org)='ADMIN' then coalesce(s.current_version_id,latest.source_version_id) else latest.source_version_id end);
 if app_private.material_actor_role(app_private.actor_id(),org)<>'ADMIN' and v<>latest.source_version_id then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 if not exists(select 1 from app.source_versions where id=v and source_id=source and organization_id=org) then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 if not exists(select 1 from app_private.material_upload_objects u join app.material_jobs j on j.id=u.job_id where j.source_version_id=v and u.lifecycle_status='CONFIRMED') then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 insert into app.source_index_generations(id,organization_id,source_id,source_version_id,generation_number)
 select g,org,source,v,max(generation_number)+1 from app.source_index_generations where source_version_id=v;
 insert into app.operation_keys(id,organization_id,actor_id,operation,key,payload_hash,state,resource_type,resource_id,response_status,response_body)
 values(op,org,app_private.actor_id(),'material.reindex',operation_key,hash_payload,'COMPLETED','source',source,202,jsonb_build_object('kind','replay','sourceId',source,'versionId',v,'generationId',g,'jobId',job));
 insert into app.material_jobs(id,organization_id,class_id,source_id,source_version_id,generation_id,requested_by,kind,operation_id,lifecycle_status,correlation_id)
 values(job,org,s.class_id,source,v,g,app_private.actor_id(),'REINDEX',op,'QUEUED',correlation);
 perform app_private.material_audit(org,app_private.actor_id(),'material.reindex_requested',source,correlation,jsonb_build_object('generationId',g));
 return jsonb_build_object('kind','replay','sourceId',source,'versionId',v,'generationId',g,'jobId',job);
end $$;

create function app_private.material_govern(source uuid, expected_revision integer, visibility_value text, archive_value boolean, correlation uuid, reason_value text default null, operation_key text default null) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare s app.sources; org uuid; k app.operation_keys; hash_payload text;
begin
 select * into s from app.sources where id=source;
 org:=app_private.material_assert_class(s.class_id,s.activity_id);
 if app_private.material_actor_role(app_private.actor_id(),org)<>'ADMIN' then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 select * into s from app.sources where id=source for update;
 if archive_value then
  hash_payload:=encode(sha256(convert_to(jsonb_build_array(source,reason_value)::text,'UTF8')),'hex');
  select * into k from app.operation_keys where organization_id=org and actor_id=app_private.actor_id() and operation='material.archive' and key=operation_key;
  if k.id is not null then
   if k.payload_hash<>hash_payload then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
   return true;
  end if;
 end if;
 if expected_revision is null or s.revision<>expected_revision then return false; end if;
 if s.archived_at is not null then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
 if archive_value then
  update app.sources set archived_at=now(),archived_by=app_private.actor_id(),revision=revision+1,updated_at=now() where id=source;
  update app.material_jobs set lifecycle_status='CANCELLED',last_error_code='SOURCE_ARCHIVED',completed_at=now(),lease_until=null,lease_token=null where source_id=source and lifecycle_status in ('UPLOADING','QUEUED','RUNNING');
  update app.source_index_generations set index_status='ARCHIVED' where source_id=source and index_status in ('UPLOADED','PROCESSING');
  update app_private.material_upload_objects set lifecycle_status='ORPHAN',updated_at=now() where lifecycle_status='RESERVED' and job_id in(select id from app.material_jobs where source_id=source);
  update app.operation_keys set state='COMPLETED',response_status=503,response_body=jsonb_build_object('sourceId',source),lease_until=null where state='RUNNING' and id in(select operation_id from app.material_jobs where source_id=source and lifecycle_status='CANCELLED');
 else update app.sources set visibility=visibility_value,revision=revision+1,updated_at=now() where id=source;
 end if;
 perform app_private.material_audit(org,app_private.actor_id(),case when archive_value then 'material.archived' else 'material.visibility_changed' end,source,correlation,jsonb_build_object('visibility',visibility_value,'reason',reason_value));
 if archive_value then
  insert into app.operation_keys(organization_id,actor_id,operation,key,payload_hash,state,resource_type,resource_id,response_status,response_body)
  values(org,app_private.actor_id(),'material.archive',operation_key,hash_payload,'COMPLETED','source',source,200,jsonb_build_object('sourceId',source));
 end if;
 return true;
end $$;

create function app_private.material_claim_job() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j app.material_jobs; v app.source_versions; token uuid:=gen_random_uuid();
begin
 if app_private.actor_id() is not null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 -- Every state transition is fenced; external work never holds this transaction open.
 select * into j from app.material_jobs where
 (lifecycle_status='QUEUED' and available_at<=now()) or
 (lifecycle_status in ('UPLOADING','RUNNING') and lease_until<now())
 order by available_at,created_at for update skip locked limit 1;
 if j.id is null then return null; end if;
 if not app_private.material_can_manage(j.requested_by,j.source_id,true) then
  update app.material_jobs set lifecycle_status='CANCELLED',last_error_code='PERMISSION_REVOKED',lease_until=null,completed_at=now() where id=j.id;
  update app.source_index_generations set index_status='FAILED',index_error_code='PERMISSION_REVOKED' where id=j.generation_id and index_status<>'READY';
  update app_private.material_upload_objects set lifecycle_status='ORPHAN',updated_at=now() where job_id=j.id and lifecycle_status='RESERVED';
  update app.operation_keys set state='COMPLETED',response_status=503,response_body=jsonb_build_object('sourceId',j.source_id,'jobId',j.id),lease_until=null where id=j.operation_id and state='RUNNING';
  return null;
 end if;
 if j.lifecycle_status='UPLOADING' and j.upload_recovery_count>=3 then
  update app.material_jobs set lifecycle_status='FAILED',last_error_code='UPLOAD_INCOMPLETE',lease_until=null,completed_at=now() where id=j.id;
  update app.source_index_generations set index_status='FAILED',index_error_code='UPLOAD_INCOMPLETE' where id=j.generation_id;
  update app_private.material_upload_objects set lifecycle_status='ORPHAN',updated_at=now() where job_id=j.id;
  update app.operation_keys set state='COMPLETED',response_status=503,response_body=jsonb_build_object('sourceId',j.source_id,'jobId',j.id),lease_until=null where id=j.operation_id;
  return null;
 end if;
 if j.attempt_count>=3 then
  update app.material_jobs set lifecycle_status='FAILED',last_error_code='RETRY_LIMIT',lease_until=null,completed_at=now() where id=j.id;
  update app.source_index_generations set index_status='FAILED',index_error_code='RETRY_LIMIT' where id=j.generation_id;
  return null;
 end if;
 select * into v from app.source_versions where id=j.source_version_id;
 if j.lifecycle_status='UPLOADING' then
  update app.material_jobs set upload_token=token,upload_recovery_count=upload_recovery_count+1,lease_until=now()+interval '60 seconds',updated_at=now() where id=j.id;
  return jsonb_build_object('kind','upload','id',j.id,'token',token,'sourceId',j.source_id,'versionId',v.id,'storageKey',v.storage_object_key,'sha256',v.content_hash,'format',v.format,'attempt',j.attempt_count);
 end if;
 update app.material_jobs set lifecycle_status='RUNNING',attempt_count=attempt_count+1,lease_token=token,lease_until=now()+interval '60 seconds',updated_at=now() where id=j.id returning * into j;
 update app.source_index_generations set index_status='PROCESSING',index_error_code=null where id=j.generation_id;
 return jsonb_build_object('kind','index','id',j.id,'token',token,'sourceId',j.source_id,'versionId',v.id,'generationId',j.generation_id,'storageKey',v.storage_object_key,'sha256',v.content_hash,'format',v.format,'attempt',j.attempt_count);
end $$;
create function app_private.material_renew_job(job uuid, token uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if app_private.actor_id() is not null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 update app.material_jobs set lease_until=now()+interval '60 seconds',updated_at=now()
 where id=job and lease_token=token and lifecycle_status='RUNNING' and lease_until>now()
 and app_private.material_can_manage(requested_by,source_id,true);
 return found;
end $$;
create function app_private.material_fail_job(job uuid, token uuid, code_value text, retryable boolean default false, retry_after_ms integer default 0) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare j app.material_jobs; retry_value boolean;
begin
 if app_private.actor_id() is not null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 select * into j from app.material_jobs where id=job for update;
 if j.id is null or j.lifecycle_status not in ('UPLOADING','RUNNING') or j.lease_until<now()
 or (j.lifecycle_status='UPLOADING' and j.upload_token is distinct from token) or (j.lifecycle_status='RUNNING' and j.lease_token is distinct from token) then return false; end if;
 retry_value:=retryable and j.lifecycle_status='RUNNING' and j.attempt_count<3 and app_private.material_can_manage(j.requested_by,j.source_id,true);
 update app.material_jobs set lifecycle_status=case when retry_value then 'QUEUED' else 'FAILED' end,
 last_error_code=left(code_value,80),lease_until=null,lease_token=null,updated_at=now(),completed_at=case when retry_value then null else now() end,
 available_at=now()+greatest(case when j.attempt_count<=1 then 5000 else 30000 end,least(300000,greatest(0,retry_after_ms)))*interval '1 millisecond' where id=job;
 update app.source_index_generations set index_status=case when retry_value then 'UPLOADED' else 'FAILED' end,index_error_code=left(code_value,80) where id=j.generation_id;
 if j.lifecycle_status='UPLOADING' then
  update app_private.material_upload_objects set lifecycle_status='ORPHAN',updated_at=now() where job_id=job;
  update app.operation_keys set state='COMPLETED',response_status=503,response_body=jsonb_build_object('sourceId',j.source_id,'versionId',j.source_version_id,'generationId',j.generation_id,'jobId',j.id),lease_until=null where id=j.operation_id;
 end if;
 perform app_private.material_audit(j.organization_id,j.requested_by,'material.processing_failed',j.source_id,j.correlation_id,jsonb_build_object('code',left(code_value,80),'retry',retry_value),'FAILED');
 return true;
end $$;
create function app_private.material_prepare_generation(job uuid, token uuid, config_value text, model_value text, dimension_value integer,
 extractor_value text, tokenizer_value text, count_value integer, manifest_value text) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare j app.material_jobs; g app.source_index_generations; persisted integer;
begin
 if app_private.actor_id() is not null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 select * into j from app.material_jobs where id=job for update;
 if j.id is null or j.lifecycle_status<>'RUNNING' or j.lease_token is distinct from token or j.lease_until<now() or not app_private.material_can_manage(j.requested_by,j.source_id,true) then return -1; end if;
 select * into g from app.source_index_generations where id=j.generation_id for update;
 if count_value not between 1 and 100000 or dimension_value not between 1 and 16000 or length(config_value)<1 or length(model_value)<1 or manifest_value!~'^[a-f0-9]{64}$' then raise exception using errcode='23514',message='INVALID_GENERATION'; end if;
 insert into app_private.material_embedding_profile(configuration_id,model,dimensions) values(config_value,model_value,dimension_value) on conflict(singleton) do nothing;
 if not exists(select 1 from app_private.material_embedding_profile where configuration_id=config_value and model=model_value and dimensions=dimension_value) then return -2; end if;
 if g.configuration_id is not null and (g.configuration_id<>config_value or g.embedding_model<>model_value or g.embedding_dimension<>dimension_value
 or g.extraction_version<>extractor_value or g.tokenizer_version<>tokenizer_value or g.manifest_hash<>manifest_value or g.expected_chunk_count<>count_value) then
 raise exception using errcode='23514',message='GENERATION_CONFIGURATION_CHANGED'; end if;
 update app.source_index_generations set configuration_id=config_value,embedding_model=model_value,embedding_dimension=dimension_value,
 extraction_version=extractor_value,tokenizer_version=tokenizer_value,expected_chunk_count=count_value,manifest_hash=manifest_value where id=j.generation_id;
 select count(*) into persisted from app.source_chunks where generation_id=j.generation_id;
 return persisted;
end $$;
create function app_private.material_stage_chunks(job uuid, token uuid, chunks_value jsonb, usage_value jsonb default null) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare j app.material_jobs; g app.source_index_generations; number_value integer; chunk jsonb; vector_value extensions.vector;
begin
 if app_private.actor_id() is not null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 select * into j from app.material_jobs where id=job for update;
 if j.id is null or j.lifecycle_status<>'RUNNING' or j.lease_token is distinct from token or j.lease_until<now() or not app_private.material_can_manage(j.requested_by,j.source_id,true) then return false; end if;
 select * into g from app.source_index_generations where id=j.generation_id;
 if g.configuration_id is null or jsonb_typeof(chunks_value)<>'array' or jsonb_array_length(chunks_value) not between 1 and 32 then raise exception using errcode='23514',message='INVALID_BATCH'; end if;
 select count(*) into number_value from app.source_chunks where generation_id=g.id;
 for chunk in select value from jsonb_array_elements(chunks_value) loop
  if (chunk->>'index')::integer<>number_value or number_value>=g.expected_chunk_count then raise exception using errcode='23514',message='INVALID_CHUNK_ORDER'; end if;
  vector_value:=(chunk->'embedding')::text::extensions.vector;
  if extensions.vector_dims(vector_value)<>g.embedding_dimension or extensions.vector_norm(vector_value)=0 then raise exception using errcode='23514',message='INVALID_VECTOR'; end if;
  if encode(sha256(convert_to(chunk->>'text','UTF8')),'hex')<>chunk->>'contentHash' then raise exception using errcode='23514',message='INVALID_CHUNK_HASH'; end if;
  insert into app.source_chunks(organization_id,source_id,source_version_id,generation_id,chunk_index,text,token_count,locator,content_hash,embedding)
  values(j.organization_id,j.source_id,j.source_version_id,j.generation_id,number_value,chunk->>'text',(chunk->>'tokenCount')::integer,chunk->>'locator',chunk->>'contentHash',vector_value);
  number_value:=number_value+1;
 end loop;
 if usage_value is not null then
  if jsonb_typeof(usage_value)<>'object' or usage_value->>'model' is distinct from g.embedding_model
   or coalesce(usage_value->>'inputTokens','')!~'^[0-9]{1,12}$' then raise exception using errcode='23514',message='INVALID_USAGE'; end if;
  update app.source_index_generations set usage_input_tokens=coalesce(usage_input_tokens,0)+(usage_value->>'inputTokens')::bigint,
   usage_batch_count=usage_batch_count+1,last_provider_request_id=coalesce(left(usage_value->>'requestId',200),last_provider_request_id) where id=g.id;
 end if;
 return true;
end $$;
create function app_private.material_publish_job(job uuid, token uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare j app.material_jobs; g app.source_index_generations; number_value integer:=0;
begin
 if app_private.actor_id() is not null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 select * into j from app.material_jobs where id=job;
 if j.id is null then return false; end if;
 -- Organization lock is shared with archive and permission changes.
 perform 1 from app.organizations where id=j.organization_id for update;
 perform 1 from app.sources where id=j.source_id for update;
 select * into j from app.material_jobs where id=job for update;
 if j.lifecycle_status<>'RUNNING' or j.lease_token is distinct from token or j.lease_until<now() then return false; end if;
 if not app_private.material_can_manage(j.requested_by,j.source_id,true) then
  perform app_private.material_fail_job(job,token,'PERMISSION_REVOKED',false); return false;
 end if;
 select * into g from app.source_index_generations where id=j.generation_id;
 select count(*) into number_value from app.source_chunks where generation_id=g.id;
 if g.expected_chunk_count is null or number_value<>g.expected_chunk_count or number_value=0 then raise exception using errcode='23514',message='INCOMPLETE_GENERATION'; end if;
 update app.source_index_generations set index_status='READY',index_error_code=null,chunk_count=number_value,indexed_at=now() where id=j.generation_id;
 update app.source_versions set current_generation_id=j.generation_id where id=j.source_version_id;
 update app.sources set current_version_id=j.source_version_id,revision=revision+1,updated_at=now() where id=j.source_id;
 update app.material_jobs set lifecycle_status='SUCCEEDED',lease_until=null,lease_token=null,last_error_code=null,updated_at=now(),completed_at=now() where id=job;
 perform app_private.material_audit(j.organization_id,j.requested_by,'material.index_activated',j.source_id,j.correlation_id,jsonb_build_object('generationId',j.generation_id,'chunks',number_value));
 return true;
end $$;

create function app_private.material_claim_cleanup() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare u app_private.material_upload_objects; token uuid:=gen_random_uuid();
begin
 if app_private.actor_id() is not null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 select * into u from app_private.material_upload_objects where lifecycle_status='ORPHAN'
 and updated_at<now()-interval '2 minutes' and (cleanup_until is null or cleanup_until<now())
 and not exists(select 1 from app.source_versions v join app.sources s on s.current_version_id=v.id where v.storage_object_key=material_upload_objects.storage_object_key)
 order by created_at for update skip locked limit 1;
 if u.job_id is null then return null; end if;
 update app_private.material_upload_objects set cleanup_token=token,cleanup_until=now()+interval '60 seconds' where job_id=u.job_id;
 return jsonb_build_object('id',u.job_id,'token',token,'storageKey',u.storage_object_key);
end $$;
create function app_private.material_finish_cleanup(job uuid, token uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if app_private.actor_id() is not null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 update app_private.material_upload_objects set lifecycle_status='DELETED',cleanup_until=null,updated_at=now()
 where job_id=job and cleanup_token=token and lifecycle_status='ORPHAN'; return found;
end $$;

create function app_private.material_scopes(cls uuid) returns table(id uuid,title text,state text)
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.session_is_active(app_private.actor_id(),nullif(current_setting('app.session_id',true),'')::uuid)
 or not exists(select 1 from app.classes c where c.id=cls and (app_private.academic_role(c.organization_id,array['ADMIN']) or app_private.academic_teacher(cls))) then
 raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 return query select a.id,a.title,a.state from app.activities a where a.class_id=cls order by a.id;
end $$;
create function app_private.material_content(source uuid, version_value uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare v app.source_versions; s app.sources; admin_value boolean;
begin
 select * into s from app.sources where id=source;
 admin_value:=app_private.academic_role(s.organization_id,array['ADMIN']);
 if s.id is null or s.archived_at is not null or not app_private.material_can_read(source,true) then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 select * into v from app.source_versions where id=version_value and source_id=source;
 if v.id is null or not exists(select 1 from app_private.material_upload_objects u join app.material_jobs j on j.id=u.job_id where j.source_version_id=v.id and u.lifecycle_status='CONFIRMED') then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 if not admin_value and not app_private.academic_teacher(s.class_id,true) and (v.id<>s.current_version_id or v.current_generation_id is null or not app_private.material_can_read(source,false)) then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 return jsonb_build_object('key',v.storage_object_key,'fileName',v.original_name,'mimeType',v.mime_type,'sizeBytes',v.size_bytes,'sha256',v.content_hash);
end $$;
create function app_private.material_chunks(source uuid, version_value uuid, after_index integer, fetch_limit integer) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare s app.sources; generation uuid; rows_value jsonb; more boolean;
begin
 select * into s from app.sources where id=source;
 if s.id is null or s.archived_at is not null or not app_private.material_can_read(source,true)
 or not(app_private.academic_role(s.organization_id,array['ADMIN']) or app_private.academic_teacher(s.class_id,true)) then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 if fetch_limit not between 1 and 100 or after_index < -1 then raise exception using errcode='23514',message='INVALID_PAGINATION'; end if;
 if not exists(select 1 from app.source_versions where id=version_value and source_id=source) then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 select g.id into generation from app.source_versions v join app.source_index_generations g on g.id=v.current_generation_id
 where v.id=version_value and v.source_id=source and g.index_status='READY';
 if generation is null then return jsonb_build_object('data','[]'::jsonb,'page',jsonb_build_object('hasMore',false,'nextCursor',null)); end if;
 select coalesce(jsonb_agg(x.payload order by x.idx),'[]') into rows_value from (
 select c.chunk_index idx,jsonb_build_object('id',c.id,'sourceId',c.source_id,'versionId',c.source_version_id,'generationId',c.generation_id,
 'index',c.chunk_index,'text',c.text,'tokenCount',c.token_count,'locator',c.locator,'sha256',c.content_hash) payload
 from app.source_chunks c where c.generation_id=generation and c.chunk_index>after_index order by c.chunk_index limit fetch_limit) x;
 more:=jsonb_array_length(rows_value)=fetch_limit and exists(select 1 from app.source_chunks where generation_id=generation and chunk_index>(rows_value->-1->>'index')::integer);
 return jsonb_build_object('data',rows_value,'page',jsonb_build_object('hasMore',more,'nextCursor',case when more then rows_value->-1->>'index' else null end));
end $$;
create function app_private.material_retrieve(cls uuid, act uuid, configuration_value text, dimension_value integer, vector_value extensions.vector)
returns table(source_id uuid,source_version_id uuid,chunk_id uuid,locator text,text text,distance double precision)
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.session_is_active(app_private.actor_id(),nullif(current_setting('app.session_id',true),'')::uuid)
 or not (app_private.academic_student(cls) or app_private.academic_teacher(cls))
 or not exists(select 1 from app.activities a where a.id=act and a.class_id=cls and app_private.academic_activity_read(act)) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 if extensions.vector_dims(vector_value)<>dimension_value then raise exception using errcode='23514',message='INVALID_VECTOR'; end if;
 return query with scoped as materialized (
 select c.source_id,c.source_version_id,c.id,c.locator,c.text,c.embedding from app.source_chunks c
 join app.sources s on s.id=c.source_id join app.source_versions v on v.id=s.current_version_id
 join app.source_index_generations g on g.id=v.current_generation_id and g.id=c.generation_id
 where s.class_id=cls and (s.activity_id is null or s.activity_id=act) and app_private.material_can_read(s.id,false)
 and g.index_status='READY' and g.configuration_id=configuration_value and g.embedding_dimension=dimension_value
 ) select q.source_id,q.source_version_id,q.id,q.locator,q.text,q.embedding operator(extensions.<=>) vector_value
 from scoped q order by q.embedding operator(extensions.<=>) vector_value,q.id limit 5;
end $$;

create function app_private.guard_material_archive_dependencies() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if exists(select 1 from app.sources s where ((tg_table_name='organizations' and s.organization_id=old.id) or (tg_table_name='classes' and s.class_id=old.id)) and s.archived_at is null)
 or exists(select 1 from app.material_jobs j where ((tg_table_name='organizations' and j.organization_id=old.id) or (tg_table_name='classes' and j.class_id=old.id)) and j.lifecycle_status in ('UPLOADING','QUEUED','RUNNING')) then raise exception using errcode='P0001',message='DEPENDENCIES_ACTIVE'; end if;
 return new;
end $$;
create trigger guard_organization_materials before update of archived_at on app.organizations for each row when(old.archived_at is null and new.archived_at is not null) execute function app_private.guard_material_archive_dependencies();
create trigger guard_class_materials before update of archived_at on app.classes for each row when(old.archived_at is null and new.archived_at is not null) execute function app_private.guard_material_archive_dependencies();

create function app_private.material_record_denial(cls uuid, source uuid, operation_value text, correlation uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare org uuid; target_org uuid;
begin
 if not app_private.session_is_active(app_private.actor_id(),nullif(current_setting('app.session_id',true),'')::uuid) then return; end if;
 select organization_id into target_org from app.classes where id=cls;
 if target_org is null then select organization_id into target_org from app.sources where id=source; end if;
 -- Denials are recorded in an authorized organization of the actor. Never write
 -- a cross-tenant audit event or expose whether the opaque target exists.
 select m.organization_id into org from app.organization_memberships m join app.organizations o on o.id=m.organization_id
 where m.user_id=app_private.actor_id() and m.state='ACTIVE' and o.archived_at is null
 order by (m.organization_id=target_org) desc nulls last,m.organization_id limit 1;
 if org is not null then perform app_private.material_audit(org,app_private.actor_id(),'material.access_denied',coalesce(source,cls),correlation,
 jsonb_build_object('operation',left(operation_value,40)),'DENIED'); end if;
end $$;

grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
do $$ declare fn regprocedure; begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and (p.proname like 'material_%' or p.proname='guard_material_archive_dependencies') loop
 execute format('alter function %s owner to alunza_identity',fn); end loop;
end $$;
set role alunza_identity;
do $$ declare fn regprocedure; name_value text; begin
 for fn,name_value in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and (p.proname like 'material_%' or p.proname='guard_material_archive_dependencies') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',fn);
 if name_value not in ('material_actor_role','material_can_manage','material_audit','guard_material_archive_dependencies') then execute format('grant execute on function %s to alunza_app',fn); end if;
 end loop;
end $$;
reset role;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
