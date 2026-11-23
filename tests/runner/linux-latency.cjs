// Offline guest diagnostic for the prepared Linux capsule.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const { performance } = require('node:perf_hooks');

const imageId =
  'sha256:96ffff38bde1000dab2e3cc8da27c760e317ac61cde859e64b3abcfdf16a188c';
const linear = [
  'imageResolve',
  'engineResolve',
  'create',
  'preInspect',
  'attachOutput',
  'attachInput',
  'start',
  'send',
  'postInspect',
  'delete',
  'verifyAbsent',
];
const overlay = [
  'streams',
  'wait',
  'supervisor',
  'containerWall',
  'hostStartAttach',
];
const round = (number) => Math.round(number * 1000) / 1000;
const emit = (kind, data) =>
  console.log('LATENCY_' + kind + ' ' + JSON.stringify(data));
const cli = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 12000,
    maxBuffer: 16384,
  }).trim();

function unionDuration(spans) {
  let end = -Infinity,
    total = 0;
  for (const span of [...spans].sort(
    (a, b) => a.end - a.durationMs - (b.end - b.durationMs),
  )) {
    const start = Math.max(end, span.end - span.durationMs);
    total += Math.max(0, span.end - start);
    end = Math.max(end, span.end);
  }
  return total;
}

function breakdown(events, wallMs, caseCount) {
  const totals = {},
    counts = {};
  for (const e of events) {
    totals[e.phase] = (totals[e.phase] ?? 0) + e.durationMs;
    counts[e.phase] = (counts[e.phase] ?? 0) + 1;
  }
  const phaseMs = Object.fromEntries(
    linear.map((k) => [k, round(totals[k] ?? 0)]),
  );
  phaseMs.streamsWaitUnion = round(
    unionDuration(
      events.filter((e) => e.phase === 'streams' || e.phase === 'wait'),
    ),
  );
  phaseMs.unattributed = round(
    wallMs - Object.values(phaseMs).reduce((a, b) => a + b, 0),
  );
  return {
    phaseMs,
    overlayMs: Object.fromEntries(
      overlay.map((k) => [k, round(totals[k] ?? 0)]),
    ),
    eventCounts: counts,
    complete:
      events.every((e) => e.completed) &&
      [...linear, ...overlay].every(
        (k) => counts[k] === (k === 'imageResolve' ? 1 : caseCount),
      ),
  };
}

// Each sequential adapter call emits one engineResolve. A skipped case must never
// inherit a timing from an earlier one, even when that case failed before start.
function capsuleTimings(events, tests) {
  const rows = tests.map((item, index) => ({
    ordinal: index + 1,
    visibility: item.visibility,
    attempted: false,
    createMs: null,
    created: false,
    startMs: null,
    started: false,
  }));
  let index = -1;
  for (const event of events) {
    if (event.phase === 'engineResolve') {
      index++;
      assert.ok(index < rows.length);
      rows[index].attempted = true;
    } else if (event.phase === 'create' || event.phase === 'start') {
      const row = rows[index];
      assert.ok(row);
      const key = event.phase + 'Ms';
      assert.equal(row[key], null);
      row[key] = round(event.durationMs);
      row[event.phase === 'create' ? 'created' : 'started'] = event.completed;
    }
  }
  return rows;
}

function qemuReceiptId(vendor, uuid) {
  assert.equal(vendor.trim(), 'QEMU');
  const id = uuid.trim().toLowerCase();
  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  return id;
}

function capsuleStartPercentiles(samples) {
  return ['visible', 'hidden'].map((visibility, index) => {
    const rows = samples.map((sample) => sample.caseTimings[index]);
    assert.ok(
      rows.every(
        (row) => row.ordinal === index + 1 && row.visibility === visibility,
      ),
    );
    const observed = rows.filter((row) => Number.isFinite(row.startMs));
    const ordered = observed.map((row) => row.startMs).sort((a, b) => a - b);
    const rank = (q) => ordered[Math.ceil(q * ordered.length) - 1] ?? null;
    return {
      ordinal: index + 1,
      visibility,
      observed: observed.length,
      missing: rows.length - observed.length,
      failed: observed.filter((row) => !row.started).length,
      p50Ms: rank(0.5),
      p95Ms: rank(0.95),
    };
  });
}

async function main() {
  const boot = process.env.ALUNZA_BENCH_BOOT;
  assert.ok(['cold', 'preseeded', 'preseeded-submit'].includes(boot));
  const submitSeries = boot === 'preseeded-submit';
  assert.equal(process.platform, 'linux');
  const guest = process.env.ALUNZA_BENCH_GUEST ?? 'virtualbox';
  assert.ok(['virtualbox', 'qemu'].includes(guest));
  let bootId;
  if (guest === 'qemu') {
    assert.ok(submitSeries);
    bootId = qemuReceiptId(
      fs.readFileSync('/sys/class/dmi/id/sys_vendor', 'utf8'),
      fs.readFileSync('/sys/class/dmi/id/product_uuid', 'utf8'),
    );
    assert.equal(os.availableParallelism(), 1);
  } else {
    assert.equal(
      fs.readFileSync('/sys/class/dmi/id/product_name', 'utf8').trim(),
      'VirtualBox',
    );
  }
  assert.deepEqual(fs.readdirSync('/sys/class/net'), ['lo']);
  for (const variable of [
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_API_VERSION',
  ])
    assert.ok(!process.env[variable]);
  if (guest === 'qemu') {
    assert.equal(
      cli('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'),
      'unix:///var/run/docker.sock',
    );
  }
  assert.equal(cli('ps', '-aq'), '');
  const root = '/run/runner-dist';
  const { execute, DockerAdapter } = await import(
    root + '/packages/runner/dist/index.js'
  );
  const { imageIdentity, command, OWNER_LABEL } = await import(
    root + '/infra/runner/capsule.mjs'
  );
  const { localDockerEngine } = await import(
    root + '/infra/runner/docker-engine.mjs'
  );
  const { runnerFixtures } = await import(root + '/tests/runner/fixtures.mjs');
  const fixture = runnerFixtures.find((f) => f.id === 'sync-json-success');
  assert.equal(fixture.tests.length, 1);
  assert.equal(fixture.tests[0].visibility, 'visible');
  const hidden = {
    ...fixture.tests[0],
    visibility: 'hidden',
    id: 'hidden-2',
    args: [5, 3],
    expected: { sum: 8 },
  };
  let attempts = 0,
    errors = 0;
  const recentAudited = [];
  const twoCaseSeries = [];
  const guestStart = performance.now();
  if (guest === 'qemu') {
    const engine = await localDockerEngine(command, AbortSignal.timeout(5000));
    const info = await engine.request('GET', '/info', { timeoutMs: 5000 });
    assert.equal(info.status, 200);
    assert.equal(info.data.NCPU, 1);
    assert.equal(info.data.CgroupVersion, '2');
    assert.equal(await imageIdentity(), imageId);
    // The host timestamps this serial line and matches bootId to QMP query-uuid
    // and query-kvm. Neither this marker nor DMI certifies the accelerator.
    emit('READY', { guest, bootId, image: imageId });
  }
  emit('BEGIN', {
    boot,
    ...(bootId && { guest, bootId }),
    pid: process.pid,
    kernel: require('node:os').release(),
    clock: 'guest monotonic ms',
    serialPerMode: submitSeries ? 0 : 50,
    c4PerMode: submitSeries ? 0 : 50,
    twoCaseSubmit: submitSeries ? 50 : 3,
    fixture: fixture.id,
    image: imageId,
  });
  async function run(mode, group, index, wave = null) {
    const id = randomUUID();
    const tests =
      submitSeries || group === 'two-case'
        ? [...fixture.tests, hidden]
        : fixture.tests;
    const input = {
      executionId: id,
      requestId: 'offline-latency',
      exerciseVersionId: 'synthetic',
      testsVersion: 'v1',
      mode,
      entrypoint: 'solve',
      code: fixture.code,
      tests,
    };
    const events = [];
    const lookup = performance.now();
    assert.equal(await imageIdentity(), imageId);
    const start = performance.now();
    const adapter = new DockerAdapter({
      image: imageId,
      observeTiming(event) {
        events.push({ ...event, end: performance.now() });
      },
    });
    const result = await execute(input, adapter);
    const end = performance.now();
    const timing = breakdown(events, end - start, tests.length);
    const grants =
      result.evidence.cgroups.length === tests.length &&
      result.evidence.cgroups.every(
        (c) =>
          c['memory.max'] === '134217728' &&
          c['memory.swap.max'] === '0' &&
          c['pids.max'] === '32' &&
          c['cpu.max'] === '100000 100000',
      );
    return {
      id,
      start,
      end,
      data: {
        group,
        mode,
        index,
        wave,
        concurrency: group === 'c4' ? 4 : 1,
        caseCount: tests.length,
        diagnosis: result.diagnosisCode,
        reason: result.terminationReason,
        ok:
          result.diagnosisCode === 'SUCCESS' &&
          result.allRequiredPassed &&
          grants &&
          result.evidence.image === imageId,
        cleanupVerified: result.evidence.cleanupVerified,
        imageIdentityMs: round(start - lookup),
        executeMs: round(end - start),
        runtimeMs: round(result.runtimeMs),
        ...(bootId && { caseTimings: capsuleTimings(events, tests) }),
        ...timing,
      },
    };
  }
  function audit(sample) {
    const { id, start, data } = sample;
    const begin = performance.now();
    const auditAbsent =
      cli('ps', '-aq', '--filter', 'label=org.alunza.execution=' + id) === '';
    const finish = performance.now();
    data.auditAbsent = auditAbsent;
    data.auditCliMs = round(finish - begin);
    data.comparableMs = data.group === 'c4' ? null : round(finish - start);
    data.ok = data.ok && auditAbsent && data.cleanupVerified && data.complete;
    if (bootId && data.group === 'two-case-series') twoCaseSeries.push(data);
    attempts++;
    if (!data.ok) errors++;
    emit('SAMPLE', data);
    if (!data.cleanupVerified || !auditAbsent)
      throw new Error('UNCERTAIN_CLEANUP');
    recentAudited.push(id);
    if (recentAudited.length > 12) recentAudited.shift();
  }
  if (submitSeries) {
    await run('SUBMIT', 'two-case-first', 1).then(audit);
  } else {
    await run(
      'RUN',
      boot === 'cold' ? 'cold-first' : 'preseeded-first',
      1,
    ).then(audit);
  }
  const engine = await localDockerEngine(command, AbortSignal.timeout(5000));
  const info = await engine.request('GET', '/info', { timeoutMs: 5000 });
  assert.equal(info.status, 200);
  emit('ENGINE', {
    server: info.data.ServerVersion,
    storage: info.data.Driver,
    cgroup: info.data.CgroupVersion,
    cgroupDriver: info.data.CgroupDriver,
    runtime: info.data.DefaultRuntime,
    cpu: info.data.NCPU,
    mem: info.data.MemTotal,
    node: process.version,
  });
  if (submitSeries) {
    emit('GROUP', { group: 'two-case-series', mode: 'SUBMIT', perMode: 50 });
    for (let i = 1; i <= 50; i++)
      await run('SUBMIT', 'two-case-series', i).then(audit);
  } else if (boot === 'preseeded') {
    const order = (i) => (i % 2 ? ['RUN', 'SUBMIT'] : ['SUBMIT', 'RUN']);
    emit('GROUP', { group: 'serial', modes: 2, perMode: 50 });
    for (let i = 1; i <= 50; i++)
      for (const mode of order(i)) await run(mode, 'serial', i).then(audit);
    emit('GROUP', {
      group: 'c4',
      modes: 2,
      perMode: 50,
      lastWave: 2,
      audits: 'after wave',
    });
    for (let first = 1; first <= 50; first += 4) {
      const wave = (first - 1) / 4 + 1;
      for (const mode of order(wave)) {
        const width = Math.min(4, 51 - first);
        const samples = await Promise.all(
          Array.from({ length: width }, (_, i) =>
            run(mode, 'c4', first + i, wave),
          ),
        );
        for (const sample of samples) {
          sample.data.concurrency = width;
          audit(sample);
        }
      }
    }
    for (let i = 1; i <= 3; i++) await run('SUBMIT', 'two-case', i).then(audit);
    // Identical ownership + execution selectors and actual, independent read-backs. Always audit a retired case.
    for (let i = 1; i <= 12; i++) {
      const labels = [
        OWNER_LABEL,
        'org.alunza.execution=' + recentAudited[i - 1],
      ];
      const query =
        '/containers/json?all=true&filters=' +
        encodeURIComponent(JSON.stringify({ label: labels }));
      const order = i % 2 ? ['cli', 'api'] : ['api', 'cli'];
      const pair = { index: i, order: order.join('-') },
        ids = {};
      for (const source of order) {
        const start = performance.now();
        if (source === 'api') {
          const response = await engine.request('GET', query, {
            timeoutMs: 5000,
          });
          assert.equal(response.status, 200);
          assert.ok(Array.isArray(response.data));
          ids.api = response.data.map((c) => c.Id).sort();
        } else {
          const list = cli(
            'ps',
            '-aq',
            '--no-trunc',
            '--filter',
            'label=' + labels[0],
            '--filter',
            'label=' + labels[1],
          );
          ids.cli = list ? list.split(/\s+/).sort() : [];
        }
        pair[source + 'Ms'] = round(performance.now() - start);
      }
      pair.match = JSON.stringify(ids.api) === JSON.stringify(ids.cli);
      pair.absent = ids.api.length === 0 && ids.cli.length === 0;
      emit('AUDIT_PAIR', pair);
      assert.ok(pair.match && pair.absent);
    }
  }
  assert.equal(cli('ps', '-aq'), '');
  emit('END', {
    boot,
    attempts,
    errors,
    elapsedMs: round(performance.now() - guestStart),
    finalContainers: 0,
    ...(bootId && { capsules: capsuleStartPercentiles(twoCaseSeries) }),
  });
  if (errors) process.exitCode = 1;
}

module.exports = {
  breakdown,
  unionDuration,
  capsuleTimings,
  capsuleStartPercentiles,
  qemuReceiptId,
};
if (require.main === module)
  main().catch((e) => {
    emit('FAILED', {
      category:
        e.message === 'UNCERTAIN_CLEANUP'
          ? 'UNCERTAIN_CLEANUP'
          : 'PROFILE_FAILED',
    });
    process.exitCode = 2;
  });
