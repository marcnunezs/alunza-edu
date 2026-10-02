/* eslint @typescript-eslint/no-require-imports: "off" */
// This controlled oracle is imported only by the isolated TEST entrypoint. It
// does not establish semantic quality, remote latency, or Azure calibration.
const { HelpBoundaryError } = require('@alunza/ai');
const { readHelpFault } = require('./help-fault-controls.cjs');
const { observedCall } = require('./help-fault-observer.cjs');
function testHelpFactory(embeddings, control = readHelpFault) {
  return () => ({
    embeddings: {
      configuration: embeddings.configuration,
      async embed(texts, signal, observer) {
        if (control()?.scenario === 'embedding-unavailable')
          return observedCall('EMBEDDING', signal, observer, async () => {
            throw new HelpBoundaryError('PROVIDER_UNAVAILABLE');
          });
        return embeddings.embed(texts, signal, observer);
      },
    },
    configurationId: 'help-fixture-v1',
    configurationFingerprint: 'help-fixture-profile-v1',
    tokenizer: 'cl100k_base',
    evidence: {
      version: 'help-fixture-policy-v1',
      select(chunks) {
        const relevant = control()?.scenario === 'no-evidence' ? [] : chunks;
        return {
          chunks: relevant,
          reason: relevant.length ? 'SUPPORTED' : 'NO_EVIDENCE',
        };
      },
    },
    generation: {
      async generate(input, signal, observer) {
        return observedCall('GENERATION', signal, observer, async () => {
          signal.throwIfAborted();
          const scenario = control(input.context.attemptId)?.scenario;
          if (scenario === 'generation-delay') await delay(4000, signal);
          if (scenario === 'deadline') await delay(20000, signal);
          if (scenario === 'generation-unavailable')
            throw new HelpBoundaryError('PROVIDER_UNAVAILABLE');
          const refs = input.chunks.map(
            ({ source_id, source_version_id, chunk_id, locator }) => ({
              source_id,
              source_version_id,
              chunk_id,
              locator,
            }),
          );
          const candidate = {
            diagnosis_code: input.context.diagnosisCode,
            explanation:
              'El resultado guardado se explica con el material autorizado.',
            hint:
              input.kind === 'HINT'
                ? [
                    'Revisa el concepto indicado en la fuente.',
                    '¿Qué ocurre con los datos al evaluar la condición?',
                    'Traza el siguiente paso en pseudocódigo, sin completar la solución.',
                  ][input.hintLevel - 1]
                : '',
            source_refs: refs,
            status: 'SUPPORTED',
          };
          if (scenario === 'literal-html')
            candidate.explanation =
              '<img src=x onerror="window.__helpInjected=true"> Texto literal del proveedor de prueba.';
          if (scenario === 'invalid-output') candidate.score = 1;
          if (scenario === 'fake-reference')
            candidate.source_refs[0].chunk_id =
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
          if (scenario === 'diagnosis-contradiction')
            candidate.diagnosis_code =
              candidate.diagnosis_code === 'SUCCESS'
                ? 'FAILED_TEST'
                : 'SUCCESS';
          return {
            candidate,
            usage: {
              model: 'test-fixture-only',
              inputTokens: 100,
              outputTokens: 30,
            },
          };
        });
      },
    },
    verification: {
      async verify(input, candidate, signal, observer) {
        return observedCall('REVIEW', signal, observer, async () => {
          signal.throwIfAborted();
          const scenario = control(input.context.attemptId)?.scenario;
          if (scenario === 'review-delay') await delay(4000, signal);
          if (scenario === 'review-unavailable')
            throw new HelpBoundaryError('PROVIDER_UNAVAILABLE');
          const verification =
            scenario === 'ambiguous'
              ? {
                  verdict: 'NO_EVIDENCE',
                  reason: 'AMBIGUOUS_EVIDENCE',
                  source_refs: [],
                }
              : ['reject-solution', 'reject-injection'].includes(scenario)
                ? {
                    verdict: 'REJECT',
                    reason:
                      scenario === 'reject-injection'
                        ? 'INSTRUCTION_INJECTION'
                        : 'SOLUTION_DISCLOSURE',
                    source_refs: [],
                  }
                : {
                    verdict: 'ACCEPT',
                    reason: 'SUPPORTED',
                    source_refs: candidate.source_refs,
                  };
          return {
            verification,
            usage: {
              model: 'test-fixture-only',
              inputTokens: 130,
              outputTokens: 20,
            },
          };
        });
      },
    },
  });
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
module.exports = { testHelpFactory };
