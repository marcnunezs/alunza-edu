import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { AzureEmbeddingsAdapter, AzureHelpAdapter } from '@alunza/ai';
import {
  buildReadinessReport,
  localConfigurationPath,
  prepareLocalEvaluation,
  readinessMain,
  summarizeProviderEnvironment,
} from '../../scripts/evaluation-readiness.mjs';
import { buildEvaluationReviewPacket } from '../../scripts/evaluation-review-packet.mjs';
import {
  assertEvaluationReady,
  evaluationPlanSchema,
} from '../../scripts/evaluation-manifest.mjs';

const base = resolve('.local/eval-preparation');
const fixtureId = `test-readiness-${randomUUID()}`;
const inputDirectory = resolve('.local/tmp', fixtureId);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const generatedAt = '2026-11-18T08:00:00.000Z';
const secret = 'PRIVATE_PROVIDER_VALUE_NOT_FOR_REPORTS';
let example;
beforeAll(async () => {
  example = JSON.parse(
    await readFile('infra/preproduction/help-evaluation.example.json', 'utf8'),
  );
  await mkdir(inputDirectory, { recursive: true });
});
function configuration(record = {}) {
  return {
    inspection: 'PRESENCE_ONLY_NO_CREDENTIAL_VALIDATION',
    process: summarizeProviderEnvironment(record),
    files: [],
  };
}
function report(change = {}) {
  return buildReadinessReport({
    plan: example,
    reviewPacket: buildEvaluationReviewPacket(),
    configuration: configuration(),
    generatedAt,
    ...change,
  });
}
async function withoutProvider(body) {
  const guards = [
    jest.spyOn(globalThis, 'fetch'),
    jest.spyOn(AzureEmbeddingsAdapter.prototype, 'embed'),
    jest.spyOn(AzureHelpAdapter.prototype, 'generate'),
    jest.spyOn(AzureHelpAdapter.prototype, 'verify'),
  ];
  guards.forEach((guard) =>
    guard.mockImplementation(() => {
      throw new Error('OFFLINE_PROVIDER_CALL_FORBIDDEN');
    }),
  );
  try {
    const result = await body();
    guards.forEach((guard) => expect(guard).not.toHaveBeenCalled());
    return result;
  } finally {
    guards.forEach((guard) => guard.mockRestore());
  }
}

describe('offline Azure readiness without inference or authorization', () => {
  it('rejects UNC, device and outside configuration paths before any filesystem access', async () => {
    const inputs = [
      String.raw`\\fixture.invalid\share\provider.json`,
      String.raw`\\?\UNC\fixture.invalid\share\provider.json`,
      String.raw`\\?\C:\private\provider.json`,
      String.raw`\\.\pipe\provider`,
      '//fixture.invalid/share/provider.json',
      resolve('../provider.json'),
      resolve('../alunza-edu-laboratorio-foreign/provider.json'),
      resolve('.'),
    ];
    // A fresh native ESM loader is necessary: Jest retains its own snapshots of
    // built-in named imports. Establish the guard before importing the module,
    // then prove it is active before passing even a synthetic UNC address.
    const script = `
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      import { strict as assert } from 'node:assert';
      let calls = 0;
      fs.lstat = async () => { calls++; throw new Error('TEST_FILESYSTEM_FORBIDDEN'); };
      syncBuiltinESMExports();
      const {localConfigurationPath} = await import('./scripts/evaluation-readiness.mjs');
      await assert.rejects(localConfigurationPath(${JSON.stringify(join(inputDirectory, 'unread.json'))}), /TEST_FILESYSTEM_FORBIDDEN/);
      assert.equal(calls, 1);
      calls = 0;
      for (const input of ${JSON.stringify(inputs)}) await assert.rejects(localConfigurationPath(input), /OFFLINE_CONFIGURATION_PATH_OUT_OF_SCOPE/);
      assert.equal(calls, 0);
      console.log(JSON.stringify({guardProved:true,filesystemCalls:calls,deniedPaths:${inputs.length}}));
    `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--input-type=module', '-e', script],
      { cwd: resolve('.'), windowsHide: true },
    );
    expect(JSON.parse(stdout)).toEqual({
      guardProved: true,
      filesystemCalls: 0,
      deniedPaths: inputs.length,
    });
  });

  it('allows an ordinary configuration file inside the workspace and rejects a directory', async () => {
    const path = join(inputDirectory, 'allowed-local.json');
    await writeFile(path, JSON.stringify({ AI_AZURE_API_KEY: secret }), {
      flag: 'wx',
    });
    expect(await localConfigurationPath(path)).toBe(path);
    expect(await localConfigurationPath(relative(resolve('.'), path))).toBe(
      path,
    );
    await expect(localConfigurationPath(inputDirectory)).rejects.toThrow(
      'OFFLINE_CONFIGURATION_PATH_LINK_OR_NOT_FILE',
    );
    expect(JSON.parse(await readFile(path, 'utf8')).AI_AZURE_API_KEY).toBe(
      secret,
    );
  });

  it('rejects a configuration path through an owned junction/symlink without following it', async () => {
    const target = join(inputDirectory, 'provider-link-target');
    await mkdir(target);
    await writeFile(
      join(target, 'provider.json'),
      JSON.stringify({ AI_AZURE_API_KEY: secret }),
      { flag: 'wx' },
    );
    const linked = join(inputDirectory, 'provider-link');
    await symlink(
      target,
      linked,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(
      localConfigurationPath(join(linked, 'provider.json')),
    ).rejects.toThrow('OFFLINE_CONFIGURATION_PATH_LINK_OR_NOT_FILE');
    expect(await readdir(target)).toEqual(['provider.json']);
    expect(
      JSON.parse(await readFile(join(target, 'provider.json'), 'utf8'))
        .AI_AZURE_API_KEY,
    ).toBe(secret);
  });

  it('only reports allowed names and distinguishes absent, placeholder and unverified values', () => {
    const result = summarizeProviderEnvironment({
      AI_AZURE_BASE_URL: 'https://REPLACE.openai.azure.com/openai/v1/',
      AI_AUTH_MODE: 'azure-cli',
      AI_EMBEDDING_MODEL: '  ',
      AI_EMBEDDING_DIMENSIONS: 123,
      AI_GENERATION_DEPLOYMENT: '"YOUR_DEPLOYMENT"',
      AI_VERIFICATION_MODEL: '<private-model>',
      AI_AZURE_API_KEY: secret,
      UNKNOWN_PRIVATE_NAME: secret,
    });
    const states = Object.fromEntries(
      result.fields.map(({ key, status }) => [key, status]),
    );
    expect(states).toMatchObject({
      AI_AZURE_BASE_URL: 'PLACEHOLDER',
      AI_AUTH_MODE: 'PRESENT_UNVERIFIED',
      AI_EMBEDDING_MODEL: 'ABSENT',
      AI_EMBEDDING_DIMENSIONS: 'ABSENT',
      AI_GENERATION_DEPLOYMENT: 'PLACEHOLDER',
      AI_VERIFICATION_MODEL: 'PLACEHOLDER',
      AI_AZURE_API_KEY: 'PRESENT_UNVERIFIED',
    });
    expect(result.authenticationVerified).toBe(false);
    expect(result.fields).toHaveLength(14);
    for (const field of result.fields)
      expect(Object.keys(field).sort()).toEqual(['key', 'status']);
    for (const forbidden of [
      secret,
      'UNKNOWN_PRIVATE_NAME',
      'azure-cli',
      'openai.azure.com',
    ])
      expect(JSON.stringify(result)).not.toContain(forbidden);
    expect(
      summarizeProviderEnvironment(null).fields.every(
        (field) => field.status === 'ABSENT',
      ),
    ).toBe(true);
  });

  it('keeps authentication, academic review, calibration, tokens and cost unmeasured despite configuration presence', async () =>
    withoutProvider(async () => {
      const supplied = Object.fromEntries(
        summarizeProviderEnvironment({}).fields.map(({ key }) => [key, secret]),
      );
      const result = report({ configuration: configuration(supplied) });
      expect(result).toMatchObject({
        status: 'PREPARED_OFFLINE',
        authorizedForInference: false,
        providerCalls: 0,
        observedTokens: null,
        observedCostMicroUsd: null,
        azureEvaluation: 'NOT_EXECUTED',
        academicAcceptance: 'PENDING',
        calibrationArtifact: null,
      });
      expect(result.configuration.process.authenticationVerified).toBe(false);
      expect(
        result.configuration.process.fields.every(
          (field) => field.status === 'PRESENT_UNVERIFIED',
        ),
      ).toBe(true);
      expect(result.gates.map(({ id, status }) => [id, status])).toEqual([
        ['AZURE_CONFIGURATION', 'PENDING'],
        ['AUTHENTICATION_AND_QUOTA', 'NOT_VERIFIED'],
        ['COST_AND_AUTHORIZATION', 'PENDING'],
        ['CALIBRATION_AND_HUMAN_REVIEW', 'PENDING'],
        ['LOCAL_EVALUATION_ENVIRONMENT', 'NOT_VERIFIED'],
        ['BROWSER_LATENCY', 'NOT_MEASURED'],
      ]);
      expect(JSON.stringify(result)).not.toContain(secret);
      await expect(assertEvaluationReady(example, {})).rejects.toMatchObject({
        code: 'EVALUATION_CONFIGURATION_PENDING',
      });
    }));

  it('preserves documentary latency and rate limits and rejects approval or an incompatible destination', () => {
    expect(report().plan.profile).toEqual({
      functionalHelps: 4,
      functionalMaximumCalls: 12,
      serialHelps: 100,
      concurrentHelps: 100,
      concurrency: 4,
      deadlineMs: 15000,
      documentaryP95TargetMs: 12000,
      rateLimitsUnchanged: true,
    });
    expect(example.latency).toEqual({
      serialAttempts: 25,
      concurrentAttempts: 25,
      concurrency: 4,
      helpsPerAttempt: 4,
    });
    const approval = {
      approvedBy: 'Synthetic reviewer',
      reference: 'not-authorized',
      expiresAt: '2099-01-01T00:00:00Z',
    };
    expect(() =>
      report({ plan: { ...example, authorization: approval } }),
    ).toThrow('UNAUTHORIZED_AZURE_DRAFT');
    expect(() =>
      report({
        plan: {
          ...example,
          destination: {
            ...example.destination,
            apiOrigin: 'https://foreign.invalid',
          },
        },
      }),
    ).toThrow();
    expect(() =>
      report({
        plan: { ...example, latency: { ...example.latency, concurrency: 8 } },
      }),
    ).toThrow();
    expect(() => report({ plan: { ...example, provider: 'TEST' } })).toThrow();
  });

  it('writes one new complete packet with verified checksums, no credentials and a non-executable plan', async () =>
    withoutProvider(async () => {
      const directory = join(base, fixtureId);
      const providerPath = join(inputDirectory, 'provider.json');
      await writeFile(
        providerPath,
        JSON.stringify({
          AI_AZURE_API_KEY: secret,
          AI_AUTH_MODE: 'api-key',
          UNKNOWN_PRIVATE_NAME: secret,
        }),
        { flag: 'wx' },
      );
      const result = await prepareLocalEvaluation({
        directory,
        providerEnvironmentPath: providerPath,
      });
      expect(result).toMatchObject({
        directory,
        status: 'PREPARED_OFFLINE',
        providerCalls: 0,
        authorizedForInference: false,
      });
      expect(result.candidateFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect((await readdir(directory)).sort()).toEqual([
        'README.md',
        'checksums.json',
        'plan-draft.json',
        'readiness.json',
        'review-packet.json',
        'teacher-corpus.md',
        'teacher-design-review.json',
      ]);
      const files = Object.fromEntries(
        await Promise.all(
          (await readdir(directory)).map(async (name) => [
            name,
            await readFile(join(directory, name), 'utf8'),
          ]),
        ),
      );
      const plan = evaluationPlanSchema.parse(
        JSON.parse(files['plan-draft.json']),
      );
      expect(plan).toEqual({
        ...example,
        candidateFingerprint: result.candidateFingerprint,
      });
      for (const key of [
        'authorization',
        'priceVersion',
        'budgets',
        'profiles',
        'azure',
      ])
        expect(plan[key]).toBeNull();
      await expect(assertEvaluationReady(plan, {})).rejects.toMatchObject({
        code: 'EVALUATION_CONFIGURATION_PENDING',
      });
      const readiness = JSON.parse(files['readiness.json']);
      expect(
        readiness.configuration.files.find(
          (file) => file.source === 'explicit-provider',
        ),
      ).toMatchObject({ status: 'INSPECTED', authenticationVerified: false });
      expect(
        readiness.sources.every(
          (file) =>
            typeof file.path === 'string' && /^[a-f0-9]{64}$/.test(file.sha256),
        ),
      ).toBe(true);
      expect(readiness.candidateFingerprint).toBe(plan.candidateFingerprint);
      const packet = JSON.parse(files['review-packet.json']);
      expect(packet).toMatchObject({
        azureEvaluation: 'NOT_EXECUTED',
        humanAcceptance: 'PENDING',
      });
      expect(packet.inventory).toEqual(readiness.corpus);
      const checksums = JSON.parse(files['checksums.json']);
      expect(checksums).toMatchObject({
        schemaVersion: 1,
        algorithm: 'sha256',
      });
      expect(checksums.files.map(({ file }) => file).sort()).toEqual([
        'README.md',
        'plan-draft.json',
        'readiness.json',
        'review-packet.json',
        'teacher-corpus.md',
        'teacher-design-review.json',
      ]);
      for (const entry of checksums.files)
        expect(entry.sha256).toBe(hash(files[entry.file]));
      const publicText = Object.values(files).join('\n');
      for (const forbidden of [
        secret,
        'UNKNOWN_PRIVATE_NAME',
        providerPath,
        'capability.json',
        'authorized-manifest.json',
      ])
        expect(publicText).not.toContain(forbidden);
      await expect(prepareLocalEvaluation({ directory })).rejects.toMatchObject(
        { code: 'EEXIST' },
      );
      for (const [name, original] of Object.entries(files))
        expect(await readFile(join(directory, name), 'utf8')).toBe(original);
    }));

  it('never echoes a malformed private provider file or its parser error', async () =>
    withoutProvider(async () => {
      const directory = join(base, `${fixtureId}-invalid-config`),
        providerPath = join(inputDirectory, 'invalid.json');
      await writeFile(providerPath, `{"AI_AZURE_API_KEY":"${secret}`, {
        flag: 'wx',
      });
      await prepareLocalEvaluation({
        directory,
        providerEnvironmentPath: providerPath,
      });
      const text = await readFile(join(directory, 'readiness.json'), 'utf8');
      expect(
        JSON.parse(text).configuration.files.find(
          (file) => file.source === 'explicit-provider',
        ),
      ).toEqual({
        source: 'explicit-provider',
        status: 'UNREADABLE_OR_INVALID',
        authenticationVerified: false,
      });
      expect(text).not.toContain(secret);
      expect(text).not.toContain(providerPath);
    }));

  it.each([
    resolve('.local/eval-runs/forbidden'),
    resolve('.local/eval-preparation-escape/forbidden'),
    join(base, 'nested/forbidden'),
    join(base, '.hidden'),
    base,
  ])(
    'rejects an out-of-scope or non-direct output before creating evidence: %s',
    async (directory) =>
      withoutProvider(async () => {
        await expect(prepareLocalEvaluation({ directory })).rejects.toThrow(
          'DIRECTORY_OUT_OF_SCOPE',
        );
      }),
  );

  it('refuses a child junction/symlink and preserves its target', async () =>
    withoutProvider(async () => {
      await mkdir(base, { recursive: true });
      const target = join(inputDirectory, 'link-target');
      await mkdir(target);
      await writeFile(
        join(target, 'sentinel.txt'),
        'preserve-owned-test-target',
        { flag: 'wx' },
      );
      const directory = join(base, `${fixtureId}-link`);
      await symlink(
        target,
        directory,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await expect(prepareLocalEvaluation({ directory })).rejects.toMatchObject(
        { code: 'EEXIST' },
      );
      expect(await readdir(target)).toEqual(['sentinel.txt']);
      expect(await readFile(join(target, 'sentinel.txt'), 'utf8')).toBe(
        'preserve-owned-test-target',
      );
    }));

  it.each([
    ['--run'],
    ['--directory'],
    ['--provider-env'],
    ['--directory', 'x', '--directory', 'y'],
    ['--authorize', 'yes'],
  ])(
    'rejects unsupported or incomplete CLI arguments without dispatch: %j',
    async (args) =>
      withoutProvider(async () => {
        await expect(readinessMain(args)).rejects.toThrow(
          'INVALID_OFFLINE_PREPARATION_ARGUMENT',
        );
      }),
  );
});
