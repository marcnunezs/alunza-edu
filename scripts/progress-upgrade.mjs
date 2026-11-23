import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
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
import { createDashboardHarness } from '../tests/e2e/dashboard-fixture.mjs';

const require = createRequire(import.meta.url);
const fromVersion = '20261026163925';
const toVersion = '20261026220133';
const migration = `${toVersion}_dashboard_summary_projection.sql`;
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stripObservedAt = (value) =>
  JSON.parse(
    JSON.stringify(value, (key, item) =>
      key === 'observedAt' ? undefined : item,
    ),
  );

// Only constant identifiers form this query. Canonical payloads remain in memory;
// reports contain hashes and counts, never student code or hidden runner results.
async function canonicalSnapshot(client, organizationId) {
  const scoped = 'x.organization_id=$1';
  const laneScoped = 'x.lane_id IN (SELECT id FROM lanes)';
  const sources = [
    ['attempts', 'app.attempts', 'x.id', scoped],
    ['events', 'app_private.attempt_events', 'x.id', scoped],
    [
      'observations',
      'app_private.student_activity_observations',
      'x.id',
      scoped,
    ],
    ['help', 'app_private.help_events', 'x.id', scoped],
    ['helpRequests', 'app.feedback_requests', 'x.id', scoped],
    ['feedbacks', 'app.feedbacks', 'x.id', scoped],
    ['rules', 'app.signal_rule_versions', 'x.id', scoped],
    ['ruleScopes', 'app_private.signal_rule_scopes', 'x.type', scoped],
    [
      'ruleOperations',
      'app_private.signal_rule_operations',
      'x.actor_id,x.operation,x.key',
      scoped,
    ],
    ['lanes', 'app_private.signal_lanes', 'x.id', scoped],
    ['jobs', 'app_private.signal_jobs', 'x.lane_id', laneScoped],
    ['snapshots', 'app_private.signal_snapshots', 'x.id', laneScoped],
    ['evaluations', 'app_private.signal_evaluations', 'x.id', laneScoped],
    ['episodes', 'app_private.signal_episodes', 'x.id', laneScoped],
    ['reviews', 'app_private.signal_reviews', 'x.id', laneScoped],
    [
      'witnesses',
      'app_private.signal_witnesses',
      'x.lane_id,x.rule_version_id,x.witness_key',
      laneScoped,
    ],
    [
      'episodeEvaluations',
      'app_private.signal_episode_evaluations',
      'x.episode_id,x.evaluation_id',
      'x.episode_id IN (SELECT id FROM app_private.signal_episodes WHERE lane_id IN (SELECT id FROM lanes))',
    ],
    [
      'projections',
      'app_private.signal_projections',
      'x.episode_id',
      laneScoped,
    ],
    [
      'acks',
      'app_private.signal_change_acks',
      'x.lane_id,x.change_id',
      laneScoped,
    ],
    [
      'finalizeReceipts',
      'app_private.signal_finalize_receipts',
      'x.lane_id,x.lease_token,x.snapshot_id',
      laneScoped,
    ],
    [
      'rebuildReceipts',
      'app_private.signal_rebuild_receipts',
      'x.id',
      laneScoped,
    ],
    ['coverage', 'app_private.signal_coverage_epochs', 'x.id', 'true'],
    [
      'captureRegistry',
      'app_private.signal_capture_registry',
      'x.source',
      'true',
    ],
    // The exclusive TEST fixture preserves all clocks and producer changes;
    // catalog reads must not require executing private worker helpers as postgres.
    [
      'clocks',
      'app_private.signal_evidence_clocks',
      'x.component,x.scope_key',
      'true',
    ],
    ['inputChanges', 'app_private.signal_input_changes', 'x.id', 'true'],
    ['audit', 'app.audit_events', 'x.id', scoped],
  ];
  const entries = sources.map(
    ([name, table, order, predicate]) =>
      `'${name}',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY ${order}),'[]'::jsonb) FROM ${table} x WHERE ${predicate})`,
  );
  const result = await client.query(
    `WITH lanes AS MATERIALIZED (SELECT id FROM app_private.signal_lanes WHERE organization_id=$1)
    SELECT jsonb_build_object(${entries.join(',')}) AS value`,
    [organizationId],
  );
  return result.rows[0].value;
}

// Catalog metadata only. postgres may retain Supabase's ADMIN-only membership;
// neither inherited privileges nor SET ROLE are acceptable runtime grants.
async function authorizationSnapshot(client) {
  const result = await client.query(`SELECT jsonb_build_object(
    'memberships',(
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'member',member_role.rolname,'role',granted_role.rolname,'grantor',grantor_role.rolname,
        'adminOption',m.admin_option,'inheritOption',m.inherit_option,'setOption',m.set_option
      ) ORDER BY grantor_role.rolname),'[]'::jsonb)
      FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member
      JOIN pg_roles granted_role ON granted_role.oid=m.roleid JOIN pg_roles grantor_role ON grantor_role.oid=m.grantor
      WHERE member_role.rolname='postgres' AND granted_role.rolname='alunza_identity'),
    'canSetRole',pg_has_role('postgres','alunza_identity','SET'),
    'canInheritPrivileges',pg_has_role('postgres','alunza_identity','USAGE'),
    'isMember',pg_has_role('postgres','alunza_identity','MEMBER'),
    'functions',(
      SELECT jsonb_agg(jsonb_build_object('name',p.proname,
        'arguments',pg_get_function_identity_arguments(p.oid),'owner',owner.rolname,
        'acl',p.proacl,'securityDefiner',p.prosecdef,'volatility',p.provolatile,
        'configuration',p.proconfig) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles owner ON owner.oid=p.proowner
      WHERE n.nspname='app_private' AND (p.proname LIKE 'dashboard_%' OR p.proname IN
        ('student_progress','student_progress_observed','progress_observations','signal_lane_clock_keys','signal_current_vector'))),
    'tables',(
      SELECT jsonb_agg(jsonb_build_object('name',c.relname,'owner',owner.rolname,
        'acl',c.relacl,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity) ORDER BY c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles owner ON owner.oid=c.relowner
      WHERE n.nspname='app_private' AND c.relname IN
        ('signal_evidence_clocks','signal_input_changes','signal_change_acks','signal_lanes','signal_jobs','signal_evaluations'))
  ) AS value`);
  const value = result.rows[0].value;
  assert.equal(value.canSetRole, false, 'PHASE_UPGRADE_POSTGRES_CAN_SET_ROLE');
  assert.equal(
    value.canInheritPrivileges,
    false,
    'PHASE_UPGRADE_POSTGRES_INHERITS_IDENTITY',
  );
  assert.ok(
    value.memberships.every(
      (membership) => !membership.inheritOption && !membership.setOption,
    ),
    'PHASE_UPGRADE_MEMBERSHIP_EXCEEDS_ADMIN_ONLY',
  );
  return value;
}

async function migrationVersion(client) {
  return (
    await client.query(
      'SELECT max(version) AS version FROM supabase_migrations.schema_migrations',
    )
  ).rows[0].version;
}

async function publicSnapshot(harness, scope, cut) {
  const contracts = require('@alunza/contracts');
  const query = (options = {}) =>
    new URLSearchParams({ asOf: cut, ...options }).toString();
  const prefix = `/classes/${scope.classroomId}`;
  async function read(path, schema, actor = 'teacher') {
    const response = await harness.request(path, { actor });
    assert.equal(response.status, 200, 'PHASE_UPGRADE_PUBLIC_READ_FAILED');
    assert.equal(response.noStore, true, 'PHASE_UPGRADE_PUBLIC_CACHE_POLICY');
    schema.parse({ data: response.data, requestId: response.requestId });
    return response.data;
  }
  const dashboard = await read(
    `${prefix}/dashboard?${query()}`,
    contracts.dashboardResponseSchema,
  );
  const evidence = {};
  for (const kind of ['ATTEMPT', 'COMPLETION', 'EVENT', 'HINT'])
    evidence[kind] = await read(
      `${prefix}/dashboard/evidence?${query({ kind, limit: '100' })}`,
      contracts.dashboardEvidenceResponseSchema,
    );
  const signals = await read(
    `${prefix}/signals?${query({ state: 'ALL', limit: '100' })}`,
    contracts.dashboardSignalsResponseSchema,
  );
  const details = [];
  for (const signal of signals.data)
    details.push(
      await read(
        `${prefix}/signals/${signal.id}?${query()}`,
        contracts.dashboardSignalDetailResponseSchema,
      ),
    );
  const progress = await read(
    `/me/progress?${query({ classId: scope.classroomId, limit: '100' })}`,
    contracts.studentProgressResponseSchema,
    'student',
  );
  return stripObservedAt({ dashboard, evidence, signals, details, progress });
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

// withTestEnvironment owns TEST and applies the real additive migration between
// preparation and this returned verifier. Neither helper resets or migrates DB.
export async function prepareProgressUpgrade({ ctx, state }) {
  assertRuntimeTarget(state, testTarget);
  assert.equal(ctx.projectId, testTarget.projectId);
  const owner = new pg.Client({ connectionString: state.migrationUrl });
  await owner.connect();
  let api, harness;
  try {
    assert.equal(await migrationVersion(owner), fromVersion);
    const authorizationBefore = await authorizationSnapshot(owner);
    await buildApi();
    api = testApi(ctx, state, ctx.webPort, {
      SIGNALS_WORKER_ENABLED: 'false',
      INVITATION_WORKER_ENABLED: 'false',
      MATERIALS_WORKER_ENABLED: 'false',
    });
    await api.start(`http://127.0.0.1:${ctx.apiPort}/health/ready`);
    harness = await createDashboardHarness(state);
    const scope = await harness.prepare({ signals: true });
    const history = await harness.historical(scope);
    assert.ok(history.reviewedId);
    const opening = await harness.request(
      `/activities/${scope.activityIds[0]}/open-events`,
      { actor: 'student', method: 'POST', body: {} },
    );
    assert.equal(opening.status, 201);
    assert.deepEqual(await harness.help(scope), {
      feedbackViews: 1,
      deliveredHints: 0,
      status: 'NO_EVIDENCE',
    });
    await harness.processSignals(scope);
    const cut = (
      await owner.query(
        'SELECT app_private.signal_instant(clock_timestamp()) AS value',
      )
    ).rows[0].value;
    const before = await canonicalSnapshot(owner, scope.organizationId);
    assert.equal(before.attempts.length, 6);
    assert.equal(before.observations.length, 1);
    assert.equal(before.help.length, 2);
    assert.equal(before.reviews.length, 1);
    assert.ok(before.coverage.length > 0);
    assert.ok(before.acks.length > 0);
    assert.ok(before.audit.length > 0);
    const beforeDigest = digest(before);
    const publicBefore = await publicSnapshot(harness, scope, cut);
    assert.equal(publicBefore.dashboard.summary.completed, 1);
    assert.equal(publicBefore.dashboard.summary.required, 6);
    assert.equal(publicBefore.progress.summary.completed, 1);
    assert.equal(publicBefore.progress.summary.required, 3);
    assert.equal(publicBefore.progress.observation.summary.attempts, 6);
    assert.equal(publicBefore.signals.data.length, 2);
    assert.ok(
      publicBefore.signals.data.some(
        (signal) =>
          signal.id === history.reviewedId && signal.state === 'REVIEWED',
      ),
    );
    assert.ok(
      publicBefore.signals.data.some(
        (signal) => signal.state === 'ACTIVE' && signal.stoppedAt !== null,
      ),
    );
    assert.equal(
      digest(await canonicalSnapshot(owner, scope.organizationId)),
      beforeDigest,
      'PHASE_UPGRADE_BASELINE_READ_CHANGED_FACTS',
    );
    const publicBeforeDigest = digest(publicBefore);
    const preserved = Object.fromEntries(
      Object.entries(before).map(([name, rows]) => [name, rows.length]),
    );

    return async function verifyProgressUpgrade() {
      const current = await readState(ctx);
      assertRuntimeTarget(current, testTarget);
      const client = new pg.Client({ connectionString: current.migrationUrl });
      await client.connect();
      let upgradedApi, reader;
      try {
        assert.equal(await migrationVersion(client), toVersion);
        const authorizationAfter = await authorizationSnapshot(client);
        assert.deepEqual(
          authorizationAfter,
          authorizationBefore,
          'PHASE_UPGRADE_CHANGED_ROLE_GRAPH_OR_ACLS',
        );
        const afterDigest = digest(
          await canonicalSnapshot(client, scope.organizationId),
        );
        assert.equal(afterDigest, beforeDigest, 'PHASE_UPGRADE_CHANGED_FACTS');
        upgradedApi = testApi(ctx, current, ctx.webPort, {
          SIGNALS_WORKER_ENABLED: 'false',
          INVITATION_WORKER_ENABLED: 'false',
          MATERIALS_WORKER_ENABLED: 'false',
          HELP_WORKER_ENABLED: 'false',
        });
        await upgradedApi.start(`http://127.0.0.1:${ctx.apiPort}/health/ready`);
        reader = await createDashboardHarness(current);
        const publicAfter = await publicSnapshot(reader, scope, cut);
        const publicAfterDigest = digest(publicAfter);
        assert.equal(
          publicAfterDigest,
          publicBeforeDigest,
          'PHASE_UPGRADE_CHANGED_PUBLIC_DTOS',
        );
        assert.equal(
          digest(await canonicalSnapshot(client, scope.organizationId)),
          beforeDigest,
          'PHASE_UPGRADE_PUBLIC_READ_CHANGED_FACTS',
        );
        return {
          status: 'passed',
          from: fromVersion,
          to: toVersion,
          migration,
          asOf: cut,
          beforeDigest,
          afterDigest,
          publicBeforeDigest,
          publicAfterDigest,
          preserved,
          authorizationBefore,
          authorizationAfter,
          roleGraphAndAclsPreserved: true,
          publicSurfaces: [
            'dashboard',
            'evidence:ATTEMPT/COMPLETION/EVENT/HINT',
            'signals:ALL',
            'signal-details',
            'student-progress',
          ],
          publicDtoComparison: 'Exact data equality excluding only observedAt',
          publicReadsUsedAuthenticatedHttp: true,
          canonicalSubmissionWithStagedTestResult: true,
          activityOpeningAndFallbackAckUsedRealTestApi: true,
          remoteProvidersUsed: false,
        };
      } catch (error) {
        throw preserveDiagnostic(error, current, upgradedApi);
      } finally {
        await upgradedApi?.stop();
        await reader?.close();
        await client.end();
      }
    };
  } catch (error) {
    throw preserveDiagnostic(error, state, api);
  } finally {
    await api?.stop();
    await harness?.close();
    await owner.end();
  }
}

export async function runProgressUpgrade() {
  try {
    return await withTestEnvironment(
      async ({ upgrade }) => {
        assert.ok(upgrade, 'PHASE_UPGRADE_REPORT_MISSING');
        await report('phase-migration-upgrade', upgrade, 'imp-05');
        return upgrade;
      },
      [],
      {
        upgradeFromVersion: fromVersion,
        beforeUpgrade: prepareProgressUpgrade,
      },
    );
  } catch (error) {
    const directory = join(root, '.local/evidence/imp-05-08');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'phase-upgrade-error.log'),
      redactDiagnostics(error.output ?? error.stack ?? error.message),
      { mode: 0o600 },
    );
    await report(
      'phase-migration-upgrade',
      { status: 'failed', from: fromVersion, to: toVersion, migration },
      'imp-05',
    );
    throw new Error(
      'La actualización .07 → .08 falló; revisar el diagnóstico local saneado.',
      { cause: error },
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  runProgressUpgrade()
    .then(() => {
      console.log(
        'Actualización .07 → .08: hechos, historia, checkpoints y DTO públicos preservados.',
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
