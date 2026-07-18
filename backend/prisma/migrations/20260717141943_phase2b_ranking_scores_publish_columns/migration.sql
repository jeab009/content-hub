-- CreateEnum
CREATE TYPE "EngineVersion" AS ENUM ('v1', 'v2');

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "override_reason" TEXT,
ADD COLUMN     "ranking_score_id" UUID,
ADD COLUMN     "recommended_platform" "AssetPlatform",
ADD COLUMN     "selected_platform" "AssetPlatform",
ADD COLUMN     "was_override" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ranking_scores" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "platform" "AssetPlatform" NOT NULL,
    "score" DECIMAL(10,4) NOT NULL,
    "reasoning" JSONB NOT NULL,
    "engine_version" "EngineVersion" NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranking_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ranking_scores_content_id_computed_at_idx" ON "ranking_scores"("content_id", "computed_at");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_ranking_score_id_fkey" FOREIGN KEY ("ranking_score_id") REFERENCES "ranking_scores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_scores" ADD CONSTRAINT "ranking_scores_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
