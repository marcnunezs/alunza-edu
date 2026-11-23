import { EventEmitter } from 'node:events';
import {
  studentProgressSchema,
  studentProgressResponseSchema,
} from '@alunza/contracts';
import type { PoolClient } from 'pg';
import { ProgressService } from './progress.service';
import { ProgressController } from './progress.controller';
import { DatabaseService } from '../database/database.service';
import type { AppConfig } from '../config';
import type { ApiRequest } from '../http/errors';
import { ApiError } from '../http/errors';
import { PhaseDiagnostics } from '../http/phase-diagnostics';
import type { PhaseDiagnosticRuntime } from '../http/phase-diagnostics';

const who = {
  actorId: '10000000-0000-4000-8000-000000000001',
  sessionId: '10000000-0000-4000-8000-000000000002',
  requestId: '10000000-0000-4000-8000-000000000003',
};
const classroom = '20000000-0000-4000-8000-000000000001';
const at = '2026-10-02T12:00:00Z';
const progress = {
  classId: classroom,
  filters: { activityId: null, conceptId: null },
  asOf: at,
  summary: {
    completed: 0,
    required: 0,
    ratio: null,
    evidenceState: 'NO_REQUIRED_EXERCISES',
    basisAttemptIds: [],
  },
  byActivity: [],
  byConcept: [],
  evidence: [],
  observation: {
    from: null,
    observedAt: at,
    lastActivityAt: null,
    summary: {
      attempts: 0,
      technicalFailures: 0,
      unverifiableAttempts: 0,
      hintsDelivered: 0,
      activityEvents: 0,
      byDiagnosis: [
        'SUCCESS',
        'SYNTAX_ERROR',
        'RUNTIME_ERROR',
        'FAILED_TEST',
        'TIMEOUT',
        'UNKNOWN',
      ].map((diagnosisCode) => ({ diagnosisCode, count: 0 })),
    },
    attempts: [],
    page: { hasMore: false, nextCursor: null },
  },
};
function setup() {
  const client = {
    query: jest.fn(async () => ({
      rows: [
        {
          progress,
          event: {
            eventId: who.requestId,
            activityId: classroom,
            occurredAt: at,
          },
        },
      ],
    })),
  };
  const transaction = async (
    _actor: string,
    action: (client: PoolClient) => Promise<unknown>,
  ) => action(client as unknown as PoolClient);
  const database = {
    readAs: jest.fn(transaction),
    writeAs: jest.fn(transaction),
  };
  const service = new ProgressService(database as unknown as DatabaseService);
  return {
    service,
    controller: new ProgressController(service),
    client,
    database,
  };
}
describe('progreso determinista bajo contexto actual', () => {
  it('obtiene todos los contadores en una consulta y conserva el corte exacto', async () => {
    const { service, client, database } = setup();
    await expect(
      service.read(who, { classId: classroom, asOf: at }),
    ).resolves.toEqual(progress);
    expect(database.readAs).toHaveBeenCalledWith(
      who.actorId,
      expect.any(Function),
      who.sessionId,
    );
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('student_progress'),
      [classroom, JSON.stringify({ asOf: at })],
    );
    expect(database.writeAs).not.toHaveBeenCalled();
  });
  it('apertura usa identidad de sesión y clave en una transacción de escritura', async () => {
    const { service, client, database } = setup();
    await service.open(who, classroom, 'explicit-open-key');
    expect(database.writeAs).toHaveBeenCalledWith(
      who.actorId,
      expect.any(Function),
      who.sessionId,
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('record_activity_open'),
      [classroom, 'explicit-open-key'],
    );
  });
  it('rechaza una respuesta que convierte falla de servicio en cero', async () => {
    const { service, client } = setup();
    client.query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.read(who, { classId: classroom })).rejects.toThrow(
      'database unavailable',
    );
  });
});

function observation(enabled = true) {
  const lines: string[] = [];
  let clock = 0;
  const runtime: PhaseDiagnosticRuntime = {
    now: () => (clock += 0.01),
    wall: () => 1_790_000_000_000,
    write: jest.fn((line: string) => {
      lines.push(line);
      return true;
    }),
    onDrain: () => () => undefined,
    cpu: () => ({ user: 0, system: 0 }),
    memory: () => ({ rss: 0, heapUsed: 0 }),
    eventLoop: () => ({ idle: 0, active: 0, utilization: 0 }),
    histogram: () => {
      throw new Error('Request-only test must not start process sampling.');
    },
  };
  const diagnostics = new PhaseDiagnostics(
    { environment: 'test', dashboardTimingsEnabled: enabled } as AppConfig,
    runtime,
  );
  const run = <T>(action: () => Promise<T>) => {
    const response = Object.assign(new EventEmitter(), { statusCode: 200 });
    return new Promise<T>((resolve, reject) => {
      diagnostics.run(
        who.requestId,
        '/api/v1/me/progress',
        'GET',
        response,
        () => {
          action().then(
            (value) => {
              response.emit('finish');
              response.emit('close');
              resolve(value);
            },
            (error: unknown) => {
              response.statusCode =
                error instanceof ApiError ? error.getStatus() : 500;
              response.emit('finish');
              reject(error);
            },
          );
        },
      );
    });
  };
  return {
    run,
    runtime,
    lines,
    records: () =>
      lines.map(
        (line) =>
          JSON.parse(line) as {
            path: string;
            status: number;
            dropped: number;
            spans: Array<{ name: string; outcome: string }>;
          },
      ),
  };
}

describe('observación TEST de la lectura de progreso', () => {
  it.each([false, true])(
    'conserva respuesta, sesión y única consulta (diagnóstico=%s)',
    async (enabled) => {
      const { controller, client, database } = setup();
      const observed = observation(enabled);
      await expect(
        observed.run(() =>
          controller.read(who as ApiRequest, { classId: classroom, asOf: at }),
        ),
      ).resolves.toEqual({
        data: progress,
        requestId: who.requestId,
      });
      expect(database.readAs).toHaveBeenCalledWith(
        who.actorId,
        expect.any(Function),
        who.sessionId,
      );
      expect(database.writeAs).not.toHaveBeenCalled();
      expect(client.query).toHaveBeenCalledTimes(1);
      expect(client.query).toHaveBeenCalledWith(
        'SELECT app_private.student_progress_observed($1::uuid,$2::jsonb) AS progress',
        [classroom, JSON.stringify({ asOf: at })],
      );
      if (!enabled) expect(observed.lines).toEqual([]);
      else {
        expect(observed.records()).toHaveLength(1);
        expect(observed.records()[0]).toMatchObject({
          path: '/api/v1/me/progress',
          status: 200,
          dropped: 0,
          spans: [
            { name: 'progress.query', outcome: 'ok' },
            { name: 'progress.parse', outcome: 'ok' },
            { name: 'progress.responseParse', outcome: 'ok' },
          ],
        });
        for (const privateValue of [
          who.actorId,
          who.sessionId,
          classroom,
          at,
          'SELECT',
          'student_progress_observed',
        ])
          expect(observed.lines.join('')).not.toContain(privateValue);
      }
    },
  );

  it.each(['query', 'parse', 'responseParse'] as const)(
    'preserva el error original y la fase fallida (%s)',
    async (failure) => {
      const { controller, client } = setup();
      const observed = observation();
      const error = new Error('private-query-or-validation-detail');
      if (failure === 'query') client.query.mockRejectedValueOnce(error);
      else
        jest
          .spyOn(
            failure === 'parse'
              ? studentProgressSchema
              : studentProgressResponseSchema,
            'parse',
          )
          .mockImplementationOnce(() => {
            throw error;
          });
      await expect(
        observed.run(() =>
          controller.read(who as ApiRequest, { classId: classroom }),
        ),
      ).rejects.toBe(error);
      expect(client.query).toHaveBeenCalledTimes(1);
      const names = ['query', 'parse', 'responseParse'].slice(
        0,
        ['query', 'parse', 'responseParse'].indexOf(failure) + 1,
      );
      expect(observed.records()).toHaveLength(1);
      expect(observed.records()[0]?.spans).toEqual(
        names.map((name) =>
          expect.objectContaining({
            name: `progress.${name}`,
            outcome: name === failure ? 'error' : 'ok',
          }),
        ),
      );
      expect(observed.lines.join('')).not.toContain(error.message);
    },
  );

  it('rechaza filtros inválidos antes de consultar y no los registra', async () => {
    const { controller, client, database } = setup();
    const observed = observation();
    await expect(
      observed.run(() =>
        controller.read(who as ApiRequest, {
          classId: 'private-invalid-class',
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(database.readAs).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
    expect(observed.records()).toEqual([
      expect.objectContaining({ status: 422, spans: [] }),
    ]);
    expect(observed.lines.join('')).not.toContain('private-invalid-class');
  });

  it.each([
    ['write', false],
    ['write', true],
    ['clock', false],
    ['clock', true],
  ] as const)(
    'fallo del observador %s conserva resultado de dominio (error=%s)',
    async (failure, rejects) => {
      const { controller, client } = setup();
      const observed = observation();
      const domainError = new Error('unchanged domain error');
      const originalQuery = client.query.getMockImplementation()!;
      client.query.mockImplementationOnce(async () => {
        if (failure === 'clock')
          observed.runtime.now = () => {
            throw new Error('clock failed');
          };
        if (rejects) throw domainError;
        return originalQuery();
      });
      if (failure === 'write')
        jest.mocked(observed.runtime.write).mockImplementation(() => {
          throw new Error('write failed');
        });
      const result = observed.run(() =>
        controller.read(who as ApiRequest, { classId: classroom }),
      );
      if (rejects) await expect(result).rejects.toBe(domainError);
      else
        await expect(result).resolves.toEqual({
          data: progress,
          requestId: who.requestId,
        });
      expect(client.query).toHaveBeenCalledTimes(1);
      expect(observed.lines).toEqual([]);
    },
  );
});
