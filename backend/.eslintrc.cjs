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
  /**
   * Phase 6 — Layer 2 of the commerce ⇄ payout separation (design §2.2,
   * System Analyst condition B4). `npm run lint` is `--max-warnings 0` and CI
   * runs it before anything else, so a violation genuinely fails the build.
   *
   * The zones are SYSTEM-WIDE, not four directories. The design named only
   * `ranking`, `metrics`, `dashboard` and `report-export.service.ts`; the
   * System Analyst's G2b finding was that a shared helper in `common/utils/`
   * importing both sides would have passed lint while breaking the same rule.
   * "No combined total anywhere" is a system-wide rule, so the config is too.
   */
  overrides: [
    {
      // The PAYOUT + RANKING side of the boundary. Phase 6 locked decision
      // C-C: ranking stays payout + engagement + override feedback only. A
      // commerce import here is not a style issue — it is a breach of a
      // business rule the ranking engine would then learn from silently.
      files: [
        'src/modules/ranking/**/*.ts',
        'src/modules/metrics/**/*.ts',
        'src/modules/dashboard/**/*.ts',
        // B4 extension — the rest of the payout/content side.
        'src/modules/scheduler/**/*.ts',
        'src/modules/content/**/*.ts',
        'src/modules/queue/**/*.ts',
        'src/modules/publish/**/*.ts',
        'src/common/**/*.ts',
        // File granularity, not the whole `reports/` directory: the commerce
        // CSV (6A.9) lives in `modules/commerce/` and is MOUNTED by
        // `reports.controller.ts`, so that controller must stay able to import
        // it. Restricting the directory would force the commerce export into
        // the payout service — the exact wrong outcome. The price of the
        // exemption is paid by the frozen-header test
        // (src/testing/separation/csv-header-freeze.spec.ts) and by the
        // boundary scan, which covers all of `reports/` with no exemption.
        'src/modules/reports/report-export.service.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/commerce/**', '**/modules/commerce'],
                message:
                  'Commerce is a structurally separate stream (phase6-project-plan.md C-A/C-B/C-C). ' +
                  'Payout and ranking modules must never read a commerce table. If you believe you ' +
                  'need this, it is a new admin decision, not a refactor.',
              },
              {
                // Phase 7 — the same rule, extended to the third stream
                // (design §2.2, System Analyst condition P-B4). Note this
                // does NOT ban `**/content/**` — `src/modules/content/**`
                // is itself covered by THIS override's `files` list, so it
                // is banned from importing paid/commerce like every other
                // entry here, but nothing bans PaidModule from importing
                // ContentModule (that ban lives on the paid-side override
                // below, and it deliberately omits `content`).
                group: ['**/paid/**', '**/modules/paid'],
                message:
                  'Paid/ads is a structurally separate stream (phase7-project-plan.md Decision 4). ' +
                  'Payout and ranking modules must never read a paid table. If you believe you need ' +
                  'this, it is a new admin decision, not a refactor.',
              },
            ],
          },
        ],
      },
    },
    {
      // The COMMERCE side. Symmetric: commerce must not read the metric stream
      // either, or a future "blend in payout for context" makes the separation
      // one-directional while the byte-identity test still passes.
      files: ['src/modules/commerce/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                // NOTE the shape of these globs. `no-restricted-imports`
                // matches the import SPECIFIER STRING, not the resolved path,
                // so `**/modules/metrics/**` never fires on the relative form
                // `../metrics/metrics.service` that a sibling module actually
                // writes — it would have been a rule that only caught the
                // spelling nobody uses. Verified by deliberately breaking it.
                group: [
                  '**/metrics/**',
                  '**/ranking/**',
                  '**/dashboard/**',
                  '**/reports/**',
                  '**/modules/metrics',
                  '**/modules/ranking',
                  '**/modules/dashboard',
                  '**/modules/reports',
                ],
                message:
                  'Commerce must not read the payout/ranking stream. Two streams, two totals.',
              },
              {
                // Phase 7 — closes the third leg of the triangle: commerce
                // must not import paid either (design §2.2, System Analyst
                // condition P-B4). payout<->paid and payout<->commerce were
                // already banned above; commerce<->paid is the one Phase 7 adds.
                group: ['**/paid/**', '**/modules/paid'],
                message:
                  'Commerce must not read the paid/ads stream. Three streams, three totals.',
              },
            ],
          },
        ],
      },
    },
    {
      // The PAID side (design §2.2, System Analyst condition P-B4). Paid must
      // not read the metric/ranking/payout stream OR the commerce stream.
      // Deliberately does NOT ban `**/content/**`, `**/common/**`,
      // `**/scheduler/**`, `**/queue/**`, or `**/publish/**` — PaidModule
      // legitimately imports `ContentModule` (the content picker lookup) and
      // `common/*` (audit logging), and imports nothing else at all. Its
      // import graph must stay exactly `{ContentModule, common/*}` — no path
      // to PublishModule (so no step-up dependency), RankingModule,
      // MetricsModule, DashboardModule, or CommerceModule.
      files: ['src/modules/paid/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '**/metrics/**',
                  '**/ranking/**',
                  '**/dashboard/**',
                  '**/reports/**',
                  '**/commerce/**',
                  '**/modules/metrics',
                  '**/modules/ranking',
                  '**/modules/dashboard',
                  '**/modules/reports',
                  '**/modules/commerce',
                ],
                message:
                  'Paid must not read the payout/ranking or commerce stream. Three streams, three totals.',
              },
            ],
          },
        ],
      },
    },
    {
      // `src/testing/` is on NEITHER side. It holds the separation fixtures,
      // which must legitimately seed both streams in one file — that is the
      // whole reason it exists outside the scanned module directories
      // (condition B3). It is excluded from the `src/common/**` zone above by
      // being a sibling, not a child; this entry documents the intent so it is
      // not "tidied" into `common/` later.
      files: ['src/testing/**/*.ts'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
};
