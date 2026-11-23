import { spawn } from 'node:child_process';

const ignoreError = () => {};
function safeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function bounded(value, fallback, maximum) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum)
    throw safeError('DOCKER_OBSERVATION_INVALID_OPTIONS');
  return selected;
}

// Used by read-only Docker observations. Shell expansion and inherited output
// are deliberately unavailable. Error objects never carry arguments or output.
export function executeDockerObservation(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let timeoutMs, maxOutputBytes, killGraceMs, closeGraceMs;
    try {
      if (
        typeof command !== 'string' ||
        !command ||
        !Array.isArray(args) ||
        !args.every((argument) => typeof argument === 'string') ||
        !options ||
        typeof options !== 'object' ||
        Array.isArray(options)
      )
        throw safeError('DOCKER_OBSERVATION_INVALID_OPTIONS');
      timeoutMs = bounded(options.timeoutMs, 10000, 10000);
      maxOutputBytes = bounded(
        options.maxOutputBytes,
        2 * 1024 * 1024,
        2 * 1024 * 1024,
      );
      killGraceMs = bounded(options.killGraceMs, 250, 1000);
      closeGraceMs = bounded(options.closeGraceMs, 250, 1000);
    } catch {
      reject(safeError('DOCKER_OBSERVATION_INVALID_OPTIONS'));
      return;
    }
    const spawnProcess = options.spawnProcess ?? spawn;
    const schedule = options.schedule ?? setTimeout;
    const unschedule = options.unschedule ?? clearTimeout;
    let child, timer, killTimer, closeTimer;
    let settled = false,
      failure,
      exitObserved = false,
      closeObserved = false;
    let bytes = 0;
    const output = { stdout: [], stderr: [] };
    const cancel = (handle) => {
      if (handle !== undefined) unschedule(handle);
    };
    function cleanup() {
      cancel(timer);
      cancel(killTimer);
      cancel(closeTimer);
      timer = killTimer = closeTimer = undefined;
      if (!child) return;
      child.off('exit', onExit);
      child.off('close', onClose);
      child.off('error', onError);
      // A late process/pipe error must not become an uncaught exception after
      // the bounded observation has already returned.
      child.on('error', ignoreError);
      for (const [stream, listener] of [
        [child.stdout, onStdout],
        [child.stderr, onStderr],
      ]) {
        stream?.off('data', listener);
        stream?.off('error', onStreamError);
        stream?.on('error', ignoreError);
      }
      for (const stream of [child.stdin, child.stdout, child.stderr]) {
        try {
          stream?.destroy?.();
        } catch {
          /* Owned pipes are best-effort cleanup. */
        }
      }
      if (!closeObserved) {
        try {
          child.unref?.();
        } catch {
          /* An unconfirmed child must not retain this observation. */
        }
      }
    }
    function finish(code = null) {
      if (settled) return;
      settled = true;
      cleanup();
      const resultCode = Number.isSafeInteger(code) ? code : null;
      if (failure) reject(safeError(failure));
      else if (resultCode === 0 || options.allowFailure === true)
        resolve({
          stdout: Buffer.concat(output.stdout).toString('utf8'),
          stderr: Buffer.concat(output.stderr).toString('utf8'),
          code: resultCode,
        });
      else reject(safeError('DOCKER_OBSERVATION_EXIT_FAILED'));
      output.stdout.length = output.stderr.length = 0;
    }
    function kill(signal) {
      try {
        child?.kill?.(signal);
      } catch {
        /* Failure still has a bounded finalizer. */
      }
    }
    function fail(code) {
      if (settled || failure) return;
      failure = code;
      output.stdout.length = output.stderr.length = 0;
      cancel(timer);
      timer = undefined;
      cancel(closeTimer);
      closeTimer = undefined;
      if (!child || !Number.isSafeInteger(child.pid) || child.pid < 1) {
        finish();
        return;
      }
      if (exitObserved) {
        closeTimer = schedule(() => finish(), closeGraceMs);
        return;
      }
      // Schedule before signalling: a fake or real child may close immediately.
      killTimer = schedule(() => {
        killTimer = undefined;
        if (settled) return;
        closeTimer = schedule(() => finish(), closeGraceMs);
        kill('SIGKILL');
      }, killGraceMs);
      kill('SIGTERM');
    }
    function collect(channel, chunk) {
      if (settled || failure) return;
      let length;
      try {
        if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string')
          throw new Error();
        length = Buffer.isBuffer(chunk)
          ? chunk.length
          : Buffer.byteLength(chunk, 'utf8');
      } catch {
        fail('DOCKER_OBSERVATION_STREAM_ERROR');
        return;
      }
      if (bytes + length > maxOutputBytes) {
        fail('DOCKER_OBSERVATION_OUTPUT_LIMIT');
        return;
      }
      bytes += length;
      output[channel].push(Buffer.from(chunk));
    }
    function onStdout(chunk) {
      collect('stdout', chunk);
    }
    function onStderr(chunk) {
      collect('stderr', chunk);
    }
    function onStreamError() {
      fail('DOCKER_OBSERVATION_STREAM_ERROR');
    }
    function onError() {
      fail(
        child?.pid
          ? 'DOCKER_OBSERVATION_PROCESS_ERROR'
          : 'DOCKER_OBSERVATION_SPAWN_FAILED',
      );
    }
    function onExit() {
      if (settled) return;
      exitObserved = true;
      cancel(timer);
      timer = undefined;
      cancel(killTimer);
      killTimer = undefined;
      cancel(closeTimer);
      // Exit alone does not guarantee that both output pipes have drained.
      closeTimer = schedule(() => {
        failure ??= 'DOCKER_OBSERVATION_CLOSE_TIMEOUT';
        finish();
      }, closeGraceMs);
    }
    function onClose(code) {
      if (settled) return;
      closeObserved = true;
      finish(code);
    }
    try {
      child = spawnProcess(command, args, {
        cwd: options.cwd ?? process.cwd(),
        env: { ...process.env, ...options.env },
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      failure = 'DOCKER_OBSERVATION_SPAWN_FAILED';
      finish();
      return;
    }
    child.on('error', onError);
    child.on('exit', onExit);
    child.on('close', onClose);
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.stdout?.on('error', onStreamError);
    child.stderr?.on('error', onStreamError);
    timer = schedule(() => fail('DOCKER_OBSERVATION_TIMEOUT'), timeoutMs);
  });
}
