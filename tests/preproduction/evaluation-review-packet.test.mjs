import { describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { AzureEmbeddingsAdapter, AzureHelpAdapter } from '@alunza/ai';
import { buildEvaluationReviewPacket } from '../../scripts/evaluation-review-packet.mjs';
import {
  manifest,
  cases,
  documents,
  rubric,
} from '../../fixtures/ai/help-adversarial-manifest.mjs';
import { evaluationCalibrationCases } from '../../scripts/evaluation-prepare.mjs';

const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const textHash = (value) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

describe('offline authored evaluation review packet', () => {
  it('builds synchronously without fetch or any Azure provider phase', () => {
    const guards = [
      jest.spyOn(globalThis, 'fetch'),
      jest.spyOn(AzureEmbeddingsAdapter.prototype, 'embed'),
      jest.spyOn(AzureHelpAdapter.prototype, 'generate'),
      jest.spyOn(AzureHelpAdapter.prototype, 'verify'),
    ];
    guards.forEach((guard) =>
      guard.mockImplementation(() => {
        throw new Error('REMOTE_OPERATION_FORBIDDEN');
      }),
    );
    try {
      const packet = buildEvaluationReviewPacket();
      expect(packet).not.toBeInstanceOf(Promise);
      expect(packet).toMatchObject({
        schemaVersion: 1,
        kind: 'AZURE_HELP_REVIEW_PREPARATION',
        humanAcceptance: 'PENDING',
        azureEvaluation: 'NOT_EXECUTED',
      });
      guards.forEach((guard) => expect(guard).not.toHaveBeenCalled());
    } finally {
      guards.forEach((guard) => guard.mockRestore());
    }
  });

  it('preserves the existing corpus identities, content, classifications and hashes', () => {
    const packet = buildEvaluationReviewPacket();
    expect(packet.inventory.adversarial).toMatchObject({
      version: manifest.version,
      sourceDocumentsSha256: hash(documents),
      sourceCasesSha256: hash(cases),
      documentCount: 12,
      caseCount: 43,
    });
    expect(
      packet.documents.map(({ textSha256, ...document }) => {
        expect(textSha256).toBe(textHash(document.text));
        return document;
      }),
    ).toEqual(documents);
    expect(packet.adversarialCases.map((entry) => entry.id)).toEqual(
      cases.map((entry) => entry.id),
    );
    for (const [index, entry] of packet.adversarialCases.entries()) {
      expect(entry.authoredExpectation).toEqual(cases[index].expected);
      expect(entry.authoredCandidate).toEqual(cases[index].candidate ?? null);
      expect(entry.context).toEqual(cases[index].context);
      expect(entry.forbidden).toEqual(cases[index].forbidden);
      expect(
        entry.chunks.map(({ illustrativeDistance, ...chunk }) => {
          expect(illustrativeDistance.measured).toBe(false);
          expect(chunk).not.toHaveProperty('distance');
          return { ...chunk, distance: illustrativeDistance.value };
        }),
      ).toEqual(cases[index].chunks);
    }
  });

  it('keeps authored candidates and illustrative distances distinct from actual evidence', () => {
    const packet = buildEvaluationReviewPacket();
    expect(packet.interpretation).toMatchObject({
      distances: 'ILLUSTRATIVE_FIXTURE_VALUES_NOT_MEASURED',
      candidates: 'AUTHORED_ADVERSARIAL_INPUTS_NOT_OBSERVED_RESPONSES',
      executionAuthorization: null,
    });
    expect(
      packet.adversarialCases.filter(
        (entry) => entry.authoredCandidate !== null,
      ),
    ).toHaveLength(12);
    for (const entry of [
      ...packet.adversarialCases,
      ...packet.calibrationCases,
    ]) {
      expect(entry.observedResponse).toBeNull();
      expect(entry.observedEvidence).toBeNull();
      expect(entry).not.toHaveProperty('acceptanceThreshold');
    }
    expect(packet).not.toHaveProperty('measurement');
    expect(packet).not.toHaveProperty('calibrationArtifact');
    expect(packet).not.toHaveProperty('runId');
  });

  it('reuses the four calibration labels and keeps the relevant holdout content and groups separate', () => {
    const packet = buildEvaluationReviewPacket();
    expect(packet.inventory.calibration).toMatchObject({
      sourceScenariosSha256: hash(evaluationCalibrationCases),
      scenarioCount: 2,
      caseCount: 4,
      partitions: { calibration: 2, validation: 2 },
    });
    for (const scenario of evaluationCalibrationCases) {
      const rows = packet.calibrationCases.filter(
        (entry) => entry.split === scenario.split,
      );
      expect(rows.map((entry) => entry.authoredExpectation.status)).toEqual([
        'SUPPORTED',
        'NO_EVIDENCE',
      ]);
      expect(rows.map((entry) => entry.sources[0].text)).toEqual([
        scenario.relevantText,
        scenario.irrelevantText,
      ]);
      for (const row of rows) {
        expect(row.context).toEqual({
          statement: scenario.statement,
          code: scenario.code,
        });
        expect(row.authoredExpectedDiagnosis).toBe(scenario.expectedDiagnosis);
        expect(row.sources[0].sha256).toBe(textHash(row.sources[0].text));
        expect(row.authoredExpectation.relevantSourceIds).toEqual(
          row.authoredExpectation.status === 'SUPPORTED'
            ? [row.sources[0].id]
            : [],
        );
      }
    }
    const training = packet.calibrationCases.filter(
      (entry) => entry.split === 'calibration',
    );
    const heldout = packet.calibrationCases.filter(
      (entry) => entry.split === 'validation',
    );
    expect(
      heldout.every(
        (entry) =>
          !training.some(
            (other) =>
              other.groupId === entry.groupId ||
              other.context.statement === entry.context.statement,
          ),
      ),
    ).toBe(true);
    const relevantHashes = training
      .filter((entry) => entry.authoredExpectation.status === 'SUPPORTED')
      .flatMap((entry) => entry.sources.map((source) => source.sha256));
    expect(
      heldout
        .filter((entry) => entry.authoredExpectation.status === 'SUPPORTED')
        .every((entry) =>
          entry.sources.every(
            (source) => !relevantHashes.includes(source.sha256),
          ),
        ),
    ).toBe(true);
  });

  it('uses the current rubric and leaves every actual human field blank', () => {
    const packet = buildEvaluationReviewPacket();
    expect(packet.rubric).toEqual(rubric);
    expect(packet.inventory.rubric).toEqual({
      version: rubric.version,
      sha256: hash(rubric),
      dimensions: 6,
    });
    for (const entry of [
      ...packet.adversarialCases,
      ...packet.calibrationCases,
    ]) {
      expect(entry.humanReview.status).toBe('PENDING');
      expect(entry.humanReview.acceptance).toBeNull();
      expect(
        entry.humanReview.records.map((record) => record.dimension),
      ).toEqual(rubric.dimensions);
      for (const record of entry.humanReview.records) {
        expect(Object.keys(record)).toEqual(rubric.record);
        expect(record.caseId).toBe(entry.id);
        for (const field of rubric.record.filter(
          (field) => !['caseId', 'dimension'].includes(field),
        ))
          expect(record[field]).toBeNull();
      }
    }
  });

  it('returns reproducible JSON and never lets a review edit mutate the source fixtures or another packet', () => {
    const before = hash({
      cases,
      documents,
      rubric,
      evaluationCalibrationCases,
    });
    const first = buildEvaluationReviewPacket(),
      second = buildEvaluationReviewPacket();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    first.documents[0].text = 'edited locally';
    first.adversarialCases[0].context.code = 'changed';
    first.adversarialCases.find(
      (entry) => entry.authoredCandidate,
    ).authoredCandidate.explanation = 'edited';
    first.calibrationCases[0].authoredTestExpectedResults[0] = -1;
    first.adversarialCases[0].humanReview.records[0].reviewer =
      'local reviewer';
    first.rubric.dimensions.push('not canonical');
    expect(hash({ cases, documents, rubric, evaluationCalibrationCases })).toBe(
      before,
    );
    expect(buildEvaluationReviewPacket()).toEqual(second);
    expect(
      second.adversarialCases[0].humanReview.records[0].reviewer,
    ).toBeNull();
  });
});
