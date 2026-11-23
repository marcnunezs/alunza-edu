import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL, URLSearchParams } from 'node:url';
import pg from 'pg';
import { root, readState, redactDiagnostics } from './local.mjs';
import { testTarget, assertRuntimeTarget } from './local-target.mjs';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';
import { createAuditHarness } from '../tests/e2e/audit-fixture.mjs';
import { createStudentDetailHarness } from '../tests/e2e/student-detail-fixture.mjs';
import { signalReviewFacts } from '../tests/integration/helpers/signal-review.mjs';

const fromVersion = '20261101172048',
  toVersion = '20261102233927';
const migration = `${toVersion}_audit_read.sql`;
const workersDisabled = {
  SIGNALS_WORKER_ENABLED: 'false',
  INVITATION_WORKER_ENABLED: 'false',
  MATERIALS_WORKER_ENABLED: 'false',
  HELP_WORKER_ENABLED: 'false',
};
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function schemaState(db) {
  return (
    await db.query(`SELECT
    (SELECT max(version) FROM supabase_migrations.schema_migrations) AS version,
    to_regprocedure('app_private.audit_events_list(uuid,jsonb)') IS NOT NULL AS audit_present,
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='app_private' AND p.proname='audit_events_list' AND p.prosecdef AND p.provolatile='s'
      AND pg_get_userbyid(p.proowner)='alunza_identity'
      AND has_function_privilege('alunza_app',p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')) AS safe_entrypoint,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='app.audit_events'::regclass AND tgname='audit_append_only' AND tgenabled='O') AS append_only`)
  ).rows[0];
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
export async function prepareAuditUpgrade({ ctx, state }) {
  assertRuntimeTarget(state, testTarget);
  const db = new pg.Client({ connectionString: state.migrationUrl });
  let api, harness, pedagogical;
  try {
    await db.connect();
    const beforeSchema = await schemaState(db);
    assert.equal(beforeSchema.version, fromVersion);
    assert.equal(beforeSchema.audit_present, false);
    assert.equal(beforeSchema.append_only, true);
    await buildApi();
    api = testApi(ctx, state, ctx.webPort, {
      SIGNALS_WORKER_ENABLED: 'false',
      INVITATION_WORKER_ENABLED: 'false',
    });
    await api.start(`${testTarget.apiUrl}/health/live`);
    await api.wait(`${testTarget.apiUrl}/health/ready`, 503);
    harness = createAuditHarness(state);
    const scope = await harness.prepare();
    const update = await harness.request(
      scope,
      `/organizations/${scope.organizationId}`,
      {
        method: 'PATCH',
        headers: { 'If-Match': '"1"' },
        body: { name: 'Auditoría previa a migración .05' },
      },
    );
    assert.equal(update.status, 200);
    pedagogical = await createStudentDetailHarness(state);
    const studentScope = await pedagogical.prepare();
    const signalId = studentScope.signals.find(
      (signal) => signal.state === 'ACTIVE',
    )?.id;
    assert.ok(signalId, 'AUDIT_UPGRADE_REVIEWABLE_SIGNAL');
    const reviewed = await pedagogical.request(`/signals/${signalId}/review`, {
      method: 'PUT',
      body: {},
    });
    assert.equal(reviewed.status, 200);
    const historicalReview = await signalReviewFacts(
      db,
      studentScope,
      signalId,
    );
    assert.equal(historicalReview.reviews.length, 1);
    assert.equal(historicalReview.audits.length, 1);
    await api.stop();
    const before = await harness.snapshot(scope);
    const pedagogicalBefore = await pedagogical.snapshot(studentScope);
    assert.ok(pedagogicalBefore['app.attempts'].count > 0);
    assert.ok(pedagogicalBefore['app.feedbacks'].count > 0);
    assert.ok(pedagogicalBefore.signal_reviews.count > 0);
    assert.equal(before.audit_events.count, 26);
    const organizations = (
      await db.query(
        'SELECT id,code,name,timezone,revision,created_at,updated_at FROM app.organizations WHERE id=ANY($1::uuid[]) ORDER BY id',
        [[scope.organizationId, scope.otherOrganizationId]],
      )
    ).rows;
    return async function verifyAuditUpgrade() {
      let current = state,
        client,
        upgradedApi;
      try {
        current = await readState(ctx);
        assertRuntimeTarget(current, testTarget);
        client = new pg.Client({ connectionString: current.migrationUrl });
        await client.connect();
        const afterSchema = await schemaState(client);
        assert.equal(afterSchema.version, toVersion);
        assert.equal(afterSchema.safe_entrypoint, true);
        assert.equal(afterSchema.append_only, true);
        const after = await harness.snapshot(scope);
        assert.deepEqual(after, before, 'AUDIT_UPGRADE_CHANGED_HISTORY');
        assert.deepEqual(
          await pedagogical.snapshot(studentScope),
          pedagogicalBefore,
          'AUDIT_UPGRADE_CHANGED_PEDAGOGICAL_HISTORY',
        );
        assert.deepEqual(
          await signalReviewFacts(client, studentScope, signalId),
          historicalReview,
          'AUDIT_UPGRADE_CHANGED_REVIEW',
        );
        assert.deepEqual(
          (
            await client.query(
              'SELECT id,code,name,timezone,revision,created_at,updated_at FROM app.organizations WHERE id=ANY($1::uuid[]) ORDER BY id',
              [[scope.organizationId, scope.otherOrganizationId]],
            )
          ).rows,
          organizations,
        );
        upgradedApi = testApi(ctx, current, ctx.webPort, workersDisabled);
        await upgradedApi.start(`${testTarget.apiUrl}/health/ready`);
        const contracts = await import('@alunza/contracts');
        const list = await harness.request(
          scope,
          `/organizations/${scope.organizationId}/audit-events?limit=20`,
        );
        assert.equal(list.status, 200);
        assert.equal(list.noStore, true);
        contracts.auditListResponseSchema.parse(list.body);
        assert.equal(list.data.page.totalFiltered, 26);
        assert.equal(list.data.items[0].action, 'organization.updated');
        const next = await harness.request(
          scope,
          `/organizations/${scope.organizationId}/audit-events?${new URLSearchParams({ asOf: list.data.asOf, limit: 20, cursor: list.data.page.nextCursor })}`,
        );
        assert.equal(next.status, 200);
        contracts.auditListResponseSchema.parse(next.body);
        assert.equal(next.data.items.length, 6);
        const reviewAudit = await harness.request(
          scope,
          `/organizations/${studentScope.organizationId}/audit-events?${new URLSearchParams({ action: 'SIGNAL_REVIEWED', entityId: signalId })}`,
        );
        assert.equal(reviewAudit.status, 200);
        contracts.auditListResponseSchema.parse(reviewAudit.body);
        assert.equal(reviewAudit.data.page.totalFiltered, 1);
        assert.equal(
          reviewAudit.data.items[0].actorId,
          pedagogical.actors.teacher.id,
        );
        const attempt = await pedagogical.request(
          `${pedagogical.path(studentScope)}/attempts/${studentScope.attemptId}?asOf=${encodeURIComponent(studentScope.asOf)}`,
        );
        assert.equal(attempt.status, 200);
        assert.deepEqual(attempt.data.attempt, studentScope.originalAttempt);
        assert.deepEqual(
          await pedagogical.snapshot(studentScope),
          pedagogicalBefore,
          'AUDIT_UPGRADE_READ_CHANGED_PEDAGOGICAL_HISTORY',
        );
        assert.deepEqual(
          await harness.snapshot(scope),
          before,
          'AUDIT_UPGRADE_READ_MUTATED_HISTORY',
        );
        return {
          status: 'passed',
          increment: 'IMP-06.05',
          from: fromVersion,
          to: toVersion,
          migration,
          beforeSchema,
          afterSchema,
          beforeDigest: digest(before),
          afterDigest: digest(after),
          preserved: Object.fromEntries(
            Object.entries(before).map(([name, value]) => [name, value.count]),
          ),
          pedagogicalBeforeDigest: digest(pedagogicalBefore),
          pedagogicalAfterDigest: digest(
            await pedagogical.snapshot(studentScope),
          ),
          pedagogicalPreserved: Object.fromEntries(
            Object.entries(pedagogicalBefore).map(([name, value]) => [
              name,
              value.count,
            ]),
          ),
          readinessBefore: 503,
          readinessAfter: 200,
          authenticatedReadSmoke: true,
          publicMutationAuditPreserved: true,
          historicalReviewPreserved: true,
          fixture:
            '25 synthetic operational events plus organization.updated and SIGNAL_REVIEWED from public mutations; inherited fixture includes Docker submissions, delivered TEST help, deterministic signals and historical review.',
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
          await pedagogical.close();
          await client?.end();
        }
      }
    };
  } catch (error) {
    await harness?.close();
    await pedagogical?.close();
    throw preserveDiagnostic(error, state, api);
  } finally {
    try {
      await api?.stop();
    } finally {
      await db.end();
    }
  }
}
export async function runAuditUpgrade() {
  try {
    return await withTestEnvironment(
      async ({ upgrade }) => {
        assert.ok(upgrade, 'AUDIT_UPGRADE_REPORT_MISSING');
        await report('audit-upgrade', upgrade, 'imp-06');
        return upgrade;
      },
      [],
      { upgradeFromVersion: fromVersion, beforeUpgrade: prepareAuditUpgrade },
    );
  } catch (error) {
    const directory = join(root, '.local/evidence/imp-06');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'audit-upgrade-error.log'),
      redactDiagnostics(error.output ?? error.stack ?? error.message),
      { mode: 0o600 },
    );
    await report(
      'audit-upgrade',
      { status: 'failed', from: fromVersion, to: toVersion, migration },
      'imp-06',
    );
    throw new Error(
      'La actualización de auditoría falló; consultar .local/evidence/imp-06/audit-upgrade-error.log.',
      { cause: error },
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  runAuditUpgrade()
    .then(() =>
      console.log(
        'Actualización IMP-06.04 → IMP-06.05: auditoría previa conservada y consultas verificadas.',
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
