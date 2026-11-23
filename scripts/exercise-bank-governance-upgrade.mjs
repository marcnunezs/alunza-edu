import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { root, readState, redactDiagnostics } from './local.mjs';
import { testTarget, assertRuntimeTarget } from './local-target.mjs';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';
import { createExerciseBankHarness } from '../tests/e2e/exercise-bank-fixture.mjs';

const require = createRequire(import.meta.url);
const fromVersion = '20261027020051';
const toVersion = '20261027155241';
const migration = `${toVersion}_exercise_bank_governance.sql`;
const workersDisabled = {
  SIGNALS_WORKER_ENABLED: 'false',
  INVITATION_WORKER_ENABLED: 'false',
  MATERIALS_WORKER_ENABLED: 'false',
  HELP_WORKER_ENABLED: 'false',
};
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function schemaState(client) {
  return (
    await client.query(`SELECT
      (SELECT max(version) FROM supabase_migrations.schema_migrations) AS version,
      to_regprocedure('app_private.guard_exercise_governance_owner()') IS NOT NULL AS function_present,
      EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='app.exercises'::regclass
        AND t.tgname='guard_exercise_governance_owner' AND NOT t.tgisinternal
        AND t.tgenabled='O'
        AND t.tgfoid=to_regprocedure('app_private.guard_exercise_governance_owner()')) AS trigger_present`)
  ).rows[0];
}

async function snapshot(client, harness, scope) {
  const result = await harness.snapshot(scope);
  for (const [key, table] of [
    ['exercise_tests', 'app_private.exercise_tests'],
    ['operation_keys', 'app.operation_keys'],
  ]) {
    result[key] = (
      await client.query(
        `SELECT count(*)::integer AS count,md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY to_jsonb(t)::text),'')) AS digest FROM ${table} t WHERE organization_id=$1`,
        [scope.organizationId],
      )
    ).rows[0];
  }
  return result;
}

function preserveDiagnostic(error, state, api) {
  let diagnostic = `${error.output ?? error.stack ?? error.message}\n${api?.output ?? ''}`;
  for (const field of [
    'applicationPassword',
    'fixturePassword',
    'authAdminKey',
    'publishableKey',
    'migrationUrl',
  ])
    if (typeof state[field] === 'string' && state[field])
      diagnostic = diagnostic.split(state[field]).join('[redacted]');
  error.output = redactDiagnostics(diagnostic);
  return error;
}

async function detail(harness, scope) {
  const response = await harness.request(
    scope,
    `/exercises/${scope.exerciseId}/governance`,
  );
  assert.equal(response.status, 200, 'BANK_GOV_UPGRADE_DETAIL_FAILED');
  assert.equal(response.noStore, true);
  require('@alunza/contracts').exerciseBankDetailResponseSchema.parse(
    response.body,
  );
  assert.equal(response.headers.etag, `"${response.data.revision}"`);
  assert.equal(response.data.id, scope.exerciseId);
  assert.deepEqual(response.data.useCounts, scope.oracle.useCounts);
  return response;
}

// Creates an actual legacy archive event through authenticated HTTP on .01.
// This is controlled fixture work, not a reconstructed historical audit event.
async function preparePriorAudit(harness, scope) {
  const exerciseId = scope.exerciseIds[1];
  const read = await harness.request(scope, `/exercises/${exerciseId}`);
  assert.equal(read.status, 200, 'BANK_GOV_UPGRADE_PRIOR_READ_FAILED');
  const result = await harness.request(
    scope,
    `/exercises/${exerciseId}/archive`,
    {
      method: 'POST',
      body: { reason: 'Ensayo local de conservación al actualizar IMP-06.02.' },
      headers: {
        'If-Match': `"${read.data.revision}"`,
        'Idempotency-Key': randomUUID(),
      },
    },
  );
  assert.equal(result.status, 200, 'BANK_GOV_UPGRADE_PRIOR_ARCHIVE_FAILED');
  assert.equal(result.data.state, 'ARCHIVED');
  return exerciseId;
}

async function verifyMutations(harness, scope, current) {
  const contracts = require('@alunza/contracts');
  const options = {
    method: 'PATCH',
    body: { ownerId: scope.adminId, visibility: 'PRIVATE' },
    headers: {
      'If-Match': current.headers.etag,
      'Idempotency-Key': randomUUID(),
    },
  };
  const changed = await harness.request(
    scope,
    `/exercises/${scope.exerciseId}/governance`,
    options,
  );
  assert.equal(changed.status, 200, 'BANK_GOV_UPGRADE_GOVERN_FAILED');
  contracts.exerciseBankDetailResponseSchema.parse(changed.body);
  assert.equal(changed.data.owner.id, scope.adminId);
  assert.equal(changed.data.visibility, 'PRIVATE');
  assert.equal(changed.data.revision, current.data.revision + 1);
  assert.deepEqual(changed.data.useCounts, current.data.useCounts);
  const replay = await harness.request(
    scope,
    `/exercises/${scope.exerciseId}/governance`,
    options,
  );
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.data, changed.data);
  const version = await harness.request(
    scope,
    `/exercises/${scope.exerciseId}/versions`,
    {
      method: 'POST',
      headers: {
        'If-Match': `"${changed.data.revision}"`,
        'Idempotency-Key': randomUUID(),
      },
      body: {
        title: 'Versión administrativa tras actualización',
        statement: 'Devuelve el valor 1.',
        starterCode: 'module.exports.solve=()=>1;',
        language: 'javascript',
        entrypoint: 'solve',
        difficulty: 'BEGINNER',
        conceptVersionIds: [scope.conceptVersionIds[0]],
        executionLimits: {
          memoryBytes: 134217728,
          runtimeMs: 3000,
          outputBytes: 65536,
        },
        tests: [
          {
            id: 'upgrade-visible',
            visibility: 'visible',
            args: [],
            expected: 1,
          },
        ],
      },
    },
  );
  assert.equal(version.status, 201, 'BANK_GOV_UPGRADE_ADMIN_VERSION_FAILED');
  contracts.exerciseVersionResponseSchema.parse(version.body);
  assert.equal(version.data.version, scope.oracle.versions + 1);
  const final = await detail(harness, scope);
  assert.equal(final.data.currentVersion.id, version.data.id);
  return { governance: 200, replay: 200, adminVersion: 201 };
}

export async function prepareExerciseBankGovernanceUpgrade({ ctx, state }) {
  assertRuntimeTarget(state, testTarget);
  assert.equal(ctx.projectId, testTarget.projectId);
  assert.equal(ctx.apiPort, testTarget.apiPort);
  const owner = new pg.Client({ connectionString: state.migrationUrl });
  let api, harness;
  try {
    await owner.connect();
    const beforeSchema = await schemaState(owner);
    assert.equal(
      beforeSchema.version,
      fromVersion,
      'BANK_GOV_UPGRADE_BASELINE',
    );
    assert.equal(beforeSchema.function_present, false);
    assert.equal(beforeSchema.trigger_present, false);
    harness = createExerciseBankHarness(state);
    const scope = await harness.prepare();
    await buildApi();
    api = testApi(ctx, state, ctx.webPort, workersDisabled);
    await api.start(`${testTarget.apiUrl}/health/live`);
    await api.wait(`${testTarget.apiUrl}/health/ready`, 503);
    const archivedId = await preparePriorAudit(harness, scope);
    const before = await snapshot(owner, harness, scope);
    assert.equal(before.exercises.count, 25);
    assert.equal(before.exercise_versions.count, 49);
    assert.equal(before.exercise_tests.count, 98);
    assert.equal(before.exercise_version_concepts.count, 49);
    assert.equal(before.activities.count, 24);
    assert.equal(before.activity_exercises.count, 25);
    assert.equal(before.audit_events.count, 1, 'BANK_GOV_UPGRADE_PRIOR_AUDIT');
    assert.equal(before.operation_keys.count, 1);
    const priorAudit = (
      await owner.query(
        'SELECT action,entity_id::text,actor_id::text FROM app.audit_events WHERE organization_id=$1',
        [scope.organizationId],
      )
    ).rows[0];
    assert.equal(priorAudit.action, 'exercise.archived');
    assert.equal(priorAudit.entity_id, archivedId);
    assert.equal(priorAudit.actor_id, scope.adminId);
    await api.stop();

    return async function verifyExerciseBankGovernanceUpgrade() {
      let current = state;
      let client, upgradedApi;
      try {
        current = await readState(ctx);
        assertRuntimeTarget(current, testTarget);
        client = new pg.Client({ connectionString: current.migrationUrl });
        await client.connect();
        const afterSchema = await schemaState(client);
        assert.equal(afterSchema.version, toVersion, 'BANK_GOV_UPGRADE_TARGET');
        assert.equal(afterSchema.function_present, true);
        assert.equal(afterSchema.trigger_present, true);
        const after = await snapshot(client, harness, scope);
        assert.deepEqual(after, before, 'BANK_GOV_UPGRADE_CHANGED_DATA');
        upgradedApi = testApi(ctx, current, ctx.webPort, workersDisabled);
        await upgradedApi.start(`${testTarget.apiUrl}/health/ready`);
        const currentDetail = await detail(harness, scope);
        const afterReads = await snapshot(client, harness, scope);
        assert.deepEqual(
          afterReads,
          before,
          'BANK_GOV_UPGRADE_READ_CHANGED_DATA',
        );
        const mutations = await verifyMutations(harness, scope, currentDetail);
        const afterMutations = await snapshot(client, harness, scope);
        for (const name of ['activities', 'activity_exercises'])
          assert.deepEqual(afterMutations[name], before[name]);
        assert.equal(
          afterMutations.exercise_versions.count,
          before.exercise_versions.count + 1,
        );
        assert.equal(
          afterMutations.audit_events.count,
          before.audit_events.count + 2,
        );
        assert.equal(
          afterMutations.operation_keys.count,
          before.operation_keys.count + 2,
        );
        return {
          status: 'passed',
          increment: 'IMP-06.02',
          from: fromVersion,
          to: toVersion,
          migration,
          beforeDigest: digest(before),
          afterDigest: digest(after),
          afterReadsDigest: digest(afterReads),
          preserved: Object.fromEntries(
            Object.entries(before).map(([name, value]) => [name, value.count]),
          ),
          priorAudit: {
            count: 1,
            action: priorAudit.action,
            origin: 'authenticated legacy archive HTTP before migration',
          },
          beforeSchema,
          afterSchema,
          readinessBefore: 503,
          readinessAfter: 200,
          authenticatedMutationSmoke: mutations,
          remoteProvidersUsed: false,
          academicAcceptance: 'pending',
        };
      } catch (error) {
        throw preserveDiagnostic(error, current, upgradedApi);
      } finally {
        try {
          await upgradedApi?.stop();
        } finally {
          await harness.close();
          await client?.end();
        }
      }
    };
  } catch (error) {
    await harness?.close();
    throw preserveDiagnostic(error, state, api);
  } finally {
    try {
      await api?.stop();
    } finally {
      await owner.end();
    }
  }
}

export async function runExerciseBankGovernanceUpgrade() {
  try {
    return await withTestEnvironment(
      async ({ upgrade }) => {
        assert.ok(upgrade, 'BANK_GOV_UPGRADE_REPORT_MISSING');
        await report('bank-governance-upgrade', upgrade, 'imp-06');
        return upgrade;
      },
      [],
      {
        upgradeFromVersion: fromVersion,
        beforeUpgrade: prepareExerciseBankGovernanceUpgrade,
      },
    );
  } catch (error) {
    const directory = join(root, '.local/evidence/imp-06');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'bank-governance-upgrade-error.log'),
      redactDiagnostics(error.output ?? error.stack ?? error.message),
      { mode: 0o600 },
    );
    await report(
      'bank-governance-upgrade',
      { status: 'failed', from: fromVersion, to: toVersion, migration },
      'imp-06',
    );
    throw new Error(
      'La actualización del gobierno del banco falló; revisar .local/evidence/imp-06/bank-governance-upgrade-error.log.',
      { cause: error },
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runExerciseBankGovernanceUpgrade()
    .then(() => {
      console.log(
        'Actualización IMP-06.01 → IMP-06.02: banco y auditoría previa preservados; gobierno y versionado ADMIN verificados.',
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
