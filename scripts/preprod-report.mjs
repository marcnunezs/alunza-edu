import { open } from 'node:fs/promises';

function measure(value, maximum = 3_640_000) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= maximum
    ? Math.round(value)
    : null;
}
export function publicProbeEvidence(operation, input, manifest) {
  const remoteCalls = measure(input?.remoteCalls, 100);
  if (operation === 'probe:ai') {
    const usage = Array.isArray(input?.usage)
      ? input.usage.slice(0, 2).map((item) => ({
          operation: ['embeddings', 'generation'].includes(item.operation)
            ? item.operation
            : 'invalid',
          inputTokens: measure(item.inputTokens, 1_000_000),
          outputTokens: measure(item.outputTokens, 1_000_000),
        }))
      : [];
    const durationMs = measure(input?.durationMs);
    const embeddingDimensions = measure(input?.embeddingDimensions, 4096);
    return {
      complete:
        input?.status === 'transport-contract-scope-passed' &&
        input?.mode === 'connectivity' &&
        remoteCalls === 2 &&
        durationMs !== null &&
        embeddingDimensions ===
          manifest.targets.azureOpenAi.embeddingDimensions &&
        usage.length === 2 &&
        new Set(usage.map((item) => item.operation)).size === 2 &&
        usage.every(
          (item) =>
            item.operation !== 'invalid' &&
            item.inputTokens !== null &&
            item.outputTokens !== null,
        ),
      provider: 'azure',
      mode: 'connectivity',
      configuredRegion: manifest.targets.azureOpenAi.region,
      observedRegion: null,
      remoteCalls,
      durationMs,
      embeddingDimensions,
      usage,
      cleanupVerified: null,
      semanticReview: 'pending',
      monetaryHardLimit: false,
      observedCost: null,
    };
  }
  if (operation !== 'probe:sandbox')
    throw new Error('Invalid probe operation.');
  const cases = Array.isArray(input?.cases)
    ? input.cases.slice(0, 1).map((item) => ({
        passed: item.status === 'PASS',
        runtimeMs: measure(item.runtimeMs),
        lifecycleMs: measure(item.lifecycleMs),
        outputBytes: measure(item.outputBytes, 65536),
        vcpus: measure(item.sandbox?.vcpus, 16),
        memoryMb: measure(item.sandbox?.memoryMb, 32768),
        observedRegion:
          item.sandbox?.region === manifest.targets.sandbox.region
            ? manifest.targets.sandbox.region
            : null,
        cleanupVerified:
          item.evidence?.cleanupVerified === true &&
          item.sandbox?.cleanupVerified === true,
      }))
    : [];
  return {
    complete:
      input?.provider === 'vercel' &&
      input?.failures === 0 &&
      input?.authorizationChecked === true &&
      remoteCalls !== null &&
      Array.isArray(input?.cases) &&
      input.cases.length === 1 &&
      cases.length === 1 &&
      cases.every(
        (item) =>
          item.passed &&
          item.cleanupVerified &&
          item.runtimeMs !== null &&
          item.lifecycleMs !== null &&
          item.outputBytes !== null &&
          item.vcpus !== null &&
          item.memoryMb !== null &&
          item.observedRegion !== null,
      ),
    provider: 'vercel',
    configuredRegion: manifest.targets.sandbox.region,
    remoteCalls,
    sandboxRuns: cases.length,
    cases,
    cleanupVerified:
      cases.length === 1 && cases.every((item) => item.cleanupVerified),
    invocationAuthenticity: 'not-proven',
    monetaryHardLimit: false,
    observedCost: null,
  };
}
export async function readProbeEvidence(path, operation, manifest) {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65536) throw new Error('Probe report exceeds limit.');
    return publicProbeEvidence(
      operation,
      JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')),
      manifest,
    );
  } finally {
    await file.close();
  }
}
