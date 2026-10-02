import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { applicationUrl } from './local.mjs';
import { assertRuntimeTarget, testTarget } from './local-target.mjs';

class HelpRecoveryAssertion extends Error {}
function check(condition, message) {
  if (!condition) throw new HelpRecoveryAssertion(message);
}
async function until(action, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await action();
    if (value) return value;
    await delay(50);
  }
  throw new HelpRecoveryAssertion(message);
}

// A running job or a DISPATCHED help call alone does not prove that the intended
// failure boundary was reached. Sequence increments survive the trigger's
// rollback; the ledger distinguishes a completed result from real uncertainty.
export function helpRecoveryBoundaryReached({
  scenario,
  row,
  checkpoint,
  ledger,
  faultHits,
  baseline,
}) {
  if (
    row?.lifecycle_status !== 'RUNNING' ||
    !Number.isSafeInteger(faultHits) ||
    !Number.isSafeInteger(baseline) ||
    faultHits <= baseline
  )
    return false;
  if (
    checkpoint.filter((call) => call.state === 'COMPLETED').length !==
    scenario.completed
  )
    return false;
  if (scenario.operation === 'UPDATE') {
    const phase = scenario.phase === 'LEDGER' ? 'EMBEDDING' : scenario.phase;
    if (
      !checkpoint.some(
        (call) => call.phase === phase && call.state === 'DISPATCHED',
      )
    )
      return false;
    if (ledger.length !== 1 || ledger[0].phase !== phase) return false;
    return scenario.phase === 'LEDGER'
      ? ledger[0].state === 'DISPATCHED' && ledger[0].result === null
      : ledger[0].state === 'COMPLETED' && ledger[0].result != null;
  }
  return (
    ledger.length === scenario.completed &&
    ledger.every(
      (receipt) => receipt.state === 'COMPLETED' && receipt.result != null,
    )
  );
}

/** Physical PostgreSQL outage. Stack lifecycle remains exclusively owned by
 * the caller; this helper never derives Docker names or starts other services. */
export async function verifyHelpAdmissionOutage({
  state,
  stopDatabase,
  startDatabase,
}) {
  assertRuntimeTarget(state, testTarget);
  check(
    typeof stopDatabase === 'function' && typeof startDatabase === 'function',
    'Faltan los controles del propietario TEST para la caída de PostgreSQL.',
  );
  const fixture = JSON.parse(
    await readFile(
      new URL('../fixtures/foundation/identity.json', import.meta.url),
      'utf8',
    ),
  );
  const student = fixture.users[2];
  const auth = createClient(state.authUrl, state.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const login = await auth.auth.signInWithPassword({
    email: student.email,
    password: state.fixturePassword,
  });
  check(
    !login.error && login.data.session,
    'No se autenticó el estudiante de caída PostgreSQL.',
  );
  const token = login.data.session.access_token;
  let stopped = false;
  const query = async (sql, values) => {
    const client = new pg.Client({
      connectionString: state.migrationUrl,
      connectionTimeoutMillis: 3000,
      statement_timeout: 5000,
    });
    try {
      await client.connect();
      return await client.query(sql, values);
    } finally {
      await client.end();
    }
  };
  const request = async (path, body, key) => {
    const response = await fetch(`${testTarget.apiUrl}/api/v1${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body
          ? { 'Content-Type': 'application/json', 'Idempotency-Key': key }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(45000),
    });
    const payload = await response.json();
    return { status: response.status, data: payload.data };
  };
  try {
    const scope = (
      await query(
        `SELECT act.id AS activity,ae.id AS assignment,ae.exercise_version_id AS version
      FROM app.organizations o JOIN app.classes c ON c.organization_id=o.id
      JOIN app.class_memberships cm ON cm.class_id=c.id AND cm.user_id=$1 AND cm.ended_at IS NULL
      JOIN app.activities act ON act.class_id=c.id AND act.state='PUBLISHED'
      JOIN app.activity_exercises ae ON ae.activity_id=act.id
      WHERE o.code LIKE 'HELP-%' AND o.archived_at IS NULL AND c.archived_at IS NULL
      AND EXISTS(SELECT 1 FROM app.sources s WHERE s.class_id=c.id AND s.current_version_id IS NOT NULL AND s.visibility='VISIBLE' AND s.archived_at IS NULL)
      ORDER BY o.id LIMIT 1`,
        [student.id],
      )
    ).rows[0];
    check(scope, 'Falta una clase ficticia activa para la caída PostgreSQL.');
    const submitted = await request(
      `/activities/${scope.activity}/exercises/${scope.assignment}/attempts`,
      {
        exerciseVersionId: scope.version,
        code: 'module.exports.solve=(a,b)=>a-b;',
      },
      randomUUID(),
    );
    check(
      submitted.status === 201,
      'No se confirmó el intento antes de apagar PostgreSQL.',
    );
    const id = submitted.data.attemptId;
    const key = randomUUID();
    stopped = true;
    await stopDatabase();
    const rejected = await request(
      `/attempts/${id}/feedback-requests`,
      { kind: 'HINT' },
      key,
    );
    check(
      rejected.status === 503,
      'PostgreSQL apagado no produjo 503 al pedir ayuda.',
    );
    check(!rejected.data, 'PostgreSQL apagado devolvió una admisión de ayuda.');
    await startDatabase();
    stopped = false;
    await until(
      async () => {
        try {
          return (
            await fetch(`${testTarget.apiUrl}/health/ready`, {
              signal: AbortSignal.timeout(3000),
            })
          ).ok;
        } catch {
          return false;
        }
      },
      'La API no recuperó PostgreSQL.',
      60000,
    );
    const count = async (table) =>
      (
        await query(
          `SELECT count(*)::int n FROM ${table} WHERE attempt_id=$1`,
          [id],
        )
      ).rows[0].n;
    check(
      (await count('app.feedback_requests')) === 0 &&
        (await count('app_private.help_events')) === 0,
      'La caída PostgreSQL conservó datos parciales de admisión.',
    );
    const accepted = await request(
      `/attempts/${id}/feedback-requests`,
      { kind: 'HINT' },
      key,
    );
    check(
      accepted.status === 202,
      'La misma clave no fue recuperable después de restaurar PostgreSQL.',
    );
    const feedbackId = await until(
      async () =>
        (await request(`/feedback-requests/${accepted.data.id}`)).data
          ?.feedbackId,
      'La ayuda no terminó tras restaurar PostgreSQL.',
    );
    const feedback = await request(`/feedback/${feedbackId}`);
    check(
      feedback.status === 200 && feedback.data.help.status === 'SUPPORTED',
      'La ayuda recuperada no conservó su resultado autorizado.',
    );
    check(
      (await count('app.feedback_requests')) === 1 &&
        (await count('app_private.help_events')) === 1,
      'La recuperación duplicó solicitud o eventos sin ACK.',
    );
    return {
      status: 'passed',
      scenario: 'physical-postgresql-admission-outage',
      unavailableStatus: 503,
      acceptedWhileDown: false,
      sameKeyRecovered: true,
      requests: 1,
      eventsWithoutAck: 1,
    };
  } catch (error) {
    if (error instanceof HelpRecoveryAssertion) throw error;
    // eslint-disable-next-line preserve-caught-error -- Do not expose connection/auth details in shared evidence.
    throw new Error('Falló la frontera de admisión con PostgreSQL detenido.');
  } finally {
    if (stopped) await startDatabase();
    await auth.auth.signOut({ scope: 'local' });
  }
}

/** Real API restarts inside the caller's exclusively owned TEST stack. Provider
 * calls use the explicit local oracle; this does not certify Azure recovery. */
export async function verifyHelpRecovery({ ctx, state, api }) {
  assertRuntimeTarget(state, testTarget);
  const address = new URL(state.migrationUrl);
  check(
    ctx.projectId === testTarget.projectId &&
      ctx.apiPort === testTarget.apiPort &&
      state.projectId === ctx.projectId &&
      address.hostname === '127.0.0.1' &&
      address.port === String(testTarget.dbPort) &&
      address.username === 'postgres',
    'La recuperación de ayuda exige el entorno TEST ya adquirido.',
  );
  const fixture = JSON.parse(
    await readFile(
      new URL('../fixtures/foundation/identity.json', import.meta.url),
      'utf8',
    ),
  );
  const student = fixture.users[2];
  const auth = createClient(state.authUrl, state.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const login = await auth.auth.signInWithPassword({
    email: student.email,
    password: state.fixturePassword,
  });
  check(
    !login.error && login.data.session,
    'No se autenticó el estudiante ficticio de recuperación.',
  );
  const token = login.data.session.access_token;
  const db = new pg.Pool({
    connectionString: state.migrationUrl,
    max: 2,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  const ordinary = new pg.Pool({
    connectionString: applicationUrl(ctx, state),
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
  });
  let installed = false,
    stopped = false;
  const outcomes = [];
  async function request(path, { body, key } = {}) {
    const response = await fetch(`${testTarget.apiUrl}/api/v1${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(45000),
    });
    const payload = await response.json();
    return {
      status: response.status,
      data: payload.data,
      errorCode:
        typeof payload.error?.code === 'string' &&
        /^[A-Z0-9_]{1,80}$/.test(payload.error.code)
          ? payload.error.code
          : null,
    };
  }
  const calls = async (id) =>
    (
      await db.query(
        'SELECT phase,state,dispatched_at,completed_at,result,usage FROM app_private.help_calls WHERE request_id=$1 ORDER BY phase',
        [id],
      )
    ).rows;
  const receipts = async (id) =>
    (
      await db.query(
        'SELECT id,phase,state,result,dispatched_at,settled_at FROM app_private.ai_call_receipts WHERE help_request_id=$1 ORDER BY phase',
        [id],
      )
    ).rows;
  const faultHits = async () =>
    Object.fromEntries(
      (
        await db.query(`
      SELECT 'ADMISSION' kind,CASE WHEN is_called THEN last_value ELSE 0 END::int hits FROM help_recovery_faults.admission_hits
      UNION ALL SELECT 'CHECKPOINT',CASE WHEN is_called THEN last_value ELSE 0 END::int FROM help_recovery_faults.checkpoint_hits
      UNION ALL SELECT 'PUBLICATION',CASE WHEN is_called THEN last_value ELSE 0 END::int FROM help_recovery_faults.publication_hits
      UNION ALL SELECT 'LEDGER',CASE WHEN is_called THEN last_value ELSE 0 END::int FROM help_recovery_faults.ledger_hits
    `)
      ).rows.map((row) => [row.kind, row.hits]),
    );
  try {
    // Reuse a completed, isolated HTTP fixture with live student membership and
    // indexed material. The canonical demo corpus and its history are untouched.
    const scope = (
      await db.query(
        `SELECT o.id AS org,act.id AS activity,ae.id AS assignment,ae.exercise_version_id AS version
      FROM app.organizations o JOIN app.classes c ON c.organization_id=o.id
      JOIN app.class_memberships cm ON cm.class_id=c.id AND cm.user_id=$1 AND cm.ended_at IS NULL
      JOIN app.activities act ON act.class_id=c.id AND act.state='PUBLISHED'
      JOIN app.activity_exercises ae ON ae.activity_id=act.id
      WHERE o.code LIKE 'HELP-%' AND o.archived_at IS NULL AND c.archived_at IS NULL
      AND EXISTS(SELECT 1 FROM app.sources s WHERE s.class_id=c.id AND s.current_version_id IS NOT NULL AND s.visibility='VISIBLE' AND s.archived_at IS NULL)
      ORDER BY o.id LIMIT 1`,
        [student.id],
      )
    ).rows[0];
    check(
      scope,
      'Falta un fixture de ayuda completo para comprobar recuperación.',
    );
    await db.query(`CREATE SCHEMA help_recovery_faults;
      CREATE TABLE help_recovery_faults.flags(attempt_id uuid PRIMARY KEY,phase text NOT NULL,operation_kind text NOT NULL);
      CREATE SEQUENCE help_recovery_faults.admission_hits;
      CREATE SEQUENCE help_recovery_faults.checkpoint_hits;
      CREATE SEQUENCE help_recovery_faults.publication_hits;
      CREATE SEQUENCE help_recovery_faults.ledger_hits;
      CREATE FUNCTION help_recovery_faults.block_checkpoint() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
      BEGIN
        IF EXISTS(SELECT 1 FROM help_recovery_faults.flags f JOIN app.feedback_requests r ON r.attempt_id=f.attempt_id
          WHERE r.id=NEW.request_id AND f.phase=NEW.phase AND f.operation_kind=TG_OP)
        THEN
          PERFORM nextval('help_recovery_faults.checkpoint_hits');
          RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='CONTROLLED_HELP_CHECKPOINT_FAILURE';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER help_recovery_checkpoint_failure BEFORE INSERT OR UPDATE ON app_private.help_calls
        FOR EACH ROW EXECUTE FUNCTION help_recovery_faults.block_checkpoint();
      CREATE FUNCTION help_recovery_faults.block_admission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
      BEGIN
        IF EXISTS(SELECT 1 FROM help_recovery_faults.flags WHERE attempt_id=NEW.attempt_id AND phase='ADMISSION')
        -- query_canceled exercises unavailable persistence; serialization_failure
        -- (40001) is deliberately normalized as retryable contention HTTP409.
        THEN
          PERFORM nextval('help_recovery_faults.admission_hits');
          RAISE EXCEPTION USING ERRCODE='57014',MESSAGE='CONTROLLED_HELP_ADMISSION_FAILURE';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER help_recovery_admission_failure BEFORE INSERT ON app.feedback_requests
        FOR EACH ROW EXECUTE FUNCTION help_recovery_faults.block_admission();
      CREATE FUNCTION help_recovery_faults.block_publication() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
      BEGIN
        IF EXISTS(SELECT 1 FROM help_recovery_faults.flags f JOIN app.feedback_requests r ON r.attempt_id=f.attempt_id
          WHERE r.id=NEW.request_id AND f.phase IN('PUBLICATION','LEDGER'))
        THEN
          PERFORM nextval('help_recovery_faults.publication_hits');
          RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='CONTROLLED_HELP_PUBLICATION_FAILURE';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER help_recovery_publication_failure BEFORE INSERT ON app.feedbacks
        FOR EACH ROW EXECUTE FUNCTION help_recovery_faults.block_publication();
      CREATE FUNCTION help_recovery_faults.block_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
      BEGIN
        IF NEW.owner_kind='HELP' AND NEW.phase='EMBEDDING' AND NEW.state='COMPLETED'
          AND EXISTS(SELECT 1 FROM help_recovery_faults.flags f JOIN app.feedback_requests r ON r.attempt_id=f.attempt_id
          WHERE r.id=NEW.help_request_id AND f.phase='LEDGER')
        THEN
          PERFORM nextval('help_recovery_faults.ledger_hits');
          RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='CONTROLLED_HELP_LEDGER_FAILURE';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER help_recovery_ledger_failure BEFORE UPDATE ON app_private.ai_call_receipts
        FOR EACH ROW EXECUTE FUNCTION help_recovery_faults.block_ledger();`);
    installed = true;
    const admissionAttempt = await request(
      `/activities/${scope.activity}/exercises/${scope.assignment}/attempts`,
      {
        key: randomUUID(),
        body: {
          exerciseVersionId: scope.version,
          code: 'module.exports.solve=(a,b)=>a-b;',
        },
      },
    );
    check(
      admissionAttempt.status === 201,
      'No se confirmó el intento de admisión.',
    );
    const admissionId = admissionAttempt.data.attemptId;
    const admissionKey = randomUUID();
    const admissionBaseline = (await faultHits()).ADMISSION;
    await db.query(
      "INSERT INTO help_recovery_faults.flags VALUES($1,'ADMISSION','INSERT')",
      [admissionId],
    );
    const rejectedAdmission = await request(
      `/attempts/${admissionId}/feedback-requests`,
      { key: admissionKey, body: { kind: 'HINT' } },
    );
    check(
      rejectedAdmission.status === 503 &&
        rejectedAdmission.errorCode === 'PERSISTENCE_UNAVAILABLE',
      `El fallo PostgreSQL de admisión no produjo indisponibilidad explícita (HTTP ${rejectedAdmission.status}, ${rejectedAdmission.errorCode ?? 'SIN_CODIGO'}).`,
    );
    const admissionFaultCount =
      (await faultHits()).ADMISSION - admissionBaseline;
    check(
      admissionFaultCount > 0,
      'No se alcanzó el fallo SQL de admisión controlado.',
    );
    const uncommitted = (
      await db.query(
        'SELECT count(*)::int n FROM app.feedback_requests WHERE attempt_id=$1',
        [admissionId],
      )
    ).rows[0].n;
    check(
      uncommitted === 0,
      'Una admisión rechazada conservó una solicitud parcial.',
    );
    check(
      (
        await db.query(
          'SELECT count(*)::int n FROM app_private.help_events WHERE attempt_id=$1',
          [admissionId],
        )
      ).rows[0].n === 0,
      'Una admisión rechazada produjo eventos de ayuda.',
    );
    await db.query(
      'DELETE FROM help_recovery_faults.flags WHERE attempt_id=$1',
      [admissionId],
    );
    const admitted = await request(
      `/attempts/${admissionId}/feedback-requests`,
      { key: admissionKey, body: { kind: 'HINT' } },
    );
    check(
      admitted.status === 202,
      'La misma clave no pudo recuperarse tras rollback de admisión.',
    );
    await until(async () => {
      const current = await request(`/feedback-requests/${admitted.data.id}`);
      return current.data?.feedbackId;
    }, 'La admisión recuperada no completó.');
    check(
      (
        await db.query(
          'SELECT count(*)::int n FROM app.feedback_requests WHERE attempt_id=$1',
          [admissionId],
        )
      ).rows[0].n === 1,
      'El replay de admisión duplicó una solicitud.',
    );
    outcomes.push({
      scenario: 'database-admission-rollback',
      rejectedStatus: 503,
      partialRequests: 0,
      partialEvents: 0,
      sameKeyRecovered: true,
      faultCount: admissionFaultCount,
    });
    for (const scenario of [
      {
        name: 'before-first-dispatch',
        phase: 'EMBEDDING',
        operation: 'INSERT',
        completed: 0,
        expected: 'SUPPORTED',
      },
      {
        name: 'checkpoint-recovers-completed-ledger',
        phase: 'EMBEDDING',
        operation: 'UPDATE',
        completed: 0,
        expected: 'SUPPORTED',
      },
      {
        name: 'review-resumes-saved-candidate',
        phase: 'REVIEW',
        operation: 'INSERT',
        completed: 2,
        expected: 'SUPPORTED',
      },
      {
        name: 'publication-resumes-completed-review',
        phase: 'PUBLICATION',
        operation: 'INSERT',
        completed: 3,
        expected: 'SUPPORTED',
      },
      {
        name: 'uncertain-provider-result-ledger',
        phase: 'LEDGER',
        operation: 'UPDATE',
        completed: 0,
        expected: 'PROVIDER_UNAVAILABLE',
      },
    ]) {
      const submitted = await request(
        `/activities/${scope.activity}/exercises/${scope.assignment}/attempts`,
        {
          key: randomUUID(),
          body: {
            exerciseVersionId: scope.version,
            code: `module.exports.solve=(a,b)=>a-b;\n// help-recovery-${randomUUID()}`,
          },
        },
      );
      check(
        submitted.status === 201,
        'No se confirmó el intento real previo a recuperación.',
      );
      const attemptId = submitted.data.attemptId;
      const faultKind = ['PUBLICATION', 'LEDGER'].includes(scenario.phase)
        ? scenario.phase
        : 'CHECKPOINT';
      const baseline = (await faultHits())[faultKind];
      await db.query(
        'INSERT INTO help_recovery_faults.flags VALUES($1,$2,$3)',
        [attemptId, scenario.phase, scenario.operation],
      );
      const key = randomUUID();
      const accepted = await request(
        `/attempts/${attemptId}/feedback-requests`,
        { key, body: { kind: 'HINT' } },
      );
      check(
        accepted.status === 202,
        'No se reservó durablemente la ayuda de recuperación.',
      );
      const id = accepted.data.id;
      const blocked = await until(
        async () => {
          const [requestRows, checkpoint, ledger, hits] = await Promise.all([
            db.query('SELECT * FROM app.feedback_requests WHERE id=$1', [id]),
            calls(id),
            receipts(id),
            faultHits(),
          ]);
          const row = requestRows.rows[0];
          return helpRecoveryBoundaryReached({
            scenario,
            row,
            checkpoint,
            ledger,
            faultHits: hits[faultKind],
            baseline,
          })
            ? { ...row, faultCount: hits[faultKind] - baseline }
            : null;
        },
        'No se alcanzó la frontera de llamada controlada.',
        7000,
      );
      await api.stop();
      stopped = true;
      const before = await calls(id);
      const ledgerBefore = await receipts(id);
      if (scenario.phase === 'LEDGER')
        check(
          ledgerBefore.length === 1 &&
            ledgerBefore[0].state === 'DISPATCHED' &&
            ledgerBefore[0].result === null,
          'El escenario incierto ya tenía resultado durable o repitió el despacho.',
        );
      if (scenario.name === 'checkpoint-recovers-completed-ledger')
        check(
          ledgerBefore.length === 1 &&
            ledgerBefore[0].state === 'COMPLETED' &&
            ledgerBefore[0].result !== null,
          'El checkpoint perdido no tenía resultado recuperable en ledger.',
        );
      const inputBefore = (
        await db.query(
          'SELECT input,metadata,context_hash FROM app_private.help_inputs WHERE request_id=$1',
          [id],
        )
      ).rows[0];
      check(
        before.filter((call) => call.state === 'COMPLETED').length ===
          scenario.completed,
        'El checkpoint confirmado cambió antes del reinicio.',
      );
      await db.query(
        'DELETE FROM help_recovery_faults.flags WHERE attempt_id=$1',
        [attemptId],
      );
      // Move only the lease; the original admission and 15s deadline are retained.
      await db.query(
        "UPDATE app.feedback_requests SET lease_until=clock_timestamp()-interval '1 millisecond' WHERE id=$1",
        [id],
      );
      const fenced = await ordinary.query(
        "SELECT app_private.help_renew($1,$2) renewed,app_private.help_complete_call($1,$2,'EMBEDDING','{}') completed",
        [id, blocked.lease_token],
      );
      check(
        !fenced.rows[0].renewed && !fenced.rows[0].completed,
        'Un trabajador con lease vencido modificó la solicitud.',
      );
      await api.start(`${testTarget.apiUrl}/health/ready`);
      stopped = false;
      const finished = await until(async () => {
        const current = await request(`/feedback-requests/${id}`);
        check(
          current.status === 200,
          'No se pudo recuperar la solicitud propia.',
        );
        return current.data.feedbackId ? current.data : null;
      }, 'La solicitud recuperada no llegó a un resultado durable.');
      check(
        finished.deadlineAt === accepted.data.deadlineAt,
        'Un reinicio amplió el plazo absoluto de ayuda.',
      );
      const feedback = await request(`/feedback/${finished.feedbackId}`);
      check(
        feedback.status === 200 &&
          feedback.data.help.status === scenario.expected,
        'La frontera recuperada no produjo el resultado esperado.',
      );
      const replay = await request(`/attempts/${attemptId}/feedback-requests`, {
        key,
        body: { kind: 'HINT' },
      });
      check(
        replay.status === 202 && replay.data.id === id,
        'La recuperación duplicó una solicitud idempotente.',
      );
      const after = await calls(id);
      const ledgerAfter = await receipts(id);
      for (const receipt of ledgerBefore)
        check(
          JSON.stringify(ledgerAfter.find((row) => row.id === receipt.id)) ===
            JSON.stringify(receipt),
          'Se modificó o repitió una llamada registrada en el ledger.',
        );
      check(
        ledgerAfter.length === (scenario.expected === 'SUPPORTED' ? 3 : 1),
        'La recuperación despachó llamadas adicionales en el ledger.',
      );
      for (const saved of before.filter((call) => call.state === 'COMPLETED'))
        check(
          JSON.stringify(after.find((call) => call.phase === saved.phase)) ===
            JSON.stringify(saved),
          'Se repitió o alteró una llamada que ya tenía receipt durable.',
        );
      if (scenario.expected === 'SUPPORTED')
        check(
          after.length === 3 &&
            after.every((call) => call.state === 'COMPLETED'),
          'Faltan receipts completos de embedding, generación y revisión.',
        );
      else
        check(
          after.length === 1 && after[0].state === 'DISPATCHED',
          'Una llamada incierta se volvió a despachar o habilitó generación.',
        );
      if (inputBefore) {
        const saved = (
          await db.query(
            'SELECT input,metadata,context_hash FROM app_private.help_inputs WHERE request_id=$1',
            [id],
          )
        ).rows[0];
        check(
          JSON.stringify(saved) === JSON.stringify(inputBefore),
          'La revisión usó otro contexto tras el reinicio.',
        );
      }
      const delivery = (
        await db.query(
          "SELECT count(*)::int n FROM app_private.help_events WHERE request_id=$1 AND event_type<>'HELP_REQUESTED'",
          [id],
        )
      ).rows[0].n;
      check(
        delivery === 0,
        'La recuperación contó una entrega sin render y ACK.',
      );
      const unique = (
        await db.query(
          'SELECT count(*)::int n FROM app.feedbacks WHERE request_id=$1',
          [id],
        )
      ).rows[0].n;
      check(
        unique === 1,
        'Se publicaron dos respuestas para la misma solicitud.',
      );
      outcomes.push({
        scenario: scenario.name,
        result: scenario.expected,
        completedReceipts: after.filter((call) => call.state === 'COMPLETED')
          .length,
        deadlinePreserved: true,
        oneFeedback: true,
        noDeliveryWithoutAcknowledgement: true,
        ledgerCalls: ledgerAfter.length,
        faultCount: blocked.faultCount,
      });
      // This scenario has ended; age only its completed test fixture so the
      // independent physical-outage check does not collide with the global
      // student's one-minute quota. Never alter a live request or its deadline.
      await db.query(
        "UPDATE app.feedback_requests SET requested_at=least(requested_at,clock_timestamp()-interval '61 seconds') WHERE id=$1 AND lifecycle_status='SUCCEEDED'",
        [id],
      );
    }
    for (const secret of [
      token,
      state.authAdminKey,
      state.applicationPassword,
      state.fixturePassword,
      state.migrationUrl,
    ])
      if (secret)
        check(
          !api.output.includes(secret),
          'Se expuso un secreto en el registro de recuperación de ayuda.',
        );
    return {
      status: 'passed',
      infrastructure: 'real-local-auth-api-postgresql-runner',
      provider: 'explicit-test-double',
      azureRemote: 'not-tested',
      apiRestarts: 5,
      scenarios: outcomes,
    };
  } catch (error) {
    if (error instanceof HelpRecoveryAssertion) throw error;
    // eslint-disable-next-line preserve-caught-error -- Keep private SQL/auth causes out of the public evidence artifact.
    throw new Error(
      'Falló la recuperación real de ayuda; revisar el diagnóstico local redactado.',
    );
  } finally {
    try {
      if (installed)
        await db.query(
          'DROP TRIGGER help_recovery_checkpoint_failure ON app_private.help_calls; DROP TRIGGER help_recovery_admission_failure ON app.feedback_requests; DROP TRIGGER help_recovery_publication_failure ON app.feedbacks; DROP TRIGGER help_recovery_ledger_failure ON app_private.ai_call_receipts; DROP FUNCTION help_recovery_faults.block_checkpoint(); DROP FUNCTION help_recovery_faults.block_admission(); DROP FUNCTION help_recovery_faults.block_publication(); DROP FUNCTION help_recovery_faults.block_ledger(); DROP TABLE help_recovery_faults.flags; DROP SEQUENCE help_recovery_faults.admission_hits,help_recovery_faults.checkpoint_hits,help_recovery_faults.publication_hits,help_recovery_faults.ledger_hits; DROP SCHEMA help_recovery_faults;',
        );
    } finally {
      await Promise.allSettled([
        db.end(),
        ordinary.end(),
        auth.auth.signOut({ scope: 'local' }),
      ]);
      if (stopped) await api.start(`${testTarget.apiUrl}/health/ready`);
    }
  }
}
