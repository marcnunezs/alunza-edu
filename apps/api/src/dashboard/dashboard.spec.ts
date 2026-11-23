import type { PoolClient } from 'pg';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DatabaseService } from '../database/database.service';
import type { ApiRequest } from '../http/errors';

const classroom = '20000000-0000-4000-8000-000000000001';
const request = {
  actorId: '10000000-0000-4000-8000-000000000001',
  sessionId: '10000000-0000-4000-8000-000000000002',
  requestId: '10000000-0000-4000-8000-000000000003',
} as ApiRequest;
const at = '2026-10-26T12:00:00.123456Z';
const period = {
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
};
const processing = {
  status: 'NOT_EVALUATED',
  evaluatedAt: null,
  processedThrough: null,
  pendingLanes: 0,
  failedLanes: 0,
  unconfiguredTypes: [],
};
const page = { hasMore: false, nextCursor: null };
const dashboard = {
  classId: classroom,
  organizationId: classroom,
  className: 'Clase ficticia',
  filters: { activityId: null, conceptId: null, from: null },
  asOf: at,
  observedAt: at,
  roster: 'CURRENT_ACTIVE',
  summary: {
    students: 0,
    completed: 0,
    required: 0,
    ratio: null,
    evidenceState: 'NO_REQUIRED_EXERCISES',
    lastActivityAt: null,
    period,
  },
  byActivity: [],
  byConcept: [],
  students: { data: [], page },
  signals: { counts: [], processing },
};
function setup() {
  const client = {
    query: jest.fn(async () => ({ rows: [{ data: dashboard as unknown }] })),
  };
  const transaction = async (
    _actor: string,
    action: (client: PoolClient) => Promise<unknown>,
  ) => action(client as unknown as PoolClient);
  const database = { readAs: jest.fn(transaction), writeAs: jest.fn() };
  const service = new DashboardService(database as unknown as DatabaseService);
  return {
    client,
    database,
    service,
    controller: new DashboardController(service),
  };
}

describe('consulta docente sin efectos estudiantiles', () => {
  it('usa una lectura autenticada y preserva corte; nunca genera eventos o cálculos', async () => {
    const { controller, client, database } = setup();
    const result = await controller.dashboard(request, classroom, { asOf: at });
    expect(result.data).toEqual(dashboard);
    expect(result.requestId).toBe(request.requestId);
    expect(database.readAs).toHaveBeenCalledWith(
      request.actorId,
      expect.any(Function),
      request.sessionId,
    );
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(
      'SELECT app_private.dashboard_read($1::uuid,$2::jsonb) AS data',
      [classroom, JSON.stringify({ asOf: at })],
    );
    expect(database.writeAs).not.toHaveBeenCalled();
  });

  it.each([
    { organizationId: classroom },
    { studentId: classroom },
    { role: 'TEACHER' },
    { from: '2026-10-26T12:00:00.123457Z', asOf: at },
    { asOf: '2026-10-26T12:00:00' },
    { limit: 0 },
    { limit: 101 },
    { cursor: 'unsafe/cursor' },
  ])('rechaza entradas no autorizadas antes de leer %#', async (query) => {
    const { controller, database } = setup();
    await expect(
      controller.dashboard(request, classroom, query),
    ).rejects.toMatchObject({ status: 422, code: 'VALIDATION_FAILED' });
    expect(database.readAs).not.toHaveBeenCalled();
  });

  it('no filtra señales por inicio de período ni admite tercer estado', async () => {
    const { controller, database } = setup();
    for (const query of [
      { from: at },
      { state: 'RESOLVED' },
      { state: 'NOT_VERIFIABLE' },
    ])
      await expect(
        controller.signals(request, classroom, query),
      ).rejects.toMatchObject({ status: 422 });
    expect(database.readAs).not.toHaveBeenCalled();
  });

  it('rechaza diagnóstico en conteos de pistas antes de leer', async () => {
    const { controller, database } = setup();
    await expect(
      controller.evidence(request, classroom, {
        kind: 'HINT',
        diagnosisCode: 'FAILED_TEST',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(database.readAs).not.toHaveBeenCalled();
  });

  it('falla de persistencia nunca se publica como vacío o cero', async () => {
    const { controller, client } = setup();
    client.query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(controller.dashboard(request, classroom, {})).rejects.toThrow(
      'database unavailable',
    );
  });

  it('rechaza salida privada o contadores incoherentes aunque procedan de SQL', async () => {
    const { controller, client } = setup();
    client.query.mockResolvedValueOnce({
      rows: [{ data: { ...dashboard, code: 'private' } as typeof dashboard }],
    });
    await expect(
      controller.dashboard(request, classroom, {}),
    ).rejects.toThrow();
    client.query.mockResolvedValueOnce({
      rows: [
        { data: { ...dashboard, summary: { ...dashboard.summary, ratio: 1 } } },
      ],
    });
    await expect(
      controller.dashboard(request, classroom, {}),
    ).rejects.toThrow();
  });
});
