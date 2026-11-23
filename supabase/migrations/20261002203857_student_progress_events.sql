-- IMP-05.01–05.02. New observations start here; existing ledgers remain canonical.
create table app_private.student_activity_observations (
 id uuid primary key default gen_random_uuid(),
 event_sequence bigint generated always as identity unique,
 organization_id uuid not null,
 class_id uuid not null,
 activity_id uuid not null,
 student_id uuid not null,
 activity_exercise_id uuid,
 exercise_version_id uuid,
 execution_id uuid,
 event_type text not null check(event_type in ('ACTIVITY_OPENED','EXECUTION_COMPLETED')),
 schema_version integer not null default 1 check(schema_version=1),
 operation_key text,
 occurred_at timestamptz not null,
 infrastructure_status text check(infrastructure_status in ('OK','FAILED')),
 foreign key(organization_id,class_id) references app.classes(organization_id,id),
 foreign key(organization_id,activity_id) references app.activities(organization_id,id),
 foreign key(organization_id,student_id) references app.organization_memberships(organization_id,user_id),
 foreign key(organization_id,activity_exercise_id) references app.activity_exercises(organization_id,id),
 foreign key(organization_id,exercise_version_id) references app.exercise_versions(organization_id,id),
 foreign key(organization_id,execution_id) references app.executions(organization_id,id),
 check((event_type='ACTIVITY_OPENED' and operation_key is not null and operation_key ~ '^[A-Za-z0-9_.:-]{8,128}$'
  and execution_id is null and activity_exercise_id is null and exercise_version_id is null and infrastructure_status is null)
  or (event_type='EXECUTION_COMPLETED' and operation_key is null and execution_id is not null
  and activity_exercise_id is not null and exercise_version_id is not null and infrastructure_status is not null))
);
create unique index student_activity_open_identity on app_private.student_activity_observations(student_id,activity_id,operation_key)
 where event_type='ACTIVITY_OPENED';
create unique index student_run_observation_identity on app_private.student_activity_observations(execution_id)
 where event_type='EXECUTION_COMPLETED';
create index student_activity_observations_scope on app_private.student_activity_observations(organization_id,class_id,student_id,occurred_at,event_sequence);

create table app_private.student_event_coverage (
 source text not null check(source in ('ACTIVITY_OPEN','RUN')),
 event_type text not null check(event_type in ('ACTIVITY_OPENED','EXECUTION_COMPLETED')),
 schema_version integer not null default 1 check(schema_version=1),
 starts_at timestamptz not null default clock_timestamp(),
 primary key(source,event_type)
);
do $$ declare relation text; begin
 foreach relation in array array['student_activity_observations','student_event_coverage'] loop
  execute format('alter table app_private.%I enable row level security',relation);
  execute format('alter table app_private.%I force row level security',relation);
  execute format('revoke all on app_private.%I from public,anon,authenticated,service_role,alunza_app',relation);
  execute format('grant select,insert on app_private.%I to alunza_identity',relation);
  execute format('create policy student_event_internal on app_private.%I for all to alunza_identity using(true) with check(true)',relation);
 end loop;
end $$;
grant usage on sequence app_private.student_activity_observations_event_sequence_seq to alunza_identity;

create function app_private.guard_student_activity_observation() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='IMMUTABLE_STUDENT_EVENT'; end if;
 if new.event_type='ACTIVITY_OPENED' then
  if new.student_id is distinct from app_private.actor_id()
   or not app_private.academic_student(new.class_id)
   or not exists(select 1 from app.activities a where a.id=new.activity_id and a.organization_id=new.organization_id
    and a.class_id=new.class_id and a.state in ('PUBLISHED','CLOSED')) then
   raise exception using errcode='23514',message='STUDENT_EVENT_CONTEXT_MISMATCH';
  end if;
 elsif not exists(select 1 from app.executions e where e.id=new.execution_id and e.lifecycle_status='COMPLETED'
  and row(e.organization_id,e.class_id,e.activity_id,e.student_id,e.activity_exercise_id,e.exercise_version_id,e.finished_at,e.response_body->'technicalResult'->>'infrastructureStatus')
   is not distinct from row(new.organization_id,new.class_id,new.activity_id,new.student_id,new.activity_exercise_id,new.exercise_version_id,new.occurred_at,new.infrastructure_status)) then
  raise exception using errcode='23514',message='STUDENT_EVENT_CONTEXT_MISMATCH';
 end if;
 return new;
end $$;
create trigger student_activity_observation_context before insert or update or delete on app_private.student_activity_observations
 for each row execute function app_private.guard_student_activity_observation();

create function app_private.capture_completed_run_observation() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if old.lifecycle_status<>'COMPLETED' and new.lifecycle_status='COMPLETED' then
  insert into app_private.student_activity_observations(organization_id,class_id,activity_id,student_id,
   activity_exercise_id,exercise_version_id,execution_id,event_type,occurred_at,infrastructure_status)
  values(new.organization_id,new.class_id,new.activity_id,new.student_id,new.activity_exercise_id,new.exercise_version_id,
   new.id,'EXECUTION_COMPLETED',new.finished_at,new.response_body->'technicalResult'->>'infrastructureStatus');
 end if;
 return null;
end $$;
create trigger student_completed_run_observation after update on app.executions
 for each row execute function app_private.capture_completed_run_observation();

create function app_private.record_activity_open(activity uuid, operation_key_value text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare a app.activities; observation app_private.student_activity_observations; actor uuid:=app_private.actor_id();
begin
 if operation_key_value is null or operation_key_value !~ '^[A-Za-z0-9_.:-]{8,128}$' then
  raise exception using errcode='P0001',message='INVALID_REQUEST';
 end if;
 select * into a from app.activities where id=activity;
 if a.id is null or not app_private.academic_student(a.class_id) or not app_private.academic_activity_read(a.id) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 perform 1 from app.organizations where id=a.organization_id for update;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,4917));
 if not app_private.academic_student(a.class_id) or not app_private.academic_activity_read(a.id) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 insert into app_private.student_activity_observations(organization_id,class_id,activity_id,student_id,event_type,operation_key,occurred_at)
 values(a.organization_id,a.class_id,a.id,actor,'ACTIVITY_OPENED',operation_key_value,clock_timestamp())
 on conflict(student_id,activity_id,operation_key) where event_type='ACTIVITY_OPENED' do nothing;
 select * into observation from app_private.student_activity_observations
  where student_id=actor and activity_id=a.id and event_type='ACTIVITY_OPENED' and operation_key=operation_key_value;
 return jsonb_build_object('eventId',observation.id,'activityId',observation.activity_id,'occurredAt',observation.occurred_at);
end $$;

-- Only this scalar projects private ordering metadata, after current own-access checks.
create function app_private.attempt_confirmation_sequence(attempt uuid) returns bigint
language sql stable security definer set search_path=pg_catalog as $$
 select e.event_sequence from app_private.attempt_events e join app.attempts a on a.id=e.attempt_id and a.organization_id=e.organization_id
 where a.id=attempt and e.event_type='ATTEMPT_SUBMITTED' and a.student_id=app_private.actor_id()
 and app_private.academic_student(a.class_id) and app_private.academic_activity_read(a.activity_id)
$$;

create function app_private.progress_counts(required_count bigint,completed_count bigint,has_attempt boolean,basis_ids uuid[]) returns jsonb
language sql immutable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('completed',completed_count,'required',required_count,
  'ratio',case when required_count=0 then null else completed_count::numeric/required_count end,
  'evidenceState',case when required_count=0 then 'NO_REQUIRED_EXERCISES' when not has_attempt then 'NO_ATTEMPTS' else 'HAS_EVIDENCE' end,
  'basisAttemptIds',to_jsonb(coalesce(basis_ids,'{}'::uuid[])))
$$;

create function app_private.student_progress(class uuid,activity uuid default null,concept uuid default null,cutoff timestamptz default null) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare response jsonb; selected_org uuid; effective_cutoff timestamptz:=coalesce(cutoff,statement_timestamp());
begin
 if class is null or not app_private.academic_student(class) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 select organization_id into selected_org from app.classes where id=class;
 if not isfinite(effective_cutoff) or effective_cutoff>statement_timestamp() then
  raise exception using errcode='P0001',message='INVALID_PROGRESS_CUTOFF';
 end if;
 if activity is not null and not exists(select 1 from app.activities a where a.id=activity and a.class_id=class) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 if concept is not null and not exists(select 1 from app.concept_tags c where c.id=concept and c.organization_id=selected_org) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 with scoped_activities as materialized (
  select a.id,a.title from app.activities a where a.class_id=class and a.organization_id=selected_org
   and a.published_at<=effective_cutoff and (activity is null or a.id=activity)
 ), candidate_assignments as materialized (
  select ae.* from app.activity_exercises ae join scoped_activities sa on sa.id=ae.activity_id
  where ae.organization_id=selected_org
 ), assigned_versions as materialized (
  select distinct organization_id,exercise_version_id from candidate_assignments
 ), version_concepts as materialized (
  -- Read each assigned version's fixed concept links once under the invoker's RLS.
  select link.organization_id,link.exercise_version_id,cv.concept_id,cv.id as concept_version_id,cv.version,cv.name
  from assigned_versions v join app.exercise_version_concepts link
   on link.organization_id=v.organization_id and link.exercise_version_id=v.exercise_version_id
   join app.concept_versions cv on cv.organization_id=link.organization_id and cv.id=link.concept_version_id
  where link.organization_id=selected_org and (concept is null or cv.concept_id=concept)
 ), scoped_assignments as materialized (
  select ae.* from candidate_assignments ae
  where concept is null or exists(select 1 from version_concepts vc
   where vc.organization_id=ae.organization_id and vc.exercise_version_id=ae.exercise_version_id)
 ), confirmed as materialized (
  select a.id,a.activity_exercise_id,a.submitted_at,a.technical_result,
   app_private.attempt_confirmation_sequence(a.id) as event_sequence
  from app.attempts a join scoped_assignments ae on ae.organization_id=a.organization_id and ae.activity_id=a.activity_id
   and ae.id=a.activity_exercise_id and ae.exercise_version_id=a.exercise_version_id
  where a.organization_id=selected_org and a.class_id=class
   and a.student_id=app_private.actor_id() and a.submitted_at<=effective_cutoff
 ), first_success as materialized (
  select distinct on (a.activity_exercise_id) a.activity_exercise_id,a.id,a.submitted_at
  from confirmed a where a.technical_result->'allRequiredPassed'='true'::jsonb
  order by a.activity_exercise_id,a.submitted_at,a.event_sequence,a.id
 ), observations as materialized (
  select ae.*,success.id as basis_id,success.submitted_at,
   exists(select 1 from confirmed c where c.activity_exercise_id=ae.id) as has_attempt
  from scoped_assignments ae left join first_success success on success.activity_exercise_id=ae.id
 ), summary as (
  select app_private.progress_counts(count(*) filter(where required),count(*) filter(where required and basis_id is not null),
   coalesce(bool_or(has_attempt),false),array_agg(basis_id order by activity_id,position,id) filter(where required and basis_id is not null)) as counts
  from observations
 ), activity_groups as (
  select sa.id,sa.title,app_private.progress_counts(count(o.id) filter(where o.required),count(o.id) filter(where o.required and o.basis_id is not null),
   coalesce(bool_or(o.has_attempt),false),array_agg(o.basis_id order by o.position,o.id) filter(where o.required and o.basis_id is not null)) as counts
  from scoped_activities sa left join observations o on o.activity_id=sa.id
  where concept is null or o.id is not null group by sa.id,sa.title
 ), concept_assignments as materialized (
  select distinct vc.concept_id,o.id from observations o join version_concepts vc
   on vc.organization_id=o.organization_id and vc.exercise_version_id=o.exercise_version_id
 ), concept_metadata as materialized (
  select vc.concept_id,(array_agg(vc.name order by vc.version desc,vc.concept_version_id))[1] as name,
   array_agg(distinct vc.concept_version_id order by vc.concept_version_id) as version_ids
  from version_concepts vc group by vc.concept_id
 ), concept_groups as (
  select m.concept_id,m.name,m.version_ids,app_private.progress_counts(count(*) filter(where o.required),count(*) filter(where o.required and o.basis_id is not null),
   coalesce(bool_or(o.has_attempt),false),array_agg(o.basis_id order by o.activity_id,o.position,o.id) filter(where o.required and o.basis_id is not null)) as counts
  from concept_metadata m join concept_assignments ca on ca.concept_id=m.concept_id join observations o on o.id=ca.id
  group by m.concept_id,m.name,m.version_ids
 )
 select jsonb_build_object('classId',class,'filters',jsonb_build_object('activityId',activity,'conceptId',concept),'asOf',effective_cutoff,
  'summary',(select counts from summary),
  'byActivity',coalesce((select jsonb_agg(jsonb_build_object('activityId',id,'title',title)||counts order by id) from activity_groups),'[]'::jsonb),
  'byConcept',coalesce((select jsonb_agg(jsonb_build_object('conceptId',concept_id,'name',name,'conceptVersionIds',version_ids)||counts order by concept_id) from concept_groups),'[]'::jsonb),
  'evidence',coalesce((select jsonb_agg(jsonb_build_object('activityId',activity_id,'activityExerciseId',id,'exerciseVersionId',exercise_version_id,
   'attemptId',basis_id,'submittedAt',submitted_at) order by activity_id,position,id) from observations where required and basis_id is not null),'[]'::jsonb)) into response;
 return response;
end $$;

-- Canonical ledgers are combined at read time; no backfill or ledger copying.
create function app_private.student_activity_events(org uuid,class uuid,student uuid,cutoff timestamptz)
returns table(event_id uuid,source text,source_id uuid,event_type text,occurred_at timestamptz,organization_id uuid,class_id uuid,
 activity_id uuid,activity_exercise_id uuid,exercise_version_id uuid,student_id uuid,eligible boolean,infrastructure_status text,schema_version integer,deduplication_key text)
language sql stable security invoker set search_path=pg_catalog as $$
 with events as (
  select m.id as event_id,'CLASS_MEMBERSHIP'::text as source,m.id as source_id,'CLASS_JOINED'::text as event_type,m.enrolled_at as occurred_at,
   m.organization_id,m.class_id,null::uuid as activity_id,null::uuid as activity_exercise_id,null::uuid as exercise_version_id,m.user_id as student_id,
   true as eligible,null::text as infrastructure_status,1 as schema_version,'membership:'||m.id::text as deduplication_key
  from app.class_memberships m where m.organization_id=org and m.class_id=class and m.user_id=student
  union all
  select o.id,case when o.event_type='ACTIVITY_OPENED' then 'ACTIVITY_OPEN' else 'RUN' end,coalesce(o.execution_id,o.id),o.event_type,o.occurred_at,
   o.organization_id,o.class_id,o.activity_id,o.activity_exercise_id,o.exercise_version_id,o.student_id,
   o.event_type='ACTIVITY_OPENED' or o.infrastructure_status='OK',o.infrastructure_status,o.schema_version,
   case when o.event_type='ACTIVITY_OPENED' then 'open:'||o.id::text else 'run:'||o.execution_id::text end
  from app_private.student_activity_observations o where o.organization_id=org and o.class_id=class and o.student_id=student
  union all
  select e.id,'ATTEMPT',a.id,e.event_type,e.occurred_at,e.organization_id,e.class_id,e.activity_id,e.activity_exercise_id,e.exercise_version_id,e.student_id,
   e.event_type='ATTEMPT_SUBMITTED' or a.technical_result->>'infrastructureStatus'='OK',a.technical_result->>'infrastructureStatus',1,'attempt:'||a.id::text||':'||e.event_type
  from app_private.attempt_events e join app.attempts a on a.id=e.attempt_id and a.organization_id=e.organization_id
   where e.organization_id=org and e.class_id=class and e.student_id=student
  union all
  select e.id,'HELP',e.request_id,e.event_type,e.occurred_at,e.organization_id,a.class_id,a.activity_id,a.activity_exercise_id,a.exercise_version_id,a.student_id,
   e.event_type='FEEDBACK_VIEWED' or (e.event_type='HINT_DELIVERED' and f.rag_status='SUPPORTED'),null::text,1,'help:'||e.request_id::text||':'||e.event_type
  from app_private.help_events e join app.attempts a on a.id=e.attempt_id and a.organization_id=e.organization_id left join app.feedbacks f on f.id=e.feedback_id
   where e.organization_id=org and a.class_id=class and a.student_id=student
 )
 select * from events where occurred_at<=cutoff order by occurred_at,event_id
$$;

create index attempts_progress_cutoff on app.attempts(organization_id,student_id,class_id,activity_id,submitted_at,activity_exercise_id);

grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
do $$ declare fn regprocedure; begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'
  and p.proname in ('guard_student_activity_observation','capture_completed_run_observation','record_activity_open','attempt_confirmation_sequence','student_activity_events') loop
  execute format('alter function %s owner to alunza_identity',fn);
 end loop;
end $$;
set role alunza_identity;
create or replace function app_private.practice_activity_progress(activity uuid) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare class_id_value uuid; progress jsonb;
begin
 select a.class_id into class_id_value from app.activities a where a.id=activity and app_private.academic_student(a.class_id);
 if class_id_value is null then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 progress:=app_private.student_progress(class_id_value,activity,null,null);
 return jsonb_build_object('activityId',activity,'asOf',progress->'asOf')||((progress->'summary')-'basisAttemptIds');
end $$;
do $$ declare fn regprocedure; begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'
  and p.proname in ('guard_student_activity_observation','capture_completed_run_observation','record_activity_open','attempt_confirmation_sequence','student_activity_events') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',fn);
  if fn::text like 'app_private.record_activity_open%' or fn::text like 'app_private.attempt_confirmation_sequence%' then
   execute format('grant execute on function %s to alunza_app',fn);
  end if;
 end loop;
end $$;
reset role;
revoke all on function app_private.student_progress(uuid,uuid,uuid,timestamptz),app_private.progress_counts(bigint,bigint,boolean,uuid[]) from public,anon,authenticated,service_role,alunza_app;
grant execute on function app_private.student_progress(uuid,uuid,uuid,timestamptz),app_private.progress_counts(bigint,bigint,boolean,uuid[]) to alunza_app,alunza_identity;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;

-- Register coverage after installing the capture triggers. Their DDL locks are
-- retained until migration commit, so a concurrent RUN cannot finish in a gap
-- after this timestamp without passing through the durable observation trigger.
insert into app_private.student_event_coverage(source,event_type) values
 ('ACTIVITY_OPEN','ACTIVITY_OPENED'),('RUN','EXECUTION_COMPLETED');
