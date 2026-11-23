import { readFile, unlink, writeFile, stat, chown } from 'node:fs/promises';
import { runCapsule } from './capsule.mjs';
import {
  remoteDriverExitCodes,
  remoteDriverFailureMarker,
  safeRemoteStartFailureDetail,
} from './timing.mjs';
const [operation, path, output, ...options] = process.argv.slice(2);
// This trusted command argument is never part of the student input file.
const deadlineOption = options.at(-1)?.startsWith('--deadline-ms=')
  ? options.pop()
  : undefined;
const deadlineMs = deadlineOption && Number(deadlineOption.slice(14));
const [probe] = options;
const match = /^\/vercel\/sandbox\/alunza-input-([a-f0-9-]{36})\.json$/.exec(
  path ?? '',
);
let phase = 'ARGUMENTS';
let firstFailure;
let startFailure;
function observeFailure(failedPhase) {
  if (Object.hasOwn(remoteDriverExitCodes, failedPhase))
    firstFailure ??= failedPhase;
}
async function writePrivateDocument(document, owner, maxBytes) {
  phase = 'RESULT_ENCODE';
  const bytes = Buffer.from(JSON.stringify(document));
  if (bytes.length > maxBytes) throw new Error('Capsule output too large');
  phase = 'RESULT_WRITE';
  await writeFile(output, bytes, { mode: 0o600, flag: 'wx' });
  phase = 'RESULT_CHOWN';
  await chown(output, owner.uid, owner.gid);
}
try {
  if (
    !match ||
    output !== `/vercel/sandbox/alunza-result-${match[1]}.json` ||
    !['execute', 'cleanup'].includes(operation) ||
    options.length > 1 ||
    (deadlineOption &&
      (operation !== 'execute' ||
        !/^--deadline-ms=[1-9][0-9]{0,15}$/.test(deadlineOption) ||
        !Number.isSafeInteger(deadlineMs))) ||
    (probe !== undefined &&
      (operation !== 'execute' ||
        ![
          'identity',
          'permissions',
          'memory',
          'descendant-memory',
          'processes',
          'network',
        ].includes(probe)))
  )
    throw new Error('Invalid private job paths');
  if (operation === 'cleanup') {
    phase = 'FILE_CLEANUP';
    for (const file of [path, output]) {
      await unlink(file).catch((error) => {
        if (error.code !== 'ENOENT') observeFailure(phase);
      });
    }
    if (firstFailure) throw new Error('Private file cleanup failed');
  } else {
    let owner;
    try {
      phase = 'INPUT_STAT';
      owner = await stat(path);
      phase = 'INPUT_READ';
      const body = await readFile(path);
      if (body.length > 262144) throw new Error('Capsule input too large');
      phase = 'INPUT_DECODE';
      const input = JSON.parse(body.toString('utf8'));
      phase = 'CAPSULE';
      const capsule = await runCapsule(input, {
        probe,
        deadlineMs,
        observeFailure,
        observeStartFailure(detail) {
          startFailure ??= safeRemoteStartFailureDetail(detail);
        },
      });
      await writePrivateDocument(capsule, owner, 524288);
    } catch (error) {
      observeFailure(phase);
      if (
        firstFailure === 'START' &&
        startFailure &&
        (deadlineMs === undefined || Date.now() < deadlineMs)
      ) {
        await writePrivateDocument(
          { kind: 'START_FAILURE', schemaVersion: 1, detail: startFailure },
          owner,
          4096,
        ).catch(() => {});
      }
      throw error;
    } finally {
      phase = 'INPUT_UNLINK';
      await unlink(path).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
} catch {
  // Never send the private result, arguments, code or provider error to command logs.
  observeFailure(phase);
  process.stderr.write(remoteDriverFailureMarker);
  process.exitCode = remoteDriverExitCodes[firstFailure];
}
