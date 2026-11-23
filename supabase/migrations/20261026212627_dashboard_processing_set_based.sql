-- IMP-05.08. Set-based freshness for read-only class projections.
-- Preserve canonical clocks, ordered vectors, finalized changes and ACK semantics;
-- share clock JSON and coverage attestations across lanes in the same statement.
-- No canonical facts, worker checkpoints, public DTOs or permissions change.

grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;

create or replace function app_private.dashboard_processing(cls uuid,activity uuid,concept uuid,cut timestamptz) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 with roster as materialized(select * from app_private.dashboard_roster(cls)),
 assignments as materialized(select * from app_private.dashboard_assignments(cls,activity,concept,cut)),
 activities as materialized(
  select a.* from app.activities a where a.class_id=cls and a.published_at<=cut and a.state in ('PUBLISHED','CLOSED')
   and (activity is null or a.id=activity) and (concept is null or exists(select 1 from assignments ae where ae.activity_id=a.id))
 ), rules as materialized(
  select v.type from app.signal_rule_versions v join app.classes c on c.organization_id=v.organization_id
   where c.id=cls and v.valid_from<=cut and (v.valid_to is null or v.valid_to>cut)
 ), expected as materialized(
  select r.student_id,a.id as activity_id,null::uuid as assignment_id,'INACTIVITY'::text as type from roster r cross join activities a
  union all
  select r.student_id,ae.activity_id,ae.assignment_id,t.type from roster r cross join assignments ae cross join (values('REPEATED_ERROR'),('STAGNATION')) t(type)
 ), scope_lanes as materialized(
  select l as lane,l.id,j.through_time,j.failed_at,j.continuation,j.next_deadline_micros,j.last_revision,j.boundary_key,j.lane_id as job_lane_id
  from expected x join rules r on r.type=x.type
  left join app_private.signal_lanes l on l.class_id=cls and l.student_id=x.student_id and l.activity_id=x.activity_id
   and l.type=x.type and l.assignment_id is not distinct from x.assignment_id
  left join app_private.signal_jobs j on j.lane_id=l.id
 ), keys as materialized(
  select l.id as lane_id,k.component,k.scope_key from scope_lanes l cross join lateral app_private.signal_lane_clock_keys(l.lane) k where l.id is not null
 ), relevant_keys as materialized(select distinct component,scope_key from keys),
 clock_entries as materialized(
  select c.component,c.scope_key,jsonb_build_object('component',c.component,'key',c.scope_key,'epoch',c.epoch,'revision',c.revision::text) as value
  from relevant_keys k join app_private.signal_evidence_clocks c using(component,scope_key)
 ), attestations as materialized(
  select 'COVERAGE_ATTESTATION'::text as component,r.source as scope_key,jsonb_build_object('component','COVERAGE_ATTESTATION','key',r.source,
   'epoch',e.id,'startsAt',app_private.signal_instant(e.starts_at),'endsAt',app_private.signal_instant(e.ends_at),'definition',r.expected_definition_hash) as value
  from app_private.signal_capture_registry r left join lateral(select * from app_private.signal_coverage_epochs x where x.source=r.source
   order by (x.ends_at is null) desc,x.starts_at desc,x.id desc limit 1) e on true
 ), vector_entries as(
  select k.lane_id,c.component,c.scope_key,c.value from keys k join clock_entries c using(component,scope_key)
  union all
  select l.id,a.component,a.scope_key,a.value from scope_lanes l cross join attestations a where l.id is not null
 ), vectors as materialized(
  select lane_id,app_private.signal_digest(jsonb_agg(value order by component,scope_key)) as revision from vector_entries group by lane_id
 ), unacknowledged as materialized(
  select distinct k.lane_id from keys k join app_private.signal_input_changes change using(component,scope_key)
  where change.finalized_at is not null and not exists(select 1 from app_private.signal_change_acks ack where ack.lane_id=k.lane_id and ack.change_id=change.id)
 ), lanes as materialized(
  select l.*,l.job_lane_id is null or l.through_time is null or l.boundary_key is null or l.continuation is not null
   or l.last_revision is distinct from coalesce(v.revision,app_private.signal_digest('[]'::jsonb))
   or l.next_deadline_micros<=floor(extract(epoch from cut)*1000000) or u.lane_id is not null as pending
  from scope_lanes l left join vectors v on v.lane_id=l.id left join unacknowledged u on u.lane_id=l.id
 ), totals as(
  select count(*) filter(where pending and failed_at is null) as pending_count,count(*) filter(where failed_at is not null) as failed_count,
   min(least(through_time,cut)) filter(where through_time is not null) as through,max(through_time) as latest_through from lanes
 )
 select jsonb_build_object('status',case when failed_count>0 then 'FAILED' when latest_through is null then 'NOT_EVALUATED'
  when pending_count>0 then 'PENDING' else 'UP_TO_DATE' end,
  'evaluatedAt',app_private.signal_instant((select max(e.calculated_at) from app_private.signal_evaluations e join scope_lanes l on l.id=e.lane_id where e.evaluation_time<=cut)),
  'processedThrough',app_private.signal_instant(through),'pendingLanes',pending_count,'failedLanes',failed_count,
  'unconfiguredTypes',(select coalesce(jsonb_agg(t.type order by t.position),'[]'::jsonb)
   from (values(1,'INACTIVITY'),(2,'REPEATED_ERROR'),(3,'STAGNATION')) t(position,type) where not exists(select 1 from rules r where r.type=t.type))) from totals
$$;

-- Counters need only scope and historical state; full evidence remains in signal reads.
create or replace function app_private.dashboard_read(class uuid,options jsonb) returns jsonb
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
 signal_items as materialized(
  select jsonb_build_object('type',l.type,'state',case when ep.reviewed_at<=cut then 'REVIEWED' else 'ACTIVE' end,
   'studentId',l.student_id,'currentMember',exists(select 1 from roster r where r.student_id=l.student_id)) as payload
  from app_private.dashboard_signal_rows(class,activity,concept,cut) ep join app_private.signal_lanes l on l.id=ep.lane_id),
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

-- CREATE OR REPLACE retains ownership and ACLs; make the intended boundary explicit.
alter function app_private.dashboard_processing(uuid,uuid,uuid,timestamptz) owner to alunza_identity;
alter function app_private.dashboard_read(uuid,jsonb) owner to alunza_identity;
revoke all on function app_private.dashboard_processing(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role,alunza_app;
revoke all on function app_private.dashboard_read(uuid,jsonb) from public,anon,authenticated,service_role,alunza_app;
grant execute on function app_private.dashboard_processing(uuid,uuid,uuid,timestamptz) to alunza_identity;
grant execute on function app_private.dashboard_read(uuid,jsonb) to alunza_identity,alunza_app;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
