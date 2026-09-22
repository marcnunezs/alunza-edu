import cypress from 'cypress';
import { root } from './local.mjs';

// Run in a child process: raw Cypress diagnostics never become CI artifacts.
const result = await cypress.run({
  project: root,
  configFile: 'cypress.config.cjs',
  browser: 'chrome',
  headless: true,
  quiet: true,
  record: false,
  posixExitCodes: true,
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
