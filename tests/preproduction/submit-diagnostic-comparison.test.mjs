import { test, expect } from '@jest/globals';
import { compareSubmitDiagnostics } from '../../scripts/submit-diagnostic-comparison.mjs';

function summary() {
  return {
    mode: 'SUBMIT',
    environment: 'isolated-local-supabase-and-docker',
    status: 'passed',
    candidateFingerprint: 'a'.repeat(64),
    runner: { image: `sha256:${'b'.repeat(64)}` },
    host: { node: 'v24.21.0' },
    environmentManifest: {
      docker: {
        cpus: 4,
        memoryBytes: 8000000000,
        serverVersion: '28.0.0',
        driver: 'overlay2',
        kernelVersion: '6.6.0',
      },
      workloadFingerprint: 'c'.repeat(64),
    },
    fixture: { title: 'Funciones', visibleCount: 1, hiddenCount: 1 },
    profile: {
      sequential: 50,
      concurrent: 50,
      concurrency: 4,
      actorConcurrency: 2,
      organizationConcurrency: 4,
      actorRequestsPerMinute: 100,
      timeoutMs: 45000,
      temperature: 'cold service followed by warm service; every capsule new',
    },
    diagnostics: { enabled: true, continuousEnabled: false },
    samples: [1, 4].flatMap((concurrency) =>
      Array.from({ length: 50 }, (_, index) => ({
        concurrency,
        index,
        durationMs: 1000 + 10 * index,
        valid: true,
        requestId: 'private-request-identifier',
        phaseTimings: [
          {
            source: 'submission',
            phase: 'total',
            durationMs: 990 + 10 * index,
            completed: true,
          },
          {
            source: 'submission',
            phase: 'execute',
            durationMs: 900,
            completed: true,
          },
          {
            source: 'docker',
            phase: 'wait',
            durationMs: 400 + index,
            completed: true,
          },
          {
            source: 'docker',
            phase: 'wait',
            durationMs: 200 + index,
            completed: true,
          },
          {
            source: 'docker',
            phase: 'streams',
            durationMs: 550,
            completed: true,
          },
        ],
      })),
    ),
    profiles: [{ concurrency: 1, count: 0, failed: 0, p95Ms: 1 }],
  };
}

test('compares full retained cohorts, recalculates nearest-rank and keeps source reports immutable', () => {
  const baseline = summary(),
    continuous = summary();
  continuous.diagnostics.continuousEnabled = true;
  continuous.samples.forEach((sample) => {
    sample.durationMs += 100;
  });
  const before = JSON.stringify({ baseline, continuous });
  const result = compareSubmitDiagnostics(
    { summary: baseline },
    { summary: continuous },
  );
  expect(result.comparisonState).toBe('comparable');
  expect(result.observationDifferences).toEqual([
    'diagnostics.continuousEnabled',
  ]);
  expect(result.profiles.map((profile) => profile.baseline.count)).toEqual([
    50, 50,
  ]);
  expect(result.profiles[0].baseline.p95Ms).toBe(1470);
  expect(result.profiles[0].continuous.p95Ms).toBe(1570);
  expect(result.profiles[0].difference.absoluteMs).toBe(100);
  expect(result.profiles[0].difference.relative).toBeCloseTo(100 / 1470);
  expect(JSON.stringify({ baseline, continuous })).toBe(before);
  expect(JSON.stringify(result)).not.toContain('private-request-identifier');
});

test('all failures and threshold breaches remain, including the sample defining p95', () => {
  const baseline = summary(),
    continuous = summary();
  continuous.status = 'failed';
  continuous.samples
    .filter((sample) => sample.concurrency === 4)
    .slice(-4)
    .forEach((sample, index) => {
      sample.durationMs = 5000 + index * 1000;
      sample.valid = false;
    });
  const result = compareSubmitDiagnostics(baseline, continuous);
  const profile = result.profiles[1];
  expect(result.comparisonState).toBe('comparable');
  expect(profile.continuous.failed).toBe(4);
  expect(profile.continuous.status).toBe('failed');
  expect(profile.continuous.p95Ms).toBe(6000);
  expect(profile.continuous.slowRequests.map((sample) => sample.index)).toEqual(
    [46, 47, 48, 49],
  );
  expect(
    profile.continuous.slowRequests.find((sample) => sample.index === 47).atP95,
  ).toBe(true);
  expect(
    profile.continuous.slowRequests.every((sample) => sample.valid === false),
  ).toBe(true);
  // Failure elsewhere in the report is preserved even for a faster profile.
  expect(result.profiles[0].continuous.status).toBe('failed');
});

test('returns every p95 tie and includes the p95 request even below the target', () => {
  const baseline = summary(),
    continuous = summary();
  continuous.samples.forEach((sample) => {
    sample.durationMs = 1000;
  });
  const result = compareSubmitDiagnostics(baseline, continuous);
  expect(
    result.profiles[0].baseline.slowRequests.map((sample) => sample.index),
  ).toEqual([47]);
  expect(result.profiles[0].continuous.slowRequests).toHaveLength(50);
  expect(
    result.profiles[0].continuous.slowRequests.every(
      (sample) => sample.atP95 && !sample.atOrAboveTarget,
    ),
  ).toBe(true);
});

test('consolidates capsules per source and request without summing overlapping phases or percentiles', () => {
  const baseline = summary(),
    continuous = summary();
  continuous.samples[0].phaseTimings.push({
    source: 'submission',
    phase: 'suite',
    durationMs: 42,
    completed: false,
  });
  const profile = compareSubmitDiagnostics(baseline, continuous).profiles[0];
  expect(
    profile.baseline.phaseTimings.find((item) => item.phase === 'docker.wait'),
  ).toEqual({
    phase: 'docker.wait',
    samples: 50,
    events: 100,
    failed: 0,
    p95Ms: 694,
  });
  expect(
    profile.baseline.phaseTimings.find(
      (item) => item.phase === 'docker.streams',
    ).p95Ms,
  ).toBe(550);
  expect(
    profile.continuous.phaseTimings.find(
      (item) => item.phase === 'submission.suite',
    ),
  ).toEqual({
    phase: 'submission.suite',
    samples: 1,
    events: 1,
    failed: 1,
    p95Ms: 42,
  });
  expect(profile.baseline.p95Ms).toBe(1470);
  expect(profile.baseline.slowRequests[0].dominantPhase).toEqual({
    phase: 'submission.execute',
    durationMs: 900,
  });
});

test('different observation flags and missing phase evidence do not masquerade as changed VM conditions', () => {
  const baseline = summary(),
    continuous = summary();
  baseline.diagnostics.enabled = false;
  delete baseline.diagnostics.continuousEnabled;
  baseline.samples.forEach((sample) => {
    delete sample.phaseTimings;
  });
  const result = compareSubmitDiagnostics(baseline, continuous);
  expect(result.comparisonState).toBe('comparable');
  expect(result.mismatches).toEqual([]);
  expect(result.observationDifferences).toEqual([
    'diagnostics.enabled',
    'diagnostics.continuousEnabled',
  ]);
  expect(result.profiles[0].baseline.phaseTimings).toEqual([]);
  expect(result.profiles[0].baseline.slowRequests[0].dominantPhase).toBeNull();
});

test.each([
  [
    'candidateFingerprint',
    (x) => {
      x.candidateFingerprint = 'd'.repeat(64);
    },
  ],
  [
    'runner.image',
    (x) => {
      x.runner.image = 'another-image-private';
    },
  ],
  [
    'host.node',
    (x) => {
      x.host.node = 'v24.22.0';
    },
  ],
  [
    'environmentManifest.docker.cpus',
    (x) => {
      x.environmentManifest.docker.cpus = 8;
    },
  ],
  [
    'environmentManifest.docker.memoryBytes',
    (x) => {
      x.environmentManifest.docker.memoryBytes++;
    },
  ],
  [
    'environmentManifest.docker.serverVersion',
    (x) => {
      x.environmentManifest.docker.serverVersion = 'different-version-private';
    },
  ],
  [
    'environmentManifest.docker.driver',
    (x) => {
      x.environmentManifest.docker.driver = 'different-driver-private';
    },
  ],
  [
    'environmentManifest.docker.kernelVersion',
    (x) => {
      x.environmentManifest.docker.kernelVersion = 'different-kernel-private';
    },
  ],
  [
    'environmentManifest.workloadFingerprint',
    (x) => {
      x.environmentManifest.workloadFingerprint = 'e'.repeat(64);
    },
  ],
  [
    'fixture.title',
    (x) => {
      x.fixture.title = 'different-fixture-private';
    },
  ],
  [
    'profile.timeoutMs',
    (x) => {
      x.profile.timeoutMs++;
    },
  ],
])(
  'does not compare changed execution condition %s or expose its values',
  (label, change) => {
    const baseline = summary(),
      continuous = summary();
    change(continuous);
    const result = compareSubmitDiagnostics(baseline, continuous);
    expect(result.comparisonState).toBe('not-comparable');
    expect(result.mismatches).toContain(label);
    expect(
      result.profiles.every(
        (profile) => profile.difference.absoluteMs === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private');
  },
);

test.each([
  (x) => {
    x.mode = 'RUN';
  },
  (x) => {
    delete x.candidateFingerprint;
  },
  (x) => {
    x.environmentManifest.workloadFingerprint = 'malformed';
  },
  (x) => {
    x.profile.concurrent = 49;
  },
  (x) => {
    x.profile.concurrency = 2;
  },
  (x) => {
    x.samples.pop();
  },
  (x) => {
    x.samples.push({ ...x.samples[0] });
  },
  (x) => {
    x.samples[0].index = 1;
  },
  (x) => {
    x.samples[0].concurrency = 2;
  },
  (x) => {
    x.samples[0].durationMs = NaN;
  },
  (x) => {
    x.samples[0].valid = 'true';
  },
  (x) => {
    x.diagnostics.continuousEnabled = 'secret';
  },
  (x) => {
    x.samples[0].phaseTimings[0].phase = 'secret';
  },
])(
  'rejects incomplete or malformed retained measurements %# without cohort selection',
  (change) => {
    const baseline = summary(),
      continuous = summary();
    change(continuous);
    const result = compareSubmitDiagnostics(baseline, continuous);
    expect(result.comparisonState).toBe('not-comparable');
    expect(result.mismatches.length).toBeGreaterThan(0);
    expect(
      result.profiles.every((profile) => profile.difference.relative === null),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret');
  },
);

test.each([null, undefined, 'private-invalid-report', [], { summary: null }])(
  'fails closed for malformed report %#',
  (value) => {
    const result = compareSubmitDiagnostics(value, summary());
    expect(result.comparisonState).toBe('not-comparable');
    expect(result.profiles.map((profile) => profile.baseline.count)).toEqual([
      0, 0,
    ]);
    expect(JSON.stringify(result)).not.toContain('private-invalid-report');
  },
);

test('zero baseline has an absolute difference but no invented infinite relative difference', () => {
  const baseline = summary(),
    continuous = summary();
  baseline.samples.forEach((sample) => {
    sample.durationMs = 0;
  });
  continuous.samples.forEach((sample) => {
    sample.durationMs = 100;
  });
  const result = compareSubmitDiagnostics(baseline, continuous);
  expect(result.comparisonState).toBe('comparable');
  expect(result.profiles[0].baseline.failed).toBe(0);
  expect(result.profiles[0].difference).toEqual({
    absoluteMs: 100,
    relative: null,
    percent: null,
  });
});
