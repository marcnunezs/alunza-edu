// Fixed trusted PID 1. Student gets different UID, zero capabilities and its own pipes.
// Its return pipe is still untrusted: this bridge never compares tests or grants success.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const OUT_MAX = 65536;
let stdin = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  if (stdin.length + chunk.length > 262144) process.exit(120);
  stdin = Buffer.concat([stdin, chunk]);
});
function launch(args, includeReturn = false) {
  return spawn(
    '/usr/bin/setpriv',
    [
      '--reuid=10001',
      '--regid=10001',
      '--clear-groups',
      '--bounding-set=-all',
      '--inh-caps=-all',
      '--ambient-caps=-all',
      '--no-new-privs',
      '/usr/local/bin/node',
      ...args,
    ],
    {
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: '/tmp',
        LANG: 'C.UTF-8',
      },
      cwd: '/tmp',
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe', ...(includeReturn ? ['pipe'] : [])],
    },
  );
}
function cgroupEvidence() {
  const values = {};
  for (const file of [
    'memory.max',
    'memory.swap.max',
    'memory.peak',
    'memory.events',
    'pids.max',
    'cpu.max',
  ]) {
    try {
      values[file] = fs.readFileSync(`/sys/fs/cgroup/${file}`, 'utf8').trim();
    } catch {
      values[file] = 'unavailable';
    }
  }
  return values;
}
function complete(packet) {
  process.stdout.write(
    JSON.stringify({ ...packet, cgroup: cgroupEvidence() }) + '\n',
    () => process.exit(0),
  );
}
process.stdin.on('end', async () => {
  try {
    const input = JSON.parse(stdin.toString('utf8'));
    const start = performance.now();
    const resources = cgroupEvidence();
    if (
      resources['memory.max'] !== '134217728' ||
      resources['memory.swap.max'] !== '0' ||
      resources['pids.max'] !== '32' ||
      !/^100000 100000$/.test(resources['cpu.max'])
    ) {
      complete({
        status: 'capability-gap',
        runtimeMs: 0,
        stdout: '',
        stderr: '',
        outputBytes: 0,
        outputTruncated: false,
      });
      return;
    }
    fs.writeFileSync('/tmp/solution.cjs', input.code, { mode: 0o444 });
    fs.writeFileSync(
      '/tmp/args.json',
      JSON.stringify({
        args: input.args,
        budgetMs: input.budgetMs,
        outputRemaining: input.outputRemaining,
      }),
      {
        mode: 0o444,
      },
    );
    // Probe mode is chosen only by trusted Docker tooling, never by capsule input.
    const probe = process.env.ALUNZA_RUNNER_PROBE;
    const worker = launch(
      probe ? ['/opt/alunza/os-probe.cjs', probe] : ['/opt/alunza/worker.cjs'],
      true,
    );
    let reason = null,
      outputBytes = 0,
      stdout = Buffer.alloc(0),
      stderr = Buffer.alloc(0),
      returned = Buffer.alloc(0);
    const stop = (value) => {
      if (reason === null) reason = value;
      try {
        process.kill(-worker.pid, 'SIGKILL');
      } catch {
        /* already exited */
      }
    };
    const budget = Math.max(
      0,
      Math.min(3000, input.budgetMs) - (performance.now() - start),
    );
    const timer = setTimeout(() => stop('timeout'), budget);
    const capture = (channel, chunk) => {
      const remaining = Math.max(
        0,
        Math.min(OUT_MAX, input.outputRemaining) - outputBytes,
      );
      const kept = chunk.subarray(0, remaining);
      if (channel === 'stdout') stdout = Buffer.concat([stdout, kept]);
      else stderr = Buffer.concat([stderr, kept]);
      outputBytes += kept.length;
      if (chunk.length > remaining) stop('output');
    };
    worker.stdout.on('data', (chunk) => capture('stdout', chunk));
    worker.stderr.on('data', (chunk) => capture('stderr', chunk));
    worker.stdio[3].on('data', (chunk) => {
      if (returned.length + chunk.length > OUT_MAX) {
        stop('return-limit');
        return;
      }
      returned = Buffer.concat([returned, chunk]);
    });
    worker.on('error', () => stop('failure'));
    worker.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      complete({
        status: reason ?? 'exited',
        exitCode,
        signal,
        runtimeMs: performance.now() - start,
        stdout: stdout.toString('base64'),
        stderr: stderr.toString('base64'),
        returnData: returned.toString('base64'),
        outputBytes,
        outputTruncated: reason === 'output',
      });
    });
  } catch {
    complete({
      status: 'failure',
      runtimeMs: 0,
      stdout: '',
      stderr: '',
      outputBytes: 0,
      outputTruncated: false,
    });
  }
});
