import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, run, cli, redactDiagnostics } from './local.mjs';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';
import { captureSignalCandidate } from './signals-candidate.mjs';
import { seedAcademic } from './academic-fixture.mjs';
import inventory from './governance-phase.cjs';

const testFile =
  'tests/integration/zzzzzzzzzzzzzzzzzzz-governance-phase.test.cjs';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function safeScopes(values) {
  assert.equal(values.length, inventory.phaseCaseIds.length);
  assert.equal(
    new Set(values.map((value) => value.caseId)).size,
    inventory.phaseCaseIds.length,
  );
  return values.map((value) => {
    assert.ok(inventory.phaseCaseIds.includes(value.caseId));
    assert.match(value.organizationId, uuid);
    const safe = { caseId: value.caseId, organizationId: value.organizationId };
    for (const key of [
      'exerciseId',
      'originalVersionId',
      'signalId',
      'exportId',
    ]) {
      if (value[key] !== undefined) {
        assert.match(value[key], uuid);
        safe[key] = value[key];
      }
    }
    if (value.attemptIds !== undefined) {
      assert.equal(value.attemptIds.length, 3);
      value.attemptIds.forEach((id) => assert.match(id, uuid));
      safe.attemptIds = value.attemptIds;
    }
    for (const key of [
      'realAttempts',
      'deliveredHints',
      'reviews',
      'rowCount',
      'emptyRows',
      'deniedRoles',
      'observedReviewWaiters',
      'observedGovernanceWaiters',
      'governanceChanges',
      'generationCount',
    ]) {
      if (value[key] !== undefined) {
        assert.ok(Number.isSafeInteger(value[key]) && value[key] >= 0);
        safe[key] = value[key];
      }
    }
    for (const key of [
      'crossClassDenied',
      'crossOrganizationDenied',
      'revokedReviewDenied',
      'byteIdentical',
      'revokedDeliveryDenied',
    ]) {
      if (value[key] !== undefined) {
        assert.equal(typeof value[key], 'boolean');
        safe[key] = value[key];
      }
    }
    if (value.sha256 !== undefined) {
      assert.match(value.sha256, /^[a-f0-9]{64}$/);
      safe.sha256 = value.sha256;
    }
    if (value.rejectedLimits !== undefined) {
      assert.deepEqual(value.rejectedLimits, ['rows', 'bytes']);
      safe.rejectedLimits = value.rejectedLimits;
    }
    return safe;
  });
}

export async function runGovernancePhaseIntegration() {
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const directory = join(
    root,
    '.local/evidence/imp-06/governance-phase-integration',
    runId,
  );
  await mkdir(directory, { recursive: true });
  const jestPath = join(directory, 'jest.json');
  const factsPath = join(directory, 'facts.json');
  let candidate,
    verified,
    sqlSummary,
    scopes = [],
    cases = [],
    failure;
  try {
    candidate = await captureSignalCandidate(
      `governance-phase-http-${runId}-start`,
    );
    await withTestEnvironment(async ({ ctx, state }) => {
      const api = testApi(ctx, state, ctx.webPort, {
        SIGNALS_WORKER_ENABLED: 'false',
        INVITATION_WORKER_ENABLED: 'false',
      });
      try {
        await seedAcademic(state);
        await buildApi();
        const baseUrl = `http://127.0.0.1:${ctx.apiPort}`;
        await api.start(`${baseUrl}/health/ready`);
        const result = await run(
          process.execPath,
          [
            '--experimental-vm-modules',
            join(root, 'node_modules/jest/bin/jest.js'),
            '--config',
            'tests/jest.integration.cjs',
            '--runInBand',
            '--runTestsByPath',
            testFile,
            '--json',
            '--outputFile',
            jestPath,
          ],
          {
            env: {
              ALUNZA_TEST_STATE: ctx.statePath,
              ALUNZA_TEST_API_URL: baseUrl,
              ALUNZA_GOVERNANCE_PHASE_FACTS: factsPath,
            },
          },
        );
        console.log(redactDiagnostics(result.stdout + result.stderr));
        const jest = JSON.parse(await readFile(jestPath, 'utf8'));
        cases = jest.testResults.flatMap((suite) =>
          suite.assertionResults.map((item) => ({
            id: item.fullName.match(/\bIMP06-PHASE-\d{2}\b/)?.[0] ?? 'UNKNOWN',
            status: item.status,
            durationMs: item.duration,
          })),
        );
        assert.equal(jest.success, true);
        assert.equal(cases.length, inventory.phaseCaseIds.length);
        assert.deepEqual(
          cases.map((item) => item.id).sort(),
          [...inventory.phaseCaseIds].sort(),
        );
        assert.ok(cases.every((item) => item.status === 'passed'));
        scopes = safeScopes(JSON.parse(await readFile(factsPath, 'utf8')));
        // The integrated journey crosses identity, content, attempts, help,
        // signals and exports. Run their existing SQL regression suite intact.
        const sql = await cli(ctx, ['test', 'db']);
        console.log(redactDiagnostics(sql.stdout + sql.stderr));
        const summary = (sql.stdout + sql.stderr).match(
          /Files=(\d+),\s*Tests=(\d+)/,
        );
        assert.ok(summary, 'SQL_REGRESSION_SUMMARY_MISSING');
        sqlSummary = {
          status: 'passed',
          files: Number(summary[1]),
          assertions: Number(summary[2]),
        };
        assert.ok(sqlSummary.files > 0 && sqlSummary.assertions > 0);
        for (const value of [
          state.applicationPassword,
          state.fixturePassword,
          state.authAdminKey,
          state.migrationUrl,
        ])
          if (value)
            assert.ok(!api.output.includes(value), 'API_SECRET_IN_LOG');
        assert.ok(
          !api.output.includes('DASHBOARD_HIDDEN_SENTINEL'),
          'HIDDEN_TEST_IN_LOG',
        );
      } catch (error) {
        let diagnostic = `${error.output ?? error.stack ?? error.message}\n${api.output}`;
        for (const field of [
          'applicationPassword',
          'fixturePassword',
          'authAdminKey',
          'migrationUrl',
          'publishableKey',
        ])
          if (state[field])
            diagnostic = diagnostic.split(state[field]).join('[redacted]');
        error.output = redactDiagnostics(diagnostic);
        throw error;
      } finally {
        await api.stop();
      }
    });
    verified = await captureSignalCandidate(
      `governance-phase-http-${runId}-end`,
    );
    assert.equal(
      verified.sourceDigest,
      candidate.sourceDigest,
      'CANDIDATE_CHANGED_DURING_HTTP',
    );
  } catch (error) {
    failure = error;
    if (cases.length === 0) {
      try {
        const observed = JSON.parse(await readFile(jestPath, 'utf8'));
        cases = observed.testResults.flatMap((suite) =>
          suite.assertionResults.map((item) => ({
            id: item.fullName.match(/\bIMP06-PHASE-\d{2}\b/)?.[0] ?? 'UNKNOWN',
            status: ['passed', 'failed', 'pending', 'skipped', 'todo'].includes(
              item.status,
            )
              ? item.status
              : 'failed',
            durationMs: Number.isFinite(item.duration) ? item.duration : null,
          })),
        );
      } catch {
        /* Missing/invalid output remains unverified, never a pass. */
      }
    }
    await writeFile(
      join(directory, 'error.log'),
      redactDiagnostics(error.output ?? error.stack ?? error.message),
      { mode: 0o600 },
    );
  }
  const summary = {
    schemaVersion: 1,
    increment: 'IMP-06.07',
    suite: 'governance-phase',
    evidenceSurface: 'http',
    environment: 'LAB TEST',
    projectId: 'alunza-edu-laboratorio-test',
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceDigestBefore: candidate?.sourceDigest ?? null,
    sourceDigestAfter: verified?.sourceDigest ?? null,
    status: failure ? 'failed' : 'passed',
    cleanup: failure ? 'not-certified' : 'completed',
    cases,
    counts: {
      total: cases.length,
      passed: cases.filter((item) => item.status === 'passed').length,
      failed: cases.filter((item) => item.status === 'failed').length,
      pending: cases.filter((item) => ['pending', 'todo'].includes(item.status))
        .length,
      skipped: cases.filter((item) => item.status === 'skipped').length,
    },
    sql: sqlSummary ?? { status: 'not-completed' },
    scopes,
    scenarioIds: inventory.acceptanceMatrix
      .filter((row) => row.evidence.some((item) => item.suite === 'http'))
      .map((row) => row.scenarioId),
    remoteProvidersUsed: false,
    integralCiExecuted: false,
  };
  await report('governance-phase-integration', summary, 'imp-06');
  if (failure) throw new Error('GOVERNANCE_PHASE_INTEGRATION_FAILED');
  return summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await runGovernancePhaseIntegration();
    console.log(
      'IMP-06.07: seis recorridos HTTP y regresiones SQL aprobados en LAB TEST.',
    );
  } catch {
    console.error(
      'La integración de gobierno falló; consultar sus evidencias privadas por ejecución.',
    );
    process.exitCode = 1;
  }
}
