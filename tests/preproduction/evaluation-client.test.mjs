import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import {
  mkdtemp,
  readFile,
  writeFile,
  rename,
  readdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  EvaluationClient,
  EvaluationJournal,
  EvaluationSessions,
  EvaluationError,
  privateJson,
  sha256,
} from '../../scripts/evaluation-client.mjs';
import {
  evaluationReport,
  runEvaluation,
  verifyReviewCases,
} from '../../scripts/evaluation-run.mjs';
import { evaluationMain } from '../../scripts/evaluation-cli.mjs';

let directory;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'alunza-evaluation-client-'));
  jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('Unexpected network in offline evaluation test');
  });
});
afterEach(async () => {
  jest.restoreAllMocks();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep))
    throw new Error('Refuse cleanup outside the dedicated temporary directory');
  await rm(directory, { recursive: true, force: true });
});
const binding = () => ({
  id: randomUUID(),
  attemptId: randomUUID(),
  actorId: randomUUID(),
  organizationId: randomUUID(),
});
const makeClient = (journal) =>
  new EvaluationClient({
    apiOrigin: 'http://127.0.0.1:4400',
    operationsOrigin: 'http://127.0.0.1:4401',
    runId: journal.value.runId,
    capability: 'fixture-capability',
    sessions: { token: async () => 'fixture-token' },
    journal,
  });
const unavailable = (attemptId) => ({
  id: randomUUID(),
  attemptId,
  requestId: randomUUID(),
  kind: 'HINT',
  hintLevel: 1,
  available: true,
  presentationToken: null,
  help: {
    diagnosis_code: 'FAILED_TEST',
    explanation: 'Servicio temporalmente no disponible.',
    hint: '',
    source_refs: [],
    status: 'PROVIDER_UNAVAILABLE',
  },
});

test.each(['EPERM', 'EACCES', 'EBUSY'])(
  'atomic JSON retries the same replacement after transient %s without deleting the destination',
  async (code) => {
    const path = join(directory, 'atomic.json');
    await privateJson(path, { version: 'previous' });
    const calls = [];
    const pause = jest.fn(async () => undefined);
    await privateJson(
      path,
      { version: 'next' },
      {
        pause,
        renameFile: async (source, destination) => {
          calls.push([source, destination]);
          expect(JSON.parse(await readFile(destination, 'utf8'))).toEqual({
            version: 'previous',
          });
          expect(JSON.parse(await readFile(source, 'utf8'))).toEqual({
            version: 'next',
          });
          if (calls.length < 3)
            throw Object.assign(new Error('fixture sharing lock'), { code });
          await rename(source, destination);
        },
      },
    );
    expect(calls).toHaveLength(3);
    expect(
      calls.every((entry) => entry[0] === calls[0][0] && entry[1] === path),
    ).toBe(true);
    expect(pause.mock.calls.map(([duration]) => duration)).toEqual([25, 50]);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 'next',
    });
    expect(await readdir(directory)).toEqual(['atomic.json']);
  },
);

test('an exhausted sharing-lock retry retains both the previous destination and the new temporary evidence', async () => {
  const path = join(directory, 'atomic.json');
  await privateJson(path, { version: 'previous' });
  const failure = Object.assign(new Error('fixture persistent sharing lock'), {
    code: 'EPERM',
  });
  const renameFile = jest.fn(async () => {
    throw failure;
  });
  const pause = jest.fn(async () => undefined);
  await expect(
    privateJson(path, { version: 'next' }, { renameFile, pause }),
  ).rejects.toBe(failure);
  expect(renameFile).toHaveBeenCalledTimes(6);
  expect(pause.mock.calls.map(([duration]) => duration)).toEqual([
    25, 50, 100, 200, 400,
  ]);
  const sources = renameFile.mock.calls.map(([source]) => source);
  expect(new Set(sources).size).toBe(1);
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
    version: 'previous',
  });
  expect(JSON.parse(await readFile(sources[0], 'utf8'))).toEqual({
    version: 'next',
  });
});

test('atomic JSON does not retry unrelated filesystem errors', async () => {
  const failure = Object.assign(new Error('fixture missing path'), {
    code: 'ENOENT',
  });
  const renameFile = jest.fn(async () => {
    throw failure;
  });
  const pause = jest.fn(async () => undefined);
  await expect(
    privateJson(
      join(directory, 'atomic.json'),
      { marker: 'fictitious' },
      { renameFile, pause },
    ),
  ).rejects.toBe(failure);
  expect(renameFile).toHaveBeenCalledTimes(1);
  expect(pause).not.toHaveBeenCalled();
});

test('report CLI attributes receipts to the immutable authorization even after the editable plan changes or expires', async () => {
  const example = JSON.parse(
    await readFile('infra/preproduction/help-evaluation.example.json', 'utf8'),
  );
  const runId = randomUUID(),
    corpusHash = 'c'.repeat(64);
  const profiles = (label) =>
    Object.fromEntries(
      ['EMBEDDING', 'GENERATION', 'REVIEW'].map((phase) => [
        phase,
        {
          id: `${label}-${phase}`,
          model: `${label}-model`,
          fingerprint: 'a'.repeat(64),
          ...(phase === 'EMBEDDING' ? { dimensions: 3 } : {}),
          inputMicroUsdPerMillion: '100',
          outputMicroUsdPerMillion: '200',
        },
      ]),
    );
  const plan = {
    ...example,
    candidateFingerprint: 'b'.repeat(64),
    profiles: profiles('next-candidate'),
  };
  const budget = {
    maxCalls: 10,
    maxInputTokens: 1000,
    maxOutputTokens: 1000,
    maxCostMicroUsd: '1000',
  };
  const authorized = {
    version: 1,
    runId,
    environment: 'LAB-EVAL',
    provider: 'AZURE',
    releaseSha: 'a'.repeat(64),
    environmentHash: sha256(JSON.stringify(plan.destination)),
    corpusHash,
    approvedBy: 'Fictitious operator',
    approvalReference: 'offline-fixture',
    priceVersion: 'fixture-only',
    expiresAt: '2020-01-01T00:00:00Z',
    globalBudget: budget,
    stages: Object.fromEntries(
      ['INGESTION', 'CALIBRATION', 'FUNCTIONAL', 'EVALUATION'].map((stage) => [
        stage,
        budget,
      ]),
    ),
    profiles: profiles('authorized-candidate'),
    materials: [],
    cases: [],
  };
  await privateJson(join(directory, 'plan.json'), plan);
  await privateJson(join(directory, 'prepared.json'), { runId, corpusHash });
  await privateJson(join(directory, 'authorized-manifest.json'), authorized);
  await privateJson(join(directory, 'capability.json'), {
    runId,
    capability: 'fixture-only',
  });
  await privateJson(join(directory, 'sessions.json'), { actors: {} });
  await privateJson(join(directory, 'run-journal.json'), {
    version: 1,
    runId,
    stages: {},
    samples: [],
    operations: {},
  });
  jest
    .spyOn(EvaluationClient.prototype, 'receipts')
    .mockRejectedValue(new EvaluationError('OPERATIONS_HTTP_403', 403));
  const report = await evaluationMain([
    '--mode',
    'report',
    '--manifest',
    join(directory, 'plan.json'),
    '--directory',
    directory,
  ]);
  expect(report.candidateFingerprint).toBe(authorized.releaseSha);
  expect(report.configuration).toEqual(authorized.profiles);
  expect(report.corpusHash).toBe(authorized.corpusHash);
  expect(report.provider).toBe(authorized.provider);
  expect(report.receiptEvidence).toBe('UNAVAILABLE');
  expect(report.observedCostMicroUsd).toBeNull();
  expect(JSON.stringify(report)).not.toContain('next-candidate');
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const renewedSession = (actorId, suffix) => ({
  error: null,
  data: {
    session: {
      user: { id: actorId },
      access_token: `fixture-access-${suffix}`,
      refresh_token: `fixture-refresh-${suffix}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    },
  },
});

test('concurrent calls for the same actor share one refresh and return only a durably saved token', async () => {
  const actorId = randomUUID(),
    path = join(directory, 'sessions.json');
  const original = {
    actors: {
      [actorId]: {
        access_token: 'fixture-expired',
        refresh_token: 'fixture-old-refresh',
        expires_at: 1,
      },
    },
  };
  await privateJson(path, original);
  const sessions = await EvaluationSessions.load(path);
  const pending = deferred();
  const refreshSession = jest.fn(() => pending.promise);
  sessions.clients.set(actorId, { auth: { refreshSession } });
  const first = sessions.token(actorId),
    second = sessions.token(actorId);
  expect(refreshSession).toHaveBeenCalledTimes(1);
  expect(refreshSession).toHaveBeenCalledWith({
    refresh_token: 'fixture-old-refresh',
  });
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(original);
  pending.resolve(renewedSession(actorId, 'same-actor'));
  for (const token of await Promise.all([first, second])) {
    expect(token).toBe('fixture-access-same-actor');
    expect(
      JSON.parse(await readFile(path, 'utf8')).actors[actorId].access_token,
    ).toBe(token);
  }
  expect(sessions.renewals.size).toBe(0);
  await sessions.token(actorId);
  expect(refreshSession).toHaveBeenCalledTimes(1);
});

test('simultaneous actor refreshes serialize complete vault snapshots and preserve other actors', async () => {
  const firstId = randomUUID(),
    secondId = randomUUID(),
    retainedId = randomUUID();
  const path = join(directory, 'sessions.json');
  const actors = Object.fromEntries(
    [firstId, secondId, retainedId].map((id) => [
      id,
      {
        access_token: `fixture-old-${id}`,
        refresh_token: `fixture-refresh-${id}`,
        expires_at: 1,
      },
    ]),
  );
  await privateJson(path, {
    actors,
    authUrl: 'http://127.0.0.1:1',
    publishableKey: 'fixture-public-key',
  });
  const sessions = await EvaluationSessions.load(path);
  const first = deferred(),
    second = deferred();
  const firstRefresh = jest.fn(() => first.promise),
    secondRefresh = jest.fn(() => second.promise);
  sessions.clients.set(firstId, { auth: { refreshSession: firstRefresh } });
  sessions.clients.set(secondId, { auth: { refreshSession: secondRefresh } });
  const tokens = Promise.all([
    sessions.token(firstId),
    sessions.token(secondId),
    sessions.token(firstId),
  ]);
  second.resolve(renewedSession(secondId, 'second'));
  first.resolve(renewedSession(firstId, 'first'));
  expect(await tokens).toEqual([
    'fixture-access-first',
    'fixture-access-second',
    'fixture-access-first',
  ]);
  const stored = JSON.parse(await readFile(path, 'utf8'));
  expect(stored.actors[firstId]).toMatchObject({
    access_token: 'fixture-access-first',
    refresh_token: 'fixture-refresh-first',
  });
  expect(stored.actors[secondId]).toMatchObject({
    access_token: 'fixture-access-second',
    refresh_token: 'fixture-refresh-second',
  });
  expect(stored.actors[retainedId]).toEqual(actors[retainedId]);
  expect(Object.keys(stored.actors)).toHaveLength(3);
  expect(firstRefresh).toHaveBeenCalledTimes(1);
  expect(secondRefresh).toHaveBeenCalledTimes(1);
});

test('a refresh for a different actor cannot mutate the vault and a missing actor never refreshes', async () => {
  const actorId = randomUUID(),
    strangerId = randomUUID(),
    path = join(directory, 'sessions.json');
  const original = {
    actors: {
      [actorId]: {
        access_token: 'fixture-expired',
        refresh_token: 'fixture-old',
        expires_at: 1,
      },
    },
  };
  await privateJson(path, original);
  const sessions = await EvaluationSessions.load(path);
  const refreshSession = jest
    .fn()
    .mockResolvedValueOnce(renewedSession(strangerId, 'foreign'))
    .mockResolvedValueOnce(renewedSession(actorId, 'authorized'));
  sessions.clients.set(actorId, { auth: { refreshSession } });
  sessions.clients.set(strangerId, { auth: { refreshSession } });
  await expect(sessions.token(strangerId)).rejects.toMatchObject({
    code: 'SESSION_ACTOR_MISSING',
  });
  expect(refreshSession).not.toHaveBeenCalled();
  await expect(sessions.token(actorId)).rejects.toMatchObject({
    code: 'SESSION_RENEWAL_FAILED',
  });
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(original);
  expect(sessions.renewals.size).toBe(0);
  expect(await sessions.token(actorId)).toBe('fixture-access-authorized');
  expect(Object.keys(JSON.parse(await readFile(path, 'utf8')).actors)).toEqual([
    actorId,
  ]);
});

test('journal persists its intention before transport and refuses another payload on the same name', async () => {
  const path = join(directory, 'journal.json');
  const runId = randomUUID();
  const original = await EvaluationJournal.load(path, runId);
  const first = await original.intent('owned-operation', {
    attemptId: 'fixture',
    kind: 'HINT',
  });
  const reloaded = await EvaluationJournal.load(path, runId);
  expect(
    await reloaded.intent('owned-operation', {
      attemptId: 'fixture',
      kind: 'HINT',
    }),
  ).toEqual(first);
  await expect(
    reloaded.intent('owned-operation', { attemptId: 'foreign', kind: 'HINT' }),
  ).rejects.toMatchObject({ code: 'JOURNAL_PAYLOAD_MISMATCH' });
  await expect(
    EvaluationJournal.load(path, randomUUID()),
  ).rejects.toMatchObject({ code: 'JOURNAL_RUN_MISMATCH' });
  expect(
    JSON.stringify(JSON.parse(await readFile(path, 'utf8'))),
  ).not.toContain('fixture-token');
});

test('active journal ownership prevents a second process from taking the same file', async () => {
  const path = join(directory, 'journal.json');
  const runId = randomUUID();
  const owner = await EvaluationJournal.load(path, runId);
  const contender = await EvaluationJournal.load(path, runId);
  await owner.lock();
  try {
    await expect(contender.lock()).rejects.toBeDefined();
  } finally {
    await owner.close();
  }
  await contender.lock();
  await contender.close();
});

test('a dead journal owner can be reclaimed while retaining its saved operation key', async () => {
  const path = join(directory, 'journal.json'),
    runId = randomUUID();
  const original = await EvaluationJournal.load(path, runId);
  const intent = await original.intent('admitted', { attemptId: 'fictitious' });
  await writeFile(
    `${path}.lock`,
    JSON.stringify({ pid: 123456789, nonce: randomUUID() }),
  );
  jest.spyOn(process, 'kill').mockImplementation((pid) => {
    if (pid === 123456789)
      throw Object.assign(new Error('dead fictitious owner'), {
        code: 'ESRCH',
      });
    return true;
  });
  const restored = await EvaluationJournal.load(path, runId);
  await restored.lock();
  try {
    expect(
      (await restored.intent('admitted', { attemptId: 'fictitious' })).key,
    ).toBe(intent.key);
  } finally {
    await restored.close();
  }
});

test('a response lost after admission resumes with the same key and records one fallback sample without ACK', async () => {
  const runId = randomUUID(),
    path = join(directory, 'journal.json');
  const entry = binding();
  const original = makeClient(await EvaluationJournal.load(path, runId));
  const sent = [];
  original.product = jest.fn(async (_actor, _path, options) => {
    sent.push(options.key);
    const dispatched = Object.values(
      JSON.parse(await readFile(path, 'utf8')).operations,
    )[0].transport;
    expect(dispatched.attempts[0].state).toBe('DISPATCHED');
    expect(dispatched.firstDispatchedAt).toBe(
      dispatched.attempts[0].dispatchedAt,
    );
    throw new TypeError('controlled ambiguous response');
  });
  await expect(original.help(entry, 'HINT', 1)).rejects.toThrow(
    'controlled ambiguous response',
  );
  const firstTransport = Object.values(original.journal.value.operations)[0]
    .transport;
  expect(firstTransport).toMatchObject({
    observation: 'INCOMPLETE',
    clientMs: null,
    attempts: [
      {
        state: 'UNCERTAIN',
        errorCode: 'EVALUATION_OPERATION_FAILED',
        httpStatus: null,
      },
    ],
  });
  const restored = makeClient(await EvaluationJournal.load(path, runId));
  const feedback = unavailable(entry.attemptId);
  restored.product = jest.fn(async (_actor, route, options = {}) => {
    if (route.endsWith('/feedback-requests')) {
      sent.push(options.key);
      return { id: feedback.requestId };
    }
    if (route.startsWith('/feedback-requests/'))
      return {
        state: 'SUCCEEDED',
        feedbackId: feedback.id,
        createdAt: '2026-10-01T00:00:00Z',
        completedAt: '2026-10-01T00:00:01Z',
        errorCode: null,
      };
    if (route === `/feedback/${feedback.id}`) return feedback;
    throw new Error('Unexpected product side effect');
  });
  const result = await restored.help(entry, 'HINT', 1);
  expect(sent).toHaveLength(2);
  expect(sent[0]).toBe(sent[1]);
  expect(result.status).toBe('PROVIDER_UNAVAILABLE');
  expect(result.admissionToPersistedMs).toBe(1000);
  expect(result.clientMs).toBeNull();
  expect(result.clientObservation).toBe('INCOMPLETE');
  expect(result.firstDispatchedAt).toBe(firstTransport.firstDispatchedAt);
  expect(result.transportAttempts).toBe(2);
  const resumedTransport = Object.values(restored.journal.value.operations)[0]
    .transport;
  expect(resumedTransport.attempts.map((item) => item.state)).toEqual([
    'UNCERTAIN',
    'RESPONSE',
  ]);
  expect(JSON.stringify(resumedTransport)).not.toContain(
    'controlled ambiguous response',
  );
  expect(restored.journal.value.samples).toHaveLength(1);
  expect(
    restored.product.mock.calls.some(([, route]) => route.endsWith('/viewed')),
  ).toBe(false);
  expect(await restored.help(entry, 'HINT', 1)).toEqual(result);
  expect(restored.journal.value.samples).toHaveLength(1);
});

test('a real quota response reuses the operation key instead of creating another intention', async () => {
  const entry = binding();
  const client = makeClient(
    await EvaluationJournal.load(join(directory, 'journal.json'), randomUUID()),
  );
  const feedback = unavailable(entry.attemptId);
  const sent = [];
  client.operations = jest.fn(async () => ({ state: 'RUNNING' }));
  client.product = jest.fn(async (_actor, route, options = {}) => {
    if (route.endsWith('/feedback-requests')) {
      sent.push(options.key);
      if (sent.length === 1) throw new EvaluationError('QUOTA_WAIT', 429);
      return { id: feedback.requestId };
    }
    if (route.startsWith('/feedback-requests/'))
      return {
        state: 'SUCCEEDED',
        feedbackId: feedback.id,
        createdAt: '2026-10-01T00:00:00Z',
        completedAt: '2026-10-01T00:00:01Z',
        errorCode: null,
      };
    return feedback;
  });
  const sample = await client.help(entry, 'HINT', 1);
  expect(sent).toHaveLength(2);
  expect(sent[0]).toBe(sent[1]);
  expect(Object.keys(client.journal.value.operations)).toHaveLength(1);
  expect(client.journal.value.samples).toHaveLength(1);
  expect(sample.quotaWaitMs).toBeGreaterThanOrEqual(1000);
  expect(Number.isFinite(sample.clientMs)).toBe(true);
  expect(sample.clientObservation).toBe('COMPLETE');
  expect(
    Object.values(client.journal.value.operations)[0].transport.attempts.map(
      (item) => item.state,
    ),
  ).toEqual(['QUOTA_REJECTED', 'RESPONSE']);
}, 10000);

test('a quota retry stops when the server revokes the operational run and never invents a completed sample', async () => {
  const entry = binding();
  const client = makeClient(
    await EvaluationJournal.load(join(directory, 'journal.json'), randomUUID()),
  );
  client.product = jest.fn(async () => {
    throw new EvaluationError('QUOTA_WAIT', 429);
  });
  client.operations = jest.fn(async () => ({ state: 'STOPPED' }));
  await expect(client.help(entry, 'HINT', 1)).rejects.toMatchObject({
    code: 'RUN_STOPPED',
  });
  expect(client.product).toHaveBeenCalledTimes(1);
  expect(client.journal.value.samples).toEqual([]);
  expect(Object.values(client.journal.value.operations)[0].state).toBe(
    'INTENT',
  );
});

test('product errors are coded without persisting response content or credentials', async () => {
  const journal = await EvaluationJournal.load(
    join(directory, 'journal.json'),
    randomUUID(),
  );
  const client = makeClient(journal);
  const transport = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ error: 'private SQL token contents' }), {
      status: 503,
    }),
  );
  await expect(
    client.product(randomUUID(), '/attempts/fixture'),
  ).rejects.toMatchObject({ code: 'PRODUCT_HTTP_503', status: 503 });
  expect(transport.mock.calls[0][1].redirect).toBe('error');
  expect(JSON.stringify(journal.value)).not.toContain('private SQL token');
  expect(JSON.stringify(journal.value)).not.toContain('fixture-token');
});

test('report preserves unknown usage and counts fallbacks without inventing pedagogical or Azure acceptance', async () => {
  const prepared = {
    runId: randomUUID(),
    corpusHash: 'a'.repeat(64),
    omittedRemoteOracles: [],
  };
  const plan = {
    provider: 'TEST',
    candidateFingerprint: 'b'.repeat(64),
    profiles: {},
  };
  const value = {
    samples: [
      {
        profile: 'serial',
        status: 'PROVIDER_UNAVAILABLE',
        admissionToPersistedMs: 15000,
        clientMs: 15100,
        hintLevel: 1,
        kind: 'HINT',
      },
    ],
    stages: {},
  };
  const client = {
    receipts: async () => [
      {
        state: 'UNKNOWN',
        inputTokens: null,
        observedCostMicroUsd: null,
        reservedCostMicroUsd: '100',
      },
    ],
  };
  const report = await evaluationReport({
    plan,
    prepared,
    directory,
    journal: { value },
    client,
  });
  expect(report.observedInputTokens).toBeNull();
  expect(report.observedCostMicroUsd).toBeNull();
  expect(report.maximumReservedCostMicroUsd).toBe('100');
  expect(report.profiles[0]).toMatchObject({
    count: 1,
    success: 0,
    fallbacks: 1,
    belowDocumentaryTarget: false,
  });
  expect(report.academicAcceptance).toBe('PENDING');
  expect(report.azureEvidence).toBe('NOT_PROMOTABLE');
  expect(JSON.stringify(report)).not.toContain('presentationToken');
  const review = JSON.parse(
    await readFile(join(directory, 'teacher-review.json'), 'utf8'),
  );
  expect(review.reviewer).toBeNull();
  expect(review.acceptance).toBeNull();
});

test('regenerating a report preserves an existing human review for that same run', async () => {
  const runId = randomUUID(),
    corpusHash = 'a'.repeat(64);
  const reviewed = {
    version: 'help-rubric-1',
    runId,
    corpusHash,
    reviewer: 'Docente ficticio',
    reviewedAt: '2026-10-01T00:00:00Z',
    acceptance: 'NEEDS_REVISION',
    cases: [
      {
        feedbackId: randomUUID(),
        ratings: ['NEEDS_REVISION'],
        notes: 'Revisión ficticia que no debe borrarse.',
      },
    ],
  };
  await privateJson(join(directory, 'teacher-review.json'), reviewed);
  await evaluationReport({
    plan: { provider: 'TEST', profiles: {} },
    prepared: { runId, corpusHash, omittedRemoteOracles: [] },
    directory,
    journal: { value: { samples: [], stages: {} } },
    client: { receipts: async () => [] },
  });
  expect(
    JSON.parse(await readFile(join(directory, 'teacher-review.json'), 'utf8')),
  ).toEqual(reviewed);
});

test.each(['absent', 'empty', 'unavailable'])(
  'report leaves consumption unknown when receipt evidence is %s',
  async (mode) => {
    const client =
      mode === 'absent'
        ? undefined
        : {
            receipts: async () => {
              if (mode === 'unavailable')
                throw new Error('private transport message');
              return [];
            },
          };
    const report = await evaluationReport({
      plan: { provider: 'TEST', profiles: {} },
      prepared: { runId: randomUUID(), corpusHash: 'a'.repeat(64) },
      directory,
      journal: { value: { samples: [], stages: {} } },
      client,
    });
    expect(report.observedInputTokens).toBeNull();
    expect(report.observedCostMicroUsd).toBeNull();
    expect(report.maximumReservedCostMicroUsd).toBeNull();
    expect(report.receiptEvidence).toBe(
      {
        absent: 'NOT_FETCHED',
        empty: 'NO_RECEIPTS',
        unavailable: 'UNAVAILABLE',
      }[mode],
    );
    expect(JSON.stringify(report)).not.toContain('private transport');
  },
);

test.each([
  [[null, null, 900], 1, 2, 900],
  [[null, null], 0, 2, null],
])(
  'client latency percentiles exclude missing observations %j without changing the sample count',
  async (measurements, observed, missing, percentile) => {
    const report = await evaluationReport({
      plan: { provider: 'TEST', profiles: {} },
      prepared: { runId: randomUUID(), corpusHash: 'a'.repeat(64) },
      directory,
      journal: {
        value: {
          stages: {},
          samples: measurements.map((clientMs) => ({
            profile: 'serial',
            status: 'SUPPORTED',
            clientMs,
            admissionToPersistedMs: 1000,
          })),
        },
      },
    });
    expect(report.profiles[0]).toMatchObject({
      count: measurements.length,
      clientObservedCount: observed,
      clientMissingCount: missing,
      clientP50Ms: percentile,
      clientP95Ms: percentile,
      persistedP50Ms: 1000,
      persistedP95Ms: 1000,
    });
  },
);

test('a new review snapshot is merged without replacing the human ratings or original review basis', async () => {
  const runId = randomUUID(),
    corpusHash = 'a'.repeat(64);
  const firstId = randomUUID(),
    nextId = randomUUID();
  const previous = {
    version: 'help-rubric-1',
    runId,
    corpusHash,
    reviewer: 'Docente ficticio',
    reviewedAt: '2026-10-01T00:00:00Z',
    acceptance: 'NEEDS_REVISION',
    cases: [
      {
        feedbackId: firstId,
        ratings: ['NEEDS_REVISION'],
        notes: 'Conservar',
        snapshot: { response: { explanation: 'Base de revisión original.' } },
      },
    ],
  };
  await privateJson(join(directory, 'teacher-review.json'), previous);
  const snapshot = {
    corpusKind: 'FICTITIOUS_ADVERSARIAL',
    response: { explanation: 'Explicación ficticia nueva.' },
    context: { statement: 'Ejercicio ficticio', code: 'return n;' },
    references: [
      { text: 'return comunica un resultado.', locator: 'Líneas 1–1' },
    ],
  };
  const args = {
    plan: { provider: 'TEST', profiles: {} },
    prepared: { runId, corpusHash },
    directory,
    journal: {
      value: {
        samples: [firstId, nextId].map((feedbackId) => ({
          feedbackId,
          kind: 'FEEDBACK',
          hintLevel: null,
        })),
        stages: {},
        reviewSnapshots: { [firstId]: snapshot, [nextId]: snapshot },
      },
    },
  };
  await evaluationReport(args);
  await evaluationReport(args);
  const merged = JSON.parse(
    await readFile(join(directory, 'teacher-review.json'), 'utf8'),
  );
  expect(merged).toMatchObject({
    reviewer: previous.reviewer,
    reviewedAt: previous.reviewedAt,
    acceptance: previous.acceptance,
  });
  expect(merged.cases).toHaveLength(2);
  expect(merged.cases[0]).toEqual(previous.cases[0]);
  expect(merged.cases[1]).toMatchObject({
    feedbackId: nextId,
    snapshot,
    ratings: null,
    notes: null,
  });
});

test('an interrupted ACK retains a safe review snapshot and sample and replays the same operation', async () => {
  const entry = {
    ...binding(),
    activityId: randomUUID(),
    classId: randomUUID(),
  };
  const journal = await EvaluationJournal.load(
    join(directory, 'journal.json'),
    randomUUID(),
  );
  const client = makeClient(journal);
  const feedback = {
    ...unavailable(entry.attemptId),
    kind: 'FEEDBACK',
    hintLevel: null,
    presentationToken: randomUUID(),
    help: {
      diagnosis_code: 'FAILED_TEST',
      explanation: 'Resultado ficticio explicado.',
      hint: '',
      status: 'SUPPORTED',
      source_refs: [
        {
          source_id: randomUUID(),
          source_version_id: randomUUID(),
          chunk_id: randomUUID(),
          locator: 'Líneas 1–1',
        },
      ],
    },
  };
  const ref = feedback.help.source_refs[0];
  const attempt = {
    attemptId: entry.attemptId,
    activityId: entry.activityId,
    assignmentId: randomUUID(),
    exerciseVersionId: randomUUID(),
    code: 'module.exports.solve = n => n;',
    technicalResult: {
      diagnosisCode: 'FAILED_TEST',
      infrastructureStatus: 'OK',
      visibleTestResults: [
        { id: 'visible', passed: false, stdout: 'do not copy output' },
      ],
      hiddenTests: 'NEVER_EXPORT_PRIVATE_TESTS',
    },
  };
  const reference = {
    sourceId: ref.source_id,
    versionId: ref.source_version_id,
    chunkId: ref.chunk_id,
    title: 'Material ficticio',
    version: 1,
    fileName: 'fixture.txt',
    format: 'TXT',
    locator: ref.locator,
    text: 'return comunica un resultado.',
  };
  let ackCalls = 0;
  const keys = [];
  client.product = jest.fn(async (actorId, route, options = {}) => {
    expect(actorId).toBe(entry.actorId);
    if (route.endsWith('/feedback-requests')) {
      keys.push(options.key);
      return { id: feedback.requestId };
    }
    if (route.startsWith('/feedback-requests/'))
      return {
        state: 'SUCCEEDED',
        feedbackId: feedback.id,
        createdAt: '2026-10-01T00:00:00Z',
        completedAt: '2026-10-01T00:00:01Z',
        errorCode: null,
      };
    if (route === `/feedback/${feedback.id}`) return feedback;
    if (route === `/attempts/${entry.attemptId}`) return attempt;
    if (route.startsWith('/activities/'))
      return {
        organizationId: entry.organizationId,
        classId: entry.classId,
        activityId: entry.activityId,
        exerciseVersionId: attempt.exerciseVersionId,
        title: 'Doble',
        statement: 'Devuelve el doble.',
        concepts: [{ name: 'Funciones', description: 'Retorno' }],
        hiddenTests: 'NEVER_EXPORT_PRIVATE_TESTS',
      };
    if (route.endsWith(`/sources/${ref.chunk_id}`)) return reference;
    if (route.endsWith('/viewed')) {
      if (++ackCalls === 1)
        throw new TypeError('private ambiguous ACK message');
      return feedback;
    }
    throw new Error('Unexpected product request');
  });
  await expect(
    client.help(entry, 'FEEDBACK', null, { captureReview: true }),
  ).rejects.toThrow('private ambiguous ACK message');
  const saved = JSON.parse(await readFile(journal.path, 'utf8'));
  expect(saved.samples).toHaveLength(1);
  expect(saved.samples[0]).toMatchObject({
    status: 'SUPPORTED',
    verificationComplete: false,
    verificationErrors: [{ code: 'EVALUATION_OPERATION_FAILED' }],
  });
  expect(saved.reviewSnapshots[feedback.id]).toMatchObject({
    response: feedback.help,
    context: { code: attempt.code, statement: 'Devuelve el doble.' },
    references: [reference],
  });
  expect(JSON.stringify(saved)).not.toMatch(
    /NEVER_EXPORT_PRIVATE_TESTS|presentationToken|private ambiguous ACK|do not copy output/,
  );
  await client.help(entry, 'FEEDBACK', null, { captureReview: true });
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(journal.value.samples).toHaveLength(1);
  expect(journal.value.samples[0].verificationComplete).toBe(true);
  expect(journal.value.samples[0].verificationErrors).toHaveLength(1);
  expect(Number.isFinite(saved.samples[0].clientMs)).toBe(true);
  expect(journal.value.samples[0].clientMs).toBe(saved.samples[0].clientMs);
  expect(journal.value.samples[0].firstDispatchedAt).toBe(
    saved.samples[0].firstDispatchedAt,
  );
  expect(journal.value.samples[0].clientObservation).toBe('COMPLETE');
});

const candidate = () => ({
  profile: 'candidate',
  binding: {
    reviewCase: {
      caseId: 'fixture-review',
      expected: 'REJECT',
      boundaryExpected: false,
    },
  },
});
test('internal REVIEW stays pending until an authoritative terminal verdict is available', async () => {
  const journal = await EvaluationJournal.load(
    join(directory, 'journal.json'),
    randomUUID(),
  );
  const result = {
    expected: 'REJECT',
    actual: 'REJECT',
    boundaryRejected: false,
    passed: true,
    reviewCallId: randomUUID(),
  };
  const client = {
    operations: jest
      .fn()
      .mockResolvedValueOnce({
        state: 'RUNNING',
        cases: [
          {
            caseId: 'fixture-review',
            stage: 'EVALUATION',
            state: 'RUNNING',
            result: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        state: 'RUNNING',
        cases: [
          {
            caseId: 'fixture-review',
            stage: 'EVALUATION',
            state: 'SUCCEEDED',
            result,
          },
        ],
      }),
    poll: async (check) => {
      expect(await check()).toBeNull();
      expect(journal.value.reviewCases[0]).toMatchObject({
        state: 'RUNNING',
        passed: false,
      });
      expect(await check()).toBe(true);
    },
  };
  await verifyReviewCases({
    prepared: { cases: [candidate()] },
    journal,
    client,
  });
  expect(journal.value.reviewCases[0]).toMatchObject({
    state: 'SUCCEEDED',
    actual: 'REJECT',
    passed: true,
    reviewCallId: result.reviewCallId,
  });
});

test.each([
  ['FAILED', null, 'REVIEW_CASE_FAILED'],
  [
    'SUCCEEDED',
    {
      expected: 'REJECT',
      actual: 'ACCEPT',
      boundaryRejected: false,
      passed: true,
      reviewCallId: randomUUID(),
    },
    'REVIEW_VERDICT_MISMATCH',
  ],
  [
    'SUCCEEDED',
    {
      expected: 'REJECT',
      actual: 'REJECT',
      boundaryRejected: true,
      passed: true,
      reviewCallId: null,
    },
    'REVIEW_VERDICT_MISMATCH',
  ],
])(
  'internal REVIEW state %s cannot conceal a failed or inconsistent verdict',
  async (state, result, code) => {
    const journal = await EvaluationJournal.load(
      join(directory, 'journal.json'),
      randomUUID(),
    );
    await expect(
      verifyReviewCases({
        prepared: { cases: [candidate()] },
        journal,
        client: {
          operations: async () => ({
            state: 'RUNNING',
            cases: [
              { caseId: 'fixture-review', stage: 'EVALUATION', state, result },
            ],
          }),
          poll: async (check) => check(),
        },
      }),
    ).rejects.toMatchObject({ code });
    expect(
      JSON.parse(await readFile(journal.path, 'utf8')).reviewCases[0],
    ).toMatchObject({ state, passed: false });
  },
);

test('a failed latency profile writes its partial report and releases the journal without claiming completion', async () => {
  const runId = randomUUID();
  await privateJson(join(directory, 'capability.json'), {
    runId,
    capability: 'fixture-only',
  });
  await privateJson(join(directory, 'sessions.json'), { actors: {} });
  jest
    .spyOn(EvaluationClient.prototype, 'operations')
    .mockResolvedValue({ state: 'RUNNING', cases: [] });
  jest.spyOn(EvaluationClient.prototype, 'receipts').mockResolvedValue([]);
  const help = jest
    .spyOn(EvaluationClient.prototype, 'help')
    .mockImplementation(async function (
      _binding,
      kind,
      hintLevel,
      { profile },
    ) {
      const sample = {
        requestId: randomUUID(),
        feedbackId: randomUUID(),
        kind,
        hintLevel,
        profile,
        status: 'PROVIDER_UNAVAILABLE',
        admissionToPersistedMs: 400,
        clientMs: 405,
      };
      this.journal.value.samples.push(sample);
      await this.journal.save();
      return sample;
    });
  const prepared = {
    runId,
    corpusHash: 'a'.repeat(64),
    cases: Array.from({ length: 25 }, () => ({
      profile: 'serial',
      binding: binding(),
    })),
  };
  await expect(
    runEvaluation({
      plan: { provider: 'TEST', destination: {}, profiles: {} },
      prepared,
      directory,
      stages: ['EVALUATION'],
    }),
  ).rejects.toMatchObject({ code: 'LATENCY_HELP_FALLBACK' });
  const report = JSON.parse(
    await readFile(join(directory, 'report.json'), 'utf8'),
  );
  expect(report.stages.EVALUATION.state).toBe('FAILED');
  expect(report.failures).toEqual([
    expect.objectContaining({
      stage: 'EVALUATION',
      code: 'LATENCY_HELP_FALLBACK',
    }),
  ]);
  expect(report.samples).toHaveLength(1);
  expect(report.profiles[0]).toMatchObject({
    count: 1,
    fallbacks: 1,
    belowDocumentaryTarget: false,
  });
  expect(report.observedCostMicroUsd).toBeNull();
  expect(help).toHaveBeenCalledTimes(1);
  await expect(
    readFile(join(directory, 'run-journal.json.lock')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});

test('a grouped diagnostic exercises FEEDBACK and each permitted HINT and preserves all four oracles on a later profile failure', async () => {
  const runId = randomUUID();
  await privateJson(join(directory, 'capability.json'), {
    runId,
    capability: 'fixture-only',
  });
  await privateJson(join(directory, 'sessions.json'), { actors: {} });
  jest
    .spyOn(EvaluationClient.prototype, 'operations')
    .mockResolvedValue({ state: 'RUNNING', cases: [] });
  jest.spyOn(EvaluationClient.prototype, 'receipts').mockResolvedValue([]);
  const requests = [null, 1, 2, 3].map((hintLevel) => ({
    kind: hintLevel ? 'HINT' : 'FEEDBACK',
    hintLevel,
    oracle: {
      caseId: `fixture-${hintLevel ?? 'feedback'}`,
      expected: { status: 'SUPPORTED' },
      forbidden: [],
    },
  }));
  const help = jest
    .spyOn(EvaluationClient.prototype, 'help')
    .mockImplementation(async function (
      _binding,
      kind,
      hintLevel,
      { profile, captureReview },
    ) {
      expect(captureReview).toBe(true);
      const sample = {
        requestId: randomUUID(),
        feedbackId: randomUUID(),
        kind,
        hintLevel,
        profile,
        diagnosis: 'FAILED_TEST',
        status:
          profile === 'adversarial' ? 'SUPPORTED' : 'PROVIDER_UNAVAILABLE',
        admissionToPersistedMs: 100,
        clientMs: 110,
      };
      this.journal.value.samples.push(sample);
      await this.journal.save();
      return sample;
    });
  const prepared = {
    runId,
    corpusHash: 'a'.repeat(64),
    cases: [
      {
        profile: 'adversarial',
        binding: binding(),
        expectedDiagnosis: 'FAILED_TEST',
        helpRequests: requests,
      },
      ...Array.from({ length: 25 }, () => ({
        profile: 'serial',
        binding: binding(),
      })),
    ],
  };
  await expect(
    runEvaluation({
      plan: { provider: 'TEST', destination: {}, profiles: {} },
      prepared,
      directory,
      stages: ['EVALUATION'],
    }),
  ).rejects.toMatchObject({ code: 'LATENCY_HELP_FALLBACK' });
  expect(
    help.mock.calls
      .slice(0, 4)
      .map(([, kind, hintLevel]) => ({ kind, hintLevel })),
  ).toEqual(requests.map(({ kind, hintLevel }) => ({ kind, hintLevel })));
  const report = JSON.parse(
    await readFile(join(directory, 'report.json'), 'utf8'),
  );
  expect(report.samples).toHaveLength(5);
  expect(report.oracles.map((item) => item.caseId)).toEqual(
    requests.map((item) => item.oracle.caseId),
  );
  expect(
    report.oracles.every(
      (item) =>
        item.diagnosisPreserved &&
        item.semanticEvaluation === 'NOT_ESTABLISHED',
    ),
  ).toBe(true);
});
