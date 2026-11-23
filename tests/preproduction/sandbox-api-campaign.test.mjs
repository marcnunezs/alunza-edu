import { describe, expect, it } from '@jest/globals';
import {
  planApiStage,
  preflightApiStage,
  executeApiStage,
} from '../../scripts/sandbox-api-campaign.mjs';

const config = { baseUrl: 'https://api.alunza.invalid', fictitiousOnly: true };
const azure = {
  subscriptionId: '10000000-0000-4000-8000-000000000001',
  resourceGroup: 'alunza-preproduction',
  appName: 'alunza-api',
  revision: 'alunza-api--test',
  replica: 'alunza-api--test-unit',
  container: 'api',
};
describe('real API Sandbox campaign boundaries', () => {
  it('inventories transport replay separately from new creations', () => {
    const plan = planApiStage({ kind: 'api', config });
    expect(plan.blockers).toEqual([]);
    expect(plan.creations).toBe(6);
    expect(plan.cases.map((value) => value.id)).toEqual(
      expect.arrayContaining([
        'replay',
        'payload-conflict',
        'intentional-retry',
        'foreign-attempt',
        'cleanup',
      ]),
    );
    expect(plan.clientRequests).toBeGreaterThan(plan.creations);
  });
  it('requires exact preproduction interruption authority for recovery and cold profiles', () => {
    for (const kind of ['recovery', 'performance']) {
      expect(planApiStage({ kind, config }).blockers).toContain(
        'EXACT_PREPRODUCTION_INTERRUPT_AUTHORIZATION_REQUIRED',
      );
      expect(
        planApiStage({
          kind,
          config: {
            ...config,
            azure,
            allowedOperations: ['azure:interrupt-api'],
          },
        }).blockers,
      ).toEqual([]);
    }
  });
  it('declares all 200 performance creations without claiming warm VM reuse', () => {
    const plan = planApiStage({
      kind: 'performance',
      config: { ...config, azure, allowedOperations: ['azure:interrupt-api'] },
    });
    expect(plan.creations).toBe(200);
    expect(plan.cases).toHaveLength(5);
  });
  it.each([
    { ...config, baseUrl: 'http://localhost:4000' },
    { ...config, baseUrl: 'https://user:password@api.alunza.invalid' },
    { ...config, fictitiousOnly: false },
    { ...config, azure: { ...azure, appName: 'safe & injected' } },
  ])('rejects unsafe target without contacting accounts', (value) => {
    expect(planApiStage({ kind: 'api', config: value }).blockers).toContain(
      'API_STAGE_CONFIGURATION_REQUIRED',
    );
  });
  it('blocks before effects if private fixtures or limited database are absent', async () => {
    expect(
      (await preflightApiStage({ kind: 'api', config }, {})).blockers,
    ).toContain('PRIVATE_API_FIXTURES_AND_LIMITED_DATABASE_REQUIRED');
    const result = await executeApiStage(
      { kind: 'api', config },
      { campaign: {}, env: {} },
    );
    expect(result.status).toBe('BLOCKED');
    expect(result.cases).toEqual([]);
  });
});
