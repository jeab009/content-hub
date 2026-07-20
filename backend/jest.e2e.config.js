/**
 * Jest configuration for the REAL-DATABASE end-to-end suite (Phase 6.0.8).
 *
 * WHY THIS FILE EXISTS AT ALL — read before adding a test anywhere else.
 *
 * `jest.config.js` (the unit suite) is `rootDir: 'src'` with
 * `testRegex: '.*\.spec\.ts$'`. Two consequences that silently bite:
 *
 *   1. Anything placed under `backend/test/` is NEVER collected, because it
 *      is outside `rootDir`.
 *   2. A file named `*.e2e-spec.ts` would not match `.*\.spec\.ts$` even if
 *      it were inside `src/` — the regex needs a literal dot before `spec`,
 *      and `e2e-spec` has a hyphen.
 *
 * The Phase 6 System Analyst review (docs/phase6-system-analysis.md §2, G3a)
 * called this out as the most important finding of the review: the separation
 * tests, as originally specified, would have reported green by never having
 * executed. Exit criteria #1 and #6 would have been vacuous.
 *
 * So the split is deliberate and load-bearing:
 *
 *   - Static / introspection separation checks (enum freeze, boundary scan,
 *     CSV header freeze) live at `src/testing/separation/*.spec.ts` and are
 *     collected by the FAST unit suite that every developer already runs.
 *   - The byte-identity proof (exit criterion #6) needs a real Postgres, so
 *     it lives here, in `backend/test/*.e2e-spec.ts`, behind
 *     `npm run test:e2e`, and runs as its OWN CI job — so a failure reads as
 *     "separation broken", not as one red dot among 400+ passing unit tests.
 *
 * Requires DATABASE_URL pointing at a migrated database (CI provisions
 * postgres:16-alpine and runs `prisma migrate deploy` before this job).
 */
module.exports = {
  displayName: 'e2e',
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  // A real-DB suite serialises: the fixtures own the whole database.
  maxWorkers: 1,
  // Migrations + Nest boot + two full re-rank passes.
  testTimeout: 120000,
};
