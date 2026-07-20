/**
 * Typed error taxonomy for commerce adapters (6A.1). Deliberately small: this
 * phase ships no live HTTP client (Decision 5, see phase6-project-plan.md),
 * so there is no dispatch/ambiguity distinction to make the way
 * `publisher.errors.ts` needs one — every failure here is pre-dispatch by
 * construction.
 */

/** Base class so `instanceof CommerceAdapterError` catches the whole family. */
export abstract class CommerceAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * No usable credentials were supplied. Both mock and live adapters throw
 * this for `credentials: null` — mocks reject it too, faithful to the live
 * path, so a rehearsal that passes with `credentials: null` would be lying.
 */
export class CommerceCredentialsError extends CommerceAdapterError {}

/**
 * The channel has no live integration (no HTTP client exists this phase —
 * Decision 5). Thrown by every method on `ShopeeAdapter`/`TikTokShopAdapter`
 * regardless of credentials; audited by the caller as
 * `commerce_adapter_unavailable`.
 */
export class CommerceIntegrationUnavailableError extends CommerceAdapterError {}
