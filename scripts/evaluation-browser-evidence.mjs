import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.uuid();
const provider = z.enum(['TEST', 'AZURE']);
const profile = z.enum(['serial', 'concurrent']);
const kind = z.enum(['FEEDBACK', 'HINT']);
const hintLevel = z.union([z.null(), z.literal(1), z.literal(2), z.literal(3)]);
const ragStatus = z.enum(['SUPPORTED', 'NO_EVIDENCE', 'PROVIDER_UNAVAILABLE']);
const browserVersion = z.string().min(1).max(200);
const scopeFields = {
  runId: uuid,
  provider,
  corpusHash: sha,
  candidateFingerprint: sha,
};
const expectedSchema = z.strictObject(scopeFields);
const producerSchema = z.strictObject({
  version: z.literal(1),
  producer: z.literal('CHROME_CDP'),
  browserVersion,
  webSourceDigest: sha,
  ...scopeFields,
});
const bindingSchema = z.strictObject({
  bindingId: uuid,
  actorId: uuid,
  attemptId: uuid,
  operationKeyHash: sha,
  explanationHash: sha,
  hintHash: sha,
});
const sampleFieldsSchema = z.strictObject({
  requestId: uuid,
  feedbackId: uuid,
  profile,
  kind,
  hintLevel,
  status: ragStatus,
});
const evidenceSchema = z.strictObject({
  observation: z.unknown(),
  artifact: z.strictObject({ file: z.string().min(1).max(200), sha256: sha }),
});
const observationSchema = z.strictObject({
  version: z.literal(1),
  producer: z.literal('CHROME_CDP'),
  browserVersion,
  ...scopeFields,
  bindingId: uuid,
  actorId: uuid,
  attemptId: uuid,
  requestId: uuid,
  feedbackId: uuid,
  profile,
  kind,
  hintLevel,
  webSourceDigest: sha,
  operationKeyHash: sha,
  startedAt: z.iso.datetime({ offset: true }),
  visibleAt: z.iso.datetime({ offset: true }),
  actionToVisibleMs: z.number().finite().nonnegative(),
  requestToParsedFeedbackMs: z.number().finite().nonnegative(),
  statusFromDom: ragStatus,
  explanationHash: sha,
  hintHash: sha,
  domIdentityMatched: z.literal(true),
  documentVisible: z.literal(true),
  geometryVisible: z.literal(true),
  paintFrames: z.literal(2),
  observation: z.literal('COMPLETE'),
  failureCode: z.null(),
});

const result = (status, reason) => ({ status, reason });
const invalid = (reason) => result('INVALID', reason);
const missing = (reason) => result('MISSING', reason);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const samePath = (a, b) =>
  process.platform === 'win32'
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);

function localDirectory(input) {
  if (
    typeof input !== 'string' ||
    !input ||
    /^(?:\\\\|\/\/)/u.test(input) ||
    /[\0\r\n]/u.test(input) ||
    input.split(/[\\/]/u).includes('..') ||
    // Refuse device paths, schemes and NTFS alternate streams. A local drive
    // prefix is allowed only as an absolute path on Windows.
    (input.includes(':') &&
      !(process.platform === 'win32' && /^[A-Za-z]:[\\/][^:]*$/u.test(input)))
  )
    return null;
  const path = resolve(input);
  return /^(?:\\\\|\/\/)/u.test(path) ? null : path;
}

class EvidenceFileError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

async function inspectLocalPath(path, file) {
  const root = parse(path).root;
  const parts = relative(root, path).split(sep).filter(Boolean);
  let current = root;
  let last = await fs.lstat(root);
  if (last.isSymbolicLink() || !last.isDirectory())
    throw new EvidenceFileError('BROWSER_ARTIFACT_PATH_INVALID');
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    last = await fs.lstat(current);
    if (last.isSymbolicLink())
      throw new EvidenceFileError('BROWSER_ARTIFACT_LINK_INVALID');
    const isFile = file && index === parts.length - 1;
    if (isFile ? !last.isFile() : !last.isDirectory())
      throw new EvidenceFileError('BROWSER_ARTIFACT_PATH_INVALID');
    if (isFile && last.nlink !== 1)
      throw new EvidenceFileError('BROWSER_ARTIFACT_LINK_INVALID');
  }
  if (!samePath(await fs.realpath(path), path))
    throw new EvidenceFileError('BROWSER_ARTIFACT_LINK_INVALID');
  return last;
}

async function readArtifact(path) {
  const checked = await inspectLocalPath(path, true);
  // The strict observation is small. Bound reading malformed evidence without
  // changing a product or provider limit.
  if (checked.size > 64 * 1024)
    throw new EvidenceFileError('BROWSER_ARTIFACT_TOO_LARGE');
  const flags =
    constants.O_RDONLY |
    (process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0));
  const handle = await fs.open(path, flags);
  try {
    const opened = await handle.stat();
    const rechecked = await inspectLocalPath(path, true);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== checked.dev ||
      opened.ino !== checked.ino ||
      opened.dev !== rechecked.dev ||
      opened.ino !== rechecked.ino ||
      opened.size !== checked.size ||
      opened.size !== rechecked.size
    )
      throw new EvidenceFileError('BROWSER_ARTIFACT_CHANGED');
    // Use a bounded read from the checked descriptor rather than following the
    // path again. Extra bytes or concurrent changes invalidate the artifact.
    const bytes = Buffer.alloc(64 * 1024 + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const after = await handle.stat();
    if (
      bytesRead !== opened.size ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    )
      throw new EvidenceFileError('BROWSER_ARTIFACT_CHANGED');
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Read-only verification of one recorded browser artifact, not attestation of
 * a browser process. Duplicate-profile detection belongs to the aggregate gate.
 * HTTP durations and viewed ACKs cannot supply missing browser evidence.
 */
export async function inspectBrowserEvidence({
  directory,
  sample,
  producer: rawProducer,
  expected: rawExpected,
}) {
  if (sample?.browserEvidence == null)
    return missing('BROWSER_EVIDENCE_MISSING');
  if (rawProducer == null) return missing('BROWSER_PRODUCER_MISSING');
  const expected = expectedSchema.safeParse(rawExpected);
  const producerIdentity = producerSchema.safeParse(rawProducer);
  const binding = bindingSchema.safeParse(sample.browserBinding);
  const sampleFields = sampleFieldsSchema.safeParse(
    Object.fromEntries(
      Object.keys(sampleFieldsSchema.shape).map((field) => [
        field,
        sample[field],
      ]),
    ),
  );
  const evidence = evidenceSchema.safeParse(sample.browserEvidence);
  if (!expected.success) return invalid('BROWSER_EXPECTED_SCOPE_INVALID');
  if (!producerIdentity.success) return invalid('BROWSER_PRODUCER_INVALID');
  if (!binding.success) return invalid('BROWSER_BINDING_INVALID');
  if (!sampleFields.success) return invalid('BROWSER_SAMPLE_INVALID');
  if (!evidence.success) return invalid('BROWSER_EVIDENCE_INVALID');
  if (sample.verificationComplete !== true)
    return invalid('BROWSER_SAMPLE_UNVERIFIED');
  const identity = producerIdentity.data;
  if (
    Object.entries(expected.data).some(
      ([key, value]) => identity[key] !== value,
    )
  )
    return invalid('BROWSER_PRODUCER_SCOPE_MISMATCH');
  if (evidence.data.observation?.observation === 'INCOMPLETE')
    return invalid('BROWSER_OBSERVATION_INCOMPLETE');
  const parsed = observationSchema.safeParse(evidence.data.observation);
  if (!parsed.success) return invalid('BROWSER_OBSERVATION_INVALID');
  const observation = parsed.data;
  const { status, ...sampleIdentity } = sampleFields.data;
  const expectedFields = {
    ...identity,
    ...binding.data,
    ...sampleIdentity,
    statusFromDom: status,
  };
  if (
    Object.entries(expectedFields).some(
      ([key, value]) => observation[key] !== value,
    )
  )
    return invalid('BROWSER_OBSERVATION_CORRELATION_MISMATCH');
  if (
    (observation.kind === 'FEEDBACK' && observation.hintLevel !== null) ||
    (observation.kind === 'HINT' && observation.hintLevel === null)
  )
    return invalid('BROWSER_OBSERVATION_KIND_MISMATCH');
  const elapsed =
    Date.parse(observation.visibleAt) - Date.parse(observation.startedAt);
  // ISO timestamps have millisecond precision; performance.now is rounded to
  // hundredths by the producer. Both timestamps must come from that same clock.
  if (
    !Number.isFinite(elapsed) ||
    elapsed < 0 ||
    Math.abs(elapsed - observation.actionToVisibleMs) > 2 ||
    observation.requestToParsedFeedbackMs > observation.actionToVisibleMs
  )
    return invalid('BROWSER_OBSERVATION_TIME_MISMATCH');
  const runDirectory = localDirectory(directory);
  const expectedFile = `browser-observations/${binding.data.operationKeyHash}.json`;
  if (!runDirectory || evidence.data.artifact.file !== expectedFile)
    return invalid('BROWSER_ARTIFACT_PATH_INVALID');
  const path = resolve(runDirectory, evidence.data.artifact.file);
  const suffix = relative(runDirectory, path);
  if (!suffix || isAbsolute(suffix) || suffix.startsWith(`..${sep}`))
    return invalid('BROWSER_ARTIFACT_PATH_INVALID');
  try {
    await inspectLocalPath(runDirectory, false);
    const bytes = await readArtifact(path);
    if (hash(bytes) !== evidence.data.artifact.sha256)
      return invalid('BROWSER_ARTIFACT_HASH_MISMATCH');
    let stored;
    try {
      stored = JSON.parse(bytes.toString('utf8'));
    } catch {
      return invalid('BROWSER_ARTIFACT_JSON_INVALID');
    }
    if (!isDeepStrictEqual(stored, observation))
      return invalid('BROWSER_ARTIFACT_OBSERVATION_MISMATCH');
    return {
      status: 'VERIFIED',
      reason: 'BROWSER_ARTIFACT_VERIFIED',
      observation,
    };
  } catch (error) {
    if (error instanceof EvidenceFileError) return invalid(error.reason);
    if (error?.code === 'ENOENT') return missing('BROWSER_ARTIFACT_MISSING');
    return invalid('BROWSER_ARTIFACT_UNREADABLE');
  }
}
