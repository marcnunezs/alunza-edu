import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';

export const remoteOperations = Object.freeze([
  'azure:deploy',
  'azure:job',
  'supabase:bootstrap',
  'smoke:web-api',
  'probe:sandbox',
  'probe:ai',
]);
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const digest = /^[a-z0-9.-]+\/[a-z0-9/_-]+@sha256:[a-f\d]{64}$/;
const sha = /^[a-f\d]{40}$/;

export class ManifestError extends Error {
  constructor(field) {
    super(`Manifiesto inválido: ${field}.`);
    this.name = 'ManifestError';
  }
}
function requireValue(condition, field) {
  if (!condition) throw new ManifestError(field);
}
function object(value, keys, field) {
  requireValue(
    value && typeof value === 'object' && !Array.isArray(value),
    field,
  );
  requireValue(
    Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
    field,
  );
}
function text(value, field, pattern = /^[\p{L}\p{N}_.:/@+ -]{1,160}$/u) {
  requireValue(
    value === null || (typeof value === 'string' && pattern.test(value)),
    field,
  );
}
function timestamp(value, field) {
  requireValue(
    value === null ||
      (typeof value === 'string' &&
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) &&
        Number.isFinite(Date.parse(value))),
    field,
  );
}
function integer(value, low, high, field) {
  requireValue(Number.isInteger(value) && value >= low && value <= high, field);
}
export function publicOrigin(value, field = 'origin') {
  try {
    const url = new URL(value);
    requireValue(
      url.protocol === 'https:' &&
        url.origin === value &&
        !url.username &&
        !url.password &&
        !isIP(url.hostname) &&
        !['localhost', 'host.docker.internal'].includes(url.hostname) &&
        url.hostname.includes('.'),
      field,
    );
    return url.origin;
  } catch {
    throw new ManifestError(field);
  }
}
function nullableOrigin(value, field) {
  if (value !== null) publicOrigin(value, field);
}

export function validateManifest(value) {
  object(
    value,
    ['schemaVersion', 'environment', 'remote', 'budget', 'release', 'targets'],
    'root',
  );
  requireValue(
    value.schemaVersion === 1 && value.environment === 'preproduction',
    'schemaVersion/environment',
  );
  const { remote, budget, release, targets } = value;
  object(
    remote,
    [
      'enabled',
      'approvedBy',
      'approvalRef',
      'approvedAt',
      'expiresAt',
      'allowedOperations',
    ],
    'remote',
  );
  requireValue(typeof remote.enabled === 'boolean', 'remote.enabled');
  text(remote.approvedBy, 'remote.approvedBy');
  text(remote.approvalRef, 'remote.approvalRef');
  timestamp(remote.approvedAt, 'remote.approvedAt');
  timestamp(remote.expiresAt, 'remote.expiresAt');
  requireValue(
    Array.isArray(remote.allowedOperations) &&
      remote.allowedOperations.every((op) => remoteOperations.includes(op)) &&
      new Set(remote.allowedOperations).size ===
        remote.allowedOperations.length,
    'remote.allowedOperations',
  );
  object(
    budget,
    [
      'currency',
      'maxCost',
      'maxDurationSeconds',
      'maxHttpRequests',
      'maxSandboxRuns',
      'maxAiRequests',
      'maxAiTokens',
    ],
    'budget',
  );
  requireValue(budget.currency === 'CLP', 'budget.currency');
  integer(budget.maxCost, 0, 265000, 'budget.maxCost');
  integer(budget.maxDurationSeconds, 1, 3600, 'budget.maxDurationSeconds');
  integer(budget.maxHttpRequests, 1, 100, 'budget.maxHttpRequests');
  integer(budget.maxSandboxRuns, 0, 1, 'budget.maxSandboxRuns');
  integer(budget.maxAiRequests, 0, 4, 'budget.maxAiRequests');
  integer(budget.maxAiTokens, 1, 512, 'budget.maxAiTokens');
  object(release, ['sha', 'apiImage', 'jobImage'], 'release');
  text(release.sha, 'release.sha', sha);
  for (const field of ['apiImage', 'jobImage'])
    text(release[field], `release.${field}`, digest);
  object(
    targets,
    ['azure', 'vercel', 'supabase', 'sandbox', 'azureOpenAi'],
    'targets',
  );
  const { azure, vercel, supabase, sandbox, azureOpenAi } = targets;
  object(
    azure,
    [
      'subscriptionId',
      'resourceGroup',
      'location',
      'environmentName',
      'registryName',
      'identityName',
      'apiName',
      'jobName',
      'apiOrigin',
    ],
    'targets.azure',
  );
  text(azure.subscriptionId, 'targets.azure.subscriptionId', uuid);
  for (const field of [
    'resourceGroup',
    'location',
    'environmentName',
    'identityName',
    'apiName',
    'jobName',
  ])
    text(azure[field], `targets.azure.${field}`, /^[a-z][a-z0-9-]{1,30}$/);
  text(
    azure.registryName,
    'targets.azure.registryName',
    /^[a-z][a-z0-9]{4,49}$/,
  );
  nullableOrigin(azure.apiOrigin, 'targets.azure.apiOrigin');
  if (azure.apiOrigin !== null && azure.apiName !== null)
    requireValue(
      new URL(azure.apiOrigin).hostname.startsWith(`${azure.apiName}.`) &&
        new URL(azure.apiOrigin).hostname.endsWith('.azurecontainerapps.io'),
      'targets.azure.apiOrigin',
    );
  object(vercel, ['projectId', 'teamId', 'webOrigin'], 'targets.vercel');
  text(vercel.projectId, 'targets.vercel.projectId', /^prj_[a-zA-Z0-9]+$/);
  text(vercel.teamId, 'targets.vercel.teamId', /^team_[a-zA-Z0-9]+$/);
  nullableOrigin(vercel.webOrigin, 'targets.vercel.webOrigin');
  object(
    supabase,
    ['projectRef', 'authUrl', 'databaseHost', 'databasePort', 'region'],
    'targets.supabase',
  );
  text(supabase.projectRef, 'targets.supabase.projectRef', /^[a-z]{20}$/);
  nullableOrigin(supabase.authUrl, 'targets.supabase.authUrl');
  text(
    supabase.databaseHost,
    'targets.supabase.databaseHost',
    /^(?:db\.[a-z]{20}\.supabase\.co|aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com)$/,
  );
  requireValue(supabase.databasePort === 5432, 'targets.supabase.databasePort');
  text(supabase.region, 'targets.supabase.region', /^[a-z][a-z0-9-]{1,40}$/);
  if (supabase.authUrl !== null && supabase.projectRef !== null)
    requireValue(
      supabase.authUrl === `https://${supabase.projectRef}.supabase.co`,
      'targets.supabase.authUrl',
    );
  object(
    sandbox,
    ['teamId', 'projectId', 'region', 'image'],
    'targets.sandbox',
  );
  text(sandbox.teamId, 'targets.sandbox.teamId', /^team_[a-zA-Z0-9]+$/);
  text(sandbox.projectId, 'targets.sandbox.projectId', /^prj_[a-zA-Z0-9]+$/);
  text(sandbox.region, 'targets.sandbox.region', /^[a-z][a-z0-9-]{1,40}$/);
  text(sandbox.image, 'targets.sandbox.image', digest);
  object(
    azureOpenAi,
    [
      'resourceId',
      'endpoint',
      'region',
      'generationDeployment',
      'embeddingDeployment',
      'apiVersion',
      'embeddingDimensions',
    ],
    'targets.azureOpenAi',
  );
  text(
    azureOpenAi.resourceId,
    'targets.azureOpenAi.resourceId',
    /^\/subscriptions\/[a-f\d-]{36}\/resourceGroups\/[\w-]+\/providers\/Microsoft\.CognitiveServices\/accounts\/[\w-]+$/i,
  );
  nullableOrigin(azureOpenAi.endpoint, 'targets.azureOpenAi.endpoint');
  if (azureOpenAi.endpoint !== null)
    requireValue(
      /^https:\/\/[a-z0-9-]+\.openai\.azure\.com$/.test(azureOpenAi.endpoint),
      'targets.azureOpenAi.endpoint',
    );
  for (const field of ['region', 'generationDeployment', 'embeddingDeployment'])
    text(
      azureOpenAi[field],
      `targets.azureOpenAi.${field}`,
      /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/,
    );
  requireValue(
    azureOpenAi.apiVersion === 'v1',
    'targets.azureOpenAi.apiVersion',
  );
  if (azureOpenAi.embeddingDimensions !== null)
    integer(
      azureOpenAi.embeddingDimensions,
      1,
      4096,
      'targets.azureOpenAi.embeddingDimensions',
    );
  return JSON.parse(JSON.stringify(value));
}

export async function loadManifest(path) {
  let input;
  try {
    input = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new ManifestError('archivo JSON legible');
  }
  return validateManifest(input);
}

export function assertRemoteAuthorization(
  manifest,
  operation,
  now = Date.now(),
) {
  validateManifest(manifest);
  const { remote, budget, release, targets } = manifest;
  requireValue(
    remote.enabled && remote.allowedOperations.includes(operation),
    'remote.enabled/allowedOperations',
  );
  requireValue(
    remote.approvedBy &&
      remote.approvalRef &&
      remote.approvedAt &&
      remote.expiresAt,
    'remote.approval',
  );
  const start = Date.parse(remote.approvedAt),
    end = Date.parse(remote.expiresAt);
  requireValue(
    start <= now && now < end && end - start <= 7 * 24 * 60 * 60 * 1000,
    'remote.vigencia',
  );
  requireValue(budget.maxCost > 0 && release.sha, 'budget.maxCost/release.sha');
  const complete = (entry, name) =>
    requireValue(
      Object.values(entry).every((v) => v !== null),
      `targets.${name}`,
    );
  if (operation === 'supabase:bootstrap')
    complete(targets.supabase, 'supabase');
  if (operation === 'smoke:web-api' || operation.startsWith('azure:')) {
    const azureRequired = { ...targets.azure };
    if (operation === 'azure:deploy') delete azureRequired.apiOrigin;
    complete(azureRequired, 'azure');
    complete(targets.vercel, 'vercel');
    complete(targets.supabase, 'supabase');
    // Registry bootstrap precedes the first push, so its digest is not known yet.
    // Workloads and every smoke/Job still require the approved image digest.
    if (operation !== 'azure:deploy')
      requireValue(release.apiImage, 'release.apiImage');
    if (release.apiImage !== null)
      requireValue(
        release.apiImage.startsWith(
          `${targets.azure.registryName}.azurecr.io/`,
        ),
        'release.apiImage.registry',
      );
  }
  if (operation === 'azure:job') {
    requireValue(release.jobImage, 'release.jobImage');
    requireValue(
      release.jobImage.startsWith(`${targets.azure.registryName}.azurecr.io/`),
      'release.jobImage.registry',
    );
  }
  if (operation === 'probe:sandbox') {
    complete(targets.sandbox, 'sandbox');
    requireValue(budget.maxSandboxRuns > 0, 'budget.maxSandboxRuns');
  }
  if (operation === 'probe:ai') {
    complete(targets.azureOpenAi, 'azureOpenAi');
    requireValue(
      budget.maxAiRequests >= 2 && budget.maxHttpRequests >= 2,
      'budget.maxAiRequests/maxHttpRequests',
    );
  }
  return manifest;
}

// Every outbound smoke request consumes a slot before it is dispatched.
export function requestBudget(manifest, operation, now = () => Date.now()) {
  assertRemoteAuthorization(manifest, operation, now());
  const deadline = Math.min(
    Date.parse(manifest.remote.expiresAt),
    now() + manifest.budget.maxDurationSeconds * 1000,
  );
  let requests = 0;
  return {
    consume() {
      requireValue(now() < deadline, 'budget.deadline');
      requireValue(
        requests < manifest.budget.maxHttpRequests,
        'budget.maxHttpRequests',
      );
      requests += 1;
      return Math.min(10000, deadline - now());
    },
    get requests() {
      return requests;
    },
  };
}
