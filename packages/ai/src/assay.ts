import { diagnosisCodeSchema, ragHelpSchema } from '@alunza/contracts';
import type { DiagnosisCode, RagHelp, SourceRef } from '@alunza/contracts';
import { AiBoundaryError, validateVectors } from './ports';
import type {
  EmbeddingsPort,
  EvidencePolicy,
  GenerationPort,
  RetrievalPort,
  RetrievalScope,
} from './ports';

export const PROMPT_VERSION = 'imp-00-07-es-1';
export const SCHEMA_VERSION = 'rag-help-1';
export function fallback(
  diagnosis: DiagnosisCode,
  status: 'NO_EVIDENCE' | 'PROVIDER_UNAVAILABLE',
): RagHelp {
  return {
    diagnosis_code: diagnosis,
    explanation:
      status === 'NO_EVIDENCE'
        ? 'No hay material autorizado suficiente para sustentar esta ayuda.'
        : 'La ayuda no está disponible en este momento. Puedes reintentarlo más tarde.',
    hint: '',
    source_refs: [],
    status,
  };
}
export function referenceKey(ref: SourceRef): string {
  return JSON.stringify([
    ref.source_id,
    ref.source_version_id,
    ref.chunk_id,
    ref.locator,
  ]);
}
// Standalone technical assay, explicitly not an academic attempt endpoint.
export async function runRagAssay(input: {
  diagnosis: DiagnosisCode;
  query: string;
  scope: RetrievalScope;
  embeddings: EmbeddingsPort;
  retrieval: RetrievalPort;
  generation: GenerationPort;
  evidence: EvidencePolicy;
  timeoutMs?: number;
}): Promise<{ help: RagHelp; reason: string; semanticPolicy: string }> {
  const diagnosis = diagnosisCodeSchema.parse(input.diagnosis);
  const timeoutMs = input.timeoutMs ?? 15000;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 15000 ||
    !input.query.trim() ||
    input.query.length > 2000
  )
    throw new AiBoundaryError('INVALID_CONFIGURATION');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AiBoundaryError('PROVIDER_FAILURE'));
    }, timeoutMs);
  });
  const execute = async (): Promise<{ help: RagHelp; reason: string }> => {
    await input.retrieval.authorize(input.scope);
    controller.signal.throwIfAborted();
    const vectors = await input.embeddings.embed(
      [input.query],
      controller.signal,
    );
    validateVectors(vectors, 1, input.embeddings.configuration.dimensions);
    controller.signal.throwIfAborted();
    const retrieved = await input.retrieval.retrieve(
      input.scope,
      vectors[0]!,
      input.embeddings.configuration,
    );
    const chunks = input.evidence.relevant(retrieved);
    if (chunks.some((chunk) => !retrieved.includes(chunk)))
      throw new AiBoundaryError('INVALID_OUTPUT');
    if (!chunks.length)
      return {
        help: fallback(diagnosis, 'NO_EVIDENCE'),
        reason: 'NO_AUTHORIZED_EVIDENCE',
      };
    controller.signal.throwIfAborted();
    const raw = await input.generation.generate(
      {
        canonicalDiagnosis: diagnosis,
        authorizedChunks: chunks,
        promptVersion: PROMPT_VERSION,
      },
      controller.signal,
    );
    const parsed = ragHelpSchema.safeParse(raw);
    if (!parsed.success) throw new AiBoundaryError('INVALID_OUTPUT');
    const help = parsed.data;
    const allowed = new Set(chunks.map(referenceKey));
    if (
      help.diagnosis_code !== diagnosis ||
      new Set(help.source_refs.map(referenceKey)).size !==
        help.source_refs.length ||
      help.source_refs.some((ref) => !allowed.has(referenceKey(ref)))
    )
      throw new AiBoundaryError('INVALID_OUTPUT');
    if (help.status !== 'SUPPORTED')
      return {
        help: fallback(diagnosis, help.status),
        reason: 'PROVIDER_DECLINED',
      };
    if (!input.evidence.supports(help, chunks))
      throw new AiBoundaryError('INVALID_OUTPUT');
    controller.signal.throwIfAborted();
    if (!(await input.retrieval.revalidate(input.scope, help.source_refs)))
      return {
        help: fallback(diagnosis, 'NO_EVIDENCE'),
        reason: 'EVIDENCE_REVOKED',
      };
    return { help, reason: 'VALIDATED_FIXTURE_EVIDENCE' };
  };
  try {
    return {
      ...(await Promise.race([execute(), timeout])),
      semanticPolicy: input.evidence.version,
    };
  } catch (error) {
    if (error instanceof AiBoundaryError && error.reason === 'ACCESS_DENIED')
      throw error;
    return {
      help: fallback(diagnosis, 'PROVIDER_UNAVAILABLE'),
      reason:
        error instanceof AiBoundaryError ? error.reason : 'PROVIDER_FAILURE',
      semanticPolicy: input.evidence.version,
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
