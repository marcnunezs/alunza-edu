/* eslint @typescript-eslint/no-require-imports: "off" */
const Sequencer = require('@jest/test-sequencer').default;

// Foundation checks the canonical fixture before IMP-01 creates additional,
// separately named adversarial institutions. Individual cases remain independent.
module.exports = class IdentityIntegrationSequencer extends Sequencer {
  sort(tests) {
    return [...tests].sort((a, b) => a.path.localeCompare(b.path));
  }
};
