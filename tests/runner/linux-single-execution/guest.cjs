// Trusted offline guest supervisor. Never loads caller-provided code or credentials.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { pathToFileURL } = require('node:url');

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha = /^[a-f0-9]{64}$/;
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const bundleRoot = '/run/runner-dist';
const boundary = '/sys/fs/cgroup/alunzasingleexecutor.slice';
const limits = Object.freeze({
  vcpus: 1,
  envelopeMemoryBytes: 2147483648,
  studentMemoryBytes: 134217728,
  swapBytes: 0,
  runtimeMs: 3000,
  outputBytes: 65536,
});
const costPhases = [
  'entry',
  'importsReady',
  'identityChecked',
  'inputRead',
  'wasmReady',
  'runtimeReady',
  'contextReady',
  'trustedSetupReady',
  'studentCompiled',
  'moduleEvaluated',
  'solveReturned',
  'serialized',
  'disposed',
  'workerExit',
];
const measuredMs = (value) =>
  Number.isFinite(value) && value >= 0 && value <= 60000;

// Private laboratory metadata only. Invalid optional profiling must never turn
// an otherwise correct execution into a pass or a failure.
function projectCaseCost(value) {
  if (value == null) return null;
  try {
    assert.equal(value.version, 1);
    assert.equal(value.workerClock, 'PERFORMANCE_NOW');
    assert.equal(value.workerOrigin, 'NODE_PERFORMANCE_TIME_ORIGIN');
    assert.equal(value.bridgeOrigin, 'BRIDGE_INPUT_PARSED');
    assert.ok(
      ['COMPLETE', 'PARTIAL', 'MISSING', 'INVALID'].includes(value.status),
    );
    assert.ok(
      Array.isArray(value.phases) && value.phases.length <= costPhases.length,
    );
    let previousIndex = -1;
    let previousMs = -1;
    const phases = value.phases.map(({ phase, atMs }) => {
      const index = costPhases.indexOf(phase);
      assert.ok(
        index > previousIndex && measuredMs(atMs) && atMs >= previousMs,
      );
      previousIndex = index;
      previousMs = atMs;
      return { phase, atMs };
    });
    for (const field of ['launchRequestedMs', 'closeObservedMs'])
      assert.ok(measuredMs(value[field]));
    for (const field of ['receivedFirstMs', 'receivedLastMs'])
      assert.ok(value[field] === null || measuredMs(value[field]));
    assert.ok(value.closeObservedMs >= value.launchRequestedMs);
    assert.equal(value.receivedFirstMs === null, value.receivedLastMs === null);
    if (value.receivedFirstMs !== null)
      assert.ok(
        value.receivedFirstMs >= value.launchRequestedMs &&
          value.receivedLastMs >= value.receivedFirstMs &&
          value.receivedLastMs <= value.closeObservedMs,
      );
    if (phases.length)
      assert.ok(phases[0].phase === 'entry' && value.receivedFirstMs !== null);
    if (value.status === 'COMPLETE')
      assert.equal(phases.at(-1)?.phase, 'workerExit');
    if (value.status === 'PARTIAL')
      assert.ok(phases.length && phases.at(-1).phase !== 'workerExit');
    if (['MISSING', 'INVALID'].includes(value.status))
      assert.equal(phases.length, 0);
    if (value.status === 'MISSING') assert.equal(value.receivedFirstMs, null);
    return {
      version: 1,
      workerClock: value.workerClock,
      workerOrigin: value.workerOrigin,
      bridgeOrigin: value.bridgeOrigin,
      status: value.status,
      phases,
      receivedFirstMs: value.receivedFirstMs,
      receivedLastMs: value.receivedLastMs,
      launchRequestedMs: value.launchRequestedMs,
      closeObservedMs: value.closeObservedMs,
    };
  } catch {
    return { status: 'INVALID' };
  }
}

function validateRequest(value) {
  assert.equal(value.schemaVersion, 1);
  assert.match(value.bootId, uuid);
  assert.match(value.executionId, uuid);
  assert.ok(['RUN', 'SUBMIT'].includes(value.mode));
  assert.ok(
    (value.mode === 'RUN' ? [1, 2, 8] : [2, 8]).includes(value.caseCount),
  );
  if (value.fixture !== 'sum-fixed-v1') {
    const profile = require('./adversarial.cjs').describeProfile(value.fixture);
    assert.equal(value.mode, profile.mode);
    assert.equal(value.caseCount, profile.caseCount);
  }
  assert.equal(value.maxAdmissions, 1);
  assert.equal(value.ttlMs, 60000);
  assert.ok(Number.isSafeInteger(value.createdAtEpochMs));
  assert.equal(value.normalDeadlineEpochMs, value.createdAtEpochMs + 30000);
  assert.equal(value.cleanupDeadlineEpochMs, value.createdAtEpochMs + 40000);
  for (const field of ['sourceDigest', 'bundleManifestSha256', 'bundleSha256'])
    assert.match(value[field], sha);
  assert.match(value.capsuleImageId, /^sha256:[a-f0-9]{64}$/);
  const runtime = value.runtime;
  assert.ok(['crun', 'runc'].includes(runtime.runtime));
  assert.equal(
    runtime.runtimeVersion,
    runtime.runtime === 'crun' ? '1.31' : '1.3.4',
  );
  assert.match(runtime.runtimeSha256, sha);
  assert.match(runtime.runtimeName, /^alunza-[a-z0-9-]{1,40}$/);
  assert.match(runtime.runtimePath, /^\/[A-Za-z0-9_./-]+$/);
  assert.ok(!runtime.runtimePath.split('/').includes('..'));
  assert.equal(runtime.strategy, 'cold');
  return value;
}

function fixedInput(admission) {
  validateRequest(admission);
  return {
    executionId: admission.executionId,
    requestId: 'local-one-guest-one-execution',
    exerciseVersionId: 'synthetic-sum-fixed-v1',
    testsVersion: 'fixed-v1',
    mode: admission.mode,
    entrypoint: 'solve',
    code: 'module.exports.solve=(a,b)=>({sum:a+b});',
    tests: Array.from({ length: admission.caseCount }, (_, index) => ({
      id: `case-${index + 1}`,
      visibility:
        admission.mode === 'SUBMIT' && index > 0 ? 'hidden' : 'visible',
      args: [index + 1, 3],
      expected: { sum: index + 4 },
    })),
  };
}

function verifyEnvelope(evidence) {
  assert.equal(evidence.cpuCount, 1);
  assert.equal(evidence.memoryMax, '2147483648');
  assert.equal(evidence.swapMax, '0');
  const [quota, period] = evidence.cpuMax.split(/\s+/).map(Number);
  assert.ok(
    Number.isSafeInteger(quota) &&
      Number.isSafeInteger(period) &&
      quota > 0 &&
      period > 0 &&
      quota <= period,
  );
  assert.ok(evidence.selfGroup.startsWith('0::/alunzasingleexecutor.slice/'));
  assert.equal(evidence.cgroupVersion, '2');
  assert.equal(evidence.cgroupDriver, 'systemd');
}

function treeFiles(directory, prefix = '') {
  return fs
    .readdirSync(path.join(directory, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(path.join(directory, name));
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) return treeFiles(directory, name);
      assert.ok(stat.isFile() && stat.nlink === 1);
      return [name];
    })
    .sort();
}

function verifyExtractedBundle(manifest, directory) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.scope, 'LOCAL_DOCKER_COLD_ONLY');
  assert.equal(
    JSON.stringify(treeFiles(directory)),
    JSON.stringify(manifest.inventory.map((entry) => entry.path).sort()),
  );
  for (const entry of manifest.inventory) {
    assert.match(entry.path, /^[A-Za-z0-9_@./-]+$/);
    assert.ok(
      entry.path
        .split('/')
        .every((part) => part && part !== '.' && part !== '..'),
    );
    const content = fs.readFileSync(path.join(directory, entry.path));
    assert.equal(content.length, entry.bytes);
    assert.equal(hash(content), entry.sha256);
  }
}

function publicResult(result, events, admission, executeMs) {
  const controls = result.evidence.cgroups;
  const controlsObserved =
    controls.length === admission.caseCount &&
    controls.every(
      (row) =>
        row['memory.max'] === '134217728' &&
        row['memory.swap.max'] === '0' &&
        row['pids.max'] === '32' &&
        row['cpu.max'] === '100000 100000',
    );
  const budgetObserved =
    measuredMs(result.runtimeMs) &&
    result.runtimeMs < limits.runtimeMs &&
    Number.isSafeInteger(result.outputBytes) &&
    result.outputBytes >= 0 &&
    result.outputBytes <= limits.outputBytes;
  const imageMatched = result.evidence.image === admission.capsuleImageId;
  const casesCompleted =
    result.visibleTestResults.length + result.privateTestResults.length;
  const caseTimings = result.evidence.timings.map((row, index) => ({
    ordinal: index + 1,
    hostStartAttachMs: row.hostStartAttachMs,
    containerWallMs: row.containerWallMs,
    supervisorProcessMs: row.supervisorProcessMs,
    budgetMs: row.budgetMs,
    caseCost: projectCaseCost(row.caseCost),
  }));
  let accumulatedMs = 0;
  const caseBudgetsObserved =
    caseTimings.every((row) => {
      if (
        !measuredMs(row.supervisorProcessMs) ||
        row.budgetMs !== limits.runtimeMs - accumulatedMs
      )
        return false;
      accumulatedMs += row.supervisorProcessMs;
      return true;
    }) && accumulatedMs === result.runtimeMs;
  return {
    event: 'result',
    admissions: 1,
    mode: admission.mode,
    caseCount: admission.caseCount,
    diagnosis: result.diagnosisCode,
    reason: result.terminationReason,
    ok:
      result.diagnosisCode === 'SUCCESS' &&
      result.terminationReason === 'COMPLETED' &&
      result.allRequiredPassed &&
      result.infrastructureStatus === 'OK' &&
      controlsObserved &&
      budgetObserved &&
      caseBudgetsObserved &&
      !result.outputTruncated &&
      casesCompleted === admission.caseCount &&
      caseTimings.length === admission.caseCount &&
      imageMatched &&
      result.evidence.cleanupVerified,
    cleanupVerified: result.evidence.cleanupVerified,
    controlsObserved,
    budgetObserved,
    imageMatched,
    infrastructureStatus: result.infrastructureStatus,
    casesCompleted,
    limits,
    runtimeMs: result.runtimeMs,
    outputBytes: result.outputBytes,
    outputTruncated: result.outputTruncated,
    executeMs,
    caseTimings,
    phases: events.map(({ phase, durationMs, completed }) => ({
      phase,
      durationMs,
      completed,
    })),
  };
}

function mountDockerStore(cli) {
  // The root is the sole virtio disk; the store is the sole NVMe namespace.
  cli('mount', [
    '-t',
    'ext4',
    '-o',
    'nosuid,nodev',
    '/dev/nvme0n1',
    '/run/alunza-docker-store',
  ]);
}

async function main() {
  assert.equal(process.platform, 'linux');
  assert.equal(
    fs.readFileSync('/sys/class/dmi/id/sys_vendor', 'utf8').trim(),
    'QEMU',
  );
  assert.deepEqual(fs.readdirSync('/sys/class/net'), ['lo']);
  const admission = validateRequest(
    JSON.parse(
      fs.readFileSync(
        '/sys/firmware/qemu_fw_cfg/by_name/opt/alunza/request/raw',
        'utf8',
      ),
    ),
  );
  assert.equal(
    fs
      .readFileSync('/sys/class/dmi/id/product_uuid', 'utf8')
      .trim()
      .toLowerCase(),
    admission.bootId,
  );
  const emit = (value) =>
    process.stdout.write(
      'ALUNZA_SINGLE ' +
        JSON.stringify({
          bootId: admission.bootId,
          executionId: admission.executionId,
          ...value,
        }) +
        '\n',
    );
  let dockerStarted = false;
  const remaining = (cleanup = false) => {
    const ms =
      (cleanup
        ? admission.cleanupDeadlineEpochMs
        : admission.normalDeadlineEpochMs) - Date.now();
    assert.ok(ms > 0 && ms <= (cleanup ? 40000 : 30000));
    return Math.max(1, Math.floor(ms));
  };
  const cli = (binary, args, cleanup = false) =>
    execFileSync(binary, args, {
      encoding: 'utf8',
      timeout: remaining(cleanup),
      maxBuffer: 131072,
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        LANG: 'C',
        DOCKER_HOST: 'unix:///run/alunza-docker.sock',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    // O_EXCL establishes a single local admission even if the unit is restarted.
    fs.writeFileSync('/run/alunza-single-admitted', admission.executionId, {
      flag: 'wx',
      mode: 0o600,
    });
    const manifestBytes = fs.readFileSync(
      '/opt/alunza-single/runner-bundle.json',
    );
    assert.equal(hash(manifestBytes), admission.bundleManifestSha256);
    assert.equal(
      hash(fs.readFileSync('/opt/alunza-single/runner.tar.gz')),
      admission.bundleSha256,
    );
    const manifest = JSON.parse(manifestBytes);
    assert.equal(process.version, manifest.runtime.node);
    assert.equal(manifest.sourceDigest, admission.sourceDigest);
    fs.mkdirSync(bundleRoot, { mode: 0o700 });
    cli('tar', [
      '-xzf',
      '/opt/alunza-single/runner.tar.gz',
      '--no-same-owner',
      '-C',
      bundleRoot,
    ]);
    verifyExtractedBundle(manifest, bundleRoot);
    fs.mkdirSync('/run/alunza-docker-store', { mode: 0o700 });
    mountDockerStore(cli);
    cli('systemd-run', [
      '--quiet',
      '--unit=alunza-single-docker',
      '--slice=alunzasingleexecutor.slice',
      '--property=Delegate=yes',
      '--property=KillMode=control-group',
      'dockerd',
      '--host=unix:///run/alunza-docker.sock',
      '--data-root=/run/alunza-docker-store',
      '--exec-root=/run/alunza-docker-exec',
      '--pidfile=/run/alunza-docker.pid',
      '--bridge=none',
      '--iptables=false',
      '--ip-forward=false',
      '--ip-masq=false',
      '--exec-opt=native.cgroupdriver=systemd',
      '--cgroup-parent=alunzasingleexecutor.slice',
      `--add-runtime=${admission.runtime.runtimeName}=${admission.runtime.runtimePath}`,
    ]);
    dockerStarted = true;
    let info;
    for (;;) {
      remaining();
      try {
        info = JSON.parse(cli('docker', ['info', '--format', '{{json .}}']));
        break;
      } catch {
        await new Promise((done) => setTimeout(done, 50));
      }
    }
    assert.equal(cli('docker', ['ps', '-aq']), '');
    verifyEnvelope({
      cpuCount: os.availableParallelism(),
      memoryMax: fs.readFileSync(`${boundary}/memory.max`, 'utf8').trim(),
      swapMax: fs.readFileSync(`${boundary}/memory.swap.max`, 'utf8').trim(),
      cpuMax: fs.readFileSync(`${boundary}/cpu.max`, 'utf8').trim(),
      selfGroup: fs.readFileSync('/proc/self/cgroup', 'utf8').trim(),
      cgroupVersion: info.CgroupVersion,
      cgroupDriver: info.CgroupDriver,
    });
    const daemonPid = fs.readFileSync('/run/alunza-docker.pid', 'utf8').trim();
    assert.match(daemonPid, /^[1-9][0-9]{0,8}$/);
    assert.ok(
      fs
        .readFileSync(`/proc/${daemonPid}/cgroup`, 'utf8')
        .trim()
        .startsWith('0::/alunzasingleexecutor.slice/'),
    );
    for (const key of ['DOCKER_CONTEXT', 'DOCKER_API_VERSION'])
      delete process.env[key];
    process.env.DOCKER_HOST = 'unix:///run/alunza-docker.sock';
    const runner = await import(
      pathToFileURL(`${bundleRoot}/packages/runner/dist/index.js`).href
    );
    const { IMAGE_TAG } = await import(
      pathToFileURL(`${bundleRoot}/infra/runner/capsule.mjs`).href
    );
    assert.equal(
      cli('docker', [
        'image',
        'inspect',
        admission.capsuleImageId,
        '--format',
        '{{.Id}}',
      ]),
      admission.capsuleImageId,
    );
    // This tag changes only the fresh store overlay, never its supplied base.
    cli('docker', ['tag', admission.capsuleImageId, IMAGE_TAG]);
    const { runtimePath: _runtimePath, ...runtime } = admission.runtime;
    const inspection = await runner.inspectDockerRunner(
      runtime,
      AbortSignal.timeout(remaining()),
    );
    assert.equal(inspection.available, true);
    assert.equal(inspection.context.image, admission.capsuleImageId);
    emit({
      event: 'ready',
      sourceDigest: admission.sourceDigest,
      runtime: runtime.runtime,
      runtimeVersion: runtime.runtimeVersion,
      strategy: 'cold',
      runnerVersion: runner.RUNNER_VERSION,
      nodeVersion: process.version,
      daemonInEnvelope: true,
      supervisorInEnvelope: true,
    });
    if (admission.fixture !== 'sum-fixed-v1') {
      const { runAdversarial } = require('./adversarial-guest.cjs');
      emit(
        await runAdversarial({
          runner,
          runtime: inspection.context,
          admission,
          remaining,
          cli,
          bundleRoot,
        }),
      );
    } else {
      const events = [];
      const adapter = new runner.DockerAdapter({
        image: admission.capsuleImageId,
        runtime: inspection.context,
        deadlineMs: admission.normalDeadlineEpochMs,
        beforeSend: async () => {
          remaining();
        },
        observeTiming: (event) => {
          assert.ok(events.length < 1000);
          events.push(event);
        },
      });
      const started = performance.now();
      const result = await runner.execute(
        fixedInput(admission),
        adapter,
        AbortSignal.timeout(remaining()),
      );
      emit(
        publicResult(result, events, admission, performance.now() - started),
      );
    }
    assert.equal(cli('docker', ['ps', '-aq'], true), '');
    emit({ event: 'clean', containers: 0 });
  } catch {
    emit({ event: 'failed', code: 'GUEST_PREPARATION_OR_EXECUTION_FAILED' });
  } finally {
    if (dockerStarted) {
      try {
        cli('systemctl', ['stop', 'alunza-single-docker.service'], true);
      } catch {
        /* Host guardian retains absolute deadlines. */
      }
    }
    try {
      execFileSync('systemctl', ['poweroff', '--no-block'], {
        timeout: 1000,
        stdio: 'ignore',
      });
    } catch {
      /* Host removes the guest. */
    }
  }
}

module.exports = {
  validateRequest,
  fixedInput,
  verifyEnvelope,
  verifyExtractedBundle,
  publicResult,
  mountDockerStore,
};
if (require.main === module)
  main().catch(() => {
    process.exitCode = 1;
  });
