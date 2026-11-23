const {
  PROFILE_IDS,
  IMAGE_ID,
  BOUNDARY,
  LIMITS,
  describeProfile,
  buildFixture,
  assessRunner,
  assessProbe,
} = require('./linux-single-execution/adversarial.cjs');

const executionId = '12345678-1234-4234-8234-123456789abc';
const leaf = {
  'memory.max': '134217728',
  'memory.swap.max': '0',
  'cpu.max': '100000 100000',
  'pids.max': '32',
};
const outer = {
  'memory.max': '2147483648',
  'memory.swap.max': '0',
  'cpu.max': '100000 100000',
};
function observations(n = 1) {
  return {
    imageId: IMAGE_ID,
    kernelBoundary: BOUNDARY,
    cleanupVerified: true,
    capsules: Array.from({ length: n }, (_, i) => ({
      id: String(i + 1).repeat(64),
      leafBeforeInput: { ...leaf },
      boundaryBeforeInput: { ...outer },
    })),
    dispatches: Array.from({ length: n }, (_, i) => ({
      budgetMs: 3000 - i * 100,
      outputRemaining: 65536,
    })),
  };
}
function result(n = 1, diagnosis = 'SUCCESS', reason = 'COMPLETED') {
  return {
    diagnosisCode: diagnosis,
    terminationReason: reason,
    infrastructureStatus: 'OK',
    allRequiredPassed: diagnosis === 'SUCCESS',
    runtimeMs: n * 100,
    outputBytes: 0,
    outputTruncated: false,
    visibleTestResults: Array.from({ length: n }, (_, i) => ({
      id: `case-${i}`,
      passed: diagnosis === 'SUCCESS',
      stdout: '',
      stderr: '',
    })),
    privateTestResults: [],
    evidence: {
      image: IMAGE_ID,
      cleanupVerified: true,
      oomObserved: false,
      cgroups: Array.from({ length: n }, () => ({ ...leaf })),
      timings: Array.from({ length: n }, (_, i) => ({
        budgetMs: 3000 - i * 100,
        supervisorProcessMs: 100,
        hostStartAttachMs: 10,
        containerWallMs: 110,
        watchdog: null,
      })),
    },
  };
}

test('an explicitly admitted new image is checked independently of the legacy fixture pin', () => {
  const image = 'sha256:' + 'f'.repeat(64);
  const actual = result();
  const observed = observations();
  actual.evidence.image = image;
  observed.imageId = image;
  expect(assessRunner('qjs-host-globals', actual, observed).pass).toBe(false);
  expect(assessRunner('qjs-host-globals', actual, observed, image).pass).toBe(
    true,
  );
  actual.evidence.image = IMAGE_ID;
  expect(assessRunner('qjs-host-globals', actual, observed, image).pass).toBe(
    false,
  );
});

test('watchdog v2 retains its retirement reserve and the real close time', () => {
  const actual = result(1, 'TIMEOUT', 'EXECUTION_DEADLINE');
  actual.runtimeMs = 2955;
  actual.evidence.timings[0].supervisorProcessMs = 2955;
  actual.evidence.timings[0].watchdog = {
    ...watch(3000, 2955),
    version: 2,
    retirementReserveMs: 50,
    stopDeadlineMs: 2950,
    launchSkipped: false,
    timerDelayMs: 2948,
    watchdogFiredMs: 2950,
    firstKillAttemptMs: 2950,
    lastKillAttemptMs: 2950,
    firstKillCallSucceededMs: 2950,
    lastKillCallSucceededMs: 2950,
  };
  const receipt = assessRunner('qjs-loop', actual, observations());
  expect(receipt.pass).toBe(true);
  expect(receipt.timings[0].watchdog).toMatchObject({
    version: 2,
    retirementReserveMs: 50,
    closeObservedMs: 2955,
  });
  actual.evidence.timings[0].watchdog.retirementReserveMs = 0;
  expect(assessRunner('qjs-loop', actual, observations()).pass).toBe(false);
});
function watch(budgetMs, runtimeMs) {
  return {
    version: 1,
    clock: 'PERFORMANCE_NOW',
    origin: 'BRIDGE_INPUT_PARSED',
    budgetMs,
    deadlineMs: budgetMs,
    launchRequestedMs: 0,
    spawnObservedMs: 1,
    timerArmedMs: 2,
    timerDelayMs: budgetMs - 2,
    watchdogFiredMs: budgetMs,
    watchdogLatenessMs: 0,
    killAttempts: 1,
    killCallSuccesses: 1,
    firstKillAttemptMs: budgetMs,
    lastKillAttemptMs: budgetMs,
    firstKillCallSucceededMs: budgetMs,
    lastKillCallSucceededMs: budgetMs,
    exitObservedMs: runtimeMs,
    closeObservedMs: runtimeMs,
    lastGuestInstructionObservedMs: null,
  };
}
function native(value = {}) {
  return {
    image: IMAGE_ID,
    kernelBoundary: BOUNDARY,
    cleanupVerified: true,
    cancelled: false,
    timedOut: false,
    oomKilled: false,
    exitCode: 0,
    programWallMs: 20,
    containerWallMs: 120,
    packet: {
      status: 'exited',
      exitCode: 0,
      runtimeMs: 100,
      cgroup: { ...leaf },
      outputBytes: 0,
      outputTruncated: false,
      returnData: Buffer.from(
        JSON.stringify({ kind: 'probe', value }),
      ).toString('base64'),
    },
  };
}

test('bounded catalogue separates QuickJS from native kernel probes', () => {
  expect(PROFILE_IDS).toHaveLength(20);
  expect(new Set(PROFILE_IDS).size).toBe(PROFILE_IDS.length);
  expect(
    PROFILE_IDS.filter((id) => describeProfile(id).scope === 'CAPSULE_KERNEL'),
  ).toHaveLength(6);
  expect(
    PROFILE_IDS.every((id) => describeProfile(id).limits.ttlMs === 60000),
  ).toBe(true);
  expect(() => describeProfile('__proto__')).toThrow(
    'UNKNOWN_ADVERSARIAL_PROFILE',
  );
});

test('only known fixtures and UUIDs produce immutable input; no arbitrary source API exists', async () => {
  await expect(buildFixture('external-source', executionId)).rejects.toThrow();
  await expect(buildFixture('qjs-loop', 'studentCode()')).rejects.toThrow();
  for (const id of PROFILE_IDS) {
    const built = await buildFixture(id, executionId);
    expect(Object.isFrozen(built.input)).toBe(true);
    expect(built.input.executionId).toBe(executionId);
    expect(built.profile.id).toBe(id);
    if (built.kind === 'runner')
      expect(built.input.tests).toHaveLength(built.profile.caseCount);
    else {
      expect(built.input.budgetMs).toBe(3000);
      expect(built.input.outputRemaining).toBe(65536);
      expect(built.probe).toBe(id.slice('capsule-'.length));
    }
  }
});

test.each([
  ['below', 32767],
  ['at', 32768],
  ['over', 32769],
])(
  'output aggregate %s keeps a fixed 32768-byte first case and exact second boundary',
  async (suffix, bytes) => {
    const built = await buildFixture(`output-aggregate-${suffix}`, executionId);
    expect(built.input.tests.map((item) => item.args[0])).toEqual([
      32768,
      bytes,
    ]);
    expect(built.input.code).toContain('console.log');
    expect(built.input.code).toContain('console.error');
  },
);

test('hidden fixture has a visible case and keeps hidden values outside metadata', async () => {
  const built = await buildFixture('hidden-projection', executionId);
  expect(built.input.mode).toBe('SUBMIT');
  expect(built.input.tests.map((item) => item.visibility)).toEqual([
    'visible',
    'hidden',
  ]);
  expect(JSON.stringify(built.profile)).not.toContain(
    'HIDDEN_FIXTURE_MUST_NOT_APPEAR_PUBLICLY',
  );
});

test('matching result requires original image, exact leaf/envelope and independent cleanup', () => {
  expect(assessRunner('qjs-host-globals', result(), observations()).pass).toBe(
    true,
  );
  for (const mutate of [
    (o) => {
      o.imageId = `sha256:${'f'.repeat(64)}`;
    },
    (o) => {
      o.kernelBoundary += '/other';
    },
    (o) => {
      o.capsules[0].leafBeforeInput['memory.max'] = '268435456';
    },
    (o) => {
      o.capsules[0].boundaryBeforeInput['cpu.max'] = '200000 100000';
    },
    (o) => {
      o.cleanupVerified = false;
    },
  ]) {
    const o = observations();
    mutate(o);
    expect(assessRunner('qjs-host-globals', result(), o).pass).toBe(false);
  }
});

test('reused capsule IDs and reset time budgets cannot pass cumulative controls', () => {
  const o = observations(2),
    r = result(2);
  expect(assessRunner('qjs-state-isolation', r, o).pass).toBe(true);
  o.capsules[1].id = o.capsules[0].id;
  expect(assessRunner('qjs-state-isolation', r, o).failures).toContain(
    'BEFORE_INPUT_CONTROLS',
  );
  const reset = observations(2);
  reset.dispatches[1].budgetMs = 3000;
  expect(assessRunner('qjs-state-isolation', r, reset).failures).toContain(
    'ACCUMULATED_TIME_BUDGET',
  );
});

test.each([
  ['below', 65535, 'SUCCESS', 'COMPLETED'],
  ['at', 65536, 'SUCCESS', 'COMPLETED'],
  ['over', 65537, 'UNKNOWN', 'OUTPUT_LIMIT'],
])(
  'assesses aggregate output %s without exporting output',
  (suffix, total, diagnosis, reason) => {
    const r = result(2, diagnosis, reason),
      o = observations(2);
    r.outputBytes = Math.min(total, 65536);
    r.outputTruncated = total > 65536;
    r.visibleTestResults[0].stdout = 'x'.repeat(32768);
    r.visibleTestResults[1].stderr = 'y'.repeat(r.outputBytes - 32768);
    o.dispatches[1].outputRemaining = 32768;
    const receipt = assessRunner(`output-aggregate-${suffix}`, r, o);
    expect(receipt.pass).toBe(true);
    expect(JSON.stringify(receipt)).not.toContain('xxxx');
    o.dispatches[1].outputRemaining = 65536;
    expect(assessRunner(`output-aggregate-${suffix}`, r, o).failures).toContain(
      'ACCUMULATED_OUTPUT_BUDGET',
    );
  },
);

test('expected TIMEOUT with measured overshoot remains a failed time gate', () => {
  const r = result(1, 'TIMEOUT', 'EXECUTION_DEADLINE');
  r.runtimeMs = 3026.12;
  r.evidence.timings[0].supervisorProcessMs = r.runtimeMs;
  r.evidence.timings[0].watchdog = watch(3000, r.runtimeMs);
  const receipt = assessRunner('qjs-loop', r, observations());
  expect(receipt.expectedOutcomeObserved).toBe(true);
  expect(receipt.watchdogObserved).toBe(true);
  expect(receipt.pass).toBe(false);
  expect(receipt.reportedOverrunMs).toBeCloseTo(26.12);
  expect(receipt.checks.REPORTED_RUNTIME_EXCEEDS_3000).toBe(false);
  expect(receipt.physicalLastInstructionObserved).toBe(false);
  expect(receipt.latencySample).toBe(false);
});

test('watchdog requires successful kill and retains each case remaining budget', () => {
  const r = result(2, 'TIMEOUT', 'EXECUTION_DEADLINE'),
    o = observations(2);
  r.runtimeMs = 3000;
  r.evidence.timings[0].supervisorProcessMs = 1700;
  r.evidence.timings[1].budgetMs = o.dispatches[1].budgetMs = 1300;
  r.evidence.timings[1].supervisorProcessMs = 1300;
  r.evidence.timings[1].watchdog = watch(1300, 1300);
  expect(assessRunner('qjs-cumulative-time', r, o).pass).toBe(true);
  r.evidence.timings[1].watchdog.killCallSuccesses = 0;
  expect(assessRunner('qjs-cumulative-time', r, o).failures).toContain(
    'WATCHDOG_KILL_NOT_OBSERVED',
  );
});

test('TIMEOUT without a valid watchdog does not certify a physical kill', () => {
  const r = result(1, 'TIMEOUT', 'EXECUTION_DEADLINE');
  const receipt = assessRunner('qjs-loop', r, observations());
  expect(receipt.expectedOutcomeObserved).toBe(true);
  expect(receipt.pass).toBe(false);
  expect(receipt.watchdogObserved).toBe(false);
});

test('a student-forged SUCCESS does not replace the expected failed assertion', () => {
  const r = result(1, 'FAILED_TEST', 'ASSERTION_FAILED');
  r.visibleTestResults[0].stdout = '{"passed":true,"diagnosis":"SUCCESS"}';
  r.outputBytes = Buffer.byteLength(r.visibleTestResults[0].stdout);
  expect(assessRunner('qjs-stdout-forgery', r, observations()).pass).toBe(true);
  r.diagnosisCode = 'SUCCESS';
  r.terminationReason = 'COMPLETED';
  r.allRequiredPassed = true;
  expect(
    assessRunner('qjs-stdout-forgery', r, observations()).failures,
  ).toContain('UNEXPECTED_OUTCOME');
});

test('hidden projection leaks fail without copying private input into receipt', () => {
  const r = result(2),
    o = observations(2);
  r.privateTestResults = [r.visibleTestResults.pop()];
  o.publicProjection = { visibleTestResults: [{}], hiddenChecksPassed: true };
  expect(assessRunner('hidden-projection', r, o).pass).toBe(true);
  o.publicProjection.privateTestResults = [
    { output: 'HIDDEN_FIXTURE_MUST_NOT_APPEAR_PUBLICLY' },
  ];
  const receipt = assessRunner('hidden-projection', r, o);
  expect(receipt.pass).toBe(false);
  expect(JSON.stringify(receipt)).not.toContain(
    'HIDDEN_FIXTURE_MUST_NOT_APPEAR_PUBLICLY',
  );
});

test.each(['capsule-memory', 'capsule-descendant-memory'])(
  'native %s requires kernel OOM; absence of a packet never invents time',
  (id) => {
    const r = native();
    r.oomKilled = true;
    r.packet = null;
    r.exitCode = 137;
    const receipt = assessProbe(id, r, observations());
    expect(receipt.pass).toBe(true);
    expect(receipt.observedStudentRuntimeMs).toBeNull();
    expect(receipt.withinReportedTimeLimit).toBeNull();
    expect(receipt.timingComplete).toBe(false);
    r.oomKilled = false;
    expect(assessProbe(id, r, observations()).failures).toContain(
      'KERNEL_OOM_NOT_OBSERVED',
    );
  },
);

test('kernel event OOM is independent from QuickJS memory failure and still requires cleanup', () => {
  const r = native();
  r.packet.cgroup['memory.events'] = 'oom 1\noom_kill 1\n';
  expect(assessProbe('capsule-memory', r, observations()).pass).toBe(true);
  r.cleanupVerified = false;
  expect(assessProbe('capsule-memory', r, observations()).pass).toBe(false);
});

test('native identity is exact UID, five zero capabilities and pinned Node', () => {
  const value = {
    uid: 10001,
    node: 'v24.21.0',
    capabilities: Object.fromEntries(
      ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'].map((name) => [
        name,
        '0000000000000000',
      ]),
    ),
  };
  expect(
    assessProbe('capsule-identity', native(value), observations()).pass,
  ).toBe(true);
  value.capabilities.CapEff = '0000000000000020';
  expect(
    assessProbe('capsule-identity', native(value), observations()).pass,
  ).toBe(false);
});

test('native filesystem policies require real denial, read-only bridge and exact environment', () => {
  const value = {
    parentDenied: true,
    readonly: true,
    environment: ['HOME', 'LANG', 'PATH'],
  };
  expect(
    assessProbe('capsule-permissions', native(value), observations()).pass,
  ).toBe(true);
  value.environment.push('SECRET');
  const receipt = assessProbe(
    'capsule-permissions',
    native(value),
    observations(),
  );
  expect(receipt.pass).toBe(false);
  expect(JSON.stringify(receipt)).not.toContain('SECRET');
});

test('network timeout is inconclusive, never equivalent to denied egress', () => {
  const value = {
    loopbackOnly: true,
    dns: 'ECONNREFUSED',
    ipv6: 'ENETUNREACH',
    udp: 'ENETUNREACH',
  };
  expect(
    assessProbe('capsule-network', native(value), observations()).pass,
  ).toBe(true);
  value.udp = 'PROBE_TIMEOUT';
  expect(
    assessProbe('capsule-network', native(value), observations()).pass,
  ).toBe(false);
});

test('process policy requires exhaustion, bounded task count and children without capabilities', () => {
  const value = {
    uid: 10001,
    attempted: 40,
    started: 20,
    eagain: 20,
    unexpectedErrors: 0,
    pidsMax: 32,
    pidsCurrent: 32,
    identitiesValid: true,
  };
  expect(
    assessProbe('capsule-processes', native(value), observations()).pass,
  ).toBe(true);
  value.identitiesValid = false;
  expect(
    assessProbe('capsule-processes', native(value), observations()).pass,
  ).toBe(false);
});

test('malformed native payload and arbitrary diagnostics cannot leak through receipt', () => {
  const r = native({ private: 'DO_NOT_REPORT' });
  r.packet.returnData = Buffer.from(
    '{"kind":"value","value":"DO_NOT_REPORT"}',
  ).toString('base64');
  r.code = 'STUDENT_SOURCE_SECRET';
  const receipt = assessProbe('capsule-identity', r, observations());
  expect(receipt.pass).toBe(false);
  expect(JSON.stringify(receipt)).not.toMatch(
    /DO_NOT_REPORT|STUDENT_SOURCE_SECRET|returnData/,
  );
  expect(
    Object.values(receipt.checks).every((value) => typeof value === 'boolean'),
  ).toBe(true);
});

test('malformed runner observations and missing cleanup remain failed evidence', () => {
  const r = result();
  r.evidence.timings = null;
  r.evidence.cleanupVerified = false;
  r.diagnosisCode = 'PRIVATE_DIAGNOSIS_TEXT';
  const receipt = assessRunner('qjs-host-globals', r, observations());
  expect(receipt.pass).toBe(false);
  expect(receipt.failures).toContain('RUNNER_CLEANUP_UNCONFIRMED');
  expect(JSON.stringify(receipt)).not.toContain('PRIVATE_DIAGNOSIS_TEXT');
  expect(assessRunner('qjs-host-globals', null, null).pass).toBe(false);
  expect(LIMITS.memoryBytes).toBe(134217728);
});
