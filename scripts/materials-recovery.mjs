import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { classes } from '../fixtures/demo/academic.mjs';
import { applicationUrl } from './local.mjs';
import { testTarget, assertRuntimeTarget } from './local-target.mjs';
import materialFaults from '../tests/help-fault-materials.cjs';

class RecoveryAssertion extends Error {}
function check(condition, message) {
  if (!condition) throw new RecoveryAssertion(message);
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const authOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
async function until(action, message, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await action();
    if (result) return result;
    await delay(100);
  }
  throw new RecoveryAssertion(message);
}

/** Uses the caller's already-owned TEST stack. Never starts another environment,
 * invokes Azure, deletes history, or prints a credential/provider response. */
export async function verifyMaterialsRecovery({ ctx, state, api }) {
  assertRuntimeTarget(state, testTarget);
  const destination = new URL(state.migrationUrl);
  check(
    ctx.projectId === testTarget.projectId &&
      ctx.apiPort === testTarget.apiPort &&
      state.projectId === ctx.projectId &&
      state.authUrl === testTarget.authUrl &&
      destination.hostname === '127.0.0.1' &&
      destination.port === String(testTarget.dbPort) &&
      destination.username === 'postgres',
    'La recuperación de materiales solo admite el laboratorio TEST ya adquirido.',
  );
  const fixture = JSON.parse(
    await readFile(
      new URL('../fixtures/foundation/identity.json', import.meta.url),
      'utf8',
    ),
  );
  const teacher = fixture.users.find(
    (user) => user.id === classes[0].teacherId,
  );
  check(
    teacher,
    'No existe el profesor ficticio para recuperación de materiales.',
  );
  const auth = createClient(state.authUrl, state.publishableKey, authOptions);
  const login = await auth.auth.signInWithPassword({
    email: teacher.email,
    password: state.fixturePassword,
  });
  check(
    !login.error && login.data.session,
    'No se autenticó el profesor ficticio de recuperación.',
  );
  const token = login.data.session.access_token;
  const storage = createClient(
    state.authUrl,
    state.authAdminKey,
    authOptions,
  ).storage.from('materials');
  const fixtureDb = new pg.Pool({
    connectionString: state.migrationUrl,
    max: 2,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  const ordinaryDb = new pg.Pool({
    connectionString: applicationUrl(ctx, state),
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
  });
  const suffix = randomUUID();
  const uploadTitle = `Recuperación de carga ${suffix}`;
  const checkpointTitle = `Recuperación de fragmentos ${suffix}`;
  const original = Buffer.from(
    'Una función recibe parámetros y retorna un resultado. Documento ficticio de recuperación.',
  );
  const replacement = Buffer.from(
    'Nueva versión ficticia: una condición determina qué rama se ejecuta.',
  );
  let installed = false,
    stopped = false;

  async function request(
    path,
    { method = 'GET', form, key, revision, binary = false } = {},
  ) {
    const response = await fetch(`${testTarget.apiUrl}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(key ? { 'Idempotency-Key': key } : {}),
        ...(revision ? { 'If-Match': `"${revision}"` } : {}),
      },
      ...(form ? { body: form } : {}),
      signal: AbortSignal.timeout(12_000),
    });
    if (binary)
      return {
        status: response.status,
        bytes: Buffer.from(await response.arrayBuffer()),
      };
    const payload = await response.json();
    return {
      status: response.status,
      data: payload.data,
      error: payload.error,
    };
  }
  function upload(bytes, title, { source, key = randomUUID() } = {}) {
    const form = new globalThis.FormData();
    form.set(
      'file',
      new globalThis.Blob([bytes], { type: 'text/plain' }),
      'recuperacion.txt',
    );
    if (!source) form.set('title', title);
    return request(
      source
        ? `/sources/${source.id}/versions`
        : `/classes/${classes[0].id}/sources`,
      { method: 'POST', form, key, revision: source?.revision },
    );
  }
  async function sourceReady(id) {
    return until(async () => {
      const result = await request(`/sources/${id}`);
      check(
        result.status === 200,
        'No se pudo consultar el material en recuperación.',
      );
      check(
        result.data.latestJob?.state !== 'FAILED',
        'El material no se recuperó después del reinicio.',
      );
      return result.data.latestJob?.state === 'SUCCEEDED' &&
        result.data.availability === 'READY'
        ? result.data
        : null;
    }, 'La generación recuperada no llegó a READY dentro del plazo.');
  }
  async function rowForTitle(title) {
    const result = await fixtureDb.query(
      `SELECT j.*,v.storage_object_key,u.lifecycle_status AS object_status
      FROM app.material_jobs j JOIN app.sources s ON s.id=j.source_id
      JOIN app.source_versions v ON v.id=j.source_version_id
      JOIN app_private.material_upload_objects u ON u.job_id=j.id
      WHERE s.title=$1 AND s.owner_id=$2 ORDER BY j.created_at DESC,j.id DESC LIMIT 1`,
      [title, teacher.id],
    );
    return result.rows[0];
  }
  async function storedHash(key) {
    const result = await storage.download(key);
    check(
      !result.error && result.data,
      'El objeto privado ficticio no está disponible en Storage.',
    );
    return hash(Buffer.from(await result.data.arrayBuffer()));
  }
  async function toggleFault(title, phase, enabled) {
    if (enabled)
      await fixtureDb.query(
        'INSERT INTO materials_recovery_faults.flags(source_title,phase) VALUES($1,$2)',
        [title, phase],
      );
    else
      await fixtureDb.query(
        'DELETE FROM materials_recovery_faults.flags WHERE source_title=$1 AND phase=$2',
        [title, phase],
      );
  }
  async function lateWorkerRejected(jobId, oldToken) {
    // Ordinary application role and empty worker actor: no privileged bypass is
    // used to execute the same fenced transitions as the real worker.
    const result = await ordinaryDb.query(
      `SELECT
      app_private.material_renew_job($1,$2) AS renewed,
      app_private.material_stage_chunks($1,$2,'[]'::jsonb) AS staged,
      app_private.material_publish_job($1,$2) AS published`,
      [jobId, oldToken],
    );
    check(
      result.rows[0].renewed === false &&
        result.rows[0].staged === false &&
        result.rows[0].published === false,
      'Un trabajador con lease vencido u obsoleto alteró la generación.',
    );
  }
  try {
    check(
      (await ordinaryDb.query('SELECT current_user AS role')).rows[0].role ===
        'alunza_app',
      'El ensayo de fencing no está usando el rol ordinario de aplicación.',
    );
    const embeddingProfile = (
      await fixtureDb.query(
        'SELECT configuration_id,model,dimensions FROM app_private.material_embedding_profile',
      )
    ).rows[0];
    check(
      embeddingProfile?.configuration_id === 'materials-fixture-3d-v1' &&
        embeddingProfile.model === 'test-fixture-only' &&
        embeddingProfile.dimensions === 3,
      'La recuperación requiere el perfil explícito de embeddings ficticios usado por la suite HTTP.',
    );
    // TEST-only fault injection: the upload reservation and first chunk batch
    // really commit. The selected subsequent transaction alone is rolled back.
    await fixtureDb.query(`BEGIN;
      SET LOCAL lock_timeout='3s';
      CREATE SCHEMA materials_recovery_faults AUTHORIZATION postgres;
      REVOKE ALL ON SCHEMA materials_recovery_faults FROM PUBLIC,anon,authenticated,service_role,alunza_app,alunza_identity;
      CREATE TABLE materials_recovery_faults.flags(source_title text NOT NULL,phase text NOT NULL,PRIMARY KEY(source_title,phase));
      REVOKE ALL ON materials_recovery_faults.flags FROM PUBLIC,anon,authenticated,service_role,alunza_app,alunza_identity;
      CREATE FUNCTION materials_recovery_faults.fail_confirm() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
      BEGIN
        IF NEW.action='material.uploaded' AND EXISTS(SELECT 1 FROM materials_recovery_faults.flags f JOIN app.sources s ON s.title=f.source_title WHERE f.phase='confirm' AND s.id=NEW.entity_id) THEN
          RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='MATERIALS_RECOVERY_CONFIRM_FAULT';
        END IF;
        RETURN NEW;
      END $$;
      CREATE FUNCTION materials_recovery_faults.fail_second_batch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
      BEGIN
        IF NEW.chunk_index>=32 AND EXISTS(SELECT 1 FROM materials_recovery_faults.flags f JOIN app.sources s ON s.title=f.source_title WHERE f.phase='checkpoint' AND s.id=NEW.source_id) THEN
          RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='MATERIALS_RECOVERY_CHECKPOINT_FAULT';
        END IF;
        RETURN NEW;
      END $$;
      REVOKE ALL ON FUNCTION materials_recovery_faults.fail_confirm(),materials_recovery_faults.fail_second_batch() FROM PUBLIC,anon,authenticated,service_role,alunza_app,alunza_identity;
      CREATE TRIGGER materials_recovery_confirm_failure BEFORE INSERT ON app.audit_events FOR EACH ROW EXECUTE FUNCTION materials_recovery_faults.fail_confirm();
      CREATE TRIGGER materials_recovery_checkpoint_failure BEFORE INSERT ON app.source_chunks FOR EACH ROW EXECUTE FUNCTION materials_recovery_faults.fail_second_batch();
      COMMIT;`);
    installed = true;

    await toggleFault(uploadTitle, 'confirm', true);
    const operationKey = randomUUID();
    const interrupted = await upload(original, uploadTitle, {
      key: operationKey,
    });
    check(
      [409, 503].includes(interrupted.status),
      'La carga con commit fallido no debe confirmar HTTP 202.',
    );
    const pending = await rowForTitle(uploadTitle);
    check(
      pending?.lifecycle_status === 'UPLOADING' &&
        pending.object_status === 'RESERVED',
      'La respuesta incierta no dejó una reserva durable de carga.',
    );
    check(
      (await storedHash(pending.storage_object_key)) === hash(original),
      'Storage no conserva los bytes anteriores al fallo del commit.',
    );
    await api.stop();
    stopped = true;
    await toggleFault(uploadTitle, 'confirm', false);
    await fixtureDb.query(
      "UPDATE app.material_jobs SET lease_until=now()-interval '1 second' WHERE id=$1 AND lifecycle_status='UPLOADING'",
      [pending.id],
    );
    await api.start(`${testTarget.apiUrl}/health/ready`);
    stopped = false;
    const first = await sourceReady(pending.source_id);
    const replay = await upload(original, uploadTitle, { key: operationKey });
    check(
      replay.status === 202 &&
        replay.data.source.id === first.id &&
        replay.data.job.id === pending.id,
      'La repetición de la carga recuperada creó otra fuente o trabajo.',
    );
    const firstContent = await request(
      `/sources/${first.id}/versions/${first.activeVersion.id}/content`,
      { binary: true },
    );
    check(
      firstContent.status === 200 &&
        hash(firstContent.bytes) === hash(original),
      'La versión recuperada no entrega los bytes originales por la API autorizada.',
    );

    // Keep a genuine historical version before orphan cleanup is exercised.
    const replaced = await upload(replacement, uploadTitle, { source: first });
    check(
      replaced.status === 202,
      'No se registró el reemplazo ficticio de recuperación.',
    );
    const second = await sourceReady(first.id);
    check(
      second.activeVersion.id !== first.activeVersion.id,
      'El reemplazo no creó una versión inmutable nueva.',
    );
    const secondObject = await rowForTitle(uploadTitle);
    await toggleFault(uploadTitle, 'confirm', true);
    const orphanAttempt = await upload(
      Buffer.from('Objeto ficticio reservado que debe limpiarse.'),
      uploadTitle,
      { source: second },
    );
    check(
      [409, 503].includes(orphanAttempt.status),
      'La carga huérfana no debe anunciarse confirmada.',
    );
    const orphan = await rowForTitle(uploadTitle);
    check(
      orphan.lifecycle_status === 'UPLOADING' &&
        orphan.object_status === 'RESERVED',
      'No se registró el objeto reservado de la prueba de limpieza.',
    );
    await storedHash(orphan.storage_object_key);
    await toggleFault(uploadTitle, 'confirm', false);
    const failedUpload = await ordinaryDb.query(
      "SELECT app_private.material_fail_job($1,$2,'UPLOAD_INCOMPLETE',false) AS failed",
      [orphan.id, orphan.upload_token],
    );
    check(
      failedUpload.rows[0].failed === true,
      'No se pudo declarar fallida la reserva huérfana controlada.',
    );
    await fixtureDb.query(
      "UPDATE app_private.material_upload_objects SET updated_at=now()-interval '3 minutes' WHERE job_id=$1 AND lifecycle_status='ORPHAN'",
      [orphan.id],
    );
    await until(
      async () =>
        (
          await fixtureDb.query(
            'SELECT lifecycle_status FROM app_private.material_upload_objects WHERE job_id=$1',
            [orphan.id],
          )
        ).rows[0]?.lifecycle_status === 'DELETED',
      'El worker no limpió el objeto huérfano recuperable.',
    );
    const missing = await storage.download(orphan.storage_object_key);
    check(
      missing.error &&
        !missing.data &&
        ['400', '404'].includes(
          String(missing.error.statusCode ?? missing.error.status),
        ),
      'La limpieza no eliminó el objeto privado huérfano.',
    );
    check(
      (
        await fixtureDb.query(
          "SELECT count(*)::int AS count FROM storage.objects WHERE bucket_id='materials' AND name=$1",
          [orphan.storage_object_key],
        )
      ).rows[0].count === 0,
      'Storage conserva metadatos del objeto que se declaró eliminado.',
    );
    check(
      (await storedHash(pending.storage_object_key)) === hash(original) &&
        (await storedHash(secondObject.storage_object_key)) ===
          hash(replacement),
      'La limpieza del huérfano eliminó una versión confirmada o histórica.',
    );
    const history = await request(
      `/sources/${first.id}/versions/${first.activeVersion.id}/content`,
      { binary: true },
    );
    check(
      history.status === 200 && hash(history.bytes) === hash(original),
      'La referencia histórica dejó de ser consultable tras la limpieza.',
    );

    await toggleFault(checkpointTitle, 'checkpoint', true);
    const longText = Buffer.from(
      Array.from(
        { length: 45 },
        () => `Función recuperación${' variable'.repeat(400)}`,
      ).join('\n'),
    );
    await materialFaults.setMaterialFault({
      text: longText.toString('utf8'),
      scenario: 'slow',
    });
    const checkpointUpload = await upload(longText, checkpointTitle);
    check(
      checkpointUpload.status === 202,
      'No se confirmó el documento ficticio para checkpoints.',
    );
    const checkpointId = checkpointUpload.data.job.id;
    const checkpoint = await until(async () => {
      const result = (
        await fixtureDb.query(
          `SELECT j.*,g.expected_chunk_count,
        (SELECT count(*)::int FROM app.source_chunks c WHERE c.generation_id=j.generation_id) AS persisted
        FROM app.material_jobs j JOIN app.source_index_generations g ON g.id=j.generation_id WHERE j.id=$1`,
          [checkpointId],
        )
      ).rows[0];
      check(
        result.lifecycle_status !== 'FAILED',
        'El fallo transitorio de checkpoint se convirtió en fallo permanente.',
      );
      return result.lifecycle_status === 'QUEUED' &&
        result.persisted === 32 &&
        result.attempt_count === 1
        ? result
        : null;
    }, 'No se observó el primer lote persistido con reintento pendiente.');
    check(
      checkpoint.expected_chunk_count > 32,
      'El fixture no requiere un segundo lote de embeddings.',
    );
    await api.stop();
    stopped = true;
    const before = (
      await fixtureDb.query(
        'SELECT id,chunk_index,content_hash FROM app.source_chunks WHERE generation_id=$1 ORDER BY chunk_index',
        [checkpoint.generation_id],
      )
    ).rows;
    check(
      before.length === 32,
      'El checkpoint cambió antes de detener la API.',
    );
    await toggleFault(checkpointTitle, 'checkpoint', false);
    const oldToken = randomUUID();
    await fixtureDb.query(
      "UPDATE app.material_jobs SET lifecycle_status='RUNNING',lease_token=$2,lease_until=now()-interval '1 second',available_at=now()-interval '1 second' WHERE id=$1 AND lifecycle_status='QUEUED'",
      [checkpointId, oldToken],
    );
    await lateWorkerRejected(checkpointId, oldToken);
    await api.start(`${testTarget.apiUrl}/health/ready`);
    stopped = false;
    await until(async () => {
      const reclaimed = (
        await fixtureDb.query(
          'SELECT lifecycle_status,lease_token,attempt_count FROM app.material_jobs WHERE id=$1',
          [checkpointId],
        )
      ).rows[0];
      check(
        reclaimed.lifecycle_status !== 'FAILED',
        'El lease vencido no se recuperó.',
      );
      return (
        reclaimed.lifecycle_status === 'RUNNING' &&
        reclaimed.lease_token !== oldToken &&
        reclaimed.attempt_count === 2
      );
    }, 'No se observó el lease renovado mientras continuaba el segundo lote.');
    await lateWorkerRejected(checkpointId, oldToken);
    const resumed = await sourceReady(checkpoint.source_id);
    const after = (
      await fixtureDb.query(
        'SELECT id,chunk_index,content_hash FROM app.source_chunks WHERE generation_id=$1 ORDER BY chunk_index',
        [checkpoint.generation_id],
      )
    ).rows;
    check(
      after.length === checkpoint.expected_chunk_count &&
        new Set(after.map((chunk) => chunk.chunk_index)).size ===
          after.length &&
        JSON.stringify(after.slice(0, 32)) === JSON.stringify(before),
      'El reinicio duplicó, reemplazó o perdió fragmentos del checkpoint.',
    );
    check(
      resumed.activeGenerationId === checkpoint.generation_id &&
        resumed.latestJob.attempts === 2,
      'La recuperación cambió de generación o no registró el segundo intento durable.',
    );
    const activations = (
      await fixtureDb.query(
        "SELECT count(*)::int AS count FROM app.audit_events WHERE entity_id=$1 AND action='material.index_activated'",
        [checkpoint.source_id],
      )
    ).rows[0].count;
    check(
      activations === 1,
      'La recuperación activó dos veces la misma generación.',
    );
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
          'Un secreto apareció en el registro de recuperación de materiales.',
        );
    return {
      status: 'passed',
      infrastructure: 'real-local-auth-api-storage-postgresql',
      embeddings: 'explicit-test-double',
      azureRemote: 'not-tested',
      apiRestarts: 2,
      upload: {
        uncertainResponse: interrupted.status,
        reservationRecovered: true,
        idempotentReplay: true,
        originalBytesPreserved: true,
      },
      orphan: {
        privateObjectDeleted: true,
        currentAndHistoricalVersionsPreserved: true,
      },
      checkpoint: {
        persistedBeforeRestart: before.length,
        persistedAfterRestart: after.length,
        duplicateIndexes: 0,
        originalChunkIdsPreserved: true,
        attempts: resumed.latestJob.attempts,
        activations,
      },
      fencing: {
        expiredLeaseRejected: true,
        obsoleteTokenAfterRestartRejected: true,
      },
      scenarios: [
        'storage-written-upload-commit-failure',
        'api-restart-reconciles-reserved-object',
        'upload-replay-no-duplicate',
        'orphan-cleanup-preserves-history',
        'committed-batch-resumes-after-restart',
        'expired-and-obsolete-lease-fenced',
        'one-complete-activation',
      ],
    };
  } catch (error) {
    if (error instanceof RecoveryAssertion) throw error;
    // eslint-disable-next-line preserve-caught-error -- SQL/Storage causes may contain private connection or authorization details.
    throw new Error(
      'Falló la recuperación real de materiales; revisar el entorno TEST con datos sensibles redactados.',
    );
  } finally {
    materialFaults.clearMaterialFault();
    try {
      if (installed)
        await fixtureDb.query(`DROP TRIGGER materials_recovery_confirm_failure ON app.audit_events;
        DROP TRIGGER materials_recovery_checkpoint_failure ON app.source_chunks;
        DROP FUNCTION materials_recovery_faults.fail_confirm();
        DROP FUNCTION materials_recovery_faults.fail_second_batch();
        DROP TABLE materials_recovery_faults.flags;
        DROP SCHEMA materials_recovery_faults;`);
    } finally {
      await Promise.allSettled([
        fixtureDb.end(),
        ordinaryDb.end(),
        auth.auth.signOut({ scope: 'local' }),
      ]);
      if (stopped) await api.start(`${testTarget.apiUrl}/health/ready`);
    }
  }
}
