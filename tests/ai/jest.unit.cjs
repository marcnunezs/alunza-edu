module.exports = {
  rootDir: '../..',
  modulePathIgnorePatterns: [
    '<rootDir>/.local/',
    '<rootDir>/.tools/',
    '<rootDir>/apps/web/.next',
  ],
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/ai/unit.test.cjs',
    '<rootDir>/tests/ai/ingestion*.test.cjs',
    '<rootDir>/tests/ai/help*.test.cjs',
  ],
  clearMocks: true,
  restoreMocks: true,
};
