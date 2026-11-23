// Dedicated child process: raw Cypress diagnostics are never inherited by the campaign.
import cypress from 'cypress';
const result = await cypress.run({
  configFile: 'tests/remote-sandbox/cypress.config.cjs',
  spec: 'tests/remote-sandbox/browser-vertical.cy.ts',
  browser: 'electron',
  headless: true,
  runnerUi: false,
  quiet: true,
  record: false,
  posixExitCodes: true,
});
if (
  'failures' in result ||
  result.totalTests !== 1 ||
  result.totalPassed !== 1 ||
  result.totalFailed ||
  result.totalPending ||
  result.totalSkipped
)
  process.exitCode = 1;
