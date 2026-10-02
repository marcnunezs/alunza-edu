import cypress from 'cypress';
import { root } from './local.mjs';

// Node-only control; this is deliberately not CYPRESS_* browser environment.
const suite = process.env.ALUNZA_E2E_SUITE ?? 'full';
if (!['full', 'materials', 'help'].includes(suite))
  throw new Error('ALUNZA_E2E_SUITE debe ser full, materials o help.');
// Run in a child process: raw Cypress diagnostics never become CI artifacts.
const result = await cypress.run({
  project: root,
  configFile: 'cypress.config.cjs',
  browser: 'chrome',
  headless: true,
  quiet: true,
  record: false,
  posixExitCodes: true,
  ...(suite !== 'full' ? { spec: `tests/e2e/${suite}.cy.ts` } : {}),
});
if (
  'failures' in result ||
  result.totalTests === 0 ||
  result.totalFailed > 0 ||
  result.totalPending > 0 ||
  result.totalSkipped > 0
) {
  process.exitCode = 1;
}
