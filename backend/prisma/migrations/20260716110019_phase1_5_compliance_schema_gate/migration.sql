-- CreateEnum
CREATE TYPE "ContentPillar" AS ENUM ('product', 'drama', 'comedy');

-- CreateEnum
CREATE TYPE "TargetAgeSegment" AS ENUM ('18-22', '23-30', '31-45', '46+');

-- CreateEnum
CREATE TYPE "CopyrightClearance" AS ENUM ('not_checked', 'cleared', 'blocked');

-- CreateEnum
CREATE TYPE "AssetPlatform" AS ENUM ('facebook', 'youtube', 'tiktok', 'line_oa');

-- CreateEnum
CREATE TYPE "AspectRatio" AS ENUM ('1:1', '4:5', '9:16', '16:9');

-- CreateEnum
CREATE TYPE "CadencePeriodUnit" AS ENUM ('week', 'month');

-- AlterTable
ALTER TABLE "contents" ADD COLUMN     "content_pillar" "ContentPillar",
ADD COLUMN     "copyright_cleared" "CopyrightClearance" NOT NULL DEFAULT 'not_checked',
ADD COLUMN     "copyright_evidence_url" TEXT,
ADD COLUMN     "copyright_notes" TEXT,
ADD COLUMN     "target_age_segment" "TargetAgeSegment";

-- CreateTable
CREATE TABLE "content_assets" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "platform" "AssetPlatform" NOT NULL,
    "aspect_ratio" "AspectRatio" NOT NULL,
    "media_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pillar_ratio_policies" (
    "id" UUID NOT NULL,
    "content_pillar" "ContentPillar" NOT NULL,
    "target_ratio_pct" DECIMAL(5,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "is_provisional" BOOLEAN NOT NULL DEFAULT true,
    "created_by_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pillar_ratio_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_cadence_targets" (
    "id" UUID NOT NULL,
    "platform" "AssetPlatform" NOT NULL,
    "target_posts_per_period" INTEGER NOT NULL,
    "period_unit" "CadencePeriodUnit" NOT NULL,
    "effective_from" DATE NOT NULL,
    "is_provisional" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_cadence_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_assets_content_id_idx" ON "content_assets"("content_id");

-- AddForeignKey
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
