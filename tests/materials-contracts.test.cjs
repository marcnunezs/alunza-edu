/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const c = require('@alunza/contracts');
test('material upload does not accept client ownership, scope broadening or storage paths', () => {
  expect(
    c.materialUploadInputSchema.safeParse({
      title: 'Funciones',
      activityId: randomUUID(),
    }).success,
  ).toBe(true);
  for (const field of [
    'organizationId',
    'classId',
    'ownerId',
    'storageKey',
    'visible',
    'activeVersion',
  ])
    expect(
      c.materialUploadInputSchema.safeParse({
        title: 'Funciones',
        [field]: randomUUID(),
      }).success,
    ).toBe(false);
  expect(c.materialUploadInputSchema.safeParse({ title: 'a\0b' }).success).toBe(
    false,
  );
});
test('materials APIs all require authentication and document durable multipart acceptance', () => {
  const spec = JSON.parse(
    readFileSync(`${__dirname}/../packages/contracts/openapi.json`, 'utf8'),
  );
  const paths = Object.entries(spec.paths).filter(
    ([path]) =>
      !path.startsWith('/api/v1/feedback/') &&
      (path.includes('/sources') || path.includes('/source-scopes')),
  );
  expect(paths.length).toBe(10);
  expect(
    spec.paths['/api/v1/sources/{id}/versions/{versionId}/chunks'].get
      .responses[200],
  ).toBeDefined();
  expect(
    spec.paths['/api/v1/classes/{id}/sources'].get.parameters.find(
      (p) => p.name === 'cursor',
    ).schema.format,
  ).toBe('uuid');
  expect(
    spec.paths[
      '/api/v1/sources/{id}/versions/{versionId}/chunks'
    ].get.parameters.find((p) => p.name === 'cursor').schema.pattern,
  ).toBe('^[0-9]+$');
  for (const [, methods] of paths)
    for (const operation of Object.values(methods))
      expect(operation.security).toEqual([{ bearerAuth: [] }]);
  const upload = spec.paths['/api/v1/classes/{id}/sources'].post;
  expect(upload.responses[202]).toBeDefined();
  expect(
    upload.requestBody.content['multipart/form-data'].schema.properties.file
      .format,
  ).toBe('binary');
  expect(
    upload.parameters.some((p) => p.name === 'Idempotency-Key' && p.required),
  ).toBe(true);
  expect(
    spec.paths['/api/v1/sources/{id}/visibility'].patch.parameters.some(
      (p) => p.name === 'If-Match' && p.required,
    ),
  ).toBe(true);
});
test('operational material states do not extend the RAG result vocabulary', () => {
  for (const state of [
    'UPLOADED',
    'PROCESSING',
    'READY',
    'FAILED',
    'ARCHIVED',
    'QUEUED',
    'RUNNING',
  ])
    expect(c.ragStatusSchema.safeParse(state).success).toBe(false);
  expect(c.MATERIAL_MAX_BYTES).toBe(10_000_000);
  expect(
    c.materialVisibilityInputSchema.safeParse({
      visible: true,
      classId: randomUUID(),
    }).success,
  ).toBe(false);
});
