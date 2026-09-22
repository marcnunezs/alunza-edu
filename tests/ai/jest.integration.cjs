module.exports = {
  rootDir: '../..',
  modulePathIgnorePatterns: [
    '<rootDir>/.local/',
    '<rootDir>/.tools/',
    '<rootDir>/apps/web/.next',
  ],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/ai/integration.test.cjs'],
  testTimeout: 15000,
  clearMocks: true,
  restoreMocks: true,
};
