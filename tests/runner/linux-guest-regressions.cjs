// Offline Linux guest diagnostic. The archive contains the repository runner and synthetic fixtures.
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function verifiedNetworkDenial(observed, routes) {
  const denied = [
    'ENETUNREACH',
    'EHOSTUNREACH',
    'EACCES',
    'EPERM',
    'ECONNREFUSED',
  ];
  if (
    observed?.loopbackOnly !== true ||
    !denied.includes(observed.dns) ||
    !denied.includes(observed.udp)
  )
    return false;
  if (denied.includes(observed.ipv6)) return true;
  // A missing IPv6 source address alone does not establish isolation.
  return (
    observed.ipv6 === 'EADDRNOTAVAIL' &&
    routes?.interfaces?.length === 1 &&
    routes.interfaces[0] === 'lo' &&
    routes.ipv4DefaultExternal === false &&
    routes.ipv6DefaultExternal === false
  );
}

function inspectGuestNetwork() {
  const readRows = (file) =>
    fs
      .readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/));
  return {
    interfaces: fs.readdirSync('/sys/class/net'),
    ipv4DefaultExternal: readRows('/proc/net/route')
      .slice(1)
      .some(
        (cols) =>
          cols[0] !== 'lo' && cols[1] === '00000000' && cols[7] === '00000000',
      ),
    ipv6DefaultExternal: readRows('/proc/net/ipv6_route').some(
      (cols) =>
        cols.at(-1) !== 'lo' && cols[0] === '0'.repeat(32) && cols[1] === '00',
    ),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const focused = args.length === 1 && args[0] === '--recheck';
  if (args.length && !focused) throw new Error('Unexpected arguments');
  if (
    process.platform !== 'linux' ||
    fs.readFileSync('/sys/class/dmi/id/product_name', 'utf8').trim() !==
      'VirtualBox' ||
    fs.readdirSync('/sys/class/net').join(',') !== 'lo' ||
    !fs.existsSync('/opt/alunza/capsule.tar')
  )
    throw new Error('Expected offline VirtualBox guest');

  const work = fs.mkdtempSync('/run/alunza-regressions-');
  execFileSync('tar', [
    '-xzf',
    path.join(__dirname, 'regressions.tar.gz'),
    '-C',
    work,
  ]);
  const { execute, DockerAdapter, publicResult, cleanupDockerExecution } =
    await import(path.join(work, 'packages/runner/dist/index.js'));
  const { runnerFixtures } = await import(
    path.join(work, 'tests/runner/fixtures.mjs')
  );
  const { imageIdentity, runCapsule } = await import(
    path.join(work, 'infra/runner/capsule.mjs')
  );
  const image = await imageIdentity();
  const rows = [];
  const fixtures = [
    'sync-json-success',
    'syntax',
    'exception',
    'assertion',
    'cumulative-budget',
    'arraybuffer-memory',
    'output-65535',
    'output-65536',
    'output-65537',
    'combined-stdout-stderr',
    'case-state-isolation',
    'guest-no-host-globals',
    'hidden-projection',
    'return-envelope-as-value',
  ];
  const list = (id, runningOnly = false) =>
    execFileSync(
      'docker',
      [
        '--host',
        'unix:///var/run/docker.sock',
        'ps',
        runningOnly ? '-q' : '-aq',
        '--filter',
        'label=org.alunza.execution=' + id,
      ],
      { encoding: 'utf8', timeout: 5000 },
    ).trim();
  const record = (name, data) => {
    rows.push(data.pass === true);
    console.log('REGRESSION ' + JSON.stringify({ name, ...data }));
  };
  const request = (fixture, id) => ({
    executionId: id,
    requestId: 'local-guest',
    exerciseVersionId: 'synthetic',
    testsVersion: 'v1',
    mode: fixture.mode ?? 'RUN',
    entrypoint: 'solve',
    code: fixture.code,
    tests: fixture.tests,
  });
  for (const name of focused ? ['sync-json-success'] : fixtures) {
    const fixture = runnerFixtures.find((item) => item.id === name);
    if (!fixture) throw new Error('Missing selected fixture');
    const id = randomUUID();
    const result = await execute(
      request(fixture, id),
      new DockerAdapter({ image }),
    );
    const publicView = publicResult(result);
    const privateOk =
      !fixture.privateSentinel ||
      (!JSON.stringify(publicView).includes(fixture.privateSentinel) &&
        publicView.visibleTestResults.length === 0 &&
        publicView.hiddenChecksPassed === true);
    const bounded = result.outputBytes <= 65536;
    const outputMatch =
      !/^output-6553[567]$/.test(name) ||
      result.outputBytes === Math.min(Number(name.slice(7)), 65536);
    const clean = result.evidence.cleanupVerified === true && list(id) === '';
    record(name, {
      pass:
        result.diagnosisCode === fixture.expected &&
        (!fixture.reason || result.terminationReason === fixture.reason) &&
        outputMatch &&
        bounded &&
        privateOk &&
        clean,
      diagnosis: result.diagnosisCode,
      reason: result.terminationReason,
      outputBytes: result.outputBytes,
      runtimeMs: result.runtimeMs,
      privateOk,
      clean,
    });
  }

  const probes = [
    'identity',
    'permissions',
    'processes',
    'network',
    'descendant-memory',
  ];
  for (const probe of focused ? ['network', 'descendant-memory'] : probes) {
    const id = randomUUID();
    const test = request(
      runnerFixtures.find((f) => f.id === 'sync-json-success'),
      id,
    );
    let raw;
    const result = await execute(test, {
      provider: 'docker',
      async execute(input, signal) {
        raw = await runCapsule(input, { signal, image, probe });
        return raw;
      },
      async close() {},
    });
    const packet = raw?.packet;
    let value;
    if (packet?.returnData) {
      const envelope = JSON.parse(Buffer.from(packet.returnData, 'base64'));
      if (envelope.kind === 'probe') value = envelope.value;
    }
    const oom =
      raw?.oomKilled === true ||
      /^oom_kill [1-9]\d*$/m.test(packet?.cgroup?.['memory.events'] ?? '');
    const clean = raw?.cleanupVerified === true && list(id) === '';
    let valid = false;
    if (probe === 'identity')
      valid =
        value?.uid === 10001 &&
        Object.keys(value.capabilities).length === 5 &&
        Object.values(value.capabilities).every(
          (c) => c === '0000000000000000',
        );
    if (probe === 'permissions')
      valid =
        value?.parentDenied &&
        value.readonly &&
        value.environment.join(',') === 'HOME,LANG,PATH';
    if (probe === 'processes')
      valid =
        value?.attempted === 40 &&
        value.started > 0 &&
        value.started + value.eagain === 40 &&
        value.eagain > 0 &&
        value.pidsMax === 32 &&
        value.pidsCurrent <= 32 &&
        value.identitiesValid &&
        value.unexpectedErrors === 0;
    if (probe === 'network')
      valid = verifiedNetworkDenial(value, inspectGuestNetwork());
    if (probe === 'descendant-memory')
      valid =
        oom &&
        result.evidence.oomObserved &&
        result.diagnosisCode === 'UNKNOWN' &&
        result.terminationReason === 'MEMORY_LIMIT' &&
        !result.allRequiredPassed;
    else
      valid =
        valid &&
        raw?.exitCode === 0 &&
        packet?.exitCode === 0 &&
        !raw.timedOut &&
        !oom;
    record('os-' + probe, {
      pass: Boolean(valid && clean),
      clean,
      oom,
      parentReturned: probe === 'descendant-memory' && value === true,
      ...(probe === 'network'
        ? {
            loopbackOnly: value?.loopbackOnly === true,
            errors: ['dns', 'ipv6', 'udp'].map((key) => {
              const observed = value?.[key];
              return typeof observed === 'string' &&
                /^[A-Z][A-Z0-9_]{0,30}$/.test(observed)
                ? observed
                : 'UNAVAILABLE';
            }),
            packetStatus: packet?.status ?? null,
          }
        : {}),
      ...(probe === 'descendant-memory'
        ? {
            diagnosis: result.diagnosisCode,
            reason: result.terminationReason,
            oomRecorded: result.evidence.oomObserved,
          }
        : {}),
    });
  }

  const id = randomUUID();
  const control = new AbortController();
  const fixture = runnerFixtures.find((f) => f.id === 'infinite-loop');
  let seenRunning = false;
  const watcher = setInterval(() => {
    if (list(id, true)) {
      seenRunning = true;
      control.abort();
      clearInterval(watcher);
    }
  }, 120);
  let result;
  try {
    result = await execute(
      request(fixture, id),
      new DockerAdapter({ image }),
      control.signal,
    );
  } finally {
    clearInterval(watcher);
  }
  // Cancellation can invalidate the worker's receipt. A fresh lookup must confirm absence.
  const initialCleanupVerified = result.evidence.cleanupVerified;
  const recovered = await cleanupDockerExecution(
    id,
    AbortSignal.timeout(10000),
  );
  const clean = recovered.cleanupVerified && list(id) === '';
  record('cancel-running', {
    pass: seenRunning && clean && result.terminationReason === 'CANCELLED',
    seenRunning,
    initialCleanupVerified,
    reconciliationVerified: recovered.cleanupVerified,
    reason: result.terminationReason,
    clean,
  });
  console.log(
    'REGRESSION_TOTAL ' +
      JSON.stringify({
        total: rows.length,
        passed: rows.filter(Boolean).length,
      }),
  );
  if (rows.some((p) => !p)) process.exitCode = 1;
}
module.exports = { verifiedNetworkDenial };
if (require.main === module)
  main().catch(() => {
    console.error('REGRESSION_ERROR guest setup or observation failed');
    process.exitCode = 2;
  });
