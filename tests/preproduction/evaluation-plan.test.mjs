import { test, expect, jest } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import {
  evaluationPlanSchema,
  planEvaluation,
  preparationFingerprint,
  assertEvaluationReady,
} from '../../scripts/evaluation-manifest.mjs';
import { buildEvaluationConfig } from '../../scripts/evaluation-environment.mjs';
import { TOKENIZER_VERSION } from '@alunza/ai';

const example = JSON.parse(
  await readFile('infra/preproduction/help-evaluation.example.json', 'utf8'),
);

test('unknown Azure prices, profiles, authorization and build identity block execution without transport', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Forbidden remote call'));
  try {
    expect(planEvaluation(example)).toMatchObject({
      status: 'configuration-pending',
      remoteCalls: 0,
      observedTokens: null,
      tokenizerVersion: TOKENIZER_VERSION,
    });
    await expect(assertEvaluationReady(example, {})).rejects.toMatchObject({
      code: 'EVALUATION_CONFIGURATION_PENDING',
    });
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});

test('preparation may precede prices and approval, but cannot change corpus, destination or tokenizer', () => {
  const configured = {
    ...example,
    candidateFingerprint: 'a'.repeat(64),
    priceVersion: 'approved-later',
    authorization: {
      approvedBy: 'Fictitious operator',
      reference: 'fixture',
      expiresAt: '2099-01-01T00:00:00Z',
    },
  };
  expect(preparationFingerprint(configured)).toBe(
    preparationFingerprint(example),
  );
  expect(
    preparationFingerprint({ ...example, corpusVersion: 'other' }),
  ).not.toBe(preparationFingerprint(example));
  expect(
    preparationFingerprint({
      ...example,
      destination: { ...example.destination, projectId: 'foreign' },
    }),
  ).not.toBe(preparationFingerprint(example));
  expect(
    evaluationPlanSchema.safeParse({ ...example, tokenizerVersion: 'invented' })
      .success,
  ).toBe(false);
});

test.each([
  { provider: 'TEST' },
  {
    destination: { ...example.destination, apiOrigin: 'http://127.0.0.1:4200' },
  },
  { latency: { ...example.latency, concurrency: 8 } },
  { secret: 'forbidden' },
])('an incompatible evaluation plan is rejected', (change) => {
  expect(
    evaluationPlanSchema.safeParse({ ...example, ...change }).success,
  ).toBe(false);
});

test('LAB-EVAL configuration reserves its own Supabase and UI family without altering the source', async () => {
  const source = await readFile('supabase/config.toml', 'utf8');
  const result = buildEvaluationConfig(source);
  expect(result).toContain('project_id = "alunza-edu-laboratorio-eval"');
  for (const port of [19420, 19421, 19422, 19423, 19424, 3400])
    expect(result).toContain(String(port));
  expect(result).not.toContain('17421');
  expect(source).toContain('17421');
});
