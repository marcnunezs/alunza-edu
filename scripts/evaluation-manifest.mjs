import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  evaluationBudgetSchema,
  evaluationProfileSchema,
  evaluationManifestSchema,
} from '@alunza/contracts';
import {
  TOKENIZER_VERSION,
  HELP_QUERY_VERSION,
  evaluationProviderFingerprint,
} from '@alunza/ai';
import { root, run } from './local.mjs';
import { evaluationTarget, testTarget } from './local-target.mjs';
import { sha256, EvaluationError } from './evaluation-client.mjs';

const nullable = (schema) => schema.nullable();
const label = z.string().min(1).max(200);
const budgets = z.strictObject({
  global: evaluationBudgetSchema,
  INGESTION: evaluationBudgetSchema,
  CALIBRATION: evaluationBudgetSchema,
  FUNCTIONAL: evaluationBudgetSchema,
  EVALUATION: evaluationBudgetSchema,
});
export const evaluationPlanSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    operation: z.literal('help-product-evaluation'),
    environment: z.enum(['LAB-EVAL', 'TEST']),
    provider: z.enum(['AZURE', 'TEST']),
    destination: z.strictObject({
      apiOrigin: z.url(),
      authOrigin: z.url(),
      operationsOrigin: z.url(),
      projectId: label,
    }),
    candidateFingerprint: nullable(z.string().regex(/^[a-f0-9]{64}$/)),
    corpusVersion: z.literal('help-evaluation-1'),
    tokenizerVersion: z.literal(TOKENIZER_VERSION),
    queryVersion: z.literal(HELP_QUERY_VERSION),
    authorization: nullable(
      z.strictObject({
        approvedBy: label,
        reference: label,
        expiresAt: z.iso.datetime({ offset: true }),
      }),
    ),
    priceVersion: nullable(label),
    budgets: nullable(budgets),
    profiles: nullable(
      z.strictObject({
        EMBEDDING: evaluationProfileSchema,
        GENERATION: evaluationProfileSchema,
        REVIEW: evaluationProfileSchema,
      }),
    ),
    azure: nullable(
      z.strictObject({
        baseURL: z.url(),
        embeddingDeployment: label,
        generationDeployment: label,
        verificationDeployment: label,
        authMode: z.enum(['azure-cli', 'managed-identity', 'api-key']),
        tokenizer: z.enum(['cl100k_base', 'o200k_base']),
      }),
    ),
    latency: z.strictObject({
      serialAttempts: z.literal(25),
      concurrentAttempts: z.literal(25),
      concurrency: z.literal(4),
      helpsPerAttempt: z.literal(4),
    }),
  })
  .superRefine((value, ctx) => {
    const target = value.environment === 'TEST' ? testTarget : evaluationTarget;
    if (
      value.destination.apiOrigin !== target.apiUrl ||
      value.destination.authOrigin !== target.authUrl ||
      value.destination.operationsOrigin !== 'http://127.0.0.1:4401' ||
      value.destination.projectId !== target.projectId
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Evaluation requires the isolated loopback target.',
      });
    if ((value.environment === 'TEST') !== (value.provider === 'TEST'))
      ctx.addIssue({
        code: 'custom',
        message: 'TEST evidence cannot authorize Azure.',
      });
    if (
      value.azure &&
      !/^https:\/\/[a-z0-9-]+\.openai\.azure\.com\/openai\/v1\/$/u.test(
        value.azure.baseURL,
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid Azure destination.' });
    if (value.provider === 'AZURE' && value.azure && value.profiles) {
      for (const phase of ['EMBEDDING', 'GENERATION', 'REVIEW']) {
        let expected;
        try {
          expected = evaluationProviderFingerprint({
            provider: 'AZURE',
            phase,
            profile: value.profiles[phase],
            azure: {
              baseURL: value.azure.baseURL,
              deployment:
                phase === 'EMBEDDING'
                  ? value.azure.embeddingDeployment
                  : phase === 'GENERATION'
                    ? value.azure.generationDeployment
                    : value.azure.verificationDeployment,
              authMode: value.azure.authMode,
              ...(phase === 'EMBEDDING'
                ? {}
                : { tokenizer: value.azure.tokenizer }),
            },
          });
        } catch {
          // The public descriptor is untrusted. Do not echo any supplied values.
        }
        if (!expected || expected !== value.profiles[phase].fingerprint)
          ctx.addIssue({
            code: 'custom',
            path: ['profiles', phase, 'fingerprint'],
            message:
              'Azure profile does not match its explicit public descriptor.',
          });
      }
    }
  });
export async function candidateFingerprint() {
  const listed = await run('git', [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ]);
  const files = [...new Set(listed.stdout.split('\0').filter(Boolean))].sort();
  const hashes = [];
  for (const path of files) {
    try {
      hashes.push([
        path.replaceAll('\\', '/'),
        sha256(await readFile(join(root, path))),
      ]);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hashes.push([path, 'deleted']);
    }
  }
  return sha256(JSON.stringify(hashes));
}
// Preparing fictitious product records needs scope and corpus identity, but
// not yet provider credentials, prices, approvals or the final build digest.
export function preparationFingerprint(plan) {
  return sha256(
    JSON.stringify({
      environment: plan.environment,
      provider: plan.provider,
      destination: plan.destination,
      corpusVersion: plan.corpusVersion,
      tokenizerVersion: plan.tokenizerVersion,
      queryVersion: plan.queryVersion,
      latency: plan.latency,
    }),
  );
}
export function planEvaluation(raw) {
  const manifest = evaluationPlanSchema.parse(raw);
  const pending = [
    'candidateFingerprint',
    'authorization',
    'priceVersion',
    'budgets',
    'profiles',
    ...(manifest.provider === 'AZURE' ? ['azure'] : []),
  ].filter((key) => manifest[key] === null);
  return {
    schemaVersion: 2,
    status: pending.length ? 'configuration-pending' : 'ready-for-local-check',
    executionImplemented: true,
    remoteCalls: 0,
    observedTokens: null,
    observedCostMicroUsd: null,
    stages: ['INGESTION', 'CALIBRATION', 'FUNCTIONAL', 'EVALUATION'],
    pending,
    profile: {
      functionalHelps: 4,
      functionalMaximumCalls: 12,
      serialHelps: 100,
      concurrentHelps: 100,
      concurrency: 4,
      deadlineMs: 15000,
      documentaryP95TargetMs: 12000,
      rateLimitsUnchanged: true,
    },
    academicAcceptance: 'pending',
    azureEvaluation: 'not-executed',
    tokenizerVersion: TOKENIZER_VERSION,
  };
}
export async function assertEvaluationReady(
  raw,
  prepared,
  { verifyCandidate = true } = {},
) {
  const plan = evaluationPlanSchema.parse(raw);
  if (planEvaluation(plan).pending.length)
    throw new EvaluationError('EVALUATION_CONFIGURATION_PENDING');
  if (Date.parse(plan.authorization.expiresAt) <= Date.now())
    throw new EvaluationError('EVALUATION_AUTHORIZATION_EXPIRED');
  if (
    verifyCandidate &&
    plan.candidateFingerprint !== (await candidateFingerprint())
  )
    throw new EvaluationError('CANDIDATE_CHANGED');
  if (prepared.planHash !== preparationFingerprint(plan))
    throw new EvaluationError('PREPARED_MANIFEST_CHANGED');
  if (plan.budgets.FUNCTIONAL.maxCalls > 12)
    throw new EvaluationError('FUNCTIONAL_PROFILE_CHANGED');
  for (const dimension of [
    'maxCalls',
    'maxInputTokens',
    'maxOutputTokens',
    'maxCostMicroUsd',
  ]) {
    const total = [
      'INGESTION',
      'CALIBRATION',
      'FUNCTIONAL',
      'EVALUATION',
    ].reduce((sum, key) => sum + BigInt(plan.budgets[key][dimension]), 0n);
    if (total > BigInt(plan.budgets.global[dimension]))
      throw new EvaluationError('GLOBAL_BUDGET_INSUFFICIENT');
  }
  const manifest = evaluationManifestSchema.parse({
    version: 1,
    runId: prepared.runId,
    environment: plan.environment,
    provider: plan.provider,
    releaseSha: plan.candidateFingerprint,
    environmentHash: sha256(JSON.stringify(plan.destination)),
    corpusHash: prepared.corpusHash,
    priceVersion: plan.priceVersion,
    approvedBy: plan.authorization.approvedBy,
    approvalReference: plan.authorization.reference,
    expiresAt: plan.authorization.expiresAt,
    globalBudget: plan.budgets.global,
    stages: Object.fromEntries(
      ['INGESTION', 'CALIBRATION', 'FUNCTIONAL', 'EVALUATION'].map((key) => [
        key,
        plan.budgets[key],
      ]),
    ),
    profiles: plan.profiles,
    materials: prepared.materials.map(({ binding }) => binding),
    cases: prepared.cases.map(({ binding }) => binding),
  });
  return { plan, manifest };
}
