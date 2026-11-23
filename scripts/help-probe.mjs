import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  HELP_LIMITS,
  HELP_QUERY_VERSION,
  TOKENIZER_VERSION,
  azureGenerationConfigurationSchema,
  azureEmbeddingConfigurationSchema,
  parseHelpCalibrationArtifact,
  helpEvidencePolicyFromArtifact,
} from '@alunza/ai';
import { publicOrigin } from './preprod-manifest.mjs';

// This is an offline preparation tool. Remote execution must be implemented
// against durable server receipts before it can enforce the approved budget.
// The legacy connectivity probe and its 4-call/512-token cap stay unchanged.
const label = z.string().regex(/^[\p{L}\p{N}_.:/@+ -]{1,160}$/u);
const name = z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/u);
const nullableId = z.uuid().nullable();
const schema = z.strictObject({
  schemaVersion: z.literal(1),
  environment: z.literal('preproduction'),
  operation: z.literal('probe:help-product'),
  remote: z.strictObject({
    enabled: z.boolean(),
    approvedBy: label.nullable(),
    approvalRef: label.nullable(),
    approvedAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime().nullable(),
  }),
  releaseSha: z
    .string()
    .regex(/^[a-f0-9]{40}$/u)
    .nullable(),
  targets: z.strictObject({
    apiOrigin: z.string().nullable(),
    azureBaseURL: z.string().nullable(),
    organizationId: nullableId,
    classId: nullableId,
    activityId: nullableId,
    attemptId: nullableId,
    sourceVersionIds: z.array(z.uuid()).min(1).max(5).nullable(),
    embedding: z
      .strictObject({
        configurationId: name,
        model: name,
        dimensions: z.number().int().min(1).max(3072),
        deployment: name,
      })
      .nullable(),
    generation: z
      .strictObject({
        configurationId: name,
        model: name,
        deployment: name,
        verificationModel: name,
        verificationDeployment: name,
        tokenizer: z.enum(['cl100k_base', 'o200k_base']),
      })
      .nullable(),
  }),
  corpus: z.strictObject({
    fixtureVersion: z.literal('help-corpus-1'),
    content: z.literal('fictitious-only'),
    expectedHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    calibrationArtifact: z.unknown().nullable(),
  }),
  budget: z.strictObject({
    maxHelpRequests: z.literal(4),
    maxAiRequests: z.literal(12),
    maxHttpRequests: z.number().int().min(122).max(128),
    maxDurationSeconds: z.number().int().min(60).max(300),
    currency: z.literal('USD'),
    maxCost: z.number().finite().positive().max(25).nullable(),
    pricePerMillionTokens: z
      .strictObject({
        embeddingInput: z.number().finite().nonnegative(),
        generationInput: z.number().finite().nonnegative(),
        generationOutput: z.number().finite().nonnegative(),
        verificationInput: z.number().finite().nonnegative(),
        verificationOutput: z.number().finite().nonnegative(),
      })
      .nullable(),
  }),
});
export class HelpProbeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'HelpProbeError';
    this.code = code;
  }
}
function invalid() {
  throw new HelpProbeError('INVALID_HELP_MANIFEST');
}
export function validateHelpProbeManifest(value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) invalid();
  const manifest = parsed.data;
  try {
    if (manifest.targets.apiOrigin !== null)
      publicOrigin(manifest.targets.apiOrigin);
    if (
      manifest.targets.azureBaseURL !== null &&
      !/^https:\/\/[a-z0-9-]+\.openai\.azure\.com\/openai\/v1\/$/u.test(
        manifest.targets.azureBaseURL,
      )
    )
      invalid();
    if (manifest.corpus.calibrationArtifact !== null)
      parseHelpCalibrationArtifact(manifest.corpus.calibrationArtifact);
    const embedding = manifest.targets.embedding;
    if (embedding !== null)
      azureEmbeddingConfigurationSchema.parse({
        baseURL: manifest.targets.azureBaseURL,
        embeddingDeployment: embedding.deployment,
        embeddingModel: embedding.model,
        configurationId: embedding.configurationId,
        dimensions: embedding.dimensions,
        authMode: 'managed-identity',
      });
    const generation = manifest.targets.generation;
    if (generation !== null)
      azureGenerationConfigurationSchema.parse({
        baseURL: manifest.targets.azureBaseURL,
        generationDeployment: generation.deployment,
        generationModel: generation.model,
        verificationDeployment: generation.verificationDeployment,
        verificationModel: generation.verificationModel,
        configurationId: generation.configurationId,
        tokenizer: generation.tokenizer,
        authMode: 'managed-identity',
      });
  } catch {
    invalid();
  }
  return manifest;
}
export function helpProbeTokenBudget() {
  return {
    embeddingInput: 4 * HELP_LIMITS.queryTokens,
    generationInput: 4 * HELP_LIMITS.callInputTokens,
    generationOutput: 4 * HELP_LIMITS.generationOutputTokens,
    verificationInput: 4 * HELP_LIMITS.callInputTokens,
    verificationOutput: 4 * HELP_LIMITS.verificationOutputTokens,
  };
}
export function assertHelpProbeAuthorization(value, now = Date.now()) {
  const manifest = validateHelpProbeManifest(value);
  const { remote, targets, corpus, budget } = manifest;
  const denied = () => {
    throw new HelpProbeError('HELP_REMOTE_NOT_AUTHORIZED');
  };
  if (
    !remote.enabled ||
    !remote.approvedBy ||
    !remote.approvalRef ||
    !remote.approvedAt ||
    !remote.expiresAt ||
    !manifest.releaseSha
  )
    denied();
  const start = Date.parse(remote.approvedAt),
    end = Date.parse(remote.expiresAt);
  if (start > now || now >= end || end - start > 7 * 24 * 60 * 60 * 1000)
    denied();
  if (
    Object.values(targets).some((value) => value === null) ||
    !corpus.expectedHash ||
    !corpus.calibrationArtifact ||
    !budget.maxCost ||
    !budget.pricePerMillionTokens
  )
    denied();
  const tokens = helpProbeTokenBudget();
  const maximumCost = Object.entries(tokens).reduce(
    (sum, [key, count]) =>
      sum + (count * budget.pricePerMillionTokens[key]) / 1_000_000,
    0,
  );
  if (maximumCost > budget.maxCost) denied();
  try {
    helpEvidencePolicyFromArtifact(corpus.calibrationArtifact, {
      configurationId: targets.embedding.configurationId,
      embeddingModel: targets.embedding.model,
      dimensions: targets.embedding.dimensions,
      tokenizerVersion: TOKENIZER_VERSION,
      queryVersion: HELP_QUERY_VERSION,
      corpusHash: corpus.expectedHash,
    });
  } catch {
    denied();
  }
  return { manifest, maximumCost };
}
export function planHelpProbe(value, now = Date.now()) {
  const manifest = validateHelpProbeManifest(value);
  let authorization = 'pending',
    maximumCost = null;
  try {
    maximumCost = assertHelpProbeAuthorization(manifest, now).maximumCost;
    authorization = 'manifest-valid';
  } catch (error) {
    if (!(error instanceof HelpProbeError)) throw error;
  }
  return {
    status: 'prepared-remote-not-executed',
    executionImplemented: false,
    authorization,
    remoteCalls: 0,
    observedTokens: null,
    observedCost: null,
    plannedCalls: { embedding: 4, generation: 4, verification: 4, total: 12 },
    maximumTokens: helpProbeTokenBudget(),
    maximumCost,
    currency: 'USD',
    target: manifest.targets.apiOrigin,
    prerequisites: [
      'Deploy and verify the exact release and provider/configuration IDs in the manifest.',
      'Use a dedicated fictitious tenant, ACTIVE student and authorized READY source versions; verify expected corpus hash independently.',
      'Persist a FAILED_TEST attempt using the fixture code and verify its public context. No material ingestion, runner execution or calibration calls are included in this budget.',
      'Install an Azure-measured calibration artifact bound to the expected corpus and embedding configuration; semantic review remains human work.',
      'Obtain the student session out of band; never place access tokens, API keys or private material in this manifest or report.',
    ],
    sequence: [
      {
        method: 'GET',
        path: '/api/v1/attempts/{attemptId}/feedback',
        assert:
          'Capabilities permit FEEDBACK and HINT 1; no prior help in this dedicated attempt.',
      },
      ...[
        { kind: 'FEEDBACK' },
        ...[1, 2, 3].map((hintLevel) => ({ kind: 'HINT', hintLevel })),
      ].map((body) => ({
        method: 'POST',
        path: '/api/v1/attempts/{attemptId}/feedback-requests',
        body,
        assert:
          'Persist a unique idempotency key; replay the same request once and require the same request ID without additional provider calls.',
        continuation:
          'Poll at most 16 times within the 15 s absolute job deadline; read feedback; require exactly five help fields and canonical diagnosis. For SUPPORTED check all references; acknowledge viewed with the returned presentationToken before the next hint.',
      })),
      {
        method: 'GET',
        path: '/api/v1/feedback/{feedbackId}/sources/{chunkId}',
        assert:
          'Every reference returns its authorized source/version, locator and exact fragment; download only those versions, at most five per help.',
      },
      {
        method: 'GET',
        path: '/api/v1/feedback/{feedbackId}',
        assert:
          'A second out-of-scope identity cannot read feedback or a cited source; record status only.',
      },
    ],
    reportRequirements: [
      'Server receipts must prove at most one dispatched EMBEDDING, GENERATION and REVIEW call per request, exact model/configuration IDs and verification acceptance before publication.',
      'Report missing provider usage as unknown, never zero; report fallbacks and deadline failures without logging prompts, code, material, candidates or credentials.',
      'Compare observed usage with reserved maxima, preserve typed rejection reasons, and stop on an uncertain dispatch without retrying paid work.',
      'Keep remote technical evidence, calibration coverage and human pedagogical acceptance distinct.',
    ],
    remaining:
      'Remote execution is deliberately unavailable until a bounded product API runner can reconcile durable per-call receipts and enforce the approved aggregate budget.',
  };
}
export async function loadHelpProbeManifest(path) {
  try {
    return validateHelpProbeManifest(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    throw new HelpProbeError('INVALID_HELP_MANIFEST');
  }
}
export async function helpProbeMain(args) {
  // The v1 connectivity preparation remains readable for historical evidence.
  // Product evaluation uses the executable v2 manifest and durable server ledger.
  const suppliedPath = args.includes('--manifest')
    ? args[args.indexOf('--manifest') + 1]
    : undefined;
  const requestedMode = args.includes('--mode')
    ? args[args.indexOf('--mode') + 1]
    : 'plan';
  if (suppliedPath) {
    const input = JSON.parse(await readFile(resolve(suppliedPath), 'utf8'));
    if (input.schemaVersion === 2)
      return (await import('./evaluation-cli.mjs')).evaluationMain(args);
  } else if (
    [
      'prepare',
      'authorize',
      'run',
      'resume',
      'status',
      'stop',
      'report',
    ].includes(requestedMode)
  ) {
    return (await import('./evaluation-cli.mjs')).evaluationMain(args);
  }
  const values = {
    mode: 'plan',
    manifest: resolve('infra/preproduction/help-manifest.example.json'),
  };
  for (let i = 0; i < args.length; i++) {
    if (
      !['--mode', '--manifest'].includes(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    )
      throw new HelpProbeError('INVALID_ARGUMENTS');
    values[args[i].slice(2)] = args[++i];
  }
  if (!['plan', 'check'].includes(values.mode))
    throw new HelpProbeError('REMOTE_EXECUTION_NOT_IMPLEMENTED');
  const manifest = await loadHelpProbeManifest(values.manifest);
  if (values.mode === 'check') assertHelpProbeAuthorization(manifest);
  return planHelpProbe(manifest);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.stdout.write(
      `${JSON.stringify(await helpProbeMain(process.argv.slice(2)), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof HelpProbeError ? error.code : 'HELP_PROBE_FAILED'}\n`,
    );
    process.exitCode = 1;
  }
}
