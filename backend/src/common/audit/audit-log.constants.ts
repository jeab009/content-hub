/** Default page size for the admin audit-trail read. */
export const AUDIT_LOG_DEFAULT_PAGE_SIZE = 50;

/**
 * Hard cap on the audit-trail page size. Same rationale as the comment
 * inbox's MAX_PAGE_SIZE: an unbounded page is a query-DoS, and audit rows are
 * the highest-volume table in the system.
 */
export const AUDIT_LOG_MAX_PAGE_SIZE = 200;

/**
 * Audit retention policy (admin decision, 2026-07-20): **anonymize the PII,
 * keep the row forever** — deliberately NOT the comment table's delete-after-12
 * -months rule.
 *
 * Deleting audit rows would defeat the reason they are persisted at all: the
 * copyright gate on the manual-external path is justified on audit-trail
 * grounds (`bussiness_rule.md`), and a copyright dispute can surface long after
 * 12 months. So rows are permanent.
 *
 * The only personal data here is `actor` on a FAILED login: it holds the
 * address someone typed, which may belong to a person who is not our user at
 * all. That value is worth keeping just long enough to investigate a slow
 * brute-force attempt, and no longer.
 */
export const AUDIT_ACTOR_ANONYMIZE_AFTER_DAYS = 90;

/**
 * Actions whose `actor` is an attempted (unauthenticated) identifier rather
 * than a resolved user id. Only these get anonymized — for every other action
 * `actor` is an internal user id, which carries no standalone PII value and is
 * needed to attribute the business action.
 */
export const AUDIT_ACTIONS_WITH_ATTEMPTED_IDENTIFIER: readonly string[] = ['auth.login.failure'];

/** Replacement written over an expired attempted identifier. */
export const AUDIT_ACTOR_ANONYMIZED = '[anonymized]';
