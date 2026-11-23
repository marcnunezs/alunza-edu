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
  createAuditHarness,
  auditPrivateSentinel,
} from '../tests/e2e/audit-fixture.mjs';

async function verifyObservation(api, state) {
  const harness = createAuditHarness(state);
  try {
    const scope = await harness.prepare();
    const path = `/organizations/${scope.organizationId}/audit-events`;
    const cases = [
      [path, {}, 200, 'SUCCEEDED', true],
      [`${path}?action=fixture.unmatched`, {}, 200, 'SUCCEEDED', true],
      [
        `${path}?includePrivate=${auditPrivateSentinel}`,
        {},
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
    ];
    const expected = [];
    for (const [url, options, status, outcome, organizationVisible] of cases) {
      const response = await harness.request(scope, url, options);
      assert.equal(response.status, status);
      expected.push({
        requestId: response.requestId,
        status,
        outcome,
        organizationVisible,
      });
    }
    await api.stop();
    const events = api.output.split(/\r?\n/).flatMap((line) => {
      try {
        const event = JSON.parse(line);
        return event.event === 'audit.query' ? [event] : [];
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
      const matches = events.filter(
        (event) => event.requestId === check.requestId,
      );
      assert.equal(matches.length, 1, 'AUDIT_QUERY_LOG_COUNT');
      const event = matches[0];
      assert.ok(
        Object.keys(event).every((key) => allowed.includes(key)),
        'AUDIT_QUERY_LOG_FIELDS',
      );
      assert.equal(event.path, '/api/v1/organizations/:orgId/audit-events');
      assert.equal(event.outcome, check.outcome);
      assert.equal(event.status, check.status);
      assert.equal(
        event.organizationId,
        check.organizationVisible ? scope.organizationId : undefined,
      );
      if (check.status === 401) assert.equal(event.actorId, undefined);
      else assert.match(event.actorId, /^[a-f0-9-]{36}$/);
      assert.ok(!JSON.stringify(event).includes(auditPrivateSentinel));
    }
    return {
      checked: expected.length,
      correlated: true,
      allowlist: true,
      secretFree: true,
      unauthorizedScopeOmitted: true,
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
      const observation = await verifyObservation(api, state);
      const sql = await cli(ctx, ['test', 'db']);
      console.log(redactDiagnostics(sql.stdout + sql.stderr));
      await report(
        'audit-integration',
        {
          status: 'passed',
          environment: ctx.projectId,
          integration: (result.stdout + result.stderr).match(
            /^Tests:.*$/m,
          )?.[0],
          sql: (sql.stdout + sql.stderr).match(/Files=\d+,\s*Tests=\d+/)?.[0],
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
    join(directory, 'audit-integration-error.log'),
    redactDiagnostics(error.output ?? error.stack ?? error.message),
    { mode: 0o600 },
  );
  await report('audit-integration', { status: 'failed' }, 'imp-06');
  console.error(
    'La integración de auditoría falló; consultar .local/evidence/imp-06/audit-integration-error.log.',
  );
  process.exitCode = 1;
}
