import { describe, it, expect, jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createStopPlan,
  stopPlannedServices,
  assessPostgrestInterrupt,
  engineRequest,
  main,
  POSTGREST_IMAGE,
  POSTGREST_ELF,
  STOP_DEADLINE_MS,
} from '../../scripts/local-service-stop.mjs';
import { physicalTestTarget as target } from '../../scripts/local-target.mjs';

const id = (n) => n.toString(16).padStart(64, '0');
const epoch = Date.parse('2026-11-18T00:00:00.000Z');
const clone = (value) => globalThis.structuredClone(value);
function frame(line) {
  const bytes = Buffer.from(line),
    header = Buffer.alloc(8);
  header[0] = 2;
  header.writeUInt32BE(bytes.length, 4);
  return Buffer.concat([header, bytes]);
}
function fixture(options = {}) {
  let clock = 0,
    execFor,
    signalAt;
  const requests = [],
    mutations = [];
  const network = {
    Id: id(10),
    Name: target.networkName,
    Driver: 'bridge',
    Labels: { 'alunza.project': target.projectId },
    Options: { 'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1' },
  };
  const containers = Object.fromEntries(
    ['kong', 'rest'].map((role, i) => [
      role,
      {
        Id: id(i + 1),
        Name: `/supabase_${role}_${target.projectId}`,
        Image: role === 'rest' ? POSTGREST_IMAGE : `sha256:${id(9)}`,
        Config: {
          Labels: { 'com.supabase.cli.project': target.projectId },
          Env: ['SECRET=PRIVATE_SENTINEL'],
          Entrypoint: ['PRIVATE_SCRIPT'],
        },
        HostConfig: {
          AutoRemove: false,
          Privileged: false,
          PidMode: '',
          Init: false,
          RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
          PortBindings:
            role === 'kong'
              ? { '8000/tcp': [{ HostIp: '', HostPort: '18421' }] }
              : {},
        },
        NetworkSettings: {
          Networks: { [target.networkName]: { NetworkID: id(10) } },
          Ports:
            role === 'kong'
              ? {
                  '8000/tcp': [{ HostIp: '127.0.0.1', HostPort: '18421' }],
                  '8443/tcp': null,
                }
              : {},
        },
        Mounts: [
          {
            Type: 'volume',
            Name: 'owned-volume',
            Source: '/private/volume',
            Destination: '/data',
            RW: true,
          },
          {
            Type: 'bind',
            Source: '/private/config',
            Destination: '/config',
            RW: false,
          },
        ],
        RestartCount: 0,
        State: {
          Running: true,
          Status: 'running',
          Pid: 300 + i,
          ExitCode: 0,
          OOMKilled: false,
          Paused: false,
          Restarting: false,
          StartedAt: new Date(epoch - 10000).toISOString(),
          FinishedAt: '0001-01-01T00:00:00Z',
        },
      },
    ]),
  );
  function stop(c, exitCode) {
    c.State.Running = false;
    c.State.Status = 'exited';
    c.State.Pid = 0;
    c.State.ExitCode = exitCode;
    c.State.FinishedAt = new Date(epoch + clock).toISOString();
  }
  const before = {
    connections: 1,
    active: 0,
    applicationName: 'PostgREST 14.10',
    executableSha256: POSTGREST_ELF,
    directBinary: true,
    namespacePid1: true,
    initDisabled: true,
    quiescent: true,
    ghcVersion: '9.4.8',
  };
  const after = {
    connections: 0,
    applicationName: 'PostgREST 14.10',
    capturedPidsRemaining: 0,
  };
  const postgrest = {
    before: jest.fn(async () => clone(before)),
    after: jest.fn(async () => clone(after)),
  };
  const events = () =>
    Buffer.from(
      [
        {
          Action: 'kill',
          Actor: { ID: containers.rest.Id, Attributes: { signal: '15' } },
          timeNano: (epoch + signalAt) * 1e6,
        },
        {
          Action: 'die',
          Actor: { ID: containers.rest.Id, Attributes: { exitCode: '255' } },
          timeNano: (epoch + signalAt + 1) * 1e6,
        },
      ]
        .map(JSON.stringify)
        .join('\n'),
    );
  const docker = async (request) => {
    requests.push(clone(request));
    clock += options.commandMs ?? 1;
    const path = request.path,
      parts = path.split('/'),
      c = Object.values(containers).find(
        (x) => x.Id === parts[2] || x.Name.slice(1) === parts[2],
      );
    if (request.method === 'POST') mutations.push(clone(request));
    if (path === '/version') return { Os: 'linux', Version: '29.1.3' };
    if (path.startsWith('/networks/')) return clone(network);
    if (path.includes('/top?'))
      return {
        Titles: ['PID', 'COMMAND', 'COMMAND'],
        Processes: [
          [
            '300',
            'nginx',
            'nginx: master process /usr/local/openresty/nginx/sbin/nginx -p /usr/local/kong -c nginx.conf',
          ],
        ],
      };
    if (path.startsWith('/containers/') && path.endsWith('/json'))
      return clone(c);
    if (path.endsWith('/update')) {
      if (options.restoreFailure && request.body.RestartPolicy.Name !== 'no')
        throw new Error('PRIVATE_RESTORE_SECRET');
      c.HostConfig.RestartPolicy = clone(request.body.RestartPolicy);
      return {};
    }
    if (path.endsWith('/exec')) {
      execFor = c;
      if (options.restartAfterExec) {
        c.State.StartedAt = new Date(epoch).toISOString();
        c.RestartCount++;
      }
      return { Id: id(50) };
    }
    if (path.startsWith('/exec/') && path.endsWith('/start')) {
      if (!options.hangKong) stop(execFor, 0);
      return null;
    }
    if (path.startsWith('/exec/') && path.endsWith('/json'))
      return { ContainerID: execFor.Id, Running: false, ExitCode: 0 };
    if (path.includes('/kill?signal=SIGCONT')) return null;
    if (path.includes('/kill?signal=SIGTERM')) {
      signalAt = clock;
      stop(c, options.restExit ?? 255);
      clock++;
      return null;
    }
    if (path.includes('/logs?') || path.startsWith('/events?')) {
      const query = new URL(path, 'http://engine.test').searchParams;
      if (
        !['since', 'until'].every((key) =>
          /^\d+(?:\.\d{1,9})?$/.test(query.get(key)),
        )
      )
        throw new Error('ENGINE_UNIX_SECONDS_REQUIRED');
    }
    if (path.includes('/logs?'))
      return frame(
        `${new Date(epoch + signalAt).toISOString()} Received termination unix signal SIGTERM\n`,
      );
    if (path.startsWith('/events?')) return events();
    throw new Error('Unexpected test endpoint');
  };
  return {
    docker,
    containers,
    network,
    requests,
    mutations,
    before,
    after,
    postgrest,
    now: () => clock,
    wallNow: () => new Date(epoch + clock).toISOString(),
    sleep: async (ms) => {
      clock += ms;
    },
    setClock: (value) => {
      clock = value;
    },
  };
}

describe('bounded physical TEST service shutdown without Docker or services', () => {
  it('uses fractional Unix seconds for Engine queries while rejecting ISO query values', async () => {
    const f = fixture(),
      plan = await createStopPlan(f);
    for (const path of [`/containers/${id(2)}/logs`, '/events']) {
      await expect(
        f.docker({
          path: `${path}?since=${encodeURIComponent(new Date(epoch).toISOString())}&until=${epoch / 1000 + 1}`,
        }),
      ).rejects.toThrow('ENGINE_UNIX_SECONDS_REQUIRED');
    }
    f.requests.length = 0;
    expect((await stopPlannedServices(plan, f)).pass).toBe(true);
    const queries = f.requests.filter(
      (r) => r.path.includes('/logs?') || r.path.startsWith('/events?'),
    );
    expect(queries).toHaveLength(2);
    for (const request of queries) {
      const query = new URL(request.path, 'http://engine.test').searchParams;
      expect(Number(query.get('since'))).toBeGreaterThan(epoch / 1000);
      expect(Number(query.get('until'))).toBeLessThan(epoch / 1000 + 20);
      expect(query.get('since')).toMatch(/^\d+\.\d+$/);
    }
  });
  it('plans metadata only, accepts inherited loopback and preserves raw configuration behind hashes', async () => {
    const f = fixture(),
      plan = await createStopPlan(f);
    expect(f.mutations).toHaveLength(0);
    expect(JSON.stringify(plan)).not.toMatch(
      /PRIVATE_SENTINEL|PRIVATE_SCRIPT|SECRET=/,
    );
    expect(plan.containers[0].portBindings['8000/tcp'][0].HostIp).toBe(
      '127.0.0.1',
    );
    expect(plan.containers.map((c) => c.name)).toEqual(
      ['kong', 'rest'].map((r) => `/supabase_${r}_${target.projectId}`),
    );
  });
  it('uses Engine CONT then native nginx QUIT; validates expected255 without changing exit code or claiming durable flag', async () => {
    const f = fixture(),
      plan = await createStopPlan(f),
      result = await stopPlannedServices(plan, f);
    expect(result.pass).toBe(true);
    expect(result.services[1].state.exitCode).toBe(255);
    expect(result.services[1].classification.classification).toBe(
      'expected-interrupt-255',
    );
    expect(
      result.services.every(
        (s) => s.policyRestored && !s.durableManualStopMarkerVerified,
      ),
    ).toBe(true);
    const commands = f.mutations.map((r) => r.path);
    expect(
      commands.indexOf(`/containers/${id(1)}/kill?signal=SIGCONT`),
    ).toBeLessThan(commands.indexOf(`/containers/${id(1)}/exec`));
    expect(JSON.stringify(f.mutations)).not.toMatch(
      /SIGKILL|signal=9|\/stop|\/restart|\/remove|prune/,
    );
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE_SENTINEL|PRIVATE_SCRIPT|SECRET=/,
    );
  });
  it.each([
    'label',
    'image',
    'config',
    'mount',
    'network',
    'effectivePort',
    'defaultBinding',
  ])('rejects changed %s before any mutation', async (change) => {
    const f = fixture(),
      plan = await createStopPlan(f);
    if (change === 'label')
      f.containers.kong.Config.Labels['com.supabase.cli.project'] = 'other';
    if (change === 'image') f.containers.kong.Image = `sha256:${id(77)}`;
    if (change === 'config') f.containers.kong.Config.Env.push('CHANGED=yes');
    if (change === 'mount') f.containers.kong.Mounts[0].Name = 'other-volume';
    if (change === 'network') f.network.Id = id(88);
    if (change === 'effectivePort')
      f.containers.kong.NetworkSettings.Ports['8000/tcp'][0].HostIp = '0.0.0.0';
    if (change === 'defaultBinding')
      f.network.Options['com.docker.network.bridge.host_binding_ipv4'] =
        '0.0.0.0';
    const result = await stopPlannedServices(plan, f);
    expect(result.pass).toBe(false);
    expect(f.mutations).toHaveLength(0);
  });
  it('accepts a reordered mount inventory but refuses a new process generation between exec creation and start', async () => {
    const f = fixture({ restartAfterExec: true }),
      plan = await createStopPlan(f);
    f.containers.kong.Mounts.reverse();
    const result = await stopPlannedServices(plan, f);
    expect(result.pass).toBe(false);
    expect(result.services[0].failures).toContain('PROCESS_GENERATION_CHANGED');
    expect(
      f.mutations.some(
        (r) => r.path.startsWith('/exec/') && r.path.endsWith('/start'),
      ),
    ).toBe(false);
  });
  it('stops waiting at the common20s deadline, restores policy and never escalates', async () => {
    const f = fixture({ hangKong: true }),
      plan = await createStopPlan(f),
      result = await stopPlannedServices(plan, f);
    expect(result.pass).toBe(false);
    expect(result.services[0].failures).toContain('STOP_DEADLINE_EXCEEDED');
    expect(f.containers.kong.HostConfig.RestartPolicy.Name).toBe(
      'unless-stopped',
    );
    expect(result.stopElapsedMs).toBeGreaterThanOrEqual(STOP_DEADLINE_MS);
    expect(JSON.stringify(f.mutations)).not.toMatch(/SIGKILL|signal=9|\/stop/);
    expect(f.mutations.some((r) => r.path.includes('signal=SIGTERM'))).toBe(
      false,
    );
  });
  it('reports policy restoration failure and preserves safe failure codes without provider output', async () => {
    const f = fixture({ restoreFailure: true }),
      plan = await createStopPlan(f),
      result = await stopPlannedServices(plan, f);
    expect(result.pass).toBe(false);
    expect(result.services[0].policyRestored).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_RESTORE_SECRET');
  });
  it('does not accept255,137 or OOM without the complete interruption evidence', async () => {
    for (const change of [
      'hash',
      'namespace',
      'connections',
      'after',
      'ghc',
      '137',
      'oom',
    ]) {
      const f = fixture({ restExit: change === '137' ? 137 : 255 }),
        plan = await createStopPlan(f);
      if (change === 'hash') f.before.executableSha256 = id(99);
      if (change === 'namespace') f.before.namespacePid1 = false;
      if (change === 'connections') f.before.connections = 0;
      if (change === 'after') f.after.connections = 1;
      if (change === 'ghc') f.before.ghcVersion = 'unknown';
      if (change === 'oom') f.containers.rest.State.OOMKilled = true;
      const result = await stopPlannedServices(plan, f);
      expect(result.pass).toBe(false);
    }
  });
  it('rejects a stale termination log and unexpected kill9 rather than inferring an expected exit', async () => {
    const f = fixture(),
      plan = await createStopPlan(f),
      anchor = plan.containers[1];
    const state = {
      ...anchor.initialState,
      running: false,
      pid: 0,
      exitCode: 255,
    };
    const signalAt = new Date(epoch + 10).toISOString(),
      observedAt = new Date(epoch + 30).toISOString();
    const event = (action, attributes) => ({
      Action: action,
      Actor: { ID: anchor.id, Attributes: attributes },
      timeNano: (epoch + 20) * 1e6,
    });
    const base = {
      anchor,
      state,
      before: f.before,
      after: f.after,
      signalAt,
      observedAt,
      logBuffer: frame(
        `${new Date(epoch + 20).toISOString()} Received termination unix signal SIGTERM\n`,
      ),
      eventBuffer: Buffer.from(
        [event('kill', { signal: '15' }), event('die', { exitCode: '255' })]
          .map(JSON.stringify)
          .join('\n'),
      ),
    };
    expect(assessPostgrestInterrupt(base).exitCode).toBe(255);
    expect(() =>
      assessPostgrestInterrupt({
        ...base,
        logBuffer: frame(
          `${new Date(epoch).toISOString()} Received termination unix signal SIGTERM\n`,
        ),
      }),
    ).toThrow('POSTGREST_SIGNAL_EVIDENCE_REJECTED');
    expect(() =>
      assessPostgrestInterrupt({
        ...base,
        eventBuffer: Buffer.concat([
          base.eventBuffer,
          Buffer.from('\n' + JSON.stringify(event('kill', { signal: '9' }))),
        ]),
      }),
    ).toThrow('POSTGREST_SIGNAL_EVIDENCE_REJECTED');
  });
  it('CLI stop without runtime hooks refuses before effects and creates an exclusive receipt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'alunza-stop-test-'));
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const f = fixture(),
        plan = await createStopPlan(f),
        planPath = join(directory, 'plan.json'),
        output = join(directory, 'receipt.json');
      await writeFile(planPath, JSON.stringify(plan));
      expect(
        await main(['stop', '--plan', planPath, '--output', output], {
          docker: f.docker,
        }),
      ).toBe(1);
      const receipt = JSON.parse(await readFile(output, 'utf8'));
      expect(receipt.failures).toContain('POSTGREST_EVIDENCE_HOOKS_REQUIRED');
      expect(f.mutations).toHaveLength(0);
      await expect(
        main(['stop', '--plan', planPath, '--output', output], {
          docker: f.docker,
        }),
      ).rejects.toThrow();
      if (process.platform !== 'win32')
        expect((await stat(output)).mode & 0o777).toBe(0o600);
    } finally {
      log.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('bounds Engine output and never exposes Docker error bodies', async () => {
    for (const [statusCode, bytes, expected] of [
      [500, Buffer.from('PRIVATE_ENGINE_TOKEN'), 'DOCKER_OPERATION_FAILED'],
      [200, Buffer.alloc(1024 * 1024 + 1), 'DOCKER_OUTPUT_LIMIT'],
    ]) {
      const request = (_options, callback) => {
        const req = new EventEmitter();
        req.destroy = () => {};
        req.end = () => {
          Promise.resolve().then(() => {
            const response = new EventEmitter();
            response.statusCode = statusCode;
            response.destroy = () => {};
            callback(response);
            response.emit('data', bytes);
            response.emit('end');
          });
        };
        return req;
      };
      await expect(
        engineRequest(
          { path: '/version' },
          {
            request,
            stat: async () => ({ isSocket: () => true }),
            platform: 'linux',
          },
        ),
      ).rejects.toThrow(expected);
    }
  });
});
