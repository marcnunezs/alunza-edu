-- IMP-04.07/08. Accounting is independent of pedagogical publication.
create table app_private.evaluation_runs (
 id uuid primary key, manifest jsonb not null, manifest_hash text not null check(manifest_hash~'^[a-f0-9]{64}$'),
 capability_hash text not null check(capability_hash~'^[a-f0-9]{64}$'),
 environment text not null check(environment in('LAB-EVAL','TEST')), provider text not null check(provider in('AZURE','TEST')),
 state text not null default 'AUTHORIZED' check(state in('AUTHORIZED','RUNNING','STOPPED','COMPLETED')),
 expires_at timestamptz not null, created_at timestamptz not null default clock_timestamp(), stopped_at timestamptz,
 calibration_artifact jsonb, calibration_artifact_hash text, check(environment<>'TEST' or provider='TEST')
);
create unique index evaluation_one_active_run on app_private.evaluation_runs((true)) where state in('AUTHORIZED','RUNNING');
create table app_private.evaluation_stages (
 run_id uuid not null references app_private.evaluation_runs(id), stage text not null check(stage in('INGESTION','CALIBRATION','FUNCTIONAL','EVALUATION')),
 state text not null default 'PENDING' check(state in('PENDING','RUNNING','COMPLETED','STOPPED')), budget jsonb not null,
 started_at timestamptz, completed_at timestamptz, primary key(run_id,stage)
);
create unique index evaluation_one_stage on app_private.evaluation_stages(run_id) where state='RUNNING';
create table app_private.evaluation_bindings (
 id uuid primary key, run_id uuid not null, stage text not null, kind text not null check(kind in('MATERIAL','HELP','CALIBRATION')),
 organization_id uuid not null, class_id uuid not null, activity_id uuid, actor_id uuid not null,
 content_hash text not null check(content_hash~'^[a-f0-9]{64}$'), attempt_id uuid, operation text, format text,
 max_operations integer not null check(max_operations between 1 and 100), calibration_metadata jsonb, review_metadata jsonb,
 unique(run_id,id), unique(organization_id,id),
 foreign key(run_id,stage) references app_private.evaluation_stages(run_id,stage),
 foreign key(organization_id,class_id) references app.classes(organization_id,id),
 foreign key(organization_id,class_id,activity_id) references app.activities(organization_id,class_id,id),
 foreign key(organization_id,actor_id) references app.organization_memberships(organization_id,user_id),
 foreign key(organization_id,class_id,activity_id,actor_id,attempt_id) references app.attempts(organization_id,class_id,activity_id,student_id,id),
 check((kind='MATERIAL' and attempt_id is null and stage='INGESTION' and operation in('UPLOAD','REPLACE','REINDEX') and format in('PDF','TXT','MARKDOWN'))
 or(kind in('HELP','CALIBRATION') and attempt_id is not null and activity_id is not null and operation is null and format is null))
);
create unique index evaluation_attempt_binding on app_private.evaluation_bindings(run_id,stage,attempt_id) where attempt_id is not null;
create table app_private.evaluation_calibrations (
 id uuid primary key references app_private.evaluation_bindings(id), organization_id uuid not null,
 state text not null default 'QUEUED' check(state in('QUEUED','RUNNING','SUCCEEDED','FAILED')),
 lease_token uuid, lease_until timestamptz, query_hash text, query_text text check(octet_length(query_text)<=20000), call_id uuid, candidates jsonb, review_result jsonb, completed_at timestamptz,
 unique(organization_id,id), foreign key(organization_id,id) references app_private.evaluation_bindings(organization_id,id)
);
create table app_private.evaluation_owners (
 owner_kind text not null check(owner_kind in('MATERIAL','HELP','CALIBRATION')), owner_id uuid not null,
 binding_id uuid not null, run_id uuid not null, organization_id uuid not null,
 primary key(owner_kind,owner_id), foreign key(run_id,binding_id) references app_private.evaluation_bindings(run_id,id),
 foreign key(organization_id,binding_id) references app_private.evaluation_bindings(organization_id,id)
);
create table app_private.ai_call_receipts (
 id uuid primary key default gen_random_uuid(), dispatch_token uuid not null default gen_random_uuid(),
 owner_kind text not null check(owner_kind in('MATERIAL','HELP','CALIBRATION')), owner_id uuid not null,
 organization_id uuid not null, class_id uuid not null, actor_id uuid not null,
 material_job_id uuid, help_request_id uuid, calibration_id uuid,
 run_id uuid, stage text, phase text not null check(phase in('EMBEDDING','GENERATION','REVIEW')),
 logical_key text not null check(length(logical_key) between 1 and 160), attempt integer not null check(attempt between 1 and 3),
 input_hash text not null check(input_hash~'^[a-f0-9]{64}$'), configuration jsonb not null,
 provider text not null check(provider in('AZURE','TEST','UNSPECIFIED')),
 state text not null default 'DISPATCHED' check(state in('DISPATCHED','COMPLETED','UNKNOWN')),
 dispatched_at timestamptz not null default clock_timestamp(), settled_at timestamptz, outcome text check(outcome in('RESPONSE','ERROR')),
 reserved_input_tokens bigint not null check(reserved_input_tokens between 0 and 1000000000), max_output_tokens bigint not null check(max_output_tokens between 0 and 1000000000),
 input_price numeric(30,0), output_price numeric(30,0), reserved_cost numeric(40,0), observed_cost numeric(40,0),
 input_tokens bigint check(input_tokens between 0 and 1000000000), output_tokens bigint check(output_tokens between 0 and 1000000000),
 observed_model text check(length(observed_model)<=160), provider_request_id text check(length(provider_request_id)<=200), aborted boolean,
 observation jsonb, result jsonb check(octet_length(result::text)<=4194304), failure jsonb,
 unique(owner_kind,owner_id,phase,logical_key,attempt), unique(organization_id,id),
 foreign key(organization_id,class_id) references app.classes(organization_id,id),
 foreign key(organization_id,actor_id) references app.organization_memberships(organization_id,user_id),
 foreign key(organization_id,material_job_id) references app.material_jobs(organization_id,id),
 foreign key(organization_id,help_request_id) references app.feedback_requests(organization_id,id),
 foreign key(organization_id,calibration_id) references app_private.evaluation_calibrations(organization_id,id),
 foreign key(run_id,stage) references app_private.evaluation_stages(run_id,stage),
 check(num_nonnulls(material_job_id,help_request_id,calibration_id)=1),
 check((owner_kind='MATERIAL' and material_job_id=owner_id and help_request_id is null and calibration_id is null)
 or(owner_kind='HELP' and help_request_id=owner_id and material_job_id is null and calibration_id is null)
 or(owner_kind='CALIBRATION' and calibration_id=owner_id and material_job_id is null and help_request_id is null)),
 check((run_id is null)=(stage is null)), check(state<>'COMPLETED' or result is not null or failure is not null)
);
alter table app_private.evaluation_calibrations add foreign key(organization_id,call_id) references app_private.ai_call_receipts(organization_id,id);
create index evaluation_receipts_run on app_private.ai_call_receipts(run_id,stage,id);
do $$ declare t text; begin
 foreach t in array array['evaluation_runs','evaluation_stages','evaluation_bindings','evaluation_calibrations','evaluation_owners','ai_call_receipts'] loop
  execute format('alter table app_private.%I enable row level security',t);
  execute format('alter table app_private.%I force row level security',t);
  execute format('revoke all on app_private.%I from public,anon,authenticated,service_role,alunza_app',t);
  execute format('grant select,insert,update on app_private.%I to alunza_identity',t);
  execute format('create policy evaluation_internal on app_private.%I for all to alunza_identity using(true) with check(true)',t);
 end loop;
end $$;

create function app_private.evaluation_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$ begin
 if tg_table_name='evaluation_runs' then
  if row(new.id,new.manifest,new.manifest_hash,new.capability_hash,new.environment,new.provider,new.expires_at,new.created_at)
   is distinct from row(old.id,old.manifest,old.manifest_hash,old.capability_hash,old.environment,old.provider,old.expires_at,old.created_at) then raise exception using errcode='23514',message='IMMUTABLE_EVALUATION_GRANT'; end if;
 elsif tg_table_name='evaluation_stages' then
  if row(new.run_id,new.stage,new.budget) is distinct from row(old.run_id,old.stage,old.budget) then raise exception using errcode='23514',message='IMMUTABLE_EVALUATION_BUDGET'; end if;
 else raise exception using errcode='23514',message='IMMUTABLE_EVALUATION_BINDING'; end if;
 return new;
end $$;
create trigger evaluation_run_immutable before update on app_private.evaluation_runs for each row execute function app_private.evaluation_immutable();
create trigger evaluation_stage_immutable before update on app_private.evaluation_stages for each row execute function app_private.evaluation_immutable();
create trigger evaluation_binding_immutable before update or delete on app_private.evaluation_bindings for each row execute function app_private.evaluation_immutable();
create function app_private.evaluation_receipt_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$ begin
 if row(new.id,new.dispatch_token,new.owner_kind,new.owner_id,new.organization_id,new.class_id,new.actor_id,new.material_job_id,new.help_request_id,new.calibration_id,
 new.run_id,new.stage,new.phase,new.logical_key,new.attempt,new.input_hash,new.configuration,new.provider,new.dispatched_at,new.reserved_input_tokens,new.max_output_tokens,new.input_price,new.output_price,new.reserved_cost)
 is distinct from row(old.id,old.dispatch_token,old.owner_kind,old.owner_id,old.organization_id,old.class_id,old.actor_id,old.material_job_id,old.help_request_id,old.calibration_id,
 old.run_id,old.stage,old.phase,old.logical_key,old.attempt,old.input_hash,old.configuration,old.provider,old.dispatched_at,old.reserved_input_tokens,old.max_output_tokens,old.input_price,old.output_price,old.reserved_cost)
 or(old.state='COMPLETED' and row(new.state,new.result,new.failure) is distinct from row(old.state,old.result,old.failure))
 or(old.state='UNKNOWN' and new.state='DISPATCHED') then raise exception using errcode='23514',message='IMMUTABLE_AI_DISPATCH'; end if;
 return new;
end $$;
create trigger evaluation_receipt_immutable before update on app_private.ai_call_receipts for each row execute function app_private.evaluation_receipt_immutable();

create function app_private.evaluation_budget_valid(b jsonb) returns boolean language sql immutable set search_path=pg_catalog as $$
 select jsonb_typeof(b)='object' and (b->>'maxCalls')~'^[0-9]{1,10}$' and (b->>'maxInputTokens')~'^[0-9]{1,10}$'
 and (b->>'maxOutputTokens')~'^[0-9]{1,10}$' and (b->>'maxCostMicroUsd')~'^(0|[1-9][0-9]{0,23})$'
 and (b->>'maxCalls')::numeric<=1000000000 and (b->>'maxInputTokens')::numeric<=1000000000 and (b->>'maxOutputTokens')::numeric<=1000000000
$$;
-- Maintenance only. No application, browser or operational-capability EXECUTE grant.
create function app_private.evaluation_authorize(m jsonb, capability_digest text) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare rid uuid:=(m->>'runId')::uuid; item jsonb; st text; old app_private.evaluation_runs; bid uuid;
begin
 if capability_digest is null or capability_digest!~'^[a-f0-9]{64}$' or m->>'version'<>'1' or octet_length(m::text)>1048576
 or m->>'environment' not in('LAB-EVAL','TEST') or m->>'provider' not in('AZURE','TEST') or (m->>'environment'='TEST' and m->>'provider'<>'TEST')
 or (m->>'expiresAt')::timestamptz<=clock_timestamp() or (m->>'expiresAt')::timestamptz>clock_timestamp()+interval '7 days'
 or m->>'corpusHash'!~'^[a-f0-9]{64}$' or m->>'environmentHash'!~'^[a-f0-9]{64}$' or not coalesce(app_private.evaluation_budget_valid(m->'globalBudget'),false)
 then raise exception using errcode='23514',message='INVALID_EVALUATION_MANIFEST'; end if;
 select * into old from app_private.evaluation_runs where id=rid for update;
 if found then
  if old.manifest is distinct from m or old.capability_hash is distinct from capability_digest then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
  return rid;
 end if;
 update app_private.evaluation_runs set state='STOPPED',stopped_at=clock_timestamp() where state in('AUTHORIZED','RUNNING') and expires_at<=clock_timestamp();
 foreach st in array array['EMBEDDING','GENERATION','REVIEW'] loop
  item:=m->'profiles'->st;
  if item->>'id' is null or item->>'model' is null or not coalesce(item->>'fingerprint'~'^[a-f0-9]{64}$',false)
   or not coalesce(item->>'inputMicroUsdPerMillion'~'^(0|[1-9][0-9]{0,23})$',false)
   or not coalesce(item->>'outputMicroUsdPerMillion'~'^(0|[1-9][0-9]{0,23})$',false)
   or(st='EMBEDDING' and not coalesce((item->>'dimensions')::integer between 1 and 16000,false)) then raise exception using errcode='23514',message='INVALID_EVALUATION_PROFILE'; end if;
 end loop;
 if exists(select 1 from app_private.material_embedding_profile p where p.configuration_id is distinct from m->'profiles'->'EMBEDDING'->>'id'
  or p.model is distinct from m->'profiles'->'EMBEDDING'->>'model' or p.dimensions is distinct from (m->'profiles'->'EMBEDDING'->>'dimensions')::integer)
 then raise exception using errcode='23514',message='EVALUATION_REQUIRES_ISOLATED_EMBEDDING_PROFILE'; end if;
 insert into app_private.evaluation_runs(id,manifest,manifest_hash,capability_hash,environment,provider,expires_at)
 values(rid,m,encode(sha256(convert_to(m::text,'UTF8')),'hex'),capability_digest,m->>'environment',m->>'provider',(m->>'expiresAt')::timestamptz);
 foreach st in array array['INGESTION','CALIBRATION','FUNCTIONAL','EVALUATION'] loop
  if not coalesce(app_private.evaluation_budget_valid(m->'stages'->st),false) then raise exception using errcode='23514',message='INVALID_EVALUATION_BUDGET'; end if;
  insert into app_private.evaluation_stages(run_id,stage,budget) values(rid,st,m->'stages'->st);
 end loop;
 for item in select * from jsonb_array_elements(m->'materials') loop
  insert into app_private.evaluation_bindings(id,run_id,stage,kind,organization_id,class_id,activity_id,actor_id,content_hash,operation,format,max_operations)
  values((item->>'id')::uuid,rid,'INGESTION','MATERIAL',(item->>'organizationId')::uuid,(item->>'classId')::uuid,(item->>'activityId')::uuid,
  (item->>'actorId')::uuid,item->>'sha256',item->>'operation',item->>'format',(item->>'maxOperations')::integer);
 end loop;
 for item in select * from jsonb_array_elements(m->'cases') loop
  if not exists(select 1 from app.attempts a where a.id=(item->>'attemptId')::uuid and a.code_hash=item->>'codeHash'
   and app_private.help_actor_allowed((item->>'actorId')::uuid,a.id)) then raise exception using errcode='23514',message='INVALID_EVALUATION_ATTEMPT'; end if;
  st:=item->>'stage'; bid:=(item->>'id')::uuid;
  insert into app_private.evaluation_bindings(id,run_id,stage,kind,organization_id,class_id,activity_id,actor_id,content_hash,attempt_id,max_operations,calibration_metadata,review_metadata)
  values(bid,rid,st,case when st='CALIBRATION' or item->'reviewCase' is not null then 'CALIBRATION' else 'HELP' end,(item->>'organizationId')::uuid,(item->>'classId')::uuid,
  (item->>'activityId')::uuid,(item->>'actorId')::uuid,item->>'codeHash',(item->>'attemptId')::uuid,(item->>'maxOperations')::integer,item->'calibration',item->'reviewCase');
  if st='CALIBRATION' or item->'reviewCase' is not null then insert into app_private.evaluation_calibrations(id,organization_id) values(bid,(item->>'organizationId')::uuid); end if;
 end loop;
 -- Dataset labels do not establish a holdout: actual exercise families and
 -- document contents must also be disjoint between calibration and validation.
 if exists(select 1 from app_private.evaluation_bindings a join app_private.evaluation_bindings b on b.run_id=a.run_id
  join app.attempts aa on aa.id=a.attempt_id join app.attempts ba on ba.id=b.attempt_id
  join app.exercise_versions ae on ae.id=aa.exercise_version_id join app.exercise_versions be on be.id=ba.exercise_version_id
  where a.run_id=rid and a.stage='CALIBRATION' and b.stage='CALIBRATION' and a.calibration_metadata->>'split'<>b.calibration_metadata->>'split'
  and(ae.exercise_id=be.exercise_id or a.calibration_metadata->>'groupId'=b.calibration_metadata->>'groupId'))
 or exists(select 1 from app_private.evaluation_bindings a join app_private.evaluation_bindings b on b.run_id=a.run_id
  join app_private.evaluation_bindings ad on ad.run_id=a.run_id and ad.id::text in(select jsonb_array_elements_text(a.calibration_metadata->'relevantBindingIds'))
  join app_private.evaluation_bindings bd on bd.run_id=b.run_id and bd.id::text in(select jsonb_array_elements_text(b.calibration_metadata->'relevantBindingIds'))
  where a.run_id=rid and a.stage='CALIBRATION' and b.stage='CALIBRATION' and a.calibration_metadata->>'split'<>b.calibration_metadata->>'split' and ad.content_hash=bd.content_hash)
 or exists(select 1 from app_private.evaluation_bindings a join app_private.evaluation_bindings b on b.run_id=a.run_id
  join app_private.evaluation_bindings ad on ad.run_id=a.run_id and ad.kind='MATERIAL' and ad.organization_id=a.organization_id and ad.class_id=a.class_id and(ad.activity_id is null or ad.activity_id=a.activity_id)
  join app_private.evaluation_bindings bd on bd.run_id=b.run_id and bd.kind='MATERIAL' and bd.organization_id=b.organization_id and bd.class_id=b.class_id and(bd.activity_id is null or bd.activity_id=b.activity_id)
  where a.run_id=rid and a.stage='CALIBRATION' and b.stage='CALIBRATION' and a.calibration_metadata->>'split'<>b.calibration_metadata->>'split' and ad.content_hash=bd.content_hash)
 then raise exception using errcode='23514',message='CALIBRATION_HOLDOUT_CONTAMINATED'; end if;
 return rid;
end $$;

create function app_private.evaluation_capability(rid uuid, digest text) returns app_private.evaluation_runs
language plpgsql security definer set search_path=pg_catalog as $$ declare r app_private.evaluation_runs; begin
 perform app_private.help_worker_only();
 select * into r from app_private.evaluation_runs where id=rid;
 if r.id is null or digest is null or r.capability_hash is distinct from digest or r.expires_at<=clock_timestamp() then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 return r;
end $$;

create function app_private.evaluation_owner(kind_value text, oid uuid, token uuid, required_value boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare org uuid; cls uuid; act uuid; actor uuid; content text; attempt_value uuid; op text; fmt text;
 b app_private.evaluation_bindings; j app.material_jobs; h app.feedback_requests; c app_private.evaluation_calibrations;
begin
 perform app_private.help_worker_only();
 if token is null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 -- Heartbeats and dispatches may reach the first owner binding concurrently.
 -- Always acquire the owner lock before the shared run/budget row lock.
 perform pg_advisory_xact_lock(hashtextextended(kind_value||oid::text,834));
 if kind_value='MATERIAL' then
  select * into j from app.material_jobs where id=oid;
  if j.id is null or j.lease_token is distinct from token or j.lifecycle_status<>'RUNNING' or j.lease_until<=clock_timestamp()
   or not app_private.material_can_manage(j.requested_by,j.source_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  org:=j.organization_id; cls:=j.class_id; actor:=j.requested_by; op:=j.kind;
  select activity_id into act from app.sources where id=j.source_id;
  select content_hash,format into content,fmt from app.source_versions where id=j.source_version_id;
 elsif kind_value='HELP' then
  if not app_private.help_job_live(oid,token) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  select * into h from app.feedback_requests where id=oid;
  org:=h.organization_id; cls:=h.class_id; act:=h.activity_id; actor:=h.student_id; attempt_value:=h.attempt_id;
  select code_hash into content from app.attempts where id=attempt_value;
 elsif kind_value='CALIBRATION' then
  select * into c from app_private.evaluation_calibrations where id=oid;
  select * into b from app_private.evaluation_bindings where id=oid;
  if c.id is null or c.lease_token is distinct from token or c.state<>'RUNNING' or c.lease_until<=clock_timestamp()
   or not app_private.help_actor_allowed(b.actor_id,b.attempt_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  org:=b.organization_id; cls:=b.class_id; act:=b.activity_id; actor:=b.actor_id; content:=b.content_hash; attempt_value:=b.attempt_id;
 else raise exception using errcode='23514',message='INVALID_EVALUATION_OWNER'; end if;
 -- Once this isolated database has an evaluation grant, no caller can opt out.
 required_value:=required_value or exists(select 1 from app_private.evaluation_runs);
 if required_value then
  select bb.* into b from app_private.evaluation_owners o join app_private.evaluation_bindings bb on bb.id=o.binding_id where o.owner_kind=kind_value and o.owner_id=oid;
  if not found then
   select bb.* into b from app_private.evaluation_bindings bb join app_private.evaluation_runs r on r.id=bb.run_id
    join app_private.evaluation_stages s on s.run_id=bb.run_id and s.stage=bb.stage
   where bb.kind=kind_value and bb.organization_id=org and bb.class_id=cls and bb.activity_id is not distinct from act and bb.actor_id=actor and bb.content_hash=content
    and bb.attempt_id is not distinct from attempt_value and bb.operation is not distinct from op and bb.format is not distinct from fmt
    and r.state='RUNNING' and r.expires_at>clock_timestamp() and s.state='RUNNING' order by bb.id limit 1;
   if b.id is null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
   perform 1 from app_private.evaluation_runs where id=b.run_id for update;
   if (select count(*) from app_private.evaluation_owners where binding_id=b.id)>=b.max_operations then raise exception using errcode='P0001',message='RATE_LIMITED'; end if;
   insert into app_private.evaluation_owners(owner_kind,owner_id,binding_id,run_id,organization_id) values(kind_value,oid,b.id,b.run_id,org);
  end if;
  perform 1 from app_private.evaluation_runs r join app_private.evaluation_stages s on s.run_id=r.id and s.stage=b.stage
  where r.id=b.run_id and r.state='RUNNING' and r.expires_at>clock_timestamp() and s.state='RUNNING' for update of r;
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 end if;
 return jsonb_build_object('organizationId',org,'classId',cls,'actorId',actor,'runId',b.run_id,'stage',b.stage);
end $$;

create function app_private.evaluation_totals(rid uuid, st text default null) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('calls',count(*),'inputTokens',coalesce(sum(case when state='COMPLETED' then coalesce(input_tokens,reserved_input_tokens) else greatest(coalesce(input_tokens,0),reserved_input_tokens) end),0),
 'outputTokens',coalesce(sum(case when state='COMPLETED' then coalesce(output_tokens,max_output_tokens) else greatest(coalesce(output_tokens,0),max_output_tokens) end),0),
 'costMicroUsd',coalesce(sum(case when state='COMPLETED' then coalesce(observed_cost,reserved_cost) else greatest(coalesce(observed_cost,0),reserved_cost) end),0)::text,
 'unknownCalls',count(*)filter(where state='UNKNOWN' or (state='DISPATCHED')),
 'incompleteUsageCalls',count(*)filter(where input_tokens is null or output_tokens is null),
 'observedInputTokens',sum(input_tokens),'observedOutputTokens',sum(output_tokens),'observedCostMicroUsd',sum(observed_cost)::text)
 from app_private.ai_call_receipts where run_id=rid and (st is null or stage=st)
$$;
create function app_private.evaluation_fits(b jsonb,t jsonb, inputs bigint, outputs bigint, cost numeric) returns boolean
language sql immutable set search_path=pg_catalog as $$ select
 (t->>'calls')::numeric+1<=(b->>'maxCalls')::numeric and (t->>'inputTokens')::numeric+inputs<=(b->>'maxInputTokens')::numeric
 and (t->>'outputTokens')::numeric+outputs<=(b->>'maxOutputTokens')::numeric and (t->>'costMicroUsd')::numeric+cost<=(b->>'maxCostMicroUsd')::numeric $$;

create function app_private.evaluation_reserve(spec jsonb, required_value boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare owner_value jsonb; r app_private.evaluation_runs; prior app_private.ai_call_receipts; receipt app_private.ai_call_receipts;
 prof jsonb; budget jsonb; in_price numeric; out_price numeric; cost numeric;
 kind_value text:=spec->'owner'->>'kind'; oid uuid:=(spec->'owner'->>'id')::uuid; phase_value text:=spec->>'phase';
 logical text:=spec->>'logicalKey'; attempt_value integer:=coalesce((spec->>'attempt')::integer,1);
 inputs bigint:=(spec->>'reservedInputTokens')::bigint; outputs bigint:=(spec->>'maxOutputTokens')::bigint;
begin
 perform app_private.help_worker_only();
 if inputs is null or outputs is null or inputs not between 0 and 1000000000 or outputs not between 0 and 1000000000 or phase_value not in('EMBEDDING','GENERATION','REVIEW')
 or logical is null or length(logical) not between 1 and 160 or spec->>'inputHash'!~'^[a-f0-9]{64}$' or attempt_value not between 1 and 3 then raise exception using errcode='23514',message='INVALID_AI_RESERVATION'; end if;
 perform pg_advisory_xact_lock(hashtextextended(kind_value||oid::text,834));
 owner_value:=app_private.evaluation_owner(kind_value,oid,(spec->'owner'->>'token')::uuid,required_value);
 if(kind_value='MATERIAL' and phase_value<>'EMBEDDING') or(kind_value='CALIBRATION' and phase_value<>'EMBEDDING' and not(phase_value='REVIEW' and owner_value->>'stage'='EVALUATION')) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 select * into prior from app_private.ai_call_receipts where owner_kind=kind_value and owner_id=oid and phase=phase_value and logical_key=logical order by attempt desc limit 1 for update;
 if prior.id is not null then
  if prior.input_hash is distinct from spec->>'inputHash' or prior.configuration is distinct from spec->'configuration' or prior.reserved_input_tokens<>inputs or prior.max_output_tokens<>outputs then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
  if prior.state='COMPLETED' and prior.result is not null then return jsonb_build_object('state','COMPLETED','callId',prior.id,'result',prior.result); end if;
  if prior.state<>'COMPLETED' then return jsonb_build_object('state','STOP','callId',prior.id); end if;
  if not coalesce((prior.failure->>'retryable')::boolean,false) or attempt_value<>prior.attempt+1 then
   return jsonb_build_object('state','ERROR','callId',prior.id,'failure',prior.failure);
  end if;
 end if;
 if owner_value->>'runId' is not null then
  select * into r from app_private.evaluation_runs where id=(owner_value->>'runId')::uuid for update;
  prof:=r.manifest->'profiles'->phase_value;
  if prof->>'id' is distinct from spec->'configuration'->>'id' or prof->>'model' is distinct from spec->'configuration'->>'model'
   or prof->>'fingerprint' is distinct from spec->'configuration'->>'fingerprint'
   or prof->>'dimensions' is distinct from spec->'configuration'->>'dimensions' then raise exception using errcode='23514',message='INVALID_EVALUATION_PROFILE'; end if;
  if phase_value<>'EMBEDDING' and (r.calibration_artifact is null or owner_value->>'stage' not in('FUNCTIONAL','EVALUATION')) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  in_price:=(prof->>'inputMicroUsdPerMillion')::numeric; out_price:=(prof->>'outputMicroUsdPerMillion')::numeric;
  cost:=ceil((inputs*in_price+outputs*out_price)/1000000);
  select s.budget into budget from app_private.evaluation_stages s where s.run_id=r.id and s.stage=owner_value->>'stage';
  if not app_private.evaluation_fits(r.manifest->'globalBudget',app_private.evaluation_totals(r.id),inputs,outputs,cost)
   or not app_private.evaluation_fits(budget,app_private.evaluation_totals(r.id,owner_value->>'stage'),inputs,outputs,cost)
  then raise exception using errcode='P0001',message='RATE_LIMITED'; end if;
 end if;
 insert into app_private.ai_call_receipts(owner_kind,owner_id,organization_id,class_id,actor_id,material_job_id,help_request_id,calibration_id,
 run_id,stage,phase,logical_key,attempt,input_hash,configuration,provider,reserved_input_tokens,max_output_tokens,input_price,output_price,reserved_cost)
 values(kind_value,oid,(owner_value->>'organizationId')::uuid,(owner_value->>'classId')::uuid,(owner_value->>'actorId')::uuid,
 case when kind_value='MATERIAL' then oid end,case when kind_value='HELP' then oid end,case when kind_value='CALIBRATION' then oid end,
 r.id,owner_value->>'stage',phase_value,logical,attempt_value,spec->>'inputHash',spec->'configuration',coalesce(r.provider,'UNSPECIFIED'),inputs,outputs,in_price,out_price,cost)
 returning * into receipt;
 return jsonb_build_object('state','DISPATCH','callId',receipt.id,'dispatchToken',receipt.dispatch_token);
end $$;

create function app_private.evaluation_observe(cid uuid, token uuid, event_value jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare c app_private.ai_call_receipts; observed_inputs bigint; observed_outputs bigint; model_value text;
begin
 perform app_private.help_worker_only();
 select * into c from app_private.ai_call_receipts where id=cid;
 if c.id is null or token is null or c.dispatch_token is distinct from token then return false; end if;
 if c.run_id is not null then perform 1 from app_private.evaluation_runs where id=c.run_id for update; end if;
 select * into c from app_private.ai_call_receipts where id=cid for update;
 if event_value->>'phase' is distinct from c.phase or event_value->>'outcome' not in('RESPONSE','ERROR') or octet_length(event_value::text)>4096 then return false; end if;
 observed_inputs:=(event_value->'usage'->>'inputTokens')::bigint; observed_outputs:=(event_value->'usage'->>'outputTokens')::bigint;
 if c.phase='EMBEDDING' and event_value->>'outcome'='RESPONSE' then observed_outputs:=0; end if;
 if observed_inputs not between 0 and 1000000000 or observed_outputs not between 0 and 1000000000 then return false; end if;
 model_value:=event_value->>'model';
 if (c.input_tokens is not null and observed_inputs is not null and c.input_tokens<>observed_inputs)
 or(c.output_tokens is not null and observed_outputs is not null and c.output_tokens<>observed_outputs)
 or(c.observed_model is not null and model_value is not null and c.observed_model<>model_value) then return false; end if;
 update app_private.ai_call_receipts set settled_at=coalesce(settled_at,(event_value->>'settledAt')::timestamptz),
 outcome=coalesce(outcome,event_value->>'outcome'), input_tokens=coalesce(input_tokens,observed_inputs),output_tokens=coalesce(output_tokens,observed_outputs),
 observed_model=coalesce(observed_model,model_value),provider_request_id=coalesce(provider_request_id,left(event_value->>'requestId',200)),
 aborted=coalesce(aborted,(event_value->>'aborted')::boolean),observation=coalesce(observation,event_value)
 where id=cid returning * into c;
 if c.input_tokens is not null and c.output_tokens is not null and c.observed_model=c.configuration->>'model' and c.input_price is not null then
  update app_private.ai_call_receipts set observed_cost=ceil((c.input_tokens*c.input_price+c.output_tokens*c.output_price)/1000000) where id=cid;
 end if;
 if c.run_id is not null and (c.input_tokens>c.reserved_input_tokens or c.output_tokens>c.max_output_tokens or (c.observed_model is not null and c.observed_model<>c.configuration->>'model')) then
  update app_private.evaluation_runs set state='STOPPED',stopped_at=coalesce(stopped_at,clock_timestamp()) where id=c.run_id;
  update app_private.evaluation_stages set state='STOPPED' where run_id=c.run_id and state='RUNNING';
 end if;
 -- Accounting deliberately does not inspect current membership, lease or deadline.
 return true;
end $$;

create function app_private.evaluation_complete(cid uuid, token uuid, result_value jsonb, failure_value jsonb default null) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ declare c app_private.ai_call_receipts; begin
 perform app_private.help_worker_only();
 select * into c from app_private.ai_call_receipts where id=cid for update;
 if c.id is null or token is null or c.dispatch_token is distinct from token then return false; end if;
 if c.state='COMPLETED' then return c.result is not distinct from result_value and c.failure is not distinct from failure_value; end if;
 if result_value is not null and failure_value is not null then return false; end if;
 if result_value is null and failure_value is null then
  update app_private.ai_call_receipts set state='UNKNOWN' where id=cid; return true;
 end if;
 if failure_value is not null and (c.outcome is null or(c.outcome='ERROR' and c.provider_request_id is null and c.observation->>'httpStatus' is null)) then
  update app_private.ai_call_receipts set state='UNKNOWN' where id=cid; return true;
 end if;
 if octet_length(result_value::text)>4194304 or octet_length(failure_value::text)>1024 then return false; end if;
 update app_private.ai_call_receipts set state='COMPLETED',result=result_value,failure=failure_value where id=cid;
 return true;
end $$;

create function app_private.evaluation_receipt_projection(c app_private.ai_call_receipts) returns jsonb
language sql stable set search_path=pg_catalog as $$ select jsonb_build_object(
 'callId',c.id,'runId',c.run_id,'stage',c.stage,'phase',c.phase,'state',c.state,'provider',c.provider,
 'configurationId',c.configuration->>'id','model',c.configuration->>'model','dimensions',(c.configuration->>'dimensions')::integer,'inputHash',c.input_hash,
 'observedModel',c.observed_model,'httpStatus',(c.observation->>'httpStatus')::integer,'retryable',(c.observation->>'retryable')::boolean,'aborted',c.aborted,
 'dispatchedAt',c.dispatched_at,'settledAt',c.settled_at,'outcome',c.outcome,'inputTokens',c.input_tokens,'outputTokens',c.output_tokens,
 'requestId',c.provider_request_id,'reservedInputTokens',c.reserved_input_tokens,'maxOutputTokens',c.max_output_tokens,
 'reservedCostMicroUsd',c.reserved_cost::text,'observedCostMicroUsd',c.observed_cost::text) $$;
create function app_private.evaluation_stage_done(rid uuid, stage_value text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$ select
 exists(select 1 from app_private.evaluation_bindings where run_id=rid and stage=stage_value)
 and not exists(select 1 from app_private.ai_call_receipts where run_id=rid and stage=stage_value and state<>'COMPLETED')
 and not exists(select 1 from app_private.evaluation_bindings b where b.run_id=rid and b.stage=stage_value and (
 (b.kind='HELP' and (select count(*) from app_private.evaluation_owners o join app.feedback_requests h on h.id=o.owner_id where o.binding_id=b.id and h.lifecycle_status='SUCCEEDED')<>b.max_operations)
 or(b.kind='CALIBRATION' and not exists(select 1 from app_private.evaluation_calibrations c where c.id=b.id and c.state='SUCCEEDED'))))
$$;
create function app_private.evaluation_status(rid uuid, digest text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$ declare r app_private.evaluation_runs; stages_value jsonb; cases_value jsonb; begin
 r:=app_private.evaluation_capability(rid,digest);
 perform 1 from app_private.evaluation_runs where id=rid for update;
 select * into r from app_private.evaluation_runs where id=rid;
 if r.state='RUNNING' and exists(select 1 from app_private.evaluation_stages where run_id=rid and stage='EVALUATION' and state='RUNNING') and app_private.evaluation_stage_done(rid,'EVALUATION') then
  update app_private.evaluation_stages set state='COMPLETED',completed_at=clock_timestamp() where run_id=rid and stage='EVALUATION';
  update app_private.evaluation_runs set state='COMPLETED' where id=rid returning * into r;
 end if;
 select jsonb_agg(jsonb_build_object('stage',s.stage,'state',s.state,'budget',s.budget,'totals',app_private.evaluation_totals(rid,s.stage))) into stages_value from app_private.evaluation_stages s where run_id=rid;
 select coalesce(jsonb_agg(jsonb_build_object('caseId',coalesce(b.calibration_metadata->>'caseId',b.review_metadata->>'caseId'),
 'stage',b.stage,'state',c.state,'result',c.review_result) order by b.id),'[]') into cases_value from app_private.evaluation_bindings b join app_private.evaluation_calibrations c on c.id=b.id where b.run_id=rid;
 return jsonb_build_object('id',r.id,'state',r.state,'expired',r.expires_at<=clock_timestamp(),'expiresAt',r.expires_at,'environment',r.environment,'provider',r.provider,
 'manifestHash',r.manifest_hash,'corpusHash',r.manifest->>'corpusHash','releaseSha',r.manifest->>'releaseSha','priceVersion',r.manifest->>'priceVersion',
 'globalBudget',r.manifest->'globalBudget','totals',app_private.evaluation_totals(rid),'stages',stages_value,'cases',cases_value,'calibrationArtifact',r.calibration_artifact,'calibrationArtifactHash',r.calibration_artifact_hash);
end $$;
create function app_private.evaluation_receipts(rid uuid, digest text, cursor_value uuid default null, limit_value integer default 100) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$ declare result_value jsonb; next_value uuid; begin
 perform app_private.evaluation_capability(rid,digest);
 if limit_value not between 1 and 100 then raise exception using errcode='23514',message='INVALID_REQUEST'; end if;
 select coalesce(jsonb_agg(app_private.evaluation_receipt_projection(q::app_private.ai_call_receipts) order by q.id),'[]') into result_value
 from(select * from app_private.ai_call_receipts where run_id=rid and(cursor_value is null or id>cursor_value) order by id limit limit_value)q;
 if jsonb_array_length(result_value)=limit_value then next_value:=(result_value->(limit_value-1)->>'callId')::uuid; end if;
 return jsonb_build_object('items',result_value,'nextCursor',next_value);
end $$;
create function app_private.evaluation_start_stage(rid uuid, digest text, stage_value text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$ declare r app_private.evaluation_runs; s app_private.evaluation_stages; prev text; begin
 r:=app_private.evaluation_capability(rid,digest);
 perform 1 from app_private.evaluation_runs where id=rid for update;
 select * into r from app_private.evaluation_runs where id=rid;
 if r.state not in('AUTHORIZED','RUNNING') or r.expires_at<=clock_timestamp() then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 select * into s from app_private.evaluation_stages where run_id=rid and stage=stage_value;
 if s.stage is null then raise exception using errcode='23514',message='INVALID_EVALUATION_STAGE'; end if;
 if s.state='RUNNING' then return app_private.evaluation_status(rid,digest); end if;
 if s.state<>'PENDING' then raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
 prev:=case stage_value when 'CALIBRATION' then 'INGESTION' when 'FUNCTIONAL' then 'CALIBRATION' when 'EVALUATION' then 'FUNCTIONAL' end;
 if prev is not null then
  if not exists(select 1 from app_private.evaluation_stages where run_id=rid and stage=prev and state in('RUNNING','COMPLETED'))
   or exists(select 1 from app_private.ai_call_receipts where run_id=rid and stage=prev and state<>'COMPLETED')
  then raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
  if prev='INGESTION' and exists(select 1 from app_private.evaluation_bindings b where b.run_id=rid and b.kind='MATERIAL'
   and (select count(*) from app_private.evaluation_owners o join app.material_jobs j on j.id=o.owner_id where o.binding_id=b.id and j.lifecycle_status='SUCCEEDED')<>b.max_operations)
  then raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
  if prev='CALIBRATION' and r.calibration_artifact is null then raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
  if prev='FUNCTIONAL' and not app_private.evaluation_stage_done(rid,'FUNCTIONAL') then raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
  update app_private.evaluation_stages set state='COMPLETED',completed_at=clock_timestamp() where run_id=rid and stage=prev;
 end if;
 update app_private.evaluation_runs set state='RUNNING' where id=rid;
 update app_private.evaluation_stages set state='RUNNING',started_at=clock_timestamp() where run_id=rid and stage=stage_value;
 return app_private.evaluation_status(rid,digest);
end $$;
create function app_private.evaluation_stop(rid uuid, digest text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform app_private.evaluation_capability(rid,digest);
 update app_private.evaluation_runs set state='STOPPED',stopped_at=coalesce(stopped_at,clock_timestamp()) where id=rid and state<>'COMPLETED';
 update app_private.evaluation_stages set state='STOPPED' where run_id=rid and state='RUNNING';
 return app_private.evaluation_status(rid,digest);
end $$;

create function app_private.evaluation_find_receipt(owner_value jsonb, phase_value text, key_value text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$ declare c app_private.ai_call_receipts; begin
 perform app_private.evaluation_owner(owner_value->>'kind',(owner_value->>'id')::uuid,(owner_value->>'token')::uuid,false);
 select * into c from app_private.ai_call_receipts where owner_kind=owner_value->>'kind' and owner_id=(owner_value->>'id')::uuid
 and phase=phase_value and logical_key=key_value order by attempt desc limit 1;
 if c.id is null then return null; end if;
 return app_private.evaluation_receipt_projection(c);
end $$;

create function app_private.evaluation_calibration_claim() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$ declare c app_private.evaluation_calibrations; b app_private.evaluation_bindings; r app_private.evaluation_runs; begin
 perform app_private.help_worker_only();
 select cc.* into c from app_private.evaluation_calibrations cc join app_private.evaluation_bindings bb on bb.id=cc.id
 join app_private.evaluation_runs rr on rr.id=bb.run_id join app_private.evaluation_stages ss on ss.run_id=rr.id and ss.stage=bb.stage
 where rr.state='RUNNING' and rr.expires_at>clock_timestamp() and ss.state='RUNNING' and (cc.state='QUEUED' or(cc.state='RUNNING' and cc.lease_until<=clock_timestamp()))
 order by cc.id for update of cc skip locked limit 1;
 if c.id is null then return null; end if;
 select * into b from app_private.evaluation_bindings where id=c.id;
 if not app_private.help_actor_allowed(b.actor_id,b.attempt_id) or exists(select 1 from app_private.ai_call_receipts where calibration_id=c.id and state in('DISPATCHED','UNKNOWN')) then
  update app_private.evaluation_calibrations set state='FAILED',completed_at=clock_timestamp() where id=c.id; return null;
 end if;
 select * into r from app_private.evaluation_runs where id=b.run_id;
 update app_private.evaluation_calibrations set state='RUNNING',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '30 seconds' where id=c.id returning * into c;
 return jsonb_build_object('id',c.id,'token',c.lease_token,'runId',r.id,'kind',case when b.review_metadata is null then 'CALIBRATION' else 'REVIEW' end,
 'caseId',coalesce(b.calibration_metadata->>'caseId',b.review_metadata->>'caseId'),'corpusHash',r.manifest->>'corpusHash',
 'profile',r.manifest->'profiles'->'EMBEDDING','calibration',b.calibration_metadata,'reviewCase',b.review_metadata);
end $$;
create function app_private.evaluation_calibration_renew(cid uuid, token uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform app_private.help_worker_only();
 update app_private.evaluation_calibrations c set lease_until=clock_timestamp()+interval '30 seconds'
 from app_private.evaluation_bindings b join app_private.evaluation_runs r on r.id=b.run_id
 where c.id=cid and b.id=c.id and token is not null and c.lease_token=token and c.state='RUNNING' and c.lease_until>clock_timestamp()
 and r.state='RUNNING' and r.expires_at>clock_timestamp() and app_private.help_actor_allowed(b.actor_id,b.attempt_id);
 return found;
end $$;
create function app_private.evaluation_calibration_context(cid uuid, token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$ declare b app_private.evaluation_bindings; a app.attempts; e app.exercise_versions; concepts jsonb; tests jsonb; begin
 perform app_private.evaluation_owner('CALIBRATION',cid,token,true);
 select * into b from app_private.evaluation_bindings where id=cid;
 select * into a from app.attempts where id=b.attempt_id;
 select * into e from app.exercise_versions where id=a.exercise_version_id;
 select coalesce(jsonb_agg(v.name order by v.id),'[]') into concepts from app.exercise_version_concepts x join app.concept_versions v on v.id=x.concept_version_id where x.exercise_version_id=e.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',x->>'id','passed',x->'passed')),'[]') into tests from jsonb_array_elements(a.technical_result->'visibleTestResults')x;
 return jsonb_build_object('scope',jsonb_build_object('organizationId',b.organization_id,'classId',b.class_id,'activityId',b.activity_id,'studentId',b.actor_id),
 'context',jsonb_build_object('attemptId',a.id,'exerciseVersionId',e.id,'statement',e.statement,'concepts',concepts,'code',a.code,
 'diagnosisCode',a.technical_result->>'diagnosisCode','infrastructureStatus',a.technical_result->>'infrastructureStatus','visibleTests',tests));
end $$;
create function app_private.evaluation_calibration_query(cid uuid, token uuid, query_value text) returns text
language plpgsql security definer set search_path=pg_catalog as $$ declare existing text; digest text; begin
 perform app_private.evaluation_owner('CALIBRATION',cid,token,true);
 if query_value is null or octet_length(query_value) not between 1 and 20000 then raise exception using errcode='23514',message='INVALID_CALIBRATION_QUERY'; end if;
 select query_text into existing from app_private.evaluation_calibrations where id=cid for update;
 if existing is not null and existing<>query_value then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
 digest:=encode(sha256(convert_to(query_value,'UTF8')),'hex');
 update app_private.evaluation_calibrations set query_text=query_value,query_hash=digest where id=cid;
 return digest;
end $$;
create function app_private.evaluation_calibration_retrieve(cid uuid, token uuid, vector_value extensions.vector, query_hash_value text, call_value uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$ declare b app_private.evaluation_bindings; r app_private.evaluation_runs; c app_private.ai_call_receipts; prof jsonb; found_chunks jsonb; begin
 perform app_private.evaluation_owner('CALIBRATION',cid,token,true);
 select * into b from app_private.evaluation_bindings where id=cid;
 select * into r from app_private.evaluation_runs where id=b.run_id;
 select * into c from app_private.ai_call_receipts where id=call_value and calibration_id=cid and run_id=r.id and state='COMPLETED' and phase='EMBEDDING' and result is not null;
 prof:=r.manifest->'profiles'->'EMBEDDING';
 if c.id is null or c.input_hash is distinct from query_hash_value or not exists(select 1 from app_private.evaluation_calibrations where id=cid and query_hash=query_hash_value and query_text is not null)
 or extensions.vector_dims(vector_value)<>(prof->>'dimensions')::integer or extensions.vector_norm(vector_value)=0
 then raise exception using errcode='23514',message='INVALID_CALIBRATION_RECEIPT'; end if;
 if ((coalesce(c.result->'vectors',c.result)->0)::text::extensions.vector operator(extensions.=) vector_value) is not true then raise exception using errcode='23514',message='INVALID_CALIBRATION_VECTOR'; end if;
 if not exists(select 1 from app_private.material_embedding_profile where configuration_id=prof->>'id' and model=prof->>'model' and dimensions=(prof->>'dimensions')::integer)
 then raise exception using errcode='23514',message='INVALID_EMBEDDING_PROFILE'; end if;
 with scoped as materialized (
  select ch.id,ch.source_id,ch.source_version_id,ch.locator,ch.text,ch.embedding from app.source_chunks ch join app.sources s on s.id=ch.source_id
  join app.source_versions v on v.id=s.current_version_id join app.source_index_generations g on g.id=v.current_generation_id and ch.generation_id=g.id
  where s.organization_id=b.organization_id and s.class_id=b.class_id and(s.activity_id is null or s.activity_id=b.activity_id)
  and s.visibility='VISIBLE' and s.archived_at is null and g.index_status='READY' and g.configuration_id=prof->>'id' and g.embedding_model=prof->>'model' and g.embedding_dimension=(prof->>'dimensions')::integer
 ), ranked as(select *,embedding operator(extensions.<=>) vector_value distance from scoped order by embedding operator(extensions.<=>) vector_value,id limit 5)
 select coalesce(jsonb_agg(jsonb_build_object('source_id',source_id,'source_version_id',source_version_id,'chunk_id',id,'locator',locator,'text',text,'distance',distance) order by distance,id),'[]') into found_chunks from ranked;
 update app_private.evaluation_calibrations set state=case when b.review_metadata is null then 'SUCCEEDED' else 'RUNNING' end,query_hash=query_hash_value,call_id=call_value,
 candidates=(select coalesce(jsonb_agg(jsonb_build_object('chunkId',x->>'chunk_id','distance',x->'distance')),'[]') from jsonb_array_elements(found_chunks)x),completed_at=clock_timestamp() where id=cid;
 return found_chunks;
end $$;
create function app_private.evaluation_calibration_evidence(rid uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$ declare r app_private.evaluation_runs; cases_value jsonb; receipts_value jsonb; corpus_value jsonb; queries_value jsonb; observations_value jsonb; begin
 perform app_private.help_worker_only();
 select * into r from app_private.evaluation_runs where id=rid;
 if r.id is null or not exists(select 1 from app_private.evaluation_bindings where run_id=rid and kind='CALIBRATION')
 or exists(select 1 from app_private.evaluation_bindings b join app_private.evaluation_calibrations c on c.id=b.id where b.run_id=rid and b.stage='CALIBRATION' and c.state<>'SUCCEEDED') then return null; end if;
 select jsonb_agg(jsonb_build_object('id',b.id,'metadata',b.calibration_metadata,'queryHash',c.query_hash,'candidates',c.candidates,'callId',c.call_id,
 'relevantChunkIds',(select coalesce(jsonb_agg(distinct ch.id),'[]') from app_private.evaluation_owners o join app.material_jobs j on j.id=o.owner_id
 join app.source_chunks ch on ch.generation_id=j.generation_id where o.owner_kind='MATERIAL' and o.run_id=rid and o.binding_id::text in(select jsonb_array_elements_text(b.calibration_metadata->'relevantBindingIds')))) order by b.id)
 into cases_value from app_private.evaluation_bindings b join app_private.evaluation_calibrations c on c.id=b.id where b.run_id=rid and b.stage='CALIBRATION';
 select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('callId',c.id,'runId',c.run_id,'provider',c.provider,'configurationId',c.configuration->>'id','model',c.configuration->>'model',
 'dimensions',(c.configuration->>'dimensions')::integer,'inputHash',c.input_hash,'state',c.state,'requestId',c.provider_request_id)) order by c.id)
 into receipts_value from app_private.ai_call_receipts c join app_private.evaluation_calibrations x on x.call_id=c.id where c.run_id=rid and c.stage='CALIBRATION';
 select coalesce(jsonb_agg(jsonb_build_object('sourceVersionId',q.source_version_id,'chunkId',q.id,'contentHash',q.content_hash) order by q.id),'[]') into corpus_value
 from(select distinct ch.id,ch.source_version_id,ch.content_hash from app_private.evaluation_owners o join app.material_jobs j on j.id=o.owner_id
 join app.source_chunks ch on ch.generation_id=j.generation_id where o.owner_kind='MATERIAL' and o.run_id=rid)q;
 select jsonb_agg(jsonb_build_object('caseId',b.calibration_metadata->>'caseId','text',c.query_text,'queryHash',c.query_hash) order by b.id),
 jsonb_agg(jsonb_build_object('caseId',b.calibration_metadata->>'caseId','callId',c.call_id,'queryHash',c.query_hash,'corpusHash',r.manifest->>'corpusHash','candidates',c.candidates) order by b.id)
 into queries_value,observations_value from app_private.evaluation_bindings b join app_private.evaluation_calibrations c on c.id=b.id where b.run_id=rid and b.stage='CALIBRATION';
 return jsonb_build_object('manifest',r.manifest,'cases',cases_value,'receipts',receipts_value,'corpus',corpus_value,'queries',queries_value,'observations',observations_value);
end $$;
create function app_private.evaluation_calibration_finish(rid uuid, artifact_value jsonb, artifact_hash text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ declare r app_private.evaluation_runs; evidence jsonb; begin
 perform app_private.help_worker_only();
 select * into r from app_private.evaluation_runs where id=rid for update;
 if r.id is null or r.state<>'RUNNING' or r.expires_at<=clock_timestamp() or octet_length(artifact_value::text)>100000 then return false; end if;
 evidence:=app_private.evaluation_calibration_evidence(rid);
 if evidence is null or artifact_hash is null or artifact_hash!~'^[a-f0-9]{64}$' or artifact_value->>'version' is distinct from 'help-evidence-2'
 or artifact_value->>'origin' is distinct from r.provider or artifact_value->>'runId' is distinct from rid::text
 or artifact_value->'measurement'->'binding'->>'corpusHash' is distinct from r.manifest->>'corpusHash'
 or artifact_value->'measurement'->'binding'->>'configurationId' is distinct from r.manifest->'profiles'->'EMBEDDING'->>'id'
 or artifact_value->'measurement'->'binding'->>'embeddingModel' is distinct from r.manifest->'profiles'->'EMBEDDING'->>'model'
 or artifact_value->'measurement'->'binding'->>'dimensions' is distinct from r.manifest->'profiles'->'EMBEDDING'->>'dimensions'
 then return false; end if;
 if r.calibration_artifact is not null then return r.calibration_artifact=artifact_value; end if;
 update app_private.evaluation_runs set calibration_artifact=artifact_value,calibration_artifact_hash=artifact_hash where id=rid;
 return true;
end $$;
create function app_private.evaluation_calibration_assert(artifact_value jsonb, allow_test boolean default false, embedding_fingerprint text default null) returns text
language plpgsql security definer set search_path=pg_catalog as $$ declare r app_private.evaluation_runs; begin
 perform app_private.help_worker_only();
 select * into r from app_private.evaluation_runs where calibration_artifact=artifact_value and embedding_fingerprint is not null
 and manifest->'profiles'->'EMBEDDING'->>'fingerprint'=embedding_fingerprint
 and ((provider='AZURE' and environment='LAB-EVAL') or(allow_test and provider='TEST' and environment='TEST'));
 if r.id is null then return null; end if;
 return r.calibration_artifact_hash;
end $$;
create function app_private.evaluation_calibration_fail(cid uuid, token uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform app_private.help_worker_only();
 update app_private.evaluation_calibrations set state='FAILED',completed_at=clock_timestamp() where id=cid and token is not null and lease_token=token and state='RUNNING'; return found;
end $$;

create function app_private.evaluation_calibration_pending() returns uuid
language sql stable security definer set search_path=pg_catalog as $$
 select r.id from app_private.evaluation_runs r join app_private.evaluation_stages s on s.run_id=r.id and s.stage='CALIBRATION'
 where app_private.actor_id() is null and r.state='RUNNING' and r.expires_at>clock_timestamp() and r.calibration_artifact is null and s.state='RUNNING'
 and exists(select 1 from app_private.evaluation_bindings b where b.run_id=r.id and b.stage='CALIBRATION')
 and not exists(select 1 from app_private.evaluation_bindings b join app_private.evaluation_calibrations c on c.id=b.id where b.run_id=r.id and b.stage='CALIBRATION' and c.state<>'SUCCEEDED') order by r.created_at limit 1
$$;
create function app_private.evaluation_calibration_run_fail(rid uuid, reason text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform app_private.help_worker_only();
 if reason<>'CALIBRATION_INVALID' then return false; end if;
 update app_private.evaluation_runs set state='STOPPED',stopped_at=clock_timestamp() where id=rid and calibration_artifact is null and state='RUNNING';
 if not found then return false; end if;
 update app_private.evaluation_stages set state='STOPPED' where run_id=rid and state='RUNNING'; return true;
end $$;
create function app_private.evaluation_review_references(cid uuid, token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$ declare b app_private.evaluation_bindings; result_value jsonb; begin
 perform app_private.evaluation_owner('CALIBRATION',cid,token,true);
 select * into b from app_private.evaluation_bindings where id=cid;
 if b.review_metadata is null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('materialBindingId',q.binding_id,'source_id',q.source_id,'source_version_id',q.source_version_id,'chunk_id',q.id,'locator',q.locator) order by q.binding_id,q.id),'[]') into result_value
 from(select distinct o.binding_id,ch.source_id,ch.source_version_id,ch.id,ch.locator from app_private.evaluation_owners o join app.material_jobs j on j.id=o.owner_id join app.source_chunks ch on ch.generation_id=j.generation_id
 join app_private.evaluation_calibrations c on c.id=cid where o.run_id=b.run_id and o.owner_kind='MATERIAL'
 and ch.id::text in(select x->>'chunkId' from jsonb_array_elements(c.candidates)x)
 and o.binding_id::text in(select x->>'materialBindingId' from jsonb_array_elements(b.review_metadata->'refsMapping')x))q;
 return result_value;
end $$;
create function app_private.evaluation_review_complete(cid uuid, token uuid, call_value uuid, boundary_rejected boolean) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ declare b app_private.evaluation_bindings; c app_private.ai_call_receipts; verdict text; passed boolean; begin
 perform app_private.evaluation_owner('CALIBRATION',cid,token,true);
 select * into b from app_private.evaluation_bindings where id=cid;
 if b.review_metadata is null then return false; end if;
 if boundary_rejected then
  if call_value is not null then return false; end if;
  verdict:='REJECT'; passed:=coalesce((b.review_metadata->>'boundaryExpected')::boolean,false) and b.review_metadata->>'expected'='REJECT';
 else
  select * into c from app_private.ai_call_receipts where id=call_value and calibration_id=cid and state='COMPLETED' and phase='REVIEW';
  verdict:=c.result->'verification'->>'verdict';
  if verdict is null or verdict not in('ACCEPT','NO_EVIDENCE','REJECT') then return false; end if;
  passed:=verdict=b.review_metadata->>'expected' and not coalesce((b.review_metadata->>'boundaryExpected')::boolean,false);
 end if;
 update app_private.evaluation_calibrations set state='SUCCEEDED',completed_at=clock_timestamp(),review_result=jsonb_build_object('expected',b.review_metadata->>'expected','actual',verdict,'boundaryRejected',boundary_rejected,'passed',passed,'reviewCallId',call_value) where id=cid;
 return true;
end $$;
create function app_private.evaluation_can_continue(owner_value jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform app_private.evaluation_owner(owner_value->>'kind',(owner_value->>'id')::uuid,(owner_value->>'token')::uuid,false); return true;
 exception when insufficient_privilege then return false;
end $$;

-- A recovered provider result is private until the existing help transaction
-- revalidates its scope and publishes it. Uncertain dispatches remain fenced.
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
set role alunza_identity;
create or replace function app_private.help_claim() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r app.feedback_requests; token uuid:=gen_random_uuid(); diagnosis text;
begin
 perform app_private.help_worker_only();
 select * into r from app.feedback_requests where lifecycle_status='QUEUED'
 or(lifecycle_status='RUNNING' and(deadline_at<=clock_timestamp() or lease_until<=clock_timestamp())) order by requested_at,id for update skip locked limit 1;
 if r.id is null then return null; end if;
 select technical_result->>'diagnosisCode' into diagnosis from app.attempts where id=r.attempt_id;
 if not app_private.help_scope_valid(r.id) then perform app_private.help_store_result(r.id,app_private.help_fallback(diagnosis,'NO_EVIDENCE'),'{}','EVIDENCE_REVOKED'); return null; end if;
 if r.deadline_at<=clock_timestamp() or exists(select 1 from app_private.evaluation_owners o join app_private.evaluation_runs er on er.id=o.run_id
  where o.owner_kind='HELP' and o.owner_id=r.id and(er.state<>'RUNNING' or er.expires_at<=clock_timestamp())) then
  perform app_private.help_store_result(r.id,app_private.help_fallback(diagnosis,'PROVIDER_UNAVAILABLE'),'{}','DEADLINE_EXCEEDED'); return null;
 end if;
 update app_private.help_calls hc set state='COMPLETED',completed_at=clock_timestamp(),result=cr.result,
 usage=coalesce(cr.result->'usage',jsonb_strip_nulls(jsonb_build_object('inputTokens',cr.input_tokens,'outputTokens',cr.output_tokens,'model',cr.observed_model,'requestId',cr.provider_request_id)))
 from app_private.ai_call_receipts cr where hc.request_id=r.id and hc.state='DISPATCHED' and cr.help_request_id=r.id and cr.phase=hc.phase and cr.state='COMPLETED' and cr.result is not null;
 if exists(select 1 from app_private.help_calls where request_id=r.id and state='DISPATCHED') then
  update app.feedback_requests set lifecycle_status='RUNNING',lease_token=token,lease_until=deadline_at where id=r.id; return null;
 end if;
 update app.feedback_requests set lifecycle_status='RUNNING',lease_token=token,lease_until=least(deadline_at,clock_timestamp()+interval '10 seconds') where id=r.id;
 return jsonb_build_object('id',r.id,'token',token,'attemptId',r.attempt_id,'kind',r.kind,'hintLevel',r.hint_level,'deadlineAt',r.deadline_at);
end $$;
create or replace function app_private.help_job_live(request uuid, token uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.feedback_requests r where r.id=request and r.lifecycle_status='RUNNING'
 and token is not null and r.lease_token=token and r.lease_until>clock_timestamp() and r.deadline_at>clock_timestamp() and app_private.help_scope_valid(r.id)
 and not exists(select 1 from app_private.evaluation_owners o join app_private.evaluation_runs er on er.id=o.run_id
  where o.owner_kind='HELP' and o.owner_id=r.id and(er.state<>'RUNNING' or er.expires_at<=clock_timestamp())))
$$;
reset role;
create function app_private.evaluation_material_publish_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform 1 from app_private.evaluation_runs r join app_private.evaluation_owners o on o.run_id=r.id join app.material_jobs j on j.id=o.owner_id
  where o.owner_kind='MATERIAL' and j.generation_id=new.id for update of r;
 if exists(select 1 from app_private.evaluation_owners o join app_private.evaluation_runs r on r.id=o.run_id join app.material_jobs j on j.id=o.owner_id
  where o.owner_kind='MATERIAL' and j.generation_id=new.id and(r.state<>'RUNNING' or r.expires_at<=clock_timestamp())) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 return new;
end $$;
create trigger evaluation_material_publish_guard before update of index_status on app.source_index_generations for each row when(new.index_status='READY' and old.index_status<>'READY') execute function app_private.evaluation_material_publish_guard();
create function app_private.evaluation_feedback_publish_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform 1 from app_private.evaluation_runs r join app_private.evaluation_owners o on o.run_id=r.id
  where o.owner_kind='HELP' and o.owner_id=new.request_id for update of r;
 if exists(select 1 from app_private.evaluation_owners o join app_private.evaluation_runs r on r.id=o.run_id
  where o.owner_kind='HELP' and o.owner_id=new.request_id and(r.state<>'RUNNING' or r.expires_at<=clock_timestamp())) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 return new;
end $$;
create trigger evaluation_feedback_publish_guard before insert on app.feedbacks for each row when(new.rag_status='SUPPORTED') execute function app_private.evaluation_feedback_publish_guard();

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname like 'evaluation_%' loop
  execute format('alter function %s owner to alunza_identity',f.signature);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',f.signature);
  if f.proname in('evaluation_reserve','evaluation_observe','evaluation_complete','evaluation_find_receipt','evaluation_status','evaluation_receipts','evaluation_start_stage','evaluation_stop',
   'evaluation_calibration_claim','evaluation_calibration_renew','evaluation_calibration_context','evaluation_calibration_query','evaluation_calibration_retrieve','evaluation_calibration_evidence','evaluation_calibration_finish','evaluation_calibration_assert','evaluation_calibration_fail',
   'evaluation_calibration_pending','evaluation_calibration_run_fail','evaluation_review_references','evaluation_review_complete','evaluation_can_continue') then
   execute format('grant execute on function %s to alunza_app',f.signature);
  end if;
 end loop;
end $$;
-- The maintenance CLI can mint a reviewed grant without assuming the
-- function-owner role or granting that authority to the application runtime.
grant execute on function app_private.evaluation_authorize(jsonb,text) to postgres;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
