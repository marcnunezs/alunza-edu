import { MaterialExtractor, MaterialIngestionError } from '@alunza/ai';
import { MaterialsWorker } from './materials.worker';
import { materialHash } from './materials.service';
import type {
  MaterialsRepository,
  ClaimedMaterialJob,
} from './materials.repository';
import type { MaterialsStoragePort } from './materials.ports';
import type { AppConfig } from '../config';
const bytes = Buffer.from('Texto ficticio para el trabajador.');
const job: ClaimedMaterialJob = {
  kind: 'index',
  id: 'job',
  token: 'lease',
  sourceId: 'source',
  versionId: 'version',
  generationId: 'generation',
  storageKey: 'key',
  sha256: materialHash(bytes),
  format: 'TXT',
  attempt: 1,
};
const chunks = Array.from({ length: 33 }, (_, index) => ({
  index,
  text: `fragmento ${index}`,
  tokenCount: 4,
  locator: `Línea ${index}`,
  contentHash: 'a'.repeat(64),
}));
function fixture(checkpoint = 0) {
  const repository = {
    claimCleanup: jest.fn().mockResolvedValue(null),
    claim: jest.fn().mockResolvedValue(job),
    renew: jest.fn().mockResolvedValue(true),
    fail: jest.fn().mockResolvedValue(true),
    prepare: jest.fn().mockResolvedValue(checkpoint),
    stage: jest.fn().mockResolvedValue(true),
    publish: jest.fn().mockResolvedValue(true),
    confirm: jest.fn().mockResolvedValue(true),
    finishCleanup: jest.fn(),
  };
  const storage = {
    download: jest.fn().mockResolvedValue(bytes),
    stat: jest.fn().mockResolvedValue({
      sizeBytes: bytes.length,
      contentType: 'text/plain',
    }),
    upload: jest.fn(),
    remove: jest.fn(),
  };
  const embeddings = {
    configuration: { id: 'fixture-3d', model: 'synthetic', dimensions: 3 },
    embed: jest
      .fn()
      .mockImplementation(async (texts: string[]) =>
        texts.map(() => [1, 0, 0]),
      ),
  };
  const config = {
    materialsWorkerEnabled: false,
    materialsLeaseMs: 60000,
    materialsPollMs: 500,
  } as AppConfig;
  const worker = new MaterialsWorker(
    repository as unknown as MaterialsRepository,
    storage as MaterialsStoragePort,
    embeddings,
    config,
  );
  jest.spyOn(MaterialExtractor.prototype, 'extractAndChunk').mockResolvedValue({
    chunks,
    extractionVersion: 'fixture',
    normalizedTextBytes: 100,
  });
  return { repository, storage, embeddings, config, worker };
}
test('completed batch checkpoint skips paid embeddings on recovery and publishes last', async () => {
  const { worker, embeddings, repository } = fixture(32);
  await worker.tick();
  expect(embeddings.embed.mock.calls[0][0]).toEqual(['fragmento 32']);
  expect(repository.stage).toHaveBeenCalledTimes(1);
  expect(repository.stage.mock.calls[0][1][0].index).toBe(32);
  expect(repository.publish.mock.invocationCallOrder[0]).toBeGreaterThan(
    repository.stage.mock.invocationCallOrder[0]!,
  );
});
test('staging denial fences stale worker before publication', async () => {
  const { worker, repository } = fixture();
  repository.stage.mockResolvedValue(false);
  await worker.tick();
  expect(repository.publish).not.toHaveBeenCalled();
});
test('a configuration mismatch fails before another provider request', async () => {
  const { worker, repository, embeddings } = fixture(-2);
  await worker.tick();
  expect(repository.fail).toHaveBeenCalledWith(job, 'CONFIGURATION_MISMATCH');
  expect(embeddings.embed).not.toHaveBeenCalled();
});
test('revoked lease prevents Storage and provider work', async () => {
  const { worker, repository, storage, embeddings } = fixture();
  repository.renew.mockResolvedValue(false);
  await worker.tick();
  expect(storage.download).not.toHaveBeenCalled();
  expect(embeddings.embed).not.toHaveBeenCalled();
});

test.each(['lost', 'unconfirmed'] as const)(
  'heartbeat with %s lease aborts extraction without marking the job failed',
  async (outcome) => {
    jest.useFakeTimers();
    try {
      const { worker, repository, embeddings } = fixture();
      if (outcome === 'lost') repository.renew.mockResolvedValue(false);
      else
        repository.renew.mockRejectedValue(
          new Error('Temporary database outage'),
        );
      repository.renew.mockResolvedValueOnce(true);
      let observedSignal: AbortSignal | undefined;
      jest
        .mocked(MaterialExtractor.prototype.extractAndChunk)
        .mockImplementation(
          (_bytes, _format, signal) =>
            new Promise((_accept, reject) => {
              observedSignal = signal;
              signal?.addEventListener(
                'abort',
                () => reject(new MaterialIngestionError('CANCELLED')),
                { once: true },
              );
            }),
        );
      const processing = worker.tick();
      await jest.advanceTimersByTimeAsync(15_000);
      await processing;
      expect(observedSignal?.aborted).toBe(true);
      expect(repository.renew).toHaveBeenCalledTimes(2);
      expect(repository.fail).not.toHaveBeenCalled();
      expect(repository.prepare).not.toHaveBeenCalled();
      expect(repository.stage).not.toHaveBeenCalled();
      expect(repository.publish).not.toHaveBeenCalled();
      expect(embeddings.embed).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  },
);
test('missing configuration gives a durable explicit failure without a fake provider', async () => {
  const { repository, storage, config } = fixture();
  const worker = new MaterialsWorker(
    repository as unknown as MaterialsRepository,
    storage as MaterialsStoragePort,
    null,
    config,
  );
  await worker.tick();
  expect(repository.fail).toHaveBeenCalledWith(job, 'CONFIGURATION_MISSING');
  expect(repository.publish).not.toHaveBeenCalled();
});
test('transient provider failure propagates bounded retry-after metadata', async () => {
  const { worker, repository, embeddings } = fixture();
  embeddings.embed.mockRejectedValue(
    new MaterialIngestionError('PROVIDER_UNAVAILABLE', true, 7000),
  );
  await worker.tick();
  expect(repository.fail).toHaveBeenCalledWith(
    job,
    'PROVIDER_UNAVAILABLE',
    true,
    7000,
  );
  expect(repository.publish).not.toHaveBeenCalled();
});
