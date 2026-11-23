const { defineConfig } = require('cypress');

module.exports = defineConfig({
  video: false,
  screenshotOnRunFailure: false,
  numTestsKeptInMemory: 0,
  retries: 0,
  viewportWidth: 1280,
  viewportHeight: 900,
  defaultCommandTimeout: 15_000,
  requestTimeout: 15_000,
  responseTimeout: 15_000,
  taskTimeout: 35_000,
  reporter: 'dot',
  e2e: {
    specPattern: 'tests/cypress-runner/runner-ui.cy.js',
    supportFile: false,
    testIsolation: true,
  },
});
