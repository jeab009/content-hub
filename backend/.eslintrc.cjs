/**
 * ESLint configuration for the Content Hub backend.
 *
 * Security decision #5 (System Analyst review): raw SQL escape hatches are
 * banned. `$queryRawUnsafe` and `$executeRawUnsafe` accept string-concatenated
 * SQL and are the most common Prisma injection footgun — they are blocked
 * below via `no-restricted-syntax`. Use Prisma's parameterized query builder
 * (`prisma.model.findMany(...)`, etc.) or, only when the query builder truly
 * cannot express the query, `$queryRaw` / `$executeRaw` with a tagged
 * template literal (which Prisma parameterizes automatically).
 */
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.cjs', 'dist', 'node_modules'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'error',
    // Interface-mandated parameters that an implementation doesn't need
    // (e.g. the Phase 3/4 adapter capability stubs) use the standard `_`
    // prefix convention instead of being deleted, so signatures stay
    // aligned with the PlatformAdapter contract.
    '@typescript-eslint/no-unused-vars': [
      'error',
      { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "MemberExpression[property.name='queryRawUnsafe'], MemberExpression[property.name='executeRawUnsafe']",
        message:
          'Raw SQL escape hatches ($queryRawUnsafe / $executeRawUnsafe) are banned — use Prisma\'s parameterized query builder, or $queryRaw/$executeRaw with a tagged template literal.',
      },
    ],
  },
};
