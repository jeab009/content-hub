-- CreateEnum
CREATE TYPE "CommentPriority" AS ENUM ('complaint', 'question', 'spam', 'general');

-- CreateEnum
CREATE TYPE "SentimentSource" AS ENUM ('rule_based', 'model');

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "author_external_id" TEXT,
ADD COLUMN     "external_comment_id" TEXT,
ADD COLUMN     "priority" "CommentPriority",
ADD COLUMN     "replied_at" TIMESTAMP(3),
ADD COLUMN     "replied_by" UUID,
ADD COLUMN     "reply_external_id" TEXT,
ADD COLUMN     "reply_text" TEXT,
ADD COLUMN     "replyable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sentiment_source" "SentimentSource",
ADD COLUMN     "sla_due_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "comment_reply_templates" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comment_reply_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_alerts" (
    "id" UUID NOT NULL,
    "rule_key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "negative_count" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "raised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "escalation_alerts_raised_at_idx" ON "escalation_alerts"("raised_at");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_alerts_rule_key_window_start_key" ON "escalation_alerts"("rule_key", "window_start");

-- CreateIndex
CREATE INDEX "comments_platform_sentiment_priority_sla_due_at_idx" ON "comments"("platform", "sentiment", "priority", "sla_due_at");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_replied_by_fkey" FOREIGN KEY ("replied_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reply_templates" ADD CONSTRAINT "comment_reply_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 4 (C3) — DB-enforced comment dedup.
--
-- Partial unique index: at most ONE comment may exist per
-- (platform, external_comment_id) when external_comment_id IS NOT NULL.
-- Legacy/manual rows with a NULL external_comment_id are excluded (Postgres
-- already treats NULLs as DISTINCT, so the WHERE clause makes the intent
-- explicit and keeps the index small). This is the authoritative dedup key
-- that makes re-sync and concurrent syncs idempotent by construction; the
-- app-level createMany({ skipDuplicates: true }) leans on it.
--
-- Hand-written DDL (a Postgres partial index cannot be expressed via Prisma's
-- schema `@@unique`, which has no WHERE clause). Additive-only and reversible
-- (DROP INDEX). Same convention as posts_content_platform_active_key
-- (BUG-QA-001). NOTE: a null/empty external id gets ZERO dedup protection —
-- the adapter contract test (platform-adapter.contract.spec) asserts FB/YT
-- mock/live snapshots always carry a non-null, non-empty external id.
CREATE UNIQUE INDEX "comments_platform_external_key"
    ON "comments" ("platform", "external_comment_id")
    WHERE "external_comment_id" IS NOT NULL;
