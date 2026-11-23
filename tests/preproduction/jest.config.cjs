module.exports = {
  rootDir: '../..',
  roots: ['<rootDir>/tests/preproduction'],
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/preproduction/*.test.mjs',
    '<rootDir>/tests/preproduction/help-probe.test.cjs',
  ],
  transform: {},
};
