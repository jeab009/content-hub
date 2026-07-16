/** Jest configuration for the Content Hub backend (unit tests). */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coveragePathIgnorePatterns: [
    '.module.ts',
    'main.ts',
    '.dto.ts',
    '.processor.ts',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
