/**
 * Queue name constants, kept in their own file (no imports from
 * queue.module.ts or queue.service.ts) so that queue.module.ts,
 * queue.service.ts, and the processors can all import them without a
 * circular dependency.
 *
 * Previously these lived in queue.module.ts, which queue.service.ts (and
 * both processors) imported from — while queue.module.ts itself imported
 * QueueService/the processors. That circular require meant, at the time
 * queue.service.ts's `@InjectQueue(...)` decorators ran, the constants
 * hadn't been assigned on queue.module's exports object yet, so both
 * decorators silently received `undefined` and collided on Nest's default
 * queue token ("BullQueue_default"), crashing startup with "Nest can't
 * resolve dependencies of the QueueService".
 */
export const SYSTEM_HEALTH_QUEUE = 'system-health';
// Note: BullMQ queue names cannot contain ":" (Queue constructor throws
// "Queue name cannot contain :"), so this uses "-" instead.
export const TOKEN_REFRESH_QUEUE = 'connected-accounts-refresh-token';
// Phase 2 Pass B: manual-publish dispatch jobs (PublishModule). Same
// no-":" naming rule as above.
export const PUBLISH_QUEUE = 'publish-dispatch';
