module.exports = {
  rootDir: '..',
  roots: ['<rootDir>/tests'],
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/contracts.test.cjs',
    '<rootDir>/tests/provisioning.test.cjs',
    '<rootDir>/tests/practice-contracts.test.cjs',
    '<rootDir>/tests/submission-contracts.test.cjs',
  ],
  transform: {},
};
