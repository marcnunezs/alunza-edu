import { EvaluationOperations } from './evaluation.operations';
import { EvaluationRepository } from './evaluation.repository';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
function fixture() {
  const repository = {
    status: jest.fn().mockResolvedValue({ id: 'run', state: 'RUNNING' }),
    receipts: jest.fn(),
    stop: jest.fn(),
    startStage: jest.fn(),
  };
  const operations = new EvaluationOperations(
    repository as unknown as EvaluationRepository,
    { enabled: true, operationsPort: 4401 },
  );
  const response = { writeHead: jest.fn(), end: jest.fn() };
  const request = {
    method: 'GET',
    url: '/operations/ai-runs/aaaaaaaa-0000-4000-8000-000000000001',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { authorization: `Bearer ${'a'.repeat(43)}` },
  };
  const handle = () =>
    operations.handle(
      request as unknown as IncomingMessage,
      response as unknown as ServerResponse,
    );
  return { repository, operations, response, request, handle };
}
test('hashes the capability and returns only repository operational projection', async () => {
  const f = fixture();
  await f.handle();
  expect(f.repository.status).toHaveBeenCalledWith(
    'aaaaaaaa-0000-4000-8000-000000000001',
    createHash('sha256').update('a'.repeat(43)).digest('hex'),
  );
  expect(f.response.writeHead).toHaveBeenCalledWith(
    200,
    expect.not.objectContaining({
      'Access-Control-Allow-Origin': expect.anything(),
    }),
  );
});
test('forwarded loopback headers cannot authorize a remote socket', async () => {
  const f = fixture();
  f.request.socket.remoteAddress = '10.0.0.1';
  Object.assign(f.request.headers, { 'x-forwarded-for': '127.0.0.1' });
  await f.handle();
  expect(f.response.writeHead).toHaveBeenCalledWith(403, expect.anything());
  expect(f.repository.status).not.toHaveBeenCalled();
});
test('browser origins cannot use the operations listener', async () => {
  const f = fixture();
  Object.assign(f.request.headers, { origin: 'https://example.invalid' });
  await f.handle();
  expect(f.repository.status).not.toHaveBeenCalled();
});
test('requests with bodies are rejected before resolving a run', async () => {
  const f = fixture();
  Object.assign(f.request.headers, { 'content-length': '2' });
  await f.handle();
  expect(f.repository.status).not.toHaveBeenCalled();
});
test('no public pedagogical path exists', async () => {
  const f = fixture();
  f.request.url += '/feedback';
  await f.handle();
  expect(f.response.writeHead).toHaveBeenCalledWith(404, expect.anything());
  expect(f.repository.status).not.toHaveBeenCalled();
});
test('the listener lifecycle is inactive by default', async () => {
  const f = fixture();
  const operations = new EvaluationOperations(
    f.repository as unknown as EvaluationRepository,
    { enabled: false, operationsPort: 0 },
  );
  await expect(operations.onModuleInit()).resolves.toBeUndefined();
  await expect(operations.onModuleDestroy()).resolves.toBeUndefined();
});
