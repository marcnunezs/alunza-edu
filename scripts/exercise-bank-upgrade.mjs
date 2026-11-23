import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const fromVersion = '20261026220133';
const toVersion = '20261027020051';
const migration = `${toVersion}_exercise_bank_read.sql`;
const workersDisabled = {
  SIGNALS_WORKER_ENABLED: 'false',
  INVITATION_WORKER_ENABLED: 'false',
  MATERIALS_WORKER_ENABLED: 'false',
  HELP_WORKER_ENABLED: 'false',
};
const functions = [
  'app_private.exercise_bank_list(uuid,jsonb)',
  'app_private.exercise_bank_detail(uuid)',
  'app_private.exercise_bank_versions(uuid,jsonb)',
  'app_private.exercise_bank_uses(uuid,jsonb)',
];
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function schemaState(client) {
  const version = (
    await client.query(
      'SELECT max(version) AS version FROM supabase_migrations.schema_migrations',
    )
  ).rows[0].version;
  const available = (
    await client.query(
      'SELECT signature,to_regprocedure(signature) IS NOT NULL AS present FROM unnest($1::text[]) AS names(signature) ORDER BY signature',
      [functions],
    )
  ).rows;
  return { version, functions: available };
}

function preserveDiagnostic(error, state, api) {
  let diagnostic = `${error.output ?? error.stack ?? error.message}\n${api?.output ?? ''}`;
  for (const field of [
    'applicationPassword',
    'fixturePassword',
    'authAdminKey',
    'publishableKey',
    'migrationUrl',
  ]) {
    if (typeof state[field] === 'string' && state[field])
      diagnostic = diagnostic.split(state[field]).join('[redacted]');
  }
  error.output = redactDiagnostics(diagnostic);
  return error;
}

async function verifyPublicReads(harness, scope) {
  const contracts = require('@alunza/contracts');
  async function read(path, schema) {
    const response = await harness.request(scope, path, { actor: 'admin' });
    assert.equal(response.status, 200, 'BANK_UPGRADE_PUBLIC_READ_FAILED');
    assert.equal(response.noStore, true, 'BANK_UPGRADE_PUBLIC_CACHE_POLICY');
    schema.parse(response.body);
    return response.data;
  }
  const detailPath = `/exercises/${scope.exerciseId}/governance`;
  const list = await read(
    `/organizations/${scope.organizationId}/exercise-bank?limit=100`,
    contracts.exerciseBankListResponseSchema,
  );
  const detail = await read(
    detailPath,
    contracts.exerciseBankDetailResponseSchema,
  );
  const versions = await read(
    `${detailPath}/versions?limit=100`,
    contracts.exerciseBankVersionsResponseSchema,
  );
  const uses = await read(
    `${detailPath}/uses?limit=100`,
    contracts.exerciseBankUsesResponseSchema,
  );
  assert.equal(list.organizationId, scope.organizationId);
  assert.equal(list.items.length, scope.oracle.exercises);
  assert.equal(list.page.totalFiltered, scope.oracle.exercises);
  assert.equal(detail.id, scope.exerciseId);
  assert.equal(detail.owner.id, scope.teacherId);
  assert.equal(detail.currentVersion.id, scope.currentVersionId);
  assert.equal(detail.versionCount, scope.oracle.versions);
  assert.deepEqual(detail.useCounts, scope.oracle.useCounts);
  assert.equal(versions.exerciseId, scope.exerciseId);
  assert.equal(versions.items.length, scope.oracle.versions);
  assert.equal(versions.page.totalFiltered, scope.oracle.versions);
  assert.equal(versions.items[0].id, scope.currentVersionId);
  assert.equal(versions.items.at(-1).version, 1);
  assert.equal(uses.exerciseId, scope.exerciseId);
  assert.equal(uses.items.length, scope.oracle.uses);
  assert.equal(uses.page.totalFiltered, scope.oracle.uses);
  assert.equal(
    new Set(uses.items.map((item) => item.assignmentId)).size,
    scope.oracle.uses,
  );
  for (const activityState of ['DRAFT', 'PUBLISHED', 'CLOSED'])
    assert.equal(
      uses.items.filter((item) => item.activity.state === activityState).length,
      scope.oracle.useCounts[activityState.toLowerCase()],
    );
  for (const result of [list, versions, uses])
    assert.deepEqual(result.page, {
      totalFiltered: 25,
      hasMore: false,
      nextCursor: null,
    });
  return {
    list: list.page.totalFiltered,
    versions: versions.page.totalFiltered,
    uses: uses.page.totalFiltered,
    currentVersion: detail.currentVersion.version,
    useCounts: detail.useCounts,
  };
}

// The shared environment owns reset/migration/teardown. This hook only prepares
// fictitious data on the old schema and returns the post-migration verifier.
export async function prepareExerciseBankUpgrade({ ctx, state }) {
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
      'BANK_UPGRADE_WRONG_BASELINE',
    );
    assert.ok(
      beforeSchema.functions.every((item) => !item.present),
      'BANK_UPGRADE_FUNCTIONS_ALREADY_EXIST',
    );
    // The environment seeds identity. Academic fixtures are unnecessary: this
    // harness creates its own bank; its foreign ID is not read by this smoke.
    harness = createExerciseBankHarness(state);
    const scope = await harness.prepare();
    const before = await harness.snapshot(scope);
    assert.equal(before.exercises.count, 25);
    assert.equal(before.exercise_versions.count, 49);
    assert.equal(before.exercise_version_concepts.count, 49);
    assert.equal(before.activities.count, 24);
    assert.equal(before.activity_exercises.count, 25);
    const beforeDigest = digest(before);
    await buildApi();
    api = testApi(ctx, state, ctx.webPort, workersDisabled);
    await api.start(`${testTarget.apiUrl}/health/live`);
    await api.wait(`${testTarget.apiUrl}/health/ready`, 503);
    assert.deepEqual(
      await harness.snapshot(scope),
      before,
      'BANK_UPGRADE_BASELINE_START_CHANGED_DATA',
    );
    await api.stop();

    // Keep this harness until verification: its scope registry intentionally
    // prevents a new harness from claiming another process's fixture.
    return async function verifyExerciseBankUpgrade() {
      let current = state;
      let client, upgradedApi;
      try {
        current = await readState(ctx);
        assertRuntimeTarget(current, testTarget);
        client = new pg.Client({ connectionString: current.migrationUrl });
        await client.connect();
        const afterSchema = await schemaState(client);
        assert.equal(
          afterSchema.version,
          toVersion,
          'BANK_UPGRADE_WRONG_TARGET',
        );
        assert.ok(
          afterSchema.functions.every((item) => item.present),
          'BANK_UPGRADE_FUNCTION_MISSING',
        );
        const after = await harness.snapshot(scope);
        assert.deepEqual(after, before, 'BANK_UPGRADE_CHANGED_EXISTING_DATA');
        upgradedApi = testApi(ctx, current, ctx.webPort, workersDisabled);
        await upgradedApi.start(`${testTarget.apiUrl}/health/ready`);
        const publicCounts = await verifyPublicReads(harness, scope);
        const afterReads = await harness.snapshot(scope);
        assert.deepEqual(afterReads, before, 'BANK_UPGRADE_READ_CHANGED_DATA');
        return {
          status: 'passed',
          from: fromVersion,
          to: toVersion,
          migration,
          beforeDigest,
          afterDigest: digest(after),
          afterReadsDigest: digest(afterReads),
          preserved: Object.fromEntries(
            Object.entries(before).map(([name, value]) => [name, value.count]),
          ),
          beforeSchema,
          afterSchema,
          readinessBefore: 503,
          readinessAfter: 200,
          publicSurfaces: [
            'exercise-bank',
            'governance-detail',
            'governance-versions',
            'governance-uses',
          ],
          publicCounts,
          publicReadsUsedAuthenticatedHttp: true,
          actor: 'ADMIN',
          fixturePreparation:
            'isolated SQL on prior schema; no academic seed or provider',
          remoteProvidersUsed: false,
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

export async function runExerciseBankUpgrade() {
  try {
    return await withTestEnvironment(
      async ({ upgrade }) => {
        assert.ok(upgrade, 'BANK_UPGRADE_REPORT_MISSING');
        await report('bank-upgrade', upgrade, 'imp-06');
        return upgrade;
      },
      [],
      {
        upgradeFromVersion: fromVersion,
        beforeUpgrade: prepareExerciseBankUpgrade,
      },
    );
  } catch (error) {
    const directory = join(root, '.local/evidence/imp-06');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'bank-upgrade-error.log'),
      redactDiagnostics(error.output ?? error.stack ?? error.message),
      { mode: 0o600 },
    );
    await report(
      'bank-upgrade',
      { status: 'failed', from: fromVersion, to: toVersion, migration },
      'imp-06',
    );
    throw new Error(
      'La actualización del banco falló; revisar .local/evidence/imp-06/bank-upgrade-error.log.',
      { cause: error },
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runExerciseBankUpgrade()
    .then(() => {
      console.log(
        'Actualización IMP-05.08 → IMP-06.01: banco previo preservado y cuatro consultas administrativas verificadas.',
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
