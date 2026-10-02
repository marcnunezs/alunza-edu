/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const c = require('@alunza/contracts');

test('help inputs cannot supply diagnosis, code, actor, corpus or a feedback hint level', () => {
  expect(c.helpRequestInputSchema.parse({ kind: 'FEEDBACK' })).toEqual({
    kind: 'FEEDBACK',
  });
  for (const extra of [
    { hintLevel: 1 },
    { code: 'secret' },
    { diagnosis_code: 'SUCCESS' },
    { organizationId: randomUUID() },
    { sourceIds: [randomUUID()] },
    { studentId: randomUUID() },
  ])
    expect(
      c.helpRequestInputSchema.safeParse({ kind: 'FEEDBACK', ...extra })
        .success,
    ).toBe(false);
  for (const hintLevel of [0, 4, 1.5, '1'])
    expect(
      c.helpRequestInputSchema.safeParse({ kind: 'HINT', hintLevel }).success,
    ).toBe(false);
  for (const hintLevel of [1, 2, 3])
    expect(
      c.helpRequestInputSchema.safeParse({ kind: 'HINT', hintLevel }).success,
    ).toBe(true);
});
test('viewed acknowledgement accepts only the presentation token', () => {
  expect(
    c.helpViewedInputSchema.safeParse({ presentationToken: randomUUID() })
      .success,
  ).toBe(true);
  for (const extra of [
    { hintLevel: 3 },
    { viewedAt: new Date().toISOString() },
    { studentId: randomUUID() },
    { source_refs: [] },
  ])
    expect(
      c.helpViewedInputSchema.safeParse({
        presentationToken: randomUUID(),
        ...extra,
      }).success,
    ).toBe(false);
});
test('help APIs document separate durable requests, GET and acknowledgement', () => {
  const spec = JSON.parse(
    readFileSync(`${__dirname}/../packages/contracts/openapi.json`, 'utf8'),
  );
  const paths = Object.entries(spec.paths).filter(([path]) =>
    path.includes('/feedback'),
  );
  expect(paths).toHaveLength(7);
  for (const [, methods] of paths)
    for (const operation of Object.values(methods))
      expect(operation.security).toEqual([{ bearerAuth: [] }]);
  const request = spec.paths['/api/v1/attempts/{id}/feedback-requests'].post;
  expect(request.responses[202]).toBeDefined();
  expect(
    request.parameters.find((p) => p.name === 'Idempotency-Key')?.required,
  ).toBe(true);
  expect(
    spec.paths['/api/v1/feedback/{id}/viewed'].post.responses[200],
  ).toBeDefined();
  expect(
    spec.paths['/api/v1/feedback/{id}/sources/{chunkId}/content'].get
      .responses[200].content['application/pdf'].schema.format,
  ).toBe('binary');
});
