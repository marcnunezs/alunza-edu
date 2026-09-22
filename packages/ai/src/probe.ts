import { ragHelpSchema } from '@alunza/contracts';
import type { RagHelp, SourceRef } from '@alunza/contracts';
import { AiBoundaryError, validateVectors } from './ports';
import type {
  EmbeddingsPort,
  GenerationPort,
  RetrievalPort,
  RetrievalScope,
  RetrievedChunk,
} from './ports';
import { fallback, PROMPT_VERSION, referenceKey } from './assay';

export interface ProbeChunk extends SourceRef {
  text: string;
}
// Validates transport, dimensions, scope and shape; semantic review stays pending.
export async function runProviderProbe(input: {
  mode: 'connectivity' | 'rag-local';
  embeddings: EmbeddingsPort;
  generation: GenerationPort;
  chunks: readonly ProbeChunk[];
  query: string;
  signal: AbortSignal;
  local?: {
    maxCosineDistance: number;
    scope: RetrievalScope;
    repository: RetrievalPort;
    publish: (vectors: readonly (readonly number[])[]) => Promise<void>;
  };
}): Promise<{ help: RagHelp; retrievedCount: number; dimension: number }> {
  if (
    !['connectivity', 'rag-local'].includes(input.mode) ||
    !input.chunks.length ||
    input.chunks.length > 31
  )
    throw new AiBoundaryError('INVALID_CONFIGURATION');
  if (
    input.mode === 'rag-local' &&
    (!input.local ||
      !Number.isFinite(input.local.maxCosineDistance) ||
      input.local.maxCosineDistance < 0 ||
      input.local.maxCosineDistance > 2 ||
      input.embeddings.configuration.id === 'synthetic-3d-v1')
  )
    throw new AiBoundaryError('INVALID_CONFIGURATION');
  const chunks =
    input.mode === 'connectivity' ? input.chunks.slice(0, 1) : input.chunks;
  const vectors = await input.embeddings.embed(
    [...chunks.map((chunk) => chunk.text), input.query],
    input.signal,
  );
  validateVectors(
    vectors,
    chunks.length + 1,
    input.embeddings.configuration.dimensions,
  );
  input.signal.throwIfAborted();
  let retrieved: RetrievedChunk[];
  if (input.mode === 'rag-local') {
    const local = input.local!;
    await local.publish(vectors.slice(0, -1));
    await local.repository.authorize(local.scope);
    retrieved = (
      await local.repository.retrieve(
        local.scope,
        vectors.at(-1)!,
        input.embeddings.configuration,
      )
    ).filter((chunk) => chunk.distance <= local.maxCosineDistance);
  } else retrieved = chunks.map((chunk) => ({ ...chunk, distance: 0 }));
  if (!retrieved.length)
    return {
      help: fallback('FAILED_TEST', 'NO_EVIDENCE'),
      retrievedCount: 0,
      dimension: input.embeddings.configuration.dimensions,
    };
  input.signal.throwIfAborted();
  const candidate = await input.generation.generate(
    {
      canonicalDiagnosis: 'FAILED_TEST',
      authorizedChunks: retrieved,
      promptVersion: PROMPT_VERSION,
    },
    input.signal,
  );
  const parsed = ragHelpSchema.safeParse(candidate);
  if (!parsed.success) throw new AiBoundaryError('INVALID_OUTPUT');
  const help = parsed.data,
    allowed = new Set(retrieved.map(referenceKey));
  if (
    help.diagnosis_code !== 'FAILED_TEST' ||
    help.source_refs.some((ref) => !allowed.has(referenceKey(ref))) ||
    new Set(help.source_refs.map(referenceKey)).size !== help.source_refs.length
  )
    throw new AiBoundaryError('INVALID_OUTPUT');
  input.signal.throwIfAborted();
  if (
    input.mode === 'rag-local' &&
    !(await input.local!.repository.revalidate(
      input.local!.scope,
      help.source_refs,
    ))
  )
    return {
      help: fallback('FAILED_TEST', 'NO_EVIDENCE'),
      retrievedCount: 0,
      dimension: input.embeddings.configuration.dimensions,
    };
  return {
    help:
      help.status === 'SUPPORTED' ? help : fallback('FAILED_TEST', help.status),
    retrievedCount: retrieved.length,
    dimension: input.embeddings.configuration.dimensions,
  };
}
