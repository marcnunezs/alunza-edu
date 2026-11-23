import { RuleVersionsController } from './rule-versions.controller';
import { RuleVersionsService } from './rule-versions.service';
import type { ApiRequest } from '../http/errors';

const organizationId = '20000000-0000-4000-8000-000000000001';
const id = '20000000-0000-4000-8000-000000000002';
const request = {
  actorId: '10000000-0000-4000-8000-000000000001',
  sessionId: '10000000-0000-4000-8000-000000000002',
  requestId: '10000000-0000-4000-8000-000000000003',
} as ApiRequest;
const body = {
  type: 'INACTIVITY',
  schemaVersion: 1,
  algorithmVersion: 'DEC005_V1',
  parameters: { inactivityDays: 7 },
};
const draft = {
  ...body,
  id,
  organizationId,
  version: 1,
  state: 'DRAFT',
  createdBy: request.actorId,
  createdAt: '2026-10-05T12:00:00.123456Z',
  activatedBy: null,
  validFrom: null,
  validTo: null,
};

function setup() {
  const service = {
    effective: jest.fn(async () => ({
      organizationId,
      observedAt: '2026-10-25T23:59:59.123456Z',
      rules: ['INACTIVITY', 'REPEATED_ERROR', 'STAGNATION'].map((type) => ({
        type,
        ruleVersion: null,
      })),
    })),
    list: jest.fn(async () => ({
      data: [draft],
      page: { hasMore: false, nextCursor: null },
    })),
    create: jest.fn(async () => draft),
    get: jest.fn(async () => draft),
    activate: jest.fn(async () => ({
      ...draft,
      state: 'ACTIVE',
      activatedBy: request.actorId,
      validFrom: '2026-10-05T12:00:01.123456Z',
    })),
  };
  return {
    service,
    controller: new RuleVersionsController(
      service as unknown as RuleVersionsService,
    ),
  };
}

describe('contrato HTTP de gobierno de reglas', () => {
  it('consulta las tres efectivas con ámbito de ruta y actor autenticado', async () => {
    const { controller, service } = setup();
    const response = await controller.effective(request, organizationId, {});
    expect(response.data.observedAt).toBe('2026-10-25T23:59:59.123456Z');
    expect(response.data.rules).toHaveLength(3);
    expect(response.requestId).toBe(request.requestId);
    expect(service.effective).toHaveBeenCalledWith(request, organizationId);
  });

  it.each([
    { at: '2026-10-25T12:00:00Z' },
    { type: 'INACTIVITY' },
    { cursor: id },
    { organizationId },
  ])('no permite filtros ni cortes cliente en efectivas %#', async (query) => {
    const { controller, service } = setup();
    await expect(
      controller.effective(request, organizationId, query),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 422,
    });
    expect(service.effective).not.toHaveBeenCalled();
  });

  it('no inventa configuración vacía si el servicio falla', async () => {
    const { controller, service } = setup();
    service.effective.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      controller.effective(request, organizationId, {}),
    ).rejects.toThrow('database unavailable');
  });

  it('crea una versión inactiva conservando microsegundos y actor de sesión', async () => {
    const { controller, service } = setup();
    const response = await controller.create(
      request,
      organizationId,
      body,
      'create-rule-key',
    );
    expect(response.data).toEqual(draft);
    expect(response.requestId).toBe(request.requestId);
    expect(service.create).toHaveBeenCalledWith(
      request,
      organizationId,
      body,
      'create-rule-key',
    );
  });

  it.each([
    { ...body, createdBy: request.actorId },
    { ...body, parameters: { inactivityDays: 0 } },
    { ...body, parameters: { inactivityDays: 1.5 } },
    { ...body, parameters: { inactivityDays: '7' } },
    { ...body, parameters: { inactivityDays: 7, hiddenThreshold: 2 } },
    { ...body, algorithmVersion: 'client-script' },
  ])(
    'rechaza configuración no canónica antes de persistir %#',
    async (input) => {
      const { controller, service } = setup();
      await expect(
        controller.create(request, organizationId, input, 'create-rule-key'),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
      expect(service.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { expectedCurrentVersionId: null, effectiveAt: '2026-10-06T12:00:00Z' },
    { expectedCurrentVersionId: 'previous' },
  ])(
    'exige expectativa explícita y rechaza vigencia cliente %#',
    async (input) => {
      const { controller, service } = setup();
      await expect(
        controller.activate(request, id, input, 'activate-rule-key'),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
      expect(service.activate).not.toHaveBeenCalled();
    },
  );

  it('acepta ausencia de regla vigente explícita, sin tomar organización del cuerpo', async () => {
    const { controller, service } = setup();
    await controller.activate(
      request,
      id,
      { expectedCurrentVersionId: null },
      'activate-rule-key',
    );
    expect(service.activate).toHaveBeenCalledWith(
      request,
      id,
      { expectedCurrentVersionId: null },
      'activate-rule-key',
    );
  });

  it('rechaza clave ausente en ambas mutaciones antes de invocar el servicio', async () => {
    const { controller, service } = setup();
    await expect(
      controller.create(request, organizationId, body, undefined),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
    await expect(
      controller.activate(
        request,
        id,
        { expectedCurrentVersionId: null },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
    expect(service.create).not.toHaveBeenCalled();
    expect(service.activate).not.toHaveBeenCalled();
  });

  it('lista paginada con filtros estrictos y una cuenta autenticada', async () => {
    const { controller, service } = setup();
    await controller.list(request, organizationId, {
      type: 'INACTIVITY',
      limit: '2',
    });
    expect(service.list).toHaveBeenCalledWith(request, organizationId, {
      type: 'INACTIVITY',
      limit: 2,
    });
    await expect(
      controller.list(request, organizationId, { organizationId }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    await expect(
      controller.get({ requestId: request.requestId } as ApiRequest, id),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(service.get).not.toHaveBeenCalled();
  });
});
