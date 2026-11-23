import { jest, test, expect } from '@jest/globals';
import { createRequire } from 'node:module';
import { PassThrough, Writable } from 'node:stream';

const require = createRequire(import.meta.url);
const { storageFaultHandler } = require('../help-fault-storage.cjs');
const target = 'http://127.0.0.1:18421';
const objectKey =
  '00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000003.txt';

function upstreamFixture(bytes = Buffer.from('real-upstream-response')) {
  const requests = [];
  const requestUpstream = jest.fn((url, options, respond) => {
    const request = new PassThrough();
    const parts = [];
    request.on('data', (part) => parts.push(part));
    request.on('finish', () => {
      requests.push({ url: url.href, options, body: Buffer.concat(parts) });
      const remote = new PassThrough();
      remote.statusCode = 200;
      remote.headers = {
        'content-type': 'application/octet-stream',
        'content-length': bytes.length,
      };
      respond(remote);
      remote.end(bytes);
    });
    return request;
  });
  return { requestUpstream, requests };
}

function dispatch(
  handler,
  path,
  { method = 'GET', body = '', headers = {} } = {},
) {
  return new Promise((resolve, reject) => {
    const incoming = new PassThrough();
    incoming.url = path;
    incoming.method = method;
    incoming.headers = headers;
    const parts = [];
    const outgoing = new Writable({
      write(chunk, _encoding, done) {
        parts.push(Buffer.from(chunk));
        done();
      },
    });
    outgoing.writeHead = (status, responseHeaders = {}) => {
      outgoing.statusCode = status;
      outgoing.headers = responseHeaders;
      return outgoing;
    };
    let complete = false;
    outgoing.on('finish', () => {
      complete = true;
    });
    outgoing.on('error', reject);
    outgoing.on('close', () =>
      resolve({
        status: outgoing.statusCode,
        headers: outgoing.headers,
        body: Buffer.concat(parts),
        complete,
      }),
    );
    handler(incoming, outgoing);
    incoming.end(body);
  });
}

test.each(['/auth/v1/invite', '/auth/v1/otp'])(
  'Auth %s reaches fixed upstream unchanged without reading Storage controls',
  async (path) => {
    const bytes = Buffer.from('{"user":{"id":"fictitious-user"}}');
    const upstream = upstreamFixture(bytes);
    const readFault = jest.fn(() => {
      throw new Error('Storage-only invalid control');
    });
    const recordFault = jest.fn();
    const handler = storageFaultHandler(target, {
      ...upstream,
      readFault,
      recordFault,
    });
    const body = '{"email":"fictitious@example.invalid"}';
    const response = await dispatch(
      handler,
      `${path}?redirect_to=http%3A%2F%2F127.0.0.1%3A3300`,
      {
        method: 'POST',
        body,
        headers: {
          authorization: 'Bearer fictitious-token',
          apikey: 'fictitious-key',
          'content-type': 'application/json',
          host: '127.0.0.1:9999',
        },
      },
    );
    expect(response.status).toBe(200);
    expect(response.complete).toBe(true);
    expect(response.body).toEqual(bytes);
    expect(upstream.requests).toEqual([
      {
        url: `${target}${path}?redirect_to=http%3A%2F%2F127.0.0.1%3A3300`,
        options: {
          method: 'POST',
          headers: {
            authorization: 'Bearer fictitious-token',
            apikey: 'fictitious-key',
            'content-type': 'application/json',
            host: '127.0.0.1:18421',
          },
        },
        body: Buffer.from(body),
      },
    ]);
    expect(readFault).not.toHaveBeenCalled();
    expect(recordFault).not.toHaveBeenCalled();
  },
);

test.each(['corrupt', 'interrupt', 'hold'])(
  'authorized Storage object keeps the %s fault',
  async (scenario) => {
    const bytes = Buffer.from('documento ficticio');
    const upstream = upstreamFixture(bytes);
    const readFault = jest
      .fn()
      .mockReturnValueOnce({ key: objectKey, scenario })
      .mockReturnValue(null);
    const recordFault = jest.fn();
    const response = await dispatch(
      storageFaultHandler(target, { ...upstream, readFault, recordFault }),
      `/storage/v1/object/materials/${objectKey}`,
    );
    expect(response.status).toBe(200);
    expect(recordFault).toHaveBeenCalledTimes(1);
    expect(recordFault).toHaveBeenCalledWith(scenario);
    if (scenario === 'corrupt') {
      const expected = Buffer.from(bytes);
      expected[0] ^= 1;
      expect(response.body).toEqual(expected);
      expect(response.complete).toBe(true);
    } else if (scenario === 'interrupt') {
      expect(response.body).toEqual(
        bytes.subarray(0, Math.floor(bytes.length / 2)),
      );
      expect(response.complete).toBe(false);
    } else {
      expect(response.body).toEqual(bytes);
      expect(response.complete).toBe(true);
      expect(readFault).toHaveBeenCalledTimes(2);
    }
  },
);

test.each([
  '/rest/v1/private',
  '/auth/v1/../../rest/v1/private',
  'https://example.invalid/auth/v1/invite',
  '//example.invalid/auth/v1/invite',
])(
  'proxy refuses unapproved route or origin %s without an upstream call',
  async (path) => {
    const upstream = upstreamFixture();
    const response = await dispatch(
      storageFaultHandler(target, upstream),
      path,
    );
    expect(response.status).toBe(404);
    expect(upstream.requestUpstream).not.toHaveBeenCalled();
  },
);

test('proxy cannot target another host or port', () => {
  expect(() => storageFaultHandler('http://127.0.0.1:54321')).toThrow(
    'LAB TEST',
  );
  expect(() => storageFaultHandler('https://example.invalid')).toThrow(
    'LAB TEST',
  );
});
