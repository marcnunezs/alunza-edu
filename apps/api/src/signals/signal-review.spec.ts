import type { PoolClient } from 'pg';
import { SignalReviewController } from './signal-review.controller';
import { SignalReviewService } from './signal-review.service';
import type { DatabaseService } from '../database/database.service';
import type { ApiRequest } from '../http/errors';

const signalId = 'abcdefab-0000-4000-8000-000000000001';
const request = {
  actorId: '10000000-0000-4000-8000-000000000001',
  sessionId: '10000000-0000-4000-8000-000000000002',
  requestId: '10000000-0000-4000-8000-000000000003',
} as ApiRequest;
const review = {
  signalId,
  classId: '20000000-0000-4000-8000-000000000001',
  studentId: '20000000-0000-4000-8000-000000000002',
  state: 'REVIEWED',
  reviewedBy: request.actorId,
  reviewedByName: 'Docente ficticio',
  reviewedAt: '2026-11-01T12:00:00.123456Z',
};
function setup(value: unknown = review) {
  const client = { query: jest.fn(async () => ({ rows: [{ data: value }] })) };
  const database = {
    writeAs: jest.fn(
      async (
        _actor: string,
        action: (client: PoolClient) => Promise<unknown>,
        _session?: string,
      ) => action(client as unknown as PoolClient),
    ),
    readAs: jest.fn(),
    internal: jest.fn(),
  };
  const service = new SignalReviewService(
    database as unknown as DatabaseService,
  );
  return { client, database, controller: new SignalReviewController(service) };
}

describe('revisión pública de señales', () => {
  it('conserva contexto docente y correlación, normaliza UUID y valida respuesta dentro de la transacción', async () => {
    const { client, database, controller } = setup();
    expect(
      await controller.review(request, signalId.toUpperCase(), {}, {}),
    ).toEqual({ data: review, requestId: request.requestId });
    expect(database.writeAs).toHaveBeenCalledWith(
      request.actorId,
      expect.any(Function),
      request.sessionId,
    );
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      "SELECT set_config('app.request_id',$1,true)",
      [request.requestId],
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      'SELECT app_private.signal_review($1::uuid) AS data',
      [signalId],
    );
    expect(database.internal).not.toHaveBeenCalled();
    expect(database.readAs).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    null,
    [],
    { reviewedBy: request.actorId },
    { reviewedAt: review.reviewedAt },
    { state: 'REVIEWED' },
    { note: 'texto' },
    { classId: review.classId },
  ])('rechaza payload no permitido %# antes de escribir', async (body) => {
    const { database, controller } = setup();
    await expect(
      controller.review(request, signalId, body, {}),
    ).rejects.toMatchObject({ status: 422 });
    expect(database.writeAs).not.toHaveBeenCalled();
  });

  it.each([
    { asOf: review.reviewedAt },
    { studentId: review.studentId },
    { role: 'ADMIN' },
  ])('rechaza query no permitida %#', async (query) => {
    const { database, controller } = setup();
    await expect(
      controller.review(request, signalId, {}, query),
    ).rejects.toMatchObject({ status: 422 });
    expect(database.writeAs).not.toHaveBeenCalled();
  });

  it('rechaza UUID inválido y ausencia de identidad verificada', async () => {
    const { database, controller } = setup();
    await expect(
      controller.review(request, 'invalid', {}, {}),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      controller.review(
        { requestId: request.requestId } as ApiRequest,
        signalId,
        {},
        {},
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(database.writeAs).not.toHaveBeenCalled();
  });

  it.each([
    { ...review, signalId: review.classId },
    { ...review, state: 'ACTIVE' },
    { ...review, snapshot: { private: true } },
    { ...review, reviewedAt: null },
  ])('impide confirmar una respuesta corrupta o privada %#', async (value) => {
    const { controller } = setup(value);
    await expect(
      controller.review(request, signalId, {}, {}),
    ).rejects.toThrow();
  });
});
