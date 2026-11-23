-- IMP-05.07. Read-only, scoped projections over canonical facts. No signal
-- publication, review, worker checkpoint changes or generated activity events.

create function app_private.dashboard_context(cls uuid, options jsonb, own boolean default false) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare org uuid; cut timestamptz:=coalesce((options->>'asOf')::timestamptz,statement_timestamp());
 start_at timestamptz:=(options->>'from')::timestamptz; activity uuid:=(options->>'activityId')::uuid; concept uuid:=(options->>'conceptId')::uuid;
begin
 if cls is null or app_private.actor_id() is null or
  (case when own then app_private.academic_student(cls) else app_private.academic_teacher(cls,true) end) is distinct from true then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 select organization_id into org from app.classes where id=cls;
 if not isfinite(cut) or cut>statement_timestamp() then raise exception using errcode='P0001',message='INVALID_PROGRESS_CUTOFF'; end if;
 if start_at is not null and (not isfinite(start_at) or start_at>cut) then raise exception using errcode='P0001',message='DASHBOARD_PERIOD_INVALID'; end if;
 if activity is not null and not exists(select 1 from app.activities a where a.id=activity and a.organization_id=org and a.class_id=cls and a.state in ('PUBLISHED','CLOSED')) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 if concept is not null and not exists(select 1 from app.concept_tags c where c.id=concept and c.organization_id=org) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 return jsonb_build_object('organizationId',org,'classId',cls,'activityId',activity,'conceptId',concept,
  'from',app_private.signal_instant(start_at),'asOf',app_private.signal_instant(cut));
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 raise exception using errcode='P0001',message='DASHBOARD_FILTER_INVALID';
end $$;

create function app_private.dashboard_limit(options jsonb) returns integer
language plpgsql immutable set search_path=pg_catalog as $$
declare n integer:=coalesce((options->>'limit')::integer,50);
begin
 if n not between 1 and 100 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 return n;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='P0001',message='INVALID_REQUEST';
end $$;

create function app_private.dashboard_options(options jsonb,allowed text[]) returns void
language plpgsql immutable set search_path=pg_catalog as $$
begin
 if options is null or jsonb_typeof(options)<>'object' or (options-allowed)<>'{}'::jsonb then
  raise exception using errcode='P0001',message='INVALID_REQUEST';
 end if;
 perform app_private.dashboard_limit(options);
end $$;

create function app_private.dashboard_cursor(options jsonb,signature text) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare encoded text:=options->>'cursor'; decoded jsonb;
begin
 if encoded is null then return null; end if;
 if length(encoded)>4096 or encoded!~'^[A-Za-z0-9_-]+$' then raise exception 'invalid cursor'; end if;
 decoded:=convert_from(decode(translate(encoded,'-_','+/')||repeat('=',(4-length(encoded)%4)%4),'base64'),'UTF8')::jsonb;
 if jsonb_typeof(decoded)<>'object' or (decoded-array['v','signature','key'])<>'{}'::jsonb or decoded->>'v' is distinct from '1'
  or decoded->>'signature' is distinct from signature or jsonb_typeof(decoded->'key')<>'object'
  or ((decoded->'key')-array['id','at'])<>'{}'::jsonb or decoded->'key'->>'id' is null then raise exception 'invalid cursor'; end if;
 perform (decoded->'key'->>'id')::uuid;
 if decoded->'key'->>'at' is not null then perform (decoded->'key'->>'at')::timestamptz; end if;
 return decoded->'key';
exception when others then raise exception using errcode='P0001',message='DASHBOARD_CURSOR_INVALID';
end $$;

create function app_private.dashboard_next_cursor(signature text,key jsonb) returns text
language sql immutable set search_path=pg_catalog as $$
 select rtrim(translate(replace(encode(convert_to(jsonb_build_object('v',1,'signature',signature,'key',key)::text,'UTF8'),'base64'),E'\n',''),'+/','-_'),'=')
$$;

create function app_private.dashboard_attempt_verifiable(value jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $$
 select coalesce(value->>'infrastructureStatus'='OK' and value->>'diagnosisCode' in ('SUCCESS','SYNTAX_ERROR','RUNTIME_ERROR','FAILED_TEST','TIMEOUT'),false)
$$;

create function app_private.dashboard_visible_complete(value jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $$
 select coalesce(value->>'infrastructureStatus'='OK' and value->>'diagnosisCode'<>'UNKNOWN'
  and jsonb_typeof(value->'visibleTestResults')='array'
  and jsonb_array_length(value->'visibleTestResults')=(value->>'visibleTotal')::integer
  and (value->>'visiblePassed')::integer between 0 and (value->>'visibleTotal')::integer,false)
$$;

create function app_private.dashboard_attempt_projection(a app.attempts) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('id',a.id,'studentId',a.student_id,'studentName',p.display_name,
  'activityId',a.activity_id,'activityTitle',act.title,'activityExerciseId',a.activity_exercise_id,'exerciseVersionId',a.exercise_version_id,
  'submittedAt',app_private.signal_instant(a.submitted_at),'diagnosisCode',a.technical_result->>'diagnosisCode',
  'visiblePassed',case when app_private.dashboard_visible_complete(a.technical_result) then (a.technical_result->>'visiblePassed')::integer else null end,
  'visibleTotal',case when app_private.dashboard_visible_complete(a.technical_result) then (a.technical_result->>'visibleTotal')::integer else null end,
  'allRequiredPassed',(a.technical_result->>'allRequiredPassed')::boolean,
  'verification',case when app_private.dashboard_attempt_verifiable(a.technical_result) then 'VERIFIED' else 'UNVERIFIABLE' end)
 from app.profiles p join app.activities act on act.id=a.activity_id and act.organization_id=a.organization_id where p.id=a.student_id
$$;

create function app_private.dashboard_roster(cls uuid) returns table(student_id uuid,student_name text,enrolled_at timestamptz)
language sql stable security invoker set search_path=pg_catalog as $$
 select m.user_id,p.display_name,m.enrolled_at from app.classes c
 join app.class_memberships m on m.organization_id=c.organization_id and m.class_id=c.id
 join app.organization_memberships om on om.organization_id=m.organization_id and om.user_id=m.user_id
 join app.profiles p on p.id=m.user_id
 where c.id=cls and m.ended_at is null and om.role='STUDENT' and om.state='ACTIVE' and p.account_state='ACTIVE'
$$;

-- One row per fixed assignment. Concept matching is EXISTS, never a fan-out.
create function app_private.dashboard_assignments(cls uuid,activity uuid,concept uuid,cut timestamptz)
returns table(organization_id uuid,activity_id uuid,activity_title text,assignment_id uuid,exercise_version_id uuid,"position" integer,required boolean)
language sql stable security invoker set search_path=pg_catalog as $$
 select a.organization_id,a.id,a.title,ae.id,ae.exercise_version_id,ae.position,ae.required
 from app.activities a join app.activity_exercises ae on ae.organization_id=a.organization_id and ae.activity_id=a.id
 where a.class_id=cls and a.state in ('PUBLISHED','CLOSED') and a.published_at<=cut and (activity is null or a.id=activity)
 and (concept is null or exists(select 1 from app.exercise_version_concepts link join app.concept_versions cv
  on cv.organization_id=link.organization_id and cv.id=link.concept_version_id
  where link.organization_id=ae.organization_id and link.exercise_version_id=ae.exercise_version_id and cv.concept_id=concept))
$$;

create function app_private.dashboard_attempts(cls uuid,student uuid,activity uuid,concept uuid,cut timestamptz,start_at timestamptz)
returns setof app.attempts language sql stable security invoker set search_path=pg_catalog as $$
 select a.* from app_private.dashboard_assignments(cls,activity,concept,cut) ae
 join app.attempts a on a.organization_id=ae.organization_id and a.class_id=cls and a.activity_id=ae.activity_id
  and a.activity_exercise_id=ae.assignment_id and a.exercise_version_id=ae.exercise_version_id
 join app_private.dashboard_roster(cls) r on r.student_id=a.student_id
 where (student is null or a.student_id=student) and a.submitted_at<=cut and (start_at is null or a.submitted_at>=start_at)
 and exists(select 1 from app_private.attempt_events e where e.organization_id=a.organization_id and e.attempt_id=a.id and e.event_type='ATTEMPT_SUBMITTED')
$$;

create function app_private.dashboard_events(cls uuid,student uuid,activity uuid,concept uuid,cut timestamptz,start_at timestamptz)
returns table(id uuid,student_id uuid,activity_id uuid,assignment_id uuid,occurred_at timestamptz,event_type text,payload jsonb)
language sql stable security invoker set search_path=pg_catalog as $$
 with assignments as materialized(select * from app_private.dashboard_assignments(cls,activity,concept,cut))
 select e.event_id,r.student_id,e.activity_id,e.activity_exercise_id,e.occurred_at,e.event_type,
  jsonb_build_object('id',e.event_id,'studentId',r.student_id,'studentName',r.student_name,'activityId',e.activity_id,
   'occurredAt',app_private.signal_instant(e.occurred_at),'eventType',e.event_type,'referenceId',e.source_id)
 from app.classes c join app_private.dashboard_roster(cls) r on true
 cross join lateral app_private.student_activity_events(c.organization_id,cls,r.student_id,cut) e
 where c.id=cls and (student is null or r.student_id=student) and e.eligible
 and e.event_type in ('CLASS_JOINED','ACTIVITY_OPENED','EXECUTION_COMPLETED','ATTEMPT_SUBMITTED','HINT_DELIVERED','FEEDBACK_VIEWED')
 and (start_at is null or e.occurred_at>=start_at)
 and ((e.event_type='CLASS_JOINED' and activity is null and concept is null)
  or exists(select 1 from app.activities act where act.id=e.activity_id and act.class_id=cls and act.published_at<=cut
   and act.state in ('PUBLISHED','CLOSED') and (activity is null or act.id=activity)
   and (concept is null or exists(select 1 from assignments ae where ae.activity_id=e.activity_id
    and (e.activity_exercise_id is null or ae.assignment_id=e.activity_exercise_id)))))
$$;

create function app_private.dashboard_observation_summary(attempts jsonb,events jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('attempts',jsonb_array_length(attempts),
  'technicalFailures',(select count(*) from jsonb_array_elements(attempts) a where a->>'verification'='VERIFIED' and a->>'diagnosisCode' in ('SYNTAX_ERROR','RUNTIME_ERROR','FAILED_TEST','TIMEOUT')),
  'unverifiableAttempts',(select count(*) from jsonb_array_elements(attempts) a where a->>'verification'='UNVERIFIABLE'),
  'hintsDelivered',(select count(*) from jsonb_array_elements(events) e where e->>'eventType'='HINT_DELIVERED'),
  'activityEvents',jsonb_array_length(events),
  'byDiagnosis',(select jsonb_agg(jsonb_build_object('diagnosisCode',kind,'count',(select count(*) from jsonb_array_elements(attempts) a where a->>'diagnosisCode'=kind)) order by position)
   from unnest(array['SUCCESS','SYNTAX_ERROR','RUNTIME_ERROR','FAILED_TEST','TIMEOUT','UNKNOWN']) with ordinality kinds(kind,position)))
$$;

-- Canonical completion kernel shared by personal progress and the class panel.
-- Restricted helpers cannot be executed by alunza_app; public wrappers authorize
-- the actor without substituting a student's identity into the transaction.
create function app_private.progress_observations(cls uuid,student uuid,activity uuid,concept uuid,cut timestamptz)
returns table(student_id uuid,activity_id uuid,activity_title text,assignment_id uuid,exercise_version_id uuid,
 "position" integer,required boolean,basis_id uuid,basis_at timestamptz,has_attempt boolean)
language sql stable security invoker set search_path=pg_catalog as $$
 with assignments as materialized(select * from app_private.dashboard_assignments(cls,activity,concept,cut)),
 roster as materialized(select * from app_private.dashboard_roster(cls) where student is null or student_id=student),
 confirmed as materialized(
  select a.id,a.student_id,a.activity_exercise_id,a.submitted_at,a.technical_result,e.event_sequence
  from assignments ae join app.attempts a on a.organization_id=ae.organization_id and a.class_id=cls
   and a.activity_id=ae.activity_id and a.activity_exercise_id=ae.assignment_id and a.exercise_version_id=ae.exercise_version_id
  join roster r on r.student_id=a.student_id
  join app_private.attempt_events e on e.organization_id=a.organization_id and e.attempt_id=a.id and e.event_type='ATTEMPT_SUBMITTED'
  where a.submitted_at<=cut
 ), first_success as materialized(
  select distinct on(student_id,activity_exercise_id) student_id,activity_exercise_id,id,submitted_at
  from confirmed where technical_result->'allRequiredPassed'='true'::jsonb
  order by student_id,activity_exercise_id,submitted_at,event_sequence,id
 ), attempted as materialized(select distinct student_id,activity_exercise_id from confirmed)
 select r.student_id,ae.activity_id,ae.activity_title,ae.assignment_id,ae.exercise_version_id,ae.position,ae.required,
  s.id,s.submitted_at,t.student_id is not null
 from roster r cross join assignments ae
 left join first_success s on s.student_id=r.student_id and s.activity_exercise_id=ae.assignment_id
 left join attempted t on t.student_id=r.student_id and t.activity_exercise_id=ae.assignment_id
$$;

create function app_private.progress_payload(cls uuid,student uuid,activity uuid,concept uuid,cut timestamptz) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 with observations as materialized(select * from app_private.progress_observations(cls,student,activity,concept,cut)),
 scoped_activities as materialized(
  select a.id,a.title from app.activities a where a.class_id=cls and a.state in ('PUBLISHED','CLOSED') and a.published_at<=cut
   and (activity is null or a.id=activity) and (concept is null or exists(select 1 from observations o where o.activity_id=a.id))
 ), version_concepts as materialized(
  select distinct cv.concept_id,cv.id as concept_version_id,cv.version,cv.name,o.exercise_version_id
  from observations o join app.exercise_version_concepts link on link.exercise_version_id=o.exercise_version_id
  join app.concept_versions cv on cv.organization_id=link.organization_id and cv.id=link.concept_version_id
  where concept is null or cv.concept_id=concept
 ), summary as(
  select app_private.progress_counts(count(*) filter(where required),count(*) filter(where required and basis_id is not null),
   coalesce(bool_or(has_attempt),false),array_agg(basis_id order by activity_id,position,assignment_id) filter(where required and basis_id is not null)) as counts from observations
 ), activity_groups as(
  select sa.id,sa.title,app_private.progress_counts(count(o.assignment_id) filter(where o.required),count(o.assignment_id) filter(where o.required and o.basis_id is not null),
   coalesce(bool_or(o.has_attempt),false),array_agg(o.basis_id order by o.position,o.assignment_id) filter(where o.required and o.basis_id is not null)) as counts
  from scoped_activities sa left join observations o on o.activity_id=sa.id group by sa.id,sa.title
 ), concept_assignments as materialized(
  select distinct vc.concept_id,o.assignment_id from observations o join version_concepts vc on vc.exercise_version_id=o.exercise_version_id
 ), concept_metadata as(
  select concept_id,(array_agg(name order by version desc,concept_version_id))[1] as name,array_agg(distinct concept_version_id order by concept_version_id) as version_ids
  from version_concepts group by concept_id
 ), concept_groups as(
  select m.concept_id,m.name,m.version_ids,app_private.progress_counts(count(*) filter(where o.required),count(*) filter(where o.required and o.basis_id is not null),
   coalesce(bool_or(o.has_attempt),false),array_agg(o.basis_id order by o.activity_id,o.position,o.assignment_id) filter(where o.required and o.basis_id is not null)) as counts
  from concept_metadata m join concept_assignments ca on ca.concept_id=m.concept_id join observations o on o.assignment_id=ca.assignment_id group by m.concept_id,m.name,m.version_ids
 )
 select jsonb_build_object('classId',cls,'filters',jsonb_build_object('activityId',activity,'conceptId',concept),'asOf',cut,
  'summary',(select counts from summary),
  'byActivity',coalesce((select jsonb_agg(jsonb_build_object('activityId',id,'title',title)||counts order by id) from activity_groups),'[]'::jsonb),
  'byConcept',coalesce((select jsonb_agg(jsonb_build_object('conceptId',concept_id,'name',name,'conceptVersionIds',version_ids)||counts order by concept_id) from concept_groups),'[]'::jsonb),
  'evidence',coalesce((select jsonb_agg(jsonb_build_object('activityId',activity_id,'activityExerciseId',assignment_id,'exerciseVersionId',exercise_version_id,
   'attemptId',basis_id,'submittedAt',basis_at) order by activity_id,position,assignment_id) from observations where required and basis_id is not null),'[]'::jsonb))
$$;

create or replace function app_private.student_progress(class uuid,activity uuid default null,concept uuid default null,cutoff timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare context jsonb;
begin
 context:=app_private.dashboard_context(class,jsonb_build_object('activityId',activity,'conceptId',concept,'asOf',cutoff),true);
 return app_private.progress_payload(class,app_private.actor_id(),activity,concept,(context->>'asOf')::timestamptz);
end $$;

create function app_private.dashboard_evidence_body(cls uuid,options jsonb,own boolean default false) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare ctx jsonb; cut timestamptz; start_at timestamptz; activity uuid; concept uuid; student uuid;
 kind text:=coalesce(options->>'kind','ATTEMPT'); diagnosis text:=options->>'diagnosisCode'; n integer;
 signature text; cursor_key jsonb; entries jsonb; more boolean; next_key jsonb; valid_cursor boolean; result jsonb;
begin
 perform app_private.dashboard_options(options,array['activityId','conceptId','from','asOf','cursor','limit','kind','studentId','diagnosisCode']);
 ctx:=app_private.dashboard_context(cls,options,own); cut:=(ctx->>'asOf')::timestamptz; start_at:=(ctx->>'from')::timestamptz;
 activity:=(ctx->>'activityId')::uuid; concept:=(ctx->>'conceptId')::uuid; student:=case when own then app_private.actor_id() else (options->>'studentId')::uuid end;
 if student is not null and not exists(select 1 from app_private.dashboard_roster(cls) r where r.student_id=student) then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 if kind not in ('ATTEMPT','COMPLETION','EVENT','HINT') or (diagnosis is not null and (kind<>'ATTEMPT' or diagnosis not in ('SUCCESS','SYNTAX_ERROR','RUNTIME_ERROR','FAILED_TEST','TIMEOUT','UNKNOWN'))) then
  raise exception using errcode='P0001',message='DASHBOARD_FILTER_INVALID';
 end if;
 n:=app_private.dashboard_limit(options);
 signature:=app_private.signal_digest(ctx||jsonb_build_object('actor',app_private.actor_id(),'reader','evidence','kind',kind,'studentId',student,'diagnosisCode',diagnosis));
 cursor_key:=app_private.dashboard_cursor(options,signature);
 with items as materialized(
  select a.id,a.submitted_at as at,e.event_sequence as sequence,jsonb_build_object('kind',kind,'attempt',app_private.dashboard_attempt_projection(a)) as payload
  from app_private.dashboard_attempts(cls,student,activity,concept,cut,case when kind='COMPLETION' then null else start_at end) a
  join app_private.attempt_events e on e.organization_id=a.organization_id and e.attempt_id=a.id and e.event_type='ATTEMPT_SUBMITTED'
  where kind in ('ATTEMPT','COMPLETION') and (diagnosis is null or a.technical_result->>'diagnosisCode'=diagnosis)
   and (kind<>'COMPLETION' or exists(select 1 from app_private.progress_observations(cls,student,activity,concept,cut) o where o.required and o.basis_id=a.id))
  union all
  select e.id,e.occurred_at,0::bigint,jsonb_build_object('kind',kind,'event',e.payload)
  from app_private.dashboard_events(cls,student,activity,concept,cut,start_at) e
  where kind='EVENT' or (kind='HINT' and e.event_type='HINT_DELIVERED')
 ), cursor_item as(select * from items where id=(cursor_key->>'id')::uuid and at=(cursor_key->>'at')::timestamptz),
 sliced as materialized(
  select * from items where cursor_key is null or (at,sequence,id)<(select at,sequence,id from cursor_item)
  order by at desc,sequence desc,id desc limit n+1
 ), page_items as materialized(select * from sliced order by at desc,sequence desc,id desc limit n)
 select coalesce((select jsonb_agg(payload order by at desc,sequence desc,id desc) from page_items),'[]'::jsonb),
  (select count(*)>n from sliced),
  (select jsonb_build_object('id',id,'at',app_private.signal_instant(at)) from page_items order by at,sequence,id limit 1),
  cursor_key is null or exists(select 1 from cursor_item)
 into entries,more,next_key,valid_cursor;
 if not valid_cursor then raise exception using errcode='P0001',message='DASHBOARD_CURSOR_INVALID'; end if;
 result:=jsonb_build_object('classId',cls,'filters',jsonb_build_object('activityId',activity,'conceptId',concept,'from',app_private.signal_instant(start_at)),
  'asOf',app_private.signal_instant(cut),'observedAt',app_private.signal_instant(statement_timestamp()),'kind',kind,'studentId',student,'diagnosisCode',diagnosis,
  'data',entries,'page',jsonb_build_object('hasMore',more,'nextCursor',case when more then app_private.dashboard_next_cursor(signature,next_key) else null end));
 return result;
end $$;

create function app_private.dashboard_evidence(class uuid,options jsonb) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.dashboard_evidence_body(class,options,false)
$$;

create function app_private.student_progress_observed(class uuid,options jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ctx jsonb; cut timestamptz; start_at timestamptz; activity uuid; concept uuid; attempts jsonb; events jsonb; last_at timestamptz; evidence jsonb;
begin
 perform app_private.dashboard_options(options,array['activityId','conceptId','from','asOf','cursor','limit']);
 ctx:=app_private.dashboard_context(class,options,true); cut:=(ctx->>'asOf')::timestamptz; start_at:=(ctx->>'from')::timestamptz;
 activity:=(ctx->>'activityId')::uuid; concept:=(ctx->>'conceptId')::uuid;
 select coalesce(jsonb_agg(app_private.dashboard_attempt_projection(a)),'[]'::jsonb) into attempts
 from app_private.dashboard_attempts(class,app_private.actor_id(),activity,concept,cut,start_at) a;
 select coalesce(jsonb_agg(e.payload) filter(where start_at is null or e.occurred_at>=start_at),'[]'::jsonb),max(e.occurred_at) into events,last_at
 from app_private.dashboard_events(class,app_private.actor_id(),activity,concept,cut,null) e;
 evidence:=app_private.dashboard_evidence_body(class,options||jsonb_build_object('asOf',ctx->>'asOf','kind','ATTEMPT'),true);
 return app_private.progress_payload(class,app_private.actor_id(),activity,concept,cut)||jsonb_build_object('observation',jsonb_build_object(
  'from',app_private.signal_instant(start_at),'observedAt',app_private.signal_instant(statement_timestamp()),'lastActivityAt',app_private.signal_instant(last_at),
  'summary',app_private.dashboard_observation_summary(attempts,events),
  'attempts',coalesce((select jsonb_agg(item->'attempt' order by ord) from jsonb_array_elements(evidence->'data') with ordinality items(item,ord)),'[]'::jsonb),'page',evidence->'page'));
end $$;

create function app_private.dashboard_signal_rows(cls uuid,activity uuid,concept uuid,cut timestamptz)
returns setof app_private.signal_episodes language sql stable security invoker set search_path=pg_catalog as $$
 select ep.* from app_private.signal_episodes ep join app_private.signal_lanes l on l.id=ep.lane_id
 where l.class_id=cls and ep.qualified_at<=cut and (activity is null or l.activity_id=activity)
 and (concept is null or exists(select 1 from app_private.dashboard_assignments(cls,l.activity_id,concept,cut) ae
  where l.assignment_id is null or l.assignment_id=ae.assignment_id))
$$;

create function app_private.dashboard_signal_projection(ep app_private.signal_episodes,cut timestamptz) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare l app_private.signal_lanes; v app.signal_rule_versions; latest app_private.signal_evaluations;
 is_reviewed boolean:=ep.reviewed_at is not null and ep.reviewed_at<=cut; valid boolean; student_name text; activity_title text;
begin
 select * into l from app_private.signal_lanes where id=ep.lane_id;
 select * into v from app.signal_rule_versions where id=ep.rule_version_id and organization_id=l.organization_id;
 select display_name into student_name from app.profiles where id=l.student_id;
 select title into activity_title from app.activities where id=l.activity_id and organization_id=l.organization_id and class_id=l.class_id;
 select * into latest from app_private.signal_evaluations e where e.lane_id=l.id and e.evaluation_time between ep.qualified_at and least(cut,coalesce(ep.stopped_at,cut))
  and e.result->>'ruleVersionId'=ep.rule_version_id::text
  and not exists(select 1 from app_private.signal_episodes successor join app_private.signal_evaluations first_next on first_next.id=successor.first_evaluation_id
   where successor.previous_episode_id=ep.id and e.evaluation_sequence>=first_next.evaluation_sequence)
 order by e.evaluation_time desc,case e.boundary->>'kind' when 'CURRENT' then 7 when 'RECONCILE' then 6
  when 'INACTIVITY_DUE' then 5 when 'REPETITION_EXPIRES' then 5 when 'REVIEW' then 4 when 'EVENT' then 3
  when 'SUBMISSION' then 2 when 'START' then 0 else 1 end desc,
  coalesce((e.boundary->>'sequence')::bigint,0) desc,e.evaluation_sequence desc limit 1;
 valid:=app_private.signal_episode_source_valid(ep);
 if l.type<>'INACTIVITY' then
  valid:=valid and not exists(select 1 from jsonb_array_elements(coalesce(ep.initial_evidence->'submissions','[]'::jsonb)) ref
   where not exists(select 1 from app.attempts a where a.id=(ref->>'id')::uuid and a.organization_id=l.organization_id
    and a.class_id=l.class_id and a.student_id=l.student_id and a.activity_id=l.activity_id and a.activity_exercise_id=l.assignment_id and a.submitted_at<=cut));
 else
  valid:=valid and not exists(select 1 from jsonb_array_elements(coalesce(ep.initial_evidence->'referenceEvents','[]'::jsonb)) ref
   where not exists(select 1 from app_private.student_activity_events(l.organization_id,l.class_id,l.student_id,cut) e
    where e.event_id=(ref->>'id')::uuid and e.source=ref->>'source' and e.activity_id=l.activity_id and e.eligible));
 end if;
 return jsonb_build_object('id',ep.id,'type',l.type,'state',case when is_reviewed then 'REVIEWED' else 'ACTIVE' end,
  'studentId',l.student_id,'studentName',student_name,'currentMember',exists(select 1 from app_private.dashboard_roster(l.class_id) r where r.student_id=l.student_id),
  'activityId',l.activity_id,'activityTitle',activity_title,'activityExerciseId',l.assignment_id,
  'rule',jsonb_build_object('id',v.id,'version',v.version,'configuration',jsonb_build_object('type',v.type,'schemaVersion',v.schema_version,'algorithmVersion',v.algorithm_version,'parameters',v.parameters)),
  'cause',ep.initial_cause,'qualifiedAt',app_private.signal_instant(ep.qualified_at),'calculatedAt',app_private.signal_instant(ep.calculated_at),
  'reviewedAt',case when is_reviewed then app_private.signal_instant(ep.reviewed_at) else null end,'reviewedBy',case when is_reviewed then ep.reviewed_by else null end,
  'stoppedAt',case when ep.stopped_at<=cut then app_private.signal_instant(ep.stopped_at) else null end,'stopReason',case when ep.stopped_at<=cut then ep.stop_reason else null end,
  'previousEpisodeId',ep.previous_episode_id,'lastEvaluation',case when latest.id is null then null else jsonb_build_object('id',latest.id,
   'evaluationTime',app_private.signal_instant(latest.evaluation_time),'calculatedAt',app_private.signal_instant(latest.calculated_at),'outcome',latest.outcome,'reason',latest.result->>'reason') end,
  'verification',case when valid then 'VERIFIABLE' else 'UNVERIFIABLE' end);
end $$;

create function app_private.dashboard_processing(cls uuid,activity uuid,concept uuid,cut timestamptz) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 with activities as materialized(
  select a.* from app.activities a where a.class_id=cls and a.published_at<=cut and a.state in ('PUBLISHED','CLOSED')
   and (activity is null or a.id=activity) and (concept is null or exists(select 1 from app_private.dashboard_assignments(cls,a.id,concept,cut)))
 ), rules as materialized(
  select v.type from app.signal_rule_versions v join app.classes c on c.organization_id=v.organization_id
   where c.id=cls and v.valid_from<=cut and (v.valid_to is null or v.valid_to>cut)
 ), expected as materialized(
  select r.student_id,a.id as activity_id,null::uuid as assignment_id,'INACTIVITY'::text as type
   from app_private.dashboard_roster(cls) r cross join activities a
  union all
  select r.student_id,ae.activity_id,ae.assignment_id,t.type from app_private.dashboard_roster(cls) r
   cross join app_private.dashboard_assignments(cls,activity,concept,cut) ae cross join (values('REPEATED_ERROR'),('STAGNATION')) t(type)
 ), lanes as materialized(
  select l.*,j.through_time,j.failed_at,j.continuation,j.next_deadline_micros,j.last_revision,
   j.lane_id is null or j.through_time is null or j.boundary_key is null or j.continuation is not null
    or j.last_revision is distinct from app_private.signal_digest(app_private.signal_current_vector(l))
    or j.next_deadline_micros<=floor(extract(epoch from cut)*1000000)
    or exists(select 1 from app_private.signal_input_changes change join app_private.signal_lane_clock_keys(l) k using(component,scope_key)
     where change.finalized_at is not null and not exists(select 1 from app_private.signal_change_acks ack where ack.lane_id=l.id and ack.change_id=change.id)) as pending
  from expected x join rules r on r.type=x.type
  left join app_private.signal_lanes l on l.class_id=cls and l.student_id=x.student_id and l.activity_id=x.activity_id
   and l.type=x.type and l.assignment_id is not distinct from x.assignment_id
  left join app_private.signal_jobs j on j.lane_id=l.id
 ), totals as(
  select count(*) filter(where pending and failed_at is null) as pending_count,count(*) filter(where failed_at is not null) as failed_count,
   min(least(through_time,cut)) filter(where through_time is not null) as through,max(through_time) as latest_through from lanes
 )
 select jsonb_build_object('status',case when failed_count>0 then 'FAILED' when latest_through is null then 'NOT_EVALUATED'
  when pending_count>0 then 'PENDING' else 'UP_TO_DATE' end,
  'evaluatedAt',app_private.signal_instant((select max(e.calculated_at) from app_private.signal_evaluations e join lanes l on l.id=e.lane_id where e.evaluation_time<=cut)),
  'processedThrough',app_private.signal_instant(through),'pendingLanes',pending_count,'failedLanes',failed_count,
  'unconfiguredTypes',(select coalesce(jsonb_agg(t.type order by t.position),'[]'::jsonb)
   from (values(1,'INACTIVITY'),(2,'REPEATED_ERROR'),(3,'STAGNATION')) t(position,type) where not exists(select 1 from rules r where r.type=t.type))) from totals
$$;

create function app_private.dashboard_signal_counts(signals jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(jsonb_build_object('type',t.type,'state',s.state,
  'count',(select count(*) from jsonb_array_elements(signals) x where x->>'type'=t.type and x->>'state'=s.state),
  'currentStudents',(select count(*) from jsonb_array_elements(signals) x where x->>'type'=t.type and x->>'state'=s.state and x->'currentMember'='true'::jsonb),
  'historicalStudents',(select count(*) from jsonb_array_elements(signals) x where x->>'type'=t.type and x->>'state'=s.state and x->'currentMember'='false'::jsonb)
 ) order by t.position,s.position),'[]'::jsonb)
 from (values(1,'INACTIVITY'),(2,'REPEATED_ERROR'),(3,'STAGNATION')) t(position,type) cross join (values(1,'ACTIVE'),(2,'REVIEWED')) s(position,state)
$$;

create function app_private.dashboard_signals(class uuid,options jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ctx jsonb; activity uuid; concept uuid; cut timestamptz; kind text:=options->>'type'; state_value text:=coalesce(options->>'state','ACTIVE');
 signature text; cursor_key jsonb; n integer; entries jsonb; more boolean; next_key jsonb; valid_cursor boolean;
begin
 perform app_private.dashboard_options(options,array['activityId','conceptId','asOf','cursor','limit','type','state']);
 ctx:=app_private.dashboard_context(class,options,false); activity:=(ctx->>'activityId')::uuid; concept:=(ctx->>'conceptId')::uuid; cut:=(ctx->>'asOf')::timestamptz;
 if (kind is not null and kind not in ('INACTIVITY','REPEATED_ERROR','STAGNATION')) or state_value not in ('ACTIVE','REVIEWED','ALL') then raise exception using errcode='P0001',message='DASHBOARD_FILTER_INVALID'; end if;
 n:=app_private.dashboard_limit(options);
 signature:=app_private.signal_digest(ctx||jsonb_build_object('actor',app_private.actor_id(),'reader','signals','type',kind,'state',state_value));
 cursor_key:=app_private.dashboard_cursor(options,signature);
 with items as materialized(
  select ep.id,ep.qualified_at as at,app_private.dashboard_signal_projection(ep,cut) as payload
  from app_private.dashboard_signal_rows(class,activity,concept,cut) ep join app_private.signal_lanes l on l.id=ep.lane_id
  where (kind is null or l.type=kind) and (state_value='ALL' or state_value=case when ep.reviewed_at<=cut then 'REVIEWED' else 'ACTIVE' end)
 ), cursor_item as(select * from items where id=(cursor_key->>'id')::uuid and at=(cursor_key->>'at')::timestamptz),
 sliced as materialized(select * from items where cursor_key is null or (at,id)<(select at,id from cursor_item) order by at desc,id desc limit n+1),
 page_items as materialized(select * from sliced order by at desc,id desc limit n)
 select coalesce((select jsonb_agg(payload order by at desc,id desc) from page_items),'[]'::jsonb),(select count(*)>n from sliced),
  (select jsonb_build_object('id',id,'at',app_private.signal_instant(at)) from page_items order by at,id limit 1),cursor_key is null or exists(select 1 from cursor_item)
 into entries,more,next_key,valid_cursor;
 if not valid_cursor then raise exception using errcode='P0001',message='DASHBOARD_CURSOR_INVALID'; end if;
 return jsonb_build_object('classId',class,'asOf',ctx->>'asOf','observedAt',app_private.signal_instant(statement_timestamp()),
  'filters',jsonb_build_object('activityId',activity,'conceptId',concept,'type',kind,'state',state_value),
  'processing',app_private.dashboard_processing(class,activity,concept,cut),'data',entries,
  'page',jsonb_build_object('hasMore',more,'nextCursor',case when more then app_private.dashboard_next_cursor(signature,next_key) else null end));
end $$;

create function app_private.dashboard_signal(class uuid,signal uuid,options jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ctx jsonb; cut timestamptz; ep app_private.signal_episodes; l app_private.signal_lanes; attempts jsonb; events jsonb; projection jsonb;
begin
 perform app_private.dashboard_options(options,array['asOf']);
 ctx:=app_private.dashboard_context(class,options,false); cut:=(ctx->>'asOf')::timestamptz;
 select e.* into ep from app_private.signal_episodes e join app_private.signal_lanes lane on lane.id=e.lane_id
  where e.id=signal and lane.class_id=class and e.qualified_at<=cut;
 if ep.id is null then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 select * into l from app_private.signal_lanes where id=ep.lane_id;
 projection:=app_private.dashboard_signal_projection(ep,cut);
 select coalesce(jsonb_agg(app_private.dashboard_attempt_projection(a) order by refs.ord),'[]'::jsonb) into attempts
 from jsonb_array_elements(coalesce(ep.initial_evidence->'submissions','[]'::jsonb)) with ordinality refs(ref,ord)
 join app.attempts a on a.id=(ref->>'id')::uuid and a.organization_id=l.organization_id and a.class_id=l.class_id
  and a.student_id=l.student_id and a.activity_id=l.activity_id and a.activity_exercise_id=l.assignment_id and a.submitted_at<=cut;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.event_id,'studentId',l.student_id,'studentName',projection->>'studentName',
  'activityId',e.activity_id,'occurredAt',app_private.signal_instant(e.occurred_at),'eventType',e.event_type,'referenceId',e.source_id) order by refs.ord),'[]'::jsonb) into events
 from jsonb_array_elements(coalesce(ep.initial_evidence->'referenceEvents','[]'::jsonb)) with ordinality refs(ref,ord)
 join app_private.student_activity_events(l.organization_id,l.class_id,l.student_id,cut) e
  on e.event_id=(ref->>'id')::uuid and e.source=ref->>'source' and e.activity_id=l.activity_id and e.eligible;
 return jsonb_build_object('classId',class,'asOf',ctx->>'asOf','observedAt',app_private.signal_instant(statement_timestamp()),'signal',projection,
  'evidence',jsonb_build_object('attempts',attempts,'events',events,'baselineAt',ep.initial_evidence->>'baselineAt',
   'observableSince',ep.initial_evidence->>'observableSince','lastAt',ep.initial_evidence->>'lastAt',
   'explanation',case when projection->>'verification'='UNVERIFIABLE' then 'La evidencia persistida no puede verificarse completamente.' else ep.initial_cause end));
end $$;

create function app_private.dashboard_read(class uuid,options jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ctx jsonb; org uuid; activity uuid; concept uuid; cut timestamptz; start_at timestamptz;
 signature text; cursor_key jsonb; n integer; result jsonb;
begin
 perform app_private.dashboard_options(options,array['activityId','conceptId','from','asOf','cursor','limit']);
 ctx:=app_private.dashboard_context(class,options,false); org:=(ctx->>'organizationId')::uuid;
 activity:=(ctx->>'activityId')::uuid; concept:=(ctx->>'conceptId')::uuid; cut:=(ctx->>'asOf')::timestamptz; start_at:=(ctx->>'from')::timestamptz;
 n:=app_private.dashboard_limit(options);
 signature:=app_private.signal_digest(ctx||jsonb_build_object('actor',app_private.actor_id(),'reader','dashboard'));
 cursor_key:=app_private.dashboard_cursor(options,signature);
 if cursor_key is not null and not exists(select 1 from app_private.dashboard_roster(class) where student_id=(cursor_key->>'id')::uuid) then
  raise exception using errcode='P0001',message='DASHBOARD_CURSOR_INVALID';
 end if;
 with roster as materialized(select * from app_private.dashboard_roster(class)),
 assignments as materialized(select * from app_private.dashboard_assignments(class,activity,concept,cut)),
 observations as materialized(select * from app_private.progress_observations(class,null,activity,concept,cut)),
 attempts as materialized(select a.id,a.student_id,a.activity_id,a.activity_exercise_id,a.exercise_version_id,app_private.dashboard_attempt_projection(a) as payload
  from app_private.dashboard_attempts(class,null,activity,concept,cut,start_at) a),
 all_events as materialized(select * from app_private.dashboard_events(class,null,activity,concept,cut,null)),
 events as materialized(select * from all_events where start_at is null or occurred_at>=start_at),
 signal_items as materialized(select app_private.dashboard_signal_projection(ep,cut) as payload from app_private.dashboard_signal_rows(class,activity,concept,cut) ep),
 scoped_activities as materialized(select a.id,a.title from app.activities a where a.organization_id=org and a.class_id=class and a.state in ('PUBLISHED','CLOSED')
  and a.published_at<=cut and (activity is null or a.id=activity) and (concept is null or exists(select 1 from assignments ae where ae.activity_id=a.id))),
 version_concepts as materialized(
  select distinct ae.exercise_version_id,cv.concept_id,cv.id as concept_version_id,cv.version,cv.name
  from assignments ae join app.exercise_version_concepts link on link.organization_id=ae.organization_id and link.exercise_version_id=ae.exercise_version_id
  join app.concept_versions cv on cv.organization_id=link.organization_id and cv.id=link.concept_version_id
  where concept is null or cv.concept_id=concept
 ), concept_metadata as materialized(
  select concept_id,(array_agg(name order by version desc,concept_version_id))[1] as name,
   array_agg(distinct concept_version_id order by concept_version_id) as version_ids from version_concepts group by concept_id
 ), concept_assignments as materialized(select distinct vc.concept_id,ae.assignment_id,ae.activity_id
  from assignments ae join version_concepts vc on vc.exercise_version_id=ae.exercise_version_id),
 summary as(
  select (app_private.progress_counts(count(*) filter(where required),count(*) filter(where required and basis_id is not null),coalesce(bool_or(has_attempt),false),null)-'basisAttemptIds')
   ||jsonb_build_object('students',(select count(*) from roster),'lastActivityAt',app_private.signal_instant((select max(occurred_at) from all_events)),
   'period',app_private.dashboard_observation_summary(coalesce((select jsonb_agg(payload) from attempts),'[]'::jsonb),coalesce((select jsonb_agg(payload) from events),'[]'::jsonb))) as payload
  from observations
 ), activity_groups as(
  select sa.id,jsonb_build_object('activityId',sa.id,'title',sa.title)||
   (app_private.progress_counts(count(o.assignment_id) filter(where o.required),count(o.assignment_id) filter(where o.required and o.basis_id is not null),coalesce(bool_or(o.has_attempt),false),null)-'basisAttemptIds')||
   jsonb_build_object('period',app_private.dashboard_observation_summary(
    coalesce((select jsonb_agg(a.payload) from attempts a where a.activity_id=sa.id),'[]'::jsonb),
    coalesce((select jsonb_agg(e.payload) from events e where e.activity_id=sa.id),'[]'::jsonb))) as payload
  from scoped_activities sa left join observations o on o.activity_id=sa.id group by sa.id,sa.title
 ), concept_groups as(
  select cm.concept_id,jsonb_build_object('conceptId',cm.concept_id,'name',cm.name,'conceptVersionIds',cm.version_ids)||
   (app_private.progress_counts(count(o.assignment_id) filter(where o.required),count(o.assignment_id) filter(where o.required and o.basis_id is not null),coalesce(bool_or(o.has_attempt),false),null)-'basisAttemptIds')||
   jsonb_build_object('period',app_private.dashboard_observation_summary(
    coalesce((select jsonb_agg(a.payload) from attempts a where exists(select 1 from concept_assignments ca where ca.concept_id=cm.concept_id and ca.assignment_id=a.activity_exercise_id)),'[]'::jsonb),
    coalesce((select jsonb_agg(e.payload) from events e where exists(select 1 from concept_assignments ca where ca.concept_id=cm.concept_id and ca.activity_id=e.activity_id
     and (e.assignment_id is null or ca.assignment_id=e.assignment_id))),'[]'::jsonb))) as payload
  from concept_metadata cm left join concept_assignments ca on ca.concept_id=cm.concept_id left join observations o on o.assignment_id=ca.assignment_id
  group by cm.concept_id,cm.name,cm.version_ids
 ), student_slice as materialized(select * from roster where cursor_key is null or student_id>(cursor_key->>'id')::uuid order by student_id limit n+1),
 student_page as materialized(select * from student_slice order by student_id limit n),
 students as(
  select r.student_id,jsonb_build_object('studentId',r.student_id,'studentName',r.student_name)||
   (app_private.progress_counts(count(o.assignment_id) filter(where o.required),count(o.assignment_id) filter(where o.required and o.basis_id is not null),coalesce(bool_or(o.has_attempt),false),null)-'basisAttemptIds')||
   jsonb_build_object('lastActivityAt',app_private.signal_instant((select max(e.occurred_at) from all_events e where e.student_id=r.student_id)),
   'period',app_private.dashboard_observation_summary(coalesce((select jsonb_agg(a.payload) from attempts a where a.student_id=r.student_id),'[]'::jsonb),
    coalesce((select jsonb_agg(e.payload) from events e where e.student_id=r.student_id),'[]'::jsonb)),
   'signals',app_private.dashboard_signal_counts(coalesce((select jsonb_agg(s.payload) from signal_items s where s.payload->>'studentId'=r.student_id::text),'[]'::jsonb))) as payload
  from student_page r left join observations o on o.student_id=r.student_id group by r.student_id,r.student_name
 )
 select jsonb_build_object('classId',class,'organizationId',org,'className',(select name from app.classes where id=class),
  'filters',jsonb_build_object('activityId',activity,'conceptId',concept,'from',app_private.signal_instant(start_at)),
  'asOf',app_private.signal_instant(cut),'observedAt',app_private.signal_instant(statement_timestamp()),'roster','CURRENT_ACTIVE',
  'summary',(select payload from summary),'byActivity',coalesce((select jsonb_agg(payload order by id) from activity_groups),'[]'::jsonb),
  'byConcept',coalesce((select jsonb_agg(payload order by concept_id) from concept_groups),'[]'::jsonb),
  'students',jsonb_build_object('data',coalesce((select jsonb_agg(payload order by student_id) from students),'[]'::jsonb),
   'page',jsonb_build_object('hasMore',(select count(*)>n from student_slice),'nextCursor',case when (select count(*)>n from student_slice)
    then app_private.dashboard_next_cursor(signature,jsonb_build_object('id',(select student_id from student_page order by student_id desc limit 1))) else null end)),
  'signals',jsonb_build_object('counts',app_private.dashboard_signal_counts(coalesce((select jsonb_agg(payload) from signal_items),'[]'::jsonb)),
   'processing',app_private.dashboard_processing(class,activity,concept,cut))) into result;
 return result;
end $$;

create index dashboard_attempts_class_cut on app.attempts(organization_id,class_id,submitted_at,student_id,activity_exercise_id);
create index dashboard_episodes_lane_cut on app_private.signal_episodes(lane_id,qualified_at,id);
create index dashboard_evaluations_latest on app_private.signal_evaluations(lane_id,evaluation_time desc,evaluation_sequence desc);

-- Entry points authorize actor/session and scope. Shared kernels are private.
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
do $$ declare fn regprocedure; name text; begin
 for fn,name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app_private' and (p.proname like 'dashboard_%' or p.proname in ('progress_observations','progress_payload','student_progress','student_progress_observed')) loop
  execute format('alter function %s owner to alunza_identity',fn);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',fn);
  execute format('grant execute on function %s to alunza_identity',fn);
  if name in ('dashboard_read','dashboard_evidence','dashboard_signals','dashboard_signal','student_progress','student_progress_observed') then
   execute format('grant execute on function %s to alunza_app',fn);
  end if;
 end loop;
end $$;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
