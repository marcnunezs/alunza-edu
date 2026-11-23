import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, run, cli, redactDiagnostics } from './local.mjs';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';
import {
  createAuditExportHarness,
  auditPrivateSentinel,
} from '../tests/e2e/audit-fixture.mjs';

async function verifyRecovery(api, state, baseUrl) {
  const harness = createAuditExportHarness(state);
  try {
    const scope = await harness.prepare();
    const key = 'audit-export-restart-recovery';
    const created = await harness.create(scope, { key });
    assert.equal(created.status, 201);
    const bytes = await harness.content(scope, created.data.exportId);
    assert.equal(bytes.status, 200);
    await api.stop();
    await api.start(`${baseUrl}/health/ready`);
    const replay = await harness.create(scope, { key });
    assert.equal(replay.status, 201);
    assert.deepEqual(replay.data, created.data);
    const recovered = await harness.content(scope, created.data.exportId);
    assert.equal(recovered.status, 200);
    assert.ok(
      recovered.bytes.equals(bytes.bytes),
      'AUDIT_EXPORT_RESTART_BYTES_CHANGED',
    );
    assert.ok(!api.output.includes(auditPrivateSentinel));
    return {
      restartRecovery: true,
      sameResource: true,
      byteIdentical: true,
      hash: created.data.sha256,
      rows: created.data.rowCount,
    };
  } finally {
    await harness.close();
  }
}

async function verifyObservation(api, state) {
  const harness = createAuditExportHarness(state);
  try {
    const scope = await harness.prepare();
    const created = await harness.create(scope);
    assert.equal(created.status, 201);
    const path = `/organizations/${scope.organizationId}/audit-exports/${created.data.exportId}`;
    const expected = [
      { response: created, outcome: 'SUCCEEDED', visible: true },
    ];
    for (const [url, options, status, outcome, visible] of [
      [path, {}, 200, 'SUCCEEDED', true],
      [`${path}/content`, { method: 'HEAD' }, 200, 'SUCCEEDED', true],
      [
        `/organizations/${scope.organizationId}/audit-exports`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': 'audit-export-log-invalid' },
          body: { asOf: scope.asOf, includePrivate: auditPrivateSentinel },
        },
        422,
        'INVALID',
        false,
      ],
      [path, { actor: 'foreignAdmin' }, 404, 'DENIED', false],
      [
        path,
        { headers: { Authorization: 'Bearer invalid-token' } },
        401,
        'DENIED',
        false,
      ],
    ]) {
      const response = await harness.request(scope, url, options);
      assert.equal(response.status, status);
      expected.push({ response, outcome, visible });
    }
    await api.stop();
    const entries = api.output.split(/\r?\n/).flatMap((line) => {
      try {
        const event = JSON.parse(line);
        return event.event === 'audit.export' ? [event] : [];
      } catch {
        return [];
      }
    });
    const allowed = [
      'timestamp',
      'environment',
      'release',
      'method',
      'path',
      'requestId',
      'status',
      'durationMs',
      'event',
      'outcome',
      'actorId',
      'organizationId',
    ];
    for (const check of expected) {
      const matches = entries.filter(
        (entry) => entry.requestId === check.response.requestId,
      );
      assert.equal(matches.length, 1, 'AUDIT_EXPORT_LOG_COUNT');
      const event = matches[0];
      assert.ok(
        Object.keys(event).every((key) => allowed.includes(key)),
        'AUDIT_EXPORT_LOG_ALLOWLIST',
      );
      assert.match(
        event.path,
        /^\/api\/v1\/organizations\/:orgId\/audit-exports(?:\/:exportId(?:\/content)?)?$/,
      );
      assert.equal(event.status, check.response.status);
      assert.equal(event.outcome, check.outcome);
      assert.equal(
        event.organizationId,
        check.visible ? scope.organizationId : undefined,
      );
      if (event.status === 401) assert.equal(event.actorId, undefined);
      else assert.match(event.actorId, /^[a-f0-9-]{36}$/);
      assert.ok(!JSON.stringify(event).includes(auditPrivateSentinel));
    }
    return {
      checked: expected.length,
      correlated: true,
      allowlist: true,
      unauthorizedScopeOmitted: true,
      secretFree: true,
    };
  } finally {
    await harness.close();
  }
}

try {
  await withTestEnvironment(async ({ ctx, state }) => {
    const api = testApi(ctx, state);
    try {
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
          'tests/integration/zzzzzzzzzzzzzzzzzz-audit-export.test.cjs',
          'tests/integration/zzzzzzzzzzzzzzzzz-audit.test.cjs',
        ],
        {
          env: {
            ALUNZA_TEST_STATE: ctx.statePath,
            ALUNZA_TEST_API_URL: baseUrl,
          },
        },
      );
      console.log(redactDiagnostics(result.stdout + result.stderr));
      const recovery = await verifyRecovery(api, state, baseUrl);
      const observation = await verifyObservation(api, state);
      const sql = await cli(ctx, ['test', 'db']);
      console.log(redactDiagnostics(sql.stdout + sql.stderr));
      await report(
        'audit-export-integration',
        {
          status: 'passed',
          increment: 'IMP-06.06',
          environment: ctx.projectId,
          integration: (result.stdout + result.stderr).match(
            /^Tests:.*$/m,
          )?.[0],
          sql: (sql.stdout + sql.stderr).match(/Files=\d+,\s*Tests=\d+/)?.[0],
          recovery,
          observation,
        },
        'imp-06',
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
} catch (error) {
  const directory = join(root, '.local/evidence/imp-06');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'audit-export-integration-error.log'),
    redactDiagnostics(error.output ?? error.stack ?? error.message),
    { mode: 0o600 },
  );
  await report(
    'audit-export-integration',
    { status: 'failed', increment: 'IMP-06.06' },
    'imp-06',
  );
  console.error(
    'La integración de exportación falló; consultar .local/evidence/imp-06/audit-export-integration-error.log.',
  );
  process.exitCode = 1;
}
