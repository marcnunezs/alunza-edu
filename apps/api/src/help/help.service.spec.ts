import { HelpService } from './help.service';
import type { HelpRepository } from './help.repository';
import type { MaterialsStoragePort } from '../materials/materials.ports';
import { materialHash } from '../materials/materials.service';
import { ApiError } from '../http/errors';

const who = {
  actorId: '10000000-0000-4000-8000-000000000001',
  sessionId: '10000000-0000-4000-8000-000000000002',
  requestId: '10000000-0000-4000-8000-000000000003',
};
const feedbackId = '20000000-0000-4000-8000-000000000001';
const chunkId = '30000000-0000-4000-8000-000000000001';
const bytes = Buffer.from('Una función retorna el resultado autorizado.');
const publicReference = {
  sourceId: '40000000-0000-4000-8000-000000000001',
  versionId: '50000000-0000-4000-8000-000000000001',
  chunkId,
  title: 'Funciones',
  version: 1,
  fileName: 'Funciones.txt',
  format: 'TXT',
  locator: 'Líneas 1–1',
  text: bytes.toString('utf8'),
};
function fixture() {
  const repository = {
    reference: jest.fn().mockResolvedValue({
      ...publicReference,
      storageKey: 'private/organization/source/original.txt',
      mimeType: 'text/plain',
      sizeBytes: bytes.length,
      sha256: materialHash(bytes),
      providerRequestId: 'private-provider-trace',
      embedding: [0.5, 0.25, 0.75],
    }),
  };
  const storage = {
    download: jest.fn().mockResolvedValue(bytes),
    upload: jest.fn(),
    remove: jest.fn(),
    stat: jest.fn(),
  };
  const service = new HelpService(
    repository as unknown as HelpRepository,
    storage as MaterialsStoragePort,
  );
  return { service, repository, storage };
}

test('reference metadata exposes only the public citation and does not read Storage or return private fields', async () => {
  const { service, repository, storage } = fixture();
  const result = await service.reference(who, feedbackId, chunkId);
  expect(result).toEqual(publicReference);
  expect(Object.keys(result).sort()).toEqual(
    Object.keys(publicReference).sort(),
  );
  expect(repository.reference).toHaveBeenCalledWith(who, feedbackId, chunkId);
  expect(storage.download).not.toHaveBeenCalled();
});

test('download verifies exact bytes and reauthorizes the same citation after Storage before returning', async () => {
  const { service, repository, storage } = fixture();
  const order: string[] = [];
  repository.reference.mockImplementation(async () => {
    order.push('authorize');
    return {
      ...publicReference,
      storageKey: 'private/version-one',
      mimeType: 'text/plain',
      sizeBytes: bytes.length,
      sha256: materialHash(bytes),
    };
  });
  storage.download.mockImplementation(async (key: string) => {
    order.push(`download:${key}`);
    return bytes;
  });
  const result = await service.content(who, feedbackId, chunkId);
  order.push('returned');
  expect(order).toEqual([
    'authorize',
    'download:private/version-one',
    'authorize',
    'returned',
  ]);
  expect(result).toEqual({
    bytes,
    mimeType: 'text/plain',
    fileName: 'Funciones.txt',
  });
  expect(repository.reference).toHaveBeenNthCalledWith(
    1,
    who,
    feedbackId,
    chunkId,
  );
  expect(repository.reference).toHaveBeenNthCalledWith(
    2,
    who,
    feedbackId,
    chunkId,
  );
});

test('an unauthorized initial reference never reaches private Storage', async () => {
  const { service, repository, storage } = fixture();
  repository.reference.mockRejectedValue(
    new ApiError('RESOURCE_NOT_FOUND', 'No disponible.', 404),
  );
  await expect(service.content(who, feedbackId, chunkId)).rejects.toMatchObject(
    { code: 'RESOURCE_NOT_FOUND' },
  );
  expect(storage.download).not.toHaveBeenCalled();
});

test('revocation during Storage I/O withholds the downloaded bytes', async () => {
  const { service, repository, storage } = fixture();
  repository.reference
    .mockResolvedValueOnce({
      ...publicReference,
      storageKey: 'private/version-one',
      mimeType: 'text/plain',
      sizeBytes: bytes.length,
      sha256: materialHash(bytes),
    })
    .mockRejectedValueOnce(
      new ApiError('RESOURCE_NOT_FOUND', 'No disponible.', 404),
    );
  await expect(service.content(who, feedbackId, chunkId)).rejects.toMatchObject(
    { code: 'RESOURCE_NOT_FOUND' },
  );
  expect(storage.download).toHaveBeenCalledTimes(1);
  expect(repository.reference).toHaveBeenCalledTimes(2);
});

test.each(['size', 'hash'])(
  'a %s mismatch is an unavailable document, never a successful download',
  async (kind) => {
    const { service, repository, storage } = fixture();
    const changed =
      kind === 'size'
        ? Buffer.from('truncated')
        : Buffer.alloc(bytes.length, 65);
    storage.download.mockResolvedValue(changed);
    await expect(
      service.content(who, feedbackId, chunkId),
    ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', retryable: true });
    expect(repository.reference).toHaveBeenCalledTimes(1);
  },
);
