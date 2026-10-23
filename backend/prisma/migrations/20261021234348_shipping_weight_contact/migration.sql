-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerEmailEnc" TEXT,
ADD COLUMN     "shippingCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shippingMethod" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "weightGrams" INTEGER NOT NULL DEFAULT 300;
