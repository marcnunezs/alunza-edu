import { beforeEach, afterEach, test, expect } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { evaluationReport } from '../../scripts/evaluation-run.mjs';

let directory;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'alunza-evaluation-latency-'));
});
afterEach(async () => {
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep))
    throw new Error('Refuse cleanup outside the dedicated temporary directory');
  await rm(directory, { recursive: true, force: true });
});

const samplesFor = (profile, overrides = {}) =>
  Array.from({ length: 100 }, () => ({
    profile,
    status: 'SUPPORTED',
    verificationComplete: true,
    admissionToPersistedMs: 1000,
    clientMs: 1100,
    clientObservation: 'COMPLETE',
    ...overrides,
  }));
const reportFor = (samples) =>
  evaluationReport({
    plan: { provider: 'TEST', profiles: {} },
    prepared: { runId: randomUUID(), corpusHash: 'a'.repeat(64) },
    directory,
    journal: { value: { stages: {}, samples } },
  });
const blockedVisibleTarget = {
  belowDocumentaryTarget: false,
  documentaryLatencyScope: 'BROWSER_REQUEST_TO_VISIBLE_FEEDBACK',
  documentaryTargetStatus: 'BLOCKED',
  documentaryTargetReason: 'BROWSER_RENDER_EVIDENCE_UNAVAILABLE',
};

test.each(['serial', 'concurrent'])(
  '%s cannot use fast server persistence to accept a slow client response',
  async (profile) => {
    const samples = samplesFor(profile, { clientMs: 13000 });
    const report = await reportFor(samples);
    const measured = report.profiles.find((item) => item.name === profile);
    expect(report.latencyMetricsVersion).toBe(2);
    expect(measured).toMatchObject({
      count: 100,
      persistedP95Ms: 1000,
      clientP95Ms: 13000,
      belowServerTarget: true,
      belowApiResponseTarget: false,
      ...blockedVisibleTarget,
    });
    expect(report.samples).toEqual(samples);
  },
);

test('100 complete fast API responses do not establish browser rendering', async () => {
  const report = await reportFor(samplesFor('serial'));
  expect(report.profiles[0]).toMatchObject({
    expected: 100,
    clientObservedCount: 100,
    clientMissingCount: 0,
    latencyTargetMs: 12000,
    serverLatencyScope: 'ADMISSION_TO_FEEDBACK_PERSISTENCE',
    clientLatencyScope: 'LAST_ADMISSION_DISPATCH_TO_PARSED_FEEDBACK_RESPONSE',
    belowServerTarget: true,
    belowApiResponseTarget: true,
    ...blockedVisibleTarget,
  });
});

test.each([null, undefined, -1, Infinity, NaN])(
  'a missing or invalid client duration %s blocks the API gate without removing the sample',
  async (clientMs) => {
    const samples = samplesFor('serial');
    samples[0].clientMs = clientMs;
    const report = await reportFor(samples);
    expect(report.profiles[0]).toMatchObject({
      count: 100,
      clientObservedCount: 99,
      clientMissingCount: 1,
      clientP95Ms: 1100,
      belowServerTarget: true,
      belowApiResponseTarget: false,
      ...blockedVisibleTarget,
    });
  },
);

test('an explicitly incomplete client observation is not credited even with a finite duration', async () => {
  const samples = samplesFor('serial');
  samples[0].clientObservation = 'INCOMPLETE';
  expect((await reportFor(samples)).profiles[0]).toMatchObject({
    count: 100,
    clientObservedCount: 99,
    clientMissingCount: 1,
    belowServerTarget: true,
    belowApiResponseTarget: false,
    ...blockedVisibleTarget,
  });
});

test('legacy journal durations remain API/server evidence and never become visible-help evidence', async () => {
  const samples = samplesFor('serial');
  for (const sample of samples) delete sample.clientObservation;
  const report = await reportFor(samples);
  expect(report.profiles[0]).toMatchObject({
    count: 100,
    clientObservedCount: 100,
    clientP95Ms: 1100,
    belowServerTarget: true,
    belowApiResponseTarget: true,
    ...blockedVisibleTarget,
  });
  expect(report.samples).toEqual(samples);
  expect(report.samples[0]).not.toHaveProperty('clientObservation');
});

test.each([false, undefined])(
  'verificationComplete=%s cannot be accepted through a legacy missing-field default',
  async (verificationComplete) => {
    const samples = samplesFor('serial');
    if (verificationComplete === undefined)
      delete samples[0].verificationComplete;
    else samples[0].verificationComplete = verificationComplete;
    expect((await reportFor(samples)).profiles[0]).toMatchObject({
      count: 100,
      belowServerTarget: false,
      belowApiResponseTarget: false,
      ...blockedVisibleTarget,
    });
  },
);

test('the first fallback remains counted and blocks acceptance even with 100 recorded samples', async () => {
  const samples = samplesFor('serial');
  Object.assign(samples[0], {
    status: 'PROVIDER_UNAVAILABLE',
    errorCode: 'DEADLINE_EXCEEDED',
    admissionToPersistedMs: 15000,
    clientMs: 15100,
  });
  const report = await reportFor(samples);
  expect(report.profiles[0]).toMatchObject({
    count: 100,
    success: 99,
    fallbacks: 1,
    persistedP95Ms: 1000,
    clientP95Ms: 1100,
    belowServerTarget: false,
    belowApiResponseTarget: false,
    ...blockedVisibleTarget,
  });
  expect(report.samples[0]).toEqual(samples[0]);
});

test('an incomplete profile cannot pass any latency gate', async () => {
  const samples = samplesFor('serial').slice(0, 99);
  expect((await reportFor(samples)).profiles[0]).toMatchObject({
    count: 99,
    belowServerTarget: false,
    belowApiResponseTarget: false,
    ...blockedVisibleTarget,
  });
});

test('missing server persistence evidence does not invalidate complete API response evidence', async () => {
  const samples = samplesFor('serial');
  samples[0].admissionToPersistedMs = null;
  expect((await reportFor(samples)).profiles[0]).toMatchObject({
    count: 100,
    clientObservedCount: 100,
    belowServerTarget: false,
    belowApiResponseTarget: true,
    ...blockedVisibleTarget,
  });
});

test('100 missing client observations remain unknown rather than becoming zero latency', async () => {
  expect(
    (await reportFor(samplesFor('serial', { clientMs: null }))).profiles[0],
  ).toMatchObject({
    count: 100,
    clientObservedCount: 0,
    clientMissingCount: 100,
    clientP50Ms: null,
    clientP95Ms: null,
    belowServerTarget: true,
    belowApiResponseTarget: false,
    ...blockedVisibleTarget,
  });
});

test('the API gate uses a strict p95 below 12000 ms and stays separate from the server gate', async () => {
  expect(
    (await reportFor(samplesFor('serial', { clientMs: 12000 }))).profiles[0],
  ).toMatchObject({
    belowServerTarget: true,
    belowApiResponseTarget: false,
    ...blockedVisibleTarget,
  });
});
