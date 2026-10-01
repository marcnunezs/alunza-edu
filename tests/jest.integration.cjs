/* eslint @typescript-eslint/no-require-imports: "off" */
const path = require('node:path');

module.exports = {
  rootDir: path.resolve(__dirname, '..'),
  roots: ['<rootDir>/tests/integration'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/integration/**/*.test.cjs'],
  transform: {},
  maxWorkers: 1,
  testSequencer: '<rootDir>/tests/integration-sequencer.cjs',
  testTimeout: 20000,
  verbose: true,
};
