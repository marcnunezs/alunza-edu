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
const args = process.argv.slice(2);
if (
  args.length > 1 ||
  (args.length === 1 && !['--materials', '--help'].includes(args[0]))
)
  throw new Error('Uso: npm run test:e2e [-- --materials|--help].');
const materialsOnly = args[0] === '--materials';
const helpOnly = args[0] === '--help';
const focused = materialsOnly || helpOnly;
const suite = helpOnly ? 'help' : materialsOnly ? 'materials' : 'full';
const reportName = helpOnly
  ? 'e2e-help'
  : materialsOnly
    ? 'e2e-materials'
    : 'e2e';
const reportIncrement = focused ? 'imp-04' : 'imp-01';
const resultPath = join(
  root,
  '.local/reports',
  reportIncrement,
  `${reportName}.json`,
);
const evidenceDirectory = join(
  root,
  '.local/evidence',
  focused ? 'imp-04' : 'imp-00-05',
);
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
  await report(
    helpOnly
      ? 'artifacts-help'
      : materialsOnly
        ? 'artifacts-materials'
        : 'artifacts',
    {
      status: 'passed',
      environment: 'isolated-local',
      privateValues: 'not-found',
      serverAdapterCanaries: 'not-found',
    },
    focused ? 'imp-04' : undefined,
  );

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
          ALUNZA_E2E_SUITE: suite,
          ALUNZA_TEST_API_URL: ctx.apiUrl,
          ALUNZA_E2E_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
          ALUNZA_E2E_CONTROL_KEY: controlKey,
          CYPRESS_CRASH_REPORTS: '0',
        },
      },
    );
    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    const fullCases = [
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
      ...Array.from(
        { length: 11 },
        (_, i) => `IMP03-${String(i + 1).padStart(2, '0')}`,
      ),
    ];
    const materialCases = ['IMP04-01', 'IMP04-02', 'IMP04-03'];
    const helpCases = [
      'IMP04-04',
      'IMP04-05',
      'IMP04-06',
      'IMP04-07',
      'IMP04-08',
      'IMP04-09',
      'IMP04-10',
    ];
    const requiredCases = helpOnly
      ? helpCases
      : materialsOnly
        ? materialCases
        : [...fullCases, ...materialCases, ...helpCases];
    const completed = new Set(
      result.tests
        .filter((item) => item.state === 'passed')
        .map((item) => item.id),
    );
    if (
      result.status !== 'passed' ||
      result.suite !== suite ||
      result.total !== requiredCases.length ||
      result.total !== result.passed ||
      completed.size !== requiredCases.length ||
      requiredCases.some((id) => !completed.has(id)) ||
      result.tests.some((item) => item.id === 'UNKNOWN')
    )
      throw new Error(
        helpOnly
          ? 'El recorrido dirigido no completó los siete escenarios requeridos IMP04-04/05/06/07/08/09/10.'
          : materialsOnly
            ? 'El recorrido dirigido no completó los tres escenarios requeridos IMP04-01/02/03.'
            : 'El recorrido no completó los 45 escenarios requeridos de fundación, identidad, contenido, práctica, materiales y ayuda.',
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
    if (!focused) await report('e2e', result, 'imp-03-submissions');
    await report(
      reportName,
      {
        ...result,
        embeddings: 'explicit-test-double',
        generationAndVerification: 'explicit-test-doubles',
        azureRemote: 'not-tested',
      },
      'imp-04',
    );
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(
      join(
        evidenceDirectory,
        helpOnly
          ? 'cypress-help.log'
          : materialsOnly
            ? 'cypress-materials.log'
            : 'cypress.log',
      ),
      sanitized(cypressOutput.stdout + cypressOutput.stderr),
      { mode: 0o600 },
    );
    console.log(
      `Cypress (${suite}): ${result.passed}/${result.total} casos aprobados.`,
    );
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
  await report(reportName, { status: 'not-started', suite }, reportIncrement);
  await withTestEnvironment(execute, [testContext.webPort]);
} catch (error) {
  let previous;
  try {
    previous = JSON.parse(await readFile(resultPath, 'utf8'));
  } catch {
    /* No completed Cypress run. */
  }
  if (previous?.status !== 'failed')
    await report(
      reportName,
      { status: 'failed-infrastructure', suite },
      reportIncrement,
    );
  await mkdir(evidenceDirectory, { recursive: true });
  const errorName = helpOnly
    ? 'e2e-help-error.log'
    : materialsOnly
      ? 'e2e-materials-error.log'
      : 'e2e-error.log';
  await writeFile(
    join(evidenceDirectory, errorName),
    sanitized(error.output ?? error.message),
    { mode: 0o600 },
  );
  console.error(
    `Cypress (${suite}) falló. Diagnóstico local saneado: ${focused ? '.local/evidence/imp-04/' : '.local/evidence/imp-00-05/'}${errorName}.`,
  );
  process.exitCode = 1;
}
