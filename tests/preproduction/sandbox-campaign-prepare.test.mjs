import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { parseEnv, promisify } from 'node:util';
import { prepareCampaignDirectory } from '../../scripts/sandbox-campaign.mjs';
import { readCoverageCandidate } from '../../scripts/quality-coverage.mjs';

const temporaryRoot = resolve('.local/tmp');
const digest = 'sha256:' + 'a'.repeat(64);
const otherDigest = 'sha256:' + 'b'.repeat(64);
const project = 'alunza-preprod';
const repository = 'practice-runner';
const scope = 'equipo-ficticio/' + project + '/' + repository;
const qualified = scope + '@' + digest;
const short = repository + '@' + digest;
const teamId = 'team_syntheticFixture';
const projectId = 'prj_syntheticFixture';
const oldCandidate = { commit: 'c'.repeat(40), sourceDigest: 'd'.repeat(64) };
let directory, template;

beforeAll(async () => {
  await mkdir(temporaryRoot, { recursive: true });
  directory = await mkdtemp(resolve(temporaryRoot, 'sandbox-prepare-unit-'));
  template = JSON.parse(
    await readFile(
      new URL(
        '../../infra/preproduction/sandbox-capability-campaign.example.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
});

afterAll(async () => {
  if (!directory) return;
  const parent = await realpath(temporaryRoot);
  const target = await realpath(directory);
  if (!target.startsWith(parent + sep + 'sandbox-prepare-unit-'))
    throw new Error('Unexpected temporary path');
  await rm(target, { recursive: true });
});

function inputs() {
  const draft = JSON.parse(JSON.stringify(template));
  Object.assign(draft, {
    campaignId: 'b502f234-bd19-44cb-81a1-88c557366b55',
    teamId,
    projectId,
    region: 'gru1',
    image: short,
    candidate: { ...oldCandidate },
    maxCost: 0.01,
    rates: {
      currency: 'USD',
      region: 'gru1',
      activeCpuPerVcpuHour: 0.2,
      memoryPerGbHour: 0.03,
      creationPerRun: 0.000001,
      memoryBillingQuantumSeconds: 60,
      sourceUrl: 'https://example.invalid/synthetic-rates',
      recordedAt: '2026-11-10',
    },
  });
  const publication = {
    schemaVersion: 1,
    purpose: 'publish-and-verify-only',
    verifiedAt: '2026-11-10T15:02:00.000Z',
    campaignId: draft.campaignId,
    project,
    projectId,
    teamId,
    repository,
    repositoryId: 'repo_syntheticFixture',
    repositoryPublic: false,
    imageId: 'image_syntheticFixture',
    platform: 'linux/amd64',
    createdAt: '2026-11-10T15:00:00.000Z',
    registryTag: 'vcr.vercel.com/' + scope + ':fixture-v1',
    registryDigestReference: 'vcr.vercel.com/' + qualified,
    sandboxProjectScopedReference: short,
    expectedManifestDigest: digest,
    observedManifestDigest: digest,
    vcrStatus: 'ready',
    registrySizeBytes: 1000,
    compressedLayersAndConfigBytes: 1000,
    verification: ['Synthetic registry receipt for local tests'],
    registryStorageBillingObserved: false,
    sandboxExecutions: 0,
    retentionReviewRecommendedAt: '2026-11-17T15:00:00.000Z',
    retirementScheduled: false,
  };
  return { draft, publication };
}

async function files({ draft, publication }) {
  const fixture = await mkdtemp(resolve(directory, 'case-'));
  const draftPath = resolve(fixture, 'input.draft.json');
  const publicationPath = resolve(fixture, 'publication.json');
  const output = resolve(fixture, 'prepared');
  const draftText = JSON.stringify(draft, null, 2) + '\n';
  const receiptText = JSON.stringify(publication, null, 2) + '\n';
  await Promise.all([
    writeFile(draftPath, draftText, { flag: 'wx' }),
    writeFile(publicationPath, receiptText, { flag: 'wx' }),
  ]);
  return {
    draftPath,
    publicationPath,
    output,
    draftText,
    receiptText,
    fixture,
  };
}

describe('prepare a reviewable campaign from an existing private VCR publication', () => {
  it.each(['unassigned', 'short', 'canonical'])(
    'prepares candidate and environment from a %s draft',
    async (form) => {
      const value = inputs();
      if (form === 'unassigned')
        Object.assign(value.draft, {
          teamId: null,
          projectId: null,
          image: null,
        });
      if (form === 'canonical') value.draft.image = qualified;
      const local = await files(value);
      const { campaign, environment } = await prepareCampaignDirectory(
        local.draftPath,
        local.publicationPath,
        local.output,
      );
      const [onDisk, envText, original, receipt] = await Promise.all([
        readFile(resolve(local.output, 'campaign.draft.json'), 'utf8'),
        readFile(resolve(local.output, 'sandbox.env'), 'utf8'),
        readFile(local.draftPath, 'utf8'),
        readFile(local.publicationPath, 'utf8'),
      ]);
      expect(original).toBe(local.draftText);
      expect(receipt).toBe(local.receiptText);
      expect(JSON.parse(onDisk)).toEqual(campaign);
      expect(campaign).toMatchObject({
        teamId,
        projectId,
        image: qualified,
        authorized: false,
        expiresAt: null,
        approval: { approvedAt: null, approvedBy: null, reference: null },
        region: value.draft.region,
        runnerVersion: value.draft.runnerVersion,
        currency: value.draft.currency,
        maxCost: value.draft.maxCost,
        maxRequests: value.draft.maxRequests,
        maxCreations: value.draft.maxCreations,
        rates: value.draft.rates,
        stages: value.draft.stages,
      });
      expect(campaign.campaignId).toMatch(
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
      );
      expect(campaign.campaignId).not.toBe(value.draft.campaignId);
      const current = await readCoverageCandidate();
      expect(campaign.candidate).toEqual({
        commit: current.commit,
        sourceDigest: current.sourceDigest,
      });
      const expectedEnv = {
        SANDBOX_TEAM_ID: teamId,
        SANDBOX_PROJECT_ID: projectId,
        SANDBOX_REGION: value.draft.region,
        SANDBOX_IMAGE: qualified,
      };
      expect(environment).toMatchObject(expectedEnv);
      expect(parseEnv(envText)).toMatchObject(expectedEnv);
    },
  );

  it.each([
    [
      'different team ID',
      (d) => {
        d.teamId = 'team_anotherFixture';
      },
    ],
    [
      'different project ID',
      (d) => {
        d.projectId = 'prj_anotherFixture';
      },
    ],
    [
      'different draft repository with same digest',
      (d) => {
        d.image = 'foreign-runner@' + digest;
      },
    ],
    [
      'different team scope with same digest',
      (d) => {
        d.image = 'foreign-team/' + project + '/' + short;
      },
    ],
    [
      'different draft digest',
      (d) => {
        d.image = repository + '@' + otherDigest;
      },
    ],
    [
      'inconsistent expected and observed digests',
      (_d, p) => {
        p.observedManifestDigest = otherDigest;
      },
    ],
    [
      'mismatching digest reference',
      (_d, p) => {
        p.registryDigestReference =
          'vcr.vercel.com/' + scope + '@' + otherDigest;
      },
    ],
    [
      'foreign registry host',
      (_d, p) => {
        p.registryDigestReference = 'registry.invalid/' + qualified;
      },
    ],
    [
      'tag for a different repository',
      (_d, p) => {
        p.registryTag =
          'vcr.vercel.com/equipo-ficticio/' + project + '/other:fixture-v1';
      },
    ],
    [
      'inconsistent repository metadata',
      (_d, p) => {
        p.repository = 'other-runner';
      },
    ],
    [
      'inconsistent project metadata',
      (_d, p) => {
        p.project = 'other-project';
      },
    ],
    [
      'public repository',
      (_d, p) => {
        p.repositoryPublic = true;
      },
    ],
    [
      'image still preparing',
      (_d, p) => {
        p.vcrStatus = 'preparing';
      },
    ],
    [
      'unsupported architecture',
      (_d, p) => {
        p.platform = 'linux/arm64';
      },
    ],
    [
      'existing approval reference in an otherwise disabled draft',
      (d) => {
        d.approval.reference = 'prior-review-unit-test';
      },
    ],
    [
      'prior expiry window in an otherwise disabled draft',
      (d) => {
        d.expiresAt = '2026-11-10T16:00:00.000Z';
      },
    ],
    [
      'already approved campaign',
      (d) => {
        d.authorized = true;
        d.expiresAt = '2026-11-10T16:00:00.000Z';
        d.approval = {
          approvedBy: 'synthetic owner',
          reference: 'unit-test-only',
          approvedAt: '2026-11-10T15:00:00.000Z',
        };
      },
    ],
  ])(
    'rejects %s without producing a usable proposal or modifying the inputs',
    async (_label, change) => {
      const value = inputs();
      change(value.draft, value.publication);
      const local = await files(value);
      await expect(
        prepareCampaignDirectory(
          local.draftPath,
          local.publicationPath,
          local.output,
        ),
      ).rejects.toThrow();
      await expect(
        readFile(resolve(local.output, 'campaign.draft.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        readFile(resolve(local.output, 'sandbox.env')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(local.draftPath, 'utf8')).toBe(local.draftText);
      expect(await readFile(local.publicationPath, 'utf8')).toBe(
        local.receiptText,
      );
    },
  );

  it('makes the operator CLI produce a separate unapproved proposal without credentials', async () => {
    const value = inputs();
    const local = await files(value);
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        resolve('scripts/sandbox-campaign.mjs'),
        'prepare',
        local.draftPath,
        local.publicationPath,
        local.output,
      ],
      {
        windowsHide: true,
        env: Object.fromEntries(
          ['PATH', 'SystemRoot', 'HOME', 'USERPROFILE']
            .filter((key) => process.env[key])
            .map((key) => [key, process.env[key]]),
        ),
      },
    );
    const saved = JSON.parse(
      await readFile(resolve(local.output, 'campaign.draft.json'), 'utf8'),
    );
    expect(JSON.parse(stdout)).toMatchObject({
      status: 'DRAFT_PREPARED',
      campaignId: saved.campaignId,
      image: qualified,
    });
    expect(saved.authorized).toBe(false);
    expect(saved.campaignId).not.toBe(value.draft.campaignId);
    expect(
      parseEnv(await readFile(resolve(local.output, 'sandbox.env'), 'utf8'))
        .SANDBOX_IMAGE,
    ).toBe(qualified);
  });

  it('refuses an existing empty directory and preserves previously reviewed files', async () => {
    const local = await files(inputs());
    await mkdir(local.output);
    const prepare = () =>
      prepareCampaignDirectory(
        local.draftPath,
        local.publicationPath,
        local.output,
      );
    await expect(prepare()).rejects.toThrow();
    expect(await readdir(local.output)).toEqual([]);
    const approved = resolve(local.output, 'campaign.draft.json');
    const reviewedEnv = resolve(local.output, 'sandbox.env');
    await Promise.all([
      writeFile(approved, 'previously approved draft'),
      writeFile(reviewedEnv, 'previously reviewed env'),
    ]);
    await expect(prepare()).rejects.toThrow();
    expect(await readFile(approved, 'utf8')).toBe('previously approved draft');
    expect(await readFile(reviewedEnv, 'utf8')).toBe('previously reviewed env');
  });
});
