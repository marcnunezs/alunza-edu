BEGIN;

DO $alunza_preconditions$
BEGIN
  IF current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'Se requiere PostgreSQL 17 o posterior; validado en 17.6.';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Ejecutar como supabase_admin local o superusuario equivalente, con control de Auth.';
  END IF;
  IF to_regnamespace('app') IS NOT NULL OR to_regnamespace('app_private') IS NOT NULL THEN
    RAISE EXCEPTION 'El destino debe estar vacío: app o app_private ya existe. No se ha modificado el esquema.';
  END IF;
  IF to_regclass('auth.users') IS NULL OR to_regclass('auth.sessions') IS NULL THEN
    RAISE EXCEPTION 'Inicializar Supabase Auth antes: se requieren auth.users y auth.sessions.';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('postgres','anon','authenticated','service_role')) <> 4 THEN
    RAISE EXCEPTION 'Faltan roles de plataforma Supabase: postgres, anon, authenticated o service_role.';
  END IF;
END
$alunza_preconditions$;

-- Roles propios. Mismas definiciones y validaciones que las migraciones.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'alunza_app') then
    create role alunza_app login noinherit nosuperuser nocreatedb nocreaterole
      noreplication nobypassrls;
  end if;
end
$$;


do $$
begin
  if exists (
    select 1 from pg_catalog.pg_roles where rolname = 'alunza_app'
      and (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole
        or rolreplication or rolinherit or not rolcanlogin)
  ) then
    raise exception 'Existing alunza_app role has unexpected privileges';
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'alunza_identity') then
    create role alunza_identity nologin noinherit nosuperuser nocreatedb
      nocreaterole noreplication nobypassrls;
  end if;
  if exists (select 1 from pg_roles where rolname = 'alunza_identity'
    and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole
      or rolreplication or rolbypassrls)) then
    raise exception 'Unexpected identity helper role attributes';
  end if;
end $$;


-- Estado final reconstruido desde las migraciones, exportado con pg_dump 17.6.
--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: app; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA app;


ALTER SCHEMA app OWNER TO postgres;

--
-- Name: app_private; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA app_private;


ALTER SCHEMA app_private OWNER TO postgres;

--
-- Name: academic_resource_org(text, uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.academic_resource_org(kind text, target uuid) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare org uuid;
begin
  case kind
    when 'course' then select organization_id into org from app.courses where id=target;
    when 'class' then select organization_id into org from app.classes where id=target;
    when 'concept' then select organization_id into org from app.concepts where id=target;
    when 'exercise' then select organization_id into org from app.exercises where id=target;
    when 'activity' then select organization_id into org from app.activities where id=target;
    else return null;
  end case;
  if app_private.academic_role(org) is null then return null; end if;
  if kind='class' and not app_private.can_read_class(org,target) then return null; end if;
  if kind='activity' and not app_private.can_read_activity(org,target) then return null; end if;
  if kind='exercise' and not exists(select 1 from app.exercises e where e.id=target
      and (app_private.academic_role(org)='ADMIN' or app_private.can_read_exercise_version(org,e.current_version_id))) then return null; end if;
  return org;
end $$;


ALTER FUNCTION app_private.academic_resource_org(kind text, target uuid) OWNER TO alunza_identity;

--
-- Name: academic_role(uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.academic_role(org uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select m.role from app.organization_memberships m join app.profiles p on p.id=m.user_id
    join app.organizations o on o.id=m.organization_id
  where m.organization_id=org and m.user_id=app_private.actor_id() and m.state='ACTIVE' and p.account_state='ACTIVE'
    and o.archived_at is null and (app_private.organization_id() is null or app_private.organization_id()=org)
    and app_private.session_is_active(app_private.actor_id(),nullif(current_setting('app.session_id',true),'')::uuid)
$$;


ALTER FUNCTION app_private.academic_role(org uuid) OWNER TO alunza_identity;

--
-- Name: actor_id(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.actor_id() RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog'
    AS $$ select nullif(current_setting('app.actor_id', true), '')::uuid $$;


ALTER FUNCTION app_private.actor_id() OWNER TO alunza_identity;

--
-- Name: admit_practice_run(uuid, uuid, uuid, uuid, text, text, text, text, integer, text, uuid, boolean, integer, integer, integer); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.admit_practice_run(execution uuid, activity uuid, assignment uuid, version_id uuid, operation_key text, payload_digest text, code_digest text, suite_digest text, visible_count integer, runtime_version text, correlation uuid, runner_available boolean, actor_concurrency integer, organization_concurrency integer, actor_frequency integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
declare a record; k app.operation_keys%rowtype; e app.executions%rowtype;
 org uuid:=app_private.organization_id(); actor uuid:=app_private.actor_id(); ts timestamptz; op uuid:=gen_random_uuid(); token uuid:=gen_random_uuid();
begin
 if org is null or actor is null or app_private.academic_role(org) is distinct from 'STUDENT' then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 if actor_concurrency is null or organization_concurrency is null or actor_frequency is null or operation_key is null
  or actor_concurrency not between 1 and 10 or organization_concurrency not between 1 and 32 or actor_frequency not between 1 and 120
  or operation_key !~ '^[A-Za-z0-9._:-]{8,128}$' then
  raise exception using errcode='22023',message='INVALID_RUN_CONFIGURATION';
 end if;

 perform pg_advisory_xact_lock(hashtextextended('practice.actor:'||actor::text,0));
 perform app_private.lock_academic_organization(org);
 select act.*, c.archived_at as class_archived_at, ae.exercise_version_id into a
  from app.activities act join app.classes c on c.id=act.class_id and c.organization_id=act.organization_id
  join app.activity_exercises ae on ae.activity_id=act.id and ae.organization_id=act.organization_id
  where act.id=activity and ae.id=assignment and act.organization_id=org
   and act.state in ('PUBLISHED','CLOSED') and app_private.practice_student(act.class_id);
 if not found then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 if a.exercise_version_id<>version_id then raise exception using errcode='P0001',message='VERSION_CONFLICT'; end if;
 select * into k from app.operation_keys where organization_id=org and actor_id=actor and operation='practice.run' and key=operation_key for update;
 ts:=clock_timestamp();
 if found then
  if k.payload_hash<>payload_digest then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
  if k.expires_at<=ts then raise exception using errcode='P0001',message='IDEMPOTENCY_EXPIRED'; end if;
  if k.state<>'COMPLETED' then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
  if k.response_body is null then raise exception using errcode='P0001',message='IDEMPOTENCY_EXPIRED'; end if;
  return jsonb_build_object('kind','replay','response',k.response_body);
 end if;
 if a.state<>'PUBLISHED' then raise exception using errcode='P0001',message='ACTIVITY_CLOSED'; end if;
 if a.class_archived_at is not null then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
 if (a.opens_at is not null and ts<a.opens_at) or (a.closes_at is not null and ts>=a.closes_at) then
  raise exception using errcode='P0001',message='ACTIVITY_NOT_AVAILABLE';
 end if;
 if runner_available is distinct from true then raise exception using errcode='P0001',message='DEPENDENCY_UNAVAILABLE'; end if;
 if (select count(*) from app.executions where organization_id=org and student_id=actor and lifecycle_status<>'COMPLETED')>=actor_concurrency
  or ((select count(*) from app.executions where organization_id=org and lifecycle_status<>'COMPLETED')+(select count(*) from app_private.submission_reservations where organization_id=org and lifecycle_status<>'COMPLETED'))>=organization_concurrency
  or ((select count(*) from app.executions where organization_id=org and student_id=actor and admitted_at>ts-interval '1 minute')+(select count(*) from app_private.submission_reservations where organization_id=org and student_id=actor and admitted_at>ts-interval '1 minute'))>=actor_frequency then
  raise exception using errcode='P0001',message='RATE_LIMITED';
 end if;
 if visible_count<>(select count(*) from app_private.exercise_tests where exercise_version_id=version_id and visibility='VISIBLE') then
  raise exception using errcode='23514',message='VISIBLE_SUITE_MISMATCH';
 end if;
 insert into app.operation_keys(id,organization_id,actor_id,operation,key,payload_hash,state,resource_type,resource_id,expires_at,lease_until)
 values(op,org,actor,'practice.run',operation_key,payload_digest,'RUNNING','execution',execution,ts+interval '24 hours',ts+interval '60 seconds');
 insert into app.executions(id,organization_id,class_id,activity_id,activity_exercise_id,exercise_version_id,student_id,operation_id,
  code_hash,test_suite_hash,limits_snapshot,runner_version,visible_total,admitted_at,started_at,lease_until,lease_token,response_expires_at,request_id)
 values(execution,org,a.class_id,activity,assignment,version_id,actor,op,code_digest,suite_digest,
  (select app_private.practice_limits(v.execution_limits) from app.exercise_versions v where v.id=version_id and v.organization_id=org),runtime_version,visible_count,ts,ts,ts+interval '60 seconds',token,ts+interval '24 hours',correlation)
 returning * into e;
 return jsonb_build_object('kind','reserved','executionId',e.id,'exerciseVersionId',e.exercise_version_id,'organizationId',e.organization_id,
  'studentId',e.student_id,'admittedAt',e.admitted_at,'leaseToken',e.lease_token,'visibleTotal',e.visible_total,'runnerVersion',e.runner_version);
end $_$;


ALTER FUNCTION app_private.admit_practice_run(execution uuid, activity uuid, assignment uuid, version_id uuid, operation_key text, payload_digest text, code_digest text, suite_digest text, visible_count integer, runtime_version text, correlation uuid, runner_available boolean, actor_concurrency integer, organization_concurrency integer, actor_frequency integer) OWNER TO alunza_identity;

--
-- Name: admit_practice_submit(uuid, uuid, uuid, uuid, text, text, text, uuid, text, uuid, boolean, integer, integer, integer); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.admit_practice_submit(execution uuid, activity uuid, assignment uuid, version_id uuid, operation_key text, payload_digest text, source_code text, previous_attempt uuid, runtime_version text, correlation uuid, runner_available boolean, actor_concurrency integer, organization_concurrency integer, actor_frequency integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
declare a record; k app.operation_keys%rowtype; s app_private.submission_reservations%rowtype;
 org uuid:=app_private.organization_id(); actor uuid:=app_private.actor_id(); ts timestamptz; op uuid:=gen_random_uuid(); token uuid:=gen_random_uuid();
 tests jsonb; visible_count integer; total_count integer; next_number integer;
begin
 if org is null or actor is null or app_private.academic_role(org) is distinct from 'STUDENT' then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 if actor_concurrency is null or organization_concurrency is null or actor_frequency is null or operation_key is null
  or actor_concurrency not between 1 and 10 or organization_concurrency not between 1 and 32 or actor_frequency not between 1 and 120
  or operation_key !~ '^[A-Za-z0-9._:-]{8,128}$' or payload_digest is null or payload_digest !~ '^[a-f0-9]{64}$'
  or source_code is null or octet_length(source_code) not between 1 and 65536 then
  raise exception using errcode='22023',message='INVALID_SUBMIT_CONFIGURATION';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('practice.actor:'||actor::text,0));
 perform app_private.lock_academic_organization(org);
 select act.*,c.archived_at as class_archived_at,ae.exercise_version_id into a
  from app.activities act join app.classes c on c.id=act.class_id and c.organization_id=act.organization_id
  join app.activity_exercises ae on ae.activity_id=act.id and ae.organization_id=act.organization_id
  where act.id=activity and ae.id=assignment and act.organization_id=org
   and act.state in ('PUBLISHED','CLOSED') and app_private.practice_student(act.class_id);
 if not found then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 if a.exercise_version_id<>version_id then raise exception using errcode='P0001',message='VERSION_CONFLICT'; end if;
 select * into k from app.operation_keys where organization_id=org and actor_id=actor and operation='practice.submit' and key=operation_key for update;
 ts:=clock_timestamp();
 if found then
  if k.payload_hash<>payload_digest then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
  if k.expires_at<=ts then raise exception using errcode='P0001',message='IDEMPOTENCY_EXPIRED'; end if;
  if k.state<>'COMPLETED' then raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS'; end if;
  if k.response_body is null then raise exception using errcode='P0001',message='IDEMPOTENCY_EXPIRED'; end if;
  return jsonb_build_object('kind','replay','response',k.response_body);
 end if;
 if a.state<>'PUBLISHED' then raise exception using errcode='P0001',message='ACTIVITY_CLOSED'; end if;
 if a.class_archived_at is not null then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
 if (a.opens_at is not null and ts<a.opens_at) or (a.closes_at is not null and ts>=a.closes_at) then
  raise exception using errcode='P0001',message='ACTIVITY_NOT_AVAILABLE';
 end if;
 if previous_attempt is not null and not exists(select 1 from app.attempts p where p.id=previous_attempt
  and p.organization_id=org and p.student_id=actor and p.activity_exercise_id=assignment and p.exercise_version_id=version_id) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 if runner_available is distinct from true then raise exception using errcode='P0001',message='DEPENDENCY_UNAVAILABLE'; end if;
 if (select count(*) from app_private.submission_reservations where organization_id=org and student_id=actor and lifecycle_status<>'COMPLETED')>=actor_concurrency
  or ((select count(*) from app.executions where organization_id=org and lifecycle_status<>'COMPLETED')
      +(select count(*) from app_private.submission_reservations where organization_id=org and lifecycle_status<>'COMPLETED'))>=organization_concurrency
  or ((select count(*) from app.executions where organization_id=org and student_id=actor and admitted_at>ts-interval '1 minute')
      +(select count(*) from app_private.submission_reservations where organization_id=org and student_id=actor and admitted_at>ts-interval '1 minute'))>=actor_frequency then
  raise exception using errcode='P0001',message='RATE_LIMITED';
 end if;
 select jsonb_agg(jsonb_build_object('id',id,'visibility',lower(visibility),'args',args,'expected',expected) order by position),
  count(*) filter(where visibility='VISIBLE'),count(*) into tests,visible_count,total_count
  from app_private.exercise_tests where organization_id=org and exercise_version_id=version_id;
 if visible_count<1 or total_count not between 1 and 8 then raise exception using errcode='23514',message='INVALID_SUBMIT_SUITE'; end if;
 select coalesce(max(attempt_number),0)+1 into next_number from app_private.submission_reservations
  where organization_id=org and student_id=actor and activity_exercise_id=assignment;
 insert into app.operation_keys(id,organization_id,actor_id,operation,key,payload_hash,state,resource_type,resource_id,expires_at,lease_until)
 values(op,org,actor,'practice.submit',operation_key,payload_digest,'RUNNING','submission',execution,ts+interval '24 hours',ts+interval '60 seconds');
 insert into app_private.submission_reservations(id,organization_id,class_id,activity_id,activity_exercise_id,exercise_version_id,student_id,operation_id,
  code,code_hash,test_suite_hash,limits_snapshot,runner_version,visible_total,total_required,attempt_number,previous_attempt_id,admitted_at,lease_until,lease_token,response_expires_at,request_id)
 values(execution,org,a.class_id,activity,assignment,version_id,actor,op,source_code,encode(sha256(convert_to(source_code,'UTF8')),'hex'),
  encode(sha256(convert_to(tests::text,'UTF8')),'hex'),(select app_private.practice_limits(v.execution_limits) from app.exercise_versions v where v.id=version_id and v.organization_id=org),runtime_version,
  visible_count,total_count,next_number,previous_attempt,ts,ts+interval '60 seconds',token,ts+interval '24 hours',correlation)
 returning * into s;
 return app_private.submission_reservation_payload(s)||jsonb_build_object('kind','reserved');
end $_$;


ALTER FUNCTION app_private.admit_practice_submit(execution uuid, activity uuid, assignment uuid, version_id uuid, operation_key text, payload_digest text, source_code text, previous_attempt uuid, runtime_version text, correlation uuid, runner_available boolean, actor_concurrency integer, organization_concurrency integer, actor_frequency integer) OWNER TO alunza_identity;

--
-- Name: assert_academic_version_complete(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.assert_academic_version_complete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare current_id uuid;
begin
  if TG_TABLE_NAME='concepts' then select current_version_id into current_id from app.concepts where id=new.id;
  else select current_version_id into current_id from app.exercises where id=new.id; end if;
  if current_id is null then raise exception using errcode='23514',message='VERSION_REQUIRED'; end if;
  return null;
end $$;


ALTER FUNCTION app_private.assert_academic_version_complete() OWNER TO alunza_identity;

--
-- Name: assert_provisioning_complete(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.assert_provisioning_complete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if session_user = 'alunza_app' and not exists (
    select 1 from app.provisioning_grants g
      join app.organization_memberships m on m.organization_id = g.consumed_organization_id
        and m.user_id = g.user_id
      where g.consumed_organization_id = new.id and g.consumed_at is not null
        and g.user_id = app_private.actor_id() and m.role = 'ADMIN' and m.state = 'ACTIVE') then
    raise exception using errcode = 'P0001', message = 'PROVISIONING_INCOMPLETE';
  end if;
  return null;
end $$;


ALTER FUNCTION app_private.assert_provisioning_complete() OWNER TO alunza_identity;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: attempts; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    execution_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    class_id uuid NOT NULL,
    activity_id uuid NOT NULL,
    activity_exercise_id uuid NOT NULL,
    exercise_version_id uuid NOT NULL,
    student_id uuid NOT NULL,
    code text NOT NULL,
    code_hash text NOT NULL,
    test_suite_hash text NOT NULL,
    attempt_number integer NOT NULL,
    previous_attempt_id uuid,
    admitted_at timestamp with time zone NOT NULL,
    submitted_at timestamp with time zone NOT NULL,
    technical_result jsonb NOT NULL,
    CONSTRAINT attempts_attempt_number_check CHECK ((attempt_number > 0)),
    CONSTRAINT attempts_check CHECK ((submitted_at >= admitted_at)),
    CONSTRAINT attempts_code_check CHECK (((octet_length(code) >= 1) AND (octet_length(code) <= 65536))),
    CONSTRAINT attempts_code_hash_check CHECK ((code_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT attempts_test_suite_hash_check CHECK ((test_suite_hash ~ '^[a-f0-9]{64}$'::text))
);

ALTER TABLE ONLY app.attempts FORCE ROW LEVEL SECURITY;


ALTER TABLE app.attempts OWNER TO postgres;

--
-- Name: attempt_payload(app.attempts); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.attempt_payload(a app.attempts) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog'
    AS $$
 select jsonb_build_object('attemptId',a.id,'executionId',a.execution_id,'activityId',a.activity_id,'assignmentId',a.activity_exercise_id,
  'exerciseVersionId',a.exercise_version_id,'testsVersion',a.test_suite_hash,'attemptNumber',a.attempt_number,'previousAttemptId',a.previous_attempt_id,
  'admittedAt',a.admitted_at,'submittedAt',a.submitted_at,'code',a.code,'technicalResult',a.technical_result)
$$;


ALTER FUNCTION app_private.attempt_payload(a app.attempts) OWNER TO alunza_identity;

--
-- Name: audit_append_only(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.audit_append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$ begin raise exception using errcode = '42501', message = 'AUDIT_APPEND_ONLY'; end $$;


ALTER FUNCTION app_private.audit_append_only() OWNER TO alunza_identity;

--
-- Name: can_admin(uuid, boolean); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.can_admin(org uuid, include_archived boolean DEFAULT false) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select org = app_private.organization_id() and exists (
    select 1 from app.organization_memberships m join app.profiles p on p.id = m.user_id
      join app.organizations o on o.id = m.organization_id
    where m.organization_id = org and m.user_id = app_private.actor_id()
      and m.role = 'ADMIN' and m.state = 'ACTIVE' and p.account_state = 'ACTIVE'
      and (include_archived or o.archived_at is null))
    and (coalesce(current_setting('app.worker', true), '') <> 'true' or exists (
      select 1 from app.invitation_deliveries d
      where d.id = nullif(current_setting('app.delivery_id', true), '')::uuid
        and d.lease_token = nullif(current_setting('app.delivery_lease_token', true), '')::uuid
        and d.organization_id = org and d.requested_by = app_private.actor_id()
        and d.state = 'RUNNING' and d.lease_until > statement_timestamp()))
$$;


ALTER FUNCTION app_private.can_admin(org uuid, include_archived boolean) OWNER TO alunza_identity;

--
-- Name: can_manage_class(uuid, uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.can_manage_class(org uuid, target uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select app_private.academic_role(org)='TEACHER' and exists (
    select 1 from app.classes c where c.organization_id=org and c.id=target and c.teacher_id=app_private.actor_id() and c.archived_at is null)
$$;


ALTER FUNCTION app_private.can_manage_class(org uuid, target uuid) OWNER TO alunza_identity;

--
-- Name: can_read_activity(uuid, uuid, boolean); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.can_read_activity(org uuid, target uuid, content boolean DEFAULT false) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select exists(select 1 from app.activities a join app.classes c on c.organization_id=a.organization_id and c.id=a.class_id
    where a.organization_id=org and a.id=target and app_private.can_read_class(org,a.class_id)
      and (app_private.academic_role(org) in ('ADMIN','TEACHER') or
        (a.state='PUBLISHED' and (not content or
          (c.archived_at is null and (a.opens_at is null or a.opens_at<=statement_timestamp()) and (a.closes_at is null or a.closes_at>statement_timestamp()))))))
$$;


ALTER FUNCTION app_private.can_read_activity(org uuid, target uuid, content boolean) OWNER TO alunza_identity;

--
-- Name: can_read_class(uuid, uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.can_read_class(org uuid, target uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select case app_private.academic_role(org)
    when 'ADMIN' then true
    when 'TEACHER' then exists(select 1 from app.classes c where c.organization_id=org and c.id=target and c.teacher_id=app_private.actor_id())
    when 'STUDENT' then exists(select 1 from app.class_memberships m where m.organization_id=org and m.class_id=target and m.user_id=app_private.actor_id() and m.state='ACTIVE')
    else false end
$$;


ALTER FUNCTION app_private.can_read_class(org uuid, target uuid) OWNER TO alunza_identity;

--
-- Name: can_read_exercise_version(uuid, uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.can_read_exercise_version(org uuid, target uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select exists(select 1 from app.exercise_versions v join app.exercises e on e.organization_id=v.organization_id and e.id=v.exercise_id
    where v.organization_id=org and v.id=target and (
      app_private.academic_role(org)='ADMIN' or
      (app_private.academic_role(org)='TEACHER' and (e.owner_id=app_private.actor_id() or e.visibility='ORGANIZATION' or
        exists(select 1 from app.activity_exercises ae where ae.organization_id=org and ae.exercise_version_id=target and app_private.can_read_activity(org,ae.activity_id,true)))) or
      (app_private.academic_role(org)='STUDENT' and exists(select 1 from app.activity_exercises ae
        where ae.organization_id=org and ae.exercise_version_id=target and app_private.can_read_activity(org,ae.activity_id,true)))))
$$;


ALTER FUNCTION app_private.can_read_exercise_version(org uuid, target uuid) OWNER TO alunza_identity;

--
-- Name: can_read_organization(uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.can_read_organization(org uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select (app_private.organization_id() is null or app_private.organization_id() = org)
    and exists (select 1 from app.organization_memberships m
      join app.profiles p on p.id = m.user_id join app.organizations o on o.id = m.organization_id
      where m.organization_id = org and m.user_id = app_private.actor_id()
      and m.state = 'ACTIVE' and p.account_state = 'ACTIVE'
      and (o.archived_at is null or m.role = 'ADMIN'))
$$;


ALTER FUNCTION app_private.can_read_organization(org uuid) OWNER TO alunza_identity;

--
-- Name: claim_expired_practice_run(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.claim_expired_practice_run() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare e app.executions%rowtype; ts timestamptz:=clock_timestamp();
begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 select * into e from app.executions where lifecycle_status<>'COMPLETED' and lease_until<=ts order by lease_until,id for update skip locked limit 1;
 if not found then return null; end if;
 update app.executions set lifecycle_status='RECOVERING',lease_token=gen_random_uuid(),lease_until=ts+interval '60 seconds' where id=e.id returning * into e;
 return jsonb_build_object('executionId',e.id,'exerciseVersionId',e.exercise_version_id,'organizationId',e.organization_id,'studentId',e.student_id,
  'admittedAt',e.admitted_at,'leaseToken',e.lease_token,'visibleTotal',e.visible_total,'runnerVersion',e.runner_version);
end $$;


ALTER FUNCTION app_private.claim_expired_practice_run() OWNER TO alunza_identity;

--
-- Name: claim_expired_practice_submit(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.claim_expired_practice_submit() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare s app_private.submission_reservations%rowtype; ts timestamptz:=clock_timestamp();
begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 select * into s from app_private.submission_reservations where lifecycle_status<>'COMPLETED' and lease_until<=ts order by lease_until,id for update skip locked limit 1;
 if not found then return null; end if;
 update app_private.submission_reservations set lifecycle_status='RECOVERING',lease_token=gen_random_uuid(),lease_until=ts+interval '60 seconds' where id=s.id returning * into s;
 return app_private.submission_reservation_payload(s);
end $$;


ALTER FUNCTION app_private.claim_expired_practice_submit() OWNER TO alunza_identity;

--
-- Name: invitation_deliveries; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.invitation_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invitation_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    kind text NOT NULL,
    state text DEFAULT 'QUEUED'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_until timestamp with time zone,
    lease_token uuid,
    last_error_code text,
    auth_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT invitation_deliveries_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT invitation_deliveries_kind_check CHECK ((kind = ANY (ARRAY['INITIAL'::text, 'RESEND'::text, 'RENEW'::text]))),
    CONSTRAINT invitation_deliveries_last_error_code_check CHECK (((last_error_code IS NULL) OR (last_error_code ~ '^[A-Z0-9_]{1,80}$'::text))),
    CONSTRAINT invitation_deliveries_state_check CHECK ((state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'SENT'::text, 'UNCERTAIN'::text, 'FAILED'::text, 'CANCELLED'::text])))
);

ALTER TABLE ONLY app.invitation_deliveries FORCE ROW LEVEL SECURITY;


ALTER TABLE app.invitation_deliveries OWNER TO postgres;

--
-- Name: claim_invitation_delivery(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.claim_invitation_delivery() RETURNS SETOF app.invitation_deliveries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare claimed_org uuid;
begin

  select o.id into claimed_org from app.organizations o
    join app.invitation_deliveries d on d.organization_id = o.id
    where (d.state in ('QUEUED','UNCERTAIN') and d.available_at <= statement_timestamp())
      or (d.state = 'RUNNING' and d.lease_until <= statement_timestamp())
    order by d.available_at, d.id for update of o skip locked limit 1;
  if claimed_org is null then return; end if;
  return query
  with next_job as (
    select d.id from app.invitation_deliveries d
    where d.organization_id = claimed_org and
      ((d.state in ('QUEUED','UNCERTAIN') and d.available_at <= statement_timestamp())
      or (d.state = 'RUNNING' and d.lease_until <= statement_timestamp()))
    order by d.available_at, d.id for update skip locked limit 1
  )
  update app.invitation_deliveries d set state = 'RUNNING',
    attempt_count = d.attempt_count + 1,
    lease_until = statement_timestamp() + interval '90 seconds',
    lease_token = gen_random_uuid(), updated_at = statement_timestamp()
  from next_job n where d.id = n.id returning d.*;
end $$;


ALTER FUNCTION app_private.claim_invitation_delivery() OWNER TO alunza_identity;

--
-- Name: count_class_enrollment(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.count_class_enrollment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if app_private.actor_id() is not null or session_user='alunza_app' then
    update app.class_join_codes set uses_count=uses_count+1
      where organization_id=new.organization_id and class_id=new.class_id
        and token_digest=nullif(current_setting('app.class_join_digest',true),'');
  end if;
  return null;
end $$;


ALTER FUNCTION app_private.count_class_enrollment() OWNER TO alunza_identity;

--
-- Name: current_auth_email(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.current_auth_email() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select lower(btrim(u.email)) from auth.users u
  where u.id = app_private.actor_id() and u.email_confirmed_at is not null
    and app_private.session_is_active(u.id, nullif(current_setting('app.session_id', true), '')::uuid)
$$;


ALTER FUNCTION app_private.current_auth_email() OWNER TO alunza_identity;

--
-- Name: finish_practice_run(uuid, uuid, jsonb, boolean); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.finish_practice_run(execution uuid, token uuid, technical_result jsonb, cleaned boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare e app.executions%rowtype; response jsonb; ts timestamptz;
begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 select * into e from app.executions where id=execution for update;
 -- Waiting for this lock may consume the lease. Never authorize completion
 -- with a timestamp captured before the row became available.
 ts:=clock_timestamp();
 if not found or token is distinct from e.lease_token or e.lifecycle_status='COMPLETED' or e.lease_until<=ts then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS';
 end if;
 if cleaned is distinct from true then
  update app.executions set lifecycle_status='RECOVERING',lease_until=ts+interval '15 seconds',lease_token=gen_random_uuid() where id=e.id;
  return null;
 end if;
 if technical_result is null or jsonb_typeof(technical_result)<>'object' then
  raise exception using errcode='23514',message='INVALID_RUN_RESULT';
 end if;
 if not (technical_result ?& array['runnerVersion','diagnosisCode','terminationReason','infrastructureStatus','visibleTestResults','visiblePassed','visibleTotal','outputTruncated','outputBytes','runtimeMs','lifecycleMs'])
  or (select count(*) from jsonb_object_keys(technical_result))<>11
  or exists(select 1 from jsonb_each(technical_result) x where
   (x.key in ('runnerVersion','diagnosisCode','terminationReason','infrastructureStatus') and jsonb_typeof(x.value)<>'string')
   or (x.key in ('visiblePassed','visibleTotal','outputBytes','runtimeMs','lifecycleMs') and jsonb_typeof(x.value)<>'number')
   or (x.key='visibleTestResults' and jsonb_typeof(x.value)<>'array')
   or (x.key='outputTruncated' and jsonb_typeof(x.value)<>'boolean')) then
  raise exception using errcode='23514',message='INVALID_RUN_RESULT';
 end if;
 if technical_result->>'runnerVersion'<>e.runner_version
  or technical_result->>'diagnosisCode' not in ('SUCCESS','SYNTAX_ERROR','RUNTIME_ERROR','FAILED_TEST','TIMEOUT','UNKNOWN')
  or technical_result->>'terminationReason' not in ('COMPLETED','STUDENT_SYNTAX','STUDENT_EXCEPTION','ASSERTION_FAILED','EXECUTION_DEADLINE','MEMORY_LIMIT','OUTPUT_LIMIT','RETURN_LIMIT','PROTOCOL_INVALID','RUNNER_FAILURE','PROVIDER_FAILURE','CAPABILITY_GAP','CANCELLED')
  or technical_result->>'infrastructureStatus' not in ('OK','FAILED')
  or (technical_result->>'visibleTotal')::numeric<>e.visible_total
  or jsonb_array_length(technical_result->'visibleTestResults')>e.visible_total
  or (technical_result->>'visiblePassed')::numeric not between 0 and e.visible_total
  or (technical_result->>'outputBytes')::numeric not between 0 and (e.limits_snapshot->>'outputBytes')::numeric
  or mod((technical_result->>'outputBytes')::numeric,1)<>0
  or (technical_result->>'runtimeMs')::numeric<0 or (technical_result->>'lifecycleMs')::numeric<0
  or (technical_result->>'infrastructureStatus'='FAILED' and technical_result->>'diagnosisCode'<>'UNKNOWN') then
  raise exception using errcode='23514',message='INVALID_RUN_RESULT';
 end if;
 if exists(select 1 from jsonb_array_elements(technical_result->'visibleTestResults') t where jsonb_typeof(t)<>'object') then
  raise exception using errcode='23514',message='INVALID_RUN_RESULT';
 end if;
 if exists(select 1 from jsonb_array_elements(technical_result->'visibleTestResults') t where
  not(t ?& array['id','passed','stdout','stderr']) or (select count(*) from jsonb_object_keys(t))<>4
  or jsonb_typeof(t->'id')<>'string' or jsonb_typeof(t->'passed')<>'boolean'
  or jsonb_typeof(t->'stdout')<>'string' or jsonb_typeof(t->'stderr')<>'string'
  or not exists(select 1 from app_private.exercise_tests et where et.exercise_version_id=e.exercise_version_id and et.visibility='VISIBLE' and et.id::text=t->>'id'))
  or (select count(distinct t->>'id') from jsonb_array_elements(technical_result->'visibleTestResults') t)<>jsonb_array_length(technical_result->'visibleTestResults')
  or (select count(*) from jsonb_array_elements(technical_result->'visibleTestResults') t where t->'passed'='true'::jsonb)<>(technical_result->>'visiblePassed')::numeric
  or (select coalesce(sum(octet_length(t->>'stdout')+octet_length(t->>'stderr')),0) from jsonb_array_elements(technical_result->'visibleTestResults') t)>(technical_result->>'outputBytes')::numeric
  or (technical_result->>'diagnosisCode'='SUCCESS' and ((technical_result->>'visiblePassed')::numeric<>e.visible_total
   or jsonb_array_length(technical_result->'visibleTestResults')<>e.visible_total or technical_result->>'infrastructureStatus'<>'OK'
   or technical_result->>'terminationReason'<>'COMPLETED' or technical_result->'outputTruncated'<>'false'::jsonb)) then
  raise exception using errcode='23514',message='INVALID_RUN_RESULT';
 end if;
 response:=jsonb_build_object('executionId',e.id,'exerciseVersionId',e.exercise_version_id,'mode','RUN','admittedAt',e.admitted_at,'finishedAt',ts,'technicalResult',technical_result);
 update app.executions set lifecycle_status='COMPLETED',finished_at=ts,lease_until=null,response_body=response,cleanup_verified=true where id=e.id;
 update app.operation_keys set state='COMPLETED',response_status=201,response_body=response,lease_until=null,updated_at=ts where id=e.operation_id;
 return response;
end $$;


ALTER FUNCTION app_private.finish_practice_run(execution uuid, token uuid, technical_result jsonb, cleaned boolean) OWNER TO alunza_identity;

--
-- Name: finish_practice_submit(uuid, uuid, boolean); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.finish_practice_submit(execution uuid, token uuid, cleaned boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare s app_private.submission_reservations%rowtype; a app.attempts%rowtype; response jsonb; ts timestamptz;
begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 select * into s from app_private.submission_reservations where id=execution for update;
 -- Check the lease against the clock after any row-lock wait.
 ts:=clock_timestamp();
 if not found or token is distinct from s.lease_token or s.lifecycle_status='COMPLETED' or s.lease_until<=ts then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS';
 end if;
 if cleaned is distinct from true then
  update app_private.submission_reservations set lifecycle_status='RECOVERING',lease_until=greatest(ts+interval '15 seconds',s.admitted_at+interval '60 seconds'),lease_token=gen_random_uuid() where id=s.id;
  return null;
 end if;
 if s.staged_result is null then raise exception using errcode='23514',message='SUBMIT_RESULT_REQUIRED'; end if;
 insert into app.attempts(execution_id,organization_id,class_id,activity_id,activity_exercise_id,exercise_version_id,student_id,
  code,code_hash,test_suite_hash,attempt_number,previous_attempt_id,admitted_at,submitted_at,technical_result)
 values(s.id,s.organization_id,s.class_id,s.activity_id,s.activity_exercise_id,s.exercise_version_id,s.student_id,
  s.code,s.code_hash,s.test_suite_hash,s.attempt_number,s.previous_attempt_id,s.admitted_at,ts,s.staged_result) returning * into a;
 insert into app_private.attempt_results(attempt_id,organization_id,runner_version,test_suite_hash,private_test_results)
 values(a.id,s.organization_id,s.runner_version,s.test_suite_hash,s.staged_private_results);
 insert into app_private.attempt_events(organization_id,class_id,activity_id,activity_exercise_id,exercise_version_id,student_id,attempt_id,event_type,occurred_at)
 select s.organization_id,s.class_id,s.activity_id,s.activity_exercise_id,s.exercise_version_id,s.student_id,a.id,event_type,ts
  from unnest(array['ATTEMPT_SUBMITTED','EXECUTION_COMPLETED']) event_type;
 response:=app_private.attempt_payload(a);
 update app_private.submission_reservations set lifecycle_status='COMPLETED',finished_at=ts,lease_until=null,response_body=response,cleanup_verified=true,attempt_id=a.id where id=s.id;
 update app.operation_keys set state='COMPLETED',resource_type='attempt',resource_id=a.id,response_status=201,response_body=response,lease_until=null,updated_at=ts where id=s.operation_id;
 return response;
end $$;


ALTER FUNCTION app_private.finish_practice_submit(execution uuid, token uuid, cleaned boolean) OWNER TO alunza_identity;

--
-- Name: guard_academic_entity(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_academic_entity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare selected_version app.concept_versions; selected_exercise app.exercise_versions; actor_role text;
begin
  actor_role:=app_private.academic_role(new.organization_id);
  if TG_OP='UPDATE' then
    if old.archived_at is not null and new is distinct from old then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
    new.revision:=old.revision+1; new.updated_at:=statement_timestamp();
  end if;
  if TG_TABLE_NAME='courses' then
    if TG_OP='UPDATE' and old.archived_at is null and new.archived_at is not null and exists(select 1 from app.classes where organization_id=new.organization_id and course_id=new.id and archived_at is null) then
      raise exception using errcode='P0001',message='DEPENDENCIES_ACTIVE'; end if;
  elsif TG_TABLE_NAME='classes' then
    if not exists(select 1 from app.courses where organization_id=new.organization_id and id=new.course_id and archived_at is null) then raise exception using errcode='P0001',message='COURSE_UNAVAILABLE'; end if;
    if (TG_OP='INSERT' or new.archived_at is null or new.teacher_id is distinct from old.teacher_id) and
      not exists(select 1 from app.organization_memberships m join app.profiles p on p.id=m.user_id where m.organization_id=new.organization_id and m.user_id=new.teacher_id and m.role='TEACHER' and m.state='ACTIVE' and p.account_state='ACTIVE') then raise exception using errcode='P0001',message='TEACHER_UNAVAILABLE'; end if;
    if TG_OP='UPDATE' and new.teacher_id is distinct from old.teacher_id and actor_role is distinct from 'ADMIN' then raise exception using errcode='42501',message='FORBIDDEN'; end if;
    if TG_OP='UPDATE' and old.archived_at is null and new.archived_at is not null then
      if actor_role is distinct from 'ADMIN' then raise exception using errcode='42501',message='FORBIDDEN'; end if;
      if exists(select 1 from app.activities where organization_id=new.organization_id and class_id=new.id and state='PUBLISHED') then raise exception using errcode='P0001',message='DEPENDENCIES_ACTIVE'; end if;
      update app.class_join_codes set revoked_at=statement_timestamp(),revision=revision+1 where organization_id=new.organization_id and class_id=new.id and revoked_at is null;
    end if;
  elsif TG_TABLE_NAME='concepts' then
    if new.current_version_id is not null then
      select * into selected_version from app.concept_versions where organization_id=new.organization_id and concept_id=new.id and id=new.current_version_id;
      if not found or lower(btrim(regexp_replace(normalize(selected_version.name,NFKC),'\s+',' ','g')))<>new.normalized_name then raise exception using errcode='23514',message='CONCEPT_VERSION_INVALID'; end if;
      if exists(with recursive ancestors(id) as (
        select selected_version.parent_concept_id union
        select v.parent_concept_id from ancestors a join app.concepts c on c.id=a.id and c.organization_id=new.organization_id join app.concept_versions v on v.id=c.current_version_id)
        select 1 from ancestors where id=new.id) then raise exception using errcode='23514',message='CONCEPT_CYCLE'; end if;
      if TG_OP='UPDATE' and new.current_version_id is distinct from old.current_version_id and old.current_version_id is not null and
        selected_version.version <= (select version from app.concept_versions where id=old.current_version_id) then raise exception using errcode='23514',message='VERSION_NOT_NEWER'; end if;
    end if;
  elsif TG_TABLE_NAME='exercises' then
    if TG_OP='UPDATE' and new.owner_id<>old.owner_id then raise exception using errcode='23514',message='IMMUTABLE_OWNER'; end if;
    if TG_OP='UPDATE' and new.current_version_id is distinct from old.current_version_id then
      if actor_role='ADMIN' then raise exception using errcode='42501',message='FORBIDDEN'; end if;
      select * into selected_exercise from app.exercise_versions where organization_id=new.organization_id and exercise_id=new.id and id=new.current_version_id;
      if not found or not exists(select 1 from app_private.exercise_tests where organization_id=new.organization_id and exercise_version_id=selected_exercise.id and visibility='VISIBLE') or
        not exists(select 1 from app.exercise_version_concepts where organization_id=new.organization_id and exercise_version_id=selected_exercise.id) then raise exception using errcode='23514',message='EXERCISE_INCOMPLETE'; end if;
      if old.current_version_id is not null and selected_exercise.version <= (select version from app.exercise_versions where id=old.current_version_id) then raise exception using errcode='23514',message='VERSION_NOT_NEWER'; end if;
    end if;
  end if;
  return new;
end $$;


ALTER FUNCTION app_private.guard_academic_entity() OWNER TO alunza_identity;

--
-- Name: guard_academic_scope(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_academic_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare org uuid; archived timestamptz;
begin
  org:=case when TG_OP='DELETE' then old.organization_id else new.organization_id end;
  perform 1 from app.organizations where id=org for update;
  select archived_at into archived from app.organizations where id=org;
  if archived is not null then raise exception using errcode='P0001',message='ORGANIZATION_ARCHIVED'; end if;
  if TG_OP='UPDATE' and (new.id is distinct from old.id or new.organization_id is distinct from old.organization_id) then
    raise exception using errcode='23514',message='IMMUTABLE_SCOPE';
  end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end $$;


ALTER FUNCTION app_private.guard_academic_scope() OWNER TO alunza_identity;

--
-- Name: guard_academic_version(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_academic_version() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if TG_OP<>'INSERT' then raise exception using errcode='23514',message='IMMUTABLE_VERSION'; end if;
  if TG_TABLE_NAME='concept_versions' then
    if not exists(select 1 from app.concepts where organization_id=new.organization_id and id=new.concept_id and archived_at is null) then raise exception using errcode='23514',message='CONCEPT_UNAVAILABLE'; end if;
    if new.parent_concept_id is not null and not exists(select 1 from app.concepts where organization_id=new.organization_id and id=new.parent_concept_id and archived_at is null) then raise exception using errcode='23514',message='PARENT_UNAVAILABLE'; end if;
  else
    if not exists(select 1 from app.exercises where organization_id=new.organization_id and id=new.exercise_id and archived_at is null) then raise exception using errcode='23514',message='EXERCISE_UNAVAILABLE'; end if;
  end if;
  return new;
end $$;


ALTER FUNCTION app_private.guard_academic_version() OWNER TO alunza_identity;

--
-- Name: guard_activity(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_activity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if not exists(select 1 from app.classes where organization_id=new.organization_id and id=new.class_id and archived_at is null) then raise exception using errcode='P0001',message='CLASS_UNAVAILABLE'; end if;
  if TG_OP='INSERT' then
    if new.state<>'DRAFT' then raise exception using errcode='23514',message='ACTIVITY_TRANSITION_INVALID'; end if;
    return new;
  end if;
  if new.class_id<>old.class_id or new.created_by<>old.created_by then raise exception using errcode='23514',message='IMMUTABLE_SCOPE'; end if;
  if old.state='CLOSED' or (old.state='PUBLISHED' and (new.state<>'CLOSED' or
      (to_jsonb(new)-array['state','closed_at','revision','updated_at']) is distinct from (to_jsonb(old)-array['state','closed_at','revision','updated_at']))) then
    raise exception using errcode='23514',message='IMMUTABLE_PUBLICATION'; end if;
  if old.state='DRAFT' and new.state not in ('DRAFT','PUBLISHED') then raise exception using errcode='23514',message='ACTIVITY_TRANSITION_INVALID'; end if;
  if old.state='DRAFT' and new.state='PUBLISHED' then
    if not exists(select 1 from app.activity_exercises where organization_id=new.organization_id and activity_id=new.id) then raise exception using errcode='23514',message='ACTIVITY_EMPTY'; end if;
    if exists(select 1 from app.activity_exercises ae join app.exercise_versions v on v.organization_id=ae.organization_id and v.id=ae.exercise_version_id
      join app.exercises e on e.organization_id=v.organization_id and e.id=v.exercise_id
      where ae.organization_id=new.organization_id and ae.activity_id=new.id and (e.archived_at is not null or e.current_version_id is null
        or not exists(select 1 from app_private.exercise_tests t where t.organization_id=ae.organization_id and t.exercise_version_id=v.id and t.visibility='VISIBLE')
        or not exists(select 1 from app.exercise_version_concepts ec where ec.organization_id=ae.organization_id and ec.exercise_version_id=v.id)
        or exists(select 1 from app.exercise_version_concepts ec join app.concepts c on c.organization_id=ec.organization_id and c.id=ec.concept_id where ec.organization_id=ae.organization_id and ec.exercise_version_id=v.id and c.archived_at is not null))) then
      raise exception using errcode='23514',message='PUBLICATION_CONTENT_UNAVAILABLE'; end if;
    new.published_at:=statement_timestamp(); new.closed_at:=null;
  elsif old.state='PUBLISHED' and new.state='CLOSED' then new.closed_at:=statement_timestamp();
  end if;
  new.revision:=old.revision+1; new.updated_at:=statement_timestamp();
  return new;
end $$;


ALTER FUNCTION app_private.guard_activity() OWNER TO alunza_identity;

--
-- Name: guard_activity_exercise(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_activity_exercise() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare org uuid; target uuid;
begin
  org:=case when TG_OP='DELETE' then old.organization_id else new.organization_id end;
  target:=case when TG_OP='DELETE' then old.activity_id else new.activity_id end;
  if not exists(select 1 from app.activities a join app.classes c on c.organization_id=a.organization_id and c.id=a.class_id
    where a.organization_id=org and a.id=target and a.state='DRAFT' and c.archived_at is null) then raise exception using errcode='23514',message='IMMUTABLE_PUBLICATION'; end if;
  if TG_OP='DELETE' then return old; end if;
  if not exists(select 1 from app.exercise_versions v join app.exercises e on e.organization_id=v.organization_id and e.id=v.exercise_id
    where v.organization_id=org and v.id=new.exercise_version_id and e.archived_at is null and e.current_version_id is not null
      and (e.owner_id=app_private.actor_id() or e.visibility='ORGANIZATION' or app_private.actor_id() is null)
      and v.version<=(select version from app.exercise_versions where id=e.current_version_id)) then raise exception using errcode='23514',message='EXERCISE_UNAVAILABLE'; end if;
  return new;
end $$;


ALTER FUNCTION app_private.guard_activity_exercise() OWNER TO alunza_identity;

--
-- Name: guard_attempt_context(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_attempt_context() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='IMMUTABLE_ATTEMPT'; end if;
 if not exists(select 1 from app_private.submission_reservations s where s.id=new.execution_id
  and row(s.organization_id,s.class_id,s.activity_id,s.activity_exercise_id,s.exercise_version_id,s.student_id,s.code,s.code_hash,s.test_suite_hash,s.attempt_number,s.previous_attempt_id,s.admitted_at,s.staged_result)
   is not distinct from row(new.organization_id,new.class_id,new.activity_id,new.activity_exercise_id,new.exercise_version_id,new.student_id,new.code,new.code_hash,new.test_suite_hash,new.attempt_number,new.previous_attempt_id,new.admitted_at,new.technical_result)
  and s.lifecycle_status<>'COMPLETED' and s.staged_result is not null) then
  raise exception using errcode='23514',message='ATTEMPT_CONTEXT_MISMATCH';
 end if;
 return new;
end $$;


ALTER FUNCTION app_private.guard_attempt_context() OWNER TO alunza_identity;

--
-- Name: guard_attempt_event(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_attempt_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='IMMUTABLE_ATTEMPT_EVENT'; end if;
 if not exists(select 1 from app.attempts a where a.id=new.attempt_id
  and row(a.organization_id,a.class_id,a.activity_id,a.activity_exercise_id,a.exercise_version_id,a.student_id,a.submitted_at)
   is not distinct from row(new.organization_id,new.class_id,new.activity_id,new.activity_exercise_id,new.exercise_version_id,new.student_id,new.occurred_at)) then
  raise exception using errcode='23514',message='ATTEMPT_EVENT_CONTEXT_MISMATCH';
 end if;
 return new;
end $$;


ALTER FUNCTION app_private.guard_attempt_event() OWNER TO alunza_identity;

--
-- Name: guard_attempt_result(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_attempt_result() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='IMMUTABLE_ATTEMPT_RESULT'; end if;
 if not exists(select 1 from app.attempts a join app_private.submission_reservations s on s.id=a.execution_id
  where a.id=new.attempt_id and a.organization_id=new.organization_id
   and s.runner_version=new.runner_version and s.test_suite_hash=new.test_suite_hash
   and s.staged_private_results=new.private_test_results) then
  raise exception using errcode='23514',message='ATTEMPT_RESULT_CONTEXT_MISMATCH';
 end if;
 return new;
end $$;


ALTER FUNCTION app_private.guard_attempt_result() OWNER TO alunza_identity;

--
-- Name: guard_class_code(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_class_code() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if TG_OP='INSERT' then
    if not exists(select 1 from app.classes where organization_id=new.organization_id and id=new.class_id and archived_at is null) then raise exception using errcode='P0001',message='CLASS_UNAVAILABLE'; end if;
  else
    if new.class_id<>old.class_id or new.token_digest<>old.token_digest or new.created_by<>old.created_by or new.created_at<>old.created_at or new.expires_at<>old.expires_at or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then raise exception using errcode='23514',message='IMMUTABLE_CODE'; end if;
    new.revision:=old.revision+1;
  end if;
  return new;
end $$;


ALTER FUNCTION app_private.guard_class_code() OWNER TO alunza_identity;

--
-- Name: guard_class_enrollment(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_class_enrollment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare join_id uuid;
begin
  if TG_OP<>'INSERT' then raise exception using errcode='23514',message='IMMUTABLE_ENROLLMENT'; end if;
  -- Technical fixture owners may seed explicitly; runtime always requires proof.
  if app_private.actor_id() is not null or session_user='alunza_app' then
    if new.user_id is distinct from app_private.actor_id() or app_private.academic_role(new.organization_id) is distinct from 'STUDENT' then raise exception using errcode='42501',message='FORBIDDEN'; end if;
    select p.id into join_id from app_private.preview_class_join_code(nullif(current_setting('app.class_join_digest',true),'')) p
      where p.organization_id=new.organization_id and p.class_id=new.class_id;
    if join_id is null then raise exception using errcode='P0001',message='JOIN_CODE_INVALID'; end if;
    new.joined_at:=statement_timestamp();
  end if;
  return new;
end $$;


ALTER FUNCTION app_private.guard_class_enrollment() OWNER TO alunza_identity;

--
-- Name: guard_class_submissions(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_class_submissions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
 if exists(select 1 from app_private.submission_reservations where class_id=old.id and lifecycle_status in ('RUNNING','RECOVERING')) then
  raise exception using errcode='P0001',message='DEPENDENCIES_ACTIVE';
 end if;
 return new;
end $$;


ALTER FUNCTION app_private.guard_class_submissions() OWNER TO alunza_identity;

--
-- Name: guard_delivery_change(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_delivery_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare archived timestamptz;
begin
  if TG_OP = 'UPDATE' and (new.id <> old.id or new.organization_id <> old.organization_id
    or new.invitation_id <> old.invitation_id or new.requested_by <> old.requested_by) then
    raise exception using errcode = '23514', message = 'IMMUTABLE_SCOPE';
  end if;
  if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and new.state in ('QUEUED','RUNNING','UNCERTAIN')) then
    select archived_at into archived from app.organizations where id = new.organization_id for update;
    if session_user = 'alunza_app' and archived is not null then
      raise exception using errcode = 'P0001', message = 'ORGANIZATION_ARCHIVED';
    end if;
  end if;
  if TG_OP = 'INSERT' then
    -- Transaction start timestamps can run in the opposite order of the lock.
    -- Assign a strict server order after the organization lock for authorizations.
    select greatest(clock_timestamp(), coalesce(max(d.created_at) + interval '1 microsecond', clock_timestamp()))
      into new.created_at from app.invitation_deliveries d
      where d.organization_id = new.organization_id and d.invitation_id = new.invitation_id;
  end if;
  return new;
end $$;


ALTER FUNCTION app_private.guard_delivery_change() OWNER TO alunza_identity;

--
-- Name: guard_execution_context(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_execution_context() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
 if tg_op='UPDATE' then
  if row(new.id,new.organization_id,new.class_id,new.activity_id,new.activity_exercise_id,new.exercise_version_id,new.student_id,new.operation_id,new.purpose,new.code_hash,new.test_suite_hash,new.limits_snapshot,new.runner_version,new.visible_total,new.admitted_at,new.started_at,new.response_expires_at,new.request_id)
   is distinct from row(old.id,old.organization_id,old.class_id,old.activity_id,old.activity_exercise_id,old.exercise_version_id,old.student_id,old.operation_id,old.purpose,old.code_hash,old.test_suite_hash,old.limits_snapshot,old.runner_version,old.visible_total,old.admitted_at,old.started_at,old.response_expires_at,old.request_id) then
   raise exception using errcode='23514',message='IMMUTABLE_EXECUTION';
  end if;
  if old.lifecycle_status='COMPLETED' and row(new.lifecycle_status,new.finished_at,new.lease_until,new.lease_token,new.cleanup_verified) is distinct from row(old.lifecycle_status,old.finished_at,old.lease_until,old.lease_token,old.cleanup_verified) then
   raise exception using errcode='23514',message='IMMUTABLE_EXECUTION';
  end if;
  if old.lifecycle_status='COMPLETED' and new.response_body is distinct from old.response_body and not(new.response_body is null and new.response_expires_at<=clock_timestamp()) then
   raise exception using errcode='23514',message='IMMUTABLE_EXECUTION';
  end if;
 else
  if not exists(select 1 from app.activities a join app.activity_exercises ae on ae.organization_id=a.organization_id and ae.activity_id=a.id
   join app.operation_keys k on k.id=new.operation_id
   where a.id=new.activity_id and a.organization_id=new.organization_id and a.class_id=new.class_id
    and ae.id=new.activity_exercise_id and ae.exercise_version_id=new.exercise_version_id
    and k.organization_id=new.organization_id and k.actor_id=new.student_id and k.operation='practice.run'
    and k.resource_id=new.id and k.resource_type='execution' and k.state='RUNNING') then
   raise exception using errcode='23514',message='EXECUTION_CONTEXT_MISMATCH';
  end if;
 end if;
 return new;
end $$;


ALTER FUNCTION app_private.guard_execution_context() OWNER TO alunza_identity;

--
-- Name: guard_exercise_child(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_exercise_child() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare org uuid; target uuid;
begin
  if TG_OP<>'INSERT' then raise exception using errcode='23514',message='IMMUTABLE_VERSION'; end if;
  org:=new.organization_id; target:=new.exercise_version_id;
  perform 1 from app.organizations where id=org for update;
  if not exists(select 1 from app.exercise_versions v join app.exercises e on e.organization_id=v.organization_id and e.id=v.exercise_id
    where v.organization_id=org and v.id=target and e.archived_at is null
      and (e.current_version_id is null or v.version>(select version from app.exercise_versions where id=e.current_version_id))) then
    raise exception using errcode='23514',message='IMMUTABLE_VERSION'; end if;
  if TG_TABLE_NAME='exercise_version_concepts' then
    if not exists(select 1 from app.concepts c where c.organization_id=org and c.id=new.concept_id and c.archived_at is null and c.current_version_id=new.concept_version_id) then
      raise exception using errcode='23514',message='CONCEPT_UNAVAILABLE'; end if;
  elsif (select count(*) from app_private.exercise_tests where organization_id=org and exercise_version_id=target)>=8 then
    raise exception using errcode='23514',message='TOO_MANY_TESTS';
  end if;
  return new;
end $$;


ALTER FUNCTION app_private.guard_exercise_child() OWNER TO alunza_identity;

--
-- Name: guard_invitation_change(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_invitation_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare archived timestamptz;
begin
  if TG_OP = 'UPDATE' and (new.id <> old.id or new.organization_id <> old.organization_id
    or new.email_normalized <> old.email_normalized or new.invited_by <> old.invited_by or new.role <> old.role) then
    raise exception using errcode = '23514', message = 'IMMUTABLE_SCOPE';
  end if;
  select archived_at into archived from app.organizations where id = new.organization_id for update;
  if session_user = 'alunza_app' then
    if archived is not null then raise exception using errcode = 'P0001', message = 'ORGANIZATION_ARCHIVED'; end if;
    if TG_OP = 'UPDATE' then
      if old.accepted_at is not null and (new.accepted_at is distinct from old.accepted_at
        or new.accepted_by is distinct from old.accepted_by or new.token_digest is distinct from old.token_digest
        or new.generation <> old.generation or new.expires_at <> old.expires_at or new.revoked_at is not null) then
        raise exception using errcode = 'P0001', message = 'INVITATION_ALREADY_ACCEPTED';
      end if;
      if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
        raise exception using errcode = 'P0001', message = 'INVITATION_REVOKED';
      end if;
      if old.accepted_at is null and new.accepted_at is not null then
        if new.accepted_by is distinct from app_private.actor_id() or not app_private.invitation_matches() then
          raise exception using errcode = 'P0001', message = 'INVITATION_INVALID';
        end if;
        new.accepted_at := statement_timestamp();
      end if;
      if new.token_digest is distinct from old.token_digest and new.generation <> old.generation + 1 then
        raise exception using errcode = '23514', message = 'INVALID_GENERATION';
      end if;
      new.revision := old.revision + 1;
    end if;
    new.updated_at := statement_timestamp();
  end if;
  return new;
end $$;


ALTER FUNCTION app_private.guard_invitation_change() OWNER TO alunza_identity;

--
-- Name: guard_membership_change(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_membership_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare active_count integer; org_archived timestamptz; invitation_role text;
begin
  if TG_OP = 'UPDATE' and (new.organization_id <> old.organization_id or new.user_id <> old.user_id) then
    raise exception using errcode = '23514', message = 'IMMUTABLE_SCOPE';
  end if;
  select archived_at into org_archived from app.organizations where id = new.organization_id for update;
  if session_user = 'alunza_app' then
    if org_archived is not null then raise exception using errcode = 'P0001', message = 'ORGANIZATION_ARCHIVED'; end if;
    if new.state = 'ACTIVE' and (TG_OP = 'INSERT' or old.state = 'INVITED') then
      if not (new.user_id = app_private.actor_id() and new.role = 'ADMIN' and app_private.provisioning_allowed()) then
        if not (new.user_id = app_private.actor_id() and app_private.invitation_matches()) then
          raise exception using errcode = 'P0001', message = 'INVITATION_REQUIRED';
        end if;
        select i.role into invitation_role from app.organization_invitations i
          where i.id = nullif(current_setting('app.invitation_id', true), '')::uuid;
        if new.role <> invitation_role then raise exception using errcode = 'P0001', message = 'INVITATION_ROLE_MISMATCH'; end if;
      end if;
    end if;
    if TG_OP = 'UPDATE' and old.role = 'ADMIN' and old.state = 'ACTIVE'
      and (new.role <> 'ADMIN' or new.state <> 'ACTIVE') then
      select count(*) into active_count from app.organization_memberships m
        join app.profiles p on p.id = m.user_id where m.organization_id = old.organization_id
        and m.role = 'ADMIN' and m.state = 'ACTIVE' and p.account_state = 'ACTIVE';
      if active_count <= 1 then raise exception using errcode = 'P0001', message = 'LAST_ADMIN'; end if;
    end if;
    if TG_OP = 'UPDATE' then new.revision := old.revision + 1; end if;
  end if;
  return new;
end $$;


ALTER FUNCTION app_private.guard_membership_change() OWNER TO alunza_identity;

--
-- Name: guard_organization_academic_archive(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_organization_academic_archive() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if old.archived_at is null and new.archived_at is not null and (
    exists(select 1 from app.courses where organization_id=new.id and archived_at is null) or
    exists(select 1 from app.classes where organization_id=new.id and archived_at is null) or
    exists(select 1 from app.concepts where organization_id=new.id and archived_at is null) or
    exists(select 1 from app.exercises where organization_id=new.id and archived_at is null) or
    exists(select 1 from app.activities where organization_id=new.id and state='PUBLISHED')) then
    raise exception using errcode='P0001',message='DEPENDENCIES_ACTIVE'; end if;
  return new;
end $$;


ALTER FUNCTION app_private.guard_organization_academic_archive() OWNER TO alunza_identity;

--
-- Name: guard_organization_change(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_organization_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if new.id <> old.id then raise exception using errcode = '23514', message = 'IMMUTABLE_SCOPE'; end if;
  if session_user = 'alunza_app' then
    if old.archived_at is not null and new is distinct from old then
      raise exception using errcode = 'P0001', message = 'ORGANIZATION_ARCHIVED';
    end if;
    if old.archived_at is null and new.archived_at is not null then
      if new.archived_by is distinct from app_private.actor_id() or not app_private.can_admin(old.id)
        or new.archive_reason is null then
        raise exception using errcode = 'P0001', message = 'FORBIDDEN';
      end if;
      if exists (select 1 from app.organization_memberships m
          where m.organization_id = old.id and m.state = 'ACTIVE' and m.user_id <> app_private.actor_id())
        or exists (select 1 from app.organization_invitations i where i.organization_id = old.id
          and i.accepted_at is null and i.revoked_at is null and i.expires_at > statement_timestamp())
        or exists (select 1 from app.invitation_deliveries d where d.organization_id = old.id
          and d.state in ('QUEUED','RUNNING','UNCERTAIN')) then
        raise exception using errcode = 'P0001', message = 'DEPENDENCIES_ACTIVE';
      end if;
      new.archived_at := statement_timestamp();
    end if;
    new.revision := old.revision + 1;
    new.updated_at := statement_timestamp();
  end if;
  return new;
end $$;


ALTER FUNCTION app_private.guard_organization_change() OWNER TO alunza_identity;

--
-- Name: guard_organization_practice_runs(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_organization_practice_runs() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
 if exists(select 1 from app.executions where organization_id=old.id and lifecycle_status in ('RUNNING','RECOVERING'))
  or exists(select 1 from app_private.submission_reservations where organization_id=old.id and lifecycle_status in ('RUNNING','RECOVERING')) then
  raise exception using errcode='P0001',message='DEPENDENCIES_ACTIVE';
 end if;
 return new;
end $$;


ALTER FUNCTION app_private.guard_organization_practice_runs() OWNER TO alunza_identity;

--
-- Name: guard_practice_recovery_grace(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_practice_recovery_grace() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
begin
 new.lease_until:=greatest(new.lease_until,new.admitted_at+interval '60 seconds');
 return new;
end $$;


ALTER FUNCTION app_private.guard_practice_recovery_grace() OWNER TO alunza_identity;

--
-- Name: guard_submission_context(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.guard_submission_context() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
 if tg_op='UPDATE' then
  if row(new.id,new.organization_id,new.class_id,new.activity_id,new.activity_exercise_id,new.exercise_version_id,new.student_id,new.operation_id,new.code_hash,new.test_suite_hash,new.limits_snapshot,new.runner_version,new.visible_total,new.total_required,new.attempt_number,new.previous_attempt_id,new.admitted_at,new.response_expires_at,new.request_id)
   is distinct from row(old.id,old.organization_id,old.class_id,old.activity_id,old.activity_exercise_id,old.exercise_version_id,old.student_id,old.operation_id,old.code_hash,old.test_suite_hash,old.limits_snapshot,old.runner_version,old.visible_total,old.total_required,old.attempt_number,old.previous_attempt_id,old.admitted_at,old.response_expires_at,old.request_id) then
   raise exception using errcode='23514',message='IMMUTABLE_SUBMISSION';
  end if;
  if old.lifecycle_status='COMPLETED' and row(new.lifecycle_status,new.finished_at,new.lease_until,new.lease_token,new.cleanup_verified,new.attempt_id)
   is distinct from row(old.lifecycle_status,old.finished_at,old.lease_until,old.lease_token,old.cleanup_verified,old.attempt_id) then
   raise exception using errcode='23514',message='IMMUTABLE_SUBMISSION';
  end if;
  if new.code is distinct from old.code and not(new.code is null and old.lifecycle_status='COMPLETED' and old.response_expires_at<=clock_timestamp()) then
   raise exception using errcode='23514',message='IMMUTABLE_SUBMISSION';
  end if;
  if old.staged_result is not null and row(new.staged_result,new.staged_private_results) is distinct from row(old.staged_result,old.staged_private_results)
   and not(new.staged_result is null and new.staged_private_results is null and old.lifecycle_status='COMPLETED' and old.response_expires_at<=clock_timestamp()) then
   raise exception using errcode='23514',message='IMMUTABLE_SUBMISSION_RESULT';
  end if;
  if old.lifecycle_status='COMPLETED' and new.response_body is distinct from old.response_body
   and not(new.response_body is null and old.response_expires_at<=clock_timestamp()) then
   raise exception using errcode='23514',message='IMMUTABLE_SUBMISSION';
  end if;
  if new.lifecycle_status='COMPLETED' and not exists(select 1 from app.attempts a where a.id=new.attempt_id and a.execution_id=new.id and a.organization_id=new.organization_id) then
   raise exception using errcode='23514',message='SUBMISSION_ATTEMPT_MISMATCH';
  end if;
  if new.lifecycle_status='RECOVERING' then new.lease_until:=greatest(new.lease_until,new.admitted_at+interval '60 seconds'); end if;
 else
  if not exists(select 1 from app.activities a join app.activity_exercises ae on ae.organization_id=a.organization_id and ae.activity_id=a.id
   join app.operation_keys k on k.id=new.operation_id
   where a.id=new.activity_id and a.organization_id=new.organization_id and a.class_id=new.class_id
    and ae.id=new.activity_exercise_id and ae.exercise_version_id=new.exercise_version_id
    and k.organization_id=new.organization_id and k.actor_id=new.student_id and k.operation='practice.submit'
    and k.resource_id=new.id and k.resource_type='submission' and k.state='RUNNING')
   or new.code is null or new.code_hash<>encode(sha256(convert_to(new.code,'UTF8')),'hex') then
   raise exception using errcode='23514',message='SUBMISSION_CONTEXT_MISMATCH';
  end if;
 end if;
 return new;
end $$;


ALTER FUNCTION app_private.guard_submission_context() OWNER TO alunza_identity;

--
-- Name: invitation_context(uuid, text, integer); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.invitation_context(invitation uuid, digest text, token_generation integer) RETURNS TABLE(organization_id uuid, email_normalized text, role text, expires_at timestamp with time zone, accepted_at timestamp with time zone, accepted_by uuid, revoked_at timestamp with time zone, generation integer, invited_by uuid, authorized_by uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
  select i.organization_id, i.email_normalized, i.role, i.expires_at,
    i.accepted_at, i.accepted_by, i.revoked_at, i.generation, i.invited_by, delivery.requested_by
  from app.organization_invitations i
  left join lateral (select d.requested_by from app.invitation_deliveries d
    where d.organization_id = i.organization_id and d.invitation_id = i.id
    order by d.created_at desc, d.id desc limit 1) delivery on true
  where i.id = invitation and i.token_digest = digest and i.generation = $3
    and digest ~ '^[a-f0-9]{64}$'
$_$;


ALTER FUNCTION app_private.invitation_context(invitation uuid, digest text, token_generation integer) OWNER TO alunza_identity;

--
-- Name: invitation_matches(boolean); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.invitation_matches(require_recipient boolean DEFAULT true) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select exists (select 1 from app.organization_invitations i
    join app.organizations o on o.id = i.organization_id
    join lateral (select d.requested_by from app.invitation_deliveries d
      where d.organization_id = i.organization_id and d.invitation_id = i.id
      order by d.created_at desc, d.id desc limit 1) delivery on true
    join app.organization_memberships m on m.organization_id = i.organization_id and m.user_id = delivery.requested_by
    join app.profiles p on p.id = m.user_id
    where i.id = nullif(current_setting('app.invitation_id', true), '')::uuid
      and i.organization_id = app_private.organization_id()
      and i.token_digest = nullif(current_setting('app.invitation_token_digest', true), '')
      and i.generation = nullif(current_setting('app.invitation_generation', true), '')::integer
      and i.revoked_at is null and o.archived_at is null
      and m.role = 'ADMIN' and m.state = 'ACTIVE' and p.account_state = 'ACTIVE'
      and (i.accepted_at is not null or i.expires_at > statement_timestamp())
      and (not require_recipient or (i.email_normalized = app_private.current_auth_email()
        and (i.accepted_by is null or i.accepted_by = app_private.actor_id())
        and not exists (select 1 from app.profiles recipient
          where recipient.id = app_private.actor_id() and recipient.account_state = 'DISABLED'))))
$$;


ALTER FUNCTION app_private.invitation_matches(require_recipient boolean) OWNER TO alunza_identity;

--
-- Name: invitation_proof_matches(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.invitation_proof_matches() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select exists (select 1 from app.organization_invitations i
    where i.id = nullif(current_setting('app.invitation_id', true), '')::uuid
      and i.organization_id = app_private.organization_id()
      and i.token_digest = nullif(current_setting('app.invitation_token_digest', true), '')
      and i.generation = nullif(current_setting('app.invitation_generation', true), '')::integer)
$$;


ALTER FUNCTION app_private.invitation_proof_matches() OWNER TO alunza_identity;

--
-- Name: list_practice_attempts(uuid, uuid, bigint, integer); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.list_practice_attempts(activity uuid, assignment uuid, before_number bigint, fetch_limit integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare entries jsonb; remaining boolean;
begin
 if fetch_limit is null or fetch_limit not between 1 and 20 or (before_number is not null and before_number<1) then raise exception using errcode='22023',message='INVALID_PAGINATION'; end if;
 if not exists(select 1 from app.activities a join app.activity_exercises ae on ae.activity_id=a.id and ae.organization_id=a.organization_id
  where a.id=activity and ae.id=assignment and app_private.practice_student(a.class_id) and (a.state='PUBLISHED' or (a.state='CLOSED'
   and exists(select 1 from app.attempts p where p.activity_exercise_id=assignment and p.student_id=app_private.actor_id())))) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 select coalesce(jsonb_agg(app_private.attempt_payload(q::app.attempts)-'code' order by q.attempt_number desc),'[]'::jsonb) into entries
 from (select p.* from app.attempts p where p.activity_id=activity and p.activity_exercise_id=assignment and p.student_id=app_private.actor_id()
  and (before_number is null or p.attempt_number<before_number) order by p.attempt_number desc limit fetch_limit) q;
 remaining:=jsonb_array_length(entries)=fetch_limit and exists(select 1 from app.attempts p where p.activity_id=activity and p.activity_exercise_id=assignment
  and p.student_id=app_private.actor_id() and p.attempt_number<(entries->-1->>'attemptNumber')::bigint);
 return jsonb_build_object('items',entries,'nextCursor',case when remaining then entries->-1->>'attemptNumber' else null end);
end $$;


ALTER FUNCTION app_private.list_practice_attempts(activity uuid, assignment uuid, before_number bigint, fetch_limit integer) OWNER TO alunza_identity;

--
-- Name: load_practice_submit_suite(uuid, uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.load_practice_submit_suite(execution uuid, token uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare s app_private.submission_reservations%rowtype; tests jsonb;
begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 select * into s from app_private.submission_reservations where id=execution;
 if not found or token is distinct from s.lease_token or s.lifecycle_status<>'RUNNING' or s.lease_until<=clock_timestamp() then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS';
 end if;
 select jsonb_agg(jsonb_build_object('id',id,'visibility',lower(visibility),'args',args,'expected',expected) order by position) into tests
  from app_private.exercise_tests where organization_id=s.organization_id and exercise_version_id=s.exercise_version_id;
 if encode(sha256(convert_to(tests::text,'UTF8')),'hex') is distinct from s.test_suite_hash then
  raise exception using errcode='23514',message='SUBMIT_SUITE_MISMATCH';
 end if;
 return jsonb_build_object('tests',tests,'testsVersion',s.test_suite_hash,'limits',s.limits_snapshot);
end $$;


ALTER FUNCTION app_private.load_practice_submit_suite(execution uuid, token uuid) OWNER TO alunza_identity;

--
-- Name: lock_academic_organization(uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.lock_academic_organization(org uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if org is distinct from app_private.organization_id() or app_private.academic_role(org) is null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  perform 1 from app.organizations where id=org for update;
  if app_private.academic_role(org) is null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
end $$;


ALTER FUNCTION app_private.lock_academic_organization(org uuid) OWNER TO alunza_identity;

--
-- Name: lock_invitation_organization(uuid, text, integer); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.lock_invitation_organization(invitation uuid, digest text, token_generation integer) RETURNS TABLE(id uuid, archived_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
  select o.id, o.archived_at from app.organizations o
    join app.organization_invitations i on i.organization_id = o.id
    where i.id = invitation and i.token_digest = digest and i.generation = token_generation
      and digest ~ '^[a-f0-9]{64}$'
    for update of o
$_$;


ALTER FUNCTION app_private.lock_invitation_organization(invitation uuid, digest text, token_generation integer) OWNER TO alunza_identity;

--
-- Name: organization_id(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.organization_id() RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog'
    AS $$ select nullif(current_setting('app.organization_id', true), '')::uuid $$;


ALTER FUNCTION app_private.organization_id() OWNER TO alunza_identity;

--
-- Name: owns_exercise(uuid, uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.owns_exercise(org uuid, target uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select app_private.academic_role(org)='TEACHER' and exists(select 1 from app.exercises e
    where e.organization_id=org and e.id=target and e.owner_id=app_private.actor_id())
$$;


ALTER FUNCTION app_private.owns_exercise(org uuid, target uuid) OWNER TO alunza_identity;

--
-- Name: practice_activity_progress(uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.practice_activity_progress(activity uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare required_count integer; completed_count integer; any_attempt boolean;
begin
 if not exists(select 1 from app.activities a where a.id=activity and app_private.practice_student(a.class_id)
  and (a.state='PUBLISHED' or (a.state='CLOSED' and exists(select 1 from app.attempts p where p.activity_id=activity and p.student_id=app_private.actor_id())))) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 select count(*),count(*) filter(where exists(select 1 from app.attempts p where p.activity_id=activity and p.activity_exercise_id=ae.id
  and p.exercise_version_id=ae.exercise_version_id and p.student_id=app_private.actor_id() and p.technical_result->'allRequiredPassed'='true'::jsonb))
 into required_count,completed_count from app.activity_exercises ae where ae.activity_id=activity and ae.required;
 select exists(select 1 from app.attempts p where p.activity_id=activity and p.student_id=app_private.actor_id()) into any_attempt;
 return jsonb_build_object('activityId',activity,'completed',completed_count,'required',required_count,
  'ratio',case when required_count=0 then null else completed_count::numeric/required_count end,
  'evidenceState',case when required_count=0 then 'NO_REQUIRED_EXERCISES' when not any_attempt then 'NO_ATTEMPTS' else 'HAS_EVIDENCE' end,'asOf',statement_timestamp());
end $$;


ALTER FUNCTION app_private.practice_activity_progress(activity uuid) OWNER TO alunza_identity;

--
-- Name: practice_activity_read(uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.practice_activity_read(target uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
 select exists(select 1 from app.activities a where a.id=target and a.state in ('PUBLISHED','CLOSED')
  and app_private.practice_student(a.class_id))
$$;


ALTER FUNCTION app_private.practice_activity_read(target uuid) OWNER TO alunza_identity;

--
-- Name: practice_assignment_context(uuid, uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.practice_assignment_context(activity uuid, assignment uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare a record;
begin
 select act.organization_id,act.class_id,act.state,ae.exercise_version_id,v.execution_limits into a
  from app.activities act join app.activity_exercises ae on ae.activity_id=act.id and ae.organization_id=act.organization_id
  join app.exercise_versions v on v.id=ae.exercise_version_id and v.organization_id=ae.organization_id
  where act.id=activity and ae.id=assignment and act.state in ('PUBLISHED','CLOSED') and app_private.practice_student(act.class_id);
 if not found then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 if a.state='CLOSED' and not exists(select 1 from app.attempts p where p.activity_exercise_id=assignment and p.student_id=app_private.actor_id())
  and not exists(select 1 from app.executions e where e.activity_exercise_id=assignment and e.student_id=app_private.actor_id())
  and not exists(select 1 from app_private.submission_reservations s where s.activity_exercise_id=assignment and s.student_id=app_private.actor_id()) then
  raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND';
 end if;
 return jsonb_build_object('organizationId',a.organization_id,'exerciseVersionId',a.exercise_version_id,'limits',app_private.practice_limits(a.execution_limits));
end $$;


ALTER FUNCTION app_private.practice_assignment_context(activity uuid, assignment uuid) OWNER TO alunza_identity;

--
-- Name: practice_attempted_activities(uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.practice_attempted_activities(target uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare result jsonb;
begin
 if not app_private.practice_student(target) then raise exception using errcode='P0001',message='RESOURCE_NOT_FOUND'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('activityId',a.id,'title',a.title,'activityState',a.state,'exercises',(
  select jsonb_agg(jsonb_build_object('assignmentId',ae.id,'title',v.title) order by ae.position)
  from app.activity_exercises ae join app.exercise_versions v on v.id=ae.exercise_version_id and v.organization_id=ae.organization_id
  where ae.activity_id=a.id and exists(select 1 from app.attempts p where p.activity_exercise_id=ae.id and p.student_id=app_private.actor_id())
 )) order by a.created_at desc,a.id),'[]'::jsonb) into result
 from app.activities a where a.class_id=target and a.state in ('PUBLISHED','CLOSED')
  and exists(select 1 from app.attempts p where p.activity_id=a.id and p.student_id=app_private.actor_id());
 return result;
end $$;


ALTER FUNCTION app_private.practice_attempted_activities(target uuid) OWNER TO alunza_identity;

--
-- Name: practice_limits(jsonb); Type: FUNCTION; Schema: app_private; Owner: postgres
--

CREATE FUNCTION app_private.practice_limits(value jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $$
 select jsonb_build_object('memoryBytes',value->'memoryBytes','runtimeMs',value->'timeoutMs','outputBytes',value->'outputBytes')
$$;


ALTER FUNCTION app_private.practice_limits(value jsonb) OWNER TO postgres;

--
-- Name: practice_run_context(uuid, uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.practice_run_context(activity uuid, assignment uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare context jsonb; tests jsonb;
begin
 context:=app_private.practice_assignment_context(activity,assignment);
 select jsonb_agg(jsonb_build_object('id',t.id,'visibility','visible','args',t.args,'expected',t.expected) order by t.position) into tests
 from app_private.exercise_tests t where t.organization_id=(context->>'organizationId')::uuid
  and t.exercise_version_id=(context->>'exerciseVersionId')::uuid and t.visibility='VISIBLE' and t.comparator='EXACT_DEEP';
 return context||jsonb_build_object('tests',tests);
end $$;


ALTER FUNCTION app_private.practice_run_context(activity uuid, assignment uuid) OWNER TO alunza_identity;

--
-- Name: practice_student(uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.practice_student(target uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
 select exists(select 1 from app.classes c where c.id=target
  and app_private.academic_role(c.organization_id)='STUDENT' and app_private.can_read_class(c.organization_id,c.id))
$$;


ALTER FUNCTION app_private.practice_student(target uuid) OWNER TO alunza_identity;

--
-- Name: preview_class_join_code(text); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.preview_class_join_code(digest text) RETURNS TABLE(id uuid, class_id uuid, organization_id uuid, expires_at timestamp with time zone, class_name text, course_name text, already_enrolled boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select j.id,j.class_id,j.organization_id,j.expires_at,c.name,co.name,
    exists(select 1 from app.class_memberships m where m.organization_id=j.organization_id and m.class_id=j.class_id and m.user_id=app_private.actor_id() and m.state='ACTIVE')
    from app.class_join_codes j
    join app.classes c on c.organization_id=j.organization_id and c.id=j.class_id
    join app.courses co on co.organization_id=c.organization_id and co.id=c.course_id
  where j.token_digest=digest and j.revoked_at is null and j.expires_at>statement_timestamp()
    and c.archived_at is null and co.archived_at is null and app_private.academic_role(j.organization_id)='STUDENT'
$$;


ALTER FUNCTION app_private.preview_class_join_code(digest text) OWNER TO alunza_identity;

--
-- Name: provisioning_allowed(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.provisioning_allowed() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select app_private.current_auth_email() is not null
    and exists (select 1 from app.profiles p where p.id = app_private.actor_id() and p.account_state = 'ACTIVE')
    and exists (
    select 1 from app.provisioning_grants g
    where g.id = nullif(current_setting('app.provisioning_grant_id', true), '')::uuid
      and g.user_id = app_private.actor_id() and g.revoked_at is null
      and g.expires_at > statement_timestamp()
      and g.consumed_at is null)
$$;


ALTER FUNCTION app_private.provisioning_allowed() OWNER TO alunza_identity;

--
-- Name: purge_expired_operation_responses(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.purge_expired_operation_responses() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare changed_count integer;
begin
  with expired as (
    select k.id from app.operation_keys k
    where k.expires_at <= statement_timestamp() and k.response_body is not null
    order by k.expires_at, k.id for update skip locked limit 100
  ), changed as (
    update app.operation_keys k set response_body = null
    from expired e where k.id = e.id returning k.id
  ) select count(*)::integer into changed_count from changed;
  return changed_count;
end $$;


ALTER FUNCTION app_private.purge_expired_operation_responses() OWNER TO alunza_identity;

--
-- Name: purge_practice_responses(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.purge_practice_responses() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare removed integer;
begin
 if app_private.actor_id() is not null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 with due as(select id from app.executions where response_body is not null and response_expires_at<=clock_timestamp() order by response_expires_at,id for update skip locked limit 200)
 update app.executions e set response_body=null from due where e.id=due.id;
 get diagnostics removed=row_count;
 with due as(select id from app.operation_keys where operation='practice.run' and response_body is not null and expires_at<=clock_timestamp() order by expires_at,id for update skip locked limit 200)
 update app.operation_keys k set response_body=null from due where k.id=due.id;
 return removed;
end $$;


ALTER FUNCTION app_private.purge_practice_responses() OWNER TO alunza_identity;

--
-- Name: purge_submit_responses(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.purge_submit_responses() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare removed integer;
begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 with due as(select id from app_private.submission_reservations where lifecycle_status='COMPLETED' and response_expires_at<=clock_timestamp()
  and (response_body is not null or code is not null) order by response_expires_at,id for update skip locked limit 200)
 update app_private.submission_reservations s set response_body=null,code=null,staged_result=null,staged_private_results=null from due where s.id=due.id;
 get diagnostics removed=row_count;
 with due as(select id from app.operation_keys where operation='practice.submit' and response_body is not null and expires_at<=clock_timestamp() order by expires_at,id for update skip locked limit 200)
 update app.operation_keys k set response_body=null from due where k.id=due.id;
 return removed;
end $$;


ALTER FUNCTION app_private.purge_submit_responses() OWNER TO alunza_identity;

--
-- Name: read_practice_attempt(uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.read_practice_attempt(attempt uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog'
    AS $$
 select app_private.attempt_payload(a) from app.attempts a where a.id=attempt
$$;


ALTER FUNCTION app_private.read_practice_attempt(attempt uuid) OWNER TO alunza_identity;

--
-- Name: session_is_active(uuid, uuid); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.session_is_active(actor uuid, session uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select actor is not null and session is not null
    and actor = app_private.actor_id()
    and session = nullif(current_setting('app.session_id', true), '')::uuid
    and exists (select 1 from auth.sessions s where s.id = session and s.user_id = actor)
$$;


ALTER FUNCTION app_private.session_is_active(actor uuid, session uuid) OWNER TO alunza_identity;

--
-- Name: stage_practice_submit_result(uuid, uuid, jsonb, jsonb); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.stage_practice_submit_result(execution uuid, token uuid, technical_result jsonb, private_results jsonb) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare s app_private.submission_reservations%rowtype; hidden_count integer; hidden_complete boolean; expected_hidden jsonb; complete_pass boolean;
begin
 if app_private.actor_id() is not null or nullif(current_setting('app.session_id',true),'') is not null then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 select * into s from app_private.submission_reservations where id=execution for update;
 if not found or token is distinct from s.lease_token or s.lifecycle_status='COMPLETED' or s.lease_until<=clock_timestamp() then
  raise exception using errcode='P0001',message='REQUEST_IN_PROGRESS';
 end if;
 if technical_result is null or jsonb_typeof(technical_result)<>'object' or private_results is null or jsonb_typeof(private_results)<>'array' then
  raise exception using errcode='23514',message='INVALID_SUBMIT_RESULT';
 end if;
 if not(technical_result ?& array['runnerVersion','diagnosisCode','terminationReason','infrastructureStatus','visibleTestResults','visiblePassed','visibleTotal','outputTruncated','outputBytes','runtimeMs','lifecycleMs','hiddenChecksPassed','allRequiredPassed'])
  or (select count(*) from jsonb_object_keys(technical_result))<>13
  or exists(select 1 from jsonb_each(technical_result) x where
   (x.key in ('runnerVersion','diagnosisCode','terminationReason','infrastructureStatus') and jsonb_typeof(x.value)<>'string')
   or (x.key in ('visiblePassed','visibleTotal','outputBytes','runtimeMs','lifecycleMs') and jsonb_typeof(x.value)<>'number')
   or (x.key='visibleTestResults' and jsonb_typeof(x.value)<>'array')
   or (x.key in ('outputTruncated','allRequiredPassed') and jsonb_typeof(x.value)<>'boolean')
   or (x.key='hiddenChecksPassed' and jsonb_typeof(x.value) not in ('boolean','null'))) then
  raise exception using errcode='23514',message='INVALID_SUBMIT_RESULT';
 end if;
 if technical_result->>'runnerVersion'<>s.runner_version
  or technical_result->>'diagnosisCode' not in ('SUCCESS','SYNTAX_ERROR','RUNTIME_ERROR','FAILED_TEST','TIMEOUT','UNKNOWN')
  or technical_result->>'terminationReason' not in ('COMPLETED','STUDENT_SYNTAX','STUDENT_EXCEPTION','ASSERTION_FAILED','EXECUTION_DEADLINE','MEMORY_LIMIT','OUTPUT_LIMIT','RETURN_LIMIT','PROTOCOL_INVALID','RUNNER_FAILURE','PROVIDER_FAILURE','CAPABILITY_GAP','CANCELLED')
  or technical_result->>'infrastructureStatus' not in ('OK','FAILED')
  or (technical_result->>'visibleTotal')::numeric<>s.visible_total
  or jsonb_array_length(technical_result->'visibleTestResults')>s.visible_total
  or (technical_result->>'visiblePassed')::numeric not between 0 and s.visible_total
  or (technical_result->>'outputBytes')::numeric not between 0 and (s.limits_snapshot->>'outputBytes')::numeric
  or mod((technical_result->>'outputBytes')::numeric,1)<>0
  or (technical_result->>'runtimeMs')::numeric<0 or (technical_result->>'lifecycleMs')::numeric<0
  or (technical_result->>'infrastructureStatus'='FAILED' and technical_result->>'diagnosisCode'<>'UNKNOWN') then
  raise exception using errcode='23514',message='INVALID_SUBMIT_RESULT';
 end if;
 if exists(select 1 from jsonb_array_elements(technical_result->'visibleTestResults') t where jsonb_typeof(t)<>'object')
  or exists(select 1 from jsonb_array_elements(private_results) t where jsonb_typeof(t)<>'object') then
  raise exception using errcode='23514',message='INVALID_SUBMIT_RESULT';
 end if;
 if exists(select 1 from jsonb_array_elements(technical_result->'visibleTestResults') t where
  not(t ?& array['id','passed','stdout','stderr']) or (select count(*) from jsonb_object_keys(t))<>4
  or jsonb_typeof(t->'id')<>'string' or jsonb_typeof(t->'passed')<>'boolean'
  or jsonb_typeof(t->'stdout')<>'string' or jsonb_typeof(t->'stderr')<>'string'
  or not exists(select 1 from app_private.exercise_tests et where et.organization_id=s.organization_id and et.exercise_version_id=s.exercise_version_id and et.visibility='VISIBLE' and et.id::text=t->>'id'))
  or (select count(distinct t->>'id') from jsonb_array_elements(technical_result->'visibleTestResults') t)<>jsonb_array_length(technical_result->'visibleTestResults')
  or (select count(*) from jsonb_array_elements(technical_result->'visibleTestResults') t where t->'passed'='true'::jsonb)<>(technical_result->>'visiblePassed')::numeric
  or (select coalesce(sum(octet_length(t->>'stdout')+octet_length(t->>'stderr')),0) from jsonb_array_elements(technical_result->'visibleTestResults') t)>(technical_result->>'outputBytes')::numeric then
  raise exception using errcode='23514',message='INVALID_SUBMIT_RESULT';
 end if;
 hidden_count:=s.total_required-s.visible_total;
 if jsonb_array_length(private_results)>hidden_count
  or exists(select 1 from jsonb_array_elements(private_results) t where
   not(t ?& array['id','passed']) or (select count(*) from jsonb_object_keys(t))<>2
   or jsonb_typeof(t->'id')<>'string' or jsonb_typeof(t->'passed')<>'boolean'
   or not exists(select 1 from app_private.exercise_tests et where et.organization_id=s.organization_id and et.exercise_version_id=s.exercise_version_id and et.visibility='HIDDEN' and et.id::text=t->>'id'))
  or (select count(distinct t->>'id') from jsonb_array_elements(private_results) t)<>jsonb_array_length(private_results) then
  raise exception using errcode='23514',message='INVALID_SUBMIT_RESULT';
 end if;
 hidden_complete:=hidden_count>0 and jsonb_array_length(private_results)=hidden_count and technical_result->>'diagnosisCode' in ('SUCCESS','FAILED_TEST');
 expected_hidden:=case when hidden_complete then to_jsonb(not exists(select 1 from jsonb_array_elements(private_results) t where t->'passed'='false'::jsonb)) else 'null'::jsonb end;
 complete_pass:=jsonb_array_length(private_results)=hidden_count
  and jsonb_array_length(technical_result->'visibleTestResults')=s.visible_total
  and (technical_result->>'visiblePassed')::numeric=s.visible_total
  and not exists(select 1 from jsonb_array_elements(private_results) t where t->'passed'='false'::jsonb)
  and technical_result->>'infrastructureStatus'='OK' and technical_result->>'terminationReason'='COMPLETED'
  and technical_result->'outputTruncated'='false'::jsonb;
 if technical_result->'hiddenChecksPassed' is distinct from expected_hidden
  or technical_result->'allRequiredPassed' is distinct from to_jsonb(complete_pass)
  or (technical_result->>'diagnosisCode'='SUCCESS') is distinct from complete_pass
  or (technical_result->>'diagnosisCode'='FAILED_TEST' and (
   jsonb_array_length(private_results)<>hidden_count or jsonb_array_length(technical_result->'visibleTestResults')<>s.visible_total
   or technical_result->>'infrastructureStatus'<>'OK' or technical_result->>'terminationReason'<>'ASSERTION_FAILED'
   or technical_result->'outputTruncated'<>'false'::jsonb
   or not exists(select 1 from jsonb_array_elements(private_results||(technical_result->'visibleTestResults')) t where t->'passed'='false'::jsonb))) then
  raise exception using errcode='23514',message='INVALID_SUBMIT_RESULT';
 end if;
 if s.staged_result is not null then
  if row(s.staged_result,s.staged_private_results) is distinct from row(technical_result,private_results) then
   raise exception using errcode='23514',message='IMMUTABLE_SUBMISSION_RESULT';
  end if;
  return true;
 end if;
 update app_private.submission_reservations set staged_result=technical_result,staged_private_results=private_results where id=s.id;
 return true;
end $$;


ALTER FUNCTION app_private.stage_practice_submit_result(execution uuid, token uuid, technical_result jsonb, private_results jsonb) OWNER TO alunza_identity;

--
-- Name: valid_practice_limits(jsonb); Type: FUNCTION; Schema: app_private; Owner: postgres
--

CREATE FUNCTION app_private.valid_practice_limits(value jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $$
 select coalesce(jsonb_typeof(value)='object'
  and value ?& array['memoryBytes','runtimeMs','outputBytes']
  and value-array['memoryBytes','runtimeMs','outputBytes']='{}'::jsonb
  and jsonb_typeof(value->'memoryBytes')='number' and jsonb_typeof(value->'runtimeMs')='number' and jsonb_typeof(value->'outputBytes')='number'
  and (value->>'memoryBytes')::numeric between 1 and 134217728 and mod((value->>'memoryBytes')::numeric,1)=0
  and (value->>'runtimeMs')::numeric between 1 and 3000 and mod((value->>'runtimeMs')::numeric,1)=0
  and (value->>'outputBytes')::numeric between 1 and 65536 and mod((value->>'outputBytes')::numeric,1)=0,false)
$$;


ALTER FUNCTION app_private.valid_practice_limits(value jsonb) OWNER TO postgres;

--
-- Name: submission_reservations; Type: TABLE; Schema: app_private; Owner: postgres
--

CREATE TABLE app_private.submission_reservations (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    class_id uuid NOT NULL,
    activity_id uuid NOT NULL,
    activity_exercise_id uuid NOT NULL,
    exercise_version_id uuid NOT NULL,
    student_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    code text,
    code_hash text NOT NULL,
    test_suite_hash text NOT NULL,
    limits_snapshot jsonb NOT NULL,
    runner_version text NOT NULL,
    visible_total integer NOT NULL,
    total_required integer NOT NULL,
    attempt_number integer NOT NULL,
    previous_attempt_id uuid,
    lifecycle_status text DEFAULT 'RUNNING'::text NOT NULL,
    admitted_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    lease_until timestamp with time zone,
    lease_token uuid NOT NULL,
    staged_result jsonb,
    staged_private_results jsonb,
    response_body jsonb,
    response_expires_at timestamp with time zone NOT NULL,
    cleanup_verified boolean DEFAULT false NOT NULL,
    attempt_id uuid,
    request_id uuid NOT NULL,
    CONSTRAINT submission_reservations_attempt_number_check CHECK ((attempt_number > 0)),
    CONSTRAINT submission_reservations_check CHECK (((total_required >= 1) AND (total_required <= 8) AND (total_required >= visible_total))),
    CONSTRAINT submission_reservations_check1 CHECK ((((lifecycle_status = 'COMPLETED'::text) AND (finished_at IS NOT NULL) AND (lease_until IS NULL) AND cleanup_verified AND (attempt_id IS NOT NULL)) OR ((lifecycle_status = ANY (ARRAY['RUNNING'::text, 'RECOVERING'::text])) AND (finished_at IS NULL) AND (lease_until IS NOT NULL) AND (response_body IS NULL) AND (attempt_id IS NULL) AND (code IS NOT NULL)))),
    CONSTRAINT submission_reservations_check2 CHECK (((staged_result IS NULL) = (staged_private_results IS NULL))),
    CONSTRAINT submission_reservations_check3 CHECK (((response_body IS NULL) OR (((response_body ->> 'executionId'::text) = (id)::text) AND ((response_body ->> 'attemptId'::text) = (attempt_id)::text)))),
    CONSTRAINT submission_reservations_code_check CHECK (((octet_length(code) >= 1) AND (octet_length(code) <= 65536))),
    CONSTRAINT submission_reservations_code_hash_check CHECK ((code_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT submission_reservations_lifecycle_status_check CHECK ((lifecycle_status = ANY (ARRAY['RUNNING'::text, 'RECOVERING'::text, 'COMPLETED'::text]))),
    CONSTRAINT submission_reservations_limits_snapshot_check CHECK (app_private.valid_practice_limits(limits_snapshot)),
    CONSTRAINT submission_reservations_runner_version_check CHECK (((length(runner_version) >= 1) AND (length(runner_version) <= 100))),
    CONSTRAINT submission_reservations_test_suite_hash_check CHECK ((test_suite_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT submission_reservations_visible_total_check CHECK (((visible_total >= 1) AND (visible_total <= 8)))
);

ALTER TABLE ONLY app_private.submission_reservations FORCE ROW LEVEL SECURITY;


ALTER TABLE app_private.submission_reservations OWNER TO postgres;

--
-- Name: submission_reservation_payload(app_private.submission_reservations); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.submission_reservation_payload(s app_private.submission_reservations) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog'
    AS $$
 select jsonb_build_object('executionId',s.id,'exerciseVersionId',s.exercise_version_id,'organizationId',s.organization_id,
  'studentId',s.student_id,'admittedAt',s.admitted_at,'leaseToken',s.lease_token,'visibleTotal',s.visible_total,'runnerVersion',s.runner_version,
  'testsVersion',s.test_suite_hash,'attemptNumber',s.attempt_number,'stagedResult',s.staged_result is not null)
$$;


ALTER FUNCTION app_private.submission_reservation_payload(s app_private.submission_reservations) OWNER TO alunza_identity;

--
-- Name: worker_delivery_valid(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.worker_delivery_valid() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select current_setting('app.worker', true) = 'true'
    and exists (select 1 from app.invitation_deliveries d
      where d.id = nullif(current_setting('app.delivery_id', true), '')::uuid
        and d.lease_token = nullif(current_setting('app.delivery_lease_token', true), '')::uuid
        and d.organization_id = app_private.organization_id()
        and d.requested_by = app_private.actor_id()
        and d.state = 'RUNNING' and d.lease_until > statement_timestamp())
    and app_private.can_admin(app_private.organization_id())
$$;


ALTER FUNCTION app_private.worker_delivery_valid() OWNER TO alunza_identity;

--
-- Name: worker_lease_valid(); Type: FUNCTION; Schema: app_private; Owner: alunza_identity
--

CREATE FUNCTION app_private.worker_lease_valid() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select current_setting('app.worker', true) = 'true'
    and exists (select 1 from app.invitation_deliveries d
      where d.id = nullif(current_setting('app.delivery_id', true), '')::uuid
        and d.lease_token = nullif(current_setting('app.delivery_lease_token', true), '')::uuid
        and d.organization_id = app_private.organization_id()
        and d.requested_by = app_private.actor_id()
        and d.state = 'RUNNING' and d.lease_until > statement_timestamp())
$$;


ALTER FUNCTION app_private.worker_lease_valid() OWNER TO alunza_identity;

--
-- Name: activities; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    class_id uuid NOT NULL,
    title text NOT NULL,
    type text NOT NULL,
    instructions text DEFAULT ''::text NOT NULL,
    state text DEFAULT 'DRAFT'::text NOT NULL,
    opens_at timestamp with time zone,
    closes_at timestamp with time zone,
    published_at timestamp with time zone,
    closed_at timestamp with time zone,
    revision integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT activities_check CHECK (((opens_at IS NULL) OR (closes_at IS NULL) OR (closes_at > opens_at))),
    CONSTRAINT activities_check1 CHECK ((((state = 'DRAFT'::text) AND (published_at IS NULL) AND (closed_at IS NULL)) OR ((state = 'PUBLISHED'::text) AND (published_at IS NOT NULL) AND (closed_at IS NULL)) OR ((state = 'CLOSED'::text) AND (published_at IS NOT NULL) AND (closed_at IS NOT NULL)))),
    CONSTRAINT activities_instructions_check CHECK ((char_length(instructions) <= 30000)),
    CONSTRAINT activities_revision_check CHECK ((revision > 0)),
    CONSTRAINT activities_state_check CHECK ((state = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'CLOSED'::text]))),
    CONSTRAINT activities_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 160))),
    CONSTRAINT activities_type_check CHECK ((type = ANY (ARRAY['DIAGNOSTIC'::text, 'FORMATIVE'::text])))
);

ALTER TABLE ONLY app.activities FORCE ROW LEVEL SECURITY;


ALTER TABLE app.activities OWNER TO postgres;

--
-- Name: activity_exercises; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.activity_exercises (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    activity_id uuid NOT NULL,
    exercise_version_id uuid NOT NULL,
    "position" integer NOT NULL,
    required boolean DEFAULT true NOT NULL,
    CONSTRAINT activity_exercises_position_check CHECK (("position" >= 0))
);

ALTER TABLE ONLY app.activity_exercises FORCE ROW LEVEL SECURITY;


ALTER TABLE app.activity_exercises OWNER TO postgres;

--
-- Name: audit_events; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    actor_id uuid,
    actor_kind text DEFAULT 'USER'::text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    result text NOT NULL,
    correlation_id uuid NOT NULL,
    safe_changes jsonb,
    request_id uuid,
    CONSTRAINT audit_events_action_check CHECK (((char_length(action) >= 1) AND (char_length(action) <= 100))),
    CONSTRAINT audit_events_actor_kind_check CHECK ((actor_kind = ANY (ARRAY['USER'::text, 'SYSTEM'::text, 'TECHNICAL'::text]))),
    CONSTRAINT audit_events_entity_type_check CHECK (((char_length(entity_type) >= 1) AND (char_length(entity_type) <= 100))),
    CONSTRAINT audit_events_result_check CHECK (((char_length(result) >= 1) AND (char_length(result) <= 80)))
);

ALTER TABLE ONLY app.audit_events FORCE ROW LEVEL SECURITY;


ALTER TABLE app.audit_events OWNER TO postgres;

--
-- Name: class_join_codes; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.class_join_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    class_id uuid NOT NULL,
    token_digest text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    uses_count integer DEFAULT 0 NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT class_join_codes_check CHECK ((expires_at > created_at)),
    CONSTRAINT class_join_codes_revision_check CHECK ((revision > 0)),
    CONSTRAINT class_join_codes_token_digest_check CHECK ((token_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT class_join_codes_uses_count_check CHECK ((uses_count >= 0))
);

ALTER TABLE ONLY app.class_join_codes FORCE ROW LEVEL SECURITY;


ALTER TABLE app.class_join_codes OWNER TO postgres;

--
-- Name: class_memberships; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.class_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    class_id uuid NOT NULL,
    user_id uuid NOT NULL,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT class_memberships_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'DISABLED'::text])))
);

ALTER TABLE ONLY app.class_memberships FORCE ROW LEVEL SECURITY;


ALTER TABLE app.class_memberships OWNER TO postgres;

--
-- Name: classes; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    course_id uuid NOT NULL,
    teacher_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    start_date date,
    end_date date,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT classes_check CHECK (((start_date IS NULL) OR (end_date IS NULL) OR (end_date >= start_date))),
    CONSTRAINT classes_code_check CHECK (((code = upper(btrim(code))) AND ((char_length(code) >= 1) AND (char_length(code) <= 40)))),
    CONSTRAINT classes_description_check CHECK ((char_length(description) <= 10000)),
    CONSTRAINT classes_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 160))),
    CONSTRAINT classes_revision_check CHECK ((revision > 0))
);

ALTER TABLE ONLY app.classes FORCE ROW LEVEL SECURITY;


ALTER TABLE app.classes OWNER TO postgres;

--
-- Name: concept_versions; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.concept_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    concept_id uuid NOT NULL,
    version integer NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    parent_concept_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT concept_versions_check CHECK ((parent_concept_id IS DISTINCT FROM concept_id)),
    CONSTRAINT concept_versions_description_check CHECK ((char_length(description) <= 10000)),
    CONSTRAINT concept_versions_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 160))),
    CONSTRAINT concept_versions_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY app.concept_versions FORCE ROW LEVEL SECURITY;


ALTER TABLE app.concept_versions OWNER TO postgres;

--
-- Name: concepts; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.concepts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    normalized_name text NOT NULL,
    current_version_id uuid,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT concepts_normalized_name_check CHECK (((normalized_name = lower(btrim(regexp_replace(NORMALIZE(normalized_name, NFKC), '\s+'::text, ' '::text, 'g'::text)))) AND ((char_length(normalized_name) >= 1) AND (char_length(normalized_name) <= 160)))),
    CONSTRAINT concepts_revision_check CHECK ((revision > 0))
);

ALTER TABLE ONLY app.concepts FORCE ROW LEVEL SECURITY;


ALTER TABLE app.concepts OWNER TO postgres;

--
-- Name: courses; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.courses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    academic_period text NOT NULL,
    start_date date,
    end_date date,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT courses_academic_period_check CHECK (((char_length(btrim(academic_period)) >= 1) AND (char_length(btrim(academic_period)) <= 80))),
    CONSTRAINT courses_check CHECK (((start_date IS NULL) OR (end_date IS NULL) OR (end_date >= start_date))),
    CONSTRAINT courses_code_check CHECK (((code = upper(btrim(code))) AND ((char_length(code) >= 1) AND (char_length(code) <= 40)))),
    CONSTRAINT courses_description_check CHECK ((char_length(description) <= 10000)),
    CONSTRAINT courses_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 160))),
    CONSTRAINT courses_revision_check CHECK ((revision > 0))
);

ALTER TABLE ONLY app.courses FORCE ROW LEVEL SECURITY;


ALTER TABLE app.courses OWNER TO postgres;

--
-- Name: executions; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.executions (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    class_id uuid NOT NULL,
    activity_id uuid NOT NULL,
    activity_exercise_id uuid NOT NULL,
    exercise_version_id uuid NOT NULL,
    student_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    purpose text DEFAULT 'RUN'::text NOT NULL,
    code_hash text NOT NULL,
    test_suite_hash text NOT NULL,
    limits_snapshot jsonb NOT NULL,
    runner_version text NOT NULL,
    visible_total integer NOT NULL,
    lifecycle_status text DEFAULT 'RUNNING'::text NOT NULL,
    admitted_at timestamp with time zone NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    lease_until timestamp with time zone,
    lease_token uuid NOT NULL,
    response_body jsonb,
    response_expires_at timestamp with time zone NOT NULL,
    cleanup_verified boolean DEFAULT false NOT NULL,
    request_id uuid NOT NULL,
    CONSTRAINT executions_check CHECK ((((lifecycle_status = 'COMPLETED'::text) AND (finished_at IS NOT NULL) AND (lease_until IS NULL) AND cleanup_verified) OR ((lifecycle_status = ANY (ARRAY['RUNNING'::text, 'RECOVERING'::text])) AND (finished_at IS NULL) AND (lease_until IS NOT NULL) AND (response_body IS NULL)))),
    CONSTRAINT executions_check1 CHECK (((response_body IS NULL) OR (((response_body ->> 'executionId'::text) = (id)::text) AND ((response_body ->> 'exerciseVersionId'::text) = (exercise_version_id)::text) AND ((response_body ->> 'mode'::text) = 'RUN'::text)))),
    CONSTRAINT executions_code_hash_check CHECK ((code_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT executions_lifecycle_status_check CHECK ((lifecycle_status = ANY (ARRAY['RUNNING'::text, 'RECOVERING'::text, 'COMPLETED'::text]))),
    CONSTRAINT executions_limits_snapshot_check CHECK (app_private.valid_practice_limits(limits_snapshot)),
    CONSTRAINT executions_purpose_check CHECK ((purpose = 'RUN'::text)),
    CONSTRAINT executions_runner_version_check CHECK (((length(runner_version) >= 1) AND (length(runner_version) <= 100))),
    CONSTRAINT executions_test_suite_hash_check CHECK ((test_suite_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT executions_visible_total_check CHECK (((visible_total >= 1) AND (visible_total <= 8)))
);

ALTER TABLE ONLY app.executions FORCE ROW LEVEL SECURITY;


ALTER TABLE app.executions OWNER TO postgres;

--
-- Name: exercise_version_concepts; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.exercise_version_concepts (
    organization_id uuid NOT NULL,
    exercise_version_id uuid NOT NULL,
    concept_id uuid NOT NULL,
    concept_version_id uuid NOT NULL
);

ALTER TABLE ONLY app.exercise_version_concepts FORCE ROW LEVEL SECURITY;


ALTER TABLE app.exercise_version_concepts OWNER TO postgres;

--
-- Name: exercise_versions; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.exercise_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    exercise_id uuid NOT NULL,
    version integer NOT NULL,
    title text NOT NULL,
    statement text NOT NULL,
    starter_code text NOT NULL,
    language text DEFAULT 'javascript'::text NOT NULL,
    difficulty text NOT NULL,
    entrypoint text DEFAULT 'solve'::text NOT NULL,
    execution_limits jsonb DEFAULT '{"timeoutMs": 3000, "memoryBytes": 134217728, "outputBytes": 65536}'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT exercise_versions_difficulty_check CHECK ((difficulty = ANY (ARRAY['BASIC'::text, 'INTERMEDIATE'::text, 'ADVANCED'::text]))),
    CONSTRAINT exercise_versions_entrypoint_check CHECK ((entrypoint = 'solve'::text)),
    CONSTRAINT exercise_versions_execution_limits_check CHECK (((jsonb_typeof(execution_limits) = 'object'::text) AND (execution_limits ?& ARRAY['memoryBytes'::text, 'timeoutMs'::text, 'outputBytes'::text]) AND ((execution_limits - ARRAY['memoryBytes'::text, 'timeoutMs'::text, 'outputBytes'::text]) = '{}'::jsonb) AND (jsonb_typeof((execution_limits -> 'memoryBytes'::text)) = 'number'::text) AND (jsonb_typeof((execution_limits -> 'timeoutMs'::text)) = 'number'::text) AND (jsonb_typeof((execution_limits -> 'outputBytes'::text)) = 'number'::text) AND ((((execution_limits ->> 'memoryBytes'::text))::bigint >= 1) AND (((execution_limits ->> 'memoryBytes'::text))::bigint <= 134217728)) AND ((((execution_limits ->> 'timeoutMs'::text))::integer >= 1) AND (((execution_limits ->> 'timeoutMs'::text))::integer <= 3000)) AND ((((execution_limits ->> 'outputBytes'::text))::integer >= 1) AND (((execution_limits ->> 'outputBytes'::text))::integer <= 65536)))),
    CONSTRAINT exercise_versions_language_check CHECK ((language = 'javascript'::text)),
    CONSTRAINT exercise_versions_starter_code_check CHECK ((octet_length(starter_code) <= 65536)),
    CONSTRAINT exercise_versions_statement_check CHECK (((char_length(btrim(statement)) >= 1) AND (char_length(btrim(statement)) <= 10000))),
    CONSTRAINT exercise_versions_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 160))),
    CONSTRAINT exercise_versions_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY app.exercise_versions FORCE ROW LEVEL SECURITY;


ALTER TABLE app.exercise_versions OWNER TO postgres;

--
-- Name: exercises; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.exercises (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    visibility text DEFAULT 'PRIVATE'::text NOT NULL,
    current_version_id uuid,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT exercises_revision_check CHECK ((revision > 0)),
    CONSTRAINT exercises_visibility_check CHECK ((visibility = ANY (ARRAY['PRIVATE'::text, 'ORGANIZATION'::text])))
);

ALTER TABLE ONLY app.exercises FORCE ROW LEVEL SECURITY;


ALTER TABLE app.exercises OWNER TO postgres;

--
-- Name: operation_keys; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.operation_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    actor_id uuid NOT NULL,
    operation text NOT NULL,
    key text NOT NULL,
    payload_hash text NOT NULL,
    state text DEFAULT 'RUNNING'::text NOT NULL,
    resource_type text,
    resource_id uuid,
    response_status integer,
    response_body jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
    lease_until timestamp with time zone,
    CONSTRAINT operation_keys_key_check CHECK (((char_length(key) >= 1) AND (char_length(key) <= 200))),
    CONSTRAINT operation_keys_operation_check CHECK (((char_length(operation) >= 1) AND (char_length(operation) <= 100))),
    CONSTRAINT operation_keys_payload_hash_check CHECK ((payload_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT operation_keys_response_status_check CHECK (((response_status >= 200) AND (response_status <= 599))),
    CONSTRAINT operation_keys_state_check CHECK ((state = ANY (ARRAY['RUNNING'::text, 'COMPLETED'::text])))
);

ALTER TABLE ONLY app.operation_keys FORCE ROW LEVEL SECURITY;


ALTER TABLE app.operation_keys OWNER TO postgres;

--
-- Name: organization_invitations; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.organization_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    email_normalized text NOT NULL,
    role text NOT NULL,
    invited_by uuid NOT NULL,
    token_digest text,
    generation integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '72:00:00'::interval) NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by uuid,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT organization_invitations_check CHECK (((accepted_at IS NULL) = (accepted_by IS NULL))),
    CONSTRAINT organization_invitations_check1 CHECK ((NOT ((accepted_at IS NOT NULL) AND (revoked_at IS NOT NULL)))),
    CONSTRAINT organization_invitations_check2 CHECK ((((generation = 0) AND (token_digest IS NULL)) OR ((generation > 0) AND (token_digest IS NOT NULL)))),
    CONSTRAINT organization_invitations_email_normalized_check CHECK (((email_normalized = lower(btrim(email_normalized))) AND ((char_length(email_normalized) >= 3) AND (char_length(email_normalized) <= 254)))),
    CONSTRAINT organization_invitations_generation_check CHECK ((generation >= 0)),
    CONSTRAINT organization_invitations_revision_check CHECK ((revision > 0)),
    CONSTRAINT organization_invitations_role_check CHECK ((role = ANY (ARRAY['ADMIN'::text, 'TEACHER'::text, 'STUDENT'::text]))),
    CONSTRAINT organization_invitations_token_digest_check CHECK (((token_digest IS NULL) OR (token_digest ~ '^[a-f0-9]{64}$'::text)))
);

ALTER TABLE ONLY app.organization_invitations FORCE ROW LEVEL SECURITY;


ALTER TABLE app.organization_invitations OWNER TO postgres;

--
-- Name: organization_memberships; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.organization_memberships (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    state text DEFAULT 'INVITED'::text NOT NULL,
    joined_at timestamp with time zone,
    disabled_at timestamp with time zone,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_memberships_revision_check CHECK ((revision > 0)),
    CONSTRAINT organization_memberships_role_check CHECK ((role = ANY (ARRAY['ADMIN'::text, 'TEACHER'::text, 'STUDENT'::text]))),
    CONSTRAINT organization_memberships_state_check CHECK ((state = ANY (ARRAY['INVITED'::text, 'ACTIVE'::text, 'DISABLED'::text])))
);

ALTER TABLE ONLY app.organization_memberships FORCE ROW LEVEL SECURITY;


ALTER TABLE app.organization_memberships OWNER TO postgres;

--
-- Name: organizations; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    timezone text DEFAULT 'America/Santiago'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    revision integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_by uuid,
    archive_reason text,
    CONSTRAINT organizations_archive_reason_check CHECK (((archive_reason IS NULL) OR ((char_length(btrim(archive_reason)) >= 1) AND (char_length(btrim(archive_reason)) <= 500)))),
    CONSTRAINT organizations_code_check CHECK (((char_length(code) >= 1) AND (char_length(code) <= 40) AND (code = upper(btrim(code))))),
    CONSTRAINT organizations_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 160) AND (btrim(name) <> ''::text))),
    CONSTRAINT organizations_revision_check CHECK ((revision > 0)),
    CONSTRAINT organizations_timezone_check CHECK (((char_length(timezone) >= 1) AND (char_length(timezone) <= 64) AND (btrim(timezone) <> ''::text)))
);

ALTER TABLE ONLY app.organizations FORCE ROW LEVEL SECURITY;


ALTER TABLE app.organizations OWNER TO postgres;

--
-- Name: profiles; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.profiles (
    id uuid NOT NULL,
    display_name text NOT NULL,
    email_normalized text NOT NULL,
    account_state text DEFAULT 'INVITED'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT profiles_account_state_check CHECK ((account_state = ANY (ARRAY['INVITED'::text, 'ACTIVE'::text, 'DISABLED'::text]))),
    CONSTRAINT profiles_display_name_check CHECK (((char_length(display_name) >= 1) AND (char_length(display_name) <= 120) AND (btrim(display_name) <> ''::text))),
    CONSTRAINT profiles_email_normalized_check CHECK (((char_length(email_normalized) >= 1) AND (char_length(email_normalized) <= 254) AND (email_normalized = lower(btrim(email_normalized)))))
);

ALTER TABLE ONLY app.profiles FORCE ROW LEVEL SECURITY;


ALTER TABLE app.profiles OWNER TO postgres;

--
-- Name: provisioning_grants; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.provisioning_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    granted_by text NOT NULL,
    reason text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by text,
    revocation_reason text,
    consumed_at timestamp with time zone,
    consumed_organization_id uuid,
    CONSTRAINT provisioning_grants_check CHECK ((expires_at > granted_at)),
    CONSTRAINT provisioning_grants_check1 CHECK (((consumed_at IS NULL) = (consumed_organization_id IS NULL))),
    CONSTRAINT provisioning_grants_granted_by_check CHECK (((char_length(btrim(granted_by)) >= 1) AND (char_length(btrim(granted_by)) <= 120))),
    CONSTRAINT provisioning_grants_reason_check CHECK (((char_length(btrim(reason)) >= 1) AND (char_length(btrim(reason)) <= 500))),
    CONSTRAINT provisioning_grants_revocation_reason_check CHECK (((revocation_reason IS NULL) OR ((char_length(btrim(revocation_reason)) >= 1) AND (char_length(btrim(revocation_reason)) <= 500)))),
    CONSTRAINT provisioning_grants_revoked_by_check CHECK (((revoked_by IS NULL) OR ((char_length(btrim(revoked_by)) >= 1) AND (char_length(btrim(revoked_by)) <= 120))))
);

ALTER TABLE ONLY app.provisioning_grants FORCE ROW LEVEL SECURITY;


ALTER TABLE app.provisioning_grants OWNER TO postgres;

--
-- Name: attempt_events; Type: TABLE; Schema: app_private; Owner: postgres
--

CREATE TABLE app_private.attempt_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_sequence bigint NOT NULL,
    organization_id uuid NOT NULL,
    class_id uuid NOT NULL,
    activity_id uuid NOT NULL,
    activity_exercise_id uuid NOT NULL,
    exercise_version_id uuid NOT NULL,
    student_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    event_type text NOT NULL,
    schema_version text DEFAULT 'submission.v1'::text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    CONSTRAINT attempt_events_event_type_check CHECK ((event_type = ANY (ARRAY['ATTEMPT_SUBMITTED'::text, 'EXECUTION_COMPLETED'::text]))),
    CONSTRAINT attempt_events_schema_version_check CHECK ((schema_version = 'submission.v1'::text))
);

ALTER TABLE ONLY app_private.attempt_events FORCE ROW LEVEL SECURITY;


ALTER TABLE app_private.attempt_events OWNER TO postgres;

--
-- Name: attempt_events_event_sequence_seq; Type: SEQUENCE; Schema: app_private; Owner: postgres
--

ALTER TABLE app_private.attempt_events ALTER COLUMN event_sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME app_private.attempt_events_event_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: attempt_results; Type: TABLE; Schema: app_private; Owner: postgres
--

CREATE TABLE app_private.attempt_results (
    attempt_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    result_schema_version text DEFAULT 'submission.v1'::text NOT NULL,
    runner_version text NOT NULL,
    test_suite_hash text NOT NULL,
    private_test_results jsonb NOT NULL,
    CONSTRAINT attempt_results_private_test_results_check CHECK ((jsonb_typeof(private_test_results) = 'array'::text)),
    CONSTRAINT attempt_results_result_schema_version_check CHECK ((result_schema_version = 'submission.v1'::text)),
    CONSTRAINT attempt_results_test_suite_hash_check CHECK ((test_suite_hash ~ '^[a-f0-9]{64}$'::text))
);

ALTER TABLE ONLY app_private.attempt_results FORCE ROW LEVEL SECURITY;


ALTER TABLE app_private.attempt_results OWNER TO postgres;

--
-- Name: exercise_tests; Type: TABLE; Schema: app_private; Owner: postgres
--

CREATE TABLE app_private.exercise_tests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    exercise_version_id uuid NOT NULL,
    "position" integer NOT NULL,
    visibility text NOT NULL,
    args jsonb NOT NULL,
    expected jsonb NOT NULL,
    comparator text DEFAULT 'EXACT_DEEP'::text NOT NULL,
    CONSTRAINT exercise_tests_args_check CHECK (((jsonb_typeof(args) = 'array'::text) AND (octet_length((args)::text) <= 65536))),
    CONSTRAINT exercise_tests_comparator_check CHECK ((comparator = 'EXACT_DEEP'::text)),
    CONSTRAINT exercise_tests_expected_check CHECK ((octet_length((expected)::text) <= 65536)),
    CONSTRAINT exercise_tests_position_check CHECK (("position" >= 0)),
    CONSTRAINT exercise_tests_visibility_check CHECK ((visibility = ANY (ARRAY['VISIBLE'::text, 'HIDDEN'::text])))
);

ALTER TABLE ONLY app_private.exercise_tests FORCE ROW LEVEL SECURITY;


ALTER TABLE app_private.exercise_tests OWNER TO postgres;

--
-- Name: activities activities_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.activities
    ADD CONSTRAINT activities_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


--
-- Name: activity_exercises activity_exercises_organization_id_activity_id_exercise_ver_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.activity_exercises
    ADD CONSTRAINT activity_exercises_organization_id_activity_id_exercise_ver_key UNIQUE (organization_id, activity_id, exercise_version_id);


--
-- Name: activity_exercises activity_exercises_organization_id_activity_id_position_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.activity_exercises
    ADD CONSTRAINT activity_exercises_organization_id_activity_id_position_key UNIQUE (organization_id, activity_id, "position");


--
-- Name: activity_exercises activity_exercises_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.activity_exercises
    ADD CONSTRAINT activity_exercises_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: activity_exercises activity_exercises_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.activity_exercises
    ADD CONSTRAINT activity_exercises_pkey PRIMARY KEY (id);


--
-- Name: attempts attempts_execution_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.attempts
    ADD CONSTRAINT attempts_execution_id_key UNIQUE (execution_id);


--
-- Name: attempts attempts_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.attempts
    ADD CONSTRAINT attempts_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: attempts attempts_organization_id_student_id_activity_exercise_id_at_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.attempts
    ADD CONSTRAINT attempts_organization_id_student_id_activity_exercise_id_at_key UNIQUE (organization_id, student_id, activity_exercise_id, attempt_number);


--
-- Name: attempts attempts_organization_id_student_id_activity_exercise_id_ex_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.attempts
    ADD CONSTRAINT attempts_organization_id_student_id_activity_exercise_id_ex_key UNIQUE (organization_id, student_id, activity_exercise_id, exercise_version_id, id);


--
-- Name: attempts attempts_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.attempts
    ADD CONSTRAINT attempts_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: class_join_codes class_join_codes_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.class_join_codes
    ADD CONSTRAINT class_join_codes_pkey PRIMARY KEY (id);


--
-- Name: class_join_codes class_join_codes_token_digest_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.class_join_codes
    ADD CONSTRAINT class_join_codes_token_digest_key UNIQUE (token_digest);


--
-- Name: class_memberships class_memberships_organization_id_class_id_user_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.class_memberships
    ADD CONSTRAINT class_memberships_organization_id_class_id_user_id_key UNIQUE (organization_id, class_id, user_id);


--
-- Name: class_memberships class_memberships_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.class_memberships
    ADD CONSTRAINT class_memberships_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: class_memberships class_memberships_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.class_memberships
    ADD CONSTRAINT class_memberships_pkey PRIMARY KEY (id);


--
-- Name: classes classes_organization_id_code_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.classes
    ADD CONSTRAINT classes_organization_id_code_key UNIQUE (organization_id, code);


--
-- Name: classes classes_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.classes
    ADD CONSTRAINT classes_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: classes classes_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.classes
    ADD CONSTRAINT classes_pkey PRIMARY KEY (id);


--
-- Name: concept_versions concept_versions_organization_id_concept_id_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.concept_versions
    ADD CONSTRAINT concept_versions_organization_id_concept_id_id_key UNIQUE (organization_id, concept_id, id);


--
-- Name: concept_versions concept_versions_organization_id_concept_id_version_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.concept_versions
    ADD CONSTRAINT concept_versions_organization_id_concept_id_version_key UNIQUE (organization_id, concept_id, version);


--
-- Name: concept_versions concept_versions_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.concept_versions
    ADD CONSTRAINT concept_versions_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: concept_versions concept_versions_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.concept_versions
    ADD CONSTRAINT concept_versions_pkey PRIMARY KEY (id);


--
-- Name: concepts concepts_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.concepts
    ADD CONSTRAINT concepts_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: concepts concepts_organization_id_normalized_name_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.concepts
    ADD CONSTRAINT concepts_organization_id_normalized_name_key UNIQUE (organization_id, normalized_name);


--
-- Name: concepts concepts_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.concepts
    ADD CONSTRAINT concepts_pkey PRIMARY KEY (id);


--
-- Name: courses courses_organization_id_code_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.courses
    ADD CONSTRAINT courses_organization_id_code_key UNIQUE (organization_id, code);


--
-- Name: courses courses_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.courses
    ADD CONSTRAINT courses_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (id);


--
-- Name: executions executions_operation_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.executions
    ADD CONSTRAINT executions_operation_id_key UNIQUE (operation_id);


--
-- Name: executions executions_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.executions
    ADD CONSTRAINT executions_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: executions executions_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.executions
    ADD CONSTRAINT executions_pkey PRIMARY KEY (id);


--
-- Name: exercise_version_concepts exercise_version_concepts_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.exercise_version_concepts
    ADD CONSTRAINT exercise_version_concepts_pkey PRIMARY KEY (organization_id, exercise_version_id, concept_id);


--
-- Name: exercise_versions exercise_versions_organization_id_exercise_id_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.exercise_versions
    ADD CONSTRAINT exercise_versions_organization_id_exercise_id_id_key UNIQUE (organization_id, exercise_id, id);


--
-- Name: exercise_versions exercise_versions_organization_id_exercise_id_version_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.exercise_versions
    ADD CONSTRAINT exercise_versions_organization_id_exercise_id_version_key UNIQUE (organization_id, exercise_id, version);


--
-- Name: exercise_versions exercise_versions_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.exercise_versions
    ADD CONSTRAINT exercise_versions_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: exercise_versions exercise_versions_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.exercise_versions
    ADD CONSTRAINT exercise_versions_pkey PRIMARY KEY (id);


--
-- Name: exercises exercises_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.exercises
    ADD CONSTRAINT exercises_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: exercises exercises_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.exercises
    ADD CONSTRAINT exercises_pkey PRIMARY KEY (id);


--
-- Name: invitation_deliveries invitation_deliveries_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.invitation_deliveries
    ADD CONSTRAINT invitation_deliveries_pkey PRIMARY KEY (id);


--
-- Name: operation_keys operation_keys_organization_id_actor_id_operation_key_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.operation_keys
    ADD CONSTRAINT operation_keys_organization_id_actor_id_operation_key_key UNIQUE NULLS NOT DISTINCT (organization_id, actor_id, operation, key);


--
-- Name: operation_keys operation_keys_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.operation_keys
    ADD CONSTRAINT operation_keys_pkey PRIMARY KEY (id);


--
-- Name: organization_invitations organization_invitations_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.organization_invitations
    ADD CONSTRAINT organization_invitations_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: organization_invitations organization_invitations_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.organization_invitations
    ADD CONSTRAINT organization_invitations_pkey PRIMARY KEY (id);


--
-- Name: organization_memberships organization_memberships_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.organization_memberships
    ADD CONSTRAINT organization_memberships_pkey PRIMARY KEY (organization_id, user_id);


--
-- Name: organizations organizations_code_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.organizations
    ADD CONSTRAINT organizations_code_key UNIQUE (code);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_email_normalized_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.profiles
    ADD CONSTRAINT profiles_email_normalized_key UNIQUE (email_normalized);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: provisioning_grants provisioning_grants_consumed_organization_id_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.provisioning_grants
    ADD CONSTRAINT provisioning_grants_consumed_organization_id_key UNIQUE (consumed_organization_id);


--
-- Name: provisioning_grants provisioning_grants_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.provisioning_grants
    ADD CONSTRAINT provisioning_grants_pkey PRIMARY KEY (id);


--
-- Name: attempt_events attempt_events_attempt_id_event_type_key; Type: CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.attempt_events
    ADD CONSTRAINT attempt_events_attempt_id_event_type_key UNIQUE (attempt_id, event_type);


--
-- Name: attempt_events attempt_events_event_sequence_key; Type: CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.attempt_events
    ADD CONSTRAINT attempt_events_event_sequence_key UNIQUE (event_sequence);


--
-- Name: attempt_events attempt_events_pkey; Type: CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.attempt_events
    ADD CONSTRAINT attempt_events_pkey PRIMARY KEY (id);


--
-- Name: attempt_results attempt_results_pkey; Type: CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.attempt_results
    ADD CONSTRAINT attempt_results_pkey PRIMARY KEY (attempt_id);


--
-- Name: exercise_tests exercise_tests_organization_id_exercise_version_id_position_key; Type: CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.exercise_tests
    ADD CONSTRAINT exercise_tests_organization_id_exercise_version_id_position_key UNIQUE (organization_id, exercise_version_id, "position");


--
-- Name: exercise_tests exercise_tests_pkey; Type: CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.exercise_tests
    ADD CONSTRAINT exercise_tests_pkey PRIMARY KEY (id);


--
-- Name: submission_reservations submission_reservations_attempt_id_key; Type: CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.submission_reservations
    ADD CONSTRAINT submission_reservations_attempt_id_key UNIQUE (attempt_id);


--
-- Name: submission_reservations submission_reservations_operation_id_key; Type: CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.submission_reservations
    ADD CONSTRAINT submission_reservations_operation_id_key UNIQUE (operation_id);


--
-- Name: submission_reservations submission_reservations_organization_id_id_key; Type: CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.submission_reservations
    ADD CONSTRAINT submission_reservations_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: submission_reservations submission_reservations_organization_id_student_id_activity_key; Type: CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.submission_reservations
    ADD CONSTRAINT submission_reservations_organization_id_student_id_activity_key UNIQUE (organization_id, student_id, activity_exercise_id, attempt_number);


--
-- Name: submission_reservations submission_reservations_pkey; Type: CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.submission_reservations
    ADD CONSTRAINT submission_reservations_pkey PRIMARY KEY (id);


--
-- Name: activities_class_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX activities_class_idx ON app.activities USING btree (organization_id, class_id, state, created_at, id);


--
-- Name: activity_exercises_version_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX activity_exercises_version_idx ON app.activity_exercises USING btree (organization_id, exercise_version_id);


--
-- Name: attempts_completion; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX attempts_completion ON app.attempts USING btree (organization_id, student_id, activity_id, activity_exercise_id, exercise_version_id) WHERE ((technical_result -> 'allRequiredPassed'::text) = 'true'::jsonb);


--
-- Name: attempts_history; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX attempts_history ON app.attempts USING btree (organization_id, student_id, activity_id, activity_exercise_id, attempt_number DESC);


--
-- Name: audit_events_org_time_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX audit_events_org_time_idx ON app.audit_events USING btree (organization_id, occurred_at DESC, id);


--
-- Name: class_join_codes_class_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX class_join_codes_class_idx ON app.class_join_codes USING btree (organization_id, class_id);


--
-- Name: class_memberships_user_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX class_memberships_user_idx ON app.class_memberships USING btree (organization_id, user_id, class_id);


--
-- Name: classes_course_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX classes_course_idx ON app.classes USING btree (organization_id, course_id);


--
-- Name: classes_teacher_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX classes_teacher_idx ON app.classes USING btree (organization_id, teacher_id);


--
-- Name: concept_versions_parent_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX concept_versions_parent_idx ON app.concept_versions USING btree (organization_id, parent_concept_id);


--
-- Name: executions_actor_active; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX executions_actor_active ON app.executions USING btree (student_id, organization_id) WHERE (lifecycle_status <> 'COMPLETED'::text);


--
-- Name: executions_actor_admitted; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX executions_actor_admitted ON app.executions USING btree (organization_id, student_id, admitted_at DESC);


--
-- Name: executions_lease; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX executions_lease ON app.executions USING btree (lease_until, id) WHERE (lifecycle_status <> 'COMPLETED'::text);


--
-- Name: executions_org_active; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX executions_org_active ON app.executions USING btree (organization_id) WHERE (lifecycle_status <> 'COMPLETED'::text);


--
-- Name: executions_response_expiry; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX executions_response_expiry ON app.executions USING btree (response_expires_at, id) WHERE (response_body IS NOT NULL);


--
-- Name: exercise_version_concepts_concept_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX exercise_version_concepts_concept_idx ON app.exercise_version_concepts USING btree (organization_id, concept_id);


--
-- Name: exercises_owner_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX exercises_owner_idx ON app.exercises USING btree (organization_id, owner_id);


--
-- Name: invitation_deliveries_invitation_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX invitation_deliveries_invitation_idx ON app.invitation_deliveries USING btree (organization_id, invitation_id);


--
-- Name: invitation_deliveries_latest_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX invitation_deliveries_latest_idx ON app.invitation_deliveries USING btree (organization_id, invitation_id, created_at DESC, id DESC);


--
-- Name: invitation_deliveries_ready_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX invitation_deliveries_ready_idx ON app.invitation_deliveries USING btree (available_at, id) WHERE (state = ANY (ARRAY['QUEUED'::text, 'UNCERTAIN'::text, 'RUNNING'::text]));


--
-- Name: operation_keys_response_expiry_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX operation_keys_response_expiry_idx ON app.operation_keys USING btree (expires_at, id) WHERE (response_body IS NOT NULL);


--
-- Name: organization_invitations_pending_email_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE UNIQUE INDEX organization_invitations_pending_email_idx ON app.organization_invitations USING btree (organization_id, email_normalized) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: organization_memberships_user_id_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX organization_memberships_user_id_idx ON app.organization_memberships USING btree (user_id);


--
-- Name: provisioning_grants_user_idx; Type: INDEX; Schema: app; Owner: postgres
--

CREATE INDEX provisioning_grants_user_idx ON app.provisioning_grants USING btree (user_id);


--
-- Name: attempt_events_scope; Type: INDEX; Schema: app_private; Owner: postgres
--

CREATE INDEX attempt_events_scope ON app_private.attempt_events USING btree (organization_id, class_id, student_id, event_sequence);


--
-- Name: submissions_actor_active; Type: INDEX; Schema: app_private; Owner: postgres
--

CREATE INDEX submissions_actor_active ON app_private.submission_reservations USING btree (student_id, organization_id) WHERE (lifecycle_status <> 'COMPLETED'::text);


--
-- Name: submissions_actor_admitted; Type: INDEX; Schema: app_private; Owner: postgres
--

CREATE INDEX submissions_actor_admitted ON app_private.submission_reservations USING btree (organization_id, student_id, admitted_at DESC);


--
-- Name: submissions_lease; Type: INDEX; Schema: app_private; Owner: postgres
--

CREATE INDEX submissions_lease ON app_private.submission_reservations USING btree (lease_until, id) WHERE (lifecycle_status <> 'COMPLETED'::text);


--
-- Name: submissions_org_active; Type: INDEX; Schema: app_private; Owner: postgres
--

CREATE INDEX submissions_org_active ON app_private.submission_reservations USING btree (organization_id) WHERE (lifecycle_status <> 'COMPLETED'::text);


--
-- Name: submissions_response_expiry; Type: INDEX; Schema: app_private; Owner: postgres
--

CREATE INDEX submissions_response_expiry ON app_private.submission_reservations USING btree (response_expires_at, id) WHERE ((response_body IS NOT NULL) OR (code IS NOT NULL));


--
-- Name: activities a_academic_scope; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER a_academic_scope BEFORE INSERT OR DELETE OR UPDATE ON app.activities FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_scope();


--
-- Name: activity_exercises a_academic_scope; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER a_academic_scope BEFORE INSERT OR DELETE OR UPDATE ON app.activity_exercises FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_scope();


--
-- Name: class_join_codes a_academic_scope; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER a_academic_scope BEFORE INSERT OR DELETE OR UPDATE ON app.class_join_codes FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_scope();


--
-- Name: class_memberships a_academic_scope; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER a_academic_scope BEFORE INSERT OR DELETE OR UPDATE ON app.class_memberships FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_scope();


--
-- Name: classes a_academic_scope; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER a_academic_scope BEFORE INSERT OR DELETE OR UPDATE ON app.classes FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_scope();


--
-- Name: concept_versions a_academic_scope; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER a_academic_scope BEFORE INSERT OR DELETE OR UPDATE ON app.concept_versions FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_scope();


--
-- Name: concepts a_academic_scope; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER a_academic_scope BEFORE INSERT OR DELETE OR UPDATE ON app.concepts FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_scope();


--
-- Name: courses a_academic_scope; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER a_academic_scope BEFORE INSERT OR DELETE OR UPDATE ON app.courses FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_scope();


--
-- Name: exercise_versions a_academic_scope; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER a_academic_scope BEFORE INSERT OR DELETE OR UPDATE ON app.exercise_versions FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_scope();


--
-- Name: exercises a_academic_scope; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER a_academic_scope BEFORE INSERT OR DELETE OR UPDATE ON app.exercises FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_scope();


--
-- Name: attempts attempts_context; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER attempts_context BEFORE INSERT OR DELETE OR UPDATE ON app.attempts FOR EACH ROW EXECUTE FUNCTION app_private.guard_attempt_context();


--
-- Name: audit_events audit_append_only; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER audit_append_only BEFORE DELETE OR UPDATE ON app.audit_events FOR EACH ROW EXECUTE FUNCTION app_private.audit_append_only();


--
-- Name: classes b_academic_entity; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER b_academic_entity BEFORE INSERT OR UPDATE ON app.classes FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_entity();


--
-- Name: concepts b_academic_entity; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER b_academic_entity BEFORE INSERT OR UPDATE ON app.concepts FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_entity();


--
-- Name: courses b_academic_entity; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER b_academic_entity BEFORE INSERT OR UPDATE ON app.courses FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_entity();


--
-- Name: exercises b_academic_entity; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER b_academic_entity BEFORE INSERT OR UPDATE ON app.exercises FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_entity();


--
-- Name: activities b_activity; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER b_activity BEFORE INSERT OR UPDATE ON app.activities FOR EACH ROW EXECUTE FUNCTION app_private.guard_activity();


--
-- Name: activity_exercises b_activity_exercise; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER b_activity_exercise BEFORE INSERT OR DELETE OR UPDATE ON app.activity_exercises FOR EACH ROW EXECUTE FUNCTION app_private.guard_activity_exercise();


--
-- Name: class_join_codes b_class_code; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER b_class_code BEFORE INSERT OR UPDATE ON app.class_join_codes FOR EACH ROW EXECUTE FUNCTION app_private.guard_class_code();


--
-- Name: class_memberships b_class_enrollment; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER b_class_enrollment BEFORE INSERT OR UPDATE ON app.class_memberships FOR EACH ROW EXECUTE FUNCTION app_private.guard_class_enrollment();


--
-- Name: exercise_version_concepts b_exercise_child; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER b_exercise_child BEFORE INSERT OR DELETE OR UPDATE ON app.exercise_version_concepts FOR EACH ROW EXECUTE FUNCTION app_private.guard_exercise_child();


--
-- Name: concept_versions b_version; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER b_version BEFORE INSERT OR DELETE OR UPDATE ON app.concept_versions FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_version();


--
-- Name: exercise_versions b_version; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER b_version BEFORE INSERT OR DELETE OR UPDATE ON app.exercise_versions FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_version();


--
-- Name: class_memberships c_count_enrollment; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER c_count_enrollment AFTER INSERT ON app.class_memberships FOR EACH ROW EXECUTE FUNCTION app_private.count_class_enrollment();


--
-- Name: concepts concept_complete; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE CONSTRAINT TRIGGER concept_complete AFTER INSERT OR UPDATE ON app.concepts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.assert_academic_version_complete();


--
-- Name: executions executions_context; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER executions_context BEFORE INSERT OR UPDATE ON app.executions FOR EACH ROW EXECUTE FUNCTION app_private.guard_execution_context();


--
-- Name: executions executions_recovery_grace; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER executions_recovery_grace BEFORE UPDATE OF lifecycle_status ON app.executions FOR EACH ROW WHEN ((new.lifecycle_status = 'RECOVERING'::text)) EXECUTE FUNCTION app_private.guard_practice_recovery_grace();


--
-- Name: exercises exercise_complete; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE CONSTRAINT TRIGGER exercise_complete AFTER INSERT OR UPDATE ON app.exercises DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.assert_academic_version_complete();


--
-- Name: classes guard_class_submissions; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER guard_class_submissions BEFORE UPDATE OF archived_at ON app.classes FOR EACH ROW WHEN (((old.archived_at IS NULL) AND (new.archived_at IS NOT NULL))) EXECUTE FUNCTION app_private.guard_class_submissions();


--
-- Name: invitation_deliveries guard_delivery_change; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER guard_delivery_change BEFORE INSERT OR UPDATE ON app.invitation_deliveries FOR EACH ROW EXECUTE FUNCTION app_private.guard_delivery_change();


--
-- Name: organization_invitations guard_invitation_change; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER guard_invitation_change BEFORE INSERT OR UPDATE ON app.organization_invitations FOR EACH ROW EXECUTE FUNCTION app_private.guard_invitation_change();


--
-- Name: organization_memberships guard_membership_change; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER guard_membership_change BEFORE INSERT OR UPDATE ON app.organization_memberships FOR EACH ROW EXECUTE FUNCTION app_private.guard_membership_change();


--
-- Name: organizations guard_organization_academic_archive; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER guard_organization_academic_archive BEFORE UPDATE ON app.organizations FOR EACH ROW EXECUTE FUNCTION app_private.guard_organization_academic_archive();


--
-- Name: organizations guard_organization_change; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER guard_organization_change BEFORE UPDATE ON app.organizations FOR EACH ROW EXECUTE FUNCTION app_private.guard_organization_change();


--
-- Name: organizations guard_organization_practice_runs; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE TRIGGER guard_organization_practice_runs BEFORE UPDATE OF archived_at ON app.organizations FOR EACH ROW WHEN (((old.archived_at IS NULL) AND (new.archived_at IS NOT NULL))) EXECUTE FUNCTION app_private.guard_organization_practice_runs();


--
-- Name: organizations provisioning_complete; Type: TRIGGER; Schema: app; Owner: postgres
--

CREATE CONSTRAINT TRIGGER provisioning_complete AFTER INSERT ON app.organizations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.assert_provisioning_complete();


--
-- Name: exercise_tests a_academic_scope; Type: TRIGGER; Schema: app_private; Owner: postgres
--

CREATE TRIGGER a_academic_scope BEFORE INSERT OR DELETE OR UPDATE ON app_private.exercise_tests FOR EACH ROW EXECUTE FUNCTION app_private.guard_academic_scope();


--
-- Name: attempt_events attempt_events_context; Type: TRIGGER; Schema: app_private; Owner: postgres
--

CREATE TRIGGER attempt_events_context BEFORE INSERT OR DELETE OR UPDATE ON app_private.attempt_events FOR EACH ROW EXECUTE FUNCTION app_private.guard_attempt_event();


--
-- Name: attempt_results attempt_results_context; Type: TRIGGER; Schema: app_private; Owner: postgres
--

CREATE TRIGGER attempt_results_context BEFORE INSERT OR DELETE OR UPDATE ON app_private.attempt_results FOR EACH ROW EXECUTE FUNCTION app_private.guard_attempt_result();


--
-- Name: exercise_tests b_exercise_child; Type: TRIGGER; Schema: app_private; Owner: postgres
--

CREATE TRIGGER b_exercise_child BEFORE INSERT OR DELETE OR UPDATE ON app_private.exercise_tests FOR EACH ROW EXECUTE FUNCTION app_private.guard_exercise_child();


--
-- Name: submission_reservations submissions_context; Type: TRIGGER; Schema: app_private; Owner: postgres
--

CREATE TRIGGER submissions_context BEFORE INSERT OR UPDATE ON app_private.submission_reservations FOR EACH ROW EXECUTE FUNCTION app_private.guard_submission_context();


--
-- Name: activities activities_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.activities
    ADD CONSTRAINT activities_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.profiles(id) ON DELETE RESTRICT;


--
-- Name: activities activities_organization_id_class_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.activities
    ADD CONSTRAINT activities_organization_id_class_id_fkey FOREIGN KEY (organization_id, class_id) REFERENCES app.classes(organization_id, id) ON DELETE RESTRICT;


--
-- Name: activity_exercises activity_exercises_organization_id_activity_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.activity_exercises
    ADD CONSTRAINT activity_exercises_organization_id_activity_id_fkey FOREIGN KEY (organization_id, activity_id) REFERENCES app.activities(organization_id, id) ON DELETE RESTRICT;


--
-- Name: activity_exercises activity_exercises_organization_id_exercise_version_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.activity_exercises
    ADD CONSTRAINT activity_exercises_organization_id_exercise_version_id_fkey FOREIGN KEY (organization_id, exercise_version_id) REFERENCES app.exercise_versions(organization_id, id) ON DELETE RESTRICT;


--
-- Name: attempts attempts_organization_id_activity_exercise_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.attempts
    ADD CONSTRAINT attempts_organization_id_activity_exercise_id_fkey FOREIGN KEY (organization_id, activity_exercise_id) REFERENCES app.activity_exercises(organization_id, id);


--
-- Name: attempts attempts_organization_id_activity_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.attempts
    ADD CONSTRAINT attempts_organization_id_activity_id_fkey FOREIGN KEY (organization_id, activity_id) REFERENCES app.activities(organization_id, id);


--
-- Name: attempts attempts_organization_id_class_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.attempts
    ADD CONSTRAINT attempts_organization_id_class_id_fkey FOREIGN KEY (organization_id, class_id) REFERENCES app.classes(organization_id, id);


--
-- Name: attempts attempts_organization_id_execution_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.attempts
    ADD CONSTRAINT attempts_organization_id_execution_id_fkey FOREIGN KEY (organization_id, execution_id) REFERENCES app_private.submission_reservations(organization_id, id);


--
-- Name: attempts attempts_organization_id_exercise_version_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.attempts
    ADD CONSTRAINT attempts_organization_id_exercise_version_id_fkey FOREIGN KEY (organization_id, exercise_version_id) REFERENCES app.exercise_versions(organization_id, id);


--
-- Name: attempts attempts_organization_id_student_id_activity_exercise_id_e_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.attempts
    ADD CONSTRAINT attempts_organization_id_student_id_activity_exercise_id_e_fkey FOREIGN KEY (organization_id, student_id, activity_exercise_id, exercise_version_id, previous_attempt_id) REFERENCES app.attempts(organization_id, student_id, activity_exercise_id, exercise_version_id, id);


--
-- Name: attempts attempts_organization_id_student_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.attempts
    ADD CONSTRAINT attempts_organization_id_student_id_fkey FOREIGN KEY (organization_id, student_id) REFERENCES app.organization_memberships(organization_id, user_id);


--
-- Name: audit_events audit_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.audit_events
    ADD CONSTRAINT audit_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: audit_events audit_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.audit_events
    ADD CONSTRAINT audit_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organizations(id) ON DELETE RESTRICT;


--
-- Name: class_join_codes class_join_codes_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.class_join_codes
    ADD CONSTRAINT class_join_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.profiles(id) ON DELETE RESTRICT;


--
-- Name: class_join_codes class_join_codes_organization_id_class_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.class_join_codes
    ADD CONSTRAINT class_join_codes_organization_id_class_id_fkey FOREIGN KEY (organization_id, class_id) REFERENCES app.classes(organization_id, id) ON DELETE RESTRICT;


--
-- Name: class_memberships class_memberships_organization_id_class_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.class_memberships
    ADD CONSTRAINT class_memberships_organization_id_class_id_fkey FOREIGN KEY (organization_id, class_id) REFERENCES app.classes(organization_id, id) ON DELETE RESTRICT;


--
-- Name: class_memberships class_memberships_organization_id_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.class_memberships
    ADD CONSTRAINT class_memberships_organization_id_user_id_fkey FOREIGN KEY (organization_id, user_id) REFERENCES app.organization_memberships(organization_id, user_id) ON DELETE RESTRICT;


--
-- Name: classes classes_organization_id_course_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.classes
    ADD CONSTRAINT classes_organization_id_course_id_fkey FOREIGN KEY (organization_id, course_id) REFERENCES app.courses(organization_id, id) ON DELETE RESTRICT;


--
-- Name: classes classes_organization_id_teacher_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.classes
    ADD CONSTRAINT classes_organization_id_teacher_id_fkey FOREIGN KEY (organization_id, teacher_id) REFERENCES app.organization_memberships(organization_id, user_id) ON DELETE RESTRICT;


--
-- Name: concept_versions concept_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.concept_versions
    ADD CONSTRAINT concept_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.profiles(id) ON DELETE RESTRICT;


--
-- Name: concept_versions concept_versions_organization_id_concept_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.concept_versions
    ADD CONSTRAINT concept_versions_organization_id_concept_id_fkey FOREIGN KEY (organization_id, concept_id) REFERENCES app.concepts(organization_id, id) ON DELETE RESTRICT;


--
-- Name: concept_versions concept_versions_organization_id_parent_concept_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.concept_versions
    ADD CONSTRAINT concept_versions_organization_id_parent_concept_id_fkey FOREIGN KEY (organization_id, parent_concept_id) REFERENCES app.concepts(organization_id, id) ON DELETE RESTRICT;


--
-- Name: concepts concepts_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.concepts
    ADD CONSTRAINT concepts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organizations(id) ON DELETE RESTRICT;


--
-- Name: concepts concepts_organization_id_id_current_version_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.concepts
    ADD CONSTRAINT concepts_organization_id_id_current_version_id_fkey FOREIGN KEY (organization_id, id, current_version_id) REFERENCES app.concept_versions(organization_id, concept_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: courses courses_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.courses
    ADD CONSTRAINT courses_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organizations(id) ON DELETE RESTRICT;


--
-- Name: executions executions_operation_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.executions
    ADD CONSTRAINT executions_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES app.operation_keys(id);


--
-- Name: executions executions_organization_id_activity_exercise_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.executions
    ADD CONSTRAINT executions_organization_id_activity_exercise_id_fkey FOREIGN KEY (organization_id, activity_exercise_id) REFERENCES app.activity_exercises(organization_id, id);


--
-- Name: executions executions_organization_id_activity_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.executions
    ADD CONSTRAINT executions_organization_id_activity_id_fkey FOREIGN KEY (organization_id, activity_id) REFERENCES app.activities(organization_id, id);


--
-- Name: executions executions_organization_id_class_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.executions
    ADD CONSTRAINT executions_organization_id_class_id_fkey FOREIGN KEY (organization_id, class_id) REFERENCES app.classes(organization_id, id);


--
-- Name: executions executions_organization_id_exercise_version_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.executions
    ADD CONSTRAINT executions_organization_id_exercise_version_id_fkey FOREIGN KEY (organization_id, exercise_version_id) REFERENCES app.exercise_versions(organization_id, id);


--
-- Name: executions executions_organization_id_student_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.executions
    ADD CONSTRAINT executions_organization_id_student_id_fkey FOREIGN KEY (organization_id, student_id) REFERENCES app.organization_memberships(organization_id, user_id);


--
-- Name: exercise_version_concepts exercise_version_concepts_organization_id_concept_id_conce_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.exercise_version_concepts
    ADD CONSTRAINT exercise_version_concepts_organization_id_concept_id_conce_fkey FOREIGN KEY (organization_id, concept_id, concept_version_id) REFERENCES app.concept_versions(organization_id, concept_id, id) ON DELETE RESTRICT;


--
-- Name: exercise_version_concepts exercise_version_concepts_organization_id_exercise_version_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.exercise_version_concepts
    ADD CONSTRAINT exercise_version_concepts_organization_id_exercise_version_fkey FOREIGN KEY (organization_id, exercise_version_id) REFERENCES app.exercise_versions(organization_id, id) ON DELETE RESTRICT;


--
-- Name: exercise_versions exercise_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.exercise_versions
    ADD CONSTRAINT exercise_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.profiles(id) ON DELETE RESTRICT;


--
-- Name: exercise_versions exercise_versions_organization_id_exercise_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.exercise_versions
    ADD CONSTRAINT exercise_versions_organization_id_exercise_id_fkey FOREIGN KEY (organization_id, exercise_id) REFERENCES app.exercises(organization_id, id) ON DELETE RESTRICT;


--
-- Name: exercises exercises_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.exercises
    ADD CONSTRAINT exercises_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organizations(id) ON DELETE RESTRICT;


--
-- Name: exercises exercises_organization_id_id_current_version_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.exercises
    ADD CONSTRAINT exercises_organization_id_id_current_version_id_fkey FOREIGN KEY (organization_id, id, current_version_id) REFERENCES app.exercise_versions(organization_id, exercise_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: exercises exercises_organization_id_owner_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.exercises
    ADD CONSTRAINT exercises_organization_id_owner_id_fkey FOREIGN KEY (organization_id, owner_id) REFERENCES app.organization_memberships(organization_id, user_id) ON DELETE RESTRICT;


--
-- Name: invitation_deliveries invitation_deliveries_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.invitation_deliveries
    ADD CONSTRAINT invitation_deliveries_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: invitation_deliveries invitation_deliveries_organization_id_invitation_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.invitation_deliveries
    ADD CONSTRAINT invitation_deliveries_organization_id_invitation_id_fkey FOREIGN KEY (organization_id, invitation_id) REFERENCES app.organization_invitations(organization_id, id) ON DELETE RESTRICT;


--
-- Name: invitation_deliveries invitation_deliveries_requested_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.invitation_deliveries
    ADD CONSTRAINT invitation_deliveries_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES app.profiles(id) ON DELETE RESTRICT;


--
-- Name: operation_keys operation_keys_actor_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.operation_keys
    ADD CONSTRAINT operation_keys_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: operation_keys operation_keys_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.operation_keys
    ADD CONSTRAINT operation_keys_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organizations(id) ON DELETE RESTRICT;


--
-- Name: organization_invitations organization_invitations_accepted_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.organization_invitations
    ADD CONSTRAINT organization_invitations_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES app.profiles(id) ON DELETE RESTRICT;


--
-- Name: organization_invitations organization_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.organization_invitations
    ADD CONSTRAINT organization_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES app.profiles(id) ON DELETE RESTRICT;


--
-- Name: organization_invitations organization_invitations_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.organization_invitations
    ADD CONSTRAINT organization_invitations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organizations(id) ON DELETE RESTRICT;


--
-- Name: organization_invitations organization_invitations_revoked_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.organization_invitations
    ADD CONSTRAINT organization_invitations_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES app.profiles(id) ON DELETE RESTRICT;


--
-- Name: organization_memberships organization_memberships_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.organization_memberships
    ADD CONSTRAINT organization_memberships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organizations(id) ON DELETE RESTRICT;


--
-- Name: organization_memberships organization_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.organization_memberships
    ADD CONSTRAINT organization_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.profiles(id) ON DELETE RESTRICT;


--
-- Name: organizations organizations_archived_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.organizations
    ADD CONSTRAINT organizations_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES app.profiles(id) ON DELETE RESTRICT;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: provisioning_grants provisioning_grants_consumed_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.provisioning_grants
    ADD CONSTRAINT provisioning_grants_consumed_organization_id_fkey FOREIGN KEY (consumed_organization_id) REFERENCES app.organizations(id) ON DELETE RESTRICT;


--
-- Name: provisioning_grants provisioning_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.provisioning_grants
    ADD CONSTRAINT provisioning_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: attempt_events attempt_events_organization_id_activity_exercise_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.attempt_events
    ADD CONSTRAINT attempt_events_organization_id_activity_exercise_id_fkey FOREIGN KEY (organization_id, activity_exercise_id) REFERENCES app.activity_exercises(organization_id, id);


--
-- Name: attempt_events attempt_events_organization_id_activity_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.attempt_events
    ADD CONSTRAINT attempt_events_organization_id_activity_id_fkey FOREIGN KEY (organization_id, activity_id) REFERENCES app.activities(organization_id, id);


--
-- Name: attempt_events attempt_events_organization_id_attempt_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.attempt_events
    ADD CONSTRAINT attempt_events_organization_id_attempt_id_fkey FOREIGN KEY (organization_id, attempt_id) REFERENCES app.attempts(organization_id, id);


--
-- Name: attempt_events attempt_events_organization_id_class_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.attempt_events
    ADD CONSTRAINT attempt_events_organization_id_class_id_fkey FOREIGN KEY (organization_id, class_id) REFERENCES app.classes(organization_id, id);


--
-- Name: attempt_events attempt_events_organization_id_exercise_version_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.attempt_events
    ADD CONSTRAINT attempt_events_organization_id_exercise_version_id_fkey FOREIGN KEY (organization_id, exercise_version_id) REFERENCES app.exercise_versions(organization_id, id);


--
-- Name: attempt_events attempt_events_organization_id_student_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.attempt_events
    ADD CONSTRAINT attempt_events_organization_id_student_id_fkey FOREIGN KEY (organization_id, student_id) REFERENCES app.organization_memberships(organization_id, user_id);


--
-- Name: attempt_results attempt_results_organization_id_attempt_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.attempt_results
    ADD CONSTRAINT attempt_results_organization_id_attempt_id_fkey FOREIGN KEY (organization_id, attempt_id) REFERENCES app.attempts(organization_id, id);


--
-- Name: exercise_tests exercise_tests_organization_id_exercise_version_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.exercise_tests
    ADD CONSTRAINT exercise_tests_organization_id_exercise_version_id_fkey FOREIGN KEY (organization_id, exercise_version_id) REFERENCES app.exercise_versions(organization_id, id) ON DELETE RESTRICT;


--
-- Name: submission_reservations submission_reservations_operation_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.submission_reservations
    ADD CONSTRAINT submission_reservations_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES app.operation_keys(id);


--
-- Name: submission_reservations submission_reservations_organization_id_activity_exercise__fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.submission_reservations
    ADD CONSTRAINT submission_reservations_organization_id_activity_exercise__fkey FOREIGN KEY (organization_id, activity_exercise_id) REFERENCES app.activity_exercises(organization_id, id);


--
-- Name: submission_reservations submission_reservations_organization_id_activity_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.submission_reservations
    ADD CONSTRAINT submission_reservations_organization_id_activity_id_fkey FOREIGN KEY (organization_id, activity_id) REFERENCES app.activities(organization_id, id);


--
-- Name: submission_reservations submission_reservations_organization_id_attempt_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.submission_reservations
    ADD CONSTRAINT submission_reservations_organization_id_attempt_id_fkey FOREIGN KEY (organization_id, attempt_id) REFERENCES app.attempts(organization_id, id);


--
-- Name: submission_reservations submission_reservations_organization_id_class_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.submission_reservations
    ADD CONSTRAINT submission_reservations_organization_id_class_id_fkey FOREIGN KEY (organization_id, class_id) REFERENCES app.classes(organization_id, id);


--
-- Name: submission_reservations submission_reservations_organization_id_exercise_version_i_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.submission_reservations
    ADD CONSTRAINT submission_reservations_organization_id_exercise_version_i_fkey FOREIGN KEY (organization_id, exercise_version_id) REFERENCES app.exercise_versions(organization_id, id);


--
-- Name: submission_reservations submission_reservations_organization_id_student_id_activit_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.submission_reservations
    ADD CONSTRAINT submission_reservations_organization_id_student_id_activit_fkey FOREIGN KEY (organization_id, student_id, activity_exercise_id, exercise_version_id, previous_attempt_id) REFERENCES app.attempts(organization_id, student_id, activity_exercise_id, exercise_version_id, id);


--
-- Name: submission_reservations submission_reservations_organization_id_student_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: postgres
--

ALTER TABLE ONLY app_private.submission_reservations
    ADD CONSTRAINT submission_reservations_organization_id_student_id_fkey FOREIGN KEY (organization_id, student_id) REFERENCES app.organization_memberships(organization_id, user_id);


--
-- Name: class_join_codes academic_internal_code_update; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY academic_internal_code_update ON app.class_join_codes FOR UPDATE TO alunza_identity USING (true) WITH CHECK (true);


--
-- Name: activities academic_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY academic_internal_lookup ON app.activities FOR SELECT TO alunza_identity USING (true);


--
-- Name: activity_exercises academic_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY academic_internal_lookup ON app.activity_exercises FOR SELECT TO alunza_identity USING (true);


--
-- Name: class_join_codes academic_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY academic_internal_lookup ON app.class_join_codes FOR SELECT TO alunza_identity USING (true);


--
-- Name: class_memberships academic_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY academic_internal_lookup ON app.class_memberships FOR SELECT TO alunza_identity USING (true);


--
-- Name: classes academic_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY academic_internal_lookup ON app.classes FOR SELECT TO alunza_identity USING (true);


--
-- Name: concept_versions academic_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY academic_internal_lookup ON app.concept_versions FOR SELECT TO alunza_identity USING (true);


--
-- Name: concepts academic_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY academic_internal_lookup ON app.concepts FOR SELECT TO alunza_identity USING (true);


--
-- Name: courses academic_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY academic_internal_lookup ON app.courses FOR SELECT TO alunza_identity USING (true);


--
-- Name: exercise_version_concepts academic_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY academic_internal_lookup ON app.exercise_version_concepts FOR SELECT TO alunza_identity USING (true);


--
-- Name: exercise_versions academic_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY academic_internal_lookup ON app.exercise_versions FOR SELECT TO alunza_identity USING (true);


--
-- Name: exercises academic_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY academic_internal_lookup ON app.exercises FOR SELECT TO alunza_identity USING (true);


--
-- Name: activities; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.activities ENABLE ROW LEVEL SECURITY;

--
-- Name: activities activities_insert; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY activities_insert ON app.activities FOR INSERT TO alunza_app WITH CHECK (((organization_id = app_private.organization_id()) AND app_private.can_manage_class(organization_id, class_id) AND (created_by = app_private.actor_id()) AND (state = 'DRAFT'::text)));


--
-- Name: activities activities_read; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY activities_read ON app.activities FOR SELECT TO alunza_app USING ((app_private.can_read_class(organization_id, class_id) AND ((app_private.academic_role(organization_id) = ANY (ARRAY['ADMIN'::text, 'TEACHER'::text])) OR ((app_private.academic_role(organization_id) = 'STUDENT'::text) AND (state = 'PUBLISHED'::text)))));


--
-- Name: activities activities_update; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY activities_update ON app.activities FOR UPDATE TO alunza_app USING (app_private.can_manage_class(organization_id, class_id)) WITH CHECK (((organization_id = app_private.organization_id()) AND app_private.can_manage_class(organization_id, class_id)));


--
-- Name: activity_exercises; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.activity_exercises ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_exercises activity_exercises_delete; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY activity_exercises_delete ON app.activity_exercises FOR DELETE TO alunza_app USING (((organization_id = app_private.organization_id()) AND (EXISTS ( SELECT 1
   FROM app.activities a
  WHERE ((a.organization_id = activity_exercises.organization_id) AND (a.id = activity_exercises.activity_id) AND (a.state = 'DRAFT'::text) AND app_private.can_manage_class(a.organization_id, a.class_id))))));


--
-- Name: activity_exercises activity_exercises_insert; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY activity_exercises_insert ON app.activity_exercises FOR INSERT TO alunza_app WITH CHECK (((organization_id = app_private.organization_id()) AND (EXISTS ( SELECT 1
   FROM app.activities a
  WHERE ((a.organization_id = activity_exercises.organization_id) AND (a.id = activity_exercises.activity_id) AND (a.state = 'DRAFT'::text) AND app_private.can_manage_class(a.organization_id, a.class_id))))));


--
-- Name: activity_exercises activity_exercises_read; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY activity_exercises_read ON app.activity_exercises FOR SELECT TO alunza_app USING (app_private.can_read_activity(organization_id, activity_id, true));


--
-- Name: attempts; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: attempts attempts_actor_read; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY attempts_actor_read ON app.attempts FOR SELECT TO alunza_app USING ((((app_private.organization_id() IS NULL) OR (organization_id = app_private.organization_id())) AND (student_id = app_private.actor_id()) AND app_private.practice_student(class_id) AND app_private.practice_activity_read(activity_id)));


--
-- Name: attempts attempts_internal; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY attempts_internal ON app.attempts TO alunza_identity USING (true) WITH CHECK (true);


--
-- Name: audit_events; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_events audit_insert_authorized; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY audit_insert_authorized ON app.audit_events FOR INSERT TO alunza_app WITH CHECK (((organization_id = app_private.organization_id()) AND (actor_id = app_private.actor_id()) AND (EXISTS ( SELECT 1
   FROM app.organization_memberships m
  WHERE ((m.organization_id = audit_events.organization_id) AND (m.user_id = app_private.actor_id()))))));


--
-- Name: audit_events audit_read_admin; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY audit_read_admin ON app.audit_events FOR SELECT TO alunza_app USING (((organization_id = app_private.organization_id()) AND app_private.can_admin(organization_id, true)));


--
-- Name: class_join_codes; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.class_join_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: class_join_codes class_join_codes_read; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY class_join_codes_read ON app.class_join_codes FOR SELECT TO alunza_app USING ((app_private.can_manage_class(organization_id, class_id) OR (app_private.academic_role(organization_id) = 'ADMIN'::text)));


--
-- Name: class_memberships; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.class_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: class_memberships class_memberships_read; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY class_memberships_read ON app.class_memberships FOR SELECT TO alunza_app USING ((((user_id = app_private.actor_id()) AND (app_private.academic_role(organization_id) = 'STUDENT'::text)) OR (app_private.can_read_class(organization_id, class_id) AND (app_private.academic_role(organization_id) = ANY (ARRAY['ADMIN'::text, 'TEACHER'::text])))));


--
-- Name: classes; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.classes ENABLE ROW LEVEL SECURITY;

--
-- Name: classes classes_insert; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY classes_insert ON app.classes FOR INSERT TO alunza_app WITH CHECK (((organization_id = app_private.organization_id()) AND ((app_private.academic_role(organization_id) = 'ADMIN'::text) OR ((app_private.academic_role(organization_id) = 'TEACHER'::text) AND (teacher_id = app_private.actor_id())))));


--
-- Name: classes classes_read; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY classes_read ON app.classes FOR SELECT TO alunza_app USING (((app_private.academic_role(organization_id) = 'ADMIN'::text) OR ((app_private.academic_role(organization_id) = 'TEACHER'::text) AND (teacher_id = app_private.actor_id())) OR ((app_private.academic_role(organization_id) = 'STUDENT'::text) AND app_private.can_read_class(organization_id, id))));


--
-- Name: classes classes_update; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY classes_update ON app.classes FOR UPDATE TO alunza_app USING (((app_private.academic_role(organization_id) = 'ADMIN'::text) OR app_private.can_manage_class(organization_id, id))) WITH CHECK (((organization_id = app_private.organization_id()) AND ((app_private.academic_role(organization_id) = 'ADMIN'::text) OR app_private.can_manage_class(organization_id, id))));


--
-- Name: class_join_codes codes_insert; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY codes_insert ON app.class_join_codes FOR INSERT TO alunza_app WITH CHECK (((organization_id = app_private.organization_id()) AND (created_by = app_private.actor_id()) AND ((app_private.academic_role(organization_id) = 'ADMIN'::text) OR app_private.can_manage_class(organization_id, class_id))));


--
-- Name: class_join_codes codes_update; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY codes_update ON app.class_join_codes FOR UPDATE TO alunza_app USING (((app_private.academic_role(organization_id) = 'ADMIN'::text) OR app_private.can_manage_class(organization_id, class_id))) WITH CHECK (((organization_id = app_private.organization_id()) AND ((app_private.academic_role(organization_id) = 'ADMIN'::text) OR app_private.can_manage_class(organization_id, class_id))));


--
-- Name: concept_versions; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.concept_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: concept_versions concept_versions_insert; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY concept_versions_insert ON app.concept_versions FOR INSERT TO alunza_app WITH CHECK (((organization_id = app_private.organization_id()) AND (app_private.academic_role(organization_id) = 'ADMIN'::text) AND (created_by = app_private.actor_id())));


--
-- Name: concept_versions concept_versions_read; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY concept_versions_read ON app.concept_versions FOR SELECT TO alunza_app USING (((app_private.academic_role(organization_id) = ANY (ARRAY['ADMIN'::text, 'TEACHER'::text])) OR (EXISTS ( SELECT 1
   FROM app.exercise_version_concepts ec
  WHERE ((ec.organization_id = concept_versions.organization_id) AND (ec.concept_version_id = concept_versions.id) AND app_private.can_read_exercise_version(ec.organization_id, ec.exercise_version_id))))));


--
-- Name: concepts; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.concepts ENABLE ROW LEVEL SECURITY;

--
-- Name: concepts concepts_insert; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY concepts_insert ON app.concepts FOR INSERT TO alunza_app WITH CHECK (((organization_id = app_private.organization_id()) AND (app_private.academic_role(organization_id) = 'ADMIN'::text)));


--
-- Name: concepts concepts_read; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY concepts_read ON app.concepts FOR SELECT TO alunza_app USING (((app_private.academic_role(organization_id) = ANY (ARRAY['ADMIN'::text, 'TEACHER'::text])) OR (EXISTS ( SELECT 1
   FROM app.exercise_version_concepts ec
  WHERE ((ec.organization_id = concepts.organization_id) AND (ec.concept_id = concepts.id) AND app_private.can_read_exercise_version(ec.organization_id, ec.exercise_version_id))))));


--
-- Name: concepts concepts_update; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY concepts_update ON app.concepts FOR UPDATE TO alunza_app USING ((app_private.academic_role(organization_id) = 'ADMIN'::text)) WITH CHECK (((organization_id = app_private.organization_id()) AND (app_private.academic_role(organization_id) = 'ADMIN'::text)));


--
-- Name: courses; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.courses ENABLE ROW LEVEL SECURITY;

--
-- Name: courses courses_insert; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY courses_insert ON app.courses FOR INSERT TO alunza_app WITH CHECK (((organization_id = app_private.organization_id()) AND (app_private.academic_role(organization_id) = 'ADMIN'::text)));


--
-- Name: courses courses_read; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY courses_read ON app.courses FOR SELECT TO alunza_app USING ((app_private.academic_role(organization_id) IS NOT NULL));


--
-- Name: courses courses_update; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY courses_update ON app.courses FOR UPDATE TO alunza_app USING ((app_private.academic_role(organization_id) = 'ADMIN'::text)) WITH CHECK (((organization_id = app_private.organization_id()) AND (app_private.academic_role(organization_id) = 'ADMIN'::text)));


--
-- Name: invitation_deliveries deliveries_insert_authorized; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY deliveries_insert_authorized ON app.invitation_deliveries FOR INSERT TO alunza_app WITH CHECK (((organization_id = app_private.organization_id()) AND (state = 'QUEUED'::text) AND (requested_by = app_private.actor_id()) AND app_private.can_admin(organization_id)));


--
-- Name: invitation_deliveries deliveries_read_admin; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY deliveries_read_admin ON app.invitation_deliveries FOR SELECT TO alunza_app USING (((organization_id = app_private.organization_id()) AND (app_private.can_admin(organization_id, true) OR app_private.worker_lease_valid())));


--
-- Name: invitation_deliveries deliveries_update_admin; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY deliveries_update_admin ON app.invitation_deliveries FOR UPDATE TO alunza_app USING (((organization_id = app_private.organization_id()) AND (app_private.can_admin(organization_id) OR app_private.worker_lease_valid()))) WITH CHECK ((organization_id = app_private.organization_id()));


--
-- Name: executions; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.executions ENABLE ROW LEVEL SECURITY;

--
-- Name: executions executions_actor_read; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY executions_actor_read ON app.executions FOR SELECT TO alunza_app USING (((organization_id = app_private.organization_id()) AND (student_id = app_private.actor_id()) AND app_private.practice_student(class_id) AND app_private.practice_activity_read(activity_id)));


--
-- Name: executions executions_internal; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY executions_internal ON app.executions TO alunza_identity USING (true) WITH CHECK (true);


--
-- Name: exercise_version_concepts exercise_concepts_insert; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY exercise_concepts_insert ON app.exercise_version_concepts FOR INSERT TO alunza_app WITH CHECK (((organization_id = app_private.organization_id()) AND (EXISTS ( SELECT 1
   FROM app.exercise_versions v
  WHERE ((v.organization_id = exercise_version_concepts.organization_id) AND (v.id = exercise_version_concepts.exercise_version_id) AND app_private.owns_exercise(v.organization_id, v.exercise_id))))));


--
-- Name: exercise_version_concepts exercise_concepts_read; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY exercise_concepts_read ON app.exercise_version_concepts FOR SELECT TO alunza_app USING (app_private.can_read_exercise_version(organization_id, exercise_version_id));


--
-- Name: exercise_version_concepts; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.exercise_version_concepts ENABLE ROW LEVEL SECURITY;

--
-- Name: exercise_versions; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.exercise_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: exercise_versions exercise_versions_insert; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY exercise_versions_insert ON app.exercise_versions FOR INSERT TO alunza_app WITH CHECK (((organization_id = app_private.organization_id()) AND app_private.owns_exercise(organization_id, exercise_id) AND (created_by = app_private.actor_id())));


--
-- Name: exercise_versions exercise_versions_read; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY exercise_versions_read ON app.exercise_versions FOR SELECT TO alunza_app USING ((app_private.owns_exercise(organization_id, exercise_id) OR app_private.can_read_exercise_version(organization_id, id)));


--
-- Name: exercises; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.exercises ENABLE ROW LEVEL SECURITY;

--
-- Name: exercises exercises_insert; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY exercises_insert ON app.exercises FOR INSERT TO alunza_app WITH CHECK (((organization_id = app_private.organization_id()) AND (app_private.academic_role(organization_id) = 'TEACHER'::text) AND (owner_id = app_private.actor_id())));


--
-- Name: exercises exercises_read; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY exercises_read ON app.exercises FOR SELECT TO alunza_app USING (((app_private.academic_role(organization_id) = 'ADMIN'::text) OR ((app_private.academic_role(organization_id) = 'TEACHER'::text) AND ((owner_id = app_private.actor_id()) OR (visibility = 'ORGANIZATION'::text))) OR (EXISTS ( SELECT 1
   FROM app.exercise_versions v
  WHERE ((v.organization_id = exercises.organization_id) AND (v.exercise_id = exercises.id) AND app_private.can_read_exercise_version(v.organization_id, v.id))))));


--
-- Name: exercises exercises_update; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY exercises_update ON app.exercises FOR UPDATE TO alunza_app USING (((app_private.academic_role(organization_id) = 'ADMIN'::text) OR app_private.owns_exercise(organization_id, id))) WITH CHECK (((organization_id = app_private.organization_id()) AND ((app_private.academic_role(organization_id) = 'ADMIN'::text) OR app_private.owns_exercise(organization_id, id))));


--
-- Name: invitation_deliveries identity_claim_delivery; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY identity_claim_delivery ON app.invitation_deliveries FOR UPDATE TO alunza_identity USING (true) WITH CHECK (true);


--
-- Name: audit_events identity_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY identity_internal_lookup ON app.audit_events FOR SELECT TO alunza_identity USING (true);


--
-- Name: invitation_deliveries identity_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY identity_internal_lookup ON app.invitation_deliveries FOR SELECT TO alunza_identity USING (true);


--
-- Name: operation_keys identity_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY identity_internal_lookup ON app.operation_keys FOR SELECT TO alunza_identity USING (true);


--
-- Name: organization_invitations identity_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY identity_internal_lookup ON app.organization_invitations FOR SELECT TO alunza_identity USING (true);


--
-- Name: organization_memberships identity_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY identity_internal_lookup ON app.organization_memberships FOR SELECT TO alunza_identity USING (true);


--
-- Name: organizations identity_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY identity_internal_lookup ON app.organizations FOR SELECT TO alunza_identity USING (true);


--
-- Name: profiles identity_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY identity_internal_lookup ON app.profiles FOR SELECT TO alunza_identity USING (true);


--
-- Name: provisioning_grants identity_internal_lookup; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY identity_internal_lookup ON app.provisioning_grants FOR SELECT TO alunza_identity USING (true);


--
-- Name: organizations identity_lock_organization; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY identity_lock_organization ON app.organizations FOR UPDATE TO alunza_identity USING (true) WITH CHECK (true);


--
-- Name: operation_keys identity_purge_operation_response; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY identity_purge_operation_response ON app.operation_keys FOR UPDATE TO alunza_identity USING (((expires_at <= statement_timestamp()) AND (response_body IS NOT NULL))) WITH CHECK (((expires_at <= statement_timestamp()) AND (response_body IS NULL)));


--
-- Name: invitation_deliveries; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.invitation_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_invitations invitations_insert_admin; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY invitations_insert_admin ON app.organization_invitations FOR INSERT TO alunza_app WITH CHECK (((organization_id = app_private.organization_id()) AND (invited_by = app_private.actor_id()) AND app_private.can_admin(organization_id) AND (accepted_at IS NULL) AND (revoked_at IS NULL)));


--
-- Name: organization_invitations invitations_read_authorized; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY invitations_read_authorized ON app.organization_invitations FOR SELECT TO alunza_app USING (((organization_id = app_private.organization_id()) AND (app_private.can_admin(organization_id, true) OR ((id = (NULLIF(current_setting('app.invitation_id'::text, true), ''::text))::uuid) AND app_private.invitation_proof_matches()))));


--
-- Name: organization_invitations invitations_update_authorized; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY invitations_update_authorized ON app.organization_invitations FOR UPDATE TO alunza_app USING (((organization_id = app_private.organization_id()) AND (app_private.can_admin(organization_id) OR ((id = (NULLIF(current_setting('app.invitation_id'::text, true), ''::text))::uuid) AND app_private.invitation_matches())))) WITH CHECK (((organization_id = app_private.organization_id()) AND (app_private.can_admin(organization_id) OR ((accepted_by = app_private.actor_id()) AND app_private.invitation_matches()))));


--
-- Name: class_memberships memberships_insert; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY memberships_insert ON app.class_memberships FOR INSERT TO alunza_app WITH CHECK (((organization_id = app_private.organization_id()) AND (user_id = app_private.actor_id()) AND (state = 'ACTIVE'::text) AND (app_private.academic_role(organization_id) = 'STUDENT'::text)));


--
-- Name: organization_memberships memberships_insert_authorized; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY memberships_insert_authorized ON app.organization_memberships FOR INSERT TO alunza_app WITH CHECK (((organization_id = app_private.organization_id()) AND ((app_private.can_admin(organization_id) AND (state = 'INVITED'::text)) OR ((user_id = app_private.actor_id()) AND (state = 'ACTIVE'::text) AND (((role = 'ADMIN'::text) AND app_private.provisioning_allowed()) OR app_private.invitation_matches())))));


--
-- Name: organization_memberships memberships_read_authorized; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY memberships_read_authorized ON app.organization_memberships FOR SELECT TO alunza_app USING (((user_id = app_private.actor_id()) OR ((organization_id = app_private.organization_id()) AND app_private.can_admin(organization_id, true))));


--
-- Name: organization_memberships memberships_update_authorized; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY memberships_update_authorized ON app.organization_memberships FOR UPDATE TO alunza_app USING (((organization_id = app_private.organization_id()) AND (app_private.can_admin(organization_id) OR ((user_id = app_private.actor_id()) AND app_private.invitation_matches())))) WITH CHECK (((organization_id = app_private.organization_id()) AND (app_private.can_admin(organization_id) OR ((user_id = app_private.actor_id()) AND app_private.invitation_matches()))));


--
-- Name: operation_keys; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.operation_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: operation_keys operation_keys_actor; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY operation_keys_actor ON app.operation_keys TO alunza_app USING (((actor_id = app_private.actor_id()) AND ((organization_id IS NULL) OR (organization_id = app_private.organization_id())))) WITH CHECK (((actor_id = app_private.actor_id()) AND ((organization_id IS NULL) OR (organization_id = app_private.organization_id()))));


--
-- Name: organization_invitations; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.organization_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_memberships; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.organization_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations organizations_create_granted; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY organizations_create_granted ON app.organizations FOR INSERT TO alunza_app WITH CHECK (((id = app_private.organization_id()) AND (archived_at IS NULL) AND app_private.provisioning_allowed()));


--
-- Name: organizations organizations_read_authorized; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY organizations_read_authorized ON app.organizations FOR SELECT TO alunza_app USING ((app_private.can_read_organization(id) OR ((id = app_private.organization_id()) AND app_private.invitation_matches())));


--
-- Name: organizations organizations_update_admin; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY organizations_update_admin ON app.organizations FOR UPDATE TO alunza_app USING (app_private.can_admin(id)) WITH CHECK ((id = app_private.organization_id()));


--
-- Name: operation_keys practice_operation_insert_guard; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY practice_operation_insert_guard ON app.operation_keys AS RESTRICTIVE FOR INSERT TO alunza_app WITH CHECK ((operation <> ALL (ARRAY['practice.run'::text, 'practice.submit'::text])));


--
-- Name: operation_keys practice_operation_internal; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY practice_operation_internal ON app.operation_keys TO alunza_identity USING ((operation = ANY (ARRAY['practice.run'::text, 'practice.submit'::text]))) WITH CHECK ((operation = ANY (ARRAY['practice.run'::text, 'practice.submit'::text])));


--
-- Name: operation_keys practice_operation_update_guard; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY practice_operation_update_guard ON app.operation_keys AS RESTRICTIVE FOR UPDATE TO alunza_app USING ((operation <> ALL (ARRAY['practice.run'::text, 'practice.submit'::text]))) WITH CHECK ((operation <> ALL (ARRAY['practice.run'::text, 'practice.submit'::text])));


--
-- Name: profiles; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_create_self; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY profiles_create_self ON app.profiles FOR INSERT TO alunza_app WITH CHECK (((id = app_private.actor_id()) AND (email_normalized = app_private.current_auth_email()) AND (account_state = 'ACTIVE'::text) AND app_private.invitation_matches()));


--
-- Name: profiles profiles_read_authorized; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY profiles_read_authorized ON app.profiles FOR SELECT TO alunza_app USING (((id = app_private.actor_id()) OR (app_private.can_admin(app_private.organization_id(), true) AND (EXISTS ( SELECT 1
   FROM app.organization_memberships m
  WHERE ((m.organization_id = app_private.organization_id()) AND (m.user_id = profiles.id)))))));


--
-- Name: profiles profiles_update_self; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY profiles_update_self ON app.profiles FOR UPDATE TO alunza_app USING (((id = app_private.actor_id()) AND (account_state = 'INVITED'::text) AND app_private.invitation_matches())) WITH CHECK (((id = app_private.actor_id()) AND (email_normalized = app_private.current_auth_email()) AND (account_state = 'ACTIVE'::text)));


--
-- Name: provisioning_grants provisioning_consume_self; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY provisioning_consume_self ON app.provisioning_grants FOR UPDATE TO alunza_app USING (((user_id = app_private.actor_id()) AND (id = (NULLIF(current_setting('app.provisioning_grant_id'::text, true), ''::text))::uuid) AND (revoked_at IS NULL) AND (consumed_at IS NULL) AND (expires_at > statement_timestamp()))) WITH CHECK (((user_id = app_private.actor_id()) AND (consumed_at IS NOT NULL) AND (consumed_organization_id = app_private.organization_id())));


--
-- Name: provisioning_grants; Type: ROW SECURITY; Schema: app; Owner: postgres
--

ALTER TABLE app.provisioning_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: provisioning_grants provisioning_read_self; Type: POLICY; Schema: app; Owner: postgres
--

CREATE POLICY provisioning_read_self ON app.provisioning_grants FOR SELECT TO alunza_app USING ((user_id = app_private.actor_id()));


--
-- Name: exercise_tests academic_internal_lookup; Type: POLICY; Schema: app_private; Owner: postgres
--

CREATE POLICY academic_internal_lookup ON app_private.exercise_tests FOR SELECT TO alunza_identity USING (true);


--
-- Name: attempt_events; Type: ROW SECURITY; Schema: app_private; Owner: postgres
--

ALTER TABLE app_private.attempt_events ENABLE ROW LEVEL SECURITY;

--
-- Name: attempt_events attempt_events_internal; Type: POLICY; Schema: app_private; Owner: postgres
--

CREATE POLICY attempt_events_internal ON app_private.attempt_events TO alunza_identity USING (true) WITH CHECK (true);


--
-- Name: attempt_results; Type: ROW SECURITY; Schema: app_private; Owner: postgres
--

ALTER TABLE app_private.attempt_results ENABLE ROW LEVEL SECURITY;

--
-- Name: attempt_results attempt_results_internal; Type: POLICY; Schema: app_private; Owner: postgres
--

CREATE POLICY attempt_results_internal ON app_private.attempt_results TO alunza_identity USING (true) WITH CHECK (true);


--
-- Name: exercise_tests; Type: ROW SECURITY; Schema: app_private; Owner: postgres
--

ALTER TABLE app_private.exercise_tests ENABLE ROW LEVEL SECURITY;

--
-- Name: exercise_tests exercise_tests_insert; Type: POLICY; Schema: app_private; Owner: postgres
--

CREATE POLICY exercise_tests_insert ON app_private.exercise_tests FOR INSERT TO alunza_app WITH CHECK (((organization_id = app_private.organization_id()) AND (EXISTS ( SELECT 1
   FROM app.exercise_versions v
  WHERE ((v.organization_id = exercise_tests.organization_id) AND (v.id = exercise_tests.exercise_version_id) AND app_private.owns_exercise(v.organization_id, v.exercise_id))))));


--
-- Name: exercise_tests exercise_tests_read; Type: POLICY; Schema: app_private; Owner: postgres
--

CREATE POLICY exercise_tests_read ON app_private.exercise_tests FOR SELECT TO alunza_app USING (((EXISTS ( SELECT 1
   FROM app.exercise_versions v
  WHERE ((v.organization_id = exercise_tests.organization_id) AND (v.id = exercise_tests.exercise_version_id) AND app_private.owns_exercise(v.organization_id, v.exercise_id)))) OR ((visibility = 'VISIBLE'::text) AND (app_private.academic_role(organization_id) = 'STUDENT'::text) AND app_private.can_read_exercise_version(organization_id, exercise_version_id))));


--
-- Name: submission_reservations; Type: ROW SECURITY; Schema: app_private; Owner: postgres
--

ALTER TABLE app_private.submission_reservations ENABLE ROW LEVEL SECURITY;

--
-- Name: submission_reservations submissions_internal; Type: POLICY; Schema: app_private; Owner: postgres
--

CREATE POLICY submissions_internal ON app_private.submission_reservations TO alunza_identity USING (true) WITH CHECK (true);


--
-- Name: SCHEMA app; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA app TO alunza_app;
GRANT USAGE ON SCHEMA app TO alunza_identity;


--
-- Name: SCHEMA app_private; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA app_private TO alunza_app;
GRANT USAGE ON SCHEMA app_private TO alunza_identity;


--
-- Name: FUNCTION academic_resource_org(kind text, target uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.academic_resource_org(kind text, target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.academic_resource_org(kind text, target uuid) TO alunza_app;


--
-- Name: FUNCTION academic_role(org uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.academic_role(org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.academic_role(org uuid) TO alunza_app;


--
-- Name: FUNCTION actor_id(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.actor_id() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.actor_id() TO alunza_app;


--
-- Name: FUNCTION admit_practice_run(execution uuid, activity uuid, assignment uuid, version_id uuid, operation_key text, payload_digest text, code_digest text, suite_digest text, visible_count integer, runtime_version text, correlation uuid, runner_available boolean, actor_concurrency integer, organization_concurrency integer, actor_frequency integer); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.admit_practice_run(execution uuid, activity uuid, assignment uuid, version_id uuid, operation_key text, payload_digest text, code_digest text, suite_digest text, visible_count integer, runtime_version text, correlation uuid, runner_available boolean, actor_concurrency integer, organization_concurrency integer, actor_frequency integer) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.admit_practice_run(execution uuid, activity uuid, assignment uuid, version_id uuid, operation_key text, payload_digest text, code_digest text, suite_digest text, visible_count integer, runtime_version text, correlation uuid, runner_available boolean, actor_concurrency integer, organization_concurrency integer, actor_frequency integer) TO alunza_app;


--
-- Name: FUNCTION admit_practice_submit(execution uuid, activity uuid, assignment uuid, version_id uuid, operation_key text, payload_digest text, source_code text, previous_attempt uuid, runtime_version text, correlation uuid, runner_available boolean, actor_concurrency integer, organization_concurrency integer, actor_frequency integer); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.admit_practice_submit(execution uuid, activity uuid, assignment uuid, version_id uuid, operation_key text, payload_digest text, source_code text, previous_attempt uuid, runtime_version text, correlation uuid, runner_available boolean, actor_concurrency integer, organization_concurrency integer, actor_frequency integer) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.admit_practice_submit(execution uuid, activity uuid, assignment uuid, version_id uuid, operation_key text, payload_digest text, source_code text, previous_attempt uuid, runtime_version text, correlation uuid, runner_available boolean, actor_concurrency integer, organization_concurrency integer, actor_frequency integer) TO alunza_app;


--
-- Name: FUNCTION assert_academic_version_complete(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.assert_academic_version_complete() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.assert_academic_version_complete() TO alunza_app;


--
-- Name: FUNCTION assert_provisioning_complete(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.assert_provisioning_complete() FROM PUBLIC;


--
-- Name: TABLE attempts; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT ON TABLE app.attempts TO alunza_app;
GRANT SELECT,INSERT ON TABLE app.attempts TO alunza_identity;


--
-- Name: FUNCTION attempt_payload(a app.attempts); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.attempt_payload(a app.attempts) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.attempt_payload(a app.attempts) TO alunza_app;


--
-- Name: FUNCTION audit_append_only(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.audit_append_only() FROM PUBLIC;


--
-- Name: FUNCTION can_admin(org uuid, include_archived boolean); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.can_admin(org uuid, include_archived boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.can_admin(org uuid, include_archived boolean) TO alunza_app;


--
-- Name: FUNCTION can_manage_class(org uuid, target uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.can_manage_class(org uuid, target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.can_manage_class(org uuid, target uuid) TO alunza_app;


--
-- Name: FUNCTION can_read_activity(org uuid, target uuid, content boolean); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.can_read_activity(org uuid, target uuid, content boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.can_read_activity(org uuid, target uuid, content boolean) TO alunza_app;


--
-- Name: FUNCTION can_read_class(org uuid, target uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.can_read_class(org uuid, target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.can_read_class(org uuid, target uuid) TO alunza_app;


--
-- Name: FUNCTION can_read_exercise_version(org uuid, target uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.can_read_exercise_version(org uuid, target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.can_read_exercise_version(org uuid, target uuid) TO alunza_app;


--
-- Name: FUNCTION can_read_organization(org uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.can_read_organization(org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.can_read_organization(org uuid) TO alunza_app;


--
-- Name: FUNCTION claim_expired_practice_run(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.claim_expired_practice_run() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.claim_expired_practice_run() TO alunza_app;


--
-- Name: FUNCTION claim_expired_practice_submit(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.claim_expired_practice_submit() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.claim_expired_practice_submit() TO alunza_app;


--
-- Name: TABLE invitation_deliveries; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT,UPDATE ON TABLE app.invitation_deliveries TO alunza_identity;
GRANT SELECT,INSERT ON TABLE app.invitation_deliveries TO alunza_app;


--
-- Name: COLUMN invitation_deliveries.state; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(state) ON TABLE app.invitation_deliveries TO alunza_app;


--
-- Name: COLUMN invitation_deliveries.attempt_count; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(attempt_count) ON TABLE app.invitation_deliveries TO alunza_app;


--
-- Name: COLUMN invitation_deliveries.available_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(available_at) ON TABLE app.invitation_deliveries TO alunza_app;


--
-- Name: COLUMN invitation_deliveries.lease_until; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(lease_until) ON TABLE app.invitation_deliveries TO alunza_app;


--
-- Name: COLUMN invitation_deliveries.lease_token; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(lease_token) ON TABLE app.invitation_deliveries TO alunza_app;


--
-- Name: COLUMN invitation_deliveries.last_error_code; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(last_error_code) ON TABLE app.invitation_deliveries TO alunza_app;


--
-- Name: COLUMN invitation_deliveries.auth_user_id; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(auth_user_id) ON TABLE app.invitation_deliveries TO alunza_app;


--
-- Name: COLUMN invitation_deliveries.updated_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(updated_at) ON TABLE app.invitation_deliveries TO alunza_app;


--
-- Name: FUNCTION claim_invitation_delivery(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.claim_invitation_delivery() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.claim_invitation_delivery() TO alunza_app;


--
-- Name: FUNCTION count_class_enrollment(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.count_class_enrollment() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.count_class_enrollment() TO alunza_app;


--
-- Name: FUNCTION current_auth_email(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.current_auth_email() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.current_auth_email() TO alunza_app;


--
-- Name: FUNCTION finish_practice_run(execution uuid, token uuid, technical_result jsonb, cleaned boolean); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.finish_practice_run(execution uuid, token uuid, technical_result jsonb, cleaned boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.finish_practice_run(execution uuid, token uuid, technical_result jsonb, cleaned boolean) TO alunza_app;


--
-- Name: FUNCTION finish_practice_submit(execution uuid, token uuid, cleaned boolean); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.finish_practice_submit(execution uuid, token uuid, cleaned boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.finish_practice_submit(execution uuid, token uuid, cleaned boolean) TO alunza_app;


--
-- Name: FUNCTION guard_academic_entity(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_academic_entity() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.guard_academic_entity() TO alunza_app;


--
-- Name: FUNCTION guard_academic_scope(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_academic_scope() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.guard_academic_scope() TO alunza_app;


--
-- Name: FUNCTION guard_academic_version(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_academic_version() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.guard_academic_version() TO alunza_app;


--
-- Name: FUNCTION guard_activity(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_activity() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.guard_activity() TO alunza_app;


--
-- Name: FUNCTION guard_activity_exercise(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_activity_exercise() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.guard_activity_exercise() TO alunza_app;


--
-- Name: FUNCTION guard_attempt_context(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_attempt_context() FROM PUBLIC;


--
-- Name: FUNCTION guard_attempt_event(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_attempt_event() FROM PUBLIC;


--
-- Name: FUNCTION guard_attempt_result(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_attempt_result() FROM PUBLIC;


--
-- Name: FUNCTION guard_class_code(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_class_code() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.guard_class_code() TO alunza_app;


--
-- Name: FUNCTION guard_class_enrollment(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_class_enrollment() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.guard_class_enrollment() TO alunza_app;


--
-- Name: FUNCTION guard_class_submissions(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_class_submissions() FROM PUBLIC;


--
-- Name: FUNCTION guard_delivery_change(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_delivery_change() FROM PUBLIC;


--
-- Name: FUNCTION guard_execution_context(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_execution_context() FROM PUBLIC;


--
-- Name: FUNCTION guard_exercise_child(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_exercise_child() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.guard_exercise_child() TO alunza_app;


--
-- Name: FUNCTION guard_invitation_change(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_invitation_change() FROM PUBLIC;


--
-- Name: FUNCTION guard_membership_change(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_membership_change() FROM PUBLIC;


--
-- Name: FUNCTION guard_organization_academic_archive(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_organization_academic_archive() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.guard_organization_academic_archive() TO alunza_app;


--
-- Name: FUNCTION guard_organization_change(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_organization_change() FROM PUBLIC;


--
-- Name: FUNCTION guard_organization_practice_runs(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_organization_practice_runs() FROM PUBLIC;


--
-- Name: FUNCTION guard_practice_recovery_grace(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_practice_recovery_grace() FROM PUBLIC;


--
-- Name: FUNCTION guard_submission_context(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.guard_submission_context() FROM PUBLIC;


--
-- Name: FUNCTION invitation_context(invitation uuid, digest text, token_generation integer); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.invitation_context(invitation uuid, digest text, token_generation integer) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.invitation_context(invitation uuid, digest text, token_generation integer) TO alunza_app;


--
-- Name: FUNCTION invitation_matches(require_recipient boolean); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.invitation_matches(require_recipient boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.invitation_matches(require_recipient boolean) TO alunza_app;


--
-- Name: FUNCTION invitation_proof_matches(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.invitation_proof_matches() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.invitation_proof_matches() TO alunza_app;


--
-- Name: FUNCTION list_practice_attempts(activity uuid, assignment uuid, before_number bigint, fetch_limit integer); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.list_practice_attempts(activity uuid, assignment uuid, before_number bigint, fetch_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.list_practice_attempts(activity uuid, assignment uuid, before_number bigint, fetch_limit integer) TO alunza_app;


--
-- Name: FUNCTION load_practice_submit_suite(execution uuid, token uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.load_practice_submit_suite(execution uuid, token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.load_practice_submit_suite(execution uuid, token uuid) TO alunza_app;


--
-- Name: FUNCTION lock_academic_organization(org uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.lock_academic_organization(org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.lock_academic_organization(org uuid) TO alunza_app;


--
-- Name: FUNCTION lock_invitation_organization(invitation uuid, digest text, token_generation integer); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.lock_invitation_organization(invitation uuid, digest text, token_generation integer) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.lock_invitation_organization(invitation uuid, digest text, token_generation integer) TO alunza_app;


--
-- Name: FUNCTION organization_id(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.organization_id() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.organization_id() TO alunza_app;


--
-- Name: FUNCTION owns_exercise(org uuid, target uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.owns_exercise(org uuid, target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.owns_exercise(org uuid, target uuid) TO alunza_app;


--
-- Name: FUNCTION practice_activity_progress(activity uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.practice_activity_progress(activity uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.practice_activity_progress(activity uuid) TO alunza_app;


--
-- Name: FUNCTION practice_activity_read(target uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.practice_activity_read(target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.practice_activity_read(target uuid) TO alunza_app;


--
-- Name: FUNCTION practice_assignment_context(activity uuid, assignment uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.practice_assignment_context(activity uuid, assignment uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.practice_assignment_context(activity uuid, assignment uuid) TO alunza_app;


--
-- Name: FUNCTION practice_attempted_activities(target uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.practice_attempted_activities(target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.practice_attempted_activities(target uuid) TO alunza_app;


--
-- Name: FUNCTION practice_limits(value jsonb); Type: ACL; Schema: app_private; Owner: postgres
--

REVOKE ALL ON FUNCTION app_private.practice_limits(value jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.practice_limits(value jsonb) TO alunza_app;
GRANT ALL ON FUNCTION app_private.practice_limits(value jsonb) TO alunza_identity;


--
-- Name: FUNCTION practice_run_context(activity uuid, assignment uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.practice_run_context(activity uuid, assignment uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.practice_run_context(activity uuid, assignment uuid) TO alunza_app;


--
-- Name: FUNCTION practice_student(target uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.practice_student(target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.practice_student(target uuid) TO alunza_app;


--
-- Name: FUNCTION preview_class_join_code(digest text); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.preview_class_join_code(digest text) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.preview_class_join_code(digest text) TO alunza_app;


--
-- Name: FUNCTION provisioning_allowed(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.provisioning_allowed() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.provisioning_allowed() TO alunza_app;


--
-- Name: FUNCTION purge_expired_operation_responses(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.purge_expired_operation_responses() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.purge_expired_operation_responses() TO alunza_app;


--
-- Name: FUNCTION purge_practice_responses(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.purge_practice_responses() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.purge_practice_responses() TO alunza_app;


--
-- Name: FUNCTION purge_submit_responses(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.purge_submit_responses() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.purge_submit_responses() TO alunza_app;


--
-- Name: FUNCTION read_practice_attempt(attempt uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.read_practice_attempt(attempt uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.read_practice_attempt(attempt uuid) TO alunza_app;


--
-- Name: FUNCTION session_is_active(actor uuid, session uuid); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.session_is_active(actor uuid, session uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.session_is_active(actor uuid, session uuid) TO alunza_app;


--
-- Name: FUNCTION stage_practice_submit_result(execution uuid, token uuid, technical_result jsonb, private_results jsonb); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.stage_practice_submit_result(execution uuid, token uuid, technical_result jsonb, private_results jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.stage_practice_submit_result(execution uuid, token uuid, technical_result jsonb, private_results jsonb) TO alunza_app;


--
-- Name: FUNCTION valid_practice_limits(value jsonb); Type: ACL; Schema: app_private; Owner: postgres
--

REVOKE ALL ON FUNCTION app_private.valid_practice_limits(value jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.valid_practice_limits(value jsonb) TO alunza_app;
GRANT ALL ON FUNCTION app_private.valid_practice_limits(value jsonb) TO alunza_identity;


--
-- Name: TABLE submission_reservations; Type: ACL; Schema: app_private; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE app_private.submission_reservations TO alunza_identity;


--
-- Name: FUNCTION submission_reservation_payload(s app_private.submission_reservations); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.submission_reservation_payload(s app_private.submission_reservations) FROM PUBLIC;


--
-- Name: FUNCTION worker_delivery_valid(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.worker_delivery_valid() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.worker_delivery_valid() TO alunza_app;


--
-- Name: FUNCTION worker_lease_valid(); Type: ACL; Schema: app_private; Owner: alunza_identity
--

REVOKE ALL ON FUNCTION app_private.worker_lease_valid() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.worker_lease_valid() TO alunza_app;


--
-- Name: TABLE activities; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT ON TABLE app.activities TO alunza_identity;
GRANT SELECT,INSERT ON TABLE app.activities TO alunza_app;


--
-- Name: COLUMN activities.title; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(title) ON TABLE app.activities TO alunza_app;


--
-- Name: COLUMN activities.type; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(type) ON TABLE app.activities TO alunza_app;


--
-- Name: COLUMN activities.instructions; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(instructions) ON TABLE app.activities TO alunza_app;


--
-- Name: COLUMN activities.state; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(state) ON TABLE app.activities TO alunza_app;


--
-- Name: COLUMN activities.opens_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(opens_at) ON TABLE app.activities TO alunza_app;


--
-- Name: COLUMN activities.closes_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(closes_at) ON TABLE app.activities TO alunza_app;


--
-- Name: COLUMN activities.revision; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(revision) ON TABLE app.activities TO alunza_app;


--
-- Name: COLUMN activities.updated_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(updated_at) ON TABLE app.activities TO alunza_app;


--
-- Name: TABLE activity_exercises; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT ON TABLE app.activity_exercises TO alunza_identity;
GRANT SELECT,INSERT,DELETE ON TABLE app.activity_exercises TO alunza_app;


--
-- Name: TABLE audit_events; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT ON TABLE app.audit_events TO alunza_identity;
GRANT SELECT,INSERT ON TABLE app.audit_events TO alunza_app;


--
-- Name: TABLE class_join_codes; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT ON TABLE app.class_join_codes TO alunza_identity;
GRANT SELECT,INSERT ON TABLE app.class_join_codes TO alunza_app;


--
-- Name: COLUMN class_join_codes.revoked_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(revoked_at) ON TABLE app.class_join_codes TO alunza_identity;
GRANT UPDATE(revoked_at) ON TABLE app.class_join_codes TO alunza_app;


--
-- Name: COLUMN class_join_codes.uses_count; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(uses_count) ON TABLE app.class_join_codes TO alunza_identity;


--
-- Name: COLUMN class_join_codes.revision; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(revision) ON TABLE app.class_join_codes TO alunza_identity;
GRANT UPDATE(revision) ON TABLE app.class_join_codes TO alunza_app;


--
-- Name: TABLE class_memberships; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT ON TABLE app.class_memberships TO alunza_identity;
GRANT SELECT,INSERT ON TABLE app.class_memberships TO alunza_app;


--
-- Name: TABLE classes; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT ON TABLE app.classes TO alunza_identity;
GRANT SELECT,INSERT ON TABLE app.classes TO alunza_app;


--
-- Name: COLUMN classes.course_id; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(course_id) ON TABLE app.classes TO alunza_app;


--
-- Name: COLUMN classes.teacher_id; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(teacher_id) ON TABLE app.classes TO alunza_app;


--
-- Name: COLUMN classes.code; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(code) ON TABLE app.classes TO alunza_app;


--
-- Name: COLUMN classes.name; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(name) ON TABLE app.classes TO alunza_app;


--
-- Name: COLUMN classes.description; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(description) ON TABLE app.classes TO alunza_app;


--
-- Name: COLUMN classes.start_date; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(start_date) ON TABLE app.classes TO alunza_app;


--
-- Name: COLUMN classes.end_date; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(end_date) ON TABLE app.classes TO alunza_app;


--
-- Name: COLUMN classes.revision; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(revision) ON TABLE app.classes TO alunza_app;


--
-- Name: COLUMN classes.updated_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(updated_at) ON TABLE app.classes TO alunza_app;


--
-- Name: COLUMN classes.archived_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(archived_at) ON TABLE app.classes TO alunza_app;


--
-- Name: TABLE concept_versions; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT ON TABLE app.concept_versions TO alunza_identity;
GRANT SELECT,INSERT ON TABLE app.concept_versions TO alunza_app;


--
-- Name: TABLE concepts; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT ON TABLE app.concepts TO alunza_identity;
GRANT SELECT,INSERT ON TABLE app.concepts TO alunza_app;


--
-- Name: COLUMN concepts.normalized_name; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(normalized_name) ON TABLE app.concepts TO alunza_app;


--
-- Name: COLUMN concepts.current_version_id; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(current_version_id) ON TABLE app.concepts TO alunza_app;


--
-- Name: COLUMN concepts.revision; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(revision) ON TABLE app.concepts TO alunza_app;


--
-- Name: COLUMN concepts.updated_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(updated_at) ON TABLE app.concepts TO alunza_app;


--
-- Name: COLUMN concepts.archived_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(archived_at) ON TABLE app.concepts TO alunza_app;


--
-- Name: TABLE courses; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT ON TABLE app.courses TO alunza_identity;
GRANT SELECT,INSERT ON TABLE app.courses TO alunza_app;


--
-- Name: COLUMN courses.code; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(code) ON TABLE app.courses TO alunza_app;


--
-- Name: COLUMN courses.name; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(name) ON TABLE app.courses TO alunza_app;


--
-- Name: COLUMN courses.description; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(description) ON TABLE app.courses TO alunza_app;


--
-- Name: COLUMN courses.academic_period; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(academic_period) ON TABLE app.courses TO alunza_app;


--
-- Name: COLUMN courses.start_date; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(start_date) ON TABLE app.courses TO alunza_app;


--
-- Name: COLUMN courses.end_date; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(end_date) ON TABLE app.courses TO alunza_app;


--
-- Name: COLUMN courses.revision; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(revision) ON TABLE app.courses TO alunza_app;


--
-- Name: COLUMN courses.updated_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(updated_at) ON TABLE app.courses TO alunza_app;


--
-- Name: COLUMN courses.archived_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(archived_at) ON TABLE app.courses TO alunza_app;


--
-- Name: TABLE executions; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.executions TO alunza_identity;


--
-- Name: COLUMN executions.id; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(id) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.organization_id; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(organization_id) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.class_id; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(class_id) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.activity_id; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(activity_id) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.activity_exercise_id; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(activity_exercise_id) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.exercise_version_id; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(exercise_version_id) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.student_id; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(student_id) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.operation_id; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(operation_id) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.purpose; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(purpose) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.code_hash; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(code_hash) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.test_suite_hash; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(test_suite_hash) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.limits_snapshot; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(limits_snapshot) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.runner_version; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(runner_version) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.visible_total; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(visible_total) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.lifecycle_status; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(lifecycle_status) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.admitted_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(admitted_at) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.started_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(started_at) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.finished_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(finished_at) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.lease_until; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(lease_until) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.response_body; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(response_body) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.response_expires_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(response_expires_at) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.cleanup_verified; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(cleanup_verified) ON TABLE app.executions TO alunza_app;


--
-- Name: COLUMN executions.request_id; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT(request_id) ON TABLE app.executions TO alunza_app;


--
-- Name: TABLE exercise_version_concepts; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT ON TABLE app.exercise_version_concepts TO alunza_identity;
GRANT SELECT,INSERT ON TABLE app.exercise_version_concepts TO alunza_app;


--
-- Name: TABLE exercise_versions; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT ON TABLE app.exercise_versions TO alunza_identity;
GRANT SELECT,INSERT ON TABLE app.exercise_versions TO alunza_app;


--
-- Name: TABLE exercises; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT ON TABLE app.exercises TO alunza_identity;
GRANT SELECT,INSERT ON TABLE app.exercises TO alunza_app;


--
-- Name: COLUMN exercises.visibility; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(visibility) ON TABLE app.exercises TO alunza_app;


--
-- Name: COLUMN exercises.current_version_id; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(current_version_id) ON TABLE app.exercises TO alunza_app;


--
-- Name: COLUMN exercises.revision; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(revision) ON TABLE app.exercises TO alunza_app;


--
-- Name: COLUMN exercises.updated_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(updated_at) ON TABLE app.exercises TO alunza_app;


--
-- Name: COLUMN exercises.archived_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(archived_at) ON TABLE app.exercises TO alunza_app;


--
-- Name: TABLE operation_keys; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE app.operation_keys TO alunza_identity;
GRANT SELECT,INSERT ON TABLE app.operation_keys TO alunza_app;


--
-- Name: COLUMN operation_keys.state; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(state) ON TABLE app.operation_keys TO alunza_app;
GRANT UPDATE(state) ON TABLE app.operation_keys TO alunza_identity;


--
-- Name: COLUMN operation_keys.resource_type; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(resource_type) ON TABLE app.operation_keys TO alunza_app;
GRANT UPDATE(resource_type) ON TABLE app.operation_keys TO alunza_identity;


--
-- Name: COLUMN operation_keys.resource_id; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(resource_id) ON TABLE app.operation_keys TO alunza_app;
GRANT UPDATE(resource_id) ON TABLE app.operation_keys TO alunza_identity;


--
-- Name: COLUMN operation_keys.response_status; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(response_status) ON TABLE app.operation_keys TO alunza_app;
GRANT UPDATE(response_status) ON TABLE app.operation_keys TO alunza_identity;


--
-- Name: COLUMN operation_keys.response_body; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(response_body) ON TABLE app.operation_keys TO alunza_identity;
GRANT UPDATE(response_body) ON TABLE app.operation_keys TO alunza_app;


--
-- Name: COLUMN operation_keys.updated_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(updated_at) ON TABLE app.operation_keys TO alunza_app;
GRANT UPDATE(updated_at) ON TABLE app.operation_keys TO alunza_identity;


--
-- Name: COLUMN operation_keys.lease_until; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(lease_until) ON TABLE app.operation_keys TO alunza_app;
GRANT UPDATE(lease_until) ON TABLE app.operation_keys TO alunza_identity;


--
-- Name: TABLE organization_invitations; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT ON TABLE app.organization_invitations TO alunza_identity;
GRANT SELECT,INSERT ON TABLE app.organization_invitations TO alunza_app;


--
-- Name: COLUMN organization_invitations.token_digest; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(token_digest) ON TABLE app.organization_invitations TO alunza_app;


--
-- Name: COLUMN organization_invitations.generation; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(generation) ON TABLE app.organization_invitations TO alunza_app;


--
-- Name: COLUMN organization_invitations.expires_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(expires_at) ON TABLE app.organization_invitations TO alunza_app;


--
-- Name: COLUMN organization_invitations.accepted_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(accepted_at) ON TABLE app.organization_invitations TO alunza_app;


--
-- Name: COLUMN organization_invitations.accepted_by; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(accepted_by) ON TABLE app.organization_invitations TO alunza_app;


--
-- Name: COLUMN organization_invitations.revoked_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(revoked_at) ON TABLE app.organization_invitations TO alunza_app;


--
-- Name: COLUMN organization_invitations.revoked_by; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(revoked_by) ON TABLE app.organization_invitations TO alunza_app;


--
-- Name: COLUMN organization_invitations.updated_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(updated_at) ON TABLE app.organization_invitations TO alunza_app;


--
-- Name: COLUMN organization_invitations.revision; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(revision) ON TABLE app.organization_invitations TO alunza_app;


--
-- Name: TABLE organization_memberships; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE app.organization_memberships TO alunza_app;
GRANT SELECT ON TABLE app.organization_memberships TO alunza_identity;


--
-- Name: COLUMN organization_memberships.role; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(role) ON TABLE app.organization_memberships TO alunza_app;


--
-- Name: COLUMN organization_memberships.state; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(state) ON TABLE app.organization_memberships TO alunza_app;


--
-- Name: COLUMN organization_memberships.joined_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(joined_at) ON TABLE app.organization_memberships TO alunza_app;


--
-- Name: COLUMN organization_memberships.disabled_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(disabled_at) ON TABLE app.organization_memberships TO alunza_app;


--
-- Name: COLUMN organization_memberships.revision; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(revision) ON TABLE app.organization_memberships TO alunza_app;


--
-- Name: TABLE organizations; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE app.organizations TO alunza_app;
GRANT SELECT ON TABLE app.organizations TO alunza_identity;


--
-- Name: COLUMN organizations.id; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(id) ON TABLE app.organizations TO alunza_identity;


--
-- Name: COLUMN organizations.code; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(code) ON TABLE app.organizations TO alunza_app;


--
-- Name: COLUMN organizations.name; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(name) ON TABLE app.organizations TO alunza_app;


--
-- Name: COLUMN organizations.archived_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(archived_at) ON TABLE app.organizations TO alunza_app;


--
-- Name: COLUMN organizations.revision; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(revision) ON TABLE app.organizations TO alunza_app;


--
-- Name: COLUMN organizations.updated_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(updated_at) ON TABLE app.organizations TO alunza_app;


--
-- Name: COLUMN organizations.archived_by; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(archived_by) ON TABLE app.organizations TO alunza_app;


--
-- Name: COLUMN organizations.archive_reason; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(archive_reason) ON TABLE app.organizations TO alunza_app;


--
-- Name: TABLE profiles; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE app.profiles TO alunza_app;
GRANT SELECT ON TABLE app.profiles TO alunza_identity;


--
-- Name: COLUMN profiles.display_name; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(display_name) ON TABLE app.profiles TO alunza_app;


--
-- Name: COLUMN profiles.email_normalized; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(email_normalized) ON TABLE app.profiles TO alunza_app;


--
-- Name: COLUMN profiles.account_state; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(account_state) ON TABLE app.profiles TO alunza_app;


--
-- Name: COLUMN profiles.updated_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(updated_at) ON TABLE app.profiles TO alunza_app;


--
-- Name: TABLE provisioning_grants; Type: ACL; Schema: app; Owner: postgres
--

GRANT SELECT ON TABLE app.provisioning_grants TO alunza_identity;
GRANT SELECT ON TABLE app.provisioning_grants TO alunza_app;


--
-- Name: COLUMN provisioning_grants.consumed_at; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(consumed_at) ON TABLE app.provisioning_grants TO alunza_app;


--
-- Name: COLUMN provisioning_grants.consumed_organization_id; Type: ACL; Schema: app; Owner: postgres
--

GRANT UPDATE(consumed_organization_id) ON TABLE app.provisioning_grants TO alunza_app;


--
-- Name: TABLE attempt_events; Type: ACL; Schema: app_private; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE app_private.attempt_events TO alunza_identity;


--
-- Name: SEQUENCE attempt_events_event_sequence_seq; Type: ACL; Schema: app_private; Owner: postgres
--

GRANT USAGE ON SEQUENCE app_private.attempt_events_event_sequence_seq TO alunza_identity;


--
-- Name: TABLE attempt_results; Type: ACL; Schema: app_private; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE app_private.attempt_results TO alunza_identity;


--
-- Name: TABLE exercise_tests; Type: ACL; Schema: app_private; Owner: postgres
--

GRANT SELECT ON TABLE app_private.exercise_tests TO alunza_identity;
GRANT SELECT,INSERT ON TABLE app_private.exercise_tests TO alunza_app;


--
-- PostgreSQL database dump complete
--



-- Integración con Supabase Auth (permisos mínimos y políticas por actor/sesión).
GRANT USAGE ON SCHEMA auth TO alunza_identity;
GRANT SELECT (id,user_id) ON auth.sessions TO alunza_identity;
GRANT SELECT (id,email,email_confirmed_at) ON auth.users TO alunza_identity;
DROP POLICY IF EXISTS alunza_current_session ON auth.sessions;
CREATE POLICY alunza_current_session ON auth.sessions FOR SELECT TO alunza_identity
  USING (id = nullif(current_setting('app.session_id',true),'')::uuid
    AND user_id = nullif(current_setting('app.actor_id',true),'')::uuid);
DROP POLICY IF EXISTS alunza_current_identity ON auth.users;
CREATE POLICY alunza_current_identity ON auth.users FOR SELECT TO alunza_identity
  USING (id = nullif(current_setting('app.actor_id',true),'')::uuid);

COMMIT;
