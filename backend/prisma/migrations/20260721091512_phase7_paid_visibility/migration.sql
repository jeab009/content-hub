-- =========================================================================
-- Phase 7.0 — Paid/Ads Visibility · Schema & Separation Gate
-- =========================================================================
--
-- ADDITIVE ONLY. This migration creates three enums and two tables. It
-- contains NO `ALTER TABLE posts`, `ALTER TABLE metrics`,
-- `ALTER TABLE ranking_scores`, `ALTER TABLE contents`, `ALTER TABLE comments`,
-- `ALTER TABLE commerce_*` / `affiliate_links` / `product_anchors`, or
-- `ALTER TYPE "Platform"` / `ALTER TYPE "AssetPlatform"` / `ALTER TYPE
-- "CommerceChannel"`. Verify by reading it: those strings do not appear below.
--
-- ---------------------------------------------------------------------
-- ⚠ FALSE-POSITIVE DRIFT — READ BEFORE RE-RUNNING `prisma migrate dev`
-- ---------------------------------------------------------------------
-- `prisma migrate dev --create-only`'s FIRST auto-generated draft of this file
-- contained FOURTEEN `DROP CONSTRAINT` statements against five EXISTING
-- Commerce tables (`affiliate_links`, `commerce_conversions`,
-- `commerce_placements`, `commerce_products`, `product_anchors`). This was a
-- false positive, not a real schema change: those FKs are hand-written
-- `ALTER TABLE` DDL in `20260721000000_phase6_commerce/migration.sql`
-- SECTION 2 — deliberately "SQL FK only, no Prisma relation" — so Prisma's
-- diff engine, which only knows about relations declared in `schema.prisma`,
-- concluded they were "supposed to not exist" and proposed dropping them.
-- Applying that draft as generated would have silently destroyed referential
-- integrity on five live Commerce tables. Those fourteen lines were deleted by
-- hand before this migration was ever applied — they do not appear below, and
-- must never be reintroduced by a future auto-regenerate. Same operational
-- note as Commerce's own migration: review `prisma migrate diff` output;
-- never auto-apply it.
--
-- ---------------------------------------------------------------------
-- WHY SO MUCH OF THIS FILE IS HAND-WRITTEN DDL (SECTION 2)
-- ---------------------------------------------------------------------
-- Section 2 is written by hand because Prisma's schema language cannot
-- express FOREIGN KEYS WITHOUT A PRISMA RELATION FIELD or CHECK constraints.
--
-- The FK omission is this phase's primary separation guarantee (schema.prisma
-- header comment above `AdCampaign`, design §2.1), mirroring Commerce's own
-- Layer 1 exactly: `AdCampaign.contentId` / `createdBy` and
-- `AdPerformanceEntry.recordedBy` are plain `String @db.Uuid` columns with no
-- Prisma relation, so `Content` and `User` gain no back-relation field and
-- `prisma.content.findMany({ include: { adCampaigns: true } })` is not
-- spellable. Postgres still enforces the FK — declared here instead.
--
-- ROLLBACK: drop the two tables (children first: ad_performance_entries,
-- ad_campaigns) and the three enums (AdSource, AdCampaignStatus, AdChannel).
-- No existing table is altered, so a rollback cannot corrupt Phase 1–6 data.
--
-- =========================================================================
-- SECTION 1 — Prisma-generated DDL (enums, tables, indexes, in-namespace FK)
-- =========================================================================

-- CreateEnum
CREATE TYPE "AdChannel" AS ENUM ('meta');

-- CreateEnum
CREATE TYPE "AdCampaignStatus" AS ENUM ('active', 'paused', 'ended');

-- CreateEnum
CREATE TYPE "AdSource" AS ENUM ('manual', 'api');

-- CreateTable
CREATE TABLE "ad_campaigns" (
    "id" UUID NOT NULL,
    "channel" "AdChannel" NOT NULL,
    "external_campaign_name" TEXT NOT NULL,
    "external_campaign_id" TEXT,
    "objective" TEXT NOT NULL,
    "content_id" UUID,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "planned_budget" DECIMAL(12,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'THB',
    "status" "AdCampaignStatus" NOT NULL DEFAULT 'active',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "retired_at" TIMESTAMP(3),
    "source" "AdSource" NOT NULL DEFAULT 'manual',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_performance_entries" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "spend" DECIMAL(12,2) NOT NULL,
    "reach" INTEGER,
    "impressions" INTEGER,
    "clicks" INTEGER,
    "result_type" TEXT,
    "result_count" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'THB',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "source_ref" TEXT,
    "corrects_entry_id" UUID,
    "source" "AdSource" NOT NULL DEFAULT 'manual',
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_performance_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ad_campaigns_channel_is_active_external_campaign_name_idx" ON "ad_campaigns"("channel", "is_active", "external_campaign_name");

-- CreateIndex
CREATE INDEX "ad_campaigns_content_id_idx" ON "ad_campaigns"("content_id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_campaigns_channel_external_campaign_id_key" ON "ad_campaigns"("channel", "external_campaign_id");

-- CreateIndex
CREATE INDEX "ad_performance_entries_campaign_id_period_start_period_end_idx" ON "ad_performance_entries"("campaign_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "ad_performance_entries_created_at_idx" ON "ad_performance_entries"("created_at");

-- AddForeignKey
ALTER TABLE "ad_performance_entries" ADD CONSTRAINT "ad_performance_entries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =========================================================================
-- SECTION 2 — Hand-written DDL (Prisma cannot express any of this)
-- =========================================================================

-- -------------------------------------------------------------------------
-- 2.1  Cross-namespace FOREIGN KEYS *without* a Prisma relation field.
--      This is the separation mechanism. See the header, and
--      schema.prisma's comment block above `AdCampaign`.
-- -------------------------------------------------------------------------

-- SET NULL (not RESTRICT): a campaign's content picker link is informational
-- attribution, not a required fact. Deleting the content it was pinned to
-- must not block the delete, nor orphan the campaign record — mirrors
-- commerce_placements_source_asset_id_fkey's reasoning exactly.
ALTER TABLE "ad_campaigns"
    ADD CONSTRAINT "ad_campaigns_content_id_fkey"
    FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ad_campaigns"
    ADD CONSTRAINT "ad_campaigns_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ad_performance_entries"
    ADD CONSTRAINT "ad_performance_entries_recorded_by_fkey"
    FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Self-FK, SQL-level only (no Prisma relation — see schema.prisma comment
-- above AdPerformanceEntry.correctsEntryId). SET NULL, not RESTRICT: there is
-- no delete path for these append-only rows today, but if one is ever added,
-- a correction row naming a since-removed target should survive as an
-- orphaned-but-intact correction, not block the delete of the row it
-- corrects nor cascade-delete the correction itself.
ALTER TABLE "ad_performance_entries"
    ADD CONSTRAINT "ad_performance_entries_corrects_entry_id_fkey"
    FOREIGN KEY ("corrects_entry_id") REFERENCES "ad_performance_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- -------------------------------------------------------------------------
-- 2.2  CHECK constraints (System Analyst conditions P-A2, P-A3, SA-P6 —
--      docs/phase7-system-analyst-signoff.md)
-- -------------------------------------------------------------------------

-- P-A2: a negative planned budget is meaningless and must fail at the DB,
-- not rely on the DTO's `@Min(0)` alone — the DTO is absent from any future
-- non-HTTP write path, identical reasoning to every other numeric CHECK here.
ALTER TABLE "ad_campaigns"
    ADD CONSTRAINT "ad_campaigns_planned_budget_nonneg_chk"
    CHECK ("planned_budget" IS NULL OR "planned_budget" >= 0);

-- Design §1.2's own stated ordering rule, made a DB-level backstop rather
-- than a DTO-only check. NULL end_date ("still running") always passes.
ALTER TABLE "ad_campaigns"
    ADD CONSTRAINT "ad_campaigns_date_range_chk"
    CHECK ("end_date" IS NULL OR "end_date" >= "start_date");

-- SA-P6 / ISO-4217 shape, identical reasoning and identical pattern to
-- commerce_products_currency_chk / commerce_conversions_currency_chk:
-- `CHAR(3)` alone is blank-padded and would accept 'xx ', '123' or lowercase
-- 'thb' — a 'thb'/'THB' split would silently fragment a currency GROUP BY.
-- PAID_SUPPORTED_CURRENCIES (service-level, THB only per the admin's 2026-07-21
-- OQ-4 answer, bussiness_rule.md) is the v1 restriction; this CHECK is the
-- permanent shape guard regardless of that answer.
ALTER TABLE "ad_campaigns"
    ADD CONSTRAINT "ad_campaigns_currency_chk"
    CHECK ("currency" ~ '^[A-Z]{3}$');

-- Every numeric field on ad_performance_entries is CHECK'd non-negative —
-- ad spend has no real-world refund/reversal event (System Analyst SA-P2),
-- so there is no signed-amount case to accommodate, unlike commerce's
-- reversal_of_id ledger.
ALTER TABLE "ad_performance_entries"
    ADD CONSTRAINT "ad_performance_entries_spend_nonneg_chk"
    CHECK ("spend" >= 0);

ALTER TABLE "ad_performance_entries"
    ADD CONSTRAINT "ad_performance_entries_reach_nonneg_chk"
    CHECK ("reach" IS NULL OR "reach" >= 0);

ALTER TABLE "ad_performance_entries"
    ADD CONSTRAINT "ad_performance_entries_impressions_nonneg_chk"
    CHECK ("impressions" IS NULL OR "impressions" >= 0);

ALTER TABLE "ad_performance_entries"
    ADD CONSTRAINT "ad_performance_entries_clicks_nonneg_chk"
    CHECK ("clicks" IS NULL OR "clicks" >= 0);

ALTER TABLE "ad_performance_entries"
    ADD CONSTRAINT "ad_performance_entries_result_count_nonneg_chk"
    CHECK ("result_count" IS NULL OR "result_count" >= 0);

ALTER TABLE "ad_performance_entries"
    ADD CONSTRAINT "ad_performance_entries_period_chk"
    CHECK ("period_end" >= "period_start");

-- P-A3: a row cannot correct itself. NULL-safe, mirroring
-- commerce_conversions_no_self_reversal_chk exactly: a non-correction row
-- yields NULL <> id = NULL, which Postgres accepts as "not violated". The
-- service additionally validates (7A) that the corrected entry belongs to
-- the SAME campaignId — a DB-level cross-campaign check would need a
-- composite FK this schema does not carry.
ALTER TABLE "ad_performance_entries"
    ADD CONSTRAINT "ad_performance_entries_no_self_correction_chk"
    CHECK ("corrects_entry_id" <> "id");

ALTER TABLE "ad_performance_entries"
    ADD CONSTRAINT "ad_performance_entries_currency_chk"
    CHECK ("currency" ~ '^[A-Z]{3}$');
