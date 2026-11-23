const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const adapters = [
  ['assay', 'AzureAiAdapter', 'azureConfigurationFromEnv'],
  [
    'embeddings',
    'AzureEmbeddingsAdapter',
    'azureEmbeddingConfigurationFromEnv',
  ],
  ['help', 'AzureHelpAdapter', 'azureGenerationConfigurationFromEnv'],
];

// Every case gets a fresh CommonJS cache and real SDK constructors. Network and
// credential subprocesses are forbidden; no token is requested or sent.
const probe = String.raw`
  const scenario = JSON.parse(process.argv[1]);
  let externalAttempts = 0;
  function forbiddenExternalOperation() {
    externalAttempts += 1;
    throw new Error('EXTERNAL_OPERATION_FORBIDDEN');
  }
  globalThis.fetch = forbiddenExternalOperation;
  require('node:net').Socket.prototype.connect = forbiddenExternalOperation;
  require('node:tls').connect = forbiddenExternalOperation;
  for (const moduleName of ['node:http', 'node:https']) {
    const transport = require(moduleName);
    transport.request = forbiddenExternalOperation;
    transport.get = forbiddenExternalOperation;
  }
  const processes = require('node:child_process');
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync'])
    processes[name] = forbiddenExternalOperation;

  const base = {
    baseURL: 'https://fixture.openai.azure.com/openai/v1/',
    configurationId: 'startup-test',
    authMode: scenario.authMode ?? 'api-key',
    ...(scenario.authMode && scenario.authMode !== 'api-key'
      ? scenario.authMode === 'managed-identity'
        ? { managedIdentityClientId: '11111111-1111-4111-8111-111111111111' }
        : {}
      : { apiKey: 'fictitious-startup-key' }),
  };
  const embedding = {
    embeddingDeployment: 'embedding-deployment',
    embeddingModel: 'text-embedding-3-small',
    dimensions: 3,
  };
  const generation = {
    generationDeployment: 'generation-deployment',
    generationModel: 'gpt-4.1-mini-2025-04-14',
  };
  const configurations = {
    assay: { ...base, ...embedding, ...generation },
    embeddings: { ...base, ...embedding },
    help: {
      ...base,
      ...generation,
      verificationDeployment: generation.generationDeployment,
      verificationModel: generation.generationModel,
      tokenizer: 'o200k_base',
    },
  };
  function rejectedConfiguration(action) {
    try {
      action();
      return false;
    } catch (error) {
      return error.message === 'INVALID_CONFIGURATION';
    }
  }
  function sdkLoaded(name) {
    const segment = '/node_modules/' + name + '/';
    return Object.keys(require.cache).some((file) =>
      file.replaceAll('\\', '/').includes(segment),
    );
  }
  let completed = false;
  let constructed = false;
  let rejected = [];
  try {
    const ai = require('@alunza/ai');
    if (scenario.operation === 'reject') {
      rejected = [
        rejectedConfiguration(() => new ai[scenario.adapter]({
          ...configurations[scenario.kind],
          baseURL: 'http://fixture.openai.azure.com/openai/v1/',
        })),
        rejectedConfiguration(() => ai[scenario.fromEnv]({})),
      ];
    } else if (scenario.operation === 'construct') {
      const instance = new ai[scenario.adapter](configurations[scenario.kind]);
      constructed = instance instanceof ai[scenario.adapter];
    }
    completed = true;
  } catch {
    // Never forward SDK errors, constructor arguments or inherited environment.
  }
  process.stdout.write(JSON.stringify({
    completed,
    constructed,
    rejected,
    openaiLoaded: sdkLoaded('openai'),
    identityLoaded: sdkLoaded('@azure/identity'),
    externalAttempts,
  }));
`;

function inspectFreshProcess(scenario) {
  const environment = {};
  for (const name of [
    'PATH',
    'SystemRoot',
    'USERPROFILE',
    'HOME',
    'TEMP',
    'TMP',
  ])
    if (process.env[name]) environment[name] = process.env[name];
  const result = spawnSync(
    process.execPath,
    ['-e', probe, JSON.stringify(scenario)],
    {
      cwd: root,
      env: environment,
      windowsHide: true,
      encoding: 'utf8',
      // A deadlock watchdog only: assertions concern dependency loading, not time.
      timeout: 30_000,
      maxBuffer: 64 * 1024,
    },
  );
  expect({
    exitCode: result.status,
    signal: result.signal,
    failedToRun: Boolean(result.error),
    stderrEmpty: result.stderr?.length === 0,
  }).toEqual({
    exitCode: 0,
    signal: null,
    failedToRun: false,
    stderrEmpty: true,
  });
  let observation;
  try {
    observation = JSON.parse(result.stdout);
  } catch {
    throw new Error('The startup probe did not return its safe observation.');
  }
  expect(observation.completed).toBe(true);
  expect(observation.externalAttempts).toBe(0);
  return observation;
}

describe('U/R startup · provider dependencies in fresh Node processes', () => {
  test('importing the public AI package loads neither provider SDK', () => {
    expect(inspectFreshProcess({ operation: 'import' })).toMatchObject({
      openaiLoaded: false,
      identityLoaded: false,
    });
  });

  test.each(adapters)(
    '%s rejects constructor and environment configuration before loading either SDK',
    (kind, adapter, fromEnv) => {
      expect(
        inspectFreshProcess({ operation: 'reject', kind, adapter, fromEnv }),
      ).toMatchObject({
        rejected: [true, true],
        openaiLoaded: false,
        identityLoaded: false,
      });
    },
  );

  test.each(adapters)(
    '%s constructs the real api-key SDK without loading Azure identity',
    (kind, adapter) => {
      expect(
        inspectFreshProcess({
          operation: 'construct',
          kind,
          adapter,
          authMode: 'api-key',
        }),
      ).toMatchObject({
        constructed: true,
        openaiLoaded: true,
        identityLoaded: false,
      });
    },
  );

  test.each(
    adapters.flatMap(([kind, adapter]) =>
      ['azure-cli', 'managed-identity'].map((authMode) => [
        kind,
        authMode,
        adapter,
      ]),
    ),
  )(
    '%s preserves %s credential construction without external operations',
    (kind, authMode, adapter) => {
      expect(
        inspectFreshProcess({
          operation: 'construct',
          kind,
          adapter,
          authMode,
        }),
      ).toMatchObject({
        constructed: true,
        openaiLoaded: true,
        identityLoaded: true,
      });
    },
  );
});
