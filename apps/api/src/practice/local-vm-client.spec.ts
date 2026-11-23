import fs from 'node:fs/promises';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import type { AppConfig } from '../config';
import { LocalVmClient } from './local-vm-client';
import { LocalVmResourceRepository } from './local-vm-resource.repository';
import type { DatabaseService } from '../database/database.service';

const socketPath = '/run/private-vm/broker.sock';
const config = { localVmConfiguration: { socketPath } } as AppConfig;
function transport(
  body: string,
  options: {
    uid?: number;
    directoryMode?: number;
    resolved?: string;
    status?: number;
  } = {},
) {
  Object.defineProperty(process, 'platform', {
    value: 'linux',
    configurable: true,
  });
  const uid = process.getuid?.() ?? 1000;
  if (!process.getuid)
    Object.defineProperty(process, 'getuid', {
      value: () => uid,
      configurable: true,
    });
  jest.spyOn(fs, 'lstat').mockImplementation(
    async (path) =>
      ({
        uid: options.uid ?? uid,
        mode: path === socketPath ? 0o600 : (options.directoryMode ?? 0o700),
        isSocket: () => path === socketPath,
        isDirectory: () => path !== socketPath,
        isSymbolicLink: () => false,
      }) as never,
  );
  jest.spyOn(fs, 'realpath').mockResolvedValue(options.resolved ?? socketPath);
  const response = Object.assign(new EventEmitter(), {
    statusCode: options.status ?? 200,
  });
  const req = Object.assign(new EventEmitter(), {
    end: jest.fn(),
    destroy: jest.fn(),
  });
  const request = jest.spyOn(http, 'request').mockImplementation(((
    _options: unknown,
    callback: (response: unknown) => void,
  ) => {
    req.end.mockImplementation(() =>
      queueMicrotask(() => {
        callback(response);
        response.emit('data', Buffer.from(body));
        response.emit('end');
      }),
    );
    req.destroy.mockImplementation(() =>
      queueMicrotask(() => req.emit('error', new Error('closed'))),
    );
    return req;
  }) as never);
  return { request, req, client: new LocalVmClient(config) };
}
describe('private bounded local VM transport', () => {
  const originalGetuid = process.getuid;
  const originalPlatform = Object.getOwnPropertyDescriptor(
    process,
    'platform',
  )!;
  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
    if (!originalGetuid) delete (process as Partial<NodeJS.Process>).getuid;
  });
  it('rejects Windows before filesystem or HTTP access', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });
    const stat = jest.spyOn(fs, 'lstat');
    const request = jest.spyOn(http, 'request');
    await expect(
      new LocalVmClient(config).call('/inspect', {}, 1000),
    ).rejects.toThrow('unavailable');
    expect(stat).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it('uses only the configured UDS and bounded JSON body', async () => {
    const { client, request, req } = transport(
      '{"available":false,"context":null}',
    );
    expect(await client.call('/inspect', {}, 1000)).toEqual({
      available: false,
      context: null,
    });
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      socketPath,
      path: '/inspect',
      method: 'POST',
    });
    expect(req.end).toHaveBeenCalledWith(Buffer.from('{}'));
  });
  it.each([
    { uid: 99999 },
    { directoryMode: 0o755 },
    { resolved: '/run/other/broker.sock' },
  ])('rejects socket ownership or path drift %j', async (options) => {
    const { client, request } = transport('{}', options);
    await expect(client.call('/inspect', {}, 1000)).rejects.toThrow('identity');
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects a response above one MiB even if end immediately follows data', async () => {
    const { client, req } = transport(JSON.stringify('a'.repeat(1048576)));
    await expect(client.call('/inspect', {}, 1000)).rejects.toThrow(
      'too large',
    );
    expect(req.destroy).toHaveBeenCalled();
  });
  it('rejects oversized requests before HTTP dispatch', async () => {
    const { client, request } = transport('{}');
    await expect(
      client.call('/start', { inputJson: 'a'.repeat(2097152) }, 1000),
    ).rejects.toThrow('too large');
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    { body: 'not-json', status: 200 },
    { body: '{}', status: 409 },
  ])('does not expose broker error contents %j', async ({ body, status }) => {
    const { client } = transport(body, { status });
    await expect(client.call('/inspect', {}, 1000)).rejects.toThrow(
      /^Local VM/,
    );
  });
});

describe('local VM resource repository', () => {
  it('uses internal parameterized transactions and rejects malformed stored records', async () => {
    const query = jest
      .fn()
      .mockResolvedValue({ rows: [{ value: { provider: 'untrusted' } }] });
    const internal = jest.fn(
      async (operation: (client: unknown) => Promise<unknown>) =>
        operation({ query }),
    );
    const repository = new LocalVmResourceRepository({
      internal,
    } as unknown as DatabaseService);
    const execution = '10000000-0000-4000-8000-000000000001';
    await expect(repository.load(execution)).rejects.toThrow();
    expect(query).toHaveBeenCalledWith(
      'SELECT app_private.load_local_vm_resource($1::uuid) AS value',
      [execution],
    );
    expect(internal).toHaveBeenCalledTimes(1);
  });
});
