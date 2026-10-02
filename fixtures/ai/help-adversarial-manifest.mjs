import { createHash } from 'node:crypto';
import { cases, documents, rubric, version } from './adversarial/corpus.mjs';
export { cases, documents, rubric };
export const manifest = Object.freeze({
  version,
  corpusKind: 'FICTITIOUS_ADVERSARIAL',
  productionCalibration: false,
  providerEvaluation: 'NOT_EXECUTED',
  humanAcceptance: 'PENDING',
  documentCount: documents.length,
  caseCount: cases.length,
  corpusHash: createHash('sha256')
    .update(JSON.stringify(documents))
    .digest('hex'),
  casesHash: createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
  rubricVersion: rubric.version,
});
