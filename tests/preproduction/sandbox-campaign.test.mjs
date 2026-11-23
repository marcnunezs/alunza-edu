import { describe, test, expect, jest } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { remoteDriverExitCodes } from '../../infra/runner/timing.mjs';
import {
  CampaignBudget,
  capsuleInventory,
  estimateCampaignCost,
  evaluateFixture,
  evaluateOsProbe,
  executeCapsuleStage,
  executeLifecycleFixture,
  loadCampaign,
  planCampaign,
  preflightCampaign,
  runCampaign,
  validateCampaign,
} from '../../scripts/sandbox-campaign.mjs';

const now = Date.parse('2026-11-04T00:00:00Z');
const candidate = { commit: 'a'.repeat(40), sourceDigest: 'b'.repeat(64) };
function prepared() {
  const stage = {
    id: 'success',
    kind: 'capsule',
    enabled: true,
    fixtures: ['sync-json-success'],
    creations: 1,
    maxRequests: 36,
    maxDurationSeconds: 40,
  };
  return {
    schemaVersion: 1,
    campaignId: '49364c2d-b51a-4ccc-bdb4-8c9300adab26',
    environment: 'preproduction',
    authorized: true,
    expiresAt: new Date(now + 3600000).toISOString(),
    teamId: 'team_fixture',
    projectId: 'prj_fixture',
    region: 'iad1',
    image: `registry.test/capsule@sha256:${'c'.repeat(64)}`,
    runnerVersion: 'imp-03-quickjs.9',
    maxCreations: 1,
    maxRequests: 36,
    maxCost: 1,
    currency: 'USD',
    candidate,
    approval: {
      approvedBy: 'FICTITIOUS_UNIT_TEST_ACTOR',
      reference: 'UNIT_TEST_ONLY',
      approvedAt: new Date(now - 1000).toISOString(),
    },
    rates: {
      currency: 'USD',
      region: 'iad1',
      activeCpuPerVcpuHour: 1,
      memoryPerGbHour: 2,
      creationPerRun: 0.1,
      memoryBillingQuantumSeconds: 60,
      sourceUrl: 'https://example.test/explicit-test-rates',
      recordedAt: '2026-11-03',
    },
    stages: [stage],
  };
}
function options(manifest) {
  return {
    now,
    candidate,
    runnerVersion: manifest.runnerVersion,
    env: {
      VERCEL_TOKEN: 'UNIT_TEST_TOKEN_NEVER_SENT',
      SANDBOX_TEAM_ID: manifest.teamId,
      SANDBOX_PROJECT_ID: manifest.projectId,
      SANDBOX_REGION: manifest.region,
      SANDBOX_IMAGE: manifest.image,
    },
  };
}

describe('Sandbox campaign review and default-deny boundary (local unit checks only)', () => {
  test('capability template is a separately unapproved single-creation first gate', async () => {
    const capability = await loadCampaign(
      new URL(
        '../../infra/preproduction/sandbox-capability-campaign.example.json',
        import.meta.url,
      ),
    );
    const broader = await loadCampaign(
      new URL(
        '../../infra/preproduction/sandbox-campaign.example.json',
        import.meta.url,
      ),
    );
    const plan = await planCampaign(capability);
    expect(capability.campaignId).not.toBe(broader.campaignId);
    expect(capability.authorized).toBe(false);
    expect(capability.approval.reference).toBeNull();
    expect(capability.maxCost).toBe(0);
    expect(plan.totals).toMatchObject({
      creations: 1,
      requests: 36,
      cleanupReserved: 8,
      durationSeconds: 40,
      cases: 1,
    });
    expect(plan.remote).toBe('NOT_RUN');
  });
  test('checked-in template inventories all real fixture IDs but cannot dispatch', async () => {
    const manifest = await loadCampaign(
      new URL(
        '../../infra/preproduction/sandbox-campaign.example.json',
        import.meta.url,
      ),
    );
    const plan = await planCampaign(manifest);
    expect(manifest.authorized).toBe(false);
    expect(plan.remote).toBe('NOT_RUN');
    expect(plan.acceptance).toBe('NOT_ACCEPTED');
    expect(plan.totals.creations).toBe(69);
    expect(
      plan.stages[0].cases.filter((item) => item.kind === 'trusted-os-probe'),
    ).toHaveLength(6);
    expect(
      plan.stages[0].cases.every(
        (item) => item.implemented && item.status === 'NOT_RUN',
      ),
    ).toBe(true);
    const create = jest.fn();
    await expect(
      runCampaign(manifest, {
        candidate,
        env: {},
        runner: { VercelAdapter: create },
      }),
    ).rejects.toThrow('CAMPAIGN_PREFLIGHT_BLOCKED');
    expect(create).not.toHaveBeenCalled();
  });

  test('schema rejects credential smuggling and production', () => {
    expect(() => validateCampaign({ ...prepared(), token: 'secret' })).toThrow(
      'CAMPAIGN_SCHEMA_INVALID',
    );
    expect(() =>
      validateCampaign({ ...prepared(), environment: 'production' }),
    ).toThrow('CAMPAIGN_SCHEMA_INVALID');
  });

  test('static preflight never converts authorization into an executed result', async () => {
    const manifest = prepared();
    const result = await preflightCampaign(manifest, options(manifest));
    expect(result.blockers).toEqual([]);
    expect(result.status).toBe('READY_FOR_AUTHORIZED_EXECUTION');
    expect(result.remote).toBe('NOT_RUN');
    expect(result.cost.status).toBe('MODEL_ONLY');
  });

  test.each([
    [
      'unauthorized',
      (manifest) => {
        manifest.authorized = false;
      },
      'CAMPAIGN_NOT_AUTHORIZED',
    ],
    [
      'missing-reference',
      (manifest) => {
        manifest.approval.reference = null;
      },
      'REFERENCED_APPROVAL_REQUIRED',
    ],
    [
      'missing-actor',
      (manifest) => {
        manifest.approval.approvedBy = null;
      },
      'REFERENCED_APPROVAL_REQUIRED',
    ],
    [
      'expired',
      (manifest) => {
        manifest.expiresAt = new Date(now - 1).toISOString();
      },
      'CAMPAIGN_WINDOW_INVALID',
    ],
    [
      'future-approval',
      (manifest) => {
        manifest.approval.approvedAt = new Date(now + 1).toISOString();
      },
      'CAMPAIGN_WINDOW_INVALID',
    ],
    [
      'eight-day-window',
      (manifest) => {
        manifest.expiresAt = new Date(now + 8 * 86400000).toISOString();
      },
      'CAMPAIGN_WINDOW_INVALID',
    ],
    [
      'short-window',
      (manifest) => {
        manifest.expiresAt = new Date(now + 10000).toISOString();
      },
      'CAMPAIGN_WINDOW_TOO_SHORT',
    ],
    [
      'source-mismatch',
      (manifest) => {
        manifest.candidate = { ...candidate, sourceDigest: 'd'.repeat(64) };
      },
      'CANDIDATE_MISMATCH',
    ],
    [
      'missing-rates',
      (manifest) => {
        manifest.rates = null;
      },
      'EXPLICIT_REGIONAL_RATES_REQUIRED',
    ],
    [
      'zero-cost',
      (manifest) => {
        manifest.maxCost = 0;
      },
      'CAMPAIGN_COST_INSUFFICIENT',
    ],
    [
      'too-few-creations',
      (manifest) => {
        manifest.maxCreations = 0;
      },
      'CAMPAIGN_CREATIONS_INSUFFICIENT',
    ],
    [
      'cleanup-only-budget',
      (manifest) => {
        manifest.maxRequests = 8;
      },
      'CAMPAIGN_REQUESTS_INSUFFICIENT',
    ],
  ])(
    '%s blocks before provider initialization',
    async (_label, change, code) => {
      const manifest = prepared();
      change(manifest);
      const result = await preflightCampaign(manifest, options(manifest));
      expect(result.blockers).toContain(code);
    },
  );

  test('candidate, built version and exact destination must agree', async () => {
    const manifest = prepared();
    const opts = options(manifest);
    opts.runnerVersion = 'old-runner';
    opts.env.SANDBOX_PROJECT_ID = 'prj_other';
    opts.env.VERCEL_TOKEN = '';
    const result = await preflightCampaign(manifest, opts);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        'BUILT_RUNNER_VERSION_MISMATCH',
        'SANDBOX_PROJECT_ID_MISMATCH',
        'VERCEL_TOKEN_REQUIRED',
      ]),
    );
  });

  test('extra authorized creations also reserve cleanup, even if not selected', async () => {
    const manifest = prepared();
    manifest.maxCreations = 2;
    expect((await planCampaign(manifest)).blockers).toContain(
      'CAMPAIGN_REQUESTS_INSUFFICIENT',
    );
  });

  test('API preflight checks its private fixture before dispatch without requiring client-side provider token', async () => {
    const manifest = prepared();
    manifest.stages[0].kind = 'api';
    const apiPlanner = () => ({
      implemented: true,
      cases: [],
      creations: 1,
      normalRequests: 28,
      clientRequests: 5,
      maxDurationSeconds: 40,
      blockers: [],
    });
    const apiPreflight = jest.fn(async () => ({
      blockers: ['PRIVATE_API_FIXTURES_REQUIRED'],
    }));
    const result = await preflightCampaign(manifest, {
      ...options(manifest),
      env: {},
      apiPlanner,
      apiPreflight,
    });
    expect(result.blockers).toEqual(['success:PRIVATE_API_FIXTURES_REQUIRED']);
    expect(apiPreflight).toHaveBeenCalledTimes(1);
  });

  test('inventories exact test count and reserves eight cleanup calls for every creation', async () => {
    const manifest = prepared();
    manifest.stages[0].fixtures = ['case-state-isolation', 'os-network'];
    const inventory = capsuleInventory(manifest.stages[0]);
    expect(inventory.creations).toBe(2);
    expect(inventory.normalRequests).toBe(68);
    const result = await planCampaign(manifest);
    expect(result.blockers).toContain('success:STAGE_CREATIONS_INSUFFICIENT');
    expect(result.blockers).toContain('success:STAGE_REQUESTS_INSUFFICIENT');
  });

  test('unknown fixtures and unavailable API harness block before spending', async () => {
    const manifest = prepared();
    manifest.stages[0].fixtures = ['unimplemented-lifecycle'];
    expect((await planCampaign(manifest)).blockers).toContain(
      'success:CAPSULE_FIXTURE_NOT_IMPLEMENTED',
    );
    manifest.stages[0].kind = 'recovery';
    expect((await planCampaign(manifest)).blockers).toContain(
      'success:API_HARNESS_UNAVAILABLE',
    );
  });

  test('independent local and runtime ledgers cannot pretend to share one campaign quota', async () => {
    const manifest = prepared();
    manifest.stages.push({ ...manifest.stages[0], id: 'api', kind: 'api' });
    const result = await planCampaign(manifest, {
      apiPlanner: () => ({
        implemented: true,
        cases: [],
        creations: 1,
        normalRequests: 28,
        clientRequests: 5,
        maxDurationSeconds: 40,
        blockers: [],
      }),
    });
    expect(result.blockers).toContain(
      'SEPARATE_CAPSULE_AND_API_CAMPAIGNS_REQUIRED',
    );
    expect(result.totals.clientRequests).toBe(5);
  });

  test('cost uses explicit rates and60s VM TTL, never the longer authorization window', () => {
    const manifest = prepared();
    const cost = estimateCampaignCost(manifest, 2);
    expect(cost.modeled.cpu).toBeCloseTo(2 / 60);
    expect(cost.modeled.memory).toBeCloseTo(8 / 60);
    expect(cost.modeled.creation).toBeCloseTo(0.2);
    expect(cost.vmSeconds).toBe(60);
    manifest.rates.region = 'sfo1';
    expect(estimateCampaignCost(manifest, 2).modeled).toBeNull();
  });
});

describe('lifecycle harness ordering with explicit local doubles (no remote evidence)', () => {
  function context() {
    return {
      campaign: prepared(),
      env: {},
      deadline: Date.now() + 120000,
      signal: AbortSignal.timeout(120000),
      reserveCreation: jest.fn(),
      allowRequest: jest.fn(),
      appendEvidence: jest.fn(),
    };
  }
  const startFailure = {
    httpStatus: 500,
    outcome: 'INCOMPLETE_RESPONSE',
    runtimeCause: null,
    containerState: 'created',
    hasStarted: false,
    oomKilled: false,
  };
  test.each([
    ['valid START evidence', 'START', startFailure, startFailure],
    ['different phase', 'CREATE', startFailure, null],
    ['legacy driver', 'START', undefined, null],
    [
      'unknown property',
      'START',
      { ...startFailure, message: 'PRIVATE_CASE_SENTINEL' },
      null,
    ],
    [
      'unknown cause',
      'START',
      { ...startFailure, runtimeCause: 'PRIVATE_CASE_SENTINEL' },
      null,
    ],
  ])(
    'a failed case journals only the driver status fields and keeps cleanup independent: %s',
    async (_label, phase, detail, expected) => {
      const command = {
        exitCode: remoteDriverExitCodes[phase],
        stdoutPresent: false,
        stderrPresent: true,
        failureMarker: true,
        phase,
      };
      const cleanup = {
        exitCode: 0,
        stdoutPresent: false,
        stderrPresent: false,
        failureMarker: false,
        phase: null,
      };
      class LocalDouble {
        evidence = {
          driverCommand: { ...command, stderr: 'PRIVATE_CASE_SENTINEL' },
          driverStartFailure: detail,
          driverCleanupCommand: cleanup,
          cpuCfsPeriod: false,
          cpuCfsQuota: 'PRIVATE_CASE_SENTINEL',
          cleanupVerified: true,
        };
        async close() {}
      }
      const appendEvidence = jest.fn();
      const result = await executeCapsuleStage(
        { id: 'unit-test', fixtures: ['sync-json-success'] },
        { ...context(), appendEvidence },
        {
          VercelAdapter: LocalDouble,
          execute: async () => {
            throw new Error('PRIVATE_CASE_SENTINEL');
          },
        },
      );
      const observation = {
        status: 'FAIL',
        driverCommand: command,
        driverStartFailure: expected,
        driverCleanupCommand: cleanup,
        cpuCfsPeriod: false,
        cpuCfsQuota: null,
      };
      expect(result.cases[0]).toMatchObject(observation);
      expect(appendEvidence).toHaveBeenCalledWith(
        expect.objectContaining(observation),
      );
      expect(JSON.stringify([result, appendEvidence.mock.calls])).not.toContain(
        'PRIVATE_CASE_SENTINEL',
      );
    },
  );

  test.each([true, false])(
    'natural timeout accepts only observed provider expiry: %s',
    async (verified) => {
      const calls = [];
      class LocalDouble {
        constructor(options) {
          this.options = options;
          this.evidence = {
            createDispatches: 1,
            effectiveVmTimeoutMs: 60000,
            cleanupVerified: false,
          };
        }
        async execute() {
          calls.push('execute');
          await this.options.recordResource({});
          return { cleanupVerified: true };
        }
        async observeNaturalTimeout() {
          calls.push('observe');
          return {
            verified,
            sandboxId: 'PRIVATE_ID',
            sessionStatus: verified ? 'stopped' : 'ABSENT',
            observedAt: new Date().toISOString(),
          };
        }
        async close() {
          calls.push('close');
          this.evidence.cleanupVerified = true;
        }
      }
      const wait = jest.fn(async () => {
        calls.push('wait');
      });
      const result = await executeLifecycleFixture(
        'natural-vm-timeout-60s',
        { id: 'unit-test' },
        context(),
        { VercelAdapter: LocalDouble },
        wait,
      );
      expect(calls).toEqual(['execute', 'wait', 'observe', 'close']);
      expect(result.status).toBe(verified ? 'PASS' : 'FAIL');
      expect(result.naturalTimeoutObservation.sandboxId).toBeUndefined();
      expect(wait).toHaveBeenCalledTimes(1);
    },
  );

  test.each([true, false])(
    'uncertain creation needs deliberate real-response fault evidence: %s',
    async (discarded) => {
      class LocalDouble {
        constructor(options) {
          this.options = options;
          this.evidence = {
            createDispatches: 1,
            acceptanceFault: discarded
              ? 'CREATE_RESPONSE_DISCARDED'
              : undefined,
          };
        }
        async execute() {
          expect(this.options.acceptance.discardCreateResponse).toBe(true);
          throw new Error('local controlled double');
        }
        async close() {
          this.evidence.cleanupVerified = true;
        }
      }
      const result = await executeLifecycleFixture(
        'uncertain-creation-reconciliation',
        { id: 'unit-test' },
        context(),
        { VercelAdapter: LocalDouble },
      );
      expect(result.status).toBe(discarded ? 'PASS' : 'FAIL');
    },
  );

  test('cancellation aborts only after accepted execution dispatch and always closes', async () => {
    const calls = [];
    class LocalDouble {
      constructor(options) {
        this.options = options;
        this.evidence = { createDispatches: 1 };
      }
      async execute(_input, signal) {
        calls.push('dispatch');
        this.options.acceptance.onCapsuleDispatched();
        return new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              calls.push('abort');
              reject(new Error('cancelled local double'));
            },
            { once: true },
          ),
        );
      }
      async close() {
        calls.push('close');
        this.evidence.cleanupVerified = true;
      }
    }
    const result = await executeLifecycleFixture(
      'cancellation',
      { id: 'unit-test' },
      context(),
      { VercelAdapter: LocalDouble },
    );
    expect(result.status).toBe('PASS');
    expect(calls).toEqual(['dispatch', 'abort', 'close']);
  });

  test('concurrent cases use distinct identities and input/expected data', async () => {
    const calls = [];
    let serial = 0;
    class LocalDouble {
      constructor() {
        this.evidence = {
          sandboxName: `local-test-${++serial}`,
          createDispatches: 1,
        };
      }
      async close() {
        this.evidence.cleanupVerified = true;
      }
    }
    const execute = jest.fn(async (input, adapter) => {
      calls.push(input);
      await adapter.close();
      return { diagnosisCode: 'SUCCESS', evidence: { cleanupVerified: true } };
    });
    const result = await executeLifecycleFixture(
      'two-concurrent-executions',
      { id: 'unit-test' },
      context(),
      { VercelAdapter: LocalDouble, execute, publicResult: () => ({}) },
    );
    expect(result.status).toBe('PASS');
    expect(calls).toHaveLength(2);
    expect(calls[0].executionId).not.toBe(calls[1].executionId);
    expect(calls[0].tests[0].expected).not.toEqual(calls[1].tests[0].expected);
    expect(result.resources.every((item) => item.cleanupVerified)).toBe(true);
  });
});

describe('durable dispatch reservations and independent cleanup budget', () => {
  test('must persist a unique reservation before consuming any creation', () => {
    const persist = jest.fn(() => {
      throw new Error('disk full');
    });
    const budget = new CampaignBudget(prepared(), { now: () => now, persist });
    expect(() => budget.reserveCreation('case-1', {})).toThrow('disk full');
    expect(budget.creations).toBe(0);
    expect(budget.reservations.size).toBe(0);
  });

  test('creation exhaustion and normal calls cannot consume cleanup reserve', () => {
    const budget = new CampaignBudget(prepared(), { now: () => now });
    budget.reserveCreation('case-1', {});
    expect(() => budget.reserveCreation('case-1', {})).toThrow();
    expect(() => budget.reserveCreation('case-2', {})).toThrow();
    for (let call = 0; call < 28; call++) budget.allowRequest(false, 'case-1');
    expect(() => budget.allowRequest(false, 'case-1')).toThrow();
    for (let call = 0; call < 8; call++) budget.allowRequest(true, 'case-1');
    expect(() => budget.allowRequest(true, 'case-1')).toThrow();
    expect(budget.normalRequests + budget.cleanupRequests).toBe(36);
  });

  test('expiry permits only bounded cleanup for an already reserved resource', () => {
    let clock = now;
    const manifest = prepared();
    const budget = new CampaignBudget(manifest, { now: () => clock });
    budget.reserveCreation('case-1', {});
    clock = Date.parse(manifest.expiresAt) + 1;
    expect(() => budget.allowRequest(false, 'case-1')).toThrow();
    expect(() => budget.reserveCreation('case-2', {})).toThrow();
    budget.allowRequest(true, 'case-1');
    expect(() => budget.allowRequest(true, 'foreign')).toThrow();
    clock += 10000;
    expect(() => budget.allowRequest(true, 'case-1')).toThrow();
  });
});

describe('real-result assertions, without executing a capsule', () => {
  test('diagnosis alone cannot pass with hidden leakage or failed cleanup', () => {
    const fixture = {
      expected: 'SUCCESS',
      privateSentinel: 'PRIVATE_SENTINEL',
    };
    const result = {
      diagnosisCode: 'SUCCESS',
      evidence: { cleanupVerified: true },
    };
    expect(evaluateFixture(fixture, result, {})).toBe(true);
    expect(
      evaluateFixture(fixture, result, { output: 'PRIVATE_SENTINEL' }),
    ).toBe(false);
    result.evidence.cleanupVerified = false;
    expect(evaluateFixture(fixture, result, {})).toBe(false);
  });

  test('OS memory requires actual cgroup OOM evidence and verified cleanup', () => {
    expect(
      evaluateOsProbe('memory', {
        cleanupVerified: true,
        oomKilled: false,
        packet: { cgroup: { 'memory.events': 'oom_kill 0' } },
      }).passed,
    ).toBe(false);
    expect(
      evaluateOsProbe('memory', {
        cleanupVerified: true,
        oomKilled: false,
        packet: { cgroup: { 'memory.events': 'oom_kill 1' } },
      }).passed,
    ).toBe(true);
    expect(
      evaluateOsProbe('memory', { cleanupVerified: false, oomKilled: true })
        .passed,
    ).toBe(false);
  });

  test('OS network fails if any syscall has successful egress', () => {
    const response = (udp) => ({
      cleanupVerified: true,
      exitCode: 0,
      timedOut: false,
      oomKilled: false,
      packet: {
        exitCode: 0,
        returnData: Buffer.from(
          JSON.stringify({
            kind: 'probe',
            value: {
              loopbackOnly: true,
              dns: 'ENETUNREACH',
              ipv6: 'EACCES',
              udp,
            },
          }),
        ).toString('base64'),
      },
    });
    expect(evaluateOsProbe('network', response('EPERM')).passed).toBe(true);
    expect(
      evaluateOsProbe('network', response('UNEXPECTED_SUCCESS')).passed,
    ).toBe(false);
  });

  test('ACA mounts campaign andtoken server-side, preserves probes, and keeps recovery alive', async () => {
    const template = await readFile(
      new URL('../../infra/preproduction/main.bicep', import.meta.url),
      'utf8',
    );
    expect(template).toContain(
      "{ name: 'VERCEL_TOKEN', secretRef: 'vercel-token' }",
    );
    expect(template).toContain(
      "secrets: [{ secretRef: 'sandbox-campaign', path: 'campaign.json' }]",
    );
    expect(template).toContain(
      "{ name: 'SANDBOX_CAMPAIGN_FILE', value: '/var/run/alunza-sandbox/campaign.json' }",
    );
    expect(template).toContain('terminationGracePeriodSeconds: 60');
    expect(template).toContain(
      "practiceRunnerEnabled || sandboxRecoveryEnabled || (practiceRunnerProvider == 'vercel' && !empty(sandboxCampaign)) ? 1 : 0",
    );
    expect(template).toContain("path: '/health/ready'");
  });
});
