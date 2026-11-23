-- IMP-06.04. Authenticated review of an existing episode, preserving its first
-- reviewer, server instant and immutable evidence. No pedagogical recalculation.
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;

-- The capture kernel is callable only by the internal owner. The worker entry
-- point keeps its empty-actor guard. Review captures the present, never a worker
-- continuation's earlier targetThrough, and never clears the teacher context.
create function app_private.signal_capture_snapshot_core(lane uuid,token uuid,review_now boolean) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare l app_private.signal_lanes; j app_private.signal_jobs; vector_value jsonb; revision_value text; digest_value text;
 ts timestamptz; captured timestamptz; bootstrap timestamptz; snapshot_uuid uuid:=gen_random_uuid(); envelope jsonb; continuation_value jsonb;
 rules_value jsonb; events_value jsonb; submissions_value jsonb; availability_value jsonb; coverage_value jsonb;
 history_value jsonb; refs jsonb; changes uuid[]; reviews_value jsonb; prior_value jsonb; witnesses_value jsonb; semantic_value jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'SIGNAL_READ_COMMITTED_REQUIRED'; end if;
 select * into l from app_private.signal_lanes where id=lane;
 if not found then return null; end if;
 vector_value:=app_private.signal_lock_lane_clocks(l);
 -- Fresh statement snapshot after all waits. Producers cannot commit a source
 -- change for these keys until this transaction releases the clocks.
 select * into j from app_private.signal_jobs where lane_id=lane for update;
 ts:=clock_timestamp();
 captured:=ts;
 if token is null or j.lease_token is distinct from token or j.lease_until<=ts then return null; end if;
 if j.through_time>ts then raise exception using errcode='P0001',message='CLOCK_REGRESSION'; end if;
 select bootstrap_at into bootstrap from app_private.signal_runtime where singleton;
 revision_value:=app_private.signal_digest(vector_value);
 continuation_value:=j.continuation;
 if not review_now and continuation_value is not null and continuation_value->>'revision'=revision_value
  and (continuation_value->>'targetThrough')::timestamptz<=captured then
  ts:=(continuation_value->>'targetThrough')::timestamptz;
 else
  continuation_value:=null;
  if j.continuation is not null then update app_private.signal_jobs set continuation=null where lane_id=lane; end if;
 end if;
 select coalesce(jsonb_agg(app_private.signal_rule_projection(v) order by valid_from nulls last,created_at,id),'[]'::jsonb)
 into rules_value from app.signal_rule_versions v where organization_id=l.organization_id and type=l.type and valid_from is not null and valid_from<=ts;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.event_id,'source',e.source,'type',e.event_type,'schemaVersion',e.schema_version,
 'organizationId',e.organization_id,'classId',e.class_id,'studentId',e.student_id,'activityId',e.activity_id,
 'occurredAt',app_private.signal_instant(e.occurred_at),'eligible',e.eligible,'infrastructureStatus',e.infrastructure_status)
 order by e.occurred_at,e.source,e.event_id),'[]'::jsonb)
 into events_value from app_private.student_activity_events(l.organization_id,l.class_id,l.student_id,ts) e
 where e.activity_id=l.activity_id or e.activity_id is null;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'organizationId',a.organization_id,'classId',a.class_id,'studentId',a.student_id,
 'activityId',a.activity_id,'assignmentId',a.activity_exercise_id,'mode','SUBMIT','confirmed',true,
 'submittedAt',app_private.signal_instant(a.submitted_at),'eventSequence',ev.event_sequence::text,'exerciseVersionId',a.exercise_version_id,
 'profile',case when ar.attempt_id is not null and ev.id is not null and ar.test_suite_hash=a.test_suite_hash and sr.test_suite_hash=a.test_suite_hash
  and ar.runner_version=sr.runner_version and ar.runner_version=a.technical_result->>'runnerVersion'
  and jsonb_array_length(visible.ids)=sr.visible_total then jsonb_build_object('testsVersion',a.test_suite_hash,
   'visibleTestIds',visible.ids,'runnerVersion',ar.runner_version,'resultSchemaVersion',ar.result_schema_version,'limits',sr.limits_snapshot) else null end,
 'technicalResult',a.technical_result) order by a.submitted_at,ev.event_sequence,a.id),'[]'::jsonb)
 into submissions_value from app.attempts a
 left join app_private.attempt_results ar on ar.attempt_id=a.id and ar.organization_id=a.organization_id
 left join app_private.submission_reservations sr on sr.id=a.execution_id and sr.organization_id=a.organization_id
 left join app_private.attempt_events ev on ev.attempt_id=a.id and ev.event_type='ATTEMPT_SUBMITTED' and ev.organization_id=a.organization_id
 left join lateral (select coalesce(jsonb_agg(t.test_id order by t.position),'[]'::jsonb) as ids
  from app_private.exercise_tests t where t.exercise_version_id=a.exercise_version_id and t.organization_id=a.organization_id and t.visibility='visible') visible on true
 where a.organization_id=l.organization_id and a.class_id=l.class_id and a.student_id=l.student_id and a.activity_id=l.activity_id
 and (l.assignment_id is null or a.activity_exercise_id=l.assignment_id) and a.submitted_at<=ts;
 select coalesce(array_agg(c.id order by c.occurred_at,c.id),'{}'::uuid[]) into changes
 from app_private.signal_input_changes c join app_private.signal_lane_clock_keys(l) k using(component,scope_key) where c.finalized_at is not null;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'occurredAt',app_private.signal_instant(c.occurred_at),'component',c.component,'sequence',c.change_sequence::text,
 'before',app_private.signal_activity_at(l,c.occurred_at,c.change_sequence-1),
 'after',app_private.signal_activity_at(l,c.occurred_at,c.change_sequence)) order by c.occurred_at,c.change_sequence),'[]'::jsonb)
 into availability_value from app_private.signal_input_changes c where c.id=any(changes)
 and c.component in ('PROFILE','MEMBERSHIP','ORGANIZATION','CLASS','ENROLLMENT','ACTIVITY')
 and c.source<>'activity_exercises' and c.occurred_at>=bootstrap and c.occurred_at<=ts;
 coverage_value:=app_private.signal_coverage_at(ts,ts,true);
 select coalesce(jsonb_agg(jsonb_build_object('at',app_private.signal_instant(at),
  'coverage',app_private.signal_coverage_at(at,ts,false)) order by at),'[]'::jsonb)
 into history_value from (select bootstrap as at union select starts_at from app_private.signal_coverage_epochs where starts_at between bootstrap and ts
 union select ends_at from app_private.signal_coverage_epochs where ends_at between bootstrap and ts) boundaries;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'reviewedAt',app_private.signal_instant(r.reviewed_at),'episodeId',r.episode_id,
 'baseWitnessKeys',to_jsonb(r.base_witness_keys)) order by r.reviewed_at,r.id),'[]'::jsonb)
 into reviews_value from app_private.signal_reviews r where lane_id=lane;
 select coalesce(jsonb_agg(jsonb_build_object('identityKey',e.identity_key,'boundary',e.boundary,'result',e.result,'publicationAllowed',e.publication_allowed) order by e.evaluation_sequence),'[]'::jsonb),
 coalesce(jsonb_agg(e.semantic_key order by e.semantic_key),'[]'::jsonb)
 into prior_value,semantic_value from app_private.signal_evaluations e where lane_id=lane;
 select coalesce(jsonb_agg(w.witness_key order by w.witness_key),'[]'::jsonb) into witnesses_value from app_private.signal_witnesses w where lane_id=lane;
 envelope:=jsonb_build_object('schemaVersion',1,'lane',app_private.signal_lane_projection(l),'bootstrapAt',app_private.signal_instant(bootstrap),
 'checkpoint',jsonb_build_object('throughTime',app_private.signal_instant(j.through_time),'throughSubmissionSequence',j.through_submission_sequence::text,'pendingReconciliationBreak',j.pending_reconciliation_break is not null,'boundaryKey',j.boundary_key,'continuation',continuation_value),
 'activity',app_private.signal_activity_at(l,ts),'rules',rules_value,'coverage',coverage_value,'coverageHistory',history_value,
 'events',events_value,'submissions',submissions_value,'availabilityChanges',availability_value,'reviews',reviews_value,
 'processedWitnessKeys',witnesses_value,'priorEvaluations',prior_value,'knownSemanticKeys',semantic_value);
 -- Hash canonical input, but persist only immutable references and digests of
 -- technical results. No code, stdout/stderr, private tests or prompts copied.
 digest_value:=app_private.signal_digest(envelope-'checkpoint'-'priorEvaluations'-'knownSemanticKeys');
 select coalesce(jsonb_agg((s.value-'technicalResult')||jsonb_build_object('technicalResultDigest',app_private.signal_digest(s.value->'technicalResult')) order by s.ordinality),'[]'::jsonb)
 into refs from jsonb_array_elements(submissions_value) with ordinality s(value,ordinality);
 insert into app_private.signal_snapshots(id,lane_id,lease_token,captured_at,observed_through,revision,digest,clock_vector,input_references,change_ids)
 values(snapshot_uuid,lane,token,captured,ts,revision_value,digest_value,vector_value,
  (envelope-'submissions'-'priorEvaluations'-'knownSemanticKeys')||jsonb_build_object('submissions',refs),changes);
 return envelope||jsonb_build_object('snapshot',jsonb_build_object('id',snapshot_uuid,'revision',revision_value,'digest',digest_value,
 'observedThrough',app_private.signal_instant(ts),'capturedAt',app_private.signal_instant(captured)));
end $$;

create or replace function app_private.signal_capture_snapshot(lane uuid,token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform app_private.signal_worker_only();
 return app_private.signal_capture_snapshot_core(lane,token,false);
end $$;

-- Current enrollment is required for writes. Historical dashboard reads retain
-- their existing scope; neither archive nor prior enrollment confers review.
create function app_private.signal_review_allowed(l app_private.signal_lanes) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
 select l.id is not null and app_private.academic_teacher(l.class_id,true)
  and exists(select 1 from app_private.dashboard_roster(l.class_id) r where r.student_id=l.student_id)
$$;

create function app_private.signal_review_authorize(l app_private.signal_lanes) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if app_private.signal_review_allowed(l) is distinct from true then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 if exists(select 1 from app.classes c where c.id=l.class_id and c.archived_at is not null) then
  raise exception using errcode='P0001',message='RESOURCE_ARCHIVED';
 end if;
end $$;

-- Names are current display labels. Identity and reviewedAt are immutable; a
-- profile rename does not rewrite a review or require a historical name backfill.
create function app_private.signal_review_projection(ep app_private.signal_episodes,l app_private.signal_lanes) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('signalId',ep.id,'classId',l.class_id,'studentId',l.student_id,
  'state','REVIEWED','reviewedBy',ep.reviewed_by,'reviewedByName',p.display_name,
  'reviewedAt',app_private.signal_instant(ep.reviewed_at))
 from app.profiles p where p.id=ep.reviewed_by
$$;

-- Earlier operational audit policies allow the application to append events.
-- This new effective domain event is emitted exclusively by the review writer;
-- permissive older policies must not let the runtime forge or duplicate it.
create policy signal_review_audit_runtime on app.audit_events as restrictive for insert to alunza_app
 with check(action<>'SIGNAL_REVIEWED');
create unique index audit_signal_review_once on app.audit_events(entity_id)
 where action='SIGNAL_REVIEWED' and entity_type='SIGNAL';

create policy signal_review_audit_internal on app.audit_events for insert to alunza_identity
 with check(action='SIGNAL_REVIEWED' and entity_type='SIGNAL' and result='SUCCEEDED'
  and actor_id=app_private.actor_id()
  and exists(select 1 from app_private.signal_episodes ep
   join app_private.signal_lanes l on l.id=ep.lane_id
   where ep.id=entity_id and l.organization_id=audit_events.organization_id
    and ep.state='REVIEWED' and ep.reviewed_by=app_private.actor_id()
    and app_private.signal_review_allowed(l)
    and not exists(select 1 from app.classes c where c.id=l.class_id and c.archived_at is not null)));

create function app_private.signal_review(signal uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare ep app_private.signal_episodes; l app_private.signal_lanes; j app_private.signal_jobs;
 existing app_private.signal_reviews; snapshot_value jsonb; token uuid:=gen_random_uuid(); review_uuid uuid;
 witness_keys text[]; evaluation_ids uuid[]; ts timestamptz; request_uuid uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='P0001',message='INVALID_REQUEST';
 end if;
 -- Scope and account state are verified before locks, response or mutation. In
 -- particular a replay after revocation must not reveal the original reviewer.
 select lane.* into l from app_private.signal_episodes episode
  join app_private.signal_lanes lane on lane.id=episode.lane_id
  where episode.id=signal and app_private.signal_review_allowed(lane);
 perform app_private.signal_review_authorize(l);

 -- Runtime membership, enrollment, reassignment and archive writers already
 -- lock this organization exclusively in their guards. Do not lock their rows:
 -- a direct UPDATE obtains its tuple before that guard, reversing lock order.
 -- Shared organization locks allow reviews of independent lanes concurrently.
 perform o.id from app.organizations o where o.id=l.organization_id and o.archived_at is null for share;
 if not found then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 -- Profile state can change independently of organization governance. Lock
 -- both profiles in UUID order before acquiring the evidence-clock vector.
 perform p.id from app.profiles p where p.id in (app_private.actor_id(),l.student_id) order by p.id for share;
 perform app_private.signal_review_authorize(l);
 perform app_private.signal_lock_lane_clocks(l,true);
 select * into j from app_private.signal_jobs where lane_id=l.id for update;
 if not found then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 select * into ep from app_private.signal_episodes where id=signal and lane_id=l.id for update;
 if not found then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 -- Every wait is followed by a fresh READ COMMITTED permission check.
 perform app_private.signal_review_authorize(l);
 select * into existing from app_private.signal_reviews where episode_id=signal;
 if found then return app_private.signal_review_projection(ep,l); end if;
 if j.lease_until>clock_timestamp() then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS';
 end if;

 update app_private.signal_jobs set lease_token=token,lease_until=clock_timestamp()+interval '30 seconds' where lane_id=l.id;
 -- Unlike a worker snapshot, this review base is committed immediately and has
 -- no later finalize phase to detect a DDL/coverage change. Fence the complete
 -- source set first, then registry and live epochs, in the same order used by
 -- signal_finalize_batch. DDL takes source ACCESS EXCLUSIVE before updating
 -- registry/epochs; reversing this order would introduce a deadlock.
 lock table app.profiles,app.organizations,app.organization_memberships,app.classes,app.class_memberships,
  app.activities,app.activity_exercises,app.signal_rule_versions,app.executions,app.attempts,
  app_private.student_activity_observations,app_private.attempt_events,app_private.attempt_results,
  app_private.submission_reservations,app_private.help_events in access share mode;
 perform 1 from app_private.signal_capture_registry order by source for share;
 perform 1 from app_private.signal_coverage_epochs where ends_at is null order by source,id for share;
 snapshot_value:=app_private.signal_capture_snapshot_core(l.id,token,true);
 if snapshot_value is null then raise exception 'SIGNAL_REVIEW_SNAPSHOT_FAILED'; end if;
 ts:=(snapshot_value->'snapshot'->>'observedThrough')::timestamptz;
 select coalesce(array_agg(w.witness_key order by w.witness_key),'{}'::text[]) into witness_keys
  from app_private.signal_witnesses w where lane_id=l.id;
 select coalesce(array_agg(e.id order by e.evaluation_sequence),'{}'::uuid[]) into evaluation_ids
  from app_private.signal_evaluations e where lane_id=l.id;
 perform app_private.signal_review_authorize(l);
 insert into app_private.signal_reviews(episode_id,lane_id,reviewed_by,reviewed_at,snapshot_id,base_witness_keys,base_evaluation_ids,base_digest)
 values(signal,l.id,app_private.actor_id(),ts,(snapshot_value->'snapshot'->>'id')::uuid,witness_keys,evaluation_ids,
  app_private.signal_digest(jsonb_build_object('snapshot',snapshot_value->'snapshot','witnesses',witness_keys,'evaluations',evaluation_ids))) returning id into review_uuid;
 update app_private.signal_episodes set state='REVIEWED',reviewed_by=app_private.actor_id(),reviewed_at=ts,
  stopped_at=coalesce(stopped_at,ts),stop_reason=coalesce(stop_reason,'REVIEWED') where id=signal returning * into ep;
 update app_private.signal_jobs set lease_token=null,lease_until=null,boundary_key=null,available_at=ts where lane_id=l.id;
 perform app_private.signal_record_change('REVIEW',l.id::text,l.organization_id,'signal_reviews',review_uuid,ts,null,
  jsonb_build_object('episodeId',signal,'reviewedBy',ep.reviewed_by,'reviewedAt',app_private.signal_instant(ts)));
 perform app_private.signal_sync_projections(l.id);
 request_uuid:=nullif(current_setting('app.request_id',true),'')::uuid;
 insert into app.audit_events(organization_id,actor_id,action,entity_type,entity_id,result,correlation_id,safe_changes,request_id,occurred_at)
 values(l.organization_id,app_private.actor_id(),'SIGNAL_REVIEWED','SIGNAL',signal,'SUCCEEDED',coalesce(request_uuid,gen_random_uuid()),
  jsonb_build_object('state',jsonb_build_object('from','ACTIVE','to','REVIEWED')),request_uuid,ts);
 perform app_private.signal_review_authorize(l);
 return app_private.signal_review_projection(ep,l);
end $$;

create or replace function app_private.dashboard_signal_projection(ep app_private.signal_episodes,cut timestamptz) returns jsonb
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
  'reviewedByName',case when is_reviewed then (select p.display_name from app.profiles p where p.id=ep.reviewed_by) else null end,
  'stoppedAt',case when ep.stopped_at<=cut then app_private.signal_instant(ep.stopped_at) else null end,'stopReason',case when ep.stopped_at<=cut then ep.stop_reason else null end,
  'previousEpisodeId',ep.previous_episode_id,'lastEvaluation',case when latest.id is null then null else jsonb_build_object('id',latest.id,
   'evaluationTime',app_private.signal_instant(latest.evaluation_time),'calculatedAt',app_private.signal_instant(latest.calculated_at),'outcome',latest.outcome,'reason',latest.result->>'reason') end,
  'verification',case when valid then 'VERIFIABLE' else 'UNVERIFIABLE' end);
end $$;

-- Only the authorizing public operation and existing worker wrapper receive a
-- runtime grant. Neither the capture kernel nor the TEST fixture is exposed.
do $$ declare fn regprocedure; name text; begin
 for fn,name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app_private' and p.proname in ('signal_capture_snapshot_core','signal_capture_snapshot',
  'signal_review_allowed','signal_review_authorize','signal_review_projection','signal_review','dashboard_signal_projection') loop
  execute format('alter function %s owner to alunza_identity',fn);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',fn);
  execute format('grant execute on function %s to alunza_identity',fn);
  if name in ('signal_review','signal_capture_snapshot') then
   execute format('grant execute on function %s to alunza_app',fn);
  end if;
 end loop;
end $$;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
