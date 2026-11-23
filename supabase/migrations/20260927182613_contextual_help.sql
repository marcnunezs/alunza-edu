-- IMP-04.04–04.06. Help reads confirmed public evidence only; no hidden-test grant.
alter table app.attempts add constraint attempts_help_scope unique(organization_id,class_id,activity_id,student_id,id);
alter table app.source_chunks add constraint chunks_help_scope unique(organization_id,source_id,source_version_id,id);
create table app.feedback_requests (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, class_id uuid not null, activity_id uuid not null,
 student_id uuid not null, attempt_id uuid not null, kind text not null check(kind in('FEEDBACK','HINT')),
 hint_level integer check(hint_level between 1 and 3), level_reserved boolean not null default false,
 lifecycle_status text not null default 'QUEUED' check(lifecycle_status in('QUEUED','RUNNING','SUCCEEDED','CANCELLED')),
 requested_at timestamptz not null default clock_timestamp(), deadline_at timestamptz not null,
 lease_token uuid, lease_until timestamptz, completed_at timestamptz, last_error_code text,
 retrieved_at timestamptz, context_fixed boolean not null default false, correlation_id uuid not null,
 unique(organization_id,id), unique(organization_id,attempt_id,id),
 foreign key(organization_id,class_id,activity_id,student_id,attempt_id) references app.attempts(organization_id,class_id,activity_id,student_id,id),
 check((kind='FEEDBACK' and hint_level is null and not level_reserved) or (kind='HINT' and hint_level is not null)),
 check(deadline_at>requested_at), check(lifecycle_status<>'RUNNING' or (lease_token is not null and lease_until is not null))
);
create unique index help_attempt_pending on app.feedback_requests(attempt_id) where lifecycle_status in('QUEUED','RUNNING') or level_reserved;
create unique index help_student_running on app.feedback_requests(student_id) where lifecycle_status in('QUEUED','RUNNING');
create index help_jobs_due on app.feedback_requests(deadline_at,requested_at) where lifecycle_status in('QUEUED','RUNNING');
create index help_student_quota on app.feedback_requests(student_id,requested_at desc);
create index help_organization_quota on app.feedback_requests(organization_id,requested_at desc);
create index help_history on app.feedback_requests(attempt_id,requested_at,id);
create table app.feedbacks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, attempt_id uuid not null, request_id uuid not null unique,
 diagnosis_code text not null check(diagnosis_code in('SUCCESS','SYNTAX_ERROR','RUNTIME_ERROR','FAILED_TEST','TIMEOUT','UNKNOWN')),
 explanation text not null check(length(btrim(explanation)) between 1 and 2000), hint text not null check(length(hint)<=1000),
 rag_status text not null check(rag_status in('SUPPORTED','NO_EVIDENCE','PROVIDER_UNAVAILABLE')),
 metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default clock_timestamp(),
 presentation_token uuid not null default gen_random_uuid(), presented_at timestamptz, viewed_at timestamptz, suppressed_at timestamptz,
 unique(organization_id,id), unique(organization_id,request_id,id),
 foreign key(organization_id,attempt_id,request_id) references app.feedback_requests(organization_id,attempt_id,id),
 check(rag_status='SUPPORTED' or hint='')
);
create table app_private.help_calls (
 request_id uuid not null, organization_id uuid not null, phase text not null check(phase in('EMBEDDING','GENERATION','REVIEW')),
 state text not null check(state in('DISPATCHED','COMPLETED')), dispatched_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz, result jsonb, usage jsonb,
 primary key(request_id,phase), foreign key(organization_id,request_id) references app.feedback_requests(organization_id,id),
 check((state='DISPATCHED' and completed_at is null and result is null) or (state='COMPLETED' and completed_at is not null and result is not null))
);
create table app_private.help_context_refs (
 organization_id uuid not null, request_id uuid not null, source_id uuid not null, source_version_id uuid not null, chunk_id uuid not null,
 locator text not null, distance double precision not null, used boolean not null default false,
 primary key(request_id,chunk_id), unique(organization_id,request_id,source_id,source_version_id,chunk_id),
 foreign key(organization_id,request_id) references app.feedback_requests(organization_id,id),
 foreign key(organization_id,source_id,source_version_id,chunk_id) references app.source_chunks(organization_id,source_id,source_version_id,id)
);
create table app_private.help_inputs (
 request_id uuid primary key, organization_id uuid not null, input jsonb not null check(octet_length(input::text)<=102400),
 metadata jsonb not null, context_hash text not null check(context_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(), foreign key(organization_id,request_id) references app.feedback_requests(organization_id,id)
);
create table app.feedback_source_refs (
 organization_id uuid not null, request_id uuid not null, feedback_id uuid not null,
 source_id uuid not null, source_version_id uuid not null, chunk_id uuid not null, locator text not null, position integer not null check(position between 0 and 4),
 primary key(feedback_id,chunk_id), unique(feedback_id,position),
 foreign key(organization_id,request_id,feedback_id) references app.feedbacks(organization_id,request_id,id),
 foreign key(organization_id,request_id,source_id,source_version_id,chunk_id) references app_private.help_context_refs(organization_id,request_id,source_id,source_version_id,chunk_id)
);
create table app_private.help_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, attempt_id uuid not null, request_id uuid not null, feedback_id uuid,
 event_type text not null check(event_type in('HELP_REQUESTED','HINT_DELIVERED','FEEDBACK_VIEWED')), hint_level integer check(hint_level between 1 and 3),
 occurred_at timestamptz not null default clock_timestamp(), unique(request_id,event_type),
 foreign key(organization_id,attempt_id,request_id) references app.feedback_requests(organization_id,attempt_id,id),
 foreign key(organization_id,request_id,feedback_id) references app.feedbacks(organization_id,request_id,id),
 check((event_type='HINT_DELIVERED' and hint_level is not null and feedback_id is not null) or (event_type<>'HINT_DELIVERED' and hint_level is null)),
 check(event_type='HELP_REQUESTED' or feedback_id is not null)
);
create unique index help_level_delivered on app_private.help_events(attempt_id,hint_level) where event_type='HINT_DELIVERED';

do $$ declare t text; begin
 foreach t in array array['app.feedback_requests','app.feedbacks','app.feedback_source_refs','app_private.help_calls','app_private.help_context_refs','app_private.help_inputs','app_private.help_events'] loop
  execute format('alter table %s enable row level security',t);
  execute format('alter table %s force row level security',t);
  execute format('revoke all on %s from public,anon,authenticated,service_role,alunza_app',t);
  execute format('grant select,insert,update on %s to alunza_identity',t);
  execute format('create policy help_internal on %s for all to alunza_identity using(true) with check(true)',t);
 end loop;
end $$;

create policy help_operations_internal on app.operation_keys for all to alunza_identity using(operation='help.request') with check(operation='help.request');
create policy help_operation_insert_guard on app.operation_keys as restrictive for insert to alunza_app with check(operation<>'help.request');
create policy help_operation_update_guard on app.operation_keys as restrictive for update to alunza_app using(operation<>'help.request') with check(operation<>'help.request');

create function app_private.help_actor_allowed(actor uuid, attempt uuid, active_class boolean default true) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.attempts a join app.classes c on c.id=a.class_id
 join app.activities act on act.id=a.activity_id
 join app.class_memberships cm on cm.organization_id=a.organization_id and cm.class_id=a.class_id and cm.user_id=actor
 where a.id=attempt and a.student_id=actor and cm.ended_at is null and (not active_class or c.archived_at is null)
 and act.state in('PUBLISHED','CLOSED') and app_private.material_actor_role(actor,a.organization_id)='STUDENT')
$$;
create function app_private.help_assert_attempt(attempt uuid, active_class boolean default true) returns app.attempts
language plpgsql security definer set search_path=pg_catalog as $$
declare a app.attempts; begin
 if not app_private.session_is_active(app_private.actor_id(),nullif(current_setting('app.session_id',true),'')::uuid)
 or not app_private.help_actor_allowed(app_private.actor_id(),attempt,active_class) then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 select * into a from app.attempts where id=attempt;
 perform set_config('app.organization_id',a.organization_id::text,true);
 return a;
end $$;
create function app_private.help_worker_only() returns void
language plpgsql security definer set search_path=pg_catalog as $$ begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
end $$;
create function app_private.help_scope_valid(request uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.help_actor_allowed(r.student_id,r.attempt_id) and not exists(
  select 1 from app_private.help_context_refs x join app.sources s on s.id=x.source_id
  join app.source_chunks c on c.id=x.chunk_id join app.source_index_generations g on g.id=c.generation_id
  where x.request_id=r.id and x.used and (s.organization_id<>r.organization_id or s.class_id<>r.class_id
   or (s.activity_id is not null and s.activity_id<>r.activity_id) or s.archived_at is not null or s.visibility<>'VISIBLE'
   or g.index_status<>'READY' or c.locator<>x.locator)) from app.feedback_requests r where r.id=request
$$;
create function app_private.help_fallback(diagnosis text, status_value text) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('diagnosis_code',diagnosis,'explanation',case when status_value='NO_EVIDENCE' then 'No hay material autorizado suficiente para sustentar esta ayuda.' else 'La ayuda no está disponible en este momento. Puedes reintentarlo más tarde.' end,
 'hint','','source_refs','[]'::jsonb,'status',status_value)
$$;
create function app_private.help_request_payload(r app.feedback_requests) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('id',r.id,'attemptId',r.attempt_id,'kind',r.kind,'hintLevel',r.hint_level,'state',case when r.lifecycle_status='CANCELLED' then 'FAILED' else r.lifecycle_status end,
 'createdAt',r.requested_at,'deadlineAt',r.deadline_at,'completedAt',r.completed_at,'feedbackId',(select id from app.feedbacks where request_id=r.id),'errorCode',r.last_error_code,
 'errorMessage',case when r.last_error_code is not null then 'No se pudo completar la ayuda. Conserva tu intento y vuelve a consultar.' else null end)
$$;

-- Suppression is durable and releases an undelivered level. It never erases a delivered event.
create function app_private.help_suppress(request uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$ begin
 update app.feedbacks set suppressed_at=coalesce(suppressed_at,clock_timestamp()) where request_id=request;
 update app.feedback_requests set level_reserved=false where id=request;
end $$;

create function app_private.help_reserve(attempt uuid, kind_value text, level_value integer, operation_key text, correlation uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare a app.attempts; r app.feedback_requests; k app.operation_keys; payload_hash text; level_next integer; ts timestamptz:=clock_timestamp(); request uuid;
begin
 a:=app_private.help_assert_attempt(attempt);
 perform 1 from app.organizations where id=a.organization_id for update;
 perform pg_advisory_xact_lock(hashtextextended(a.student_id::text,4917));
 a:=app_private.help_assert_attempt(attempt);
 perform pg_advisory_xact_lock(hashtextextended(attempt::text,4918));
 if kind_value is null or kind_value not in('FEEDBACK','HINT') or (kind_value='FEEDBACK' and level_value is not null) then raise exception using errcode='23514',message='INVALID_HELP_KIND'; end if;
 if operation_key is null or operation_key !~ '^[A-Za-z0-9._:-]{8,128}$' or correlation is null then raise exception using errcode='23514',message='INVALID_HELP_REQUEST'; end if;
 payload_hash:=encode(sha256(convert_to(jsonb_build_array(attempt,kind_value,level_value)::text,'UTF8')),'hex');
 select * into k from app.operation_keys where actor_id=a.student_id and organization_id=a.organization_id and operation='help.request' and key=operation_key;
 if k.id is not null then
  if k.payload_hash<>payload_hash then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
  select * into r from app.feedback_requests where id=k.resource_id; return app_private.help_request_payload(r);
 end if;
 -- Lazily suppress stale prepared responses before examining the held level.
 for r in select * from app.feedback_requests where attempt_id=attempt and lifecycle_status='SUCCEEDED' loop
  if not app_private.help_scope_valid(r.id) then perform app_private.help_suppress(r.id); end if;
 end loop;
 if kind_value='FEEDBACK' then
  select q.* into r from app.feedback_requests q join app.feedbacks f on f.request_id=q.id where q.attempt_id=attempt and q.kind='FEEDBACK'
   and f.rag_status='SUPPORTED' and f.suppressed_at is null order by q.requested_at desc limit 1;
  if r.id is not null then request:=r.id; end if;
 end if;
 if request is null then
  if exists(select 1 from app.feedback_requests where attempt_id=attempt and (lifecycle_status in('QUEUED','RUNNING') or level_reserved)) then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
  if exists(select 1 from app.feedback_requests where student_id=a.student_id and lifecycle_status in('QUEUED','RUNNING'))
   or (select count(*) from app.feedback_requests where organization_id=a.organization_id and lifecycle_status in('QUEUED','RUNNING'))>=4
   or (select count(*) from app.feedback_requests where student_id=a.student_id and requested_at>ts-interval '60 seconds')>=6
   or (select count(*) from app.feedback_requests where organization_id=a.organization_id and requested_at>ts-interval '60 seconds')>=60 then raise exception using errcode='P0001',message='RATE_LIMITED'; end if;
  if kind_value='HINT' then
   if a.technical_result->>'diagnosisCode'='SUCCESS' or (a.technical_result->>'diagnosisCode'='UNKNOWN' and a.technical_result->>'infrastructureStatus'='FAILED') then raise exception using errcode='23514',message='HINT_NOT_AVAILABLE'; end if;
   select coalesce(max(hint_level),0)+1 into level_next from app_private.help_events where attempt_id=attempt and event_type='HINT_DELIVERED';
   if level_next>3 or (level_value is not null and level_value<>level_next) then raise exception using errcode='23514',message='INVALID_HINT_LEVEL'; end if;
  end if;
  insert into app.feedback_requests(organization_id,class_id,activity_id,student_id,attempt_id,kind,hint_level,level_reserved,requested_at,deadline_at,correlation_id)
  values(a.organization_id,a.class_id,a.activity_id,a.student_id,a.id,kind_value,level_next,kind_value='HINT',ts,ts+interval '15 seconds',correlation) returning * into r;
  request:=r.id;
  insert into app_private.help_events(organization_id,attempt_id,request_id,event_type) values(a.organization_id,a.id,r.id,'HELP_REQUESTED');
 end if;
 insert into app.operation_keys(organization_id,actor_id,operation,key,payload_hash,state,resource_type,resource_id,response_status,response_body)
 values(a.organization_id,a.student_id,'help.request',operation_key,payload_hash,'COMPLETED','feedback_request',request,202,jsonb_build_object('requestId',request));
 return app_private.help_request_payload(r);
end $$;

create function app_private.help_job_live(request uuid, token uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.feedback_requests r where r.id=request and r.lifecycle_status='RUNNING'
 and token is not null and r.lease_token=token and r.lease_until>clock_timestamp() and r.deadline_at>clock_timestamp()
 and app_private.help_scope_valid(r.id))
$$;

create function app_private.help_store_result(request uuid, rag jsonb, metadata_value jsonb, code_value text default null) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare r app.feedback_requests; a app.attempts; f uuid:=gen_random_uuid(); ref jsonb; pos integer:=0; scope_ok boolean;
begin
 select * into r from app.feedback_requests where id=request for update;
 if r.id is null or r.lifecycle_status not in('QUEUED','RUNNING') then return false; end if;
 select * into a from app.attempts where id=r.attempt_id;
 scope_ok:=app_private.help_scope_valid(r.id);
 if not scope_ok then rag:=app_private.help_fallback(a.technical_result->>'diagnosisCode','NO_EVIDENCE'); code_value:='EVIDENCE_REVOKED'; end if;
 if jsonb_typeof(rag)<>'object' or (select count(*) from jsonb_object_keys(rag))<>5
  or not(rag ?& array['diagnosis_code','explanation','hint','source_refs','status'])
  or rag->>'diagnosis_code' is distinct from a.technical_result->>'diagnosisCode'
  or jsonb_typeof(rag->'source_refs')<>'array' or jsonb_array_length(rag->'source_refs')>5
  or jsonb_typeof(rag->'explanation')<>'string' or jsonb_typeof(rag->'hint')<>'string'
  or rag->>'status' not in('SUPPORTED','NO_EVIDENCE','PROVIDER_UNAVAILABLE') then raise exception using errcode='23514',message='INVALID_HELP_RESULT'; end if;
 if (r.kind='FEEDBACK' and rag->>'hint'<>'') or (rag->>'status'<>'SUPPORTED' and (rag->>'hint'<>'' or jsonb_array_length(rag->'source_refs')<>0))
  or (rag->>'status'='SUPPORTED' and (jsonb_array_length(rag->'source_refs')=0 or (r.kind='HINT' and length(btrim(rag->>'hint'))=0))) then raise exception using errcode='23514',message='INVALID_HELP_RESULT'; end if;
 if rag->>'status'='SUPPORTED' and not exists(select 1 from app_private.help_calls where request_id=r.id and phase='REVIEW' and state='COMPLETED'
  and result->'verification'->>'verdict'='ACCEPT') then raise exception using errcode='23514',message='UNREVIEWED_HELP'; end if;
 if rag->>'status'='SUPPORTED' and (not exists(select 1 from app_private.help_calls where request_id=r.id and phase='GENERATION' and state='COMPLETED' and result->'candidate'=rag)
 or not exists(select 1 from app_private.help_calls where request_id=r.id and phase='REVIEW' and state='COMPLETED'
  and (result->'verification'->'source_refs') @> (rag->'source_refs') and (result->'verification'->'source_refs') <@ (rag->'source_refs'))) then raise exception using errcode='23514',message='HELP_REVIEW_MISMATCH'; end if;
 insert into app.feedbacks(id,organization_id,attempt_id,request_id,diagnosis_code,explanation,hint,rag_status,metadata,suppressed_at)
 values(f,r.organization_id,r.attempt_id,r.id,rag->>'diagnosis_code',rag->>'explanation',rag->>'hint',rag->>'status',coalesce(metadata_value,'{}'),case when scope_ok then null else clock_timestamp() end);
 for ref in select value from jsonb_array_elements(rag->'source_refs') loop
  if (select count(*) from jsonb_object_keys(ref))<>4 or not exists(select 1 from app_private.help_context_refs x where x.request_id=r.id and x.used
   and x.source_id=(ref->>'source_id')::uuid and x.source_version_id=(ref->>'source_version_id')::uuid and x.chunk_id=(ref->>'chunk_id')::uuid and x.locator=ref->>'locator') then raise exception using errcode='23514',message='INVALID_HELP_REFERENCE'; end if;
  insert into app.feedback_source_refs(organization_id,request_id,feedback_id,source_id,source_version_id,chunk_id,locator,position)
  values(r.organization_id,r.id,f,(ref->>'source_id')::uuid,(ref->>'source_version_id')::uuid,(ref->>'chunk_id')::uuid,ref->>'locator',pos);
  pos:=pos+1;
 end loop;
 update app.feedback_requests set lifecycle_status='SUCCEEDED',completed_at=clock_timestamp(),lease_token=null,lease_until=null,
 level_reserved=kind='HINT' and rag->>'status'='SUPPORTED',last_error_code=left(code_value,80) where id=r.id;
 return true;
end $$;

create function app_private.help_claim() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r app.feedback_requests; token uuid:=gen_random_uuid(); diagnosis text;
begin
 perform app_private.help_worker_only();
 select * into r from app.feedback_requests where lifecycle_status='QUEUED'
 or (lifecycle_status='RUNNING' and (deadline_at<=clock_timestamp() or lease_until<=clock_timestamp()))
 order by requested_at,id for update skip locked limit 1;
 if r.id is null then return null; end if;
 select technical_result->>'diagnosisCode' into diagnosis from app.attempts where id=r.attempt_id;
 if not app_private.help_scope_valid(r.id) then
  perform app_private.help_store_result(r.id,app_private.help_fallback(diagnosis,'NO_EVIDENCE'),'{}','EVIDENCE_REVOKED'); return null;
 end if;
 if r.deadline_at<=clock_timestamp() then
  perform app_private.help_store_result(r.id,app_private.help_fallback(diagnosis,'PROVIDER_UNAVAILABLE'),'{}','DEADLINE_EXCEEDED'); return null;
 end if;
 if exists(select 1 from app_private.help_calls where request_id=r.id and state='DISPATCHED') then
  -- A crash after dispatch is indistinguishable from an unpaid or paid call.
  -- Keep the claim dormant until its original deadline; never send it again.
  update app.feedback_requests set lifecycle_status='RUNNING',lease_token=token,lease_until=deadline_at where id=r.id;
  return null;
 end if;
 update app.feedback_requests set lifecycle_status='RUNNING',lease_token=token,lease_until=least(deadline_at,clock_timestamp()+interval '10 seconds') where id=r.id;
 return jsonb_build_object('id',r.id,'token',token,'attemptId',r.attempt_id,'kind',r.kind,'hintLevel',r.hint_level,'deadlineAt',r.deadline_at);
end $$;
create function app_private.help_renew(request uuid, token uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform app_private.help_worker_only();
 update app.feedback_requests set lease_until=least(deadline_at,clock_timestamp()+interval '10 seconds')
 where id=request and app_private.help_job_live(request,token); return found;
end $$;
create function app_private.help_revalidate(request uuid, token uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform app_private.help_worker_only(); return app_private.help_job_live(request,token);
end $$;
create function app_private.help_context(request uuid, token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r app.feedback_requests; a app.attempts; e app.exercise_versions; concepts jsonb; tests jsonb;
begin
 perform app_private.help_worker_only();
 if not app_private.help_job_live(request,token) then return null; end if;
 select * into r from app.feedback_requests where id=request;
 select * into a from app.attempts where id=r.attempt_id;
 select * into e from app.exercise_versions where id=a.exercise_version_id;
 select coalesce(jsonb_agg(v.name order by v.id),'[]') into concepts from app.exercise_version_concepts c join app.concept_versions v on v.id=c.concept_version_id where c.exercise_version_id=e.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',x->>'id','passed',x->'passed')),'[]') into tests from jsonb_array_elements(a.technical_result->'visibleTestResults')x;
 return jsonb_build_object('scope',jsonb_build_object('organizationId',r.organization_id,'classId',r.class_id,'activityId',r.activity_id,'studentId',r.student_id),
 'context',jsonb_build_object('attemptId',a.id,'exerciseVersionId',e.id,'statement',e.statement,'concepts',concepts,'code',a.code,
 'diagnosisCode',a.technical_result->>'diagnosisCode','infrastructureStatus',a.technical_result->>'infrastructureStatus','visibleTests',tests));
end $$;

create function app_private.help_retrieve(request uuid, token uuid, config_value text, model_value text, dimension_value integer, vector_value extensions.vector) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r app.feedback_requests; result_value jsonb;
begin
 perform app_private.help_worker_only();
 select * into r from app.feedback_requests where id=request for update;
 if not app_private.help_job_live(request,token) then return null; end if;
 if not exists(select 1 from app_private.material_embedding_profile where configuration_id=config_value and model=model_value and dimensions=dimension_value)
  and exists(select 1 from app_private.material_embedding_profile) then raise exception using errcode='23514',message='INVALID_EMBEDDING_PROFILE'; end if;
 if extensions.vector_dims(vector_value) is distinct from dimension_value or extensions.vector_norm(vector_value)=0 then raise exception using errcode='23514',message='INVALID_VECTOR'; end if;
 if r.retrieved_at is null then
  with scoped as materialized (
   select c.id,c.source_id,c.source_version_id,c.locator,c.embedding from app.source_chunks c join app.sources s on s.id=c.source_id
   join app.source_versions v on v.id=s.current_version_id join app.source_index_generations g on g.id=v.current_generation_id and c.generation_id=g.id
   where s.organization_id=r.organization_id and s.class_id=r.class_id and (s.activity_id is null or s.activity_id=r.activity_id)
   and s.visibility='VISIBLE' and s.archived_at is null and g.index_status='READY' and g.configuration_id=config_value and g.embedding_dimension=dimension_value and g.embedding_model=model_value
  ) insert into app_private.help_context_refs(organization_id,request_id,source_id,source_version_id,chunk_id,locator,distance)
  select r.organization_id,r.id,q.source_id,q.source_version_id,q.id,q.locator,q.embedding operator(extensions.<=>) vector_value
   from scoped q order by q.embedding operator(extensions.<=>) vector_value,q.id limit 5;
  update app.feedback_requests set retrieved_at=clock_timestamp() where id=r.id;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('source_id',x.source_id,'source_version_id',x.source_version_id,'chunk_id',x.chunk_id,'locator',x.locator,'text',c.text,'distance',x.distance) order by x.distance,x.chunk_id),'[]')
 into result_value from app_private.help_context_refs x join app.source_chunks c on c.id=x.chunk_id where x.request_id=r.id;
 return result_value;
end $$;
create function app_private.help_set_context_refs(request uuid, token uuid, refs jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare r app.feedback_requests; ref jsonb;
begin
 perform app_private.help_worker_only();
 perform 1 from app.organizations where id=(select organization_id from app.feedback_requests where id=request) for update;
 select * into r from app.feedback_requests where id=request for update;
 if not app_private.help_job_live(request,token) then return false; end if;
 if jsonb_typeof(refs)<>'array' or jsonb_array_length(refs)>5 then raise exception using errcode='23514',message='INVALID_HELP_CONTEXT'; end if;
 for ref in select value from jsonb_array_elements(refs) loop
  if not exists(select 1 from app_private.help_context_refs where request_id=request and chunk_id=(ref->>'chunk_id')::uuid
   and source_id=(ref->>'source_id')::uuid and source_version_id=(ref->>'source_version_id')::uuid and locator=ref->>'locator') then raise exception using errcode='23514',message='INVALID_HELP_CONTEXT'; end if;
 end loop;
 if r.context_fixed then
  if (select count(*) from app_private.help_context_refs where request_id=request and used)<>jsonb_array_length(refs)
   or exists(select 1 from app_private.help_context_refs where request_id=request and used and not exists(select 1 from jsonb_array_elements(refs) x where (x->>'chunk_id')::uuid=chunk_id)) then raise exception using errcode='23514',message='HELP_CONTEXT_CHANGED'; end if;
  return app_private.help_scope_valid(request);
 end if;
 update app_private.help_context_refs set used=true where request_id=request and chunk_id in(select (x->>'chunk_id')::uuid from jsonb_array_elements(refs)x);
 update app.feedback_requests set context_fixed=true where id=request;
 return app_private.help_scope_valid(request);
end $$;
create function app_private.help_begin_call(request uuid, token uuid, phase_value text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r app.feedback_requests; call_value app_private.help_calls;
begin
 perform app_private.help_worker_only();
 perform 1 from app.organizations where id=(select organization_id from app.feedback_requests where id=request) for update;
 select * into r from app.feedback_requests where id=request for update;
 if not app_private.help_job_live(request,token) then return jsonb_build_object('state','STOP'); end if;
 if phase_value is null or phase_value not in('EMBEDDING','GENERATION','REVIEW') then raise exception using errcode='23514',message='INVALID_HELP_PHASE'; end if;
 if phase_value in('GENERATION','REVIEW') and not r.context_fixed then raise exception using errcode='23514',message='MISSING_HELP_CONTEXT'; end if;
 if phase_value='GENERATION' and not exists(select 1 from app_private.help_inputs where request_id=request) then raise exception using errcode='23514',message='MISSING_HELP_INPUT'; end if;
 if phase_value='REVIEW' and not exists(select 1 from app_private.help_calls where request_id=request and phase='GENERATION' and state='COMPLETED') then raise exception using errcode='23514',message='MISSING_HELP_CANDIDATE'; end if;
 select * into call_value from app_private.help_calls where request_id=request and phase=phase_value;
 if call_value.state='COMPLETED' then return jsonb_build_object('state','COMPLETED','result',call_value.result); end if;
 if call_value.state='DISPATCHED' then return jsonb_build_object('state','STOP'); end if;
 insert into app_private.help_calls(organization_id,request_id,phase,state) values(r.organization_id,r.id,phase_value,'DISPATCHED');
 return jsonb_build_object('state','DISPATCH');
end $$;
create function app_private.help_complete_call(request uuid, token uuid, phase_value text, result_value jsonb, usage_value jsonb default null) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform app_private.help_worker_only();
 perform 1 from app.feedback_requests where id=request for update;
 if not app_private.help_job_live(request,token) then return false; end if;
 if result_value is null or octet_length(result_value::text)>262144 then raise exception using errcode='23514',message='INVALID_HELP_CHECKPOINT'; end if;
 update app_private.help_calls set state='COMPLETED',completed_at=clock_timestamp(),result=result_value,usage=usage_value
 where request_id=request and phase=phase_value and state='DISPATCHED'; return found;
end $$;
create function app_private.help_finish(request uuid, token uuid, rag jsonb, metadata_value jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare r app.feedback_requests;
begin
 perform app_private.help_worker_only();
 select * into r from app.feedback_requests where id=request;
 perform 1 from app.organizations where id=r.organization_id for update;
 select * into r from app.feedback_requests where id=request for update;
 -- Scope failure is projected as NO_EVIDENCE, but an expired or stale worker
 -- cannot publish anything. Recovery owns terminalization after its deadline.
 if r.id is null or r.lifecycle_status<>'RUNNING' or token is null or r.lease_token is distinct from token
  or r.lease_until<=clock_timestamp() or r.deadline_at<=clock_timestamp() then return false; end if;
 return app_private.help_store_result(request,rag,metadata_value);
end $$;
create function app_private.help_fail(request uuid, token uuid, code_value text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare r app.feedback_requests; diagnosis text;
begin
 perform app_private.help_worker_only();
 select * into r from app.feedback_requests where id=request for update;
 if r.id is null or r.lifecycle_status<>'RUNNING' or token is null or r.lease_token is distinct from token or r.lease_until<=clock_timestamp() then return false; end if;
 select technical_result->>'diagnosisCode' into diagnosis from app.attempts where id=r.attempt_id;
 return app_private.help_store_result(request,app_private.help_fallback(diagnosis,case when code_value in('NO_EVIDENCE','CONTEXT_TOO_LARGE') then 'NO_EVIDENCE' else 'PROVIDER_UNAVAILABLE' end)||case when code_value='CONTEXT_TOO_LARGE' then jsonb_build_object('explanation','La ayuda no pudo generarse porque el contexto supera el límite permitido. Tu intento y su resultado se conservan.') else '{}'::jsonb end,'{}',code_value);
end $$;

create function app_private.help_configuration_matches(request uuid, token uuid, metadata_value jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform app_private.help_worker_only();
 if not app_private.help_job_live(request,token) then return false; end if;
 return not exists(select 1 from app_private.help_inputs where request_id=request and metadata is distinct from metadata_value);
end $$;
create function app_private.help_get_input(request uuid, token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform app_private.help_worker_only();
 if not app_private.help_job_live(request,token) then return null; end if;
 return (select input from app_private.help_inputs where request_id=request);
end $$;
create function app_private.help_prepare_input(request uuid, token uuid, input_value jsonb, metadata_value jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r app.feedback_requests; saved jsonb; refs jsonb;
begin
 perform app_private.help_worker_only();
 perform 1 from app.organizations where id=(select organization_id from app.feedback_requests where id=request) for update;
 select * into r from app.feedback_requests where id=request for update;
 if not app_private.help_job_live(request,token) then return null; end if;
 select input into saved from app_private.help_inputs where request_id=request;
 if saved is not null then return saved; end if;
 if input_value is null or octet_length(input_value::text)>102400 or jsonb_typeof(input_value->'chunks')<>'array'
 or input_value->'context'->>'attemptId' is distinct from r.attempt_id::text or input_value->>'kind' is distinct from r.kind
 or (input_value->>'hintLevel')::integer is distinct from r.hint_level
 or input_value->'context'->>'diagnosisCode' is distinct from (select technical_result->>'diagnosisCode' from app.attempts where id=r.attempt_id)
 then raise exception using errcode='23514',message='INVALID_HELP_INPUT'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('source_id',x->>'source_id','source_version_id',x->>'source_version_id','chunk_id',x->>'chunk_id','locator',x->>'locator')),'[]')
 into refs from jsonb_array_elements(input_value->'chunks')x;
 if not app_private.help_set_context_refs(request,token,refs) then return null; end if;
 insert into app_private.help_inputs(organization_id,request_id,input,metadata,context_hash)
 values(r.organization_id,r.id,input_value,coalesce(metadata_value,'{}'),encode(sha256(convert_to(input_value::text,'UTF8')),'hex'));
 return input_value;
end $$;

create function app_private.help_feedback_payload(feedback uuid, include_content boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f app.feedbacks; r app.feedback_requests; available_value boolean; rag jsonb; result_value jsonb;
begin
 select * into f from app.feedbacks where id=feedback;
 select * into r from app.feedback_requests where id=f.request_id;
 available_value:=f.suppressed_at is null and app_private.help_scope_valid(r.id);
 if available_value then
  select jsonb_build_object('diagnosis_code',f.diagnosis_code,'explanation',f.explanation,'hint',f.hint,'status',f.rag_status,
   'source_refs',coalesce(jsonb_agg(jsonb_build_object('source_id',x.source_id,'source_version_id',x.source_version_id,'chunk_id',x.chunk_id,'locator',x.locator) order by x.position) filter(where x.chunk_id is not null),'[]'))
  into rag from app.feedback_source_refs x where x.feedback_id=f.id;
 else rag:=app_private.help_fallback(f.diagnosis_code,'NO_EVIDENCE'); end if;
 result_value:=jsonb_build_object('id',f.id,'attemptId',f.attempt_id,'requestId',f.request_id,'kind',r.kind,'hintLevel',r.hint_level,
  'status',rag->>'status','createdAt',f.created_at,'viewedAt',f.viewed_at,'available',available_value);
 if include_content then
  result_value:=result_value||jsonb_build_object('help',rag,'presentationToken',case when available_value and (r.kind='FEEDBACK' or f.rag_status='SUPPORTED') then f.presentation_token else null end);
 end if;
 return result_value;
end $$;
create function app_private.help_request_status(request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r app.feedback_requests; begin
 select * into r from app.feedback_requests where id=request;
 perform app_private.help_assert_attempt(r.attempt_id,false);
 return app_private.help_request_payload(r);
end $$;
create function app_private.help_capabilities(attempt uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare a app.attempts; pending app.feedback_requests; prepared uuid; level_next integer; available_value boolean; can_hint boolean; reason_value text;
begin
 a:=app_private.help_assert_attempt(attempt,false);
 select * into pending from app.feedback_requests where attempt_id=attempt and lifecycle_status in('QUEUED','RUNNING') order by requested_at limit 1;
 select f.id into prepared from app.feedbacks f join app.feedback_requests r on r.id=f.request_id where r.attempt_id=attempt and r.level_reserved and f.suppressed_at is null;
 select coalesce(max(hint_level),0)+1 into level_next from app_private.help_events where attempt_id=attempt and event_type='HINT_DELIVERED';
 available_value:=app_private.help_actor_allowed(a.student_id,attempt) and pending.id is null and prepared is null;
 can_hint:=available_value and level_next<=3 and not(a.technical_result->>'diagnosisCode'='SUCCESS'
  or (a.technical_result->>'diagnosisCode'='UNKNOWN' and a.technical_result->>'infrastructureStatus'='FAILED'));
 reason_value:=case when not app_private.help_actor_allowed(a.student_id,attempt) then 'CLASS_ARCHIVED'
 when pending.id is not null then 'REQUEST_IN_PROGRESS' when prepared is not null then 'VIEW_PENDING_HINT'
 when level_next>3 then 'HINT_LEVELS_EXHAUSTED' when not can_hint then 'EXPLANATION_ONLY' else null end;
 return jsonb_build_object('canExplain',available_value,'canHint',can_hint,'nextHintLevel',case when can_hint then level_next else null end,
 'reason',reason_value,'pendingRequest',case when pending.id is null then null else app_private.help_request_payload(pending) end,'preparedFeedbackId',prepared);
end $$;
create function app_private.help_history(attempt uuid, cursor_value uuid, fetch_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r app.feedback_requests; rows_value jsonb; last_id uuid; more boolean;
begin
 perform app_private.help_assert_attempt(attempt,false);
 if fetch_limit not between 1 and 20 then raise exception using errcode='23514',message='INVALID_PAGINATION'; end if;
 for r in select * from app.feedback_requests where attempt_id=attempt and lifecycle_status='SUCCEEDED' loop
  if not app_private.help_scope_valid(r.id) then perform app_private.help_suppress(r.id); end if;
 end loop;
 select coalesce(jsonb_agg(x.payload order by x.id),'[]') into rows_value from
 (select f.id,app_private.help_feedback_payload(f.id,false) payload from app.feedbacks f where f.attempt_id=attempt
  and (cursor_value is null or f.id>cursor_value) order by f.id limit fetch_limit)x;
 last_id:=(rows_value->-1->>'id')::uuid;
 more:=jsonb_array_length(rows_value)=fetch_limit and exists(select 1 from app.feedbacks where attempt_id=attempt and id>last_id);
 return jsonb_build_object('items',rows_value,'nextCursor',case when more then last_id::text else null end,'capabilities',app_private.help_capabilities(attempt));
end $$;
create function app_private.help_feedback(feedback uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f app.feedbacks; a app.attempts;
begin
 select * into f from app.feedbacks where id=feedback;
 a:=app_private.help_assert_attempt(f.attempt_id,false);
 perform 1 from app.organizations where id=a.organization_id for update;
 perform pg_advisory_xact_lock(hashtextextended(a.id::text,4918));
 perform app_private.help_assert_attempt(f.attempt_id,false);
 if not app_private.help_scope_valid(f.request_id) then perform app_private.help_suppress(f.request_id); end if;
 update app.feedbacks set presented_at=coalesce(presented_at,clock_timestamp()) where id=f.id and suppressed_at is null
  and (rag_status='SUPPORTED' or exists(select 1 from app.feedback_requests where id=f.request_id and kind='FEEDBACK'));
 return app_private.help_feedback_payload(f.id,true);
end $$;
create function app_private.help_viewed(feedback uuid, presentation uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f app.feedbacks; r app.feedback_requests; a app.attempts;
begin
 select * into f from app.feedbacks where id=feedback;
 a:=app_private.help_assert_attempt(f.attempt_id,false);
 perform 1 from app.organizations where id=a.organization_id for update;
 perform pg_advisory_xact_lock(hashtextextended(a.id::text,4918));
 perform app_private.help_assert_attempt(f.attempt_id,false);
 select * into f from app.feedbacks where id=feedback for update;
 select * into r from app.feedback_requests where id=f.request_id for update;
 if not app_private.help_scope_valid(r.id) then perform app_private.help_suppress(r.id); return app_private.help_feedback_payload(f.id,true); end if;
 if f.suppressed_at is not null then return app_private.help_feedback_payload(f.id,true); end if;
 if presentation is null or f.presentation_token is distinct from presentation or f.presented_at is null or (r.kind<>'FEEDBACK' and f.rag_status<>'SUPPORTED') then raise exception using errcode='23514',message='INVALID_HELP_PRESENTATION'; end if;
 if f.viewed_at is null then
  insert into app_private.help_events(organization_id,attempt_id,request_id,feedback_id,event_type,hint_level)
  values(r.organization_id,r.attempt_id,r.id,f.id,case when r.kind='HINT' then 'HINT_DELIVERED' else 'FEEDBACK_VIEWED' end,r.hint_level);
  update app.feedbacks set viewed_at=clock_timestamp() where id=f.id;
  update app.feedback_requests set level_reserved=false where id=r.id;
 end if;
 return app_private.help_feedback_payload(f.id,true);
end $$;
create function app_private.help_reference(feedback uuid, chunk uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f app.feedbacks; result_value jsonb;
begin
 select * into f from app.feedbacks where id=feedback;
 perform app_private.help_assert_attempt(f.attempt_id,false);
 if f.suppressed_at is not null or not app_private.help_scope_valid(f.request_id) then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 select jsonb_build_object('sourceId',s.id,'versionId',v.id,'chunkId',c.id,'title',s.title,'version',v.version,
 'fileName',v.original_name,'format',v.format,'locator',x.locator,'text',c.text,'storageKey',v.storage_object_key,'mimeType',v.mime_type,'sizeBytes',v.size_bytes,'sha256',v.content_hash)
 into result_value from app.feedback_source_refs x join app.sources s on s.id=x.source_id join app.source_versions v on v.id=x.source_version_id join app.source_chunks c on c.id=x.chunk_id
 where x.feedback_id=f.id and x.chunk_id=chunk;
 if result_value is null then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 return result_value;
end $$;

create function app_private.help_revoke_request(request uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare diagnosis text; begin
 select a.technical_result->>'diagnosisCode' into diagnosis from app.feedback_requests r join app.attempts a on a.id=r.attempt_id where r.id=request;
 perform app_private.help_store_result(request,app_private.help_fallback(diagnosis,'NO_EVIDENCE'),'{}','EVIDENCE_REVOKED');
 perform app_private.help_suppress(request);
end $$;
create function app_private.help_source_revoked() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare request uuid; begin
 for request in select distinct request_id from app_private.help_context_refs where source_id=new.id and used loop
  perform app_private.help_revoke_request(request);
 end loop;
 return new;
end $$;
create trigger help_source_revoked after update of visibility,archived_at on app.sources for each row
 when ((old.visibility='VISIBLE' and new.visibility='HIDDEN') or (old.archived_at is null and new.archived_at is not null)) execute function app_private.help_source_revoked();
create function app_private.help_permission_revoked() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; org uuid; cls uuid; request uuid; begin
 if tg_table_name='profiles' then actor:=new.id;
 elsif tg_table_name='organization_memberships' then actor:=new.user_id; org:=new.organization_id;
 elsif tg_table_name='class_memberships' then actor:=new.user_id; org:=new.organization_id; cls:=new.class_id;
 elsif tg_table_name='classes' then org:=new.organization_id; cls:=new.id;
 elsif tg_table_name='organizations' then org:=new.id;
 end if;
 for request in select id from app.feedback_requests where (actor is null or student_id=actor) and (org is null or organization_id=org) and (cls is null or class_id=cls) loop
  perform app_private.help_revoke_request(request);
 end loop;
 return new;
end $$;
create trigger help_profile_revoked after update of account_state on app.profiles for each row when(old.account_state='ACTIVE' and new.account_state<>'ACTIVE') execute function app_private.help_permission_revoked();
create trigger help_membership_revoked after update of role,state on app.organization_memberships for each row when(old.state='ACTIVE' and old.role='STUDENT' and (new.state<>'ACTIVE' or new.role<>'STUDENT')) execute function app_private.help_permission_revoked();
create trigger help_enrollment_revoked after update of ended_at on app.class_memberships for each row when(old.ended_at is null and new.ended_at is not null) execute function app_private.help_permission_revoked();
create trigger help_class_archived after update of archived_at on app.classes for each row when(old.archived_at is null and new.archived_at is not null) execute function app_private.help_permission_revoked();
create trigger help_organization_archived after update of archived_at on app.organizations for each row when(old.archived_at is null and new.archived_at is not null) execute function app_private.help_permission_revoked();
-- Every new function has a fixed search_path and a non-login owner. Only the
-- explicit API/worker entry points are executable by the limited application.
create policy help_audit_internal on app.audit_events for insert to alunza_identity with check(action like 'help.%');
create function app_private.help_record_denial(target uuid, operation_value text, correlation uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare org uuid; begin
 if not app_private.session_is_active(app_private.actor_id(),nullif(current_setting('app.session_id',true),'')::uuid) then return; end if;
 select m.organization_id into org from app.organization_memberships m join app.organizations o on o.id=m.organization_id
 where m.user_id=app_private.actor_id() and m.state='ACTIVE' and o.archived_at is null order by m.organization_id limit 1;
 if org is not null then
  insert into app.audit_events(organization_id,actor_id,actor_kind,action,entity_type,entity_id,result,correlation_id,safe_changes)
  values(org,app_private.actor_id(),'USER','help.access_denied','help',target,'DENIED',correlation,jsonb_build_object('operation',left(operation_value,40)));
 end if;
end $$;
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname like 'help_%' loop
  execute format('alter function %s owner to alunza_identity',f.signature);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',f.signature);
  if f.proname in('help_reserve','help_request_status','help_history','help_capabilities','help_feedback','help_viewed','help_reference',
   'help_claim','help_renew','help_revalidate','help_context','help_retrieve','help_set_context_refs','help_begin_call','help_complete_call','help_finish','help_fail','help_get_input','help_prepare_input','help_record_denial','help_configuration_matches') then
   execute format('grant execute on function %s to alunza_app',f.signature);
  end if;
 end loop;
end $$;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
