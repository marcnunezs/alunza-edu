import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { z } from 'zod';
import * as contracts from '@alunza/contracts';
import {
  planApiStage,
  verifyApiStageEvidence,
  verifyApiProgress,
} from '../../scripts/sandbox-api-campaign.mjs';

const uuid = (value) =>
  `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const stage = {
  kind: 'api',
  config: { baseUrl: 'https://api.alunza.invalid', fictitiousOnly: true },
};
const campaignId = uuid(900);
const resource = (index, mode = index < 4 ? 'RUN' : 'SUBMIT') => ({
  executionId: uuid(index),
  creationId: uuid(index + 100),
  sandboxName: `alunza-practice-${uuid(index)}`,
  providerResourceId: `session-${index}`,
  creationState: 'CONFIRMED',
  cleanupState: 'VERIFIED',
  lifecycleStatus: 'COMPLETED',
  mode,
});
const baseline = () => ({
  campaignId,
  creations: 0,
  normalRequests: 0,
  totalRequests: 0,
  resources: [],
});
const finalEvidence = () => ({
  campaignId,
  creations: 6,
  normalRequests: 60,
  totalRequests: 90,
  resources: Array.from({ length: 6 }, (_, index) => resource(index + 1)),
});
const executions = () =>
  finalEvidence().resources.map(({ executionId, mode }) => ({
    executionId,
    mode,
  }));
const progress = (completed = 0, evidenceState = 'NO_ATTEMPTS') => ({
  requestId: uuid(800),
  data: {
    activityId: uuid(700),
    completed,
    required: 1,
    ratio: completed,
    evidenceState,
    asOf: '2026-11-04T00:00:00Z',
  },
});

describe('API evidence gates do not approve unrelated executions or previous progress', () => {
  test('matches every new result to its own distinct cleaned session', () => {
    expect(
      verifyApiStageEvidence(stage, baseline(), finalEvidence(), executions()),
    ).toEqual({
      creations: 6,
      normalRequests: 60,
      totalRequests: 90,
      pending: 0,
    });
  });
  test.each([
    [
      'foreign campaign',
      (value) => {
        value.campaignId = uuid(901);
      },
    ],
    [
      'unrelated execution',
      (value) => {
        value.resources[0].executionId = uuid(99);
      },
    ],
    [
      'reused provider session',
      (value) => {
        value.resources[0].providerResourceId =
          value.resources[1].providerResourceId;
      },
    ],
    [
      'unconfirmed creation',
      (value) => {
        value.resources[0].creationState = 'UNKNOWN';
      },
    ],
    [
      'pending cleanup',
      (value) => {
        value.resources[0].cleanupState = 'PENDING';
      },
    ],
    [
      'unfinished result',
      (value) => {
        value.resources[0].lifecycleStatus = 'RUNNING';
      },
    ],
    [
      'wrong mode',
      (value) => {
        value.resources[0].mode = 'SUBMIT';
      },
    ],
    [
      'wrong owned name',
      (value) => {
        value.resources[0].sandboxName = 'unrelated-resource';
      },
    ],
    [
      'normal budget exceeded',
      (value) => {
        value.normalRequests = 481;
        value.totalRequests = 481;
      },
    ],
    [
      'total budget exceeded',
      (value) => {
        value.totalRequests = 529;
      },
    ],
    [
      'invalid accounting',
      (value) => {
        value.totalRequests = 1;
      },
    ],
  ])('rejects %s despite the correct creation count', (_, mutate) => {
    const evidence = finalEvidence();
    mutate(evidence);
    expect(() =>
      verifyApiStageEvidence(stage, baseline(), evidence, executions()),
    ).toThrow();
  });
  test('does not count one execution twice or borrow a previous stage session', () => {
    const values = executions();
    values[0] = values[1];
    expect(() =>
      verifyApiStageEvidence(stage, baseline(), finalEvidence(), values),
    ).toThrow();
    const previous = {
      ...baseline(),
      creations: 1,
      resources: [resource(1000)],
    };
    const final = finalEvidence();
    final.creations++;
    final.resources.push(resource(1000));
    final.resources[0].providerResourceId = 'session-1000';
    expect(() =>
      verifyApiStageEvidence(stage, previous, final, executions()),
    ).toThrow();
  });
  test('checks deltas instead of charging earlier valid stages again', () => {
    const previous = {
      ...baseline(),
      creations: 1,
      normalRequests: 1000,
      totalRequests: 1004,
      resources: [resource(1000)],
    };
    const final = finalEvidence();
    final.creations++;
    final.normalRequests += 1000;
    final.totalRequests += 1004;
    final.resources.push(resource(1000));
    expect(
      verifyApiStageEvidence(stage, previous, final, executions())
        .normalRequests,
    ).toBe(60);
  });
  test('requires an empty baseline and the first correct submit to produce exactly one completion', () => {
    expect(verifyApiProgress(progress(), uuid(700), 'initial').completed).toBe(
      0,
    );
    expect(
      verifyApiProgress(progress(0, 'HAS_EVIDENCE'), uuid(700), 'failed')
        .completed,
    ).toBe(0);
    expect(
      verifyApiProgress(progress(1, 'HAS_EVIDENCE'), uuid(700), 'success')
        .completed,
    ).toBe(1);
    expect(() =>
      verifyApiProgress(progress(1, 'HAS_EVIDENCE'), uuid(700), 'initial'),
    ).toThrow();
    expect(() =>
      verifyApiProgress(progress(0, 'HAS_EVIDENCE'), uuid(700), 'success'),
    ).toThrow();
    expect(() =>
      verifyApiProgress(progress(1, 'HAS_EVIDENCE'), uuid(700), 'failed'),
    ).toThrow();
    expect(() => verifyApiProgress(progress(), uuid(701), 'initial')).toThrow();
  });
  test('the planned IDs describe assertions actually produced, including embedded recovery replay', () => {
    expect(planApiStage(stage).cases.map((value) => value.id)).toEqual(
      expect.arrayContaining([
        'fixture-without-evidence',
        'no-progress-from-run-or-failed-submit',
      ]),
    );
    expect(
      planApiStage({ kind: 'recovery', config: stage.config }).cases.map(
        (value) => value.id,
      ),
    ).toEqual(['run-api-interruption', 'submit-api-interruption', 'cleanup']);
  });
});

// Execute the real module in an isolated VM. Every I/O dependency below is a
// local in-memory double: this never opens a socket or invokes Azure/Cypress.
async function recovery(outcome = 'disconnected') {
  let clock = Date.parse('2026-11-04T00:00:00Z');
  const fixture = {
    schemaVersion: 1,
    environment: 'preproduction',
    fictitiousOnly: true,
    baseUrl: stage.config.baseUrl,
    actors: Array.from({ length: 4 }, (_, index) => ({
      actorId: uuid(500 + index),
      accessToken: 'private-fixture-token'.repeat(2),
    })),
    activityId: uuid(700),
    assignmentId: uuid(701),
    exerciseVersionId: uuid(702),
    successfulCode: 'module.exports.solve=()=>1',
    failingCode: 'module.exports.solve=()=>0',
    privateSentinels: ['PRIVATE_SENTINEL'],
  };
  const state = baseline();
  const entries = new Map();
  let active;
  let interruptions = 0;
  const commit = 'a'.repeat(40);
  const response = (body, status = 201, release = commit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'x-release-id': release },
    });
  const ioFetch = async (url, options) => {
    const key = options.headers['idempotency-key'];
    if (entries.has(key)) return response(entries.get(key));
    const index = entries.size + 1;
    const mode = url.endsWith('/executions') ? 'RUN' : 'SUBMIT';
    const value = resource(index, mode);
    value.cleanupState = 'PENDING';
    value.lifecycleStatus = 'RUNNING';
    state.resources.push(value);
    state.creations++;
    state.normalRequests += 10;
    state.totalRequests += 12;
    const body = JSON.parse(options.body);
    const technicalResult = {
      runnerVersion: 'unit',
      diagnosisCode: 'UNKNOWN',
      terminationReason: 'RUNNER_FAILURE',
      infrastructureStatus: 'FAILED',
      visibleTestResults: [],
      visiblePassed: 0,
      visibleTotal: 1,
      outputTruncated: false,
      outputBytes: 0,
      runtimeMs: 0,
      lifecycleMs: 1,
    };
    const common = {
      executionId: value.executionId,
      exerciseVersionId: fixture.exerciseVersionId,
      admittedAt: new Date(clock).toISOString(),
    };
    const result = {
      requestId: uuid(800 + index),
      data:
        mode === 'RUN'
          ? {
              ...common,
              mode,
              finishedAt: new Date(clock).toISOString(),
              technicalResult,
            }
          : {
              ...common,
              attemptId: uuid(600 + index),
              activityId: fixture.activityId,
              assignmentId: fixture.assignmentId,
              testsVersion: 'a'.repeat(64),
              attemptNumber: 1,
              previousAttemptId: null,
              submittedAt: new Date(clock).toISOString(),
              code: body.code,
              technicalResult: {
                ...technicalResult,
                hiddenChecksPassed: null,
                allRequiredPassed: false,
              },
            },
    };
    entries.set(key, result);
    return new Promise((resolve, reject) => {
      active = { value, result, resolve, reject };
    });
  };
  const client = {
    query: async (sql) => ({
      rows: sql.includes('current_user')
        ? [{ allowed: true }]
        : sql.includes('observe_sandbox_campaign')
          ? [{ evidence: globalThis.structuredClone(state) }]
          : [],
    }),
    release() {},
  };
  class Pool {
    on() {}
    async connect() {
      return client;
    }
    async end() {}
  }
  class Clock extends Date {
    static now() {
      return clock;
    }
  }
  const dependencies = {
    'node:fs/promises': {
      readFile: async (path) =>
        path === 'fixture'
          ? Buffer.from(JSON.stringify(fixture))
          : 'fixture-ca',
    },
    './sandbox-aca-control.mjs': {
      prepareApiInterruption: async () => ({
        interrupt: async () => {
          interruptions++;
          active.value.cleanupState = 'VERIFIED';
          active.value.lifecycleStatus = 'COMPLETED';
          if (outcome === 'disconnected')
            active.reject(new TypeError('fixture transport disconnected'));
          else if (outcome === 'completed')
            active.resolve(response(active.result));
          else if (outcome === 'wrong-release')
            active.resolve(response({}, 503, 'b'.repeat(40)));
          else active.resolve(response({ message: 'PRIVATE_SENTINEL' }, 503));
        },
        verifyRestart: async () => ({
          restarted: true,
          method: 'CONTAINER_RESTART_COUNT_INCREASED',
          restartCount: interruptions,
        }),
      }),
    },
    './sandbox-browser-campaign.mjs': {
      planBrowserStage: () => {},
      preflightBrowserStage: () => {},
      executeBrowserStage: () => {},
    },
    'node:crypto': { randomUUID },
    'node:timers/promises': {
      setTimeout: async (milliseconds) => {
        clock += milliseconds;
      },
    },
    'node:perf_hooks': { performance: { now: () => clock } },
    zod: { z },
    pg: { default: { Pool } },
    '@alunza/contracts': contracts,
  };
  const context = createContext({
    Buffer,
    URL,
    Date: Clock,
    AbortSignal,
    fetch: ioFetch,
  });
  const module = new SourceTextModule(
    readFileSync('scripts/sandbox-api-campaign.mjs', 'utf8'),
    { context },
  );
  await module.link(async (name) => {
    const values = dependencies[name];
    if (!values) throw new Error(`Unexpected dependency ${name}`);
    return new SyntheticModule(
      Object.keys(values),
      function () {
        for (const [key, value] of Object.entries(values))
          this.setExport(key, value);
      },
      { context },
    );
  });
  await module.evaluate();
  const result = await module.namespace.executeApiStage(
    {
      kind: 'recovery',
      config: {
        ...stage.config,
        azure: {
          subscriptionId: uuid(900),
          resourceGroup: 'unit',
          appName: 'unit',
          revision: 'unit--test',
          replica: 'unit--test-one',
          container: 'api',
        },
        allowedOperations: ['azure:interrupt-api'],
      },
    },
    {
      campaign: {
        campaignId,
        candidate: { commit },
        expiresAt: new Date(clock + 600000).toISOString(),
      },
      env: {
        ALUNZA_SANDBOX_API_FIXTURES_FILE: 'fixture',
        ALUNZA_SANDBOX_API_DATABASE_CA_FILE: 'ca',
        ALUNZA_SANDBOX_API_DATABASE_URL:
          'postgresql://alunza_app:private@db.invalid/postgres',
      },
    },
  );
  return { result, interruptions };
}

describe('recovery evidence distinguishes a killed request from other UNKNOWN responses', () => {
  test('records both verified restarts and exact replay without another creation', async () => {
    const { result, interruptions } = await recovery();
    expect(result.status).toBe('PASS');
    expect(interruptions).toBe(2);
    expect(result.cases.filter((value) => value.replayVerified)).toHaveLength(
      2,
    );
    expect(
      result.cases.filter((value) => value.restart?.restarted),
    ).toHaveLength(2);
    expect(result.providerObserved.creations).toBe(2);
    expect(JSON.stringify(result)).not.toContain('private-fixture-token');
  });
  test.each(['completed', 'wrong-release', 'private-leak'])(
    'rejects %s instead of swallowing it as an interruption',
    async (outcome) => {
      const { result } = await recovery(outcome);
      expect(result.status).toBe('FAIL');
      expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
      expect(result.cases.some((value) => value.replayVerified)).toBe(false);
    },
  );
});
