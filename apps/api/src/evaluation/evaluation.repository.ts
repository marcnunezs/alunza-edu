import { Injectable } from '@nestjs/common';
import type {
  EmbeddingConfiguration,
  RetrievedChunk,
  HelpCalibrationBinding,
} from '@alunza/ai';
import {
  validateVectors,
  verifiedHelpCalibrationHash,
  calibrateHelpEvidenceFromReceipts,
  HELP_QUERY_VERSION,
  TOKENIZER_VERSION,
} from '@alunza/ai';
import type {
  EvaluationObservation,
  EvaluationStage,
  EvaluationReceipt,
} from '@alunza/contracts';
import { DatabaseService } from '../database/database.service';
import type {
  EvaluationCallSpec,
  EvaluationReservation,
  EvaluationCalibrationJob,
  EvaluationCalibrationContext,
  EvaluationCalibrationEvidence,
  EvaluationOwner,
} from './evaluation.types';

@Injectable()
export class EvaluationRepository {
  constructor(private readonly database: DatabaseService) {}
  private call<T>(name: string, values: unknown[] = []): Promise<T> {
    return this.database.internal(
      async (client) =>
        (
          await client.query(
            `SELECT app_private.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) AS result`,
            values,
          )
        ).rows[0]?.result as T,
    );
  }
  reserve(spec: EvaluationCallSpec, required: boolean) {
    return this.call<EvaluationReservation>('evaluation_reserve', [
      JSON.stringify(spec),
      required,
    ]);
  }
  findReceipt(
    owner: EvaluationOwner,
    phase: EvaluationCallSpec['phase'],
    key: string,
  ) {
    return this.call<EvaluationReceipt | null>('evaluation_find_receipt', [
      JSON.stringify(owner),
      phase,
      key,
    ]);
  }
  observe(callId: string, token: string, event: EvaluationObservation) {
    return this.call<boolean>('evaluation_observe', [
      callId,
      token,
      JSON.stringify(event),
    ]);
  }
  complete(
    callId: string,
    token: string,
    result: unknown,
    failure?: { code: string; retryable: boolean; retryAfterMs?: number },
  ) {
    return this.call<boolean>('evaluation_complete', [
      callId,
      token,
      result === undefined ? null : JSON.stringify(result),
      failure ? JSON.stringify(failure) : null,
    ]);
  }
  status(runId: string, digest: string) {
    return this.call<Record<string, unknown>>('evaluation_status', [
      runId,
      digest,
    ]);
  }
  receipts(runId: string, digest: string, cursor?: string, limit = 100) {
    return this.call<{ items: unknown[]; nextCursor: string | null }>(
      'evaluation_receipts',
      [runId, digest, cursor ?? null, limit],
    );
  }
  startStage(runId: string, digest: string, stage: EvaluationStage) {
    return this.call<Record<string, unknown>>('evaluation_start_stage', [
      runId,
      digest,
      stage,
    ]);
  }
  stop(runId: string, digest: string) {
    return this.call<Record<string, unknown>>('evaluation_stop', [
      runId,
      digest,
    ]);
  }
  claimCalibration() {
    return this.call<EvaluationCalibrationJob | null>(
      'evaluation_calibration_claim',
    );
  }
  pendingCalibrationRun() {
    return this.call<string | null>('evaluation_calibration_pending');
  }
  failCalibrationRun(runId: string, reason = 'CALIBRATION_INVALID') {
    return this.call<boolean>('evaluation_calibration_run_fail', [
      runId,
      reason,
    ]);
  }
  renewCalibration(job: EvaluationCalibrationJob) {
    return this.call<boolean>('evaluation_calibration_renew', [
      job.id,
      job.token,
    ]);
  }
  calibrationContext(job: EvaluationCalibrationJob) {
    return this.call<EvaluationCalibrationContext | null>(
      'evaluation_calibration_context',
      [job.id, job.token],
    );
  }
  prepareCalibrationQuery(job: EvaluationCalibrationJob, query: string) {
    return this.call<string | null>('evaluation_calibration_query', [
      job.id,
      job.token,
      query,
    ]);
  }
  reviewReferences(job: EvaluationCalibrationJob) {
    return this.call<
      {
        materialBindingId: string;
        source_id: string;
        source_version_id: string;
        chunk_id: string;
        locator: string;
      }[]
    >('evaluation_review_references', [job.id, job.token]);
  }
  completeReviewCase(
    job: EvaluationCalibrationJob,
    reviewCallId: string | null,
    boundaryRejected = false,
  ) {
    return this.call<boolean>('evaluation_review_complete', [
      job.id,
      job.token,
      reviewCallId,
      boundaryRejected,
    ]);
  }
  async calibrationRetrieve(
    job: EvaluationCalibrationJob,
    vector: readonly number[],
    queryHash: string,
    callId: string,
    config?: EmbeddingConfiguration,
  ) {
    const profile = config ?? job.profile;
    validateVectors([vector], 1, profile.dimensions!);
    return this.call<RetrievedChunk[] | null>(
      'evaluation_calibration_retrieve',
      [job.id, job.token, JSON.stringify(vector), queryHash, callId],
    );
  }
  calibrationEvidence(runId: string) {
    return this.call<EvaluationCalibrationEvidence | null>(
      'evaluation_calibration_evidence',
      [runId],
    );
  }
  async finishCalibration(runId: string, artifact: unknown) {
    const stored = await this.calibrationEvidence(runId);
    if (!stored) return false;
    const profile = stored.manifest.profiles.EMBEDDING;
    const binding: HelpCalibrationBinding = {
      configurationId: profile.id,
      embeddingModel: profile.model,
      dimensions: profile.dimensions!,
      tokenizerVersion: TOKENIZER_VERSION,
      queryVersion: HELP_QUERY_VERSION,
      corpusHash: stored.manifest.corpusHash,
    };
    const evidence = {
      version: 'help-measurement-1',
      origin: stored.manifest.provider,
      runId,
      binding,
      corpus: stored.corpus,
      cases: stored.cases.map((c) => ({
        id: c.metadata.caseId,
        groupId: c.metadata.groupId,
        split: c.metadata.split,
        expected: c.metadata.expected,
        relevantChunkIds: c.relevantChunkIds,
        candidates: c.candidates,
      })),
      queries: stored.queries,
      observations: stored.observations,
    };
    const expected = calibrateHelpEvidenceFromReceipts(evidence, {
      origin: stored.manifest.provider,
      runId,
      binding,
      corpus: stored.corpus,
      observations: stored.observations,
      receipts: stored.receipts,
    });
    if (
      verifiedHelpCalibrationHash(expected) !==
      verifiedHelpCalibrationHash(artifact)
    )
      return false;
    return this.call<boolean>('evaluation_calibration_finish', [
      runId,
      JSON.stringify(artifact),
      verifiedHelpCalibrationHash(artifact),
    ]);
  }
  failCalibration(job: EvaluationCalibrationJob) {
    return this.call<boolean>('evaluation_calibration_fail', [
      job.id,
      job.token,
    ]);
  }
  assertCalibration(
    artifact: unknown,
    allowTest = false,
    embeddingFingerprint?: string,
  ) {
    return this.call<string | null>('evaluation_calibration_assert', [
      JSON.stringify(artifact),
      allowTest,
      embeddingFingerprint ?? null,
    ]);
  }
  canContinue(owner: EvaluationOwner) {
    return this.call<boolean>('evaluation_can_continue', [
      JSON.stringify(owner),
    ]);
  }
}
