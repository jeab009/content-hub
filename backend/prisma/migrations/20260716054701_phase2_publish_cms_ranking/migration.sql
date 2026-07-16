-- AlterEnum
ALTER TYPE "PostStatus" ADD VALUE 'posted_unconfirmed';

-- AlterTable
ALTER TABLE "contents" ADD COLUMN     "file_size_bytes" BIGINT,
ADD COLUMN     "mime_type" TEXT;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;
