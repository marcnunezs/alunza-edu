/* eslint @typescript-eslint/no-require-imports: "off" */
// A loopback proxy for isolated TEST Storage and unchanged Auth traffic. Faults
// apply only to Storage, selected by the harness, never by product input.
const http = require('node:http');
const fs = require('node:fs');
const { resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const controlPath = resolve(__dirname, '../.local/help-storage-fault.json');
const receiptPath = resolve(
  __dirname,
  '../.local/help-storage-fault-receipt.json',
);
const scenarios = new Set(['interrupt', 'corrupt', 'hold']);
const keyPattern = /^[a-f0-9-]{36}(\/[a-f0-9-]{36}){2,5}(\.[a-z]+)?$/;
function clearStorageFault() {
  for (const path of [controlPath, receiptPath]) {
    try {
      fs.unlinkSync(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
function setStorageFault({ key, scenario }) {
  if (!keyPattern.test(key) || !scenarios.has(scenario))
    throw new Error('Invalid TEST Storage fault');
  clearStorageFault();
  fs.mkdirSync(resolve(__dirname, '../.local'), { recursive: true });
  fs.writeFileSync(
    controlPath,
    JSON.stringify({ key, scenario, expiresAt: Date.now() + 30000 }),
    { mode: 0o600 },
  );
}
function readStorageFault() {
  try {
    const value = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
    if (
      !keyPattern.test(value.key) ||
      !scenarios.has(value.scenario) ||
      !Number.isFinite(value.expiresAt)
    )
      throw new Error('Invalid TEST Storage fault');
    return Date.now() < value.expiresAt ? value : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function storageFaultReached() {
  try {
    return (
      JSON.parse(fs.readFileSync(receiptPath, 'utf8')).upstreamRead === true
    );
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
function storageFaultHandler(
  target,
  {
    requestUpstream = http.request,
    readFault = readStorageFault,
    recordFault = (scenario) =>
      fs.writeFileSync(
        receiptPath,
        JSON.stringify({ upstreamRead: true, scenario }),
        { mode: 0o600 },
      ),
  } = {},
) {
  if (target !== 'http://127.0.0.1:18421')
    throw new Error('Storage fault proxy requires LAB TEST');
  return (request, response) => {
    let upstreamUrl;
    try {
      if (!request.url?.startsWith('/') || request.url.startsWith('//'))
        throw new Error('Invalid TEST proxy path');
      upstreamUrl = new URL(request.url, target);
      if (
        upstreamUrl.origin !== target ||
        !['/storage/v1/', '/auth/v1/'].some((prefix) =>
          upstreamUrl.pathname.startsWith(prefix),
        )
      )
        throw new Error('Invalid TEST proxy path');
    } catch {
      response.writeHead(404).end();
      return;
    }
    const isStorage = upstreamUrl.pathname.startsWith('/storage/v1/');
    const upstream = requestUpstream(
      upstreamUrl,
      {
        method: request.method,
        headers: { ...request.headers, host: '127.0.0.1:18421' },
      },
      async (remote) => {
        try {
          // Auth must neither consult nor be affected by a Storage fault file.
          const selected = isStorage ? readFault() : null;
          const objectPath = isStorage
            ? decodeURIComponent(upstreamUrl.pathname)
            : '';
          const match =
            request.method === 'GET' &&
            remote.statusCode === 200 &&
            selected &&
            [
              `/storage/v1/object/materials/${selected.key}`,
              `/storage/v1/object/authenticated/materials/${selected.key}`,
            ].includes(objectPath);
          if (!match) {
            response.writeHead(remote.statusCode, remote.headers);
            remote.pipe(response);
            return;
          }
          const pieces = [];
          let size = 0;
          for await (const piece of remote) {
            size += piece.length;
            if (size > 10000000) throw new Error('Unbounded TEST object');
            pieces.push(piece);
          }
          const bytes = Buffer.concat(pieces);
          recordFault(selected.scenario);
          if (selected.scenario === 'hold') {
            while (readFault()?.scenario === 'hold' && !response.destroyed)
              await delay(20);
          }
          const headers = { ...remote.headers, 'content-length': bytes.length };
          delete headers['transfer-encoding'];
          if (selected.scenario === 'corrupt') bytes[0] ^= 1;
          response.writeHead(200, headers);
          if (selected.scenario === 'interrupt') {
            response.write(
              bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 2))),
            );
            response.destroy();
          } else response.end(bytes);
        } catch {
          response.destroy();
        }
      },
    );
    upstream.on('error', () => response.destroy());
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  };
}
async function startStorageFaultProxy(target) {
  const server = http.createServer(storageFaultHandler(target));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  server.unref();
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
module.exports = {
  startStorageFaultProxy,
  setStorageFault,
  clearStorageFault,
  storageFaultReached,
  storageFaultHandler,
};
