import { test, expect, jest } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { evaluationProviderFingerprint } from '@alunza/ai';
import {
  evaluationPlanSchema,
  assertEvaluationReady,
  planEvaluation,
  preparationFingerprint,
} from '../../scripts/evaluation-manifest.mjs';

const example = JSON.parse(
  await readFile('infra/preproduction/help-evaluation.example.json', 'utf8'),
);
function fixture() {
  const budget = {
    maxCalls: 12,
    maxInputTokens: 10000,
    maxOutputTokens: 3000,
    maxCostMicroUsd: '100000',
  };
  const plan = {
    ...globalThis.structuredClone(example),
    candidateFingerprint: 'a'.repeat(64),
    authorization: {
      approvedBy: 'Fictitious operator',
      reference: 'unit-only',
      expiresAt: '2099-01-01T00:00:00Z',
    },
    priceVersion: 'fictitious-unit-prices',
    budgets: {
      global: {
        maxCalls: 48,
        maxInputTokens: 40000,
        maxOutputTokens: 12000,
        maxCostMicroUsd: '400000',
      },
      INGESTION: budget,
      CALIBRATION: budget,
      FUNCTIONAL: budget,
      EVALUATION: budget,
    },
    azure: {
      baseURL: 'https://unit-one.openai.azure.com/openai/v1/',
      embeddingDeployment: 'embedding',
      generationDeployment: 'generation',
      verificationDeployment: 'review',
      authMode: 'azure-cli',
      tokenizer: 'o200k_base',
    },
    profiles: {},
  };
  for (const phase of ['EMBEDDING', 'GENERATION', 'REVIEW']) {
    const profile =
      phase === 'EMBEDDING'
        ? {
            id: 'embedding-unit',
            model: 'text-embedding-3-small',
            dimensions: 3,
          }
        : { id: 'generation-unit', model: 'gpt-4.1-mini-2025-04-14' };
    plan.profiles[phase] = {
      ...profile,
      fingerprint: evaluationProviderFingerprint({
        provider: 'AZURE',
        phase,
        profile,
        azure: {
          baseURL: plan.azure.baseURL,
          deployment:
            phase === 'EMBEDDING'
              ? plan.azure.embeddingDeployment
              : phase === 'GENERATION'
                ? plan.azure.generationDeployment
                : plan.azure.verificationDeployment,
          authMode: plan.azure.authMode,
          ...(phase === 'EMBEDDING' ? {} : { tokenizer: plan.azure.tokenizer }),
        },
      }),
      inputMicroUsdPerMillion: '1',
      outputMicroUsdPerMillion: '2',
    };
  }
  const prepared = {
    runId: '12345678-1234-4234-8234-123456789abc',
    corpusHash: 'b'.repeat(64),
    planHash: preparationFingerprint(plan),
    materials: [],
    cases: [],
  };
  return { plan, prepared };
}

test('an explicitly matching Azure plan preserves the three approved identities without network access', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Forbidden network'));
  try {
    const { plan, prepared } = fixture();
    const { manifest } = await assertEvaluationReady(plan, prepared, {
      verifyCandidate: false,
    });
    expect(manifest.profiles).toEqual(plan.profiles);
    expect(planEvaluation(plan).status).toBe('ready-for-local-check');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});

test.each([
  [
    'resource',
    (p) => {
      p.azure.baseURL = 'https://unit-two.openai.azure.com/openai/v1/';
    },
  ],
  [
    'embedding deployment',
    (p) => {
      p.azure.embeddingDeployment = 'other';
    },
  ],
  [
    'generation deployment',
    (p) => {
      p.azure.generationDeployment = 'other';
    },
  ],
  [
    'review deployment',
    (p) => {
      p.azure.verificationDeployment = 'other';
    },
  ],
  [
    'authentication',
    (p) => {
      p.azure.authMode = 'managed-identity';
    },
  ],
  [
    'tokenizer',
    (p) => {
      p.azure.tokenizer = 'cl100k_base';
    },
  ],
  [
    'embedding model',
    (p) => {
      p.profiles.EMBEDDING.model = 'text-embedding-3-large';
    },
  ],
  [
    'generation model',
    (p) => {
      p.profiles.GENERATION.model = 'gpt-4.1';
    },
  ],
  [
    'review model',
    (p) => {
      p.profiles.REVIEW.model = 'gpt-4.1';
    },
  ],
  [
    'dimensions',
    (p) => {
      p.profiles.EMBEDDING.dimensions = 4;
    },
  ],
  [
    'configuration ID',
    (p) => {
      p.profiles.EMBEDDING.id = 'other';
    },
  ],
  [
    'swapped calls',
    (p) => {
      [p.profiles.GENERATION.fingerprint, p.profiles.REVIEW.fingerprint] = [
        p.profiles.REVIEW.fingerprint,
        p.profiles.GENERATION.fingerprint,
      ];
    },
  ],
])(
  'rejects a mismatched %s before any authorization or request',
  async (_name, mutate) => {
    const { plan, prepared } = fixture();
    mutate(plan);
    const before = JSON.stringify(plan);
    const parsed = evaluationPlanSchema.safeParse(plan);
    expect(parsed.success).toBe(false);
    expect(
      parsed.error.issues.some((issue) => issue.path[0] === 'profiles'),
    ).toBe(true);
    await expect(
      assertEvaluationReady(plan, prepared, { verifyCandidate: false }),
    ).rejects.toThrow();
    expect(() => planEvaluation(plan)).toThrow();
    expect(JSON.stringify(plan)).toBe(before);
  },
);

test('public price approval is independent of destination identity', async () => {
  const { plan, prepared } = fixture();
  plan.profiles.GENERATION.inputMicroUsdPerMillion = '9';
  plan.profiles.REVIEW.outputMicroUsdPerMillion = '11';
  const { manifest } = await assertEvaluationReady(plan, prepared, {
    verifyCandidate: false,
  });
  expect(manifest.profiles).toEqual(plan.profiles);
});

test('the public Azure descriptor rejects credentials without rendering their values', () => {
  const { plan } = fixture();
  plan.azure.apiKey = 'fictitious-never-printed';
  const result = evaluationPlanSchema.safeParse(plan);
  expect(result.success).toBe(false);
  expect(JSON.stringify(result.error.issues)).not.toContain(
    'fictitious-never-printed',
  );
});
