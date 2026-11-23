import contextCatalog from './phase-context.cjs';

const { inspectContextCoverage } = contextCatalog;
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = /^[a-f0-9]{64}$/i;
const routePaths = {
  identity: '/api/v1/me',
  class: '/api/v1/classes/:id',
  organization: '/api/v1/organizations/:orgId',
  dashboard: '/api/v1/classes/:id/dashboard',
  signals: '/api/v1/classes/:id/signals',
  progress: '/api/v1/me/progress',
};
const routes = [
  ...Object.keys(routePaths),
  'auth-token',
  'auth-user',
  'auth-logout',
];
const eventNames = [
  'observer:installed',
  'session:effect',
  'session:client-ready',
  'session:state',
  'identity:ready',
  'json:start',
  'json:end',
  'validation:start',
  'validation:end',
  'dom:ready',
];
const spanNames = [
  'auth.jwt',
  'db.pool',
  'db.begin',
  'db.role',
  'db.context',
  'db.session',
  'db.action',
  'db.commit',
  'db.rollback',
  'dashboard.query',
  'dashboard.parse',
  'dashboard.responseParse',
  'progress.query',
  'progress.parse',
  'progress.responseParse',
];
const criticalSuccessSpans = [
  'auth.jwt',
  'db.pool',
  'db.begin',
  'db.role',
  'db.context',
  'db.session',
  'db.action',
  'db.commit',
];
const dashboardSuccessSpans = [
  'dashboard.query',
  'dashboard.parse',
  'dashboard.responseParse',
];
const progressSuccessSpans = [
  'progress.query',
  'progress.parse',
  'progress.responseParse',
];
const surfaceRoutes = {
  dashboard: ['identity', 'class', 'organization', 'dashboard', 'signals'],
  progress: ['identity', 'class', 'organization', 'progress'],
};
const profileKey = (surface, concurrency) => `${surface}:${concurrency}`;
const sessionMarkers = [
  'observer:installed',
  'session:effect',
  'session:client-ready',
  'session:state',
  'identity:ready',
  'dom:ready',
];
const responseMarkers = [
  'json:start',
  'json:end',
  'validation:start',
  'validation:end',
];
const unsupportedNames = [
  'navigation-timing',
  'longtask',
  'mutation-observer',
  'fetch-hook',
  'clock-sync',
];
const finite = (value, signed = false) =>
  typeof value === 'number' && Number.isFinite(value) && (signed || value >= 0)
    ? value
    : null;
const integer = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;
const id = (value) =>
  typeof value === 'string' && uuid.test(value) ? value : null;
const choice = (value, allowed) => (allowed.includes(value) ? value : null);
const numbers = (value, names) =>
  Object.fromEntries(names.map((name) => [name, finite(value?.[name])]));
const bounded = (values, max) =>
  Array.isArray(values) ? values.slice(0, max) : [];
const extra = (values, max) =>
  Array.isArray(values) ? Math.max(0, values.length - max) : 0;

/** Deliberate allowlist: browser payloads never carry URLs, query values or headers. */
export function sanitizeBrowserDiagnostic(value) {
  const nav = value ?? {};
  return {
    schemaVersion: nav.schemaVersion === 1 ? 1 : null,
    // Absence is the historical dashboard schema, never an inferred progress nav.
    surface: Object.hasOwn(nav, 'surface')
      ? choice(nav.surface, ['dashboard', 'progress'])
      : 'dashboard',
    navIndex: integer(nav.navIndex),
    isFirst: typeof nav.isFirst === 'boolean' ? nav.isFirst : null,
    profile: choice(nav.profile, [1, 4]),
    valid: typeof nav.valid === 'boolean' ? nav.valid : null,
    ...numbers(nav, [
      'runnerStart',
      'runnerEnd',
      'autTimeOrigin',
      'domReadyAt',
      'selfCostMs',
      'runnerSelfCostMs',
    ]),
    clockSync: nav.clockSync
      ? {
          ...numbers(nav.clockSync, ['runnerBefore', 'autNow', 'runnerAfter']),
          offsetMin: finite(nav.clockSync.offsetMin, true),
          offsetMax: finite(nav.clockSync.offsetMax, true),
        }
      : null,
    events: bounded(nav.events, 1024).map((event) => ({
      name: choice(event.name, eventNames),
      at: finite(event.at),
      ...(event.route === undefined
        ? {}
        : { route: choice(event.route, routes) }),
      ...(event.requestId === undefined
        ? {}
        : { requestId: id(event.requestId) }),
    })),
    requests: bounded(nav.requests, 128).map((request) => ({
      seq: integer(request.seq),
      route: choice(request.route, routes),
      method: choice(request.method, ['GET', 'POST', 'OTHER']),
      ...numbers(request, ['start', 'headers', 'end']),
      status: integer(request.status),
      requestId: id(request.requestId),
      outcome: choice(request.outcome, ['pending', 'fulfilled', 'rejected']),
      aborted: typeof request.aborted === 'boolean' ? request.aborted : null,
    })),
    requestIds: bounded(nav.requestIds, 128).map(id),
    navigation: nav.navigation
      ? numbers(nav.navigation, [
          'startTime',
          'responseEnd',
          'domInteractive',
          'domContentLoadedEventEnd',
          'loadEventEnd',
        ])
      : null,
    longTasks: bounded(nav.longTasks, 512).map((task) =>
      numbers(task, ['startTime', 'duration']),
    ),
    dropped: integer(nav.dropped),
    truncated:
      (integer(nav.truncated) ?? 0) +
      extra(nav.events, 1024) +
      extra(nav.requests, 128) +
      extra(nav.requestIds, 128) +
      extra(nav.longTasks, 512),
    unsupported: bounded(nav.unsupported, unsupportedNames.length).map((name) =>
      choice(name, unsupportedNames),
    ),
  };
}

function pool(value) {
  return value
    ? {
        total: integer(value.total),
        idle: integer(value.idle),
        waiting: integer(value.waiting),
      }
    : null;
}
function sanitizeApiEvent(value) {
  const base = {
    event: value?.event,
    schemaVersion: value?.schemaVersion === 1 ? 1 : null,
    processInstanceId: id(value?.processInstanceId),
  };
  if (base.event === 'PHASE_DIAGNOSTIC_REQUEST')
    return {
      ...base,
      requestId: id(value.requestId),
      path: choice(value.path, Object.values(routePaths)),
      method: choice(value.method, ['GET']),
      status: integer(value.status),
      terminal: choice(value.terminal, ['finish', 'close']),
      ...numbers(value, [
        'startedAtUnixMs',
        'durationMs',
        'observerSelfTimeMs',
      ]),
      dropped: integer(value.dropped),
      spans: bounded(value.spans, 64).map((span) => ({
        name: choice(span.name, spanNames),
        ...numbers(span, ['startMs', 'durationMs']),
        outcome: choice(span.outcome, ['ok', 'error']),
      })),
      truncated: extra(value.spans, 64),
      pool: {
        before: pool(value.pool?.before),
        after: pool(value.pool?.after),
      },
    };
  if (base.event === 'PHASE_DIAGNOSTIC_PROCESS')
    return {
      ...base,
      ...numbers(value, [
        'timestampUnixMs',
        'elapsedMs',
        'intervalMs',
        'rssBytes',
        'heapUsedBytes',
        'observerSelfTimeMs',
      ]),
      cpu: numbers(value.cpu, ['userMs', 'systemMs']),
      eventLoop: numbers(value.eventLoop, [
        'utilization',
        'delayMeanMs',
        'delayP95Ms',
        'delayMaxMs',
      ]),
      emission: numbers(value.emission, [
        'count',
        'selfTimeMs',
        'maxSelfTimeMs',
        'backpressureEvents',
        'backpressureMs',
        'writeErrors',
      ]),
      dropped: integer(value.dropped),
      final: typeof value.final === 'boolean' ? value.final : null,
    };
  return null;
}

/** A missing record or a long sampling gap is unavailable time, never idle CPU. */
export function observationCoverage(
  timestamps,
  start,
  end,
  maximumIntervalMs = 1500,
) {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    !Array.isArray(timestamps)
  )
    return {
      status: 'unavailable',
      windowMs: null,
      missingMs: null,
      missingFraction: null,
    };
  const times = timestamps.filter(Number.isFinite).sort((a, b) => a - b);
  let covered = 0;
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > maximumIntervalMs) continue;
    covered += Math.max(
      0,
      Math.min(end, times[i]) - Math.max(start, times[i - 1]),
    );
  }
  const missingMs = Math.max(0, end - start - covered);
  return {
    status: missingMs / (end - start) > 0.05 ? 'partial' : 'observed',
    windowMs: end - start,
    missingMs,
    missingFraction: missingMs / (end - start),
  };
}

function cost(selfTimeMs, elapsedMs) {
  const valid =
    finite(selfTimeMs) !== null && finite(elapsedMs) !== null && elapsedMs > 0;
  return {
    selfTimeMs: finite(selfTimeMs),
    elapsedMs: finite(elapsedMs),
    fraction: valid ? selfTimeMs / elapsedMs : null,
    passed: valid && selfTimeMs / elapsedMs <= 0.01,
  };
}
function nearestRank(values) {
  const sorted = values
    .filter((value) => finite(value) !== null)
    .sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null;
}
function sanitizeHostObservation(input) {
  return {
    ...numbers(input, [
      'elapsedMs',
      'totalSelfTimeMs',
      'startedAtUnixMs',
      'endedAtUnixMs',
    ]),
    dropped: integer(input?.dropped),
    failed: integer(input?.failed),
    samples: bounded(input?.samples, 10000).map((sample) => ({
      ...numbers(sample, [
        'timestampUnixMs',
        'elapsedMs',
        'observerSelfTimeMs',
      ]),
      host: {
        ...numbers(sample.host, [
          'logicalCpus',
          'memoryBytes',
          'freeMemoryBytes',
        ]),
        cpuTimeMs: numbers(sample.host?.cpuTimeMs, ['idle', 'total']),
      },
    })),
    truncated: extra(input?.samples, 10000),
  };
}

/** Quality verdict only: never replaces the existing UI percentile or CI gate. */
export function summarizePhaseDiagnostics({
  browserProfiles = [],
  apiEvents = [],
  hostObservation,
  contextReport,
  candidate,
  diagnosticScope = 'dashboard',
  allowedContextFailures = ['IMP05-PHASE-07'],
} = {}) {
  const reasons = new Set();
  const fail = (reason) => reasons.add(reason);
  const scopedReasons = new Map();
  let activeProfileKey = null;
  const profileFail = (reason) => {
    fail(reason);
    if (activeProfileKey) {
      if (!scopedReasons.has(activeProfileKey))
        scopedReasons.set(activeProfileKey, new Set());
      scopedReasons.get(activeProfileKey).add(reason);
    }
  };
  const surfaces =
    diagnosticScope === 'dashboard+progress'
      ? ['dashboard', 'progress']
      : diagnosticScope === 'dashboard'
        ? ['dashboard']
        : [];
  if (!surfaces.length) fail('DIAGNOSTIC_SCOPE_INVALID');
  const expectedProfiles = surfaces.flatMap((surface) =>
    [1, 4].map((concurrency) => ({ surface, concurrency })),
  );
  const failureScopeValid =
    Array.isArray(allowedContextFailures) &&
    new Set(allowedContextFailures).size === allowedContextFailures.length &&
    allowedContextFailures.every((id) =>
      ['IMP05-PHASE-07', 'IMP05-PHASE-08'].includes(id),
    );
  if (!failureScopeValid) fail('CONTEXT_FAILURE_SCOPE_INVALID');
  const permittedFailures = failureScopeValid
    ? [...allowedContextFailures]
    : [];
  const inputEvents = Array.isArray(apiEvents) ? apiEvents : apiEvents?.events;
  if (
    !Array.isArray(apiEvents) &&
    (apiEvents?.malformed !== 0 || apiEvents?.dropped !== 0)
  )
    fail('API_RECORDS_REJECTED');
  const api = bounded(inputEvents, 100000)
    .map(sanitizeApiEvent)
    .filter(Boolean);
  if (!Array.isArray(inputEvents) || api.length !== inputEvents.length)
    fail('API_RECORDS_REJECTED');
  const requests = api.filter(
    (event) => event.event === 'PHASE_DIAGNOSTIC_REQUEST',
  );
  const processes = api.filter(
    (event) => event.event === 'PHASE_DIAGNOSTIC_PROCESS',
  );
  const byRequest = new Map();
  for (const request of requests) {
    if (
      !request.requestId ||
      !request.processInstanceId ||
      request.schemaVersion !== 1 ||
      !request.path ||
      !request.method ||
      request.status === null ||
      request.startedAtUnixMs === null ||
      request.durationMs === null ||
      request.observerSelfTimeMs === null ||
      request.dropped !== 0 ||
      request.truncated ||
      !request.terminal ||
      request.spans.some(
        (span) =>
          !span.name ||
          span.startMs === null ||
          span.durationMs === null ||
          !span.outcome,
      )
    )
      fail('API_REQUEST_INVALID');
    if (byRequest.has(request.requestId)) fail('API_REQUEST_DUPLICATED');
    byRequest.set(request.requestId, request);
  }
  const profiles = [];
  const criticalRequests = [];
  const windows = [];
  for (const inputProfile of bounded(browserProfiles, 4)) {
    const profile = inputProfile ?? {};
    const surface = choice(profile.surface, surfaces);
    const concurrency = choice(profile.concurrency, [1, 4]);
    activeProfileKey = profileKey(surface, concurrency);
    const diagnostics = bounded(profile.diagnostics, 51).map(
      sanitizeBrowserDiagnostic,
    );
    const samples = bounded(profile.samples, 50).map((sample, index) => ({
      index,
      durationMs: finite(sample.durationMs),
      valid: sample.valid === true,
    }));
    if (
      !surface ||
      concurrency === null ||
      diagnostics.length !== 51 ||
      profile.diagnostics?.length !== 51 ||
      samples.length !== 50 ||
      profile.samples?.length !== 50
    )
      profileFail('BROWSER_PROFILE_INCOMPLETE');
    if (
      profile.firstNavigationValid !== true ||
      samples.some((sample) => !sample.valid || sample.durationMs === null)
    )
      profileFail('BROWSER_GATE_INVALID');
    let elapsedMs = 0,
      autSelfTime = 0,
      runnerSelfTime = 0;
    for (let index = 0; index < diagnostics.length; index++) {
      const nav = diagnostics[index];
      const sync = nav.clockSync;
      const duration =
        nav.runnerEnd === null || nav.runnerStart === null
          ? null
          : nav.runnerEnd - nav.runnerStart;
      if (
        nav.schemaVersion !== 1 ||
        nav.surface !== surface ||
        nav.navIndex !== index ||
        nav.isFirst !== (index === 0) ||
        nav.profile !== concurrency ||
        nav.valid !== true ||
        duration === null ||
        duration < 0 ||
        nav.autTimeOrigin === null ||
        nav.domReadyAt === null ||
        !sync ||
        Object.values(sync).some((n) => n === null) ||
        sync.runnerAfter < sync.runnerBefore ||
        sync.offsetMax < sync.offsetMin ||
        nav.domReadyAt < sync.autNow ||
        nav.selfCostMs === null ||
        nav.runnerSelfCostMs === null ||
        nav.dropped !== 0 ||
        nav.truncated ||
        nav.unsupported.some(
          (item) =>
            item === null || ['fetch-hook', 'clock-sync'].includes(item),
        ) ||
        nav.events.some((event) => !event.name || event.at === null) ||
        nav.requests.some(
          (request) =>
            !request.route ||
            !request.method ||
            request.start === null ||
            request.end === null ||
            request.end < request.start ||
            request.outcome !== 'fulfilled',
        )
      )
        profileFail('BROWSER_NAVIGATION_INVALID');
      const measured =
        index === 0
          ? finite(profile.firstNavigationMs)
          : samples[index - 1]?.durationMs;
      if (
        duration === null ||
        measured === null ||
        measured === undefined ||
        Math.abs(duration - measured) > 0.01
      )
        profileFail('BROWSER_GATE_CLOCK_MISMATCH');
      elapsedMs += Math.max(0, duration ?? 0);
      autSelfTime += nav.selfCostMs ?? 0;
      runnerSelfTime += nav.runnerSelfCostMs ?? 0;
      if (
        sync &&
        nav.autTimeOrigin !== null &&
        nav.domReadyAt !== null &&
        sync.autNow !== null
      )
        windows.push({
          surface,
          concurrency,
          start: nav.autTimeOrigin + sync.autNow,
          end: nav.autTimeOrigin + nav.domReadyAt,
        });
      const critical = nav.requests.filter((request) =>
        Object.hasOwn(routePaths, request.route ?? ''),
      );
      if (
        sessionMarkers.some(
          (name) => !nav.events.some((event) => event.name === name),
        )
      )
        profileFail('BROWSER_MARKERS_INCOMPLETE');
      for (const request of critical.filter(
        (request) => request.status >= 200 && request.status < 300,
      )) {
        const events = responseMarkers.map((name) =>
          nav.events.find(
            (event) =>
              event.name === name &&
              event.requestId === request.requestId &&
              event.route === request.route,
          ),
        );
        if (
          events.some((event) => !event || event.at === null) ||
          events.some(
            (event, index) => index > 0 && event?.at < events[index - 1]?.at,
          )
        )
          profileFail('BROWSER_MARKERS_INCOMPLETE');
      }
      const requiredRoutes =
        diagnosticScope === 'dashboard'
          ? ['dashboard', 'signals']
          : (surfaceRoutes[surface] ?? []);
      if (
        requiredRoutes.some(
          (route) =>
            !critical.some(
              (request) => request.route === route && request.status === 200,
            ),
        )
      )
        profileFail('BROWSER_CRITICAL_ROUTES_MISSING');
      if (
        critical.some(
          (request) => !surfaceRoutes[surface]?.includes(request.route),
        )
      )
        profileFail('BROWSER_CRITICAL_ROUTES_UNEXPECTED');
      for (const request of critical)
        criticalRequests.push({
          surface,
          concurrency,
          requestId: request.requestId,
          path: routePaths[request.route],
          status: request.status,
        });
    }
    const browserCost = cost(autSelfTime, elapsedMs),
      runnerCost = cost(runnerSelfTime, elapsedMs);
    const sensors = Object.fromEntries(
      ['navigation-timing', 'longtask', 'mutation-observer'].map((sensor) => {
        const missing = diagnostics.filter(
          (nav) =>
            nav.unsupported.includes(sensor) ||
            (sensor === 'navigation-timing' &&
              (!nav.navigation ||
                Object.values(nav.navigation).some((value) => value === null))),
        ).length;
        const missingFraction = diagnostics.length
          ? missing / diagnostics.length
          : null;
        return [
          sensor,
          {
            missing,
            missingFraction,
            available: missingFraction !== null && missingFraction <= 0.05,
          },
        ];
      }),
    );
    if (
      ['navigation-timing', 'mutation-observer'].some(
        (name) => !sensors[name].available,
      )
    )
      profileFail('BROWSER_SENSOR_UNAVAILABLE');
    if (!browserCost.passed || !runnerCost.passed)
      profileFail('BROWSER_OBSERVER_COST');
    const fixture = profile.fixtureObserver;
    const fixtureCost = cost(fixture?.selfTimeMs, fixture?.elapsedMs);
    if (!fixtureCost.passed || fixture?.dropped !== 0)
      profileFail('FIXTURE_OBSERVER_COST_OR_DROPS');
    const background = bounded(
      profile.backgroundDiagnostics?.requests,
      50000,
    ).map((request) => ({
      requestId: id(request.requestId),
      status: integer(request.status),
      valid: request.valid === true,
      ...numbers(request, [
        'startedAtUnixMs',
        'startedAtMs',
        'finishedAtMs',
        'durationMs',
      ]),
    }));
    if (
      concurrency === 4 &&
      (!background.length ||
        profile.backgroundDiagnostics?.dropped !== 0 ||
        profile.backgroundDiagnostics?.requests?.length !== background.length)
    )
      profileFail('BACKGROUND_INCOMPLETE');
    if (
      concurrency === 1 &&
      (background.length ||
        (profile.backgroundDiagnostics?.dropped !== undefined &&
          profile.backgroundDiagnostics.dropped !== 0))
    )
      profileFail('BACKGROUND_UNEXPECTED');
    for (const request of background) {
      if (
        !request.valid ||
        !request.requestId ||
        request.status !== 200 ||
        request.startedAtUnixMs === null ||
        request.startedAtMs === null ||
        request.finishedAtMs === null ||
        request.durationMs === null ||
        request.finishedAtMs < request.startedAtMs ||
        Math.abs(
          request.finishedAtMs - request.startedAtMs - request.durationMs,
        ) > 0.01
      )
        profileFail('BACKGROUND_INVALID');
      criticalRequests.push({
        surface,
        concurrency,
        requestId: request.requestId,
        path: routePaths[surface],
        status: request.status,
      });
    }
    profiles.push({
      surface,
      concurrency,
      samples,
      firstNavigationMs: finite(profile.firstNavigationMs),
      firstNavigationValid: profile.firstNavigationValid === true,
      p95Ms: nearestRank(samples.map((sample) => sample.durationMs)),
      diagnostics,
      backgroundDiagnostics: { requests: background },
      sensors,
      costs: { browser: browserCost, runner: runnerCost, fixture: fixtureCost },
    });
  }
  activeProfileKey = null;
  if (
    !Array.isArray(browserProfiles) ||
    browserProfiles.length !== expectedProfiles.length ||
    new Set(
      profiles.map((profile) =>
        profileKey(profile.surface, profile.concurrency),
      ),
    ).size !== expectedProfiles.length ||
    expectedProfiles.some(
      ({ surface, concurrency }) =>
        !profiles.some(
          (profile) =>
            profile.surface === surface && profile.concurrency === concurrency,
        ),
    )
  )
    fail('BROWSER_PROFILES_MISSING');
  const correlated = criticalRequests.filter((request) => {
    const event = byRequest.get(request.requestId);
    return (
      request.requestId &&
      event?.path === request.path &&
      event.status === request.status &&
      event.terminal === 'finish'
    );
  });
  if (!criticalRequests.length || correlated.length !== criticalRequests.length)
    fail('CRITICAL_REQUEST_CORRELATION');
  const correlationProfiles = expectedProfiles.map(
    ({ surface, concurrency }) => {
      const selected = (request) =>
        request.surface === surface && request.concurrency === concurrency;
      const required = criticalRequests.filter(selected).length;
      const count = correlated.filter(selected).length;
      activeProfileKey = profileKey(surface, concurrency);
      if (!required || count !== required)
        profileFail('CRITICAL_REQUEST_CORRELATION');
      return {
        surface,
        concurrency,
        required,
        correlated: count,
        fraction: required ? count / required : null,
      };
    },
  );
  activeProfileKey = null;
  const criticalIds = new Set(
    criticalRequests.map((request) => request.requestId),
  );
  if (criticalIds.size !== criticalRequests.length)
    fail('CRITICAL_REQUEST_DUPLICATED');
  const relevant = requests.filter((request) =>
    criticalIds.has(request.requestId),
  );
  for (const request of relevant.filter(
    (request) => request.status >= 200 && request.status < 300,
  )) {
    const required = [
      ...criticalSuccessSpans,
      ...([routePaths.dashboard, routePaths.signals].includes(request.path)
        ? dashboardSuccessSpans
        : request.path === routePaths.progress
          ? progressSuccessSpans
          : []),
    ];
    if (
      required.some(
        (name) =>
          !request.spans.some(
            (span) => span.name === name && span.outcome === 'ok',
          ),
      )
    )
      fail('CRITICAL_REQUEST_SPANS_INCOMPLETE');
  }
  const apiQuality = [];
  for (const { surface, concurrency } of expectedProfiles) {
    activeProfileKey = profileKey(surface, concurrency);
    const profileRequestIds = new Set(
      criticalRequests
        .filter(
          (request) =>
            request.surface === surface && request.concurrency === concurrency,
        )
        .map((request) => request.requestId),
    );
    const profileRequests = relevant.filter((request) =>
      profileRequestIds.has(request.requestId),
    );
    for (const processId of new Set(
      profileRequests.map((request) => request.processInstanceId),
    )) {
      const observed = processes
        .filter((event) => event.processInstanceId === processId)
        .sort((a, b) => a.elapsedMs - b.elapsedMs);
      const requestWindows = profileRequests
        .filter((request) => request.processInstanceId === processId)
        .map((request) => ({
          start: request.startedAtUnixMs,
          end: request.startedAtUnixMs + request.durationMs,
        }));
      const start = Math.min(...requestWindows.map((window) => window.start)),
        end = Math.max(...requestWindows.map((window) => window.end));
      const coverage = observationCoverage(
        observed.map((event) => event.timestampUnixMs),
        start,
        end,
      );
      const last = observed.at(-1);
      const lower = observed.findLast(
        (event) => event.timestampUnixMs <= start,
      );
      const upper = observed.find((event) => event.timestampUnixMs >= end);
      const observerCost =
        lower && upper
          ? cost(
              upper.observerSelfTimeMs - lower.observerSelfTimeMs,
              upper.elapsedMs - lower.elapsedMs,
            )
          : cost(null, null);
      const inWindow =
        lower && upper
          ? observed.filter(
              (event) =>
                event.elapsedMs >= lower.elapsedMs &&
                event.elapsedMs <= upper.elapsedMs,
            )
          : [];
      const sensors = {
        cpu:
          inWindow.length > 0 &&
          inWindow.every((event) =>
            Object.values(event.cpu).every((n) => n !== null),
          ),
        memory:
          inWindow.length > 0 &&
          inWindow.every(
            (event) => event.rssBytes !== null && event.heapUsedBytes !== null,
          ),
        eventLoop:
          inWindow.length > 0 &&
          inWindow.every(
            (event) =>
              Object.values(event.eventLoop).every((n) => n !== null) &&
              event.eventLoop.utilization <= 1,
          ),
      };
      if (Object.values(sensors).some((available) => !available))
        profileFail('API_SENSOR_UNAVAILABLE');
      if (coverage.status !== 'observed') profileFail('API_PROCESS_COVERAGE');
      if (!observerCost.passed) profileFail('API_OBSERVER_COST');
      if (
        observed.some(
          (event, index) =>
            event.schemaVersion !== 1 ||
            !event.processInstanceId ||
            event.timestampUnixMs === null ||
            event.elapsedMs === null ||
            event.observerSelfTimeMs === null ||
            event.dropped !== 0 ||
            event.emission.writeErrors !== 0 ||
            event.emission.backpressureEvents !== 0 ||
            (index > 0 &&
              (event.elapsedMs <= observed[index - 1].elapsedMs ||
                event.timestampUnixMs <= observed[index - 1].timestampUnixMs ||
                event.observerSelfTimeMs <
                  observed[index - 1].observerSelfTimeMs)),
        )
      )
        profileFail('API_PROCESS_DROPS_OR_BACKPRESSURE');
      apiQuality.push({
        surface,
        concurrency,
        processInstanceId: processId,
        coverage,
        cost: observerCost,
        sensors,
        cumulativeCost: cost(last?.observerSelfTimeMs, last?.elapsedMs),
        finalSeen: last?.final === true,
        observations: inWindow,
      });
    }
  }
  const host = sanitizeHostObservation(hostObservation);
  const hostCost = cost(host.totalSelfTimeMs, host.elapsedMs);
  const hostProfiles = expectedProfiles.map(({ surface, concurrency }) => {
    activeProfileKey = profileKey(surface, concurrency);
    const selected = windows.filter(
      (window) =>
        window.surface === surface && window.concurrency === concurrency,
    );
    const start = Math.min(...selected.map((window) => window.start)),
      end = Math.max(...selected.map((window) => window.end));
    const coverage = observationCoverage(
      host.samples.map((sample) => sample.timestampUnixMs),
      start,
      end,
    );
    const lower = host.samples.findLast(
      (sample) => sample.timestampUnixMs <= start,
    );
    const upper = host.samples.find((sample) => sample.timestampUnixMs >= end);
    const observerCost =
      lower && upper
        ? cost(
            upper.observerSelfTimeMs - lower.observerSelfTimeMs,
            upper.elapsedMs - lower.elapsedMs,
          )
        : cost(null, null);
    const inWindow =
      lower && upper
        ? host.samples.filter(
            (sample) =>
              sample.elapsedMs >= lower.elapsedMs &&
              sample.elapsedMs <= upper.elapsedMs,
          )
        : [];
    const sensors = {
      cpu:
        inWindow.length > 0 &&
        inWindow.every(
          (sample) =>
            Object.values(sample.host.cpuTimeMs).every((n) => n !== null) &&
            sample.host.cpuTimeMs.idle <= sample.host.cpuTimeMs.total,
        ),
      memory:
        inWindow.length > 0 &&
        inWindow.every(
          (sample) =>
            sample.host.memoryBytes !== null &&
            sample.host.freeMemoryBytes !== null &&
            sample.host.freeMemoryBytes <= sample.host.memoryBytes,
        ),
    };
    if (!observerCost.passed) profileFail('HOST_OBSERVER_COST');
    if (coverage.status !== 'observed') profileFail('HOST_COVERAGE_OR_DROPS');
    if (Object.values(sensors).some((available) => !available))
      profileFail('HOST_SENSOR_UNAVAILABLE');
    return { surface, concurrency, coverage, cost: observerCost, sensors };
  });
  activeProfileKey = null;
  if (
    host.failed !== 0 ||
    host.dropped !== 0 ||
    host.truncated ||
    host.samples.some(
      (sample, index) =>
        sample.timestampUnixMs === null ||
        sample.elapsedMs === null ||
        sample.observerSelfTimeMs === null ||
        (index > 0 &&
          (sample.timestampUnixMs <= host.samples[index - 1].timestampUnixMs ||
            sample.elapsedMs <= host.samples[index - 1].elapsedMs ||
            sample.observerSelfTimeMs <
              host.samples[index - 1].observerSelfTimeMs)),
    )
  )
    fail('HOST_COVERAGE_OR_DROPS');
  const coverage = inspectContextCoverage({
    specs: contextReport?.contextCoverage?.actualSpecs ?? [],
    tests: contextReport?.tests ?? [],
  });
  if (
    !coverage.complete ||
    contextReport?.suite !== 'phase-context' ||
    contextReport?.pending !== 0 ||
    contextReport?.skipped !== 0
  )
    fail('CONTEXT_INCOMPLETE');
  if (
    (contextReport?.tests ?? []).some(
      (test) =>
        !['passed', 'failed'].includes(test.state) ||
        (test.state === 'failed' && !permittedFailures.includes(test.id)),
    )
  )
    fail('CONTEXT_UNEXPECTED_FAILURE');
  const before = candidate?.before?.sourceDigest,
    after = candidate?.after?.sourceDigest;
  const stable =
    typeof before === 'string' && hash.test(before) && before === after;
  if (!stable) fail('CANDIDATE_CHANGED_OR_MISSING');
  return {
    schemaVersion: 1,
    diagnosticScope: choice(diagnosticScope, [
      'dashboard',
      'dashboard+progress',
    ]),
    allowedContextFailures: permittedFailures,
    status: reasons.size ? 'invalid' : 'observed',
    causalEligible: reasons.size === 0,
    reasons: [...reasons],
    candidate: {
      before: typeof before === 'string' && hash.test(before) ? before : null,
      after: typeof after === 'string' && hash.test(after) ? after : null,
      unchanged: stable,
    },
    contextCoverage: coverage,
    sensorAvailability: {
      apiProcessCpu:
        apiQuality.length > 0 && apiQuality.every((item) => item.sensors.cpu)
          ? 'observed'
          : 'unavailable',
      hostCpu:
        hostProfiles.length > 0 &&
        hostProfiles.every((item) => item.sensors.cpu)
          ? 'observed'
          : 'unavailable',
      browserProcessCpu: 'unavailable',
      webProcessCpu: 'unavailable',
      vmCpu: 'unavailable',
    },
    profiles: profiles.map((profile) => ({
      ...profile,
      observationReasons: [
        ...(scopedReasons.get(
          profileKey(profile.surface, profile.concurrency),
        ) ?? []),
      ],
    })),
    correlation: {
      required: criticalRequests.length,
      correlated: correlated.length,
      fraction: criticalRequests.length
        ? correlated.length / criticalRequests.length
        : null,
      profiles: correlationProfiles,
    },
    api: { requests: relevant, processes: apiQuality },
    host: { ...host, profiles: hostProfiles, cumulativeCost: hostCost },
    interpretation:
      'Existing gate durations are retained. Request IDs join clocks; monotonic browser and API clocks are never subtracted. API spans nest and must not be added. Process observer cost is cumulative, already including emission; no double counting. Missing sensors are not zero. Browser/Next.js process CPU and VM CPU are unavailable; shared host CPU cannot be attributed to Chrome or the web process. This is observation quality, not proof of a cause or a passing performance gate.',
  };
}
