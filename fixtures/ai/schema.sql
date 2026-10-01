-- IMP-00.07 technical dictionary, TEST ONLY, never a business migration.
-- scope_grants: explicit fictitious (actor,org,class,activity) grants; all UUID,
-- composite PK, active boolean. No implicit ADMIN academic privileges.
-- sources: fixed source/version/generation UUIDs, composite scope FK through
-- chunks; nullable activity means class-wide. READY+active+visible+not archived
-- is the only readable state. configuration_id and dimensions bind vectors.
-- chunks: immutable fixture text/localizer/vector, unique source+chunk index;
-- composite FK prevents changing source/version/generation/scope/dimensions.
-- Owned by bootstrap; ordinary alunza_app has SELECT only, no ownership/bypass.
-- Cleanup drops ONLY this schema on the test project after all clients close.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO alunza_app;
CREATE SCHEMA rag_probe;
REVOKE ALL ON SCHEMA rag_probe FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA rag_probe TO alunza_app;
CREATE TABLE rag_probe.scope_grants (
  user_id uuid NOT NULL REFERENCES app.profiles(id),
  organization_id uuid NOT NULL REFERENCES app.organizations(id),
  class_id uuid NOT NULL, activity_id uuid NOT NULL, active boolean NOT NULL,
  PRIMARY KEY(user_id,organization_id,class_id,activity_id)
);
CREATE TABLE rag_probe.sources (
  id uuid PRIMARY KEY, source_version_id uuid NOT NULL, generation_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES app.organizations(id), class_id uuid NOT NULL,
  activity_id uuid, visible boolean NOT NULL, archived boolean NOT NULL,
  index_status text NOT NULL CHECK(index_status IN ('UPLOADED','PROCESSING','READY','FAILED','ARCHIVED')),
  active_generation boolean NOT NULL,
  configuration_id text NOT NULL, dimensions integer NOT NULL CHECK(dimensions BETWEEN 1 AND 16000),
  UNIQUE(id,source_version_id,generation_id,organization_id,class_id,configuration_id,dimensions)
);
CREATE TABLE rag_probe.chunks (
  id uuid PRIMARY KEY, source_id uuid NOT NULL, source_version_id uuid NOT NULL,
  generation_id uuid NOT NULL, organization_id uuid NOT NULL, class_id uuid NOT NULL,
  configuration_id text NOT NULL, dimensions integer NOT NULL,
  chunk_index integer NOT NULL CHECK(chunk_index>=0), text text NOT NULL CHECK(length(text)>0),
  locator text NOT NULL CHECK(length(locator)>0), embedding extensions.vector NOT NULL,
  CHECK(extensions.vector_dims(embedding)=dimensions),
  UNIQUE(source_id,chunk_index),
  FOREIGN KEY(source_id,source_version_id,generation_id,organization_id,class_id,configuration_id,dimensions)
    REFERENCES rag_probe.sources(id,source_version_id,generation_id,organization_id,class_id,configuration_id,dimensions)
);
REVOKE ALL ON ALL TABLES IN SCHEMA rag_probe FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA rag_probe TO alunza_app;
ALTER TABLE rag_probe.scope_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_probe.scope_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE rag_probe.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_probe.sources FORCE ROW LEVEL SECURITY;
ALTER TABLE rag_probe.chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_probe.chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY own_fixture_grants ON rag_probe.scope_grants FOR SELECT TO alunza_app
USING(user_id=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY authorized_fixture_sources ON rag_probe.sources FOR SELECT TO alunza_app USING (
  organization_id=nullif(current_setting('app.organization_id',true),'')::uuid
  AND class_id=nullif(current_setting('app.class_id',true),'')::uuid
  AND (activity_id IS NULL OR activity_id=nullif(current_setting('app.activity_id',true),'')::uuid)
  AND visible AND NOT archived AND index_status='READY' AND active_generation
  AND EXISTS(SELECT 1 FROM rag_probe.scope_grants g JOIN app.profiles p ON p.id=g.user_id
    JOIN app.organization_memberships m ON m.user_id=g.user_id AND m.organization_id=g.organization_id
    JOIN app.organizations o ON o.id=g.organization_id
    WHERE g.organization_id=sources.organization_id AND g.class_id=sources.class_id
      AND g.activity_id=nullif(current_setting('app.activity_id',true),'')::uuid
      AND g.user_id=nullif(current_setting('app.actor_id',true),'')::uuid
      AND g.active AND p.account_state='ACTIVE' AND m.state='ACTIVE' AND o.archived_at IS NULL)
);
CREATE POLICY authorized_fixture_chunks ON rag_probe.chunks FOR SELECT TO alunza_app USING (
  EXISTS(SELECT 1 FROM rag_probe.sources s WHERE s.id=chunks.source_id)
);
