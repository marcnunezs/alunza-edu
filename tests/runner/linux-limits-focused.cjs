#!/usr/bin/env node
'use strict';
// Independent local focus, not a replacement or pass for the eight-case smoke.
// Same explicit ALUNZA_SMOKE_* variables and private Linux engine as
// linux-controls-smoke.cjs. No services, pulls, global cleanup or host workloads.
async function main() {
  const report = {
    protocol: 'LINUX_LIMITS_FOCUSED_V1',
    status: 'FAILED',
    scope: 'INDEPENDENT_KERNEL_FOCUS_NO_API_VM_OR_PERFORMANCE_ACCEPTANCE',
    scenarios: [],
  };
  const gate = (ok, code) => {
    if (!ok) {
      const error = new Error(code);
      error.smokeCode = code;
      throw error;
    }
  };
  let engine, capsule, cleanup, context;
  const owned = new Set(),
    ids = new Set();
  try {
    gate(process.platform === 'linux', 'LOCAL_LINUX_REQUIRED');
    // Even trusted module imports occur only AFTER rejecting a non-Linux host.
    const { readFile, readlink, realpath, stat } = require('node:fs/promises');
    const { randomUUID } = require('node:crypto');
    const { posix } = require('node:path');
    const env = process.env,
      signal = AbortSignal.timeout(120000);
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
    const read = async (path) => (await readFile(path, 'utf8')).trim();
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
    capsule = await import('../../infra/runner/capsule.mjs');
    const { localDockerEngine } =
      await import('../../infra/runner/docker-engine.mjs');
    const { validateDockerRuntimeConfig, inspectDockerRuntime } =
      await import('../../infra/runner/docker-runtime.mjs');
    const runner = await import('../../packages/runner/dist/index.js');
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
    const get = (path, callSignal = signal) =>
      engine.request('GET', path, { signal: callSignal, timeoutMs: 10000 });
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
        const group = await read(`/proc/${currentPid}/cgroup`);
        const prefix = `0::${boundary.slice('/sys/fs/cgroup'.length)}`;
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
    report.candidate = { ...context, boundary };
    for (const scenario of [
      'output-aggregate2',
      'memory',
      'descendant-memory',
    ]) {
      const executionId = randomUUID(),
        record = { scenario, executionId, status: 'FAILED', capsules: [] };
      owned.add(executionId);
      report.scenarios.push(record);
      try {
        const deadlineMs = Date.now() + 30000,
          output = scenario === 'output-aggregate2';
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
              !ids.has(list.data[0].Id),
            'OWNED_CAPSULE_REQUIRED',
          );
          ids.add(list.data[0].Id);
          record.capsules.push(list.data[0].Id);
        };
        const options = {
          image,
          runtime: context,
          expectedBoundary: boundary,
          beforeSend,
          deadlineMs,
          signal,
        };
        let native;
        const adapter = output
          ? new runner.DockerAdapter(options)
          : {
              provider: 'docker',
              execute: async (input, callSignal) => {
                native = await capsule.runCapsule(input, {
                  ...options,
                  signal: callSignal,
                  probe: scenario,
                });
                return native;
              },
              close: async () => {},
            };
        const result = await runner.execute(
          {
            executionId,
            requestId: randomUUID(),
            exerciseVersionId: 'fixed-limits-focus',
            testsVersion: 'v1',
            entrypoint: 'solve',
            mode: 'RUN',
            code: output
              ? "module.exports.solve=()=>{console.log('o'.repeat(19999));console.error('e'.repeat(19999));return true;};"
              : 'module.exports.solve=()=>true;',
            tests: Array.from({ length: output ? 2 : 1 }, (_, index) => ({
              id: `case-${index}`,
              visibility: 'visible',
              args: [],
              expected: true,
            })),
          },
          adapter,
          signal,
        );
        const oomKill = /^oom_kill ([1-9]\d*)$/m.exec(
          native?.packet?.cgroup?.['memory.events'] ?? '',
        );
        record.result = {
          diagnosis: result.diagnosisCode,
          reason: result.terminationReason,
          infrastructure: result.infrastructureStatus,
          runtimeMs: result.runtimeMs,
          outputBytes: result.outputBytes,
          outputTruncated: result.outputTruncated,
          cleanupVerified: result.evidence.cleanupVerified,
          oomState: native?.oomKilled ?? false,
          oomKillEvents: oomKill ? Number(oomKill[1]) : 0,
        };
        gate(
          result.infrastructureStatus === 'OK' &&
            result.evidence.cleanupVerified &&
            record.capsules.length === (output ? 2 : 1),
          'EXECUTION_OR_CLEANUP_FAILED',
        );
        if (output)
          gate(
            result.diagnosisCode === 'UNKNOWN' &&
              result.terminationReason === 'OUTPUT_LIMIT' &&
              result.outputBytes === 65536 &&
              result.outputTruncated &&
              result.runtimeMs < 3000 &&
              result.evidence.cgroups.length === 2,
            'AGGREGATE_OUTPUT_GATE',
          );
        else
          gate(
            result.diagnosisCode === 'UNKNOWN' &&
              result.terminationReason === 'MEMORY_LIMIT' &&
              (native.oomKilled || oomKill !== null) &&
              native.kernelBoundary === boundary,
            'NATIVE_OOM_GATE',
          );
        record.status = 'PASSED';
      } catch (error) {
        record.failure = error.smokeCode ?? 'SCENARIO_OPERATION_FAILED';
      } finally {
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
    gate(
      report.scenarios.length === 3 &&
        report.scenarios.every((item) => item.status === 'PASSED'),
      'FOCUSED_GATES_FAILED',
    );
    report.status = 'PASSED';
  } catch (error) {
    report.failure = error.smokeCode ?? 'FOCUS_OPERATION_FAILED';
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
if (require.main === module) void main();
