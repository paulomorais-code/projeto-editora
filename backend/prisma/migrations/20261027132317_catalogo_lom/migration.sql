-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "collection" TEXT,
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pages" INTEGER,
ADD COLUMN     "promoPriceCents" INTEGER,
ADD COLUMN     "year" INTEGER;
