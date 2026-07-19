-- CreateEnum
CREATE TYPE "PublishMethod" AS ENUM ('adapter', 'manual_external');

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "external_post_url" TEXT,
ADD COLUMN     "publish_method" "PublishMethod" NOT NULL DEFAULT 'adapter';
