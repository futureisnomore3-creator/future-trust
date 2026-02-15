-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "crossSellEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "desktopPosition" TEXT NOT NULL DEFAULT 'bottom_left',
ADD COLUMN     "hideMobile" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mobilePosition" TEXT NOT NULL DEFAULT 'top',
ADD COLUMN     "showVerified" BOOLEAN NOT NULL DEFAULT true;
