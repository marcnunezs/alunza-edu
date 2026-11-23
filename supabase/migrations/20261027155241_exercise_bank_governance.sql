-- IMP-06.02: administrative governance of an existing exercise identity.
-- Existing grants, history guards, organization serialization, fixed-version
-- foreign keys and visibility enum remain in force. No pedagogical read policy
-- or teacher authorship helper is widened.
create function app_private.guard_exercise_governance_owner() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 -- A former owner may later become inactive. Preserve that historical identity
 -- when changing visibility, creating a version or archiving the exercise.
 if new.owner_id is distinct from old.owner_id then
  if not exists (
   select 1 from app.organization_memberships m
   join app.profiles p on p.id=m.user_id
   where m.organization_id=new.organization_id and m.user_id=new.owner_id
    and m.role in ('ADMIN','TEACHER') and m.state='ACTIVE'
    and p.account_state='ACTIVE'
  ) then
   raise exception using errcode='23514',message='EXERCISE_OWNER_INVALID';
  end if;
 end if;
 return new;
end $$;

create trigger guard_exercise_governance_owner before update of owner_id on app.exercises
 for each row execute function app_private.guard_exercise_governance_owner();

-- The HTTP service still authorizes the actor and serializes by organization.
-- RLS independently permits an ACTIVE ADMIN to append a complete definition,
-- never to update the version, its concepts or its tests. Authors retain their
-- original permission and ADMIN gains no activity/student access.
alter policy versions_insert on app.exercise_versions with check (
 organization_id=app_private.organization_id()
 and created_by=app_private.actor_id()
 and (app_private.academic_exercise_author(exercise_id)
  or app_private.academic_role(organization_id,array['ADMIN']))
);
alter policy links_insert on app.exercise_version_concepts with check (
 organization_id=app_private.organization_id()
 and exists(select 1 from app.exercise_versions v
  where v.id=exercise_version_id and v.organization_id=exercise_version_concepts.organization_id
   and (app_private.academic_exercise_author(v.exercise_id)
    or app_private.academic_role(v.organization_id,array['ADMIN'])))
);
alter policy tests_insert on app_private.exercise_tests with check (
 organization_id=app_private.organization_id()
 and exists(select 1 from app.exercise_versions v
  where v.id=exercise_version_id and v.organization_id=exercise_tests.organization_id
   and (app_private.academic_exercise_author(v.exercise_id)
    or app_private.academic_role(v.organization_id,array['ADMIN'])))
);

grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
alter function app_private.guard_exercise_governance_owner() owner to alunza_identity;
set role alunza_identity;
revoke all on function app_private.guard_exercise_governance_owner() from public,anon,authenticated,service_role,alunza_app;
reset role;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
