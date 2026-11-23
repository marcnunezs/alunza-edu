// Trusted local API guest. Receives data, never evaluates student code in Node.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bundleRoot = '/run/runner-dist';
const boundary = '/sys/fs/cgroup/alunzasingleexecutor.slice';
const { validateRequest } = require('./protocol.cjs');

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
  const emit = (value) => {
    const frame = Buffer.from(
      'ALUNZA_VM ' +
        JSON.stringify({
          bootId: admission.bootId,
          executionId: admission.executionId,
          creationId: admission.creationId,
          ...value,
        }) +
        '\n',
    );
    assert.ok(frame.length <= 1048576);
    let offset = 0;
    while (offset < frame.length) offset += fs.writeSync(1, frame, offset);
  };
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
    const envelope = {
      cpuCount: os.availableParallelism(),
      memoryMax: fs.readFileSync(`${boundary}/memory.max`, 'utf8').trim(),
      swapMax: fs.readFileSync(`${boundary}/memory.swap.max`, 'utf8').trim(),
      cpuMax: fs.readFileSync(`${boundary}/cpu.max`, 'utf8').trim(),
      selfGroup: fs.readFileSync('/proc/self/cgroup', 'utf8').trim(),
      cgroupVersion: info.CgroupVersion,
      cgroupDriver: info.CgroupDriver,
    };
    verifyEnvelope(envelope);
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
      envelope,
    });
    assert.equal(runner.RUNNER_VERSION, admission.context.runnerVersion);
    const input = runner.executionSchema.parse(JSON.parse(admission.inputJson));
    assert.equal(input.executionId, admission.executionId);
    const adapter = new runner.DockerAdapter({
      image: admission.capsuleImageId,
      runtime: inspection.context,
      deadlineMs: admission.normalDeadlineEpochMs,
      expectedBoundary: boundary,
      beforeSend: async () => {
        remaining();
      },
    });
    const result = await runner.execute(
      input,
      adapter,
      AbortSignal.timeout(remaining()),
    );
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 1048576);
    emit({ event: 'result', admissions: 1, result });
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
  verifyEnvelope,
  verifyExtractedBundle,
  mountDockerStore,
};
if (require.main === module)
  main().catch(() => {
    process.exitCode = 1;
  });
