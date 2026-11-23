// Private evidence for one pinned, existing physical TEST PostgREST process.
// No signals, starts, updates or removals are performed by this module.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { assertRuntimeTarget, physicalTestTarget } from './local-target.mjs';
import { engineRequest } from './local-service-stop.mjs';

export const POSTGREST_IMAGE =
  'sha256:bca3f86f69d8ef7aa1e5ee65e66ce9a20c6c147be637517a7be8399e102901d1';
export const POSTGREST_EXECUTABLE_SHA256 =
  'f7934270752251bf27cb0f2cb60b3adefcde484dec3cfb0b5cd3a9deda07a62c';
export const POSTGREST_RTS_SHA256 =
  '6efb86a7cc83acc0043816e13cf3f814b20661122323fd3e0f24c42a2a7bdf56';
const target = physicalTestTarget;
const MAX_BYTES = 32 * 1024 * 1024;
const HEX = /^[a-f0-9]{64}$/;
const APPLICATION = /^PostgREST 14\.10(?: \([a-f0-9]{7,40}\))?$/;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const codes = new Set();
function requireValue(value, code) {
  codes.add(code);
  if (!value) throw new Error(code);
}
function safeError(error) {
  return new Error(
    codes.has(error?.message) ? error.message : 'POSTGREST_EVIDENCE_FAILED',
  );
}
function budget(timeoutMs = 5000) {
  requireValue(
    Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 20000,
    'EVIDENCE_DEADLINE_REJECTED',
  );
  const deadline = performance.now() + Math.min(5000, timeoutMs);
  return () => {
    const left = Math.floor(deadline - performance.now());
    requireValue(left > 0, 'EVIDENCE_DEADLINE_EXCEEDED');
    return left;
  };
}
function dockerCommand(args, remaining) {
  const timeout = remaining();
  return new Promise((resolve, reject) => {
    execFile(
      'docker',
      ['--host', 'unix:///var/run/docker.sock', ...args],
      {
        timeout,
        maxBuffer: MAX_BYTES,
        encoding: 'buffer',
        windowsHide: true,
        env: { PATH: '/usr/local/bin:/usr/bin:/bin' },
      },
      (error, stdout, stderr) => {
        if (error || !Buffer.isBuffer(stdout) || stderr.length)
          reject(new Error('POSTGREST_COMMAND_FAILED'));
        else resolve(stdout);
      },
    );
  });
}
function tarBinary(archive) {
  requireValue(
    Buffer.isBuffer(archive) &&
      archive.length >= 1536 &&
      archive.length <= MAX_BYTES,
    'POSTGREST_ARCHIVE_REJECTED',
  );
  const header = archive.subarray(0, 512);
  const value = (start, end) =>
    header.subarray(start, end).toString('ascii').replace(/\0.*$/s, '');
  const octal = (start, end) => {
    const text = value(start, end).trim();
    requireValue(/^[0-7]+$/.test(text), 'POSTGREST_ARCHIVE_REJECTED');
    return Number.parseInt(text, 8);
  };
  const checksum = header.reduce(
    (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
    0,
  );
  const bytes = octal(124, 136);
  requireValue(
    value(0, 100) === 'postgrest' &&
      !value(345, 500) &&
      [0, 48].includes(header[156]) &&
      !value(157, 257) &&
      checksum === octal(148, 156) &&
      bytes > 64 &&
      bytes < MAX_BYTES,
    'POSTGREST_ARCHIVE_REJECTED',
  );
  const end = 512 + Math.ceil(bytes / 512) * 512;
  requireValue(
    end + 1024 <= archive.length &&
      archive.subarray(end).every((byte) => byte === 0),
    'POSTGREST_ARCHIVE_REJECTED',
  );
  const binary = archive.subarray(512, 512 + bytes);
  requireValue(
    binary.subarray(0, 6).equals(Buffer.from([127, 69, 76, 70, 2, 1])) &&
      binary.readUInt16LE(18) === 62,
    'POSTGREST_ELF_REJECTED',
  );
  requireValue(
    sha(binary) === POSTGREST_EXECUTABLE_SHA256,
    'POSTGREST_BINARY_CHANGED',
  );
  return POSTGREST_EXECUTABLE_SHA256;
}
function verifyRts(raw) {
  requireValue(sha(raw) === POSTGREST_RTS_SHA256, 'POSTGREST_RTS_CHANGED');
  const fields = Object.fromEntries(
    [
      ...raw
        .toString('utf8')
        .matchAll(/\(\s*"([^"\r\n]+)"\s*,\s*"([^"\r\n]*)"\s*\)/g),
    ].map((match) => [match[1], match[2]]),
  );
  requireValue(
    fields['GHC version'] === '9.4.8' &&
      fields['RTS way'] === 'rts_thr' &&
      fields['Target architecture'] === 'x86_64' &&
      fields['Target OS'] === 'linux',
    'POSTGREST_RTS_REJECTED',
  );
  return fields['GHC version'];
}
function identityKey(identity) {
  requireValue(
    identity &&
      HEX.test(identity.containerId) &&
      identity.imageId === POSTGREST_IMAGE &&
      Number.isSafeInteger(identity.pid) &&
      identity.pid > 0 &&
      typeof identity.startedAt === 'string' &&
      Number.isFinite(Date.parse(identity.startedAt)),
    'POSTGREST_IDENTITY_REJECTED',
  );
  return JSON.stringify([
    identity.containerId,
    identity.imageId,
    identity.pid,
    identity.startedAt,
  ]);
}
function closedPort(port, remaining) {
  return new Promise((resolve, reject) => {
    const connection = net.createConnection({ host: '127.0.0.1', port });
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      connection.destroy();
      if (error) reject(error);
      else resolve();
    };
    connection.setTimeout(remaining());
    connection.once('connect', () =>
      finish(new Error('POSTGREST_PRODUCER_ACTIVE')),
    );
    connection.once('timeout', () =>
      finish(new Error('POSTGREST_PORT_UNCONFIRMED')),
    );
    connection.once('error', (error) =>
      finish(
        error.code === 'ECONNREFUSED'
          ? null
          : new Error('POSTGREST_PORT_UNCONFIRMED'),
      ),
    );
  });
}

/** Returns private callbacks for stopPlannedServices. Call close() in finally. */
export async function createPostgrestEvidence({
  runtimePath,
  docker = engineRequest,
}) {
  let pool;
  let closed = false;
  let failed = false;
  let anchor;
  let inFlight = false;
  try {
    const stat = await lstat(runtimePath);
    requireValue(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024,
      'POSTGREST_RUNTIME_REJECTED',
    );
    const state = JSON.parse(await readFile(runtimePath, 'utf8'));
    assertRuntimeTarget(state, target);
    requireValue(
      new URL(state.migrationUrl).hostname === '127.0.0.1',
      'POSTGREST_RUNTIME_REJECTED',
    );
    pool = new pg.Pool({
      connectionString: state.migrationUrl,
      max: 1,
      connectionTimeoutMillis: 1000,
      idleTimeoutMillis: 1000,
      options: '-c default_transaction_read_only=on -c statement_timeout=1500',
      application_name: 'alunza-postgrest-stop-evidence',
    });
    pool.on('error', () => {
      failed = true;
    });
  } catch (error) {
    throw safeError(error);
  }

  async function close() {
    if (closed) return;
    closed = true;
    try {
      await pool.end();
    } catch {
      throw new Error('POSTGREST_POOL_CLOSE_FAILED');
    }
  }
  async function query(text, values, remaining) {
    const timeout = Math.min(1500, remaining());
    let timer;
    try {
      return await Promise.race([
        pool.query({ text, values, query_timeout: timeout }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('POSTGREST_DB_TIMEOUT')),
            timeout,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function inspect(identity, stopped, remaining) {
    const raw = await docker({
      path: `/containers/${identity.containerId}/json`,
      timeoutMs: remaining(),
    });
    requireValue(
      raw.Id === identity.containerId &&
        raw.Image === identity.imageId &&
        raw.Name === `/supabase_rest_${target.projectId}` &&
        raw.Config?.Labels?.['com.supabase.cli.project'] === target.projectId &&
        raw.State?.StartedAt === identity.startedAt &&
        !raw.State.OOMKilled,
      'POSTGREST_CONTAINER_CHANGED',
    );
    requireValue(
      raw.HostConfig?.Privileged === false &&
        raw.HostConfig.AutoRemove === false &&
        !raw.HostConfig.PidMode &&
        raw.HostConfig.Init !== true &&
        (!raw.Config.Entrypoint || raw.Config.Entrypoint.length === 0) &&
        ['/bin/postgrest', 'postgrest'].includes(raw.Path) &&
        Array.isArray(raw.Args) &&
        raw.Args.length === 0,
      'POSTGREST_DIRECT_PROCESS_REQUIRED',
    );
    requireValue(
      raw.State.Running === !stopped &&
        raw.State.Pid === (stopped ? 0 : identity.pid),
      'POSTGREST_PROCESS_STATE_CHANGED',
    );
    const network = await docker({
      path: `/networks/${target.networkName}`,
      timeoutMs: remaining(),
    });
    requireValue(
      HEX.test(network.Id) &&
        network.Name === target.networkName &&
        network.Driver === 'bridge' &&
        network.Labels?.['alunza.project'] === target.projectId &&
        network.Options?.['com.docker.network.bridge.host_binding_ipv4'] ===
          '127.0.0.1',
      'POSTGREST_NETWORK_REJECTED',
    );
    const networks = raw.NetworkSettings?.Networks;
    requireValue(
      networks &&
        Object.keys(networks).length === 1 &&
        networks[target.networkName]?.NetworkID === network.Id,
      'POSTGREST_NETWORK_REJECTED',
    );
    return {
      raw,
      networkId: network.Id,
      ip: networks[target.networkName].IPAddress,
    };
  }
  async function callback(operation) {
    requireValue(
      !closed && !failed && !inFlight,
      'POSTGREST_EVIDENCE_UNAVAILABLE',
    );
    inFlight = true;
    try {
      return await operation();
    } catch (error) {
      failed = true;
      try {
        await close();
      } catch {
        /* Primary evidence failure still prevents acceptance. */
      }
      throw safeError(error);
    } finally {
      inFlight = false;
    }
  }

  return {
    before: (identity, { timeoutMs = 5000 } = {}) =>
      callback(async () => {
        const key = identityKey(identity);
        requireValue(!anchor, 'POSTGREST_BEFORE_ALREADY_CAPTURED');
        const remaining = budget(timeoutMs);
        const observed = await inspect(identity, false, remaining);
        requireValue(net.isIP(observed.ip) === 4, 'POSTGREST_IP_REJECTED');
        const kong = await docker({
          path: `/containers/supabase_kong_${target.projectId}/json`,
          timeoutMs: remaining(),
        });
        requireValue(
          kong.Name === `/supabase_kong_${target.projectId}` &&
            kong.Config?.Labels?.['com.supabase.cli.project'] ===
              target.projectId &&
            kong.State?.Running === false &&
            kong.State.Pid === 0,
          'POSTGREST_INGRESS_ACTIVE',
        );
        await Promise.all(
          [3300, 4300, 4301, 4302].map((port) => closedPort(port, remaining)),
        );
        let namespacePid1;
        try {
          const status = await readFile(`/proc/${identity.pid}/status`, 'utf8');
          const row = status.match(/^NSpid:\s+([0-9\t ]+)$/m);
          const ids = row?.[1].trim().split(/\s+/).map(Number);
          namespacePid1 =
            ids?.length >= 2 && ids[0] === identity.pid && ids.at(-1) === 1;
        } catch (error) {
          if (!['EACCES', 'EPERM'].includes(error.code)) throw error;
          // Docker's isolated PID namespace + no init + direct sole process binds
          // State.Pid to namespace PID1 when procfs metadata is restricted.
          const top = await docker({
            path: `/containers/${identity.containerId}/top?ps_args=-eo%20pid,comm`,
            timeoutMs: remaining(),
          });
          namespacePid1 =
            Array.isArray(top.Titles) &&
            top.Titles.join(',') === 'PID,COMMAND' &&
            top.Processes?.length === 1 &&
            top.Processes[0][0] === String(identity.pid) &&
            top.Processes[0][1] === 'postgrest';
        }
        requireValue(namespacePid1, 'POSTGREST_NAMESPACE_PID_REJECTED');
        const executableSha256 = tarBinary(
          await dockerCommand(
            ['cp', '-L', `${identity.containerId}:/bin/postgrest`, '-'],
            remaining,
          ),
        );
        const ghcVersion = verifyRts(
          await dockerCommand(
            [
              'exec',
              '--env',
              'GHCRTS=',
              identity.containerId,
              '/bin/postgrest',
              '+RTS',
              '--info',
              '-RTS',
              '--version',
            ],
            remaining,
          ),
        );
        const { rows } = await query(
          `SELECT pid, application_name, state
        FROM pg_catalog.pg_stat_activity WHERE client_addr=$1::inet ORDER BY pid`,
          [observed.ip],
          remaining,
        );
        requireValue(
          rows.length > 0 &&
            rows.every(
              (row) =>
                Number.isSafeInteger(row.pid) &&
                row.pid > 0 &&
                APPLICATION.test(row.application_name),
            ),
          'POSTGREST_SESSIONS_UNVERIFIED',
        );
        const names = new Set(rows.map((row) => row.application_name));
        requireValue(names.size === 1, 'POSTGREST_APPLICATION_CHANGED');
        const active = rows.filter((row) => row.state !== 'idle').length;
        requireValue(active === 0, 'POSTGREST_SESSIONS_ACTIVE');
        const stable = await inspect(identity, false, remaining);
        requireValue(
          stable.ip === observed.ip && stable.networkId === observed.networkId,
          'POSTGREST_NETWORK_CHANGED',
        );
        remaining();
        const applicationName = rows[0].application_name;
        anchor = {
          key,
          ip: observed.ip,
          networkId: observed.networkId,
          applicationName,
          pids: rows.map((row) => row.pid),
        };
        return {
          connections: rows.length,
          active,
          applicationName,
          executableSha256,
          ghcVersion,
          directBinary: true,
          namespacePid1,
          initDisabled: true,
          quiescent: true,
        };
      }),
    after: (identity, { timeoutMs = 5000 } = {}) =>
      callback(async () => {
        const remaining = budget(timeoutMs);
        requireValue(
          anchor && anchor.key === identityKey(identity),
          'POSTGREST_AFTER_IDENTITY_REJECTED',
        );
        const observed = await inspect(identity, true, remaining);
        requireValue(
          observed.networkId === anchor.networkId,
          'POSTGREST_NETWORK_CHANGED',
        );
        const { rows } = await query(
          `SELECT
        count(*) FILTER (WHERE client_addr=$1::inet)::integer AS connections,
        count(*) FILTER (WHERE pid=ANY($2::integer[]))::integer AS captured
        FROM pg_catalog.pg_stat_activity WHERE client_addr=$1::inet OR pid=ANY($2::integer[])`,
          [anchor.ip, anchor.pids],
          remaining,
        );
        requireValue(
          rows.length === 1 &&
            rows[0].connections === 0 &&
            rows[0].captured === 0,
          'POSTGREST_CONNECTIONS_REMAIN',
        );
        remaining();
        return {
          applicationName: anchor.applicationName,
          connections: 0,
          capturedPidsRemaining: 0,
        };
      }),
    close,
  };
}
