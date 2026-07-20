/**
 * Phase 6.0 — exit criterion #1: `Platform` and `AssetPlatform` are frozen.
 *
 * WHY THIS FILE IS AT `src/testing/separation/` AND NOT AT `backend/test/`
 * ----------------------------------------------------------------------
 * `backend/jest.config.js` is `rootDir: 'src'` with `testRegex: '.*\.spec\.ts$'`.
 * The design placed this test at `backend/test/schema-freeze.spec.ts`, which
 * jest would never have collected — the suite count would have risen by zero
 * and exit criterion #1 would have reported green having never executed. That
 * was the single most important finding of the System Analyst review
 * (docs/phase6-system-analysis.md §2, G3a; condition B1). Anything static
 * belongs under `src/**` with a `.spec.ts` name so the suite every developer
 * already runs picks it up.
 *
 * WHAT IT GUARDS
 * --------------
 * `AssetPlatform` is not a labelling enum — it is the ranking domain.
 * `ranking-v2.constants.ts` sets `RANKED_PLATFORMS_V2 = PLATFORM_TIE_BREAK_ORDER`,
 * typed `readonly AssetPlatform[]`, so appending a value here ENROLS IT INTO
 * v2 SCORING with no code change, no review and no other failing test. Phase 6
 * deliberately did not add `shopee`: commerce is a structurally separate
 * stream and ranking consumes payout + engagement + override feedback only
 * (phase6-project-plan.md C-C, Decision 2). Postgres enum additions are
 * irreversible, so the mistake would be permanent.
 *
 * These assertions read the GENERATED Prisma client, so they track the real
 * schema — regenerating the client after adding an enum value is what makes
 * them fail.
 */

import { AssetPlatform, CommerceChannel, Platform } from '@prisma/client';

describe('Phase 6 separation — platform enum freeze', () => {
  it('Platform is frozen at the Phase 1 set', () => {
    expect(Object.values(Platform)).toEqual(['facebook', 'youtube', 'tiktok', 'line']);
  });

  it('AssetPlatform is frozen — adding a value here enrols it into RANKED_PLATFORMS_V2', () => {
    expect(Object.values(AssetPlatform)).toEqual(['facebook', 'youtube', 'tiktok', 'line_oa']);
  });

  it('commerce channels live on their own enum, never on a platform enum', () => {
    expect(Object.values(CommerceChannel)).toEqual(['shopee', 'tiktok_shop']);

    const platformValues = [
      ...Object.values(Platform),
      ...Object.values(AssetPlatform),
    ] as string[];
    for (const channel of Object.values(CommerceChannel)) {
      expect(platformValues).not.toContain(channel);
    }
  });
});
