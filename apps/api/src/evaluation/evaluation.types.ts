import type {
  AiSettlementObserver,
  EmbeddingConfiguration,
  HelpContext,
} from '@alunza/ai';
import type { EvaluationPhase, EvaluationManifest } from '@alunza/contracts';

export const EVALUATION_CONFIG = Symbol('EVALUATION_CONFIG');
export interface EvaluationConfig {
  enabled: boolean;
  operationsPort: number;
}
export interface EvaluationOwner {
  kind: 'MATERIAL' | 'HELP' | 'CALIBRATION';
  id: string;
  token: string;
}
export interface EvaluationCallSpec {
  owner: EvaluationOwner;
  phase: EvaluationPhase;
  logicalKey: string;
  inputHash: string;
  configuration: {
    id: string;
    model: string;
    dimensions?: number;
    fingerprint?: string;
  };
  reservedInputTokens: number;
  maxOutputTokens: number;
  attempt?: number;
}
export type EvaluationReservation =
  | { state: 'DISPATCH'; callId: string; dispatchToken: string }
  | { state: 'COMPLETED'; callId: string; result: unknown }
  | { state: 'STOP'; callId: string }
  | {
      state: 'ERROR';
      callId: string;
      failure: { code: string; retryable: boolean; retryAfterMs?: number };
    };
export interface EvaluationCalibrationJob {
  kind: 'CALIBRATION' | 'REVIEW';
  id: string;
  token: string;
  runId: string;
  caseId: string;
  corpusHash: string;
  profile: EvaluationManifest['profiles']['EMBEDDING'];
  calibration: NonNullable<EvaluationManifest['cases'][number]['calibration']>;
  reviewCase?: NonNullable<EvaluationManifest['cases'][number]['reviewCase']>;
}
export interface EvaluationCalibrationContext {
  scope: {
    organizationId: string;
    classId: string;
    activityId: string;
    studentId: string;
  };
  context: HelpContext;
}
export interface EvaluationCalibrationEvidence {
  manifest: EvaluationManifest;
  corpus: { sourceVersionId: string; chunkId: string; contentHash: string }[];
  queries: { caseId: string; text: string; queryHash: string }[];
  observations: {
    caseId: string;
    callId: string;
    queryHash: string;
    corpusHash: string;
    candidates: { chunkId: string; distance: number }[];
  }[];
  cases: {
    id: string;
    metadata: EvaluationCalibrationJob['calibration'];
    queryHash: string;
    candidates: { chunkId: string; distance: number }[];
    relevantChunkIds: string[];
    callId: string;
  }[];
  receipts: {
    callId: string;
    runId: string;
    provider: 'AZURE' | 'TEST';
    configurationId: string;
    model: string;
    dimensions: number;
    inputHash: string;
    state: 'COMPLETED';
    requestId?: string;
  }[];
}
export type EvaluationInvoke<T> = (
  observer: AiSettlementObserver,
) => Promise<T>;
export type EvaluationEmbeddingConfiguration = EmbeddingConfiguration;
export class EvaluationCallError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'EvaluationCallError';
  }
}
