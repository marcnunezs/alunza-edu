import { jest, test, expect } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { executeDockerObservation } from '../../scripts/submit-docker-observation.mjs';

function fixture({ pid = 123 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.destroy = jest.fn();
  child.stderr.destroy = jest.fn();
  child.unref = jest.fn();
  child.kill = jest.fn(() => true);
  const spawnProcess = jest.fn(() => child);
  let now = 0,
    next = 0;
  const tasks = new Map();
  const schedule = (callback, delay) => {
    const id = next++;
    tasks.set(id, { callback, at: now + delay });
    return id;
  };
  const unschedule = (id) => tasks.delete(id);
  function advance(delay) {
    const end = now + delay;
    while (true) {
      const pending = [...tasks]
        .sort((a, b) => a[1].at - b[1].at)
        .find(([, task]) => task.at <= end);
      if (!pending) break;
      const [id, task] = pending;
      tasks.delete(id);
      now = task.at;
      task.callback();
    }
    now = end;
  }
  return {
    child,
    spawnProcess,
    tasks,
    advance,
    options: { spawnProcess, schedule, unschedule },
  };
}

test('bounded observation preserves complete stdout/stderr and drains pipes after exit before resolving', async () => {
  const f = fixture();
  const result = executeDockerObservation('docker', ['info'], {
    ...f.options,
    cwd: 'workspace',
    env: { TASK_ONLY: 'yes' },
  });
  f.child.stdout.emit('data', Buffer.from('first'));
  f.child.stderr.emit('data', Buffer.from('warning'));
  f.child.emit('exit', 0);
  f.child.stdout.emit('data', Buffer.from(' last'));
  f.child.emit('close', 0);
  await expect(result).resolves.toEqual({
    stdout: 'first last',
    stderr: 'warning',
    code: 0,
  });
  expect(f.spawnProcess).toHaveBeenCalledWith(
    'docker',
    ['info'],
    expect.objectContaining({
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: 'workspace',
      env: expect.objectContaining({ TASK_ONLY: 'yes' }),
    }),
  );
  expect(f.tasks.size).toBe(0);
  expect(f.child.kill).not.toHaveBeenCalled();
  expect(f.child.unref).not.toHaveBeenCalled();
  expect(f.child.stdout.destroy).toHaveBeenCalledTimes(1);
});

test('byte budget is combined across stdout/stderr and decodes split UTF-8 only after collection', async () => {
  const f = fixture();
  const value = Buffer.from('á');
  const result = executeDockerObservation('docker', ['info'], {
    ...f.options,
    maxOutputBytes: 3,
  });
  f.child.stdout.emit('data', value.subarray(0, 1));
  f.child.stdout.emit('data', value.subarray(1));
  f.child.stderr.emit('data', 'x');
  f.child.emit('close', 0);
  await expect(result).resolves.toEqual({ stdout: 'á', stderr: 'x', code: 0 });
});

test('spawn exception returns only a safe error without child arguments, cause or output', async () => {
  const result = executeDockerObservation('docker', ['private-argument'], {
    spawnProcess() {
      throw new Error('private-spawn-error');
    },
  });
  await expect(result).rejects.toMatchObject({
    message: 'DOCKER_OBSERVATION_SPAWN_FAILED',
    code: 'DOCKER_OBSERVATION_SPAWN_FAILED',
  });
  await result.catch((error) => {
    expect(error.cause).toBeUndefined();
    expect(error.output).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('private');
  });
});

test('asynchronous spawn failure without a process does not wait for close', async () => {
  const f = fixture({ pid: undefined });
  f.child.pid = undefined;
  const result = executeDockerObservation('docker', ['info'], f.options);
  f.child.emit('error', new Error('private asynchronous spawn failure'));
  await expect(result).rejects.toMatchObject({
    code: 'DOCKER_OBSERVATION_SPAWN_FAILED',
  });
  expect(f.tasks.size).toBe(0);
  expect(f.child.unref).toHaveBeenCalledTimes(1);
});

test('nonzero exit is a safe rejection while allowFailure preserves run-compatible result', async () => {
  const f = fixture();
  const result = executeDockerObservation('docker', ['info'], f.options);
  f.child.stderr.emit('data', 'private stderr');
  f.child.emit('exit', 2);
  f.child.emit('close', 2);
  await expect(result).rejects.toMatchObject({
    code: 'DOCKER_OBSERVATION_EXIT_FAILED',
  });
  await result.catch((error) => expect(error.output).toBeUndefined());
  const allowed = fixture();
  const allowedResult = executeDockerObservation('docker', ['info'], {
    ...allowed.options,
    allowFailure: true,
  });
  allowed.child.stderr.emit('data', 'diagnostic result');
  allowed.child.emit('close', 2);
  await expect(allowedResult).resolves.toEqual({
    stdout: '',
    stderr: 'diagnostic result',
    code: 2,
  });
});

test('signal exit has no successful exit code', async () => {
  const f = fixture();
  const result = executeDockerObservation('docker', ['info'], f.options);
  f.child.emit('close', null, 'SIGTERM');
  await expect(result).rejects.toMatchObject({
    code: 'DOCKER_OBSERVATION_EXIT_FAILED',
  });
});

test('combined output overflow cannot be hidden by a subsequent successful close', async () => {
  const f = fixture();
  const result = executeDockerObservation('docker', ['info'], {
    ...f.options,
    maxOutputBytes: 8,
  });
  f.child.stdout.emit('data', '1234');
  f.child.stderr.emit('data', '56789');
  expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
  f.child.emit('close', 0);
  await expect(result).rejects.toMatchObject({
    code: 'DOCKER_OBSERVATION_OUTPUT_LIMIT',
  });
  expect(f.tasks.size).toBe(0);
});

test.each(['returns-false', 'throws'])(
  'timeout remains bounded when kill %s and neither exit nor close arrives',
  async (behavior) => {
    const f = fixture();
    f.child.kill.mockImplementation(() => {
      if (behavior === 'throws') throw new Error('private kill failure');
      return false;
    });
    const result = executeDockerObservation('docker', ['info'], f.options);
    f.advance(10000);
    expect(f.child.kill.mock.calls).toEqual([['SIGTERM']]);
    f.advance(250);
    expect(f.child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    f.advance(250);
    await expect(result).rejects.toMatchObject({
      code: 'DOCKER_OBSERVATION_TIMEOUT',
    });
    expect(f.child.unref).toHaveBeenCalledTimes(1);
    expect(f.child.stdout.destroy).toHaveBeenCalledTimes(1);
    expect(f.child.stderr.destroy).toHaveBeenCalledTimes(1);
    expect(f.tasks.size).toBe(0);
    // Late events do not resurrect the operation or become uncaught errors.
    f.child.emit('error', new Error('private late failure'));
    f.child.stdout.emit('error', new Error('private late pipe failure'));
    f.child.emit('close', 0);
  },
);

test('exit without pipe close is bounded and reports incomplete observation', async () => {
  const f = fixture();
  const result = executeDockerObservation('docker', ['info'], f.options);
  f.child.emit('exit', 0);
  f.advance(250);
  await expect(result).rejects.toMatchObject({
    code: 'DOCKER_OBSERVATION_CLOSE_TIMEOUT',
  });
  expect(f.child.kill).not.toHaveBeenCalled();
  expect(f.child.unref).toHaveBeenCalledTimes(1);
  expect(f.tasks.size).toBe(0);
});

test('process and pipe errors remain safe and stop the child', async () => {
  for (const target of ['process', 'stdout', 'stderr']) {
    const f = fixture();
    const result = executeDockerObservation('docker', ['info'], f.options);
    (target === 'process' ? f.child : f.child[target]).emit(
      'error',
      new Error('private details'),
    );
    f.child.emit('close', 1);
    await expect(result).rejects.toMatchObject({
      code:
        target === 'process'
          ? 'DOCKER_OBSERVATION_PROCESS_ERROR'
          : 'DOCKER_OBSERVATION_STREAM_ERROR',
    });
    expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(f.tasks.size).toBe(0);
  }
});

test('synchronous close during kill cancels all grace timers', async () => {
  const f = fixture();
  f.child.kill.mockImplementation(() => {
    f.child.emit('close', null);
    return true;
  });
  const result = executeDockerObservation('docker', ['info'], f.options);
  f.advance(10000);
  await expect(result).rejects.toMatchObject({
    code: 'DOCKER_OBSERVATION_TIMEOUT',
  });
  expect(f.tasks.size).toBe(0);
  expect(f.child.kill).toHaveBeenCalledTimes(1);
});

test.each([
  { timeoutMs: 10001 },
  { maxOutputBytes: 2097153 },
  { maxOutputBytes: 0 },
  { killGraceMs: 1001 },
  { closeGraceMs: Infinity },
])('rejects an unbounded option %# before spawning', async (options) => {
  const f = fixture();
  await expect(
    executeDockerObservation('docker', ['info'], { ...f.options, ...options }),
  ).rejects.toMatchObject({ code: 'DOCKER_OBSERVATION_INVALID_OPTIONS' });
  expect(f.spawnProcess).not.toHaveBeenCalled();
});
