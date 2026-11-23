#!/usr/bin/env node
'use strict';
// One fixed local regression suite, no CLI. Uses ALUNZA_SMOKE_* exactly as
// linux-limits-focused.cjs. All programs run in new capsules, never on this host.
const selected = [
  'sync-json-success',
  'json-arguments',
  'json-argument-prototype',
  'return-nul-preserved',
  'syntax',
  'exception',
  'assertion',
  'promise-null-prototype',
  'non-json-map-prototype',
  'getter-return',
  'cyclic-return',
  'mutated-serializer',
  'fake-stdout-verdict',
  'forged-return-known-gap',
  'constructor-escape-denied',
  'guest-no-host-globals',
  'case-state-isolation',
  'hidden-projection',
];
function selectFixtures(available) {
  const fixtures = selected.map((id) => {
    const matches = available.filter((item) => item.id === id);
    if (matches.length !== 1)
      throw new Error('Missing or duplicate fixed fixture');
    return matches[0];
  });
  fixtures.push({
    id: 'finite-cpu-200000',
    expected: 'SUCCESS',
    code: 'module.exports.solve=()=>{let n=0;for(let i=0;i<200000;i++)n=(n+i)%1000003;return n;};',
    tests: [
      { id: 'visible-cpu', visibility: 'visible', args: [], expected: 840003 },
    ],
  });
  const loop = available.find((item) => item.id === 'infinite-loop');
  if (!loop) throw new Error('Missing cancellation fixture');
  fixtures.push({
    ...loop,
    id: 'cancel-running-worker',
    cancel: true,
    expected: 'UNKNOWN',
    reason: 'CANCELLED',
  });
  return fixtures;
}
function assessFixture(fixture, result, publicView) {
  const reason =
    fixture.reason ??
    {
      SUCCESS: 'COMPLETED',
      SYNTAX_ERROR: 'STUDENT_SYNTAX',
      RUNTIME_ERROR: 'STUDENT_EXCEPTION',
      FAILED_TEST: 'ASSERTION_FAILED',
    }[fixture.expected];
  const hidden = fixture.tests.filter(
    (item) => item.visibility === 'hidden',
  ).length;
  const visible = fixture.tests.length - hidden;
  const privateOk =
    !Object.hasOwn(publicView, 'privateTestResults') &&
    !Object.hasOwn(publicView, 'evidence') &&
    (!fixture.privateSentinel ||
      (!JSON.stringify(publicView).includes(fixture.privateSentinel) &&
        publicView.visibleTestResults.length === visible &&
        result.privateTestResults.length === hidden &&
        publicView.hiddenChecksPassed === true));
  const limits = {
    'memory.max': '134217728',
    'memory.swap.max': '0',
    'pids.max': '32',
    'cpu.max': '100000 100000',
  };
  const controlsOk =
    result.evidence.cgroups.length === fixture.tests.length &&
    result.evidence.cgroups.every((row) =>
      Object.entries(limits).every(([key, value]) => row[key] === value),
    );
  const outputOk =
    Number.isSafeInteger(result.outputBytes) &&
    result.outputBytes >= 0 &&
    result.outputBytes <= 65536 &&
    (fixture.expectedStdout === undefined ||
      result.visibleTestResults.every(
        (item) => item.stdout === fixture.expectedStdout,
      ));
  const diagnosisOk =
    result.diagnosisCode === fixture.expected &&
    result.terminationReason === reason &&
    result.allRequiredPassed === (fixture.expected === 'SUCCESS');
  return {
    privateOk,
    controlsOk,
    outputOk,
    diagnosisOk,
    pass:
      privateOk &&
      controlsOk &&
      outputOk &&
      diagnosisOk &&
      result.infrastructureStatus === 'OK' &&
      result.runtimeMs >= 0 &&
      result.runtimeMs < 3000 &&
      result.evidence.cleanupVerified,
  };
}

// Observes the trusted Node worker process, not its first student instruction.
// Bind its executable inode to PID1's Node from the already pinned capsule image.
function observedNodeWorker({
  status,
  executable,
  argv,
  parentPid,
  nodeIdentity,
  pinnedNode,
}) {
  const caps = status
    .split('\n')
    .filter((line) => /^Cap(Inh|Prm|Eff|Bnd|Amb):/.test(line));
  return (
    executable === '/usr/local/bin/node' &&
    pinnedNode.path === executable &&
    nodeIdentity.dev === pinnedNode.dev &&
    nodeIdentity.ino === pinnedNode.ino &&
    argv[0] === executable &&
    argv.at(-1) === '/opt/alunza/worker.cjs' &&
    argv
      .slice(1, -1)
      .every(
        (arg) =>
          arg.startsWith('--') &&
          !/^--(?:eval|print|require|import)(?:=|$)/.test(arg),
      ) &&
    new RegExp(`^PPid:\\s+${parentPid}$`, 'm').test(status) &&
    /^State:\s+[RSD]\b/m.test(status) &&
    /^NoNewPrivs:\s+1$/m.test(status) &&
    /^Uid:\s+10001\s+10001\s+10001\s+10001$/m.test(status) &&
    caps.length === 5 &&
    caps.every((line) => /:\s+0+$/.test(line))
  );
}

async function main() {
  const report = {
    protocol: 'CASE_COST_REGRESSIONS_V1',
    status: 'FAILED',
    scope: 'LOCAL_FIXED_REGRESSIONS_NO_API_P95_OR_VM_ACCEPTANCE',
    fixtures: [],
  };
  const gate = (ok, code) => {
    if (!ok) {
      const error = new Error(code);
      error.smokeCode = code;
      throw error;
    }
  };
  let engine, cleanup, context;
  const owned = new Set();
  try {
    gate(process.platform === 'linux', 'LOCAL_LINUX_REQUIRED');
    gate(process.argv.length === 2, 'NO_ARGUMENTS_ALLOWED');
    const { readFile, readlink, realpath, stat } = require('node:fs/promises');
    const { randomUUID, createHash } = require('node:crypto');
    const { posix } = require('node:path');
    const env = process.env,
      signal = AbortSignal.timeout(180000);
    gate(
      /^unix:\/\/\/[^/][a-zA-Z0-9_./:-]*$/.test(env.DOCKER_HOST ?? '') &&
        !env.DOCKER_CONTEXT &&
        !env.DOCKER_TLS &&
        !env.DOCKER_TLS_VERIFY,
      'EXPLICIT_LOCAL_SOCKET_REQUIRED',
    );
    const socket = env.DOCKER_HOST.slice(7);
    gate(
      posix.normalize(socket) === socket &&
        !['/run/docker.sock', '/var/run/docker.sock'].includes(
          await realpath(socket),
        ) &&
        (await stat(socket)).isSocket(),
      'PRIVATE_SOCKET_REQUIRED',
    );
    const boundary = env.ALUNZA_SMOKE_BOUNDARY,
      engineId = env.ALUNZA_SMOKE_ENGINE_ID,
      image = env.ALUNZA_SMOKE_IMAGE,
      pid = Number(env.ALUNZA_SMOKE_DOCKER_PID);
    gate(
      /^\/sys\/fs\/cgroup\/[a-zA-Z0-9_./:-]+$/.test(boundary ?? '') &&
        posix.normalize(boundary) === boundary &&
        !boundary.endsWith('/'),
      'BOUNDARY_REQUIRED',
    );
    gate(
      /^[a-zA-Z0-9:_-]{1,128}$/.test(engineId ?? '') &&
        /^sha256:[a-f0-9]{64}$/.test(image ?? '') &&
        Number.isSafeInteger(pid) &&
        pid > 1,
      'PINNED_IDENTITIES_REQUIRED',
    );
    const read = async (file) => (await readFile(file, 'utf8')).trim();
    const pidStart = async () =>
      (await read(`/proc/${pid}/stat`)).split(') ').at(-1).split(' ')[19];
    const started = await pidStart(),
      args = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
    gate(
      /^\d+$/.test(started ?? '') &&
        posix.basename(await readlink(`/proc/${pid}/exe`)) === 'dockerd' &&
        args.some(
          (arg, index) =>
            arg === `--host=${env.DOCKER_HOST}` ||
            (['-H', '--host'].includes(arg) &&
              args[index + 1] === env.DOCKER_HOST),
        ),
      'DOCKER_PID_SOCKET_MISMATCH',
    );
    const capsule = await import('../../infra/runner/capsule.mjs');
    const { localDockerEngine } =
      await import('../../infra/runner/docker-engine.mjs');
    const { validateDockerRuntimeConfig, inspectDockerRuntime } =
      await import('../../infra/runner/docker-runtime.mjs');
    const runner = await import('../../packages/runner/dist/index.js');
    const { runnerFixtures } = await import('./fixtures.mjs');
    const fixtures = selectFixtures(runnerFixtures);
    ({ cleanupBoundDockerExecution: cleanup } =
      await import('../../infra/runner/prepared-capsule.mjs'));
    const runtime = validateDockerRuntimeConfig({
      runtime: env.ALUNZA_SMOKE_RUNTIME,
      runtimeName: env.ALUNZA_SMOKE_RUNTIME_NAME,
      runtimeVersion: env.ALUNZA_SMOKE_RUNTIME_VERSION,
      runtimeSha256: env.ALUNZA_SMOKE_RUNTIME_SHA256,
      strategy: 'cold',
    });
    engine = await localDockerEngine(capsule.command, signal);
    gate(engine.endpoint === env.DOCKER_HOST, 'ENGINE_ENDPOINT_CHANGED');
    const get = (route, callSignal = signal) =>
      engine.request('GET', route, { signal: callSignal, timeoutMs: 10000 });
    const envelope = async () => {
      const info = await get('/info');
      gate(
        info.status === 200 &&
          info.data?.ID === engineId &&
          info.data.OSType === 'linux' &&
          info.data.CgroupVersion === '2' &&
          info.data.CgroupDriver === 'systemd' &&
          (await pidStart()) === started,
        'ENGINE_IDENTITY_CHANGED',
      );
      for (const currentPid of [process.pid, pid]) {
        const group = await read(`/proc/${currentPid}/cgroup`),
          prefix = `0::${boundary.slice('/sys/fs/cgroup'.length)}`;
        gate(
          !group.includes('\n') &&
            (group === prefix || group.startsWith(prefix + '/')),
          'PID_OUTSIDE_ENVELOPE',
        );
      }
      for (const [file, value] of Object.entries({
        'cpu.max': '100000 100000',
        'memory.max': '2147483648',
        'memory.swap.max': '0',
      }))
        gate(
          (await read(`${boundary}/${file}`)) === value,
          'OUTER_LIMIT_MISMATCH',
        );
    };
    const empty = async (callSignal = signal) => {
      const list = await get('/containers/json?all=true', callSignal);
      return (
        list.status === 200 &&
        Array.isArray(list.data) &&
        list.data.length === 0
      );
    };
    await envelope();
    gate(await empty(), 'PRIVATE_ENGINE_MUST_BE_EMPTY');
    const identity = await inspectDockerRuntime(engine, runtime, signal);
    gate(
      identity.engineId === engineId &&
        (await capsule.imageIdentity(image, signal)) === image,
      'RUNTIME_IMAGE_MISMATCH',
    );
    context = {
      ...identity,
      provider: 'docker',
      image,
      runnerVersion: runner.RUNNER_VERSION,
    };
    report.candidate = {
      ...context,
      boundary,
      fixturesSha256: createHash('sha256')
        .update(
          await readFile(require('node:path').join(__dirname, 'fixtures.mjs')),
        )
        .digest('hex'),
    };
    for (const fixture of fixtures) {
      const executionId = randomUUID(),
        record = {
          fixture: fixture.id,
          executionId,
          status: 'FAILED',
          capsules: [],
        };
      owned.add(executionId);
      report.fixtures.push(record);
      const cancel = new AbortController();
      let finished = false,
        watcher;
      try {
        const beforeSend = async () => {
          await envelope();
          const filters = encodeURIComponent(
            JSON.stringify({
              label: [
                'org.alunza.runner=alunza-edu-laboratorio',
                `org.alunza.execution=${executionId}`,
              ],
            }),
          );
          const list = await get(
            `/containers/json?all=true&filters=${filters}`,
          );
          gate(
            list.status === 200 &&
              Array.isArray(list.data) &&
              list.data.length === 1 &&
              /^[a-f0-9]{64}$/.test(list.data[0].Id) &&
              !record.capsules.includes(list.data[0].Id),
            'OWNED_FRESH_CAPSULE_REQUIRED',
          );
          record.capsules.push(list.data[0].Id);
        };
        if (fixture.cancel)
          watcher = (async () => {
            const until = Date.now() + 10000;
            while (!finished && !signal.aborted && Date.now() < until) {
              for (const id of record.capsules) {
                const info = await get(`/containers/${id}/json`);
                const parent = info.data?.State?.Pid;
                if (
                  info.status !== 200 ||
                  info.data?.Id !== id ||
                  !info.data.State.Running ||
                  !Number.isSafeInteger(parent) ||
                  parent <= 0
                )
                  continue;
                const parentNode = await stat(`/proc/${parent}/exe`, {
                  bigint: true,
                });
                const pinnedNode = {
                  path: await readlink(`/proc/${parent}/exe`),
                  dev: parentNode.dev,
                  ino: parentNode.ino,
                };
                const children = (
                  await read(`/proc/${parent}/task/${parent}/children`)
                )
                  .split(/\s+/)
                  .filter((value) => /^[1-9]\d*$/.test(value));
                for (const child of children.slice(0, 32)) {
                  const observed = await Promise.all([
                    read(`/proc/${child}/status`),
                    readlink(`/proc/${child}/exe`),
                    readFile(`/proc/${child}/cmdline`, 'utf8'),
                    stat(`/proc/${child}/exe`, { bigint: true }),
                  ]).catch(() => null);
                  if (!observed) continue;
                  const [status, executable, cmdline, nodeIdentity] = observed;
                  if (
                    observedNodeWorker({
                      status,
                      executable,
                      argv: cmdline.split('\0').filter(Boolean),
                      parentPid: parent,
                      nodeIdentity,
                      pinnedNode,
                    })
                  ) {
                    record.seenRunningWorker = true;
                    record.cancellationObservation =
                      'TRUSTED_NODE_WORKER_NOT_GUEST_INSTRUCTION';
                    cancel.abort();
                    return;
                  }
                }
              }
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
          })().catch(() => {
            record.cancelObservationFailed = true;
          });
        const result = await runner.execute(
          {
            executionId,
            requestId: randomUUID(),
            exerciseVersionId: 'fixed-regressions',
            testsVersion: 'case-cost-v1',
            mode: fixture.mode ?? 'RUN',
            entrypoint: 'solve',
            code: fixture.code,
            tests: fixture.tests,
          },
          new runner.DockerAdapter({
            image,
            runtime: context,
            expectedBoundary: boundary,
            deadlineMs: Date.now() + 30000,
            beforeSend,
          }),
          AbortSignal.any([signal, cancel.signal]),
        );
        finished = true;
        await watcher;
        record.result = {
          diagnosis: result.diagnosisCode,
          reason: result.terminationReason,
          infrastructure: result.infrastructureStatus,
          allRequiredPassed: result.allRequiredPassed,
          runtimeMs: result.runtimeMs,
          outputBytes: result.outputBytes,
          visibleCount: result.visibleTestResults.length,
          hiddenCount: result.privateTestResults.length,
          initialCleanupVerified: result.evidence.cleanupVerified,
        };
        if (fixture.cancel)
          record.checks = {
            pass:
              record.seenRunningWorker === true &&
              result.diagnosisCode === 'UNKNOWN' &&
              result.terminationReason === 'CANCELLED' &&
              !result.allRequiredPassed,
          };
        else
          record.checks = assessFixture(
            fixture,
            result,
            runner.publicResult(result),
          );
        record.status = record.checks.pass ? 'PASSED' : 'FAILED';
      } catch (error) {
        record.failure = error.smokeCode ?? 'FIXTURE_OPERATION_FAILED';
      } finally {
        finished = true;
        await watcher;
        const cleanupSignal = AbortSignal.timeout(10000);
        record.cleanupVerified = (
          await cleanup(executionId, context, cleanupSignal).catch(() => ({
            cleanupVerified: false,
          }))
        ).cleanupVerified;
        for (const id of record.capsules)
          record.cleanupVerified &&=
            (await get(`/containers/${id}/json`, cleanupSignal)).status === 404;
        record.cleanupVerified &&= await empty(cleanupSignal);
        if (!record.cleanupVerified) record.status = 'FAILED';
      }
      if (!record.cleanupVerified) break;
    }
    report.total = report.fixtures.length;
    report.passed = report.fixtures.filter(
      (item) => item.status === 'PASSED',
    ).length;
    report.status =
      report.total === 20 && report.passed === 20 ? 'PASSED' : 'FAILED';
  } catch (error) {
    report.failure = error.smokeCode ?? 'REGRESSION_OPERATION_FAILED';
  } finally {
    const checks = [];
    if (engine && context)
      for (const executionId of owned)
        checks.push(
          (
            await cleanup(
              executionId,
              context,
              AbortSignal.timeout(10000),
            ).catch(() => ({ cleanupVerified: false }))
          ).cleanupVerified,
        );
    report.cleanupVerified = checks.every(Boolean);
    if (!report.cleanupVerified) report.status = 'FAILED';
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'PASSED' ? 0 : 1;
  }
}
module.exports = { selectFixtures, assessFixture, observedNodeWorker };
if (require.main === module) void main();
