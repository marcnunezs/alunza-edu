import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import type { AppConfig } from '../config';
import { DatabaseService } from './database.service';

it('keeps the database pool open through asynchronous resource drains and closes it last', async () => {
  const database = new DatabaseService({
    databaseUrl: 'postgresql://alunza_app:fixture@127.0.0.1:1/fixture',
    databaseSsl: false,
  } as AppConfig);
  const pool = (database as unknown as { pool: Pool }).pool;
  const events: string[] = [];
  const end = jest.spyOn(pool, 'end').mockImplementation(async () => {
    events.push('database-closed');
  });
  let finish!: () => void;
  const drained = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const cleanup = {
    async onModuleDestroy() {
      events.push('admissions-stopped');
      await drained;
      expect(end).not.toHaveBeenCalled();
      events.push('cleanup-committed');
    },
  };
  const app = await Test.createTestingModule({
    providers: [
      { provide: DatabaseService, useValue: database },
      { provide: 'resource-drain', useValue: cleanup },
    ],
  }).compile();
  await app.init();
  const close = app.close();
  while (!events.length) await Promise.resolve();
  expect(end).not.toHaveBeenCalled();
  finish();
  await close;
  expect(events).toEqual([
    'admissions-stopped',
    'cleanup-committed',
    'database-closed',
  ]);
  await database.onApplicationShutdown();
  expect(end).toHaveBeenCalledTimes(1);
});
