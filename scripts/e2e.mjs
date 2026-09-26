import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, run, redactDiagnostics } from './local.mjs';
import { seedAcademic } from './academic-fixture.mjs';
import {
  withTestEnvironment,
  publicTestEnvironment,
  testApi,
  nodeService,
  report,
  testContext,
} from './test-environment.mjs';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Ejecuta npm run test:e2e desde la raíz Git.');
let privateValues = [];
function sanitized(text) {
  for (const value of privateValues)
    if (value) text = text.split(value).join('[redacted]');
  return redactDiagnostics(text);
}

async function execute({ ctx, state }) {
  await seedAcademic(state);
  privateValues = [
    state.fixturePassword,
    state.applicationPassword,
    state.authAdminKey,
    state.migrationUrl,
  ];
  const publicEnvironment = publicTestEnvironment(state);
  // Fictitious secrets prove that new server-only adapters stay out of Next's
  // browser artifacts. They are not credentials and authorize no provider call.
  const canaryEnvironment = {
    AI_AZURE_API_KEY: `alunza-canary-ai-${randomBytes(24).toString('hex')}`,
    VERCEL_TOKEN: `alunza-canary-sandbox-${randomBytes(24).toString('hex')}`,
  };
  privateValues.push(...Object.values(canaryEnvironment));
  const buildEnvironment = {
    ...publicEnvironment,
    ...canaryEnvironment,
    ALUNZA_ARTIFACT_CANARIES: JSON.stringify(Object.values(canaryEnvironment)),
  };
  console.log('Construyendo web/API para el entorno aislado...');
  await run(process.execPath, [npm, 'run', 'build'], {
    env: buildEnvironment,
  });
  await run(process.execPath, [npm, 'run', 'test:artifacts'], {
    env: buildEnvironment,
  });
  await report('artifacts', {
    status: 'passed',
    environment: 'isolated-local',
    privateValues: 'not-found',
    serverAdapterCanaries: 'not-found',
  });

  const api = testApi(ctx, state);
  const readyUrl = `${ctx.apiUrl}/health/ready`;
  const web = nodeService(
    [
      join(root, 'node_modules/next/dist/bin/next'),
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(ctx.webPort),
    ],
    publicEnvironment,
    join(root, 'apps/web'),
  );
  const controlKey = randomBytes(32).toString('hex');
  privateValues.push(controlKey);
  let operation = Promise.resolve();
  const server = createServer((request, response) => {
    if (
      request.method !== 'POST' ||
      request.headers['x-alunza-e2e-key'] !== controlKey ||
      !['/api/start', '/api/stop'].includes(request.url)
    ) {
      response.writeHead(404).end();
      return;
    }
    // Only the API child owned by this run can be controlled; no arbitrary PID,
    // shell command, container or database operation is accepted from Cypress.
    operation = operation
      .then(async () => {
        if (request.url === '/api/start') await api.start(readyUrl);
        else await api.stop();
        response
          .writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          })
          .end('{"ok":true}');
      })
      .catch(() => {
        response.writeHead(503).end();
      });
  });
  try {
    await api.start(readyUrl);
    await web.start(ctx.webUrl);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const controlPort = server.address().port;
    console.log('Ejecutando Cypress en Chrome con servicios reales...');
    const cypressOutput = await run(
      process.execPath,
      [join(root, 'scripts/cypress-run.mjs')],
      {
        env: {
          ALUNZA_TEST_STATE: ctx.statePath,
          ALUNZA_TEST_API_URL: ctx.apiUrl,
          ALUNZA_E2E_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
          ALUNZA_E2E_CONTROL_KEY: controlKey,
          CYPRESS_CRASH_REPORTS: '0',
        },
      },
    );
    const result = JSON.parse(
      await readFile(join(root, '.local/reports/imp-01/e2e.json'), 'utf8'),
    );
    const requiredCases = [
      ...Array.from(
        { length: 8 },
        (_, i) => `FND-${String(i + 1).padStart(2, '0')}`,
      ),
      ...Array.from(
        { length: 8 },
        (_, i) => `IMP01-${String(i + 1).padStart(2, '0')}`,
      ),
      ...Array.from(
        { length: 8 },
        (_, i) => `IMP02-${String(i + 1).padStart(2, '0')}`,
      ),
    ];
    const completed = new Set(
      result.tests
        .filter((item) => item.state === 'passed')
        .map((item) => item.id),
    );
    if (
      result.status !== 'passed' ||
      result.total !== result.passed ||
      requiredCases.some((id) => !completed.has(id)) ||
      result.tests.some((item) => item.id === 'UNKNOWN')
    )
      throw new Error(
        'El recorrido no completó todos los escenarios requeridos de fundación e identidad.',
      );
    for (const secret of privateValues) {
      if (api.output.includes(secret) || web.output.includes(secret))
        throw new Error('Un secreto apareció en logs de los servicios.');
    }
    if (
      api.output.includes('hidden-sentinel-e2e') ||
      web.output.includes('hidden-sentinel-e2e')
    )
      throw new Error('Una prueba oculta apareció en logs de los servicios.');
    await report('e2e', result, 'imp-02');
    await mkdir(join(root, '.local/evidence/imp-00-05'), { recursive: true });
    await writeFile(
      join(root, '.local/evidence/imp-00-05/cypress.log'),
      sanitized(cypressOutput.stdout + cypressOutput.stderr),
      { mode: 0o600 },
    );
    console.log(`Cypress: ${result.passed}/${result.total} casos aprobados.`);
  } catch (error) {
    error.output = sanitized(
      `${error.output ?? error.message}\n${api.output}\n${web.output}`,
    );
    throw error;
  } finally {
    if (server.listening)
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    await operation;
    try {
      await web.stop();
    } finally {
      await api.stop();
    }
  }
}

try {
  await report('e2e', { status: 'not-started' }, 'imp-01');
  await withTestEnvironment(execute, [testContext.webPort]);
} catch (error) {
  let previous;
  try {
    previous = JSON.parse(
      await readFile(join(root, '.local/reports/imp-01/e2e.json'), 'utf8'),
    );
  } catch {
    /* No completed Cypress run. */
  }
  if (previous?.status !== 'failed')
    await report('e2e', { status: 'failed-infrastructure' }, 'imp-01');
  await mkdir(join(root, '.local/evidence/imp-00-05'), { recursive: true });
  await writeFile(
    join(root, '.local/evidence/imp-00-05/e2e-error.log'),
    sanitized(error.output ?? error.message),
    { mode: 0o600 },
  );
  console.error(
    'Cypress falló. Diagnóstico local saneado: .local/evidence/imp-00-05/e2e-error.log.',
  );
  process.exitCode = 1;
}
