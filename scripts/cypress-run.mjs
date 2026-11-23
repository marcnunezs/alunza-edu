import cypress from 'cypress';
import { root } from './local.mjs';
import context from './phase-context.cjs';
const { suites, contextSpecs, inspectContextCoverage } = context;

// Node-only control; this is deliberately not CYPRESS_* browser environment.
const suite = process.env.ALUNZA_E2E_SUITE ?? 'full';
if (!suites.includes(suite)) throw new Error('ALUNZA_E2E_SUITE no admitida.');
// Run in a child process: raw Cypress diagnostics never become CI artifacts.
const result = await cypress.run({
  project: root,
  configFile: 'cypress.config.cjs',
  browser: 'chrome',
  headless: true,
  runnerUi: false,
  quiet: true,
  record: false,
  posixExitCodes: true,
  ...(suite !== 'full'
    ? {
        spec:
          suite === 'phase-context'
            ? [...contextSpecs]
            : `tests/e2e/${suite === 'bank-governance' ? 'exercise-bank-governance' : suite === 'bank' ? 'exercise-bank' : suite === 'rules' ? 'signal-rules' : suite === 'phase' ? 'progress-phase' : suite}.cy.ts`,
      }
    : {}),
});
const contextComplete =
  suite !== 'phase-context' ||
  inspectContextCoverage({
    specs: (result.runs ?? []).map((run) => run.spec?.relative),
    tests: (result.runs ?? []).flatMap((run) =>
      (run.tests ?? []).map((test) => ({
        spec: run.spec?.relative?.replaceAll('\\', '/'),
        id: test.title
          .join(' ')
          .match(/\b(?:FND-\d{2}|IMP\d{2}(?:-[A-Z]+)?-\d{2})\b/)?.[0],
        state: test.state,
      })),
    ),
  }).complete;
if (
  !contextComplete ||
  'failures' in result ||
  result.totalTests === 0 ||
  result.totalFailed > 0 ||
  result.totalPending > 0 ||
  result.totalSkipped > 0
) {
  process.exitCode = 1;
}
