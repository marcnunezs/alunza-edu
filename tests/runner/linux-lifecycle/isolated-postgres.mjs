import { execFile, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import pg from 'pg';

const run = promisify(execFile);

async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const port = server.address().port;
  await new Promise((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
  return port;
}

// No URL input and no connection to an existing database or Docker service.
export async function withIsolatedPostgres(binaryDirectory, action) {
  const binary = (name) =>
    join(binaryDirectory, process.platform === 'win32' ? name + '.exe' : name);
  await stat(binary('initdb'));
  const temporaryRoot = await realpath(tmpdir());
  const workspace = await mkdtemp(
    join(temporaryRoot, 'alunza-linux-recovery-'),
  );
  const directory = join(workspace, 'data');
  const password = randomBytes(32).toString('hex');
  const passwordFile = join(workspace, 'bootstrap-password');
  const port = await freeLoopbackPort();
  const control = (...args) =>
    execFileSync(binary('pg_ctl'), args, {
      cwd: workspace,
      windowsHide: true,
      timeout: 45000,
      stdio: 'ignore',
    });
  let started = false;
  try {
    await writeFile(passwordFile, password, { mode: 0o600 });
    await run(
      binary('initdb'),
      [
        '-D',
        directory,
        '-U',
        'postgres',
        '--pwfile',
        passwordFile,
        '--auth=scram-sha-256',
        '--encoding=UTF8',
        '--locale=C',
      ],
      { cwd: workspace, windowsHide: true, timeout: 80000 },
    );
    await rm(passwordFile);
    await mkdir(join(workspace, 'socket'));
    const socket =
      process.platform === 'win32'
        ? ''
        : ' -k "' + join(workspace, 'socket') + '"';
    await control(
      '-D',
      directory,
      '-l',
      join(workspace, 'postgres.log'),
      '-o',
      '-h 127.0.0.1 -p ' + port + socket,
      '-w',
      '-t',
      '30',
      'start',
    );
    started = true;
    const connection = {
      host: '127.0.0.1',
      port,
      database: 'postgres',
      user: 'postgres',
      password,
      connectionTimeoutMillis: 5000,
    };
    const admin = new pg.Client(connection);
    await admin.connect();
    try {
      const actual = (await admin.query('SHOW data_directory')).rows[0]
        .data_directory;
      if ((await realpath(actual)) !== (await realpath(directory)))
        throw new Error('Wrong temporary cluster');
      return await action(admin, connection);
    } finally {
      await admin.end();
    }
  } finally {
    // A failed startup can still have a registered server. Limit all control to this fresh data directory.
    const pidFile = await readFile(
      join(directory, 'postmaster.pid'),
      'utf8',
    ).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (started || pidFile)
      await control('-D', directory, '-m', 'fast', '-w', '-t', '30', 'stop');
    const actual = await realpath(workspace);
    assert.equal(dirname(actual), temporaryRoot);
    assert.ok(basename(actual).startsWith('alunza-linux-recovery-'));
    assert.equal(actual, resolve(workspace));
    await rm(actual, { recursive: true });
  }
}
