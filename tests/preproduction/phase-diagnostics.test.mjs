import catalog from '../../scripts/phase-context.cjs';
import {
  sanitizeBrowserDiagnostic,
  summarizePhaseDiagnostics,
  observationCoverage,
} from '../../scripts/phase-diagnostics.mjs';

const base = 1_800_000_000_000;
const uuid = (index) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
function fixture({ combined = false } = {}) {
  const apiEvents = [],
    browserProfiles = [];
  let nextRequest = 1;
  const paths = {
    identity: '/api/v1/me',
    class: '/api/v1/classes/:id',
    organization: '/api/v1/organizations/:orgId',
    dashboard: '/api/v1/classes/:id/dashboard',
    signals: '/api/v1/classes/:id/signals',
    progress: '/api/v1/me/progress',
  };
  function request(route, start) {
    const requestId = uuid(nextRequest++);
    const service = ['dashboard', 'signals'].includes(route)
      ? 'dashboard'
      : route === 'progress'
        ? 'progress'
        : null;
    apiEvents.push({
      event: 'PHASE_DIAGNOSTIC_REQUEST',
      schemaVersion: 1,
      processInstanceId: uuid(0),
      requestId,
      path: paths[route],
      method: 'GET',
      status: 200,
      terminal: 'finish',
      startedAtUnixMs: base + start + 5,
      durationMs: 20,
      spans: [
        'auth.jwt',
        'db.pool',
        'db.begin',
        'db.role',
        'db.context',
        'db.session',
        'db.action',
        ...(service ? [`${service}.query`, `${service}.parse`] : []),
        'db.commit',
        ...(service ? [`${service}.responseParse`] : []),
      ].map((name, index) => ({
        name,
        startMs: index,
        durationMs: name === 'db.action' ? 3 : 1,
        outcome: 'ok',
      })),
      pool: {
        before: { total: 4, idle: 3, waiting: 0 },
        after: { total: 4, idle: 3, waiting: 0 },
      },
      observerSelfTimeMs: 0.01,
      dropped: 0,
    });
    return {
      seq: nextRequest,
      route,
      method: 'GET',
      start: 5,
      headers: 25,
      end: 25,
      status: 200,
      requestId,
      outcome: 'fulfilled',
      aborted: false,
    };
  }
  const selected = (
    combined ? ['dashboard', 'progress'] : ['dashboard']
  ).flatMap((surface) =>
    [1, 4].map((concurrency) => ({ surface, concurrency })),
  );
  for (const { surface, concurrency } of selected) {
    const offset =
      (surface === 'progress' ? 24000 : 0) + (concurrency === 1 ? 0 : 12000);
    const diagnostics = Array.from({ length: 51 }, (_, index) => {
      const start = offset + index * 200;
      const routes =
        surface === 'progress' ? ['progress'] : ['dashboard', 'signals'];
      if (combined) routes.unshift('identity', 'class', 'organization');
      const requests = routes.map((route) => request(route, start));
      return {
        schemaVersion: 1,
        ...(combined ? { surface } : {}),
        navIndex: index,
        isFirst: index === 0,
        profile: concurrency,
        valid: true,
        runnerStart: start,
        runnerEnd: start + 100,
        autTimeOrigin: base + start,
        clockSync: {
          runnerBefore: start,
          autNow: 1,
          runnerAfter: start + 1,
          offsetMin: start - 1,
          offsetMax: start,
        },
        events: [
          { name: 'observer:installed', at: 1 },
          ...[
            'session:effect',
            'session:client-ready',
            'session:state',
            'identity:ready',
          ].map((name, index) => ({ name, at: index + 2 })),
          ...requests.flatMap((request) =>
            [
              'json:start',
              'json:end',
              'validation:start',
              'validation:end',
            ].map((name, index) => ({
              name,
              at: 26 + index,
              requestId: request.requestId,
              route: request.route,
            })),
          ),
          { name: 'dom:ready', at: 100 },
        ],
        requests,
        requestIds: requests.map((r) => r.requestId),
        navigation: {
          startTime: 0,
          responseEnd: 2,
          domInteractive: 3,
          domContentLoadedEventEnd: 4,
          loadEventEnd: 5,
        },
        longTasks: [],
        domReadyAt: 100,
        selfCostMs: 0.01,
        runnerSelfCostMs: 0.01,
        dropped: 0,
        unsupported: [],
      };
    });
    const background =
      concurrency === 4
        ? Array.from({ length: 3 }, (_, index) => {
            const observed = request(surface, offset + index * 200);
            return {
              requestId: observed.requestId,
              status: 200,
              valid: true,
              startedAtUnixMs: base + offset + index * 200,
              startedAtMs: index * 200,
              finishedAtMs: index * 200 + 20,
              durationMs: 20,
            };
          })
        : [];
    browserProfiles.push({
      surface,
      concurrency,
      firstNavigationMs: 100,
      firstNavigationValid: true,
      samples: Array.from({ length: 50 }, () => ({
        durationMs: 100,
        valid: true,
      })),
      diagnostics,
      backgroundDiagnostics:
        concurrency === 4 ? { requests: background, dropped: 0 } : null,
      fixtureObserver: { selfTimeMs: 1, elapsedMs: 10000, dropped: 0 },
    });
  }
  const hostSamples = [];
  const observationEnd = combined ? 49000 : 25000;
  for (let elapsedMs = 0; elapsedMs <= observationEnd; elapsedMs += 1000) {
    const timestampUnixMs = base - 1000 + elapsedMs;
    apiEvents.push({
      event: 'PHASE_DIAGNOSTIC_PROCESS',
      schemaVersion: 1,
      processInstanceId: uuid(0),
      timestampUnixMs,
      elapsedMs,
      intervalMs: 1000,
      cpu: { userMs: 10, systemMs: 2 },
      rssBytes: 1000000,
      heapUsedBytes: 500000,
      eventLoop: {
        utilization: 0.2,
        delayMeanMs: 2,
        delayP95Ms: 3,
        delayMaxMs: 4,
      },
      observerSelfTimeMs: elapsedMs / 10000,
      dropped: 0,
      emission: {
        count: 1,
        selfTimeMs: 1,
        maxSelfTimeMs: 0.1,
        backpressureEvents: 0,
        backpressureMs: 0,
        writeErrors: 0,
      },
      final: false,
    });
    hostSamples.push({
      timestampUnixMs,
      elapsedMs,
      observerSelfTimeMs: elapsedMs / 10000,
      host: {
        logicalCpus: 12,
        memoryBytes: 3000000,
        freeMemoryBytes: 2000000,
        cpuTimeMs: { idle: elapsedMs, total: elapsedMs * 2 },
      },
    });
  }
  let nextCase = 0;
  const tests = [8, 8, 5, 8, 8, 7, 8, 3, 5, 9].flatMap((count, index) =>
    catalog.contextCaseIds.slice(nextCase, (nextCase += count)).map((id) => ({
      id,
      spec: catalog.contextSpecs[index],
      state:
        id === 'IMP05-PHASE-07' || (combined && id === 'IMP05-PHASE-08')
          ? 'failed'
          : 'passed',
    })),
  );
  return {
    ...(combined
      ? {
          diagnosticScope: 'dashboard+progress',
          allowedContextFailures: ['IMP05-PHASE-07', 'IMP05-PHASE-08'],
        }
      : {}),
    browserProfiles,
    apiEvents,
    hostObservation: {
      samples: hostSamples,
      elapsedMs: observationEnd,
      totalSelfTimeMs: observationEnd / 10000,
      dropped: 0,
      failed: 0,
      startedAtUnixMs: base - 1000,
      endedAtUnixMs: base + observationEnd - 1000,
    },
    contextReport: {
      suite: 'phase-context',
      pending: 0,
      skipped: 0,
      contextCoverage: {
        actualSpecs: [...catalog.contextSpecs],
        capturesComplete: true,
      },
      tests,
    },
    candidate: {
      before: { sourceDigest: 'a'.repeat(64) },
      after: { sourceDigest: 'a'.repeat(64) },
    },
  };
}

test('complete instrumented evidence joins every critical request without claiming the latency gate passed', () => {
  const result = summarizePhaseDiagnostics(fixture());
  expect(result.reasons).toEqual([]);
  expect(result).toMatchObject({
    schemaVersion: 1,
    status: 'observed',
    causalEligible: true,
    correlation: { required: 207, correlated: 207, fraction: 1 },
  });
  expect(result.api.processes).toHaveLength(2);
  expect(result.api.processes.every((p) => !p.finalSeen && p.cost.passed)).toBe(
    true,
  );
  expect(result.host.profiles.every((p) => p.cost.passed)).toBe(true);
});
test('request IDs join independent clocks; API elapsed timestamps are never subtracted from browser clocks', () => {
  const input = fixture();
  for (const event of input.apiEvents) {
    if (event.startedAtUnixMs !== undefined) event.startedAtUnixMs += 1_000_000;
    if (event.timestampUnixMs !== undefined) event.timestampUnixMs += 1_000_000;
  }
  expect(summarizePhaseDiagnostics(input).correlation.fraction).toBe(1);
  expect(summarizePhaseDiagnostics(input).causalEligible).toBe(true);
});
test('allowlists discard sensitive extras and malformed route names without exposing them', () => {
  const input = fixture();
  input.apiEvents[0].token = 'SENSITIVE_SECRET';
  input.browserProfiles[0].diagnostics[0].requests[0].url = 'SENSITIVE_SECRET';
  input.hostObservation.samples[0].host.secret = 'SENSITIVE_SECRET';
  expect(JSON.stringify(summarizePhaseDiagnostics(input))).not.toContain(
    'SENSITIVE_SECRET',
  );
  input.browserProfiles[0].diagnostics[0].requests[0].route =
    'SENSITIVE_SECRET';
  const result = summarizePhaseDiagnostics(input);
  expect(result.causalEligible).toBe(false);
  expect(JSON.stringify(result)).not.toContain('SENSITIVE_SECRET');
});
test('missing correlation, duplicated API records and parser losses invalidate evidence', () => {
  const missing = fixture();
  missing.apiEvents.shift();
  expect(summarizePhaseDiagnostics(missing).reasons).toContain(
    'CRITICAL_REQUEST_CORRELATION',
  );
  const duplicate = fixture();
  duplicate.apiEvents.push(duplicate.apiEvents[0]);
  expect(summarizePhaseDiagnostics(duplicate).reasons).toContain(
    'API_REQUEST_DUPLICATED',
  );
  const rejected = fixture();
  rejected.apiEvents = { events: rejected.apiEvents, malformed: 1, dropped: 0 };
  expect(summarizePhaseDiagnostics(rejected).reasons).toContain(
    'API_RECORDS_REJECTED',
  );
});
test('critical successful requests require every authorization, transaction and dashboard span', () => {
  for (const missing of [
    'all',
    'auth.jwt',
    'db.pool',
    'db.begin',
    'db.role',
    'db.context',
    'db.session',
    'db.action',
    'db.commit',
    'dashboard.query',
    'dashboard.parse',
    'dashboard.responseParse',
  ]) {
    const input = fixture();
    input.apiEvents[0].spans =
      missing === 'all'
        ? []
        : input.apiEvents[0].spans.filter((span) => span.name !== missing);
    const result = summarizePhaseDiagnostics(input);
    expect(result.correlation.fraction).toBe(1);
    expect(result.reasons).toContain('CRITICAL_REQUEST_SPANS_INCOMPLETE');
    expect(result.causalEligible).toBe(false);
  }
});
test('web hooks must record session and JSON/schema phases with the same request identity and route', () => {
  for (const missing of [
    'all',
    'session:effect',
    'session:client-ready',
    'session:state',
    'identity:ready',
    'json:start',
    'json:end',
    'validation:start',
    'validation:end',
  ]) {
    const input = fixture();
    const nav = input.browserProfiles[0].diagnostics[0];
    nav.events =
      missing === 'all'
        ? []
        : nav.events.filter((event) => event.name !== missing);
    expect(summarizePhaseDiagnostics(input).reasons).toContain(
      'BROWSER_MARKERS_INCOMPLETE',
    );
  }
  for (const field of ['requestId', 'route']) {
    const input = fixture();
    const marker = input.browserProfiles[0].diagnostics[0].events.find(
      (event) => event.name === 'validation:end',
    );
    marker[field] = field === 'route' ? 'identity' : uuid(999999);
    expect(summarizePhaseDiagnostics(input).reasons).toContain(
      'BROWSER_MARKERS_INCOMPLETE',
    );
  }
});
test('gaps beyond five percent and missing sensors remain unavailable, not zero', () => {
  expect(observationCoverage([0, 1000, 5000, 6000], 0, 6000)).toMatchObject({
    status: 'partial',
    missingMs: 4000,
  });
  const input = fixture();
  input.hostObservation.samples = input.hostObservation.samples.filter(
    (s) => s.elapsedMs < 14000 || s.elapsedMs > 19000,
  );
  input.apiEvents.find(
    (event) =>
      event.event === 'PHASE_DIAGNOSTIC_PROCESS' && event.elapsedMs === 15000,
  ).eventLoop.delayMeanMs = null;
  const result = summarizePhaseDiagnostics(input);
  expect(result.reasons).toContain('HOST_COVERAGE_OR_DROPS');
  expect(result.reasons).toContain('API_SENSOR_UNAVAILABLE');
  expect(
    result.host.profiles.find((p) => p.concurrency === 4).coverage
      .missingFraction,
  ).toBeGreaterThan(0.05);
});
test('observer cost is checked per profile and cannot be diluted by the preceding suite', () => {
  const input = fixture();
  for (const event of input.apiEvents)
    if (event.event === 'PHASE_DIAGNOSTIC_PROCESS' && event.elapsedMs >= 13000)
      event.observerSelfTimeMs += (event.elapsedMs - 12000) * 0.02;
  for (const event of input.hostObservation.samples)
    if (event.elapsedMs >= 13000)
      event.observerSelfTimeMs += (event.elapsedMs - 12000) * 0.02;
  input.hostObservation.elapsedMs = 1_000_000;
  input.hostObservation.totalSelfTimeMs = 300;
  const result = summarizePhaseDiagnostics(input);
  expect(result.host.cumulativeCost.passed).toBe(true);
  expect(
    result.host.profiles.find((p) => p.concurrency === 1).cost.passed,
  ).toBe(true);
  expect(
    result.host.profiles.find((p) => p.concurrency === 4).cost.passed,
  ).toBe(false);
  expect(result.reasons).toEqual(
    expect.arrayContaining(['HOST_OBSERVER_COST', 'API_OBSERVER_COST']),
  );
});
test('every warm and first sample survives reporting, including a failing tail', () => {
  const input = fixture();
  for (let index = 0; index < 3; index++)
    input.browserProfiles[1].samples[index].durationMs = 9000;
  const result = summarizePhaseDiagnostics(input);
  expect(result.profiles[1].samples).toHaveLength(50);
  expect(result.profiles[1].p95Ms).toBe(9000);
  expect(result.profiles[1].firstNavigationMs).toBe(100);
  expect(result.reasons).toContain('BROWSER_GATE_CLOCK_MISMATCH');
});
test('truncation, missing first navigation, changed candidate and an unrelated prefix failure cannot qualify', () => {
  const input = fixture();
  input.browserProfiles[0].diagnostics[0].events = Array.from(
    { length: 1025 },
    () => ({ name: 'dom:ready', at: 10 }),
  );
  input.browserProfiles[0].diagnostics[0] = sanitizeBrowserDiagnostic(
    input.browserProfiles[0].diagnostics[0],
  );
  input.browserProfiles[1].diagnostics.shift();
  input.contextReport.tests[0].state = 'failed';
  input.candidate.after.sourceDigest = 'b'.repeat(64);
  expect(summarizePhaseDiagnostics(input).reasons).toEqual(
    expect.arrayContaining([
      'BROWSER_NAVIGATION_INVALID',
      'BROWSER_PROFILE_INCOMPLETE',
      'CANDIDATE_CHANGED_OR_MISSING',
      'CONTEXT_UNEXPECTED_FAILURE',
    ]),
  );
});
test('process instances are isolated when a preceding API process has a different clock and cost', () => {
  const input = fixture();
  input.apiEvents.push({
    event: 'PHASE_DIAGNOSTIC_PROCESS',
    schemaVersion: 1,
    processInstanceId: uuid(9999),
    timestampUnixMs: base - 30000,
    elapsedMs: 999999,
    intervalMs: 1000,
    cpu: { userMs: 1, systemMs: 1 },
    rssBytes: 100,
    heapUsedBytes: 50,
    eventLoop: {
      utilization: 0.2,
      delayMeanMs: 1,
      delayP95Ms: 2,
      delayMaxMs: 3,
    },
    observerSelfTimeMs: 500000,
    dropped: 0,
    emission: {
      count: 1,
      selfTimeMs: 100,
      maxSelfTimeMs: 100,
      backpressureEvents: 0,
      backpressureMs: 0,
      writeErrors: 0,
    },
    final: true,
  });
  const result = summarizePhaseDiagnostics(input);
  expect(result.causalEligible).toBe(true);
  expect(
    result.api.processes.every((p) => p.processInstanceId === uuid(0)),
  ).toBe(true);
});
test('browser sensor gaps and failed first readings remain explicit without inventing zero latency', () => {
  const input = fixture();
  input.browserProfiles[1].firstNavigationValid = false;
  for (const nav of input.browserProfiles[1].diagnostics.slice(0, 3))
    nav.unsupported = ['longtask'];
  const result = summarizePhaseDiagnostics(input);
  expect(result.reasons).toEqual(
    expect.arrayContaining(['BROWSER_GATE_INVALID']),
  );
  expect(result.profiles[1].sensors.longtask.missingFraction).toBeGreaterThan(
    0.05,
  );
  expect(result.profiles[1].firstNavigationMs).toBe(100);
  input.browserProfiles[1].firstNavigationValid = true;
  const optional = summarizePhaseDiagnostics(input);
  expect(optional.causalEligible).toBe(true);
  expect(optional.profiles[1].sensors.longtask.available).toBe(false);
});

test('declared combined scope retains four distinct profiles and correlates each surface independently', () => {
  const input = fixture({ combined: true });
  const result = summarizePhaseDiagnostics(input);
  expect(result.reasons).toEqual([]);
  expect(result.causalEligible).toBe(true);
  expect(result.diagnosticScope).toBe('dashboard+progress');
  expect(
    result.profiles.map((profile) => [profile.surface, profile.concurrency]),
  ).toEqual([
    ['dashboard', 1],
    ['dashboard', 4],
    ['progress', 1],
    ['progress', 4],
  ]);
  expect(result.correlation).toMatchObject({
    required: 924,
    correlated: 924,
    fraction: 1,
  });
  expect(
    result.correlation.profiles.map((profile) => [
      profile.surface,
      profile.concurrency,
      profile.required,
      profile.fraction,
    ]),
  ).toEqual([
    ['dashboard', 1, 255, 1],
    ['dashboard', 4, 258, 1],
    ['progress', 1, 204, 1],
    ['progress', 4, 207, 1],
  ]);
  expect(result.api.processes).toHaveLength(4);
  expect(result.host.profiles).toHaveLength(4);
  expect(
    result.profiles.every(
      (profile) =>
        profile.samples.length === 50 && profile.firstNavigationMs === 100,
    ),
  ).toBe(true);
});

test('legacy missing navigation surface means dashboard only; explicit invalid values cannot invoke compatibility', () => {
  const legacy = summarizePhaseDiagnostics(fixture());
  expect(legacy.causalEligible).toBe(true);
  expect(
    legacy.profiles.every((profile) =>
      profile.diagnostics.every((nav) => nav.surface === 'dashboard'),
    ),
  ).toBe(true);
  for (const surface of [null, 'private-surface', undefined]) {
    const input = fixture({ combined: true });
    input.browserProfiles[2].diagnostics[0].surface = surface;
    const result = summarizePhaseDiagnostics(input);
    expect(result.reasons).toContain('BROWSER_NAVIGATION_INVALID');
    expect(JSON.stringify(result)).not.toContain('private-surface');
  }
  const missing = fixture({ combined: true });
  delete missing.browserProfiles[2].diagnostics[0].surface;
  expect(summarizePhaseDiagnostics(missing).reasons).toContain(
    'BROWSER_NAVIGATION_INVALID',
  );
});

test('scope is independent of available profiles, rejects loss or duplication, and never infers a smaller experiment', () => {
  for (const mutate of [
    (input) => {
      input.browserProfiles = input.browserProfiles.slice(0, 2);
    },
    (input) => {
      input.browserProfiles[3] = input.browserProfiles[1];
    },
    (input) => {
      input.browserProfiles.push(input.browserProfiles[0]);
    },
  ]) {
    const input = fixture({ combined: true });
    mutate(input);
    expect(summarizePhaseDiagnostics(input).reasons).toContain(
      'BROWSER_PROFILES_MISSING',
    );
  }
  for (const scope of [null, 'unknown']) {
    const input = fixture({ combined: true });
    input.diagnosticScope = scope;
    expect(summarizePhaseDiagnostics(input).reasons).toContain(
      'DIAGNOSTIC_SCOPE_INVALID',
    );
  }
});

test('combined navigation requires successful identity, class, organization and its own data routes', () => {
  for (const route of ['identity', 'class', 'organization', 'progress']) {
    const input = fixture({ combined: true });
    const nav = input.browserProfiles[2].diagnostics[0];
    nav.requests = nav.requests.filter((request) => request.route !== route);
    expect(summarizePhaseDiagnostics(input).reasons).toContain(
      'BROWSER_CRITICAL_ROUTES_MISSING',
    );
  }
  const wrongSurface = fixture({ combined: true });
  wrongSurface.browserProfiles[2].diagnostics[0].requests[3].route =
    'dashboard';
  const invalid = summarizePhaseDiagnostics(wrongSurface);
  expect(invalid.reasons).toContain('BROWSER_CRITICAL_ROUTES_UNEXPECTED');
  expect(invalid.reasons).toContain('CRITICAL_REQUEST_CORRELATION');
});

test('every successful progress request requires progress-specific and shared transaction spans', () => {
  for (const missing of [
    'auth.jwt',
    'db.pool',
    'db.begin',
    'db.role',
    'db.context',
    'db.session',
    'db.action',
    'db.commit',
    'progress.query',
    'progress.parse',
    'progress.responseParse',
  ]) {
    const input = fixture({ combined: true });
    const request = input.apiEvents.find(
      (event) => event.path === '/api/v1/me/progress',
    );
    request.spans = request.spans.filter((span) => span.name !== missing);
    const result = summarizePhaseDiagnostics(input);
    expect(result.correlation.fraction).toBe(1);
    expect(result.reasons).toContain('CRITICAL_REQUEST_SPANS_INCOMPLETE');
  }
});

test('progress JSON and schema marks must match the progress request identity and route', () => {
  for (const marker of [
    'json:start',
    'json:end',
    'validation:start',
    'validation:end',
  ]) {
    const input = fixture({ combined: true });
    const nav = input.browserProfiles[2].diagnostics[0];
    nav.events = nav.events.filter(
      (event) => !(event.route === 'progress' && event.name === marker),
    );
    expect(summarizePhaseDiagnostics(input).reasons).toContain(
      'BROWSER_MARKERS_INCOMPLETE',
    );
  }
});

test('progress background correlation uses the progress endpoint and does not borrow dashboard coverage', () => {
  const input = fixture({ combined: true });
  const requestId =
    input.browserProfiles[3].backgroundDiagnostics.requests[0].requestId;
  input.apiEvents.find((event) => event.requestId === requestId).path =
    '/api/v1/classes/:id/dashboard';
  const result = summarizePhaseDiagnostics(input);
  expect(result.reasons).toContain('CRITICAL_REQUEST_CORRELATION');
  expect(
    result.correlation.profiles.find(
      (profile) => profile.surface === 'dashboard' && profile.concurrency === 4,
    ).fraction,
  ).toBe(1);
  expect(
    result.correlation.profiles.find(
      (profile) => profile.surface === 'progress' && profile.concurrency === 4,
    ).fraction,
  ).toBeLessThan(1);
});

test('missing progress background, losses and invalid request data reject combined observation', () => {
  for (const mutate of [
    (background) => {
      background.requests = [];
    },
    (background) => {
      background.dropped = 1;
    },
    (background) => {
      background.requests[0].valid = false;
    },
    (background) => {
      background.requests[0].status = 503;
    },
    (background) => {
      background.requests[0].durationMs = null;
    },
    (background) => {
      background.requests[0].finishedAtMs = -1;
    },
  ]) {
    const input = fixture({ combined: true });
    mutate(input.browserProfiles[3].backgroundDiagnostics);
    const result = summarizePhaseDiagnostics(input);
    expect(result.causalEligible).toBe(false);
    expect(
      result.profiles[3].observationReasons.some((reason) =>
        reason.startsWith('BACKGROUND_'),
      ),
    ).toBe(true);
  }
});

test('observer cost above one percent in progress concurrency four cannot be diluted by dashboard or serial progress', () => {
  const input = fixture({ combined: true });
  for (const event of input.apiEvents)
    if (event.event === 'PHASE_DIAGNOSTIC_PROCESS' && event.elapsedMs >= 37000)
      event.observerSelfTimeMs += (event.elapsedMs - 36000) * 0.02;
  for (const sample of input.hostObservation.samples)
    if (sample.elapsedMs >= 37000)
      sample.observerSelfTimeMs += (sample.elapsedMs - 36000) * 0.02;
  input.hostObservation.elapsedMs = 1_000_000;
  input.hostObservation.totalSelfTimeMs = 300;
  const result = summarizePhaseDiagnostics(input);
  expect(result.host.cumulativeCost.passed).toBe(true);
  for (const list of [result.host.profiles, result.api.processes]) {
    expect(
      list
        .filter(
          (profile) =>
            !(profile.surface === 'progress' && profile.concurrency === 4),
        )
        .every((profile) => profile.cost.passed),
    ).toBe(true);
    expect(
      list.find(
        (profile) =>
          profile.surface === 'progress' && profile.concurrency === 4,
      ).cost.passed,
    ).toBe(false);
  }
  expect(result.reasons).toEqual(
    expect.arrayContaining(['API_OBSERVER_COST', 'HOST_OBSERVER_COST']),
  );
});

test('coverage and missing sensors belong to their surface profile, without converting optional long tasks to zero', () => {
  const input = fixture({ combined: true });
  input.hostObservation.samples = input.hostObservation.samples.filter(
    (sample) => sample.elapsedMs < 39000 || sample.elapsedMs > 43000,
  );
  input.apiEvents.find(
    (event) =>
      event.event === 'PHASE_DIAGNOSTIC_PROCESS' && event.elapsedMs === 40000,
  ).eventLoop.delayP95Ms = null;
  const result = summarizePhaseDiagnostics(input);
  expect(
    result.host.profiles.find(
      (profile) => profile.surface === 'progress' && profile.concurrency === 4,
    ).coverage.missingFraction,
  ).toBeGreaterThan(0.05);
  expect(
    result.host.profiles
      .filter((profile) => profile.surface === 'dashboard')
      .every((profile) => profile.coverage.status === 'observed'),
  ).toBe(true);
  expect(result.reasons).toContain('API_SENSOR_UNAVAILABLE');
  const optional = fixture({ combined: true });
  optional.browserProfiles[2].diagnostics.slice(0, 3).forEach((nav) => {
    nav.unsupported = ['longtask'];
  });
  const accepted = summarizePhaseDiagnostics(optional);
  expect(accepted.causalEligible).toBe(true);
  expect(accepted.profiles[2].sensors.longtask.available).toBe(false);
});

test('combined scope preserves progress first and measured tail even when invalid evidence is rejected', () => {
  const input = fixture({ combined: true });
  input.browserProfiles[3].samples.slice(0, 3).forEach((sample) => {
    sample.durationMs = 9000;
  });
  const result = summarizePhaseDiagnostics(input);
  expect(result.profiles[3]).toMatchObject({
    surface: 'progress',
    concurrency: 4,
    firstNavigationMs: 100,
    p95Ms: 9000,
  });
  expect(result.profiles[3].samples).toHaveLength(50);
  expect(result.reasons).toContain('BROWSER_GATE_CLOCK_MISMATCH');
});

test('context failure allowance is explicit and does not change latency or unrelated-failure gates', () => {
  const input = fixture({ combined: true });
  delete input.allowedContextFailures;
  expect(summarizePhaseDiagnostics(input).reasons).toContain(
    'CONTEXT_UNEXPECTED_FAILURE',
  );
  input.allowedContextFailures = ['IMP05-PHASE-07', 'IMP05-PHASE-08'];
  expect(summarizePhaseDiagnostics(input).causalEligible).toBe(true);
  input.contextReport.tests[0].state = 'failed';
  expect(summarizePhaseDiagnostics(input).reasons).toContain(
    'CONTEXT_UNEXPECTED_FAILURE',
  );
  input.allowedContextFailures.push(input.contextReport.tests[0].id);
  expect(summarizePhaseDiagnostics(input).reasons).toContain(
    'CONTEXT_FAILURE_SCOPE_INVALID',
  );
});

test('invalid profile labels are sanitized and absent host scope cannot look observed', () => {
  const input = fixture({ combined: true });
  input.browserProfiles[2].concurrency = 'PRIVATE_PROFILE';
  const invalid = summarizePhaseDiagnostics(input);
  expect(invalid.causalEligible).toBe(false);
  expect(invalid.profiles[2].concurrency).toBeNull();
  expect(JSON.stringify(invalid)).not.toContain('PRIVATE_PROFILE');
  input.diagnosticScope = null;
  const missing = summarizePhaseDiagnostics(input);
  expect(missing.sensorAvailability.hostCpu).toBe('unavailable');
  expect(missing.causalEligible).toBe(false);
});
