// External-TTL laboratory model. The watchdog is independent of the API/guest stand-ins.
// Handles always reference children spawned by this test. Nothing runs inside a VM.
import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(import.meta.url);
const ttlMs = 2000;

async function watchdog() {
  const created = performance.now();
  const workload = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    {
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  let cutAt = null;
  const forceStop = () => {
    if (workload.exitCode === null && workload.signalCode === null)
      workload.kill('SIGKILL');
  };
  const timer = setTimeout(
    () => {
      cutAt = performance.now();
      forceStop();
    },
    Math.max(0, ttlMs - (performance.now() - created)),
  );
  process.once('disconnect', forceStop);
  try {
    const stopped = once(workload, 'exit');
    await once(workload, 'spawn');
    process.send({ event: 'started', pid: workload.pid });
    const [code, signal] = await stopped;
    assert.ok(cutAt !== null && (signal || code !== 0));
    const elapsedMs = Math.round(cutAt - created);
    process.send({ event: 'expired', elapsedMs, pid: workload.pid });
  } finally {
    clearTimeout(timer);
    forceStop();
    if (process.connected) process.disconnect();
  }
}

const role = process.argv[2];
if (role === 'watchdog') await watchdog();
else if (role === 'actor') {
  process.send({ event: 'ready' });
  process.once('message', (event) => {
    if (event === 'simulate-crash') process.exit(61);
    throw new Error('Unexpected actor input');
  });
} else {
  const owned = [];
  const start = (role) => {
    const child = fork(file, [role], {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      windowsHide: true,
    });
    owned.push(child);
    return child;
  };
  try {
    const api = start('actor');
    const apiExit = once(api, 'exit');
    const apiReady = once(api, 'message');
    const guest = start('actor');
    const guestExit = once(guest, 'exit');
    const guestReady = once(guest, 'message');
    await Promise.all([apiReady, guestReady]);
    const guardian = start('watchdog');
    const guardianExit = once(guardian, 'exit');
    const [started] = await once(guardian, 'message');
    assert.equal(started.event, 'started');
    const expired = once(guardian, 'message');
    api.send('simulate-crash');
    guest.send('simulate-crash');
    assert.deepEqual(await apiExit, [61, null]);
    assert.deepEqual(await guestExit, [61, null]);
    assert.doesNotThrow(() => process.kill(started.pid, 0));
    const [proof] = await expired;
    assert.equal(proof.event, 'expired');
    assert.equal(proof.pid, started.pid);
    assert.ok(proof.elapsedMs >= ttlMs - 10);
    assert.ok(proof.elapsedMs <= ttlMs + 1500);
    assert.deepEqual(await guardianExit, [0, null]);
    assert.throws(() => process.kill(started.pid, 0), { code: 'ESRCH' });
    console.log(
      JSON.stringify({
        status: 'passed',
        provider: 'SIMULATED',
        resource: 'REAL_LOCAL_CHILD_PROCESS',
        apiAndGuest: 'two synthetic processes exited before TTL',
        ttlMs,
        elapsedMs: proof.elapsedMs,
        childAbsent: true,
        cloudCalls: 0,
      }),
    );
  } finally {
    for (const child of owned)
      if (
        child.exitCode === null &&
        child.signalCode === null &&
        child.connected
      )
        child.disconnect();
  }
}
