-- AlterTable
ALTER TABLE "Topup" ADD COLUMN     "creditAttemptAt" TIMESTAMP(3),
ADD COLUMN     "creditAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paidAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Topup_status_createdAt_idx" ON "Topup"("status", "createdAt");

