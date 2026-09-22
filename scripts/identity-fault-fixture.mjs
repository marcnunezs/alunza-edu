import pg from 'pg';

function assertTestDatabase(state) {
  let database;
  try {
    database = new URL(state?.migrationUrl);
  } catch {
    throw new Error('El fixture de fallos necesita la base local de pruebas.');
  }
  if (
    state.projectId !== 'alunza-edu-foundation-test' ||
    !['postgresql:', 'postgres:'].includes(database.protocol) ||
    database.hostname !== '127.0.0.1' ||
    database.port !== '16422' ||
    database.pathname !== '/postgres' ||
    database.username !== 'postgres'
  )
    throw new Error(
      'El fixture de fallos solo admite la base local de pruebas.',
    );
}

async function alterFixture(state, statement) {
  assertTestDatabase(state);
  const client = new pg.Client({
    connectionString: state.migrationUrl,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    const actor = await client.query('SELECT current_user AS role');
    if (actor.rows[0]?.role !== 'postgres')
      throw new Error(
        'El fixture de fallos requiere su propietario de pruebas.',
      );
    await client.query(statement);
    await client.query('COMMIT');
  } catch {
    // Never include database connection details in the integration report.
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original connection may already have closed.
    }
    throw new Error(
      'No se pudo preparar o retirar el fixture local de fallos.',
    );
  } finally {
    await client.end();
  }
}

/** Install once while the integration API is stopped; tests toggle rows only. */
export async function installIdentityFaultFixture(state) {
  await alterFixture(
    state,
    `CREATE SCHEMA identity_test_faults AUTHORIZATION postgres;
     REVOKE ALL ON SCHEMA identity_test_faults
       FROM PUBLIC, anon, authenticated, service_role, alunza_app, alunza_identity;
     CREATE TABLE identity_test_faults.flags (
       org_id uuid PRIMARY KEY,
       action text,
       result text
     );
     ALTER TABLE identity_test_faults.flags OWNER TO postgres;
     REVOKE ALL ON TABLE identity_test_faults.flags
       FROM PUBLIC, anon, authenticated, service_role, alunza_app, alunza_identity;
     CREATE FUNCTION identity_test_faults.fail_audit() RETURNS trigger
       LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
     BEGIN
       IF EXISTS (
         SELECT 1 FROM identity_test_faults.flags AS fault
         WHERE fault.org_id = NEW.organization_id
           AND (fault.action IS NULL OR fault.action = NEW.action)
           AND (fault.result IS NULL OR fault.result = NEW.result)
       ) THEN
         RAISE EXCEPTION 'IDENTITY_TEST_AUDIT_FAILURE';
       END IF;
       RETURN NEW;
     END;
     $$;
     ALTER FUNCTION identity_test_faults.fail_audit() OWNER TO postgres;
     REVOKE ALL ON FUNCTION identity_test_faults.fail_audit()
       FROM PUBLIC, anon, authenticated, service_role, alunza_app, alunza_identity;
     CREATE TRIGGER identity_test_audit_failure BEFORE INSERT ON app.audit_events
       FOR EACH ROW EXECUTE FUNCTION identity_test_faults.fail_audit();`,
  );
}

/** Remove only after the integration API has stopped, including on failure. */
export async function removeIdentityFaultFixture(state) {
  await alterFixture(
    state,
    `DROP TRIGGER IF EXISTS identity_test_audit_failure ON app.audit_events;
     DROP FUNCTION IF EXISTS identity_test_faults.fail_audit();
     DROP TABLE IF EXISTS identity_test_faults.flags;
     DROP SCHEMA IF EXISTS identity_test_faults;`,
  );
}
