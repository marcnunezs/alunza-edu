begin;
grant alunza_app to postgres;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to alunza_app;
do $$ declare r regprocedure; begin
 for r in select p.oid::regprocedure from pg_proc p join pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid join pg_extension e on d.refclassid='pg_extension'::regclass and e.oid=d.refobjid where e.extname='pgtap'
 loop execute format('grant execute on function %s to alunza_app',r); end loop;
end $$;

set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at)
select ('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'review-'||n||'@alunza.test',now() from generate_series(1,5) n;
insert into auth.sessions(id,user_id)
select ('71100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,5) n;
insert into app.profiles(id,display_name,email_normalized,account_state)
select ('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Academic '||n,'review-'||n||'@alunza.test','ACTIVE' from generate_series(1,5) n;
insert into app.organizations(id,code,name) values ('72000000-0000-4000-8000-000000000001','REVIEW-A','Academic A'),('72000000-0000-4000-8000-000000000002','REVIEW-B','Academic B');
insert into app.organization_memberships(organization_id,user_id,role,state,joined_at) values
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','ADMIN','ACTIVE',now()),
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','TEACHER','ACTIVE',now()),
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003','STUDENT','ACTIVE',now()),
('72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000004','TEACHER','ACTIVE',now()),
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000005','TEACHER','ACTIVE',now());
insert into app.courses(id,organization_id,code,name,academic_period) values
('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','P1','Programming','2026-2'),
('73000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000002','P1','Foreign','2026-2');
insert into app.course_teacher_grants(organization_id,course_id,teacher_id,granted_by) values
('72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001');
insert into app.classes(id,organization_id,course_id,teacher_id,code,name) values
('74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','A1','Own class'),
('74000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000005','A2','Other class'),
('74000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000004','B1','Foreign class');
insert into app.class_memberships(organization_id,class_id,user_id) values('72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003');
insert into app.class_join_codes(organization_id,class_id,token_digest,expires_at,created_by) values
('72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000002',repeat('a',64),now()+interval '1 day','71000000-0000-4000-8000-000000000005'),
('72000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000003',repeat('b',64),now()+interval '1 day','71000000-0000-4000-8000-000000000004');
insert into app.concept_tags(id,organization_id,normalized_name) values('75000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','addition');
insert into app.concept_versions(id,organization_id,concept_id,version,name,description,created_by) values
('75100000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001',1,'Addition','Addition','71000000-0000-4000-8000-000000000001');
update app.concept_tags set current_version_id='75100000-0000-4000-8000-000000000001' where id='75000000-0000-4000-8000-000000000001';
insert into app.exercises(id,organization_id,owner_id) values('76000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002');
insert into app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) values
('76100000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001',1,'Sum','Return sum','module.exports.solve=(a,b)=>a+b;','BEGINNER','71000000-0000-4000-8000-000000000002');
insert into app.exercise_version_concepts values('72000000-0000-4000-8000-000000000001','76100000-0000-4000-8000-000000000001','75100000-0000-4000-8000-000000000001');
insert into app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) values
('72000000-0000-4000-8000-000000000001','76100000-0000-4000-8000-000000000001','visible',0,'visible','[1,2]','3'),
('72000000-0000-4000-8000-000000000001','76100000-0000-4000-8000-000000000001','hidden-sentinel',1,'hidden','[2,2]','4');
update app.exercises set current_version_id='76100000-0000-4000-8000-000000000001' where id='76000000-0000-4000-8000-000000000001';
insert into app.activities(id,organization_id,class_id,created_by,title,type) values
('77000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','Published','FORMATIVE'),
('77000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','Draft','FORMATIVE');
insert into app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position) values('78000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','77000000-0000-4000-8000-000000000001','76100000-0000-4000-8000-000000000001',0);
update app.activities set state='PUBLISHED' where id='77000000-0000-4000-8000-000000000001';
-- Validate the original domain constraints without flushing signal capture mid-transaction.
-- SET CONSTRAINTS ALL IMMEDIATE and subsequent DML rejection have their own signals integration test.
set constraints app.provisioning_complete, app.exercise_definition_complete,
 app.concept_current_version, app.exercise_current_version immediate;


-- These are structural episode fixtures. HTTP acceptance separately creates
-- episodes through the deterministic worker over real confirmed submissions.
create temporary table review_state(name text primary key,value jsonb);
grant select,insert,update on review_state to alunza_app;
create function pg_temp.review_actor(n integer) returns void language sql as $$
 select set_config('app.actor_id',('71000000-0000-4000-8000-'||lpad(n::text,12,'0')),true),
  set_config('app.session_id',('71100000-0000-4000-8000-'||lpad(n::text,12,'0')),true),
  set_config('app.organization_id',case when n=4 then '72000000-0000-4000-8000-000000000002' else '72000000-0000-4000-8000-000000000001' end,true),
  set_config('app.request_id','71200000-0000-4000-8000-000000000001',true)
$$;
create function pg_temp.review_id(n integer) returns uuid language sql immutable as $$
 select ('79700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.review_signal(n integer default 1) returns jsonb language sql as $$
 select app_private.signal_review(pg_temp.review_id(n))
$$;

set local role alunza_app;
select pg_temp.review_actor(1);
insert into review_state values('rule',app_private.create_rule_version('72000000-0000-4000-8000-000000000001',
 '{"type":"INACTIVITY","schemaVersion":1,"algorithmVersion":"DEC005_V1","parameters":{"inactivityDays":7}}','review-rule-create'));
select app_private.activate_rule_version('72000000-0000-4000-8000-000000000001',(select (value->>'id')::uuid from review_state where name='rule'),null,'review-rule-activate');
reset role;
insert into app_private.signal_lanes(id,organization_id,class_id,student_id,activity_id,type)
 values('79100000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001',
 '71000000-0000-4000-8000-000000000003','77000000-0000-4000-8000-000000000001','INACTIVITY');
insert into app_private.signal_jobs(lane_id) values('79100000-0000-4000-8000-000000000001');
insert into app_private.signal_snapshots(id,lane_id,lease_token,captured_at,observed_through,revision,digest,clock_vector,input_references)
select ('79200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'79100000-0000-4000-8000-000000000001',gen_random_uuid(),
 clock_timestamp()-make_interval(mins=>5-n),clock_timestamp()-make_interval(mins=>5-n),repeat('a',64),repeat('b',64),'[]','{}'
 from generate_series(1,3)n;
insert into app_private.signal_evaluations(id,lane_id,snapshot_id,identity_key,semantic_key,witness_key,boundary,evaluation_time,outcome,result,publication_allowed)
select ('79300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,s.lane_id,s.id,lpad(n::text,64,'0'),lpad(n::text,64,'0'),lpad(n::text,64,'0'),
 '{"kind":"CURRENT"}',s.observed_through,'MATCH',jsonb_build_object('ruleVersionId',(select value->>'id' from review_state where name='rule'),
 'cause','Siete días observables sin actividad.','reason','INACTIVITY_THRESHOLD','evidence',jsonb_build_object('referenceEvents','[]'::jsonb,
 'baselineAt',s.observed_through-interval '7 days','observableSince',s.observed_through-interval '7 days','lastAt',s.observed_through-interval '7 days')),true
 from generate_series(1,3)n join app_private.signal_snapshots s on s.id=('79200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
insert into app_private.signal_episodes(id,lane_id,rule_version_id,first_witness_key,first_evaluation_id,initial_cause,initial_evidence,qualified_at,calculated_at,stopped_at,stop_reason)
select pg_temp.review_id(n),e.lane_id,(e.result->>'ruleVersionId')::uuid,e.witness_key,e.id,e.result->>'cause',e.result->'evidence',e.evaluation_time,e.calculated_at,
 case when n<3 then e.evaluation_time+interval '1 second' else null end,case when n<3 then 'NO_MATCH' else null end
 from generate_series(1,3)n join app_private.signal_evaluations e on e.id=('79300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
insert into app_private.signal_witnesses(lane_id,witness_key,rule_version_id,first_evaluation_id,episode_id)
select lane_id,first_witness_key,rule_version_id,first_evaluation_id,id from app_private.signal_episodes where lane_id='79100000-0000-4000-8000-000000000001';
insert into app_private.signal_episode_evaluations(episode_id,evaluation_id)
select id,first_evaluation_id from app_private.signal_episodes where lane_id='79100000-0000-4000-8000-000000000001';
insert into review_state values('original',to_jsonb((select ep from app_private.signal_episodes ep where id=pg_temp.review_id(1))));

select ok(has_function_privilege('alunza_app','app_private.signal_review(uuid)','EXECUTE'),'RF019: API role may call the authorizing writer');
select ok(not has_function_privilege(role_name,p.oid,'EXECUTE'),'RF019: private entry is not a browser RPC: '||role_name||'/'||p.proname)
from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
cross join unnest(array['anon','authenticated','service_role']) role_name
where ns.nspname='app_private' and p.proname in('signal_review','signal_review_allowed','signal_review_authorize','signal_review_projection','signal_capture_snapshot_core');
select ok(not has_function_privilege('alunza_app',signature,'EXECUTE'),'RF019: runtime cannot invoke internal kernel '||signature)
from unnest(array['app_private.signal_review_allowed(app_private.signal_lanes)',
 'app_private.signal_review_authorize(app_private.signal_lanes)',
 'app_private.signal_review_projection(app_private.signal_episodes,app_private.signal_lanes)',
 'app_private.signal_capture_snapshot_core(uuid,uuid,boolean)','app_private.signal_review_fixture(uuid,uuid)']) signature;
select ok(not has_table_privilege('alunza_app','app_private.signal_reviews','SELECT,INSERT,UPDATE,DELETE'),'RF019: no direct review ledger privileges');
select ok(not has_table_privilege('alunza_app','app_private.signal_episodes','UPDATE'),'RF019: no direct episode mutation');
select ok(bool_and(pg_get_userbyid(p.proowner)='alunza_identity' and p.proconfig @> array['search_path=pg_catalog']),
 'RF019: constrained function owner and fixed search path')
from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
where ns.nspname='app_private' and p.proname in('signal_review','signal_review_allowed','signal_review_authorize','signal_review_projection','signal_capture_snapshot_core');

set local role alunza_app;
select pg_temp.review_actor(1);
select throws_ok($$select pg_temp.review_signal()$$,'P0001','RESOURCE_NOT_FOUND','ADMIN governance does not authorize pedagogical review');
select pg_temp.review_actor(3);
select throws_ok($$select pg_temp.review_signal()$$,'P0001','RESOURCE_NOT_FOUND','student cannot review own signal');
select pg_temp.review_actor(4);
select throws_ok($$select pg_temp.review_signal()$$,'P0001','RESOURCE_NOT_FOUND','foreign teacher cannot enumerate or review signal');
select pg_temp.review_actor(5);
select throws_ok($$select pg_temp.review_signal()$$,'P0001','RESOURCE_NOT_FOUND','same-organization unassigned teacher is denied');
select pg_temp.review_actor(2);
select throws_ok($$insert into app.audit_events(organization_id,actor_id,action,entity_type,entity_id,result,correlation_id)
 values('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','SIGNAL_REVIEWED','SIGNAL',pg_temp.review_id(1),'SUCCEEDED',gen_random_uuid())$$,
 '42501',null,'runtime cannot forge SIGNAL_REVIEWED through an older permissive audit policy');
select throws_ok($$select app_private.signal_review('79700000-0000-4000-8000-000000000099')$$,'P0001','RESOURCE_NOT_FOUND','unknown signal has the same safe error');
select set_config('app.session_id','71100000-0000-4000-8000-000000000003',true);
select throws_ok($$select pg_temp.review_signal()$$,'P0001','RESOURCE_NOT_FOUND','another user session does not authorize review');
select pg_temp.review_actor(2);
select throws_ok($$select app_private.signal_capture_snapshot('79100000-0000-4000-8000-000000000001',gen_random_uuid())$$,
 '42501','FORBIDDEN','capture wrapper still rejects a browser actor');
select throws_ok($$select app_private.signal_capture_snapshot_core('79100000-0000-4000-8000-000000000001',gen_random_uuid(),true)$$,
 '42501',null,'runtime cannot bypass the worker wrapper via the new kernel');
reset role;
select is((select count(*)::integer from app_private.signal_reviews where lane_id='79100000-0000-4000-8000-000000000001'),0,'negative requests did not create a review');

-- An active worker keeps its lease. Rejection does not leave a reservation.
update app_private.signal_jobs set lease_token='79400000-0000-4000-8000-000000000001',lease_until=clock_timestamp()+interval '1 hour'
 where lane_id='79100000-0000-4000-8000-000000000001';
set local role alunza_app;
select throws_ok($$select pg_temp.review_signal(3)$$,'P0001','REQUEST_IN_PROGRESS','worker lease is a recoverable conflict');
reset role;
select is((select lease_token from app_private.signal_jobs where lane_id='79100000-0000-4000-8000-000000000001'),
 '79400000-0000-4000-8000-000000000001'::uuid,'rejection does not steal lease');
select is((select count(*)::integer from app_private.signal_snapshots where lane_id='79100000-0000-4000-8000-000000000001'),3,'lease conflict creates no snapshot');
update app_private.signal_jobs set lease_token=null,lease_until=null where lane_id='79100000-0000-4000-8000-000000000001';

set local role alunza_app;
insert into review_state values('first',pg_temp.review_signal());
select is((select value->>'state' from review_state where name='first'),'REVIEWED','E1: first public review is persisted');
select is((select value->>'reviewedBy' from review_state where name='first'),'71000000-0000-4000-8000-000000000002','reviewer comes from verified context');
select is((select value->>'reviewedByName' from review_state where name='first'),'Academic 2','response supplies a display label, not email');
select is((select count(*)::integer from jsonb_object_keys((select value from review_state where name='first'))),7,'mutation response has exactly seven public fields');
select is(current_setting('app.actor_id'),'71000000-0000-4000-8000-000000000002','capture preserved teacher actor');
select is(current_setting('app.session_id'),'71100000-0000-4000-8000-000000000002','capture preserved teacher session');
select is(pg_temp.review_signal(),(select value from review_state where name='first'),'E4: same episode replays the first result');
insert into review_state values('past',app_private.dashboard_signal('74000000-0000-4000-8000-000000000001',pg_temp.review_id(1),
 jsonb_build_object('asOf',(select (value->>'reviewedAt')::timestamptz-interval '1 microsecond' from review_state where name='first'))));
select is((select value->'signal'->>'state' from review_state where name='past'),'ACTIVE','historical cut is not overwritten by review');
select is((select value->'signal'->'reviewedByName' from review_state where name='past'),'null'::jsonb,'past cut does not expose a future reviewer name');
select is(app_private.dashboard_signal('74000000-0000-4000-8000-000000000001',pg_temp.review_id(1),'{}')->'signal'->>'reviewedByName',
 'Academic 2','present read shows the responsible label');
reset role;
select is((select count(*)::integer from app_private.signal_reviews where episode_id=pg_temp.review_id(1)),1,'first review is unique');
select is((select count(*)::integer from app.audit_events where entity_id=pg_temp.review_id(1) and action='SIGNAL_REVIEWED'),1,'replay does not duplicate effective audit');
select throws_ok($$insert into app.audit_events(organization_id,actor_id,action,entity_type,entity_id,result,correlation_id)
 select organization_id,actor_id,action,entity_type,entity_id,result,gen_random_uuid() from app.audit_events
 where entity_id=pg_temp.review_id(1) and action='SIGNAL_REVIEWED'$$,
 '23505',null,'database uniqueness also prevents a duplicate effective review event');
select is((select safe_changes from app.audit_events where entity_id=pg_temp.review_id(1) and action='SIGNAL_REVIEWED'),
 '{"state":{"from":"ACTIVE","to":"REVIEWED"}}'::jsonb,'audit excludes pedagogical evidence');
select is((select request_id from app.audit_events where entity_id=pg_temp.review_id(1) and action='SIGNAL_REVIEWED'),
 '71200000-0000-4000-8000-000000000001'::uuid,'audit retains the request correlation');
select is((select to_jsonb(ep)-array['state','reviewed_by','reviewed_at'] from app_private.signal_episodes ep where id=pg_temp.review_id(1)),
 (select value-array['state','reviewed_by','reviewed_at'] from review_state where name='original'),'cause, rule, initial evidence and existing stop remain intact');
select is((select r.reviewed_at from app_private.signal_reviews r where episode_id=pg_temp.review_id(1)),
 (select s.observed_through from app_private.signal_reviews r join app_private.signal_snapshots s on s.id=r.snapshot_id where r.episode_id=pg_temp.review_id(1)),
 'review server instant matches its captured evidence cutoff');
select throws_ok($$update app_private.signal_reviews set reviewed_by='71000000-0000-4000-8000-000000000005' where episode_id=pg_temp.review_id(1)$$,
 '23514','SIGNAL_IMMUTABLE','first review cannot be rewritten');
select throws_ok($$delete from app_private.signal_reviews where episode_id=pg_temp.review_id(1)$$,'23514','SIGNAL_IMMUTABLE','review evidence cannot be deleted');

-- Audit failure proves the entire mutation rolls back, including its snapshot.
create function pg_temp.reject_review_audit() returns trigger language plpgsql as $$
begin
 if new.action='SIGNAL_REVIEWED' and new.entity_id=pg_temp.review_id(2) then raise exception 'REVIEW_AUDIT_FIXTURE_FAILURE'; end if;
 return new;
end $$;
create trigger review_audit_failure before insert on app.audit_events for each row execute function pg_temp.reject_review_audit();
insert into review_state values('snapshotCount',to_jsonb((select count(*) from app_private.signal_snapshots where lane_id='79100000-0000-4000-8000-000000000001')));
set local role alunza_app;
select throws_ok($$select pg_temp.review_signal(2)$$,'P0001','REVIEW_AUDIT_FIXTURE_FAILURE','audit failure rejects review atomically');
reset role;
select is((select state from app_private.signal_episodes where id=pg_temp.review_id(2)),'ACTIVE','audit failure restores episode');
select is((select count(*)::integer from app_private.signal_reviews where episode_id=pg_temp.review_id(2)),0,'audit failure leaves no review');
select is(to_jsonb((select count(*) from app_private.signal_snapshots where lane_id='79100000-0000-4000-8000-000000000001')),
 (select value from review_state where name='snapshotCount'),'audit failure leaves no snapshot');
select is((select count(*)::integer from app_private.signal_input_changes where source='signal_reviews' and after_value->>'episodeId'=pg_temp.review_id(2)::text),0,
 'audit failure leaves no REVIEW change');
select ok((select lease_token is null and lease_until is null from app_private.signal_jobs where lane_id='79100000-0000-4000-8000-000000000001'),
 'audit failure releases no stale reservation');
drop trigger review_audit_failure on app.audit_events;
set local role alunza_app;
select is(pg_temp.review_signal(2)->>'state','REVIEWED','request safely succeeds after persistence recovers');

-- Create an actual worker snapshot and pending continuation at an older cut.
select set_config('app.actor_id','',true),set_config('app.session_id','',true),set_config('app.organization_id','',true);
insert into review_state values('lease',app_private.signal_claim_job('79100000-0000-4000-8000-000000000001'));
insert into review_state values('workerSnapshot',app_private.signal_capture_snapshot('79100000-0000-4000-8000-000000000001',
 (select (value->>'leaseToken')::uuid from review_state where name='lease')));
reset role;
update app_private.signal_jobs set lease_token=null,lease_until=null,
 continuation=jsonb_build_object('revision',(select value->'snapshot'->>'revision' from review_state where name='workerSnapshot'),
 'targetThrough',clock_timestamp()-interval '1 minute') where lane_id='79100000-0000-4000-8000-000000000001';
insert into review_state values('oldContinuation',(select continuation from app_private.signal_jobs where lane_id='79100000-0000-4000-8000-000000000001'));
set local role alunza_app;
select pg_temp.review_actor(2);
insert into review_state values('current',pg_temp.review_signal(3));
reset role;
select ok((select (value->>'reviewedAt')::timestamptz from review_state where name='current')>
 (select (value->>'targetThrough')::timestamptz from review_state where name='oldContinuation'),'review captures now instead of resuming an old worker cutoff');
select ok((select continuation is null from app_private.signal_jobs where lane_id='79100000-0000-4000-8000-000000000001'),
 'review invalidates the old continuation without advancing the checkpoint');
select ok((select through_time is null from app_private.signal_jobs where lane_id='79100000-0000-4000-8000-000000000001'),'review does not fabricate worker progress');
select is((select stopped_at from app_private.signal_episodes where id=pg_temp.review_id(3)),
 (select reviewed_at from app_private.signal_episodes where id=pg_temp.review_id(3)),'review stops an accumulating episode at the review instant');

-- Revocation applies even to a previously completed idempotent request.
update app.class_memberships set ended_at=clock_timestamp() where class_id='74000000-0000-4000-8000-000000000001' and user_id='71000000-0000-4000-8000-000000000003';
set local role alunza_app;
select throws_ok($$select pg_temp.review_signal()$$,'P0001','RESOURCE_NOT_FOUND','retired student cannot be reviewed again');
select is(app_private.dashboard_signal('74000000-0000-4000-8000-000000000001',pg_temp.review_id(1),'{}')->'signal'->>'currentMember',
 'false','historical signal remains readable for an enrolled-then-retired student');
reset role;
update app.class_memberships set ended_at=null where class_id='74000000-0000-4000-8000-000000000001' and user_id='71000000-0000-4000-8000-000000000003';
update app.organization_memberships set state='DISABLED' where organization_id='72000000-0000-4000-8000-000000000001' and user_id='71000000-0000-4000-8000-000000000003';
set local role alunza_app;
select throws_ok($$select pg_temp.review_signal()$$,'P0001','RESOURCE_NOT_FOUND','disabled student membership prevents replay disclosure');
reset role;
update app.organization_memberships set state='ACTIVE' where organization_id='72000000-0000-4000-8000-000000000001' and user_id='71000000-0000-4000-8000-000000000003';
update app.profiles set account_state='DISABLED' where id='71000000-0000-4000-8000-000000000003';
set local role alunza_app;
select throws_ok($$select pg_temp.review_signal()$$,'P0001','RESOURCE_NOT_FOUND','disabled student account prevents replay');
reset role;
update app.profiles set account_state='ACTIVE' where id='71000000-0000-4000-8000-000000000003';
update app.organization_memberships set state='DISABLED' where organization_id='72000000-0000-4000-8000-000000000001' and user_id='71000000-0000-4000-8000-000000000002';
set local role alunza_app;
select throws_ok($$select pg_temp.review_signal()$$,'P0001','RESOURCE_NOT_FOUND','disabled teacher membership prevents replay');
reset role;
update app.organization_memberships set state='ACTIVE' where organization_id='72000000-0000-4000-8000-000000000001' and user_id='71000000-0000-4000-8000-000000000002';
update app.profiles set display_name='Nombre actualizado',account_state='DISABLED' where id='71000000-0000-4000-8000-000000000002';
set local role alunza_app;
select throws_ok($$select pg_temp.review_signal()$$,'P0001','RESOURCE_NOT_FOUND','disabled teacher account prevents replay');
reset role;
update app.classes set teacher_id='71000000-0000-4000-8000-000000000005' where id='74000000-0000-4000-8000-000000000001';
set local role alunza_app;
select pg_temp.review_actor(5);
insert into review_state values('nextTeacher',pg_temp.review_signal());
select is((select value-'reviewedByName' from review_state where name='nextTeacher'),
 (select value-'reviewedByName' from review_state where name='first'),'new assigned teacher receives first reviewer identity and instant');
select is((select value->>'reviewedByName' from review_state where name='nextTeacher'),'Nombre actualizado','reviewer name is its current label even when original reviewer is inactive');
reset role;
update app.activities set state='CLOSED' where id='77000000-0000-4000-8000-000000000001';
update app.classes set archived_at=clock_timestamp() where id='74000000-0000-4000-8000-000000000001';
set local role alunza_app;
select throws_ok($$select pg_temp.review_signal()$$,'P0001','RESOURCE_ARCHIVED','archived class remains read-only, including replay');
select is(app_private.dashboard_signal('74000000-0000-4000-8000-000000000001',pg_temp.review_id(1),'{}')->'signal'->>'state',
 'REVIEWED','archive preserves authorized historical review reads');
reset role;
select is((select count(*)::integer from app.audit_events where entity_id=pg_temp.review_id(1) and action='SIGNAL_REVIEWED'),1,
 'later reviewer, rename and revocation never duplicate the original audit');
select * from finish();
rollback;
