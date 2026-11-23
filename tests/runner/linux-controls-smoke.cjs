#!/usr/bin/env node
'use strict';

// Manual, bounded Linux guest smoke; never included in Jest discovery.
// Place at <candidate>/tests/runner/ and use the candidate's compiled runner.
// Requires an ALREADY RUNNING, private, empty Docker engine and new capsule image.
// Required environment (no defaults to stock Docker or unconfigured runtimes):
// DOCKER_HOST=unix:///private/path/docker.sock
// ALUNZA_SMOKE_ENGINE_ID, ALUNZA_SMOKE_IMAGE=sha256:<64 hex>
// ALUNZA_SMOKE_RUNTIME=crun|runc, ALUNZA_SMOKE_RUNTIME_NAME,
// ALUNZA_SMOKE_RUNTIME_VERSION, ALUNZA_SMOKE_RUNTIME_SHA256=<64 hex>
// ALUNZA_SMOKE_BOUNDARY=/sys/fs/cgroup/<private executor slice>
// ALUNZA_SMOKE_DOCKER_PID=<local dockerd PID>
// Optional ALUNZA_SMOKE_SCENARIOS: comma-separated names from SCENARIOS below.
// Omit to run all five; every invocation first runs the fixed identity probe.
// Both this Node process and dockerd must already belong to that same envelope.
// stdout: one sanitized JSON report; exit 0 only when every smoke gate passes.
// This fixture ledger is NOT SQL, admission, HTTP close, durability or recovery.
// No API/DB calls, service startup, builds, image pulls, global sweeps or pruning.

const { randomUUID } = require('node:crypto');
const { readFile, readlink, realpath, stat } = require('node:fs/promises');
const { posix } = require('node:path');
const { performance } = require('node:perf_hooks');

const LEAF = Object.freeze({
  'memory.max': '134217728',
  'memory.swap.max': '0',
  'pids.max': '32',
  'cpu.max': '100000 100000',
});
const OUTER = Object.freeze({
  'memory.max': '2147483648',
  'memory.swap.max': '0',
  'cpu.max': '100000 100000',
});
const CID = /^[a-f0-9]{64}$/;
const OWNER = 'alunza-edu-laboratorio';
const PREFIX = 'alunza-laboratorio-runner-';
const SCENARIOS = Object.freeze([
  'cold-run8',
  'cold-submit8',
  'prepared-submit8',
  'watchdog-loop1',
  'output-aggregate8',
]);

function gate(condition, code) {
  if (!condition) {
    const error = new Error(code);
    error.smokeCode = code;
    throw error;
  }
}
function selectScenarios(value) {
  const selected = value === undefined ? [...SCENARIOS] : value.split(',');
  gate(
    selected.length > 0 &&
      new Set(selected).size === selected.length &&
      selected.every((name) => SCENARIOS.includes(name)),
    'INVALID_SCENARIO_SELECTION',
  );
  return selected;
}
function failureCode(error, signal) {
  return typeof error?.smokeCode === 'string' &&
    /^[A-Z][A-Z0-9_]{0,79}$/.test(error.smokeCode)
    ? error.smokeCode
    : signal.aborted
      ? 'SMOKE_CANCELLED_OR_DEADLINE'
      : 'SMOKE_OPERATION_FAILED';
}
async function collectObservation(observation, action, cleanup, signal) {
  observation.status = 'FAILED';
  try {
    await action();
    observation.status = 'PASSED';
  } catch (error) {
    observation.failure = failureCode(error, signal);
  } finally {
    try {
      observation.cleanup = await cleanup();
      observation.cleanupVerified = observation.cleanup.verified === true;
    } catch {
      observation.cleanupVerified = false;
    }
    if (!observation.cleanupVerified) {
      observation.status = 'FAILED';
      observation.failure ??= 'SCENARIO_CLEANUP_NOT_VERIFIED';
      gate(false, 'SCENARIO_CLEANUP_NOT_VERIFIED');
    }
  }
}
const copy = (value) => globalThis.structuredClone(value);
async function controls(path, expected) {
  const observed = {};
  for (const [file, value] of Object.entries(expected)) {
    observed[file] = (await readFile(`${path}/${file}`, 'utf8')).trim();
    gate(observed[file] === value, 'KERNEL_LIMIT_MISMATCH');
  }
  return observed;
}
async function membership(pid, boundary) {
  const value = (await readFile(`/proc/${pid}/cgroup`, 'utf8')).trim();
  const match = /^0::(\/[a-zA-Z0-9_./:-]+)$/.exec(value);
  gate(match && !match[1].split('/').includes('..'), 'PID_CGROUP_INVALID');
  const path = `/sys/fs/cgroup${match[1]}`;
  gate(
    path === boundary || path.startsWith(`${boundary}/`),
    'PID_OUTSIDE_ENVELOPE',
  );
  return path;
}
async function startTime(pid) {
  const value = await readFile(`/proc/${pid}/stat`, 'utf8');
  const ticks = value.slice(value.lastIndexOf(')') + 2).split(' ')[19];
  gate(/^\d+$/.test(ticks ?? ''), 'PID_START_TIME_INVALID');
  return ticks;
}

// Only a private in-memory ledger for testing actual capsule/kernel paths.
// Tokens are local fixture authority and are deliberately excluded from reports.
function fixtureLedger(onPreparedDispatch) {
  const pairs = new Map();
  const assignments = new Map();
  const known = (id) => {
    const pair = pairs.get(id);
    gate(pair, 'FIXTURE_PAIR_UNKNOWN');
    return pair;
  };
  const owned = (id, owner) => {
    const pair = known(id);
    gate(
      pair.ownerToken === owner && Date.parse(pair.leaseExpiresAt) > Date.now(),
      'FIXTURE_AUTHORITY_EXPIRED',
    );
    return pair;
  };
  const slotFor = (pair, resourceId) => {
    const slot = pair.slots.find((item) => item.resourceId === resourceId);
    gate(slot, 'FIXTURE_SLOT_UNKNOWN');
    return slot;
  };
  return {
    pairs,
    port: {
      async reservePair(context, ownerToken) {
        gate(pairs.size === 0, 'FIXTURE_SINGLE_PAIR_ONLY');
        const expiry = new Date(Date.now() + 60000).toISOString();
        const pair = {
          pairId: randomUUID(),
          context: copy(context),
          creatorToken: ownerToken,
          ownerToken,
          leaseExpiresAt: expiry,
          expiresAt: expiry,
          state: 'PREPARING',
          executionId: null,
          recoveryOnly: false,
          slots: Array.from({ length: 2 }, () => {
            const resourceId = randomUUID();
            return {
              resourceId,
              name: PREFIX + resourceId,
              containerId: null,
              creationState: 'PREPARED',
              cleanupState: 'PENDING',
            };
          }),
        };
        pairs.set(pair.pairId, pair);
        return copy(pair);
      },
      async authorizeCreate(pairId, resourceId, owner) {
        const pair = owned(pairId, owner),
          slot = slotFor(pair, resourceId);
        gate(
          pair.state === 'PREPARING' && slot.creationState === 'PREPARED',
          'FIXTURE_CREATE_DENIED',
        );
        slot.creationState = 'UNKNOWN';
      },
      async confirmCreated(pairId, resourceId, containerId) {
        const slot = slotFor(known(pairId), resourceId);
        gate(
          CID.test(containerId) &&
            (!slot.containerId || slot.containerId === containerId),
          'FIXTURE_CONTAINER_ID_CHANGED',
        );
        slot.containerId = containerId;
        slot.creationState = 'CONFIRMED';
      },
      async markPairReady(pairId, owner) {
        const pair = owned(pairId, owner);
        gate(
          pair.state === 'PREPARING' &&
            pair.slots.every((slot) => slot.creationState === 'CONFIRMED'),
          'FIXTURE_READY_DENIED',
        );
        pair.state = 'READY';
      },
      async assignPair(pairId, owner, executionId, leaseToken) {
        const pair = owned(pairId, owner);
        gate(
          pair.state === 'READY' &&
            Date.parse(pair.expiresAt) - Date.now() > 40000,
          'FIXTURE_ASSIGN_DENIED',
        );
        pair.state = 'ASSIGNED';
        pair.executionId = executionId;
        assignments.set(pairId, leaseToken);
        return copy(pair);
      },
      async assertAssignment(
        pairId,
        resourceId,
        owner,
        executionId,
        leaseToken,
      ) {
        const pair = owned(pairId, owner),
          slot = slotFor(pair, resourceId);
        gate(
          pair.state === 'ASSIGNED' &&
            pair.executionId === executionId &&
            assignments.get(pairId) === leaseToken &&
            slot.cleanupState === 'PENDING',
          'FIXTURE_ASSIGNMENT_DENIED',
        );
        await onPreparedDispatch(slot.containerId, pair);
      },
      async markClean(pairId, resourceId, evidence) {
        const slot = slotFor(known(pairId), resourceId);
        gate(
          (evidence.kind === 'ABSENT' &&
            slot.creationState === 'CONFIRMED' &&
            evidence.containerId === slot.containerId) ||
            (evidence.kind === 'NOT_DISPATCHED' &&
              slot.creationState === 'PREPARED'),
          'FIXTURE_CLEANUP_UNPROVEN',
        );
        slot.cleanupState = 'VERIFIED';
      },
      async releasePair(pairId, owner) {
        const pair = owned(pairId, owner);
        gate(
          pair.slots.every((slot) => slot.cleanupState === 'VERIFIED'),
          'FIXTURE_RELEASE_DENIED',
        );
        pair.state = 'RETIRED';
      },
      async listExecutionPairs(executionId) {
        return [...pairs.values()]
          .filter((pair) => pair.executionId === executionId)
          .map(copy);
      },
      async claimRecovery() {
        throw new Error('Fixture does not implement durable recovery');
      },
    },
  };
}

async function main() {
  const report = {
    protocol: 'LINUX_CONTROLS_SMOKE_V1',
    startedAt: new Date().toISOString(),
    status: 'FAILED',
    stage: 'PREFLIGHT',
    scope: {
      kernelOnly: true,
      fixtureLedger: 'IN_MEMORY_ONLY',
      sqlApiDurability: false,
      vmIsolation: false,
      physicalLastInstructionProof: false,
      performanceAcceptance: false,
      samplesPerScenario: 1,
      concurrency: 1,
    },
    observations: [],
    cleanupVerified: false,
  };
  const stop = new AbortController();
  const cancelled = () => stop.abort();
  process.once('SIGINT', cancelled);
  process.once('SIGTERM', cancelled);
  const overall = AbortSignal.any([stop.signal, AbortSignal.timeout(180000)]);
  let engine,
    cleanupExecution,
    cleanupSlot,
    config,
    runtime,
    runner,
    verifyKernel;
  const resources = [];
  const executions = new Set();
  const observedIds = new Set();
  let daemonStart;
  async function request(method, path, signal = overall) {
    return engine.request(method, path, { signal, timeoutMs: 10000 });
  }
  async function cleanupOwned(resource) {
    const checks = {};
    const check = async (key, action) => {
      try {
        checks[key] = (await action()) === true;
      } catch {
        checks[key] = false;
      }
    };
    if (resource.pool) {
      await check('requestClosureAcknowledged', async () => {
        // Fixture acknowledgement only; there is no SQL finish or HTTP response.
        await resource.pool.afterRequestClosed(
          resource.executionId,
          resource.context,
          { replenish: false },
        );
        return true;
      });
      await check('poolDrained', async () => {
        await resource.pool.drain();
        return true;
      });
    }
    const signal = AbortSignal.timeout(10000);
    if (resource.ledger)
      for (const pair of resource.ledger.pairs.values())
        for (const [index, slot] of pair.slots.entries())
          await check(`preparedSlot${index + 1}`, () =>
            cleanupSlot(pair, slot, resource.ledger.port, signal),
          );
    await check(
      'executionAbsent',
      async () =>
        (await cleanupExecution(resource.executionId, resource.context, signal))
          .cleanupVerified,
    );
    for (const [index, item] of resource.observation.capsules.entries())
      await check(
        `capsule${index + 1}Absent`,
        async () =>
          (await request('GET', `/containers/${item.id}/json`, signal))
            .status === 404,
      );
    await check('privateEngineEmpty', async () => {
      const list = await request('GET', '/containers/json?all=true', signal);
      return (
        list.status === 200 &&
        Array.isArray(list.data) &&
        list.data.length === 0
      );
    });
    return { verified: Object.values(checks).every(Boolean), checks };
  }
  async function assertEnvelope() {
    overall.throwIfAborted();
    const info = await request('GET', '/info');
    gate(
      info.status === 200 &&
        info.data?.ID === config.engineId &&
        info.data.OSType === 'linux' &&
        info.data.CgroupVersion === '2' &&
        info.data.CgroupDriver === 'systemd',
      'ENGINE_IDENTITY_CHANGED',
    );
    gate(
      (await startTime(config.dockerPid)) === daemonStart,
      'DOCKER_PID_CHANGED',
    );
    await membership(config.dockerPid, config.boundary);
    await membership(process.pid, config.boundary);
    await controls(config.boundary, OUTER);
  }
  async function observeContainer(id, observation, kind, pair) {
    gate(CID.test(id ?? ''), 'CONTAINER_ID_INVALID');
    const inspected = await request('GET', `/containers/${id}/json`);
    const item = inspected.data,
      labels = item?.Config?.Labels;
    gate(
      inspected.status === 200 &&
        item.Id === id &&
        item.Image === config.image &&
        labels?.['org.alunza.runner'] === OWNER &&
        item.HostConfig?.Runtime === config.runtimeName,
      'SMOKE_CONTAINER_OWNERSHIP',
    );
    if (pair) {
      gate(
        pair.slots.some(
          (slot) => slot.containerId === id && item.Name === `/${slot.name}`,
        ) &&
          labels['org.alunza.prepared-pair'] === pair.pairId &&
          labels['org.alunza.creator'] === pair.creatorToken,
        'SMOKE_PREPARED_OWNERSHIP',
      );
    } else {
      gate(
        labels['org.alunza.execution'] === observation.executionId &&
          executions.has(observation.executionId),
        'SMOKE_EXECUTION_OWNERSHIP',
      );
    }
    const boundary = await verifyKernel(engine, {
      engineId: config.engineId,
      id,
      pid: item.State?.Pid,
      expectedBoundary: config.boundary,
      signal: overall,
    });
    const path = await membership(item.State.Pid, boundary);
    const leaf = await controls(path, LEAF);
    gate(!observedIds.has(id), 'CAPSULE_REUSED');
    observedIds.add(id);
    observation.capsules.push({
      id,
      kind,
      pid: item.State.Pid,
      boundary,
      leaf,
    });
  }
  async function observeCold(observation) {
    const filters = encodeURIComponent(
      JSON.stringify({
        label: [
          `org.alunza.runner=${OWNER}`,
          `org.alunza.execution=${observation.executionId}`,
        ],
      }),
    );
    const list = await request(
      'GET',
      `/containers/json?all=true&filters=${filters}`,
    );
    gate(
      list.status === 200 && Array.isArray(list.data) && list.data.length <= 1,
      'SMOKE_COLD_INVENTORY',
    );
    if (list.data.length)
      await observeContainer(list.data[0].Id, observation, 'cold');
  }
  try {
    gate(process.platform === 'linux', 'LOCAL_LINUX_REQUIRED');
    const env = process.env;
    report.selectedScenarios = selectScenarios(env.ALUNZA_SMOKE_SCENARIOS);
    gate(
      /^unix:\/\/\/[^/][a-zA-Z0-9_./:-]*$/.test(env.DOCKER_HOST ?? '') &&
        !env.DOCKER_CONTEXT &&
        !env.DOCKER_TLS &&
        !env.DOCKER_TLS_VERIFY,
      'EXPLICIT_LOCAL_SOCKET_REQUIRED',
    );
    const socket = env.DOCKER_HOST.slice('unix://'.length);
    gate(
      posix.normalize(socket) === socket &&
        !['/run/docker.sock', '/var/run/docker.sock'].includes(socket),
      'PRIVATE_SOCKET_REQUIRED',
    );
    const resolvedSocket = await realpath(socket);
    gate(
      !['/run/docker.sock', '/var/run/docker.sock'].includes(resolvedSocket) &&
        (await stat(socket)).isSocket(),
      'PRIVATE_SOCKET_REQUIRED',
    );
    config = {
      engineId: env.ALUNZA_SMOKE_ENGINE_ID,
      image: env.ALUNZA_SMOKE_IMAGE,
      runtimeName: env.ALUNZA_SMOKE_RUNTIME_NAME,
      boundary: env.ALUNZA_SMOKE_BOUNDARY,
      dockerPid: Number(env.ALUNZA_SMOKE_DOCKER_PID),
    };
    gate(
      /^[a-zA-Z0-9:_-]{1,128}$/.test(config.engineId ?? '') &&
        /^sha256:[a-f0-9]{64}$/.test(config.image ?? ''),
      'PINNED_ENGINE_IMAGE_REQUIRED',
    );
    gate(
      /^\/sys\/fs\/cgroup\/[a-zA-Z0-9_./:-]+$/.test(config.boundary ?? '') &&
        posix.normalize(config.boundary) === config.boundary &&
        !config.boundary.endsWith('/'),
      'EXPLICIT_BOUNDARY_REQUIRED',
    );
    gate(
      Number.isSafeInteger(config.dockerPid) && config.dockerPid > 1,
      'EXPLICIT_DOCKER_PID_REQUIRED',
    );
    const dockerExe = await readlink(`/proc/${config.dockerPid}/exe`);
    const args = (
      await readFile(`/proc/${config.dockerPid}/cmdline`, 'utf8')
    ).split('\0');
    gate(
      posix.basename(dockerExe) === 'dockerd' &&
        args.some(
          (arg, index) =>
            arg === `--host=${env.DOCKER_HOST}` ||
            (['--host', '-H'].includes(arg) &&
              args[index + 1] === env.DOCKER_HOST),
        ),
      'DOCKER_PID_SOCKET_MISMATCH',
    );
    daemonStart = await startTime(config.dockerPid);
    const capsule = await import('../../infra/runner/capsule.mjs');
    const transport = await import('../../infra/runner/docker-engine.mjs');
    const runtimeModule = await import('../../infra/runner/docker-runtime.mjs');
    const prepared = await import('../../infra/runner/prepared-capsule.mjs');
    ({ verifyKernelControls: verifyKernel } =
      await import('../../infra/runner/kernel-controls.mjs'));
    runner = await import('../../packages/runner/dist/index.js');
    cleanupExecution = prepared.cleanupBoundDockerExecution;
    cleanupSlot = prepared.cleanupPreparedSlot;
    runtime = runtimeModule.validateDockerRuntimeConfig({
      runtime: env.ALUNZA_SMOKE_RUNTIME,
      runtimeName: config.runtimeName,
      runtimeVersion: env.ALUNZA_SMOKE_RUNTIME_VERSION,
      runtimeSha256: env.ALUNZA_SMOKE_RUNTIME_SHA256,
      strategy: 'cold',
    });
    engine = await transport.localDockerEngine(capsule.command, overall);
    gate(engine.endpoint === env.DOCKER_HOST, 'ENGINE_ENDPOINT_CHANGED');
    await assertEnvelope();
    const identity = await runtimeModule.inspectDockerRuntime(
      engine,
      runtime,
      overall,
    );
    gate(
      identity.engineId === config.engineId &&
        (await capsule.imageIdentity(config.image, overall)) === config.image,
      'RUNTIME_IMAGE_MISMATCH',
    );
    const initial = await request('GET', '/containers/json?all=true');
    gate(
      initial.status === 200 &&
        Array.isArray(initial.data) &&
        initial.data.length === 0,
      'PRIVATE_ENGINE_MUST_BE_EMPTY',
    );
    report.candidate = {
      ...identity,
      image: config.image,
      runnerVersion: runner.RUNNER_VERSION,
      boundary: config.boundary,
      outer: await controls(config.boundary, OUTER),
      daemonPid: config.dockerPid,
      supervisorPid: process.pid,
    };

    report.stage = 'worker-identity';
    const identityObservation = {
      executionId: randomUUID(),
      capsules: [],
    };
    report.workerIdentity = identityObservation;
    executions.add(identityObservation.executionId);
    const identityContext = {
      ...identity,
      strategy: 'cold',
      provider: 'docker',
      image: config.image,
      runnerVersion: runner.RUNNER_VERSION,
    };
    const identityResource = {
      executionId: identityObservation.executionId,
      context: identityContext,
      observation: identityObservation,
    };
    resources.push(identityResource);
    await collectObservation(
      identityObservation,
      async () => {
        const response = await capsule.runCapsule(
          {
            executionId: identityObservation.executionId,
            code: '',
            args: [],
            budgetMs: 3000,
            outputRemaining: 65536,
          },
          {
            runtime: identityContext,
            image: config.image,
            probe: 'identity',
            expectedBoundary: config.boundary,
            signal: overall,
            beforeSend: async () => {
              await assertEnvelope();
              await observeCold(identityObservation);
            },
          },
        );
        identityObservation.result = {
          exitCode: response.exitCode,
          workerExitCode: response.packet?.exitCode ?? null,
          cleanupVerified: response.cleanupVerified,
          oomKilled: response.oomKilled,
          timedOut: response.timedOut,
          cancelled: response.cancelled,
        };
        gate(
          response.image === config.image &&
            response.exitCode === 0 &&
            response.packet?.status === 'exited' &&
            response.packet.exitCode === 0 &&
            !response.timedOut &&
            !response.cancelled &&
            !response.oomKilled &&
            !/^oom_kill [1-9]\d*$/m.test(
              response.packet.cgroup?.['memory.events'] ?? '',
            ) &&
            response.cleanupVerified &&
            identityObservation.capsules.length === 1,
          'WORKER_IDENTITY_PROBE_FAILED',
        );
        for (const [key, value] of Object.entries(LEAF))
          gate(response.packet.cgroup?.[key] === value, 'PACKET_LEAF_MISMATCH');
        gate(
          typeof response.packet.returnData === 'string' &&
            response.packet.returnData.length <= 87384,
          'WORKER_IDENTITY_ENVELOPE',
        );
        let envelope;
        try {
          envelope = JSON.parse(
            Buffer.from(response.packet.returnData, 'base64').toString('utf8'),
          );
        } catch {
          gate(false, 'WORKER_IDENTITY_ENVELOPE');
        }
        const value = envelope?.value;
        const capNames = ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'];
        gate(
          envelope.kind === 'probe' &&
            value?.uid === 10001 &&
            value.capabilities &&
            Object.keys(value.capabilities).length === 5 &&
            capNames.every(
              (name) => value.capabilities[name] === '0000000000000000',
            ),
          'WORKER_IDENTITY_CAPABILITIES',
        );
        identityObservation.uid = value.uid;
        identityObservation.capabilities = Object.fromEntries(
          capNames.map((name) => [name, value.capabilities[name]]),
        );
        // The pinned os-probe calls assertIdentity() before emitting kind=probe.
        // That guard also rejects NoNewPrivs != 1 and a readable supervisor pipe.
        identityObservation.noNewPrivsGuardPassed = true;
        identityObservation.guardSource = 'FIXED_WORKER_IDENTITY';
      },
      () => cleanupOwned(identityResource),
      overall,
    );
    gate(identityObservation.status === 'PASSED', 'WORKER_IDENTITY_FAILED');

    for (const scenario of report.selectedScenarios) {
      report.stage = scenario;
      overall.throwIfAborted();
      const executionId = randomUUID();
      executions.add(executionId);
      const observation = {
        scenario,
        executionId,
        status: 'FAILED',
        capsules: [],
      };
      report.observations.push(observation);
      const isPrepared = scenario === 'prepared-submit8';
      const mode = scenario.includes('submit') ? 'SUBMIT' : 'RUN';
      const loop = scenario === 'watchdog-loop1',
        output = scenario === 'output-aggregate8';
      const input = {
        executionId,
        requestId: randomUUID(),
        exerciseVersionId: 'kernel-smoke-fixed',
        testsVersion: 'linux-controls-smoke-v1',
        mode,
        entrypoint: 'solve',
        code: loop
          ? 'module.exports.solve = () => { while (true) {} };'
          : output
            ? "module.exports.solve = () => { console.log('o'.repeat(4499)); console.error('e'.repeat(4499)); return true; };"
            : 'module.exports.solve = (value) => value;',
        tests: Array.from({ length: loop ? 1 : 8 }, (_, index) => ({
          id: `case-${index + 1}`,
          visibility: mode === 'SUBMIT' && index > 0 ? 'hidden' : 'visible',
          args: [index + 1],
          expected: output ? true : index + 1,
        })),
      };
      const context = {
        ...identity,
        strategy: isPrepared ? 'prepared-pair-v1' : 'cold',
        provider: 'docker',
        image: config.image,
        runnerVersion: runner.RUNNER_VERSION,
      };
      const resource = { executionId, context, observation };
      resources.push(resource);
      await collectObservation(
        observation,
        async () => {
          await assertEnvelope();
          const deadline = Date.now() + 30000;
          const assertActive = async () => {
            gate(Date.now() < deadline, 'FIXTURE_EXECUTION_EXPIRED');
            await assertEnvelope();
            await observeCold(observation);
          };
          let adapter;
          if (isPrepared) {
            resource.ledger = fixtureLedger((id, pair) =>
              observeContainer(id, observation, 'prepared', pair),
            );
            resource.pool = new runner.DockerPreparedPool({
              runtime: { ...runtime, strategy: 'prepared-pair-v1' },
              resources: resource.ledger.port,
              ownerToken: randomUUID(),
            });
            await resource.pool.prepare(context, overall);
            adapter = await resource.pool.adapterFor(input, context, {
              leaseToken: randomUUID(),
              normalDeadlineMs: deadline,
              cleanupDeadlineMs: deadline + 10000,
              assertActive,
            });
          } else {
            adapter = new runner.DockerAdapter({
              image: config.image,
              runtime: context,
              expectedBoundary: config.boundary,
              deadlineMs: deadline,
              beforeSend: assertActive,
            });
          }
          const budgets = [];
          const measured = {
            provider: adapter.provider,
            execute: async (value, signal) => {
              budgets.push({
                budgetMs: value.budgetMs,
                outputRemaining: value.outputRemaining,
              });
              return adapter.execute(value, signal);
            },
            close: () => adapter.close(),
          };
          const began = performance.now();
          const result = await runner.execute(input, measured, overall);
          observation.elapsedMs = performance.now() - began;
          observation.result = {
            diagnosisCode: result.diagnosisCode,
            terminationReason: result.terminationReason,
            infrastructureStatus: result.infrastructureStatus,
            allRequiredPassed: result.allRequiredPassed,
            visibleCount: result.visibleTestResults.length,
            hiddenCount: result.privateTestResults.length,
            outputBytes: result.outputBytes,
            outputTruncated: result.outputTruncated,
            runtimeMs: result.runtimeMs,
            cleanupVerified: result.evidence.cleanupVerified,
            hostDeadlineObserved: result.evidence.hostDeadlineObserved,
          };
          observation.budgets = budgets;
          // The trusted packet schema has already validated these private clock fields.
          // Notification timestamps and SIGKILL return do NOT prove last instruction time.
          observation.timings = result.evidence.timings.map((item) => ({
            budgetMs: item.budgetMs,
            hostStartAttachMs: item.hostStartAttachMs,
            containerWallMs: item.containerWallMs,
            supervisorProcessMs: item.supervisorProcessMs,
            watchdog: item.watchdog,
          }));
          gate(
            result.evidence.cleanupVerified &&
              result.infrastructureStatus === 'OK',
            'EXECUTION_OR_CLEANUP_FAILED',
          );
          gate(
            observation.capsules.length === (loop ? 1 : 8) &&
              result.evidence.cgroups.length === (loop ? 1 : 8),
            'EXPECTED_CAPSULE_COUNT',
          );
          gate(
            budgets[0].budgetMs === 3000 &&
              budgets[0].outputRemaining === 65536 &&
              budgets.every(
                (value, index) =>
                  value.budgetMs > 0 &&
                  value.budgetMs <= 3000 &&
                  (index === 0 || value.budgetMs < budgets[index - 1].budgetMs),
              ),
            'AGGREGATE_TIME_BUDGET',
          );
          let spentMs = 0;
          for (const [index, value] of budgets.entries()) {
            gate(
              value.budgetMs === 3000 - spentMs &&
                Number.isFinite(
                  observation.timings[index]?.supervisorProcessMs,
                ),
              'REMAINING_TIME_MUST_INCLUDE_PRECEDING_CASES',
            );
            spentMs += observation.timings[index].supervisorProcessMs;
          }
          for (const cgroup of result.evidence.cgroups)
            for (const [key, value] of Object.entries(LEAF))
              gate(cgroup[key] === value, 'PACKET_LEAF_MISMATCH');
          if (loop) {
            const watch = observation.timings[0]?.watchdog;
            gate(
              result.diagnosisCode === 'TIMEOUT' &&
                result.terminationReason === 'EXECUTION_DEADLINE' &&
                watch?.version === 1 &&
                watch.watchdogFiredMs !== null &&
                watch.killAttempts > 0 &&
                watch.killCallSuccesses > 0 &&
                Number.isFinite(watch.exitObservedMs) &&
                Number.isFinite(watch.closeObservedMs) &&
                watch.lastGuestInstructionObservedMs === null,
              'WATCHDOG_OBSERVATION_MISSING',
            );
            observation.physicalDeadlineAcceptance =
              'NOT_ESTABLISHED_BY_NOTIFICATION_TIMESTAMPS';
          } else if (output) {
            gate(
              result.diagnosisCode === 'UNKNOWN' &&
                result.terminationReason === 'OUTPUT_LIMIT' &&
                result.outputTruncated &&
                result.outputBytes === 65536 &&
                budgets.every(
                  (value, index) =>
                    value.outputRemaining === 65536 - index * 9000,
                ),
              'AGGREGATE_OUTPUT_LIMIT',
            );
          } else {
            gate(
              result.diagnosisCode === 'SUCCESS' &&
                result.terminationReason === 'COMPLETED' &&
                result.allRequiredPassed,
              'EIGHT_CASE_SUCCESS',
            );
            const publicValue = runner.publicResult(result);
            gate(
              !Object.hasOwn(publicValue, 'privateTestResults') &&
                !Object.hasOwn(publicValue, 'evidence') &&
                publicValue.visibleTestResults.length ===
                  (mode === 'SUBMIT' ? 1 : 8),
              'PUBLIC_RESULT_PROJECTION',
            );
          }
          if (isPrepared)
            gate(
              observation.capsules.filter((item) => item.kind === 'prepared')
                .length === 2 &&
                observation.capsules.filter((item) => item.kind === 'cold')
                  .length === 6,
              'PREPARED_FALLBACK_COUNT',
            );
        },
        () => cleanupOwned(resource),
        overall,
      );
    }
    report.status = report.observations.every(
      (item) => item.status === 'PASSED',
    )
      ? 'PASSED'
      : 'FAILED';
    if (report.status === 'FAILED') report.failure = 'SCENARIO_FAILED';
  } catch (error) {
    // Never serialize arbitrary engine errors, command lines, code or outputs.
    report.failure = failureCode(error, overall);
  } finally {
    report.stageAtCompletion = report.stage;
    report.stage = 'CLEANUP';
    report.finalCleanup = [];
    for (const resource of resources) {
      try {
        report.finalCleanup.push({
          executionId: resource.executionId,
          ...(await cleanupOwned(resource)),
        });
      } catch {
        report.finalCleanup.push({
          executionId: resource.executionId,
          verified: false,
        });
      }
    }
    report.cleanupVerified =
      report.finalCleanup.length > 0 &&
      report.finalCleanup.every((item) => item.verified);
    if (!report.cleanupVerified) {
      report.status = 'FAILED';
      report.failure ??= 'CLEANUP_NOT_VERIFIED';
    }
    report.ownedExecutionIds = [...executions];
    report.preparedResources = resources.flatMap((resource) =>
      resource.ledger
        ? [...resource.ledger.pairs.values()].flatMap((pair) =>
            pair.slots.map((slot) => ({
              pairId: pair.pairId,
              resourceId: slot.resourceId,
              containerId: slot.containerId,
              creationState: slot.creationState,
              cleanupState: slot.cleanupState,
            })),
          )
        : [],
    );
    report.unattemptedScenarios = (report.selectedScenarios ?? []).filter(
      (scenario) =>
        !report.observations.some((item) => item.scenario === scenario),
    );
    report.finishedAt = new Date().toISOString();
    process.removeListener('SIGINT', cancelled);
    process.removeListener('SIGTERM', cancelled);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'PASSED' ? 0 : 1;
  }
}

if (require.main === module) void main();
