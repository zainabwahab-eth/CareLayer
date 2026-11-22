-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "attemptAt" TIMESTAMP(3),
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "settleDeadline" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "attemptAt" TIMESTAMP(3),
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failureReason" TEXT;

-- CreateIndex
CREATE INDEX "Payment_status_attemptAt_idx" ON "Payment"("status", "attemptAt");

-- CreateIndex
CREATE INDEX "Payout_status_createdAt_idx" ON "Payout"("status", "createdAt");
