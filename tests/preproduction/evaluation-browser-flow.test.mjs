import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join, resolve, sep } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import {
  EvaluationClient,
  EvaluationError,
  EvaluationJournal,
  sha256,
} from '../../scripts/evaluation-client.mjs';
import {
  buildBrowserEvaluationPlan,
  assertBrowserEvaluationFixture,
  runBrowserEvaluation,
} from '../../scripts/evaluation-browser-integration.mjs';
import { apiEnvironment } from '../../scripts/local.mjs';
import { testContext } from '../../scripts/test-environment.mjs';
import { evaluationReport } from '../../scripts/evaluation-run.mjs';

let directory;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'alunza-browser-flow-'));
  jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('Unexpected network in offline browser-flow test');
  });
});
afterEach(async () => {
  jest.restoreAllMocks();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep))
    throw new Error('Refuse cleanup outside the dedicated temporary directory');
  await rm(directory, { recursive: true, force: true });
});

async function context() {
  const binding = {
    id: randomUUID(),
    attemptId: randomUUID(),
    actorId: randomUUID(),
    organizationId: randomUUID(),
  };
  const request = {
    id: randomUUID(),
    state: 'SUCCEEDED',
    feedbackId: randomUUID(),
    createdAt: '2026-11-18T10:00:00.000Z',
    completedAt: '2026-11-18T10:00:01.000Z',
    errorCode: null,
  };
  const feedback = {
    id: request.feedbackId,
    requestId: request.id,
    attemptId: binding.attemptId,
    presentationToken: null,
    help: {
      diagnosis_code: 'FAILED_TEST',
      explanation: 'Explicación canónica recibida por API.',
      hint: '',
      source_refs: [
        {
          source_id: randomUUID(),
          source_version_id: randomUUID(),
          chunk_id: randomUUID(),
          locator: 'párrafo 1',
        },
      ],
      status: 'SUPPORTED',
    },
  };
  const path = join(directory, `${randomUUID()}.json`);
  const journal = await EvaluationJournal.load(path, randomUUID());
  const sessions = {
    token: jest.fn(async () => 'fixture-access-token'),
    value: {
      actors: {
        [binding.actorId]: {
          refresh_token: 'fixture-refresh-token',
          expires_at: 2000000000,
        },
      },
    },
  };
  const options = {
    apiOrigin: 'http://127.0.0.1:4300',
    operationsOrigin: 'http://127.0.0.1:4401',
    runId: journal.value.runId,
    capability: 'fixture-capability',
    sessions,
    journal,
  };
  const name = `help:${binding.id}:FEEDBACK:0`;
  const canonicalApi = jest.fn(async (_actor, route, input = {}) => {
    if (
      route === `/attempts/${binding.attemptId}/feedback-requests` &&
      input.method === 'POST'
    )
      return request;
    if (route === `/feedback-requests/${request.id}` && !input.method)
      return request;
    if (route === `/feedback/${feedback.id}` && !input.method) return feedback;
    throw new Error('Unexpected product request in fixture');
  });
  return {
    binding,
    request,
    feedback,
    path,
    journal,
    options,
    name,
    canonicalApi,
  };
}

async function waitUntil(condition) {
  const deadline = performance.now() + 4000;
  while (!condition()) {
    if (performance.now() > deadline)
      throw new Error('Pacing fixture did not reach the expected barrier');
    await pause(10);
  }
}

async function pacingContext(mode) {
  const c = await context();
  const jobs = [];
  const accepted = [];
  function addJob(actorId = c.binding.actorId, waitForAdmission = true) {
    const binding = {
      ...c.binding,
      id: randomUUID(),
      attemptId: randomUUID(),
      actorId,
    };
    const request = {
      ...c.request,
      id: randomUUID(),
      feedbackId: randomUUID(),
    };
    const feedback = {
      ...c.feedback,
      id: request.feedbackId,
      requestId: request.id,
      attemptId: binding.attemptId,
    };
    let release;
    const admission = new Promise((resolveAdmission) => {
      release = resolveAdmission;
    });
    const job = {
      binding,
      request,
      feedback,
      admission,
      release,
      started: false,
    };
    c.options.sessions.value.actors[actorId] = {
      refresh_token: 'fixture-refresh-token',
      expires_at: 2000000000,
    };
    jobs.push(job);
    if (!waitForAdmission) release();
    return job;
  }
  async function admit(job, operationKey) {
    job.operationKey = operationKey;
    job.started = true;
    await job.admission;
    accepted.push({
      actorId: job.binding.actorId,
      operationKey,
      at: Date.now(),
    });
    return job.request;
  }
  const browserHelp = jest.fn(async ({ binding, operationKey, onAccepted }) => {
    const job = jobs.find((item) => item.binding.id === binding.id);
    const request = await admit(job, operationKey);
    await onAccepted(request);
    return {
      request,
      observation: { requestToParsedFeedbackMs: 900, actionToVisibleMs: 1000 },
      artifact: { file: 'fixture-only.json', sha256: sha256('fixture-only') },
    };
  });
  const client = new EvaluationClient({
    ...c.options,
    ...(mode === 'browser' ? { browserDriver: { help: browserHelp } } : {}),
  });
  client.product = jest.fn(async (_actor, route, options = {}) => {
    const job = jobs.find((item) =>
      [
        `/attempts/${item.binding.attemptId}/feedback-requests`,
        `/feedback-requests/${item.request.id}`,
        `/feedback/${item.feedback.id}`,
      ].includes(route),
    );
    if (!job) throw new Error('Unexpected pacing product request');
    if (options.method === 'POST') return admit(job, options.key);
    return route.startsWith('/feedback-requests/') ? job.request : job.feedback;
  });
  return {
    ...c,
    client,
    jobs,
    addJob,
    accepted,
    browserHelp,
    send: (job) =>
      client.help(job.binding, 'FEEDBACK', null, {
        profile: mode === 'browser' ? 'concurrent' : 'functional',
      }),
  };
}

test.each(['browser', 'http'])(
  '%s pacing retains six pending reservations through another actor and starts the window at actual 202 admission',
  async (mode) => {
    const c = await pacingContext(mode);
    const epoch = Date.parse('2026-11-18T10:00:00.000Z');
    let now = epoch;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const running = [];
    try {
      const six = Array.from({ length: 6 }, () => c.addJob());
      running.push(...six.map(c.send));
      await waitUntil(() => six.every((job) => job.started));
      expect(c.accepted).toHaveLength(0);

      // Navigation (or delayed HTTP admission) exceeds a whole quota window.
      // An unrelated actor then causes the shared journal to prune and save.
      now = epoch + 65_000;
      const otherActor = c.addJob(randomUUID(), false);
      const otherWork = c.send(otherActor);
      running.push(otherWork);
      await otherWork;
      const seventh = c.addJob(c.binding.actorId, false);
      const seventhWork = c.send(seventh);
      running.push(seventhWork);
      await pause(150);
      expect(seventh.started).toBe(false);
      expect(
        c.accepted.filter((item) => item.actorId === c.binding.actorId),
      ).toHaveLength(0);

      for (const job of six) job.release();
      await Promise.all(running.slice(0, 6));
      expect(
        c.accepted
          .filter((item) => item.actorId === c.binding.actorId)
          .map((item) => item.at),
      ).toEqual(Array(6).fill(epoch + 65_000));
      const saved = JSON.parse(await readFile(c.path, 'utf8'));
      for (const job of six)
        expect(
          saved.admissions.find(
            (item) => item.operationKeyHash === sha256(job.operationKey),
          ),
        ).toMatchObject({
          actorId: c.binding.actorId,
          at: epoch + 65_000,
          pending: false,
        });

      now = epoch + 65_000 + 60_099;
      // Allow a real pacing tick to evaluate the virtual boundary. Node's
      // promise timer stays real; only the admission wall clock is controlled.
      await pause(1100);
      expect(seventh.started).toBe(false);
      now = epoch + 65_000 + 60_100;
      await waitUntil(() => seventh.started);
      await seventhWork;
      const actorAdmissions = c.accepted.filter(
        (item) => item.actorId === c.binding.actorId,
      );
      expect(actorAdmissions).toHaveLength(7);
      expect(actorAdmissions[6].at).toBe(epoch + 65_000 + 60_100);
      for (const admission of actorAdmissions)
        expect(
          actorAdmissions.filter(
            (item) =>
              item.at > admission.at - 60_100 && item.at <= admission.at,
          ).length,
        ).toBeLessThanOrEqual(6);
      expect(c.journal.value.samples).toHaveLength(8);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      now = epoch + 1_000_000;
      for (const job of c.jobs) job.release();
      await Promise.allSettled(running);
      clock.mockRestore();
    }
  },
  15000,
);

test('a browser 429 records one rejected dispatch and preserves incomplete evidence without automatic retry or complete sample', async () => {
  const c = await context();
  const observation = {
    observation: 'INCOMPLETE',
    actionToVisibleMs: null,
    requestToParsedFeedbackMs: null,
    failureCode: 'BROWSER_HELP_ADMISSION_FAILED',
  };
  const bytes = JSON.stringify(observation);
  const file = 'browser-429-observation.json';
  await writeFile(join(directory, file), bytes, { flag: 'wx' });
  const artifact = { file, sha256: sha256(bytes) };
  const help = jest.fn(async () => {
    throw Object.assign(
      new EvaluationError('BROWSER_HELP_ADMISSION_FAILED', 429),
      {
        browserObservation: observation,
        browserArtifact: artifact,
      },
    );
  });
  const client = new EvaluationClient({
    ...c.options,
    browserDriver: { help },
  });
  client.product = c.canonicalApi;
  client.operations = jest.fn(async () => ({ state: 'RUNNING' }));
  await expect(
    client.help(c.binding, 'FEEDBACK', null, { profile: 'concurrent' }),
  ).rejects.toMatchObject({
    code: 'BROWSER_HELP_ADMISSION_FAILED',
    status: 429,
  });
  expect(help).toHaveBeenCalledTimes(1);
  expect(client.product).not.toHaveBeenCalled();
  expect(client.operations).not.toHaveBeenCalled();
  const saved = JSON.parse(await readFile(c.path, 'utf8'));
  expect(saved.samples).toEqual([]);
  expect(saved.operations[c.name]).toMatchObject({
    state: 'INTENT',
    browserEvidence: { observation, artifact },
    transport: {
      observation: 'INCOMPLETE',
      clientMs: null,
      attempts: [
        {
          state: 'QUOTA_REJECTED',
          httpStatus: 429,
          errorCode: 'BROWSER_HELP_ADMISSION_FAILED',
        },
      ],
    },
  });
  expect(saved.operations[c.name]).not.toHaveProperty('requestId');
  expect(await readFile(join(directory, file), 'utf8')).toBe(bytes);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('resuming an uncertain admission reuses its own slot among six pending reservations and confirms only that slot', async () => {
  const c = await context();
  const epoch = Date.parse('2026-11-18T10:00:00.000Z');
  const op = await c.journal.intent(c.name, {
    attemptId: c.binding.attemptId,
    kind: 'FEEDBACK',
  });
  op.transport = {
    firstDispatchedAt: new Date(epoch).toISOString(),
    observation: 'INCOMPLETE',
    clientMs: null,
    attempts: [],
  };
  const own = {
    actorId: c.binding.actorId,
    organizationId: c.binding.organizationId,
    operationKeyHash: sha256(op.key),
    at: epoch,
    pending: true,
  };
  const others = Array.from({ length: 5 }, () => ({
    ...own,
    operationKeyHash: sha256(randomUUID()),
  }));
  const othersBefore = globalThis.structuredClone(others);
  c.journal.value.admissions = [own, ...others];
  await c.journal.save();
  let now = epoch + 120_000;
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  const help = jest.fn(async () => {
    throw new Error('Recovery must not repeat the browser action');
  });
  const client = new EvaluationClient({
    ...c.options,
    browserDriver: { help },
  });
  client.product = c.canonicalApi;
  let settled = false;
  const work = client.help(c.binding, 'FEEDBACK', null, {
    profile: 'concurrent',
  });
  work.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  try {
    await waitUntil(() => settled);
    const sample = await work;
    expect(sample).toMatchObject({
      verificationComplete: true,
      clientObservation: 'INCOMPLETE',
      clientMs: null,
    });
    expect(sample).not.toHaveProperty('browserBinding');
    expect(sample).not.toHaveProperty('browserEvidence');
    expect(help).not.toHaveBeenCalled();
    const posts = c.canonicalApi.mock.calls.filter(
      ([, , input]) => input?.method === 'POST',
    );
    expect(posts).toHaveLength(1);
    expect(posts[0][2].key).toBe(op.key);
    const saved = JSON.parse(await readFile(c.path, 'utf8'));
    expect(saved.admissions).toHaveLength(6);
    expect(
      saved.admissions.find(
        (item) => item.operationKeyHash === own.operationKeyHash,
      ),
    ).toEqual({
      ...own,
      at: epoch + 120_000,
      pending: false,
    });
    expect(
      saved.admissions.filter(
        (item) => item.operationKeyHash !== own.operationKeyHash,
      ),
    ).toEqual(othersBefore);
    expect(saved.operations[c.name]).toMatchObject({
      key: op.key,
      state: 'DONE',
      requestId: c.request.id,
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    now = epoch + 1_000_000;
    for (const reservation of c.journal.value.admissions) {
      reservation.pending = false;
      reservation.at = epoch;
    }
    await Promise.allSettled([work]);
    clock.mockRestore();
  }
}, 10000);

test('only latency profiles dispatch through the browser; acceptance is durable before display and DONE replay invokes neither transport', async () => {
  for (const profile of ['serial', 'concurrent', 'functional', 'adversarial']) {
    const c = await context();
    let displayed = false;
    const help = jest.fn(async ({ operationKey, onAccepted }) => {
      const intent = JSON.parse(await readFile(c.path, 'utf8')).operations[
        c.name
      ];
      expect(intent).toMatchObject({ key: operationKey, state: 'INTENT' });
      await onAccepted(c.request);
      const admitted = JSON.parse(await readFile(c.path, 'utf8')).operations[
        c.name
      ];
      expect(admitted).toMatchObject({
        key: operationKey,
        state: 'ADMITTED',
        requestId: c.request.id,
      });
      expect(admitted.transport.attempts[0]).toMatchObject({
        state: 'RESPONSE',
        httpStatus: 202,
      });
      expect(displayed).toBe(false);
      displayed = true;
      return {
        request: c.request,
        observation: {
          requestToParsedFeedbackMs: 1250,
          actionToVisibleMs: 1300,
        },
        artifact: {
          path: 'synthetic-browser-observation.json',
          sha256: 'a'.repeat(64),
        },
      };
    });
    const client = new EvaluationClient({
      ...c.options,
      browserDriver: { help },
    });
    client.product = c.canonicalApi;
    const sample = await client.help(c.binding, 'FEEDBACK', null, { profile });
    const isLatency = ['serial', 'concurrent'].includes(profile);
    expect(help).toHaveBeenCalledTimes(isLatency ? 1 : 0);
    const posts = c.canonicalApi.mock.calls.filter(
      ([, route, input]) =>
        input?.method === 'POST' && route.endsWith('/feedback-requests'),
    );
    expect(posts).toHaveLength(isLatency ? 0 : 1);
    expect(c.canonicalApi.mock.calls.map(([, route]) => route)).toEqual(
      expect.arrayContaining([
        `/feedback-requests/${c.request.id}`,
        `/feedback/${c.feedback.id}`,
      ]),
    );
    expect(sample).toMatchObject({
      requestId: c.request.id,
      feedbackId: c.feedback.id,
      verificationComplete: true,
      diagnosis: 'FAILED_TEST',
    });
    if (isLatency)
      expect(sample).toMatchObject({
        clientMs: 1250,
        browserBinding: {
          explanationHash: sha256(c.feedback.help.explanation),
          hintHash: sha256(''),
        },
      });
    const browserCalls = help.mock.calls.length,
      apiCalls = c.canonicalApi.mock.calls.length;
    await expect(
      client.help(c.binding, 'FEEDBACK', null, { profile }),
    ).resolves.toEqual(sample);
    expect(help).toHaveBeenCalledTimes(browserCalls);
    expect(c.canonicalApi).toHaveBeenCalledTimes(apiCalls);
    expect(c.journal.value.samples).toHaveLength(1);
  }
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('interruption after browser admission preserves its id/key and recovery cannot promote missing visible evidence', async () => {
  const c = await context();
  const observation = { state: 'INCOMPLETE', actionToVisibleMs: null };
  const artifact = {
    path: 'interrupted-observation.json',
    sha256: 'b'.repeat(64),
  };
  const help = jest.fn(async ({ onAccepted }) => {
    await onAccepted(c.request);
    throw Object.assign(
      new EvaluationError('BROWSER_OBSERVATION_INTERRUPTED'),
      { browserObservation: observation, browserArtifact: artifact },
    );
  });
  const first = new EvaluationClient({ ...c.options, browserDriver: { help } });
  first.product = c.canonicalApi;
  await expect(
    first.help(c.binding, 'FEEDBACK', null, { profile: 'serial' }),
  ).rejects.toThrow('BROWSER_OBSERVATION_INTERRUPTED');
  expect(c.canonicalApi).not.toHaveBeenCalled();
  const saved = JSON.parse(await readFile(c.path, 'utf8')).operations[c.name];
  expect(saved).toMatchObject({
    requestId: c.request.id,
    state: 'ADMITTED',
    browserEvidence: { observation, artifact },
    transport: { observation: 'INCOMPLETE', clientMs: null },
  });
  const journal = await EvaluationJournal.load(c.path, c.journal.value.runId);
  const resumed = new EvaluationClient({
    ...c.options,
    journal,
    browserDriver: { help },
  });
  resumed.product = c.canonicalApi;
  const result = await resumed.help(c.binding, 'FEEDBACK', null, {
    profile: 'serial',
  });
  expect(help).toHaveBeenCalledTimes(1);
  const dispatch = c.canonicalApi.mock.calls.find(
    ([, , input]) => input?.method === 'POST',
  );
  expect(dispatch[2].key).toBe(saved.key);
  expect(result).toMatchObject({
    requestId: c.request.id,
    clientMs: null,
    clientObservation: 'INCOMPLETE',
    verificationComplete: true,
  });
  expect(result).not.toHaveProperty('browserBinding');
  expect(journal.value.operations[c.name]).toMatchObject({
    state: 'DONE',
    key: saved.key,
    requestId: c.request.id,
    browserEvidence: { observation, artifact },
  });
  expect(journal.value.samples).toHaveLength(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('the report requires 100 verified unique observations in 25 complete bindings per profile; legacy, forged, incomplete and slow evidence never passes', async () => {
  const expected = {
    runId: randomUUID(),
    provider: 'TEST',
    corpusHash: sha256('corpus'),
    candidateFingerprint: sha256('candidate'),
  };
  const producer = {
    version: 1,
    producer: 'CHROME_CDP',
    browserVersion: 'Chrome/142.0.7444.0',
    webSourceDigest: sha256('web'),
    ...expected,
  };
  const samples = [];
  await mkdir(join(directory, 'browser-observations'));
  async function persist(sample, overrides = {}) {
    sample.browserBinding.operationKeyHash = sha256(randomUUID());
    const actionToVisibleMs = overrides.actionToVisibleMs ?? 1000;
    const observation = {
      ...producer,
      ...sample.browserBinding,
      requestId: sample.requestId,
      feedbackId: sample.feedbackId,
      profile: sample.profile,
      kind: sample.kind,
      hintLevel: sample.hintLevel,
      startedAt: '2026-11-18T12:00:00.000Z',
      visibleAt: new Date(
        Date.parse('2026-11-18T12:00:00.000Z') + actionToVisibleMs,
      ).toISOString(),
      actionToVisibleMs,
      requestToParsedFeedbackMs: 900,
      statusFromDom: sample.status,
      domIdentityMatched: true,
      documentVisible: true,
      geometryVisible: true,
      paintFrames: 2,
      observation: 'COMPLETE',
      failureCode: null,
      ...overrides,
    };
    const bytes = JSON.stringify(observation);
    const file = `browser-observations/${sample.browserBinding.operationKeyHash}.json`;
    await writeFile(join(directory, file), bytes, { flag: 'wx' });
    sample.browserEvidence = {
      observation,
      artifact: { file, sha256: sha256(bytes) },
    };
  }
  for (const profile of ['serial', 'concurrent']) {
    for (let index = 0; index < 25; index++) {
      const bindingId = randomUUID(),
        attemptId = randomUUID(),
        actorId = randomUUID();
      for (const hintLevel of [null, 1, 2, 3]) {
        const sample = {
          profile,
          requestId: randomUUID(),
          feedbackId: randomUUID(),
          kind: hintLevel ? 'HINT' : 'FEEDBACK',
          hintLevel,
          status: 'SUPPORTED',
          verificationComplete: true,
          admissionToPersistedMs: 800,
          clientMs: 900,
          clientObservation: 'COMPLETE',
          browserBinding: {
            bindingId,
            attemptId,
            actorId,
            operationKeyHash: sha256(randomUUID()),
            explanationHash: sha256('Explicación visible.'),
            hintHash: sha256(hintLevel ? `Pista ${hintLevel}.` : ''),
          },
        };
        await persist(sample);
        samples.push(sample);
      }
    }
  }
  const report = (selected) =>
    evaluationReport({
      plan: {
        provider: 'TEST',
        profiles: {},
        candidateFingerprint: expected.candidateFingerprint,
      },
      prepared: { runId: expected.runId, corpusHash: expected.corpusHash },
      directory,
      journal: {
        value: { stages: {}, samples: selected, browserProducer: producer },
      },
    });
  const passing = await report(samples);
  expect(passing.profiles).toHaveLength(2);
  for (const profile of passing.profiles)
    expect(profile).toMatchObject({
      count: 100,
      browserObservedCount: 100,
      browserMissingCount: 0,
      browserInvalidCount: 0,
      browserP95Ms: 1000,
      belowDocumentaryTarget: true,
      documentaryTargetStatus: 'PASS',
    });
  const legacy = globalThis.structuredClone(samples);
  for (const sample of legacy) {
    delete sample.browserEvidence;
    delete sample.browserBinding;
  }
  for (const profile of (await report(legacy)).profiles)
    expect(profile).toMatchObject({
      belowServerTarget: true,
      belowApiResponseTarget: true,
      belowDocumentaryTarget: false,
      browserObservedCount: 0,
      documentaryTargetStatus: 'BLOCKED',
      documentaryTargetReason: 'BROWSER_RENDER_EVIDENCE_UNAVAILABLE',
    });

  const missing = globalThis.structuredClone(samples);
  delete missing[0].browserEvidence;
  expect((await report(missing)).profiles[0]).toMatchObject({
    browserObservedCount: 99,
    belowDocumentaryTarget: false,
    documentaryTargetStatus: 'BLOCKED',
  });
  const forged = globalThis.structuredClone(samples);
  forged[0].browserEvidence.artifact.sha256 = '0'.repeat(64);
  expect((await report(forged)).profiles[0]).toMatchObject({
    browserInvalidCount: 1,
    belowDocumentaryTarget: false,
  });

  const duplicate = globalThis.structuredClone(samples);
  duplicate[1].requestId = duplicate[0].requestId;
  await persist(duplicate[1]);
  expect((await report(duplicate)).profiles[0]).toMatchObject({
    browserObservedCount: 100,
    belowDocumentaryTarget: false,
    documentaryTargetStatus: 'BLOCKED',
  });
  const crossProfileDuplicate = globalThis.structuredClone(samples);
  crossProfileDuplicate[100].requestId = crossProfileDuplicate[0].requestId;
  await persist(crossProfileDuplicate[100]);
  for (const profile of (await report(crossProfileDuplicate)).profiles)
    expect(profile.belowDocumentaryTarget).toBe(false);
  const splitBinding = globalThis.structuredClone(samples);
  splitBinding[1].browserBinding.bindingId = randomUUID();
  await persist(splitBinding[1]);
  expect((await report(splitBinding)).profiles[0]).toMatchObject({
    browserObservedCount: 100,
    belowDocumentaryTarget: false,
    documentaryTargetStatus: 'BLOCKED',
  });
  const falseProfile = globalThis.structuredClone(samples);
  falseProfile[0].profile = 'concurrent';
  for (const profile of (await report(falseProfile)).profiles)
    expect(profile.belowDocumentaryTarget).toBe(false);
  const slow = globalThis.structuredClone(samples);
  for (let index = 94; index < 100; index++)
    await persist(slow[index], { actionToVisibleMs: 12000 });
  expect((await report(slow)).profiles[0]).toMatchObject({
    browserObservedCount: 100,
    browserP95Ms: 12000,
    belowDocumentaryTarget: false,
    documentaryTargetStatus: 'FAIL',
    documentaryTargetReason: 'BROWSER_P95_TARGET_EXCEEDED',
  });
  expect((await report(samples.slice(1))).profiles[0]).toMatchObject({
    count: 99,
    belowDocumentaryTarget: false,
    documentaryTargetStatus: 'BLOCKED',
  });
  expect(globalThis.fetch).not.toHaveBeenCalled();
}, 20000);

test('preflight accepts the real unbounded vector schema and checks empty or existing corpus metadata without changing it', async () => {
  const empty = {
    profiles: 0,
    incompatible_profiles: 0,
    configured_generations: 0,
    incompatible_generations: 0,
    chunks: 0,
    incompatible_chunks: 0,
  };
  const compatible = {
    ...empty,
    profiles: 1,
    configured_generations: 2,
    chunks: 6,
  };
  for (const scenario of [
    { dimensions: -1, corpus: empty, pass: true },
    { dimensions: -1, corpus: compatible, pass: true },
    { dimensions: 3, corpus: compatible, pass: true },
    { dimensions: 128, corpus: empty, pass: false },
    {
      dimensions: -1,
      corpus: { ...compatible, incompatible_profiles: 1 },
      pass: false,
    },
    {
      dimensions: -1,
      corpus: { ...compatible, incompatible_generations: 1 },
      pass: false,
    },
    {
      dimensions: -1,
      corpus: { ...compatible, incompatible_chunks: 1 },
      pass: false,
    },
    { dimensions: -1, corpus: { ...compatible, profiles: 0 }, pass: false },
  ]) {
    const rows = [
      [{ version: 'fixture-migration' }],
      [{ count: 1 }],
      [{ count: 3 }],
      [{ count: 8 }],
      [{ count: 4 }],
      [{ type: 'vector', dimensions: scenario.dimensions }],
      [scenario.corpus],
      [{ materials: 0, help: 0, executions: 0, submissions: 0 }],
      [{ count: 0 }],
    ];
    const db = {
      query: jest.fn(async (sql, parameters) => {
        expect(sql).toMatch(/^SELECT\b/u);
        if (sql.includes('app_private.material_embedding_profile')) {
          expect(parameters).toEqual([
            'materials-fixture-3d-v1',
            'test-fixture-only',
            3,
          ]);
          expect(sql).toContain('extensions.vector_dims(c.embedding)');
          expect(sql).toContain('configuration_id IS DISTINCT FROM $1');
          expect(sql).toContain('model IS DISTINCT FROM $2');
          expect(sql).toContain(
            'embedding_dimension IS DISTINCT FROM $3::integer',
          );
        }
        return { rows: rows.shift() };
      }),
    };
    const checked = assertBrowserEvaluationFixture(db, {
      actors: [{ id: randomUUID() }],
      migrations: ['fixture-migration'],
    });
    if (scenario.pass)
      await expect(checked).resolves.toMatchObject({
        vector: scenario.dimensions === -1 ? 'vector' : 'vector(3)',
        embeddingCompatibility: scenario.corpus,
      });
    else
      await expect(checked).rejects.toThrow(
        'BROWSER_EVALUATION_VECTOR_PROFILE_MISMATCH',
      );
  }
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('campaign plan uses real TEST configuration with fixed budgets and rejects evaluation/VM targets before running', async () => {
  const require = createRequire(import.meta.url);
  const { loadConfig } = require('../../apps/api/dist/config.js');
  const {
    evaluationProviderProfile,
  } = require('../../apps/api/dist/evaluation-profiles.js');
  const template = JSON.parse(
    await readFile('infra/preproduction/help-evaluation.example.json', 'utf8'),
  );
  const config = loadConfig({
    ...apiEnvironment(testContext, {
      projectId: 'alunza-edu-laboratorio-test',
      authUrl: 'http://127.0.0.1:18421',
      migrationUrl: 'postgresql://postgres:fixture@127.0.0.1:18422/postgres',
      applicationPassword: 'fixture',
      fixturePassword: 'fixture',
      publishableKey: 'fixture',
      authAdminKey: 'fixture',
    }),
    EVALUATION_ENABLED: 'true',
  });
  const args = {
    template,
    config,
    fingerprint: 'a'.repeat(64),
    now: 0,
    profileFactory: evaluationProviderProfile,
  };
  expect(buildBrowserEvaluationPlan(args)).toMatchObject({
    environment: 'TEST',
    provider: 'TEST',
    azure: null,
    destination: {
      projectId: 'alunza-edu-laboratorio-test',
      apiOrigin: 'http://127.0.0.1:4300',
    },
    budgets: { global: { maxCalls: 1216 }, FUNCTIONAL: { maxCalls: 12 } },
    latency: {
      serialAttempts: 25,
      concurrentAttempts: 25,
      helpsPerAttempt: 4,
      concurrency: 4,
    },
  });
  for (const override of [
    { environment: 'evaluation' },
    { environment: 'local' },
    { practiceRunnerProvider: 'local-vm' },
    { evaluation: { enabled: false } },
  ])
    expect(() =>
      buildBrowserEvaluationPlan({
        ...args,
        config: { ...config, ...override },
      }),
    ).toThrow('BROWSER_EVALUATION_TEST_CONFIGURATION');
  await expect(runBrowserEvaluation()).rejects.toThrow(
    'BROWSER_EVALUATION_DRIVER_REQUIRED',
  );
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
