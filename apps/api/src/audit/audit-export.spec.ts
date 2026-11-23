import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import type { AuditEvent } from '@alunza/contracts';
import { AUDIT_EXPORT_MAX_BYTES } from '@alunza/contracts';
import { ApiError, databaseUnavailable } from '../http/errors';
import { auditCsv, auditCsvCell } from './audit-export-csv';
import { AuditExportAdmission } from './audit-export-admission';
import { AuditExportService } from './audit-export.service';
import { AuditExportRepository } from './audit-export.repository';
import {
  AuditExportController,
  observeDelivery,
} from './audit-export.controller';
import type { ApiRequest } from '../http/errors';

const org = '10000000-0000-4000-8000-000000000001';
const id = '10000000-0000-4000-8000-000000000002';
const token = '10000000-0000-4000-8000-000000000003';
const who = { actorId: id, sessionId: token, requestId: org };
const at = '2026-11-02T15:00:00.123456Z';
const filters = { asOf: at };
const row: AuditEvent = {
  eventId: id,
  occurredAt: at,
  actorId: null,
  action: 'CREATE',
  entityType: 'CLASS',
  entityId: null,
  organizationId: org,
  outcome: 'SUCCEEDED',
};
const csv = auditCsv([row]);
const metadata = {
  state: 'READY',
  exportId: id,
  organizationId: org,
  filters,
  snapshotAt: at,
  generatedAt: at,
  expiresAt: '2026-11-03T15:00:00.123456Z',
  rowCount: 1,
  byteLength: csv.bytes.length,
  sha256: csv.sha256,
  fileName: `auditoria-${org}-${id}.csv`,
  downloadPath: `/api/v1/organizations/${org}/audit-exports/${id}/content`,
  formatVersion: 'audit-csv-v1',
};
function setup() {
  const repository = {
    authorize: jest.fn().mockResolvedValue(undefined),
    reserve: jest
      .fn()
      .mockResolvedValue({ kind: 'CLAIMED', exportId: id, leaseToken: token }),
    capture: jest.fn().mockResolvedValue({ snapshotAt: at, items: [row] }),
    finish: jest.fn().mockResolvedValue(metadata),
    metadata: jest
      .fn()
      .mockRejectedValue(
        new ApiError('REQUEST_IN_PROGRESS', 'En curso', 409, true),
      ),
    fail: jest.fn().mockResolvedValue(undefined),
    content: jest.fn().mockResolvedValue({ metadata, content: csv.bytes }),
    beginDelivery: jest
      .fn()
      .mockResolvedValue({ ticketId: id, ticketToken: token }),
    finishDelivery: jest.fn().mockResolvedValue(undefined),
  };
  const admission = new AuditExportAdmission();
  const service = new AuditExportService(
    repository as unknown as AuditExportRepository,
    admission,
  );
  return { repository, admission, service };
}
// Independent RFC4180 reader: consumes characters rather than splitting lines
// (a quoted field may contain embedded CRLF, comma and doubled quotes).
function readCsv(bytes: Buffer) {
  const input = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      cells.push(field);
      field = '';
    } else if (c === '\r' && input[i + 1] === '\n' && !quoted) {
      cells.push(field);
      rows.push(cells);
      cells = [];
      field = '';
      i++;
    } else field += c;
  }
  expect(quoted).toBe(false);
  expect(field).toBe('');
  return rows;
}
test('CSV preserves UTF8, microseconds, nulls, quotes and multiline cells with exactly eight columns', () => {
  const result = auditCsv([{ ...row, action: 'acción,"uno"\r\ndos' }]);
  expect(result.bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(readCsv(result.bytes)).toEqual([
    [
      'event_id',
      'occurred_at',
      'actor_id',
      'action',
      'entity_type',
      'entity_id',
      'organization_id',
      'outcome',
    ],
    [id, at, '', 'acción,"uno"\r\ndos', 'CLASS', '', org, 'SUCCEEDED'],
  ]);
  expect(result.sha256).toBe(
    createHash('sha256').update(result.bytes).digest('hex'),
  );
  expect(readCsv(auditCsv([]).bytes)).toHaveLength(1);
});
test.each([
  '=1+1',
  '+1+1',
  '-1+1',
  '@SUM(1)',
  '＝1',
  '＋1',
  '－1',
  '＠x',
  ' \t\r\n=1',
  '\u200B=1',
  '\uFEFF+1',
])('formula-like cell becomes literal text: %j', (value) => {
  expect(auditCsvCell(value).startsWith('"texto: ')).toBe(true);
});
test('control characters become visible escape sequences; ordinary text is unchanged', () => {
  expect(auditCsvCell('a\u0000\t\u202Eb')).toBe('"a\\u0000\\u0009\\u202eb"');
  expect(auditCsvCell('A - B')).toBe('"A - B"');
});
test('10,001 rows are rejected rather than silently truncated', () => {
  expect(() => auditCsv(Array.from({ length: 10001 }, () => row))).toThrow(
    expect.objectContaining({
      code: 'AUDIT_EXPORT_LIMIT_EXCEEDED',
      status: 422,
      retryable: false,
    }),
  );
});
test('final byte boundary includes BOM/quoting/escaped controls and accepts exactly10MiB', () => {
  const base = { ...row, action: 'a', entityType: 'b', outcome: 'c' };
  const rows = Array.from({ length: 10000 }, () => ({ ...base }));
  let remaining = AUDIT_EXPORT_MAX_BYTES - auditCsv(rows).bytes.length;
  // A control costs six bytes. Replace each one-byte base field by up to100
  // controls, then use one ordinary character for each remaining byte.
  for (const event of rows) {
    for (const [key, max] of [
      ['action', 100],
      ['entityType', 100],
      ['outcome', 80],
    ] as const) {
      if (!remaining) break;
      const extra = Math.min(remaining, 6 * max - 1);
      const total = extra + 1;
      const controls = Math.floor(total / 6);
      const plain = total % 6;
      event[key] = '\u0001'.repeat(controls) + 'x'.repeat(plain);
      if (event[key].length > max) {
        event[key] = '\u0001'.repeat(controls - 1) + 'x'.repeat(plain + 6);
      }
      // Avoid overfilling the Zod character cap at rare remainder boundaries.
      if (event[key].length > max) {
        event[key] = '\u0001'.repeat(max - 1);
      }
      const actual = Buffer.byteLength(auditCsvCell(event[key])) - 3;
      remaining -= actual;
    }
  }
  expect(remaining).toBe(0);
  expect(auditCsv(rows).bytes.length).toBe(AUDIT_EXPORT_MAX_BYTES);
  const last = rows.at(-1)!;
  last.action += 'x';
  expect(() => auditCsv(rows)).toThrow(
    expect.objectContaining({ code: 'AUDIT_EXPORT_LIMIT_EXCEEDED' }),
  );
});
test('global admission permits two operations and releases each slot once', () => {
  const admission = new AuditExportAdmission();
  const a = admission.acquire();
  const b = admission.acquire();
  expect(() => admission.acquire()).toThrow(
    expect.objectContaining({ code: 'RATE_LIMITED' }),
  );
  a();
  a();
  const c = admission.acquire();
  expect(() => admission.acquire()).toThrow();
  b();
  c();
});
test('create persists exact CSV and capture token; replay does not recapture', async () => {
  const { service, repository } = setup();
  expect(await service.create(who, org, 'export-key', filters)).toEqual(
    metadata,
  );
  expect(repository.finish).toHaveBeenCalledWith(
    who,
    org,
    id,
    token,
    at,
    csv.bytes,
    1,
    csv.sha256,
  );
  repository.reserve.mockResolvedValue({ kind: 'READY', metadata });
  await service.create(who, org, 'export-key', filters);
  expect(repository.capture).toHaveBeenCalledTimes(1);
  expect(repository.authorize).toHaveBeenCalledTimes(2);
});
test('lost finish COMMIT response recovers READY without fail or second capture', async () => {
  const { service, repository } = setup();
  repository.finish.mockRejectedValue(databaseUnavailable());
  repository.metadata.mockResolvedValue(metadata);
  expect(await service.create(who, org, 'export-key', filters)).toEqual(
    metadata,
  );
  expect(repository.fail).not.toHaveBeenCalled();
  expect(repository.capture).toHaveBeenCalledTimes(1);
});
test('uncertain COMMIT and unavailable observation preserve the reservation', async () => {
  const { service, repository } = setup();
  repository.finish.mockRejectedValue(databaseUnavailable());
  repository.metadata.mockRejectedValue(databaseUnavailable());
  await expect(
    service.create(who, org, 'export-key', filters),
  ).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE', retryable: true });
  expect(repository.fail).not.toHaveBeenCalled();
});
test('cap failure is durable and replay retains original terminal error', async () => {
  const { service, repository } = setup();
  repository.capture.mockResolvedValue({
    snapshotAt: at,
    items: Array.from({ length: 10001 }, () => row),
  });
  repository.fail.mockImplementation(async () => {
    repository.metadata.mockRejectedValue(
      new ApiError('AUDIT_EXPORT_LIMIT_EXCEEDED', 'Límite', 422),
    );
  });
  await expect(
    service.create(who, org, 'export-key', filters),
  ).rejects.toMatchObject({ code: 'AUDIT_EXPORT_LIMIT_EXCEEDED' });
  expect(repository.fail).toHaveBeenCalledWith(
    id,
    token,
    'AUDIT_EXPORT_LIMIT_EXCEEDED',
    422,
  );
  repository.reserve.mockResolvedValue({
    kind: 'FAILED',
    error: { code: 'AUDIT_EXPORT_LIMIT_EXCEEDED' },
  });
  await expect(
    service.create(who, org, 'export-key', filters),
  ).rejects.toMatchObject({
    code: 'AUDIT_EXPORT_LIMIT_EXCEEDED',
    retryable: false,
  });
  expect(repository.capture).toHaveBeenCalledTimes(1);
});
test('durable INTERRUPTED observation wins over generic generation failure', async () => {
  const { service, repository } = setup();
  repository.finish.mockRejectedValue(databaseUnavailable());
  repository.metadata.mockRejectedValue(
    new ApiError('AUDIT_EXPORT_INTERRUPTED', 'Interrumpida', 503),
  );
  await expect(
    service.create(who, org, 'export-key', filters),
  ).rejects.toMatchObject({ code: 'AUDIT_EXPORT_INTERRUPTED' });
  expect(repository.fail).not.toHaveBeenCalled();
});
test('download verifies bytes before authorizing durable delivery ticket', async () => {
  const { service, repository } = setup();
  repository.content.mockResolvedValueOnce({
    metadata,
    content: Buffer.from('corrupt'),
  });
  await expect(service.content(who, org, id)).rejects.toMatchObject({
    code: 'PERSISTENCE_UNAVAILABLE',
  });
  expect(repository.beginDelivery).not.toHaveBeenCalled();
  const result = await service.content(who, org, id);
  expect(result.bytes).toEqual(csv.bytes);
  expect(repository.beginDelivery).toHaveBeenCalledWith(who, org, id);
  result.release();
});
test('revocation after content read prevents sending or creating a ticket', async () => {
  const { service, repository } = setup();
  repository.beginDelivery.mockRejectedValue(
    new ApiError('FORBIDDEN', 'Denegado', 403),
  );
  await expect(service.content(who, org, id)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});
test.each([
  ['finish', 'close', 'FINISHED'],
  ['close', 'finish', 'ABORTED'],
] as const)(
  'delivery %s then%s has exactly one durable terminal callback',
  async (first, second, outcome) => {
    const response = new EventEmitter() as Response;
    const finish = jest.fn().mockResolvedValue(undefined);
    const release = jest.fn();
    observeDelivery(response, finish, release);
    response.emit(first);
    response.emit(second);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith(outcome);
    expect(release).toHaveBeenCalledTimes(1);
  },
);
test('a failed terminal callback never retries or changes outcome locally', async () => {
  const response = new EventEmitter() as Response;
  const finish = jest.fn().mockRejectedValue(databaseUnavailable());
  observeDelivery(response, finish, jest.fn());
  response.emit('finish');
  response.emit('close');
  await Promise.resolve();
  expect(finish).toHaveBeenCalledTimes(1);
});
test('HEAD returns verified metadata headers without fetching bytes or delivery ticket', async () => {
  const { service, repository } = setup();
  repository.metadata.mockResolvedValue(metadata);
  const response = {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    end: jest.fn(),
  } as unknown as Response;
  await new AuditExportController(service).head(
    { ...who, method: 'HEAD' } as ApiRequest,
    response,
    org,
    id,
    {},
  );
  expect(repository.content).not.toHaveBeenCalled();
  expect(repository.beginDelivery).not.toHaveBeenCalled();
  expect(response.setHeader).toHaveBeenCalledWith(
    'Content-Length',
    csv.bytes.length,
  );
});
