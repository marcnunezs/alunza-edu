import { writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { z } from 'zod';
import * as contracts from '@alunza/contracts';
import { addAcademicOpenApi } from './academic-openapi.mjs';
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
    title: 'Alunza — identidad, estructura académica y contenido',
    version: '0.2.0',
    description:
      'IMP-02. Autorización vigente por organización/clase; publicación y editor. Ejecución estudiantil y progreso todavía fuera del corte.',
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
await writeFile(
  new URL('../packages/contracts/openapi.json', import.meta.url),
  await format(JSON.stringify(specification), { parser: 'json' }),
);
console.log(
  'OpenAPI generado desde schemas compartidos de identidad y gobierno.',
);
