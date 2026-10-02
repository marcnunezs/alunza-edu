import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HELP_QUERY_VERSION, HelpBoundaryError, helpTokenCount } from './help';
import { TOKENIZER_VERSION } from './ingestion';
import {
  calibrateHelpEvidence,
  helpCalibrationArtifactSchema,
  helpEvidencePolicyFromArtifact,
} from './help-calibration';
import type {
  HelpCalibrationBinding,
  HelpCalibrationCase,
  HelpEvidencePolicy,
} from './help-calibration';

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const label = z.string().min(1).max(128);
const safeId = z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/u);
const bindingSchema = helpCalibrationArtifactSchema.shape.binding;
const candidateSchema = z.strictObject({
  chunkId: z.uuid(),
  distance: z.number().finite().min(0).max(2),
});
export const helpCalibrationReceiptSchema = z.object({
  callId: z.uuid(),
  runId: z.uuid(),
  provider: z.enum(['AZURE', 'TEST']),
  configurationId: label,
  model: label,
  dimensions: z.number().int().min(1).max(16000),
  inputHash: hash,
  state: z.literal('COMPLETED'),
  requestId: safeId.optional(),
});
export type HelpCalibrationReceipt = z.infer<
  typeof helpCalibrationReceiptSchema
>;
export const helpCalibrationObservationSchema = z.strictObject({
  caseId: label,
  callId: z.uuid(),
  queryHash: hash,
  corpusHash: hash,
  candidates: z.array(candidateSchema).max(5),
});
export type HelpCalibrationObservation = z.infer<
  typeof helpCalibrationObservationSchema
>;
const sourceSchema = z.strictObject({
  sourceVersionId: z.uuid(),
  chunkId: z.uuid(),
  contentHash: hash,
});
const evidenceSchema = z.strictObject({
  version: z.literal('help-measurement-1'),
  origin: z.enum(['AZURE', 'TEST']),
  runId: z.uuid(),
  binding: bindingSchema,
  corpus: z.array(sourceSchema).min(1).max(5000),
  // This dataset labels retrieval pertinence only. Contradictory but pertinent
  // documents belong to the semantic-review evaluation, not cosine negatives.
  cases: z
    .array(
      z.strictObject({
        id: label,
        groupId: label,
        split: z.enum(['calibration', 'validation']),
        expected: z.enum(['SUPPORTED', 'NO_EVIDENCE']),
        relevantChunkIds: z.array(z.uuid()).max(100),
        candidates: z.array(candidateSchema).max(5),
      }),
    )
    .min(4)
    .max(1000),
  queries: z
    .array(
      z.strictObject({
        caseId: label,
        text: z.string().min(1).max(20000),
        queryHash: hash,
      }),
    )
    .min(4)
    .max(1000),
  observations: z.array(helpCalibrationObservationSchema).min(4).max(1000),
});
export type HelpCalibrationEvidence = z.infer<typeof evidenceSchema>;
export interface TrustedHelpCalibrationEvidence {
  /** Populate exclusively from authoritative server records, not uploaded JSON. */
  origin: 'AZURE' | 'TEST';
  runId: string;
  binding: HelpCalibrationBinding;
  corpus: HelpCalibrationEvidence['corpus'];
  receipts: readonly HelpCalibrationReceipt[];
  observations: readonly HelpCalibrationObservation[];
}
export const verifiedHelpCalibrationArtifactSchema = z
  .strictObject({
    version: z.literal('help-evidence-2'),
    origin: z.enum(['AZURE', 'TEST']),
    runId: z.uuid(),
    measurement: helpCalibrationArtifactSchema,
    evidenceHash: hash,
    corpusManifestHash: hash,
    receiptCount: z.number().int().min(4).max(1000),
    observationCount: z.number().int().min(4).max(1000),
  })
  .superRefine((value, context) => {
    if (
      value.receiptCount !== value.observationCount ||
      value.observationCount !==
        value.measurement.calibrationCases + value.measurement.validationCases
    )
      context.addIssue({
        code: 'custom',
        message: 'Inconsistent measurement evidence.',
      });
  });
export type VerifiedHelpCalibrationArtifact = z.infer<
  typeof verifiedHelpCalibrationArtifactSchema
>;
function invalid(): never {
  throw new HelpBoundaryError('CALIBRATION_INVALID');
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function helpMeasurementHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export function parseVerifiedHelpCalibrationArtifact(
  value: unknown,
): VerifiedHelpCalibrationArtifact {
  try {
    if (typeof value === 'string' && Buffer.byteLength(value) > 100_000)
      invalid();
    return verifiedHelpCalibrationArtifactSchema.parse(
      typeof value === 'string' ? JSON.parse(value) : value,
    );
  } catch {
    return invalid();
  }
}
export function verifiedHelpCalibrationHash(value: unknown): string {
  return helpMeasurementHash(parseVerifiedHelpCalibrationArtifact(value));
}

/** Pure validation/recomputation; the caller must obtain `trusted` independently
 * from the database. Hashes alone never authenticate an uploaded measurement. */
export function calibrateHelpEvidenceFromReceipts(
  value: unknown,
  trusted: TrustedHelpCalibrationEvidence,
): VerifiedHelpCalibrationArtifact {
  try {
    const data = evidenceSchema.parse(value);
    if (
      data.origin !== trusted.origin ||
      data.runId !== trusted.runId ||
      !same(data.binding, bindingSchema.parse(trusted.binding)) ||
      data.binding.queryVersion !== HELP_QUERY_VERSION ||
      data.binding.tokenizerVersion !== TOKENIZER_VERSION
    )
      invalid();
    const corpus = [...data.corpus].sort((a, b) =>
      compare(a.chunkId, b.chunkId),
    );
    const trustedCorpus = z
      .array(sourceSchema)
      .parse(trusted.corpus)
      .sort((a, b) => compare(a.chunkId, b.chunkId));
    if (
      !same(corpus, trustedCorpus) ||
      new Set(corpus.map((source) => source.chunkId)).size !== corpus.length
    )
      invalid();
    const chunks = new Set(corpus.map((source) => source.chunkId));
    const sourceByChunk = new Map(
      corpus.map((source) => [source.chunkId, source]),
    );
    const trainingSources = data.cases
      .filter((test) => test.split === 'calibration')
      .flatMap((test) =>
        test.relevantChunkIds.map((id) => sourceByChunk.get(id)),
      )
      .filter((source) => source !== undefined);
    const trainingVersions = new Set(
      trainingSources.map((source) => source.sourceVersionId),
    );
    const trainingContent = new Set(
      trainingSources.map((source) => source.contentHash),
    );
    if (
      data.cases
        .filter((test) => test.split === 'validation')
        .some((test) =>
          test.relevantChunkIds.some((id) => {
            const source = sourceByChunk.get(id);
            return (
              source &&
              (trainingVersions.has(source.sourceVersionId) ||
                trainingContent.has(source.contentHash))
            );
          }),
        )
    )
      invalid();
    const queries = new Map(data.queries.map((query) => [query.caseId, query]));
    const observations = new Map(
      data.observations.map((observation) => [observation.caseId, observation]),
    );
    const authoritative = z
      .array(helpCalibrationObservationSchema)
      .parse(trusted.observations);
    const trustedObservations = new Map(
      authoritative.map((observation) => [observation.caseId, observation]),
    );
    const receipts = z
      .array(helpCalibrationReceiptSchema)
      .parse(trusted.receipts);
    const byId = new Map(receipts.map((receipt) => [receipt.callId, receipt]));
    if (
      data.cases.length !== data.queries.length ||
      queries.size !== data.cases.length ||
      observations.size !== data.cases.length ||
      data.observations.length !== observations.size ||
      trustedObservations.size !== authoritative.length ||
      authoritative.length !== data.cases.length ||
      byId.size !== receipts.length ||
      receipts.length !== data.cases.length
    )
      invalid();
    const used = new Set<string>();
    const trainingQueries = new Set(
      data.cases
        .filter((test) => test.split === 'calibration')
        .map((test) => queries.get(test.id)?.queryHash),
    );
    for (const test of data.cases) {
      const query = queries.get(test.id),
        observation = observations.get(test.id);
      if (
        !query ||
        !observation ||
        !same(observation, trustedObservations.get(test.id))
      )
        invalid();
      const queryHash = createHash('sha256')
        .update(query.text, 'utf8')
        .digest('hex');
      if (
        query.queryHash !== queryHash ||
        observation.queryHash !== queryHash ||
        observation.corpusHash !== data.binding.corpusHash ||
        helpTokenCount(query.text) > 500 ||
        !same(test.candidates, observation.candidates)
      )
        invalid();
      if (test.split === 'validation' && trainingQueries.has(queryHash))
        invalid();
      if (
        test.relevantChunkIds.some((id) => !chunks.has(id)) ||
        observation.candidates.some(
          (candidate) => !chunks.has(candidate.chunkId),
        )
      )
        invalid();
      const receipt = byId.get(observation.callId);
      if (
        !receipt ||
        used.has(receipt.callId) ||
        receipt.runId !== data.runId ||
        receipt.provider !== data.origin ||
        receipt.configurationId !== data.binding.configurationId ||
        receipt.model !== data.binding.embeddingModel ||
        receipt.dimensions !== data.binding.dimensions ||
        receipt.inputHash !== queryHash ||
        (data.origin === 'AZURE' && !receipt.requestId)
      )
        invalid();
      used.add(receipt.callId);
    }
    const measurement = calibrateHelpEvidence({
      measurementProvider: 'azure',
      binding: data.binding,
      cases: data.cases as HelpCalibrationCase[],
    });
    // Legacy measurement is the pure algorithm result. The envelope origin is
    // authoritative: a TEST run never becomes a production artifact.
    return parseVerifiedHelpCalibrationArtifact({
      version: 'help-evidence-2',
      origin: data.origin,
      runId: data.runId,
      measurement,
      evidenceHash: helpMeasurementHash({
        ...data,
        corpus,
        queries: [...data.queries].sort((a, b) => compare(a.caseId, b.caseId)),
        cases: [...data.cases].sort((a, b) => compare(a.id, b.id)),
        observations: [...data.observations].sort((a, b) =>
          compare(a.caseId, b.caseId),
        ),
        receipts: [...receipts].sort((a, b) => compare(a.callId, b.callId)),
      }),
      corpusManifestHash: helpMeasurementHash(corpus),
      receiptCount: receipts.length,
      observationCount: data.observations.length,
    });
  } catch {
    return invalid();
  }
}

export function verifiedHelpEvidencePolicyFromArtifact(
  value: unknown,
  binding: HelpCalibrationBinding,
  expectedEvidenceHash: string,
  options?: { allowTest: true },
): HelpEvidencePolicy {
  const artifact = parseVerifiedHelpCalibrationArtifact(value);
  if (
    !hash.safeParse(expectedEvidenceHash).success ||
    verifiedHelpCalibrationHash(artifact) !== expectedEvidenceHash ||
    (artifact.origin !== 'AZURE' && options?.allowTest !== true)
  )
    invalid();
  const policy = helpEvidencePolicyFromArtifact(artifact.measurement, binding);
  return {
    ...policy,
    version: `${artifact.version}:${artifact.origin}:${expectedEvidenceHash}`,
  };
}
