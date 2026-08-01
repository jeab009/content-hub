/**
 * ESLint configuration for the Content Hub frontend.
 *
 * Converted from `.eslintrc.json` in Phase 6.0 for one reason: the separation
 * zones below need to carry their rationale, and JSON cannot hold a comment
 * (ESLint rejects a `"//"` key inside `overrides`). The rationale is the point
 * — a rule whose "why" is not next to it gets deleted by the next person who
 * hits it.
 *
 * PHASE 6 — LAYER 2 OF THE COMMERCE ⇄ PAYOUT SEPARATION, FRONTEND SIDE
 * (System Analyst conditions B6 / G2a / G5c.)
 *
 * Layers 1–4 of the separation are all backend: the Prisma client type graph
 * has no edge into commerce, backend ESLint zones ban the imports, a static
 * scan catches raw table names, and a byte-identity fixture proves payout
 * output is unchanged. None of them stops a developer writing
 *
 *     overview.totals.revenue + summary.commissionAmount
 *
 * in a JSX expression. The commerce dashboard section (6B) lands in the same
 * page and the same component tree as the payout KPI cards, so the frontend is
 * where a summation is MOST likely to be written — and until this file existed
 * it was the layer with the least enforcement (`{"extends":
 * "next/core-web-vitals"}` and nothing else).
 *
 * The commerce paths are declared AHEAD of the 6B code that will fill them.
 * The zone has to exist before the files do, or the first commerce component
 * ships unguarded and the rule arrives as a retrofit nobody wants to apply.
 *
 * PHASE 7 — LAYER 2 EXTENDED TO A THIRD STREAM (paid/ads), THREE-WAY
 * (docs/phase7-architecture-design.md §2.2, System Analyst condition P-B1).
 *
 * Three streams means three pairwise boundaries: payout↔commerce (already
 * above), payout↔paid, and commerce↔paid. Each of the three overrides below
 * bans BOTH of the other two streams from its own files, so no override only
 * has to be extended once per new stream rather than reworked from scratch.
 */
module.exports = {
  extends: 'next/core-web-vitals',
  overrides: [
    {
      // The PAYOUT side: dashboard pages, dashboard components, report
      // components. These render the figures the ranking engine consumes.
      files: [
        'src/app/dashboard/**/*.ts',
        'src/app/dashboard/**/*.tsx',
        'src/components/dashboard/**/*.ts',
        'src/components/dashboard/**/*.tsx',
        'src/components/reports/**/*.ts',
        'src/components/reports/**/*.tsx',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/commerce/**', '**/commerce', '**/lib/commerce*'],
                message:
                  'Payout dashboard components must never import a commerce module. Two streams, ' +
                  'two totals — a combined figure is a new admin decision (phase6-project-plan.md ' +
                  'C-A/C-B/C-C), not a UI tweak. Render the commerce section as its own component ' +
                  'with its own props type; no component may be handed both totals.',
              },
              {
                group: ['**/paid/**', '**/paid', '**/lib/paid*'],
                message:
                  'Payout dashboard components must never import a paid/ads module (Phase 7, ' +
                  'phase7-project-plan.md Decision 4/P-A). Render the paid section as its own ' +
                  'component with its own props type; no component may be handed both totals.',
              },
            ],
          },
        ],
      },
    },
    {
      // The symmetric COMMERCE side. Without it the ban is one-directional and
      // a commerce card could import the payout overview hook "for context" —
      // the same bug arriving from the other end. Phase 7 also bans commerce
      // from importing paid — the third leg of the triangle.
      files: [
        'src/components/commerce/**/*.ts',
        'src/components/commerce/**/*.tsx',
        'src/app/commerce/**/*.ts',
        'src/app/commerce/**/*.tsx',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                // NOTE the shape of these globs. `no-restricted-imports`
                // matches the import SPECIFIER STRING, not the resolved path,
                // so `**/components/dashboard/**` never fires on the relative
                // form `../dashboard/RevenueCards` that a sibling component
                // actually writes. Verified by deliberately breaking it.
                group: [
                  '**/dashboard/**',
                  '**/reports/**',
                  '**/lib/dashboard*',
                  '**/lib/reports*',
                ],
                message:
                  'Commerce components must never import a payout dashboard module. Two streams, two totals.',
              },
              {
                group: ['**/paid/**', '**/paid', '**/lib/paid*'],
                message:
                  'Commerce components must never import a paid/ads module (Phase 7, ' +
                  'phase7-project-plan.md Decision 4/P-A). Three streams, three totals.',
              },
            ],
          },
        ],
      },
    },
    {
      // Phase 7 — the PAID side, banning BOTH of the other two streams
      // (payout and commerce) from its own files (design §2.2, condition
      // P-B1/P-B4). PaidModule's only legitimate cross-stream need is a
      // read-only content lookup (ContentModule-equivalent), never dashboard,
      // reports, or commerce.
      files: [
        'src/components/paid/**/*.ts',
        'src/components/paid/**/*.tsx',
        'src/app/paid/**/*.ts',
        'src/app/paid/**/*.tsx',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '**/dashboard/**',
                  '**/reports/**',
                  '**/lib/dashboard*',
                  '**/lib/reports*',
                ],
                message:
                  'Paid/ads components must never import a payout dashboard module (Phase 7, ' +
                  'phase7-project-plan.md Decision 4/P-A). Three streams, three totals.',
              },
              {
                group: ['**/commerce/**', '**/commerce', '**/lib/commerce*'],
                message:
                  'Paid/ads components must never import a commerce module (Phase 7, ' +
                  'phase7-project-plan.md Decision 4/P-A). Three streams, three totals.',
              },
            ],
          },
        ],
      },
    },
  ],
};
