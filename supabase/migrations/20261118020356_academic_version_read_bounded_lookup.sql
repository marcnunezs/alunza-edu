-- Keep the existing authorization rules, function identity and EXECUTE grants.
-- Resolve the version first so the assignment branch only evaluates activities
-- for that organization/version instead of an OR-expanded authorization subplan.
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
set local role alunza_identity;

CREATE OR REPLACE FUNCTION app_private.academic_version_read(ver uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $candidate$
DECLARE version_exercise uuid; version_organization uuid;
BEGIN
 SELECT v.exercise_id,v.organization_id INTO version_exercise,version_organization
 FROM app.exercise_versions v WHERE v.id=ver;
 IF NOT FOUND THEN RETURN false; END IF;
 IF app_private.academic_exercise_read(version_exercise) THEN RETURN true; END IF;
 RETURN EXISTS(SELECT 1 FROM app.activity_exercises ae
  WHERE ae.organization_id=version_organization AND ae.exercise_version_id=ver
   AND app_private.academic_activity_read(ae.activity_id));
END $candidate$;

reset role;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
