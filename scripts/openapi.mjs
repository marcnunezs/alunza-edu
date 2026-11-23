import { writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { z } from 'zod';
import * as contracts from '@alunza/contracts';
import { addAcademicOpenApi } from './academic-openapi.mjs';
import { addMaterialsOpenApi } from './materials-openapi.mjs';
import { addHelpOpenApi } from './help-openapi.mjs';
import { addExerciseBankOpenApi } from './exercise-bank-openapi.mjs';
import { addStudentDetailOpenApi } from './student-detail-openapi.mjs';
import { addAuditOpenApi } from './audit-openapi.mjs';
import { addAuditExportOpenApi } from './audit-export-openapi.mjs';
import { developmentTarget } from './local-target.mjs';

const schemas = Object.fromEntries(
  Object.entries({
    Health: contracts.healthResponseSchema,
    Me: contracts.meResponseSchema,
    Organization: contracts.organizationResponseSchema,
    Organizations: contracts.organizationListResponseSchema,
    Member: contracts.memberResponseSchema,
    Members: contracts.memberListResponseSchema,
    Invitation: contracts.invitationResponseSchema,
    Invitations: contracts.invitationListResponseSchema,
    InvitationAcceptance: contracts.invitationAcceptanceResponseSchema,
    OrganizationCreate: contracts.organizationCreateSchema,
    OrganizationUpdate: contracts.organizationUpdateSchema,
    OrganizationArchive: contracts.organizationArchiveSchema,
    MemberUpdate: contracts.memberUpdateSchema,
    InvitationCreate: contracts.invitationCreateSchema,
    InvitationAccept: contracts.invitationAcceptSchema,
    InvitationProof: contracts.invitationProofSchema,
    RunExecutionInput: contracts.runExecutionInputSchema,
    RunExecution: contracts.runExecutionResponseSchema,
    SubmitAttemptInput: contracts.submitAttemptInputSchema,
    Attempt: contracts.attemptResponseSchema,
    Attempts: contracts.attemptListResponseSchema,
    ActivityProgress: contracts.activityProgressResponseSchema,
    StudentProgress: contracts.studentProgressResponseSchema,
    Dashboard: contracts.dashboardResponseSchema,
    DashboardEvidence: contracts.dashboardEvidenceResponseSchema,
    DashboardSignals: contracts.dashboardSignalsResponseSchema,
    DashboardSignalDetail: contracts.dashboardSignalDetailResponseSchema,
    ActivityOpenInput: contracts.activityOpenInputSchema,
    ActivityOpen: contracts.activityOpenResponseSchema,
    SignalRuleCreate: contracts.signalRuleCreateSchema,
    SignalRuleActivate: contracts.signalRuleActivateSchema,
    SignalRuleVersion: contracts.signalRuleVersionResponseSchema,
    SignalRuleVersions: contracts.signalRuleVersionListResponseSchema,
    SignalRuleEffective: contracts.signalRuleEffectiveResponseSchema,
    SignalReviewInput: contracts.signalReviewInputSchema,
    SignalReview: contracts.signalReviewResponseSchema,
    Error: contracts.errorResponseSchema,
  }).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' }),
  ]),
);
function response(schema, description) {
  return {
    description,
    headers: {
      'Cache-Control': {
        description:
          'Las respuestas de dominio son privadas y no se almacenan.',
        schema: { type: 'string', example: 'private, no-store' },
      },
      ...([
        'Organization',
        'Member',
        'Invitation',
        'Course',
        'Class',
        'Concept',
        'Exercise',
        'Activity',
        'JoinCode',
        'MaterialSource',
      ].includes(schema)
        ? {
            ETag: {
              description:
                'Revisión del recurso cuando corresponde a una lectura o mutación versionada.',
              schema: { type: 'string', example: '"1"' },
            },
          }
        : {}),
      'X-Request-Id': {
        description: 'Correlación generada por la API.',
        schema: { type: 'string', format: 'uuid' },
      },
      'X-Release-Id': {
        description: 'Candidato de API; SHA Git en preproducción.',
        schema: { type: 'string' },
      },
    },
    content: {
      'application/json': {
        schema: { $ref: `#/components/schemas/${schema}` },
      },
    },
  };
}
function operation(id, schema, errors, protectedRoute = false) {
  return {
    operationId: id,
    ...(protectedRoute ? { security: [{ bearerAuth: [] }] } : {}),
    responses: {
      200: response(schema, 'Resultado confirmado.'),
      ...Object.fromEntries(
        errors.map((code) => [
          code,
          response('Error', 'Error seguro; consultar error.code y requestId.'),
        ]),
      ),
    },
  };
}
export const specification = {
  openapi: '3.0.3',
  info: {
    title: 'Alunza — identidad, práctica, ayuda y progreso',
    version: '0.6.6',
    description:
      'IMP-06.06. Identidad, práctica, ayuda, progreso, gobierno del banco, detalle docente, revisión de señales, visor administrativo y exportación CSV de auditoría. Permisos actuales y proyecciones mínimas. Azure remoto y Sandbox productivo conservan sus validaciones pendientes.',
  },
  servers: [
    { url: developmentTarget.apiUrl, description: 'Laboratorio local' },
  ],
  paths: {
    '/health/live': { get: operation('liveness', 'Health', []) },
    '/health/ready': { get: operation('readiness', 'Health', [503]) },
    '/api/v1/me': { get: operation('getMe', 'Me', [401, 403, 503], true) },
    '/api/v1/organizations/{orgId}': {
      get: {
        ...operation(
          'getOrganization',
          'Organization',
          [400, 401, 403, 404, 503],
          true,
        ),
        parameters: [
          {
            name: 'orgId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT ES256 de Supabase Auth',
      },
    },
    schemas,
  },
};
const pathId = (name) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
});
const header = (name) => ({
  name,
  in: 'header',
  required: true,
  schema:
    name === 'Idempotency-Key'
      ? {
          type: 'string',
          minLength: 8,
          maxLength: 128,
          pattern: '^[A-Za-z0-9_.:-]+$',
        }
      : { type: 'string', pattern: '^"[1-9][0-9]*"$' },
});
const pagination = [
  { name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } },
  { name: 'search', in: 'query', schema: { type: 'string', maxLength: 160 } },
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
];
function domainOperation(
  id,
  schema,
  {
    input,
    ids = [],
    list = false,
    filters = [],
    idempotent = false,
    versioned = false,
    publicRoute = false,
    status = 200,
  } = {},
) {
  const result = operation(
    id,
    schema,
    [400, 401, 403, 404, 409, 412, 413, 415, 422, 428, 429, 503, 504],
    !publicRoute,
  );
  if (status !== 200) {
    result.responses[status] = result.responses[200];
    delete result.responses[200];
  }
  result.parameters = [
    ...ids.map(pathId),
    ...(list ? pagination : []),
    ...filters,
    ...(idempotent ? [header('Idempotency-Key')] : []),
    ...(versioned ? [header('If-Match')] : []),
  ];
  if (input)
    result.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${input}` },
        },
      },
    };
  return result;
}
const org = { ids: ['orgId'] };
const invitation = { ids: ['orgId', 'invitationId'] };
const filter = (name, values) => ({
  name,
  in: 'query',
  schema: { type: 'string', enum: values },
});
const roleFilter = filter('role', ['ADMIN', 'TEACHER', 'STUDENT']);
Object.assign(specification.paths, {
  '/api/v1/organizations': {
    get: domainOperation('listOrganizations', 'Organizations', {
      list: true,
      filters: [filter('state', ['ACTIVE', 'ARCHIVED'])],
    }),
    post: domainOperation('createOrganization', 'Organization', {
      input: 'OrganizationCreate',
      idempotent: true,
      status: 201,
    }),
  },
  '/api/v1/organizations/{orgId}/archive': {
    post: domainOperation('archiveOrganization', 'Organization', {
      ...org,
      input: 'OrganizationArchive',
      idempotent: true,
      versioned: true,
    }),
  },
  '/api/v1/organizations/{orgId}/members': {
    get: domainOperation('listMembers', 'Members', {
      ...org,
      list: true,
      filters: [roleFilter, filter('state', ['INVITED', 'ACTIVE', 'DISABLED'])],
    }),
  },
  '/api/v1/organizations/{orgId}/members/{userId}': {
    patch: domainOperation('updateMember', 'Member', {
      ids: ['orgId', 'userId'],
      input: 'MemberUpdate',
      versioned: true,
    }),
  },
  '/api/v1/organizations/{orgId}/invitations': {
    get: domainOperation('listInvitations', 'Invitations', {
      ...org,
      list: true,
      filters: [
        roleFilter,
        filter('state', ['INVITED', 'ACCEPTED', 'REVOKED', 'EXPIRED']),
      ],
    }),
    post: domainOperation('createInvitation', 'Invitation', {
      ...org,
      input: 'InvitationCreate',
      idempotent: true,
      status: 202,
    }),
  },
  '/api/v1/organizations/{orgId}/invitations/{invitationId}': {
    get: domainOperation('getInvitation', 'Invitation', invitation),
  },
  '/api/v1/organizations/{orgId}/invitations/{invitationId}/resend': {
    post: domainOperation('resendInvitation', 'Invitation', {
      ...invitation,
      idempotent: true,
      versioned: true,
      status: 202,
    }),
  },
  '/api/v1/organizations/{orgId}/invitations/{invitationId}/revoke': {
    post: domainOperation('revokeInvitation', 'Invitation', {
      ...invitation,
      idempotent: true,
      versioned: true,
    }),
  },
  '/api/v1/invitations/{invitationId}/accept': {
    post: domainOperation('acceptInvitation', 'InvitationAcceptance', {
      ids: ['invitationId'],
      input: 'InvitationAccept',
      idempotent: true,
    }),
  },
  '/api/v1/invitations/{invitationId}/renew-auth': {
    post: domainOperation('renewInvitationAuth', 'Invitation', {
      ids: ['invitationId'],
      input: 'InvitationProof',
      idempotent: true,
      publicRoute: true,
      status: 202,
    }),
  },
});
specification.paths['/api/v1/organizations/{orgId}'].patch = domainOperation(
  'updateOrganization',
  'Organization',
  { ...org, input: 'OrganizationUpdate', versioned: true },
);
addAcademicOpenApi(specification, domainOperation);
addMaterialsOpenApi(specification, domainOperation);
specification.paths['/api/v1/activities/{id}/exercises/{aeId}/executions'] = {
  post: {
    ...domainOperation('runExercise', 'RunExecution', {
      ids: ['id', 'aeId'],
      input: 'RunExecutionInput',
      idempotent: true,
      status: 201,
    }),
    description:
      'RUN temporal: fuente hasta 65536 bytes UTF-8 y envoltorio JSON hasta 512 KiB. La admisión previa al cierre puede terminar; el acceso se revalida antes de responder. Replays conservan ejecución y resultado durante 24 horas; una clave expirada nunca vuelve a ejecutar. No crea intentos, progreso ni ayuda.',
  },
};
specification.paths['/api/v1/activities/{id}/exercises/{aeId}/attempts'] = {
  post: {
    ...domainOperation('submitAttempt', 'Attempt', {
      ids: ['id', 'aeId'],
      input: 'SubmitAttemptInput',
      idempotent: true,
      status: 201,
    }),
    description:
      'SUBMIT ejecuta pruebas requeridas y responde 201 solo tras confirmar intento, resultado y eventos. Fuente hasta 65536 bytes UTF-8; envoltorio JSON hasta 512 KiB. Una admisión anterior al cierre puede persistir después; entrega y replay exigen acceso vigente. Misma clave/payload recupera el mismo intento durante 24 h; una clave expirada no reejecuta. previousAttemptId pertenece al mismo estudiante/asignación. No invoca IA.',
  },
  get: {
    ...domainOperation('listOwnAttempts', 'Attempts', { ids: ['id', 'aeId'] }),
    description:
      'Historial propio, sin código en la lista, ordenado por número de admisión descendente. Incluye CLOSED con permiso vigente. No concede acceso docente ni administrativo.',
    parameters: [
      pathId('id'),
      pathId('aeId'),
      {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
      },
      {
        name: 'cursor',
        in: 'query',
        schema: { type: 'string', pattern: '^[1-9][0-9]{0,15}$' },
      },
    ],
  },
};
specification.paths['/api/v1/attempts/{id}'] = {
  get: domainOperation('getOwnAttempt', 'Attempt', { ids: ['id'] }),
};
specification.paths['/api/v1/activities/{id}/progress'] = {
  get: {
    ...domainOperation('getOwnActivityProgress', 'ActivityProgress', {
      ids: ['id'],
    }),
    description:
      'Avance propio por asignación y versión, desde intentos confirmados que superan todas las pruebas requeridas. RUN no cuenta y un fallo posterior no elimina éxito previo. 0/0 tiene ratio null; la falta de intentos difiere de un error de servicio.',
  },
};
specification.paths['/api/v1/me/progress'] = {
  get: {
    ...domainOperation('getOwnStudentProgress', 'StudentProgress', {}),
    description:
      'Progreso acumulado propio al corte UTC. from limita observaciones e intentos paginados, nunca borra logros previos. Pistas desde HINT_DELIVERED deduplicado; última actividad hasta asOf. Permisos actuales y versiones publicadas. Sin corte se usa el servidor; fecha futura se rechaza. cursor/limit paginan observation.attempts, no los agregados ni evidencia de completitud.',
    parameters: [
      ...['classId', 'activityId', 'conceptId', 'from', 'asOf'].map((name) => ({
        name,
        in: 'query',
        required: name === 'classId',
        schema: {
          type: 'string',
          format: ['asOf', 'from'].includes(name) ? 'date-time' : 'uuid',
        },
      })),
      {
        name: 'cursor',
        in: 'query',
        schema: { type: 'string', maxLength: 4096 },
      },
      {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
    ],
  },
};
const observationParameters = (includeFrom = true) => [
  pathId('id'),
  ...['activityId', 'conceptId', ...(includeFrom ? ['from'] : []), 'asOf'].map(
    (name) => ({
      name,
      in: 'query',
      schema: {
        type: 'string',
        format: ['from', 'asOf'].includes(name) ? 'date-time' : 'uuid',
      },
    }),
  ),
  {
    name: 'cursor',
    in: 'query',
    schema: { type: 'string', maxLength: 4096, pattern: '^[A-Za-z0-9_-]+$' },
  },
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  },
];
specification.paths['/api/v1/classes/{id}/dashboard'] = {
  get: {
    ...domainOperation('getClassDashboard', 'Dashboard', { ids: ['id'] }),
    description:
      'Docente asignado vigente. Totales de matrícula actual ACTIVE, por estudiante/asignación; filtros antes de agregar. from/asOf inclusive limitan observación, progreso acumulado hasta asOf. Una lectura consistente, sin eventos ni evaluación de reglas. El cursor pagina estudiantes; agregados siempre completos. Señales históricas fuera de matrícula separadas de totales actuales.',
    parameters: observationParameters(),
  },
};
specification.paths['/api/v1/classes/{id}/dashboard/evidence'] = {
  get: {
    ...domainOperation('getClassDashboardEvidence', 'DashboardEvidence', {
      ids: ['id'],
    }),
    description:
      'Evidencia docente mínima del filtro: ATTEMPT del período, COMPLETION acumulada al corte, EVENT o HINT concedida. Reautoriza cada petición; no revela código, consola, contenido RAG ni tests ocultos. studentId solo restringe matrícula vigente, no concede acceso.',
    parameters: [
      ...observationParameters(),
      filter('kind', ['ATTEMPT', 'COMPLETION', 'EVENT', 'HINT']),
      {
        name: 'studentId',
        in: 'query',
        schema: { type: 'string', format: 'uuid' },
      },
      filter('diagnosisCode', [
        'SUCCESS',
        'SYNTAX_ERROR',
        'RUNTIME_ERROR',
        'FAILED_TEST',
        'TIMEOUT',
        'UNKNOWN',
      ]),
    ],
  },
};
specification.paths['/api/v1/classes/{id}/signals'] = {
  get: {
    ...domainOperation('listClassSignals', 'DashboardSignals', { ids: ['id'] }),
    description:
      'Historia persistida al corte con permisos docentes actuales. ACTIVE por defecto incluye episodios históricos interrumpidos; estado de revisión separado de última evaluación y disponibilidad del procesamiento. No admite from ni genera eventos, señales o reconstrucción. ALL es filtro, no estado persistido.',
    parameters: [
      ...observationParameters(false),
      filter('type', ['INACTIVITY', 'REPEATED_ERROR', 'STAGNATION']),
      filter('state', ['ACTIVE', 'REVIEWED', 'ALL']),
    ],
  },
};
specification.paths['/api/v1/classes/{id}/signals/{signalId}'] = {
  get: {
    ...domainOperation('getClassSignalEvidence', 'DashboardSignalDetail', {
      ids: ['id', 'signalId'],
    }),
    description:
      'Causa, configuración de regla, evidencia mínima y última evaluación persistida hasta asOf. No acredita evaluación exactamente en T. Historia autorizada fuera de matrícula se etiqueta; evidencia ausente se declara no verificable. Sin acciones de revisión ni detalle integral del alumno.',
    parameters: [
      pathId('id'),
      pathId('signalId'),
      {
        name: 'asOf',
        in: 'query',
        schema: { type: 'string', format: 'date-time' },
      },
    ],
  },
};
specification.paths['/api/v1/activities/{id}/open-events'] = {
  post: {
    ...domainOperation('recordOwnActivityOpening', 'ActivityOpen', {
      ids: ['id'],
      input: 'ActivityOpenInput',
      idempotent: true,
      status: 201,
    }),
    description:
      'Apertura intencional autenticada, con instante servidor e idempotencia permanente por actor/actividad/clave. Reintentos y remontajes usan la misma clave. No acepta timestamps cliente ni registra polling.',
  },
};
for (const route of ['executions', 'attempts']) {
  const { responses } =
    specification.paths[`/api/v1/activities/{id}/exercises/{aeId}/${route}`]
      .post;
  responses[409].headers['Retry-After'] = {
    description:
      'Solo REQUEST_IN_PROGRESS: 1 segundo antes de recuperar la misma operación con su Idempotency-Key; otros conflictos 409 no incluyen esta cabecera.',
    required: false,
    schema: { type: 'integer', enum: [1] },
  };
  responses[429].description =
    'RATE_LIMITED: cuota agotada, retryable=true y Retry-After: 60 segundos. Es distinto de la ocupación temporal del ejecutor.';
  responses[429].headers['Retry-After'] = {
    description: 'RATE_LIMITED: esperar 60 segundos antes de reintentar.',
    schema: { type: 'integer', enum: [60] },
  };
  responses[503].description =
    'RUNNER_BUSY: capacidad temporalmente ocupada, retryable=true y Retry-After: 1 segundo. La nueva operación no fue admitida, no consumió cuota ni creó ejecución o intento; conserva el código y permite reintento manual, sin cola. La recuperación idempotente se resuelve antes de comprobar capacidad; una misma clave todavía en curso devuelve 409 REQUEST_IN_PROGRESS. DEPENDENCY_UNAVAILABLE y PERSISTENCE_UNAVAILABLE indican dependencia no disponible o persistencia no confirmada, sin Retry-After; no equivalen a RUNNER_BUSY ni garantizan ausencia de admisión. Recupera una respuesta incierta con la misma Idempotency-Key y el mismo cuerpo.';
  responses[503].headers['Retry-After'] = {
    description:
      'Solo RUNNER_BUSY: 1 segundo antes del reintento manual. DEPENDENCY_UNAVAILABLE y PERSISTENCE_UNAVAILABLE no incluyen esta cabecera.',
    required: false,
    schema: { type: 'integer', enum: [1] },
  };
}
specification.paths['/api/v1/organizations/{orgId}/signal-rules'] = {
  get: {
    ...domainOperation('listSignalRuleVersions', 'SignalRuleVersions', {
      ids: ['orgId'],
    }),
    description:
      'ADMIN vigente de la organización; versiones con parámetros e historial, sin evidencia individual. Lista vacía indica ausencia de configuración. El cursor debe pertenecer a la organización y al filtro de tipo.',
    parameters: [
      pathId('orgId'),
      filter('type', ['INACTIVITY', 'REPEATED_ERROR', 'STAGNATION']),
      {
        name: 'cursor',
        in: 'query',
        schema: { type: 'string', format: 'uuid' },
      },
      {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
    ],
  },
  post: {
    ...domainOperation('createSignalRuleVersion', 'SignalRuleVersion', {
      ids: ['orgId'],
      input: 'SignalRuleCreate',
      idempotent: true,
      status: 201,
    }),
    description:
      'ADMIN vigente; crea una versión DRAFT inmutable sin activarla. Schema 1 y algoritmo DEC005_V1; parámetros específicos por tipo, sin scripts, autor ni fechas del cliente. Idempotencia permanente por actor/organización/operación/clave; replay recupera el snapshot confirmado y otro payload devuelve 409.',
  },
};
specification.paths['/api/v1/organizations/{orgId}/signal-rules/effective'] = {
  get: {
    ...domainOperation('getEffectiveSignalRules', 'SignalRuleEffective', {
      ids: ['orgId'],
    }),
    description:
      'ADMIN vigente de la organización, incluida lectura administrativa ARCHIVED. Una lectura coherente devuelve exactamente INACTIVITY, REPEATED_ERROR y STAGNATION con ruleVersion ACTIVE del mismo ámbito o null si no está configurada. observedAt es la hora UTC de la sentencia con microsegundos: no representa un corte de evaluación ni confirma procesamiento del worker. No admite filtros, fechas cliente ni evidencia pedagógica. La vigencia actual debe consultarse nuevamente después de una mutación o replay.',
  },
};
specification.paths['/api/v1/signal-rules/{id}'] = {
  get: {
    ...domainOperation('getSignalRuleVersion', 'SignalRuleVersion', {
      ids: ['id'],
    }),
    description:
      'Deriva la organización del recurso autorizado; solo ADMIN vigente. DRAFT/ACTIVE/RETIRED describen vigencia de versiones de regla, separados de los estados de señal ACTIVE/REVIEWED. Un ID ajeno responde 404. Conserva precisión UTC de microsegundos.',
  },
};
specification.paths['/api/v1/signal-rules/{id}/activate'] = {
  post: {
    ...domainOperation('activateSignalRuleVersion', 'SignalRuleVersion', {
      ids: ['id'],
      input: 'SignalRuleActivate',
      idempotent: true,
    }),
    description:
      'Activación inmediata con instante del servidor y vigencias [desde,hasta), serializada por organización/tipo. expectedCurrentVersionId es obligatorio: null significa que no hay vigente. Expectativa obsoleta devuelve 409 RULE_VERSION_CONFLICT; una versión retirada no se reactiva. Misma clave conserva el instante y la auditoría; permiso vigente se comprueba incluso en replay. No programa fechas ni evalúa o crea señales.',
  },
};
addHelpOpenApi(specification, domainOperation);
specification.paths['/api/v1/signals/{id}/review'] = {
  put: {
    ...domainOperation('reviewSignal', 'SignalReview', {
      ids: ['id'],
      input: 'SignalReviewInput',
    }),
    description:
      'IMP-06.04. Profesor vigente asignado, organización/clase operativas y estudiante CURRENT_ACTIVE. Cuerpo {} estricto, sin query. Idempotencia permanente por episodio, sin If-Match ni Idempotency-Key obligatorio; reautoriza también en replay. Conserva primer reviewedBy/reviewedAt y evidencia. reviewedByName es la etiqueta actual del perfil, sin correo. Confirma revisión y auditoría atómicamente; un lease ocupado devuelve 409 REQUEST_IN_PROGRESS con Retry-After: 1. El estado devuelto es vigente y no reescribe lecturas históricas asOf.',
  },
};
addExerciseBankOpenApi(specification, domainOperation);
addStudentDetailOpenApi(specification, domainOperation);
addAuditOpenApi(specification, domainOperation);
addAuditExportOpenApi(specification, domainOperation);
await writeFile(
  new URL('../packages/contracts/openapi.json', import.meta.url),
  await format(JSON.stringify(specification), { parser: 'json' }),
);
console.log('OpenAPI generado desde los contratos compartidos de producto.');
