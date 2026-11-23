import type { DiagnosisCode, RagHelp, SourceRef } from '@alunza/contracts';
import type { AiSettlementObserver } from './settlement';

export interface EmbeddingConfiguration {
  id: string;
  model: string;
  dimensions: number;
}
export interface EmbeddingsPort {
  readonly configuration: EmbeddingConfiguration;
  /** Bounded observation of the last completed call, persisted with its batch. */
  readonly lastUsage?:
    | {
        inputTokens: number;
        model: string;
        requestId?: string;
      }
    | undefined;
  embed(
    texts: readonly string[],
    signal: AbortSignal,
    observe?: AiSettlementObserver,
  ): Promise<readonly (readonly number[])[]>;
}
export interface RetrievedChunk extends SourceRef {
  text: string;
  distance: number;
}
// Technical harness scope. Only verified actors and explicit fixture grants are accepted.
// This is not the future academic class authorization model.
export interface RetrievalScope {
  actorId: string;
  organizationId: string;
  classId: string;
  activityId: string;
}
export interface RetrievalPort {
  authorize(scope: RetrievalScope): Promise<void>;
  retrieve(
    scope: RetrievalScope,
    vector: readonly number[],
    config: EmbeddingConfiguration,
  ): Promise<RetrievedChunk[]>;
  revalidate(
    scope: RetrievalScope,
    refs: readonly SourceRef[],
  ): Promise<boolean>;
}
export interface GenerationInput {
  canonicalDiagnosis: DiagnosisCode;
  authorizedChunks: readonly RetrievedChunk[];
  promptVersion: string;
}
export interface GenerationPort {
  generate(input: GenerationInput, signal: AbortSignal): Promise<unknown>;
}
export interface EvidencePolicy {
  readonly version: string;
  // A fixture oracle is valid only for the named fictitious corpus. It is not a
  // general semantic verifier and cannot certify pedagogical quality.
  relevant(chunks: readonly RetrievedChunk[]): readonly RetrievedChunk[];
  supports(help: RagHelp, chunks: readonly RetrievedChunk[]): boolean;
}
export class AiBoundaryError extends Error {
  constructor(
    public readonly reason:
      | 'ACCESS_DENIED'
      | 'DATABASE_UNAVAILABLE'
      | 'INVALID_VECTOR'
      | 'PROVIDER_FAILURE'
      | 'INVALID_OUTPUT'
      | 'INVALID_CONFIGURATION',
  ) {
    super(reason);
    this.name = 'AiBoundaryError';
  }
}
export function validateVectors(
  vectors: readonly (readonly number[])[],
  count: number,
  dimensions: number,
): void {
  if (
    !Array.isArray(vectors) ||
    !Number.isInteger(dimensions) ||
    dimensions < 1 ||
    dimensions > 16000 ||
    vectors.length !== count
  )
    throw new AiBoundaryError('INVALID_VECTOR');
  for (const vector of vectors) {
    if (
      !Array.isArray(vector) ||
      vector.length !== dimensions ||
      vector.some((value) => !Number.isFinite(value)) ||
      !vector.some((value) => value !== 0)
    )
      throw new AiBoundaryError('INVALID_VECTOR');
  }
}
