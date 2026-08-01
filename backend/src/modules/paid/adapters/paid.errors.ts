/**
 * Typed error taxonomy for the paid live-sync stub (WBS 7D.2), mirroring
 * `backend/src/modules/commerce/adapters/commerce.errors.ts` exactly in
 * shape. Deliberately small: no HTTP client exists this phase
 * (docs/phase7d-live-integration-spec.md §0/§6), so there is no dispatch/
 * ambiguity distinction to make the way `publisher.errors.ts` needs one —
 * every failure here is pre-dispatch by construction.
 */

/** Base class so `instanceof PaidAdapterError` catches the whole family. */
export abstract class PaidAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * No usable credentials were supplied. Mirrors `CommerceCredentialsError`.
 * Nothing constructs a non-null `PaidCredentials` today (there is no
 * credential store for it — see the spec §4), but this is kept so a future
 * live implementation rejects `credentials: null` the same faithful way the
 * commerce adapters already do, rather than inventing a different contract
 * on credential day.
 */
export class PaidCredentialsError extends PaidAdapterError {}

/**
 * The Meta channel has no live integration yet — no `ads_read` OAuth scope
 * has been granted on this system's Meta App
 * (docs/meta-app-review-status.md), so no HTTP client exists (Decision 1/2,
 * docs/phase7-project-plan.md; docs/phase7d-live-integration-spec.md).
 * Thrown by every method on `PaidLiveAdapter` regardless of credentials;
 * audited by the caller as `paid_adapter_unavailable`.
 */
export class PaidIntegrationUnavailableError extends PaidAdapterError {}
