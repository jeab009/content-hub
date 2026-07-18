-- BUG-QA-001 — defense-in-depth against duplicate publish intents.
--
-- Partial unique index: at most ONE non-terminal Post may exist per
-- (content_id, platform). Terminal attempts (`failed`, `cancelled`) are
-- excluded from the constraint so a failed publish can still be re-created /
-- retried. This closes the TOCTOU race the app-level check in
-- PublishOrchestratorService.assertNoActiveDuplicate cannot: two truly
-- concurrent POST /api/posts for the same target now have exactly one winner
-- (the loser gets a P2002 -> 409).
--
-- Hand-written DDL (a Postgres partial index cannot be expressed via Prisma's
-- schema `@@unique`, which has no WHERE clause). Additive-only and reversible
-- (DROP INDEX). Matches ACTIVE_PUBLISH_STATUSES in publish-orchestrator.service.ts.
CREATE UNIQUE INDEX "posts_content_platform_active_key"
    ON "posts" ("content_id", "platform")
    WHERE "status" NOT IN ('failed', 'cancelled');
