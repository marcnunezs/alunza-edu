import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { inspectBrowserEvidence } from '../../scripts/evaluation-browser-evidence.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
let directory;
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'alunza-browser-evidence-'));
});
afterEach(async () => {
  if (
    !directory ||
    !resolve(directory).startsWith(resolve(tmpdir()) + sep) ||
    !directory.includes('alunza-browser-evidence-')
  )
    throw new Error('UNSAFE_TEST_CLEANUP');
  await fs.rm(directory, { recursive: true, force: true });
});

function fixture() {
  const expected = {
    runId: randomUUID(),
    provider: 'TEST',
    corpusHash: hash('corpus'),
    candidateFingerprint: hash('candidate'),
  };
  const producer = {
    version: 1,
    producer: 'CHROME_CDP',
    browserVersion: 'Chrome/142.0.7444.0',
    webSourceDigest: hash('web-source'),
    ...expected,
  };
  const binding = {
    bindingId: randomUUID(),
    actorId: randomUUID(),
    attemptId: randomUUID(),
    operationKeyHash: hash(randomUUID()),
    explanationHash: hash('Explicación visible.'),
    hintHash: hash(''),
  };
  const sample = {
    requestId: randomUUID(),
    feedbackId: randomUUID(),
    profile: 'serial',
    kind: 'FEEDBACK',
    hintLevel: null,
    status: 'SUPPORTED',
    verificationComplete: true,
    browserBinding: binding,
  };
  const observation = {
    ...producer,
    ...binding,
    requestId: sample.requestId,
    feedbackId: sample.feedbackId,
    profile: sample.profile,
    kind: sample.kind,
    hintLevel: sample.hintLevel,
    startedAt: '2026-11-18T12:00:00.000Z',
    visibleAt: '2026-11-18T12:00:01.000Z',
    actionToVisibleMs: 1000,
    requestToParsedFeedbackMs: 900,
    statusFromDom: 'SUPPORTED',
    domIdentityMatched: true,
    documentVisible: true,
    geometryVisible: true,
    paintFrames: 2,
    observation: 'COMPLETE',
    failureCode: null,
  };
  sample.browserEvidence = {
    observation,
    artifact: {
      file: `browser-observations/${binding.operationKeyHash}.json`,
      sha256: hash(JSON.stringify(observation)),
    },
  };
  return { directory, sample, producer, expected };
}

async function persist(input, raw) {
  const bytes = raw ?? JSON.stringify(input.sample.browserEvidence.observation);
  await fs.mkdir(join(input.directory, 'browser-observations'), {
    recursive: true,
  });
  const path = join(
    input.directory,
    input.sample.browserEvidence.artifact.file,
  );
  await fs.writeFile(path, bytes, { flag: 'wx' });
  input.sample.browserEvidence.artifact.sha256 = hash(bytes);
  return { bytes, path };
}

describe('recorded browser visibility evidence', () => {
  it('requires and verifies the exact artifact, preserving inputs and file bytes', async () => {
    const input = fixture();
    const { path, bytes } = await persist(input);
    const before = JSON.stringify(input);
    expect(await inspectBrowserEvidence(input)).toEqual({
      status: 'VERIFIED',
      reason: 'BROWSER_ARTIFACT_VERIFIED',
      observation: input.sample.browserEvidence.observation,
    });
    expect(JSON.stringify(input)).toBe(before);
    expect(await fs.readFile(path, 'utf8')).toBe(bytes);
    expect(await fs.readdir(join(directory, 'browser-observations'))).toEqual([
      `${input.sample.browserBinding.operationKeyHash}.json`,
    ]);
  });

  it.each(['NO_EVIDENCE', 'PROVIDER_UNAVAILABLE'])(
    'can verify a visible %s fallback without relabeling it as supported',
    async (status) => {
      const input = fixture();
      input.sample.status = status;
      Object.assign(input.sample, {
        kind: 'HINT',
        hintLevel: 1,
        profile: 'concurrent',
      });
      Object.assign(input.sample.browserEvidence.observation, {
        statusFromDom: status,
        kind: 'HINT',
        hintLevel: 1,
        profile: 'concurrent',
      });
      await persist(input);
      expect(await inspectBrowserEvidence(input)).toMatchObject({
        status: 'VERIFIED',
        observation: { statusFromDom: status },
      });
    },
  );

  it('never substitutes milliseconds, parsed HTTP feedback or viewed ACKs for an artifact', async () => {
    const input = fixture();
    delete input.sample.browserEvidence;
    Object.assign(input.sample, {
      browserMs: 1,
      clientMs: 1,
      viewed: true,
      viewedCount: 1,
      clientObservation: 'COMPLETE',
    });
    expect(await inspectBrowserEvidence(input)).toEqual({
      status: 'MISSING',
      reason: 'BROWSER_EVIDENCE_MISSING',
    });
    const absent = fixture();
    expect(await inspectBrowserEvidence(absent)).toEqual({
      status: 'MISSING',
      reason: 'BROWSER_ARTIFACT_MISSING',
    });
    absent.producer = null;
    expect(await inspectBrowserEvidence(absent)).toEqual({
      status: 'MISSING',
      reason: 'BROWSER_PRODUCER_MISSING',
    });
  });

  it.each([
    ['runId', () => randomUUID()],
    ['provider', () => 'AZURE'],
    ['corpusHash', () => hash('other-corpus')],
    ['candidateFingerprint', () => hash('other-candidate')],
    ['webSourceDigest', () => hash('other-web')],
    ['browserVersion', () => 'Chrome/other'],
    ['bindingId', () => randomUUID()],
    ['actorId', () => randomUUID()],
    ['attemptId', () => randomUUID()],
    ['requestId', () => randomUUID()],
    ['feedbackId', () => randomUUID()],
    ['profile', () => 'concurrent'],
    ['kind', () => 'HINT'],
    ['hintLevel', () => 1],
    ['operationKeyHash', () => hash('other-operation')],
    ['explanationHash', () => hash('other-text')],
    ['hintHash', () => hash('other-hint')],
    ['statusFromDom', () => 'NO_EVIDENCE'],
  ])(
    'rejects a self-consistent artifact that disagrees with %s from API or campaign',
    async (field, replace) => {
      const input = fixture();
      input.sample.browserEvidence.observation[field] = replace();
      await persist(input);
      expect(await inspectBrowserEvidence(input)).toEqual({
        status: 'INVALID',
        reason: 'BROWSER_OBSERVATION_CORRELATION_MISMATCH',
      });
    },
  );

  it.each([
    ['extra', true],
    ['actorId', 'not-uuid'],
    ['explanationHash', 'short'],
    ['documentVisible', false],
    ['geometryVisible', false],
    ['domIdentityMatched', false],
    ['paintFrames', 1],
    ['failureCode', 'FAILURE'],
    ['producer', 'HTTP_ACK'],
    ['actionToVisibleMs', -1],
    ['actionToVisibleMs', Infinity],
    ['actionToVisibleMs', NaN],
    ['requestToParsedFeedbackMs', null],
    ['visibleAt', 'yesterday'],
    ['hintLevel', 4],
  ])(
    'rejects invalid observation field %s=%s before filesystem access',
    async (field, value) => {
      const input = fixture();
      input.sample.browserEvidence.observation[field] = value;
      const guard = jest.spyOn(fs, 'lstat').mockImplementation(() => {
        throw new Error('FILESYSTEM_FORBIDDEN');
      });
      try {
        expect(await inspectBrowserEvidence(input)).toEqual({
          status: 'INVALID',
          reason: 'BROWSER_OBSERVATION_INVALID',
        });
        expect(guard).not.toHaveBeenCalled();
      } finally {
        guard.mockRestore();
      }
    },
  );

  it('does not accept an incomplete failure artifact or unverified API sample', async () => {
    const input = fixture();
    Object.assign(input.sample.browserEvidence.observation, {
      observation: 'INCOMPLETE',
      actionToVisibleMs: null,
      failureCode: 'DOM_NOT_VISIBLE',
    });
    await persist(input);
    expect(await inspectBrowserEvidence(input)).toEqual({
      status: 'INVALID',
      reason: 'BROWSER_OBSERVATION_INCOMPLETE',
    });
    const unverified = fixture();
    unverified.sample.verificationComplete = false;
    expect(await inspectBrowserEvidence(unverified)).toEqual({
      status: 'INVALID',
      reason: 'BROWSER_SAMPLE_UNVERIFIED',
    });
  });

  it.each([
    { visibleAt: '2026-11-18T11:59:59.000Z' },
    { actionToVisibleMs: 997 },
    { requestToParsedFeedbackMs: 1000.01 },
  ])(
    'requires coherent timestamps and parsed-feedback timing %j',
    async (changes) => {
      const input = fixture();
      Object.assign(input.sample.browserEvidence.observation, changes);
      expect(await inspectBrowserEvidence(input)).toEqual({
        status: 'INVALID',
        reason: 'BROWSER_OBSERVATION_TIME_MISMATCH',
      });
    },
  );

  it('tolerates only timestamp rounding and rejects incoherent help levels', async () => {
    const input = fixture();
    input.sample.browserEvidence.observation.actionToVisibleMs = 1000.83;
    await persist(input);
    expect((await inspectBrowserEvidence(input)).status).toBe('VERIFIED');
    input.sample.hintLevel = 1;
    input.sample.browserEvidence.observation.hintLevel = 1;
    expect(await inspectBrowserEvidence(input)).toEqual({
      status: 'INVALID',
      reason: 'BROWSER_OBSERVATION_KIND_MISMATCH',
    });
  });

  it('distinguishes file checksum failure, JSON failure and deep observation mismatch', async () => {
    for (const [variant, reason] of [
      ['hash', 'BROWSER_ARTIFACT_HASH_MISMATCH'],
      ['json', 'BROWSER_ARTIFACT_JSON_INVALID'],
      ['different', 'BROWSER_ARTIFACT_OBSERVATION_MISMATCH'],
    ]) {
      const input = fixture();
      const raw =
        variant === 'json'
          ? '{PRIVATE_UNPARSEABLE'
          : variant === 'different'
            ? JSON.stringify({
                ...input.sample.browserEvidence.observation,
                explanationHash: hash('different'),
              })
            : undefined;
      const { path, bytes } = await persist(input, raw);
      if (variant === 'hash')
        input.sample.browserEvidence.artifact.sha256 = hash('wrong');
      const result = await inspectBrowserEvidence(input);
      expect(result).toEqual({ status: 'INVALID', reason });
      expect(JSON.stringify(result)).not.toContain('PRIVATE_UNPARSEABLE');
      expect(await fs.readFile(path, 'utf8')).toBe(bytes);
    }
  });

  it('rejects UNC/device/traversal and unexpected artifact paths before filesystem access', async () => {
    const input = fixture();
    const directories = [
      String.raw`\\fixture.invalid\share\run`,
      String.raw`\\?\UNC\fixture.invalid\share`,
      String.raw`\\.\pipe\run`,
      '//fixture.invalid/share',
      '../run',
      join(directory, '..', 'sibling') + '/..',
    ];
    const artifacts = [
      '../foreign.json',
      '/tmp/evidence.json',
      String.raw`\\fixture.invalid\share\observation.json`,
      'browser-observations/../forged.json',
      `browser-observations/${hash('different-key')}.json`,
      input.sample.browserEvidence.artifact.file.replaceAll('/', '\\'),
    ];
    const guard = jest.spyOn(fs, 'lstat').mockImplementation(() => {
      throw new Error('FILESYSTEM_FORBIDDEN');
    });
    try {
      for (const invalidDirectory of directories)
        expect(
          await inspectBrowserEvidence({
            ...input,
            directory: invalidDirectory,
          }),
        ).toEqual({
          status: 'INVALID',
          reason: 'BROWSER_ARTIFACT_PATH_INVALID',
        });
      for (const file of artifacts) {
        const changed = globalThis.structuredClone(input);
        changed.sample.browserEvidence.artifact.file = file;
        expect(await inspectBrowserEvidence(changed)).toMatchObject({
          status: 'INVALID',
        });
      }
      expect(guard).not.toHaveBeenCalled();
    } finally {
      guard.mockRestore();
    }
  });

  it('rejects a junction or symbolic-link ancestor before opening the file and preserves its target', async () => {
    const input = fixture();
    const target = join(directory, 'target');
    await fs.mkdir(target);
    const linkedRun = join(directory, 'linked-run');
    const owned = { ...input, directory: target };
    const { path, bytes } = await persist(owned);
    await fs.symlink(
      target,
      linkedRun,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const guard = jest.spyOn(fs, 'open').mockImplementation(() => {
      throw new Error('FILE_OPEN_FORBIDDEN');
    });
    try {
      expect(
        await inspectBrowserEvidence({ ...input, directory: linkedRun }),
      ).toEqual({ status: 'INVALID', reason: 'BROWSER_ARTIFACT_LINK_INVALID' });
      expect(guard).not.toHaveBeenCalled();
    } finally {
      guard.mockRestore();
    }
    expect(await fs.readFile(path, 'utf8')).toBe(bytes);
    expect(await fs.readdir(target)).toEqual(['browser-observations']);
  });

  it('rejects a hardlinked artifact and an unreadable artifact without exposing filesystem errors', async () => {
    const input = fixture();
    const { path, bytes } = await persist(input);
    const copy = join(directory, 'linked-copy.json');
    await fs.link(path, copy);
    expect(await inspectBrowserEvidence(input)).toEqual({
      status: 'INVALID',
      reason: 'BROWSER_ARTIFACT_LINK_INVALID',
    });
    expect(await fs.readFile(copy, 'utf8')).toBe(bytes);
    const guard = jest.spyOn(fs, 'lstat').mockImplementation(() => {
      throw Object.assign(new Error('PRIVATE_PATH_AND_SECRET'), {
        code: 'EACCES',
      });
    });
    try {
      expect(await inspectBrowserEvidence(fixture())).toEqual({
        status: 'INVALID',
        reason: 'BROWSER_ARTIFACT_UNREADABLE',
      });
    } finally {
      guard.mockRestore();
    }
  });

  it('refuses an oversized artifact before opening it and retains the malformed bytes', async () => {
    const input = fixture();
    const { path, bytes } = await persist(input, 'x'.repeat(64 * 1024 + 1));
    const guard = jest.spyOn(fs, 'open').mockImplementation(() => {
      throw new Error('FILE_OPEN_FORBIDDEN');
    });
    try {
      expect(await inspectBrowserEvidence(input)).toEqual({
        status: 'INVALID',
        reason: 'BROWSER_ARTIFACT_TOO_LARGE',
      });
      expect(guard).not.toHaveBeenCalled();
    } finally {
      guard.mockRestore();
    }
    expect(await fs.readFile(path, 'utf8')).toBe(bytes);
  });

  it('rejects altered producer scope and malformed evidence rather than accepting copied artifacts', async () => {
    const input = fixture();
    input.producer.provider = 'AZURE';
    expect(await inspectBrowserEvidence(input)).toEqual({
      status: 'INVALID',
      reason: 'BROWSER_PRODUCER_SCOPE_MISMATCH',
    });
    const malformed = fixture();
    delete malformed.sample.browserEvidence.artifact;
    expect(await inspectBrowserEvidence(malformed)).toEqual({
      status: 'INVALID',
      reason: 'BROWSER_EVIDENCE_INVALID',
    });
    const copied = fixture();
    await persist(copied);
    const otherSample = globalThis.structuredClone(copied);
    otherSample.sample.browserBinding.attemptId = randomUUID();
    expect(await inspectBrowserEvidence(otherSample)).toEqual({
      status: 'INVALID',
      reason: 'BROWSER_OBSERVATION_CORRELATION_MISMATCH',
    });
  });
});
