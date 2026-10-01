const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  meResponseSchema,
  organizationResponseSchema,
  errorResponseSchema,
} = require('@alunza/contracts');

test('proyección pública rechaza secretos y propiedades no declaradas', () => {
  const response = {
    data: {
      id: randomUUID(),
      code: 'ORG-A',
      name: 'Alunza A',
      timezone: 'America/Santiago',
      revision: 1,
      state: 'ACTIVE',
      archivedAt: null,
    },
    requestId: randomUUID(),
  };
  expect(organizationResponseSchema.safeParse(response).success).toBe(true);
  expect(
    organizationResponseSchema.safeParse({
      ...response,
      data: { ...response.data, serviceRoleKey: 'private' },
    }).success,
  ).toBe(false);
});
test('identidad pública exige membresía activa y rol del catálogo', () => {
  const response = {
    data: {
      id: randomUUID(),
      displayName: 'Estudiante',
      accountState: 'ACTIVE',
      memberships: [
        {
          organizationId: randomUUID(),
          organizationName: 'Alunza A',
          organizationState: 'ACTIVE',
          accessMode: 'OPERATE',
          role: 'STUDENT',
          state: 'ACTIVE',
        },
      ],
      provisioningGrants: [],
      canProvisionOrganization: false,
    },
    requestId: randomUUID(),
  };
  expect(meResponseSchema.safeParse(response).success).toBe(true);
  response.data.memberships[0].role = 'SUPERADMIN';
  expect(meResponseSchema.safeParse(response).success).toBe(false);
  response.data.memberships = [];
  expect(meResponseSchema.safeParse(response).success).toBe(true);
});
test('errores seguros no admiten stack ni códigos ajenos al contrato', () => {
  const error = {
    error: {
      code: 'UNAUTHENTICATED',
      message: 'Sesión requerida.',
      fields: [],
      retryable: false,
    },
    requestId: randomUUID(),
  };
  expect(errorResponseSchema.safeParse(error).success).toBe(true);
  expect(
    errorResponseSchema.safeParse({ ...error, stack: 'internal' }).success,
  ).toBe(false);
});
test('OpenAPI documenta identidad, mutaciones y prueba de destinatario sin omitir autorización', () => {
  const spec = JSON.parse(
    readFileSync(join(__dirname, '../packages/contracts/openapi.json'), 'utf8'),
  );
  expect(spec.paths['/api/v1/organizations'].post.security).toEqual([
    { bearerAuth: [] },
  ]);
  expect(
    spec.paths['/api/v1/organizations'].post.parameters.some(
      (item) => item.name === 'Idempotency-Key' && item.required,
    ),
  ).toBe(true);
  expect(
    spec.paths['/api/v1/organizations/{orgId}'].patch.parameters.some(
      (item) => item.name === 'If-Match' && item.required,
    ),
  ).toBe(true);
  expect(
    spec.paths['/api/v1/invitations/{invitationId}/accept'].post.security,
  ).toEqual([{ bearerAuth: [] }]);
  expect(
    spec.paths['/api/v1/invitations/{invitationId}/renew-auth'].post.requestBody
      .required,
  ).toBe(true);
  expect(spec.paths['/api/v1/me'].get.security).toEqual([{ bearerAuth: [] }]);
  expect(spec.paths['/health/ready'].get.responses['503']).toBeDefined();
});
