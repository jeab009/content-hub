// BullMQ queue names cannot contain ":" — see queue.constants.ts's note.
export const PDPA_RETENTION_QUEUE = 'pdpa-retention';

export const PDPA_RETENTION_JOB_NAME = 'sweep';
export const PDPA_RETENTION_SCHEDULER_ID = 'pdpa-retention-daily-sweep';

// 03:15 server time — same low-traffic window as the token-refresh sweep
// (03:00, queue.service.ts), offset by 15 minutes so the two daily jobs
// don't contend for the DB connection pool at the exact same instant.
export const PDPA_RETENTION_CRON = '15 3 * * *';

// Audit actor for a system-triggered sweep, mirroring the existing
// 'system:token-refresh-job' / 'system:commerce-adapter' / 'system:paid-adapter'
// convention — there is no admin session behind a cron-fired job.
export const PDPA_RETENTION_SYSTEM_ACTOR = 'system:pdpa-retention-job';
