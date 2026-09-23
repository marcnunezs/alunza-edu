-- IMP-02. Dictionary reviewed before DDL: docs/work/IMP-02-dictionary.md.
-- Incremental only: no resets, no Auth changes, no browser grants.
create table app.courses (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references app.organizations(id),
 code text not null check (code=upper(btrim(code)) and length(code) between 1 and 40),
 name text not null check (length(btrim(name)) between 1 and 160), description text not null default '' check(length(description)<=4000),
 academic_period text not null check(length(btrim(academic_period)) between 1 and 80),
 start_date date, end_date date, archived_at timestamptz, revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,id), unique(organization_id,code), check(start_date is null or end_date is null or start_date<=end_date)
);
create table app.course_teacher_grants (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, course_id uuid not null, teacher_id uuid not null,
 granted_by uuid not null references app.profiles(id), revoked_at timestamptz, revision integer not null default 1 check(revision>0), created_at timestamptz not null default now(),
 unique(organization_id,id), unique(organization_id,course_id,teacher_id),
 foreign key(organization_id,course_id) references app.courses(organization_id,id),
 foreign key(organization_id,teacher_id) references app.organization_memberships(organization_id,user_id)
);
create table app.classes (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, course_id uuid not null, teacher_id uuid not null,
 code text not null check(code=upper(btrim(code)) and length(code) between 1 and 40),
 name text not null check(length(btrim(name)) between 1 and 160), description text not null default '' check(length(description)<=4000),
 start_date date, end_date date, archived_at timestamptz, revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,id), unique(organization_id,code), check(start_date is null or end_date is null or start_date<=end_date),
 foreign key(organization_id,course_id) references app.courses(organization_id,id),
 foreign key(organization_id,teacher_id) references app.organization_memberships(organization_id,user_id)
);
create table app.class_memberships (
 id uuid not null default gen_random_uuid() unique, organization_id uuid not null, class_id uuid not null, user_id uuid not null,
 enrolled_at timestamptz not null default now(), ended_at timestamptz,
 primary key(organization_id,class_id,user_id),
 foreign key(organization_id,class_id) references app.classes(organization_id,id),
 foreign key(organization_id,user_id) references app.organization_memberships(organization_id,user_id)
);
create table app.class_join_codes (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, class_id uuid not null,
 token_digest text not null unique check(token_digest~'^[a-f0-9]{64}$'), expires_at timestamptz not null,
 revoked_at timestamptz, created_by uuid not null references app.profiles(id), uses_count integer not null default 0 check(uses_count>=0),
 revision integer not null default 1 check(revision>0), created_at timestamptz not null default now(), unique(organization_id,id),
 foreign key(organization_id,class_id) references app.classes(organization_id,id), check(expires_at>created_at and expires_at<=created_at+interval '7 days')
);
create unique index class_one_live_code on app.class_join_codes(organization_id,class_id) where revoked_at is null;
create table app.concept_tags (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references app.organizations(id),
 normalized_name text not null check(length(btrim(normalized_name)) between 1 and 160), current_version_id uuid,
 archived_at timestamptz, revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id), unique(organization_id,normalized_name)
);
create table app.concept_versions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, concept_id uuid not null,
 version integer not null check(version>0), name text not null check(length(btrim(name)) between 1 and 160),
 description text not null default '' check(length(description)<=4000), parent_concept_id uuid,
 created_by uuid not null references app.profiles(id), created_at timestamptz not null default now(),
 unique(organization_id,id), unique(organization_id,concept_id,id), unique(organization_id,concept_id,version),
 foreign key(organization_id,concept_id) references app.concept_tags(organization_id,id),
 foreign key(organization_id,parent_concept_id) references app.concept_tags(organization_id,id), check(parent_concept_id is null or parent_concept_id<>concept_id)
);
alter table app.concept_tags add foreign key(organization_id,id,current_version_id) references app.concept_versions(organization_id,concept_id,id);
create table app.exercises (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, owner_id uuid not null,
 visibility text not null default 'PRIVATE' check(visibility in ('PRIVATE','ORGANIZATION')), current_version_id uuid,
 archived_at timestamptz, revision integer not null default 1 check(revision>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,id), foreign key(organization_id,owner_id) references app.organization_memberships(organization_id,user_id)
);
create table app.exercise_versions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, exercise_id uuid not null, version integer not null check(version>0),
 title text not null check(length(btrim(title)) between 1 and 160), statement text not null check(length(btrim(statement)) between 1 and 16000),
 starter_code text not null check(octet_length(starter_code)<=65536), language text not null default 'javascript' check(language='javascript'),
 entrypoint text not null default 'solve' check(entrypoint='solve'), difficulty text not null check(difficulty in ('BEGINNER','INTERMEDIATE','ADVANCED')),
 execution_limits jsonb not null default '{"memoryBytes":134217728,"runtimeMs":3000,"outputBytes":65536}'::jsonb
  check(execution_limits='{"memoryBytes":134217728,"runtimeMs":3000,"outputBytes":65536}'::jsonb),
 created_by uuid not null references app.profiles(id), created_at timestamptz not null default now(),
 created_transaction xid8 not null default pg_current_xact_id(),
 unique(organization_id,id), unique(organization_id,exercise_id,id), unique(organization_id,exercise_id,version),
 foreign key(organization_id,exercise_id) references app.exercises(organization_id,id)
);
alter table app.exercises add foreign key(organization_id,id,current_version_id) references app.exercise_versions(organization_id,exercise_id,id);
create table app.exercise_version_concepts (
 organization_id uuid not null, exercise_version_id uuid not null, concept_version_id uuid not null,
 primary key(organization_id,exercise_version_id,concept_version_id),
 foreign key(organization_id,exercise_version_id) references app.exercise_versions(organization_id,id),
 foreign key(organization_id,concept_version_id) references app.concept_versions(organization_id,id)
);
create table app_private.exercise_tests (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, exercise_version_id uuid not null,
 test_id text not null check(length(test_id) between 1 and 100), position integer not null check(position between 0 and 7),
 -- Preserve JSON.stringify bytes; jsonb output adds spaces and expands exponent notation.
 visibility text not null check(visibility in ('visible','hidden')), args json not null check(json_typeof(args)='array' and octet_length(args::text)<=65536),
 expected json not null check(octet_length(expected::text)<=65536),
 unique(organization_id,exercise_version_id,test_id), unique(organization_id,exercise_version_id,position),
 foreign key(organization_id,exercise_version_id) references app.exercise_versions(organization_id,id)
);
create table app.activities (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, class_id uuid not null,
 created_by uuid not null references app.profiles(id), title text not null check(length(btrim(title)) between 1 and 160),
 type text not null check(type in ('DIAGNOSTIC','FORMATIVE')), instructions text not null default '' check(length(instructions)<=16000),
 state text not null default 'DRAFT' check(state in ('DRAFT','PUBLISHED','CLOSED')),
 opens_at timestamptz, closes_at timestamptz, published_at timestamptz, closed_at timestamptz,
 revision integer not null default 1 check(revision>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,id), foreign key(organization_id,class_id) references app.classes(organization_id,id),
 check(opens_at is null or closes_at is null or opens_at<closes_at),
 check((state='DRAFT' and published_at is null and closed_at is null) or (state='PUBLISHED' and published_at is not null and closed_at is null) or (state='CLOSED' and published_at is not null and closed_at is not null))
);
create table app.activity_exercises (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, activity_id uuid not null, exercise_version_id uuid not null,
 position integer not null check(position>=0), required boolean not null default true,
 unique(organization_id,id), unique(organization_id,activity_id,position), unique(organization_id,activity_id,exercise_version_id),
 foreign key(organization_id,activity_id) references app.activities(organization_id,id),
 foreign key(organization_id,exercise_version_id) references app.exercise_versions(organization_id,id)
);
create index classes_course_idx on app.classes(organization_id,course_id);
create index classes_teacher_idx on app.classes(organization_id,teacher_id);
create index memberships_user_idx on app.class_memberships(user_id,organization_id,class_id);
create index activities_class_idx on app.activities(organization_id,class_id,state,id);
create index activity_exercises_version_idx on app.activity_exercises(organization_id,exercise_version_id);
create index concepts_version_reference_idx on app.exercise_version_concepts(organization_id,concept_version_id);

-- Explicit helper-role policies avoid recursive RLS; role neither owns tables nor bypasses RLS.
do $$ declare t text; begin
 foreach t in array array['courses','course_teacher_grants','classes','class_memberships','class_join_codes','concept_tags','concept_versions','exercises','exercise_versions','exercise_version_concepts','activities','activity_exercises'] loop
  execute format('alter table app.%I enable row level security',t);
  execute format('alter table app.%I force row level security',t);
  execute format('revoke all on app.%I from public, anon, authenticated, service_role',t);
  execute format('grant select on app.%I to alunza_identity,alunza_app',t);
  execute format('create policy academic_internal_lookup on app.%I for select to alunza_identity using(true)',t);
 end loop;
end $$;
alter table app_private.exercise_tests enable row level security;
alter table app_private.exercise_tests force row level security;
revoke all on app_private.exercise_tests from public,anon,authenticated,service_role;
grant select on app_private.exercise_tests to alunza_identity,alunza_app;
create policy academic_internal_lookup on app_private.exercise_tests for select to alunza_identity using(true);

create function app_private.academic_role(org uuid, roles text[] default array['ADMIN','TEACHER','STUDENT'], archived boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select (app_private.organization_id() is null or app_private.organization_id()=org)
 and app_private.session_is_active(app_private.actor_id(),nullif(current_setting('app.session_id',true),'')::uuid)
 and exists(select 1 from app.organization_memberships m join app.profiles p on p.id=m.user_id join app.organizations o on o.id=m.organization_id
 where m.organization_id=org and m.user_id=app_private.actor_id() and m.role=any(roles) and m.state='ACTIVE' and p.account_state='ACTIVE'
 and (o.archived_at is null or (archived and m.role='ADMIN')))
$$;
create function app_private.lock_academic_organization(org uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if org is distinct from app_private.organization_id() then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 if not app_private.academic_role(org) then
  if app_private.academic_role(org,array['ADMIN'],true) then raise exception using errcode='P0001',message='ORGANIZATION_ARCHIVED'; end if;
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 perform 1 from app.organizations where id=org for update;
 if not app_private.academic_role(org) then
  if app_private.academic_role(org,array['ADMIN'],true) then raise exception using errcode='P0001',message='ORGANIZATION_ARCHIVED'; end if;
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
end $$;
create function app_private.academic_teacher(cls uuid, include_archived boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.classes c where c.id=cls and c.teacher_id=app_private.actor_id()
 and app_private.academic_role(c.organization_id,array['TEACHER']) and (include_archived or c.archived_at is null))
$$;
create function app_private.academic_student(cls uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.classes c join app.class_memberships m on m.class_id=c.id and m.organization_id=c.organization_id
 where c.id=cls and m.user_id=app_private.actor_id() and m.ended_at is null and app_private.academic_role(c.organization_id,array['STUDENT']))
$$;
create function app_private.academic_class_read(cls uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.classes c where c.id=cls and (app_private.academic_role(c.organization_id,array['ADMIN'],true)
 or app_private.academic_teacher(cls,true) or app_private.academic_student(cls)))
$$;
create function app_private.academic_activity_read(act uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.activities a where a.id=act and (app_private.academic_teacher(a.class_id,true)
 or (a.state in ('PUBLISHED','CLOSED') and app_private.academic_student(a.class_id))))
$$;
create function app_private.academic_exercise_author(ex uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.exercises e where e.id=ex and app_private.academic_role(e.organization_id,array['TEACHER']) and e.owner_id=app_private.actor_id())
$$;
create function app_private.academic_exercise_read(ex uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.exercises e where e.id=ex and (app_private.academic_role(e.organization_id,array['ADMIN'],true)
 or (app_private.academic_role(e.organization_id,array['TEACHER']) and (e.owner_id=app_private.actor_id() or e.visibility='ORGANIZATION'))))
$$;
create function app_private.academic_version_read(ver uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.exercise_versions v where v.id=ver and (app_private.academic_exercise_read(v.exercise_id)
 or exists(select 1 from app.activity_exercises ae where ae.organization_id=v.organization_id and ae.exercise_version_id=v.id and app_private.academic_activity_read(ae.activity_id))))
$$;
create function app_private.academic_teacher_name(org uuid, teacher uuid) returns text
language sql stable security definer set search_path=pg_catalog as $$
 select p.display_name from app.profiles p where p.id=teacher
 and exists(select 1 from app.organization_memberships m where m.organization_id=org and m.user_id=teacher)
 and (app_private.academic_role(org,array['ADMIN'],true)
 or exists(select 1 from app.classes c where c.organization_id=org and c.teacher_id=teacher and app_private.academic_class_read(c.id)))
$$;
create function app_private.resolve_join_code(digest text)
returns table(id uuid,organization_id uuid,class_id uuid,class_name text,expires_at timestamptz,revoked_at timestamptz,archived_at timestamptz)
language sql stable security definer set search_path=pg_catalog as $$
 select j.id,j.organization_id,j.class_id,c.name,j.expires_at,j.revoked_at,c.archived_at from app.class_join_codes j
 join app.classes c on c.id=j.class_id and c.organization_id=j.organization_id
 where j.token_digest=digest and j.revoked_at is null and j.expires_at>statement_timestamp() and c.archived_at is null
 and app_private.academic_role(j.organization_id,array['STUDENT'])
 and not exists(select 1 from app.class_memberships m where m.organization_id=j.organization_id and m.class_id=j.class_id and m.user_id=app_private.actor_id() and m.ended_at is not null)
$$;
create function app_private.enrollment_replay(code_digest text, operation_key text)
returns table(organization_id uuid,class_id uuid,payload_hash text,state text,expires_at timestamptz,response_body jsonb)
language sql stable security definer set search_path=pg_catalog as $$
 select k.organization_id,j.class_id,k.payload_hash,k.state,k.expires_at,k.response_body
 from app.operation_keys k join app.class_join_codes j on j.organization_id=k.organization_id and j.class_id=k.resource_id
 join app.class_memberships m on m.organization_id=k.organization_id and m.class_id=k.resource_id and m.user_id=k.actor_id and m.ended_at is null
 where k.actor_id=app_private.actor_id() and k.operation='class.enroll' and k.key=operation_key and j.token_digest=code_digest
 and app_private.academic_role(k.organization_id,array['STUDENT'])
$$;

-- Reads bootstrap context by authorized resource ID; writes always require exact organization context.
create policy courses_read on app.courses for select to alunza_app using(app_private.academic_role(organization_id,array['ADMIN','TEACHER'],true));
create policy courses_write on app.courses for all to alunza_app using(app_private.can_admin(organization_id)) with check(app_private.can_admin(organization_id));
create policy grants_read on app.course_teacher_grants for select to alunza_app using(app_private.academic_role(organization_id,array['ADMIN'],true) or (teacher_id=app_private.actor_id() and app_private.academic_role(organization_id,array['TEACHER'])));
create policy grants_write on app.course_teacher_grants for all to alunza_app using(app_private.can_admin(organization_id)) with check(app_private.can_admin(organization_id));
-- New rows must be visible to INSERT RETURNING without a STABLE self lookup.
create policy classes_read on app.classes for select to alunza_app using(app_private.academic_role(organization_id,array['ADMIN'],true) or (teacher_id=app_private.actor_id() and app_private.academic_role(organization_id,array['TEACHER'])) or app_private.academic_student(id));
create policy classes_insert on app.classes for insert to alunza_app with check(organization_id=app_private.organization_id() and (app_private.can_admin(organization_id) or (teacher_id=app_private.actor_id() and app_private.academic_role(organization_id,array['TEACHER']) and exists(select 1 from app.course_teacher_grants g where g.organization_id=classes.organization_id and g.course_id=classes.course_id and g.teacher_id=app_private.actor_id() and g.revoked_at is null))));
create policy classes_update on app.classes for update to alunza_app using(app_private.can_admin(organization_id) or app_private.academic_teacher(id)) with check(organization_id=app_private.organization_id() and (app_private.can_admin(organization_id) or teacher_id=app_private.actor_id()));
create policy memberships_read on app.class_memberships for select to alunza_app using(app_private.academic_role(organization_id,array['ADMIN'],true) or app_private.academic_teacher(class_id,true) or (user_id=app_private.actor_id() and ended_at is null and app_private.academic_role(organization_id,array['STUDENT'])));
create policy memberships_insert on app.class_memberships for insert to alunza_app with check(organization_id=app_private.organization_id() and user_id=app_private.actor_id() and ended_at is null and exists(select 1 from app_private.resolve_join_code(current_setting('app.join_code_digest',true)) j where j.class_id=class_memberships.class_id and j.organization_id=class_memberships.organization_id));
create policy memberships_update on app.class_memberships for update to alunza_app using(app_private.can_admin(organization_id)) with check(app_private.can_admin(organization_id));
create policy codes_read on app.class_join_codes for select to alunza_app using(app_private.can_admin(organization_id) or app_private.academic_teacher(class_id));
create policy codes_write on app.class_join_codes for all to alunza_app using(app_private.can_admin(organization_id) or app_private.academic_teacher(class_id)) with check(organization_id=app_private.organization_id() and (app_private.can_admin(organization_id) or app_private.academic_teacher(class_id)));
create policy tags_read on app.concept_tags for select to alunza_app using(app_private.academic_role(organization_id));
create policy tags_write on app.concept_tags for all to alunza_app using(app_private.can_admin(organization_id)) with check(app_private.can_admin(organization_id));
create policy concepts_read on app.concept_versions for select to alunza_app using(app_private.academic_role(organization_id));
create policy concepts_insert on app.concept_versions for insert to alunza_app with check(app_private.can_admin(organization_id) and created_by=app_private.actor_id());
create policy exercises_read on app.exercises for select to alunza_app using(app_private.academic_role(organization_id,array['ADMIN'],true) or (app_private.academic_role(organization_id,array['TEACHER']) and (owner_id=app_private.actor_id() or visibility='ORGANIZATION')));
create policy exercises_insert on app.exercises for insert to alunza_app with check(organization_id=app_private.organization_id() and owner_id=app_private.actor_id() and visibility='PRIVATE' and app_private.academic_role(organization_id,array['TEACHER']));
create policy exercises_update on app.exercises for update to alunza_app using(app_private.academic_exercise_author(id) or app_private.can_admin(organization_id)) with check(organization_id=app_private.organization_id() and (app_private.academic_exercise_author(id) or app_private.can_admin(organization_id)));
create policy versions_read on app.exercise_versions for select to alunza_app using(app_private.academic_exercise_read(exercise_id) or app_private.academic_version_read(id));
create policy versions_insert on app.exercise_versions for insert to alunza_app with check(organization_id=app_private.organization_id() and created_by=app_private.actor_id() and app_private.academic_exercise_author(exercise_id));
create policy links_read on app.exercise_version_concepts for select to alunza_app using(app_private.academic_version_read(exercise_version_id));
create policy links_insert on app.exercise_version_concepts for insert to alunza_app with check(organization_id=app_private.organization_id() and exists(select 1 from app.exercise_versions v where v.id=exercise_version_id and app_private.academic_exercise_author(v.exercise_id)));
create policy tests_read on app_private.exercise_tests for select to alunza_app using(exists(select 1 from app.exercise_versions v where v.id=exercise_version_id and (app_private.academic_exercise_read(v.exercise_id) or (visibility='visible' and app_private.academic_version_read(v.id)))));
create policy tests_insert on app_private.exercise_tests for insert to alunza_app with check(organization_id=app_private.organization_id() and exists(select 1 from app.exercise_versions v where v.id=exercise_version_id and app_private.academic_exercise_author(v.exercise_id)));
create policy activities_read on app.activities for select to alunza_app using(app_private.academic_teacher(class_id,true) or (state in ('PUBLISHED','CLOSED') and app_private.academic_student(class_id)));
create policy activities_insert on app.activities for insert to alunza_app with check(organization_id=app_private.organization_id() and created_by=app_private.actor_id() and app_private.academic_teacher(class_id) and state='DRAFT');
create policy activities_update on app.activities for update to alunza_app using(app_private.academic_teacher(class_id)) with check(organization_id=app_private.organization_id() and app_private.academic_teacher(class_id));
create policy items_read on app.activity_exercises for select to alunza_app using(app_private.academic_activity_read(activity_id));
create policy items_write on app.activity_exercises for all to alunza_app using(exists(select 1 from app.activities a where a.id=activity_id and a.state='DRAFT' and app_private.academic_teacher(a.class_id))) with check(organization_id=app_private.organization_id() and exists(select 1 from app.activities a where a.id=activity_id and a.state='DRAFT' and app_private.academic_teacher(a.class_id)));

grant insert,update on app.courses,app.course_teacher_grants,app.classes,app.class_memberships,app.class_join_codes,app.concept_tags,app.exercises,app.activities to alunza_app;
grant insert on app.concept_versions,app.exercise_versions,app.exercise_version_concepts,app_private.exercise_tests to alunza_app;
grant insert,delete on app.activity_exercises to alunza_app;

create function app_private.academic_student_name(org uuid, cls uuid, student uuid) returns text
language sql stable security definer set search_path=pg_catalog as $$
 select p.display_name from app.profiles p join app.class_memberships m on m.user_id=p.id
 where m.organization_id=org and m.class_id=cls and m.user_id=student
 and (app_private.academic_role(org,array['ADMIN'],true) or app_private.academic_teacher(cls,true))
$$;

create function app_private.guard_academic_resource() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare org uuid; runtime boolean; prior jsonb; changed jsonb; course app.courses; parent uuid;
begin
 org:=new.organization_id;
 runtime:=session_user='alunza_app' or current_setting('role',true)='alunza_app';
 if runtime then perform app_private.lock_academic_organization(org); end if;
 if TG_OP='UPDATE' then
  prior:=to_jsonb(old); changed:=to_jsonb(new);
  if new.id<>old.id or org<>old.organization_id then raise exception using errcode='23514',message='IMMUTABLE_SCOPE'; end if;
  if prior->>'archived_at' is not null and changed is distinct from prior then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
  if (prior->>'created_at') is distinct from (changed->>'created_at') then raise exception using errcode='23514',message='IMMUTABLE_HISTORY'; end if;
  new.revision:=old.revision+1;
 end if;
 if TG_TABLE_NAME in ('courses','classes','concept_tags','exercises','activities') then new.updated_at:=statement_timestamp(); end if;
 if TG_TABLE_NAME='courses' then
  if TG_OP='UPDATE' and new.archived_at is not null and old.archived_at is null and exists(select 1 from app.classes c where c.course_id=new.id and c.archived_at is null) then
   raise exception using errcode='P0001',message='DEPENDENCIES_ACTIVE'; end if;
  if exists(select 1 from app.classes c where c.course_id=new.id and ((new.start_date is not null and c.start_date<new.start_date) or (new.end_date is not null and c.end_date>new.end_date))) then
   raise exception using errcode='23514',message='ACADEMIC_DATES'; end if;
 elsif TG_TABLE_NAME='course_teacher_grants' then
  if TG_OP='UPDATE' and (new.course_id<>old.course_id or new.teacher_id<>old.teacher_id) then raise exception using errcode='23514',message='IMMUTABLE_SCOPE'; end if;
  if new.revoked_at is null and not exists(select 1 from app.organization_memberships m join app.profiles p on p.id=m.user_id where m.organization_id=org and m.user_id=new.teacher_id and m.role='TEACHER' and m.state='ACTIVE' and p.account_state='ACTIVE') then raise exception using errcode='23514',message='TEACHER_INACTIVE'; end if;
  if new.revoked_at is null and exists(select 1 from app.courses c where c.id=new.course_id and c.archived_at is not null) then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
 elsif TG_TABLE_NAME='classes' then
  select * into course from app.courses c where c.id=new.course_id and c.organization_id=org;
  if course.archived_at is not null then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
  if (course.start_date is not null and new.start_date<course.start_date) or (course.end_date is not null and new.end_date>course.end_date) then raise exception using errcode='23514',message='ACADEMIC_DATES'; end if;
  if TG_OP='INSERT' or new.teacher_id<>old.teacher_id then
   if not exists(select 1 from app.organization_memberships m join app.profiles p on p.id=m.user_id where m.organization_id=org and m.user_id=new.teacher_id and m.role='TEACHER' and m.state='ACTIVE' and p.account_state='ACTIVE') then raise exception using errcode='23514',message='TEACHER_INACTIVE'; end if;
  end if;
  if TG_OP='UPDATE' then
   if new.course_id<>old.course_id then raise exception using errcode='23514',message='IMMUTABLE_SCOPE'; end if;
   if runtime and (new.teacher_id<>old.teacher_id or new.archived_at is distinct from old.archived_at) and not app_private.can_admin(org) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
   if new.archived_at is not null and old.archived_at is null and exists(select 1 from app.activities a where a.class_id=new.id and a.state='PUBLISHED') then raise exception using errcode='P0001',message='DEPENDENCIES_ACTIVE'; end if;
  end if;
 elsif TG_TABLE_NAME='class_join_codes' then
  if TG_OP='INSERT' and runtime and new.created_by<>app_private.actor_id() then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if TG_OP='UPDATE' and (new.class_id<>old.class_id or new.token_digest<>old.token_digest or new.created_by<>old.created_by or new.expires_at<>old.expires_at or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)) then raise exception using errcode='23514',message='IMMUTABLE_SCOPE'; end if;
  if exists(select 1 from app.classes c where c.id=new.class_id and c.archived_at is not null) and new.revoked_at is null then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
 elsif TG_TABLE_NAME='concept_tags' then
  if new.current_version_id is not null then
   select v.parent_concept_id into parent from app.concept_versions v where v.id=new.current_version_id and v.concept_id=new.id and v.organization_id=org;
   if exists(with recursive ancestors(id,path) as (
    select parent,array[new.id,parent] where parent is not null
    union all select v.parent_concept_id,a.path||v.parent_concept_id from ancestors a join app.concept_tags t on t.id=a.id and t.organization_id=org
    join app.concept_versions v on v.id=t.current_version_id where v.parent_concept_id is not null and not v.parent_concept_id=any(a.path[2:]))
    select 1 from ancestors where id=new.id) then raise exception using errcode='23514',message='CONCEPT_CYCLE'; end if;
  end if;
 elsif TG_TABLE_NAME='exercises' then
  if TG_OP='UPDATE' and runtime and (new.owner_id<>old.owner_id or new.visibility<>old.visibility or new.archived_at is distinct from old.archived_at) and not app_private.can_admin(org) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 elsif TG_TABLE_NAME='activities' then
  if TG_OP='UPDATE' then
   if new.class_id<>old.class_id or new.created_by<>old.created_by then raise exception using errcode='23514',message='IMMUTABLE_SCOPE'; end if;
   if old.state='CLOSED' or (old.state='PUBLISHED' and new.state<>'CLOSED') or (old.state='DRAFT' and new.state not in ('DRAFT','PUBLISHED')) then raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
   if old.state='PUBLISHED' and (to_jsonb(new)-array['state','closed_at','revision','updated_at']) is distinct from (to_jsonb(old)-array['state','closed_at','revision','updated_at']) then raise exception using errcode='23514',message='PUBLISHED_IMMUTABLE'; end if;
   if old.state='DRAFT' and new.state='PUBLISHED' then
    if not exists(select 1 from app.activity_exercises ae where ae.activity_id=new.id and ae.required) then raise exception using errcode='23514',message='EMPTY_ACTIVITY'; end if;
    if exists(select 1 from app.activity_exercises ae join app.exercise_versions v on v.id=ae.exercise_version_id join app.exercises e on e.id=v.exercise_id where ae.activity_id=new.id and e.archived_at is not null)
    or exists(select 1 from app.activity_exercises ae join app.exercise_version_concepts ec on ec.exercise_version_id=ae.exercise_version_id join app.concept_versions cv on cv.id=ec.concept_version_id join app.concept_tags t on t.id=cv.concept_id where ae.activity_id=new.id and t.archived_at is not null) then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
    new.published_at:=statement_timestamp();
   end if;
   if old.state='PUBLISHED' and new.state='CLOSED' then new.closed_at:=statement_timestamp(); end if;
  elsif runtime and new.state<>'DRAFT' then raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
 end if;
 return new;
end $$;

create function app_private.guard_academic_version() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare runtime boolean; ex uuid; ver uuid; org uuid;
begin
 runtime:=session_user='alunza_app' or current_setting('role',true)='alunza_app';
 if TG_OP<>'INSERT' then raise exception using errcode='23514',message='IMMUTABLE_VERSION'; end if;
 org:=new.organization_id;
 if runtime then perform app_private.lock_academic_organization(org); end if;
 if TG_TABLE_NAME='concept_versions' then
  if exists(select 1 from app.concept_tags t where t.id=new.concept_id and t.archived_at is not null) or exists(select 1 from app.concept_tags t where t.id=new.parent_concept_id and t.archived_at is not null) then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
 elsif TG_TABLE_NAME='exercise_versions' then
  new.created_transaction:=pg_current_xact_id();
  if exists(select 1 from app.exercises e where e.id=new.exercise_id and e.archived_at is not null) then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
 else
  ver:=new.exercise_version_id;
  select exercise_id into ex from app.exercise_versions where id=ver;
  if exists(select 1 from app.exercise_versions v where v.id=ver and v.created_transaction<>pg_current_xact_id()) then raise exception using errcode='23514',message='IMMUTABLE_VERSION'; end if;
  if exists(select 1 from app.exercises e where e.id=ex and (e.current_version_id=ver or e.archived_at is not null)) or exists(select 1 from app.activity_exercises ae where ae.exercise_version_id=ver) then raise exception using errcode='23514',message='IMMUTABLE_VERSION'; end if;
  if TG_TABLE_NAME='exercise_version_concepts' then
   if exists(select 1 from app.concept_versions v join app.concept_tags t on t.id=v.concept_id where v.id=new.concept_version_id and t.archived_at is not null) then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
  end if;
 end if;
 return new;
end $$;
create function app_private.assert_exercise_definition() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare ver uuid;
begin
 ver:=new.id;
 if not exists(select 1 from app_private.exercise_tests t where t.exercise_version_id=ver and t.visibility='visible')
 or (select count(*) from app_private.exercise_tests t where t.exercise_version_id=ver) not between 1 and 8
 or not exists(select 1 from app.exercise_version_concepts c where c.exercise_version_id=ver)
 or exists(select 1 from app_private.exercise_tests a join app_private.exercise_tests b on b.exercise_version_id=a.exercise_version_id and b.id<>a.id and a.args::jsonb=b.args::jsonb and a.expected::jsonb<>b.expected::jsonb where a.exercise_version_id=ver) then
  raise exception using errcode='23514',message='INCONSISTENT_TESTS';
 end if;
 return null;
end $$;
create constraint trigger exercise_definition_complete after insert on app.exercise_versions deferrable initially deferred for each row execute function app_private.assert_exercise_definition();

create function app_private.assert_academic_current_version() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare ready boolean;
begin
 execute format('select current_version_id is not null from app.%I where id=$1',TG_TABLE_NAME) into ready using new.id;
 if ready is distinct from true then raise exception using errcode='23514',message='VERSION_REQUIRED'; end if;
 return null;
end $$;
create constraint trigger concept_current_version after insert or update on app.concept_tags deferrable initially deferred for each row execute function app_private.assert_academic_current_version();
create constraint trigger exercise_current_version after insert or update on app.exercises deferrable initially deferred for each row execute function app_private.assert_academic_current_version();

create function app_private.guard_activity_item() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare item jsonb; act uuid; org uuid;
begin
 item:=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 org:=(item->>'organization_id')::uuid; act:=(item->>'activity_id')::uuid;
 if session_user='alunza_app' or current_setting('role',true)='alunza_app' then perform app_private.lock_academic_organization(org); end if;
 if exists(select 1 from app.activities a where a.id=act and a.state<>'DRAFT') then raise exception using errcode='23514',message='PUBLISHED_IMMUTABLE'; end if;
 if TG_OP<>'DELETE' then
  if exists(select 1 from app.exercise_versions v join app.exercises e on e.id=v.exercise_id where v.id=new.exercise_version_id and e.archived_at is not null) then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
  if exists(select 1 from app.exercise_version_concepts ec join app.concept_versions cv on cv.id=ec.concept_version_id join app.concept_tags t on t.id=cv.concept_id where ec.exercise_version_id=new.exercise_version_id and t.archived_at is not null) then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
  if (session_user='alunza_app' or current_setting('role',true)='alunza_app') and not exists(select 1 from app.exercise_versions v where v.id=new.exercise_version_id and app_private.academic_exercise_read(v.exercise_id)) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 end if;
 return case when TG_OP='DELETE' then old else new end;
end $$;
create trigger guard_activity_item before insert or update or delete on app.activity_exercises for each row execute function app_private.guard_activity_item();

create function app_private.guard_class_membership() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if session_user='alunza_app' or current_setting('role',true)='alunza_app' then perform app_private.lock_academic_organization(new.organization_id); end if;
 if TG_OP='UPDATE' and (new.id<>old.id or new.organization_id<>old.organization_id or new.class_id<>old.class_id or new.user_id<>old.user_id or new.enrolled_at<>old.enrolled_at) then raise exception using errcode='23514',message='IMMUTABLE_SCOPE'; end if;
 if TG_OP='INSERT' then
  if not exists(select 1 from app.organization_memberships m join app.profiles p on p.id=m.user_id where m.organization_id=new.organization_id and m.user_id=new.user_id and m.role='STUDENT' and m.state='ACTIVE' and p.account_state='ACTIVE') then raise exception using errcode='23514',message='STUDENT_INACTIVE'; end if;
  if exists(select 1 from app.classes c where c.id=new.class_id and c.archived_at is not null) then raise exception using errcode='P0001',message='RESOURCE_ARCHIVED'; end if;
 end if;
 return new;
end $$;
create trigger guard_class_membership before insert or update on app.class_memberships for each row execute function app_private.guard_class_membership();
create function app_private.count_join_code_use() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 update app.class_join_codes set uses_count=uses_count+1 where organization_id=new.organization_id and class_id=new.class_id
 and token_digest=current_setting('app.join_code_digest',true) and revoked_at is null and expires_at>statement_timestamp();
 return null;
end $$;
create trigger count_join_code_use after insert on app.class_memberships for each row execute function app_private.count_join_code_use();
grant update(uses_count) on app.class_join_codes to alunza_identity;
create policy code_counter_internal on app.class_join_codes for update to alunza_identity using(true) with check(true);

do $$ declare t text; begin
 foreach t in array array['courses','course_teacher_grants','classes','class_join_codes','concept_tags','exercises','activities'] loop
  execute format('create trigger guard_academic_resource before insert or update on app.%I for each row execute function app_private.guard_academic_resource()',t);
 end loop;
 foreach t in array array['concept_versions','exercise_versions','exercise_version_concepts'] loop
  execute format('create trigger guard_academic_version before insert or update or delete on app.%I for each row execute function app_private.guard_academic_version()',t);
 end loop;
end $$;
create trigger guard_academic_version before insert or update or delete on app_private.exercise_tests for each row execute function app_private.guard_academic_version();

-- Preserve original institutional archive invariants and extend their dependency coverage.
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
set local role alunza_identity;
create or replace function app_private.guard_organization_change() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.id<>old.id then raise exception using errcode='23514',message='IMMUTABLE_SCOPE'; end if;
 if session_user='alunza_app' or current_setting('role',true)='alunza_app' then
  if old.archived_at is not null and new is distinct from old then raise exception using errcode='P0001',message='ORGANIZATION_ARCHIVED'; end if;
  if old.archived_at is null and new.archived_at is not null then
   if new.archived_by is distinct from app_private.actor_id() or not app_private.can_admin(old.id) or new.archive_reason is null then raise exception using errcode='P0001',message='FORBIDDEN'; end if;
   if exists(select 1 from app.organization_memberships m where m.organization_id=old.id and m.state='ACTIVE' and m.user_id<>app_private.actor_id())
   or exists(select 1 from app.organization_invitations i where i.organization_id=old.id and i.accepted_at is null and i.revoked_at is null and i.expires_at>statement_timestamp())
   or exists(select 1 from app.invitation_deliveries d where d.organization_id=old.id and d.state in ('QUEUED','RUNNING','UNCERTAIN'))
   or exists(select 1 from app.courses c where c.organization_id=old.id and c.archived_at is null)
   or exists(select 1 from app.classes c where c.organization_id=old.id and c.archived_at is null)
   or exists(select 1 from app.exercises e where e.organization_id=old.id and e.archived_at is null)
   or exists(select 1 from app.concept_tags t where t.organization_id=old.id and t.archived_at is null)
   then raise exception using errcode='P0001',message='DEPENDENCIES_ACTIVE'; end if;
   new.archived_at:=statement_timestamp();
  end if;
  new.revision:=old.revision+1; new.updated_at:=statement_timestamp();
 end if;
 return new;
end $$;
reset role;
do $$ declare r regprocedure; begin
 for r in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'
 and (p.proname like 'academic_%' or p.proname in ('lock_academic_organization','resolve_join_code','enrollment_replay','guard_academic_resource','guard_academic_version','assert_exercise_definition','assert_academic_current_version','guard_activity_item','guard_class_membership','count_join_code_use')) loop
  execute format('alter function %s owner to alunza_identity',r);
 end loop;
end $$;
set local role alunza_identity;
do $$ declare r regprocedure; begin
 for r in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'
 and (p.proname like 'academic_%' or p.proname in ('lock_academic_organization','resolve_join_code','enrollment_replay','guard_academic_resource','guard_academic_version','assert_exercise_definition','assert_academic_current_version','guard_activity_item','guard_class_membership','count_join_code_use')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',r);
  execute format('grant execute on function %s to alunza_identity',r);
  if r::text like 'app_private.academic_%' or r::text like 'app_private.lock_academic_organization%' or r::text like 'app_private.resolve_join_code%' or r::text like 'app_private.enrollment_replay%' then execute format('grant execute on function %s to alunza_app',r); end if;
 end loop;
end $$;
reset role;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
