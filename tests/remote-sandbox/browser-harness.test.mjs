import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, unlink, rmdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  planBrowserStage,
  preflightBrowserStage,
  executeBrowserStage,
  readBrowserFixture,
  verifyBrowserEvidence,
  browserCaseIds,
} from '../../scripts/sandbox-browser-campaign.mjs';
const require = createRequire(import.meta.url);
const stage = {
  id: 'browser',
  kind: 'api',
  fixtures: ['browser-vertical'],
  config: {
    baseUrl: 'https://api.alunza.invalid',
    webOrigin: 'https://web.alunza.invalid',
    fictitiousOnly: true,
  },
};

test('execution uses the supplied environment instead of unrelated process credentials', async () => {
  const keys = [
    'ALUNZA_SANDBOX_BROWSER_FIXTURES_FILE',
    'ALUNZA_SANDBOX_API_DATABASE_URL',
    'ALUNZA_SANDBOX_API_DATABASE_CA_FILE',
  ];
  const original = keys.map((key) => process.env[key]);
  try {
    for (const key of keys) process.env[key] = 'unrelated-process-value';
    const result = await executeBrowserStage(stage, { env: {}, campaign: {} });
    assert.equal(result.status, 'BLOCKED');
    assert.ok(
      result.blockers.includes(
        'PRIVATE_BROWSER_FIXTURES_AND_LIMITED_DATABASE_REQUIRED',
      ),
    );
    assert.equal(
      result.blockers.includes('INVALID_PRIVATE_BROWSER_CONFIGURATION'),
      false,
    );
  } finally {
    keys.forEach((key, index) => {
      if (original[index] === undefined) delete process.env[key];
      else process.env[key] = original[index];
    });
  }
});

test('browser stage is exclusive and budgets four creations independently from HTTP requests', () => {
  const plan = planBrowserStage(stage);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.creations, 4);
  assert.equal(plan.normalRequests, 320);
  assert.equal(plan.clientRequests, 240);
  assert.equal(plan.cases.length, 8);
  for (const changed of [
    { ...stage, fixtures: ['browser-vertical', 'run-success'] },
    { ...stage, kind: 'performance' },
  ])
    assert.ok(
      planBrowserStage(changed).blockers.includes(
        'EXCLUSIVE_BROWSER_VERTICAL_REQUIRED',
      ),
    );
  for (const webOrigin of [
    'http://localhost:3300',
    'https://user:secret@web.alunza.invalid',
    'https://web.alunza.invalid/path',
  ])
    assert.ok(
      planBrowserStage({
        ...stage,
        config: { ...stage.config, webOrigin },
      }).blockers.includes('BROWSER_STAGE_CONFIGURATION_REQUIRED'),
    );
});

test('preflight and blocked execution never contact a service', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('Network forbidden in local control tests');
  };
  try {
    const preflight = await preflightBrowserStage(stage, {});
    assert.ok(
      preflight.blockers.includes(
        'PRIVATE_BROWSER_FIXTURES_AND_LIMITED_DATABASE_REQUIRED',
      ),
    );
    const execution = await executeBrowserStage(
      { ...stage, fixtures: [] },
      { campaign: {} },
    );
    assert.equal(execution.status, 'BLOCKED');
    assert.deepEqual(execution.cases, []);
  } finally {
    globalThis.fetch = original;
  }
});

test('private fixture destination, actor and expiration are checked locally without secret diagnostics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alunza-browser-test-'));
  const path = join(directory, 'fixture.json'),
    actorId = randomUUID();
  const secret = 'PRIVATE_TOKEN_MUST_NOT_APPEAR';
  const fixture = {
    schemaVersion: 1,
    environment: 'preproduction',
    fictitiousOnly: true,
    ...stage.config,
    supabaseHost: 'fixture.supabase.co',
    actorId,
    activityId: randomUUID(),
    assignmentId: randomUUID(),
    exerciseVersionId: randomUUID(),
    actorSession: {
      access_token: secret,
      refresh_token: secret,
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: { id: actorId },
    },
    successfulCode: 'module.exports.solve=()=>true;',
    failingCode: 'module.exports.solve=()=>false;',
    privateSentinels: ['PRIVATE_HIDDEN_SENTINEL'],
  };
  try {
    await writeFile(path, JSON.stringify(fixture), { mode: 0o600 });
    const loaded = await readBrowserFixture(stage, {
      ALUNZA_SANDBOX_BROWSER_FIXTURES_FILE: path,
    });
    assert.equal(loaded.actorSession.access_token, secret);
    for (const invalid of [
      { ...fixture, webOrigin: 'https://other.alunza.invalid' },
      { ...fixture, actorId: randomUUID() },
      { ...fixture, actorSession: { ...fixture.actorSession, expires_at: 1 } },
    ]) {
      await writeFile(path, JSON.stringify(invalid));
      await assert.rejects(
        readBrowserFixture(stage, {
          ALUNZA_SANDBOX_BROWSER_FIXTURES_FILE: path,
        }),
        (error) =>
          error.message === 'INVALID_PRIVATE_BROWSER_CONFIGURATION' &&
          !String(error).includes(secret),
      );
    }
  } finally {
    await unlink(path);
    await rmdir(directory);
  }
});

function evidence() {
  const runId = randomUUID(),
    executionIds = Array.from({ length: 4 }, () => randomUUID()),
    attemptIds = Array.from({ length: 3 }, () => randomUUID());
  const observations = browserCaseIds.slice(0, -1).map((id) => ({ id }));
  Object.assign(observations[0], {
    executionId: executionIds[0],
    diagnosis: 'FAILED_TEST',
  });
  Object.assign(observations[2], {
    executionId: executionIds[1],
    attemptId: attemptIds[0],
    diagnosis: 'FAILED_TEST',
  });
  Object.assign(observations[3], {
    executionId: executionIds[2],
    attemptId: attemptIds[1],
    diagnosis: 'SUCCESS',
  });
  Object.assign(observations[5], {
    executionId: executionIds[3],
    attemptId: attemptIds[2],
    previousAttemptId: attemptIds[0],
    diagnosis: 'SUCCESS',
  });
  Object.assign(observations[6], { clientRequests: 40 });
  return {
    runId,
    report: {
      schemaVersion: 1,
      runId,
      status: 'PASS',
      total: 1,
      passed: 1,
      failed: 0,
      pending: 0,
      skipped: 0,
      browser: 'electron',
      browserVersion: '130.0',
      observations,
    },
    baseline: {
      creations: 0,
      normalRequests: 0,
      totalRequests: 0,
      resources: [],
    },
    final: {
      creations: 4,
      normalRequests: 20,
      totalRequests: 40,
      resources: executionIds.map((executionId, index) => ({
        executionId,
        providerResourceId: `sbx_${index}`,
        creationState: 'CONFIRMED',
        cleanupState: 'VERIFIED',
        lifecycleStatus: 'COMPLETED',
        mode: index === 0 ? 'RUN' : 'SUBMIT',
      })),
    },
  };
}
test('final approval binds exact UI executions to four distinct remote sessions and verified cleanup', () => {
  const value = evidence();
  assert.equal(
    verifyBrowserEvidence(
      value.report,
      value.runId,
      value.baseline,
      value.final,
    ).length,
    8,
  );
  for (const mutate of [
    (item) => {
      item.report.pending = 1;
    },
    (item) => {
      item.report.runId = randomUUID();
    },
    (item) => {
      item.report.observations.pop();
    },
    (item) => {
      item.report.observations[5].previousAttemptId = randomUUID();
    },
    (item) => {
      item.final.resources[0].cleanupState = 'PENDING';
    },
    (item) => {
      item.final.resources[0].executionId = randomUUID();
    },
    (item) => {
      item.final.resources[1].providerResourceId =
        item.final.resources[0].providerResourceId;
    },
    (item) => {
      item.final.creations = 5;
    },
    (item) => {
      item.final.normalRequests = 321;
    },
  ]) {
    const invalid = evidence();
    mutate(invalid);
    assert.throws(() =>
      verifyBrowserEvidence(
        invalid.report,
        invalid.runId,
        invalid.baseline,
        invalid.final,
      ),
    );
  }
});

test('remote Cypress config cannot inherit local service control, retries or media capture', async () => {
  const config = require('./cypress.config.cjs');
  assert.equal(config.video, false);
  assert.equal(config.screenshotOnRunFailure, false);
  assert.equal(config.retries, 0);
  assert.equal(config.e2e.supportFile, false);
  assert.equal(
    config.e2e.specPattern,
    'tests/remote-sandbox/browser-vertical.cy.ts',
  );
  assert.equal(
    (await readFile('cypress.config.cjs', 'utf8')).includes(
      'tests/remote-sandbox',
    ),
    false,
  );
});
