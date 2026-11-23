import type { PoolClient } from 'pg';
import { StudentDetailController } from './student-detail.controller';
import { StudentDetailService } from './student-detail.service';
import { DatabaseService } from '../database/database.service';
import type { MaterialsStoragePort } from '../materials/materials.ports';
import { materialHash } from '../materials/materials.service';
import { ApiError } from '../http/errors';
import type { ApiRequest } from '../http/errors';

const classId = '20000000-0000-4000-8000-000000000001';
const studentId = '20000000-0000-4000-8000-000000000002';
const feedbackId = '20000000-0000-4000-8000-000000000003';
const chunkId = '20000000-0000-4000-8000-000000000004';
const request = {
  actorId: '10000000-0000-4000-8000-000000000001',
  sessionId: '10000000-0000-4000-8000-000000000002',
  requestId: '10000000-0000-4000-8000-000000000003',
} as ApiRequest;
const at = '2026-10-27T12:00:00.123456Z';
const context = { classId, studentId, asOf: at, observedAt: at };
const params = { classId, studentId, feedbackId, chunkId };
const feedback = {
  ...context,
  feedback: {
    id: feedbackId,
    attemptId: classId,
    kind: 'FEEDBACK',
    hintLevel: null,
    status: 'NO_EVIDENCE',
    createdAt: at,
    deliveredAt: at,
    available: true,
    help: {
      diagnosis_code: 'FAILED_TEST',
      explanation: 'Sin evidencia autorizada.',
      hint: '',
      source_refs: [],
      status: 'NO_EVIDENCE',
    },
  },
};
const bytes = Buffer.from('Documento ficticio de prueba.');
const reference = {
  ...context,
  feedbackId,
  reference: {
    sourceId: classId,
    versionId: classId,
    chunkId,
    title: 'Fuente autorizada',
    version: 1,
    fileName: 'referencia.txt',
    format: 'TXT',
    locator: 'Línea 1',
    text: 'Contenido autorizado.',
    storageKey: 'private-object-key',
    mimeType: 'text/plain',
    sizeBytes: bytes.length,
    sha256: materialHash(bytes),
  },
};
function setup(value: unknown = feedback) {
  const client = {
    query: jest.fn(async (_sql: string, _values: unknown[]) => ({
      rows: [{ data: value }],
    })),
  };
  const database = {
    readAs: jest.fn(
      async (
        _actor: string,
        action: (client: PoolClient) => Promise<unknown>,
        _session?: string,
      ) => action(client as unknown as PoolClient),
    ),
    writeAs: jest.fn(),
  };
  const storage = { download: jest.fn(async () => bytes) };
  const service = new StudentDetailService(
    database as unknown as DatabaseService,
    storage as unknown as MaterialsStoragePort,
  );
  return {
    client,
    database,
    storage,
    service,
    controller: new StudentDetailController(service),
  };
}

describe('detalle docente de solo lectura', () => {
  it('normaliza UUID válidos antes de comprobar el ámbito canónico de PostgreSQL', async () => {
    const lowerClass = 'abcdefab-0000-4000-8000-000000000001';
    const lowerStudent = 'abcdefab-0000-4000-8000-000000000002';
    const value = { ...feedback, classId: lowerClass, studentId: lowerStudent };
    const { controller, client } = setup(value);
    const result = await controller.feedback(
      request,
      {
        ...params,
        classId: lowerClass.toUpperCase(),
        studentId: lowerStudent.toUpperCase(),
      },
      { asOf: at },
    );
    expect(result.data).toEqual(value);
    expect(client.query).toHaveBeenCalledWith(expect.any(String), [
      lowerClass,
      lowerStudent,
      feedbackId,
      JSON.stringify({ asOf: at }),
    ]);
  });

  it('conserva actor docente, sesión y ámbito explícito sin transacciones de escritura', async () => {
    const { controller, database, client } = setup();
    const result = await controller.feedback(request, params, { asOf: at });
    expect(result.data).toEqual(feedback);
    expect(database.readAs).toHaveBeenCalledWith(
      request.actorId,
      expect.any(Function),
      request.sessionId,
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('student_detail_feedback'),
      [classId, studentId, feedbackId, JSON.stringify({ asOf: at })],
    );
    expect(database.writeAs).not.toHaveBeenCalled();
  });

  it.each([
    { studentId: classId },
    { role: 'ADMIN' },
    { includeHidden: true },
    { includeUndelivered: true },
    { asOf: 'bad-date' },
  ])('rechaza ampliación de ámbito o query inválida %#', async (query) => {
    const { controller, database } = setup();
    await expect(
      controller.feedback(request, params, query),
    ).rejects.toMatchObject({ status: 422 });
    expect(database.readAs).not.toHaveBeenCalled();
  });

  it('rechaza IDs inválidos antes de consultar', async () => {
    const { controller, database } = setup();
    await expect(
      controller.feedback(
        request,
        { ...params, studentId: 'foreign-name' },
        {},
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(database.readAs).not.toHaveBeenCalled();
  });

  it('rechaza respuesta de otro estudiante aunque el DTO estructural sea válido', async () => {
    const { controller } = setup({ ...feedback, studentId: classId });
    await expect(controller.feedback(request, params, {})).rejects.toThrow(
      'scope mismatch',
    );
  });

  it('no entrega tokens o capacidades estudiantiles desde una respuesta SQL contaminada', async () => {
    const { controller } = setup({
      ...feedback,
      feedback: { ...feedback.feedback, presentationToken: chunkId },
    });
    await expect(controller.feedback(request, params, {})).rejects.toThrow();
  });

  it('no devuelve rutas privadas ni descriptores Storage en una cita', async () => {
    const { controller } = setup(reference);
    const result = await controller.reference(request, params, { asOf: at });
    expect(result.data.reference.text).toBe(reference.reference.text);
    for (const field of ['storageKey', 'mimeType', 'sizeBytes', 'sha256'])
      expect(result.data.reference).not.toHaveProperty(field);
  });

  it('verifica bytes y reautoriza después de Storage usando el corte fijado', async () => {
    const { controller, client, database, storage } = setup(reference);
    const res = { setHeader: jest.fn(), send: jest.fn() };
    await controller.content(request, params, {}, res as never);
    expect(storage.download).toHaveBeenCalledWith(
      reference.reference.storageKey,
    );
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[1]?.[1]).toEqual([
      classId,
      studentId,
      feedbackId,
      chunkId,
      JSON.stringify({ asOf: at }),
    ]);
    expect(res.send).toHaveBeenCalledWith(bytes);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(database.writeAs).not.toHaveBeenCalled();
  });

  it('revocación durante Storage impide entregar bytes', async () => {
    const { controller, client } = setup(reference);
    // The first authorization succeeds, the second fails after I/O.
    client.query
      .mockResolvedValueOnce({ rows: [{ data: reference }] })
      .mockRejectedValueOnce(
        new ApiError('RESOURCE_NOT_FOUND', 'No encontrado.', 404),
      );
    const res = { setHeader: jest.fn(), send: jest.fn() };
    await expect(
      controller.content(request, params, {}, res as never),
    ).rejects.toMatchObject({ status: 404 });
    expect(res.send).not.toHaveBeenCalled();
  });

  it('corrupción de contenido produce error recuperable sin entregar bytes', async () => {
    const { controller, storage, client } = setup(reference);
    storage.download.mockResolvedValueOnce(Buffer.from('alterado'));
    const res = { setHeader: jest.fn(), send: jest.fn() };
    await expect(
      controller.content(request, params, {}, res as never),
    ).rejects.toMatchObject({ status: 503, code: 'STORAGE_UNAVAILABLE' });
    expect(res.send).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});
