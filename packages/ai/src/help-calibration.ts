import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RetrievedChunk } from './ports';
import { HELP_QUERY_VERSION, HelpBoundaryError } from './help';

const bindingSchema = z.strictObject({
  configurationId: z.string().min(1).max(128),
  embeddingModel: z.string().min(1).max(128),
  dimensions: z.number().int().min(1).max(16000),
  tokenizerVersion: z.string().min(1).max(100),
  queryVersion: z.literal(HELP_QUERY_VERSION),
  corpusHash: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type HelpCalibrationBinding = z.infer<typeof bindingSchema>;
const candidateSchema = z.strictObject({
  chunkId: z.uuid(),
  distance: z.number().finite().min(0).max(2),
});
const caseSchema = z.strictObject({
  id: z.string().min(1).max(128),
  groupId: z.string().min(1).max(128),
  split: z.enum(['calibration', 'validation']),
  expected: z.enum(['SUPPORTED', 'NO_EVIDENCE', 'AMBIGUOUS']),
  relevantChunkIds: z.array(z.uuid()).max(100),
  candidates: z.array(candidateSchema).max(5),
});
export type HelpCalibrationCase = z.infer<typeof caseSchema>;
export const helpCalibrationArtifactSchema = z
  .strictObject({
    version: z.literal('help-evidence-1'),
    measurementProvider: z.literal('azure'),
    binding: bindingSchema,
    acceptanceThreshold: z.number().finite().min(0).max(2),
    calibrationCases: z.number().int().positive(),
    validationCases: z.number().int().positive(),
    validationSupported: z.number().int().positive(),
    validationAccepted: z.number().int().positive(),
    falseAcceptances: z.literal(0),
    casesHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .superRefine((value, ctx) => {
    if (
      value.validationAccepted > value.validationSupported ||
      value.validationSupported > value.validationCases
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Inconsistent calibration artifact.',
      });
  });
export type HelpCalibrationArtifact = z.infer<
  typeof helpCalibrationArtifactSchema
>;
export function parseHelpCalibrationArtifact(
  value: unknown,
): HelpCalibrationArtifact {
  let raw: unknown = value;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > 100_000)
      throw new HelpBoundaryError('CALIBRATION_INVALID');
    try {
      raw = JSON.parse(value);
    } catch {
      throw new HelpBoundaryError('CALIBRATION_INVALID');
    }
  }
  const parsed = helpCalibrationArtifactSchema.safeParse(raw);
  if (!parsed.success) throw new HelpBoundaryError('CALIBRATION_INVALID');
  return parsed.data;
}
function accepted(test: HelpCalibrationCase, threshold: number) {
  return test.candidates.filter((candidate) => candidate.distance <= threshold);
}
function supports(test: HelpCalibrationCase, chunkId: string) {
  return (
    test.expected === 'SUPPORTED' && test.relevantChunkIds.includes(chunkId)
  );
}
function thresholdFor(cases: HelpCalibrationCase[]): number {
  // Candidate thresholds are measured distances, not a provider-independent constant.
  const thresholds = [
    ...new Set(
      cases.flatMap((test) =>
        test.candidates
          .filter((candidate) => supports(test, candidate.chunkId))
          .map((candidate) => candidate.distance),
      ),
    ),
  ].sort((a, b) => a - b);
  let best: number | undefined,
    covered = 0;
  for (const threshold of thresholds) {
    if (
      cases.some((test) =>
        accepted(test, threshold).some(
          (chunk) => !supports(test, chunk.chunkId),
        ),
      )
    )
      continue;
    const count = cases.filter(
      (test) =>
        test.expected === 'SUPPORTED' && accepted(test, threshold).length,
    ).length;
    // Ascending order deliberately retains the smallest threshold on equal coverage.
    if (count > covered) {
      best = threshold;
      covered = count;
    }
  }
  if (best === undefined) throw new HelpBoundaryError('CALIBRATION_INVALID');
  return best;
}
export function calibrateHelpEvidence(input: {
  measurementProvider: 'azure';
  binding: HelpCalibrationBinding;
  cases: HelpCalibrationCase[];
}): HelpCalibrationArtifact {
  const parsed = z
    .strictObject({
      measurementProvider: z.literal('azure'),
      binding: bindingSchema,
      cases: z.array(caseSchema).min(4).max(1000),
    })
    .safeParse(input);
  if (!parsed.success) throw new HelpBoundaryError('CALIBRATION_INVALID');
  const data = parsed.data;
  const cases = [...data.cases].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (
    new Set(cases.map((test) => test.id)).size !== cases.length ||
    cases.some(
      (test) =>
        new Set(test.candidates.map((candidate) => candidate.chunkId)).size !==
          test.candidates.length ||
        (test.expected === 'SUPPORTED') !== test.relevantChunkIds.length > 0,
    )
  )
    throw new HelpBoundaryError('CALIBRATION_INVALID');
  const training = cases.filter((test) => test.split === 'calibration');
  const validation = cases.filter((test) => test.split === 'validation');
  const groups = [...new Set(training.map((test) => test.groupId))].sort();
  if (
    groups.length < 1 ||
    groups.length > 100 ||
    validation.some((test) => groups.includes(test.groupId)) ||
    !validation.some((test) => test.expected === 'SUPPORTED') ||
    !validation.some((test) => test.expected !== 'SUPPORTED') ||
    !training.some((test) => test.expected !== 'SUPPORTED')
  )
    throw new HelpBoundaryError('CALIBRATION_INVALID');
  const acceptanceThreshold = thresholdFor(training);
  if (
    [...training, ...validation].some((test) =>
      accepted(test, acceptanceThreshold).some(
        (chunk) => !supports(test, chunk.chunkId),
      ),
    )
  )
    throw new HelpBoundaryError('CALIBRATION_INVALID');
  const validationAccepted = validation.filter(
    (test) =>
      test.expected === 'SUPPORTED' &&
      accepted(test, acceptanceThreshold).length > 0,
  ).length;
  return parseHelpCalibrationArtifact({
    version: 'help-evidence-1',
    measurementProvider: 'azure',
    binding: data.binding,
    acceptanceThreshold,
    calibrationCases: training.length,
    validationCases: validation.length,
    validationSupported: validation.filter(
      (test) => test.expected === 'SUPPORTED',
    ).length,
    validationAccepted,
    falseAcceptances: 0,
    casesHash: createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
  });
}
export interface HelpEvidencePolicy {
  readonly version: string;
  select(chunks: readonly RetrievedChunk[]): {
    chunks: RetrievedChunk[];
    reason: 'SUPPORTED' | 'NO_EVIDENCE' | 'AMBIGUOUS_EVIDENCE';
  };
}
export function helpEvidencePolicyFromArtifact(
  value: unknown,
  binding: HelpCalibrationBinding,
): HelpEvidencePolicy {
  const artifact = parseHelpCalibrationArtifact(value);
  const expected = bindingSchema.safeParse(binding);
  if (
    !expected.success ||
    Object.entries(expected.data).some(
      ([key, field]) =>
        artifact.binding[key as keyof HelpCalibrationBinding] !== field,
    )
  )
    throw new HelpBoundaryError('CALIBRATION_INVALID');
  return {
    // Include binding and selected threshold, not only observations. A resumed
    // job must not reuse a checkpoint under a differently configured policy.
    version: `${artifact.version}:${createHash('sha256').update(JSON.stringify(artifact)).digest('hex')}`,
    select(chunks) {
      if (
        chunks.length > 5 ||
        chunks.some(
          (chunk) =>
            !Number.isFinite(chunk.distance) ||
            chunk.distance < 0 ||
            chunk.distance > 2,
        )
      )
        throw new HelpBoundaryError('INVALID_CONTEXT');
      const selected = chunks.filter(
        (chunk) => chunk.distance <= artifact.acceptanceThreshold,
      );
      return {
        chunks: selected,
        reason: selected.length ? 'SUPPORTED' : 'NO_EVIDENCE',
      };
    },
  };
}
