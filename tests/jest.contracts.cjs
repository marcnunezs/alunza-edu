module.exports = {
  rootDir: '..',
  roots: ['<rootDir>/tests'],
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/contracts.test.cjs',
    '<rootDir>/tests/academic-contracts.test.cjs',
    '<rootDir>/tests/practice-contracts.test.cjs',
    '<rootDir>/tests/submission-contracts.test.cjs',
    '<rootDir>/tests/materials-contracts.test.cjs',
    '<rootDir>/tests/help-contracts.test.cjs',
    '<rootDir>/tests/help-fault-providers.test.cjs',
    '<rootDir>/tests/provisioning.test.cjs',
    '<rootDir>/tests/local-isolation.test.cjs',
  ],
  transform: {},
};
