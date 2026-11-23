-- IMP-06.03. Current teacher/class/student read-only projections.
-- No backfill, general pedagogical grants, student impersonation or new facts.
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;

create function app_private.student_detail_context(cls uuid,student uuid,options jsonb) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare ctx jsonb;
begin
 ctx:=app_private.dashboard_context(cls,options,false);
 if student is null or not exists(select 1 from app_private.dashboard_roster(cls) r where r.student_id=student) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 return ctx||jsonb_build_object('studentId',student,'observedAt',app_private.signal_instant(statement_timestamp()));
end $$;


create function app_private.student_detail_envelope(ctx jsonb) returns jsonb
language sql immutable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('classId',ctx->'classId','studentId',ctx->'studentId','asOf',ctx->'asOf','observedAt',ctx->'observedAt')
$$;

create function app_private.student_detail_progress(cls uuid,student uuid,options jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ctx jsonb; cut timestamptz; start_at timestamptz; activity uuid; concept uuid; attempts jsonb; events jsonb;
 last_at timestamptz; evidence jsonb; progress jsonb; identity_value jsonb;
begin
 perform app_private.dashboard_options(options,array['activityId','conceptId','from','asOf','cursor','limit']);
 ctx:=app_private.student_detail_context(cls,student,options); cut:=(ctx->>'asOf')::timestamptz; start_at:=(ctx->>'from')::timestamptz;
 activity:=(ctx->>'activityId')::uuid; concept:=(ctx->>'conceptId')::uuid;
 select coalesce(jsonb_agg(app_private.dashboard_attempt_projection(a)),'[]'::jsonb) into attempts
 from app_private.dashboard_attempts(cls,student,activity,concept,cut,start_at) a;
 select coalesce(jsonb_agg(e.payload) filter(where start_at is null or e.occurred_at>=start_at),'[]'::jsonb),max(e.occurred_at) into events,last_at
 from app_private.dashboard_events(cls,student,activity,concept,cut,null) e;
 evidence:=app_private.dashboard_evidence_body(cls,options||jsonb_build_object('asOf',ctx->>'asOf','kind','ATTEMPT','studentId',student),false);
 progress:=app_private.progress_payload(cls,student,activity,concept,cut)||jsonb_build_object('observation',jsonb_build_object(
  'from',app_private.signal_instant(start_at),'observedAt',ctx->>'observedAt','lastActivityAt',app_private.signal_instant(last_at),
  'summary',app_private.dashboard_observation_summary(attempts,events),
  'attempts',coalesce((select jsonb_agg(item->'attempt' order by ord) from jsonb_array_elements(evidence->'data') with ordinality items(item,ord)),'[]'::jsonb),'page',evidence->'page'));
 select jsonb_build_object('organizationId',c.organization_id,'className',c.name,'studentName',r.student_name,
  'enrolledAt',app_private.signal_instant(r.enrolled_at),'roster','CURRENT_ACTIVE') into identity_value
 from app.classes c cross join app_private.dashboard_roster(cls) r where c.id=cls and r.student_id=student;
 return app_private.student_detail_envelope(ctx)||identity_value||jsonb_build_object('progress',progress);
end $$;

create function app_private.student_detail_evidence(cls uuid,student uuid,options jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ctx jsonb;
begin
 perform app_private.dashboard_options(options,array['activityId','conceptId','from','asOf','cursor','limit','kind','diagnosisCode']);
 ctx:=app_private.student_detail_context(cls,student,options);
 return app_private.dashboard_evidence_body(cls,options||jsonb_build_object('asOf',ctx->>'asOf','studentId',student),false);
end $$;

-- Call only after student_detail_context; this kernel is not granted to runtime.
create function app_private.student_detail_attempt_row(cls uuid,student uuid,attempt uuid,cut timestamptz) returns app.attempts
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare result_value app.attempts;
begin
 select a.* into result_value from app_private.dashboard_attempts(cls,student,null,null,cut,null) a where a.id=attempt;
 if result_value.id is null then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 return result_value;
end $$;

create function app_private.student_detail_attempt(cls uuid,student uuid,attempt uuid,options jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ctx jsonb; a app.attempts; exercise jsonb;
begin
 perform app_private.dashboard_options(options,array['asOf']);
 ctx:=app_private.student_detail_context(cls,student,options);
 a:=app_private.student_detail_attempt_row(cls,student,attempt,(ctx->>'asOf')::timestamptz);
 select jsonb_build_object('organizationId',a.organization_id,'classId',cls,'activityId',a.activity_id,'activityExerciseId',a.activity_exercise_id,
  'exerciseVersionId',v.id,'activityState',act.state,'title',v.title,'statement',v.statement,'starterCode',v.starter_code,'difficulty',v.difficulty,
  'concepts',coalesce((select jsonb_agg(jsonb_build_object('id',cv.concept_id,'versionId',cv.id,'name',cv.name,'description',cv.description) order by cv.concept_id,cv.id)
   from app.exercise_version_concepts link join app.concept_versions cv on cv.organization_id=link.organization_id and cv.id=link.concept_version_id
   where link.organization_id=a.organization_id and link.exercise_version_id=v.id),'[]'::jsonb),
  'tests',coalesce((select jsonb_agg(jsonb_build_object('id',t.test_id,'visibility','visible','args',t.args,'expected',t.expected) order by t.position)
   from app_private.exercise_tests t where t.organization_id=a.organization_id and t.exercise_version_id=v.id and t.visibility='visible'),'[]'::jsonb)) into exercise
 from app.exercise_versions v join app.activities act on act.id=a.activity_id and act.organization_id=a.organization_id
 where v.id=a.exercise_version_id and v.organization_id=a.organization_id;
 return app_private.student_detail_envelope(ctx)||jsonb_build_object('attempt',app_private.attempt_payload(a),'exercise',exercise);
end $$;

-- A confirmed delivery event is the authority, not presented_at/viewed_at alone.
-- Revoked content keeps its original status and dates but returns no text/cites.
create function app_private.student_detail_feedback_value(feedback uuid,cut timestamptz,include_content boolean default false) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare f app.feedbacks; r app.feedback_requests; delivered timestamptz; available_value boolean; result_value jsonb; help_value jsonb;
begin
 select value.* into f from app.feedbacks value where value.id=feedback and value.created_at<=cut;
 select value.* into r from app.feedback_requests value where value.id=f.request_id;
 select e.occurred_at into delivered from app_private.help_events e
 where e.organization_id=f.organization_id and e.attempt_id=f.attempt_id and e.request_id=f.request_id and e.feedback_id=f.id
  and e.event_type=case when r.kind='HINT' then 'HINT_DELIVERED' else 'FEEDBACK_VIEWED' end
  and e.occurred_at<=cut and e.occurred_at>=f.created_at order by e.occurred_at,e.id limit 1;
 if delivered is null then return null; end if;
 available_value:=f.suppressed_at is null and coalesce(app_private.help_scope_valid(r.id),false);
 result_value:=jsonb_build_object('id',f.id,'attemptId',f.attempt_id,'kind',r.kind,'hintLevel',r.hint_level,'status',f.rag_status,
  'createdAt',app_private.signal_instant(f.created_at),'deliveredAt',app_private.signal_instant(delivered),'available',available_value);
 if include_content then
  if available_value then
   select jsonb_build_object('diagnosis_code',f.diagnosis_code,'explanation',f.explanation,'hint',f.hint,'status',f.rag_status,
    'source_refs',coalesce(jsonb_agg(jsonb_build_object('source_id',x.source_id,'source_version_id',x.source_version_id,'chunk_id',x.chunk_id,'locator',x.locator) order by x.position)
    filter(where x.chunk_id is not null),'[]'::jsonb)) into help_value from app.feedback_source_refs x where x.feedback_id=f.id;
  end if;
  result_value:=result_value||jsonb_build_object('help',help_value);
 end if;
 return result_value;
end $$;

create function app_private.student_detail_feedback_history(cls uuid,student uuid,attempt uuid,options jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ctx jsonb; a app.attempts; n integer; signature text; cursor_key jsonb; entries jsonb; more boolean; next_key jsonb; valid_cursor boolean;
begin
 perform app_private.dashboard_options(options,array['asOf','cursor','limit']);
 ctx:=app_private.student_detail_context(cls,student,options);
 a:=app_private.student_detail_attempt_row(cls,student,attempt,(ctx->>'asOf')::timestamptz);
 n:=coalesce((options->>'limit')::integer,20);
 if n not between 1 and 20 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 signature:=app_private.signal_digest((ctx-'observedAt')||jsonb_build_object('actor',app_private.actor_id(),'reader','student-feedback','attemptId',attempt));
 cursor_key:=app_private.dashboard_cursor(options,signature);
 with values_at_cut as materialized(
  select f.id,app_private.student_detail_feedback_value(f.id,(ctx->>'asOf')::timestamptz,false) as payload
  from app.feedbacks f where f.organization_id=a.organization_id and f.attempt_id=a.id
 ), items as materialized(select id,(payload->>'deliveredAt')::timestamptz as at,payload from values_at_cut where payload is not null),
 cursor_item as(select * from items where id=(cursor_key->>'id')::uuid and at=(cursor_key->>'at')::timestamptz),
 sliced as materialized(select * from items where cursor_key is null or (at,id)<(select at,id from cursor_item) order by at desc,id desc limit n+1),
 page_items as materialized(select * from sliced order by at desc,id desc limit n)
 select coalesce((select jsonb_agg(payload order by at desc,id desc) from page_items),'[]'::jsonb),(select count(*)>n from sliced),
  (select jsonb_build_object('id',id,'at',app_private.signal_instant(at)) from page_items order by at,id limit 1),cursor_key is null or exists(select 1 from cursor_item)
 into entries,more,next_key,valid_cursor;
 if not valid_cursor then raise exception using errcode='P0001',message='DASHBOARD_CURSOR_INVALID'; end if;
 return app_private.student_detail_envelope(ctx)||jsonb_build_object('attemptId',attempt,'items',entries,
  'page',jsonb_build_object('hasMore',more,'nextCursor',case when more then app_private.dashboard_next_cursor(signature,next_key) else null end));
end $$;

create function app_private.student_detail_feedback(cls uuid,student uuid,feedback uuid,options jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ctx jsonb; attempt uuid; value jsonb;
begin
 perform app_private.dashboard_options(options,array['asOf']);
 ctx:=app_private.student_detail_context(cls,student,options);
 select f.attempt_id into attempt from app.feedbacks f join app.attempts a on a.id=f.attempt_id and a.organization_id=f.organization_id
 where f.id=feedback and a.organization_id=(ctx->>'organizationId')::uuid and a.class_id=cls and a.student_id=student;
 perform app_private.student_detail_attempt_row(cls,student,attempt,(ctx->>'asOf')::timestamptz);
 value:=app_private.student_detail_feedback_value(feedback,(ctx->>'asOf')::timestamptz,true);
 if value is null then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 return app_private.student_detail_envelope(ctx)||jsonb_build_object('feedback',value);
end $$;

create function app_private.student_detail_reference(cls uuid,student uuid,feedback uuid,chunk uuid,options jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare value jsonb; reference_value jsonb;
begin
 value:=app_private.student_detail_feedback(cls,student,feedback,options);
 if (value#>>'{feedback,available}')::boolean is distinct from true then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 select jsonb_build_object('sourceId',s.id,'versionId',v.id,'chunkId',c.id,'title',s.title,'version',v.version,
  'fileName',v.original_name,'format',v.format,'locator',x.locator,'text',c.text,
  'storageKey',v.storage_object_key,'mimeType',v.mime_type,'sizeBytes',v.size_bytes,'sha256',v.content_hash)
 into reference_value from app.feedback_source_refs x
 join app.sources s on s.id=x.source_id and s.organization_id=x.organization_id
 join app.source_versions v on v.id=x.source_version_id and v.organization_id=x.organization_id and v.source_id=s.id
 join app.source_chunks c on c.id=x.chunk_id and c.organization_id=x.organization_id and c.source_id=s.id and c.source_version_id=v.id
 where x.feedback_id=feedback and x.chunk_id=chunk and s.class_id=cls;
 if reference_value is null then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 return (value-'feedback')||jsonb_build_object('feedbackId',feedback,'reference',reference_value);
end $$;

-- Share the existing set-based freshness and signal-list kernels. NULL student
-- preserves the class-wide wrappers, cursor context and public DTOs exactly.
create function app_private.dashboard_processing_scoped(cls uuid,student uuid,activity uuid,concept uuid,cut timestamptz) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 with roster as materialized(select * from app_private.dashboard_roster(cls) where student is null or student_id=student),
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

create function app_private.dashboard_signals_scoped(class uuid,student uuid,options jsonb) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare ctx jsonb; activity uuid; concept uuid; cut timestamptz; kind text:=options->>'type'; state_value text:=coalesce(options->>'state','ACTIVE');
 signature text; cursor_key jsonb; n integer; entries jsonb; more boolean; next_key jsonb; valid_cursor boolean;
begin
 perform app_private.dashboard_options(options,array['activityId','conceptId','asOf','cursor','limit','type','state']);
 ctx:=app_private.dashboard_context(class,options,false); activity:=(ctx->>'activityId')::uuid; concept:=(ctx->>'conceptId')::uuid; cut:=(ctx->>'asOf')::timestamptz;
 if (kind is not null and kind not in ('INACTIVITY','REPEATED_ERROR','STAGNATION')) or state_value not in ('ACTIVE','REVIEWED','ALL') then raise exception using errcode='P0001',message='DASHBOARD_FILTER_INVALID'; end if;
 n:=app_private.dashboard_limit(options);
 signature:=app_private.signal_digest(ctx||jsonb_build_object('actor',app_private.actor_id(),'reader','signals','type',kind,'state',state_value)||case when student is null then '{}'::jsonb else jsonb_build_object('studentId',student) end);
 cursor_key:=app_private.dashboard_cursor(options,signature);
 with items as materialized(
  select ep.id,ep.qualified_at as at,app_private.dashboard_signal_projection(ep,cut) as payload
  from app_private.dashboard_signal_rows(class,activity,concept,cut) ep join app_private.signal_lanes l on l.id=ep.lane_id
  where (student is null or l.student_id=student) and (kind is null or l.type=kind) and (state_value='ALL' or state_value=case when ep.reviewed_at<=cut then 'REVIEWED' else 'ACTIVE' end)
 ), cursor_item as(select * from items where id=(cursor_key->>'id')::uuid and at=(cursor_key->>'at')::timestamptz),
 sliced as materialized(select * from items where cursor_key is null or (at,id)<(select at,id from cursor_item) order by at desc,id desc limit n+1),
 page_items as materialized(select * from sliced order by at desc,id desc limit n)
 select coalesce((select jsonb_agg(payload order by at desc,id desc) from page_items),'[]'::jsonb),(select count(*)>n from sliced),
  (select jsonb_build_object('id',id,'at',app_private.signal_instant(at)) from page_items order by at,id limit 1),cursor_key is null or exists(select 1 from cursor_item)
 into entries,more,next_key,valid_cursor;
 if not valid_cursor then raise exception using errcode='P0001',message='DASHBOARD_CURSOR_INVALID'; end if;
 return jsonb_build_object('classId',class,'asOf',ctx->>'asOf','observedAt',app_private.signal_instant(statement_timestamp()),
  'filters',jsonb_build_object('activityId',activity,'conceptId',concept,'type',kind,'state',state_value),
  'processing',app_private.dashboard_processing_scoped(class,student,activity,concept,cut),'data',entries,
  'page',jsonb_build_object('hasMore',more,'nextCursor',case when more then app_private.dashboard_next_cursor(signature,next_key) else null end));
end $$;

create or replace function app_private.dashboard_processing(cls uuid,activity uuid,concept uuid,cut timestamptz) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 select app_private.dashboard_processing_scoped(cls,null,activity,concept,cut)
$$;

create or replace function app_private.dashboard_signals(class uuid,options jsonb) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.dashboard_signals_scoped(class,null,options)
$$;

create function app_private.student_detail_signals(cls uuid,student uuid,options jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ctx jsonb;
begin
 perform app_private.dashboard_options(options,array['activityId','conceptId','asOf','cursor','limit','type','state']);
 ctx:=app_private.student_detail_context(cls,student,options);
 return app_private.dashboard_signals_scoped(cls,student,options||jsonb_build_object('asOf',ctx->>'asOf'))||jsonb_build_object('studentId',student);
end $$;

create function app_private.student_detail_signal(cls uuid,student uuid,signal uuid,options jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ctx jsonb;
begin
 perform app_private.dashboard_options(options,array['asOf']);
 ctx:=app_private.student_detail_context(cls,student,options);
 if not exists(select 1 from app_private.signal_episodes ep join app_private.signal_lanes l on l.id=ep.lane_id
  where ep.id=signal and l.class_id=cls and l.student_id=student and l.organization_id=(ctx->>'organizationId')::uuid
  and ep.qualified_at<=(ctx->>'asOf')::timestamptz) then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 return app_private.dashboard_signal(cls,signal,options||jsonb_build_object('asOf',ctx->>'asOf'))||jsonb_build_object('studentId',student);
end $$;

-- Private functions execute with the existing constrained NOLOGIN/NOBYPASSRLS
-- owner. Only the eight authorizing entrypoints are callable by the API role.
do $$ declare fn regprocedure; name text; begin
 for fn,name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app_private' and (p.proname like 'student_detail_%'
  or p.proname in ('dashboard_processing_scoped','dashboard_signals_scoped','dashboard_processing','dashboard_signals')) loop
  execute format('alter function %s owner to alunza_identity',fn);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',fn);
  execute format('grant execute on function %s to alunza_identity',fn);
  if name in ('student_detail_progress','student_detail_evidence','student_detail_attempt','student_detail_feedback_history',
   'student_detail_feedback','student_detail_reference','student_detail_signals','student_detail_signal','dashboard_signals') then
   execute format('grant execute on function %s to alunza_app',fn);
  end if;
 end loop;
end $$;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
