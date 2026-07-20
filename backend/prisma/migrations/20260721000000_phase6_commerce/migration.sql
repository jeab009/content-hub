-- =========================================================================
-- Phase 6.0 — Commerce / Affiliate · Schema & Separation Gate
-- =========================================================================
--
-- ADDITIVE ONLY. This migration creates three enums, five tables and one
-- nullable column. It contains NO `ALTER TABLE posts`, `ALTER TABLE metrics`,
-- `ALTER TABLE ranking_scores`, `ALTER TABLE contents`, `ALTER TABLE comments`
-- or `ALTER TABLE audit_logs`, and NO `ALTER TYPE "Platform"` /
-- `ALTER TYPE "AssetPlatform"`. Verify by reading it: those strings do not
-- appear below.
--
-- ---------------------------------------------------------------------
-- WHY SHOPEE IS NOT A FIFTH `Platform` / `AssetPlatform` VALUE
-- ---------------------------------------------------------------------
-- `AssetPlatform` is not a labelling enum — it is the RANKING DOMAIN.
-- `ranking-v2.constants.ts` sets
--     RANKED_PLATFORMS_V2 = PLATFORM_TIE_BREAK_ORDER   (readonly AssetPlatform[])
-- so appending `shopee` there would have ENROLLED COMMERCE INTO v2 SCORING
-- immediately, with no code change and no failing test — silently breaching
-- the locked admin decision that ranking consumes payout + engagement +
-- override feedback ONLY (phase6-project-plan.md C-C, Decision 2).
--
-- Postgres enum additions are IRREVERSIBLE per the schema header rule
-- (System Analyst decision #9): the mistake would have been permanent.
-- Commerce therefore uses the parallel `CommerceChannel` enum — the same move
-- `AssetPlatform` itself made relative to `Platform` in Phase 1.5.
--
-- ---------------------------------------------------------------------
-- WHY SO MUCH OF THIS FILE IS HAND-WRITTEN DDL
-- ---------------------------------------------------------------------
-- Section 2 below is written by hand because Prisma's schema language cannot
-- express any of it: partial unique indexes (no WHERE clause in `@@unique`),
-- CHECK constraints, and — load-bearingly — FOREIGN KEYS WITHOUT A PRISMA
-- RELATION FIELD.
--
-- That last one is the phase's primary separation guarantee (design §2.1,
-- ADR-6.1). Prisma requires a back-relation on both sides of a declared
-- relation, so `ProductAnchor.post Post @relation(...)` would FORCE `Post` to
-- gain `productAnchors ProductAnchor[]`, making
--     prisma.post.findMany({ include: { productAnchors: true } })
-- a legal, type-checked call inside DashboardService. Declaring the FK here
-- instead keeps full referential integrity in Postgres while leaving the
-- Prisma client type graph with NO EDGE from the payout side into commerce.
-- The traversal is not forbidden by policy — it is unspellable.
--
-- Precedent in this repo: `posts_content_platform_active_key`
-- (20260718000000_bugqa001_posts_active_publish_unique) and the Phase 4
-- comments partial unique index are already DB objects Prisma cannot express,
-- declared in hand-written migration SQL and documented in schema.prisma.
--
-- OPERATIONAL NOTE: because these objects live only here, `prisma migrate dev`
-- will periodically propose "fixing" the drift. Review `prisma migrate diff`
-- output; never auto-apply it.
--
-- ROLLBACK: drop the five tables (children first: commerce_conversions,
-- product_anchors, affiliate_links, commerce_placements, commerce_products)
-- and the three enums. LEAVE `content_assets.duration_seconds` — it is
-- additive, nullable, harmless, and dropping it discards parsed durations.
--
-- =========================================================================
-- SECTION 1 — Prisma-generated DDL (enums, tables, indexes, in-namespace FKs)
-- =========================================================================

-- CreateEnum
CREATE TYPE "CommerceChannel" AS ENUM ('shopee', 'tiktok_shop');

-- CreateEnum
CREATE TYPE "CommerceSource" AS ENUM ('manual', 'api');

-- CreateEnum
CREATE TYPE "CommercePlacementStatus" AS ENUM ('recorded', 'removed');

-- AlterTable
ALTER TABLE "content_assets" ADD COLUMN     "duration_seconds" INTEGER;

-- CreateTable
CREATE TABLE "commerce_products" (
    "id" UUID NOT NULL,
    "channel" "CommerceChannel" NOT NULL,
    "external_product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "product_url" TEXT,
    "list_price" DECIMAL(12,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'THB',
    "commission_rate_pct" DECIMAL(5,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "retired_at" TIMESTAMP(3),
    "source" "CommerceSource" NOT NULL DEFAULT 'manual',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_links" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "tracking_code" TEXT,
    "sub_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "retired_at" TIMESTAMP(3),
    "source" "CommerceSource" NOT NULL DEFAULT 'manual',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_anchors" (
    "id" UUID NOT NULL,
    "post_id" UUID,
    "placement_id" UUID,
    "product_id" UUID NOT NULL,
    "affiliate_link_id" UUID,
    "anchor_position" INTEGER,
    "anchored_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    "source" "CommerceSource" NOT NULL DEFAULT 'manual',
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_placements" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "channel" "CommerceChannel" NOT NULL,
    "external_media_id" TEXT NOT NULL,
    "external_url" TEXT,
    "status" "CommercePlacementStatus" NOT NULL DEFAULT 'recorded',
    "publish_method" "PublishMethod" NOT NULL DEFAULT 'manual_external',
    "source_asset_id" UUID,
    "media_url" TEXT,
    "duration_seconds" INTEGER,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "source" "CommerceSource" NOT NULL DEFAULT 'manual',
    "recorded_by" UUID NOT NULL,
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_conversions" (
    "id" UUID NOT NULL,
    "channel" "CommerceChannel" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "orders_count" INTEGER,
    "items_sold" INTEGER,
    "gross_sales_amount" DECIMAL(12,2),
    "commission_amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'THB',
    "post_id" UUID,
    "placement_id" UUID,
    "product_id" UUID,
    "affiliate_link_id" UUID,
    "statement_ref" TEXT,
    "reversal_of_id" UUID,
    "source" "CommerceSource" NOT NULL DEFAULT 'manual',
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commerce_products_channel_is_active_name_idx" ON "commerce_products"("channel", "is_active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_products_channel_external_product_id_key" ON "commerce_products"("channel", "external_product_id");

-- CreateIndex
CREATE INDEX "affiliate_links_product_id_is_active_idx" ON "affiliate_links"("product_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_links_id_product_id_key" ON "affiliate_links"("id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_links_product_id_url_key" ON "affiliate_links"("product_id", "url");

-- CreateIndex
CREATE INDEX "product_anchors_post_id_idx" ON "product_anchors"("post_id");

-- CreateIndex
CREATE INDEX "product_anchors_placement_id_idx" ON "product_anchors"("placement_id");

-- CreateIndex
CREATE INDEX "product_anchors_product_id_idx" ON "product_anchors"("product_id");

-- CreateIndex
CREATE INDEX "commerce_placements_content_id_status_idx" ON "commerce_placements"("content_id", "status");

-- CreateIndex
CREATE INDEX "commerce_placements_channel_placed_at_idx" ON "commerce_placements"("channel", "placed_at");

-- CreateIndex
CREATE INDEX "commerce_conversions_channel_period_start_period_end_idx" ON "commerce_conversions"("channel", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "commerce_conversions_product_id_period_start_idx" ON "commerce_conversions"("product_id", "period_start");

-- CreateIndex
CREATE INDEX "commerce_conversions_placement_id_idx" ON "commerce_conversions"("placement_id");

-- CreateIndex
CREATE INDEX "commerce_conversions_created_at_idx" ON "commerce_conversions"("created_at");

-- AddForeignKey
ALTER TABLE "affiliate_links" ADD CONSTRAINT "affiliate_links_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "commerce_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_anchors" ADD CONSTRAINT "product_anchors_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "commerce_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_anchors" ADD CONSTRAINT "product_anchors_affiliate_link_id_fkey" FOREIGN KEY ("affiliate_link_id") REFERENCES "affiliate_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_anchors" ADD CONSTRAINT "product_anchors_placement_id_fkey" FOREIGN KEY ("placement_id") REFERENCES "commerce_placements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =========================================================================
-- SECTION 2 — Hand-written DDL (Prisma cannot express any of this)
-- =========================================================================

-- -------------------------------------------------------------------------
-- 2.1  Cross-namespace FOREIGN KEYS *without* a Prisma relation field.
--      This is the separation mechanism. See the header.
-- -------------------------------------------------------------------------

ALTER TABLE "product_anchors"
    ADD CONSTRAINT "product_anchors_post_id_fkey"
    FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_anchors"
    ADD CONSTRAINT "product_anchors_recorded_by_fkey"
    FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commerce_products"
    ADD CONSTRAINT "commerce_products_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "affiliate_links"
    ADD CONSTRAINT "affiliate_links_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commerce_placements"
    ADD CONSTRAINT "commerce_placements_content_id_fkey"
    FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL (not RESTRICT): source_asset_id is an informational back-reference
-- used to pre-fill media_url/duration_seconds, exactly like Post.rankingScoreId.
-- Deleting the asset must not block deleting it, nor orphan the placement.
ALTER TABLE "commerce_placements"
    ADD CONSTRAINT "commerce_placements_source_asset_id_fkey"
    FOREIGN KEY ("source_asset_id") REFERENCES "content_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "commerce_placements"
    ADD CONSTRAINT "commerce_placements_recorded_by_fkey"
    FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commerce_conversions"
    ADD CONSTRAINT "commerce_conversions_post_id_fkey"
    FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commerce_conversions"
    ADD CONSTRAINT "commerce_conversions_placement_id_fkey"
    FOREIGN KEY ("placement_id") REFERENCES "commerce_placements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commerce_conversions"
    ADD CONSTRAINT "commerce_conversions_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "commerce_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commerce_conversions"
    ADD CONSTRAINT "commerce_conversions_affiliate_link_id_fkey"
    FOREIGN KEY ("affiliate_link_id") REFERENCES "affiliate_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commerce_conversions"
    ADD CONSTRAINT "commerce_conversions_recorded_by_fkey"
    FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Self-FK: a reversal row may name the row it reverses. Modelled explicitly so
-- "which correction cancels which line" never has to be encoded in the
-- free-text statement_ref — the absence of this column would actively create
-- PDPA pressure to paste an order id there (System Analyst SA-2).
ALTER TABLE "commerce_conversions"
    ADD CONSTRAINT "commerce_conversions_reversal_of_id_fkey"
    FOREIGN KEY ("reversal_of_id") REFERENCES "commerce_conversions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -------------------------------------------------------------------------
-- 2.2  Composite FK — a link may only be attached to an anchor for ITS OWN
--      product. Targets affiliate_links(id, product_id), which is why that
--      otherwise-pointless UNIQUE exists on the links table.
--
--      MATCH SIMPLE (the default) means a NULL affiliate_link_id skips the
--      check entirely — which is the intended "anchored, but no link" case.
--
--      Without this, an index-misaligned client payload could attach product
--      A's tracking link to product B's anchor and the database would accept
--      it. Data-integrity holes the plan left to app code are closed here.
-- -------------------------------------------------------------------------

ALTER TABLE "product_anchors"
    ADD CONSTRAINT "product_anchors_link_belongs_to_product_fkey"
    FOREIGN KEY ("affiliate_link_id", "product_id")
    REFERENCES "affiliate_links"("id", "product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -------------------------------------------------------------------------
-- 2.3  CHECK constraints
-- -------------------------------------------------------------------------

-- Exactly one anchor target. num_nonnulls is NULL-safe by construction; the
-- equivalent `(post_id IS NULL) <> (placement_id IS NULL)` form reads worse.
ALTER TABLE "product_anchors"
    ADD CONSTRAINT "product_anchors_one_target_chk"
    CHECK (num_nonnulls("post_id", "placement_id") = 1);

-- anchor_position orders the basket UI. Deliberately NOT unique per target:
-- a drag-reorder that swaps two positions would deadlock against a unique
-- index without a deferrable constraint or a two-phase update, and the cost
-- of a tie is cosmetic. Ties break by `anchored_at` — see
-- COMMERCE_ANCHOR_ORDER_TIE_BREAK in commerce.constants.ts, which the read
-- path must honour so the order is at least deterministic.
ALTER TABLE "product_anchors"
    ADD CONSTRAINT "product_anchors_position_nonneg_chk"
    CHECK ("anchor_position" IS NULL OR "anchor_position" >= 0);

-- ⚠ SHOPEE 10–60s — READ THE NULL HANDLING BEFORE EDITING.
--
-- The naive form
--     CHECK (channel <> 'shopee' OR duration_seconds BETWEEN 10 AND 60)
-- SILENTLY PASSES a NULL duration: for a shopee row it evaluates to
-- FALSE OR NULL = NULL, and Postgres treats a NULL CHECK result as
-- "not violated". That is the exact opposite of the locked rule that an
-- unknown duration is a REJECTION, never a pass.
--
-- The `IS NOT NULL` conjunct below is therefore mandatory, not defensive
-- styling. This constraint is the fail-closed backstop behind the service
-- guard and the DTO — the layer that still holds when a future adapter path
-- writes a row without going through either.
ALTER TABLE "commerce_placements"
    ADD CONSTRAINT "commerce_placements_shopee_duration_chk"
    CHECK (
        "channel" <> 'shopee'
        OR ("duration_seconds" IS NOT NULL AND "duration_seconds" BETWEEN 10 AND 60)
    );

-- PDPA blast-radius cap (System Analyst condition A4, reduced from the
-- design's 500). `note` is one of exactly two free-text columns in the
-- commerce schema. 200 characters still holds "reshot vertical, approved by
-- admin 07-14"; 500 was an invitation. No regex here — a note has genuine
-- prose value and a regex would be theatre.
ALTER TABLE "commerce_placements"
    ADD CONSTRAINT "commerce_placements_note_len_chk"
    CHECK ("note" IS NULL OR char_length("note") <= 200);

ALTER TABLE "commerce_conversions"
    ADD CONSTRAINT "commerce_conversions_period_chk"
    CHECK ("period_end" >= "period_start");

ALTER TABLE "commerce_conversions"
    ADD CONSTRAINT "commerce_conversions_counts_chk"
    CHECK (
        ("orders_count" IS NULL OR "orders_count" >= 0)
        AND ("items_sold" IS NULL OR "items_sold" >= 0)
    );

-- A row cannot reverse itself (System Analyst SA-2). NULL-safe: a non-reversal
-- row yields NULL <> id = NULL, which Postgres accepts.
ALTER TABLE "commerce_conversions"
    ADD CONSTRAINT "commerce_conversions_no_self_reversal_chk"
    CHECK ("reversal_of_id" <> "id");

-- statement_ref length cap. The FORMAT constraint
-- (COMMERCE_STATEMENT_REF_PATTERN) is enforced in the service rather than
-- here, because a CHECK cannot produce the 400 with a helpful message that the
-- admin needs; this is the length backstop only.
ALTER TABLE "commerce_conversions"
    ADD CONSTRAINT "commerce_conversions_statement_ref_len_chk"
    CHECK ("statement_ref" IS NULL OR char_length("statement_ref") <= 64);

-- ISO-4217 shape on every money-bearing table (System Analyst SA-9).
-- `CHAR(3)` alone is blank-padded and would happily accept 'xx ', '123' or
-- lowercase 'thb' — and a 'thb'/'THB' split would silently fragment every
-- currency GROUP BY, producing two half-totals that each look plausible.
-- The v1 service additionally REJECTS anything but THB
-- (COMMERCE_SUPPORTED_CURRENCIES); relaxing a service guard later is free,
-- whereas adding a column later is not.
ALTER TABLE "commerce_products"
    ADD CONSTRAINT "commerce_products_currency_chk"
    CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "commerce_conversions"
    ADD CONSTRAINT "commerce_conversions_currency_chk"
    CHECK ("currency" ~ '^[A-Z]{3}$');

-- -------------------------------------------------------------------------
-- 2.4  PARTIAL unique indexes (no WHERE clause in Prisma's `@@unique`)
-- -------------------------------------------------------------------------

-- "One live anchor per (target, product)", PARTIAL on removed_at IS NULL so an
-- un-anchor → re-anchor cycle is possible without deleting audit history.
-- Identical shape and reasoning to posts_content_platform_active_key.
CREATE UNIQUE INDEX "product_anchors_post_product_active_key"
    ON "product_anchors" ("post_id", "product_id")
    WHERE "removed_at" IS NULL AND "post_id" IS NOT NULL;

CREATE UNIQUE INDEX "product_anchors_placement_product_active_key"
    ON "product_anchors" ("placement_id", "product_id")
    WHERE "removed_at" IS NULL AND "placement_id" IS NOT NULL;

-- One ACTIVE placement per (content, channel). Mirrors
-- posts_content_platform_active_key exactly, including the reason: the
-- app-level check is the friendly path, this index is the race-proof backstop
-- that closes the TOCTOU window two concurrent requests would otherwise open.
CREATE UNIQUE INDEX "commerce_placements_content_channel_active_key"
    ON "commerce_placements" ("content_id", "channel")
    WHERE "status" <> 'removed';
