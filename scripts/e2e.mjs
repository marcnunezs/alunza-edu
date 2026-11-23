import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, run, redactDiagnostics } from './local.mjs';
import { seedAcademic } from './academic-fixture.mjs';
import phaseContext from './phase-context.cjs';
import inventory from './e2e-inventory.cjs';
import { summarizePhaseDiagnostics } from './phase-diagnostics.mjs';
import { captureSignalCandidate } from './signals-candidate.mjs';
import {
  createPhaseHostObserver,
  readPhaseDiagnosticEvents,
} from './phase-observation.mjs';
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
const { parseE2eArguments } = phaseContext;
const { casesForSuite } = inventory;
const { suite, diagnostics } = parseE2eArguments(process.argv.slice(2));
const materialsOnly = suite === 'materials';
const helpOnly = suite === 'help';
const progressOnly = suite === 'progress';
const rulesOnly = suite === 'rules';
const dashboardOnly = suite === 'dashboard';
const phaseOnly = suite === 'phase';
const phaseContextOnly = suite === 'phase-context';
const bankOnly = suite === 'bank';
const governanceOnly = suite === 'bank-governance';
const studentDetailOnly = suite === 'student-detail';
const signalReviewOnly = suite === 'signal-review';
const auditOnly = suite === 'audit';
const auditExportOnly = suite === 'audit-export';
const governancePhaseOnly = suite === 'governance-phase';
const focused = suite !== 'full';
const reportName = focused ? `e2e-${suite}` : 'e2e';
const reportIncrement =
  governancePhaseOnly ||
  auditExportOnly ||
  auditOnly ||
  bankOnly ||
  governanceOnly ||
  studentDetailOnly ||
  signalReviewOnly ||
  phaseContextOnly
    ? 'imp-06'
    : progressOnly || rulesOnly || dashboardOnly || phaseOnly
      ? 'imp-05'
      : focused
        ? 'imp-04'
        : 'imp-01';
const resultPath = join(
  root,
  '.local/reports',
  reportIncrement,
  `${reportName}.json`,
);
const evidenceDirectory = join(
  root,
  '.local/evidence',
  phaseContextOnly
    ? 'imp-06-closure'
    : governancePhaseOnly ||
        bankOnly ||
        governanceOnly ||
        studentDetailOnly ||
        signalReviewOnly ||
        auditOnly ||
        auditExportOnly
      ? 'imp-06'
      : progressOnly || rulesOnly || dashboardOnly || phaseOnly
        ? 'imp-05'
        : focused
          ? 'imp-04'
          : 'imp-00-05',
);
let privateValues = [];
let governanceCandidateBefore;
let governanceStartedAt;
function sanitized(text) {
  for (const value of privateValues)
    if (value) text = text.split(value).join('[redacted]');
  return redactDiagnostics(text);
}

async function normalizeGovernanceReport(result) {
  const after = await captureSignalCandidate('governance-phase-e2e-after');
  return {
    ...result,
    schemaVersion: 1,
    increment: 'IMP-06.07',
    evidenceSurface: 'e2e',
    environment: 'LAB TEST',
    sourceDigestBefore: governanceCandidateBefore?.sourceDigest ?? null,
    sourceDigestAfter: after.sourceDigest,
    startedAt: governanceStartedAt ?? null,
    finishedAt: new Date().toISOString(),
    cases: (result.tests ?? []).map((item) => ({
      id: item.id,
      status: item.state,
    })),
    counts: {
      total: result.total ?? 0,
      passed: result.passed ?? 0,
      failed: result.failed ?? 0,
      pending: result.pending ?? 0,
      skipped: result.skipped ?? 0,
    },
  };
}

async function execute({ ctx, state }) {
  if (governancePhaseOnly) {
    governanceStartedAt = new Date().toISOString();
    governanceCandidateBefore = await captureSignalCandidate(
      'governance-phase-e2e-before',
    );
  }
  await seedAcademic(state);
  privateValues = [
    state.fixturePassword,
    state.applicationPassword,
    state.authAdminKey,
    state.migrationUrl,
  ];
  const diagnosticEnvironment = {
    ALUNZA_TEST_DASHBOARD_TIMINGS: diagnostics ? '1' : '0',
  };
  const publicEnvironment = {
    ...publicTestEnvironment(state),
    ...diagnosticEnvironment,
  };
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
    focused ? reportIncrement : undefined,
  );

  const api = testApi(ctx, state, ctx.webPort, diagnosticEnvironment);
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
  let hostObserver;
  let candidateBefore;
  try {
    await api.start(readyUrl);
    await web.start(ctx.webUrl);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const controlPort = server.address().port;
    if (diagnostics) {
      await report(
        'phase-browser-diagnostics',
        {
          schemaVersion: 1,
          diagnosticScope: 'dashboard+progress',
          profiles: [],
        },
        'imp-06',
      );
      candidateBefore = await captureSignalCandidate('phase-context-before');
      hostObserver = createPhaseHostObserver();
    }
    console.log('Ejecutando Cypress en Chrome con servicios reales...');
    const cypressOutput = await run(
      process.execPath,
      [join(root, 'scripts/cypress-run.mjs')],
      {
        env: {
          ...diagnosticEnvironment,
          ALUNZA_TEST_STATE: ctx.statePath,
          ALUNZA_E2E_SUITE: suite,
          ALUNZA_TEST_API_URL: ctx.apiUrl,
          ALUNZA_E2E_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
          ALUNZA_E2E_CONTROL_KEY: controlKey,
          CYPRESS_CRASH_REPORTS: '0',
        },
      },
    );
    let result = JSON.parse(await readFile(resultPath, 'utf8'));
    if (governancePhaseOnly) {
      result = await normalizeGovernanceReport(result);
      await report(reportName, result, 'imp-06');
      if (result.sourceDigestBefore !== result.sourceDigestAfter)
        throw new Error(
          'Las fuentes cambiaron durante la aceptación funcional .07.',
        );
    }
    const requiredCases = casesForSuite(suite);
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
      result.tests.some((item) => item.id === 'UNKNOWN') ||
      (phaseContextOnly && result.contextCoverage?.complete !== true)
    )
      throw new Error(
        `La suite ${suite} no completó los ${requiredCases.length} escenarios de su inventario.`,
      );
    for (const secret of privateValues) {
      if (api.output.includes(secret) || web.output.includes(secret))
        throw new Error('Un secreto apareció en logs de los servicios.');
    }
    if (
      api.output.includes('hidden-sentinel-e2e') ||
      web.output.includes('hidden-sentinel-e2e') ||
      api.output.includes('hidden-sentinel-exercise-bank-e2e') ||
      web.output.includes('hidden-sentinel-exercise-bank-e2e')
    )
      throw new Error('Una prueba oculta apareció en logs de los servicios.');
    if (!focused) await report('e2e', result, 'imp-03-submissions');
    if (!focused) await report('e2e', result, 'imp-05');
    if (!focused) await report('e2e', result, 'imp-06');
    await report(
      reportName,
      {
        ...result,
        embeddings: 'explicit-test-double',
        generationAndVerification: 'explicit-test-doubles',
        azureRemote: 'not-tested',
      },
      governancePhaseOnly ||
        bankOnly ||
        auditExportOnly ||
        auditOnly ||
        governanceOnly ||
        studentDetailOnly ||
        signalReviewOnly ||
        phaseContextOnly
        ? 'imp-06'
        : progressOnly || rulesOnly || dashboardOnly || phaseOnly
          ? 'imp-05'
          : 'imp-04',
    );
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(
      join(
        evidenceDirectory,
        governancePhaseOnly
          ? 'cypress-governance-phase.log'
          : phaseContextOnly
            ? 'cypress-phase-context.log'
            : auditExportOnly
              ? 'cypress-audit-export.log'
              : auditOnly
                ? 'cypress-audit.log'
                : signalReviewOnly
                  ? 'cypress-signal-review.log'
                  : studentDetailOnly
                    ? 'cypress-student-detail.log'
                    : governanceOnly
                      ? 'cypress-bank-governance.log'
                      : bankOnly
                        ? 'cypress-bank.log'
                        : phaseOnly
                          ? 'cypress-phase.log'
                          : dashboardOnly
                            ? 'cypress-dashboard.log'
                            : rulesOnly
                              ? 'cypress-rules.log'
                              : progressOnly
                                ? 'cypress-progress.log'
                                : helpOnly
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
      try {
        await web.stop();
      } finally {
        await api.stop();
      }
    } finally {
      if (diagnostics) {
        const hostObservation = hostObserver?.stop();
        try {
          const [browser, contextReport, candidateAfter] = await Promise.all([
            readFile(
              join(
                root,
                '.local/reports/imp-06/phase-browser-diagnostics.json',
              ),
              'utf8',
            ).then(JSON.parse),
            readFile(resultPath, 'utf8').then(JSON.parse),
            captureSignalCandidate('phase-context-after'),
          ]);
          const summary = summarizePhaseDiagnostics({
            // Explicit scope prevents missing progress profiles from silently
            // falling back to the historical dashboard-only reader.
            diagnosticScope: browser.diagnosticScope ?? null,
            allowedContextFailures: ['IMP05-PHASE-07', 'IMP05-PHASE-08'],
            browserProfiles: browser.profiles,
            apiEvents: readPhaseDiagnosticEvents(api.output),
            hostObservation,
            contextReport,
            candidate: { before: candidateBefore, after: candidateAfter },
          });
          await report('phase-context-diagnostics', summary, 'imp-06');
        } catch {
          // Do not replace the Cypress failure with an observer failure, or copy
          // arbitrary exception bodies into the sanitized diagnostic artifact.
          await report(
            'phase-context-diagnostics',
            {
              schemaVersion: 1,
              status: 'invalid',
              causalEligible: false,
              reasons: ['diagnostic-finalization-failed'],
            },
            'imp-06',
          );
        }
      }
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
  if (governancePhaseOnly && previous?.tests)
    await report(
      reportName,
      { ...(await normalizeGovernanceReport(previous)), status: 'failed' },
      'imp-06',
    );
  const errorName = governancePhaseOnly
    ? 'e2e-governance-phase-error.log'
    : phaseContextOnly
      ? 'e2e-phase-context-error.log'
      : auditExportOnly
        ? 'e2e-audit-export-error.log'
        : auditOnly
          ? 'e2e-audit-error.log'
          : signalReviewOnly
            ? 'e2e-signal-review-error.log'
            : studentDetailOnly
              ? 'e2e-student-detail-error.log'
              : governanceOnly
                ? 'e2e-bank-governance-error.log'
                : bankOnly
                  ? 'e2e-bank-error.log'
                  : phaseOnly
                    ? 'e2e-phase-error.log'
                    : dashboardOnly
                      ? 'e2e-dashboard-error.log'
                      : rulesOnly
                        ? 'e2e-rules-error.log'
                        : progressOnly
                          ? 'e2e-progress-error.log'
                          : helpOnly
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
    `Cypress (${suite}) falló. Diagnóstico local saneado: ${evidenceDirectory}/${errorName}.`,
  );
  process.exitCode = 1;
}
