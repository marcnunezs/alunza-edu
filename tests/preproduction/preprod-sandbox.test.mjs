import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { publicParameters } from '../../scripts/preprod.mjs';
import * as manifests from '../../scripts/preprod-manifest.mjs';
import { validateCampaign } from '../../scripts/sandbox-campaign.mjs';
import { preparedManifest } from './fixture.mjs';

const now = Date.parse('2026-11-04T12:00:00Z');
const scriptUrl = new URL('../../scripts/preprod.mjs', import.meta.url);
const privateMarker = 'FICTITIOUS_PRIVATE_VALUE_NEVER_SENT';

function preparedCampaign(manifest) {
  return {
    schemaVersion: 1,
    campaignId: '49364c2d-b51a-4ccc-bdb4-8c9300adab26',
    environment: 'preproduction',
    authorized: true,
    expiresAt: new Date(now + 600000).toISOString(),
    ...manifest.targets.sandbox,
    runnerVersion: 'imp-03-quickjs.9',
    maxCreations: 1,
    maxRequests: 36,
    maxCost: 1,
    currency: 'USD',
    candidate: { commit: manifest.release.sha, sourceDigest: 'b'.repeat(64) },
    approval: {
      approvedBy: 'FICTITIOUS_TEST_ACTOR',
      reference: 'UNIT_TEST_ONLY',
      approvedAt: new Date(now - 600000).toISOString(),
    },
    rates: null,
    stages: [
      {
        id: 'unit-fixture',
        kind: 'capsule',
        enabled: true,
        fixtures: ['sync-json-success'],
        creations: 1,
        maxRequests: 36,
        maxDurationSeconds: 40,
      },
    ],
  };
}

// Exercise the actual CLI module with in-memory filesystem and bootstrap seams.
// No report, parameter file, credentials or remote resource is touched by this test.
async function runCli(manifest, campaign, flags, command = 'plan') {
  const files = new Map();
  const argv = [
    'node',
    fileURLToPath(scriptUrl),
    command,
    '/fixture/manifest.json',
    ...flags,
  ];
  const process = { argv, exitCode: 0 };
  let finish;
  const completed = new Promise((resolve) => {
    finish = resolve;
  });
  const messages = [];
  const console = {
    log: (...args) => {
      messages.push(args.join(' '));
      if (args[0].startsWith('Preparación ')) finish();
    },
    error: (...args) => {
      messages.push(args.join(' '));
      finish();
    },
  };
  const prepareBootstrap = jest.fn(async () => {});
  const loadCampaign = jest.fn(async (path) => {
    if (path !== '/fixture/campaign.json') throw new Error(privateMarker);
    return validateCampaign(globalThis.structuredClone(campaign));
  });
  const imports = {
    'node:fs/promises': {
      mkdir: async () => {},
      access: async () => {},
      writeFile: async (path, value) => {
        files.set(path, value);
      },
    },
    'node:path': { dirname, join, resolve },
    'node:url': { fileURLToPath },
    './preprod-bootstrap.mjs': { prepareBootstrap },
    './preprod-manifest.mjs': {
      ...manifests,
      loadManifest: async () =>
        manifests.validateManifest(globalThis.structuredClone(manifest)),
    },
    './sandbox-campaign.mjs': { validateCampaign, loadCampaign },
  };
  const context = createContext({ process, console, Date });
  const module = new SourceTextModule(await readFile(scriptUrl, 'utf8'), {
    context,
    initializeImportMeta(meta) {
      meta.url = scriptUrl.href;
    },
  });
  await module.link((specifier) => {
    const values = imports[specifier];
    if (!values) throw new Error(`Unexpected CLI dependency: ${specifier}`);
    return new SyntheticModule(
      Object.keys(values),
      function () {
        for (const [key, value] of Object.entries(values))
          this.setExport(key, value);
      },
      { context },
    );
  });
  await module.evaluate();
  await completed;
  const parameterFile = [...files.entries()].find(([path]) =>
    path.endsWith('parameters.public.json'),
  );
  return {
    exitCode: process.exitCode,
    parameters: parameterFile
      ? JSON.parse(parameterFile[1]).parameters
      : undefined,
    messages: messages.join('\n'),
    files,
    prepareBootstrap,
    loadCampaign,
  };
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('Sandbox public deployment parameters (local rendering only)', () => {
  test('default preparation keeps admission and recovery disabled', async () => {
    const manifest = await preparedManifest();
    expect(publicParameters(manifest).parameters).toMatchObject({
      practiceRunnerEnabled: { value: false },
      sandboxRecoveryEnabled: { value: false },
      practiceRunnerProvider: { value: 'docker' },
      deployWorkloads: { value: false },
      rolloutId: { value: '' },
    });
  });

  test('an approved exact candidate and destination can render admissions with an explicit rollout', async () => {
    const manifest = await preparedManifest();
    const campaign = preparedCampaign(manifest);
    expect(
      publicParameters(manifest, true, {
        campaign,
        enableAdmissions: true,
        enableRecovery: true,
        rolloutId: 'recover1',
      }).parameters,
    ).toMatchObject({
      practiceRunnerEnabled: { value: true },
      sandboxRecoveryEnabled: { value: true },
      practiceRunnerProvider: { value: 'vercel' },
      rolloutId: { value: 'recover1' },
      releaseId: { value: manifest.release.sha },
      apiImage: { value: manifest.release.apiImage },
      sandboxTeamId: { value: campaign.teamId },
      sandboxProjectId: { value: campaign.projectId },
      sandboxRegion: { value: campaign.region },
      sandboxImage: { value: campaign.image },
    });
  });

  const incomplete = [
    [
      'not authorized',
      (c) => {
        c.authorized = false;
      },
    ],
    [
      'no approver',
      (c) => {
        c.approval.approvedBy = null;
      },
    ],
    [
      'no approval reference',
      (c) => {
        c.approval.reference = null;
      },
    ],
    [
      'no approval date',
      (c) => {
        c.approval.approvedAt = null;
      },
    ],
    [
      'future approval',
      (c) => {
        c.approval.approvedAt = new Date(now + 1).toISOString();
      },
    ],
    [
      'no expiry',
      (c) => {
        c.expiresAt = null;
      },
    ],
    [
      'no source identity',
      (c) => {
        c.candidate.sourceDigest = null;
      },
    ],
    [
      'no cost budget',
      (c) => {
        c.maxCost = 0;
      },
    ],
    [
      'no creation quota',
      (c) => {
        c.maxCreations = 0;
      },
    ],
    [
      'no normal request quota after cleanup reserve',
      (c) => {
        c.maxRequests = 8;
      },
    ],
    [
      'request quota below runtime minimum',
      (c) => {
        c.maxRequests = 9;
      },
    ],
    [
      'creation quota above runtime maximum',
      (c) => {
        c.maxCreations = 10001;
        c.maxRequests = 100000;
      },
    ],
    [
      'runner version above runtime maximum',
      (c) => {
        c.runnerVersion = 'v'.repeat(101);
      },
    ],
    [
      'approver above runtime maximum',
      (c) => {
        c.approval.approvedBy = 'a'.repeat(101);
      },
    ],
  ];
  describe.each(['enableAdmissions', 'enableRecovery'])(
    '%s authorization',
    (mode) => {
      test.each(incomplete)(
        'rejects %s before rendering enabled parameters',
        async (_label, change) => {
          const manifest = await preparedManifest();
          const campaign = preparedCampaign(manifest);
          change(campaign);
          expect(() =>
            publicParameters(manifest, true, { campaign, [mode]: true }),
          ).toThrow();
        },
      );
      test('requires a campaign', async () => {
        const manifest = await preparedManifest();
        expect(() =>
          publicParameters(manifest, true, { [mode]: true }),
        ).toThrow();
      });
    },
  );

  test.each(['disabled', 'expired', 'not-permitted', 'no-image', 'no-budget'])(
    'workload deployment rejects Azure authorization %s',
    async (condition) => {
      const manifest = await preparedManifest();
      const campaign = preparedCampaign(manifest);
      if (condition === 'disabled') manifest.remote.enabled = false;
      if (condition === 'expired')
        manifest.remote.expiresAt = new Date(now).toISOString();
      if (condition === 'not-permitted')
        manifest.remote.allowedOperations = ['probe:sandbox'];
      if (condition === 'no-image') manifest.release.apiImage = null;
      if (condition === 'no-budget') manifest.budget.maxCost = 0;
      expect(() =>
        publicParameters(manifest, true, { campaign, enableAdmissions: true }),
      ).toThrow();
      expect(() =>
        publicParameters(manifest, true, { campaign, enableRecovery: true }),
      ).toThrow();
    },
  );

  test('admission cannot be enabled for foundation-only preparation', async () => {
    const manifest = await preparedManifest();
    expect(() =>
      publicParameters(manifest, false, {
        campaign: preparedCampaign(manifest),
        enableAdmissions: true,
      }),
    ).toThrow();
  });

  test('expired campaign can recover with admissions disabled and unchanged identity/budget', async () => {
    const manifest = await preparedManifest();
    const campaign = preparedCampaign(manifest);
    campaign.expiresAt = new Date(now).toISOString();
    const original = globalThis.structuredClone(campaign);
    const output = publicParameters(manifest, true, {
      campaign,
      enableRecovery: true,
    });
    expect(output.parameters.practiceRunnerEnabled.value).toBe(false);
    expect(output.parameters.sandboxRecoveryEnabled.value).toBe(true);
    expect(output.parameters.practiceRunnerProvider.value).toBe('vercel');
    expect(campaign).toEqual(original);
    expect(() =>
      publicParameters(manifest, true, {
        campaign,
        enableAdmissions: true,
        enableRecovery: true,
      }),
    ).toThrow();
  });

  test('recovery rejects an expiry that predates approval', async () => {
    const manifest = await preparedManifest();
    const campaign = preparedCampaign(manifest);
    campaign.expiresAt = campaign.approval.approvedAt;
    expect(() =>
      publicParameters(manifest, true, { campaign, enableRecovery: true }),
    ).toThrow();
  });

  test('different candidate commit cannot render either operating mode', async () => {
    const manifest = await preparedManifest();
    const campaign = preparedCampaign(manifest);
    campaign.candidate.commit = 'f'.repeat(40);
    for (const mode of ['enableAdmissions', 'enableRecovery'])
      expect(() =>
        publicParameters(manifest, true, { campaign, [mode]: true }),
      ).toThrow();
  });

  test.each([
    ['teamId', 'team_other'],
    ['projectId', 'prj_other'],
    ['region', 'sfo1'],
    ['image', `vcr.example/other@sha256:${'c'.repeat(64)}`],
  ])(
    'campaign cannot replace the declared %s or authorize a missing destination',
    async (field, other) => {
      const manifest = await preparedManifest();
      const campaign = preparedCampaign(manifest);
      campaign[field] = other;
      for (const mode of ['enableAdmissions', 'enableRecovery'])
        expect(() =>
          publicParameters(manifest, true, { campaign, [mode]: true }),
        ).toThrow();
      campaign[field] = manifest.targets.sandbox[field];
      manifest.targets.sandbox[field] = null;
      expect(() =>
        publicParameters(manifest, true, { campaign, enableRecovery: true }),
      ).toThrow();
      expect(() => publicParameters(manifest, false, { campaign })).toThrow();
    },
  );

  test.each(['UPPER', 'a-b', '../path', 'ninechars', 123])(
    'rejects rollout %p',
    async (rolloutId) => {
      const manifest = await preparedManifest();
      expect(() => publicParameters(manifest, false, { rolloutId })).toThrow();
    },
  );

  test('public parameters are an allowlist and do not serialize private campaign configuration', async () => {
    const manifest = await preparedManifest();
    const campaign = preparedCampaign(manifest);
    campaign.stages[0].config = {
      password: privateMarker,
      token: privateMarker,
      databaseUrl: privateMarker,
    };
    campaign.approval.reference = privateMarker;
    const output = publicParameters(manifest, true, {
      campaign,
      enableAdmissions: true,
      vercelToken: privateMarker,
      databaseUrl: privateMarker,
    });
    expect(Object.keys(output.parameters).sort()).toEqual(
      [
        'location',
        'environmentName',
        'registryName',
        'identityName',
        'apiName',
        'jobName',
        'webOrigin',
        'authOrigin',
        'releaseId',
        'rolloutId',
        'practiceRunnerEnabled',
        'practiceRunnerProvider',
        'sandboxRecoveryEnabled',
        'apiImage',
        'jobImage',
        'deployWorkloads',
        'approvedUntil',
        'budgetClp',
        'jobTimeoutSeconds',
        'aiResourceId',
        'sandboxImage',
        'sandboxRegion',
        'sandboxTeamId',
        'sandboxProjectId',
      ].sort(),
    );
    expect(JSON.stringify(output)).not.toContain(privateMarker);
  });
});

describe('Sandbox plan CLI flags with local in-memory side effects', () => {
  test('explicit flags render the approved operating mode and rollout', async () => {
    const manifest = await preparedManifest();
    const execution = await runCli(manifest, preparedCampaign(manifest), [
      '--workloads',
      '--enable-runner',
      '--recover-runner',
      '--sandbox-campaign',
      '/fixture/campaign.json',
      '--rollout',
      'run1',
    ]);
    expect(execution.exitCode).toBe(0);
    expect(execution.parameters).toMatchObject({
      deployWorkloads: { value: true },
      practiceRunnerEnabled: { value: true },
      sandboxRecoveryEnabled: { value: true },
      rolloutId: { value: 'run1' },
    });
    expect(execution.loadCampaign).toHaveBeenCalledWith(
      '/fixture/campaign.json',
    );
    expect(execution.prepareBootstrap).toHaveBeenCalledTimes(1);
  });

  test('recover-runner admits an expired approved dossier without enabling RUN/SUBMIT', async () => {
    const manifest = await preparedManifest();
    const campaign = preparedCampaign(manifest);
    campaign.expiresAt = new Date(now - 1).toISOString();
    const execution = await runCli(manifest, campaign, [
      '--workloads',
      '--recover-runner',
      '--sandbox-campaign',
      '/fixture/campaign.json',
      '--rollout',
      'cleanup1',
    ]);
    expect(execution.exitCode).toBe(0);
    expect(execution.parameters.practiceRunnerEnabled.value).toBe(false);
    expect(execution.parameters.sandboxRecoveryEnabled.value).toBe(true);
  });

  test.each([
    ['--enable-runner'],
    ['--recover-runner'],
    ['--sandbox-campaign'],
    ['--rollout'],
    ['--sandbox-campaign', '--workloads'],
    ['--rollout', '--recover-runner'],
    ['--enable-runner=true'],
    ['--unknown'],
    ['--rollout', '../escape'],
    ['--sandbox-campaign', privateMarker],
  ])(
    'invalid or incomplete flags %j never write parameters or run bootstrap',
    async (...flags) => {
      const manifest = await preparedManifest();
      const execution = await runCli(
        manifest,
        preparedCampaign(manifest),
        flags,
      );
      expect(execution.exitCode).toBe(2);
      expect(execution.parameters).toBeUndefined();
      expect(execution.prepareBootstrap).not.toHaveBeenCalled();
      expect(execution.messages).not.toContain(privateMarker);
      expect([...execution.files.values()].join('')).not.toContain(
        privateMarker,
      );
    },
  );

  test('check does not accept deployment flags', async () => {
    const manifest = await preparedManifest();
    const execution = await runCli(
      manifest,
      preparedCampaign(manifest),
      ['--recover-runner'],
      'check',
    );
    expect(execution.exitCode).toBe(2);
    expect(execution.parameters).toBeUndefined();
    expect(execution.loadCampaign).not.toHaveBeenCalled();
  });
});
