import { loadConfig } from '../config';
import type { AppConfig } from '../config';
import { loadLocalVmConfiguration } from './local-vm-config';
import { validateCleanup, validateVmExecution } from './local-vm-contract';
import { LocalVmRunnerService } from './local-vm-runner.service';
import { LocalVmClient } from './local-vm-client';
import type { LocalVmResourceRepository } from './local-vm-resource.repository';
import { createRunTimingObserver, measureRunPhase } from './run-observability';
import { LocalVmSubmissionAdapter } from './local-vm-execution.adapter';

const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context = {
  provider: 'local-vm' as const,
  image: `sha256:${'a'.repeat(64)}`,
  runnerVersion: 'imp-03-quickjs.13' as const,
  hostId: id(1),
  kitManifestSha256: 'b'.repeat(64),
  brokerVersion: 'local-vm-broker-v1' as const,
  guestSha256: 'c'.repeat(64),
  brokerGeneration: id(2),
};
const env = {
  APP_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://alunza_app:unit@127.0.0.1/test',
  SUPABASE_JWKS_URL: 'http://localhost/auth/v1/.well-known/jwks.json',
  SUPABASE_JWT_ISSUER: 'http://localhost/auth/v1',
  PRACTICE_RUNNER_PROVIDER: 'local-vm',
  PRACTICE_LOCAL_VM_SOCKET: '/run/alunza-private/broker.sock',
  PRACTICE_LOCAL_VM_HOST_ID: context.hostId,
  PRACTICE_LOCAL_VM_KIT_MANIFEST_SHA256: context.kitManifestSha256,
  PRACTICE_LOCAL_VM_GUEST_SHA256: context.guestSha256,
  PRACTICE_LOCAL_VM_IMAGE: context.image,
};
const resource = {
  executionId: id(3),
  creationId: id(4),
  resourceId: id(5),
  context,
};
const input = {
  executionId: id(3),
  requestId: id(6),
  exerciseVersionId: id(7),
  testsVersion: 'unit',
  mode: 'RUN' as const,
  entrypoint: 'solve' as const,
  code: 'module.exports.solve=()=>1;',
  tests: [{ id: 'v1', visibility: 'visible' as const, args: [], expected: 1 }],
};
const authority = () => {
  const start = Date.now();
  return {
    leaseToken: id(8),
    normalDeadlineMs: start + 30000,
    cleanupDeadlineMs: start + 40000,
  };
};
const proof = () => ({
  kind: 'RETIRED' as const,
  ...resource,
  hostId: context.hostId,
  brokerGeneration: context.brokerGeneration,
  qemuAbsent: true as const,
  overlaysAbsent: true as const,
  observedAt: new Date().toISOString(),
});
function cleanup() {
  const { context: ignored, ...value } = proof();
  void ignored;
  return { cleanupVerified: true, resource, proof: value };
}
function reply() {
  return {
    cleanupVerified: true,
    resource,
    vmEvidence: {
      bootId: resource.resourceId,
      executionId: input.executionId,
      creationId: resource.creationId,
      hostId: context.hostId,
      brokerGeneration: context.brokerGeneration,
      kitManifestSha256: context.kitManifestSha256,
      image: context.image,
      runnerVersion: context.runnerVersion,
      qemu: { vcpus: 1, memoryBytes: 2147483648, network: false },
      envelope: {
        cpuCount: 1,
        memoryMax: '2147483648',
        swapMax: '0',
        cpuMax: '100000 100000',
        selfGroup: '0::/alunzasingleexecutor.slice/alunza-guest.service',
        cgroupVersion: '2',
        cgroupDriver: 'systemd',
      },
      capsulesClean: true,
      qemuReaped: true,
      overlaysAbsent: true,
    },
    result: {
      executionId: input.executionId,
      runnerVersion: context.runnerVersion,
      diagnosisCode: 'SUCCESS',
      terminationReason: 'COMPLETED',
      infrastructureStatus: 'OK',
      allRequiredPassed: true,
      visibleTestResults: [{ id: 'v1', passed: true, stdout: '', stderr: '' }],
      privateTestResults: [] as {
        id: string;
        passed: boolean;
        stdout: string;
        stderr: string;
      }[],
      hiddenRequiredCount: 0,
      outputTruncated: false,
      outputBytes: 0,
      runtimeMs: 100,
      lifecycleMs: 500,
      evidence: {
        provider: 'docker',
        image: context.image,
        cleanupVerified: true,
        cgroups: [
          {
            'memory.max': '134217728',
            'memory.swap.max': '0',
            'pids.max': '32',
            'cpu.max': '100000 100000',
          },
        ],
        invocationAuthenticity: 'QUICKJS_SYNC_CALL',
        engine: 'quickjs-wasm-release-sync@0.32.0',
        bridgeUid: 0,
        bridgeCapabilities: [
          'CAP_KILL',
          'CAP_SETUID',
          'CAP_SETGID',
          'CAP_SETPCAP',
        ],
        studentUid: 10001,
        studentCapabilities: 'ZERO_REQUIRED',
        bridgeCountsAgainstMemory: true,
        oomObserved: false,
        hostDeadlineObserved: false,
        hostProgramWallMs: 150,
        timings: [
          {
            hostStartAttachMs: 150,
            containerWallMs: 130,
            supervisorProcessMs: 100,
            budgetMs: 3000,
            caseCost: null,
            watchdog: {
              version: 2,
              clock: 'PERFORMANCE_NOW',
              origin: 'BRIDGE_INPUT_PARSED',
              budgetMs: 3000,
              deadlineMs: 3000,
              retirementReserveMs: 50,
              stopDeadlineMs: 2950,
              launchSkipped: false,
              launchRequestedMs: 1,
              spawnObservedMs: 3,
              timerArmedMs: 2,
              timerDelayMs: 2948,
              watchdogFiredMs: null,
              watchdogLatenessMs: null,
              killAttempts: 0,
              firstKillAttemptMs: null,
              lastKillAttemptMs: null,
              killCallSuccesses: 0,
              firstKillCallSucceededMs: null,
              lastKillCallSucceededMs: null,
              exitObservedMs: 99,
              closeObservedMs: 100,
              lastGuestInstructionObservedMs: null,
            },
          },
        ],
      },
    },
  };
}
function setup() {
  const stored = {
    ...resource,
    creationState: 'CONFIRMED',
    cleanupState: 'PENDING',
    cleanupProof: null,
    inputSha256: 'd'.repeat(64),
  };
  const resources = {
    begin: jest.fn(
      async (
        _executionId: string,
        _authority: unknown,
        inputSha256: string,
      ) => ({
        ...stored,
        creationState: 'UNKNOWN',
        resourceId: null,
        inputSha256,
      }),
    ),
    confirm: jest.fn().mockResolvedValue(stored),
    assertActive: jest.fn().mockResolvedValue(undefined),
    load: jest.fn().mockResolvedValue(stored),
    verifyCleanup: jest.fn().mockResolvedValue(undefined),
  };
  const client = {
    call: jest.fn(async (route: string): Promise<unknown> => {
      if (route === '/inspect')
        return { available: true, capacity: 'READY', context };
      if (route === '/prepare')
        return { resourceId: resource.resourceId, context };
      if (route === '/start') return reply();
      if (route === '/cleanup') return cleanup();
      return {
        state: 'CLOSED',
        resource,
        cleanupVerified: true,
        result: reply(),
      };
    }),
  };
  const config = {
    localVmConfiguration: loadLocalVmConfiguration(env),
  } as AppConfig;
  return {
    config,
    client,
    resources,
    service: new LocalVmRunnerService(
      config,
      client as unknown as LocalVmClient,
      resources as unknown as LocalVmResourceRepository,
    ),
  };
}

describe('local VM configuration and privileged result boundary', () => {
  it.each(['READY', 'BUSY', 'UNCERTAIN'] as const)(
    'retains pinned identity separately from capacity %s',
    async (capacity) => {
      const { service, client, resources } = setup();
      client.call.mockResolvedValue({ available: true, capacity, context });
      expect(await service.inspect()).toEqual({
        available: true,
        runnerVersion: context.runnerVersion,
        context,
        capacity,
      });
      expect(resources.begin).not.toHaveBeenCalled();
      expect(client.call).toHaveBeenCalledTimes(1);
    },
  );
  it.each([undefined, null, 'ready', 'UNKNOWN', 1])(
    'fails closed for missing or invalid capacity %s',
    async (capacity) => {
      const { service, client } = setup();
      client.call.mockResolvedValue({ available: true, capacity, context });
      expect(await service.inspect()).toEqual({
        available: false,
        runnerVersion: context.runnerVersion,
      });
    },
  );
  it.each(['local', 'test'])(
    'allows a complete pinned configuration only in %s',
    (environment) => {
      expect(
        loadConfig({ ...env, ENVIRONMENT: environment }).localVmConfiguration,
      ).toMatchObject({
        image: context.image,
        hostId: context.hostId,
        socketPath: env.PRACTICE_LOCAL_VM_SOCKET,
      });
    },
  );
  it.each(['evaluation', 'preproduction', 'production'])(
    'rejects local VM in %s',
    (environment) => {
      expect(() => loadConfig({ ...env, ENVIRONMENT: environment })).toThrow();
    },
  );
  it.each([
    { PRACTICE_LOCAL_VM_HOST_ID: undefined },
    { PRACTICE_LOCAL_VM_GUEST_SHA256: 'latest' },
    { PRACTICE_LOCAL_VM_SOCKET: '/tmp/../broker.sock' },
    { PRACTICE_LOCAL_VM_IMAGE: 'alunza:latest' },
  ])('rejects missing or mutable pins %j', (patch) => {
    expect(() => loadConfig({ ...env, ...patch })).toThrow();
  });
  it('validates the full result without executing student code on the host', async () => {
    expect(
      (await validateVmExecution(reply(), input, resource)).result
        .diagnosisCode,
    ).toBe('SUCCESS');
  });
  it.each([
    'wrongVm',
    'wrongGeneration',
    'largeLeaf',
    'largeAncestor',
    'extraField',
    'caseMissing',
    'badClock',
    'extraCaps',
    'inflatedBudget',
    'fakeSuccess',
  ])('rejects %s before projection', async (scenario) => {
    const value = reply();
    if (scenario === 'wrongVm') value.vmEvidence.bootId = id(99);
    if (scenario === 'wrongGeneration')
      value.resource = {
        ...resource,
        context: { ...context, brokerGeneration: id(99) },
      };
    if (scenario === 'largeLeaf')
      value.result.evidence.cgroups[0]!['memory.max'] = '268435456';
    if (scenario === 'largeAncestor')
      value.vmEvidence.envelope.cpuMax = '200000 100000';
    if (scenario === 'extraField')
      Object.assign(value.result, { secret: 'not-forwarded' });
    if (scenario === 'caseMissing') value.result.visibleTestResults = [];
    if (scenario === 'badClock')
      value.result.evidence.timings[0]!.watchdog.timerDelayMs = 3000;
    if (scenario === 'extraCaps')
      value.result.evidence.bridgeCapabilities[0] = 'CAP_SYS_ADMIN';
    if (scenario === 'inflatedBudget')
      value.result.evidence.timings[0]!.budgetMs = 3100;
    if (scenario === 'fakeSuccess') value.result.runtimeMs = 3001;
    await expect(validateVmExecution(value, input, resource)).rejects.toThrow();
  });
  it('keeps raw byte limits while allowing bounded UTF-8 display replacement', async () => {
    const value = reply();
    value.result.diagnosisCode = 'UNKNOWN';
    value.result.terminationReason = 'OUTPUT_LIMIT';
    value.result.allRequiredPassed = false;
    value.result.outputTruncated = true;
    value.result.outputBytes = 65536;
    value.result.visibleTestResults[0] = {
      id: 'v1',
      passed: false,
      stdout: 'a'.repeat(65535) + '\ufffd',
      stderr: '',
    };
    expect(
      (await validateVmExecution(value, input, resource)).result.outputBytes,
    ).toBe(65536);
    value.result.visibleTestResults[0].stderr = 'over-budget';
    await expect(validateVmExecution(value, input, resource)).rejects.toThrow();
    value.result.outputBytes = 65537;
    await expect(validateVmExecution(value, input, resource)).rejects.toThrow();
  });
  it('rejects uncorrelated cleanup and cleanup uncertainty', () => {
    expect(() =>
      validateCleanup({ ...cleanup(), cleanupVerified: false }, resource),
    ).toThrow();
    expect(() =>
      validateCleanup(
        { ...cleanup(), proof: { ...cleanup().proof, creationId: id(99) } },
        resource,
      ),
    ).toThrow();
  });
  it('accounts partial OOM without inventing a supervisor duration', async () => {
    const value = reply();
    value.result.diagnosisCode = 'UNKNOWN';
    value.result.terminationReason = 'MEMORY_LIMIT';
    value.result.allRequiredPassed = false;
    value.result.visibleTestResults = [];
    value.result.runtimeMs = 0;
    value.result.evidence.cgroups = [];
    value.result.evidence.oomObserved = true;
    Object.assign(value.result.evidence.timings[0]!, {
      supervisorProcessMs: null,
      watchdog: null,
    });
    expect(
      (await validateVmExecution(value, input, resource)).result.runtimeMs,
    ).toBe(0);
  });
  it('checks decreasing total budgets across cases without a renewed 3000ms allowance', async () => {
    const value = reply();
    const second = structuredClone(value.result.evidence.timings[0]!);
    second.budgetMs = 2900;
    second.watchdog.budgetMs = 2900;
    second.watchdog.deadlineMs = 2900;
    second.watchdog.stopDeadlineMs = 2850;
    second.watchdog.timerDelayMs = 2848;
    value.result.evidence.timings.push(second);
    value.result.evidence.cgroups.push({
      ...value.result.evidence.cgroups[0]!,
    });
    value.result.runtimeMs = 200;
    value.result.visibleTestResults.push({
      id: 'v2',
      passed: true,
      stdout: '',
      stderr: '',
    });
    const two = {
      ...input,
      tests: [...input.tests, { ...input.tests[0]!, id: 'v2' }],
    };
    expect(
      (await validateVmExecution(value, two, resource)).result.runtimeMs,
    ).toBe(200);
    second.budgetMs = 3000;
    await expect(validateVmExecution(value, two, resource)).rejects.toThrow();
  });
});

describe('single input dispatch and durable retirement', () => {
  it('commits resource identity and revalidates lease before the sole input-bearing request', async () => {
    const { service, resources, client } = setup();
    const permit = authority();
    expect(
      (await service.execute(input, context, permit)).cleanupVerified,
    ).toBe(true);
    expect(resources.begin).toHaveBeenCalledWith(
      input.executionId,
      permit,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    const events = [
      resources.begin,
      client.call,
      resources.confirm,
      resources.assertActive,
      resources.verifyCleanup,
    ];
    expect(events[0]!.mock.invocationCallOrder[0]).toBeLessThan(
      events[1]!.mock.invocationCallOrder[0]!,
    );
    expect(resources.confirm.mock.invocationCallOrder[0]).toBeLessThan(
      resources.assertActive.mock.invocationCallOrder[0]!,
    );
    expect(resources.assertActive.mock.invocationCallOrder[0]).toBeLessThan(
      client.call.mock.invocationCallOrder[1]!,
    );
    expect(client.call.mock.calls.map((call) => call[0])).toEqual([
      '/prepare',
      '/start',
      '/cleanup',
    ]);
    expect(resources.verifyCleanup).toHaveBeenCalledWith(
      input.executionId,
      expect.objectContaining({
        kind: 'RETIRED',
        resourceId: resource.resourceId,
      }),
    );
  });
  it('does not dispatch input when authority rotates after prepare', async () => {
    const { service, resources, client } = setup();
    resources.assertActive.mockRejectedValue(new Error('fenced'));
    await expect(service.execute(input, context, authority())).rejects.toThrow(
      'fenced',
    );
    expect(client.call.mock.calls.map((call) => call[0])).toEqual(['/prepare']);
  });
  it('recovers a lost response by status within lease without repeating start', async () => {
    const { service, client } = setup();
    const implementation = client.call.getMockImplementation()!;
    client.call.mockImplementation((route) =>
      route === '/start'
        ? Promise.reject(new Error('lost'))
        : implementation(route),
    );
    expect(
      (await service.execute(input, context, authority())).result.diagnosisCode,
    ).toBe('SUCCESS');
    expect(client.call.mock.calls.map((call) => call[0])).toEqual([
      '/prepare',
      '/start',
      '/status',
      '/cleanup',
    ]);
  });
  it('does not retrieve or repeat execution after lease loss', async () => {
    const { service, resources, client } = setup();
    const implementation = client.call.getMockImplementation()!;
    client.call.mockImplementation((route) =>
      route === '/start'
        ? Promise.reject(new Error('lost'))
        : implementation(route),
    );
    resources.assertActive
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('expired'));
    await expect(service.execute(input, context, authority())).rejects.toThrow(
      'expired',
    );
    expect(client.call.mock.calls.map((call) => call[0])).toEqual([
      '/prepare',
      '/start',
    ]);
  });
  it('keeps cleanup uncertain when durable proof storage fails', async () => {
    const { service, resources } = setup();
    resources.verifyCleanup.mockRejectedValue(
      new Error('database unavailable'),
    );
    expect(await service.cleanup(input.executionId, context)).toBe(false);
  });
  it('uses admitted generation for recovery after broker restart', async () => {
    const { service, client } = setup();
    expect(await service.cleanup(input.executionId, context)).toBe(true);
    expect(client.call).toHaveBeenCalledWith('/cleanup', resource, 10000);
  });
  it('never exposes private results or VM evidence through SUBMIT projection', async () => {
    const { service } = setup();
    const value = reply();
    value.result.hiddenRequiredCount = 1;
    value.result.privateTestResults = [
      { id: 'h1', passed: true, stdout: 'hidden-sentinel', stderr: '' },
    ];
    jest.spyOn(service, 'execute').mockResolvedValue({
      result: value.result as never,
      cleanupVerified: true,
    });
    const projected = await new LocalVmSubmissionAdapter(service).execute(
      {
        ...input,
        mode: 'SUBMIT',
        tests: [
          ...input.tests,
          { id: 'h1', visibility: 'hidden', args: [], expected: 1 },
        ],
      },
      context,
      authority(),
    );
    expect(projected.privateTestResults).toEqual([{ id: 'h1', passed: true }]);
    expect(JSON.stringify(projected.technicalResult)).not.toMatch(
      /hidden-sentinel|vmEvidence|cgroups/,
    );
  });
});

describe('private RUN diagnostics', () => {
  it('requires TEST opt-in and projects only bounded fields', async () => {
    const output = jest.fn();
    expect(
      createRunTimingObserver('local', { requestId: id(1) }, '1', output),
    ).toBeUndefined();
    const observer = createRunTimingObserver(
      'test',
      { requestId: id(1), executionId: id(2) },
      '1',
      output,
    );
    expect(await measureRunPhase(observer, 'execute', async () => 42)).toBe(42);
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
      event: 'TEST_RUN_TIMING',
      source: 'run',
      phase: 'execute',
      completed: true,
    });
    observer!({
      source: 'submission',
      phase: 'student-code',
      durationMs: 1,
      completed: true,
    });
    expect(output).toHaveBeenCalledTimes(1);
  });
  it('does not let observer failure change operation results', async () => {
    const observer = createRunTimingObserver(
      'test',
      { requestId: id(1) },
      '1',
      () => {
        throw new Error('log failed');
      },
    );
    expect(await measureRunPhase(observer, 'finish', async () => 42)).toBe(42);
  });
});
