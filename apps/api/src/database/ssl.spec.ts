import { createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { createSecureContext, TLSSocket, rootCertificates } from 'node:tls';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { loadConfig } from '../config';

// This public, fictitious certificate/key is exclusively a loopback TLS fixture.
// It is not used by any application or remote resource.
describe('real pg TLS negotiation with the remote configuration', () => {
  const fixtures = resolve(__dirname, '../../../../tests/fixtures/tls');
  const ca = readFileSync(resolve(fixtures, 'local-test-only.crt'), 'utf8');
  const key = readFileSync(resolve(fixtures, 'local-test-only.key'), 'utf8');
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.once('data', (request) => {
      if (request.length !== 8 || request.readInt32BE(4) !== 80877103) {
        socket.destroy();
        return;
      }
      socket.write('S', () => {
        const tls = new TLSSocket(socket, {
          isServer: true,
          secureContext: createSecureContext({ key, cert: ca }),
        });
        tls.on('error', () => tls.destroy());
        tls.once('data', () => {
          // An authenticated TLS connection reaches the PostgreSQL startup.
          // This fixture deliberately stops there; it is not a database double.
          const payload = Buffer.from(
            'SERROR\0C57P03\0MTLS_PROBE_COMPLETE\0\0',
          );
          const header = Buffer.alloc(5);
          header[0] = 69;
          header.writeInt32BE(payload.length + 4, 1);
          tls.end(Buffer.concat([header, payload]));
        });
      });
    });
  });
  let port: number;
  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((done) => server.close(() => done()));
  });

  async function connectWith(certificate: string, hostname: string) {
    const config = loadConfig({
      ENVIRONMENT: 'preproduction',
      RELEASE_ID: 'b'.repeat(40),
      APP_ORIGIN: 'https://web.alunza.invalid',
      DATABASE_URL: `postgresql://alunza_app:fixture@${hostname}/postgres`,
      DATABASE_SSL_CA: certificate,
      SUPABASE_JWT_ISSUER: 'https://fixture.supabase.co/auth/v1',
      SUPABASE_JWKS_URL:
        'https://fixture.supabase.co/auth/v1/.well-known/jwks.json',
    });
    // Dial loopback while retaining the actual configured TLS server identity.
    const client = new Client({
      host: '127.0.0.1',
      port,
      user: 'fixture',
      ssl: config.databaseSsl,
      connectionTimeoutMillis: 2000,
    });
    try {
      await client.connect();
    } finally {
      await client.end();
    }
  }

  it('accepts the configured CA and matching hostname through pg', async () => {
    await expect(connectWith(ca, 'db.alunza.invalid')).rejects.toThrow(
      'TLS_PROBE_COMPLETE',
    );
  });
  it('rejects a certificate signed by an untrusted CA', async () => {
    await expect(
      connectWith(rootCertificates[0]!, 'db.alunza.invalid'),
    ).rejects.toMatchObject({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  });
  it('rejects the wrong hostname even with a trusted CA', async () => {
    await expect(connectWith(ca, 'other.alunza.invalid')).rejects.toMatchObject(
      { code: 'ERR_TLS_CERT_ALTNAME_INVALID' },
    );
  });
});
