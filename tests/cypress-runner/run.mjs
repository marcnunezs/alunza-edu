import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const root = fileURLToPath(new URL('../../', import.meta.url));
const launcherPath = resolve(root, 'scripts/cypress-run.mjs');
const digest = (source) => createHash('sha256').update(source).digest('hex');

// Only the option-capture pass is mocked. The regression below launches the
// installed Cypress and Chrome with the argument produced by the real source.
export async function captureOptions() {
  const source = await readFile(launcherPath, 'utf8');
  const captured = [];
  const isolatedProcess = { env: { ALUNZA_E2E_SUITE: 'full' }, exitCode: 0 };
  const context = createContext({ process: isolatedProcess });
  const imports = {
    cypress: {
      default: {
        async run(options) {
          captured.push(options);
          return {
            totalTests: 1,
            totalFailed: 0,
            totalPending: 0,
            totalSkipped: 0,
            runs: [],
          };
        },
      },
    },
    './local.mjs': { root },
    './phase-context.cjs': {
      default: {
        suites: ['full'],
        contextSpecs: [],
        inspectContextCoverage() {
          throw new Error('UNEXPECTED_CONTEXT_INSPECTION');
        },
      },
    },
  };
  const launcher = new SourceTextModule(source, {
    context,
    identifier: 'alunza-cypress-launcher',
  });
  await launcher.link((specifier) => {
    const exports = imports[specifier];
    if (!exports) throw new Error('UNEXPECTED_LAUNCHER_IMPORT');
    return new SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [name, value] of Object.entries(exports))
          this.setExport(name, value);
      },
      { context },
    );
  });
  await launcher.evaluate();
  if (captured.length !== 1 || isolatedProcess.exitCode !== 0)
    throw new Error('INVALID_LAUNCHER_CAPTURE');
  return { options: captured[0], sourceSha256: digest(source) };
}

const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Runner regression</title></head><body><main><h1>Local runner fixture</h1><p data-cy="fixture-state">pending</p></main></body></html>`;
const ids = ['RUNNER-01', 'RUNNER-02', 'RUNNER-03'];

function observation(input) {
  if (
    input?.id === 'RUNNER-01' &&
    typeof input.reporterPresent === 'boolean' &&
    Object.keys(input).length === 2
  )
    return { id: input.id, reporterPresent: input.reporterPresent };
  if (
    input?.id === 'RUNNER-02' &&
    Number.isSafeInteger(input.retries) &&
    input.retries > 0 &&
    input.retries < 10_000 &&
    input.initialPending === true &&
    input.finalReady === true &&
    input.viewportWidth === 1280 &&
    input.viewportHeight === 900 &&
    Object.keys(input).length === 6
  )
    return {
      id: input.id,
      retries: input.retries,
      initialPending: true,
      finalReady: true,
      viewportWidth: input.viewportWidth,
      viewportHeight: input.viewportHeight,
    };
  throw new Error('INVALID_OBSERVATION');
}

function summarize(result, observations) {
  const tests = (result?.runs ?? []).flatMap((run) => run.tests ?? []);
  const cases = tests.map((test) => ({
    id: ids.find((id) => test.title.at(-1)?.startsWith(`${id} `)) ?? null,
    state: ['passed', 'failed', 'pending', 'skipped'].includes(test.state)
      ? test.state
      : 'unknown',
    attempts: test.attempts?.length ?? 0,
    sentinelFailure:
      test.state === 'failed' &&
      [
        test.displayError,
        ...(test.attempts ?? []).map((attempt) => attempt.error?.message),
      ].some(
        (message) =>
          typeof message === 'string' &&
          message.includes('RUNNER_EXPECTED_FAILURE'),
      ),
  }));
  const structureValid =
    !('failures' in result) &&
    result.runs?.length === 1 &&
    result.totalTests === 3 &&
    result.totalPending === 0 &&
    result.totalSkipped === 0 &&
    cases.length === 3 &&
    cases.every((test, index) => test.id === ids[index] && test.attempts === 1);
  const reporter = observations.find((item) => item.id === 'RUNNER-01');
  const retry = observations.find((item) => item.id === 'RUNNER-02');
  const evidenceValid =
    observations.length === 2 && reporter !== undefined && retry !== undefined;
  const passed =
    structureValid &&
    evidenceValid &&
    reporter.reporterPresent === false &&
    cases[0].state === 'passed' &&
    cases[1].state === 'passed' &&
    cases[2].state === 'failed' &&
    cases[2].sentinelFailure &&
    result.totalPassed === 2 &&
    result.totalFailed === 1;
  return {
    status: passed ? 'passed' : 'failed',
    structureValid,
    evidenceValid,
    counts: {
      tests: result.totalTests ?? null,
      passed: result.totalPassed ?? null,
      failed: result.totalFailed ?? null,
      pending: result.totalPending ?? null,
      skipped: result.totalSkipped ?? null,
    },
    cases,
    observations,
  };
}

async function main() {
  if (process.argv.length !== 3) {
    console.error(
      'Usage: node --experimental-vm-modules tests/cypress-runner/run.mjs <report.json>',
    );
    process.exitCode = 1;
    return;
  }
  const reportPath = resolve(process.argv[2]);
  await mkdir(dirname(reportPath), { recursive: true });
  const output = await open(reportPath, 'wx');
  let server;
  const observations = [];
  const report = {
    schemaVersion: 1,
    status: 'failed',
    purpose: 'runner-ui-behavior-regression',
    limitations: [
      'The sentinel is an intentional Cypress failure; only the external verdict can pass.',
      'This local fixture does not establish application performance or PHASE-07 acceptance.',
      'The reporter DOM selector is specific to the installed Cypress version.',
    ],
  };
  try {
    // A pre-existing override could hide the reporter in candidate A.
    if (
      ['CYPRESS_NO_COMMAND_LOG', 'CYPRESS_RUNNER_UI', 'CYPRESS_RUNNERUI'].some(
        (name) => process.env[name] !== undefined,
      )
    )
      throw new Error('AMBIENT_RUNNER_OVERRIDE');
    const captured = await captureOptions();
    report.sourceSha256 = captured.sourceSha256;
    report.launch = {
      runnerUi: captured.options.runnerUi ?? null,
      headless: captured.options.headless,
      browser: captured.options.browser,
      record: captured.options.record,
    };
    server = createServer(async (request, response) => {
      try {
        if (request.method === 'POST' && request.url === '/__runner_probe') {
          let body = '';
          for await (const chunk of request) {
            body += chunk;
            if (body.length > 512) throw new Error('OVERSIZED_OBSERVATION');
          }
          const item = observation(JSON.parse(body));
          if (observations.some((previous) => previous.id === item.id))
            throw new Error('DUPLICATE_OBSERVATION');
          observations.push(item);
          response.writeHead(204).end();
          return;
        }
        if (request.method === 'GET' && request.url === '/') {
          response
            .writeHead(200, {
              'content-type': 'text/html; charset=utf-8',
              'cache-control': 'no-store',
            })
            .end(fixture);
          return;
        }
        response.writeHead(request.url === '/favicon.ico' ? 204 : 404).end();
      } catch {
        response.writeHead(400).end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { default: cypress } = await import('cypress');
    const result = await cypress.run({
      ...captured.options,
      configFile: resolve(root, 'tests/cypress-runner/config.cjs'),
      spec: resolve(root, 'tests/cypress-runner/runner-ui.cy.js'),
      config: {
        ...captured.options.config,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
      },
    });
    Object.assign(report, summarize(result, observations));
    report.sourceStable =
      digest(await readFile(launcherPath, 'utf8')) === captured.sourceSha256;
    if (!report.sourceStable) report.status = 'failed';
  } catch (error) {
    report.status = 'failed';
    const known = new Set([
      'AMBIENT_RUNNER_OVERRIDE',
      'UNEXPECTED_LAUNCHER_IMPORT',
      'UNEXPECTED_CONTEXT_INSPECTION',
      'INVALID_LAUNCHER_CAPTURE',
    ]);
    report.failure = known.has(error.message)
      ? error.message
      : 'RUNNER_REGRESSION_INFRASTRUCTURE_FAILURE';
  } finally {
    if (server?.listening)
      await new Promise((resolve) => server.close(resolve));
    await output.writeFile(`${JSON.stringify(report, null, 2)}\n`);
    await output.close();
  }
  console.log(
    JSON.stringify({
      status: report.status,
      counts: report.counts ?? null,
      sourceStable: report.sourceStable ?? null,
    }),
  );
  process.exitCode = report.status === 'passed' ? 0 : 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
