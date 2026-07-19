/** Default page size for the admin audit-trail read. */
export const AUDIT_LOG_DEFAULT_PAGE_SIZE = 50;

/**
 * Hard cap on the audit-trail page size. Same rationale as the comment
 * inbox's MAX_PAGE_SIZE: an unbounded page is a query-DoS, and audit rows are
 * the highest-volume table in the system.
 */
export const AUDIT_LOG_MAX_PAGE_SIZE = 200;
