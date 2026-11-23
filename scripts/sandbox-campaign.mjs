import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, fsyncSync, openSync } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  realpath,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import {
  remoteDriverExitCodes,
  safeRemoteStartFailureDetail,
} from '../infra/runner/timing.mjs';
import { runnerFixtures, osProbeNames } from '../tests/runner/fixtures.mjs';
import { readCoverageCandidate } from './quality-coverage.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nonempty = z.string().trim().min(1).max(200);
const date = z.iso.datetime({ offset: true });
const count = z.number().int().min(0).max(1000000);
const campaignOwner = 'alunza-imp-03-07';
export const lifecycleFixtureIds = Object.freeze([
  'cancellation',
  'two-concurrent-executions',
  'uncertain-creation-reconciliation',
  'natural-vm-timeout-60s',
]);
const stageSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
    kind: z.enum(['capsule', 'api', 'recovery', 'performance']),
    enabled: z.boolean(),
    fixtures: z.array(nonempty).max(1000),
    creations: count,
    maxRequests: count,
    maxDurationSeconds: z.number().int().min(1).max(86400),
    // API-specific configuration is validated by planApiStage before any effect.
    // It is never copied into a public plan or report.
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const schema = z
  .object({
    schemaVersion: z.literal(1),
    campaignId: z.uuid(),
    environment: z.literal('preproduction'),
    authorized: z.boolean(),
    expiresAt: date.nullable(),
    teamId: z
      .string()
      .regex(/^team_[A-Za-z0-9]+$/)
      .nullable(),
    projectId: z
      .string()
      .regex(/^prj_[A-Za-z0-9]+$/)
      .nullable(),
    region: z
      .string()
      .regex(/^[a-z]{3}[1-9]$/)
      .nullable(),
    image: z
      .string()
      .regex(/^[a-zA-Z0-9./_-]+@sha256:[a-f0-9]{64}$/)
      .nullable(),
    runnerVersion: nonempty,
    maxCreations: count,
    maxRequests: count,
    maxCost: z.number().finite().nonnegative(),
    currency: z.enum(['USD', 'CLP']),
    candidate: z
      .object({
        commit: z
          .string()
          .regex(/^[a-f0-9]{40}$/)
          .nullable(),
        sourceDigest: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
      })
      .strict(),
    approval: z
      .object({
        approvedBy: nonempty.nullable(),
        reference: nonempty.nullable(),
        approvedAt: date.nullable(),
      })
      .strict(),
    rates: z
      .object({
        currency: z.enum(['USD', 'CLP']),
        region: z.string().regex(/^[a-z]{3}[1-9]$/),
        activeCpuPerVcpuHour: z.number().finite().nonnegative(),
        memoryPerGbHour: z.number().finite().nonnegative(),
        creationPerRun: z.number().finite().nonnegative(),
        memoryBillingQuantumSeconds: z.number().int().min(1).max(3600),
        sourceUrl: z.url().refine((url) => url.startsWith('https://')),
        recordedAt: z.iso.date(),
      })
      .strict()
      .nullable(),
    stages: z.array(stageSchema).min(1).max(30),
  })
  .strict();

export function validateCampaign(value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error('CAMPAIGN_SCHEMA_INVALID');
  const manifest = parsed.data;
  if (
    new Set(manifest.stages.map((stage) => stage.id)).size !==
    manifest.stages.length
  )
    throw new Error('CAMPAIGN_DUPLICATE_STAGE');
  return manifest;
}

async function readCampaignJson(path) {
  if ((await stat(path)).size > 262144)
    throw new Error('CAMPAIGN_FILE_TOO_LARGE');
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function loadCampaign(path) {
  return validateCampaign(await readCampaignJson(path));
}

// Sandbox returns team/project/repository@digest for a VCR image. Docker uses
// the registry host as well. Bind both forms to the verified publication.
function imageFromPublication(publication, draft) {
  const match =
    /^vcr\.vercel\.com\/([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)@(sha256:[a-f0-9]{64})$/.exec(
      publication?.registryDigestReference,
    );
  if (!match) throw new Error('VERIFIED_VCR_REFERENCE_REQUIRED');
  const [, teamSlug, project, repository, digest] = match;
  const path = `${teamSlug}/${project}/${repository}`;
  const tagPrefix = `vcr.vercel.com/${path}:`;
  if (
    publication.schemaVersion !== 1 ||
    publication.purpose !== 'publish-and-verify-only' ||
    publication.vcrStatus !== 'ready' ||
    publication.platform !== 'linux/amd64' ||
    publication.repositoryPublic !== false ||
    typeof publication.teamId !== 'string' ||
    typeof publication.projectId !== 'string' ||
    publication.project !== project ||
    publication.repository !== repository ||
    publication.expectedManifestDigest !== digest ||
    publication.observedManifestDigest !== digest ||
    typeof publication.registryTag !== 'string' ||
    !publication.registryTag.startsWith(tagPrefix) ||
    !/^\w[\w.-]{0,127}$/.test(publication.registryTag.slice(tagPrefix.length))
  )
    throw new Error('SANDBOX_PUBLICATION_MISMATCH');

  const image = `${path}@${digest}`;
  const short = `${repository}@${digest}`;
  if (
    (publication.sandboxProjectScopedReference !== undefined &&
      publication.sandboxProjectScopedReference !== short) ||
    (draft.teamId !== null && draft.teamId !== publication.teamId) ||
    (draft.projectId !== null && draft.projectId !== publication.projectId) ||
    (draft.image !== null &&
      ![short, image, publication.registryDigestReference].includes(
        draft.image,
      ))
  )
    throw new Error('CAMPAIGN_PUBLICATION_SCOPE_MISMATCH');
  return image;
}

/** Prepare a new, unapproved campaign locally. Old journals keep their exact original manifest. */
export async function prepareCampaignDirectory(
  draftPath,
  publicationPath,
  outputDirectory,
) {
  const [draft, publication] = await Promise.all([
    loadCampaign(draftPath),
    readCampaignJson(publicationPath),
  ]);
  if (
    draft.authorized ||
    draft.expiresAt !== null ||
    Object.values(draft.approval).some((value) => value !== null)
  )
    throw new Error('UNAPPROVED_DRAFT_REQUIRED');
  const image = imageFromPublication(publication, draft);
  const { commit, sourceDigest } = await readCoverageCandidate(root);
  const campaign = validateCampaign({
    ...draft,
    campaignId: randomUUID(),
    candidate: { commit, sourceDigest },
    teamId: publication.teamId,
    projectId: publication.projectId,
    image,
  });
  const environment = {
    SANDBOX_TEAM_ID: campaign.teamId,
    SANDBOX_PROJECT_ID: campaign.projectId,
    ...(campaign.region === null ? {} : { SANDBOX_REGION: campaign.region }),
    SANDBOX_IMAGE: campaign.image,
  };
  const manifestPath = resolve(outputDirectory, 'campaign.draft.json');
  const envPath = resolve(outputDirectory, 'sandbox.env');
  // A completed manifest appears last. Never replace files from a prior campaign.
  await mkdir(outputDirectory, { mode: 0o700 });
  const created = [];
  async function writeOutput(path, contents) {
    const file = await open(path, 'wx', 0o600);
    created.push(path);
    try {
      await file.writeFile(contents);
    } finally {
      await file.close();
    }
  }
  try {
    await writeOutput(
      envPath,
      Object.entries(environment)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    );
    await writeOutput(manifestPath, JSON.stringify(campaign, null, 2) + '\n');
  } catch (error) {
    await Promise.all(created.map((path) => unlink(path)));
    await rmdir(outputDirectory);
    throw error;
  }
  return { campaign, environment };
}

const canonicalJson = (value) =>
  JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.keys(entry)
            .sort()
            .map((key) => [key, entry[key]]),
        )
      : entry,
  );
export const campaignManifestDigest = (campaign) =>
  createHash('sha256')
    .update(canonicalJson(validateCampaign(campaign)))
    .digest('hex');

/** Kernel-owned local IPC mutex. Process death releases it without stale files.
 * No TCP listener or external connection is used. Journals remain host-local.
 */
export async function acquireCampaignLock(directory) {
  const identity = createHash('sha256')
    .update(await realpath(directory))
    .digest('hex');
  const path =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\alunza-sandbox-${identity}`
      : process.platform === 'linux'
        ? `\0alunza-sandbox-${identity}`
        : null;
  if (!path) throw new Error('CAMPAIGN_LOCK_PLATFORM_UNSUPPORTED');
  const server = createServer((socket) => socket.destroy());
  await new Promise((resolveLock, reject) => {
    server.once('error', () => reject(new Error('CAMPAIGN_ALREADY_ACTIVE')));
    server.listen(path, resolveLock);
  });
  return () =>
    new Promise((resolveLock, reject) =>
      server.close((error) =>
        error
          ? reject(new Error('CAMPAIGN_LOCK_RELEASE_FAILED'))
          : resolveLock(),
      ),
    );
}

function journalWriter(descriptor) {
  return (event) => {
    appendFileSync(
      descriptor,
      `${JSON.stringify({ recordedAt: new Date().toISOString(), ...event })}\n`,
    );
    fsyncSync(descriptor);
  };
}

function recoveryAuthority(campaign, startedAt = Date.now()) {
  const approved = Date.parse(campaign.approval.approvedAt ?? '');
  const expires = Date.parse(campaign.expiresAt ?? '');
  if (
    !campaign.authorized ||
    !campaign.approval.approvedBy ||
    !campaign.approval.reference ||
    !Number.isFinite(approved) ||
    !Number.isFinite(expires) ||
    approved > startedAt ||
    expires <= startedAt ||
    expires - approved > 7 * 86400000 ||
    !campaign.teamId ||
    !campaign.projectId ||
    !campaign.region ||
    !campaign.image ||
    !campaign.candidate.commit ||
    !campaign.candidate.sourceDigest ||
    campaign.maxCreations < 1 ||
    campaign.maxRequests <= 8 * campaign.maxCreations ||
    campaign.maxCost <= 0 ||
    !campaign.stages.some((stage) => stage.enabled) ||
    campaign.stages.some((stage) => stage.enabled && stage.kind !== 'capsule')
  )
    throw new Error('CAMPAIGN_ORIGINAL_AUTHORITY_REQUIRED');
}

function assertResourceIdentity(campaign, correlation, resource) {
  if (
    !resource ||
    resource.sandboxName !== correlation.sandboxName ||
    resource.owner !== campaignOwner ||
    resource.correlationId !== campaign.campaignId ||
    !/^[a-zA-Z0-9_-]{1,160}$/.test(resource.sandboxId ?? '') ||
    ['teamId', 'projectId', 'region', 'image'].some(
      (key) => resource[key] !== campaign[key],
    )
  )
    throw new Error('CAMPAIGN_RESOURCE_RECEIPT_MISMATCH');
}

/** Parse private durable records, never infer a resource from broad provider lists. */
export function readCampaignRecoveryState(campaign, source) {
  let events;
  try {
    if (!source.endsWith('\n')) throw new Error();
    events = source
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
  } catch {
    throw new Error('CAMPAIGN_JOURNAL_INCOMPLETE');
  }
  const header = events[0];
  if (
    header?.kind !== 'campaign-started' ||
    header.journalVersion !== 2 ||
    header.campaignId !== campaign.campaignId ||
    header.manifestDigest !== campaignManifestDigest(campaign) ||
    canonicalJson(header.candidate) !== canonicalJson(campaign.candidate) ||
    !Number.isFinite(Date.parse(header.recordedAt))
  )
    throw new Error('CAMPAIGN_JOURNAL_CONTEXT_MISMATCH');
  recoveryAuthority(campaign, Date.parse(header.recordedAt));
  const allowedKeys = new Set(
    campaign.stages
      .filter((stage) => stage.enabled)
      .flatMap((stage) =>
        stage.fixtures.flatMap((id) =>
          id === 'two-concurrent-executions'
            ? [`${stage.id}:${id}:a`, `${stage.id}:${id}:b`]
            : [`${stage.id}:${id}`],
        ),
      ),
  );
  const resources = new Map();
  const names = new Set();
  let normalRequests = 0;
  let cleanupRequests = 0;
  for (const event of events.slice(1)) {
    if (!Number.isFinite(Date.parse(event.recordedAt)))
      throw new Error('CAMPAIGN_JOURNAL_EVENT_INVALID');
    if (event.kind === 'creation-reserved') {
      const value = event.correlation;
      if (
        !allowedKeys.has(event.key) ||
        resources.has(event.key) ||
        !value ||
        value.schemaVersion !== 1 ||
        !/^alunza-runner-[a-f0-9-]{36}$/.test(value.sandboxName ?? '') ||
        names.has(value.sandboxName) ||
        value.owner !== campaignOwner ||
        value.correlationId !== campaign.campaignId ||
        value.maxCreateDispatches !== 1 ||
        !Number.isSafeInteger(value.requestedVmTimeoutMs) ||
        value.requestedVmTimeoutMs < 1 ||
        value.requestedVmTimeoutMs > 60000 ||
        Date.parse(event.recordedAt) < Date.parse(header.recordedAt) ||
        Date.parse(event.recordedAt) >= Date.parse(campaign.expiresAt) ||
        ['teamId', 'projectId', 'region', 'image'].some(
          (key) => value[key] !== campaign[key],
        )
      )
        throw new Error('CAMPAIGN_JOURNAL_CORRELATION_INVALID');
      names.add(value.sandboxName);
      resources.set(event.key, {
        key: event.key,
        correlation: value,
        sandboxId: null,
        verified: false,
      });
    } else if (event.kind === 'resource-confirmed') {
      const resource = resources.get(event.key);
      if (!resource) throw new Error('CAMPAIGN_JOURNAL_RECEIPT_UNRESERVED');
      assertResourceIdentity(campaign, resource.correlation, event.resource);
      if (resource.sandboxId && resource.sandboxId !== event.resource.sandboxId)
        throw new Error('CAMPAIGN_JOURNAL_RECEIPT_CHANGED');
      resource.sandboxId = event.resource.sandboxId;
    } else if (
      ['request-reserved', 'cleanup-request-reserved'].includes(event.kind)
    ) {
      if (!resources.has(event.key))
        throw new Error('CAMPAIGN_JOURNAL_REQUEST_UNRESERVED');
      if (event.kind === 'request-reserved') normalRequests++;
      else cleanupRequests++;
    } else if (event.kind === 'resource-cleanup-verified') {
      const resource = resources.get(event.key);
      if (
        !resource?.sandboxId ||
        event.sandboxId !== resource.sandboxId ||
        event.cleanupCheck !== 'ABSENT_AND_ZERO_SNAPSHOTS' ||
        event.snapshotsRemaining !== 0
      )
        throw new Error('CAMPAIGN_JOURNAL_CLEANUP_UNVERIFIED');
      resource.verified = true;
    } else if (
      ![
        'case',
        'campaign-finished',
        'recovery-started',
        'recovery-result',
        'recovery-finished',
      ].includes(event.kind)
    )
      throw new Error('CAMPAIGN_JOURNAL_EVENT_INVALID');
  }
  if (
    resources.size > campaign.maxCreations ||
    normalRequests > campaign.maxRequests - 8 * campaign.maxCreations ||
    normalRequests + cleanupRequests > campaign.maxRequests
  )
    throw new Error('CAMPAIGN_JOURNAL_QUOTA_INVALID');
  return { resources, normalRequests, cleanupRequests };
}

export function capsuleInventory(stage) {
  const ids = new Set(runnerFixtures.map((fixture) => fixture.id));
  const cases = stage.fixtures.map((id) => ({
    id,
    kind: id.startsWith('os-')
      ? 'trusted-os-probe'
      : lifecycleFixtureIds.includes(id)
        ? 'trusted-lifecycle-fixture'
        : 'student-fixture',
    implemented:
      ids.has(id) ||
      osProbeNames.some((name) => id === `os-${name}`) ||
      lifecycleFixtureIds.includes(id),
    creations: id === 'two-concurrent-executions' ? 2 : 1,
    provider: 'VERCEL',
    status: 'NOT_RUN',
  }));
  const blockers = [];
  if (!cases.length || new Set(stage.fixtures).size !== cases.length)
    blockers.push('CAPSULE_FIXTURES_EMPTY_OR_DUPLICATED');
  if (cases.some((item) => !item.implemented))
    blockers.push('CAPSULE_FIXTURE_NOT_IMPLEMENTED');
  // Finite, explicit HTTP allowance includes SDK calls/retries, not just create.
  // Runtime stops at this budget; this estimate never promises all calls succeed.
  const normalRequests = cases.reduce((sum, item) => {
    const fixture = runnerFixtures.find((entry) => entry.id === item.id);
    return sum + item.creations * (16 + 12 * (fixture?.tests.length ?? 1));
  }, 0);
  return {
    implemented: blockers.length === 0,
    cases,
    creations: cases.reduce((sum, item) => sum + item.creations, 0),
    normalRequests,
    maxDurationSeconds: cases.reduce(
      (sum, item) => sum + (item.id === 'natural-vm-timeout-60s' ? 90 : 40),
      0,
    ),
    blockers,
  };
}

export function estimateCampaignCost(manifest, creations) {
  const rates = manifest.rates;
  if (
    !rates ||
    rates.currency !== manifest.currency ||
    rates.region !== manifest.region
  )
    return { status: 'EXPLICIT_REGIONAL_RATES_REQUIRED', modeled: null };
  // Provider TTL is60s, distinct from operation30s + cleanup10s.
  const vmSeconds = 60;
  const billedMemorySeconds =
    Math.ceil(vmSeconds / rates.memoryBillingQuantumSeconds) *
    rates.memoryBillingQuantumSeconds;
  const cpu = creations * (vmSeconds / 3600) * rates.activeCpuPerVcpuHour;
  const memory =
    creations * 2 * (billedMemorySeconds / 3600) * rates.memoryPerGbHour;
  const creation = creations * rates.creationPerRun;
  return {
    status: 'MODEL_ONLY',
    currency: manifest.currency,
    region: manifest.region,
    rates,
    creations,
    vcpus: 1,
    memoryGb: 2,
    vmSeconds,
    billedMemorySeconds,
    modeled: { cpu, memory, creation, total: cpu + memory + creation },
    exclusions: [
      'Not a bill or automatic spending cutoff',
      'API/ACA, registry, logs, databases and other providers',
      'Subscription, taxes, transfer and actual currency conversion',
      'Any resource that outlives its provider TTL or cleanup failure',
    ],
  };
}

export async function planCampaign(value, { apiPlanner } = {}) {
  const campaign = validateCampaign(value);
  const stages = [];
  for (const stage of campaign.stages.filter((item) => item.enabled)) {
    let planned;
    if (stage.kind === 'capsule') planned = capsuleInventory(stage);
    else if (apiPlanner) planned = await apiPlanner(stage, campaign);
    else
      planned = {
        implemented: false,
        cases: [],
        creations: 0,
        normalRequests: 0,
        maxDurationSeconds: 0,
        blockers: ['API_HARNESS_UNAVAILABLE'],
      };
    const blockers = [...(planned.blockers ?? [])];
    if (!planned.implemented) blockers.push('STAGE_NOT_IMPLEMENTED');
    if (
      ![
        planned.creations,
        planned.normalRequests,
        planned.maxDurationSeconds,
      ].every((number) => Number.isSafeInteger(number) && number >= 0)
    )
      throw new Error('CAMPAIGN_INVALID_STAGE_INVENTORY');
    if (stage.creations < planned.creations)
      blockers.push('STAGE_CREATIONS_INSUFFICIENT');
    if (stage.maxRequests < planned.normalRequests + 8 * stage.creations)
      blockers.push('STAGE_REQUESTS_INSUFFICIENT');
    if (stage.maxDurationSeconds < planned.maxDurationSeconds)
      blockers.push('STAGE_DURATION_INSUFFICIENT');
    stages.push({
      id: stage.id,
      kind: stage.kind,
      implemented: planned.implemented,
      cases: planned.cases,
      creations: stage.creations,
      normalRequests: planned.normalRequests,
      cleanupRequests: 8 * stage.creations,
      maxRequests: stage.maxRequests,
      clientRequests: planned.clientRequests ?? 0,
      maxDurationSeconds: stage.maxDurationSeconds,
      blockers,
    });
  }
  const totals = {
    creations: stages.reduce((sum, stage) => sum + stage.creations, 0),
    requests: stages.reduce((sum, stage) => sum + stage.maxRequests, 0),
    clientRequests: stages.reduce(
      (sum, stage) => sum + stage.clientRequests,
      0,
    ),
    cleanupReserved: 8 * campaign.maxCreations,
    durationSeconds: stages.reduce(
      (sum, stage) => sum + stage.maxDurationSeconds,
      0,
    ),
    cases: stages.reduce((sum, stage) => sum + stage.cases.length, 0),
  };
  const blockers = stages.flatMap((stage) =>
    stage.blockers.map((code) => `${stage.id}:${code}`),
  );
  if (!stages.length) blockers.push('NO_ENABLED_STAGES');
  if (totals.creations > campaign.maxCreations || !campaign.maxCreations)
    blockers.push('CAMPAIGN_CREATIONS_INSUFFICIENT');
  if (
    totals.requests > campaign.maxRequests ||
    campaign.maxRequests <= totals.cleanupReserved ||
    totals.requests + 8 * (campaign.maxCreations - totals.creations) >
      campaign.maxRequests
  )
    blockers.push('CAMPAIGN_REQUESTS_INSUFFICIENT');
  // Local capsule reservations and runtime DB reservations are distinct ledgers.
  // Separate campaign IDs prevent a claimed shared ceiling that cannot be enforced.
  if (
    stages.some((stage) => stage.kind === 'capsule') &&
    stages.some((stage) => stage.kind !== 'capsule')
  )
    blockers.push('SEPARATE_CAPSULE_AND_API_CAMPAIGNS_REQUIRED');
  const cost = estimateCampaignCost(campaign, campaign.maxCreations);
  if (cost.modeled === null) blockers.push('EXPLICIT_REGIONAL_RATES_REQUIRED');
  else if (cost.modeled.total > campaign.maxCost || campaign.maxCost <= 0)
    blockers.push('CAMPAIGN_COST_INSUFFICIENT');
  return {
    schemaVersion: 1,
    campaignId: campaign.campaignId,
    status: 'PLAN_ONLY',
    remote: 'NOT_RUN',
    acceptance: 'NOT_ACCEPTED',
    stages,
    totals,
    cost,
    blockers,
  };
}

export async function preflightCampaign(value, options = {}) {
  const campaign = validateCampaign(value);
  const plan = await planCampaign(campaign, options);
  const now = options.now ?? Date.now();
  const env = options.env ?? process.env;
  const blockers = [...plan.blockers];
  for (const stage of campaign.stages.filter(
    (item) => item.enabled && item.kind !== 'capsule',
  )) {
    if (!options.apiPreflight)
      blockers.push(`${stage.id}:API_PREFLIGHT_UNAVAILABLE`);
    else {
      const checked = await options.apiPreflight(stage, env);
      blockers.push(...checked.blockers.map((code) => `${stage.id}:${code}`));
    }
  }
  if (!campaign.authorized) blockers.push('CAMPAIGN_NOT_AUTHORIZED');
  if (
    !campaign.approval.approvedBy ||
    !campaign.approval.reference ||
    !campaign.approval.approvedAt
  )
    blockers.push('REFERENCED_APPROVAL_REQUIRED');
  const approvedAt = Date.parse(campaign.approval.approvedAt ?? '');
  const expiresAt = Date.parse(campaign.expiresAt ?? '');
  if (
    !Number.isFinite(approvedAt) ||
    approvedAt > now ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt <= approvedAt ||
    expiresAt - approvedAt > 7 * 86400000
  )
    blockers.push('CAMPAIGN_WINDOW_INVALID');
  else if (expiresAt - now < plan.totals.durationSeconds * 1000)
    blockers.push('CAMPAIGN_WINDOW_TOO_SHORT');
  if (campaign.rates && Date.parse(campaign.rates.recordedAt) > now)
    blockers.push('RATES_DATE_IN_FUTURE');
  if (
    !campaign.teamId ||
    !campaign.projectId ||
    !campaign.region ||
    !campaign.image
  )
    blockers.push('EXACT_DESTINATION_REQUIRED');
  const capsuleSelected = campaign.stages.some(
    (stage) => stage.enabled && stage.kind === 'capsule',
  );
  if (capsuleSelected && !env.VERCEL_TOKEN)
    blockers.push('VERCEL_TOKEN_REQUIRED');
  for (const [key, expected] of [
    ['SANDBOX_TEAM_ID', campaign.teamId],
    ['SANDBOX_PROJECT_ID', campaign.projectId],
    ['SANDBOX_REGION', campaign.region],
    ['SANDBOX_IMAGE', campaign.image],
  ]) {
    if (capsuleSelected && (!expected || env[key] !== expected))
      blockers.push(`${key}_MISMATCH`);
  }
  const candidate = options.candidate ?? (await readCoverageCandidate(root));
  if (
    !campaign.candidate.commit ||
    !campaign.candidate.sourceDigest ||
    candidate.commit !== campaign.candidate.commit ||
    candidate.sourceDigest !== campaign.candidate.sourceDigest
  )
    blockers.push('CANDIDATE_MISMATCH');
  if (options.runnerVersion !== campaign.runnerVersion)
    blockers.push('BUILT_RUNNER_VERSION_MISMATCH');
  return {
    ...plan,
    status: blockers.length ? 'BLOCKED' : 'READY_FOR_AUTHORIZED_EXECUTION',
    blockers: [...new Set(blockers)],
    candidate: {
      commit: candidate.commit,
      sourceDigest: candidate.sourceDigest,
    },
  };
}

/** One private journal per immutable campaign; no automatic resume or redispatch. */
export class CampaignBudget {
  constructor(campaign, { now = Date.now, persist = () => {} } = {}) {
    this.campaign = campaign;
    this.now = now;
    this.persist = persist;
    this.creations = 0;
    this.normalRequests = 0;
    this.cleanupRequests = 0;
    this.reservations = new Set();
    this.correlations = new Map();
    this.resourceIds = new Map();
    this.verified = new Set();
    this.cleanupByReservation = new Map();
  }
  reserveCreation(key, correlation) {
    if (
      this.now() >= Date.parse(this.campaign.expiresAt) ||
      this.creations >= this.campaign.maxCreations ||
      this.reservations.has(key)
    )
      throw new Error('CAMPAIGN_CREATION_BUDGET_EXHAUSTED');
    this.persist({ kind: 'creation-reserved', key, correlation });
    this.reservations.add(key);
    this.correlations.set(key, correlation);
    this.creations++;
  }
  recordResource(key, resource) {
    const correlation = this.correlations.get(key);
    if (!correlation) throw new Error('CAMPAIGN_RESOURCE_UNRESERVED');
    assertResourceIdentity(this.campaign, correlation, resource);
    if (
      this.resourceIds.has(key) &&
      this.resourceIds.get(key) !== resource.sandboxId
    )
      throw new Error('CAMPAIGN_RESOURCE_RECEIPT_CHANGED');
    this.persist({ kind: 'resource-confirmed', key, resource });
    this.resourceIds.set(key, resource.sandboxId);
  }
  recordCleanup(key, evidence) {
    if (this.verified.has(key) || !this.reservations.has(key)) return;
    if (
      !evidence.cleanupVerified ||
      evidence.cleanupCheck !== 'ABSENT_AND_ZERO_SNAPSHOTS' ||
      evidence.snapshotsRemaining !== 0 ||
      !this.resourceIds.get(key) ||
      evidence.sandboxId !== this.resourceIds.get(key)
    )
      return;
    this.persist({
      kind: 'resource-cleanup-verified',
      key,
      sandboxId: evidence.sandboxId,
      cleanupCheck: evidence.cleanupCheck,
      snapshotsRemaining: 0,
    });
    this.verified.add(key);
  }
  allowRequest(cleanup = false, key = 'api') {
    if (cleanup) {
      if (!this.reservations.has(key))
        throw new Error('CAMPAIGN_CLEANUP_RESERVATION_REQUIRED');
      const entry = this.cleanupByReservation.get(key) ?? {
        calls: 0,
        deadline: this.now() + 10000,
      };
      if (entry.calls >= 8 || this.now() >= entry.deadline)
        throw new Error('CAMPAIGN_CLEANUP_BUDGET_EXHAUSTED');
      this.persist({ kind: 'cleanup-request-reserved', key });
      entry.calls++;
      this.cleanupByReservation.set(key, entry);
      this.cleanupRequests++;
    } else {
      if (
        this.cleanupByReservation.has(key) ||
        this.now() >= Date.parse(this.campaign.expiresAt) ||
        this.normalRequests >=
          this.campaign.maxRequests - 8 * this.campaign.maxCreations
      )
        throw new Error('CAMPAIGN_REQUEST_BUDGET_EXHAUSTED');
      this.persist({ kind: 'request-reserved', key });
      this.normalRequests++;
    }
  }
}

export function evaluateFixture(fixture, result, publicProjection) {
  return (
    result.diagnosisCode === fixture.expected &&
    (!fixture.reason || fixture.reason === result.terminationReason) &&
    result.evidence.cleanupVerified === true &&
    (fixture.expectedStdout === undefined ||
      result.visibleTestResults[0]?.stdout === fixture.expectedStdout) &&
    (!fixture.privateSentinel ||
      !JSON.stringify(publicProjection).includes(fixture.privateSentinel))
  );
}

export function evaluateOsProbe(probe, response) {
  const packet = response.packet;
  const oom =
    response.oomKilled ||
    /^oom_kill [1-9]\d*$/m.test(packet?.cgroup?.['memory.events'] ?? '');
  let value;
  try {
    const envelope = JSON.parse(
      Buffer.from(packet.returnData, 'base64').toString('utf8'),
    );
    if (envelope.kind === 'probe') value = envelope.value;
  } catch {
    /* A missing trusted envelope is never a pass. */
  }
  let pass = response.cleanupVerified === true;
  if (probe === 'memory' || probe === 'descendant-memory') pass &&= !!oom;
  else {
    pass &&=
      response.exitCode === 0 &&
      packet?.exitCode === 0 &&
      !response.timedOut &&
      !oom;
    if (probe === 'identity')
      pass &&=
        value?.uid === 10001 &&
        Object.values(value?.capabilities ?? {}).length === 5 &&
        Object.values(value.capabilities).every(
          (cap) => cap === '0000000000000000',
        );
    else if (probe === 'permissions')
      pass &&=
        value?.parentDenied === true &&
        value?.readonly === true &&
        JSON.stringify(value?.environment) ===
          JSON.stringify(['HOME', 'LANG', 'PATH']);
    else if (probe === 'processes')
      pass &&=
        value?.attempted === 40 &&
        value.started > 0 &&
        value.started < 40 &&
        value.started + value.eagain === 40 &&
        value.eagain > 0 &&
        value.unexpectedErrors === 0 &&
        value.pidsMax === 32 &&
        value.pidsCurrent <= 32 &&
        value.identitiesValid === true;
    else if (probe === 'network')
      pass &&=
        value?.loopbackOnly === true &&
        ['dns', 'ipv6', 'udp'].every((key) =>
          [
            'ENETUNREACH',
            'EHOSTUNREACH',
            'EACCES',
            'EPERM',
            'ECONNREFUSED',
          ].includes(value[key]),
        );
    else pass = false;
  }
  return {
    passed: !!pass,
    oomObserved: !!oom,
    trustedObservationAvailable: value !== undefined,
  };
}

function campaignAdapter(runner, context, key, extra = {}) {
  const natural = extra.acceptance?.naturalTimeoutObservation === true;
  const adapter = new runner.VercelAdapter({
    authorized: true,
    expiresAtMs: context.deadline,
    token: context.env.VERCEL_TOKEN,
    teamId: context.campaign.teamId,
    projectId: context.campaign.projectId,
    region: context.campaign.region,
    image: context.campaign.image,
    owner: campaignOwner,
    correlationId: context.campaign.campaignId,
    normalDeadlineMs: Math.min(Date.now() + 30000, context.deadline),
    cleanupDeadlineMs: Math.min(
      Date.now() + (natural ? 90000 : 40000),
      context.deadline + 10000,
    ),
    recordCorrelation: async (correlation) =>
      context.reserveCreation(key, correlation),
    allowRequest: (cleanup) => context.allowRequest(cleanup, key),
    ...extra,
    recordResource: async (resource) => {
      await context.recordResource?.(key, resource);
      await extra.recordResource?.(resource);
    },
  });
  const close = adapter.close.bind(adapter);
  adapter.close = async () => {
    try {
      return await close();
    } finally {
      await context.recordCleanup?.(key, adapter.evidence);
    }
  };
  return adapter;
}

function fixtureInput(fixture) {
  return {
    executionId: randomUUID(),
    requestId: 'imp-03-07-campaign',
    exerciseVersionId: 'synthetic-v1',
    testsVersion: 'synthetic-v1',
    mode: fixture.mode ?? 'RUN',
    entrypoint: 'solve',
    code: fixture.code,
    tests: fixture.tests,
  };
}

// The journal and the campaign report receive only this fixed set of command
// fields, including when a future adapter adds other diagnostic properties.
const driverCommandSchema = z.object({
  exitCode: z.number().int().min(0).max(255).nullable(),
  stdoutPresent: z.boolean(),
  stderrPresent: z.boolean(),
  failureMarker: z.boolean(),
  phase: z.enum(Object.keys(remoteDriverExitCodes)).nullable(),
});

function safeDriverCommand(command) {
  const parsed = driverCommandSchema.safeParse(command);
  return parsed.success ? parsed.data : null;
}

function safeSandboxEvidence(adapter) {
  const item = adapter.evidence;
  const command = safeDriverCommand(item.driverCommand);
  return {
    bootstrapVerified: item.remote === 'BOOTSTRAPPED',
    cleanupVerified: item.cleanupVerified === true,
    createDispatches: item.createDispatches,
    activeCpuMs: item.activeCpuMs,
    provisionedDurationMs: item.provisionedDurationMs,
    region: item.region,
    vcpus: item.vcpus,
    memoryMb: item.memoryMb,
    requestedVmTimeoutMs: item.requestedVmTimeoutMs,
    effectiveVmTimeoutMs: item.effectiveVmTimeoutMs,
    persistent: item.persistent,
    networkPolicy: item.networkPolicy,
    cpuCfsQuota:
      typeof item.cpuCfsQuota === 'boolean' ? item.cpuCfsQuota : null,
    cpuCfsPeriod:
      typeof item.cpuCfsPeriod === 'boolean' ? item.cpuCfsPeriod : null,
    driverCommand: command,
    driverStartFailure:
      command?.phase === 'START' &&
      command.exitCode === remoteDriverExitCodes.START &&
      command.failureMarker &&
      command.stderrPresent &&
      !command.stdoutPresent
        ? safeRemoteStartFailureDetail(item.driverStartFailure)
        : null,
    driverCleanupCommand: safeDriverCommand(item.driverCleanupCommand),
    cleanupCheck: item.cleanupCheck,
    snapshotsRemaining: item.snapshotsRemaining,
  };
}

/** Real remote lifecycle operations; test injection never becomes remote evidence. */
export async function executeLifecycleFixture(
  id,
  stage,
  context,
  runner,
  wait = delay,
) {
  const key = `${stage.id}:${id}`;
  const started = Date.now();
  if (id === 'two-concurrent-executions') {
    const fixture = runnerFixtures.find(
      (item) => item.id === 'sync-json-success',
    );
    const adapters = [
      campaignAdapter(runner, context, `${key}:a`),
      campaignAdapter(runner, context, `${key}:b`),
    ];
    let correct;
    try {
      const variants = [
        fixture,
        {
          ...fixture,
          tests: [
            { ...fixture.tests[0], args: [20, 30], expected: { sum: 50 } },
          ],
        },
      ];
      const results = await Promise.allSettled(
        variants.map((variant, index) =>
          runner.execute(
            fixtureInput(variant),
            adapters[index],
            AbortSignal.timeout(
              Math.max(1, Math.min(30000, context.deadline - Date.now())),
            ),
          ),
        ),
      );
      correct =
        results.every(
          (result, index) =>
            result.status === 'fulfilled' &&
            evaluateFixture(
              variants[index],
              result.value,
              runner.publicResult(result.value),
            ),
        ) &&
        adapters[0].evidence.sandboxName !== adapters[1].evidence.sandboxName &&
        adapters.every(
          (adapter) =>
            !!adapter.evidence.sandboxName &&
            adapter.evidence.createDispatches === 1,
        );
    } finally {
      await Promise.allSettled(adapters.map((adapter) => adapter.close()));
    }
    return {
      id,
      status:
        correct && adapters.every((adapter) => adapter.evidence.cleanupVerified)
          ? 'PASS'
          : 'FAIL',
      provider: 'VERCEL',
      durationMs: Date.now() - started,
      distinctResources:
        adapters[0].evidence.sandboxName !== adapters[1].evidence.sandboxName,
      resources: adapters.map(safeSandboxEvidence),
    };
  }
  let dispatched = false;
  let confirmedAt;
  let cancellationTimer;
  const cancel = new AbortController();
  const acceptance =
    id === 'cancellation'
      ? {
          onCapsuleDispatched: () => {
            dispatched = true;
            cancellationTimer = setTimeout(() => cancel.abort(), 100);
          },
        }
      : id === 'uncertain-creation-reconciliation'
        ? { discardCreateResponse: true }
        : { naturalTimeoutObservation: true };
  const adapter = campaignAdapter(runner, context, key, {
    acceptance,
    recordResource: async () => {
      confirmedAt = Date.now();
    },
  });
  let pass = false;
  const details = {};
  try {
    const fixture = runnerFixtures.find(
      (item) =>
        item.id ===
        (id === 'cancellation' ? 'infinite-loop' : 'sync-json-success'),
    );
    const input = {
      executionId: randomUUID(),
      code: fixture.code,
      args: fixture.tests[0].args,
      budgetMs: 3000,
      outputRemaining: 65536,
    };
    const signal = AbortSignal.any([
      cancel.signal,
      AbortSignal.timeout(
        Math.max(1, Math.min(30000, context.deadline - Date.now())),
      ),
    ]);
    let response;
    let rejected = false;
    try {
      response = await adapter.execute(input, signal);
    } catch {
      rejected = true;
    }
    if (id === 'cancellation') {
      pass =
        dispatched &&
        cancel.signal.aborted &&
        rejected &&
        adapter.evidence.createDispatches === 1;
      Object.assign(details, {
        dispatchObserved: dispatched,
        cancellationObserved: cancel.signal.aborted,
        executionRejected: rejected,
      });
    } else if (id === 'uncertain-creation-reconciliation') {
      pass =
        rejected &&
        adapter.evidence.acceptanceFault === 'CREATE_RESPONSE_DISCARDED' &&
        adapter.evidence.createDispatches === 1;
      Object.assign(details, {
        fault: adapter.evidence.acceptanceFault ?? null,
        faultKind: 'REAL_CREATE_RESPONSE_DISCARDED_BY_TRUSTED_HARNESS',
        executionRejected: rejected,
      });
    } else if (id === 'natural-vm-timeout-60s') {
      if (
        !rejected &&
        response?.cleanupVerified &&
        confirmedAt &&
        adapter.evidence.effectiveVmTimeoutMs === 60000
      ) {
        const firstReadAt = Math.min(confirmedAt + 61000, started + 80000);
        await wait(Math.max(1, firstReadAt - Date.now()), undefined, {
          signal: context.signal,
        });
        let observed = await adapter.observeNaturalTimeout();
        // At most one second read, only when provider timestamps prove when the
        // same session should expire. Never stop/cancel before that observation.
        if (
          !observed.verified &&
          observed.sessionStatus === 'running' &&
          Number.isFinite(observed.expiresAtMs) &&
          observed.expiresAtMs + 1000 < started + 85000
        ) {
          await wait(
            Math.max(1, observed.expiresAtMs + 1000 - Date.now()),
            undefined,
            { signal: context.signal },
          );
          observed = await adapter.observeNaturalTimeout();
        }
        pass = observed.verified === true;
        const { sandboxId: _sandboxId, ...safeObservation } = observed;
        Object.assign(details, {
          naturalTimeoutObservation: safeObservation,
          noStopBeforeObservation: true,
        });
      }
    }
  } catch {
    pass = false;
    details.failure = 'LIFECYCLE_OBSERVATION_FAILED';
  } finally {
    if (cancellationTimer) clearTimeout(cancellationTimer);
    await adapter.close().catch(() => {});
  }
  return {
    id,
    status: pass && adapter.evidence.cleanupVerified ? 'PASS' : 'FAIL',
    provider: 'VERCEL',
    durationMs: Date.now() - started,
    ...details,
    ...safeSandboxEvidence(adapter),
  };
}

export async function executeCapsuleStage(stage, context, runner) {
  const cases = [];
  for (const id of stage.fixtures) {
    if (Date.now() >= context.deadline)
      throw new Error('CAMPAIGN_STAGE_DEADLINE');
    if (lifecycleFixtureIds.includes(id)) {
      const outcome = await executeLifecycleFixture(id, stage, context, runner);
      cases.push(outcome);
      context.appendEvidence({ kind: 'case', stageId: stage.id, ...outcome });
      if (outcome.status !== 'PASS') break;
      continue;
    }
    const key = `${stage.id}:${id}`;
    const probe = id.startsWith('os-') ? id.slice(3) : undefined;
    const adapter = campaignAdapter(
      runner,
      context,
      key,
      probe ? { trustedProbe: probe } : {},
    );
    const started = Date.now();
    let outcome;
    try {
      const signal = AbortSignal.timeout(
        Math.max(1, Math.min(30000, context.deadline - Date.now())),
      );
      if (probe) {
        let response;
        try {
          response = await adapter.execute(
            {
              executionId: randomUUID(),
              code: '',
              args: [],
              budgetMs: 3000,
              outputRemaining: 65536,
            },
            signal,
          );
        } finally {
          await adapter.close();
        }
        const observed = evaluateOsProbe(probe, response);
        outcome = {
          id,
          status:
            observed.passed && adapter.evidence.cleanupVerified
              ? 'PASS'
              : 'FAIL',
          ...observed,
        };
      } else {
        const fixture = runnerFixtures.find((item) => item.id === id);
        const result = await runner.execute(
          fixtureInput(fixture),
          adapter,
          signal,
        );
        outcome = {
          id,
          status:
            evaluateFixture(fixture, result, runner.publicResult(result)) &&
            adapter.evidence.cleanupVerified
              ? 'PASS'
              : 'FAIL',
          diagnosis: result.diagnosisCode,
          reason: result.terminationReason,
          runtimeMs: result.runtimeMs,
          outputBytes: result.outputBytes,
          outputTruncated: result.outputTruncated,
        };
      }
    } catch {
      outcome = { id, status: 'FAIL', reason: 'REMOTE_CASE_FAILED' };
    } finally {
      await adapter.close().catch(() => {});
    }
    // Explicit safe projection: never command stdout, code, arguments or errors.
    Object.assign(outcome, {
      provider: 'VERCEL',
      durationMs: Date.now() - started,
      ...safeSandboxEvidence(adapter),
    });
    if (!outcome.cleanupVerified) outcome.status = 'FAIL';
    cases.push(outcome);
    context.appendEvidence({ kind: 'case', stageId: stage.id, ...outcome });
    if (outcome.status !== 'PASS') break;
  }
  return {
    status:
      cases.length === stage.fixtures.length &&
      cases.every((item) => item.status === 'PASS')
        ? 'PASS'
        : 'FAIL',
    cases,
  };
}

export async function runCampaign(
  value,
  {
    env = process.env,
    apiPlanner,
    apiPreflight,
    apiExecutor,
    runner,
    candidate,
    evidenceDirectory = resolve(root, '.local/evidence/imp-03-07'),
  } = {},
) {
  const campaign = validateCampaign(value);
  const preflight = await preflightCampaign(campaign, {
    env,
    apiPlanner,
    apiPreflight,
    candidate,
    runnerVersion: runner?.RUNNER_VERSION,
  });
  if (preflight.blockers.length) throw new Error('CAMPAIGN_PREFLIGHT_BLOCKED');
  if (
    campaign.stages.some(
      (stage) => stage.enabled && stage.kind !== 'capsule',
    ) &&
    !apiExecutor
  )
    throw new Error('API_HARNESS_UNAVAILABLE');
  const directory = resolve(evidenceDirectory, campaign.campaignId);
  await mkdir(directory, { recursive: true });
  const releaseLock = await acquireCampaignLock(directory);
  const journalPath = resolve(directory, 'journal.private.jsonl');
  // An existing journal is an uncertain prior run. Manual reconciliation is
  // required; changing a flag or re-running the CLI cannot authorize another run.
  let descriptor;
  try {
    descriptor = openSync(journalPath, 'wx', 0o600);
  } catch (error) {
    await releaseLock();
    throw error;
  }
  const persist = journalWriter(descriptor);
  const budget = new CampaignBudget(campaign, { persist });
  const report = {
    schemaVersion: 1,
    campaignId: campaign.campaignId,
    candidate: campaign.candidate,
    runnerVersion: campaign.runnerVersion,
    recordedAt: new Date().toISOString(),
    provider: 'VERCEL',
    environment: 'REMOTE',
    acceptance: 'NOT_ACCEPTED',
    status: 'FAIL',
    stages: [],
  };
  try {
    persist({
      kind: 'campaign-started',
      journalVersion: 2,
      campaignId: campaign.campaignId,
      candidate: campaign.candidate,
      manifestDigest: campaignManifestDigest(campaign),
    });
    for (const stage of campaign.stages.filter((item) => item.enabled)) {
      const deadline = Math.min(
        Date.parse(campaign.expiresAt),
        Date.now() + stage.maxDurationSeconds * 1000,
      );
      let stageRequests = 0;
      let stageCreations = 0;
      const context = {
        campaign,
        env,
        deadline,
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        reserveCreation: (key, correlation) => {
          if (stageCreations >= stage.creations || Date.now() >= deadline)
            throw new Error('CAMPAIGN_STAGE_CREATIONS_EXHAUSTED');
          budget.reserveCreation(key, correlation);
          stageCreations++;
        },
        recordResource: (key, resource) => budget.recordResource(key, resource),
        recordCleanup: (key, evidence) => budget.recordCleanup(key, evidence),
        allowRequest: (cleanup, key) => {
          if (
            !cleanup &&
            (stageRequests >= stage.maxRequests - 8 * stage.creations ||
              Date.now() >= deadline)
          )
            throw new Error('CAMPAIGN_STAGE_REQUESTS_EXHAUSTED');
          budget.allowRequest(cleanup, key);
          if (!cleanup) stageRequests++;
        },
        appendEvidence: persist,
      };
      const result =
        stage.kind === 'capsule'
          ? await executeCapsuleStage(stage, context, runner)
          : await apiExecutor(stage, context);
      report.stages.push({ id: stage.id, kind: stage.kind, ...result });
      if (result.status !== 'PASS') break;
    }
    report.status =
      report.stages.length ===
        campaign.stages.filter((stage) => stage.enabled).length &&
      report.stages.every((stage) => stage.status === 'PASS')
        ? 'PASS'
        : 'FAIL';
  } catch {
    report.status = 'FAIL';
    report.failure = 'CAMPAIGN_EXECUTION_FAILED';
  } finally {
    report.localProviderRequests =
      budget.normalRequests + budget.cleanupRequests;
    report.localCreationReservations = budget.creations;
    report.costObserved = null;
    try {
      const after = await readCoverageCandidate(root);
      report.candidateAfter = {
        commit: after.commit,
        sourceDigest: after.sourceDigest,
      };
      report.sourceStable =
        after.commit === campaign.candidate.commit &&
        after.sourceDigest === campaign.candidate.sourceDigest;
    } catch {
      report.sourceStable = false;
    }
    if (!report.sourceStable) {
      report.status = 'FAIL';
      report.failure = 'CANDIDATE_CHANGED_OR_UNVERIFIABLE';
    }
    try {
      try {
        persist({ kind: 'campaign-finished', status: report.status });
      } finally {
        closeSync(descriptor);
      }
      await writeFile(
        resolve(directory, 'report.json'),
        `${JSON.stringify(report, null, 2)}\n`,
        { mode: 0o600, flag: 'wx' },
      );
    } finally {
      await releaseLock();
    }
  }
  return report;
}

/** Cleanup-only continuation of an already authorized, immutable local journal. */
export async function recoverCampaign(
  value,
  {
    env = process.env,
    runner,
    evidenceDirectory = resolve(root, '.local/evidence/imp-03-07'),
  } = {},
) {
  const campaign = validateCampaign(value);
  const directory = resolve(evidenceDirectory, campaign.campaignId);
  const releaseLock = await acquireCampaignLock(directory);
  let descriptor;
  try {
    const journalPath = resolve(directory, 'journal.private.jsonl');
    if ((await stat(journalPath)).size > 64 * 1024 * 1024)
      throw new Error('CAMPAIGN_JOURNAL_TOO_LARGE');
    const state = readCampaignRecoveryState(
      campaign,
      await readFile(journalPath, 'utf8'),
    );
    if (
      !env.VERCEL_TOKEN ||
      ['teamId', 'projectId', 'region', 'image'].some(
        (key) =>
          env[
            {
              teamId: 'SANDBOX_TEAM_ID',
              projectId: 'SANDBOX_PROJECT_ID',
              region: 'SANDBOX_REGION',
              image: 'SANDBOX_IMAGE',
            }[key]
          ] !== campaign[key],
      ) ||
      typeof runner?.recoverVercelSandbox !== 'function'
    )
      throw new Error('CAMPAIGN_RECOVERY_CONFIGURATION_REQUIRED');
    descriptor = openSync(journalPath, 'a', 0o600);
    const persist = journalWriter(descriptor);
    const recoveryId = randomUUID();
    persist({
      kind: 'recovery-started',
      recoveryId,
      originalCandidate: campaign.candidate,
      manifestDigest: campaignManifestDigest(campaign),
    });
    let requests = state.normalRequests + state.cleanupRequests;
    const previousRequests = requests;
    const resources = [];
    for (const item of state.resources.values()) {
      if (item.verified) {
        resources.push({ key: item.key, status: 'VERIFIED_PREVIOUSLY' });
        continue;
      }
      const deadline = Date.now() + 10000;
      let attemptCalls = 0;
      let quotaExhausted = false;
      let evidence;
      try {
        evidence = await runner.recoverVercelSandbox({
          token: env.VERCEL_TOKEN,
          teamId: campaign.teamId,
          projectId: campaign.projectId,
          region: campaign.region,
          image: campaign.image,
          sandboxName: item.correlation.sandboxName,
          sandboxId: item.sandboxId,
          owner: campaignOwner,
          correlationId: campaign.campaignId,
          creationState: item.sandboxId ? 'CONFIRMED' : 'UNKNOWN',
          cleanupDeadlineMs: deadline,
          allowRequest: (cleanup) => {
            if (cleanup !== true)
              throw new Error('CAMPAIGN_RECOVERY_CANNOT_ADMIT');
            if (
              requests >= campaign.maxRequests ||
              attemptCalls >= 8 ||
              Date.now() >= deadline
            ) {
              quotaExhausted = true;
              throw new Error('CAMPAIGN_RECOVERY_BUDGET_EXHAUSTED');
            }
            persist({
              kind: 'cleanup-request-reserved',
              key: item.key,
              recoveryId,
            });
            requests++;
            attemptCalls++;
          },
          recordResource: async (resource) => {
            assertResourceIdentity(campaign, item.correlation, resource);
            if (item.sandboxId && item.sandboxId !== resource.sandboxId)
              throw new Error('CAMPAIGN_RESOURCE_RECEIPT_CHANGED');
            persist({
              kind: 'resource-confirmed',
              key: item.key,
              resource,
              recoveryId,
            });
            item.sandboxId = resource.sandboxId;
          },
        });
      } catch {
        evidence = {
          cleanupVerified: false,
          cleanupCheck: 'RECOVERY_OPERATION_FAILED',
        };
      }
      // An uncertain POST plus404 remains pending. A known receipt and the
      // exact-name zero-snapshot readback are both necessary for closure.
      const verified =
        !!item.sandboxId &&
        evidence.sandboxId === item.sandboxId &&
        evidence.cleanupVerified === true &&
        evidence.cleanupCheck === 'ABSENT_AND_ZERO_SNAPSHOTS' &&
        evidence.snapshotsRemaining === 0;
      if (verified) {
        persist({
          kind: 'resource-cleanup-verified',
          key: item.key,
          sandboxId: item.sandboxId,
          cleanupCheck: evidence.cleanupCheck,
          snapshotsRemaining: 0,
          recoveryId,
        });
        item.verified = true;
      }
      const outcome = {
        key: item.key,
        status: verified ? 'VERIFIED' : 'PENDING',
        requests: attemptCalls,
        cleanupCheck: quotaExhausted
          ? 'REQUEST_BUDGET_EXHAUSTED'
          : /^[A-Z_]{1,80}$/.test(evidence.cleanupCheck ?? '')
            ? evidence.cleanupCheck
            : 'UNVERIFIED',
      };
      resources.push(outcome);
      persist({ kind: 'recovery-result', recoveryId, ...outcome });
    }
    const pending = [...state.resources.values()].filter(
      (item) => !item.verified,
    ).length;
    const report = {
      schemaVersion: 1,
      recoveryId,
      campaignId: campaign.campaignId,
      operation: 'OBSERVE_AND_CLEANUP_ONLY',
      status: pending ? 'PENDING' : 'RECOVERED',
      pending,
      resources,
      requests: requests - previousRequests,
      totalCampaignRequests: requests,
      remainingRequests: campaign.maxRequests - requests,
      originalCandidate: campaign.candidate,
      currentCandidateAssessed: false,
      newCreations: 0,
      acceptance: 'NOT_ACCEPTED',
    };
    persist({
      kind: 'recovery-finished',
      recoveryId,
      status: report.status,
      pending,
      requests: report.requests,
    });
    return report;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    await releaseLock();
  }
}

async function main() {
  if (process.argv[2] === 'prepare') {
    const paths = process.argv.slice(3);
    if (paths.length !== 3)
      throw new Error('EXPECTED_DRAFT_PUBLICATION_OUTPUT_DIRECTORY');
    const [draft, publication, directory] = paths.map((path) => resolve(path));
    const { campaign } = await prepareCampaignDirectory(
      draft,
      publication,
      directory,
    );
    console.log(
      JSON.stringify({
        status: 'DRAFT_PREPARED',
        campaignId: campaign.campaignId,
        directory,
        image: campaign.image,
      }),
    );
    return;
  }
  const [
    operation = 'plan',
    path = 'infra/preproduction/sandbox-campaign.example.json',
  ] = process.argv.slice(2);
  if (!['plan', 'preflight', 'run', 'recover'].includes(operation))
    throw new Error('CAMPAIGN_OPERATION_INVALID');
  const campaign = await loadCampaign(resolve(path));
  if (operation === 'recover') {
    try {
      const runner = await import('../packages/runner/dist/index.js');
      const report = await recoverCampaign(campaign, { runner });
      console.log(JSON.stringify(report, null, 2));
      if (report.pending) process.exitCode = 2;
    } catch {
      console.error(
        'Sandbox recovery blocked; preserve the journal and inspect original approval, exact configuration and remaining quota.',
      );
      process.exitCode = 2;
    }
    return;
  }
  let api;
  try {
    api = await import('./sandbox-api-campaign.mjs');
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
  if (operation === 'plan') {
    console.log(
      JSON.stringify(
        await planCampaign(campaign, { apiPlanner: api?.planApiStage }),
        null,
        2,
      ),
    );
    return;
  }
  let runner;
  try {
    runner = await import('../packages/runner/dist/index.js');
  } catch {
    /* preflight reports missing version */
  }
  const options = {
    apiPlanner: api?.planApiStage,
    apiPreflight: api?.preflightApiStage,
    apiExecutor: api?.executeApiStage,
    runner,
  };
  const preflight = await preflightCampaign(campaign, {
    ...options,
    runnerVersion: runner?.RUNNER_VERSION,
  });
  if (operation === 'preflight' || preflight.blockers.length) {
    console.log(JSON.stringify(preflight, null, 2));
    if (preflight.blockers.length) process.exitCode = 2;
    return;
  }
  const report = await runCampaign(campaign, options);
  console.log(
    JSON.stringify({
      campaignId: report.campaignId,
      status: report.status,
      remote: 'AUTHORIZED_ATTEMPT',
      acceptance: report.acceptance,
    }),
  );
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main().catch(() => {
    console.error(
      'Sandbox campaign failed; inspect private configuration or evidence without logging secrets.',
    );
    process.exitCode = 1;
  });
