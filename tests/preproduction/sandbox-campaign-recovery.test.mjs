import { afterEach, describe, expect, jest, test } from '@jest/globals';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  acquireCampaignLock,
  campaignManifestDigest,
  readCampaignRecoveryState,
  recoverCampaign,
  CampaignBudget,
} from '../../scripts/sandbox-campaign.mjs';

const temporary = [];
const temporaryRoot = resolve('.local/tmp');
const candidate = { commit: 'a'.repeat(40), sourceDigest: 'b'.repeat(64) };
const key = 'success:sync-json-success';
function fixture() {
  const start = Date.now() - 7200000;
  const campaign = {
    schemaVersion: 1,
    campaignId: randomUUID(),
    environment: 'preproduction',
    authorized: true,
    expiresAt: new Date(start + 3600000).toISOString(),
    teamId: 'team_fixture',
    projectId: 'prj_fixture',
    region: 'iad1',
    image: `registry.test/capsule@sha256:${'c'.repeat(64)}`,
    runnerVersion: 'older-runner-for-cleanup',
    maxCreations: 1,
    maxRequests: 36,
    maxCost: 1,
    currency: 'USD',
    candidate,
    approval: {
      approvedBy: 'FICTIONAL_UNIT_TEST_ACTOR',
      reference: 'UNIT_TEST_NO_REMOTE_EFFECT',
      approvedAt: new Date(start).toISOString(),
    },
    rates: null,
    stages: [
      {
        id: 'success',
        kind: 'capsule',
        enabled: true,
        fixtures: ['sync-json-success'],
        creations: 1,
        maxRequests: 36,
        maxDurationSeconds: 40,
      },
    ],
  };
  const correlation = {
    schemaVersion: 1,
    sandboxName: `alunza-runner-${randomUUID()}`,
    recordedAt: new Date(start + 2000).toISOString(),
    teamId: campaign.teamId,
    projectId: campaign.projectId,
    image: campaign.image,
    region: campaign.region,
    requestedVmTimeoutMs: 60000,
    maxCreateDispatches: 1,
    owner: 'alunza-imp-03-07',
    correlationId: campaign.campaignId,
  };
  const resource = {
    sandboxName: correlation.sandboxName,
    sandboxId: 'sbx_confirmed_fixture',
    owner: correlation.owner,
    correlationId: correlation.correlationId,
    teamId: campaign.teamId,
    projectId: campaign.projectId,
    image: campaign.image,
    region: campaign.region,
  };
  const events = [
    {
      kind: 'campaign-started',
      journalVersion: 2,
      campaignId: campaign.campaignId,
      candidate,
      manifestDigest: campaignManifestDigest(campaign),
      recordedAt: new Date(start + 1000).toISOString(),
    },
    {
      kind: 'creation-reserved',
      key,
      correlation,
      recordedAt: new Date(start + 2000).toISOString(),
    },
    {
      kind: 'request-reserved',
      key,
      recordedAt: new Date(start + 2100).toISOString(),
    },
  ];
  const env = {
    VERCEL_TOKEN: 'UNIT_TEST_TOKEN_NEVER_SENT',
    SANDBOX_TEAM_ID: campaign.teamId,
    SANDBOX_PROJECT_ID: campaign.projectId,
    SANDBOX_REGION: campaign.region,
    SANDBOX_IMAGE: campaign.image,
  };
  return { campaign, correlation, resource, events, env };
}
const lines = (events) =>
  events.map((event) => JSON.stringify(event)).join('\n') + '\n';
const event = (kind, extra = {}) => ({
  kind,
  recordedAt: new Date().toISOString(),
  ...extra,
});
async function prepare(value, confirmed = true) {
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(
    resolve(temporaryRoot, 'sandbox-recovery-unit-'),
  );
  temporary.push(directory);
  const campaignDirectory = resolve(directory, value.campaign.campaignId);
  await mkdir(campaignDirectory);
  if (confirmed)
    value.events.push(
      event('resource-confirmed', { key, resource: value.resource }),
    );
  const journal = resolve(campaignDirectory, 'journal.private.jsonl');
  await writeFile(journal, lines(value.events), { flag: 'wx' });
  return { directory, campaignDirectory, journal };
}
afterEach(async () => {
  if (!temporary.length) return;
  const root = await realpath(temporaryRoot);
  for (const path of temporary.splice(0)) {
    const target = await realpath(path);
    if (!target.startsWith(`${root}${sep}`))
      throw new Error('Test cleanup escaped its temporary workspace');
    await rm(target, { recursive: true });
  }
});

describe('cleanup-only campaign recovery: fake provider, local files and IPC lock only', () => {
  test('expired original approval can clean confirmed owned resources without current source equality or new creation', async () => {
    const value = fixture();
    const files = await prepare(value);
    const create = jest.fn(() => {
      throw new Error('Creation is prohibited');
    });
    const recoverVercelSandbox = jest.fn(async (options) => {
      expect(options.creationState).toBe('CONFIRMED');
      expect(options.sandboxId).toBe(value.resource.sandboxId);
      expect(options.sandboxName).toBe(value.correlation.sandboxName);
      options.allowRequest(true);
      const saved = await readFile(files.journal, 'utf8');
      expect(saved).toContain('cleanup-request-reserved');
      return {
        sandboxId: value.resource.sandboxId,
        cleanupVerified: true,
        cleanupCheck: 'ABSENT_AND_ZERO_SNAPSHOTS',
        snapshotsRemaining: 0,
      };
    });
    const report = await recoverCampaign(value.campaign, {
      env: value.env,
      runner: { recoverVercelSandbox, VercelAdapter: create },
      evidenceDirectory: files.directory,
    });
    expect(report).toMatchObject({
      status: 'RECOVERED',
      pending: 0,
      newCreations: 0,
      requests: 1,
      totalCampaignRequests: 2,
      currentCandidateAssessed: false,
    });
    expect(create).not.toHaveBeenCalled();
    expect(report.originalCandidate).toEqual(candidate);
    expect(await readFile(files.journal, 'utf8')).not.toContain(
      value.env.VERCEL_TOKEN,
    );
    await recoverCampaign(value.campaign, {
      env: value.env,
      runner: { recoverVercelSandbox },
      evidenceDirectory: files.directory,
    });
    expect(recoverVercelSandbox).toHaveBeenCalledTimes(1);
  });

  test('uncertain create followed by404 remains pending and preserves request consumption across invocations', async () => {
    const value = fixture();
    const files = await prepare(value, false);
    const recoverVercelSandbox = jest.fn(async (options) => {
      expect(options.creationState).toBe('UNKNOWN');
      expect(options.sandboxId).toBeNull();
      options.allowRequest(true);
      return {
        cleanupVerified: false,
        cleanupCheck: 'CREATION_UNRESOLVED',
        snapshotsRemaining: null,
      };
    });
    const options = {
      env: value.env,
      runner: { recoverVercelSandbox },
      evidenceDirectory: files.directory,
    };
    const first = await recoverCampaign(value.campaign, options);
    const second = await recoverCampaign(value.campaign, options);
    expect(first).toMatchObject({
      status: 'PENDING',
      pending: 1,
      totalCampaignRequests: 2,
    });
    expect(second).toMatchObject({
      status: 'PENDING',
      pending: 1,
      totalCampaignRequests: 3,
    });
    const state = readCampaignRecoveryState(
      value.campaign,
      await readFile(files.journal, 'utf8'),
    );
    expect(state.resources.get(key).sandboxId).toBeNull();
  });

  test('reconciliation durably records a newly observed resource ID before cleanup', async () => {
    const value = fixture();
    const files = await prepare(value, false);
    const recoverVercelSandbox = jest.fn(async (options) => {
      options.allowRequest(true);
      await options.recordResource(value.resource);
      expect(await readFile(files.journal, 'utf8')).toContain(
        'sbx_confirmed_fixture',
      );
      options.allowRequest(true);
      return {
        sandboxId: value.resource.sandboxId,
        cleanupVerified: true,
        cleanupCheck: 'ABSENT_AND_ZERO_SNAPSHOTS',
        snapshotsRemaining: 0,
      };
    });
    expect(
      (
        await recoverCampaign(value.campaign, {
          env: value.env,
          runner: { recoverVercelSandbox },
          evidenceDirectory: files.directory,
        })
      ).pending,
    ).toBe(0);
  });

  test('a provider double cannot mark unknown identity plusabsence as verified without a receipt', async () => {
    const value = fixture();
    const files = await prepare(value, false);
    const recoverVercelSandbox = jest.fn(async () => ({
      cleanupVerified: true,
      cleanupCheck: 'ABSENT_AND_ZERO_SNAPSHOTS',
      snapshotsRemaining: 0,
    }));
    expect(
      (
        await recoverCampaign(value.campaign, {
          env: value.env,
          runner: { recoverVercelSandbox },
          evidenceDirectory: files.directory,
        })
      ).status,
    ).toBe('PENDING');
  });

  test.each([
    'teamId',
    'projectId',
    'image',
    'maxRequests',
    'approval',
    'candidate',
  ])('changed %s cannot reuse original authority', async (field) => {
    const value = fixture();
    const files = await prepare(value);
    const changed = JSON.parse(JSON.stringify(value.campaign));
    if (field === 'maxRequests') changed.maxRequests++;
    else if (field === 'approval') changed.approval.reference = 'changed';
    else if (field === 'candidate') changed.candidate.commit = 'd'.repeat(40);
    else changed[field] += field === 'image' ? 'a' : 'other';
    const recoverVercelSandbox = jest.fn();
    await expect(
      recoverCampaign(changed, {
        env: value.env,
        runner: { recoverVercelSandbox },
        evidenceDirectory: files.directory,
      }),
    ).rejects.toThrow();
    expect(recoverVercelSandbox).not.toHaveBeenCalled();
  });

  test('a second process cannot recover or append while the campaign lock is held', async () => {
    const value = fixture();
    const files = await prepare(value);
    const release = await acquireCampaignLock(files.campaignDirectory);
    const recoverVercelSandbox = jest.fn();
    try {
      await expect(
        recoverCampaign(value.campaign, {
          env: value.env,
          runner: { recoverVercelSandbox },
          evidenceDirectory: files.directory,
        }),
      ).rejects.toThrow('CAMPAIGN_ALREADY_ACTIVE');
      expect(recoverVercelSandbox).not.toHaveBeenCalled();
    } finally {
      await release();
    }
  });

  test('remaining aggregate quota is consumed once; exhaustion cannot be reset by recovery', async () => {
    const value = fixture();
    for (let index = 0; index < 27; index++)
      value.events.push(event('request-reserved', { key }));
    for (let index = 0; index < 8; index++)
      value.events.push(event('cleanup-request-reserved', { key }));
    const files = await prepare(value);
    const externalEffect = jest.fn();
    const recoverVercelSandbox = jest.fn(async (options) => {
      options.allowRequest(true);
      externalEffect();
    });
    const report = await recoverCampaign(value.campaign, {
      env: value.env,
      runner: { recoverVercelSandbox },
      evidenceDirectory: files.directory,
    });
    expect(report).toMatchObject({
      status: 'PENDING',
      totalCampaignRequests: 36,
      remainingRequests: 0,
      requests: 0,
    });
    expect(externalEffect).not.toHaveBeenCalled();
  });

  test('normal operation is forbidden even when unused campaign quota remains', async () => {
    const value = fixture();
    const files = await prepare(value);
    const externalEffect = jest.fn();
    const recoverVercelSandbox = jest.fn(async (options) => {
      options.allowRequest(false);
      externalEffect();
    });
    const report = await recoverCampaign(value.campaign, {
      env: value.env,
      runner: { recoverVercelSandbox },
      evidenceDirectory: files.directory,
    });
    expect(report).toMatchObject({ status: 'PENDING', requests: 0 });
    expect(externalEffect).not.toHaveBeenCalled();
  });

  test('mismatched resource receipts and incomplete journal records block before remote effects', async () => {
    const value = fixture();
    const files = await prepare(value);
    value.events[value.events.length - 1].resource.owner = 'foreign';
    await writeFile(files.journal, lines(value.events));
    const recoverVercelSandbox = jest.fn();
    await expect(
      recoverCampaign(value.campaign, {
        env: value.env,
        runner: { recoverVercelSandbox },
        evidenceDirectory: files.directory,
      }),
    ).rejects.toThrow('CAMPAIGN_RESOURCE_RECEIPT_MISMATCH');
    await writeFile(files.journal, lines(value.events).slice(0, -2));
    await expect(
      recoverCampaign(value.campaign, {
        env: value.env,
        runner: { recoverVercelSandbox },
        evidenceDirectory: files.directory,
      }),
    ).rejects.toThrow('CAMPAIGN_JOURNAL_INCOMPLETE');
    expect(recoverVercelSandbox).not.toHaveBeenCalled();
  });

  test('run budget persists confirmed IDs and exact absence proof without extending quota', () => {
    const value = fixture();
    const persist = jest.fn();
    const budget = new CampaignBudget(value.campaign, {
      now: () => Date.parse(value.events[0].recordedAt),
      persist,
    });
    budget.reserveCreation(key, value.correlation);
    budget.recordResource(key, value.resource);
    budget.recordCleanup(key, {
      cleanupVerified: true,
      cleanupCheck: 'ABSENT_AND_ZERO_SNAPSHOTS',
      snapshotsRemaining: 0,
      sandboxId: value.resource.sandboxId,
    });
    expect(persist.mock.calls.map(([entry]) => entry.kind)).toEqual([
      'creation-reserved',
      'resource-confirmed',
      'resource-cleanup-verified',
    ]);
    expect(budget.creations).toBe(1);
  });
});
