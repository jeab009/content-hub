-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('facebook', 'youtube', 'tiktok', 'line');

-- CreateEnum
CREATE TYPE "ConnectedAccountStatus" AS ENUM ('connected', 'disconnected', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('video', 'image', 'text');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('draft', 'ready', 'archived');

-- CreateEnum
CREATE TYPE "LicensingStatus" AS ENUM ('unlicensed', 'pending_review', 'licensed', 'exempt');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('draft', 'scheduled', 'posted', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "MetricSource" AS ENUM ('api', 'manual');

-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('positive', 'negative', 'neutral');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'admin',
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connected_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "platform_account_name" TEXT NOT NULL,
    "access_token_encrypted" TEXT,
    "refresh_token_encrypted" TEXT,
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT[],
    "status" "ConnectedAccountStatus" NOT NULL DEFAULT 'connected',
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connected_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contents" (
    "id" UUID NOT NULL,
    "type" "ContentType" NOT NULL,
    "title" TEXT NOT NULL,
    "media_url" TEXT NOT NULL,
    "caption" TEXT,
    "target_age_min" INTEGER NOT NULL,
    "target_age_max" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "licensing_status" "LicensingStatus" NOT NULL DEFAULT 'unlicensed',
    "license_notes" TEXT,
    "license_expires_at" DATE,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "priority_score" DECIMAL(10,4),
    "recommended_at" TIMESTAMP(3),
    "scheduled_at" TIMESTAMP(3),
    "posted_at" TIMESTAMP(3),
    "status" "PostStatus" NOT NULL DEFAULT 'draft',
    "executed_by" UUID,
    "external_post_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "reach" INTEGER NOT NULL,
    "engagement" INTEGER NOT NULL,
    "revenue" DECIMAL(12,2) NOT NULL,
    "source" "MetricSource" NOT NULL,
    "collected_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "author" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sentiment" "Sentiment",
    "collected_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "connected_accounts_status_idx" ON "connected_accounts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "connected_accounts_user_id_platform_platform_account_id_key" ON "connected_accounts"("user_id", "platform", "platform_account_id");

-- CreateIndex
CREATE INDEX "contents_status_created_by_licensing_status_idx" ON "contents"("status", "created_by", "licensing_status");

-- CreateIndex
CREATE INDEX "posts_content_id_status_scheduled_at_idx" ON "posts"("content_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "metrics_post_id_collected_at_idx" ON "metrics"("post_id", "collected_at");

-- CreateIndex
CREATE INDEX "comments_post_id_idx" ON "comments"("post_id");

-- AddForeignKey
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contents" ADD CONSTRAINT "contents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_executed_by_fkey" FOREIGN KEY ("executed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
