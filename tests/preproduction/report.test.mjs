import { describe, test, expect } from '@jest/globals';
import { publicProbeEvidence } from '../../scripts/preprod-report.mjs';
import { preparedManifest } from './fixture.mjs';

describe('bounded public Job measurements', () => {
  test('keeps only AI token/time/dimension measurements and distinguishes configured region', async () => {
    const manifest = await preparedManifest();
    const source = {
      status: 'transport-contract-scope-passed',
      mode: 'connectivity',
      remoteCalls: 2,
      durationMs: 42,
      embeddingDimensions: manifest.targets.azureOpenAi.embeddingDimensions,
      usage: [
        {
          operation: 'embeddings',
          inputTokens: 10,
          outputTokens: 0,
          model: 'secret-model-value',
        },
        { operation: 'generation', inputTokens: 12, outputTokens: 20 },
      ],
      token: 'sensitive-value',
      answer: 'sensitive-value',
    };
    const result = publicProbeEvidence('probe:ai', source, manifest);
    expect(result.complete).toBe(true);
    expect(result.observedRegion).toBeNull();
    expect(result.observedCost).toBeNull();
    expect(JSON.stringify(result)).not.toContain('sensitive-value');
    expect(JSON.stringify(result)).not.toContain('secret-model-value');
    expect(JSON.stringify(result).length).toBeLessThan(4096);
  });
  test('missing token usage cannot produce complete AI evidence', async () => {
    const manifest = await preparedManifest();
    expect(
      publicProbeEvidence(
        'probe:ai',
        {
          status: 'transport-contract-scope-passed',
          mode: 'connectivity',
          remoteCalls: 2,
        },
        manifest,
      ).complete,
    ).toBe(false);
  });
  test('runner requires observed cleanup and omits names and capsule output', async () => {
    const manifest = await preparedManifest();
    const source = {
      provider: 'vercel',
      remoteCalls: 8,
      failures: 0,
      authorizationChecked: true,
      cases: [
        {
          status: 'PASS',
          runtimeMs: 22,
          lifecycleMs: 44,
          outputBytes: 0,
          stdout: 'private program output',
          evidence: { cleanupVerified: true },
          sandbox: {
            region: manifest.targets.sandbox.region,
            vcpus: 1,
            memoryMb: 2048,
            cleanupVerified: true,
            sandboxName: 'private-sandbox-id',
          },
        },
      ],
    };
    const result = publicProbeEvidence('probe:sandbox', source, manifest);
    expect(result.complete).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private');
    source.cases[0].sandbox.cleanupVerified = false;
    expect(
      publicProbeEvidence('probe:sandbox', source, manifest).complete,
    ).toBe(false);
  });
});
