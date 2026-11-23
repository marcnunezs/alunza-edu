// Trusted, finite laboratory catalogue. This module never executes a program,
// starts a service, loads caller-supplied source, or certifies host retirement.
const assert = require('node:assert/strict');

const IMAGE_ID =
  'sha256:59b49b3c72e25715373fd948634307bfcaaf112c3096b85cc46a2ae83e9d3c5b';
const BOUNDARY = '/sys/fs/cgroup/alunzasingleexecutor.slice';
const LIMITS = Object.freeze({
  runtimeMs: 3000,
  outputBytes: 65536,
  memoryBytes: 134217728,
  pids: 32,
  envelopeMemoryBytes: 2147483648,
  vcpus: 1,
  ttlMs: 60000,
});
const LEAF = Object.freeze({
  'memory.max': '134217728',
  'memory.swap.max': '0',
  'cpu.max': '100000 100000',
  'pids.max': '32',
});
const OUTER = Object.freeze({
  'memory.max': '2147483648',
  'memory.swap.max': '0',
  'cpu.max': '100000 100000',
});
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CAPSULE_ID = /^[a-f0-9]{64}$/;
const HIDDEN_SENTINEL = 'HIDDEN_FIXTURE_MUST_NOT_APPEAR_PUBLICLY';
const catalogue = [
  [
    'qjs-loop',
    'infinite-loop',
    'TIMEOUT',
    'EXECUTION_DEADLINE',
    1,
    { watchdog: true },
  ],
  [
    'qjs-cumulative-time',
    'cumulative-budget',
    'TIMEOUT',
    'EXECUTION_DEADLINE',
    2,
    { watchdog: true },
  ],
  ['qjs-heap-memory', 'javascript-heap-memory', 'UNKNOWN', 'MEMORY_LIMIT', 1],
  ['qjs-buffer-memory', 'arraybuffer-memory', 'UNKNOWN', 'MEMORY_LIMIT', 1],
  [
    'output-aggregate-below',
    null,
    'SUCCESS',
    'COMPLETED',
    2,
    { outputTotal: 65535 },
  ],
  [
    'output-aggregate-at',
    null,
    'SUCCESS',
    'COMPLETED',
    2,
    { outputTotal: 65536 },
  ],
  [
    'output-aggregate-over',
    null,
    'UNKNOWN',
    'OUTPUT_LIMIT',
    2,
    { outputTotal: 65537 },
  ],
  ['qjs-host-globals', 'guest-no-host-globals', 'SUCCESS', 'COMPLETED', 1],
  [
    'qjs-import-denied',
    'import-denied',
    'RUNTIME_ERROR',
    'STUDENT_EXCEPTION',
    1,
  ],
  [
    'qjs-stdout-forgery',
    'fake-stdout-verdict',
    'FAILED_TEST',
    'ASSERTION_FAILED',
    1,
  ],
  [
    'qjs-channel-forgery',
    'forged-return-known-gap',
    'RUNTIME_ERROR',
    'STUDENT_EXCEPTION',
    1,
  ],
  [
    'qjs-envelope-forgery',
    'return-envelope-as-value',
    'FAILED_TEST',
    'ASSERTION_FAILED',
    1,
  ],
  ['qjs-state-isolation', 'case-state-isolation', 'SUCCESS', 'COMPLETED', 2],
  [
    'hidden-projection',
    'hidden-projection',
    'SUCCESS',
    'COMPLETED',
    2,
    { mode: 'SUBMIT' },
  ],
].map(([id, source, diagnosis, reason, caseCount, options = {}]) =>
  Object.freeze({
    id,
    kind: 'runner',
    scope: 'QUICKJS',
    source,
    diagnosis,
    reason,
    caseCount,
    ...options,
  }),
);
for (const probe of [
  'identity',
  'permissions',
  'network',
  'processes',
  'memory',
  'descendant-memory',
])
  catalogue.push(
    Object.freeze({
      id: `capsule-${probe}`,
      kind: 'probe',
      scope: 'CAPSULE_KERNEL',
      probe,
      caseCount: 1,
      oom: probe === 'memory' || probe === 'descendant-memory',
    }),
  );
Object.freeze(catalogue);
const PROFILE_IDS = Object.freeze(catalogue.map((item) => item.id));

function profile(id) {
  const selected = catalogue.find((item) => item.id === id);
  assert.ok(selected, 'UNKNOWN_ADVERSARIAL_PROFILE');
  return selected;
}
function describeProfile(id) {
  const item = profile(id);
  return {
    id: item.id,
    kind: item.kind,
    scope: item.scope,
    caseCount: item.caseCount,
    mode: item.mode ?? 'RUN',
    expectedDiagnosis: item.diagnosis ?? null,
    expectedReason: item.reason ?? null,
    expectedNativeOutcome: item.oom ? 'KERNEL_OOM' : (item.probe ?? null),
    limits: { ...LIMITS },
    physicalLastInstructionClaim: false,
    hostRetirementRequired: true,
  };
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
async function buildFixture(id, executionId) {
  const selected = profile(id);
  assert.match(executionId, UUID, 'EXECUTION_ID_REQUIRED');
  if (selected.kind === 'probe')
    return freeze({
      kind: 'probe',
      profile: describeProfile(id),
      probe: selected.probe,
      input: {
        executionId,
        code: 'module.exports.solve=()=>true;',
        args: [],
        budgetMs: 3000,
        outputRemaining: 65536,
      },
    });
  let code, tests;
  if (selected.outputTotal) {
    // Each case emits both stdout and stderr; newline bytes count toward the total.
    code =
      "module.exports.solve=bytes=>{const n=Math.floor(bytes/2);console.log('o'.repeat(n-1));console.error('e'.repeat(bytes-n-1));return true;};";
    tests = [32768, selected.outputTotal - 32768].map((bytes, index) => ({
      id: `visible-${index + 1}`,
      visibility: 'visible',
      args: [bytes],
      expected: true,
    }));
  } else {
    const { runnerFixtures, hiddenSentinel } = await import('../fixtures.mjs');
    const matches = runnerFixtures.filter(
      (item) => item.id === selected.source,
    );
    assert.equal(matches.length, 1, 'FIXTURE_SOURCE_MISSING_OR_DUPLICATE');
    ({ code } = matches[0]);
    tests = JSON.parse(JSON.stringify(matches[0].tests));
    if (id === 'hidden-projection') {
      assert.equal(hiddenSentinel, HIDDEN_SENTINEL, 'HIDDEN_FIXTURE_CHANGED');
      tests.unshift({
        id: 'visible-1',
        visibility: 'visible',
        args: ['visible'],
        expected: 'visible',
      });
    }
  }
  assert.equal(tests.length, selected.caseCount);
  return freeze({
    kind: 'runner',
    profile: describeProfile(id),
    input: {
      executionId,
      requestId: executionId,
      exerciseVersionId: 'physical-adversarial-fixed-v1',
      testsVersion: 'v1',
      entrypoint: 'solve',
      mode: selected.mode ?? 'RUN',
      code,
      tests,
    },
  });
}

const DIAGNOSES = [
  'SUCCESS',
  'SYNTAX_ERROR',
  'RUNTIME_ERROR',
  'FAILED_TEST',
  'TIMEOUT',
  'UNKNOWN',
];
const REASONS = [
  'COMPLETED',
  'STUDENT_SYNTAX',
  'STUDENT_EXCEPTION',
  'ASSERTION_FAILED',
  'EXECUTION_DEADLINE',
  'MEMORY_LIMIT',
  'OUTPUT_LIMIT',
  'RETURN_LIMIT',
  'PROTOCOL_INVALID',
  'RUNNER_FAILURE',
  'PROVIDER_FAILURE',
  'CAPABILITY_GAP',
  'CANCELLED',
];
const ms = (value) => Number.isFinite(value) && value >= 0 && value <= 60000;
const count = (value, max = 65536) =>
  Number.isSafeInteger(value) && value >= 0 && value <= max;
const observedMs = (value) => (ms(value) ? value : null);
const matches = (value, required) =>
  value &&
  Object.entries(required).every(([key, expected]) => value[key] === expected);

function assessment(id, observations, expectedImageId) {
  assert.match(expectedImageId, /^sha256:[a-f0-9]{64}$/);
  const selected = profile(id),
    failures = [];
  const record = {
    schemaVersion: 1,
    fixture: id,
    profileId: id,
    scope: selected.scope,
    expected: describeProfile(id),
    status: 'FAILED',
    pass: false,
    expectedOutcomeObserved: false,
    controlsObserved: false,
    cleanupVerified: false,
    physicalLastInstructionObserved: false,
    hostRetirementRequired: true,
    latencySample: false,
    failures,
    checks: {},
    capsuleCount: 0,
    timingComplete: false,
  };
  const gate = (ok, code) => {
    record.checks[code] = (record.checks[code] ?? true) && Boolean(ok);
    if (!ok && !failures.includes(code)) failures.push(code);
    return Boolean(ok);
  };
  const finish = () => {
    record.pass = failures.length === 0;
    record.status = record.pass ? 'PASSED' : 'FAILED';
    return record;
  };
  const capsules = observations?.capsules;
  gate(
    observations?.imageId === expectedImageId &&
      observations?.kernelBoundary === BOUNDARY,
    'CANDIDATE_IDENTITY',
  );
  const capsuleRows = Array.isArray(capsules) ? capsules : [];
  record.capsuleCount = capsuleRows.length;
  const identities = capsuleRows.map((item) => item?.id);
  const control =
    capsuleRows.length === selected.caseCount &&
    identities.every((id) => typeof id === 'string' && CAPSULE_ID.test(id)) &&
    new Set(identities).size === identities.length &&
    capsuleRows.every(
      (item) =>
        matches(item.leafBeforeInput, LEAF) &&
        matches(item.boundaryBeforeInput, OUTER),
    );
  record.controlsObserved = gate(control, 'BEFORE_INPUT_CONTROLS');
  record.cleanupVerified = gate(
    observations?.cleanupVerified === true,
    'CAPSULE_RETIREMENT_UNCONFIRMED',
  );
  return { selected, record, gate, finish };
}

function projectWatchdog(value, budgetMs, runtimeMs) {
  if (
    !value ||
    ![1, 2].includes(value.version) ||
    value.clock !== 'PERFORMANCE_NOW' ||
    value.origin !== 'BRIDGE_INPUT_PARSED' ||
    value.budgetMs !== budgetMs ||
    value.deadlineMs !== budgetMs ||
    value.lastGuestInstructionObservedMs !== null ||
    !count(value.killAttempts, 10000) ||
    !count(value.killCallSuccesses, value.killAttempts)
  )
    return null;
  if (
    value.version === 2 &&
    (value.retirementReserveMs !== Math.min(50, budgetMs) ||
      value.stopDeadlineMs !== budgetMs - value.retirementReserveMs ||
      typeof value.launchSkipped !== 'boolean')
  )
    return null;
  const fields = [
    'launchRequestedMs',
    'spawnObservedMs',
    'timerArmedMs',
    'timerDelayMs',
    'watchdogFiredMs',
    'watchdogLatenessMs',
    'firstKillAttemptMs',
    'lastKillAttemptMs',
    'firstKillCallSucceededMs',
    'lastKillCallSucceededMs',
    'exitObservedMs',
    'closeObservedMs',
  ];
  if (
    !fields.every((field) => value[field] === null || ms(value[field])) ||
    value.closeObservedMs !== runtimeMs ||
    (value.launchSkipped
      ? value.exitObservedMs !== null
      : !ms(value.exitObservedMs)) ||
    (value.exitObservedMs !== null &&
      value.exitObservedMs > value.closeObservedMs)
  )
    return null;
  return {
    version: value.version,
    ...(value.version === 2
      ? {
          retirementReserveMs: value.retirementReserveMs,
          stopDeadlineMs: value.stopDeadlineMs,
          launchSkipped: value.launchSkipped,
        }
      : {}),
    clock: 'PERFORMANCE_NOW',
    origin: 'BRIDGE_INPUT_PARSED',
    budgetMs,
    deadlineMs: budgetMs,
    ...Object.fromEntries(fields.map((field) => [field, value[field]])),
    killAttempts: value.killAttempts,
    killCallSuccesses: value.killCallSuccesses,
    lastGuestInstructionObservedMs: null,
  };
}

function runnerTiming(selected, result, observations, gate) {
  const rows = result.evidence?.timings,
    dispatches = observations?.dispatches;
  const validArrays =
    Array.isArray(rows) &&
    rows.length === selected.caseCount &&
    Array.isArray(dispatches) &&
    dispatches.length === rows.length;
  gate(validArrays, 'TIMING_OR_DISPATCH_COUNT');
  if (!validArrays) return { rows: [], complete: false, measuredTotal: null };
  const cases = [
    ...(result.visibleTestResults ?? []),
    ...(result.privateTestResults ?? []),
  ];
  let spent = 0,
    output = 0,
    complete = true;
  const projected = rows.map((row, index) => {
    const dispatch = dispatches[index];
    gate(
      ms(dispatch?.budgetMs) &&
        dispatch.budgetMs > 0 &&
        dispatch.budgetMs === 3000 - spent &&
        row?.budgetMs === dispatch.budgetMs,
      'ACCUMULATED_TIME_BUDGET',
    );
    gate(
      dispatch?.outputRemaining === 65536 - output,
      'ACCUMULATED_OUTPUT_BUDGET',
    );
    const measured = observedMs(row?.supervisorProcessMs);
    if (measured === null) complete = false;
    else spent += measured;
    const item = cases[index];
    if (
      item &&
      typeof item.stdout === 'string' &&
      typeof item.stderr === 'string'
    )
      output += Buffer.byteLength(item.stdout) + Buffer.byteLength(item.stderr);
    const watch = projectWatchdog(row?.watchdog, dispatch?.budgetMs, measured);
    return {
      budgetMs: observedMs(dispatch?.budgetMs),
      outputRemaining: count(dispatch?.outputRemaining)
        ? dispatch.outputRemaining
        : null,
      supervisorProcessMs: measured,
      hostStartAttachMs: observedMs(row?.hostStartAttachMs),
      containerWallMs: observedMs(row?.containerWallMs),
      watchdog: watch,
    };
  });
  if (complete) gate(spent === result.runtimeMs, 'CHARGED_TIME_SUM');
  else
    gate(
      selected.reason === 'MEMORY_LIMIT' &&
        result.evidence?.oomObserved === true,
      'TIMING_INCOMPLETE',
    );
  if (selected.outputTotal)
    gate(output === result.outputBytes, 'OUTPUT_BYTE_SUM');
  return { rows: projected, complete, measuredTotal: complete ? spent : null };
}

// Consumes the real runner's ExecutionResult after remote-result validation;
// this projection is not an alternative validator for raw supervisor packets.
function assessRunner(id, result, observations, expectedImageId = IMAGE_ID) {
  const { selected, record, gate, finish } = assessment(
    id,
    observations,
    expectedImageId,
  );
  assert.equal(selected.kind, 'runner', 'RUNNER_PROFILE_REQUIRED');
  try {
    gate(result && typeof result === 'object', 'RESULT_REQUIRED');
    if (!result) return finish();
    record.result = {
      diagnosis: DIAGNOSES.includes(result.diagnosisCode)
        ? result.diagnosisCode
        : 'INVALID',
      reason: REASONS.includes(result.terminationReason)
        ? result.terminationReason
        : 'INVALID',
      infrastructure: ['OK', 'FAILED'].includes(result.infrastructureStatus)
        ? result.infrastructureStatus
        : 'INVALID',
      runtimeMs: observedMs(result.runtimeMs),
      outputBytes: count(result.outputBytes) ? result.outputBytes : null,
      outputTruncated: result.outputTruncated === true,
      visibleCount: Array.isArray(result.visibleTestResults)
        ? result.visibleTestResults.length
        : null,
      hiddenCount: Array.isArray(result.privateTestResults)
        ? result.privateTestResults.length
        : null,
    };
    record.expectedOutcomeObserved = gate(
      result.diagnosisCode === selected.diagnosis &&
        result.terminationReason === selected.reason &&
        result.allRequiredPassed === (selected.diagnosis === 'SUCCESS'),
      'UNEXPECTED_OUTCOME',
    );
    gate(result.infrastructureStatus === 'OK', 'INFRASTRUCTURE_FAILED');
    gate(result.evidence?.image === expectedImageId, 'RESULT_IMAGE_MISMATCH');
    gate(
      result.evidence?.cleanupVerified === true,
      'RUNNER_CLEANUP_UNCONFIRMED',
    );
    gate(count(result.outputBytes), 'OUTPUT_ACCOUNTING_INVALID');
    gate(
      typeof result.outputTruncated === 'boolean',
      'OUTPUT_TRUNCATION_INVALID',
    );
    gate(ms(result.runtimeMs), 'RUNTIME_INVALID');
    // No tolerance or rounding: an expected TIMEOUT can still fail the 3000 ms gate.
    record.withinReportedTimeLimit =
      ms(result.runtimeMs) && result.runtimeMs <= 3000;
    record.reportedOverrunMs = ms(result.runtimeMs)
      ? Math.max(0, result.runtimeMs - 3000)
      : null;
    gate(record.withinReportedTimeLimit, 'REPORTED_RUNTIME_EXCEEDS_3000');
    if (selected.diagnosis === 'SUCCESS')
      gate(result.runtimeMs < 3000, 'SUCCESS_AT_EXHAUSTED_BUDGET');
    const timing = runnerTiming(selected, result, observations, gate);
    record.timings = timing.rows;
    record.timingComplete = timing.complete;
    record.observedStudentRuntimeMs = timing.measuredTotal;
    const cgroups = result.evidence?.cgroups;
    const oomWithoutPacket =
      selected.reason === 'MEMORY_LIMIT' &&
      result.evidence?.oomObserved === true &&
      !timing.complete;
    gate(
      Array.isArray(cgroups) &&
        (cgroups.length === selected.caseCount ||
          (oomWithoutPacket && cgroups.length === 0)) &&
        cgroups.every((row) => matches(row, LEAF)),
      'PACKET_CONTROLS',
    );
    if (selected.outputTotal) {
      gate(
        result.outputBytes === Math.min(selected.outputTotal, 65536) &&
          result.outputTruncated === selected.outputTotal > 65536,
        'EXACT_OUTPUT_BOUNDARY',
      );
    }
    if (selected.watchdog) {
      const watch = timing.rows.at(-1)?.watchdog;
      record.watchdogObserved = Boolean(
        watch &&
        ms(watch.watchdogFiredMs) &&
        watch.killAttempts > 0 &&
        watch.killCallSuccesses > 0 &&
        ms(watch.exitObservedMs) &&
        ms(watch.closeObservedMs),
      );
      gate(record.watchdogObserved, 'WATCHDOG_KILL_NOT_OBSERVED');
      record.physicalDeadlineAcceptance =
        'NOT_ESTABLISHED_BY_NOTIFICATION_TIMESTAMPS';
    }
    if (id === 'hidden-projection') {
      const publicView = observations?.publicProjection;
      const serialized = JSON.stringify(publicView);
      record.hiddenProjectionVerified = gate(
        publicView &&
          serialized.length < 131072 &&
          !serialized.includes(HIDDEN_SENTINEL) &&
          !Object.hasOwn(publicView, 'privateTestResults') &&
          !Object.hasOwn(publicView, 'evidence') &&
          publicView.hiddenChecksPassed === true &&
          publicView.visibleTestResults?.length === 1 &&
          result.privateTestResults?.length === 1 &&
          result.visibleTestResults?.length === 1,
        'HIDDEN_PROJECTION_LEAK_OR_MISSING',
      );
    }
  } catch {
    gate(false, 'MALFORMED_RUNNER_OBSERVATION');
  }
  return finish();
}

function decodeProbe(packet) {
  assert.equal(typeof packet?.returnData, 'string');
  assert.ok(
    packet.returnData.length <= 87384 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        packet.returnData,
      ),
  );
  const bytes = Buffer.from(packet.returnData, 'base64');
  assert.ok(bytes.length <= 65536);
  const decoded = JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(Object.keys(decoded).sort(), ['kind', 'value']);
  assert.equal(decoded.kind, 'probe');
  assert.ok(
    decoded.value &&
      typeof decoded.value === 'object' &&
      !Array.isArray(decoded.value),
  );
  return decoded.value;
}

function assessProbe(id, response, observations, expectedImageId = IMAGE_ID) {
  const { selected, record, gate, finish } = assessment(
    id,
    observations,
    expectedImageId,
  );
  assert.equal(selected.kind, 'probe', 'NATIVE_PROFILE_REQUIRED');
  try {
    gate(response && typeof response === 'object', 'RESPONSE_REQUIRED');
    if (!response) return finish();
    gate(
      response.image === expectedImageId &&
        response.kernelBoundary === BOUNDARY,
      'PROBE_IDENTITY',
    );
    gate(response.cleanupVerified === true, 'PROBE_CLEANUP_UNCONFIRMED');
    gate(
      response.cancelled === false && response.timedOut === false,
      'PROBE_CANCELLED_OR_TIMED_OUT',
    );
    const dispatch = observations?.dispatches;
    gate(
      Array.isArray(dispatch) &&
        dispatch.length === 1 &&
        dispatch[0].budgetMs === 3000 &&
        dispatch[0].outputRemaining === 65536,
      'PROBE_DISPATCH_LIMITS',
    );
    const packet = response.packet;
    const events = packet?.cgroup?.['memory.events'];
    const oom =
      typeof events === 'string' &&
      events.length <= 4096 &&
      /^oom_kill ([1-9]\d*)$/m.exec(events);
    const oomEvents =
      oom && Number.isSafeInteger(Number(oom[1])) ? Number(oom[1]) : 0;
    const runtime = observedMs(packet?.runtimeMs);
    record.timingComplete = runtime !== null;
    record.observedStudentRuntimeMs = runtime;
    record.withinReportedTimeLimit = runtime === null ? null : runtime <= 3000;
    record.reportedOverrunMs =
      runtime === null ? null : Math.max(0, runtime - 3000);
    record.native = {
      oomState: response.oomKilled === true,
      oomKillEvents: oomEvents,
      runtimeMs: runtime,
      containerWallMs: observedMs(response.containerWallMs),
      hostStartAttachMs: observedMs(response.programWallMs),
    };
    if (runtime !== null)
      gate(runtime <= 3000, 'REPORTED_RUNTIME_EXCEEDS_3000');
    if (selected.oom) {
      // OOM may kill the bridge before a packet exists. Kernel readback before
      // stdin and Engine State.OOMKilled remain required; no invented runtime.
      record.expectedOutcomeObserved = gate(
        response.oomKilled === true || oomEvents > 0,
        'KERNEL_OOM_NOT_OBSERVED',
      );
      if (packet?.cgroup) gate(matches(packet.cgroup, LEAF), 'PACKET_CONTROLS');
      record.memoryScope =
        selected.probe === 'descendant-memory'
          ? 'CAPSULE_AND_DESCENDANTS'
          : 'CAPSULE_NATIVE_ALLOCATIONS';
      return finish();
    }
    gate(
      response.exitCode === 0 &&
        packet?.status === 'exited' &&
        packet?.exitCode === 0 &&
        response.oomKilled === false &&
        oomEvents === 0,
      'PROBE_DID_NOT_COMPLETE',
    );
    gate(runtime !== null && runtime < 3000, 'PROBE_TIMING_INCOMPLETE');
    gate(matches(packet?.cgroup, LEAF), 'PACKET_CONTROLS');
    gate(
      packet?.outputBytes === 0 && packet?.outputTruncated === false,
      'UNEXPECTED_PROBE_OUTPUT',
    );
    const value = decodeProbe(packet);
    let outcome = false;
    if (selected.probe === 'identity') {
      const names = ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'];
      outcome =
        value.uid === 10001 &&
        value.node === 'v24.21.0' &&
        value.capabilities &&
        Object.keys(value.capabilities).length === 5 &&
        names.every((name) => value.capabilities[name] === '0000000000000000');
      record.native.identityGuardPassed = Boolean(outcome);
      record.native.guardSource = 'PINNED_WORKER_IDENTITY';
      // The pinned guard additionally requires NoNewPrivs=1 and unreadable PID1 fd1.
    } else if (selected.probe === 'permissions') {
      outcome =
        value.parentDenied === true &&
        value.readonly === true &&
        JSON.stringify(value.environment) ===
          JSON.stringify(['HOME', 'LANG', 'PATH']);
      record.native.parentReadDenied = value.parentDenied === true;
      record.native.bridgeWriteDenied = value.readonly === true;
      record.native.environmentAllowlistMatched = Boolean(outcome);
    } else if (selected.probe === 'network') {
      const denied = [
        'ENETUNREACH',
        'EHOSTUNREACH',
        'EACCES',
        'EPERM',
        'ECONNREFUSED',
      ];
      outcome =
        value.loopbackOnly === true &&
        ['dns', 'ipv6', 'udp'].every((key) => denied.includes(value[key]));
      record.native.loopbackOnly = value.loopbackOnly === true;
      record.native.network = Object.fromEntries(
        ['dns', 'ipv6', 'udp'].map((key) => [
          key,
          denied.includes(value[key]) ? value[key] : 'UNCONFIRMED',
        ]),
      );
    } else if (selected.probe === 'processes') {
      outcome =
        value.uid === 10001 &&
        value.attempted === 40 &&
        count(value.started, 39) &&
        value.started > 0 &&
        count(value.eagain, 40) &&
        value.eagain > 0 &&
        value.started + value.eagain === 40 &&
        value.unexpectedErrors === 0 &&
        value.pidsMax === 32 &&
        count(value.pidsCurrent, 32) &&
        value.pidsCurrent > 0 &&
        value.identitiesValid === true;
      record.native.processes = Object.fromEntries(
        [
          'attempted',
          'started',
          'eagain',
          'unexpectedErrors',
          'pidsMax',
          'pidsCurrent',
        ].map((key) => [key, count(value[key], 40) ? value[key] : null]),
      );
      record.native.childIdentitiesValid = value.identitiesValid === true;
    }
    record.expectedOutcomeObserved = gate(
      outcome,
      'NATIVE_POLICY_NOT_DEMONSTRATED',
    );
  } catch {
    gate(false, 'MALFORMED_PROBE_OBSERVATION');
  }
  return finish();
}

module.exports = {
  PROFILE_IDS,
  IMAGE_ID,
  BOUNDARY,
  LIMITS,
  describeProfile,
  buildFixture,
  assessRunner,
  assessProbe,
};
