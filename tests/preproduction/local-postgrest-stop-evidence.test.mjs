import { jest, describe, beforeEach, test, expect } from '@jest/globals';
import { EventEmitter } from 'node:events';
import * as realCrypto from 'node:crypto';
import realNet from 'node:net';

const IMAGE =
  'sha256:bca3f86f69d8ef7aa1e5ee65e66ce9a20c6c147be637517a7be8399e102901d1';
const ELF_SHA =
  'f7934270752251bf27cb0f2cb60b3adefcde484dec3cfb0b5cd3a9deda07a62c';
const RTS_SHA =
  '6efb86a7cc83acc0043816e13cf3f814b20661122323fd3e0f24c42a2a7bdf56';
const PROJECT = 'alunza-edu-laboratorio-physical-test';
const NETWORK = 'alunza-laboratorio-physical-test-local';
const ID = 'a'.repeat(64),
  NETWORK_ID = 'b'.repeat(64);
const identity = {
  containerId: ID,
  imageId: IMAGE,
  pid: 123,
  startedAt: '2026-11-18T04:00:00.000000000Z',
};
const binary = Buffer.alloc(1024);
Buffer.from([127, 69, 76, 70, 2, 1]).copy(binary);
binary.writeUInt16LE(62, 18);
const rts = Buffer.from(
  '[ ("GHC version", "9.4.8"), ("RTS way", "rts_thr"), ("Target architecture", "x86_64"), ("Target OS", "linux") ]\n',
);
function archive() {
  const header = Buffer.alloc(512);
  header.write('postgrest');
  header.write(binary.length.toString(8).padStart(11, '0') + '\0', 124);
  header[156] = 48;
  header.fill(32, 148, 156);
  const checksum = header.reduce((sum, value) => sum + value, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, binary, Buffer.alloc(1024)]);
}
let state;
const poolQuery = jest.fn(async () => ({ rows: state.rows }));
const poolEnd = jest.fn(async () => {});
const poolOn = jest.fn();
const Pool = jest.fn(function () {
  return { query: poolQuery, end: poolEnd, on: poolOn };
});
const exec = jest.fn((file, args, options, callback) => {
  const output = args.includes('cp') ? state.archive : state.rts;
  globalThis.queueMicrotask(() =>
    callback(state.commandError, output, Buffer.alloc(0)),
  );
  return { kill: jest.fn() };
});
const fileRead = jest.fn(async (path) => {
  if (path === '/private/runtime.json') return JSON.stringify(state.runtime);
  if (path === '/proc/123/status') {
    if (state.procError)
      throw Object.assign(new Error('private host path'), {
        code: state.procError,
      });
    return state.procStatus;
  }
  throw new Error('unexpected file');
});
const sockets = [];
const connect = jest.fn(({ port }) => {
  const socket = new EventEmitter();
  socket.setTimeout = jest.fn();
  socket.destroy = jest.fn();
  sockets.push(socket);
  globalThis.queueMicrotask(() => {
    if (state.openPort === port) socket.emit('connect');
    else
      socket.emit(
        'error',
        Object.assign(new Error('private network message'), {
          code: 'ECONNREFUSED',
        }),
      );
  });
  return socket;
});
jest.unstable_mockModule('node:child_process', () => ({ execFile: exec }));
jest.unstable_mockModule('node:fs/promises', () => ({
  lstat: jest.fn(async () => ({
    isFile: () => !state.badFile,
    isSymbolicLink: () => false,
    size: 200,
  })),
  readFile: fileRead,
}));
jest.unstable_mockModule('node:net', () => ({
  default: { isIP: realNet.isIP, createConnection: connect },
}));
jest.unstable_mockModule('pg', () => ({ default: { Pool } }));
jest.unstable_mockModule('../../scripts/local-service-stop.mjs', () => ({
  engineRequest: jest.fn(),
}));
// The installed 20+MiB binary is not committed as a fixture. This hash adapter
// substitutes only the two fixed synthetic fixtures; all other bytes use SHA256.
jest.unstable_mockModule('node:crypto', () => ({
  createHash: (algorithm) => {
    let bytes;
    return {
      update(value) {
        bytes = value;
        return this;
      },
      digest(encoding) {
        if (Buffer.isBuffer(bytes) && bytes.equals(binary))
          return state.badBinary ? '0'.repeat(64) : ELF_SHA;
        if (Buffer.isBuffer(bytes) && bytes.equals(state.rts))
          return state.badRts ? '0'.repeat(64) : RTS_SHA;
        return realCrypto.createHash(algorithm).update(bytes).digest(encoding);
      },
    };
  },
}));
const { createPostgrestEvidence } =
  await import('../../scripts/local-postgrest-stop-evidence.mjs');
function container() {
  return {
    Id: ID,
    Image: state.image,
    Name: `/supabase_rest_${PROJECT}`,
    Path: state.path,
    Args: [],
    Config: { Labels: { 'com.supabase.cli.project': PROJECT }, Entrypoint: [] },
    HostConfig: {
      Privileged: false,
      AutoRemove: false,
      PidMode: '',
      Init: null,
    },
    State: {
      Running: !state.stopped,
      Pid: state.stopped ? 0 : 123,
      StartedAt: identity.startedAt,
      OOMKilled: false,
    },
    NetworkSettings: {
      Networks: {
        [NETWORK]: {
          NetworkID: NETWORK_ID,
          IPAddress: state.stopped ? '' : '172.20.0.3',
        },
      },
    },
  };
}
const docker = jest.fn(async ({ path }) => {
  if (path === `/containers/${ID}/json`) return container();
  if (path === `/networks/${NETWORK}`)
    return {
      Id: NETWORK_ID,
      Name: NETWORK,
      Driver: 'bridge',
      Labels: { 'alunza.project': PROJECT },
      Options: { 'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1' },
    };
  if (path === `/containers/supabase_kong_${PROJECT}/json`)
    return {
      Name: `/supabase_kong_${PROJECT}`,
      Config: { Labels: { 'com.supabase.cli.project': PROJECT } },
      State: { Running: state.kongRunning, Pid: state.kongRunning ? 44 : 0 },
    };
  if (path.endsWith('/top?ps_args=-eo%20pid,comm'))
    return {
      Titles: ['PID', 'COMMAND'],
      Processes: [['123', state.topCommand]],
    };
  throw new Error('unexpected Docker endpoint');
});
const create = () =>
  createPostgrestEvidence({ runtimePath: '/private/runtime.json', docker });
beforeEach(() => {
  jest.clearAllMocks();
  sockets.length = 0;
  poolEnd.mockResolvedValue(undefined);
  poolQuery.mockImplementation(async () => ({ rows: state.rows }));
  state = {
    runtime: {
      projectId: PROJECT,
      authUrl: 'http://127.0.0.1:18421',
      migrationUrl: 'postgresql://user:TEST_SECRET@127.0.0.1:18422/postgres',
    },
    image: IMAGE,
    path: '/bin/postgrest',
    archive: archive(),
    rts,
    procStatus: 'Name:\tpostgrest\nNSpid:\t123\t1\n',
    topCommand: 'postgrest',
    stopped: false,
    kongRunning: false,
    rows: [{ pid: 900, application_name: 'PostgREST 14.10', state: 'idle' }],
  };
});

describe('pinned PostgREST shutdown evidence', () => {
  test('observes positive quiescent sessions then retirement through fresh readonly queries', async () => {
    const evidence = await create();
    const before = await evidence.before(identity);
    expect(before).toEqual({
      connections: 1,
      active: 0,
      applicationName: 'PostgREST 14.10',
      executableSha256: ELF_SHA,
      ghcVersion: '9.4.8',
      directBinary: true,
      namespacePid1: true,
      initDisabled: true,
      quiescent: true,
    });
    state.stopped = true;
    state.rows = [{ connections: 0, captured: 0 }];
    expect(await evidence.after(identity)).toEqual({
      applicationName: 'PostgREST 14.10',
      connections: 0,
      capturedPidsRemaining: 0,
    });
    expect(Pool.mock.calls[0][0]).toMatchObject({
      max: 1,
      options: '-c default_transaction_read_only=on -c statement_timeout=1500',
    });
    expect(poolQuery.mock.calls).toHaveLength(2);
    expect(
      poolQuery.mock.calls.every(([query]) =>
        query.text.trim().startsWith('SELECT'),
      ),
    ).toBe(true);
    expect(poolQuery.mock.calls[1][0].values).toEqual(['172.20.0.3', [900]]);
    expect(exec.mock.calls.map(([, args]) => args.slice(2))).toEqual([
      ['cp', '-L', `${ID}:/bin/postgrest`, '-'],
      [
        'exec',
        '--env',
        'GHCRTS=',
        ID,
        '/bin/postgrest',
        '+RTS',
        '--info',
        '-RTS',
        '--version',
      ],
    ]);
    expect(
      exec.mock.calls.every(
        ([, , options]) =>
          options.timeout <= 5000 && options.maxBuffer === 32 * 1024 * 1024,
      ),
    ).toBe(true);
    expect(connect.mock.calls.map(([value]) => value.port)).toEqual([
      3300, 4300, 4301, 4302,
    ]);
    expect(
      sockets.every((socket) => socket.destroy.mock.calls.length === 1),
    ).toBe(true);
    await evidence.close();
    await evidence.close();
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['foreign project', { projectId: 'alunza-edu-laboratorio-test' }],
    [
      'foreign database',
      { migrationUrl: 'postgresql://user:TEST_SECRET@remote:18422/postgres' },
    ],
    [
      'wrong port',
      {
        migrationUrl: 'postgresql://user:TEST_SECRET@127.0.0.1:17422/postgres',
      },
    ],
    [
      'URL options',
      {
        migrationUrl:
          'postgresql://user:TEST_SECRET@127.0.0.1:18422/postgres?options=unsafe',
      },
    ],
  ])(
    'rejects %s runtime before opening a pool or using Docker',
    async (_, mutation) => {
      Object.assign(state.runtime, mutation);
      await expect(create()).rejects.toThrow('POSTGREST_EVIDENCE_FAILED');
      expect(Pool).not.toHaveBeenCalled();
      expect(docker).not.toHaveBeenCalled();
    },
  );

  test.each([
    [
      'image drift',
      () => {
        state.image = 'sha256:' + 'c'.repeat(64);
      },
      'POSTGREST_CONTAINER_CHANGED',
    ],
    [
      'wrapper',
      () => {
        state.path = '/bin/sh';
      },
      'POSTGREST_DIRECT_PROCESS_REQUIRED',
    ],
    [
      'namespace pid',
      () => {
        state.procStatus = 'NSpid:\t123\t2\n';
      },
      'POSTGREST_NAMESPACE_PID_REJECTED',
    ],
    [
      'binary drift',
      () => {
        state.badBinary = true;
      },
      'POSTGREST_BINARY_CHANGED',
    ],
    [
      'RTS drift',
      () => {
        state.badRts = true;
      },
      'POSTGREST_RTS_CHANGED',
    ],
    [
      'compiler mismatch',
      () => {
        state.rts = Buffer.from(rts.toString().replace('9.4.8', '9.6.7'));
      },
      'POSTGREST_RTS_REJECTED',
    ],
    [
      'active ingress',
      () => {
        state.kongRunning = true;
      },
      'POSTGREST_INGRESS_ACTIVE',
    ],
    [
      'vacuous sessions',
      () => {
        state.rows = [];
      },
      'POSTGREST_SESSIONS_UNVERIFIED',
    ],
    [
      'foreign application',
      () => {
        state.rows[0].application_name = 'other';
      },
      'POSTGREST_SESSIONS_UNVERIFIED',
    ],
    [
      'active transaction',
      () => {
        state.rows[0].state = 'idle in transaction';
      },
      'POSTGREST_SESSIONS_ACTIVE',
    ],
  ])('rejects %s and closes its pool', async (_, mutation, code) => {
    const evidence = await create();
    mutation();
    await expect(evidence.before(identity)).rejects.toThrow(code);
    expect(poolEnd).toHaveBeenCalledTimes(1);
    await evidence.close();
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  test('denied procfs requires an isolated sole direct process from Docker top', async () => {
    const evidence = await create();
    state.procError = 'EACCES';
    expect((await evidence.before(identity)).namespacePid1).toBe(true);
    await evidence.close();
  });
  test('procfs fallback rejects a wrapper even if metadata claims PostgREST', async () => {
    const evidence = await create();
    state.procError = 'EACCES';
    state.topCommand = 'sh';
    await expect(evidence.before(identity)).rejects.toThrow(
      'POSTGREST_NAMESPACE_PID_REJECTED',
    );
  });
  test('an open API port blocks evidence and destroys all probe sockets', async () => {
    const evidence = await create();
    state.openPort = 4301;
    await expect(evidence.before(identity)).rejects.toThrow(
      'POSTGREST_EVIDENCE_FAILED',
    );
    expect(exec).not.toHaveBeenCalled();
    expect(poolEnd).toHaveBeenCalledTimes(1);
    expect(
      sockets.every((socket) => socket.destroy.mock.calls.length === 1),
    ).toBe(true);
  });
  test('remaining captured backend rejects retirement even with zero current IP matches', async () => {
    const evidence = await create();
    await evidence.before(identity);
    state.stopped = true;
    state.rows = [{ connections: 0, captured: 1 }];
    await expect(evidence.after(identity)).rejects.toThrow(
      'POSTGREST_CONNECTIONS_REMAIN',
    );
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });
  test('after cannot borrow evidence from another process generation', async () => {
    const evidence = await create();
    await evidence.before(identity);
    state.stopped = true;
    await expect(evidence.after({ ...identity, pid: 124 })).rejects.toThrow(
      'POSTGREST_AFTER_IDENTITY_REJECTED',
    );
  });
  test('pool query failures are sanitized and release the connection pool', async () => {
    const evidence = await create();
    poolQuery.mockRejectedValue(new Error('password=TEST_SECRET SQL private'));
    await expect(evidence.before(identity)).rejects.toThrow(
      'POSTGREST_EVIDENCE_FAILED',
    );
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });
  test('close failure is explicit and never emits the underlying connection string', async () => {
    const evidence = await create();
    poolEnd.mockRejectedValue(new Error('TEST_SECRET'));
    await expect(evidence.close()).rejects.toThrow(
      'POSTGREST_POOL_CLOSE_FAILED',
    );
  });
  test('malformed tar, including a second file, is rejected before RTS execution', async () => {
    const evidence = await create();
    state.archive[1536] = 1;
    await expect(evidence.before(identity)).rejects.toThrow(
      'POSTGREST_ARCHIVE_REJECTED',
    );
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
