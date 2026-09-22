module.exports = {
  rootDir: '..',
  roots: ['<rootDir>/tests'],
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/contracts.test.cjs',
    '<rootDir>/tests/provisioning.test.cjs',
  ],
  transform: {},
};
