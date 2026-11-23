import { EventEmitter } from 'node:events';
import type { Pool, PoolClient } from 'pg';
import type { AppConfig } from '../config';
import { DatabaseService } from '../database/database.service';
import { ApiError } from './errors';
import {
  PhaseDiagnostics,
  phaseAsync,
  phasePool,
  phaseSync,
} from './phase-diagnostics';
import type { PhaseDiagnosticRuntime } from './phase-diagnostics';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const config = {
  environment: 'test',
  dashboardTimingsEnabled: true,
} as AppConfig;
class Boundary extends EventEmitter {
  statusCode = 200;
}
type RequestRecord = {
  event: string;
  processInstanceId: string;
  requestId: string;
  path: string;
  terminal: string;
  status: number;
  dropped: number;
  spans: Array<{
    name: string;
    outcome: string;
    startMs: number;
    durationMs: number;
  }>;
  pool: { before: unknown; after: unknown };
};
type ProcessRecord = {
  event: string;
  processInstanceId: string;
  elapsedMs: number;
  intervalMs: number;
  observerSelfTimeMs: number;
  final: boolean;
  emission: {
    count: number;
    selfTimeMs: number;
    backpressureEvents: number;
    backpressureMs: number;
    writeErrors: number;
  };
};
function setup(enabled = true) {
  const lines: string[] = [];
  let ticks = 1,
    cpu = 0;
  let drain: (() => void) | undefined;
  const histogram = {
    enable: jest.fn(() => true),
    disable: jest.fn(() => true),
    reset: jest.fn(),
    mean: 1_000_000,
    max: 3_000_000,
    percentile: jest.fn(() => 2_000_000),
  };
  const runtime: PhaseDiagnosticRuntime = {
    now: () => {
      ticks += 0.01;
      return ticks;
    },
    wall: () => 1_790_000_000_000,
    write: jest.fn((line: string) => {
      lines.push(line);
      return true;
    }),
    onDrain: (listener) => {
      drain = listener;
      return () => {
        drain = undefined;
      };
    },
    cpu: () => ({ user: ++cpu * 1000, system: cpu * 200 }),
    memory: () => ({ rss: 10000, heapUsed: 2000 }),
    eventLoop: () => ({ idle: 10, active: 2, utilization: 1 / 6 }),
    histogram: () => histogram,
  };
  const diagnostics = new PhaseDiagnostics(
    { ...config, dashboardTimingsEnabled: enabled },
    runtime,
  );
  return {
    diagnostics,
    runtime,
    lines,
    histogram,
    advance: (ms: number) => {
      ticks += ms;
    },
    drain: () => drain?.(),
    requests: () =>
      lines
        .map((line) => JSON.parse(line) as RequestRecord)
        .filter((r) => r.event === 'PHASE_DIAGNOSTIC_REQUEST'),
    processes: () =>
      lines
        .map((line) => JSON.parse(line) as ProcessRecord)
        .filter((r) => r.event === 'PHASE_DIAGNOSTIC_PROCESS'),
  };
}
function inRequest<T>(
  diagnostics: PhaseDiagnostics,
  requestId: string,
  action: () => Promise<T>,
  path = '/api/v1/classes/:id/dashboard',
): Promise<T> {
  const response = new Boundary();
  return new Promise<T>((resolve, reject) => {
    diagnostics.run(requestId, path, 'GET', response, () => {
      action().then(
        (value) => {
          response.emit('finish');
          response.emit('close');
          resolve(value);
        },
        (error: unknown) => {
          response.statusCode = 503;
          response.emit('finish');
          reject(error);
        },
      );
    });
  });
}
describe('private TEST phase diagnostics', () => {
  afterEach(() => jest.useRealTimers());

  it('is inert by default, including process sampling and arbitrary callers', async () => {
    const test = setup(false);
    test.diagnostics.onModuleInit();
    const action = jest.fn(async () => 'original');
    await expect(
      inRequest(test.diagnostics, firstId, () =>
        phaseAsync('db.action', action),
      ),
    ).resolves.toBe('original');
    test.diagnostics.onModuleDestroy();
    expect(action).toHaveBeenCalledTimes(1);
    expect(test.lines).toEqual([]);
    expect(test.histogram.enable).not.toHaveBeenCalled();
    expect(test.runtime.write).not.toHaveBeenCalled();
  });

  it('rejects forged enabled configuration outside TEST even without loadConfig', () => {
    for (const environment of ['local', 'evaluation', 'production'] as const)
      expect(() => new PhaseDiagnostics({ ...config, environment })).toThrow(
        'ALUNZA_TEST_DASHBOARD_TIMINGS',
      );
  });

  it('isolates overlapping request spans and never retains context for background work', async () => {
    const test = setup();
    let releaseFirst!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = inRequest(test.diagnostics, firstId, () =>
      phaseAsync('db.action', async () => {
        await barrier;
        phasePool('before', { totalCount: 2, idleCount: 1, waitingCount: 0 });
        return phaseSync('dashboard.parse', () => 'first');
      }),
    );
    await expect(
      inRequest(test.diagnostics, secondId, () =>
        phaseAsync('auth.jwt', async () => 'second'),
      ),
    ).resolves.toBe('second');
    releaseFirst();
    await expect(first).resolves.toBe('first');
    await phaseAsync('db.action', async () => 'outside');
    const records = test.requests();
    expect(records).toHaveLength(2);
    expect(
      records.find((r) => r.requestId === firstId)?.spans.map((s) => s.name),
    ).toEqual(['db.action', 'dashboard.parse']);
    expect(
      records.find((r) => r.requestId === secondId)?.spans.map((s) => s.name),
    ).toEqual(['auth.jwt']);
    expect(records[0]?.pool.before).toBeNull();
    expect(records[1]?.pool.before).toEqual({ total: 2, idle: 1, waiting: 0 });
    for (const record of records)
      for (const span of record.spans) {
        expect(span.startMs).toBeGreaterThanOrEqual(0);
        expect(span.durationMs).toBeGreaterThanOrEqual(0);
      }
  });

  it('isolates concurrent progress and dashboard observations with the same schema', async () => {
    const test = setup();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const progress = inRequest(
      test.diagnostics,
      firstId,
      async () => {
        const value = await phaseAsync('progress.query', async () => {
          await barrier;
          return 'progress';
        });
        const parsed = phaseSync('progress.parse', () => value);
        return phaseSync('progress.responseParse', () => parsed);
      },
      '/api/v1/me/progress',
    );
    await expect(
      inRequest(test.diagnostics, secondId, async () => {
        const value = await phaseAsync(
          'dashboard.query',
          async () => 'dashboard',
        );
        return phaseSync('dashboard.parse', () => value);
      }),
    ).resolves.toBe('dashboard');
    release();
    await expect(progress).resolves.toBe('progress');
    const records = test.requests();
    expect(records).toHaveLength(2);
    expect(
      records.find((record) => record.requestId === firstId),
    ).toMatchObject({
      schemaVersion: 1,
      path: '/api/v1/me/progress',
      dropped: 0,
      spans: [
        { name: 'progress.query', outcome: 'ok' },
        { name: 'progress.parse', outcome: 'ok' },
        { name: 'progress.responseParse', outcome: 'ok' },
      ],
    });
    expect(
      records
        .find((record) => record.requestId === secondId)
        ?.spans.map((span) => span.name),
    ).toEqual(['dashboard.query', 'dashboard.parse']);
    expect(records[0]?.processInstanceId).toBe(records[1]?.processInstanceId);
  });

  it.each([
    ['/api/v1/me/progress?classId=private-class&cursor=private-cursor', 'GET'],
    ['/api/v1/me/progress', 'POST'],
    ['/api/v1/me/progress', 'PUT'],
    ['/api/v1/me/progress/private-student', 'GET'],
  ])(
    'does not observe a non-allowlisted progress boundary (%s %s)',
    (path, method) => {
      const test = setup();
      const response = new Boundary();
      const next = jest.fn(() => {
        phaseSync('progress.parse', () => 'private-result');
        response.emit('finish');
      });
      test.diagnostics.run(firstId, path, method, response, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(test.lines).toEqual([]);
    },
  );

  it('keeps original values/errors and calls each action once when observers fail', async () => {
    const test = setup();
    const secretError = new Error(
      'Bearer secret-token actor-secret session-secret SQL-secret',
    );
    const success = jest.fn(async () => ({ private: 'domain-value' }));
    const failure = jest.fn(async () => {
      throw secretError;
    });
    jest.mocked(test.runtime.write).mockImplementation(() => {
      throw new Error('output failed');
    });
    await expect(
      inRequest(test.diagnostics, firstId, () =>
        phaseAsync('db.action', success),
      ),
    ).resolves.toEqual({ private: 'domain-value' });
    await expect(
      inRequest(test.diagnostics, secondId, () =>
        phaseAsync('db.action', failure),
      ),
    ).rejects.toBe(secretError);
    expect(success).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(test.lines).toEqual([]);
  });

  it.each([false, true])(
    'preserves async domain outcomes when the observation clock fails (error=%s)',
    async (reject) => {
      const test = setup();
      const error = new Error('unchanged domain failure');
      const action = jest.fn(async () => {
        test.runtime.now = () => {
          throw new Error('clock unavailable');
        };
        if (reject) throw error;
        return 'unchanged value';
      });
      const result = inRequest(test.diagnostics, firstId, () =>
        phaseAsync('db.action', action),
      );
      if (reject) await expect(result).rejects.toBe(error);
      else await expect(result).resolves.toBe('unchanged value');
      expect(action).toHaveBeenCalledTimes(1);
    },
  );

  it('excludes synchronous product work from ALS overhead and preserves a thrown error', () => {
    const test = setup();
    const response = new Boundary();
    const error = new Error('original next error');
    const next = jest.fn(() => {
      test.advance(1000);
      throw error;
    });
    expect(() =>
      test.diagnostics.run(firstId, '/api/v1/me', 'GET', response, next),
    ).toThrow(error);
    response.statusCode = 500;
    response.emit('finish');
    test.diagnostics.onModuleDestroy();
    expect(next).toHaveBeenCalledTimes(1);
    expect(test.processes().at(-1)!.observerSelfTimeMs).toBeLessThan(1);
  });

  it('allowlists routes, methods and phases and never serializes domain/error data', async () => {
    const test = setup();
    await expect(
      inRequest(test.diagnostics, firstId, () =>
        phaseAsync('db.action', async () => {
          phaseSync('secret-sql-and-token', () => ({
            password: 'secret-password',
          }));
          throw new Error('secret-error');
        }),
      ),
    ).rejects.toThrow('secret-error');
    await inRequest(
      test.diagnostics,
      secondId,
      async () => 'ignored',
      '/api/v1/classes/secret-class/dashboard?token=secret-token',
    );
    const next = jest.fn();
    test.diagnostics.run(
      secondId,
      '/api/v1/classes/:id/dashboard',
      'PUT',
      new Boundary(),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(test.requests()).toHaveLength(1);
    expect(test.requests()[0]).toMatchObject({
      status: 503,
      dropped: 1,
      spans: [{ name: 'db.action', outcome: 'error' }],
    });
    expect(test.lines.join('')).not.toContain('secret-');
  });

  it('bounds span storage, records truncation and emits once on premature close', () => {
    const test = setup();
    const response = new Boundary();
    test.diagnostics.run(firstId, '/api/v1/me', 'GET', response, () => {
      for (let n = 0; n < 70; n++) phaseSync('db.action', () => n);
      response.emit('close');
      phaseSync('db.action', () => 'late');
      response.emit('finish');
    });
    expect(test.requests()).toHaveLength(1);
    expect(test.requests()[0]).toMatchObject({ terminal: 'close', dropped: 6 });
    expect(test.requests()[0]?.spans).toHaveLength(64);
  });

  it('samples at one second, accounts emission/backpressure, partitions processes and stops cleanly', async () => {
    jest.useFakeTimers();
    const test = setup();
    test.diagnostics.onModuleInit();
    jest.mocked(test.runtime.write).mockImplementationOnce((line) => {
      test.lines.push(line);
      return false;
    });
    await inRequest(test.diagnostics, firstId, () =>
      phaseAsync('auth.jwt', async () => 'ok'),
    );
    test.advance(120);
    test.drain();
    test.advance(880);
    jest.advanceTimersByTime(1000);
    expect(test.processes()).toHaveLength(1);
    expect(test.processes()[0]).toMatchObject({
      final: false,
      emission: { count: 1, backpressureEvents: 1, writeErrors: 0 },
    });
    expect(test.processes()[0]!.emission.backpressureMs).toBeGreaterThanOrEqual(
      120,
    );
    expect(test.processes()[0]!.observerSelfTimeMs).toBeGreaterThan(0);
    expect(test.processes()[0]!.observerSelfTimeMs).toBeGreaterThanOrEqual(
      test.processes()[0]!.emission.selfTimeMs,
    );
    test.diagnostics.onModuleDestroy();
    const afterStop = test.lines.length;
    jest.advanceTimersByTime(5000);
    expect(test.lines).toHaveLength(afterStop);
    expect(test.histogram.disable).toHaveBeenCalledTimes(1);
    expect(test.processes().at(-1)?.final).toBe(true);
    expect(test.processes()[0]?.processInstanceId).toBe(
      test.requests()[0]?.processInstanceId,
    );
    const second = setup();
    await inRequest(second.diagnostics, firstId, async () => 'ok');
    expect(second.requests()[0]?.processInstanceId).not.toBe(
      test.requests()[0]?.processInstanceId,
    );
  });
});

describe('diagnostic transaction observation preserves database behavior', () => {
  let database: DatabaseService;
  let client: PoolClient;
  beforeEach(() => {
    database = new DatabaseService({
      databaseUrl: 'postgresql://alunza_app:fixture@127.0.0.1:1/fixture',
      databaseSsl: false,
    } as AppConfig);
    client = {
      on: jest.fn(),
      removeListener: jest.fn(),
      release: jest.fn(),
      query: jest.fn(async (sql: string) => ({
        rows: sql.includes('current_user')
          ? [{ allowed: true }]
          : sql.includes('session_is_active')
            ? [{ valid: true }]
            : [],
      })),
    } as unknown as PoolClient;
    jest
      .spyOn((database as unknown as { pool: Pool }).pool, 'connect')
      .mockResolvedValue(client as never);
  });
  afterEach(async () => {
    await database.onApplicationShutdown();
  });
  it('records the existing authorization/transaction order without exposing its arguments', async () => {
    const test = setup();
    const action = jest.fn(async () => 'result');
    await expect(
      inRequest(test.diagnostics, firstId, () =>
        database.readAs('actor-secret', action, 'session-secret'),
      ),
    ).resolves.toBe('result');
    expect(action).toHaveBeenCalledTimes(1);
    expect(test.requests()[0]?.spans.map((s) => s.name)).toEqual([
      'db.pool',
      'db.begin',
      'db.role',
      'db.context',
      'db.session',
      'db.action',
      'db.commit',
    ]);
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN READ ONLY');
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledWith(false);
    expect(test.requests()[0]?.pool.after).toEqual({
      total: 0,
      idle: 0,
      waiting: 0,
    });
    expect(test.lines.join('')).not.toMatch(
      /actor-secret|session-secret|SELECT|set_config/,
    );
  });
  it('records rollback and preserves the same authorization error without commit', async () => {
    const test = setup();
    const error = new ApiError('RESOURCE_NOT_FOUND', 'private error', 404);
    await expect(
      inRequest(test.diagnostics, firstId, () =>
        database.readAs('actor-secret', async () => {
          throw error;
        }),
      ),
    ).rejects.toBe(error);
    expect(test.requests()[0]?.spans).toEqual(
      expect.arrayContaining([
        {
          name: 'db.action',
          startMs: expect.any(Number),
          durationMs: expect.any(Number),
          outcome: 'error',
        },
        {
          name: 'db.rollback',
          startMs: expect.any(Number),
          durationMs: expect.any(Number),
          outcome: 'ok',
        },
      ]),
    );
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
