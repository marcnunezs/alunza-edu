import { createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from './database.service';
import type { AppConfig } from '../config';

function packet(type: string, payload = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(5);
  header.write(type);
  header.writeInt32BE(payload.length + 4, 1);
  return Buffer.concat([header, payload]);
}

function booleanDescription(name: string): Buffer {
  const count = Buffer.from([0, 1]);
  const field = Buffer.alloc(18);
  field.writeInt32BE(16, 6); // PostgreSQL BOOL OID.
  field.writeInt16BE(1, 10);
  field.writeInt32BE(-1, 12);
  return packet('T', Buffer.concat([count, Buffer.from(`${name}\0`), field]));
}

// A loopback wire fixture exercises the real pg Pool, Client and EventEmitter.
// It acknowledges only the queries required by DatabaseService; it is not a
// database or an authorization test and never connects to the TEST stack.
function wireFixture() {
  const sockets = new Set<Socket>();
  const queries: string[] = [];
  let connections = 0;
  let blockReadiness: (() => void) | undefined;
  const ready = () => packet('Z', Buffer.from('I'));
  const booleanValue = () => packet('D', Buffer.from([0, 1, 0, 0, 0, 1, 116]));
  const server = createServer((socket) => {
    sockets.add(socket);
    connections += 1;
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let input: Buffer = Buffer.alloc(0);
    let startup = true;
    let statement = '';
    const fieldName = () =>
      statement.includes('current_user')
        ? 'allowed'
        : statement.includes('session_is_active')
          ? 'valid'
          : null;
    const complete = () => {
      if (fieldName()) socket.write(booleanValue());
      socket.write(packet('C', Buffer.from('SELECT 1\0')));
    };
    socket.on('data', (data) => {
      input = Buffer.concat([input, data]);
      while (input.length >= (startup ? 4 : 5)) {
        const length = input.readInt32BE(startup ? 0 : 1);
        const total = length + (startup ? 0 : 1);
        if (input.length < total) break;
        if (startup) {
          startup = false;
          input = input.subarray(total);
          socket.write(packet('R', Buffer.alloc(4)));
          socket.write(ready());
          continue;
        }
        const type = input.toString('utf8', 0, 1);
        const body = input.subarray(5, total);
        input = input.subarray(total);
        if (type === 'Q') {
          statement = body.toString('utf8').replace(/\0$/, '');
          queries.push(statement);
          if (blockReadiness && statement.includes('SELECT id, display_name')) {
            blockReadiness();
            continue;
          }
          const name = fieldName();
          if (name) socket.write(booleanDescription(name));
          complete();
          socket.write(ready());
        } else if (type === 'P') {
          const start = body.indexOf(0) + 1;
          statement = body.toString('utf8', start, body.indexOf(0, start));
          queries.push(statement);
          socket.write(packet('1'));
        } else if (type === 'B') {
          socket.write(packet('2'));
        } else if (type === 'D') {
          const name = fieldName();
          socket.write(name ? booleanDescription(name) : packet('n'));
        } else if (type === 'E') {
          complete();
        } else if (type === 'S') {
          socket.write(ready());
        } else if (type === 'X') {
          socket.end();
        }
      }
    });
  });
  return {
    server,
    queries,
    get connections() {
      return connections;
    },
    blockNextReadiness(callback: () => void) {
      blockReadiness = callback;
    },
    severConnections() {
      blockReadiness = undefined;
      for (const socket of sockets) socket.destroy();
    },
  };
}

describe('borrowed PostgreSQL connection failures', () => {
  let wire: ReturnType<typeof wireFixture>;
  let service: DatabaseService;
  let pool: Pool;
  beforeEach(async () => {
    wire = wireFixture();
    await new Promise<void>((resolve) =>
      wire.server.listen(0, '127.0.0.1', resolve),
    );
    const port = (wire.server.address() as AddressInfo).port;
    service = new DatabaseService({
      databaseUrl: `postgresql://alunza_app:fixture@127.0.0.1:${port}/fixture`,
      databaseSsl: false,
    } as AppConfig);
    pool = (service as unknown as { pool: Pool }).pool;
  });
  afterEach(async () => {
    wire.severConnections();
    await service.onModuleDestroy();
    await new Promise<void>((resolve) => wire.server.close(() => resolve()));
  });

  it('handles a client error between queries, discards it, and recovers on a new connection', async () => {
    let client!: PoolClient;
    let enter!: () => void;
    let proceed!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const continuation = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const operation = service.writeAs('fixture', async (borrowed) => {
      client = borrowed;
      enter();
      await continuation;
      return 'must not commit';
    });
    const failure = expect(operation).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });
    await entered;
    // Listening for end does not consume the error event. The old service
    // crashes on that event despite its query try/catch and pool listener.
    const ended = new Promise<void>((resolve) => client.once('end', resolve));
    wire.severConnections();
    await ended;
    proceed();
    await failure;
    expect(pool.totalCount).toBe(0);
    expect(wire.queries).not.toContain('COMMIT');
    await expect(
      service.writeAs('fixture', async () => 'recovered'),
    ).resolves.toBe('recovered');
    expect(wire.connections).toBe(2);
    expect(pool.idleCount).toBe(1);
    expect(wire.queries).toContain('COMMIT');
  });

  it('handles a socket error during readiness, discards it, and recovers', async () => {
    const entered = new Promise<void>((resolve) =>
      wire.blockNextReadiness(resolve),
    );
    const failure = expect(service.ready()).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });
    await entered;
    wire.severConnections();
    await failure;
    expect(pool.totalCount).toBe(0);
    await expect(service.ready()).resolves.toBeUndefined();
    expect(wire.connections).toBe(2);
    expect(pool.idleCount).toBe(1);
  });
});
