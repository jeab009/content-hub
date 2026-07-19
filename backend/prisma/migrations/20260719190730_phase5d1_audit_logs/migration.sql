-- CreateEnum
CREATE TYPE "AuditLogResult" AS ENUM ('success', 'failure');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT,
    "action" TEXT NOT NULL,
    "result" "AuditLogResult" NOT NULL,
    "ip" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_created_at_idx" ON "audit_logs"("actor", "created_at");
