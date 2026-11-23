#!/usr/bin/env node
'use strict';
// Private local A/B: cold RUN8/SUBMIT8, one sample per image/mode. No p95 claim.
// Same ALUNZA_SMOKE_* engine/runtime/PID/boundary variables as the limits smoke;
// replace ALUNZA_SMOKE_IMAGE with ALUNZA_CASE_COST_BASELINE_IMAGE and
// ALUNZA_CASE_COST_CANDIDATE_IMAGE, both immutable local sha256 IDs. Each image
// must bake ALUNZA_RUNNER_PROFILE=case-cost-v1 and the matching optimization arm.
// ALUNZA_CASE_COST_PROFILE=off compares normal images without profiling instead;
// the report keeps that scope explicit and never invents missing phase timings.
// Fixed synthetic data runs ONLY inside capsules; never on this host process.
async function main() {
  const report = {
    protocol: 'CASE_COST_AB_V1',
    status: 'FAILED',
    scope: 'LOCAL_COLD_DIAGNOSTIC_NO_API_P95_OR_VM_ACCEPTANCE',
    samplesPerArmMode: 1,
    attempts: [],
  };
  const gate = (ok, code) => {
    if (!ok) {
      const error = new Error(code);
      error.smokeCode = code;
      throw error;
    }
  };
  let cleanup, engine, context;
  const executions = new Set();
  try {
    gate(process.platform === 'linux', 'LOCAL_LINUX_REQUIRED');
    const { readFile, readlink, realpath, stat } = require('node:fs/promises');
    const { randomUUID } = require('node:crypto');
    const { posix } = require('node:path');
    const env = process.env,
      signal = AbortSignal.timeout(180000);
    gate(
      [undefined, 'on', 'off'].includes(env.ALUNZA_CASE_COST_PROFILE),
      'INVALID_PROFILE_SELECTION',
    );
    const profileRequired = env.ALUNZA_CASE_COST_PROFILE !== 'off';
    report.profileRequired = profileRequired;
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
      pid = Number(env.ALUNZA_SMOKE_DOCKER_PID);
    const images = {
      baseline: env.ALUNZA_CASE_COST_BASELINE_IMAGE,
      candidate: env.ALUNZA_CASE_COST_CANDIDATE_IMAGE,
    };
    gate(
      /^\/sys\/fs\/cgroup\/[a-zA-Z0-9_./:-]+$/.test(boundary ?? '') &&
        posix.normalize(boundary) === boundary &&
        !boundary.endsWith('/'),
      'BOUNDARY_REQUIRED',
    );
    gate(
      /^[a-zA-Z0-9:_-]{1,128}$/.test(engineId ?? '') &&
        Number.isSafeInteger(pid) &&
        pid > 1 &&
        Object.values(images).every((image) =>
          /^sha256:[a-f0-9]{64}$/.test(image ?? ''),
        ) &&
        images.baseline !== images.candidate,
      'DISTINCT_PINNED_IDENTITIES_REQUIRED',
    );
    const read = async (file) => (await readFile(file, 'utf8')).trim();
    const startTime = async () =>
      (await read(`/proc/${pid}/stat`)).split(') ').at(-1).split(' ')[19];
    const daemonStart = await startTime(),
      args = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
    gate(
      /^\d+$/.test(daemonStart ?? '') &&
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
    const { inspectDockerRuntime, validateDockerRuntimeConfig } =
      await import('../../infra/runner/docker-runtime.mjs');
    const runner = await import('../../packages/runner/dist/index.js');
    const { caseCostObservationSchema } =
      await import('../../packages/runner/dist/remote-result.js');
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
          (await startTime()) === daemonStart,
        'ENGINE_IDENTITY_CHANGED',
      );
      for (const current of [process.pid, pid]) {
        const group = await read(`/proc/${current}/cgroup`),
          prefix = `0::${boundary.slice('/sys/fs/cgroup'.length)}`;
        gate(
          !group.includes('\n') &&
            (group === prefix || group.startsWith(prefix + '/')),
          'PID_OUTSIDE_ENVELOPE',
        );
      }
      for (const [name, value] of Object.entries({
        'memory.max': '2147483648',
        'memory.swap.max': '0',
        'cpu.max': '100000 100000',
      }))
        gate(
          (await read(`${boundary}/${name}`)) === value,
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
    gate(identity.engineId === engineId, 'RUNTIME_ENGINE_MISMATCH');
    for (const [arm, image] of Object.entries(images)) {
      const inspected = await get(`/images/${encodeURIComponent(image)}/json`);
      const environment = inspected.data?.Config?.Env;
      gate(
        inspected.status === 200 &&
          inspected.data?.Id === image &&
          Array.isArray(environment) &&
          (profileRequired
            ? environment
                .filter((value) => value.startsWith('ALUNZA_RUNNER_PROFILE='))
                .join() === 'ALUNZA_RUNNER_PROFILE=case-cost-v1' &&
              environment
                .filter((value) =>
                  value.startsWith('ALUNZA_RUNNER_OPTIMIZATION='),
                )
                .join() === `ALUNZA_RUNNER_OPTIMIZATION=${arm}`
            : !environment.some((value) =>
                /^ALUNZA_RUNNER_(PROFILE|OPTIMIZATION)=/.test(value),
              )),
        'IMAGE_PROFILE_IDENTITY_MISMATCH',
      );
    }
    context = {
      ...identity,
      provider: 'docker',
      runnerVersion: runner.RUNNER_VERSION,
    };
    report.candidate = { ...context, images, boundary, node: process.version };
    // Balanced arm order, still only an exploratory sample, never a percentile.
    for (const [arm, mode] of [
      ['baseline', 'RUN'],
      ['candidate', 'RUN'],
      ['candidate', 'SUBMIT'],
      ['baseline', 'SUBMIT'],
    ]) {
      const executionId = randomUUID(),
        image = images[arm];
      executions.add(executionId);
      const record = {
        arm,
        mode,
        image,
        executionId,
        status: 'FAILED',
        capsules: [],
        cases: [],
      };
      report.attempts.push(record);
      try {
        const adapter = new runner.DockerAdapter({
          image,
          runtime: context,
          expectedBoundary: boundary,
          deadlineMs: Date.now() + 30000,
          beforeSend: async () => {
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
          },
        });
        const measured = {
          provider: 'docker',
          close: () => adapter.close(),
          execute: async (input, callSignal) => {
            const entry = {
              ordinal: record.cases.length + 1,
              budgetMs: input.budgetMs,
              outputRemaining: input.outputRemaining,
            };
            record.cases.push(entry);
            const response = await adapter.execute(input, callSignal);
            const parsed = caseCostObservationSchema.safeParse(
              response.packet?.caseCost,
            );
            entry.profile = parsed.success ? parsed.data : null;
            entry.profileStatus = parsed.success
              ? parsed.data.status
              : 'UNAVAILABLE';
            entry.bridgeRuntimeMs = Number.isFinite(response.packet?.runtimeMs)
              ? response.packet.runtimeMs
              : null;
            entry.hostStartAttachMs = response.programWallMs;
            entry.containerWallMs = response.containerWallMs;
            entry.cleanupVerified = response.cleanupVerified;
            entry.kernelBoundary = response.kernelBoundary;
            entry.oomKilled = response.oomKilled;
            // Final accumulated cgroup counters include bridge pre-input startup;
            // this is NOT a worker-only delta and never a source of pass/fail.
            entry.cpuFinal = Object.fromEntries(
              (response.packet?.cgroup?.['cpu.stat'] ?? '')
                .split('\n')
                .flatMap((line) => {
                  const match =
                    /^(usage_usec|user_usec|system_usec|nr_periods|nr_throttled|throttled_usec) (\d+)$/.exec(
                      line,
                    );
                  return match && Number.isSafeInteger(Number(match[2]))
                    ? [[match[1], Number(match[2])]]
                    : [];
                }),
            );
            return response;
          },
        };
        const result = await runner.execute(
          {
            executionId,
            requestId: randomUUID(),
            exerciseVersionId: 'case-cost-fixed-sum',
            testsVersion: 'v1',
            mode,
            entrypoint: 'solve',
            code: 'module.exports.solve=(a,b)=>({sum:a+b});',
            tests: Array.from({ length: 8 }, (_, index) => ({
              id: `case-${index + 1}`,
              visibility: mode === 'SUBMIT' && index > 0 ? 'hidden' : 'visible',
              args: [index + 1, 7],
              expected: { sum: index + 8 },
            })),
          },
          measured,
          signal,
        );
        record.result = {
          diagnosis: result.diagnosisCode,
          reason: result.terminationReason,
          infrastructure: result.infrastructureStatus,
          allRequiredPassed: result.allRequiredPassed,
          runtimeMs: result.runtimeMs,
          lifecycleMs: result.lifecycleMs,
          outputBytes: result.outputBytes,
          visibleCount: result.visibleTestResults.length,
          hiddenCount: result.privateTestResults.length,
          cleanupVerified: result.evidence.cleanupVerified,
        };
        record.completeEightCases =
          result.diagnosisCode === 'SUCCESS' &&
          result.allRequiredPassed &&
          record.cases.length === 8 &&
          result.runtimeMs < 3000 &&
          result.outputBytes <= 65536;
        record.profileComplete =
          record.cases.length > 0 &&
          record.cases.every((item) => item.profileStatus === 'COMPLETE');
        record.status =
          record.completeEightCases &&
          (!profileRequired || record.profileComplete) &&
          result.evidence.cleanupVerified
            ? 'PASSED'
            : 'MEASURED_WITH_FAILURES';
      } catch (error) {
        record.failure = error.smokeCode ?? 'ATTEMPT_OPERATION_FAILED';
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
    report.status =
      report.attempts.length === 4 &&
      report.attempts.every((item) => item.status === 'PASSED')
        ? 'PASSED'
        : 'MEASURED_WITH_FAILURES';
  } catch (error) {
    report.failure = error.smokeCode ?? 'AB_OPERATION_FAILED';
  } finally {
    const checks = [];
    if (engine && context)
      for (const executionId of executions)
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
