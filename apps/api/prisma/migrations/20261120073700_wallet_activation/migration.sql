-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "activationAttemptAt" TIMESTAMP(3),
ADD COLUMN     "activationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "activationError" TEXT,
ADD COLUMN     "activationTxHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_activationTxHash_key" ON "Wallet"("activationTxHash");

-- CreateIndex
CREATE INDEX "Wallet_activatedAt_activationAttemptAt_idx" ON "Wallet"("activatedAt", "activationAttemptAt");

