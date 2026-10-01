-- IMP-02. Contract reviewed with API before DDL: docs/work/IMP-02-dictionary.md.
-- Forward-only extension of institutional identity; no data reset or remote effects.

create table app.courses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete restrict,
  code text not null check (code = upper(btrim(code)) and char_length(code) between 1 and 40),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 10000),
  academic_period text not null check (char_length(btrim(academic_period)) between 1 and 80),
  start_date date, end_date date,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id,id), unique (organization_id,code),
  check (start_date is null or end_date is null or end_date >= start_date)
);
create table app.classes (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  course_id uuid not null, teacher_id uuid not null,
  code text not null check (code = upper(btrim(code)) and char_length(code) between 1 and 40),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 10000),
  start_date date, end_date date,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id,id), unique (organization_id,code),
  foreign key (organization_id,course_id) references app.courses(organization_id,id) on delete restrict,
  foreign key (organization_id,teacher_id) references app.organization_memberships(organization_id,user_id) on delete restrict,
  check (start_date is null or end_date is null or end_date >= start_date)
);
create index classes_course_idx on app.classes(organization_id,course_id);
create index classes_teacher_idx on app.classes(organization_id,teacher_id);
create table app.class_memberships (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, class_id uuid not null, user_id uuid not null,
  state text not null default 'ACTIVE' check (state in ('ACTIVE','DISABLED')),
  joined_at timestamptz not null default now(),
  unique (organization_id,class_id,user_id), unique (organization_id,id),
  foreign key (organization_id,class_id) references app.classes(organization_id,id) on delete restrict,
  foreign key (organization_id,user_id) references app.organization_memberships(organization_id,user_id) on delete restrict
);
create index class_memberships_user_idx on app.class_memberships(organization_id,user_id,class_id);
create table app.class_join_codes (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, class_id uuid not null,
  token_digest text not null unique check (token_digest ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null, revoked_at timestamptz,
  created_by uuid not null references app.profiles(id) on delete restrict,
  created_at timestamptz not null default now(), uses_count integer not null default 0 check (uses_count >= 0),
  revision integer not null default 1 check (revision > 0),
  foreign key (organization_id,class_id) references app.classes(organization_id,id) on delete restrict,
  check (expires_at > created_at)
);
create index class_join_codes_class_idx on app.class_join_codes(organization_id,class_id);

create table app.concepts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references app.organizations(id) on delete restrict,
  normalized_name text not null check (normalized_name = lower(btrim(regexp_replace(normalize(normalized_name,NFKC),'\s+',' ','g'))) and char_length(normalized_name) between 1 and 160),
  current_version_id uuid,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id,id), unique (organization_id,normalized_name)
);
create table app.concept_versions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, concept_id uuid not null,
  version integer not null check (version > 0),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 10000), parent_concept_id uuid,
  created_by uuid not null references app.profiles(id) on delete restrict, created_at timestamptz not null default now(),
  unique (organization_id,id), unique (organization_id,concept_id,id), unique (organization_id,concept_id,version),
  foreign key (organization_id,concept_id) references app.concepts(organization_id,id) on delete restrict,
  foreign key (organization_id,parent_concept_id) references app.concepts(organization_id,id) on delete restrict,
  check (parent_concept_id is distinct from concept_id)
);
create index concept_versions_parent_idx on app.concept_versions(organization_id,parent_concept_id);
alter table app.concepts add foreign key (organization_id,id,current_version_id)
  references app.concept_versions(organization_id,concept_id,id) on delete restrict deferrable initially deferred;

create table app.exercises (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references app.organizations(id) on delete restrict,
  owner_id uuid not null, visibility text not null default 'PRIVATE' check (visibility in ('PRIVATE','ORGANIZATION')),
  current_version_id uuid, revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id,id),
  foreign key (organization_id,owner_id) references app.organization_memberships(organization_id,user_id) on delete restrict
);
create index exercises_owner_idx on app.exercises(organization_id,owner_id);
create table app.exercise_versions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, exercise_id uuid not null,
  version integer not null check (version > 0), title text not null check (char_length(btrim(title)) between 1 and 160),
  statement text not null check (char_length(btrim(statement)) between 1 and 10000),
  starter_code text not null check (octet_length(starter_code) <= 65536),
  language text not null default 'javascript' check (language = 'javascript'),
  difficulty text not null check (difficulty in ('BASIC','INTERMEDIATE','ADVANCED')),
  entrypoint text not null default 'solve' check (entrypoint = 'solve'),
  execution_limits jsonb not null default '{"memoryBytes":134217728,"timeoutMs":3000,"outputBytes":65536}'::jsonb,
  created_by uuid not null references app.profiles(id) on delete restrict, created_at timestamptz not null default now(),
  unique (organization_id,id), unique (organization_id,exercise_id,id), unique (organization_id,exercise_id,version),
  foreign key (organization_id,exercise_id) references app.exercises(organization_id,id) on delete restrict,
  check (jsonb_typeof(execution_limits) = 'object'
    and execution_limits ?& array['memoryBytes','timeoutMs','outputBytes']
    and (execution_limits - array['memoryBytes','timeoutMs','outputBytes']) = '{}'::jsonb
    and jsonb_typeof(execution_limits->'memoryBytes')='number'
    and jsonb_typeof(execution_limits->'timeoutMs')='number'
    and jsonb_typeof(execution_limits->'outputBytes')='number'
    and (execution_limits->>'memoryBytes')::bigint between 1 and 134217728
    and (execution_limits->>'timeoutMs')::integer between 1 and 3000
    and (execution_limits->>'outputBytes')::integer between 1 and 65536)
);
alter table app.exercises add foreign key (organization_id,id,current_version_id)
  references app.exercise_versions(organization_id,exercise_id,id) on delete restrict deferrable initially deferred;
create table app.exercise_version_concepts (
  organization_id uuid not null, exercise_version_id uuid not null, concept_id uuid not null, concept_version_id uuid not null,
  primary key (organization_id,exercise_version_id,concept_id),
  foreign key (organization_id,exercise_version_id) references app.exercise_versions(organization_id,id) on delete restrict,
  foreign key (organization_id,concept_id,concept_version_id) references app.concept_versions(organization_id,concept_id,id) on delete restrict
);
create index exercise_version_concepts_concept_idx on app.exercise_version_concepts(organization_id,concept_id);
create table app_private.exercise_tests (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, exercise_version_id uuid not null,
  position integer not null check (position >= 0), visibility text not null check (visibility in ('VISIBLE','HIDDEN')),
  args jsonb not null check (jsonb_typeof(args) = 'array' and octet_length(args::text) <= 65536),
  expected jsonb not null check (octet_length(expected::text) <= 65536),
  comparator text not null default 'EXACT_DEEP' check (comparator = 'EXACT_DEEP'),
  unique (organization_id,exercise_version_id,position),
  foreign key (organization_id,exercise_version_id) references app.exercise_versions(organization_id,id) on delete restrict
);

create table app.activities (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, class_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  type text not null check (type in ('DIAGNOSTIC','FORMATIVE')),
  instructions text not null default '' check (char_length(instructions) <= 30000),
  state text not null default 'DRAFT' check (state in ('DRAFT','PUBLISHED','CLOSED')),
  opens_at timestamptz, closes_at timestamptz, published_at timestamptz, closed_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references app.profiles(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,id),
  foreign key (organization_id,class_id) references app.classes(organization_id,id) on delete restrict,
  check (opens_at is null or closes_at is null or closes_at > opens_at),
  check ((state = 'DRAFT' and published_at is null and closed_at is null)
    or (state = 'PUBLISHED' and published_at is not null and closed_at is null)
    or (state = 'CLOSED' and published_at is not null and closed_at is not null))
);
create index activities_class_idx on app.activities(organization_id,class_id,state,created_at,id);
create table app.activity_exercises (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, activity_id uuid not null, exercise_version_id uuid not null,
  position integer not null check (position >= 0), required boolean not null default true,
  unique (organization_id,id), unique (organization_id,activity_id,position), unique (organization_id,activity_id,exercise_version_id),
  foreign key (organization_id,activity_id) references app.activities(organization_id,id) on delete restrict,
  foreign key (organization_id,exercise_version_id) references app.exercise_versions(organization_id,id) on delete restrict
);
create index activity_exercises_version_idx on app.activity_exercises(organization_id,exercise_version_id);

-- The existing NOLOGIN helper has explicit policies, never BYPASSRLS or ownership.
do $$ declare relation text; begin
  foreach relation in array array['courses','classes','class_memberships','class_join_codes','concepts','concept_versions',
    'exercises','exercise_versions','exercise_version_concepts','activities','activity_exercises'] loop
    execute format('alter table app.%I enable row level security',relation);
    execute format('alter table app.%I force row level security',relation);
    execute format('create policy academic_internal_lookup on app.%I for select to alunza_identity using (true)',relation);
    execute format('grant select on app.%I to alunza_identity, alunza_app',relation);
    execute format('revoke all on app.%I from public,anon,authenticated,service_role',relation);
  end loop;
end $$;
alter table app_private.exercise_tests enable row level security;
alter table app_private.exercise_tests force row level security;
create policy academic_internal_lookup on app_private.exercise_tests for select to alunza_identity using (true);
revoke all on app_private.exercise_tests from public,anon,authenticated,service_role;
grant select on app_private.exercise_tests to alunza_identity,alunza_app;
grant update(uses_count,revoked_at,revision) on app.class_join_codes to alunza_identity;
create policy academic_internal_code_update on app.class_join_codes for update to alunza_identity using (true) with check (true);

create function app_private.academic_role(org uuid) returns text
language sql stable security definer set search_path = pg_catalog as $$
  select m.role from app.organization_memberships m join app.profiles p on p.id=m.user_id
    join app.organizations o on o.id=m.organization_id
  where m.organization_id=org and m.user_id=app_private.actor_id() and m.state='ACTIVE' and p.account_state='ACTIVE'
    and o.archived_at is null and (app_private.organization_id() is null or app_private.organization_id()=org)
    and app_private.session_is_active(app_private.actor_id(),nullif(current_setting('app.session_id',true),'')::uuid)
$$;
create function app_private.can_manage_class(org uuid,target uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select app_private.academic_role(org)='TEACHER' and exists (
    select 1 from app.classes c where c.organization_id=org and c.id=target and c.teacher_id=app_private.actor_id() and c.archived_at is null)
$$;
create function app_private.can_read_class(org uuid,target uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select case app_private.academic_role(org)
    when 'ADMIN' then true
    when 'TEACHER' then exists(select 1 from app.classes c where c.organization_id=org and c.id=target and c.teacher_id=app_private.actor_id())
    when 'STUDENT' then exists(select 1 from app.class_memberships m where m.organization_id=org and m.class_id=target and m.user_id=app_private.actor_id() and m.state='ACTIVE')
    else false end
$$;
create function app_private.can_read_activity(org uuid,target uuid,content boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select exists(select 1 from app.activities a join app.classes c on c.organization_id=a.organization_id and c.id=a.class_id
    where a.organization_id=org and a.id=target and app_private.can_read_class(org,a.class_id)
      and (app_private.academic_role(org) in ('ADMIN','TEACHER') or
        (a.state='PUBLISHED' and (not content or
          (c.archived_at is null and (a.opens_at is null or a.opens_at<=statement_timestamp()) and (a.closes_at is null or a.closes_at>statement_timestamp()))))))
$$;
create function app_private.owns_exercise(org uuid,target uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select app_private.academic_role(org)='TEACHER' and exists(select 1 from app.exercises e
    where e.organization_id=org and e.id=target and e.owner_id=app_private.actor_id())
$$;
create function app_private.can_read_exercise_version(org uuid,target uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select exists(select 1 from app.exercise_versions v join app.exercises e on e.organization_id=v.organization_id and e.id=v.exercise_id
    where v.organization_id=org and v.id=target and (
      app_private.academic_role(org)='ADMIN' or
      (app_private.academic_role(org)='TEACHER' and (e.owner_id=app_private.actor_id() or e.visibility='ORGANIZATION' or
        exists(select 1 from app.activity_exercises ae where ae.organization_id=org and ae.exercise_version_id=target and app_private.can_read_activity(org,ae.activity_id,true)))) or
      (app_private.academic_role(org)='STUDENT' and exists(select 1 from app.activity_exercises ae
        where ae.organization_id=org and ae.exercise_version_id=target and app_private.can_read_activity(org,ae.activity_id,true)))))
$$;
create function app_private.academic_resource_org(kind text,target uuid) returns uuid
language plpgsql stable security definer set search_path=pg_catalog as $$
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
create function app_private.preview_class_join_code(digest text)
returns table(id uuid,class_id uuid,organization_id uuid,expires_at timestamptz,class_name text,course_name text,already_enrolled boolean)
language sql stable security definer set search_path=pg_catalog as $$
  select j.id,j.class_id,j.organization_id,j.expires_at,c.name,co.name,
    exists(select 1 from app.class_memberships m where m.organization_id=j.organization_id and m.class_id=j.class_id and m.user_id=app_private.actor_id() and m.state='ACTIVE')
    from app.class_join_codes j
    join app.classes c on c.organization_id=j.organization_id and c.id=j.class_id
    join app.courses co on co.organization_id=c.organization_id and co.id=c.course_id
  where j.token_digest=digest and j.revoked_at is null and j.expires_at>statement_timestamp()
    and c.archived_at is null and co.archived_at is null and app_private.academic_role(j.organization_id)='STUDENT'
$$;
create function app_private.lock_academic_organization(org uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if org is distinct from app_private.organization_id() or app_private.academic_role(org) is null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  perform 1 from app.organizations where id=org for update;
  if app_private.academic_role(org) is null then raise exception using errcode='42501',message='FORBIDDEN'; end if;
end $$;

-- Read policies are separate from writes; selecting a UUID never grants mutation.
create policy courses_read on app.courses for select to alunza_app using (app_private.academic_role(organization_id) is not null);
-- Evaluate the inserted row directly: a STABLE helper reading this same table
-- cannot observe it yet while INSERT ... RETURNING checks SELECT policies.
create policy classes_read on app.classes for select to alunza_app using
  (app_private.academic_role(organization_id)='ADMIN' or
    (app_private.academic_role(organization_id)='TEACHER' and teacher_id=app_private.actor_id()) or
    (app_private.academic_role(organization_id)='STUDENT' and app_private.can_read_class(organization_id,id)));
create policy class_memberships_read on app.class_memberships for select to alunza_app using
  ((user_id=app_private.actor_id() and app_private.academic_role(organization_id)='STUDENT') or
    (app_private.can_read_class(organization_id,class_id) and app_private.academic_role(organization_id) in ('ADMIN','TEACHER')));
create policy class_join_codes_read on app.class_join_codes for select to alunza_app using
  (app_private.can_manage_class(organization_id,class_id) or app_private.academic_role(organization_id)='ADMIN');
create policy concepts_read on app.concepts for select to alunza_app using (app_private.academic_role(organization_id) in ('ADMIN','TEACHER') or
  exists(select 1 from app.exercise_version_concepts ec where ec.organization_id=concepts.organization_id and ec.concept_id=concepts.id and app_private.can_read_exercise_version(ec.organization_id,ec.exercise_version_id)));
create policy concept_versions_read on app.concept_versions for select to alunza_app using (app_private.academic_role(organization_id) in ('ADMIN','TEACHER') or
  exists(select 1 from app.exercise_version_concepts ec where ec.organization_id=concept_versions.organization_id and ec.concept_version_id=concept_versions.id and app_private.can_read_exercise_version(ec.organization_id,ec.exercise_version_id)));
create policy exercises_read on app.exercises for select to alunza_app using (app_private.academic_role(organization_id)='ADMIN' or
  (app_private.academic_role(organization_id)='TEACHER' and (owner_id=app_private.actor_id() or visibility='ORGANIZATION')) or
  exists(select 1 from app.exercise_versions v where v.organization_id=exercises.organization_id and v.exercise_id=exercises.id and app_private.can_read_exercise_version(v.organization_id,v.id)));
create policy exercise_versions_read on app.exercise_versions for select to alunza_app using (app_private.owns_exercise(organization_id,exercise_id) or app_private.can_read_exercise_version(organization_id,id));
create policy exercise_concepts_read on app.exercise_version_concepts for select to alunza_app using (app_private.can_read_exercise_version(organization_id,exercise_version_id));
create policy exercise_tests_read on app_private.exercise_tests for select to alunza_app using
  (exists(select 1 from app.exercise_versions v where v.organization_id=exercise_tests.organization_id and v.id=exercise_tests.exercise_version_id
    and app_private.owns_exercise(v.organization_id,v.exercise_id)) or
   (visibility='VISIBLE' and app_private.academic_role(organization_id)='STUDENT' and app_private.can_read_exercise_version(organization_id,exercise_version_id)));
create policy activities_read on app.activities for select to alunza_app using (app_private.can_read_class(organization_id,class_id) and
  (app_private.academic_role(organization_id) in ('ADMIN','TEACHER') or (app_private.academic_role(organization_id)='STUDENT' and state='PUBLISHED')));
create policy activity_exercises_read on app.activity_exercises for select to alunza_app using (app_private.can_read_activity(organization_id,activity_id,true));

create policy courses_insert on app.courses for insert to alunza_app with check (organization_id=app_private.organization_id() and app_private.academic_role(organization_id)='ADMIN');
create policy courses_update on app.courses for update to alunza_app using (app_private.academic_role(organization_id)='ADMIN') with check (organization_id=app_private.organization_id() and app_private.academic_role(organization_id)='ADMIN');
create policy classes_insert on app.classes for insert to alunza_app with check (organization_id=app_private.organization_id() and (app_private.academic_role(organization_id)='ADMIN' or (app_private.academic_role(organization_id)='TEACHER' and teacher_id=app_private.actor_id())));
create policy classes_update on app.classes for update to alunza_app using (app_private.academic_role(organization_id)='ADMIN' or app_private.can_manage_class(organization_id,id)) with check (organization_id=app_private.organization_id() and (app_private.academic_role(organization_id)='ADMIN' or app_private.can_manage_class(organization_id,id)));
create policy memberships_insert on app.class_memberships for insert to alunza_app with check (organization_id=app_private.organization_id() and user_id=app_private.actor_id() and state='ACTIVE' and app_private.academic_role(organization_id)='STUDENT');
create policy codes_insert on app.class_join_codes for insert to alunza_app with check (organization_id=app_private.organization_id() and created_by=app_private.actor_id() and (app_private.academic_role(organization_id)='ADMIN' or app_private.can_manage_class(organization_id,class_id)));
create policy codes_update on app.class_join_codes for update to alunza_app using (app_private.academic_role(organization_id)='ADMIN' or app_private.can_manage_class(organization_id,class_id)) with check (organization_id=app_private.organization_id() and (app_private.academic_role(organization_id)='ADMIN' or app_private.can_manage_class(organization_id,class_id)));
create policy concepts_insert on app.concepts for insert to alunza_app with check (organization_id=app_private.organization_id() and app_private.academic_role(organization_id)='ADMIN');
create policy concepts_update on app.concepts for update to alunza_app using (app_private.academic_role(organization_id)='ADMIN') with check (organization_id=app_private.organization_id() and app_private.academic_role(organization_id)='ADMIN');
create policy concept_versions_insert on app.concept_versions for insert to alunza_app with check (organization_id=app_private.organization_id() and app_private.academic_role(organization_id)='ADMIN' and created_by=app_private.actor_id());
create policy exercises_insert on app.exercises for insert to alunza_app with check (organization_id=app_private.organization_id() and app_private.academic_role(organization_id)='TEACHER' and owner_id=app_private.actor_id());
create policy exercises_update on app.exercises for update to alunza_app using (app_private.academic_role(organization_id)='ADMIN' or app_private.owns_exercise(organization_id,id)) with check (organization_id=app_private.organization_id() and (app_private.academic_role(organization_id)='ADMIN' or app_private.owns_exercise(organization_id,id)));
create policy exercise_versions_insert on app.exercise_versions for insert to alunza_app with check (organization_id=app_private.organization_id() and app_private.owns_exercise(organization_id,exercise_id) and created_by=app_private.actor_id());
create policy exercise_concepts_insert on app.exercise_version_concepts for insert to alunza_app with check (organization_id=app_private.organization_id() and exists(select 1 from app.exercise_versions v where v.organization_id=exercise_version_concepts.organization_id and v.id=exercise_version_concepts.exercise_version_id and app_private.owns_exercise(v.organization_id,v.exercise_id)));
create policy exercise_tests_insert on app_private.exercise_tests for insert to alunza_app with check (organization_id=app_private.organization_id() and exists(select 1 from app.exercise_versions v where v.organization_id=exercise_tests.organization_id and v.id=exercise_tests.exercise_version_id and app_private.owns_exercise(v.organization_id,v.exercise_id)));
create policy activities_insert on app.activities for insert to alunza_app with check (organization_id=app_private.organization_id() and app_private.can_manage_class(organization_id,class_id) and created_by=app_private.actor_id() and state='DRAFT');
create policy activities_update on app.activities for update to alunza_app using (app_private.can_manage_class(organization_id,class_id)) with check (organization_id=app_private.organization_id() and app_private.can_manage_class(organization_id,class_id));
create policy activity_exercises_insert on app.activity_exercises for insert to alunza_app with check (organization_id=app_private.organization_id() and exists(select 1 from app.activities a where a.organization_id=activity_exercises.organization_id and a.id=activity_exercises.activity_id and a.state='DRAFT' and app_private.can_manage_class(a.organization_id,a.class_id)));
create policy activity_exercises_delete on app.activity_exercises for delete to alunza_app using (organization_id=app_private.organization_id() and exists(select 1 from app.activities a where a.organization_id=activity_exercises.organization_id and a.id=activity_exercises.activity_id and a.state='DRAFT' and app_private.can_manage_class(a.organization_id,a.class_id)));

grant insert on app.courses,app.classes,app.class_memberships,app.class_join_codes,app.concepts,app.concept_versions,
  app.exercises,app.exercise_versions,app.exercise_version_concepts,app.activities,app.activity_exercises,app_private.exercise_tests to alunza_app;
grant update(code,name,description,academic_period,start_date,end_date,archived_at,revision,updated_at) on app.courses to alunza_app;
grant update(code,name,description,course_id,teacher_id,start_date,end_date,archived_at,revision,updated_at) on app.classes to alunza_app;
grant update(revoked_at,revision) on app.class_join_codes to alunza_app;
grant update(normalized_name,current_version_id,archived_at,revision,updated_at) on app.concepts to alunza_app;
grant update(visibility,current_version_id,archived_at,revision,updated_at) on app.exercises to alunza_app;
grant update(title,type,instructions,state,opens_at,closes_at,revision,updated_at) on app.activities to alunza_app;
grant delete on app.activity_exercises to alunza_app;

-- All academic mutations serialize with institutional mutations/archive.
create function app_private.guard_academic_scope() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
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
do $$ declare relation text; begin
  foreach relation in array array['courses','classes','class_memberships','class_join_codes','concepts','concept_versions','exercises','exercise_versions','activities','activity_exercises'] loop
    execute format('create trigger a_academic_scope before insert or update or delete on app.%I for each row execute function app_private.guard_academic_scope()',relation);
  end loop;
end $$;
create trigger a_academic_scope before insert or update or delete on app_private.exercise_tests for each row execute function app_private.guard_academic_scope();

create function app_private.guard_academic_entity() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
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
create trigger b_academic_entity before insert or update on app.courses for each row execute function app_private.guard_academic_entity();
create trigger b_academic_entity before insert or update on app.classes for each row execute function app_private.guard_academic_entity();
create trigger b_academic_entity before insert or update on app.concepts for each row execute function app_private.guard_academic_entity();
create trigger b_academic_entity before insert or update on app.exercises for each row execute function app_private.guard_academic_entity();

create function app_private.guard_academic_version() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
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
create trigger b_version before insert or update or delete on app.concept_versions for each row execute function app_private.guard_academic_version();
create trigger b_version before insert or update or delete on app.exercise_versions for each row execute function app_private.guard_academic_version();

create function app_private.guard_exercise_child() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
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
create trigger b_exercise_child before insert or update or delete on app.exercise_version_concepts for each row execute function app_private.guard_exercise_child();
create trigger b_exercise_child before insert or update or delete on app_private.exercise_tests for each row execute function app_private.guard_exercise_child();

create function app_private.guard_class_code() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if TG_OP='INSERT' then
    if not exists(select 1 from app.classes where organization_id=new.organization_id and id=new.class_id and archived_at is null) then raise exception using errcode='P0001',message='CLASS_UNAVAILABLE'; end if;
  else
    if new.class_id<>old.class_id or new.token_digest<>old.token_digest or new.created_by<>old.created_by or new.created_at<>old.created_at or new.expires_at<>old.expires_at or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then raise exception using errcode='23514',message='IMMUTABLE_CODE'; end if;
    new.revision:=old.revision+1;
  end if;
  return new;
end $$;
create trigger b_class_code before insert or update on app.class_join_codes for each row execute function app_private.guard_class_code();
create function app_private.guard_class_enrollment() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
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
create trigger b_class_enrollment before insert or update on app.class_memberships for each row execute function app_private.guard_class_enrollment();
create function app_private.count_class_enrollment() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if app_private.actor_id() is not null or session_user='alunza_app' then
    update app.class_join_codes set uses_count=uses_count+1
      where organization_id=new.organization_id and class_id=new.class_id
        and token_digest=nullif(current_setting('app.class_join_digest',true),'');
  end if;
  return null;
end $$;
create trigger c_count_enrollment after insert on app.class_memberships for each row execute function app_private.count_class_enrollment();

create function app_private.guard_activity() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
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
create trigger b_activity before insert or update on app.activities for each row execute function app_private.guard_activity();
create function app_private.guard_activity_exercise() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
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
create trigger b_activity_exercise before insert or update or delete on app.activity_exercises for each row execute function app_private.guard_activity_exercise();

create function app_private.assert_academic_version_complete() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare current_id uuid;
begin
  if TG_TABLE_NAME='concepts' then select current_version_id into current_id from app.concepts where id=new.id;
  else select current_version_id into current_id from app.exercises where id=new.id; end if;
  if current_id is null then raise exception using errcode='23514',message='VERSION_REQUIRED'; end if;
  return null;
end $$;
create constraint trigger concept_complete after insert or update on app.concepts deferrable initially deferred for each row execute function app_private.assert_academic_version_complete();
create constraint trigger exercise_complete after insert or update on app.exercises deferrable initially deferred for each row execute function app_private.assert_academic_version_complete();

create function app_private.guard_organization_academic_archive() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
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
create trigger guard_organization_academic_archive before update on app.organizations for each row execute function app_private.guard_organization_academic_archive();

-- Assign only this migration's functions; preserve all existing helper grants.
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
do $$ declare routine regprocedure; begin
  for routine in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_private' and p.proname=any(array['academic_role','can_manage_class','can_read_class','can_read_activity','owns_exercise','can_read_exercise_version','academic_resource_org','preview_class_join_code','lock_academic_organization','guard_academic_scope','guard_academic_entity','guard_academic_version','guard_exercise_child','guard_class_code','guard_class_enrollment','count_class_enrollment','guard_activity','guard_activity_exercise','assert_academic_version_complete','guard_organization_academic_archive'])
  loop
    execute format('alter function %s owner to alunza_identity',routine);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',routine);
    execute format('grant execute on function %s to alunza_identity,alunza_app',routine);
  end loop;
end $$;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
