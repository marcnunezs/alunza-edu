-- IMP-05.05. Private, durable signal processing. No browser/domain endpoint.
-- Producer facts remain canonical. Clocks are published only in the terminal
-- deferred phase; readers lock clocks, never source rows.

create table app_private.signal_runtime (
 singleton boolean primary key default true check(singleton),
 bootstrap_at timestamptz not null default clock_timestamp(),
 schema_version integer not null default 1 check(schema_version=1)
);
create table app_private.signal_evidence_clocks (
 component text not null, scope_key text not null,
 epoch uuid not null default gen_random_uuid(), revision bigint not null default 0 check(revision>=0),
 primary key(component,scope_key)
);
create table app_private.signal_input_changes (
 id uuid primary key default gen_random_uuid(),
 change_sequence bigint generated always as identity unique,
 producer_transaction xid8 not null default pg_current_xact_id(),
 component text not null, scope_key text not null,
 organization_id uuid, source text not null, source_id uuid not null,
 occurred_at timestamptz not null, before_value jsonb, after_value jsonb,
 finalized_revision bigint, finalized_at timestamptz,
 check((finalized_revision is null)=(finalized_at is null))
);
-- Both terminal guards and the deferred flush search the current transaction.
-- Keep this immutable key indexed for finalized and pending rows alike.
create index signal_changes_transaction on app_private.signal_input_changes(producer_transaction);
create index signal_changes_scope on app_private.signal_input_changes(component,scope_key,occurred_at,id);
create table app_private.signal_coverage_epochs (
 id uuid primary key default gen_random_uuid(),
 source text not null check(source in ('ACTIVITY_OPEN','RUN','ATTEMPT','HELP')),
 starts_at timestamptz not null, ends_at timestamptz, verified_through timestamptz not null,
 capture_version text not null, definition_hash text not null check(definition_hash ~ '^[a-f0-9]{64}$'),
 reason text, check(ends_at is null or ends_at>=starts_at)
);
create unique index signal_coverage_current on app_private.signal_coverage_epochs(source) where ends_at is null;
create table app_private.signal_capture_registry (
 source text primary key check(source in ('ACTIVITY_OPEN','RUN','ATTEMPT','HELP')),
 expected_definition_hash text not null check(expected_definition_hash ~ '^[a-f0-9]{64}$')
);
alter table app.activity_exercises add constraint signal_assignment_scope unique(organization_id,activity_id,id);

create table app_private.signal_lanes (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null, class_id uuid not null, student_id uuid not null,
 activity_id uuid not null, assignment_id uuid,
 type text not null check(type in ('INACTIVITY','REPEATED_ERROR','STAGNATION')),
 created_at timestamptz not null default clock_timestamp(),
 unique nulls not distinct(organization_id,class_id,student_id,activity_id,type,assignment_id),
 foreign key(organization_id,class_id) references app.classes(organization_id,id),
 foreign key(organization_id,activity_id) references app.activities(organization_id,id),
 foreign key(organization_id,class_id,activity_id) references app.activities(organization_id,class_id,id),
 foreign key(organization_id,student_id) references app.organization_memberships(organization_id,user_id),
 foreign key(organization_id,class_id,student_id) references app.class_memberships(organization_id,class_id,user_id),
 foreign key(organization_id,assignment_id) references app.activity_exercises(organization_id,id),
 foreign key(organization_id,activity_id,assignment_id) references app.activity_exercises(organization_id,activity_id,id),
 check((type='INACTIVITY')=(assignment_id is null))
);
create table app_private.signal_jobs (
 lane_id uuid primary key references app_private.signal_lanes(id),
 lease_token uuid, lease_until timestamptz, attempts integer not null default 0 check(attempts>=0),
 available_at timestamptz not null default clock_timestamp(),
 next_deadline_micros numeric(30,0), through_time timestamptz, through_submission_sequence bigint, boundary_key text,
 continuation jsonb, pending_reconciliation_break jsonb,
 last_revision text, last_error_code text, failed_at timestamptz,
 check((lease_token is null)=(lease_until is null))
);
create table app_private.signal_snapshots (
 id uuid primary key default gen_random_uuid(), lane_id uuid not null references app_private.signal_lanes(id),
 lease_token uuid not null, captured_at timestamptz not null, observed_through timestamptz not null,
 revision text not null, digest text not null check(digest ~ '^[a-f0-9]{64}$'),
 clock_vector jsonb not null, input_references jsonb not null,
 change_ids uuid[] not null default '{}', unique(lane_id,id)
);
create index signal_snapshots_lane on app_private.signal_snapshots(lane_id,captured_at,id);
create table app_private.signal_evaluations (
 id uuid primary key default gen_random_uuid(), lane_id uuid not null references app_private.signal_lanes(id),
 evaluation_sequence bigint generated always as identity unique,
 snapshot_id uuid not null references app_private.signal_snapshots(id),
 identity_key text not null check(identity_key ~ '^[a-f0-9]{64}$'),
 semantic_key text not null check(semantic_key ~ '^[a-f0-9]{64}$'),
 witness_key text check(witness_key ~ '^[a-f0-9]{64}$'),
 boundary jsonb not null, evaluation_time timestamptz not null,
 outcome text not null check(outcome in ('MATCH','NO_MATCH','NOT_EVALUABLE','NOT_VERIFIABLE')),
 result jsonb not null, calculated_at timestamptz not null default clock_timestamp(),
 publication_allowed boolean not null, reconciliation_of uuid references app_private.signal_evaluations(id),
 unique(lane_id,identity_key), unique(lane_id,id),
 foreign key(lane_id,snapshot_id) references app_private.signal_snapshots(lane_id,id),
 foreign key(lane_id,reconciliation_of) references app_private.signal_evaluations(lane_id,id)
);
create index signal_evaluations_history on app_private.signal_evaluations(lane_id,evaluation_time,id);
create table app_private.signal_episodes (
 id uuid primary key default gen_random_uuid(), lane_id uuid not null references app_private.signal_lanes(id),
 rule_version_id uuid not null references app.signal_rule_versions(id),
 first_witness_key text not null, first_evaluation_id uuid not null references app_private.signal_evaluations(id),
 initial_cause text not null, initial_evidence jsonb not null,
 qualified_at timestamptz not null, calculated_at timestamptz not null default clock_timestamp(),
 state text not null default 'ACTIVE' check(state in ('ACTIVE','REVIEWED')),
 previous_episode_id uuid references app_private.signal_episodes(id),
 stopped_at timestamptz, stop_reason text,
 reviewed_by uuid references app.profiles(id), reviewed_at timestamptz,
 unique(lane_id,rule_version_id,first_witness_key), unique(lane_id,id),
 foreign key(lane_id,first_evaluation_id) references app_private.signal_evaluations(lane_id,id),
 foreign key(lane_id,previous_episode_id) references app_private.signal_episodes(lane_id,id),
 check((stopped_at is null)=(stop_reason is null)),
 check((state='REVIEWED')=(reviewed_at is not null and reviewed_by is not null)),
 check(previous_episode_id is null or previous_episode_id<>id)
);
create unique index signal_episode_accumulating on app_private.signal_episodes(lane_id) where stopped_at is null and state='ACTIVE';
create table app_private.signal_witnesses (
 lane_id uuid not null references app_private.signal_lanes(id), witness_key text not null,
 rule_version_id uuid not null references app.signal_rule_versions(id),
 first_evaluation_id uuid not null references app_private.signal_evaluations(id),
 episode_id uuid references app_private.signal_episodes(id),
 primary key(lane_id,rule_version_id,witness_key),
 foreign key(lane_id,first_evaluation_id) references app_private.signal_evaluations(lane_id,id),
 foreign key(lane_id,episode_id) references app_private.signal_episodes(lane_id,id)
);
create table app_private.signal_episode_evaluations (
 episode_id uuid not null references app_private.signal_episodes(id), evaluation_id uuid not null references app_private.signal_evaluations(id),
 primary key(episode_id,evaluation_id)
);
create table app_private.signal_reviews (
 id uuid primary key default gen_random_uuid(), episode_id uuid not null unique references app_private.signal_episodes(id),
 lane_id uuid not null references app_private.signal_lanes(id),
 reviewed_by uuid not null references app.profiles(id), reviewed_at timestamptz not null,
 snapshot_id uuid not null references app_private.signal_snapshots(id),
 base_witness_keys text[] not null, base_evaluation_ids uuid[] not null,
 base_digest text not null check(base_digest ~ '^[a-f0-9]{64}$'),
 foreign key(lane_id,episode_id) references app_private.signal_episodes(lane_id,id),
 foreign key(lane_id,snapshot_id) references app_private.signal_snapshots(lane_id,id)
);
create table app_private.signal_change_acks (
 lane_id uuid not null references app_private.signal_lanes(id), change_id uuid not null references app_private.signal_input_changes(id),
 snapshot_id uuid not null references app_private.signal_snapshots(id),
 primary key(lane_id,change_id),
 foreign key(lane_id,snapshot_id) references app_private.signal_snapshots(lane_id,id)
);
create table app_private.signal_rebuild_receipts (
 id uuid primary key default gen_random_uuid(), lane_id uuid not null references app_private.signal_lanes(id),
 reconstructed_at timestamptz not null default clock_timestamp(),
 evaluation_count bigint not null, episode_count bigint not null, digest text not null
);
create table app_private.signal_finalize_receipts (
 lane_id uuid not null references app_private.signal_lanes(id),lease_token uuid not null,snapshot_id uuid not null references app_private.signal_snapshots(id),
 batch_digest text not null,result jsonb not null,checkpoint jsonb not null,control_state jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(lane_id,lease_token,snapshot_id),
 foreign key(lane_id,snapshot_id) references app_private.signal_snapshots(lane_id,id)
);
create table app_private.signal_projections (
 episode_id uuid primary key references app_private.signal_episodes(id),lane_id uuid not null references app_private.signal_lanes(id),
 payload jsonb not null,digest text not null check(digest ~ '^[a-f0-9]{64}$'),rebuilt_at timestamptz not null default clock_timestamp(),
 foreign key(lane_id,episode_id) references app_private.signal_episodes(lane_id,id)
);

do $$ declare relation text; begin
 foreach relation in array array['signal_runtime','signal_evidence_clocks','signal_input_changes','signal_coverage_epochs','signal_capture_registry',
 'signal_lanes','signal_jobs','signal_snapshots','signal_evaluations','signal_episodes','signal_witnesses',
 'signal_episode_evaluations','signal_reviews','signal_change_acks','signal_rebuild_receipts','signal_finalize_receipts','signal_projections'] loop
  execute format('alter table app_private.%I enable row level security',relation);
  execute format('alter table app_private.%I force row level security',relation);
  execute format('revoke all on app_private.%I from public,anon,authenticated,service_role,alunza_app',relation);
  execute format('grant select,insert,update on app_private.%I to alunza_identity',relation);
  execute format('create policy signals_internal on app_private.%I for all to alunza_identity using(true) with check(true)',relation);
 end loop;
end $$;

create function app_private.signal_worker_only() returns void
language plpgsql security invoker set search_path=pg_catalog as $$ begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
end $$;
create function app_private.signal_instant(value timestamptz) returns text
language sql immutable strict set search_path=pg_catalog as $$
 select to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
create function app_private.signal_digest(value jsonb) returns text
language sql immutable strict set search_path=pg_catalog as $$
 select encode(sha256(convert_to(value::text,'UTF8')),'hex')
$$;
create function app_private.signal_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$ begin
 raise exception using errcode='23514',message='SIGNAL_IMMUTABLE';
end $$;
do $$ declare relation text; begin
 foreach relation in array array['signal_snapshots','signal_evaluations','signal_witnesses','signal_episode_evaluations','signal_reviews','signal_change_acks','signal_rebuild_receipts','signal_finalize_receipts'] loop
  execute format('create trigger signal_immutable before update or delete on app_private.%I for each row execute function app_private.signal_immutable()',relation);
 end loop;
end $$;

create function app_private.signal_record_change(component_value text,key_value text,org uuid,source_value text,source_uuid uuid,
 at_value timestamptz,before_value jsonb,after_value jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$ begin
 if exists(select 1 from app_private.signal_input_changes where producer_transaction=pg_current_xact_id() and finalized_at is not null) then
  raise exception using errcode='23514',message='SIGNAL_DML_AFTER_FLUSH';
 end if;
 insert into app_private.signal_input_changes(component,scope_key,organization_id,source,source_id,occurred_at,before_value,after_value)
 values(component_value,key_value,org,source_value,source_uuid,at_value,before_value,after_value);
end $$;
create function app_private.signal_terminal_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$ begin
 if exists(select 1 from app_private.signal_input_changes where producer_transaction=pg_current_xact_id() and finalized_at is not null) then
  raise exception using errcode='23514',message='SIGNAL_DML_AFTER_FLUSH';
 end if;
 return null;
end $$;
-- An explicit SET CONSTRAINTS may flush early. Even irrelevant field updates
-- after that point must fail: publication is a terminal transaction phase.
do $$ declare relation record; begin
 for relation in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and n.nspname in ('app','app_private')
 and not (n.nspname='app_private' and c.relname=any(array[
 'signal_runtime','signal_evidence_clocks','signal_input_changes','signal_coverage_epochs','signal_capture_registry',
 'signal_lanes','signal_jobs','signal_snapshots','signal_evaluations','signal_episodes','signal_witnesses',
 'signal_episode_evaluations','signal_reviews','signal_change_acks','signal_rebuild_receipts','signal_finalize_receipts','signal_projections'])) loop
  execute format('create trigger signal_terminal_guard before insert or update or delete or truncate on %I.%I for each statement execute function app_private.signal_terminal_guard()',relation.nspname,relation.relname);
 end loop;
end $$;
create function app_private.signal_guard_change() returns trigger
language plpgsql set search_path=pg_catalog as $$ begin
 if tg_op='DELETE' or old.finalized_at is not null or new.finalized_at is null or new.finalized_revision is null
  or (to_jsonb(old)-array['finalized_at','finalized_revision']) is distinct from (to_jsonb(new)-array['finalized_at','finalized_revision']) then
  raise exception using errcode='23514',message='SIGNAL_CHANGE_IMMUTABLE';
 end if;
 return new;
end $$;
create trigger signal_change_guard before update or delete on app_private.signal_input_changes for each row execute function app_private.signal_guard_change();
create function app_private.signal_flush_changes() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare component_row record; next_revision bigint; finalized timestamptz;
begin
 if not exists(select 1 from app_private.signal_input_changes where producer_transaction=pg_current_xact_id() and finalized_at is null) then return null; end if;
 -- All domain DML precedes this terminal phase. Do not lock or mutate sources.
 for component_row in select distinct component,scope_key from app_private.signal_input_changes
  where producer_transaction=pg_current_xact_id() and finalized_at is null order by component,scope_key loop
  insert into app_private.signal_evidence_clocks(component,scope_key) values(component_row.component,component_row.scope_key) on conflict do nothing;
  perform 1 from app_private.signal_evidence_clocks where component=component_row.component and scope_key=component_row.scope_key for update;
 end loop;
 finalized:=clock_timestamp();
 for component_row in select distinct component,scope_key from app_private.signal_input_changes
  where producer_transaction=pg_current_xact_id() and finalized_at is null order by component,scope_key loop
  update app_private.signal_evidence_clocks set revision=revision+1 where component=component_row.component and scope_key=component_row.scope_key returning revision into next_revision;
  update app_private.signal_input_changes set finalized_revision=next_revision,finalized_at=finalized
   where producer_transaction=pg_current_xact_id() and finalized_at is null and component=component_row.component and scope_key=component_row.scope_key;
 end loop;
 return null;
end $$;
create constraint trigger signal_terminal_flush after insert on app_private.signal_input_changes
 deferrable initially deferred for each row execute function app_private.signal_flush_changes();

create function app_private.signal_capture_source_change() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare n jsonb:=to_jsonb(new); o jsonb:=case when tg_op='INSERT' then null else to_jsonb(old) end;
 org uuid; source_uuid uuid; component_value text; key_value text; at_value timestamptz:=clock_timestamp();
 before_value jsonb; after_value jsonb; fields text[]; attempt_row app.attempts;
begin
 source_uuid:=coalesce((n->>'id')::uuid,(n->>'user_id')::uuid);
 org:=(n->>'organization_id')::uuid;
 if tg_table_name in ('student_activity_observations','attempt_events','help_events') then
  if tg_op<>'INSERT' then return null; end if;
  if tg_table_name='help_events' then
   select * into attempt_row from app.attempts where id=(n->>'attempt_id')::uuid;
   key_value:=attempt_row.activity_id::text||':'||attempt_row.student_id::text;
  else key_value:=(n->>'activity_id')||':'||(n->>'student_id'); end if;
  perform app_private.signal_record_change('EVIDENCE',key_value,org,tg_table_name,source_uuid,(n->>'occurred_at')::timestamptz,null,
   jsonb_build_object('id',source_uuid,'eventType',n->>'event_type','attemptId',n->>'attempt_id'));
  return null;
 elsif tg_table_name='profiles' then component_value:='PROFILE'; key_value:=source_uuid::text; fields:=array['account_state'];
 elsif tg_table_name='organizations' then component_value:='ORGANIZATION'; key_value:=source_uuid::text; org:=source_uuid; fields:=array['archived_at'];
 elsif tg_table_name='organization_memberships' then component_value:='MEMBERSHIP'; key_value:=org::text||':'||(n->>'user_id'); fields:=array['role','state'];
 elsif tg_table_name='classes' then component_value:='CLASS'; key_value:=source_uuid::text; fields:=array['archived_at','teacher_id'];
 elsif tg_table_name='class_memberships' then component_value:='ENROLLMENT'; key_value:=(n->>'class_id')||':'||(n->>'user_id'); fields:=array['enrolled_at','ended_at'];
 elsif tg_table_name='activities' then component_value:='ACTIVITY'; key_value:=source_uuid::text; fields:=array['state','published_at','opens_at','closes_at','closed_at'];
 elsif tg_table_name='activity_exercises' then component_value:='ACTIVITY'; key_value:=n->>'activity_id'; fields:=array['exercise_version_id','required','position'];
 elsif tg_table_name='signal_rule_versions' then
  if n->>'valid_from' is null then return null; end if;
  component_value:='RULE'; key_value:=org::text||':'||(n->>'type'); fields:=array['valid_from','valid_to'];
  at_value:=coalesce((n->>'valid_to')::timestamptz,(n->>'valid_from')::timestamptz);
 else raise exception 'UNSUPPORTED_SIGNAL_SOURCE'; end if;
 select jsonb_object_agg(key,value) into after_value from jsonb_each(n) where key=any(fields);
 if o is not null then select jsonb_object_agg(key,value) into before_value from jsonb_each(o) where key=any(fields); end if;
 if before_value is not distinct from after_value then return null; end if;
 if tg_table_name='activities' then
  if n->>'closed_at' is not null and o->>'closed_at' is null then at_value:=(n->>'closed_at')::timestamptz;
  elsif n->>'published_at' is not null and o->>'published_at' is null then at_value:=(n->>'published_at')::timestamptz; end if;
 end if;
 if tg_table_name='class_memberships' then
  if tg_op='INSERT' then at_value:=(n->>'enrolled_at')::timestamptz;
  elsif n->>'ended_at' is not null and o->>'ended_at' is null then at_value:=(n->>'ended_at')::timestamptz; end if;
 end if;
 perform app_private.signal_record_change(component_value,key_value,org,tg_table_name,source_uuid,at_value,before_value,after_value);
 return null;
end $$;

create function app_private.signal_lane_projection(l app_private.signal_lanes) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('laneId',l.id,'type',l.type,'organizationId',l.organization_id,'classId',l.class_id,
 'studentId',l.student_id,'activityId',l.activity_id,'assignmentId',l.assignment_id)
$$;
create function app_private.signal_lane_clock_keys(l app_private.signal_lanes)
returns table(component text,scope_key text) language sql stable set search_path=pg_catalog as $$
 select * from (values ('PROFILE',l.student_id::text),('ORGANIZATION',l.organization_id::text),
 ('MEMBERSHIP',l.organization_id::text||':'||l.student_id::text),('CLASS',l.class_id::text),
 ('ENROLLMENT',l.class_id::text||':'||l.student_id::text),('ACTIVITY',l.activity_id::text),
 ('EVIDENCE',l.activity_id::text||':'||l.student_id::text),('RULE',l.organization_id::text||':'||l.type),
 ('REVIEW',l.id::text),('COVERAGE','ACTIVITY_OPEN'),('COVERAGE','RUN'),('COVERAGE','ATTEMPT'),('COVERAGE','HELP')) keys(component,scope_key)
 order by component,scope_key
$$;
create function app_private.signal_current_vector(l app_private.signal_lanes) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(value order by component,scope_key),'[]'::jsonb) from (
  select c.component,c.scope_key,jsonb_build_object('component',c.component,'key',c.scope_key,'epoch',c.epoch,'revision',c.revision::text) value
   from app_private.signal_evidence_clocks c join app_private.signal_lane_clock_keys(l) k using(component,scope_key)
  union all
  select 'COVERAGE_ATTESTATION',r.source,jsonb_build_object('component','COVERAGE_ATTESTATION','key',r.source,
   'epoch',e.id,'startsAt',app_private.signal_instant(e.starts_at),'endsAt',app_private.signal_instant(e.ends_at),'definition',r.expected_definition_hash)
   from app_private.signal_capture_registry r left join lateral(select * from app_private.signal_coverage_epochs x where x.source=r.source
    order by (x.ends_at is null) desc,x.starts_at desc,x.id desc limit 1) e on true
 ) entries
$$;
create function app_private.signal_lock_lane_clocks(l app_private.signal_lanes,review_exclusive boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare k record; result jsonb;
begin
 for k in select * from app_private.signal_lane_clock_keys(l) order by component,scope_key loop
  insert into app_private.signal_evidence_clocks(component,scope_key) values(k.component,k.scope_key) on conflict do nothing;
  if review_exclusive and k.component='REVIEW' then
   perform 1 from app_private.signal_evidence_clocks c where c.component=k.component and c.scope_key=k.scope_key for update;
  else
   perform 1 from app_private.signal_evidence_clocks c where c.component=k.component and c.scope_key=k.scope_key for share;
  end if;
 end loop;
 result:=app_private.signal_current_vector(l);
 return result;
end $$;
create function app_private.signal_discover_lanes() returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare added integer;
begin
 perform app_private.signal_worker_only();
 insert into app_private.signal_lanes(organization_id,class_id,student_id,activity_id,type,assignment_id)
 select a.organization_id,a.class_id,m.user_id,a.id,'INACTIVITY',null
 from app.activities a join app.class_memberships m on m.organization_id=a.organization_id and m.class_id=a.class_id
 where a.published_at is not null
 union all
 select a.organization_id,a.class_id,m.user_id,a.id,kind.type,ae.id
 from app.activities a join app.class_memberships m on m.organization_id=a.organization_id and m.class_id=a.class_id
 join app.activity_exercises ae on ae.activity_id=a.id and ae.organization_id=a.organization_id
 cross join (values('REPEATED_ERROR'),('STAGNATION')) kind(type)
 where a.published_at is not null
 on conflict do nothing;
 get diagnostics added=row_count;
 insert into app_private.signal_jobs(lane_id) select id from app_private.signal_lanes on conflict do nothing;
 return added;
end $$;
create function app_private.signal_claim_job(lane uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j app_private.signal_jobs; l app_private.signal_lanes; token uuid:=gen_random_uuid(); ts timestamptz:=clock_timestamp();
begin
 perform app_private.signal_worker_only();
 perform app_private.signal_discover_lanes();
 select jobs.* into j from app_private.signal_jobs jobs join app_private.signal_lanes lanes on lanes.id=jobs.lane_id
 where (lane is null or jobs.lane_id=lane) and jobs.failed_at is null and jobs.available_at<=ts
 and (jobs.lease_until is null or jobs.lease_until<=ts)
 and (jobs.through_time is null or jobs.boundary_key is null
  or jobs.last_revision is distinct from app_private.signal_digest(app_private.signal_current_vector(lanes))
  or jobs.next_deadline_micros<=floor(extract(epoch from ts)*1000000)
  or exists(select 1 from app_private.signal_input_changes change join app_private.signal_lane_clock_keys(lanes) k using(component,scope_key)
    where change.finalized_at is not null and not exists(select 1 from app_private.signal_change_acks ack where ack.lane_id=lanes.id and ack.change_id=change.id)))
 order by jobs.available_at,jobs.lane_id for update of jobs skip locked limit 1;
 if not found then return null; end if;
 -- Read the wall clock again after a contested lock, never renew an old lease.
 ts:=clock_timestamp();
 update app_private.signal_jobs set lease_token=token,lease_until=ts+interval '30 seconds' where lane_id=j.lane_id returning * into j;
 select * into l from app_private.signal_lanes where id=j.lane_id;
 return app_private.signal_lane_projection(l)||jsonb_build_object('leaseToken',token,'leaseUntil',app_private.signal_instant(j.lease_until));
end $$;
create function app_private.signal_renew_job(lane uuid,token uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare j app_private.signal_jobs;
begin
 perform app_private.signal_worker_only();
 select * into j from app_private.signal_jobs where lane_id=lane for update;
 if j.lease_token is distinct from token or token is null or j.lease_until<=clock_timestamp() then return false; end if;
 update app_private.signal_jobs set lease_until=clock_timestamp()+interval '30 seconds' where lane_id=lane;
 return true;
end $$;
create function app_private.signal_value_at(component_value text,key_value text,source_value text,current_value jsonb,cutoff timestamptz,sequence_limit bigint default 9223372036854775807) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select coalesce((select before_value from app_private.signal_input_changes
  where component=component_value and scope_key=key_value and source=source_value and finalized_at is not null
  and (occurred_at>cutoff or (occurred_at=cutoff and change_sequence>sequence_limit)) and before_value is not null order by occurred_at,change_sequence limit 1),current_value)
$$;
create function app_private.signal_activity_at(l app_private.signal_lanes,cutoff timestamptz,sequence_limit bigint default 9223372036854775807) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare a jsonb; c jsonb; o jsonb; p jsonb; m jsonb; e jsonb; state_value text;
begin
 select app_private.signal_value_at('ACTIVITY',l.activity_id::text,'activities',to_jsonb(x),cutoff,sequence_limit) into a from app.activities x where id=l.activity_id;
 select app_private.signal_value_at('CLASS',l.class_id::text,'classes',to_jsonb(x),cutoff,sequence_limit) into c from app.classes x where id=l.class_id;
 select app_private.signal_value_at('ORGANIZATION',l.organization_id::text,'organizations',to_jsonb(x),cutoff,sequence_limit) into o from app.organizations x where id=l.organization_id;
 select app_private.signal_value_at('PROFILE',l.student_id::text,'profiles',to_jsonb(x),cutoff,sequence_limit) into p from app.profiles x where id=l.student_id;
 select app_private.signal_value_at('MEMBERSHIP',l.organization_id::text||':'||l.student_id::text,'organization_memberships',to_jsonb(x),cutoff,sequence_limit)
 into m from app.organization_memberships x where organization_id=l.organization_id and user_id=l.student_id;
 select app_private.signal_value_at('ENROLLMENT',l.class_id::text||':'||l.student_id::text,'class_memberships',to_jsonb(x),cutoff,sequence_limit)
 into e from app.class_memberships x where organization_id=l.organization_id and class_id=l.class_id and user_id=l.student_id;
 state_value:=a->>'state';
 if state_value='CLOSED' and (a->>'closed_at')::timestamptz>cutoff then state_value:='PUBLISHED'; end if;
 if (a->>'published_at')::timestamptz>cutoff then state_value:='DRAFT'; end if;
 return jsonb_build_object('organizationId',l.organization_id,'classId',l.class_id,'studentId',l.student_id,'activityId',l.activity_id,
  'state',state_value,'scopeEnabled',o->>'archived_at' is null and c->>'archived_at' is null,
  'studentActive',coalesce(p->>'account_state'='ACTIVE' and m->>'state'='ACTIVE' and m->>'role'='STUDENT',false),
  'enrollmentActive',e is not null and (e->>'enrolled_at')::timestamptz<=cutoff and (e->>'ended_at' is null or (e->>'ended_at')::timestamptz>cutoff),
  'enrolledAt',app_private.signal_instant((e->>'enrolled_at')::timestamptz),
  'publishedAt',app_private.signal_instant((a->>'published_at')::timestamptz),
  'opensAt',app_private.signal_instant((a->>'opens_at')::timestamptz),
  'closesAt',app_private.signal_instant((a->>'closes_at')::timestamptz),
  'closedAt',app_private.signal_instant((a->>'closed_at')::timestamptz))
  ||case when l.assignment_id is null then '{}'::jsonb else jsonb_build_object('assignmentId',l.assignment_id) end;
end $$;
create function app_private.signal_capture_definition(source_value text) returns text
language plpgsql stable security definer set search_path=pg_catalog as $$
declare names text[]; definitions jsonb; triggers jsonb;
begin
 names:=case source_value
 when 'ACTIVITY_OPEN' then array['record_activity_open','guard_student_activity_observation']
 when 'RUN' then array['finish_practice_run','capture_completed_run_observation','guard_student_activity_observation']
 when 'ATTEMPT' then array['finish_practice_submit','guard_attempt_context','guard_attempt_event','guard_attempt_result']
 when 'HELP' then array['help_viewed'] else null end;
 if names is null then raise exception 'INVALID_SIGNAL_SOURCE'; end if;
 names:=names||array['signal_capture_source_change','signal_record_change','signal_flush_changes','signal_guard_change','signal_terminal_guard'];
 select jsonb_agg(pg_get_functiondef(p.oid) order by p.proname,p.oid::regprocedure::text) into definitions
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname=any(names);
 select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by c.relname,t.tgname)
 into triggers from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where not t.tgisinternal and n.nspname in ('app','app_private') and
 ((t.tgname='signal_source_capture' and c.relname in ('profiles','organizations','organization_memberships','classes','class_memberships','activities','activity_exercises','signal_rule_versions'))
 or (c.relname=case source_value when 'ACTIVITY_OPEN' then 'student_activity_observations' when 'RUN' then 'student_activity_observations'
 when 'ATTEMPT' then 'attempt_events' when 'HELP' then 'help_events' end and t.tgname='signal_source_capture')
 or (c.relname='signal_input_changes' and t.tgname='signal_terminal_flush')
 or (source_value='RUN' and c.relname='executions' and t.tgname='student_completed_run_observation'));
 return app_private.signal_digest(jsonb_build_object('functions',definitions,'triggers',triggers));
end $$;
create function app_private.signal_coverage_at(cutoff timestamptz,observed timestamptz,verify_current boolean default true) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare sources jsonb; epoch_value text; total integer; mismatched boolean;
begin
 select count(*),bool_or(verify_current and e.ends_at is null and e.definition_hash<>app_private.signal_capture_definition(e.source)),
  jsonb_agg(jsonb_build_object('source',e.source,'since',app_private.signal_instant(e.starts_at),
   'through',app_private.signal_instant(least(observed,coalesce(e.ends_at-interval '1 microsecond',observed))),
   'referenceId',e.id::text) order by e.source),
  app_private.signal_digest(jsonb_agg(e.id::text order by e.source))
 into total,mismatched,sources,epoch_value from app_private.signal_coverage_epochs e
 where e.starts_at<=cutoff and (e.ends_at is null or e.ends_at>cutoff);
 if total<>4 or mismatched then return jsonb_build_object('status','UNKNOWN','reason',case when mismatched then 'CAPTURER_CHANGED' else 'CAPTURE_COVERAGE_UNKNOWN' end); end if;
 return jsonb_build_object('status','CONTINUOUS','epoch',epoch_value,'restartReason',
  (select string_agg(distinct reason,'; ' order by reason) from app_private.signal_coverage_epochs where starts_at<=cutoff and (ends_at is null or ends_at>cutoff)),
  'sources',sources);
end $$;
create function app_private.signal_restart_coverage(source_value text,reason_value text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare ts timestamptz:=clock_timestamp(); eid uuid;
begin
 if source_value not in ('ACTIVITY_OPEN','RUN','ATTEMPT','HELP') or length(btrim(reason_value)) not between 1 and 200 then raise exception 'INVALID_COVERAGE_REQUEST'; end if;
 insert into app_private.signal_evidence_clocks(component,scope_key) values('COVERAGE',source_value) on conflict do nothing;
 perform 1 from app_private.signal_evidence_clocks where component='COVERAGE' and scope_key=source_value for update;
 ts:=clock_timestamp();
 update app_private.signal_coverage_epochs set ends_at=ts,reason=coalesce(reason,reason_value) where source=source_value and ends_at is null;
 if not exists(select 1 from app_private.signal_capture_registry where source=source_value and expected_definition_hash=app_private.signal_capture_definition(source_value)) then
  raise exception 'SIGNAL_CAPTURER_NOT_APPROVED';
 end if;
 insert into app_private.signal_coverage_epochs(source,starts_at,verified_through,capture_version,definition_hash,reason)
 values(source_value,ts,ts,'signals.capture.v1',app_private.signal_capture_definition(source_value),reason_value) returning id into eid;
 perform app_private.signal_record_change('COVERAGE',source_value,null,'signal_coverage_epochs',eid,ts,null,jsonb_build_object('epochId',eid,'reason',reason_value));
 return jsonb_build_object('epochId',eid,'startsAt',app_private.signal_instant(ts));
end $$;

create function app_private.signal_observe_coverage() returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare registry app_private.signal_capture_registry; epoch app_private.signal_coverage_epochs; ts timestamptz:=clock_timestamp(); valid boolean; changed boolean:=false;
begin
 for registry in select * from app_private.signal_capture_registry order by source loop
  insert into app_private.signal_evidence_clocks(component,scope_key) values('COVERAGE',registry.source) on conflict do nothing;
  perform 1 from app_private.signal_evidence_clocks where component='COVERAGE' and scope_key=registry.source for update;
 end loop;
 ts:=clock_timestamp();
 for registry in select * from app_private.signal_capture_registry order by source loop
  valid:=registry.expected_definition_hash=app_private.signal_capture_definition(registry.source);
  select * into epoch from app_private.signal_coverage_epochs where source=registry.source and ends_at is null;
  if epoch.id is not null and not valid then
   update app_private.signal_coverage_epochs set ends_at=greatest(starts_at,verified_through),reason='CAPTURER_CHANGED' where id=epoch.id;
   perform app_private.signal_record_change('COVERAGE',registry.source,null,'signal_coverage_epochs',epoch.id,epoch.verified_through,null,jsonb_build_object('reason','CAPTURER_CHANGED'));
   changed:=true;
  elsif epoch.id is null and valid then
   perform app_private.signal_restart_coverage(registry.source,'CAPTURE_RESTORED'); changed:=true;
  elsif valid then update app_private.signal_coverage_epochs set verified_through=greatest(verified_through,ts) where id=epoch.id;
  end if;
 end loop;
 return changed;
end $$;
create function app_private.signal_verify_capture() returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform app_private.signal_worker_only();
 return app_private.signal_observe_coverage();
end $$;
-- DDL has its own durable capture boundary. It must never wait for evidence
-- clocks while holding ACCESS EXCLUSIVE on a source table: ordinary capture
-- readers hold shared clocks before acquiring their SELECT relation locks.
-- Epoch identities are included directly in the input vector and wake jobs.
create function app_private.signal_ddl_coverage_change() returns event_trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare registry app_private.signal_capture_registry; epoch app_private.signal_coverage_epochs; valid boolean; ts timestamptz:=clock_timestamp();
begin
 if (select count(*) from app_private.signal_capture_registry)<>4 then return; end if;
 for registry in select * from app_private.signal_capture_registry order by source for update loop
  valid:=registry.expected_definition_hash=app_private.signal_capture_definition(registry.source);
  select * into epoch from app_private.signal_coverage_epochs where source=registry.source and ends_at is null for update;
  if epoch.id is not null and not valid then
   update app_private.signal_coverage_epochs set ends_at=greatest(starts_at,verified_through),reason='CAPTURER_CHANGED' where id=epoch.id;
  elsif epoch.id is null and valid then
   insert into app_private.signal_coverage_epochs(source,starts_at,verified_through,capture_version,definition_hash,reason)
    values(registry.source,ts,ts,'signals.capture.v1',registry.expected_definition_hash,'CAPTURE_RESTORED');
  end if;
 end loop;
end $$;
do $$ declare relation text; begin
 foreach relation in array array['profiles','organizations','organization_memberships','classes','class_memberships','activities','activity_exercises','signal_rule_versions'] loop
  execute format('create trigger signal_source_capture after insert or update on app.%I for each row execute function app_private.signal_capture_source_change()',relation);
 end loop;
 foreach relation in array array['student_activity_observations','attempt_events','help_events'] loop
  execute format('create trigger signal_source_capture after insert on app_private.%I for each row execute function app_private.signal_capture_source_change()',relation);
 end loop;
end $$;

create function app_private.signal_capture_snapshot(lane uuid,token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare l app_private.signal_lanes; j app_private.signal_jobs; vector_value jsonb; revision_value text; digest_value text;
 ts timestamptz; captured timestamptz; bootstrap timestamptz; snapshot_uuid uuid:=gen_random_uuid(); envelope jsonb; continuation_value jsonb;
 rules_value jsonb; events_value jsonb; submissions_value jsonb; availability_value jsonb; coverage_value jsonb;
 history_value jsonb; refs jsonb; changes uuid[]; reviews_value jsonb; prior_value jsonb; witnesses_value jsonb; semantic_value jsonb;
begin
 perform app_private.signal_worker_only();
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
 if continuation_value is not null and continuation_value->>'revision'=revision_value
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

create function app_private.signal_guard_episode() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare first_eval app_private.signal_evaluations; previous_sequence bigint; lane_value app_private.signal_lanes;
begin
 if tg_op='INSERT' then
  select * into lane_value from app_private.signal_lanes where id=new.lane_id;
  select * into first_eval from app_private.signal_evaluations where lane_id=new.lane_id and id=new.first_evaluation_id;
  if first_eval.id is null or first_eval.outcome<>'MATCH' or first_eval.witness_key is distinct from new.first_witness_key
   or first_eval.result->>'ruleVersionId' is distinct from new.rule_version_id::text
   or not exists(select 1 from app.signal_rule_versions v where v.id=new.rule_version_id and v.organization_id=lane_value.organization_id and v.type=lane_value.type) then
   raise exception using errcode='23514',message='SIGNAL_EPISODE_SCOPE';
  end if;
  if new.previous_episode_id is not null then
   select e.evaluation_sequence into previous_sequence from app_private.signal_episodes p join app_private.signal_evaluations e on e.id=p.first_evaluation_id
    where p.id=new.previous_episode_id and p.lane_id=new.lane_id;
   if previous_sequence is null or previous_sequence>=first_eval.evaluation_sequence then
    raise exception using errcode='23514',message='SIGNAL_EPISODE_CHAIN';
   end if;
  end if;
  return new;
 end if;
 if tg_op='DELETE' or (to_jsonb(old)-array['stopped_at','stop_reason','state','reviewed_by','reviewed_at']) is distinct from
  (to_jsonb(new)-array['stopped_at','stop_reason','state','reviewed_by','reviewed_at'])
  or (old.stopped_at is not null and row(new.stopped_at,new.stop_reason) is distinct from row(old.stopped_at,old.stop_reason))
  or (old.state='REVIEWED' and row(new.state,new.reviewed_by,new.reviewed_at) is distinct from row(old.state,old.reviewed_by,old.reviewed_at)) then
  raise exception using errcode='23514',message='SIGNAL_EPISODE_IMMUTABLE';
 end if;
 return new;
end $$;
create trigger signal_episode_guard before insert or update or delete on app_private.signal_episodes for each row execute function app_private.signal_guard_episode();

create function app_private.signal_guard_link() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare episode_lane uuid; evaluation_lane uuid;
begin
 select lane_id into episode_lane from app_private.signal_episodes where id=new.episode_id;
 select lane_id into evaluation_lane from app_private.signal_evaluations where id=new.evaluation_id;
 if episode_lane is null or episode_lane is distinct from evaluation_lane then
  raise exception using errcode='23514',message='SIGNAL_LINK_SCOPE';
 end if;
 return new;
end $$;
create trigger signal_episode_evaluation_scope before insert on app_private.signal_episode_evaluations for each row execute function app_private.signal_guard_link();

create function app_private.signal_finalize_batch(lane uuid,token uuid,snapshot uuid,evaluations jsonb,checkpoint jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare l app_private.signal_lanes; j app_private.signal_jobs; s app_private.signal_snapshots; vector_value jsonb;
 item jsonb; r jsonb; e app_private.signal_evaluations; active_episode app_private.signal_episodes; prior_episode uuid;
 inserted_evaluations integer:=0; inserted_signals integer:=0; episode_uuid uuid; rule_uuid uuid; at_value timestamptz;
 witness_value text; semantic_value text; identity_value text; current_activity jsonb; current_enabled boolean;
 reconcile_uuid uuid; prior_at timestamptz; next_micros numeric(30,0); checkpoint_time timestamptz; count_value integer; receipt app_private.signal_finalize_receipts; batch_hash text;
 reviewed_base jsonb; previous_rule uuid; initial_cause_value text; checkpoint_sequence bigint;
 pending_break jsonb; anchor_at timestamptz; anchor_sequence bigint; known_witness app_private.signal_witnesses;
begin
 perform app_private.signal_worker_only();
 batch_hash:=app_private.signal_digest(jsonb_build_object('evaluations',evaluations,'checkpoint',checkpoint));
 select * into receipt from app_private.signal_finalize_receipts where lane_id=lane and lease_token=token and snapshot_id=snapshot;
 if found then
  if receipt.batch_digest=batch_hash then return jsonb_build_object('status','REPLAY','evaluations',0,'signals',0); end if;
  return jsonb_build_object('status','LEASE_LOST','evaluations',0,'signals',0);
 end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'SIGNAL_READ_COMMITTED_REQUIRED'; end if;
 if jsonb_typeof(evaluations)<>'array' or jsonb_array_length(evaluations)>100 or jsonb_typeof(checkpoint)<>'object'
  or (checkpoint-array['throughTime','throughSubmissionSequence','boundaryKey','nextDeadlineMicros','hasMore','continuation'])<>'{}'::jsonb
  or jsonb_typeof(checkpoint->'hasMore')<>'boolean' then raise exception 'INVALID_SIGNAL_BATCH'; end if;
 checkpoint_time:=(checkpoint->>'throughTime')::timestamptz;
 if checkpoint_time is null or not isfinite(checkpoint_time) then raise exception 'INVALID_SIGNAL_CHECKPOINT'; end if;
 if checkpoint->>'throughSubmissionSequence' is not null then
  if checkpoint->>'throughSubmissionSequence' !~ '^[0-9]{1,19}$' then raise exception 'INVALID_SIGNAL_CHECKPOINT'; end if;
  checkpoint_sequence:=(checkpoint->>'throughSubmissionSequence')::bigint;
 end if;
 if checkpoint->>'nextDeadlineMicros' is not null then
  if (checkpoint->>'nextDeadlineMicros') !~ '^-?[0-9]{1,30}$' then raise exception 'INVALID_SIGNAL_DEADLINE'; end if;
  next_micros:=(checkpoint->>'nextDeadlineMicros')::numeric(30,0);
 end if;
 select * into l from app_private.signal_lanes where id=lane;
 if not found then return jsonb_build_object('status','LEASE_LOST','evaluations',0,'signals',0); end if;
 vector_value:=app_private.signal_lock_lane_clocks(l);
 select * into j from app_private.signal_jobs where lane_id=lane for update;
 if token is null or j.lease_token is distinct from token or j.lease_until<=clock_timestamp() then
  return jsonb_build_object('status','LEASE_LOST','evaluations',0,'signals',0);
 end if;
 pending_break:=j.pending_reconciliation_break;
 select * into s from app_private.signal_snapshots where id=snapshot and lane_id=lane and lease_token=token;
 if not found then raise exception 'SIGNAL_SNAPSHOT_MISMATCH'; end if;
 if s.clock_vector is distinct from vector_value then
  update app_private.signal_jobs set lease_token=null,lease_until=null,available_at=clock_timestamp(),boundary_key=null,continuation=null,last_error_code='REVISION_CHANGED' where lane_id=lane;
  return jsonb_build_object('status','STALE','evaluations',0,'signals',0);
 end if;
 if (app_private.signal_coverage_at(clock_timestamp(),clock_timestamp(),true)->>'status') is distinct from (s.input_references->'coverage'->>'status')
  or (app_private.signal_coverage_at(clock_timestamp(),clock_timestamp(),true)->>'epoch') is distinct from (s.input_references->'coverage'->>'epoch') then
  update app_private.signal_jobs set lease_token=null,lease_until=null,available_at=clock_timestamp(),boundary_key=null,continuation=null,last_error_code='CAPTURE_CHANGED' where lane_id=lane;
  return jsonb_build_object('status','STALE','evaluations',0,'signals',0);
 end if;
 if checkpoint_time>s.observed_through then raise exception 'SIGNAL_CHECKPOINT_AFTER_SNAPSHOT'; end if;
 current_activity:=app_private.signal_activity_at(l,clock_timestamp());
 current_enabled:=current_activity->>'state'='PUBLISHED' and (current_activity->>'scopeEnabled')::boolean
  and (current_activity->>'studentActive')::boolean and (current_activity->>'enrollmentActive')::boolean
  and (current_activity->>'opensAt' is null or (current_activity->>'opensAt')::timestamptz<=clock_timestamp())
  and (current_activity->>'closesAt' is null or (current_activity->>'closesAt')::timestamptz>clock_timestamp());
 if current_activity->>'closesAt' is not null and (current_activity->>'closesAt')::timestamptz>s.observed_through
  and (current_activity->>'closesAt')::timestamptz<=clock_timestamp() then
  update app_private.signal_jobs set lease_token=null,lease_until=null,available_at=clock_timestamp(),boundary_key=null,continuation=null,last_error_code='AVAILABILITY_BOUNDARY' where lane_id=lane;
  return jsonb_build_object('status','STALE','evaluations',0,'signals',0);
 end if;
 -- Establish every domain relation read before the DDL fence. No source row
 -- is locked. DDL holds ACCESS EXCLUSIVE before its epoch update, so the
 -- inverse epoch -> relation order here would deadlock a source ALTER TABLE.
 lock table app.profiles,app.organizations,app.organization_memberships,app.classes,app.class_memberships,
  app.activities,app.activity_exercises,app.signal_rule_versions,app.executions,app.attempts,
  app_private.student_activity_observations,app_private.attempt_events,app_private.attempt_results,
  app_private.submission_reservations,app_private.help_events in access share mode;
 -- Registry rows fence epoch insertion as well as updates (including when
 -- coverage is currently UNKNOWN). DDL never takes an evidence clock.
 perform 1 from app_private.signal_capture_registry order by source for share;
 perform 1 from app_private.signal_coverage_epochs where ends_at is null order by source,id for share;
 vector_value:=app_private.signal_current_vector(l);
 if s.clock_vector is distinct from vector_value
  or (app_private.signal_coverage_at(clock_timestamp(),clock_timestamp(),true)->>'status') is distinct from (s.input_references->'coverage'->>'status')
  or (app_private.signal_coverage_at(clock_timestamp(),clock_timestamp(),true)->>'epoch') is distinct from (s.input_references->'coverage'->>'epoch') then
  update app_private.signal_jobs set lease_token=null,lease_until=null,available_at=clock_timestamp(),boundary_key=null,continuation=null,last_error_code='CAPTURE_CHANGED' where lane_id=lane;
  return jsonb_build_object('status','STALE','evaluations',0,'signals',0);
 end if;
 if j.lease_until<=clock_timestamp() then return jsonb_build_object('status','LEASE_LOST','evaluations',0,'signals',0); end if;
 if checkpoint->'continuation' is not null and checkpoint->'continuation'<>'null'::jsonb then
  if jsonb_typeof(checkpoint->'continuation')<>'object'
   or ((checkpoint->'continuation')-array['revision','targetThrough','afterBoundary','lastMeaning','pendingDeadlineMicros'])<>'{}'::jsonb
   or checkpoint->'continuation'->>'revision' is distinct from s.revision
   or (checkpoint->'continuation'->>'targetThrough')::timestamptz is distinct from s.observed_through
   or (checkpoint->'continuation'->'afterBoundary'->>'at')::timestamptz>s.observed_through then raise exception 'INVALID_SIGNAL_CONTINUATION'; end if;
 end if;
 for item in select value from jsonb_array_elements(evaluations) loop
  if jsonb_typeof(item)<>'object' or (item-array['identityKey','witnessKey','semanticKey','boundary','result','publicationAllowed'])<>'{}'::jsonb
   or jsonb_typeof(item->'publicationAllowed')<>'boolean' then raise exception 'INVALID_SIGNAL_EVALUATION'; end if;
  r:=item->'result'; identity_value:=item->>'identityKey'; semantic_value:=item->>'semanticKey'; witness_value:=item->>'witnessKey';
  if identity_value !~ '^[a-f0-9]{64}$' or semantic_value !~ '^[a-f0-9]{64}$' or (witness_value is not null and witness_value !~ '^[a-f0-9]{64}$')
   or r->>'type' is distinct from l.type or r->'snapshot'->>'revision' is distinct from s.revision
   or r->'snapshot'->>'digest' is distinct from s.digest
   or r->'scope'->>'organizationId' is distinct from l.organization_id::text or r->'scope'->>'classId' is distinct from l.class_id::text
   or r->'scope'->>'studentId' is distinct from l.student_id::text or r->'scope'->>'activityId' is distinct from l.activity_id::text
   or (l.assignment_id is not null and r->'scope'->>'assignmentId' is distinct from l.assignment_id::text)
   or r->>'outcome' not in ('MATCH','NO_MATCH','NOT_EVALUABLE','NOT_VERIFIABLE')
   or (r-array['type','outcome','reason','evaluationTime','scope','ruleVersionId','algorithmVersion','schemaVersion','parameters','snapshot','selectedAttemptIds','evidence','signature','window','cause'])<>'{}'::jsonb then
   raise exception 'SIGNAL_EVALUATION_SCOPE_MISMATCH';
  end if;
  at_value:=(r->>'evaluationTime')::timestamptz;
  if at_value is null or at_value>s.observed_through or at_value is distinct from (item->'boundary'->>'at')::timestamptz
   or (prior_at is not null and at_value<prior_at) then raise exception 'SIGNAL_BOUNDARY_ORDER'; end if;
  prior_at:=at_value;
  rule_uuid:=(r->>'ruleVersionId')::uuid;
  if rule_uuid is not null and not exists(select 1 from app.signal_rule_versions v where v.id=rule_uuid and v.organization_id=l.organization_id
   and v.type=l.type and v.valid_from<=at_value and (v.valid_to is null or v.valid_to>at_value)
   and v.parameters=r->'parameters' and v.schema_version=(r->>'schemaVersion')::integer and v.algorithm_version=r->>'algorithmVersion') then
   raise exception 'SIGNAL_RULE_MISMATCH';
  end if;
  if r->>'outcome'='MATCH' and (rule_uuid is null or witness_value is null or r->>'cause' is null) then raise exception 'SIGNAL_MATCH_INCOMPLETE'; end if;
  select id into reconcile_uuid from app_private.signal_evaluations where lane_id=lane and boundary=item->'boundary'
   and snapshot_id<>snapshot order by calculated_at desc,id desc limit 1;
  insert into app_private.signal_evaluations(lane_id,snapshot_id,identity_key,semantic_key,witness_key,boundary,evaluation_time,outcome,result,publication_allowed,reconciliation_of)
  values(lane,snapshot,identity_value,semantic_value,witness_value,item->'boundary',at_value,r->>'outcome',r,
   (item->>'publicationAllowed')::boolean and (j.through_time is null or at_value>j.through_time
    or (at_value=j.through_time and (item->'boundary'->>'kind'='CURRENT'
     or (item->'boundary'->>'kind'='SUBMISSION' and (item->'boundary'->>'sequence')::bigint>coalesce(j.through_submission_sequence,0))))),reconcile_uuid)
  on conflict do nothing returning * into e;
  if not found then continue; end if;
  inserted_evaluations:=inserted_evaluations+1;
  if not e.publication_allowed then
   if e.outcome<>'MATCH' then
    select * into active_episode from app_private.signal_episodes where lane_id=lane and stopped_at is null and state='ACTIVE';
    if active_episode.id is not null and rule_uuid=active_episode.rule_version_id then
     anchor_at:=null; anchor_sequence:=null;
     if l.type='INACTIVITY' then
      select max((linked.result->'evidence'->>'lastAt')::timestamptz) into anchor_at
       from app_private.signal_episode_evaluations link join app_private.signal_evaluations linked on linked.id=link.evaluation_id
       where link.episode_id=active_episode.id;
     else
      select (submission->>'submittedAt')::timestamptz,(submission->>'eventSequence')::bigint into anchor_at,anchor_sequence
       from app_private.signal_episode_evaluations link join app_private.signal_evaluations linked on linked.id=link.evaluation_id
       cross join lateral jsonb_array_elements(linked.result->'evidence'->'submissions') submission
       where link.episode_id=active_episode.id order by (submission->>'submittedAt')::timestamptz desc,(submission->>'eventSequence')::bigint desc limit 1;
     end if;
     if anchor_at is not null and (at_value>anchor_at or (at_value=anchor_at and item->'boundary'->>'kind'='SUBMISSION'
       and (item->'boundary'->>'sequence')::bigint>anchor_sequence)) then
      pending_break:=jsonb_build_object('episodeId',active_episode.id,'evaluationId',e.id,'boundary',e.boundary);
     end if;
    end if;
   end if;
   continue;
  end if;
  select * into active_episode from app_private.signal_episodes where lane_id=lane and stopped_at is null and state='ACTIVE' for update;
  if pending_break is not null then
   if active_episode.id is not null and active_episode.id::text=pending_break->>'episodeId' then
    update app_private.signal_episodes set stopped_at=greatest(at_value,j.through_time,qualified_at),stop_reason='RECONCILIATION_INTERRUPTION' where id=active_episode.id;
    active_episode:=null;
   end if;
   pending_break:=null;
  end if;
  if e.outcome<>'MATCH' or not current_enabled then
   if active_episode.id is not null then
    update app_private.signal_episodes set stopped_at=greatest(at_value,qualified_at),stop_reason=case when not current_enabled then 'ACTIVITY_UNAVAILABLE' else coalesce(r->>'reason','ACTIVITY_UNAVAILABLE') end where id=active_episode.id;
   end if;
   continue;
  end if;
  -- A known witness retains its original episode even when another episode
  -- is accumulating. The evaluation remains an immutable audit observation.
  select * into known_witness from app_private.signal_witnesses w
   where w.lane_id=lane and w.rule_version_id=rule_uuid and w.witness_key=witness_value;
  if found and (active_episode.id is null or known_witness.episode_id is distinct from active_episode.id) then continue; end if;
  if active_episode.id is not null and active_episode.rule_version_id<>rule_uuid then
   update app_private.signal_episodes set stopped_at=greatest(at_value,qualified_at),stop_reason='NEW_RULE_VERSION' where id=active_episode.id;
   active_episode:=null;
  end if;
  if active_episode.id is null then
   -- Novelty is membership outside the reviewed snapshot, never submittedAt >
   -- reviewedAt. A late ordinary commit can introduce an earlier dated fact.
   reviewed_base:=null;
   select snap.input_references into reviewed_base from app_private.signal_reviews review
    join app_private.signal_episodes reviewed on reviewed.id=review.episode_id
    join app_private.signal_snapshots snap on snap.id=review.snapshot_id
    where review.lane_id=lane and reviewed.rule_version_id=rule_uuid order by review.reviewed_at desc,review.id desc limit 1;
   if reviewed_base is not null and l.type<>'INACTIVITY' and not exists(
    select 1 from jsonb_array_elements_text(r->'selectedAttemptIds') selected(id)
    where not exists(select 1 from jsonb_array_elements(reviewed_base->'submissions') known where known->>'id'=selected.id)) then continue; end if;
   if reviewed_base is not null and l.type='INACTIVITY'
    and r->'evidence'->>'coverageEpoch'=reviewed_base->'coverage'->>'epoch'
    and exists(select 1 from app_private.signal_evaluations before_review join app_private.signal_reviews review on before_review.id=any(review.base_evaluation_ids)
      where review.lane_id=lane and before_review.result->>'ruleVersionId'=rule_uuid::text
      and before_review.result->'evidence'->>'lastAt'=r->'evidence'->>'lastAt'
      and before_review.result->'evidence'->>'coverageEpoch'=r->'evidence'->>'coverageEpoch') then continue; end if;
   select ep.id,ep.rule_version_id into prior_episode,previous_rule from app_private.signal_episodes ep
    join app_private.signal_evaluations first_eval on first_eval.id=ep.first_evaluation_id
    where ep.lane_id=lane order by first_eval.evaluation_sequence desc limit 1;
   initial_cause_value:=case when previous_rule is not null and previous_rule<>rule_uuid then 'Nueva versión de regla. ' else '' end||(r->>'cause');
   episode_uuid:=gen_random_uuid();
   insert into app_private.signal_episodes(id,lane_id,rule_version_id,first_witness_key,first_evaluation_id,initial_cause,initial_evidence,qualified_at,previous_episode_id)
   values(episode_uuid,lane,rule_uuid,witness_value,e.id,initial_cause_value,r->'evidence',at_value,prior_episode) returning * into active_episode;
   inserted_signals:=inserted_signals+1;
  end if;
  insert into app_private.signal_witnesses(lane_id,witness_key,rule_version_id,first_evaluation_id,episode_id)
  values(lane,witness_value,rule_uuid,e.id,active_episode.id) on conflict do nothing;
  insert into app_private.signal_episode_evaluations(episode_id,evaluation_id) values(active_episode.id,e.id) on conflict do nothing;
 end loop;
 -- ACK only this immutable snapshot's UUIDs, never a global sequence maximum.
 if not (checkpoint->>'hasMore')::boolean then
  insert into app_private.signal_change_acks(lane_id,change_id,snapshot_id) select lane,id,snapshot from unnest(s.change_ids) id on conflict do nothing;
 end if;
 update app_private.signal_jobs set through_time=greatest(through_time,checkpoint_time),boundary_key=checkpoint->>'boundaryKey',
  through_submission_sequence=case when through_time is null or checkpoint_time>through_time then checkpoint_sequence
   when checkpoint_time=through_time then greatest(through_submission_sequence,checkpoint_sequence) else through_submission_sequence end,
  continuation=nullif(checkpoint->'continuation','null'::jsonb),
  pending_reconciliation_break=pending_break,
  next_deadline_micros=case when (checkpoint->>'hasMore')::boolean then floor(extract(epoch from clock_timestamp())*1000000) else next_micros end,
  last_revision=s.revision,lease_token=null,lease_until=null,attempts=0,last_error_code=null,available_at=clock_timestamp(),failed_at=null where lane_id=lane
  returning * into j;
 perform app_private.signal_sync_projections(lane);
 insert into app_private.signal_finalize_receipts(lane_id,lease_token,snapshot_id,batch_digest,result,checkpoint,control_state)
 values(lane,token,snapshot,batch_hash,jsonb_build_object('evaluations',inserted_evaluations,'signals',inserted_signals),checkpoint,
  jsonb_build_object('throughTime',app_private.signal_instant(j.through_time),'throughSubmissionSequence',j.through_submission_sequence::text,
   'boundaryKey',j.boundary_key,'continuation',j.continuation,'pendingReconciliationBreak',j.pending_reconciliation_break,
   'nextDeadlineMicros',j.next_deadline_micros::text,'lastRevision',j.last_revision));
 return jsonb_build_object('status',case when inserted_evaluations=0 then 'REPLAY' else 'COMMITTED' end,'evaluations',inserted_evaluations,'signals',inserted_signals);
end $$;

create function app_private.signal_fail_job(lane uuid,token uuid,code_value text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare j app_private.signal_jobs; waits integer[]:=array[1,5,15,60];
begin
 perform app_private.signal_worker_only();
 if code_value not in ('PROCESSING_FAILED','CLOCK_REGRESSION') then raise exception 'INVALID_SIGNAL_FAILURE'; end if;
 select * into j from app_private.signal_jobs where lane_id=lane for update;
 if token is null or j.lease_token is distinct from token or j.lease_until<=clock_timestamp() then return false; end if;
 update app_private.signal_jobs set attempts=attempts+1,last_error_code=code_value,lease_token=null,lease_until=null,
  failed_at=case when j.attempts+1>=5 then clock_timestamp() else null end,
  available_at=clock_timestamp()+make_interval(secs=>coalesce(waits[j.attempts+1],60)) where lane_id=lane;
 return true;
end $$;

create function app_private.signal_episode_projection(episode app_private.signal_episodes) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('id',episode.id,'laneId',episode.lane_id,'ruleVersionId',episode.rule_version_id,
 'state',episode.state,'cause',episode.initial_cause,'evidence',episode.initial_evidence,
 'qualifiedAt',app_private.signal_instant(episode.qualified_at),'calculatedAt',app_private.signal_instant(episode.calculated_at),
 'previousEpisodeId',episode.previous_episode_id,'reviewedBy',episode.reviewed_by,'reviewedAt',app_private.signal_instant(episode.reviewed_at))
$$;
create function app_private.signal_expected_projection(episode app_private.signal_episodes) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare first_eval app_private.signal_evaluations; review app_private.signal_reviews; ids jsonb; cause_value text; previous_rule uuid;
begin
 select * into first_eval from app_private.signal_evaluations where id=episode.first_evaluation_id;
 select * into review from app_private.signal_reviews where episode_id=episode.id;
 select rule_version_id into previous_rule from app_private.signal_episodes where id=episode.previous_episode_id;
 cause_value:=case when previous_rule is not null and previous_rule<>episode.rule_version_id then 'Nueva versión de regla. ' else '' end||(first_eval.result->>'cause');
 select coalesce(jsonb_agg(e.id order by e.evaluation_sequence),'[]'::jsonb) into ids
 from app_private.signal_episode_evaluations link join app_private.signal_evaluations e on e.id=link.evaluation_id where link.episode_id=episode.id;
 return app_private.signal_episode_projection(episode)||jsonb_build_object('cause',cause_value,'evidence',first_eval.result->'evidence',
  'state',case when review.id is null then 'ACTIVE' else 'REVIEWED' end,'reviewedBy',review.reviewed_by,
  'reviewedAt',app_private.signal_instant(review.reviewed_at),'evaluationIds',ids,'evaluationCount',jsonb_array_length(ids));
end $$;
create function app_private.signal_episode_source_valid(episode app_private.signal_episodes) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $$
declare first_eval app_private.signal_evaluations; expected jsonb;
begin
 select * into first_eval from app_private.signal_evaluations where id=episode.first_evaluation_id;
 expected:=app_private.signal_expected_projection(episode);
 return first_eval.id is not null and first_eval.lane_id=episode.lane_id and first_eval.outcome='MATCH'
  and first_eval.witness_key=episode.first_witness_key and first_eval.result->>'ruleVersionId'=episode.rule_version_id::text
  and first_eval.evaluation_time=episode.qualified_at and expected->>'cause'=episode.initial_cause
  and expected->'evidence'=episode.initial_evidence and expected->>'state'=episode.state
  and expected->>'reviewedBy' is not distinct from episode.reviewed_by::text
  and expected->>'reviewedAt' is not distinct from app_private.signal_instant(episode.reviewed_at)
  and exists(select 1 from app_private.signal_witnesses w where w.lane_id=episode.lane_id and w.rule_version_id=episode.rule_version_id
   and w.witness_key=episode.first_witness_key and w.episode_id=episode.id and w.first_evaluation_id=first_eval.id);
end $$;
create function app_private.signal_projection_within_cut(episode app_private.signal_episodes,cutoff timestamptz) returns boolean
language sql stable set search_path=pg_catalog as $$
 select episode.qualified_at<=cutoff and (episode.reviewed_at is null or episode.reviewed_at<=cutoff)
  and (episode.stopped_at is null or episode.stopped_at<=cutoff)
  and not exists(select 1 from app_private.signal_episode_evaluations link join app_private.signal_evaluations e on e.id=link.evaluation_id
   where link.episode_id=episode.id and e.evaluation_time>cutoff)
$$;
create function app_private.signal_sync_projections(lane uuid,cutoff timestamptz default 'infinity'::timestamptz) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare episode app_private.signal_episodes; value jsonb; count_value integer:=0;
begin
 for episode in select * from app_private.signal_episodes ep where lane_id=lane and app_private.signal_projection_within_cut(ep,cutoff) order by id loop
  if app_private.signal_episode_source_valid(episode) is distinct from true then raise exception 'SIGNAL_SOURCE_INCOHERENT'; end if;
  value:=app_private.signal_expected_projection(episode);
  insert into app_private.signal_projections(episode_id,lane_id,payload,digest) values(episode.id,lane,value,app_private.signal_digest(value))
  on conflict(episode_id) do update set lane_id=excluded.lane_id,payload=excluded.payload,digest=excluded.digest,rebuilt_at=clock_timestamp()
   where signal_projections.lane_id is distinct from excluded.lane_id or signal_projections.payload is distinct from excluded.payload or signal_projections.digest is distinct from excluded.digest;
  count_value:=count_value+1;
 end loop;
 return count_value;
end $$;
create function app_private.signal_read_evidence(signal uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare episode app_private.signal_episodes; lane app_private.signal_lanes; evaluations jsonb;
begin
 select * into episode from app_private.signal_episodes where id=signal;
 select * into lane from app_private.signal_lanes where id=episode.lane_id;
 if episode.id is null or app_private.actor_id() is null or app_private.academic_teacher(lane.class_id,true) is distinct from true then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'evaluationTime',app_private.signal_instant(e.evaluation_time),
 'calculatedAt',app_private.signal_instant(e.calculated_at),'boundary',e.boundary,'result',e.result) order by e.evaluation_sequence),'[]'::jsonb)
 into evaluations from app_private.signal_episode_evaluations link join app_private.signal_evaluations e on e.id=link.evaluation_id where link.episode_id=signal;
 return app_private.signal_episode_projection(episode)||jsonb_build_object('scope',app_private.signal_lane_projection(lane),'evaluations',evaluations);
end $$;

-- Deliberately not granted to alunza_app. This supplies the immutable review
-- base to TEST and future authorized .07 wiring; there is no public review API.
create function app_private.signal_review_fixture(signal uuid,reviewer uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare episode app_private.signal_episodes; l app_private.signal_lanes; j app_private.signal_jobs; snapshot_value jsonb;
 ts timestamptz; token uuid:=gen_random_uuid(); review_uuid uuid; witness_keys text[]; evaluation_ids uuid[]; existing app_private.signal_reviews;
begin
 select * into episode from app_private.signal_episodes where id=signal;
 select * into l from app_private.signal_lanes where id=episode.lane_id;
 if episode.id is null or not exists(select 1 from app.classes c join app.organization_memberships m on m.organization_id=c.organization_id and m.user_id=reviewer
  join app.profiles p on p.id=reviewer join app.organizations o on o.id=c.organization_id
  where c.id=l.class_id and c.teacher_id=reviewer and m.role='TEACHER' and m.state='ACTIVE' and p.account_state='ACTIVE' and o.archived_at is null) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 perform app_private.signal_lock_lane_clocks(l,true);
 select * into j from app_private.signal_jobs where lane_id=l.id for update;
 select * into episode from app_private.signal_episodes where id=signal for update;
 select * into existing from app_private.signal_reviews where episode_id=signal;
 if found then return app_private.signal_episode_projection(episode); end if;
 if j.lease_until>clock_timestamp() then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
 update app_private.signal_jobs set lease_token=token,lease_until=clock_timestamp()+interval '30 seconds' where lane_id=l.id;
 snapshot_value:=app_private.signal_capture_snapshot(l.id,token);
 if snapshot_value is null then raise exception 'SIGNAL_REVIEW_SNAPSHOT_FAILED'; end if;
 ts:=clock_timestamp();
 select coalesce(array_agg(w.witness_key order by w.witness_key),'{}'::text[]) into witness_keys from app_private.signal_witnesses w where lane_id=l.id;
 select coalesce(array_agg(e.id order by e.evaluation_sequence),'{}'::uuid[]) into evaluation_ids from app_private.signal_evaluations e where lane_id=l.id;
 insert into app_private.signal_reviews(episode_id,lane_id,reviewed_by,reviewed_at,snapshot_id,base_witness_keys,base_evaluation_ids,base_digest)
 values(signal,l.id,reviewer,ts,(snapshot_value->'snapshot'->>'id')::uuid,witness_keys,evaluation_ids,
  app_private.signal_digest(jsonb_build_object('snapshot',snapshot_value->'snapshot','witnesses',witness_keys,'evaluations',evaluation_ids))) returning id into review_uuid;
 update app_private.signal_episodes set state='REVIEWED',reviewed_by=reviewer,reviewed_at=ts,
  stopped_at=coalesce(stopped_at,ts),stop_reason=coalesce(stop_reason,'REVIEWED') where id=signal returning * into episode;
 update app_private.signal_jobs set lease_token=null,lease_until=null,boundary_key=null,available_at=ts where lane_id=l.id;
 perform app_private.signal_record_change('REVIEW',l.id::text,l.organization_id,'signal_reviews',review_uuid,ts,null,
  jsonb_build_object('episodeId',signal,'reviewedBy',reviewer,'reviewedAt',app_private.signal_instant(ts)));
 perform app_private.signal_sync_projections(l.id);
 return app_private.signal_episode_projection(episode);
end $$;

create function app_private.signal_rebuild(mode_value text,scope_value jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare org uuid; cls uuid; student uuid; activity uuid; cutoff timestamptz; l app_private.signal_lanes;
 ecount bigint; scount bigint; digest_value text; receipts jsonb:='[]'::jsonb; report jsonb; receipt_uuid uuid;
 projection_mismatches bigint; source_mismatches bigint; total_mismatches bigint:=0; job app_private.signal_jobs; backlog bigint; excluded bigint;
begin
 perform app_private.signal_worker_only();
 if mode_value not in ('check','rebuild','report') or jsonb_typeof(scope_value) is distinct from 'object'
 or (scope_value-array['organizationId','classId','studentId','activityId','asOf'])<>'{}'::jsonb then raise exception 'INVALID_SIGNAL_REBUILD_SCOPE'; end if;
 org:=(scope_value->>'organizationId')::uuid; cls:=(scope_value->>'classId')::uuid; student:=(scope_value->>'studentId')::uuid;
 activity:=(scope_value->>'activityId')::uuid; cutoff:=(scope_value->>'asOf')::timestamptz;
 if org is null or cls is null or student is null or activity is null or cutoff is null or not isfinite(cutoff) or cutoff>clock_timestamp() then raise exception 'INVALID_SIGNAL_REBUILD_SCOPE'; end if;
 if not exists(select 1 from app.activities a join app.class_memberships m on m.organization_id=a.organization_id and m.class_id=a.class_id
 where a.id=activity and a.organization_id=org and a.class_id=cls and m.user_id=student) then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 for l in select * from app_private.signal_lanes where organization_id=org and class_id=cls and student_id=student and activity_id=activity order by id loop
  select count(*),app_private.signal_digest(coalesce(jsonb_agg(jsonb_build_object('id',id,'identity',identity_key,'result',result) order by evaluation_sequence),'[]'::jsonb))
  into ecount,digest_value from app_private.signal_evaluations where lane_id=l.id and evaluation_time<=cutoff;
  select count(*) into scount from app_private.signal_episodes where lane_id=l.id and qualified_at<=cutoff;
  select count(*) into excluded from app_private.signal_episodes ep where lane_id=l.id and not app_private.signal_projection_within_cut(ep,cutoff);
  select count(*) into source_mismatches from app_private.signal_episodes ep where lane_id=l.id and app_private.signal_projection_within_cut(ep,cutoff) and app_private.signal_episode_source_valid(ep) is distinct from true;
  select count(*) into projection_mismatches from app_private.signal_episodes ep left join app_private.signal_projections p on p.episode_id=ep.id
   where ep.lane_id=l.id and app_private.signal_projection_within_cut(ep,cutoff) and (p.lane_id is distinct from ep.lane_id or p.payload is distinct from app_private.signal_expected_projection(ep)
    or p.digest is distinct from app_private.signal_digest(app_private.signal_expected_projection(ep)));
  if mode_value='rebuild' then
   if source_mismatches<>0 then raise exception 'SIGNAL_SOURCE_INCOHERENT'; end if;
   -- All canonical facts stay untouched. Only replace the derived projection.
   perform app_private.signal_sync_projections(l.id,cutoff);
   projection_mismatches:=0;
   insert into app_private.signal_rebuild_receipts(lane_id,evaluation_count,episode_count,digest)
   values(l.id,ecount,scount,digest_value) returning id into receipt_uuid;
  end if;
  select * into job from app_private.signal_jobs where lane_id=l.id;
  select count(*) into backlog from app_private.signal_input_changes change join app_private.signal_lane_clock_keys(l) keys using(component,scope_key)
   where change.finalized_at is not null and not exists(select 1 from app_private.signal_change_acks ack where ack.lane_id=l.id and ack.change_id=change.id);
  total_mismatches:=total_mismatches+projection_mismatches+source_mismatches;
  report:=jsonb_build_object('laneId',l.id,'evaluations',ecount,'episodes',scount,'digest',digest_value,
   'projectionMismatches',projection_mismatches,'sourceMismatches',source_mismatches,'excludedAfterCut',excluded,'backlogChanges',backlog,
   'throughTime',app_private.signal_instant(job.through_time),'nextDeadlineMicros',job.next_deadline_micros::text,
   'checkpointLagMicros',case when job.through_time is null then null else greatest(0,floor(extract(epoch from clock_timestamp()-job.through_time)*1000000))::text end,
   'jobState',case when job.failed_at is not null then 'FAILED' when job.lease_until>clock_timestamp() then 'RUNNING' else 'IDLE' end,
   'lastErrorCode',job.last_error_code,'reconstructionId',case when mode_value='rebuild' then receipt_uuid else null end);
  receipts:=receipts||jsonb_build_array(report);
 end loop;
 return jsonb_build_object('mode',mode_value,'asOf',app_private.signal_instant(cutoff),'lanes',receipts,
 'consistent',total_mismatches=0,'mismatches',total_mismatches,'operationalStateChanged',false,'source','IMMUTABLE_SIGNAL_LEDGER');
end $$;

create function app_private.signal_resume_job(lane uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform app_private.signal_worker_only();
 update app_private.signal_jobs set failed_at=null,attempts=0,last_error_code=null,available_at=clock_timestamp(),boundary_key=null
 where lane_id=lane and failed_at is not null and (lease_until is null or lease_until<=clock_timestamp());
 return found;
end $$;

create function app_private.signal_replay_inputs(scope_value jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare org uuid; cls uuid; student uuid; activity uuid; cutoff timestamptz;
 s app_private.signal_snapshots; ref jsonb; technical jsonb; submissions_value jsonb; evaluations_value jsonb; envelope jsonb; output jsonb:='[]'::jsonb;
begin
 perform app_private.signal_worker_only();
 if jsonb_typeof(scope_value) is distinct from 'object' or (scope_value-array['organizationId','classId','studentId','activityId','asOf'])<>'{}'::jsonb then raise exception 'INVALID_SIGNAL_REBUILD_SCOPE'; end if;
 org:=(scope_value->>'organizationId')::uuid; cls:=(scope_value->>'classId')::uuid; student:=(scope_value->>'studentId')::uuid;
 activity:=(scope_value->>'activityId')::uuid; cutoff:=(scope_value->>'asOf')::timestamptz;
 if org is null or cls is null or student is null or activity is null or cutoff is null or not isfinite(cutoff) or cutoff>clock_timestamp() then raise exception 'INVALID_SIGNAL_REBUILD_SCOPE'; end if;
 if not exists(select 1 from app.activities a join app.class_memberships m on m.organization_id=a.organization_id and m.class_id=a.class_id
 where a.id=activity and a.organization_id=org and a.class_id=cls and m.user_id=student) then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 for s in select snap.* from app_private.signal_snapshots snap join app_private.signal_lanes l on l.id=snap.lane_id
 where l.organization_id=org and l.class_id=cls and l.student_id=student and l.activity_id=activity
 and exists(select 1 from app_private.signal_evaluations e where e.snapshot_id=snap.id and e.evaluation_time<=cutoff)
 order by snap.captured_at,snap.id loop
  submissions_value:='[]'::jsonb;
  for ref in select value from jsonb_array_elements(s.input_references->'submissions') loop
   select a.technical_result into technical from app.attempts a where a.id=(ref->>'id')::uuid
    and a.organization_id=org and a.class_id=cls and a.student_id=student and a.activity_id=activity;
   if technical is null or app_private.signal_digest(technical) is distinct from ref->>'technicalResultDigest' then raise exception 'SIGNAL_CANONICAL_EVIDENCE_MISMATCH'; end if;
   submissions_value:=submissions_value||jsonb_build_array((ref-'technicalResultDigest')||jsonb_build_object('technicalResult',technical));
  end loop;
  select jsonb_agg(jsonb_build_object('identityKey',e.identity_key,'boundary',e.boundary,'result',e.result,'publicationAllowed',e.publication_allowed) order by e.evaluation_sequence)
  into evaluations_value from app_private.signal_evaluations e where e.snapshot_id=s.id and e.evaluation_time<=cutoff;
  envelope:=s.input_references||jsonb_build_object('submissions',submissions_value,'priorEvaluations','[]'::jsonb,'knownSemanticKeys','[]'::jsonb,
   'snapshot',jsonb_build_object('id',s.id,'revision',s.revision,'digest',s.digest,'observedThrough',app_private.signal_instant(s.observed_through),'capturedAt',app_private.signal_instant(s.captured_at)));
  if app_private.signal_digest(envelope-'snapshot'-'checkpoint'-'priorEvaluations'-'knownSemanticKeys') is distinct from s.digest then raise exception 'SIGNAL_SNAPSHOT_DIGEST_MISMATCH'; end if;
  output:=output||jsonb_build_array(jsonb_build_object('snapshot',envelope,'evaluations',evaluations_value));
 end loop;
 return output;
end $$;

-- The helper cannot log in, inherit, bypass RLS, or own the tables. Ordinary
-- application requests have no table/sequence privileges for these ledgers.
-- Supabase's installed Supautils permits postgres to manage event triggers
-- without SUPERUSER. Create as the migration role before removing EXECUTE.
create event trigger signal_capture_ddl_guard on ddl_command_end
 when tag in ('ALTER TABLE','CREATE FUNCTION','ALTER FUNCTION','DROP FUNCTION','CREATE TRIGGER','ALTER TRIGGER','DROP TRIGGER')
 execute function app_private.signal_ddl_coverage_change();

grant usage on sequence app_private.signal_input_changes_change_sequence_seq,app_private.signal_evaluations_evaluation_sequence_seq to alunza_identity;
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
do $$ declare fn regprocedure; fname text; begin
 for fn,fname in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app_private' and p.proname in (
 'signal_worker_only','signal_instant','signal_digest','signal_immutable','signal_record_change','signal_terminal_guard','signal_guard_change','signal_flush_changes',
 'signal_capture_source_change','signal_lane_projection','signal_lane_clock_keys','signal_current_vector','signal_lock_lane_clocks','signal_discover_lanes',
 'signal_claim_job','signal_renew_job','signal_value_at','signal_activity_at','signal_capture_definition','signal_coverage_at',
 'signal_restart_coverage','signal_observe_coverage','signal_verify_capture','signal_ddl_coverage_change','signal_capture_snapshot','signal_guard_episode','signal_guard_link','signal_finalize_batch','signal_fail_job',
 'signal_episode_projection','signal_expected_projection','signal_episode_source_valid','signal_projection_within_cut','signal_sync_projections',
 'signal_read_evidence','signal_review_fixture','signal_rebuild','signal_resume_job','signal_replay_inputs') loop
  execute format('alter function %s owner to alunza_identity',fn);
 end loop;
end $$;
-- postgres is NOINHERIT locally: ownership changes do not make it the owner.
-- Apply ACLs and initialize the verified baseline under the actual owner.
set role alunza_identity;
do $$ declare fn regprocedure; fname text; begin
 for fn,fname in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app_private' and p.proname in (
 'signal_worker_only','signal_instant','signal_digest','signal_immutable','signal_record_change','signal_terminal_guard','signal_guard_change','signal_flush_changes',
 'signal_capture_source_change','signal_lane_projection','signal_lane_clock_keys','signal_current_vector','signal_lock_lane_clocks','signal_discover_lanes',
 'signal_claim_job','signal_renew_job','signal_value_at','signal_activity_at','signal_capture_definition','signal_coverage_at',
 'signal_restart_coverage','signal_observe_coverage','signal_verify_capture','signal_ddl_coverage_change','signal_capture_snapshot','signal_guard_episode','signal_guard_link','signal_finalize_batch','signal_fail_job',
 'signal_episode_projection','signal_expected_projection','signal_episode_source_valid','signal_projection_within_cut','signal_sync_projections',
 'signal_read_evidence','signal_review_fixture','signal_rebuild','signal_resume_job','signal_replay_inputs') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,alunza_app',fn);
  execute format('grant execute on function %s to alunza_identity',fn);
  if fname in ('signal_discover_lanes','signal_claim_job','signal_renew_job','signal_verify_capture','signal_capture_snapshot','signal_finalize_batch','signal_fail_job','signal_read_evidence','signal_rebuild','signal_resume_job','signal_replay_inputs') then
   execute format('grant execute on function %s to alunza_app',fn);
  end if;
  if fname in ('signal_review_fixture','signal_restart_coverage','signal_coverage_at','signal_instant') then
   execute format('grant execute on function %s to postgres',fn);
  end if;
 end loop;
end $$;
-- Capturers and definitions now exist. DDL locks remain until commit, so no
-- ordinary writer can pass the installation boundary without capture.
insert into app_private.signal_runtime(singleton) values(true);
insert into app_private.signal_capture_registry(source,expected_definition_hash)
 select source,app_private.signal_capture_definition(source) from unnest(array['ACTIVITY_OPEN','RUN','ATTEMPT','HELP']) source;
insert into app_private.signal_coverage_epochs(source,starts_at,verified_through,capture_version,definition_hash)
 select source,clock_timestamp(),clock_timestamp(),'signals.capture.v1',expected_definition_hash from app_private.signal_capture_registry;
reset role;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
