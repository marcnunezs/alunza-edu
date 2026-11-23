import { MaterialsService, materialHash } from './materials.service';
import type {
  MaterialsRepository,
  MaterialReservation,
} from './materials.repository';
import type { MaterialsStoragePort } from './materials.ports';
import { ApiError } from '../http/errors';
const who = {
  actorId: '10000000-0000-4000-8000-000000000001',
  sessionId: '10000000-0000-4000-8000-000000000002',
  requestId: '10000000-0000-4000-8000-000000000003',
};
const data = Buffer.from('Una variable conserva un valor.');
const file = { originalname: 'Variables.txt', buffer: data, size: data.length };
const reserved: MaterialReservation = {
  kind: 'reserved',
  sourceId: who.actorId,
  versionId: who.sessionId,
  generationId: who.requestId,
  jobId: who.actorId,
  uploadToken: who.sessionId,
  storageKey: 'opaque/key',
};
function fixture() {
  const repository = {
    reserve: jest.fn().mockResolvedValue(reserved),
    confirm: jest.fn().mockResolvedValue(true),
    operation: jest.fn().mockResolvedValue({ accepted: true }),
    fail: jest.fn().mockResolvedValue(true),
    content: jest.fn().mockResolvedValue({
      key: 'opaque/key',
      fileName: 'Variables.txt',
      mimeType: 'text/plain',
      sizeBytes: data.length,
      sha256: materialHash(data),
    }),
  };
  const storage = {
    stat: jest.fn().mockResolvedValue(null),
    download: jest.fn().mockResolvedValue(data),
    upload: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn(),
  };
  return {
    repository,
    storage,
    service: new MaterialsService(
      repository as unknown as MaterialsRepository,
      storage as MaterialsStoragePort,
    ),
  };
}
test('upload verifies actual stored bytes before durable acceptance', async () => {
  const { service, repository, storage } = fixture();
  await expect(
    service.upload(
      who,
      who.actorId,
      null,
      null,
      { title: 'Variables' },
      file,
      'upload-001',
    ),
  ).resolves.toEqual({ accepted: true });
  expect(storage.download).toHaveBeenCalledWith('opaque/key');
  expect(storage.download.mock.invocationCallOrder[0]).toBeLessThan(
    repository.confirm.mock.invocationCallOrder[0]!,
  );
  expect(repository.reserve.mock.calls[0][6]).toMatchObject({
    format: 'TXT',
    sizeBytes: data.length,
    sha256: materialHash(data),
  });
});
test('uncertain upload error leaves the durable reservation without confirming or deleting', async () => {
  const { service, repository, storage } = fixture();
  storage.upload.mockRejectedValue(
    new ApiError('STORAGE_UNAVAILABLE', 'Unavailable', 503, true),
  );
  await expect(
    service.upload(
      who,
      who.actorId,
      null,
      null,
      { title: 'Variables' },
      file,
      'upload-001',
    ),
  ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  expect(repository.confirm).not.toHaveBeenCalled();
  expect(storage.remove).not.toHaveBeenCalled();
});
test('reconciliation detects a stored hash mismatch and never confirms', async () => {
  const { service, repository, storage } = fixture();
  storage.stat.mockResolvedValue({
    sizeBytes: data.length,
    contentType: 'text/plain',
  });
  storage.download.mockResolvedValue(Buffer.from('Distinto'));
  await expect(
    service.upload(
      who,
      who.actorId,
      null,
      null,
      { title: 'Variables' },
      file,
      'upload-001',
    ),
  ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  expect(repository.fail).toHaveBeenCalledWith(
    { id: reserved.jobId, token: reserved.uploadToken },
    'CONTENT_MISMATCH',
  );
  expect(repository.confirm).not.toHaveBeenCalled();
});
test('idempotent replay does not upload or invoke Storage again', async () => {
  const { service, repository, storage } = fixture();
  repository.reserve.mockResolvedValue({ ...reserved, kind: 'replay' });
  await service.upload(
    who,
    who.actorId,
    null,
    null,
    { title: 'Variables' },
    file,
    'upload-001',
  );
  expect(storage.stat).not.toHaveBeenCalled();
  expect(storage.upload).not.toHaveBeenCalled();
  expect(repository.confirm).not.toHaveBeenCalled();
});
test('failed upload replay preserves failure and never reports accepted storage', async () => {
  const { service, repository, storage } = fixture();
  repository.reserve.mockResolvedValue({
    ...reserved,
    kind: 'replay',
    responseStatus: 503,
  });
  await expect(
    service.upload(
      who,
      who.actorId,
      null,
      null,
      { title: 'Variables' },
      file,
      'upload-001',
    ),
  ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  expect(repository.operation).not.toHaveBeenCalled();
  expect(storage.stat).not.toHaveBeenCalled();
});
test('content is withheld if authorization changes during download', async () => {
  const { service, repository } = fixture();
  repository.content
    .mockResolvedValueOnce({
      key: 'opaque/key',
      fileName: 'Variables.txt',
      mimeType: 'text/plain',
      sizeBytes: data.length,
      sha256: materialHash(data),
    })
    .mockRejectedValueOnce(new ApiError('RESOURCE_NOT_FOUND', 'Gone', 404));
  await expect(
    service.content(who, who.actorId, who.sessionId),
  ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  expect(repository.content).toHaveBeenCalledTimes(2);
});
test.each(['../file.txt', 'file.exe', 'file.pdf'])(
  'invalid filename or content %s reaches no persistent reservation',
  async (name) => {
    const { service, repository } = fixture();
    await expect(
      service.upload(
        who,
        who.actorId,
        null,
        null,
        { title: 'Variables' },
        { ...file, originalname: name },
        'upload-001',
      ),
    ).rejects.toBeInstanceOf(ApiError);
    expect(repository.reserve).not.toHaveBeenCalled();
  },
);
