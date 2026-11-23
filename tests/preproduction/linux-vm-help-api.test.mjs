import { describe, it, expect, jest } from '@jest/globals';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const {
  scopesFor,
  faultForAttempt,
  createProofGuard,
  createEmbeddings,
  guardedFactory,
  assertStartup,
  closePoolAfterHttp,
  createStartupReporter,
  loadTestProviders,
} = require('../integration/linux-vm-help-api.cjs');
const { observedCall } = require('../help-fault-observer.cjs');
const { testHelpFactory } = require('../help-providers.cjs');
const { loadConfig } = require('../../apps/api/dist/config.js');
const id = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = 'a'.repeat(64);
describe('safe physical TEST startup observations', () => {
  it('loads the real provider doubles from the new harness, independently of frozen application artifacts', () => {
    const loaded = loadTestProviders();
    expect(loaded.testHelpFactory).toBe(testHelpFactory);
    expect(loaded.observedCall).toBe(observedCall);
    const embeddings = createEmbeddings(loaded.observedCall);
    const help = loaded.testHelpFactory(embeddings, () => null)();
    expect(help.configurationId).toBe('help-fixture-v1');
    expect(typeof help.generation.generate).toBe('function');
  });
  it('reports fixed stages, original failure type and code once without error messages, paths, stacks or credentials', () => {
    const records = [];
    const startup = createStartupReporter((row) => records.push(row));
    startup.mark('ARTIFACT_IMPORTS');
    startup.mark('TEST_HELPER_IMPORTS');
    const failure = Object.assign(
      new Error('private:/path?password=do-not-log'),
      { code: 'MODULE_NOT_FOUND' },
    );
    startup.failed(failure);
    startup.mark('CLEANUP');
    startup.failed(new Error('replacement error must not hide original'));
    expect(
      records.filter((row) => row.event === 'PHYSICAL_HELP_API_STARTUP_FAILED'),
    ).toEqual([
      {
        event: 'PHYSICAL_HELP_API_STARTUP_FAILED',
        stage: 'TEST_HELPER_IMPORTS',
        code: 'ARTIFACT_MODULE_MISSING',
        errorType: 'Error',
      },
    ]);
    expect(JSON.stringify(records)).not.toMatch(
      /private|password|replacement|do-not-log/,
    );
  });
  it.each([
    [new TypeError('private value'), 'STARTUP_FAILED', 'TypeError'],
    [new SyntaxError('private JSON'), 'INVALID_JSON_OR_MODULE', 'SyntaxError'],
    [new Error('HELP_TEST_CONFIGURATION'), 'HELP_TEST_CONFIGURATION', 'Error'],
    [
      Object.assign(new Error('private SQL'), { code: '28P01' }),
      'DATABASE_AUTH_FAILED',
      'Error',
    ],
    [
      Object.assign(new Error('private config'), { code: '25006' }),
      'DATABASE_READ_ONLY_REJECTED',
      'Error',
    ],
    [
      {
        message: 'SECRET_WITH_UNSAFE_CODE',
        code: 'SECRET',
        constructor: { name: 'SECRET' },
      },
      'STARTUP_FAILED',
      'OTHER_ERROR',
    ],
  ])(
    'classifies an error with only allowlisted metadata',
    (error, code, errorType) => {
      const write = jest.fn();
      const startup = createStartupReporter(write);
      startup.mark('CREATE_APP');
      startup.failed(error);
      expect(write).toHaveBeenLastCalledWith({
        event: 'PHYSICAL_HELP_API_STARTUP_FAILED',
        stage: 'CREATE_APP',
        code,
        errorType,
      });
    },
  );
  it('refuses arbitrary stage strings and keeps logger failures outside startup behavior', () => {
    const write = jest.fn();
    expect(() => createStartupReporter(write).mark('PRIVATE_CONFIG')).toThrow(
      'HELP_STARTUP_STAGE_INVALID',
    );
    expect(write).not.toHaveBeenCalled();
    const startup = createStartupReporter(() => {
      throw new Error('sink unavailable');
    });
    expect(() => startup.mark('READ_ONLY')).not.toThrow();
    expect(() =>
      startup.failed(new Error('HELP_READ_ONLY_REQUIRED')),
    ).not.toThrow();
  });
});
const manifest = {
  campaignId: id(1),
  profile: 'PHYSICAL_HELP_TEST',
  brokerSocket: '/run/user/1000/help.sock',
  endpoints: { api: 'http://127.0.0.1:4300', auth: 'http://127.0.0.1:18421' },
  candidate: {
    runnerVersion: 'imp-03-quickjs.13',
    capsuleImageId: 'sha256:' + hash,
    kitManifestSha256: hash,
    guestSha256: hash,
  },
};
const scope = () => ({
  scope: 'H03',
  actorId: id(2),
  organizationId: id(3),
  classId: id(4),
  activityId: id(5),
  assignmentId: id(6),
  exerciseVersionId: id(7),
  attemptIds: [id(8)],
});
const registry = () => ({ campaignId: id(1), scopes: [scope()] });
const context = () => ({
  attemptId: id(8),
  exerciseVersionId: id(7),
  diagnosisCode: 'FAILED_TEST',
  code: 'never-log-this-private-code',
});
const proof = (phase = 'GENERATION') => ({
  ...scope(),
  attemptId: id(8),
  requestId: id(9),
  executionId: id(10),
  lifecycleStatus: 'RUNNING',
  callState: 'DISPATCHED',
  phase,
  diagnosisCode: 'FAILED_TEST',
  ordered: true,
  codeSha256: hash,
  resultSha256: hash,
  privateResultsSha256: hash,
  privateResultRows: 1,
  submittedEvents: 1,
  completedEvents: 1,
});
function guardFixture(rows = [proof()], scopes = registry()) {
  const query = jest.fn(async () => ({ rows }));
  const release = jest.fn();
  const pool = { connect: jest.fn(async () => ({ query, release })) };
  const append = jest.fn(async () => undefined);
  return {
    pool,
    query,
    release,
    append,
    guard: createProofGuard({
      manifest,
      pool,
      readScopes: () => scopes,
      append,
      now: () => '2026-11-18T12:00:00.000Z',
    }),
  };
}
function providers(guard, control = () => null) {
  const embeddings = createEmbeddings(observedCall);
  return {
    embeddings,
    help: guardedFactory({
      embeddings,
      observedCall,
      testHelpFactory,
      control,
      guard,
    })(),
  };
}
const input = () => ({
  context: context(),
  kind: 'FEEDBACK',
  hintLevel: null,
  chunks: [
    {
      source_id: id(11),
      source_version_id: id(12),
      chunk_id: id(13),
      locator: 'L1',
    },
  ],
});
function config() {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 4300,
    databaseUrl: 'postgresql://alunza_app:fixture@127.0.0.1:18422/postgres',
    jwtIssuer: manifest.endpoints.auth + '/auth/v1',
    jwksUrl: manifest.endpoints.auth + '/auth/v1/.well-known/jwks.json',
    supabaseUrl: manifest.endpoints.auth,
    helpWorkerEnabled: true,
    materialsWorkerEnabled: true,
    signalsWorkerEnabled: false,
    practiceRunnerEnabled: true,
    practiceRunnerProvider: 'local-vm',
    azureEmbeddingConfiguration: null,
    azureGenerationConfiguration: null,
    evaluation: { enabled: false, operationsPort: 4401 },
    localVmConfiguration: {
      provider: 'local-vm',
      runnerVersion: manifest.candidate.runnerVersion,
      image: manifest.candidate.capsuleImageId,
      kitManifestSha256: hash,
      guestSha256: hash,
      socketPath: manifest.brokerSocket,
    },
    practiceQuotas: {
      actorConcurrency: 1,
      submitActorConcurrency: 2,
      organizationConcurrency: 4,
      actorRequestsPerMinute: 10,
    },
  };
}
describe('physical help TEST API: persistence before provider, no network', () => {
  it('reads a separately acquired connection before every phase and records only safe committed evidence', async () => {
    for (const phase of ['EMBEDDING', 'GENERATION', 'REVIEW']) {
      const f = guardFixture([proof(phase)]);
      await f.guard(
        phase,
        phase === 'EMBEDDING' ? null : context(),
        new AbortController().signal,
      );
      expect(f.pool.connect).toHaveBeenCalledTimes(1);
      expect(f.query.mock.calls[0][1]).toEqual([
        [id(8)],
        phase,
        phase === 'EMBEDDING' ? null : id(8),
      ]);
      expect(f.release).toHaveBeenCalledTimes(1);
      expect(f.append).toHaveBeenCalledWith(
        expect.objectContaining({
          campaignId: id(1),
          scope: 'H03',
          requestId: id(9),
          attemptId: id(8),
          phase,
          pass: true,
          committed: true,
          submittedEvents: 1,
          completedEvents: 1,
        }),
      );
      expect(JSON.stringify(f.append.mock.calls)).not.toContain(context().code);
      expect(f.append.mock.calls[0][0]).not.toHaveProperty('diagnosisCode');
      expect(f.query.mock.calls[0][0]).toMatch(/^select /);
    }
  });
  it.each([
    ['missing committed attempt', []],
    ['ambiguous help request', [proof(), { ...proof(), requestId: id(90) }]],
    ['missing completion', [{ ...proof(), completedEvents: 0 }]],
    ['duplicate submission', [{ ...proof(), submittedEvents: 2 }]],
    ['missing private result', [{ ...proof(), privateResultRows: 0 }]],
    ['wrong actor', [{ ...proof(), actorId: id(91) }]],
    ['wrong class', [{ ...proof(), classId: id(91) }]],
    ['wrong organization', [{ ...proof(), organizationId: id(91) }]],
    ['unstarted phase', [{ ...proof(), callState: 'PLANNED' }]],
    ['late or unordered', [{ ...proof(), ordered: false }]],
  ])(
    'blocks generation for %s without dispatching the provider',
    async (_name, rows) => {
      const f = guardFixture(rows);
      const control = jest.fn(() => null);
      const observer = jest.fn();
      await expect(
        providers(f.guard, control).help.generation.generate(
          input(),
          new AbortController().signal,
          observer,
        ),
      ).rejects.toThrow('HELP_PERSISTENCE_UNVERIFIED');
      expect(control).not.toHaveBeenCalled();
      expect(f.append).not.toHaveBeenCalled();
      expect(observer).toHaveBeenCalledTimes(1);
      expect(observer).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'GENERATION', outcome: 'ERROR' }),
      );
    },
  );
  it('rejects help before the attempt was registered as committed, without querying or calling provider', async () => {
    const f = guardFixture([proof()], {
      campaignId: id(1),
      scopes: [{ ...scope(), attemptIds: [] }],
    });
    const control = jest.fn(() => null);
    await expect(
      providers(f.guard, control).help.generation.generate(
        input(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('HELP_PERSISTENCE_UNVERIFIED');
    expect(f.pool.connect).not.toHaveBeenCalled();
    expect(control).not.toHaveBeenCalled();
  });
  it('rejects a shadow diagnosis and wrong exercise version before generation/review', async () => {
    for (const phase of ['GENERATION', 'REVIEW']) {
      for (const patch of [
        { diagnosisCode: 'SUCCESS' },
        { exerciseVersionId: id(99) },
      ]) {
        const f = guardFixture([proof(phase)]);
        const p = providers(f.guard).help;
        const value = { ...input(), context: { ...context(), ...patch } };
        const call =
          phase === 'GENERATION'
            ? p.generation.generate(value, new AbortController().signal)
            : p.verification.verify(value, {}, new AbortController().signal);
        await expect(call).rejects.toThrow('HELP_PERSISTENCE_UNVERIFIED');
        expect(f.append).not.toHaveBeenCalled();
      }
    }
  });
  it('keeps material ingestion independent of attempts but refuses help embeddings without proof', async () => {
    const f = guardFixture([]);
    const p = providers(f.guard);
    expect(
      await p.embeddings.embed(
        ['condición función'],
        new AbortController().signal,
      ),
    ).toEqual([[1, 1, 1]]);
    expect(f.pool.connect).not.toHaveBeenCalled();
    await expect(
      p.help.embeddings.embed(['query'], new AbortController().signal),
    ).rejects.toThrow('HELP_PERSISTENCE_UNVERIFIED');
  });
  it('preserves the provider result, canonical diagnosis and one settlement observer', async () => {
    const f = guardFixture();
    const observer = jest.fn();
    const result = await providers(f.guard).help.generation.generate(
      input(),
      new AbortController().signal,
      observer,
    );
    expect(result.candidate.diagnosis_code).toBe('FAILED_TEST');
    expect(result.candidate.status).toBe('SUPPORTED');
    expect(result.candidate.source_refs).toEqual(input().chunks);
    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'GENERATION', outcome: 'RESPONSE' }),
    );
  });
  it('stops provider dispatch if persistence query or evidence append fails and releases the connection', async () => {
    for (const stage of ['query', 'append']) {
      const f = guardFixture();
      f[stage].mockRejectedValue(new Error('private SQL/code diagnostic'));
      const control = jest.fn(() => null);
      await expect(
        providers(f.guard, control).help.generation.generate(
          input(),
          new AbortController().signal,
        ),
      ).rejects.toThrow('HELP_PERSISTENCE_UNVERIFIED');
      expect(f.release).toHaveBeenCalledTimes(1);
      expect(control).not.toHaveBeenCalled();
    }
  });
  it('does not invoke a provider after cancellation during the independent proof', async () => {
    const f = guardFixture();
    const abort = new AbortController();
    f.query.mockImplementation(async () => {
      abort.abort();
      return { rows: [proof()] };
    });
    const control = jest.fn(() => null);
    await expect(
      providers(f.guard, control).help.generation.generate(
        input(),
        abort.signal,
      ),
    ).rejects.toThrow('HELP_PERSISTENCE_UNVERIFIED');
    expect(control).not.toHaveBeenCalled();
    expect(f.append).not.toHaveBeenCalled();
  });
});
describe('campaign-scoped fault injection and startup', () => {
  const fault = () => ({
    campaignId: id(1),
    scope: 'H03',
    attemptId: id(8),
    scenario: 'generation-unavailable',
    expiresAt: '2026-11-18T12:01:00Z',
  });
  const now = Date.parse('2026-11-18T12:00:00Z');
  it('injects generation failure only for the exact owned attempt before expiry', () => {
    expect(faultForAttempt(manifest, fault(), registry(), id(8), now)).toEqual({
      scenario: 'generation-unavailable',
    });
    expect(
      faultForAttempt(manifest, fault(), registry(), id(9), now),
    ).toBeNull();
    expect(
      faultForAttempt(manifest, fault(), registry(), undefined, now),
    ).toBeNull();
    expect(
      faultForAttempt(
        manifest,
        fault(),
        registry(),
        id(8),
        Date.parse(fault().expiresAt),
      ),
    ).toBeNull();
    expect(
      faultForAttempt(
        manifest,
        { campaignId: id(1), disabled: true },
        registry(),
        id(8),
        now,
      ),
    ).toBeNull();
  });
  it.each([
    { campaignId: id(99) },
    { scope: 'H02' },
    { attemptId: id(99) },
    { scenario: 'deadline' },
    { expiresAt: 'invalid' },
  ])('rejects malformed, unrelated or unsupported fault %j', (patch) => {
    expect(() =>
      faultForAttempt(
        manifest,
        { ...fault(), ...patch },
        registry(),
        id(8),
        now,
      ),
    ).toThrow(/^HELP_/);
  });
  it('refuses duplicated attempt membership and foreign campaign scopes', () => {
    expect(() =>
      scopesFor(manifest, { campaignId: id(99), scopes: [] }),
    ).toThrow('HELP_SCOPES_IDENTITY');
    expect(() =>
      scopesFor(manifest, { campaignId: id(1), scopes: [scope(), scope()] }),
    ).toThrow('HELP_DUPLICATE_ATTEMPT');
  });
  it('permits the exact physical TEST setup with direct Storage and frozen local VM candidate', () => {
    expect(() => assertStartup(manifest, config())).not.toThrow();
  });
  it('accepts the real loadConfig disabled evaluation object without dropping TEST guards', () => {
    const value = config();
    const actual = loadConfig({
      ENVIRONMENT: 'test',
      HOST: value.host,
      PORT: String(value.port),
      APP_ORIGIN: 'http://127.0.0.1:3300',
      DATABASE_URL: value.databaseUrl,
      SUPABASE_URL: value.supabaseUrl,
      SUPABASE_JWT_ISSUER: value.jwtIssuer,
      SUPABASE_JWKS_URL: value.jwksUrl,
      SUPABASE_PUBLISHABLE_KEY: 'fixture-publishable',
      SUPABASE_SECRET_KEY: 'fixture-secret-not-a-credential',
      HELP_WORKER_ENABLED: 'true',
      MATERIALS_WORKER_ENABLED: 'true',
      PRACTICE_RUNNER_ENABLED: 'true',
      PRACTICE_RUNNER_PROVIDER: 'local-vm',
      PRACTICE_LOCAL_VM_IMAGE: manifest.candidate.capsuleImageId,
      PRACTICE_LOCAL_VM_HOST_ID: id(90),
      PRACTICE_LOCAL_VM_KIT_MANIFEST_SHA256: hash,
      PRACTICE_LOCAL_VM_GUEST_SHA256: hash,
      PRACTICE_LOCAL_VM_SOCKET: manifest.brokerSocket,
    });
    expect(actual.evaluation).toEqual({ enabled: false, operationsPort: 4401 });
    expect(() => assertStartup(manifest, actual)).not.toThrow();
  });
  it.each([
    { environment: 'production' },
    { host: '0.0.0.0' },
    { port: 4200 },
    { databaseUrl: 'postgresql://alunza_app:fixture@127.0.0.1:17422/postgres' },
    { supabaseUrl: 'http://127.0.0.1:18429' },
    { jwksUrl: 'https://remote.example/jwks' },
    { helpWorkerEnabled: false },
    { materialsWorkerEnabled: false },
    { practiceRunnerProvider: 'docker' },
    { azureGenerationConfiguration: { deployment: 'external' } },
    { evaluation: { enabled: true, operationsPort: 4401 } },
    { evaluation: { operationsPort: 4401 } },
    { evaluation: undefined },
    { practiceQuotas: { ...config().practiceQuotas, actorConcurrency: 2 } },
    {
      localVmConfiguration: {
        ...config().localVmConfiguration,
        guestSha256: 'b'.repeat(64),
      },
    },
  ])('rejects mismatched startup %j', (patch) => {
    expect(() => assertStartup(manifest, { ...config(), ...patch })).toThrow(
      'HELP_TEST_CONFIGURATION',
    );
  });
  it('closes the observer pool once when Nest closes HTTP after draining its workers', async () => {
    const server = new EventEmitter();
    const pool = { end: jest.fn(async () => undefined) };
    const close = closePoolAfterHttp({ getHttpServer: () => server }, pool);
    expect(pool.end).not.toHaveBeenCalled();
    server.emit('close');
    await close();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
