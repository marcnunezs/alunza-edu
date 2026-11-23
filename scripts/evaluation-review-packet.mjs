// Offline preparation only. No run, provider, service or human review is created.
import { createHash } from 'node:crypto';
import {
  manifest,
  documents,
  cases,
  rubric,
} from '../fixtures/ai/help-adversarial-manifest.mjs';
import { evaluationCalibrationCases } from './evaluation-prepare.mjs';

const copy = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const textHash = (value) =>
  createHash('sha256').update(value, 'utf8').digest('hex');
const counts = (values) =>
  Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((value) => [value, values.filter((item) => item === value).length]),
  );

function pendingReview(caseId) {
  return {
    status: 'PENDING',
    acceptance: null,
    records: rubric.dimensions.map((dimension) =>
      Object.fromEntries(
        rubric.record.map((field) => [
          field,
          field === 'caseId'
            ? caseId
            : field === 'dimension'
              ? dimension
              : null,
        ]),
      ),
    ),
  };
}

/**
 * Synchronous snapshot of the authored fixtures, not an evaluation report.
 * Stable content deliberately excludes timestamps, random IDs and environment.
 * The operational preparer supplies the four calibration labels; importing its
 * module does not authenticate, create data or invoke prepareEvaluation().
 */
export function buildEvaluationReviewPacket() {
  const calibrationCases = evaluationCalibrationCases.flatMap((scenario) =>
    [true, false].map((relevant) => {
      // These names and labels are those used by prepareEvaluation. Neither the
      // source ID here nor the adversarial UUID templates identify stored data.
      const caseId = `${scenario.split}-${relevant ? 'positive' : 'near-negative'}`;
      const sourceId = `calibration-${caseId}`;
      const text = relevant ? scenario.relevantText : scenario.irrelevantText;
      return {
        id: caseId,
        groupId: `${scenario.split}-exercise-${relevant ? 'positive' : 'negative'}`,
        split: scenario.split,
        context: { statement: scenario.statement, code: scenario.code },
        authoredExpectedDiagnosis: scenario.expectedDiagnosis,
        authoredTestExpectedResults: copy(scenario.expectedResults),
        sources: [{ id: sourceId, text, sha256: textHash(text) }],
        authoredExpectation: {
          status: relevant ? 'SUPPORTED' : 'NO_EVIDENCE',
          relevantSourceIds: relevant ? [sourceId] : [],
        },
        observedResponse: null,
        observedEvidence: null,
        humanReview: pendingReview(caseId),
      };
    }),
  );
  return {
    schemaVersion: 1,
    kind: 'AZURE_HELP_REVIEW_PREPARATION',
    humanAcceptance: 'PENDING',
    azureEvaluation: 'NOT_EXECUTED',
    interpretation: {
      identities: 'FIXTURE_TEMPLATES_NOT_PERSISTED_BINDINGS',
      expectations: 'AUTHOR_LABELS_NOT_HUMAN_REVIEWED',
      candidates: 'AUTHORED_ADVERSARIAL_INPUTS_NOT_OBSERVED_RESPONSES',
      distances: 'ILLUSTRATIVE_FIXTURE_VALUES_NOT_MEASURED',
      calibration: 'RETRIEVAL_PERTINENCE_ONLY_NOT_PEDAGOGICAL_ACCEPTANCE',
      executionAuthorization: null,
    },
    inventory: {
      adversarial: {
        source: 'fixtures/ai/help-adversarial-manifest.mjs',
        version: manifest.version,
        corpusKind: manifest.corpusKind,
        productionCalibration: manifest.productionCalibration,
        sourceDocumentsSha256: manifest.corpusHash,
        sourceCasesSha256: manifest.casesHash,
        documentCount: documents.length,
        caseCount: cases.length,
        categories: counts(cases.map((item) => item.category)),
      },
      calibration: {
        source: 'scripts/evaluation-prepare.mjs#evaluationCalibrationCases',
        sourceScenariosSha256: hash(evaluationCalibrationCases),
        scenarioCount: evaluationCalibrationCases.length,
        caseCount: calibrationCases.length,
        partitions: counts(calibrationCases.map((item) => item.split)),
      },
      rubric: {
        version: rubric.version,
        sha256: hash(rubric),
        dimensions: rubric.dimensions.length,
      },
    },
    documents: documents.map((document) => ({
      ...copy(document),
      textSha256: textHash(document.text),
    })),
    adversarialCases: cases.map((item) => ({
      id: item.id,
      group: item.group,
      category: item.category,
      context: copy(item.context),
      kind: item.kind,
      hintLevel: item.hintLevel,
      chunks: item.chunks.map(({ distance, ...chunk }) => ({
        ...copy(chunk),
        illustrativeDistance: { value: distance, measured: false },
      })),
      authoredExpectation: copy(item.expected),
      authoredCandidate: item.candidate ? copy(item.candidate) : null,
      forbidden: copy(item.forbidden),
      observedResponse: null,
      observedEvidence: null,
      humanReview: pendingReview(item.id),
    })),
    calibrationCases,
    rubric: copy(rubric),
  };
}
