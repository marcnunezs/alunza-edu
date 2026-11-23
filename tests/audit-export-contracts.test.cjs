/* eslint @typescript-eslint/no-require-imports: "off" */
const {
  auditExportRequestSchema,
  auditExportMetadataSchema,
  errorResponseSchema,
} = require('@alunza/contracts');
const org = '10000000-0000-4000-8000-000000000001';
const id = '10000000-0000-4000-8000-000000000002';
const at = '2026-11-02T15:00:00.123456Z';
const metadata = {
  state: 'READY',
  exportId: id,
  organizationId: org,
  filters: { asOf: at },
  snapshotAt: at,
  generatedAt: at,
  expiresAt: '2026-11-03T15:00:00.123456Z',
  rowCount: 10000,
  byteLength: 10485760,
  sha256: 'a'.repeat(64),
  fileName: `auditoria-${org}-${id}.csv`,
  downloadPath: `/api/v1/organizations/${org}/audit-exports/${id}/content`,
  formatVersion: 'audit-csv-v1',
};
test.each([
  'AUDIT_EXPORT_LIMIT_EXCEEDED',
  'AUDIT_EXPORT_EXPIRED',
  'AUDIT_EXPORT_FAILED',
  'AUDIT_EXPORT_INTERRUPTED',
])('terminal error %s is a valid HTTP envelope', (code) => {
  expect(
    errorResponseSchema.safeParse({
      error: {
        code,
        message: 'Resultado terminal.',
        fields: [],
        retryable: false,
      },
      requestId: id,
    }).success,
  ).toBe(true);
});
test('export requires explicit cutoff and excludes pagination or unknown options', () => {
  expect(auditExportRequestSchema.safeParse({ asOf: at }).success).toBe(true);
  for (const value of [
    {},
    { asOf: at, cursor: 'abc' },
    { asOf: at, limit: 10 },
    { asOf: at, format: 'xlsx' },
    { asOf: at, from: '2026-11-03T00:00:00Z' },
  ])
    expect(auditExportRequestSchema.safeParse(value).success).toBe(false);
});
test('metadata validates exact limits and download destination', () => {
  expect(auditExportMetadataSchema.safeParse(metadata).success).toBe(true);
  for (const change of [
    { rowCount: 10001 },
    { byteLength: 10485761 },
    { sha256: 'NO' },
    { fileName: '../../file.csv' },
    { downloadPath: 'https://host.invalid/file.csv' },
    { state: 'RUNNING' },
    { expiresAt: '2026-11-03T15:00:01.123456Z' },
    { content: 'private' },
  ])
    expect(
      auditExportMetadataSchema.safeParse({ ...metadata, ...change }).success,
    ).toBe(false);
});
