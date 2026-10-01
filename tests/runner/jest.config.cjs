module.exports = {
  rootDir: '../..',
  roots: ['<rootDir>/tests/runner'],
  testMatch: ['<rootDir>/tests/runner/**/*.test.cjs'],
  testEnvironment: 'node',
  transform: {},
  maxWorkers: 1,
};
