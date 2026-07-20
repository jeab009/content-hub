import { AppConfig } from './configuration';

/**
 * PublisherModule security condition #4, extended by Phase 6 System Analyst
 * condition SA-7: every PUBLISHER_IMPL_* and COMMERCE_IMPL_* flag MUST
 * default to "mock". This is a defense-in-depth check on top of the Joi
 * default/enum validation in env.validation.ts — it specifically guards
 * against a non-production environment (local dev, CI, a demo box) being
 * accidentally pointed at a real adapter, which would make real API calls
 * (or, for commerce, attempt one — the live impls are rejecting stubs with
 * no HTTP client) from a non-production run. Refuses to boot in that case
 * rather than merely warning, because a silently-live adapter in a demo
 * environment is exactly the kind of mistake this assertion exists to catch.
 *
 * SA-7 ruled this should be ONE extended function rather than a second,
 * parallel one for commerce — two refusal policies could drift; one cannot.
 * Renamed from assertPublisherFlagsAreSafe accordingly.
 *
 * Lives in its own file (not inline in main.ts) so it is unit-testable
 * without importing main.ts, whose module-level `bootstrap()` call would
 * otherwise fire on import.
 */
export function assertAdapterFlagsAreSafe(appConfig: AppConfig): void {
  const nonMockFlags = [
    appConfig.publisher.facebookImpl !== 'mock' ? 'PUBLISHER_IMPL_FACEBOOK' : null,
    appConfig.publisher.youtubeImpl !== 'mock' ? 'PUBLISHER_IMPL_YOUTUBE' : null,
    appConfig.publisher.tiktokImpl !== 'mock' ? 'PUBLISHER_IMPL_TIKTOK' : null,
    appConfig.publisher.lineImpl !== 'mock' ? 'PUBLISHER_IMPL_LINE' : null,
    appConfig.commerce.shopeeImpl !== 'mock' ? 'COMMERCE_IMPL_SHOPEE' : null,
    appConfig.commerce.tiktokShopImpl !== 'mock' ? 'COMMERCE_IMPL_TIKTOK_SHOP' : null,
  ].filter((flag): flag is string => flag !== null);

  if (nonMockFlags.length === 0) {
    return;
  }

  if (appConfig.nodeEnv !== 'production') {
    throw new Error(
      `Refusing to boot: ${nonMockFlags.join(', ')} resolved to a real (non-mock) adapter ` +
        `implementation while NODE_ENV="${appConfig.nodeEnv}" (not "production"). Real platform/` +
        'commerce adapters must only run in production. Set the flag(s) back to "mock" for ' +
        'local/dev/CI use.',
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    `WARNING: ${nonMockFlags.join(', ')} resolved to a real (non-mock) adapter implementation in ` +
      'production. Confirm this is intentional — commerce flags currently have no HTTP client ' +
      'behind them and will fail closed regardless (Decision 5).',
  );
}
