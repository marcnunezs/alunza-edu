-- IMP-05.08. The dashboard's period summaries consume only diagnosis and
-- verifiability. Avoid projecting names, visible results and timestamps for
-- every attempt merely to discard those fields during aggregation.
-- Detailed evidence and personal-progress projections remain unchanged.

grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;

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
 attempts as materialized(select a.id,a.student_id,a.activity_id,a.activity_exercise_id,a.exercise_version_id,jsonb_build_object('diagnosisCode',a.technical_result->>'diagnosisCode',
   'verification',case when app_private.dashboard_attempt_verifiable(a.technical_result) then 'VERIFIED' else 'UNVERIFIABLE' end) as payload
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

alter function app_private.dashboard_read(uuid,jsonb) owner to alunza_identity;
revoke all on function app_private.dashboard_read(uuid,jsonb) from public,anon,authenticated,service_role,alunza_app;
grant execute on function app_private.dashboard_read(uuid,jsonb) to alunza_identity,alunza_app;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
