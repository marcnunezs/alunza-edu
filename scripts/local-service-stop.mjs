// Explicit physical TEST only. No service actions on import, no forced fallback.
// CLI: plan --output NEW.json | stop --plan PLAN.json --output NEW.json --runtime PRIVATE.json
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { physicalTestTarget } from './local-target.mjs';

export const STOP_DEADLINE_MS = 20000;
const ROLES = ['kong', 'rest'];
const HEX = /^[a-f0-9]{64}$/;
const PREFIX = '/usr/local/kong';
const SOCKET = '/var/run/docker.sock';
export const POSTGREST_IMAGE =
  'sha256:bca3f86f69d8ef7aa1e5ee65e66ce9a20c6c147be637517a7be8399e102901d1';
export const POSTGREST_ELF =
  'f7934270752251bf27cb0f2cb60b3adefcde484dec3cfb0b5cd3a9deda07a62c';
const MAX_BYTES = 1024 * 1024;
const target = physicalTestTarget;
const codes = new Set();
function requireValue(ok, code) {
  codes.add(code);
  if (!ok) throw new Error(code);
}
function failure(error) {
  return codes.has(error?.message) ? error.message : 'OPERATION_FAILED';
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const same = (a, b) => digest(a) === digest(b);
const containerName = (role) => `supabase_${role}_${target.projectId}`;
function exact(value, keys) {
  requireValue(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      same(Object.keys(value).sort(), keys.slice().sort()),
    'SCHEMA_REJECTED',
  );
}
function policy(value) {
  exact(value, ['Name', 'MaximumRetryCount']);
  requireValue(
    ['no', 'always', 'unless-stopped', 'on-failure'].includes(value.Name) &&
      Number.isSafeInteger(value.MaximumRetryCount) &&
      value.MaximumRetryCount >= 0,
    'RESTART_POLICY_REJECTED',
  );
  return { Name: value.Name, MaximumRetryCount: value.MaximumRetryCount };
}

// Bounded local Engine HTTP, not a shell/CLI subprocess. Bodies and errors from
// Docker stay private; only this module's fixed error codes reach receipts.
export async function engineRequest(
  {
    method = 'GET',
    path,
    body,
    timeoutMs = 2000,
    response: responseKind = 'json',
  },
  {
    request: requestImpl = http.request,
    stat = lstat,
    platform = process.platform,
  } = {},
) {
  requireValue(platform === 'linux', 'LINUX_ENGINE_REQUIRED');
  requireValue((await stat(SOCKET)).isSocket(), 'LOCAL_ENGINE_SOCKET_REQUIRED');
  requireValue(
    Number.isFinite(timeoutMs) &&
      timeoutMs > 0 &&
      timeoutMs <= STOP_DEADLINE_MS,
    'COMMAND_DEADLINE_REJECTED',
  );
  return new Promise((resolveResult, reject) => {
    let settled = false,
      bytes = 0;
    const chunks = [],
      encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolveResult(value);
    };
    const request = requestImpl(
      {
        socketPath: SOCKET,
        method,
        path,
        headers: encoded
          ? {
              'content-type': 'application/json',
              'content-length': encoded.length,
            }
          : {},
      },
      (response) => {
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) {
            codes.add('DOCKER_OUTPUT_LIMIT');
            finish(new Error('DOCKER_OUTPUT_LIMIT'));
            response.destroy();
            request.destroy();
          } else chunks.push(chunk);
        });
        response.on('error', () => {
          codes.add('DOCKER_TRANSPORT_FAILED');
          finish(new Error('DOCKER_TRANSPORT_FAILED'));
        });
        response.on('end', () => {
          try {
            requireValue(
              (response.statusCode >= 200 && response.statusCode < 300) ||
                response.statusCode === 304,
              'DOCKER_OPERATION_FAILED',
            );
            const raw = Buffer.concat(chunks);
            finish(
              null,
              responseKind === 'buffer'
                ? raw
                : raw.length
                  ? JSON.parse(raw.toString('utf8'))
                  : null,
            );
          } catch (error) {
            finish(new Error(failure(error)));
          }
        });
      },
    );
    const timer = setTimeout(() => {
      codes.add('DOCKER_REQUEST_TIMEOUT');
      finish(new Error('DOCKER_REQUEST_TIMEOUT'));
      request.destroy();
    }, timeoutMs);
    request.on('error', () => {
      codes.add('DOCKER_TRANSPORT_FAILED');
      finish(new Error('DOCKER_TRANSPORT_FAILED'));
    });
    request.end(encoded);
  });
}

function networkIdentity(raw) {
  requireValue(
    HEX.test(raw?.Id) &&
      raw.Name === target.networkName &&
      raw.Driver === 'bridge' &&
      raw.Labels?.['alunza.project'] === target.projectId &&
      raw.Options?.['com.docker.network.bridge.host_binding_ipv4'] ===
        '127.0.0.1',
    'NETWORK_IDENTITY_REJECTED',
  );
  return {
    id: raw.Id,
    name: raw.Name,
    driver: raw.Driver,
    project: target.projectId,
    loopbackBinding: '127.0.0.1',
  };
}
function stateOf(raw) {
  const s = raw.State;
  requireValue(
    typeof s?.Running === 'boolean' &&
      typeof s.OOMKilled === 'boolean' &&
      Number.isSafeInteger(s.ExitCode) &&
      Number.isSafeInteger(s.Pid) &&
      typeof s.StartedAt === 'string' &&
      typeof s.FinishedAt === 'string',
    'STATE_REJECTED',
  );
  return {
    running: s.Running,
    status: s.Status,
    pid: s.Pid,
    exitCode: s.ExitCode,
    oomKilled: s.OOMKilled,
    startedAt: s.StartedAt,
    finishedAt: s.FinishedAt,
    restartCount: raw.RestartCount,
  };
}
function identityOf(raw, role, network) {
  requireValue(
    ROLES.includes(role) &&
      HEX.test(raw?.Id) &&
      raw.Name === '/' + containerName(role) &&
      /^sha256:[a-f0-9]{64}$/.test(raw.Image) &&
      raw.Config?.Labels?.['com.supabase.cli.project'] === target.projectId,
    'CONTAINER_IDENTITY_REJECTED',
  );
  requireValue(
    raw.HostConfig?.AutoRemove === false &&
      raw.HostConfig.Privileged === false &&
      !raw.HostConfig.PidMode,
    'CONTAINER_MODE_REJECTED',
  );
  const networks = raw.NetworkSettings?.Networks;
  requireValue(
    networks &&
      Object.keys(networks).length === 1 &&
      networks[target.networkName]?.NetworkID === network.id,
    'CONTAINER_NETWORK_REJECTED',
  );
  const configuredBindings = raw.HostConfig.PortBindings ?? {};
  requireValue(
    Object.values(configuredBindings).every(
      (rows) =>
        Array.isArray(rows) &&
        rows.every(
          (p) =>
            ['', '127.0.0.1', '::1'].includes(p.HostIp) &&
            /^\d{1,5}$/.test(p.HostPort),
        ),
    ),
    'NON_LOOPBACK_PORT_REJECTED',
  );
  requireValue(
    Object.values(raw.NetworkSettings.Ports ?? {}).every((rows) =>
      (rows ?? []).every((p) => ['127.0.0.1', '::1'].includes(p.HostIp)),
    ),
    'NON_LOOPBACK_PORT_REJECTED',
  );
  const portBindings = Object.fromEntries(
    Object.entries(configuredBindings).map(([port, rows]) => [
      port,
      rows.map((p) => ({
        HostIp: p.HostIp || network.loopbackBinding,
        HostPort: p.HostPort,
      })),
    ]),
  );
  requireValue(Array.isArray(raw.Mounts), 'MOUNTS_REJECTED');
  const mounts = raw.Mounts.map((m) => {
    requireValue(
      ['volume', 'bind', 'tmpfs'].includes(m.Type) &&
        typeof m.Destination === 'string' &&
        typeof m.RW === 'boolean',
      'MOUNTS_REJECTED',
    );
    return {
      type: m.Type,
      name: m.Name ?? null,
      source: m.Source ?? null,
      destination: m.Destination,
      rw: m.RW,
    };
  }).sort((a, b) => a.destination.localeCompare(b.destination));
  // The hash covers raw configuration, including secret-bearing fields, while
  // the receipt exports no values from Env/Cmd/Entrypoint.
  const { RestartPolicy: _restartPolicy, ...hostConfig } = raw.HostConfig;
  return {
    role,
    id: raw.Id,
    name: raw.Name,
    imageId: raw.Image,
    configSha256: digest(raw.Config),
    hostConfigSha256: digest(hostConfig),
    networkId: network.id,
    mounts,
    portBindings,
  };
}
function strategyOf(raw, role) {
  if (role === 'kong') {
    const prefixes = (raw.Config.Env ?? []).filter((item) =>
      item.startsWith('KONG_PREFIX='),
    );
    requireValue(
      prefixes.length === 0 ||
        (prefixes.length === 1 && prefixes[0] === `KONG_PREFIX=${PREFIX}`),
      'KONG_PREFIX_UNVERIFIED',
    );
    return 'NGINX_NATIVE_QUIT';
  }
  requireValue(raw.Image === POSTGREST_IMAGE, 'POSTGREST_IMAGE_REJECTED');
  return 'POSTGREST_EXPECTED_INTERRUPT_255';
}
async function kongPrefix(docker, id, timeoutMs) {
  const top = await docker({
    path: `/containers/${id}/top?ps_args=-eo%20pid,comm,args`,
    timeoutMs,
  });
  requireValue(
    Array.isArray(top?.Titles) && Array.isArray(top.Processes),
    'KONG_PROCESS_METADATA_REJECTED',
  );
  const command =
    'nginx: master process /usr/local/openresty/nginx/sbin/nginx -p /usr/local/kong -c nginx.conf';
  requireValue(
    top.Processes.filter(
      (p) => p.length === 3 && p[1] === 'nginx' && p[2] === command,
    ).length === 1,
    'KONG_PREFIX_UNVERIFIED',
  );
}
async function snapshot(docker, timeoutMs = 2000) {
  const engine = await docker({ path: '/version', timeoutMs });
  requireValue(
    engine?.Os === 'linux' && engine.Version === '29.1.3',
    'PINNED_ENGINE_REQUIRED',
  );
  const network = networkIdentity(
    await docker({ path: `/networks/${target.networkName}`, timeoutMs }),
  );
  const containers = [];
  for (const role of ROLES) {
    const raw = await docker({
      path: `/containers/${containerName(role)}/json`,
      timeoutMs,
    });
    if (role === 'kong' && raw.State.Running)
      await kongPrefix(docker, raw.Id, timeoutMs);
    containers.push({
      ...identityOf(raw, role, network),
      restartPolicy: policy(raw.HostConfig.RestartPolicy),
      initialState: stateOf(raw),
      strategy: strategyOf(raw, role),
    });
  }
  return { engineVersion: engine.Version, network, containers };
}
export async function createStopPlan({
  docker = engineRequest,
  now = () => new Date().toISOString(),
} = {}) {
  const observed = await snapshot(docker);
  return {
    schemaVersion: 1,
    kind: 'PHYSICAL_TEST_SERVICE_STOP_PLAN',
    planId: randomUUID(),
    projectId: target.projectId,
    createdAt: now(),
    stopDeadlineMs: STOP_DEADLINE_MS,
    ...observed,
  };
}
function validatePlan(plan) {
  exact(plan, [
    'schemaVersion',
    'kind',
    'planId',
    'projectId',
    'createdAt',
    'stopDeadlineMs',
    'engineVersion',
    'network',
    'containers',
  ]);
  requireValue(
    plan.schemaVersion === 1 &&
      plan.kind === 'PHYSICAL_TEST_SERVICE_STOP_PLAN' &&
      plan.projectId === target.projectId &&
      plan.stopDeadlineMs === STOP_DEADLINE_MS &&
      /^[a-f0-9-]{36}$/.test(plan.planId) &&
      Array.isArray(plan.containers) &&
      same(
        plan.containers.map((c) => c.role),
        ROLES,
      ),
    'PLAN_REJECTED',
  );
  exact(plan.network, ['id', 'name', 'driver', 'project', 'loopbackBinding']);
  requireValue(
    HEX.test(plan.network.id) &&
      plan.network.name === target.networkName &&
      plan.network.project === target.projectId &&
      plan.network.driver === 'bridge' &&
      plan.network.loopbackBinding === '127.0.0.1',
    'PLAN_NETWORK_REJECTED',
  );
  for (const c of plan.containers) {
    exact(c, [
      'role',
      'id',
      'name',
      'imageId',
      'configSha256',
      'hostConfigSha256',
      'networkId',
      'mounts',
      'portBindings',
      'restartPolicy',
      'initialState',
      'strategy',
    ]);
    requireValue(
      HEX.test(c.id) &&
        c.name === '/' + containerName(c.role) &&
        /^sha256:[a-f0-9]{64}$/.test(c.imageId) &&
        HEX.test(c.configSha256) &&
        HEX.test(c.hostConfigSha256) &&
        c.networkId === plan.network.id,
      'PLAN_CONTAINER_REJECTED',
    );
    policy(c.restartPolicy);
    requireValue(
      c.strategy ===
        (c.role === 'kong'
          ? 'NGINX_NATIVE_QUIT'
          : 'POSTGREST_EXPECTED_INTERRUPT_255'),
      'PLAN_STRATEGY_REJECTED',
    );
  }
}

// Docker's non-TTY logs have an eight-byte stream header. Never return log text.
function logText(buffer) {
  requireValue(Buffer.isBuffer(buffer), 'LOG_FRAME_REJECTED');
  let offset = 0;
  const chunks = [];
  while (offset < buffer.length) {
    requireValue(
      offset + 8 <= buffer.length &&
        [1, 2].includes(buffer[offset]) &&
        buffer.subarray(offset + 1, offset + 4).every((v) => v === 0),
      'LOG_FRAME_REJECTED',
    );
    const size = buffer.readUInt32BE(offset + 4);
    requireValue(offset + 8 + size <= buffer.length, 'LOG_FRAME_REJECTED');
    chunks.push(buffer.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function assessPostgrestInterrupt({
  anchor,
  state,
  before,
  after,
  logBuffer,
  eventBuffer,
  signalAt,
  observedAt,
}) {
  requireValue(
    anchor.imageId === POSTGREST_IMAGE &&
      before?.executableSha256 === POSTGREST_ELF &&
      before.directBinary === true &&
      before.namespacePid1 === true &&
      before.initDisabled === true &&
      before.quiescent === true &&
      before.ghcVersion === '9.4.8',
    'POSTGREST_BINARY_EVIDENCE_REJECTED',
  );
  requireValue(
    Number.isInteger(before.connections) &&
      before.connections > 0 &&
      before.active === 0 &&
      /^PostgREST 14\.10(?:[ +(-].*)?$/.test(before.applicationName) &&
      after?.applicationName === before.applicationName &&
      after.connections === 0 &&
      after.capturedPidsRemaining === 0,
    'POSTGREST_CONNECTION_EVIDENCE_REJECTED',
  );
  requireValue(
    state.running === false &&
      state.pid === 0 &&
      state.exitCode === 255 &&
      state.oomKilled === false &&
      state.startedAt === anchor.initialState.startedAt &&
      state.restartCount === anchor.initialState.restartCount,
    'POSTGREST_STOP_STATE_REJECTED',
  );
  const start = Date.parse(signalAt),
    end = Date.parse(observedAt);
  requireValue(
    Number.isFinite(start) && Number.isFinite(end) && end >= start,
    'POSTGREST_CLOCK_REJECTED',
  );
  const matching = logText(logBuffer)
    .split(/\r?\n/)
    .filter((line) => {
      const stamp = line.match(/^(\S+)\s/),
        time = stamp ? Date.parse(stamp[1]) : NaN;
      return (
        time >= start &&
        time <= end &&
        line.endsWith('Received termination unix signal SIGTERM')
      );
    });
  const events = eventBuffer
    .toString('utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const window = events.filter(
    (e) =>
      (e.Actor?.ID ?? e.id) === anchor.id &&
      e.timeNano / 1e6 >= start &&
      e.timeNano / 1e6 <= end,
  );
  const kills = window.filter((e) => e.Action === 'kill');
  const deaths = window.filter((e) => e.Action === 'die');
  requireValue(
    matching.length === 1 &&
      kills.length === 1 &&
      kills[0].Actor.Attributes?.signal === '15' &&
      deaths.length === 1 &&
      deaths[0].Actor.Attributes?.exitCode === '255' &&
      !window.some((e) => e.Action === 'oom'),
    'POSTGREST_SIGNAL_EVIDENCE_REJECTED',
  );
  return {
    classification: 'expected-interrupt-255',
    exitCode: 255,
    executableSha256: POSTGREST_ELF,
    ghcVersion: '9.4.8',
    signalLogMatched: true,
    engineSignalAndExitMatched: true,
    connectionsBefore: before.connections,
    activeBefore: 0,
    connectionsAfter: 0,
    capturedPidsRemaining: 0,
  };
}

async function boundedHook(hook, identity, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      hook(identity, { timeoutMs }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          codes.add('EVIDENCE_DEADLINE_EXCEEDED');
          reject(new Error('EVIDENCE_DEADLINE_EXCEEDED'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function stopPlannedServices(
  plan,
  {
    docker = engineRequest,
    now = () => performance.now(),
    wallNow = () => new Date().toISOString(),
    sleep = delay,
    postgrest,
  } = {},
) {
  validatePlan(plan);
  const report = {
    schemaVersion: 1,
    kind: 'PHYSICAL_TEST_SERVICE_STOP_RECEIPT',
    planId: plan.planId,
    planSha256: digest(plan),
    projectId: target.projectId,
    pass: false,
    stopDeadlineMs: STOP_DEADLINE_MS,
    stopElapsedMs: null,
    policyRestoreElapsedMs: null,
    totalElapsedMs: null,
    services: [],
    failures: [],
    forcedFallbackUsed: false,
    dataDeletionRequested: false,
  };
  let started = null;
  const remaining = () => {
    const left = started === null ? 2000 : STOP_DEADLINE_MS - (now() - started);
    requireValue(left > 0, 'STOP_DEADLINE_EXCEEDED');
    return Math.min(2000, left);
  };
  const observedIdentity = async (anchor, restore = false) => {
    const timeoutMs = restore ? 2000 : remaining();
    const network = networkIdentity(
      await docker({ path: `/networks/${target.networkName}`, timeoutMs }),
    );
    requireValue(same(network, plan.network), 'NETWORK_CHANGED');
    const raw = await docker({
      path: `/containers/${anchor.id}/json`,
      timeoutMs: restore ? 2000 : remaining(),
    });
    const {
      restartPolicy: _p,
      initialState: _s,
      strategy: _strategy,
      ...expected
    } = anchor;
    requireValue(
      same(identityOf(raw, anchor.role, network), expected),
      'CONTAINER_CHANGED',
    );
    requireValue(
      strategyOf(raw, anchor.role) === anchor.strategy,
      'STRATEGY_CHANGED',
    );
    requireValue(
      raw.State.StartedAt === anchor.initialState.startedAt &&
        raw.RestartCount === anchor.initialState.restartCount,
      'PROCESS_GENERATION_CHANGED',
    );
    requireValue(
      !raw.State.Paused && !raw.State.Restarting,
      'SERVICE_PAUSED_OR_RESTARTING',
    );
    return raw;
  };
  const noRestart = { Name: 'no', MaximumRetryCount: 0 };
  try {
    const engine = await docker({ path: '/version', timeoutMs: remaining() });
    requireValue(
      engine?.Version === plan.engineVersion &&
        engine.Version === '29.1.3' &&
        engine.Os === 'linux',
      'PINNED_ENGINE_REQUIRED',
    );
    requireValue(
      !plan.containers.find((c) => c.role === 'rest').initialState.running ||
        (typeof postgrest?.before === 'function' &&
          typeof postgrest?.after === 'function'),
      'POSTGREST_EVIDENCE_HOOKS_REQUIRED',
    );
    // Reject the complete set before the first update or signal.
    for (const anchor of plan.containers) {
      const raw = await observedIdentity(anchor);
      requireValue(
        same(policy(raw.HostConfig.RestartPolicy), anchor.restartPolicy),
        'POLICY_CHANGED',
      );
      requireValue(
        same(stateOf(raw), anchor.initialState),
        'PROCESS_GENERATION_CHANGED',
      );
    }
    started = now();
    for (const anchor of plan.containers) {
      const row = {
        role: anchor.role,
        id: anchor.id,
        strategy: anchor.strategy,
        pass: false,
        alreadyStopped: false,
        signalRequested: false,
        stoppedObserved: false,
        engineManualStopPathRequested: false,
        durableManualStopMarkerVerified: false,
        policyRestored: false,
        state: null,
        failures: [],
        classification: null,
      };
      report.services.push(row);
      let restoreRequired = false,
        before,
        originalIdentity,
        signalAt;
      try {
        let raw = await observedIdentity(anchor);
        requireValue(
          same(policy(raw.HostConfig.RestartPolicy), anchor.restartPolicy),
          'POLICY_CHANGED',
        );
        row.alreadyStopped = !raw.State.Running;
        if (raw.State.Running) {
          if (anchor.role === 'kong')
            await kongPrefix(docker, anchor.id, remaining());
          if (anchor.role === 'rest') {
            originalIdentity = {
              containerId: anchor.id,
              imageId: anchor.imageId,
              pid: raw.State.Pid,
              startedAt: raw.State.StartedAt,
            };
            before = await boundedHook(
              postgrest.before,
              originalIdentity,
              remaining(),
            );
            requireValue(
              before?.quiescent === true &&
                before.connections > 0 &&
                before.active === 0,
              'POSTGREST_NOT_QUIESCENT',
            );
            requireValue(
              before.executableSha256 === POSTGREST_ELF &&
                before.directBinary === true &&
                before.namespacePid1 === true &&
                before.initDisabled === true &&
                before.ghcVersion === '9.4.8',
              'POSTGREST_BINARY_EVIDENCE_REJECTED',
            );
          }
          raw = await observedIdentity(anchor);
          requireValue(
            raw.State.Running &&
              same(policy(raw.HostConfig.RestartPolicy), anchor.restartPolicy),
            'POLICY_CHANGED',
          );
          restoreRequired = true; // The update may have succeeded despite a lost response.
          await docker({
            method: 'POST',
            path: `/containers/${anchor.id}/update`,
            body: { RestartPolicy: noRestart },
            timeoutMs: remaining(),
          });
          raw = await observedIdentity(anchor);
          requireValue(
            same(policy(raw.HostConfig.RestartPolicy), noRestart),
            'POLICY_DISABLE_UNCONFIRMED',
          );
          requireValue(
            raw.State.Running &&
              raw.State.StartedAt === anchor.initialState.startedAt,
            'PROCESS_GENERATION_CHANGED',
          );
          if (anchor.role === 'kong') {
            // Docker29.1.3's signal path requests manual-stop state. SIGCONT is
            // non-terminating; native nginx QUIT performs the graceful shutdown.
            await docker({
              method: 'POST',
              path: `/containers/${anchor.id}/kill?signal=SIGCONT`,
              timeoutMs: remaining(),
            });
            row.engineManualStopPathRequested = true;
            raw = await observedIdentity(anchor);
            requireValue(
              raw.State.Running &&
                same(policy(raw.HostConfig.RestartPolicy), noRestart),
              'POLICY_DISABLE_UNCONFIRMED',
            );
            await kongPrefix(docker, anchor.id, remaining());
            const exec = await docker({
              method: 'POST',
              path: `/containers/${anchor.id}/exec`,
              body: {
                AttachStdout: false,
                AttachStderr: false,
                Tty: false,
                Cmd: [
                  '/usr/local/openresty/nginx/sbin/nginx',
                  '-p',
                  PREFIX,
                  '-c',
                  'nginx.conf',
                  '-s',
                  'quit',
                ],
              },
              timeoutMs: remaining(),
            });
            requireValue(HEX.test(exec?.Id), 'EXEC_ID_REJECTED');
            raw = await observedIdentity(anchor);
            requireValue(
              raw.State.Running &&
                same(policy(raw.HostConfig.RestartPolicy), noRestart),
              'POLICY_DISABLE_UNCONFIRMED',
            );
            await kongPrefix(docker, anchor.id, remaining());
            row.signalRequested = true;
            await docker({
              method: 'POST',
              path: `/exec/${exec.Id}/start`,
              body: { Detach: true, Tty: false },
              timeoutMs: remaining(),
            });
            let command;
            do {
              command = await docker({
                path: `/exec/${exec.Id}/json`,
                timeoutMs: remaining(),
              });
              requireValue(
                command.ContainerID === anchor.id,
                'EXEC_CONTAINER_CHANGED',
              );
              if (command.Running) await sleep(Math.min(50, remaining()));
            } while (command.Running);
            requireValue(command.ExitCode === 0, 'NGINX_QUIT_COMMAND_FAILED');
          } else {
            signalAt = wallNow();
            row.signalRequested = true;
            await docker({
              method: 'POST',
              path: `/containers/${anchor.id}/kill?signal=SIGTERM`,
              timeoutMs: remaining(),
            });
            row.engineManualStopPathRequested = true;
          }
        }
        do {
          raw = await observedIdentity(anchor);
          if (raw.State.Running) await sleep(Math.min(50, remaining()));
        } while (raw.State.Running);
        row.state = stateOf(raw);
        row.stoppedObserved = raw.State.Pid === 0;
        requireValue(
          row.stoppedObserved && !raw.State.OOMKilled,
          'STOP_STATE_UNVERIFIED',
        );
        if (
          anchor.role === 'rest' &&
          raw.State.ExitCode === 255 &&
          row.signalRequested
        ) {
          const after = await boundedHook(
            postgrest.after,
            originalIdentity,
            remaining(),
          );
          const observedAt = wallNow(),
            // Engine logs/events require Unix seconds here; retain the ISO
            // values above for the independent evidence-window assessment.
            since = encodeURIComponent(String(Date.parse(signalAt) / 1000)),
            until = encodeURIComponent(String(Date.parse(observedAt) / 1000));
          const logBuffer = await docker({
            path: `/containers/${anchor.id}/logs?stdout=1&stderr=1&timestamps=1&since=${since}&until=${until}`,
            response: 'buffer',
            timeoutMs: remaining(),
          });
          const filters = encodeURIComponent(
            JSON.stringify({
              type: ['container'],
              container: [anchor.id],
              event: ['kill', 'die', 'stop', 'oom'],
            }),
          );
          const eventBuffer = await docker({
            path: `/events?since=${since}&until=${until}&filters=${filters}`,
            response: 'buffer',
            timeoutMs: remaining(),
          });
          row.classification = assessPostgrestInterrupt({
            anchor,
            state: row.state,
            before,
            after,
            logBuffer,
            eventBuffer,
            signalAt,
            observedAt,
          });
        } else requireValue(raw.State.ExitCode === 0, 'NONZERO_EXIT');
        remaining();
        row.pass = true;
      } catch (error) {
        row.failures.push(failure(error));
      } finally {
        report.stopElapsedMs = now() - started;
        // Restoration is bounded and reported separately; it never extends the
        // 20-second stopping criterion or emits a fallback termination signal.
        const restoreStarted = now();
        try {
          let raw = await observedIdentity(anchor, true);
          if (restoreRequired) {
            await observedIdentity(anchor, true);
            await docker({
              method: 'POST',
              path: `/containers/${anchor.id}/update`,
              body: { RestartPolicy: anchor.restartPolicy },
              timeoutMs: 2000,
            });
          }
          raw = await observedIdentity(anchor, true);
          row.policyRestored = same(
            policy(raw.HostConfig.RestartPolicy),
            anchor.restartPolicy,
          );
          requireValue(row.policyRestored, 'POLICY_RESTORE_UNCONFIRMED');
          requireValue(
            !raw.State.Running && raw.State.Pid === 0,
            'SERVICE_RESTARTED_OR_RUNNING',
          );
        } catch (error) {
          row.failures.push(failure(error));
          row.pass = false;
        }
        report.policyRestoreElapsedMs =
          (report.policyRestoreElapsedMs ?? 0) + now() - restoreStarted;
      }
      row.pass &&=
        row.failures.length === 0 &&
        row.policyRestored &&
        (row.alreadyStopped || row.engineManualStopPathRequested);
    }
  } catch (error) {
    report.failures.push(failure(error));
  }
  report.totalElapsedMs = started === null ? null : now() - started;
  report.pass =
    report.failures.length === 0 &&
    report.services.length === ROLES.length &&
    report.services.every((s) => s.pass) &&
    report.totalElapsedMs <= STOP_DEADLINE_MS;
  if (
    report.totalElapsedMs > STOP_DEADLINE_MS &&
    !report.failures.includes('STOP_DEADLINE_EXCEEDED')
  )
    report.failures.push('STOP_DEADLINE_EXCEEDED');
  return report;
}

async function newOutput(path) {
  const file = await open(resolve(path), 'wx', 0o600);
  await file.chmod(0o600);
  return file;
}
export async function main(
  args = process.argv.slice(2),
  { docker = engineRequest } = {},
) {
  const [action, ...flags] = args;
  requireValue(
    ['plan', 'stop'].includes(action) &&
      (action === 'plan' ? flags.length === 2 : [4, 6].includes(flags.length)),
    'CLI_ARGUMENTS_REJECTED',
  );
  const options = {};
  for (let i = 0; i < flags.length; i += 2) {
    requireValue(
      ['--output', '--plan', '--runtime'].includes(flags[i]) &&
        !options[flags[i]] &&
        flags[i + 1],
      'CLI_ARGUMENTS_REJECTED',
    );
    options[flags[i]] = flags[i + 1];
  }
  requireValue(
    options['--output'] &&
      (action === 'plan' ? !options['--plan'] : options['--plan']),
    'CLI_ARGUMENTS_REJECTED',
  );
  const output = await newOutput(options['--output']);
  let result, postgrest;
  try {
    if (action === 'plan') result = await createStopPlan({ docker });
    else {
      const path = resolve(options['--plan']),
        stat = await lstat(path);
      requireValue(
        stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_BYTES,
        'PLAN_FILE_REJECTED',
      );
      if (options['--runtime']) {
        const { createPostgrestEvidence } =
          await import('./local-postgrest-stop-evidence.mjs');
        postgrest = await createPostgrestEvidence({
          runtimePath: resolve(options['--runtime']),
        });
      }
      result = await stopPlannedServices(
        JSON.parse(await readFile(path, 'utf8')),
        { postgrest, docker },
      );
    }
  } catch (error) {
    result = {
      schemaVersion: 1,
      kind: 'PHYSICAL_TEST_SERVICE_STOP_ERROR',
      pass: false,
      failures: [failure(error)],
    };
  } finally {
    try {
      await postgrest?.close();
    } catch {
      result.pass = false;
      (result.failures ??= []).push('POSTGREST_EVIDENCE_CLOSE_FAILED');
    }
    try {
      await output.writeFile(JSON.stringify(result, null, 2) + '\n');
      await output.sync();
    } finally {
      await output.close();
    }
  }
  const passed =
    action === 'plan'
      ? result.kind === 'PHYSICAL_TEST_SERVICE_STOP_PLAN'
      : result.pass;
  console.log(
    JSON.stringify({
      action,
      pass: passed,
      output: resolve(options['--output']),
      failures: result.failures ?? [],
    }),
  );
  return passed ? 0 : 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error('LOCAL_SERVICE_STOP_REJECTED');
      process.exitCode = 1;
    });
}
