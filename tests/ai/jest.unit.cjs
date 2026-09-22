module.exports = {
  rootDir: '../..',
  modulePathIgnorePatterns: [
    '<rootDir>/.local/',
    '<rootDir>/.tools/',
    '<rootDir>/apps/web/.next',
  ],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/ai/unit.test.cjs'],
  clearMocks: true,
  restoreMocks: true,
};
