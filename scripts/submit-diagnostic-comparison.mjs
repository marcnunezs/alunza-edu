// Pure projection of retained measurements. No report is selected, rewritten or
// promoted to acceptance; failed requests remain in every latency calculation.
const hash = /^[a-f0-9]{64}$/;
const finite = (value) => Number.isFinite(value) && value >= 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const text = (value) => typeof value === 'string' && value.length > 0;
const record = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const phaseNames = {
  docker: new Set([
    'engineResolve',
    'imageResolve',
    'create',
    'preInspect',
    'attachOutput',
    'attachInput',
    'start',
    'send',
    'streams',
    'wait',
    'postInspect',
    'delete',
    'verifyAbsent',
    'hostStartAttach',
    'containerWall',
    'supervisor',
  ]),
  submission: new Set([
    'authorizeInitial',
    'inspect',
    'admit',
    'suite',
    'execute',
    'cleanupFallback',
    'stage',
    'finish',
    'authorizeFinal',
    'total',
  ]),
};
const conditions = [
  ['mode', (x) => x.mode, (value) => value === 'SUBMIT'],
  ['environment', (x) => x.environment, text],
  [
    'candidateFingerprint',
    (x) => x.candidateFingerprint,
    (x) => text(x) && hash.test(x),
  ],
  ['runner.image', (x) => x.runner?.image, text],
  ['host.node', (x) => x.host?.node, text],
  [
    'environmentManifest.docker.cpus',
    (x) => x.environmentManifest?.docker?.cpus,
    (x) => integer(x) && x > 0,
  ],
  [
    'environmentManifest.docker.memoryBytes',
    (x) => x.environmentManifest?.docker?.memoryBytes,
    (x) => integer(x) && x > 0,
  ],
  [
    'environmentManifest.docker.serverVersion',
    (x) => x.environmentManifest?.docker?.serverVersion,
    text,
  ],
  [
    'environmentManifest.docker.driver',
    (x) => x.environmentManifest?.docker?.driver,
    text,
  ],
  [
    'environmentManifest.docker.kernelVersion',
    (x) => x.environmentManifest?.docker?.kernelVersion,
    text,
  ],
  [
    'environmentManifest.workloadFingerprint',
    (x) => x.environmentManifest?.workloadFingerprint,
    (x) => text(x) && hash.test(x),
  ],
  ['fixture.title', (x) => x.fixture?.title, text],
  ['fixture.visibleCount', (x) => x.fixture?.visibleCount, integer],
  [
    'fixture.hiddenCount',
    (x) => x.fixture?.hiddenCount,
    (x) => integer(x) && x > 0,
  ],
  ['profile.sequential', (x) => x.profile?.sequential, (x) => x === 50],
  ['profile.concurrent', (x) => x.profile?.concurrent, (x) => x === 50],
  ['profile.concurrency', (x) => x.profile?.concurrency, (x) => x === 4],
  [
    'profile.actorConcurrency',
    (x) => x.profile?.actorConcurrency,
    (x) => integer(x) && x > 0,
  ],
  [
    'profile.organizationConcurrency',
    (x) => x.profile?.organizationConcurrency,
    (x) => integer(x) && x > 0,
  ],
  [
    'profile.actorRequestsPerMinute',
    (x) => x.profile?.actorRequestsPerMinute,
    (x) => integer(x) && x > 0,
  ],
  ['profile.timeoutMs', (x) => x.profile?.timeoutMs, (x) => finite(x) && x > 0],
  ['profile.temperature', (x) => x.profile?.temperature, text],
];

function summaryOf(value) {
  if (!record(value)) return {};
  return Object.hasOwn(value, 'summary')
    ? record(value.summary)
      ? value.summary
      : {}
    : value;
}

function percentile(values) {
  if (!values.length || !values.every(finite)) return null;
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
}

function validSample(sample) {
  return (
    record(sample) &&
    [1, 4].includes(sample.concurrency) &&
    integer(sample.index) &&
    sample.index < 50 &&
    finite(sample.durationMs) &&
    typeof sample.valid === 'boolean'
  );
}

function validPhases(sample) {
  return (
    sample.phaseTimings === undefined ||
    (Array.isArray(sample.phaseTimings) &&
      sample.phaseTimings.every(
        (event) =>
          record(event) &&
          Object.hasOwn(phaseNames, event.source) &&
          phaseNames[event.source].has(event.phase) &&
          finite(event.durationMs) &&
          typeof event.completed === 'boolean',
      ))
  );
}

function phasesForSample(sample) {
  const phases = new Map();
  for (const event of sample.phaseTimings ?? []) {
    const key = `${event.source}.${event.phase}`;
    const value = phases.get(key) ?? { durationMs: 0, events: 0, failed: 0 };
    value.durationMs += event.durationMs;
    value.events++;
    value.failed += Number(!event.completed);
    phases.set(key, value);
  }
  return phases;
}

function summarizeProfile(summary, concurrency) {
  const samples = Array.isArray(summary.samples)
    ? summary.samples.filter((sample) => sample?.concurrency === concurrency)
    : [];
  const samplingValid =
    samples.every(validSample) &&
    samples.length === 50 &&
    new Set(samples.map((sample) => sample.index)).size === 50;
  const phaseValid = samples.every(validPhases);
  const p95Ms = percentile(samples.map((sample) => sample.durationMs));
  const failed = samples.filter((sample) => sample.valid !== true).length;
  const perSample = phaseValid ? samples.map(phasesForSample) : [];
  const keys = [
    ...new Set(perSample.flatMap((phases) => [...phases.keys()])),
  ].sort();
  const phaseTimings = keys.map((phase) => {
    // Multiple capsules contribute the same phase within one HTTP request.
    // Sources remain distinct; nested phases and their percentiles never add.
    const values = perSample.flatMap((phases) =>
      phases.has(phase) ? [phases.get(phase)] : [],
    );
    return {
      phase,
      samples: values.length,
      events: values.reduce((total, value) => total + value.events, 0),
      failed: values.reduce((total, value) => total + value.failed, 0),
      p95Ms: percentile(values.map((value) => value.durationMs)),
    };
  });
  const slowRequests = samplingValid
    ? samples
        .flatMap((sample, position) => {
          const atP95 = sample.durationMs === p95Ms;
          const atOrAboveTarget = sample.durationMs >= 5000;
          if (!atP95 && !atOrAboveTarget) return [];
          // Largest observed phase is descriptive, including overlapping intervals.
          // Exclude total itself, which is already represented by totalMs.
          const ordered = phaseValid
            ? [...perSample[position].entries()]
                .filter(([phase]) => phase !== 'submission.total')
                .sort(
                  ([a, left], [b, right]) =>
                    right.durationMs - left.durationMs || a.localeCompare(b),
                )
            : [];
          return [
            {
              index: sample.index,
              concurrency,
              totalMs: sample.durationMs,
              valid: sample.valid,
              atP95,
              atOrAboveTarget,
              dominantPhase: ordered.length
                ? {
                    phase: ordered[0][0],
                    durationMs: ordered[0][1].durationMs,
                  }
                : null,
            },
          ];
        })
        .sort((a, b) => a.index - b.index)
    : [];
  return {
    count: samples.length,
    failed,
    p95Ms,
    status:
      summary.status === 'failed' ||
      failed > 0 ||
      (p95Ms !== null && p95Ms >= 5000)
        ? 'failed'
        : samplingValid && summary.status === 'passed'
          ? 'passed'
          : 'incomplete',
    samplingValid,
    phaseTimingsValid: phaseValid,
    phaseTimings,
    slowRequests,
  };
}

export function compareSubmitDiagnostics(baseline, continuous) {
  const left = summaryOf(baseline),
    right = summaryOf(continuous);
  const mismatches = [],
    observationDifferences = [];
  for (const [label, get, validate] of conditions) {
    const a = get(left),
      b = get(right);
    if (!validate(a) || !validate(b) || a !== b) mismatches.push(label);
  }
  for (const [name, summary] of [
    ['baseline', left],
    ['continuous', right],
  ]) {
    if (!['passed', 'failed'].includes(summary.status))
      mismatches.push(`${name}.status`);
    if (
      !Array.isArray(summary.samples) ||
      summary.samples.length !== 100 ||
      !summary.samples.every(validSample)
    )
      mismatches.push(`${name}.samples`);
    if (
      Array.isArray(summary.samples) &&
      summary.samples.some((sample) => record(sample) && !validPhases(sample))
    )
      mismatches.push(`${name}.phaseTimings`);
  }
  for (const flag of ['enabled', 'continuousEnabled']) {
    const a = left.diagnostics?.[flag],
      b = right.diagnostics?.[flag];
    if (
      (a !== undefined && typeof a !== 'boolean') ||
      (b !== undefined && typeof b !== 'boolean')
    )
      mismatches.push(`diagnostics.${flag}`);
    else if (a !== b) observationDifferences.push(`diagnostics.${flag}`);
  }
  const profiles = [1, 4].map((concurrency) => {
    const baseline = summarizeProfile(left, concurrency);
    const continuous = summarizeProfile(right, concurrency);
    if (!baseline.samplingValid)
      mismatches.push(`baseline.profile.${concurrency}.samples`);
    if (!continuous.samplingValid)
      mismatches.push(`continuous.profile.${concurrency}.samples`);
    return { concurrency, baseline, continuous };
  });
  const comparisonState = mismatches.length ? 'not-comparable' : 'comparable';
  return {
    version: 1,
    comparisonState,
    mismatches: [...new Set(mismatches)],
    observationDifferences,
    profiles: profiles.map((profile) => {
      const a = profile.baseline.p95Ms,
        b = profile.continuous.p95Ms;
      const absoluteMs = comparisonState === 'comparable' ? b - a : null;
      const relative = absoluteMs !== null && a > 0 ? absoluteMs / a : null;
      return {
        ...profile,
        difference: {
          absoluteMs,
          relative,
          percent: relative === null ? null : relative * 100,
        },
      };
    }),
    interpretation:
      'Nearest-rank p95 includes failures. Phases consolidate only the same source/phase within each request; nested and overlapping phases or their percentiles must not be added. Dominant phase is the largest observed non-total phase, not a cause. Observation flags are separate from execution conditions. Differences are unavailable when conditions or retained sample sets are not comparable.',
  };
}
